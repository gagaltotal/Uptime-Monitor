const Joi = require('joi');
const { ApiError } = require('../utils/helpers');

// Every write endpoint validates against one of these schemas *before*
// touching the database. Joi's type-checking is itself an effective
// NoSQL-injection guard: a field declared Joi.string() rejects an object
// payload like {"$gt": ""} outright, which is the classic MongoDB
// login-bypass trick. `stripUnknown: true` (see `validate` below) also
// blocks mass-assignment of fields the client shouldn't be able to set
// (role, tokenVersion, currentStatus, etc. are never in these schemas).

const password = Joi.string().min(8).max(128).required().messages({
  'string.min': 'Kata sandi minimal 8 karakter.',
});

const objectId = Joi.string().hex().length(24);

// Alamat email untuk penerima notifikasi. Dibatasi 254 karakter (RFC 5321)
// dan menolak karakter kontrol agar tidak bisa dipakai untuk header
// injection pada email yang dikirim lewat SMTP.
const emailAddress = Joi.string()
  .trim()
  .email({ tlds: { allow: false } })
  .max(254)
  .pattern(/^[^\r\n]+$/);

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];

  const seen = new Set();
  const result = [];
  for (const tag of tags) {
    const value = String(tag ?? '').trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value.slice(0, 40));
    if (result.length >= 20) break;
  }
  return result;
}

const schemas = {
  setup: Joi.object({
    name: Joi.string().trim().min(2).max(100).required(),
    email: Joi.string().trim().lowercase().email().max(254).required(),
    password,
  }),

  login: Joi.object({
    email: Joi.string().trim().lowercase().email().max(254).required(),
    password: Joi.string().min(1).max(128).required(),
  }),

  // Role/status pengguna. `role` menentukan hak akses (superadmin = penuh,
  // admin = tanpa manajemen pengguna), `isActive` menentukan apakah akun bisa
  // login. Keduanya hanya boleh diubah lewat endpoint manajemen pengguna yang
  // dijaga requireSuperAdmin — bukan lewat /auth/profile (schema updateProfile
  // di bawah hanya menerima `name`, jadi percobaan mengirim role dari profil
  // sendiri otomatis dibuang oleh stripUnknown).
  createUser: Joi.object({
    name: Joi.string().trim().min(2).max(100).required(),
    email: Joi.string().trim().lowercase().email().max(254).required(),
    password,
    role: Joi.string().valid('superadmin', 'admin').default('admin'),
    isActive: Joi.boolean().default(true),
  }),

  // Semua field opsional, tetapi minimal satu harus diisi agar PATCH kosong
  // tidak lolos tanpa efek.
  updateUser: Joi.object({
    name: Joi.string().trim().min(2).max(100),
    email: Joi.string().trim().lowercase().email().max(254),
    password: Joi.string().min(8).max(128).messages({
      'string.min': 'Kata sandi minimal 8 karakter.',
    }),
    role: Joi.string().valid('superadmin', 'admin'),
    isActive: Joi.boolean(),
  }).min(1),

  changePassword: Joi.object({
    currentPassword: Joi.string().min(1).max(128).required(),
    newPassword: password,
  }),

  updateProfile: Joi.object({
    name: Joi.string().trim().min(2).max(100).required(),
  }),

  monitor: Joi.object({
    name: Joi.string().trim().min(1).max(200).required(),
    type: Joi.string().valid('http', 'tcp', 'ping').required(),

    url: Joi.when('type', {
      is: 'http',
      then: Joi.string()
        .trim()
        .max(2048)
        .uri({ scheme: ['http', 'https'] })
        .required(),
      otherwise: Joi.forbidden(),
    }),
    method: Joi.when('type', {
      is: 'http',
      then: Joi.string().valid('GET', 'HEAD', 'POST').default('GET'),
      otherwise: Joi.forbidden(),
    }),
    expectedStatusCodes: Joi.when('type', {
      is: 'http',
      then: Joi.array().items(Joi.number().integer().min(100).max(599)).min(1),
      otherwise: Joi.forbidden(),
    }),
    ignoreTlsErrors: Joi.when('type', {
      is: 'http',
      then: Joi.boolean().default(false),
      otherwise: Joi.forbidden(),
    }),

    host: Joi.when('type', {
      is: Joi.valid('tcp', 'ping'),
      then: Joi.alternatives()
        .try(Joi.string().hostname(), Joi.string().ip())
        .required(),
      otherwise: Joi.forbidden(),
    }),
    port: Joi.when('type', {
      is: 'tcp',
      then: Joi.number().integer().min(1).max(65535).required(),
      otherwise: Joi.forbidden(),
    }),

    interval: Joi.number().integer().min(20).max(86400).default(60),
    timeout: Joi.number().integer().min(1).max(60).default(10),
    retries: Joi.number().integer().min(0).max(5).default(1),
    tags: Joi.array().items(Joi.string().trim().max(40).allow('')).max(20).default([]),
    isActive: Joi.boolean().default(true),
    notificationChannels: Joi.array().items(objectId).default([]),
  }),

  // SSL & Domain monitor. `domain` accepts a bare hostname, a host:port
  // pair, or a full URL; the route normalizes it to a hostname before save
  // (see helpers.normalizeDomain), so here we only bound its length and
  // reject control characters.
  sslMonitor: Joi.object({
    name: Joi.string().trim().min(1).max(200).required(),
    domain: Joi.string()
      .trim()
      .min(1)
      .max(255)
      .pattern(/^[^\s]+$/)
      .required()
      .messages({
        'string.pattern.base': 'Domain tidak boleh mengandung spasi.',
      }),
    port: Joi.number().integer().min(1).max(65535).default(443),
    interval: Joi.number().integer().min(60).max(604800).default(21600),
    timeout: Joi.number().integer().min(1).max(60).default(10),
    retries: Joi.number().integer().min(0).max(5).default(1),
    alertThresholdDays: Joi.number().integer().min(1).max(365).default(14),
    tags: Joi.array().items(Joi.string().trim().max(40).allow('')).max(20).default([]),
    isActive: Joi.boolean().default(true),
    notificationChannels: Joi.array().items(objectId).default([]),
  }),

  notificationChannel: Joi.object({
    name: Joi.string().trim().min(1).max(100).required(),
    type: Joi.string().valid('discord', 'slack', 'telegram', 'email').required(),
    // Discord/Slack require a webhook URL; Telegram uses a bot token + chat
    // ID; Email uses an SMTP server. Field milik tipe lain otomatis ditolak
    // (forbidden) supaya tidak ada kredensial "nyangkut" saat tipe diubah.
    webhookUrl: Joi.when('type', {
      is: 'discord',
      then: Joi.string()
        .uri({ scheme: ['https'] })
        .pattern(/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//)
        .required()
        .messages({ 'string.pattern.base': 'URL webhook Discord tidak valid.' }),
      otherwise: Joi.when('type', {
        is: 'slack',
        then: Joi.string()
          .uri({ scheme: ['https'] })
          .pattern(/^https:\/\/hooks\.slack\.com\/services\//)
          .required()
          .messages({ 'string.pattern.base': 'URL webhook Slack tidak valid.' }),
        otherwise: Joi.forbidden(),
      }),
    }),
    telegramBotToken: Joi.when('type', {
      is: 'telegram',
      then: Joi.string()
        .trim()
        .required()
        .messages({ 'any.required': 'Bot token Telegram wajib diisi.' }),
      otherwise: Joi.forbidden(),
    }),
    telegramChatId: Joi.when('type', {
      is: 'telegram',
      then: Joi.string()
        .trim()
        .required()
        .messages({ 'any.required': 'Chat ID Telegram wajib diisi.' }),
      otherwise: Joi.forbidden(),
    }),

    // --- Email / SMTP ---
    smtpHost: Joi.when('type', {
      is: 'email',
      then: Joi.alternatives()
        .try(Joi.string().hostname(), Joi.string().ip())
        .required()
        .messages({ 'any.required': 'Host SMTP wajib diisi.' }),
      otherwise: Joi.forbidden(),
    }),
    // 587 = STARTTLS (umum), 465 = TLS langsung, 25 = relay internal.
    smtpPort: Joi.when('type', {
      is: 'email',
      then: Joi.number().integer().min(1).max(65535).default(587),
      otherwise: Joi.forbidden(),
    }),
    smtpSecure: Joi.when('type', {
      is: 'email',
      then: Joi.boolean().default(false),
      otherwise: Joi.forbidden(),
    }),
    // Kosong = server SMTP tanpa autentikasi (mis. relay internal).
    smtpUser: Joi.when('type', {
      is: 'email',
      then: Joi.string().trim().max(254).allow(''),
      otherwise: Joi.forbidden(),
    }),
    smtpPassword: Joi.when('type', {
      is: 'email',
      then: Joi.string().max(256).allow(''),
      otherwise: Joi.forbidden(),
    }),
    // Opsional; boleh "ops@contoh.com" atau "Nama <ops@contoh.com>".
    emailFrom: Joi.when('type', {
      is: 'email',
      then: Joi.string().trim().max(254).allow(''),
      otherwise: Joi.forbidden(),
    }),
    // Penerima boleh dikirim sebagai array email atau satu string yang
    // dipisah koma/titik-koma/spasi; keduanya dinormalkan menjadi array.
    emailTo: Joi.when('type', {
      is: 'email',
      then: Joi.alternatives()
        .try(
          Joi.array().items(emailAddress).min(1).max(50),
          Joi.string()
            .trim()
            .min(1)
            .max(2000)
            .custom((value, helpers) => {
              const list = value
                .split(/[,;\s]+/)
                .map((s) => s.trim())
                .filter(Boolean);
              if (list.length === 0) return helpers.error('any.invalid');
              for (const addr of list) {
                if (emailAddress.validate(addr).error) return helpers.error('any.invalid');
              }
              return list.slice(0, 50);
            }, 'daftar email')
        )
        .required()
        .messages({
          'any.required': 'Minimal satu alamat email penerima wajib diisi.',
          'any.invalid': 'Ada alamat email penerima yang tidak valid.',
        }),
      otherwise: Joi.forbidden(),
    }),

    isActive: Joi.boolean().default(true),
  }),

  statusPage: Joi.object({
    slug: Joi.string()
      .trim()
      .lowercase()
      .pattern(/^[a-z0-9-]{3,80}$/)
      .required()
      .messages({ 'string.pattern.base': 'Slug hanya boleh huruf kecil, angka, dan tanda hubung (3-80 karakter).' }),
    title: Joi.string().trim().min(1).max(150).required(),
    description: Joi.string().trim().max(1000).allow('').default(''),
    isPublished: Joi.boolean().default(true),
    monitors: Joi.array()
      .items(
        Joi.object({
          monitor: objectId.required(),
          displayName: Joi.string().trim().max(150).allow('').optional(),
        })
      )
      .default([]),
  }),

  // Admin-managed Agent records. The token itself is generated server-side
  // (Agent.generateToken) and never accepted from the client.
  agent: Joi.object({
    name: Joi.string().trim().min(1).max(200).required(),
    description: Joi.string().trim().max(500).allow('').default(''),
    hostname: Joi.string().trim().max(255).allow('').default(''),
    distro: Joi.string().trim().max(120).allow('').default(''),
    distroVersion: Joi.string().trim().max(120).allow('').default(''),
    kernel: Joi.string().trim().max(200).allow('').default(''),
    arch: Joi.string().trim().max(40).allow('').default(''),
    ipAddress: Joi.string().trim().max(64).allow('').default(''),
    tags: Joi.array().items(Joi.string().trim().max(40).allow('')).max(20).default([]),
    interval: Joi.number().integer().min(10).max(86400).default(60),
    isActive: Joi.boolean().default(true),
    notificationChannels: Joi.array().items(objectId).default([]),
  }),

  // Payload the bash agent POSTs on every collection cycle. Kept permissive
  // (metrics optional) so a lightweight agent can report only what it can
  // gather on a given distro without failing validation.
  agentReport: Joi.object({
    metrics: Joi.object({
      cpuPercent: Joi.number().min(0).max(100),
      memoryPercent: Joi.number().min(0).max(100),
      memoryUsedMb: Joi.number().min(0),
      memoryTotalMb: Joi.number().min(0),
      diskPercent: Joi.number().min(0).max(100),
      diskUsedGb: Joi.number().min(0),
      diskTotalGb: Joi.number().min(0),
      loadAverage: Joi.array().items(Joi.number().min(0)).max(3),
      uptimeSeconds: Joi.number().min(0),
      processCount: Joi.number().integer().min(0),
    }).default({}),
    hardware: Joi.object({
      cpuModel: Joi.string().trim().max(200).allow(''),
      cpuCores: Joi.number().integer().min(1),
      memoryTotalMb: Joi.number().min(0),
      diskTotalGb: Joi.number().min(0),
      storage: Joi.array().items(
        Joi.object({
          name: Joi.string().trim().max(120).allow(''),
          type: Joi.string().trim().max(40).allow(''),
          size: Joi.string().trim().max(80).allow(''),
        })
      ).default([]),
    }).default({}),
    osInfo: Joi.object().unknown(true),
    // Daftar service yang berstatus gagal di host (systemd / OpenRC).
    services: Joi.object({
      source: Joi.string().valid('systemd', 'openrc', 'none').default('none'),
      failed: Joi.array()
        .items(
          Joi.object({
            name: Joi.string().trim().max(200).required(),
            state: Joi.string().trim().max(40).allow('').default(''),
            description: Joi.string().trim().max(300).allow('').default(''),
          })
        )
        .max(200)
        .default([]),
    }),
    message: Joi.string().trim().max(500).allow(''),
  }),

  // Payload the bash agent POSTs to stream an application/system log line.
  agentLog: Joi.object({
    level: Joi.string().valid('debug', 'info', 'warn', 'error').default('info'),
    source: Joi.string().trim().max(120).allow(''),
    message: Joi.string().trim().max(2000).required(),
    loggedAt: Joi.date().iso(),
  }),
};

// stripUnknown removes any field not declared in the schema — this is the
// mass-assignment guard: a crafted body like { role: 'superadmin' } on a
// profile-update request is silently dropped rather than validated against.
function validate(schemaName) {
  const schema = schemas[schemaName];
  if (!schema) throw new Error(`Skema validasi "${schemaName}" tidak ditemukan`);
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });
    if (error) {
      const message = error.details.map((d) => d.message).join('; ');
      return next(new ApiError(400, message));
    }
    req.body = value;
    if (Array.isArray(req.body.tags)) {
      req.body.tags = normalizeTags(req.body.tags);
    }
    next();
  };
}

// Validates :id-style route params are well-formed Mongo ObjectIds before
// they ever reach a query — an invalid shape here would otherwise surface
// as a raw Mongoose CastError.
function validateObjectIdParam(paramName = 'id') {
  return (req, res, next) => {
    const { error } = objectId.validate(req.params[paramName]);
    if (error) return next(new ApiError(400, `${paramName} tidak valid.`));
    next();
  };
}

module.exports = { validate, validateObjectIdParam };
