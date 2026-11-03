const mongoose = require('mongoose');

// A standalone SSL/Domain monitor. Deliberately separate from `Monitor`
// (http/tcp/ping): an SSL monitor watches a certificate on a host:port and
// has its own lifecycle (expiry countdown, issuer, days-left) that does not
// map cleanly onto an uptime check. Keeping it separate also lets an
// operator watch a domain's certificate without also running an HTTP check
// against it.
const sslMonitorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },

    // The concrete hostname (or IP) the TLS handshake is performed against.
    // Stored lowercase, without scheme/path/port (see helpers.normalizeDomain).
    domain: { type: String, required: true, trim: true, lowercase: true, maxlength: 255 },
    port: { type: Number, default: 443, min: 1, max: 65535 },

    // Certificate checks are cheap but certificates change slowly, so the
    // default cadence is far less frequent than an uptime check.
    interval: { type: Number, default: 21600, min: 60, max: 604800 }, // seconds (6h default)
    timeout: { type: Number, default: 10, min: 1, max: 60 }, // seconds
    retries: { type: Number, default: 1, min: 0, max: 5 },

    // Warn (and raise an incident) once the certificate has this many days
    // or fewer left before expiry.
    alertThresholdDays: { type: Number, default: 14, min: 1, max: 365 },

    tags: { type: [String], default: [] },
    isActive: { type: Boolean, default: true },
    notificationChannels: [
      { type: mongoose.Schema.Types.ObjectId, ref: 'NotificationChannel' },
    ],

    // --- cached/derived runtime state (kept in sync by the SSL engine) ---
    status: {
      type: String,
      enum: ['pending', 'valid', 'expiring', 'expired', 'error'],
      default: 'pending',
    },
    issuer: { type: String, maxlength: 300 },
    subject: { type: String, maxlength: 300 },
    serialNumber: { type: String, maxlength: 120 },
    validFrom: { type: Date },
    expiresAt: { type: Date },
    daysRemaining: { type: Number },
    lastCheckedAt: { type: Date },
    lastNotifiedAt: { type: Date }, // "Last Notified" — last alert sent for this certificate
    lastMessage: { type: String, maxlength: 500 },
    consecutiveFails: { type: Number, default: 0 },
    nextCheckAt: { type: Date, default: Date.now, index: true },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

sslMonitorSchema.index({ isActive: 1, nextCheckAt: 1 });
sslMonitorSchema.index({ status: 1 });

module.exports = mongoose.model('SslMonitor', sslMonitorSchema);
