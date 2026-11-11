const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const {
  protect,
  requireSuperAdmin,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} = require('../middleware/auth');
const { validate, validateObjectIdParam } = require('../validators/index');
const { authLimiter, setupLimiter } = require('../middleware/security');
const { ApiError, catchAsync, sanitizeUser } = require('../utils/helpers');
const { env } = require('../config/env');
const logger = require('../utils/logger');

const router = express.Router();

const REFRESH_COOKIE_NAME = 'rt';
const refreshCookieOptions = {
  httpOnly: true, // never readable by JS — immune to XSS-based token theft
  secure: env.COOKIE_SECURE,
  sameSite: env.COOKIE_SAMESITE, // 'lax'/'strict' — the primary CSRF defense
  path: '/api/auth',
  maxAge: env.JWT_REFRESH_EXPIRES_MS,
};

function issueSession(res, user) {
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions);
  return accessToken;
}

// ===========================================================================
// Math CAPTCHA untuk login
// ===========================================================================
// Tujuan: memaksa setiap percobaan login melewati satu langkah yang mahal
// untuk diotomatisasi (bot credential-stuffing), tetapi tetap mudah bagi
// manusia. Hanya memakai empat operasi dasar: + − × ÷.
//
// Rancangan keamanannya (semuanya mandiri di file ini, tanpa dependensi baru):
//   1. Jawaban TIDAK PERNAH dikirim ke klien. Klien hanya menerima soal dalam
//      bentuk teks dan sebuah token buram.
//   2. Token adalah amplop terenkripsi AES-256-GCM (kunci diturunkan dari
//      JWT_REFRESH_SECRET yang tidak pernah meninggalkan server). GCM
//      sekaligus menjamin integritas — token yang diubah gagal didekripsi,
//      jadi jawaban tidak bisa dipalsukan atau dibaca dari sisi klien.
//   3. Token mengikat id challenge ke cookie httpOnly "cpt". Token yang dicuri
//      dari browser lain (tanpa cookie-nya) otomatis ditolak.
//   4. Sekali pakai. Setiap token yang berhasil didekripsi langsung dihanguskan
//      — termasuk saat jawabannya SALAH — sehingga satu challenge hanya memberi
//      satu tebakan. Ini yang membuat brute-force jawaban tidak berguna.
//   5. Kedaluwarsa singkat (5 menit) dan jawaban dibandingkan constant-time.
//   6. Penghitung kegagalan per-IP memberi jeda tambahan setelah terlalu banyak
//      jawaban salah, di atas rate limiter authLimiter yang sudah ada.
// Alasan logika ini berada di middleware (bukan di handler): ia harus berjalan
// SEBELUM validate('login'), karena validator memakai stripUnknown dan akan
// membuang field captchaToken/captchaAnswer dari req.body. Middleware mengunci
// kedua nilai itu lebih dulu, jadi skema login tidak perlu diubah sama sekali.

const CAPTCHA_COOKIE_NAME = 'cpt';
// Umur challenge. Cukup lama untuk mengetik jawaban, cukup pendek agar token
// kedaluwarsa sebelum bisa dikumpulkan dalam jumlah besar.
const CAPTCHA_TTL_MS = 5 * 60 * 1000;
// Batas atas hasil supaya soalnya tetap bisa dihitung di kepala.
const CAPTCHA_MAX_ANSWER = 200;
// Batas panjang jawaban yang diterima (jawaban selalu bilangan bulat kecil).
const CAPTCHA_ANSWER_PATTERN = /^-?\d{1,5}$/;
// Ambang & jendela penalti per-IP untuk jawaban salah.
const CAPTCHA_MAX_FAILURES = 10;
const CAPTCHA_FAILURE_WINDOW_MS = 15 * 60 * 1000;
// Batas jumlah token yang diingat untuk anti-replay; entri kedaluwarsa
// dibersihkan lebih dulu sehingga peta ini tidak tumbuh tanpa batas.
const CAPTCHA_REPLAY_CACHE_LIMIT = 5000;

// Kunci AES-256 (32 byte) yang diturunkan dari secret server. Dilabeli domain
// ("captcha:") supaya kunci ini tidak pernah sama dengan kunci JWT mana pun.
const CAPTCHA_KEY = crypto.createHash('sha256').update(`captcha:${env.JWT_REFRESH_SECRET}`).digest();

const CAPTCHA_OPERATORS = ['+', '-', '×', '÷'];

// Rate limiter khusus endpoint penerbitan captcha: mencegah bot menggerus
// challenge tanpa batas (dan tanpa ini, satu IP bisa memanen ribuan token).
const captchaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Terlalu banyak permintaan captcha, coba lagi nanti.' },
});

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Satu langkah operasi. Mengembalikan null bila langkah itu tidak "manusiawi"
// (hasil negatif, pembagian tidak bulat, atau hasil membengkak) sehingga
// generator bisa mencoba kombinasi lain. Pembagian SELALU dibuat pas
// (mis. 24 ÷ 3) agar jawabannya bilangan bulat positif.
function applyCaptchaStep(value, operator) {
  switch (operator) {
    case '+': {
      const b = randInt(1, 25);
      if (value + b > CAPTCHA_MAX_ANSWER) return null;
      return { value: value + b, text: `+ ${b}` };
    }
    case '-': {
      // Tidak pernah menghasilkan bilangan negatif — captcha untuk gerbang
      // login sebaiknya tidak menyulitkan pengguna sahnya sendiri.
      const max = Math.min(value, 25);
      if (max < 1) return null;
      const b = randInt(1, max);
      return { value: value - b, text: `− ${b}` };
    }
    case '×': {
      const b = randInt(2, 9);
      if (value * b > CAPTCHA_MAX_ANSWER) return null;
      return { value: value * b, text: `× ${b}` };
    }
    case '÷': {
      // Cari pembagi yang membagi habis; kalau tidak ada, langkah ini batal.
      const divisors = [];
      for (let d = 2; d <= 9; d += 1) {
        if (value % d === 0 && value / d >= 1) divisors.push(d);
      }
      if (divisors.length === 0) return null;
      const divisor = divisors[randInt(0, divisors.length - 1)];
      return { value: value / divisor, text: `÷ ${divisor}` };
    }
    default:
      return null;
  }
}

// Membuat soal. Sebagian besar satu langkah, sisanya dua langkah (mis.
// "6 × 3 − 4") yang dihitung dari kiri ke kanan — ruang jawabannya lebih luas
// tanpa menambah kesulitan berarti. Kalau 25 percobaan acak tidak menghasilkan
// soal valid (praktis tidak mungkin), fallback ke penjumlahan sederhana yang
// pasti valid.
function generateMathChallenge() {
  const steps = Math.random() < 0.6 ? 1 : 2;

  for (let attempt = 0; attempt < 25; attempt += 1) {
    let value = randInt(2, 15);
    let question = String(value);
    let valid = true;

    for (let i = 0; i < steps; i += 1) {
      const operator = CAPTCHA_OPERATORS[randInt(0, CAPTCHA_OPERATORS.length - 1)];
      const applied = applyCaptchaStep(value, operator);
      if (!applied) {
        valid = false;
        break;
      }
      value = applied.value;
      question += ` ${applied.text}`;
    }

    if (valid && value >= 0 && value <= CAPTCHA_MAX_ANSWER) {
      return { question, answer: value };
    }
  }

  const a = randInt(2, 30);
  const b = randInt(2, 30);
  return { question: `${a} + ${b}`, answer: a + b };
}

// iv(12) || authTag(16) || ciphertext — base64url agar aman ditaruh di JSON.
function encryptCaptchaChallenge(payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', CAPTCHA_KEY, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

// Mengembalikan null untuk token apa pun yang rusak, dipalsukan, atau dibuat
// dengan kunci lain. Tidak pernah melempar — pemanggil cukup memperlakukannya
// sebagai "captcha tidak valid".
function decryptCaptchaChallenge(token) {
  if (typeof token !== 'string' || token.length < 24 || token.length > 2048) return null;
  try {
    const raw = Buffer.from(token, 'base64url');
    if (raw.length < 12 + 16 + 2) return null;
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const body = raw.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', CAPTCHA_KEY, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
    const parsed = JSON.parse(plain);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

// Anti-replay: token yang sudah dipakai (benar ATAU salah) tidak bisa dipakai
// lagi. Kunci peta = hash token, nilainya = waktu kedaluwarsa.
const usedCaptchaTokens = new Map();

function pruneUsedCaptchaTokens() {
  const now = Date.now();
  for (const [key, expiresAt] of usedCaptchaTokens) {
    if (expiresAt <= now) usedCaptchaTokens.delete(key);
  }
  // Pengaman terakhir bila lalu lintas sangat tinggi dalam jendela 5 menit:
  // buang entri terlama (Map menjaga urutan penyisipan).
  while (usedCaptchaTokens.size > CAPTCHA_REPLAY_CACHE_LIMIT) {
    const oldest = usedCaptchaTokens.keys().next().value;
    usedCaptchaTokens.delete(oldest);
  }
}

function captchaTokenDigest(token) {
  return crypto.createHash('sha256').update(token).digest('base64url');
}

function isCaptchaTokenUsed(token) {
  return usedCaptchaTokens.has(captchaTokenDigest(token));
}

function markCaptchaTokenUsed(token, expiresAt) {
  pruneUsedCaptchaTokens();
  // Selalu simpan waktu kedaluwarsa yang valid; bila token tidak membawa exp
  // yang masuk akal, pakai TTL standar supaya entri tetap bisa dibersihkan
  // dan peta ini tidak bocor.
  const ttl = Number.isFinite(expiresAt) ? expiresAt : Date.now() + CAPTCHA_TTL_MS;
  usedCaptchaTokens.set(captchaTokenDigest(token), Math.max(ttl, Date.now() + 1000));
}

// Penghitung jawaban salah per-IP. Bukan pengganti authLimiter, melainkan
// lapisan tambahan yang memberi jeda khusus setelah captcha sering gagal —
// pola khas script yang menebak jawaban.
const captchaFailures = new Map();

function registerCaptchaFailure(ip) {
  const now = Date.now();
  const entry = captchaFailures.get(ip);
  if (!entry || entry.resetAt <= now) {
    captchaFailures.set(ip, { count: 1, resetAt: now + CAPTCHA_FAILURE_WINDOW_MS });
    return 1;
  }
  entry.count += 1;
  return entry.count;
}

function isCaptchaBlocked(ip) {
  const entry = captchaFailures.get(ip);
  if (!entry) return false;
  if (entry.resetAt <= Date.now()) {
    captchaFailures.delete(ip);
    return false;
  }
  return entry.count >= CAPTCHA_MAX_FAILURES;
}

function captchaCookieOptions() {
  return {
    httpOnly: true, // token pengikat challenge tidak perlu dibaca JS
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAMESITE,
    path: '/api/auth',
    maxAge: CAPTCHA_TTL_MS,
  };
}

// Perbandingan constant-time supaya waktu respons tidak membocorkan jawaban.
function safeEqualStrings(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// GET /api/auth/captcha — menerbitkan satu soal matematika. Soal dikirim
// sebagai teks, jawabannya hanya hidup di dalam token terenkripsi.
router.get(
  '/captcha',
  captchaLimiter,
  catchAsync(async (req, res) => {
    if (isCaptchaBlocked(req.ip)) {
      throw new ApiError(
        429,
        'Terlalu banyak jawaban captcha yang salah. Coba lagi dalam beberapa menit.'
      );
    }

    const { question, answer } = generateMathChallenge();
    const id = crypto.randomBytes(16).toString('base64url');
    const expiresAt = Date.now() + CAPTCHA_TTL_MS;
    const token = encryptCaptchaChallenge({ id, answer, exp: expiresAt });

    res.set('Cache-Control', 'no-store');
    res.cookie(CAPTCHA_COOKIE_NAME, id, captchaCookieOptions());
    res.json({
      captcha: {
        token,
        question,
        expiresIn: Math.floor(CAPTCHA_TTL_MS / 1000),
      },
    });
  })
);

// Gerbang verifikasi. Dipasang pada /login SEBELUM validate('login') — lihat
// catatan rancangan di atas soal stripUnknown. Setiap kegagalan selalu
// menandai token sebagai terpakai, jadi satu challenge = satu tebakan.
function requireMathCaptcha(req, res, next) {
  const failWith = (status, message) => {
    // Cookie ikut dibersihkan agar klien terdorong mengambil challenge baru.
    res.clearCookie(CAPTCHA_COOKIE_NAME, { path: '/api/auth' });
    return next(new ApiError(status, message));
  };

  try {
    const token = req.body?.captchaToken;
    const rawAnswer = req.body?.captchaAnswer;

    if (typeof token !== 'string' || !token.trim()) {
      return failWith(400, 'Verifikasi keamanan (captcha) wajib diisi. Silakan muat ulang captcha.');
    }
    if (rawAnswer === undefined || rawAnswer === null || String(rawAnswer).trim() === '') {
      return failWith(400, 'Jawaban captcha wajib diisi.');
    }

    const payload = decryptCaptchaChallenge(token);
    if (!payload) {
      return failWith(400, 'Captcha tidak valid. Silakan muat ulang captcha.');
    }

    // Token terikat pada cookie httpOnly; token tanpa cookie pasangannya
    // (mis. hasil curian dari browser/perangkat lain) langsung ditolak.
    const boundId = req.cookies?.[CAPTCHA_COOKIE_NAME];
    if (!boundId || !safeEqualStrings(boundId, payload.id)) {
      markCaptchaTokenUsed(token, payload.exp);
      return failWith(400, 'Captcha tidak cocok dengan sesi browser ini. Silakan muat ulang captcha.');
    }

    if (typeof payload.exp !== 'number' || payload.exp <= Date.now()) {
      markCaptchaTokenUsed(token, payload.exp);
      return failWith(400, 'Captcha sudah kedaluwarsa. Silakan muat ulang captcha.');
    }

    if (isCaptchaTokenUsed(token)) {
      return failWith(400, 'Captcha sudah dipakai. Silakan muat ulang captcha.');
    }

    const answer = String(rawAnswer).trim();
    if (!CAPTCHA_ANSWER_PATTERN.test(answer)) {
      markCaptchaTokenUsed(token, payload.exp);
      return failWith(400, 'Jawaban captcha tidak valid. Masukkan angka saja.');
    }

    // Token dihanguskan SEBELUM hasil dibandingkan: jawaban salah pun
    // menghabiskan challenge, sehingga menebak tidak bisa berulang.
    markCaptchaTokenUsed(token, payload.exp);
    res.clearCookie(CAPTCHA_COOKIE_NAME, { path: '/api/auth' });

    if (!safeEqualStrings(answer, String(payload.answer))) {
      const failures = registerCaptchaFailure(req.ip);
      logger.warn(`Captcha login gagal dari ${req.ip} (kegagalan ke-${failures}).`);
      return failWith(400, 'Jawaban captcha salah. Silakan muat ulang captcha dan coba lagi.');
    }

    logger.debug(`Captcha login terverifikasi untuk ${req.ip}.`);
    return next();
  } catch (err) {
    return next(err);
  }
}

// GET /api/auth/setup-status — lets the frontend decide whether to show the
// "create admin account" screen or the normal login screen.
router.get(
  '/setup-status',
  catchAsync(async (req, res) => {
    const count = await User.estimatedDocumentCount();
    res.json({ needsSetup: count === 0 });
  })
);

// POST /api/auth/setup — creates the first admin account. Self-limiting:
// once any user exists this route refuses forever, which is what stops an
// attacker from registering themselves as admin on an exposed instance.
router.post(
  '/setup',
  setupLimiter,
  validate('setup'),
  catchAsync(async (req, res) => {
    const count = await User.estimatedDocumentCount();
    if (count > 0) {
      throw new ApiError(403, 'Setup sudah selesai. Silakan login.');
    }
    // Akun pertama selalu superadmin: dialah yang nantinya boleh mengelola
    // pengguna lain. Tanpa ini, sistem baru akan terkunci — tidak ada satu pun
    // akun yang berhak membuka menu Pengguna.
    const user = await User.create({ ...req.body, role: 'superadmin', isActive: true });
    const accessToken = issueSession(res, user);
    res.status(201).json({ accessToken, user: sanitizeUser(user) });
  })
);

router.post(
  '/login',
  authLimiter,
  // Captcha diverifikasi SEBELUM validate('login'): validator memakai
  // stripUnknown dan akan membuang field captchaToken/captchaAnswer dari
  // req.body, sedangkan middleware ini perlu membacanya lebih dulu. Dengan
  // urutan ini skema login (validators/index.js) tidak perlu diubah.
  requireMathCaptcha,
  validate('login'),
  catchAsync(async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email }).select('+password +tokenVersion +failedLoginAttempts +lockUntil');

    // Same generic message whether the email doesn't exist or the password
    // is wrong — prevents account enumeration via error message.
    const genericError = () => new ApiError(401, 'Email atau kata sandi salah.');

    if (!user) throw genericError();
    if (user.isLocked()) {
      throw new ApiError(429, 'Akun terkunci sementara karena terlalu banyak percobaan gagal. Coba lagi nanti.');
    }

    const valid = await user.comparePassword(password);
    if (!valid) {
      await user.registerFailedLogin();
      throw genericError();
    }

    // Status akun diperiksa *setelah* kata sandi terbukti benar, supaya pesan
    // "akun dinonaktifkan" tidak bisa dipakai untuk menebak email mana yang
    // terdaftar (account enumeration).
    if (user.isActive === false) {
      throw new ApiError(403, 'Akun Anda dinonaktifkan. Hubungi administrator.');
    }

    await user.registerSuccessfulLogin();
    const accessToken = issueSession(res, user);
    res.json({ accessToken, user: sanitizeUser(user) });
  })
);

// POST /api/auth/refresh — the only endpoint that trusts the cookie. Rotates
// the refresh token on every use (refresh token rotation) so a captured
// token has a single, narrow window of use.
router.post(
  '/refresh',
  catchAsync(async (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE_NAME];
    if (!token) throw new ApiError(401, 'Tidak ada sesi aktif.');

    let payload;
    try {
      payload = verifyRefreshToken(token);
    } catch {
      res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/auth' });
      throw new ApiError(401, 'Sesi kedaluwarsa. Silakan login kembali.');
    }

    const user = await User.findById(payload.sub).select('+tokenVersion');
    if (!user || user.tokenVersion !== payload.tokenVersion) {
      res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/auth' });
      throw new ApiError(401, 'Sesi tidak valid. Silakan login kembali.');
    }

    // Sama seperti protect: akun yang dinonaktifkan tidak boleh memperpanjang
    // sesinya lewat refresh token yang masih tersimpan di cookie.
    if (user.isActive === false) {
      res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/auth' });
      throw new ApiError(403, 'Akun Anda dinonaktifkan. Hubungi administrator.');
    }

    const accessToken = issueSession(res, user);
    res.json({ accessToken, user: sanitizeUser(user) });
  })
);

router.post('/logout', (req, res) => {
  res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/auth' });
  res.status(204).end();
});

// Invalidates every outstanding access + refresh token for this account
// immediately (e.g. "sign out of all devices").
router.post(
  '/logout-all',
  protect,
  catchAsync(async (req, res) => {
    req.user.tokenVersion += 1;
    await req.user.save();
    res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/auth' });
    res.status(204).end();
  })
);

router.get('/me', protect, (req, res) => {
  res.json({ user: sanitizeUser(req.user) });
});

router.patch(
  '/profile',
  protect,
  validate('updateProfile'),
  catchAsync(async (req, res) => {
    req.user.name = req.body.name;
    await req.user.save();
    res.json({ user: sanitizeUser(req.user) });
  })
);

// Changing your password bumps tokenVersion, which logs out every other
// session/device using this account — the expected behaviour after a
// credential change.
router.patch(
  '/password',
  protect,
  validate('changePassword'),
  catchAsync(async (req, res) => {
    const user = await User.findById(req.user._id).select('+password +tokenVersion');
    const valid = await user.comparePassword(req.body.currentPassword);
    if (!valid) throw new ApiError(400, 'Kata sandi saat ini salah.');

    user.password = req.body.newPassword;
    user.tokenVersion += 1;
    await user.save();

    const accessToken = issueSession(res, user);
    res.json({ accessToken, user: sanitizeUser(user) });
  })
);

// --- Manajemen pengguna (khusus Super Admin) ------------------------------
// Seluruh endpoint di bawah dijaga requireSuperAdmin: Admin biasa dapat
// mengelola monitor/pengaturan, tetapi tidak boleh melihat atau mengubah
// daftar pengguna. Ini yang membedakan kedua role.

// Berapa banyak superadmin yang masih aktif. Dipakai untuk mencegah aksi yang
// akan mengunci sistem (menghapus/menonaktifkan/menurunkan superadmin aktif
// terakhir) — tanpa penjaga ini, satu klik bisa membuat tidak ada lagi akun
// yang berhak mengelola pengguna.
async function countActiveSuperAdmins(excludeId = null) {
  const filter = { role: 'superadmin', isActive: true };
  if (excludeId) filter._id = { $ne: excludeId };
  return User.countDocuments(filter);
}

router.get(
  '/users',
  protect,
  requireSuperAdmin,
  catchAsync(async (req, res) => {
    const users = await User.find().sort({ createdAt: 1 });
    res.json({ users: users.map(sanitizeUser) });
  })
);

router.post(
  '/users',
  protect,
  requireSuperAdmin,
  validate('createUser'),
  catchAsync(async (req, res) => {
    const existing = await User.findOne({ email: req.body.email });
    if (existing) throw new ApiError(409, 'Email sudah digunakan.');
    const user = await User.create(req.body);
    res.status(201).json({ user: sanitizeUser(user) });
  })
);

// PATCH /api/auth/users/:id — ubah nama, email, role, status, atau reset kata
// sandi. Semua field opsional (lihat schema updateUser).
router.patch(
  '/users/:id',
  protect,
  requireSuperAdmin,
  validateObjectIdParam(),
  validate('updateUser'),
  catchAsync(async (req, res) => {
    const user = await User.findById(req.params.id).select('+tokenVersion');
    if (!user) throw new ApiError(404, 'Pengguna tidak ditemukan.');

    const { name, email, password, role, isActive } = req.body;

    // Email baru harus unik — cek dulu agar pesannya jelas, bukan error
    // duplicate-key mentah dari Mongo.
    if (email && email !== user.email) {
      const clash = await User.findOne({ email, _id: { $ne: user._id } });
      if (clash) throw new ApiError(409, 'Email sudah digunakan.');
      user.email = email;
    }

    if (name !== undefined) user.name = name;

    // Menurunkan role atau menonaktifkan superadmin aktif terakhir akan
    // mengunci sistem — tolak dengan pesan yang menjelaskan alasannya.
    const losingSuperAdmin =
      user.role === 'superadmin' &&
      user.isActive === true &&
      ((role !== undefined && role !== 'superadmin') || isActive === false);
    if (losingSuperAdmin && (await countActiveSuperAdmins(user._id)) === 0) {
      throw new ApiError(400, 'Tidak dapat menurunkan atau menonaktifkan Super Admin aktif terakhir.');
    }

    if (role !== undefined) user.role = role;
    if (isActive !== undefined) user.isActive = isActive;

    // Reset kata sandi oleh superadmin: password di-hash ulang oleh pre-save
    // hook, dan tokenVersion dinaikkan agar sesi lama pengguna tersebut
    // langsung batal.
    if (password) {
      user.password = password;
      user.tokenVersion += 1;
    }

    // Menonaktifkan akun juga membatalkan seluruh sesinya seketika, bukan
    // menunggu access token 15 menit kedaluwarsa.
    if (isActive === false) {
      user.tokenVersion += 1;
    }

    await user.save();
    res.json({ user: sanitizeUser(user) });
  })
);

router.delete(
  '/users/:id',
  protect,
  requireSuperAdmin,
  validateObjectIdParam(),
  catchAsync(async (req, res) => {
    const target = await User.findById(req.params.id);
    if (!target) throw new ApiError(404, 'Pengguna tidak ditemukan.');

    // Tidak boleh menghapus akun sendiri — mencegah superadmin mengunci
    // dirinya keluar secara tidak sengaja.
    if (target._id.equals(req.user._id)) {
      throw new ApiError(400, 'Tidak dapat menghapus akun Anda sendiri.');
    }

    const total = await User.estimatedDocumentCount();
    if (total <= 1) throw new ApiError(400, 'Tidak dapat menghapus satu-satunya pengguna yang tersisa.');

    if (target.role === 'superadmin' && target.isActive && (await countActiveSuperAdmins(target._id)) === 0) {
      throw new ApiError(400, 'Tidak dapat menghapus Super Admin aktif terakhir.');
    }

    await User.findByIdAndDelete(req.params.id);
    res.status(204).end();
  })
);

module.exports = router;
