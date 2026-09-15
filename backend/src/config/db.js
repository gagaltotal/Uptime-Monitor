const mongoose = require('mongoose');
const { env } = require('./env');
const logger = require('../utils/logger');

// Mongoose + schema-typed queries are the primary defense against NoSQL
// injection: user input is always matched against a declared field type
// instead of being interpolated into a raw query object. See middleware/security.js
// for the additional express-mongo-sanitize layer applied to all requests.
mongoose.set('strictQuery', true);

async function connectDB() {
  mongoose.connection.on('connected', () => logger.info('MongoDB connected'));
  mongoose.connection.on('error', (err) => logger.error('MongoDB connection error', err));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));

  await mongoose.connect(env.MONGO_URI, {
    serverSelectionTimeoutMS: 10000,
    // In production, indexes are built deliberately by migration
    // 001-create-core-indexes rather than implicitly on every boot — implicit
    // index builds can stall startup once collections grow large. In dev,
    // autoIndex stays on for convenience.
    autoIndex: env.NODE_ENV !== 'production',
  });
}

async function disconnectDB() {
  await mongoose.connection.close();
}

module.exports = { connectDB, disconnectDB };
