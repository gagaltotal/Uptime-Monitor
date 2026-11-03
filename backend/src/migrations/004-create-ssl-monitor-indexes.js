const SslMonitor = require('../models/SslMonitor');
const SslIncident = require('../models/SslIncident');
const logger = require('../utils/logger');

exports.description = 'Membuat index untuk fitur pemantauan SSL & Domain (sslmonitors, sslincidents)';

// SslMonitor/SslIncident are new collections introduced with the SSL & Domain
// monitoring feature. In production, config/db.js disables autoIndex, so their
// indexes must be built here explicitly — otherwise the scheduler's
// { isActive, nextCheckAt } lookups and the incident history queries would run
// as full collection scans.
//
// syncIndexes() is idempotent (creates missing indexes, drops ones no longer
// declared), and does nothing harmful when the collections are empty, so this
// is safe to run on both fresh and existing databases.
const MODELS = [SslMonitor, SslIncident];

exports.up = async () => {
  for (const Model of MODELS) {
    await Model.syncIndexes();
    logger.debug(`  index disinkronkan: ${Model.collection.collectionName}`);
  }
};

// Intentionally a no-op: indexes are derived data, and dropping them on
// rollback would degrade a live system's queries for no real benefit.
exports.down = async () => {};
