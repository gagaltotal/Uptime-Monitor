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

// Normalizes user-entered SSL targets into a bare hostname. Accepts a full
// URL (https://example.com/path), a host:port pair, or a plain hostname and
// always returns { host, port } with the host lowercased and stripped of any
// scheme, path, query, trailing dot, or IPv6 brackets. Returns null when the
// input can't be turned into a plausible hostname, so validation can reject
// it rather than persisting garbage that will never resolve.
function normalizeDomain(input, fallbackPort = 443) {
  if (typeof input !== 'string') return null;
  let raw = input.trim();
  if (!raw) return null;

  let explicitPort = null;
  let host = raw;

  // If a scheme is present, let the URL parser do the heavy lifting.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      host = url.hostname;
      if (url.port) explicitPort = parseInt(url.port, 10);
      return finalizeDomain(host, explicitPort, fallbackPort);
    } catch {
      return null;
    }
  }

  // Strip a path/query/fragment if the user pasted a URL without a scheme.
  host = host.split(/[/?#]/)[0];

  // Bracketed IPv6, e.g. [2001:db8::1]:443
  const v6 = host.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (v6) {
    host = v6[1];
    if (v6[2]) explicitPort = parseInt(v6[2], 10);
    return finalizeDomain(host, explicitPort, fallbackPort);
  }

  // host:port — only treat the trailing segment as a port when it is
  // numeric, so a bare IPv6 address without brackets isn't mangled.
  const hostPort = host.match(/^(.+):(\d+)$/);
  if (hostPort && !host.includes('::')) {
    host = hostPort[1];
    explicitPort = parseInt(hostPort[2], 10);
  }

  return finalizeDomain(host, explicitPort, fallbackPort);
}

function finalizeDomain(host, explicitPort, fallbackPort) {
  let value = String(host || '').trim().toLowerCase();
  // Remove a single trailing dot (FQDN form) which is valid DNS but would
  // pollute the stored value and SNI servername.
  value = value.replace(/\.$/, '');
  if (!value) return null;

  let port = explicitPort;
  if (port != null && (Number.isNaN(port) || port < 1 || port > 65535)) {
    port = null;
  }

  return { host: value, port: port ?? fallbackPort, hasExplicitPort: explicitPort != null };
}

// Derives the display status of a certificate from its expiry date and the
// configured warning threshold. Single source of truth shared by the engine,
// the routes and the migration so a "days left" number always maps to the
// same status label.
function computeSslStatus({ daysRemaining, thresholdDays = 14, validFrom, now = Date.now() }) {
  if (daysRemaining == null) return 'pending';
  if (daysRemaining < 0) return 'expired';
  if (validFrom && new Date(validFrom).getTime() > now) return 'pending';
  if (daysRemaining <= thresholdDays) return 'expiring';
  return 'valid';
}

module.exports = {
  ApiError,
  catchAsync,
  slugify,
  sanitizeUser,
  msToDuration,
  normalizeDomain,
  computeSslStatus,
};
