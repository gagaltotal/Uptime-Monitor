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

module.exports = router;
