const mongoose = require('mongoose');

const agentMetricSchema = new mongoose.Schema({
  agent: { type: mongoose.Schema.Types.ObjectId, ref: 'Agent', required: true, index: true },
  status: { type: String, enum: ['online', 'disconnected'], required: true },
  cpuPercent: { type: Number },
  memoryPercent: { type: Number },
  memoryUsedMb: { type: Number },
  memoryTotalMb: { type: Number },
  diskPercent: { type: Number },
  diskUsedGb: { type: Number },
  diskTotalGb: { type: Number },
  loadAverage: { type: [Number], default: undefined },
  uptimeSeconds: { type: Number },
  processCount: { type: Number },
  message: { type: String, maxlength: 500 },
  recordedAt: { type: Date, default: Date.now, index: true },
});

agentMetricSchema.index({ agent: 1, recordedAt: -1 });

module.exports = mongoose.model('AgentMetric', agentMetricSchema);