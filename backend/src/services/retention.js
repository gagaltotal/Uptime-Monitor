const Heartbeat = require('../models/Heartbeat');
const { env } = require('../config/env');
const logger = require('../utils/logger');

const RUN_EVERY_MS = 24 * 60 * 60 * 1000; // once a day is plenty

async function cleanupOldHeartbeats() {
  const cutoff = new Date(Date.now() - env.HEARTBEAT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const result = await Heartbeat.deleteMany({ checkedAt: { $lt: cutoff } });
  if (result.deletedCount > 0) {
    logger.info(`Retensi data: menghapus ${result.deletedCount} heartbeat lebih lama dari ${env.HEARTBEAT_RETENTION_DAYS} hari.`);
  }
}

function start() {
  // Run once shortly after boot, then on a daily interval. Keeps the
  // heartbeats collection bounded on long-running self-hosted instances.
  setTimeout(() => cleanupOldHeartbeats().catch((e) => logger.error('Retention cleanup failed', e)), 60 * 1000);
  setInterval(() => cleanupOldHeartbeats().catch((e) => logger.error('Retention cleanup failed', e)), RUN_EVERY_MS);
}

module.exports = { start, cleanupOldHeartbeats };
