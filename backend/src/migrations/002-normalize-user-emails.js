const mongoose = require('mongoose');
const logger = require('../utils/logger');

exports.description = 'Normalisasi email pengguna ke huruf kecil dan tanpa spasi';

// The User schema declares lowercase+trim, but that only applies to documents
// written through Mongoose after the schema was defined. Any account created
// before that (or via a direct mongosh insert) could hold "Admin@Example.com"
// and silently fail to match a login attempt for "admin@example.com", since
// the login query lowercases its input. This normalizes the existing data.
exports.up = async () => {
  const users = mongoose.connection.collection('users');
  const cursor = users.find({}, { projection: { email: 1 } });
  let fixed = 0;
  let conflicts = 0;

  for await (const doc of cursor) {
    if (typeof doc.email !== 'string') continue;
    const normalized = doc.email.trim().toLowerCase();
    if (normalized === doc.email) continue;

    // Two accounts could normalize to the same address; the unique index
    // would reject the second. Report it rather than crashing the migration.
    const clash = await users.findOne({ email: normalized, _id: { $ne: doc._id } });
    if (clash) {
      conflicts += 1;
      logger.warn(`  ⚠ Email "${doc.email}" bentrok dengan "${normalized}" yang sudah ada — dilewati.`);
      continue;
    }

    await users.updateOne({ _id: doc._id }, { $set: { email: normalized } });
    fixed += 1;
  }

  if (fixed > 0) logger.info(`  ${fixed} email pengguna dinormalisasi.`);
  if (conflicts > 0) {
    logger.warn(`  ${conflicts} email tidak bisa dinormalisasi karena bentrok — perlu diperbaiki manual.`);
  }
};

// Lowercasing is lossy — the original casing isn't stored anywhere, so there
// is nothing to restore. Rolling this back is a no-op by nature.
exports.down = async () => {};
