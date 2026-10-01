const Heartbeat = require('../models/Heartbeat');
const AgentMetric = require('../models/AgentMetric');
const AgentLog = require('../models/AgentLog');
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

// Agent telemetry is far higher volume than heartbeats (one sample per agent
// per interval), so it gets its own, shorter retention windows.
async function cleanupOldAgentMetrics() {
  const cutoff = new Date(Date.now() - env.AGENT_METRIC_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const result = await AgentMetric.deleteMany({ recordedAt: { $lt: cutoff } });
  if (result.deletedCount > 0) {
    logger.info(`Retensi data: menghapus ${result.deletedCount} metrik agent lebih lama dari ${env.AGENT_METRIC_RETENTION_DAYS} hari.`);
  }
}

async function cleanupOldAgentLogs() {
  const cutoff = new Date(Date.now() - env.AGENT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const result = await AgentLog.deleteMany({ loggedAt: { $lt: cutoff } });
  if (result.deletedCount > 0) {
    logger.info(`Retensi data: menghapus ${result.deletedCount} log agent lebih lama dari ${env.AGENT_LOG_RETENTION_DAYS} hari.`);
  }
}

function runCleanup() {
  return Promise.all([
    cleanupOldHeartbeats(),
    cleanupOldAgentMetrics(),
    cleanupOldAgentLogs(),
  ]);
}

function start() {
  // Run once shortly after boot, then on a daily interval. Keeps the
  // heartbeats collection bounded on long-running self-hosted instances.
  setTimeout(() => runCleanup().catch((e) => logger.error('Retention cleanup failed', e)), 60 * 1000);
  setInterval(() => runCleanup().catch((e) => logger.error('Retention cleanup failed', e)), RUN_EVERY_MS);
}

module.exports = { start, cleanupOldHeartbeats, cleanupOldAgentMetrics, cleanupOldAgentLogs };
