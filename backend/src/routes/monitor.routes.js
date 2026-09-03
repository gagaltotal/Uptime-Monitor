const express = require('express');
const mongoose = require('mongoose');
const Monitor = require('../models/Monitor');
const Heartbeat = require('../models/Heartbeat');
const Incident = require('../models/Incident');
const { protect } = require('../middleware/auth');
const { validate, validateObjectIdParam } = require('../validators/index');
const { ApiError, catchAsync } = require('../utils/helpers');
const monitorEngine = require('../services/monitorEngine');

const router = express.Router();

router.use(protect); // every route below requires a logged-in admin

const RANGE_TO_MS = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

// GET /api/monitors — list, with 24h uptime % attached to each monitor in a
// single aggregation instead of one query per monitor (avoids N+1 queries
// on a dashboard with many monitors).
router.get(
  '/',
  catchAsync(async (req, res) => {
    const monitors = await Monitor.find().sort({ name: 1 }).populate('notificationChannels', 'name type');

    const since24h = new Date(Date.now() - RANGE_TO_MS['24h']);
    const uptimeByMonitor = await Heartbeat.aggregate([
      { $match: { checkedAt: { $gte: since24h } } },
      {
        $group: {
          _id: '$monitor',
          total: { $sum: 1 },
          up: { $sum: { $cond: [{ $eq: ['$status', 'up'] }, 1, 0] } },
        },
      },
    ]);
    const uptimeMap = new Map(
      uptimeByMonitor.map((u) => [u._id.toString(), u.total ? (u.up / u.total) * 100 : null])
    );

    const payload = monitors.map((m) => ({
      ...m.toObject(),
      uptime24h: uptimeMap.get(m._id.toString()) ?? null,
    }));

    res.json({ monitors: payload });
  })
);

router.get(
  '/:id',
  validateObjectIdParam(),
  catchAsync(async (req, res) => {
    const monitor = await Monitor.findById(req.params.id).populate('notificationChannels', 'name type');
    if (!monitor) throw new ApiError(404, 'Monitor tidak ditemukan.');
    res.json({ monitor });
  })
);

router.post(
  '/',
  validate('monitor'),
  catchAsync(async (req, res) => {
    const monitor = await Monitor.create({
      ...req.body,
      createdBy: req.user._id,
      nextCheckAt: new Date(), // check it immediately, not after a full interval
    });
    monitorEngine.checkNow(monitor._id).catch(() => {});
    res.status(201).json({ monitor });
  })
);

router.put(
  '/:id',
  validateObjectIdParam(),
  validate('monitor'),
  catchAsync(async (req, res) => {
    const monitor = await Monitor.findById(req.params.id);
    if (!monitor) throw new ApiError(404, 'Monitor tidak ditemukan.');

    Object.assign(monitor, req.body);
    // A definition change (new URL, new port, etc.) deserves a fresh
    // verdict rather than waiting out the old schedule.
    monitor.nextCheckAt = new Date();
    monitor.consecutiveFails = 0;
    await monitor.save();

    monitorEngine.checkNow(monitor._id).catch(() => {});
    res.json({ monitor });
  })
);

router.patch(
  '/:id/toggle',
  validateObjectIdParam(),
  catchAsync(async (req, res) => {
    const monitor = await Monitor.findById(req.params.id);
    if (!monitor) throw new ApiError(404, 'Monitor tidak ditemukan.');
    monitor.isActive = !monitor.isActive;
    if (monitor.isActive) {
      monitor.nextCheckAt = new Date();
      monitor.consecutiveFails = 0;
    } else {
      monitor.currentStatus = 'pending';
    }
    await monitor.save();
    res.json({ monitor });
  })
);

router.delete(
  '/:id',
  validateObjectIdParam(),
  catchAsync(async (req, res) => {
    const monitor = await Monitor.findByIdAndDelete(req.params.id);
    if (!monitor) throw new ApiError(404, 'Monitor tidak ditemukan.');
    // Clean up dependent data so deleting a monitor doesn't leave orphaned
    // history behind (also keeps the heartbeats collection from growing
    // unboundedly with dead references).
    await Promise.all([
      Heartbeat.deleteMany({ monitor: monitor._id }),
      Incident.deleteMany({ monitor: monitor._id }),
    ]);
    res.status(204).end();
  })
);

// GET /api/monitors/:id/heartbeats?range=24h|7d|30d  OR  ?limit=40
// `limit` returns the most recent N checks regardless of age (cheap, used by
// the dashboard's inline heartbeat bar); `range` returns everything within a
// time window (used by the monitor detail chart).
router.get(
  '/:id/heartbeats',
  validateObjectIdParam(),
  catchAsync(async (req, res) => {
    const limit = parseInt(req.query.limit, 10);
    if (limit && limit > 0) {
      const recent = await Heartbeat.find({ monitor: req.params.id })
        .sort({ checkedAt: -1 })
        .limit(Math.min(limit, 200))
        .select('status responseTime statusCode message checkedAt');
      return res.json({ heartbeats: recent.reverse() });
    }

    const range = RANGE_TO_MS[req.query.range] ? req.query.range : '24h';
    const since = new Date(Date.now() - RANGE_TO_MS[range]);
    const heartbeats = await Heartbeat.find({ monitor: req.params.id, checkedAt: { $gte: since } })
      .sort({ checkedAt: 1 })
      .limit(2000)
      .select('status responseTime statusCode message checkedAt');
    res.json({ heartbeats });
  })
);

// GET /api/monitors/:id/stats — uptime % + avg response time for 24h/7d/30d
// in a single round trip via $facet.
router.get(
  '/:id/stats',
  validateObjectIdParam(),
  catchAsync(async (req, res) => {
    const monitorId = new mongoose.Types.ObjectId(req.params.id);
    const since30d = new Date(Date.now() - RANGE_TO_MS['30d']);

    const [result] = await Heartbeat.aggregate([
      { $match: { monitor: monitorId, checkedAt: { $gte: since30d } } },
      {
        $facet: Object.fromEntries(
          Object.entries(RANGE_TO_MS).map(([key, ms]) => [
            key,
            [
              { $match: { checkedAt: { $gte: new Date(Date.now() - ms) } } },
              {
                $group: {
                  _id: null,
                  total: { $sum: 1 },
                  up: { $sum: { $cond: [{ $eq: ['$status', 'up'] }, 1, 0] } },
                  avgResponseTime: { $avg: '$responseTime' },
                },
              },
            ],
          ])
        ),
      },
    ]);

    const stats = {};
    for (const key of Object.keys(RANGE_TO_MS)) {
      const bucket = result[key]?.[0];
      stats[key] = {
        uptimePercent: bucket && bucket.total ? Number(((bucket.up / bucket.total) * 100).toFixed(2)) : null,
        avgResponseTime: bucket?.avgResponseTime ? Math.round(bucket.avgResponseTime) : null,
        totalChecks: bucket?.total || 0,
      };
    }
    res.json({ stats });
  })
);

router.get(
  '/:id/incidents',
  validateObjectIdParam(),
  catchAsync(async (req, res) => {
    const incidents = await Incident.find({ monitor: req.params.id }).sort({ startedAt: -1 }).limit(100);
    res.json({ incidents });
  })
);

module.exports = router;
