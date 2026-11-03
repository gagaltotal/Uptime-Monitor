const express = require('express');
const SslMonitor = require('../models/SslMonitor');
const SslIncident = require('../models/SslIncident');
const { protect } = require('../middleware/auth');
const { validate, validateObjectIdParam } = require('../validators/index');
const { ApiError, catchAsync, normalizeDomain } = require('../utils/helpers');
const sslEngine = require('../services/sslEngine');

const router = express.Router();

router.use(protect); // every route below requires a logged-in admin

// Canonicalizes the user-supplied `domain` into { host, port }. Rejects input
// that can't be interpreted as a hostname so a bad record never reaches the
// engine (where it would just fail every check forever).
function normalizeInput(body) {
  const normalized = normalizeDomain(body.domain, body.port || 443);
  if (!normalized || !normalized.host) {
    throw new ApiError(400, 'Domain tidak valid. Contoh: example.com atau https://example.com');
  }
  // If the user typed an explicit port inside the domain (example.com:8443),
  // honour it over the separate `port` field so what they see is what runs.
  return {
    domain: normalized.host,
    port: normalized.hasExplicitPort ? normalized.port : body.port || normalized.port,
  };
}

// GET /api/ssl — list all SSL/Domain monitors. Expiry status/days-left are
// stored on the document by the engine, so no per-monitor query is needed.
router.get(
  '/',
  catchAsync(async (req, res) => {
    const monitors = await SslMonitor.find()
      .sort({ name: 1 })
      .populate('notificationChannels', 'name type');

    // Attach the live ongoing-incident flag so the list can show a warning
    // badge without a second round trip per row.
    const ongoing = await SslIncident.aggregate([
      { $match: { status: 'ongoing' } },
      { $group: { _id: '$sslMonitor', count: { $sum: 1 } } },
    ]);
    const ongoingMap = new Map(ongoing.map((o) => [o._id.toString(), o.count]));

    const payload = monitors.map((m) => ({
      ...m.toObject(),
      ongoingIncidents: ongoingMap.get(m._id.toString()) || 0,
    }));

    res.json({ monitors: payload });
  })
);

router.get(
  '/summary',
  catchAsync(async (req, res) => {
    const [byStatus, ongoing] = await Promise.all([
      SslMonitor.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      SslIncident.countDocuments({ status: 'ongoing' }),
    ]);

    const summary = { total: 0, pending: 0, valid: 0, expiring: 0, expired: 0, error: 0, ongoingIncidents: ongoing };
    for (const row of byStatus) {
      summary[row._id] = row.count;
      summary.total += row.count;
    }
    res.json({ summary });
  })
);

router.get(
  '/:id',
  validateObjectIdParam(),
  catchAsync(async (req, res) => {
    const monitor = await SslMonitor.findById(req.params.id).populate(
      'notificationChannels',
      'name type'
    );
    if (!monitor) throw new ApiError(404, 'Monitor SSL tidak ditemukan.');

    // Include a compact 30-day incident summary so the detail page can show
    // history without a second request.
    const [incidents, incidentStats] = await Promise.all([
      SslIncident.find({ sslMonitor: monitor._id }).sort({ startedAt: -1 }).limit(50),
      SslIncident.aggregate([
        { $match: { sslMonitor: monitor._id } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            lastStartedAt: { $max: '$startedAt' },
          },
        },
      ]),
    ]);

    res.json({ monitor, incidents, incidentStats });
  })
);

router.post(
  '/',
  validate('sslMonitor'),
  catchAsync(async (req, res) => {
    const { domain, port } = normalizeInput(req.body);

    const monitor = await SslMonitor.create({
      ...req.body,
      domain,
      port,
      status: 'pending',
      nextCheckAt: new Date(), // check immediately, not after a full interval
      createdBy: req.user._id,
    });

    sslEngine.checkNow(monitor._id).catch(() => {});
    res.status(201).json({ monitor });
  })
);

router.put(
  '/:id',
  validateObjectIdParam(),
  validate('sslMonitor'),
  catchAsync(async (req, res) => {
    const monitor = await SslMonitor.findById(req.params.id);
    if (!monitor) throw new ApiError(404, 'Monitor SSL tidak ditemukan.');

    const { domain, port } = normalizeInput(req.body);

    Object.assign(monitor, {
      ...req.body,
      domain,
      port,
    });

    // A definition change (new domain/port/timeout) deserves a fresh verdict
    // rather than waiting out the old schedule.
    monitor.status = 'pending';
    monitor.nextCheckAt = new Date();
    monitor.consecutiveFails = 0;
    monitor.lastMessage = undefined;
    await monitor.save();

    sslEngine.checkNow(monitor._id).catch(() => {});
    res.json({ monitor });
  })
);

router.patch(
  '/:id/toggle',
  validateObjectIdParam(),
  catchAsync(async (req, res) => {
    const monitor = await SslMonitor.findById(req.params.id);
    if (!monitor) throw new ApiError(404, 'Monitor SSL tidak ditemukan.');

    monitor.isActive = !monitor.isActive;
    if (monitor.isActive) {
      monitor.nextCheckAt = new Date();
      monitor.consecutiveFails = 0;
    }
    await monitor.save();
    res.json({ monitor });
  })
);

// POST /api/ssl/:id/check — force an immediate re-check on demand.
router.post(
  '/:id/check',
  validateObjectIdParam(),
  catchAsync(async (req, res) => {
    const monitor = await SslMonitor.findById(req.params.id);
    if (!monitor) throw new ApiError(404, 'Monitor SSL tidak ditemukan.');

    await sslEngine.checkNow(monitor._id);
    const refreshed = await SslMonitor.findById(monitor._id).populate(
      'notificationChannels',
      'name type'
    );
    res.json({ monitor: refreshed });
  })
);

router.delete(
  '/:id',
  validateObjectIdParam(),
  catchAsync(async (req, res) => {
    const monitor = await SslMonitor.findByIdAndDelete(req.params.id);
    if (!monitor) throw new ApiError(404, 'Monitor SSL tidak ditemukan.');
    // Clean up incident history so deleting a monitor doesn't leave orphans.
    await SslIncident.deleteMany({ sslMonitor: monitor._id });
    res.status(204).end();
  })
);

// GET /api/ssl/:id/incidents — incident history for one SSL monitor.
router.get(
  '/:id/incidents',
  validateObjectIdParam(),
  catchAsync(async (req, res) => {
    const incidents = await SslIncident.find({ sslMonitor: req.params.id })
      .sort({ startedAt: -1 })
      .limit(100);
    res.json({ incidents });
  })
);

module.exports = router;