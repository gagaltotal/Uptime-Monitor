const express = require('express');
const StatusPage = require('../models/StatusPage');
const { protect } = require('../middleware/auth');
const { validate, validateObjectIdParam } = require('../validators/index');
const { ApiError, catchAsync } = require('../utils/helpers');

const router = express.Router();
router.use(protect);

router.get(
  '/',
  catchAsync(async (req, res) => {
    const pages = await StatusPage.find().sort({ createdAt: -1 }).populate('monitors.monitor', 'name type');
    res.json({ statusPages: pages });
  })
);

router.get(
  '/:id',
  validateObjectIdParam(),
  catchAsync(async (req, res) => {
    const page = await StatusPage.findById(req.params.id).populate('monitors.monitor', 'name type currentStatus');
    if (!page) throw new ApiError(404, 'Halaman status tidak ditemukan.');
    res.json({ statusPage: page });
  })
);

router.post(
  '/',
  validate('statusPage'),
  catchAsync(async (req, res) => {
    const existing = await StatusPage.findOne({ slug: req.body.slug });
    if (existing) throw new ApiError(409, 'Slug sudah digunakan, pilih yang lain.');
    const page = await StatusPage.create({ ...req.body, createdBy: req.user._id });
    res.status(201).json({ statusPage: page });
  })
);

router.put(
  '/:id',
  validateObjectIdParam(),
  validate('statusPage'),
  catchAsync(async (req, res) => {
    const existing = await StatusPage.findOne({ slug: req.body.slug, _id: { $ne: req.params.id } });
    if (existing) throw new ApiError(409, 'Slug sudah digunakan, pilih yang lain.');
    const page = await StatusPage.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!page) throw new ApiError(404, 'Halaman status tidak ditemukan.');
    res.json({ statusPage: page });
  })
);

router.delete(
  '/:id',
  validateObjectIdParam(),
  catchAsync(async (req, res) => {
    const page = await StatusPage.findByIdAndDelete(req.params.id);
    if (!page) throw new ApiError(404, 'Halaman status tidak ditemukan.');
    res.status(204).end();
  })
);

module.exports = router;
