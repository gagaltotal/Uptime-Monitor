const http = require('http');
const { env, assertValidEnv } = require('./config/env');
const { connectDB, disconnectDB } = require('./config/db');
const logger = require('./utils/logger');
const app = require('./app');
const socket = require('./services/socket');
const monitorEngine = require('./services/monitorEngine');
const retention = require('./services/retention');
const migrations = require('./migrations/runner');
const { seedAdmin } = require('./seeders/adminSeeder');

assertValidEnv();

async function main() {
  await connectDB();

  // Schema/data migrations run before anything starts serving traffic or
  // scheduling checks, so the app never operates against a half-migrated
  // database. The runner takes a lock, so multiple replicas booting together
  // is safe.
  if (env.AUTO_MIGRATE) {
    await migrations.up({ silent: true });
  }

  // Optional bootstrap of the first admin account. Idempotent — an existing
  // account is left untouched, so this is harmless on every restart.
  if (env.AUTO_SEED_ADMIN) {
    const result = await seedAdmin();
    if (result.status === 'skipped' && result.email) {
      logger.debug(`Seeder admin dilewati: ${result.reason}`);
    }
  }

  const httpServer = http.createServer(app);
  socket.init(httpServer);

  httpServer.listen(env.PORT, () => {
    logger.info(`Uptime Monitor API berjalan di port ${env.PORT} [${env.NODE_ENV}]`);
  });

  monitorEngine.start();
  retention.start();

  const shutdown = async (signal) => {
    logger.info(`Menerima ${signal}, mematikan server dengan aman...`);
    monitorEngine.stop();
    httpServer.close(async () => {
      await disconnectDB();
      process.exit(0);
    });
    // Force-exit if graceful shutdown hangs.
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Promise Rejection', reason instanceof Error ? reason : new Error(String(reason)));
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception — keluar', err);
  process.exit(1);
});

main().catch((err) => {
  logger.error('Gagal memulai server', err);
  process.exit(1);
});
