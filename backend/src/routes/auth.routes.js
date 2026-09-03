const express = require('express');
const User = require('../models/User');
const { protect, signAccessToken, signRefreshToken, verifyRefreshToken } = require('../middleware/auth');
const { validate } = require('../validators/index');
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
    const user = await User.create(req.body);
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

router.get(
  '/users',
  protect,
  catchAsync(async (req, res) => {
    const users = await User.find().sort({ createdAt: 1 });
    res.json({ users: users.map(sanitizeUser) });
  })
);

router.post(
  '/users',
  protect,
  validate('createUser'),
  catchAsync(async (req, res) => {
    const existing = await User.findOne({ email: req.body.email });
    if (existing) throw new ApiError(409, 'Email sudah digunakan.');
    const user = await User.create(req.body);
    res.status(201).json({ user: sanitizeUser(user) });
  })
);

router.delete(
  '/users/:id',
  protect,
  catchAsync(async (req, res) => {
    const total = await User.estimatedDocumentCount();
    if (total <= 1) throw new ApiError(400, 'Tidak dapat menghapus satu-satunya pengguna yang tersisa.');
    const deleted = await User.findByIdAndDelete(req.params.id);
    if (!deleted) throw new ApiError(404, 'Pengguna tidak ditemukan.');
    res.status(204).end();
  })
);

module.exports = router;
