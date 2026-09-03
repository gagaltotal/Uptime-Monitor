const { env } = require('../config/env');
const logger = require('../utils/logger');

function notFoundHandler(req, res) {
  res.status(404).json({ message: 'Rute tidak ditemukan.' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
  const isOperational = err.isOperational === true;

  if (statusCode >= 500) {
    logger.error(`${req.method} ${req.originalUrl} -> ${statusCode}`, err);
  } else {
    logger.warn(`${req.method} ${req.originalUrl} -> ${statusCode}: ${err.message}`);
  }

  // Never leak internals (stack traces, DB error text, file paths) to the
  // client for unexpected (non-operational) errors — only our own
  // deliberately-thrown ApiErrors get their message forwarded verbatim.
  const message = isOperational || statusCode < 500 ? err.message : 'Terjadi kesalahan pada server.';

  const body = { message };
  if (err.details) body.details = err.details;
  if (env.NODE_ENV !== 'production' && statusCode >= 500) body.stack = err.stack;

  res.status(statusCode).json(body);
}

module.exports = { notFoundHandler, errorHandler };
