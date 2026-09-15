const crypto = require('crypto');
const User = require('../models/User');
const { env } = require('../config/env');
const logger = require('../utils/logger');

const MIN_PASSWORD_LENGTH = 8;

// Crypto-strong, URL-safe, and long enough that it's fine even if it ends up
// pasted into a password manager and never changed. base64url avoids the
// characters that get mangled when copied out of a terminal or YAML file.
function generatePassword(length = 24) {
  return crypto.randomBytes(48).toString('base64url').slice(0, length);
}

function banner(lines) {
  const width = Math.max(...lines.map((l) => l.length)) + 4;
  const edge = '='.repeat(width);
  // Deliberately written straight to stdout rather than through the logger:
  // this must be visible even when LOG level filtering is on, and it should
  // stand out in `docker compose logs`.
  console.log(`\n${edge}`);
  lines.forEach((l) => console.log(`  ${l}`));
  console.log(`${edge}\n`);
}

/**
 * Creates the initial admin account.
 *
 * Idempotent by design: if the target account already exists it is left alone
 * unless `force` is set, so this is safe to run on every container boot.
 *
 * Password resolution order:
 *   1. explicit `password` argument
 *   2. SEED_ADMIN_PASSWORD from the environment
 *   3. a randomly generated one, printed once to the logs
 *
 * The generated-password path exists so that there is no hardcoded default
 * credential anywhere in this project — a seeded "admin/admin123" on an
 * internet-facing monitoring dashboard would be an open door.
 */
async function seedAdmin({ force = false, name, email, password } = {}) {
  const finalName = (name || env.SEED_ADMIN_NAME || 'Administrator').trim();
  const finalEmail = (email || env.SEED_ADMIN_EMAIL || '').trim().toLowerCase();

  if (!finalEmail) {
    return { status: 'skipped', reason: 'SEED_ADMIN_EMAIL tidak diatur — seeder dilewati.' };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(finalEmail)) {
    throw new Error(`SEED_ADMIN_EMAIL tidak valid: "${finalEmail}"`);
  }

  const existing = await User.findOne({ email: finalEmail });

  if (existing && !force) {
    return {
      status: 'skipped',
      email: finalEmail,
      reason: `Pengguna "${finalEmail}" sudah ada. Gunakan --force untuk mereset kata sandinya.`,
    };
  }

  let finalPassword = password || env.SEED_ADMIN_PASSWORD || '';
  let wasGenerated = false;
  if (!finalPassword) {
    finalPassword = generatePassword();
    wasGenerated = true;
  }

  if (finalPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`SEED_ADMIN_PASSWORD terlalu pendek (minimal ${MIN_PASSWORD_LENGTH} karakter).`);
  }

  if (existing && force) {
    existing.name = finalName;
    existing.password = finalPassword; // re-hashed by the pre-save hook
    // Invalidate every outstanding session for this account — a password
    // reset that leaves old JWTs working isn't really a reset.
    existing.tokenVersion += 1;
    existing.failedLoginAttempts = 0;
    existing.lockUntil = undefined;
    await existing.save();

    if (wasGenerated) {
      banner([
        'KATA SANDI ADMIN DI-RESET (dibuat acak)',
        `Email    : ${finalEmail}`,
        `Password : ${finalPassword}`,
        'Simpan sekarang — tidak akan ditampilkan lagi.',
      ]);
    }
    return { status: 'updated', email: finalEmail, generatedPassword: wasGenerated ? finalPassword : null };
  }

  const user = await User.create({ name: finalName, email: finalEmail, password: finalPassword });

  if (wasGenerated) {
    banner([
      'AKUN ADMIN DIBUAT (kata sandi dibuat acak)',
      `Email    : ${finalEmail}`,
      `Password : ${finalPassword}`,
      'Simpan sekarang — tidak akan ditampilkan lagi.',
    ]);
  } else {
    logger.info(`Seeder: akun admin "${finalEmail}" dibuat dengan kata sandi dari environment.`);
  }

  return {
    status: 'created',
    id: user._id.toString(),
    email: finalEmail,
    generatedPassword: wasGenerated ? finalPassword : null,
  };
}

module.exports = { seedAdmin, generatePassword };
