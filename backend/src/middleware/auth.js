const jwt = require('jsonwebtoken');
const { env } = require('../config/env');
const { ApiError, catchAsync } = require('../utils/helpers');
const User = require('../models/User');

// Verifies the short-lived access token sent as "Authorization: Bearer <jwt>".
// We deliberately do NOT accept the token from a cookie or query string:
// - a Bearer header is never sent automatically by the browser cross-site,
//   which is what keeps normal API routes immune to CSRF (only the narrow
//   refresh endpoint relies on a cookie, see routes/auth.routes.js).
const protect = catchAsync(async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw new ApiError(401, 'Tidak terotentikasi. Silakan login kembali.');
  }
  const token = header.slice(7);

  let payload;
  try {
    payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
  } catch {
    throw new ApiError(401, 'Sesi tidak valid atau kedaluwarsa. Silakan login kembali.');
  }

  if (payload.type !== 'access') {
    throw new ApiError(401, 'Jenis token tidak valid.');
  }

  const user = await User.findById(payload.sub).select('+tokenVersion');
  if (!user) {
    throw new ApiError(401, 'Pengguna tidak ditemukan.');
  }

  // A password change or "logout everywhere" bumps tokenVersion, which
  // instantly invalidates every access/refresh token issued before that —
  // even ones that haven't technically expired yet.
  if (user.tokenVersion !== payload.tokenVersion) {
    throw new ApiError(401, 'Sesi sudah tidak berlaku. Silakan login kembali.');
  }

  req.user = user;
  next();
});

function signAccessToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), tokenVersion: user.tokenVersion, type: 'access' },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.JWT_ACCESS_EXPIRES_IN, algorithm: 'HS256' }
  );
}

function signRefreshToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), tokenVersion: user.tokenVersion, type: 'refresh' },
    env.JWT_REFRESH_SECRET,
    { expiresIn: env.JWT_REFRESH_EXPIRES_IN, algorithm: 'HS256' }
  );
}

function verifyRefreshToken(token) {
  const payload = jwt.verify(token, env.JWT_REFRESH_SECRET, { algorithms: ['HS256'] });
  if (payload.type !== 'refresh') throw new Error('Bukan refresh token');
  return payload;
}

module.exports = { protect, signAccessToken, signRefreshToken, verifyRefreshToken };
