const express = require('express');
const NotificationChannel = require('../models/NotificationChannel');
const { protect } = require('../middleware/auth');
const { validate, validateObjectIdParam } = require('../validators/index');
const { ApiError, catchAsync } = require('../utils/helpers');
const { sendTestNotification } = require('../services/notifier');

const router = express.Router();
router.use(protect);

// Secret/field milik tipe channel tertentu. Dipakai untuk dua hal:
//   1. membersihkan payload saat tipe berubah (agar tidak ada sisa field),
//   2. mempertahankan kredensial lama ketika operator mengedit channel tapi
//      tidak mengetik ulang rahasianya (field rahasia dikirim kosong oleh UI).
const SECRET_FIELDS = {
  discord: ['webhookUrl'],
  slack: ['webhookUrl'],
  telegram: ['telegramBotToken'],
  email: ['smtpPassword'],
};

const TYPE_FIELDS = {
  discord: ['name', 'type', 'webhookUrl', 'isActive'],
  slack: ['name', 'type', 'webhookUrl', 'isActive'],
  telegram: ['name', 'type', 'telegramBotToken', 'telegramChatId', 'isActive'],
  email: [
    'name',
    'type',
    'smtpHost',
    'smtpPort',
    'smtpSecure',
    'smtpUser',
    'smtpPassword',
    'emailFrom',
    'emailTo',
    'isActive',
  ],
};

// Hapus field yang tidak relevan dengan tipe channel terpilih. Validator sudah
// membuang field asing lewat stripUnknown, tetapi pembersihan eksplisit ini
// membuat alur edit/ubah-tipe mudah dibaca dan tidak bergantung pada urutan.
function sanitizeChannelPayload(type, payload) {
  const allowed = new Set(TYPE_FIELDS[type] || ['name', 'type', 'isActive']);
  const clean = {};
  for (const [key, value] of Object.entries(payload)) {
    if (allowed.has(key)) clean[key] = value;
  }
  return clean;
}

// Menggabungkan kredensial dari dokumen lama ke payload baru untuk field
// rahasia yang dikosongkan (undefined/'' = jangan diubah). Dengan begitu
// tombol "Simpan" pada form edit tidak perlu memaksa operator mengetik ulang
// password SMTP / bot token / webhook — dan tidak berisiko menghapus rahasia
// hanya karena field dibiarkan kosong.
function mergeSecrets(type, payload, existing) {
  const merged = { ...payload };
  for (const field of SECRET_FIELDS[type] || []) {
    const isEmpty = merged[field] === undefined || merged[field] === '';
    if (isEmpty && existing && existing[field]) {
      merged[field] = existing[field];
    }
  }
  return merged;
}

// Mengisi ulang field rahasia dari dokumen lama SEBELUM validator berjalan.
//
// Validator menandai webhookUrl / telegramBotToken sebagai `required`. Form edit
// sengaja mengirim field rahasia kosong untuk berarti "jangan diubah" (nilainya
// tidak pernah dikirim balik ke browser), jadi tanpa prefill ini setiap edit
// channel Discord/Slack/Telegram akan gagal validasi. Karena itu salinan nilai
// lama ditempel ke req.body terlebih dahulu, baru divalidasi.
const loadExistingWithSecrets = catchAsync(async (req, res, next) => {
  const existing = await NotificationChannel.findById(req.params.id).select(
    '+webhookUrl +telegramBotToken +smtpPassword'
  );
  if (!existing) return next(new ApiError(404, 'Channel tidak ditemukan.'));
  req.existingChannel = existing;

  if (!req.body || typeof req.body !== 'object') return next();

  const secretFields = SECRET_FIELDS[req.body.type] || [];
  for (const field of secretFields) {
    const value = req.body[field];
    if ((value === undefined || value === '') && existing[field]) {
      req.body[field] = existing[field];
    }
  }
  next();
});

// Bentuk aman untuk dikirim ke klien: buang seluruh kredensial, dan ganti
// dengan flag boolean agar UI bisa menampilkan "sudah diatur" tanpa pernah
// menerima rahasianya.
function toSafeChannel(doc) {
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  const safe = {
    _id: obj._id,
    name: obj.name,
    type: obj.type,
    isActive: obj.isActive,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
  if (obj.type === 'telegram') safe.telegramChatId = obj.telegramChatId || '';
  if (obj.type === 'email') {
    safe.smtpHost = obj.smtpHost || '';
    safe.smtpPort = obj.smtpPort ?? 587;
    safe.smtpSecure = !!obj.smtpSecure;
    safe.smtpUser = obj.smtpUser || '';
    safe.emailFrom = obj.emailFrom || '';
    safe.emailTo = Array.isArray(obj.emailTo) ? obj.emailTo : [];
    safe.hasSmtpPassword = !!obj.smtpPassword;
  }
  if (obj.type === 'discord' || obj.type === 'slack') {
    safe.hasWebhookUrl = !!obj.webhookUrl;
  }
  if (obj.type === 'telegram') {
    safe.hasTelegramBotToken = !!obj.telegramBotToken;
  }
  return safe;
}

router.get(
  '/',
  catchAsync(async (req, res) => {
    // Kredensial tidak pernah dikirim balik ke browser — hanya flag
    // has* yang menandakan rahasianya sudah diisi.
    const docs = await NotificationChannel.find()
      .select('+webhookUrl +telegramBotToken +smtpPassword')
      .sort({ createdAt: -1 });
    res.json({ channels: docs.map(toSafeChannel) });
  })
);

router.post(
  '/',
  validate('notificationChannel'),
  catchAsync(async (req, res) => {
    const payload = sanitizeChannelPayload(req.body.type, req.body);
    const channel = await NotificationChannel.create({ ...payload, createdBy: req.user._id });
    const doc = await NotificationChannel.findById(channel._id).select(
      '+webhookUrl +telegramBotToken +smtpPassword'
    );
    res.status(201).json({ channel: toSafeChannel(doc) });
  })
);

router.put(
  '/:id',
  validateObjectIdParam(),
  loadExistingWithSecrets,
  validate('notificationChannel'),
  catchAsync(async (req, res) => {
    const existing = req.existingChannel;
    const clean = sanitizeChannelPayload(req.body.type, req.body);
    const merged = mergeSecrets(req.body.type, clean, existing.toObject());

    // $unset membersihkan field yang tidak lagi dipakai (mis. saat tipe
    // berubah dari email ke discord) supaya kredensial lama tidak tertinggal.
    const unset = {};
    for (const field of [
      'webhookUrl',
      'telegramBotToken',
      'telegramChatId',
      'smtpHost',
      'smtpPort',
      'smtpSecure',
      'smtpUser',
      'smtpPassword',
      'emailFrom',
      'emailTo',
    ]) {
      if (!(field in merged) && existing[field] !== undefined) unset[field] = '';
    }

    const updated = await NotificationChannel.findByIdAndUpdate(
      req.params.id,
      { $set: merged, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
      { new: true, runValidators: true }
    ).select('+webhookUrl +telegramBotToken +smtpPassword');

    res.json({ channel: toSafeChannel(updated) });
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
    // Editing form may submit unsaved credentials; when provided, test those
    // instead of the stored ones so an operator can validate before saving.
    const channel = await NotificationChannel.findById(req.params.id).select(
      '+webhookUrl +telegramBotToken +smtpPassword'
    );
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
