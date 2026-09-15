// Centralized environment configuration.
// All process.env access happens here so the rest of the app never touches
// process.env directly — makes it easy to audit what config the app depends on.
require('dotenv').config();

const required = ['MONGO_URI', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];

const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT, 10) || 5000,

  MONGO_URI: process.env.MONGO_URI,

  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
  JWT_ACCESS_EXPIRES_IN: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  JWT_REFRESH_EXPIRES_MS: 7 * 24 * 60 * 60 * 1000,

  CORS_ORIGIN: (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  COOKIE_SECURE: process.env.COOKIE_SECURE === 'true',
  COOKIE_SAMESITE: process.env.COOKIE_SAMESITE || 'lax',

  HEARTBEAT_RETENTION_DAYS: parseInt(process.env.HEARTBEAT_RETENTION_DAYS, 10) || 90,
  MIN_CHECK_INTERVAL_SECONDS: parseInt(process.env.MIN_CHECK_INTERVAL_SECONDS, 10) || 20,

  TRUST_PROXY: process.env.TRUST_PROXY === 'true',

  // --- Migrations & seeding ---
  // Migrations run automatically on boot by default: they're idempotent and
  // the app can misbehave against an un-migrated schema, so "on" is the safe
  // default. Set AUTO_MIGRATE=false to manage them manually via `npm run migrate`.
  AUTO_MIGRATE: process.env.AUTO_MIGRATE !== 'false',

  SEED_ADMIN_NAME: process.env.SEED_ADMIN_NAME || 'Administrator',
  SEED_ADMIN_EMAIL: process.env.SEED_ADMIN_EMAIL || '',
  SEED_ADMIN_PASSWORD: process.env.SEED_ADMIN_PASSWORD || '',
  // Seeding on boot is opt-in: it only happens when SEED_ADMIN_EMAIL is set,
  // so the default first-run experience stays the interactive /setup page.
  AUTO_SEED_ADMIN:
    process.env.AUTO_SEED_ADMIN === 'true' ||
    (process.env.AUTO_SEED_ADMIN !== 'false' && !!process.env.SEED_ADMIN_EMAIL),
};

function assertValidEnv() {
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    // Fail fast and loud — never boot with an incomplete/insecure config.
    // eslint-disable-next-line no-console
    console.error(`[FATAL] Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }

  const weakSecrets = ['changeme', 'secret', 'password', ''];
  if (
    weakSecrets.includes(env.JWT_ACCESS_SECRET) ||
    weakSecrets.includes(env.JWT_REFRESH_SECRET) ||
    env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET
  ) {
    console.error(
      '[FATAL] JWT_ACCESS_SECRET / JWT_REFRESH_SECRET are missing, weak, or identical. ' +
        'Generate strong unique values, e.g.: openssl rand -hex 64'
    );
    process.exit(1);
  }

  if (env.JWT_ACCESS_SECRET.length < 32 || env.JWT_REFRESH_SECRET.length < 32) {
    console.error('[FATAL] JWT secrets must be at least 32 characters long.');
    process.exit(1);
  }

  if (env.NODE_ENV === 'production' && !env.COOKIE_SECURE) {
    // Not fatal — some self-hosted setups run plain HTTP behind a trusted LAN —
    // but the operator should make an explicit, informed choice.
    console.warn(
      '[WARN] Running in production with COOKIE_SECURE=false. ' +
        'Set COOKIE_SECURE=true once the app is served over HTTPS.'
    );
  }

  // A seeded admin is a real, login-capable account on a dashboard that is
  // often internet-facing, so a guessable seed password is treated as a
  // hard failure rather than a warning.
  if (env.SEED_ADMIN_PASSWORD) {
    const commonPasswords = [
      'admin', 'admin123', 'password', 'password123', '12345678', '123456789',
      'qwerty123', 'changeme', 'letmein', 'adminadmin', 'root', 'secret',
    ];
    if (commonPasswords.includes(env.SEED_ADMIN_PASSWORD.toLowerCase())) {
      console.error(
        '[FATAL] SEED_ADMIN_PASSWORD adalah kata sandi yang umum/mudah ditebak. ' +
          'Gunakan kata sandi kuat, atau kosongkan agar dibuat otomatis secara acak.'
      );
      process.exit(1);
    }
    if (env.SEED_ADMIN_PASSWORD.length < 8) {
      console.error('[FATAL] SEED_ADMIN_PASSWORD minimal 8 karakter.');
      process.exit(1);
    }
  }
}

module.exports = { env, assertValidEnv };
