#!/usr/bin/env node
const { assertValidEnv } = require('../config/env');
const { connectDB, disconnectDB } = require('../config/db');
const runner = require('../migrations/runner');
const logger = require('../utils/logger');

const USAGE = `
Penggunaan:
  npm run migrate              Jalankan semua migrasi yang tertunda
  npm run migrate:status       Tampilkan status setiap migrasi
  npm run migrate:down         Rollback 1 migrasi terakhir
  npm run migrate:down -- 3    Rollback 3 migrasi terakhir
`;

function printStatus(rows) {
  if (rows.length === 0) {
    console.log('Belum ada file migrasi.');
    return;
  }
  const nameWidth = Math.max(...rows.map((r) => r.name.length));
  console.log('');
  console.log(`${'MIGRASI'.padEnd(nameWidth)}  STATUS       DIJALANKAN`);
  console.log(`${'-'.repeat(nameWidth)}  -----------  ------------------------`);
  for (const row of rows) {
    const badge = row.applied ? 'diterapkan' : 'TERTUNDA  ';
    const when = row.appliedAt ? new Date(row.appliedAt).toLocaleString('id-ID') : '-';
    console.log(`${row.name.padEnd(nameWidth)}  ${badge}   ${when}`);
    if (row.description) console.log(`${' '.repeat(nameWidth)}  └─ ${row.description}`);
  }
  const pending = rows.filter((r) => !r.applied).length;
  console.log(`\n${rows.length} migrasi total, ${pending} tertunda.\n`);
}

async function main() {
  assertValidEnv();

  const command = process.argv[2] || 'up';
  if (['-h', '--help', 'help'].includes(command)) {
    console.log(USAGE);
    return;
  }

  // Validate the command before opening a connection — otherwise a typo
  // surfaces as a confusing "ECONNREFUSED" instead of "unknown command".
  if (!['up', 'status', 'down'].includes(command)) {
    console.error(`Perintah tidak dikenal: "${command}"`);
    console.log(USAGE);
    process.exitCode = 1;
    return;
  }

  await connectDB();

  if (command === 'up') {
    const { applied, skipped } = await runner.up();
    if (!skipped && applied.length > 0) {
      logger.info(`Selesai: ${applied.length} migrasi diterapkan.`);
    }
  } else if (command === 'status') {
    printStatus(await runner.status());
  } else if (command === 'down') {
    const steps = parseInt(process.argv[3], 10) || 1;
    const { reverted } = await runner.down(steps);
    logger.info(`Selesai: ${reverted.length} migrasi di-rollback.`);
  }
}

main()
  .catch((err) => {
    logger.error('Perintah migrasi gagal', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDB().catch(() => {});
    // Mongoose keeps the event loop alive; exit explicitly once done.
    process.exit(process.exitCode || 0);
  });
