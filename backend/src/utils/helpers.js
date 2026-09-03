// Custom error type carrying an HTTP status code. Thrown/passed to next()
// anywhere in the app and handled centrally by middleware/errorHandler.js.
class ApiError extends Error {
  constructor(statusCode, message, details = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true; // expected error (bad input, auth, etc.) vs a bug
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

// Wraps an async Express handler so any rejected promise is forwarded to
// next(err) automatically, instead of every route needing its own try/catch
// (a missed try/catch is a common source of unhandled-rejection crashes).
function catchAsync(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Builds a URL-safe slug from a title, used for public status pages.
function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

// Strips fields that must never be sent to a client, regardless of which
// Mongoose `.select()` was used upstream (defense in depth).
function sanitizeUser(userDoc) {
  if (!userDoc) return null;
  const obj = userDoc.toObject ? userDoc.toObject() : { ...userDoc };
  delete obj.password;
  delete obj.tokenVersion;
  delete obj.failedLoginAttempts;
  delete obj.lockUntil;
  delete obj.__v;
  return obj;
}

function msToDuration(ms) {
  if (ms == null || Number.isNaN(ms)) return null;
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (days > 0) return `${days}h ${hours}j ${minutes}m`;
  if (hours > 0) return `${hours}j ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}d`;
  return `${secs}d`;
}

module.exports = { ApiError, catchAsync, slugify, sanitizeUser, msToDuration };
