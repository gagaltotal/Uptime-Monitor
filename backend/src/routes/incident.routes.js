const express = require('express');
const Incident = require('../models/Incident');
const { protect } = require('../middleware/auth');
const { catchAsync } = require('../utils/helpers');

const router = express.Router();
router.use(protect);

// GET /api/incidents?status=ongoing|resolved&page=1&limit=20
router.get(
  '/',
  catchAsync(async (req, res) => {
    const filter = {};
    if (['ongoing', 'resolved'].includes(req.query.status)) {
      filter.status = req.query.status;
    }
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);

    const [incidents, total] = await Promise.all([
      Incident.find(filter)
        .sort({ startedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('monitor', 'name type url host port'),
      Incident.countDocuments(filter),
    ]);

    res.json({ incidents, total, page, pages: Math.ceil(total / limit) });
  })
);

// GET /api/incidents/report?from=ISO&to=ISO&status=ongoing|resolved
// Khusus untuk cetak laporan: tanpa pagination, hanya field yang dibutuhkan, dibatasi jumlahnya.
const REPORT_MAX_ROWS = 5000;
router.get(
  '/report',
  catchAsync(async (req, res) => {
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

    const incidents = await Incident.find(filter)
      .select('monitor status startedAt resolvedAt durationSeconds')
      .sort({ startedAt: 1 })
      .limit(REPORT_MAX_ROWS + 1)
      .populate('monitor', 'name type url host port')
      .lean();

    const truncated = incidents.length > REPORT_MAX_ROWS;
    if (truncated) incidents.pop();

    res.json({ incidents, total: incidents.length, truncated });
  })
);

module.exports = router;
