const Monitor = require('../models/Monitor');
const Heartbeat = require('../models/Heartbeat');
const Incident = require('../models/Incident');
const checkers = require('./checkers');
const notifier = require('./notifier');
const socket = require('./socket');
const logger = require('../utils/logger');

const TICK_INTERVAL_MS = 5000;
const SSL_RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const SSL_WARN_THRESHOLD_DAYS = 14;
const SSL_RENOTIFY_INTERVAL_MS = 24 * 60 * 60 * 1000; // don't spam the same warning

let tickTimer = null;
const inProgress = new Set();

function start() {
  if (tickTimer) return;
  tickTimer = setInterval(() => {
    tick().catch((err) => logger.error('Monitor engine tick failed', err));
  }, TICK_INTERVAL_MS);
  tick().catch((err) => logger.error('Monitor engine initial tick failed', err));
  logger.info('Monitor engine started');
}

function stop() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
}

async function tick() {
  const due = await Monitor.find({
    isActive: true,
    nextCheckAt: { $lte: new Date() },
  })
    .select('_id')
    .lean();

  for (const { _id } of due) {
    const key = _id.toString();
    if (inProgress.has(key)) continue; // a previous, slow check is still running
    inProgress.add(key);
    runCheck(_id).finally(() => inProgress.delete(key));
  }
}

async function performCheck(monitor) {
  if (monitor.type === 'http') return checkers.checkHttp(monitor);
  if (monitor.type === 'tcp') return checkers.checkTcpPort(monitor.host, monitor.port, monitor.timeout);
  if (monitor.type === 'ping') return checkers.checkPing(monitor.host, monitor.timeout);
  return { up: false, responseTime: null, statusCode: null, message: `Tipe monitor tidak dikenal: ${monitor.type}` };
}

async function runCheck(monitorId) {
  const monitor = await Monitor.findById(monitorId);
  if (!monitor || !monitor.isActive) return;

  const result = await performCheck(monitor);

  await Heartbeat.create({
    monitor: monitor._id,
    status: result.up ? 'up' : 'down',
    responseTime: result.responseTime,
    statusCode: result.statusCode,
    message: result.message,
  });
  socket.emitHeartbeat(monitor._id, {
    status: result.up ? 'up' : 'down',
    responseTime: result.responseTime,
    checkedAt: new Date(),
  });

  await applyStatusTransition(monitor, result);

  monitor.lastCheckAt = new Date();
  monitor.lastResponseTime = result.responseTime;
  monitor.lastMessage = result.message;
  monitor.nextCheckAt = new Date(Date.now() + monitor.interval * 1000);

  if (monitor.type === 'http' && monitor.url?.startsWith('https://')) {
    await maybeCheckSsl(monitor);
  }

  await monitor.save();
  socket.emitMonitorUpdate(monitor);
}

async function applyStatusTransition(monitor, result) {
  if (result.up) {
    monitor.consecutiveFails = 0;
    if (monitor.currentStatus !== 'up') {
      monitor.currentStatus = 'up';
      const incident = await Incident.findOne({ monitor: monitor._id, status: 'ongoing' });
      if (incident) {
        incident.status = 'resolved';
        incident.resolvedAt = new Date();
        incident.durationSeconds = Math.round((incident.resolvedAt - incident.startedAt) / 1000);
        incident.notifiedResolved = true;
        await incident.save();
        socket.emitIncident(incident);
        notifier.notifyRecovery(monitor, incident).catch((e) => logger.warn('notifyRecovery failed', e.message));
      }
    }
    return;
  }

  // Failed check
  monitor.consecutiveFails += 1;
  if (monitor.consecutiveFails > monitor.retries) {
    if (monitor.currentStatus !== 'down') {
      monitor.currentStatus = 'down';
      const incident = await Incident.create({
        monitor: monitor._id,
        status: 'ongoing',
        cause: result.message,
        startedAt: new Date(),
        notifiedDown: true,
      });
      socket.emitIncident(incident);
      notifier.notifyDown(monitor, incident).catch((e) => logger.warn('notifyDown failed', e.message));
    }
  } else if (monitor.currentStatus !== 'down') {
    // Within the configured retry grace window — flag as pending rather
    // than immediately crying wolf over a single transient blip.
    monitor.currentStatus = 'pending';
  }
}

async function maybeCheckSsl(monitor) {
  const dueForRecheck =
    !monitor.sslLastCheckedAt || Date.now() - monitor.sslLastCheckedAt.getTime() > SSL_RECHECK_INTERVAL_MS;
  if (!dueForRecheck) return;

  const hostname = checkers.extractHostnameFromUrl(monitor.url);
  if (!hostname) return;

  try {
    const { expiresAt, daysRemaining } = await checkers.checkSslCertificate(hostname, 443, monitor.timeout);
    monitor.sslCertExpiresAt = expiresAt;
    monitor.sslDaysRemaining = daysRemaining;
    monitor.sslLastCheckedAt = new Date();

    const shouldWarn =
      daysRemaining <= SSL_WARN_THRESHOLD_DAYS &&
      (!monitor.sslLastWarnedAt || Date.now() - monitor.sslLastWarnedAt.getTime() > SSL_RENOTIFY_INTERVAL_MS);

    if (shouldWarn) {
      monitor.sslLastWarnedAt = new Date();
      notifier.notifySslExpiry(monitor, daysRemaining).catch((e) => logger.warn('notifySslExpiry failed', e.message));
    }
  } catch (err) {
    logger.debug(`Pengecekan SSL gagal untuk ${hostname}: ${err.message}`);
  }
}

// Forces an immediate check outside the normal schedule — used right after
// a monitor is created so the dashboard doesn't sit at "pending" for a
// full interval before showing real data.
async function checkNow(monitorId) {
  const key = monitorId.toString();
  if (inProgress.has(key)) return;
  inProgress.add(key);
  try {
    await runCheck(monitorId);
  } finally {
    inProgress.delete(key);
  }
}

module.exports = { start, stop, checkNow };
