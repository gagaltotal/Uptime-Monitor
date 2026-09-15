const mongoose = require('mongoose');
const logger = require('../utils/logger');

exports.description = 'Mengisi field penjadwalan monitor yang kosong (nextCheckAt, status, dll.)';

// The monitor engine selects work with { isActive: true, nextCheckAt: $lte: now }.
// A monitor missing nextCheckAt therefore never matches and is silently never
// checked — a monitoring tool failing quietly is the worst possible failure
// mode, so this backfills any document lacking the scheduling fields.
exports.up = async () => {
  const monitors = mongoose.connection.collection('monitors');
  const now = new Date();

  const scheduling = await monitors.updateMany(
    { $or: [{ nextCheckAt: { $exists: false } }, { nextCheckAt: null }] },
    { $set: { nextCheckAt: now } }
  );

  const status = await monitors.updateMany(
    { $or: [{ currentStatus: { $exists: false } }, { currentStatus: null }] },
    { $set: { currentStatus: 'pending' } }
  );

  const fails = await monitors.updateMany(
    { $or: [{ consecutiveFails: { $exists: false } }, { consecutiveFails: null }] },
    { $set: { consecutiveFails: 0 } }
  );

  const active = await monitors.updateMany(
    { isActive: { $exists: false } },
    { $set: { isActive: true } }
  );

  const total =
    scheduling.modifiedCount + status.modifiedCount + fails.modifiedCount + active.modifiedCount;
  if (total > 0) {
    logger.info(
      `  Backfill monitor: nextCheckAt=${scheduling.modifiedCount}, ` +
        `currentStatus=${status.modifiedCount}, consecutiveFails=${fails.modifiedCount}, ` +
        `isActive=${active.modifiedCount}`
    );
  }
};

// Removing these fields again would break the scheduler outright, so rollback
// deliberately leaves the backfilled defaults in place.
exports.down = async () => {};
