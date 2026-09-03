const http = require('http');
const { env, assertValidEnv } = require('./config/env');
const { connectDB, disconnectDB } = require('./config/db');
const logger = require('./utils/logger');
const app = require('./app');
const socket = require('./services/socket');
const monitorEngine = require('./services/monitorEngine');
const retention = require('./services/retention');

assertValidEnv();

async function main() {
  await connectDB();

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
