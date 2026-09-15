const mongoose = require('mongoose');

// One document per migration that has been applied. The runner compares this
// collection against the files in src/migrations/ to decide what's pending,
// which is what makes `npm run migrate` safe to run repeatedly.
const migrationSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  appliedAt: { type: Date, default: Date.now },
  durationMs: { type: Number },
});

module.exports = mongoose.model('Migration', migrationSchema);
