const mongoose = require('mongoose');

// Advisory lock so that two backend containers booting at the same time can't
// both run the same pending migration. Acquisition is an insert on a fixed
// _id: whoever wins the unique-index race owns the lock, the other waits or
// aborts. Includes a staleness timeout so a crashed process can't deadlock
// every future boot.
const migrationLockSchema = new mongoose.Schema({
  _id: { type: String, default: 'migrations' },
  owner: { type: String, required: true },
  acquiredAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('MigrationLock', migrationLockSchema);
