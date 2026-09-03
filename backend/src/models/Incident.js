const mongoose = require('mongoose');

const incidentSchema = new mongoose.Schema(
  {
    monitor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Monitor',
      required: true,
      index: true,
    },
    status: { type: String, enum: ['ongoing', 'resolved'], default: 'ongoing', index: true },
    cause: { type: String, maxlength: 500 },
    startedAt: { type: Date, default: Date.now },
    resolvedAt: { type: Date },
    durationSeconds: { type: Number },
    notifiedDown: { type: Boolean, default: false },
    notifiedResolved: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Incident', incidentSchema);
