// Small dependency-free logger. Keeps log lines structured and consistent
// without pulling in a heavy logging framework for a self-hosted app.
const { env } = require('../config/env');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLevel = LEVELS[env.NODE_ENV === 'production' ? 'info' : 'debug'];

function timestamp() {
  return new Date().toISOString();
}

function format(level, message, meta) {
  const base = `[${timestamp()}] [${level.toUpperCase()}] ${message}`;
  if (meta === undefined) return base;
  if (meta instanceof Error) {
    // Never leak stack traces to clients (see middleware/errorHandler.js);
    // they are fine in server-side logs, which the operator controls.
    return `${base} :: ${meta.message}${env.NODE_ENV !== 'production' ? `\n${meta.stack}` : ''}`;
  }
  try {
    return `${base} :: ${JSON.stringify(meta)}`;
  } catch {
    return base;
  }
}

function log(level, message, meta) {
  if (LEVELS[level] > currentLevel) return;
  const line = format(level, message, meta);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

module.exports = {
  error: (msg, meta) => log('error', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  info: (msg, meta) => log('info', msg, meta),
  debug: (msg, meta) => log('debug', msg, meta),
};
