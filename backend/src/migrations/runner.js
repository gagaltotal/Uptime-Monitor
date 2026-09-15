const fs = require('fs');
const path = require('path');
const os = require('os');
const Migration = require('../models/Migration');
const MigrationLock = require('../models/MigrationLock');
const logger = require('../utils/logger');

const MIGRATIONS_DIR = __dirname;
// Files must be named like "001-do-something.js" — the numeric prefix is what
// defines execution order, so ordering is explicit in the filename rather than
// dependent on filesystem listing order.
const FILE_PATTERN = /^\d{3,}-[a-z0-9-]+\.js$/;
const LOCK_ID = 'migrations';
const LOCK_STALE_MS = 5 * 60 * 1000;

function loadMigrationFiles() {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => FILE_PATTERN.test(file))
    .sort();

  return files.map((file) => {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const mod = require(path.join(MIGRATIONS_DIR, file));
    const name = file.replace(/\.js$/, '');
    if (typeof mod.up !== 'function') {
      throw new Error(`Migrasi "${file}" tidak mengekspor fungsi up().`);
    }
    return { name, up: mod.up, down: mod.down, description: mod.description || '' };
  });
}

async function acquireLock() {
  const owner = `${os.hostname()}:${process.pid}`;
  try {
    await MigrationLock.create({ _id: LOCK_ID, owner });
    return owner;
  } catch (err) {
    if (err.code !== 11000) throw err;

    // Someone holds it. If the holder died mid-run the lock would block every
    // future boot, so a sufficiently old lock is treated as abandoned.
    const existing = await MigrationLock.findById(LOCK_ID);
    if (existing && Date.now() - existing.acquiredAt.getTime() > LOCK_STALE_MS) {
      logger.warn(`Lock migrasi basi dari "${existing.owner}" dibersihkan.`);
      await MigrationLock.deleteOne({ _id: LOCK_ID, acquiredAt: existing.acquiredAt });
      await MigrationLock.create({ _id: LOCK_ID, owner });
      return owner;
    }
    return null;
  }
}

async function releaseLock(owner) {
  if (!owner) return;
  await MigrationLock.deleteOne({ _id: LOCK_ID, owner });
}

async function getApplied() {
  const docs = await Migration.find().sort({ name: 1 }).lean();
  return docs;
}

/**
 * Applies every migration file that isn't recorded in the migrations
 * collection yet, in filename order.
 *
 * Note: no MongoDB transaction is used here on purpose. Transactions require a
 * replica set, and the bundled docker-compose runs a standalone mongod. Each
 * migration is therefore written to be individually idempotent instead, so a
 * partially-applied migration can simply be re-run.
 */
async function up({ silent = false } = {}) {
  const owner = await acquireLock();
  if (!owner) {
    logger.warn('Migrasi sedang dijalankan oleh proses lain — dilewati.');
    return { applied: [], skipped: true };
  }

  const applied = [];
  try {
    const files = loadMigrationFiles();
    const done = new Set((await getApplied()).map((m) => m.name));
    const pending = files.filter((m) => !done.has(m.name));

    if (pending.length === 0) {
      if (!silent) logger.info('Migrasi: tidak ada yang tertunda, database sudah mutakhir.');
      return { applied: [], skipped: false };
    }

    logger.info(`Migrasi: menjalankan ${pending.length} migrasi tertunda…`);
    for (const migration of pending) {
      const startedAt = Date.now();
      try {
        await migration.up();
      } catch (err) {
        logger.error(`Migrasi GAGAL pada "${migration.name}" — dibatalkan.`, err);
        throw err;
      }
      const durationMs = Date.now() - startedAt;
      await Migration.create({ name: migration.name, durationMs });
      applied.push(migration.name);
      logger.info(`  ✔ ${migration.name} (${durationMs}ms)`);
    }
    return { applied, skipped: false };
  } finally {
    await releaseLock(owner);
  }
}

/** Rolls back the most recently applied migrations (default: just the last one). */
async function down(steps = 1) {
  const owner = await acquireLock();
  if (!owner) {
    throw new Error('Tidak bisa rollback: proses lain sedang memegang lock migrasi.');
  }

  const reverted = [];
  try {
    const files = loadMigrationFiles();
    const byName = new Map(files.map((m) => [m.name, m]));
    const appliedDocs = await Migration.find().sort({ appliedAt: -1, name: -1 }).limit(steps);

    if (appliedDocs.length === 0) {
      logger.info('Tidak ada migrasi yang bisa di-rollback.');
      return { reverted: [] };
    }

    for (const doc of appliedDocs) {
      const migration = byName.get(doc.name);
      if (!migration) {
        logger.warn(`  ⚠ File untuk "${doc.name}" tidak ditemukan — catatan dihapus saja.`);
      } else if (typeof migration.down !== 'function') {
        logger.warn(`  ⚠ "${doc.name}" tidak punya down() — dilewati, catatan dipertahankan.`);
        continue;
      } else {
        await migration.down();
      }
      await Migration.deleteOne({ _id: doc._id });
      reverted.push(doc.name);
      logger.info(`  ↩ ${doc.name} di-rollback`);
    }
    return { reverted };
  } finally {
    await releaseLock(owner);
  }
}

async function status() {
  const files = loadMigrationFiles();
  const appliedDocs = await getApplied();
  const appliedByName = new Map(appliedDocs.map((d) => [d.name, d]));

  return files.map((m) => {
    const record = appliedByName.get(m.name);
    return {
      name: m.name,
      description: m.description,
      applied: !!record,
      appliedAt: record?.appliedAt || null,
      durationMs: record?.durationMs ?? null,
    };
  });
}

module.exports = { up, down, status, loadMigrationFiles };
