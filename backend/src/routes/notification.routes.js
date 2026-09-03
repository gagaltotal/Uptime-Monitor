const express = require('express');
const NotificationChannel = require('../models/NotificationChannel');
const { protect } = require('../middleware/auth');
const { validate, validateObjectIdParam } = require('../validators/index');
const { ApiError, catchAsync } = require('../utils/helpers');
const { sendTestNotification } = require('../services/notifier');

const router = express.Router();
router.use(protect);

router.get(
  '/',
  catchAsync(async (req, res) => {
    // webhookUrl deliberately excluded (select:false on the schema) — the
    // list view never needs to expose the raw secret back to the browser.
    const channels = await NotificationChannel.find().sort({ createdAt: -1 });
    res.json({ channels });
  })
);

router.post(
  '/',
  validate('notificationChannel'),
  catchAsync(async (req, res) => {
    const channel = await NotificationChannel.create({ ...req.body, createdBy: req.user._id });
    const { webhookUrl, ...safe } = channel.toObject();
    res.status(201).json({ channel: safe });
  })
);

router.put(
  '/:id',
  validateObjectIdParam(),
  validate('notificationChannel'),
  catchAsync(async (req, res) => {
    const channel = await NotificationChannel.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!channel) throw new ApiError(404, 'Channel tidak ditemukan.');
    res.json({ channel });
  })
);

router.delete(
  '/:id',
  validateObjectIdParam(),
  catchAsync(async (req, res) => {
    const channel = await NotificationChannel.findByIdAndDelete(req.params.id);
    if (!channel) throw new ApiError(404, 'Channel tidak ditemukan.');
    res.status(204).end();
  })
);

router.post(
  '/:id/test',
  validateObjectIdParam(),
  catchAsync(async (req, res) => {
    const channel = await NotificationChannel.findById(req.params.id).select('+webhookUrl');
    if (!channel) throw new ApiError(404, 'Channel tidak ditemukan.');
    try {
      await sendTestNotification(channel);
      res.json({ success: true, message: 'Notifikasi uji coba berhasil dikirim.' });
    } catch (err) {
      throw new ApiError(502, `Gagal mengirim notifikasi uji coba: ${err.message}`);
    }
  })
);

module.exports = router;
