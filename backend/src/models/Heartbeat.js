const mongoose = require('mongoose');

const heartbeatSchema = new mongoose.Schema({
  monitor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Monitor',
    required: true,
    index: true,
  },
  status: { type: String, enum: ['up', 'down'], required: true },
  responseTime: { type: Number }, // ms, null when the check couldn't complete
  statusCode: { type: Number },
  message: { type: String, maxlength: 500 },
  checkedAt: { type: Date, default: Date.now, index: true },
});

// Composite index: the app's most frequent query is "history for monitor X,
// most recent first" — this index serves it directly without a sort scan.
heartbeatSchema.index({ monitor: 1, checkedAt: -1 });

module.exports = mongoose.model('Heartbeat', heartbeatSchema);
