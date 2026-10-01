const mongoose = require('mongoose');

const agentLogSchema = new mongoose.Schema({
  agent: { type: mongoose.Schema.Types.ObjectId, ref: 'Agent', required: true, index: true },
  level: {
    type: String,
    enum: ['debug', 'info', 'warn', 'error'],
    default: 'info',
    index: true,
  },
  source: { type: String, trim: true, maxlength: 120 },
  message: { type: String, required: true, maxlength: 2000 },
  meta: { type: mongoose.Schema.Types.Mixed },
  loggedAt: { type: Date, default: Date.now, index: true },
});

agentLogSchema.index({ agent: 1, loggedAt: -1 });
agentLogSchema.index({ agent: 1, level: 1, loggedAt: -1 });

module.exports = mongoose.model('AgentLog', agentLogSchema);