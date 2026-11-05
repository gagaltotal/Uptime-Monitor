const crypto = require('crypto');
const User = require('../models/User');
const { env } = require('../config/env');
const logger = require('../utils/logger');

const MIN_PASSWORD_LENGTH = 8;

// Role yang dikenali User model. Divalidasi di sini juga agar salah tulis di
// .env muncul sebagai error yang jelas saat startup, bukan role yang diam-diam
// diabaikan oleh enum Mongoose.
const VALID_ROLES = ['superadmin', 'admin'];

// Akun yang dibuat dari environment adalah pemilik instance → superadmin.
const DEFAULT_SEED_ROLE = 'superadmin';

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
 * Role resolution order:
 *   1. explicit `role` argument
 *   2. SEED_ADMIN_ROLE from the environment
 *   3. 'superadmin' — the account seeded from the environment is by definition
 *      the owner of the instance, so it must be able to manage other users.
 *
 * The generated-password path exists so that there is no hardcoded default
 * credential anywhere in this project — a seeded "admin/admin123" on an
 * internet-facing monitoring dashboard would be an open door.
 *
 * Role on an EXISTING account: only touched when SEED_ADMIN_ROLE (or the
 * `--role` flag) is explicitly set. This is the escape hatch for instances
 * that were created before roles existed — those accounts were stored as
 * `role: 'admin'` and migration 005 deliberately leaves an existing value
 * alone, so without this the instance would have no superadmin at all and
 * nobody could open the "Pengguna" menu.
 */
async function seedAdmin({ force = false, name, email, password, role } = {}) {
  const finalName = (name || env.SEED_ADMIN_NAME || 'Administrator').trim();
  const finalEmail = (email || env.SEED_ADMIN_EMAIL || '').trim().toLowerCase();
  const roleOverride = (role || env.SEED_ADMIN_ROLE || '').trim().toLowerCase();

  if (roleOverride && !VALID_ROLES.includes(roleOverride)) {
    throw new Error(
      `Role tidak dikenal: "${roleOverride}". Gunakan salah satu dari: ${VALID_ROLES.join(', ')}.`
    );
  }
  // Tanpa override, akun yang di-seed adalah pemilik instance → superadmin.
  const finalRole = roleOverride || DEFAULT_SEED_ROLE;

  if (!finalEmail) {
    return { status: 'skipped', reason: 'SEED_ADMIN_EMAIL tidak diatur — seeder dilewati.' };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(finalEmail)) {
    throw new Error(`SEED_ADMIN_EMAIL tidak valid: "${finalEmail}"`);
  }

  const existing = await User.findOne({ email: finalEmail });

  // Sinkronisasi role untuk akun yang SUDAH ADA — tanpa menyentuh kata sandi,
  // sehingga operator yang terkunci tidak kehilangan kredensialnya. Hanya
  // dijalankan bila role diminta secara eksplisit, agar restart biasa tidak
  // pernah menulis ulang role (mis. menaikkan kembali admin yang sengaja
  // diturunkan lewat menu Pengguna).
  if (existing && !force && roleOverride && existing.role !== finalRole) {
    const previousRole = existing.role || '(kosong)';
    existing.role = finalRole;
    // Aman: akun yang belum punya isActive terbaca bukan-nonaktif, jadi tanpa
    // ini seeder bisa "berhasil" tetapi akunnya tetap tidak bisa login.
    if (existing.isActive === undefined) existing.isActive = true;
    await existing.save();

    logger.info(
      `Seeder: role akun "${finalEmail}" diubah dari "${previousRole}" menjadi "${finalRole}" ` +
        '(kata sandi tidak diubah).'
    );
    return { status: 'role-updated', email: finalEmail, role: finalRole, previousRole };
  }

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
    // Akun yang di-seed lewat environment adalah akun pemilik instance, jadi
    // selalu dijadikan aktif. Tanpa ini, instance yang di-seed otomatis tidak
    // akan punya siapa pun yang boleh mengelola pengguna.
    existing.role = finalRole;
    existing.isActive = true;
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

  const user = await User.create({
    name: finalName,
    email: finalEmail,
    password: finalPassword,
    role: finalRole,
    isActive: true,
  });

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
    role: finalRole,
    generatedPassword: wasGenerated ? finalPassword : null,
  };
}

module.exports = { seedAdmin, generatePassword };
