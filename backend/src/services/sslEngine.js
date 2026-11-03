const SslMonitor = require('../models/SslMonitor');
const SslIncident = require('../models/SslIncident');
const checkers = require('./checkers');
const notifier = require('./notifier');
const socket = require('./socket');
const logger = require('../utils/logger');
const { env } = require('../config/env');
const { computeSslStatus } = require('../utils/helpers');

// Wake up and look for due monitors at this cadence. Individual monitors are
// staggered via `nextCheckAt`, so this is just the scheduler's heartbeat.
const TICK_INTERVAL_MS = env.SSL_TICK_INTERVAL_MS;
const WARN_THRESHOLD_DAYS = env.SSL_WARN_THRESHOLD_DAYS;
const RENOTIFY_INTERVAL_MS = env.SSL_RENOTIFY_INTERVAL_HOURS * 60 * 60 * 1000;

let tickTimer = null;
const inProgress = new Set();

function start() {
  if (tickTimer) return;
  tickTimer = setInterval(() => {
    tick().catch((err) => logger.error('SSL engine tick failed', err));
  }, TICK_INTERVAL_MS);
  tick().catch((err) => logger.error('SSL engine initial tick failed', err));
  logger.info('SSL engine started');
}

function stop() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
}

async function tick() {
  const due = await SslMonitor.find({
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

// Reschedules nextCheckAt based on the current state. A certificate that is
// close to expiry is re-checked more aggressively so a renewal is picked up
// quickly; a healthy certificate is checked on its normal cadence.
function nextCheckDate(sslMonitor, status) {
  let seconds = sslMonitor.interval;
  if (status === 'expiring' || status === 'expired') {
    // Check at least every 6 hours, or once per day for far-out expiries.
    seconds = Math.min(sslMonitor.interval, 21600);
  } else if (status === 'error') {
    // A failing host may be transiently unreachable — retry sooner.
    seconds = Math.min(sslMonitor.interval, 3600);
  }
  return new Date(Date.now() + seconds * 1000);
}

async function runCheck(sslMonitorId) {
  const sslMonitor = await SslMonitor.findById(sslMonitorId);
  if (!sslMonitor || !sslMonitor.isActive) return;

  const previousStatus = sslMonitor.status;
  const threshold = sslMonitor.alertThresholdDays || WARN_THRESHOLD_DAYS;

  let result = null;
  let checkError = null;
  try {
    result = await checkers.checkSslCertificateDetailed(
      sslMonitor.domain,
      sslMonitor.port || 443,
      sslMonitor.timeout
    );
  } catch (err) {
    checkError = err;
  }

  if (checkError) {
    // Could not read the certificate at all (DNS failure, refused connection,
    // TLS handshake error). Record it and, once past the retry grace window,
    // surface an incident so the operator knows the check itself is failing.
    sslMonitor.consecutiveFails += 1;
    sslMonitor.lastCheckedAt = new Date();
    sslMonitor.lastMessage = checkError.message || 'Pengecekan gagal.';

    if (sslMonitor.consecutiveFails > sslMonitor.retries && previousStatus !== 'error') {
      sslMonitor.status = 'error';
      await openIncident(sslMonitor, 'error', 'critical', sslMonitor.lastMessage);
    } else if (previousStatus === 'pending') {
      // Keep showing pending during the initial grace window rather than
      // declaring an error on the very first transient failure.
      sslMonitor.status = 'pending';
    }

    sslMonitor.nextCheckAt = nextCheckDate(sslMonitor, sslMonitor.status);
    await sslMonitor.save();
    socket.emitSslUpdate(sslMonitor);
    return;
  }

  // Certificate read successfully — reset failure state and store details.
  sslMonitor.consecutiveFails = 0;
  sslMonitor.issuer = result.issuer || sslMonitor.issuer;
  sslMonitor.subject = result.subject || sslMonitor.subject;
  sslMonitor.serialNumber = result.serialNumber || undefined;
  sslMonitor.validFrom = result.validFrom || undefined;
  sslMonitor.expiresAt = result.expiresAt;
  sslMonitor.daysRemaining = result.daysRemaining;
  sslMonitor.lastCheckedAt = new Date();
  sslMonitor.lastMessage = `Sertifikat valid. Sisa ${result.daysRemaining} hari.`;

  const status = computeSslStatus({
    daysRemaining: result.daysRemaining,
    thresholdDays: threshold,
    validFrom: result.validFrom,
  });
  sslMonitor.status = status;

  await applySslTransition(sslMonitor, status, previousStatus);

  sslMonitor.nextCheckAt = nextCheckDate(sslMonitor, status);
  await sslMonitor.save();
  socket.emitSslUpdate(sslMonitor);
}

// Maps a certificate's derived status onto incident + notification behaviour,
// mirroring how monitorEngine.applyStatusTransition handles up/down edges.
async function applySslTransition(sslMonitor, status, previousStatus) {
  if (status === 'valid') {
    // Healthy — close any lingering incident and notify recovery once.
    await resolveIncidents(sslMonitor);
    return;
  }

  if (status === 'expiring') {
    // Still valid but inside the warn window. Raise/reuse an incident, and
    // notify on the edge or on the re-notify cadence.
    const incident = await openIncident(sslMonitor, 'expiring', 'warning', `Sertifikat kedaluwarsa dalam ${sslMonitor.daysRemaining} hari.`);
    if (shouldNotify(sslMonitor, previousStatus, incident)) {
      await sendNotification(sslMonitor, 'expiring', incident);
    }
    return;
  }

  if (status === 'expired') {
    const incident = await openIncident(sslMonitor, 'expired', 'critical', `Sertifikat sudah kedaluwarsa sejak ${new Date(sslMonitor.expiresAt).toLocaleString('id-ID')}.`);
    if (shouldNotify(sslMonitor, previousStatus, incident)) {
      await sendNotification(sslMonitor, 'expired', incident);
    }
    return;
  }

  // pending (certificate not yet valid) — nothing to alert on.
}

// Whether an alert should fire for an ongoing problem: on the edge (status
// changed) or once the re-notify interval has elapsed since the last alert.
function shouldNotify(sslMonitor, previousStatus, incident) {
  if (!incident) return false;
  if (previousStatus !== sslMonitor.status) return true;
  if (!sslMonitor.lastNotifiedAt) return true;
  return Date.now() - sslMonitor.lastNotifiedAt.getTime() > RENOTIFY_INTERVAL_MS;
}

async function sendNotification(sslMonitor, type, incident) {
  sslMonitor.lastNotifiedAt = new Date();
  try {
    if (type === 'expiring') {
      await notifier.notifySslExpiring(sslMonitor, incident);
    } else if (type === 'expired') {
      await notifier.notifySslExpired(sslMonitor, incident);
    } else if (type === 'error') {
      await notifier.notifySslError(sslMonitor, incident);
    }
  } catch (err) {
    logger.warn(`Gagal mengirim notifikasi SSL untuk ${sslMonitor.domain}`, err.message);
  }
}

// Finds the ongoing incident for this monitor, or creates a new one. Reuses
// the existing incident when the underlying problem hasn't changed type so we
// don't create a duplicate for every check while the cert keeps expiring.
async function openIncident(sslMonitor, type, severity, cause) {
  let incident = await SslIncident.findOne({ sslMonitor: sslMonitor._id, status: 'ongoing' });
  if (incident) {
    // Escalate in place if the problem got worse (expiring → expired).
    if (incident.type !== type || incident.severity !== severity) {
      incident.type = type;
      incident.severity = severity;
      incident.cause = cause;
      await incident.save();
      socket.emitSslIncident(incident);
    }
    return incident;
  }

  incident = await SslIncident.create({
    sslMonitor: sslMonitor._id,
    status: 'ongoing',
    type,
    severity,
    cause,
    startedAt: new Date(),
    notifiedDown: false,
  });
  socket.emitSslIncident(incident);
  return incident;
}

async function resolveIncidents(sslMonitor) {
  const incident = await SslIncident.findOne({ sslMonitor: sslMonitor._id, status: 'ongoing' });
  if (!incident) return;
  incident.status = 'resolved';
  incident.resolvedAt = new Date();
  incident.durationSeconds = Math.round((incident.resolvedAt - incident.startedAt) / 1000);
  incident.notifiedResolved = true;
  await incident.save();
  socket.emitSslIncident(incident);
  notifier
    .notifySslRecovered(sslMonitor, incident)
    .catch((e) => logger.warn('notifySslRecovered failed', e.message));
}

// Forces an immediate check outside the normal schedule — used right after a
// monitor is created or edited so the page shows real data without waiting
// for the first interval to elapse.
async function checkNow(sslMonitorId) {
  const key = sslMonitorId.toString();
  if (inProgress.has(key)) return;
  inProgress.add(key);
  try {
    await runCheck(sslMonitorId);
  } finally {
    inProgress.delete(key);
  }
}

module.exports = { start, stop, checkNow };
