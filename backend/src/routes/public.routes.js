const express = require('express');
const StatusPage = require('../models/StatusPage');
const Heartbeat = require('../models/Heartbeat');
const Incident = require('../models/Incident');
const { ApiError, catchAsync } = require('../utils/helpers');

const router = express.Router();

const DAILY_BAR_DAYS = 45;

// GET /api/public/status/:slug — no auth. Deliberately returns only the
// fields a visitor needs (label, status, uptime) and never the underlying
// url/host/port of a monitor, so a public status page can't be used to
// enumerate internal hostnames or infrastructure.
router.get(
  '/status/:slug',
  catchAsync(async (req, res) => {
    const page = await StatusPage.findOne({ slug: req.params.slug, isPublished: true }).populate(
      'monitors.monitor',
      'name type currentStatus'
    );
    if (!page) throw new ApiError(404, 'Halaman status tidak ditemukan.');

    const monitorIds = page.monitors.map((m) => m.monitor?._id).filter(Boolean);
    const since = new Date(Date.now() - DAILY_BAR_DAYS * 24 * 60 * 60 * 1000);

    const dailyRaw = await Heartbeat.aggregate([
      { $match: { monitor: { $in: monitorIds }, checkedAt: { $gte: since } } },
      {
        $group: {
          _id: {
            monitor: '$monitor',
            day: { $dateToString: { format: '%Y-%m-%d', date: '$checkedAt', timezone: 'UTC' } },
          },
          total: { $sum: 1 },
          up: { $sum: { $cond: [{ $eq: ['$status', 'up'] }, 1, 0] } },
        },
      },
    ]);

    const dailyByMonitor = new Map();
    for (const row of dailyRaw) {
      const key = row._id.monitor.toString();
      if (!dailyByMonitor.has(key)) dailyByMonitor.set(key, {});
      dailyByMonitor.get(key)[row._id.day] = Number(((row.up / row.total) * 100).toFixed(1));
    }

    const incidents = await Incident.find({ monitor: { $in: monitorIds } })
      .sort({ startedAt: -1 })
      .limit(10)
      .select('monitor status startedAt resolvedAt durationSeconds cause');

    const services = page.monitors
      .filter((m) => m.monitor)
      .map((m) => ({
        id: m.monitor._id,
        label: m.displayName?.trim() || m.monitor.name,
        status: m.monitor.currentStatus,
        dailyUptime: dailyByMonitor.get(m.monitor._id.toString()) || {},
      }));

    const overallStatus = services.some((s) => s.status === 'down')
      ? 'outage'
      : services.some((s) => s.status === 'pending')
        ? 'degraded'
        : 'operational';

    res.json({
      title: page.title,
      description: page.description,
      updatedAt: new Date(),
      overallStatus,
      services,
      incidents: incidents.map((i) => ({
        monitor: i.monitor,
        status: i.status,
        startedAt: i.startedAt,
        resolvedAt: i.resolvedAt,
        durationSeconds: i.durationSeconds,
        cause: i.cause,
      })),
    });
  })
);

module.exports = router;
