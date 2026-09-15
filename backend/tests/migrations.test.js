/* Test harness for the migration runner.
 *
 * MongoDB binaries can't be downloaded in this sandbox, so the Migration /
 * MigrationLock models and the migration files themselves are replaced with
 * in-memory fakes via require.cache injection. That still exercises the real
 * runner code path: discovery, ordering, lock acquisition, idempotency,
 * failure handling and rollback.
 */
const path = require('path');

const BACKEND = path.resolve(__dirname, '..');
const SRC = path.join(BACKEND, 'src');

process.env.MONGO_URI = 'mongodb://localhost:27017/test';
process.env.JWT_ACCESS_SECRET = 'a'.repeat(64);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(64);
process.env.NODE_ENV = 'test';

const results = [];
function check(name, condition) {
  results.push([name, !!condition]);
}

function inject(modulePath, exportsObj) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: exportsObj,
    children: [],
    paths: [],
  };
}

// --- Fake Migration model -------------------------------------------------
let migrationDocs = [];
let nextId = 1;
const FakeMigration = {
  find() {
    let docs = [...migrationDocs];
    const chain = {
      sort(spec) {
        const key = Object.keys(spec)[0];
        const dir = spec[key];
        docs.sort((a, b) => (a[key] > b[key] ? dir : a[key] < b[key] ? -dir : 0));
        return chain;
      },
      limit(n) {
        docs = docs.slice(0, n);
        return chain;
      },
      lean: async () => docs,
      then: (resolve, reject) => Promise.resolve(docs).then(resolve, reject),
    };
    return chain;
  },
  async create(doc) {
    const created = { _id: `m${nextId++}`, appliedAt: new Date(Date.now() + nextId), ...doc };
    migrationDocs.push(created);
    return created;
  },
  async deleteOne(filter) {
    const before = migrationDocs.length;
    migrationDocs = migrationDocs.filter((d) => d._id !== filter._id);
    return { deletedCount: before - migrationDocs.length };
  },
};

// --- Fake MigrationLock model ---------------------------------------------
let lockDoc = null;
const FakeLock = {
  async create(doc) {
    if (lockDoc) {
      const err = new Error('duplicate key');
      err.code = 11000;
      throw err;
    }
    lockDoc = { _id: doc._id || 'migrations', owner: doc.owner, acquiredAt: new Date() };
    return lockDoc;
  },
  async findById() {
    return lockDoc;
  },
  async deleteOne(filter) {
    if (lockDoc && (!filter.owner || lockDoc.owner === filter.owner)) {
      lockDoc = null;
      return { deletedCount: 1 };
    }
    return { deletedCount: 0 };
  },
};

inject(path.join(SRC, 'models/Migration.js'), FakeMigration);
inject(path.join(SRC, 'models/MigrationLock.js'), FakeLock);

// --- Fake migration files (replace the real ones the runner would load) ----
const calls = [];
function fakeMigration(label, { failOnUp = false } = {}) {
  return {
    description: `fake ${label}`,
    up: async () => {
      if (failOnUp) throw new Error(`boom in ${label}`);
      calls.push(`up:${label}`);
    },
    down: async () => {
      calls.push(`down:${label}`);
    },
  };
}

inject(path.join(SRC, 'migrations/001-create-core-indexes.js'), fakeMigration('001'));
inject(path.join(SRC, 'migrations/002-normalize-user-emails.js'), fakeMigration('002'));
inject(path.join(SRC, 'migrations/003-backfill-monitor-scheduling.js'), fakeMigration('003'));

const runner = require(path.join(SRC, 'migrations/runner.js'));

(async () => {
  // 1. Discovery finds all three real files and sorts them by numeric prefix.
  const files = runner.loadMigrationFiles();
  check('discovery menemukan 3 file migrasi', files.length === 3);
  check(
    'urutan migrasi sesuai prefix numerik',
    files[0].name.startsWith('001') && files[1].name.startsWith('002') && files[2].name.startsWith('003')
  );
  check('setiap migrasi punya fungsi up()', files.every((f) => typeof f.up === 'function'));

  // 2. First run applies everything, in order.
  const first = await runner.up();
  check('run pertama menerapkan 3 migrasi', first.applied.length === 3);
  check('dijalankan berurutan 001→002→003', calls.join(',') === 'up:001,up:002,up:003');
  check('lock dilepas setelah selesai', lockDoc === null);

  // 3. Second run is a no-op — this is what makes AUTO_MIGRATE on every boot safe.
  calls.length = 0;
  const second = await runner.up();
  check('run kedua idempoten (0 diterapkan)', second.applied.length === 0);
  check('tidak ada up() yang dipanggil ulang', calls.length === 0);

  // 4. status() reports all three as applied.
  const statusRows = await runner.status();
  check('status melaporkan 3 migrasi', statusRows.length === 3);
  check('semua tercatat applied', statusRows.every((r) => r.applied === true));
  check('status menyertakan appliedAt', statusRows.every((r) => r.appliedAt instanceof Date));

  // 5. Rollback reverts only the most recent one.
  calls.length = 0;
  const rolledBack = await runner.down(1);
  check('down(1) me-rollback tepat 1 migrasi', rolledBack.reverted.length === 1);
  check('yang di-rollback adalah yang terakhir (003)', rolledBack.reverted[0].startsWith('003'));
  check('fungsi down() dipanggil', calls.join(',') === 'down:003');

  const afterRollback = await runner.status();
  check('setelah rollback, 003 jadi pending', afterRollback.find((r) => r.name.startsWith('003')).applied === false);
  check('001 & 002 tetap applied', afterRollback.filter((r) => r.applied).length === 2);

  // 6. Re-running up() re-applies just the rolled-back migration.
  calls.length = 0;
  const reapply = await runner.up();
  check('up() setelah rollback menerapkan ulang 1 migrasi', reapply.applied.length === 1);
  check('hanya 003 yang dijalankan ulang', calls.join(',') === 'up:003');

  // 7. A held lock makes up() back off instead of running concurrently.
  lockDoc = { _id: 'migrations', owner: 'proses-lain:999', acquiredAt: new Date() };
  const contended = await runner.up();
  check('lock aktif → up() dilewati (tidak jalan paralel)', contended.skipped === true);
  check('tidak ada migrasi diterapkan saat lock dipegang', contended.applied.length === 0);

  // 8. A stale lock is reclaimed rather than deadlocking future boots.
  lockDoc = { _id: 'migrations', owner: 'proses-mati:1', acquiredAt: new Date(Date.now() - 10 * 60 * 1000) };
  const afterStale = await runner.up();
  check('lock basi diambil alih (tidak deadlock)', afterStale.skipped !== true);

  // 9. A failing migration aborts the run and is NOT recorded as applied.
  migrationDocs = [];
  lockDoc = null;
  calls.length = 0;
  inject(path.join(SRC, 'migrations/002-normalize-user-emails.js'), fakeMigration('002', { failOnUp: true }));
  delete require.cache[require.resolve(path.join(SRC, 'migrations/runner.js'))];
  const runner2 = require(path.join(SRC, 'migrations/runner.js'));

  let threw = false;
  try {
    await runner2.up();
  } catch {
    threw = true;
  }
  check('migrasi gagal → error dilempar', threw);
  check('hanya 001 tercatat, 002 & 003 tidak', migrationDocs.length === 1 && migrationDocs[0].name.startsWith('001'));
  check('003 tidak ikut dijalankan setelah 002 gagal', !calls.includes('up:003'));
  check('lock tetap dilepas meski gagal (tidak bocor)', lockDoc === null);

  // --- report ---
  console.log('');
  let pass = 0;
  for (const [name, ok] of results) {
    console.log(`${ok ? '✅' : '❌'} ${name}`);
    if (ok) pass += 1;
  }
  console.log(`\n${pass}/${results.length} lolos`);
  process.exit(pass === results.length ? 0 : 1);
})();
