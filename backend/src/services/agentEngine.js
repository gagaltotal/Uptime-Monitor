const Agent = require('../models/Agent');
const AgentMetric = require('../models/AgentMetric');
const AgentIncident = require('../models/AgentIncident');
const notifier = require('./notifier');
const socket = require('./socket');
const { env } = require('../config/env');
const logger = require('../utils/logger');

const TICK_INTERVAL_MS = 10000;

// Resource thresholds that raise a warning incident when crossed. Kept
// intentionally simple (percentage based) so the same rule works across
// every Linux distro the agent runs on.
const THRESHOLD_PERCENT = 90;
const THRESHOLDS = [
  { field: 'cpuPercent', type: 'cpu', label: 'CPU' },
  { field: 'memoryPercent', type: 'memory', label: 'Memori' },
  { field: 'diskPercent', type: 'disk', label: 'Disk' },
];

let tickTimer = null;
const inProgress = new Set();

function start() {
  if (tickTimer) return;
  tickTimer = setInterval(() => {
    tick().catch((err) => logger.error('Agent engine tick failed', err));
  }, TICK_INTERVAL_MS);
  tick().catch((err) => logger.error('Agent engine initial tick failed', err));
  logger.info('Agent engine started');
}

function stop() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
}

// The notifier was written for monitors, so we hand it an agent-shaped
// object that satisfies the fields it reads (name, target label, channels).
// This lets agents reuse the exact same Discord/Slack/Telegram delivery
// without touching the notifier itself.
function notifierTarget(agent) {
  return {
    name: agent.name,
    type: 'agent',
    host: agent.hostname || agent.ipAddress || agent.name,
    notificationChannels: agent.notificationChannels,
  };
}

async function tick() {
  const threshold = new Date(Date.now() - env.AGENT_OFFLINE_THRESHOLD_SECONDS * 1000);
  const stale = await Agent.find({
    isActive: true,
    currentStatus: 'online',
    lastSeenAt: { $lt: threshold },
  })
    .select('_id')
    .lean();

  for (const { _id } of stale) {
    const key = _id.toString();
    if (inProgress.has(key)) continue;
    inProgress.add(key);
    markDisconnected(_id).finally(() => inProgress.delete(key));
  }
}

async function markDisconnected(agentId) {
  const agent = await Agent.findById(agentId);
  if (!agent || !agent.isActive) return;
  if (agent.currentStatus === 'disconnected') return;

  agent.currentStatus = 'disconnected';
  agent.consecutiveMissed += 1;
  await agent.save();

  const incident = await AgentIncident.create({
    agent: agent._id,
    status: 'ongoing',
    type: 'disconnect',
    severity: 'critical',
    cause: `Agent tidak melapor lebih dari ${env.AGENT_OFFLINE_THRESHOLD_SECONDS} detik.`,
    startedAt: new Date(),
    notifiedDown: true,
  });

  socket.emitAgentIncident(incident);
  socket.emitAgentUpdate(agent);
  notifier
    .notifyDown(notifierTarget(agent), incident)
    .catch((e) => logger.warn('notifyDown (agent) failed', e.message));
}

// Called by the ingestion route whenever an agent posts a report. Persists
// the metric sample, flips the agent back online (resolving any disconnect
// incident), and evaluates resource thresholds.
async function handleReport(agent, payload = {}) {
  const metrics = payload.metrics || {};

  agent.currentMetrics = {
    cpuPercent: metrics.cpuPercent,
    memoryPercent: metrics.memoryPercent,
    memoryUsedMb: metrics.memoryUsedMb,
    memoryTotalMb: metrics.memoryTotalMb,
    diskPercent: metrics.diskPercent,
    diskUsedGb: metrics.diskUsedGb,
    diskTotalGb: metrics.diskTotalGb,
    loadAverage: Array.isArray(metrics.loadAverage) ? metrics.loadAverage : undefined,
    uptimeSeconds: metrics.uptimeSeconds,
    processCount: metrics.processCount,
  };

  const wasDisconnected = agent.currentStatus !== 'online';
  agent.currentStatus = 'online';
  agent.consecutiveMissed = 0;
  agent.lastSeenAt = new Date();
  agent.lastReportedAt = new Date();
  await agent.save();

  const metric = await AgentMetric.create({
    agent: agent._id,
    status: 'online',
    cpuPercent: metrics.cpuPercent,
    memoryPercent: metrics.memoryPercent,
    memoryUsedMb: metrics.memoryUsedMb,
    memoryTotalMb: metrics.memoryTotalMb,
    diskPercent: metrics.diskPercent,
    diskUsedGb: metrics.diskUsedGb,
    diskTotalGb: metrics.diskTotalGb,
    loadAverage: Array.isArray(metrics.loadAverage) ? metrics.loadAverage : undefined,
    uptimeSeconds: metrics.uptimeSeconds,
    processCount: metrics.processCount,
    message: payload.message,
    recordedAt: new Date(),
  });

  socket.emitAgentHeartbeat(agent._id, metric);
  socket.emitAgentUpdate(agent);

  if (wasDisconnected) {
    await resolveIncident(agent, 'disconnect');
  }

  await evaluateThresholds(agent, metrics);

  return metric;
}

async function resolveIncident(agent, type) {
  const incident = await AgentIncident.findOne({ agent: agent._id, type, status: 'ongoing' });
  if (!incident) return;
  incident.status = 'resolved';
  incident.resolvedAt = new Date();
  incident.durationSeconds = Math.round((incident.resolvedAt - incident.startedAt) / 1000);
  incident.notifiedResolved = true;
  await incident.save();
  socket.emitAgentIncident(incident);
  notifier
    .notifyRecovery(notifierTarget(agent), incident)
    .catch((e) => logger.warn('notifyRecovery (agent) failed', e.message));
}

async function evaluateThresholds(agent, metrics) {
  for (const t of THRESHOLDS) {
    const value = metrics[t.field];
    if (typeof value !== 'number' || Number.isNaN(value)) continue;

    const ongoing = await AgentIncident.findOne({ agent: agent._id, type: t.type, status: 'ongoing' });

    if (value >= THRESHOLD_PERCENT && !ongoing) {
      const incident = await AgentIncident.create({
        agent: agent._id,
        status: 'ongoing',
        type: t.type,
        severity: 'warning',
        cause: `Penggunaan ${t.label} tinggi: ${value.toFixed(1)}% (ambang ${THRESHOLD_PERCENT}%).`,
        startedAt: new Date(),
        notifiedDown: true,
      });
      socket.emitAgentIncident(incident);
      notifier
        .notifyDown(notifierTarget(agent), incident)
        .catch((e) => logger.warn('notifyDown (agent threshold) failed', e.message));
    } else if (value < THRESHOLD_PERCENT && ongoing) {
      await resolveIncident(agent, t.type);
    }
  }
}

module.exports = { start, stop, handleReport };
