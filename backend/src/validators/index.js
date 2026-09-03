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

  createUser: Joi.object({
    name: Joi.string().trim().min(2).max(100).required(),
    email: Joi.string().trim().lowercase().email().max(254).required(),
    password,
  }),

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
    tags: Joi.array().items(Joi.string().trim().max(40)).max(20).default([]),
    isActive: Joi.boolean().default(true),
    notificationChannels: Joi.array().items(objectId).default([]),
  }),

  notificationChannel: Joi.object({
    name: Joi.string().trim().min(1).max(100).required(),
    type: Joi.string().valid('discord', 'slack').required(),
    webhookUrl: Joi.when('type', {
      is: 'discord',
      then: Joi.string()
        .uri({ scheme: ['https'] })
        .pattern(/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//)
        .required()
        .messages({ 'string.pattern.base': 'URL webhook Discord tidak valid.' }),
      otherwise: Joi.string()
        .uri({ scheme: ['https'] })
        .pattern(/^https:\/\/hooks\.slack\.com\/services\//)
        .required()
        .messages({ 'string.pattern.base': 'URL webhook Slack tidak valid.' }),
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
