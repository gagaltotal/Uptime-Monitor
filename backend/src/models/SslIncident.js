const mongoose = require('mongoose');

// Incident history for SSL/Domain monitors. Mirrors the shape of the other
// incident models (Monitor Incident / AgentIncident) so the same UI and
// reporting code can render it without special-casing the data structure.
const sslIncidentSchema = new mongoose.Schema(
  {
    sslMonitor: { type: mongoose.Schema.Types.ObjectId, ref: 'SslMonitor', required: true, index: true },
    status: { type: String, enum: ['ongoing', 'resolved'], default: 'ongoing', index: true },
    // expiring → certificate is within the warn window but not yet expired
    // expired  → certificate validity window has passed
    // error    → the certificate could not be read (DNS/TLS/connection failure)
    type: { type: String, enum: ['expiring', 'expired', 'error'], default: 'expiring' },
    severity: { type: String, enum: ['warning', 'critical'], default: 'warning' },
    cause: { type: String, maxlength: 500 },
    startedAt: { type: Date, default: Date.now },
    resolvedAt: { type: Date },
    durationSeconds: { type: Number },
    notifiedDown: { type: Boolean, default: false },
    notifiedResolved: { type: Boolean, default: false },
  },
  { timestamps: true }
);

sslIncidentSchema.index({ sslMonitor: 1, startedAt: -1 });

module.exports = mongoose.model('SslIncident', sslIncidentSchema);
