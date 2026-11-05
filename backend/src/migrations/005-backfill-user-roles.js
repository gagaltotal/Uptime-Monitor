const mongoose = require('mongoose');
const logger = require('../utils/logger');

exports.description = 'Mengisi role dan status akun pengguna yang belum memiliki nilai (role, isActive)';

// User schema sebelumnya hanya mengenal satu role ('admin') dan tidak punya
// field status sama sekali. Dokumen yang dibuat sebelum perubahan itu:
//   - tidak punya `role`      → tidak akan cocok dengan filter apa pun
//   - tidak punya `isActive`  → bisa jadi terbaca sebagai nonaktif
// Keduanya berbahaya: yang pertama membuat pengguna kehilangan hak akses,
// yang kedua bisa mengunci akun lama keluar dari dashboard.
//
// Backfill:
//   - `role` kosong      → 'superadmin' untuk akun paling awal (pemilik
//                          instance), 'admin' untuk sisanya.
//   - `isActive` kosong  → true, supaya akun lama tetap bisa login.
//
// Idempotent: hanya menyentuh dokumen yang field-nya benar-benar belum ada,
// jadi aman dijalankan ulang dan tidak menimpa perubahan yang sudah dilakukan
// operator lewat menu Pengguna.
exports.up = async () => {
  const users = mongoose.connection.collection('users');

  // Akun paling awal dianggap pemilik sistem. Kalau field role sudah ada
  // (mis. migrasi pernah dijalankan), tidak ada akun yang ditimpa.
  const oldest = await users.findOne(
    { role: { $exists: false } },
    { sort: { createdAt: 1, _id: 1 }, projection: { _id: 1 } }
  );

  if (oldest) {
    await users.updateOne({ _id: oldest._id }, { $set: { role: 'superadmin' } });
    logger.info('  Akun pengguna terlama dijadikan superadmin.');
  }

  const roles = await users.updateMany(
    { role: { $exists: false } },
    { $set: { role: 'admin' } }
  );

  const active = await users.updateMany(
    { isActive: { $exists: false } },
    { $set: { isActive: true } }
  );

  if (roles.modifiedCount > 0) logger.info(`  ${roles.modifiedCount} pengguna diberi role default 'admin'.`);
  if (active.modifiedCount > 0) logger.info(`  ${active.modifiedCount} pengguna ditandai aktif.`);
};

// Field ini adalah state keamanan, bukan data turunan; mengosongkannya lagi
// pada rollback justru akan mengunci pengguna keluar. Rollback sengaja no-op.
exports.down = async () => {};
