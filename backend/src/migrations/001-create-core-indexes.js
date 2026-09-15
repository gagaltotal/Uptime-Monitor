const User = require('../models/User');
const Monitor = require('../models/Monitor');
const Heartbeat = require('../models/Heartbeat');
const Incident = require('../models/Incident');
const StatusPage = require('../models/StatusPage');
const NotificationChannel = require('../models/NotificationChannel');
const logger = require('../utils/logger');

exports.description = 'Membangun seluruh index yang dideklarasikan pada skema';

// In production, config/db.js disables Mongoose autoIndex — building indexes
// implicitly on every boot is slow and can stall a large collection. This
// migration is the explicit, controlled place where indexes get created
// instead. syncIndexes() is idempotent: it creates what's missing and drops
// indexes no longer declared in the schema.
const MODELS = [User, Monitor, Heartbeat, Incident, StatusPage, NotificationChannel];

exports.up = async () => {
  for (const Model of MODELS) {
    await Model.syncIndexes();
    logger.debug(`  index disinkronkan: ${Model.collection.collectionName}`);
  }
};

// Intentionally a no-op. Dropping indexes on rollback would leave a live
// system with severely degraded queries for no real benefit — indexes are
// derived data, not schema state worth reversing.
exports.down = async () => {};
