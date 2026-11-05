const express = require('express');
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
