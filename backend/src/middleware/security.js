const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const hpp = require('hpp');
const { env } = require('../config/env');
const { ApiError } = require('../utils/helpers');

// --- Helmet: secure HTTP headers (CSP, HSTS, no-sniff, frameguard, etc.) ---
// The API only ever returns JSON, so we lock the default-src down hard;
// this is a defense-in-depth header, real HTML/JS is served by the
// separate frontend container.
const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginResourcePolicy: { policy: 'same-site' },
});

// --- CORS: explicit allow-list only, no wildcard, credentials enabled so the
// httpOnly refresh cookie can be sent by the configured frontend origin(s). ---
const corsMiddleware = cors({
  origin(origin, callback) {
    // Allow same-origin/non-browser requests (no Origin header) and anything
    // in the configured allow-list; reject everything else outright.
    if (!origin || env.CORS_ORIGIN.includes(origin)) {
      callback(null, true);
    } else {
      callback(new ApiError(403, 'Origin tidak diizinkan oleh kebijakan CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});

// --- Rate limiting ---
// General API limiter: generous, mostly there to blunt scraping/DoS.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 400,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Terlalu banyak permintaan, coba lagi nanti.' },
});

// Strict limiter for authentication endpoints — the main defense against
// credential-stuffing / brute-force login attempts, independent of the
// per-account lockout implemented in the User model.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { message: 'Terlalu banyak percobaan otentikasi, coba lagi nanti.' },
});

// Even stricter limiter for the one-time first-admin setup endpoint.
const setupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

// --- NoSQL injection hardening ---
// Strips any request key starting with "$" or containing "." from
// body/params/query (e.g. blocks {"email": {"$gt": ""}} style operator
// injection on login). Combined with Joi type-checking in validators/index.js,
// which independently rejects non-string payloads on fields like email/password.
const mongoSanitizeMiddleware = mongoSanitize({
  replaceWith: '_',
  onSanitize: ({ key }) => {
    // eslint-disable-next-line global-require
    require('../utils/logger').warn(`Sanitized a potentially malicious key: ${key}`);
  },
});

// --- HTTP Parameter Pollution guard (duplicate query keys) ---
const hppMiddleware = hpp();

module.exports = {
  helmetMiddleware,
  corsMiddleware,
  apiLimiter,
  authLimiter,
  setupLimiter,
  mongoSanitizeMiddleware,
  hppMiddleware,
};
