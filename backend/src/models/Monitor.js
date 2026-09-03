const mongoose = require('mongoose');

const monitorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    type: { type: String, enum: ['http', 'tcp', 'ping'], required: true },

    // http
    url: { type: String, trim: true, maxlength: 2048 },
    method: { type: String, enum: ['GET', 'HEAD', 'POST'], default: 'GET' },
    expectedStatusCodes: {
      type: [Number],
      default: [200, 201, 202, 203, 204, 205, 206, 300, 301, 302, 303, 307, 308],
    },
    ignoreTlsErrors: { type: Boolean, default: false },

    // tcp / ping share "host"; tcp additionally needs "port"
    host: { type: String, trim: true, maxlength: 255 },
    port: { type: Number, min: 1, max: 65535 },

    interval: { type: Number, default: 60, min: 20, max: 86400 }, // seconds
    timeout: { type: Number, default: 10, min: 1, max: 60 }, // seconds
    retries: { type: Number, default: 1, min: 0, max: 5 },

    tags: { type: [String], default: [] },
    isActive: { type: Boolean, default: true }, // paused/resumed by the user
    notificationChannels: [
      { type: mongoose.Schema.Types.ObjectId, ref: 'NotificationChannel' },
    ],

    // --- cached/derived runtime state (kept in sync by the monitor engine) ---
    currentStatus: {
      type: String,
      enum: ['up', 'down', 'pending'],
      default: 'pending',
    },
    consecutiveFails: { type: Number, default: 0 },
    lastCheckAt: { type: Date },
    nextCheckAt: { type: Date, default: Date.now, index: true },
    lastResponseTime: { type: Number }, // ms
    lastMessage: { type: String, maxlength: 500 },

    sslCertExpiresAt: { type: Date },
    sslDaysRemaining: { type: Number },
    sslLastCheckedAt: { type: Date },
    sslLastWarnedAt: { type: Date },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

monitorSchema.index({ isActive: 1, nextCheckAt: 1 });

module.exports = mongoose.model('Monitor', monitorSchema);
