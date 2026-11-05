/* Test harness for the admin seeder, with the User model faked in memory.
 * Exercises the real seedAdmin() control flow: idempotency, password
 * generation, --force reset, and input validation.
 */
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'src');

process.env.MONGO_URI = 'mongodb://localhost:27017/test';
process.env.JWT_ACCESS_SECRET = 'a'.repeat(64);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(64);
process.env.NODE_ENV = 'test';

const results = [];
const check = (name, cond) => results.push([name, !!cond]);

function inject(modulePath, exportsObj) {
  const resolved = require.resolve(modulePath);
  require.cache[resolved] = {
    id: resolved, filename: resolved, loaded: true, exports: exportsObj, children: [], paths: [],
  };
}

// --- Fake User model ------------------------------------------------------
let users = [];
let idCounter = 1;

function makeDoc(data) {
  const doc = {
    _id: { toString: () => `u${idCounter++}` },
    tokenVersion: 0,
    failedLoginAttempts: 0,
    lockUntil: undefined,
    ...data,
    async save() {
      // Mimic the pre-save hash hook well enough to prove the raw password
      // isn't what ends up persisted.
      if (!String(this.password).startsWith('hashed:')) this.password = `hashed:${this.password}`;
      return this;
    },
  };
  return doc;
}

const FakeUser = {
  async findOne(filter) {
    return users.find((u) => u.email === filter.email) || null;
  },
  async create(data) {
    const doc = makeDoc(data);
    await doc.save();
    users.push(doc);
    return doc;
  },
};

inject(path.join(SRC, 'models/User.js'), FakeUser);

const { seedAdmin, generatePassword } = require(path.join(SRC, 'seeders/adminSeeder.js'));

(async () => {
  // 1. No email configured → skipped, nothing created.
  let res = await seedAdmin({});
  check('tanpa email → dilewati', res.status === 'skipped');
  check('tanpa email → tidak ada user dibuat', users.length === 0);

  // 2. Invalid email is rejected.
  let threw = false;
  try {
    await seedAdmin({ email: 'bukan-email' });
  } catch {
    threw = true;
  }
  check('email tidak valid → error', threw);

  // 3. Create with an explicit password.
  res = await seedAdmin({ email: 'Admin@Contoh.COM', password: 'KataSandiKuat123', name: 'Admin Utama' });
  check('user dibuat', res.status === 'created');
  check('email dinormalisasi ke lowercase', res.email === 'admin@contoh.com');
  check('password tidak disimpan plaintext', users[0].password === 'hashed:KataSandiKuat123');
  check('password eksplisit tidak dilaporkan sebagai generated', res.generatedPassword === null);
  check('nama tersimpan', users[0].name === 'Admin Utama');
  check('akun hasil seed berrole superadmin', users[0].role === 'superadmin');
  check('akun hasil seed aktif', users[0].isActive === true);

  // 4. Re-running is a no-op — this is what makes boot-time seeding safe.
  const passwordBefore = users[0].password;
  res = await seedAdmin({ email: 'admin@contoh.com', password: 'PasswordBerbeda999' });
  check('user sudah ada → dilewati', res.status === 'skipped');
  check('idempoten: hanya 1 user', users.length === 1);
  check('password lama TIDAK tertimpa tanpa --force', users[0].password === passwordBefore);

  // 5. --force resets the password and invalidates existing sessions.
  const versionBefore = users[0].tokenVersion;
  users[0].failedLoginAttempts = 3;
  users[0].lockUntil = new Date();
  res = await seedAdmin({ email: 'admin@contoh.com', password: 'PasswordBaru456', force: true });
  check('--force → status updated', res.status === 'updated');
  check('--force mengganti password', users[0].password === 'hashed:PasswordBaru456');
  check('--force menaikkan tokenVersion (sesi lama batal)', users[0].tokenVersion === versionBefore + 1);
  check('--force mereset percobaan login gagal', users[0].failedLoginAttempts === 0);
  check('--force membuka kunci akun', users[0].lockUntil === undefined);

  // 5b. Akun lama (dibuat sebelum fitur role ada) tersimpan sebagai 'admin'.
  // Menyetel role secara eksplisit harus menaikkannya TANPA menyentuh kata
  // sandi — inilah jalur pemulihan untuk instance yang tak punya superadmin.
  users[0].role = 'admin';
  users[0].password = 'hashed:PasswordLamaYangTidakBolehBerubah';
  const versionBeforeRoleUpdate = users[0].tokenVersion;
  res = await seedAdmin({ email: 'admin@contoh.com', role: 'superadmin' });
  check('role eksplisit → status role-updated', res.status === 'role-updated');
  check('role eksplisit → role naik jadi superadmin', users[0].role === 'superadmin');
  check('role eksplisit → role sebelumnya dilaporkan', res.previousRole === 'admin');
  check(
    'role eksplisit → kata sandi TIDAK diubah',
    users[0].password === 'hashed:PasswordLamaYangTidakBolehBerubah'
  );
  check(
    'role eksplisit → tokenVersion tidak diubah (sesi tetap valid)',
    users[0].tokenVersion === versionBeforeRoleUpdate
  );

  // 5c. Role yang diminta sama dengan yang sudah ada → tidak ada penulisan.
  res = await seedAdmin({ email: 'admin@contoh.com', role: 'superadmin' });
  check('role sudah sesuai → dilewati (bukan role-updated)', res.status === 'skipped');

  // 5d. Tanpa role eksplisit, akun lama TIDAK boleh diubah sama sekali.
  users[0].role = 'admin';
  res = await seedAdmin({ email: 'admin@contoh.com' });
  check('tanpa role eksplisit → akun lama tidak disentuh', res.status === 'skipped');
  check('tanpa role eksplisit → role admin dipertahankan', users[0].role === 'admin');

  // 5e. Akun lama tanpa field isActive (mis. dibuat sebelum field itu ada) harus
  // diaktifkan sekalian, kalau tidak seeder "berhasil" tapi akun tetap tak bisa
  // login karena isActive === false.
  users[0].role = 'admin';
  users[0].isActive = undefined;
  await seedAdmin({ email: 'admin@contoh.com', role: 'superadmin' });
  check('role-updated pada akun tanpa isActive → isActive jadi true', users[0].isActive === true);

  // 5f. Nilai role yang tidak dikenal ditolak, bukan gagal diam-diam.
  users[0].role = 'admin';
  threw = false;
  try {
    await seedAdmin({ email: 'admin@contoh.com', role: 'root' });
  } catch (e) {
    threw = /role tidak dikenal/i.test(e.message) && users[0].role === 'admin';
  }
  check('role tidak valid → error & role tidak berubah', threw);

  // 5g. --role admin pada akun superadmin harus benar-benar menurunkan role
  // (bukan dianggap "sudah superadmin"). Menutup kemungkinan nilai 'admin'
  // hilang saat CLI mem-parse argumen.
  users[0].role = 'superadmin';
  res = await seedAdmin({ email: 'admin@contoh.com', role: 'admin' });
  check('--role admin → benar-benar menurunkan role', res.status === 'role-updated' && users[0].role === 'admin');
  users[0].role = 'superadmin';

  // 6. Password too short is rejected.
  threw = false;
  try {
    await seedAdmin({ email: 'baru@contoh.com', password: 'pendek' });
  } catch (e) {
    threw = /minimal 8/.test(e.message);
  }
  check('password < 8 karakter → ditolak', threw);

  // 7. No password supplied → a strong one is generated and returned once.
  users = [];
  res = await seedAdmin({ email: 'auto@contoh.com' });
  check('tanpa password → tetap dibuat', res.status === 'created');
  check('password acak dihasilkan', typeof res.generatedPassword === 'string');
  check('password acak cukup panjang (>=24)', res.generatedPassword.length >= 24);
  check('password acak URL-safe', /^[A-Za-z0-9_-]+$/.test(res.generatedPassword));
  check('password acak ikut di-hash', users[0].password === `hashed:${res.generatedPassword}`);

  // 8. Generated passwords are unique across runs (not a fixed default).
  const samples = new Set(Array.from({ length: 200 }, () => generatePassword()));
  check('200 password acak semuanya unik', samples.size === 200);

  // 9. Falls back to env vars when no arguments are given.
  users = [];
  process.env.SEED_ADMIN_EMAIL = 'dari-env@contoh.com';
  process.env.SEED_ADMIN_PASSWORD = 'PasswordDariEnv123';
  process.env.SEED_ADMIN_NAME = 'Admin Env';
  delete require.cache[require.resolve(path.join(SRC, 'config/env.js'))];
  delete require.cache[require.resolve(path.join(SRC, 'seeders/adminSeeder.js'))];
  const seeder2 = require(path.join(SRC, 'seeders/adminSeeder.js'));
  res = await seeder2.seedAdmin();
  check('membaca SEED_ADMIN_EMAIL dari environment', res.email === 'dari-env@contoh.com');
  check('membaca SEED_ADMIN_PASSWORD dari environment', users[0].password === 'hashed:PasswordDariEnv123');
  check('membaca SEED_ADMIN_NAME dari environment', users[0].name === 'Admin Env');
  check('tanpa SEED_ADMIN_ROLE → akun baru tetap superadmin', users[0].role === 'superadmin');

  // 10. SEED_ADMIN_ROLE dari environment ikut dipakai — dan tetap hanya
  // menyentuh role, bukan kata sandi, pada akun yang sudah ada.
  process.env.SEED_ADMIN_ROLE = 'admin';
  delete require.cache[require.resolve(path.join(SRC, 'config/env.js'))];
  delete require.cache[require.resolve(path.join(SRC, 'seeders/adminSeeder.js'))];
  const seeder3 = require(path.join(SRC, 'seeders/adminSeeder.js'));
  users[0].role = 'superadmin';
  const passwordSebelum = users[0].password;
  res = await seeder3.seedAdmin();
  check('membaca SEED_ADMIN_ROLE dari environment', users[0].role === 'admin');
  check('SEED_ADMIN_ROLE tidak mengubah kata sandi', users[0].password === passwordSebelum);
  check('SEED_ADMIN_ROLE → status role-updated', res.status === 'role-updated');
  delete process.env.SEED_ADMIN_ROLE;

  // 11. Parser argumen CLI. `npm run seed` menyisipkan literal "admin" sebagai
  // sub-command, dan pembuangan yang ceroboh pernah ikut menghapus NILAI dari
  // `--role admin` — jadi nilai tersebut diuji secara eksplisit di sini.
  const { parseArgs, stripSubcommand } = require(path.join(SRC, 'cli/seed.js'));

  check('CLI: sub-command "admin" dibuang', JSON.stringify(stripSubcommand(['admin'])) === '[]');
  check(
    'CLI: hanya sub-command pertama yang dibuang',
    JSON.stringify(stripSubcommand(['admin', 'admin@contoh.com'])) === '["admin@contoh.com"]'
  );
  check(
    'CLI: --role admin → nilainya TIDAK ikut terhapus',
    parseArgs(stripSubcommand(['admin', '--role', 'admin'])).role === 'admin'
  );
  check(
    'CLI: --role superadmin terbaca',
    parseArgs(stripSubcommand(['admin', '--role', 'superadmin'])).role === 'superadmin'
  );
  check(
    'CLI: --role admin tidak menghilangkan flag lain',
    JSON.stringify(parseArgs(stripSubcommand(['admin', '--email', 'a@b.com', '--role', 'admin']))) ===
      JSON.stringify({ force: false, email: 'a@b.com', role: 'admin' })
  );
  check(
    'CLI: tanpa --role → role undefined (bukan string kosong)',
    parseArgs(stripSubcommand(['admin'])).role === undefined
  );
  check(
    'CLI: --force tetap dikenali bersama --role',
    JSON.stringify(parseArgs(stripSubcommand(['admin', '--force', '--role', 'superadmin']))) ===
      JSON.stringify({ force: true, role: 'superadmin' })
  );

  console.log('');
  let pass = 0;
  for (const [name, ok] of results) {
    console.log(`${ok ? '✅' : '❌'} ${name}`);
    if (ok) pass += 1;
  }
  console.log(`\n${pass}/${results.length} lolos`);
  process.exit(pass === results.length ? 0 : 1);
})();
