const express = require('express');
const morgan = require('morgan');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const { env } = require('./config/env');
const logger = require('./utils/logger');
const {
  helmetMiddleware,
  corsMiddleware,
  apiLimiter,
  mongoSanitizeMiddleware,
  hppMiddleware,
} = require('./middleware/security');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const routes = require('./routes/index');

const app = express();

// Needed so req.ip / express-rate-limit read the real client IP from
// X-Forwarded-For when running behind the bundled nginx reverse proxy.
if (env.TRUST_PROXY) app.set('trust proxy', 1);

app.use(helmetMiddleware);
app.use(corsMiddleware);
app.use(compression());

if (env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));
}

app.use(cookieParser());

// JSON only, with a small size cap. We never mount express.urlencoded()/
// multer anywhere in this app: a classic cross-site <form> POST (the basis
// of most CSRF attacks) submits as x-www-form-urlencoded/multipart, which
// this server never parses into req.body — such a request arrives with an
// effectively empty body and fails Joi validation before it can do anything.
app.use(express.json({ limit: '100kb' }));

// NoSQL-injection hardening — strips $ / . operators from user input.
app.use(mongoSanitizeMiddleware);
app.use(hppMiddleware);

app.use('/api', apiLimiter);
app.use('/api', routes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
