const express = require('express');
const Incident = require('../models/Incident');
const AgentIncident = require('../models/AgentIncident');
const Monitor = require('../models/Monitor');
const Agent = require('../models/Agent');
const { protect } = require('../middleware/auth');
const { catchAsync } = require('../utils/helpers');

const router = express.Router();
router.use(protect);

const SOURCES = ['monitors', 'agents'];

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// GET /api/incidents?source=monitors|agents&status=ongoing|resolved&q=&page=1&limit=20
router.get(
  '/',
  catchAsync(async (req, res) => {
    const source = SOURCES.includes(req.query.source) ? req.query.source : 'monitors';

    const filter = {};
    if (['ongoing', 'resolved'].includes(req.query.status)) {
      filter.status = req.query.status;
    }

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);

    // Pencarian bebas: nama target (monitor/agent), host/url, jenis, atau penyebab.
    const search = String(req.query.q || '').trim().slice(0, 100);
    const rx = search ? new RegExp(escapeRegex(search), 'i') : null;

    if (source === 'agents') {
      if (rx) {
        const agentIds = await Agent.find({
          $or: [{ name: rx }, { hostname: rx }, { ipAddress: rx }, { distro: rx }],
        })
          .select('_id')
          .lean();
        filter.$or = [
          { agent: { $in: agentIds.map((a) => a._id) } },
          { cause: rx },
          { type: rx },
        ];
      }

      const [incidents, total] = await Promise.all([
        AgentIncident.find(filter)
          .sort({ startedAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .populate('agent', 'name hostname ipAddress distro'),
        AgentIncident.countDocuments(filter),
      ]);

      return res.json({ source, incidents, total, page, pages: Math.ceil(total / limit) });
    }

    if (rx) {
      const monitorIds = await Monitor.find({
        $or: [{ name: rx }, { url: rx }, { host: rx }],
      })
        .select('_id')
        .lean();
      filter.$or = [
        { monitor: { $in: monitorIds.map((m) => m._id) } },
        { cause: rx },
      ];
    }

    const [incidents, total] = await Promise.all([
      Incident.find(filter)
        .sort({ startedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('monitor', 'name type url host port'),
      Incident.countDocuments(filter),
    ]);

    res.json({ source, incidents, total, page, pages: Math.ceil(total / limit) });
  })
);

// GET /api/incidents/report?from=ISO&to=ISO&status=ongoing|resolved&source=monitors|agents
// Khusus untuk cetak laporan: tanpa pagination, hanya field yang dibutuhkan, dibatasi jumlahnya.
const REPORT_MAX_ROWS = 5000;
const REPORT_SOURCES = ['monitors', 'agents'];
router.get(
  '/report',
  catchAsync(async (req, res) => {
    const source = REPORT_SOURCES.includes(req.query.source) ? req.query.source : 'monitors';

    const filter = {};
    if (['ongoing', 'resolved'].includes(req.query.status)) {
      filter.status = req.query.status;
    }

    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;
    if ((from && isNaN(from)) || (to && isNaN(to))) {
      return res.status(400).json({ message: 'Format periode tidak valid.' });
    }
    if (from || to) {
      filter.startedAt = {};
      if (from) filter.startedAt.$gte = from;
      if (to) filter.startedAt.$lt = to;
    }

    // Insiden agent (dari laporan agent: disconnect, CPU, memori, disk, service, dll).
    if (source === 'agents') {
      const incidents = await AgentIncident.find(filter)
        .select('agent type severity cause status startedAt resolvedAt durationSeconds')
        .sort({ startedAt: 1 })
        .limit(REPORT_MAX_ROWS + 1)
        .populate('agent', 'name hostname ipAddress distro')
        .lean();

      const truncated = incidents.length > REPORT_MAX_ROWS;
      if (truncated) incidents.pop();

      return res.json({ source, incidents, total: incidents.length, truncated });
    }

    const incidents = await Incident.find(filter)
      .select('monitor status startedAt resolvedAt durationSeconds')
      .sort({ startedAt: 1 })
      .limit(REPORT_MAX_ROWS + 1)
      .populate('monitor', 'name type url host port')
      .lean();

    const truncated = incidents.length > REPORT_MAX_ROWS;
    if (truncated) incidents.pop();

    res.json({ source, incidents, total: incidents.length, truncated });
  })
);

module.exports = router;
