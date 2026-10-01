const mongoose = require('mongoose');

const agentIncidentSchema = new mongoose.Schema(
  {
    agent: { type: mongoose.Schema.Types.ObjectId, ref: 'Agent', required: true, index: true },
    status: { type: String, enum: ['ongoing', 'resolved'], default: 'ongoing', index: true },
    type: {
      type: String,
      enum: ['disconnect', 'cpu', 'memory', 'disk', 'load', 'reported'],
      default: 'disconnect',
    },
    severity: { type: String, enum: ['warning', 'critical'], default: 'critical' },
    cause: { type: String, maxlength: 500 },
    startedAt: { type: Date, default: Date.now },
    resolvedAt: { type: Date },
    durationSeconds: { type: Number },
    notifiedDown: { type: Boolean, default: false },
    notifiedResolved: { type: Boolean, default: false },
  },
  { timestamps: true }
);

agentIncidentSchema.index({ agent: 1, startedAt: -1 });

module.exports = mongoose.model('AgentIncident', agentIncidentSchema);