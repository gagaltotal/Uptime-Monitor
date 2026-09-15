#!/usr/bin/env node
const { assertValidEnv } = require('../config/env');
const { connectDB, disconnectDB } = require('../config/db');
const { seedAdmin } = require('../seeders/adminSeeder');
const logger = require('../utils/logger');

const USAGE = `
Penggunaan:
  npm run seed                          Buat akun admin dari SEED_ADMIN_* di .env
  npm run seed -- --force               Reset kata sandi admin jika akun sudah ada
  npm run seed -- --email a@b.com       Timpa email dari environment
  npm run seed -- --password "Rahasia1" Timpa kata sandi dari environment
  npm run seed -- --name "Nama Admin"   Timpa nama dari environment

Jika kata sandi tidak diberikan (lewat flag maupun SEED_ADMIN_PASSWORD),
seeder akan membuat kata sandi acak yang kuat dan menampilkannya SEKALI.
`;

// Minimal flag parser — enough for the handful of options above without
// pulling in a CLI-args dependency for a script this small.
function parseArgs(argv) {
  const args = { force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--force' || arg === '-f') args.force = true;
    else if (arg === '--email') args.email = argv[++i];
    else if (arg === '--password') args.password = argv[++i];
    else if (arg === '--name') args.name = argv[++i];
  }
  return args;
}

async function main() {
  assertValidEnv();

  const rawArgs = process.argv.slice(2).filter((a) => a !== 'admin');
  if (rawArgs.some((a) => ['-h', '--help', 'help'].includes(a))) {
    console.log(USAGE);
    return;
  }

  const args = parseArgs(rawArgs);
  await connectDB();

  const result = await seedAdmin(args);

  if (result.status === 'created') {
    logger.info(`✔ Akun admin dibuat: ${result.email}`);
  } else if (result.status === 'updated') {
    logger.info(`✔ Akun admin diperbarui: ${result.email}`);
  } else {
    logger.info(`• Dilewati: ${result.reason}`);
  }
}

main()
  .catch((err) => {
    logger.error('Seeder gagal', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDB().catch(() => {});
    process.exit(process.exitCode || 0);
  });
