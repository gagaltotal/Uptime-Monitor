const crypto = require('crypto');
const mongoose = require('mongoose');

const agentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 500 },
    hostname: { type: String, trim: true, maxlength: 255 },
    distro: { type: String, trim: true, maxlength: 120 },
    distroVersion: { type: String, trim: true, maxlength: 120 },
    kernel: { type: String, trim: true, maxlength: 200 },
    arch: { type: String, trim: true, maxlength: 40 },
    ipAddress: { type: String, trim: true, maxlength: 64 },
    tags: { type: [String], default: [] },

    // Kredensial unik per agent. Disimpan ter-hash dan tidak pernah dikembalikan.
    tokenHash: { type: String, required: true, select: false, index: true },
    tokenPreview: { type: String, maxlength: 24 },

    // Interval pelaporan yang diminta (detik) — hanya informasional bagi dashboard.
    interval: { type: Number, default: 60, min: 10, max: 86400 },

    isActive: { type: Boolean, default: true },

    notificationChannels: [
      { type: mongoose.Schema.Types.ObjectId, ref: 'NotificationChannel' },
    ],

    currentStatus: {
      type: String,
      enum: ['online', 'disconnected'],
      default: 'disconnected',
    },
    consecutiveMissed: { type: Number, default: 0 },

    lastSeenAt: { type: Date },
    lastReportedAt: { type: Date },

    // Snapshot metrik terakhir (loopback cepat untuk list/detail).
    currentMetrics: {
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
    },

    os_info: { type: mongoose.Schema.Types.Mixed },

    // Snapshot status service dari laporan terakhir (hanya service yang gagal).
    currentServices: {
      source: { type: String, enum: ['systemd', 'openrc', 'none'], default: 'none' },
      checkedAt: { type: Date },
      failed: {
        type: [
          new mongoose.Schema(
            {
              name: { type: String, maxlength: 200 },
              state: { type: String, maxlength: 40 },
              description: { type: String, maxlength: 300 },
            },
            { _id: false }
          ),
        ],
        default: [],
      },
    },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

agentSchema.index({ isActive: 1, currentStatus: 1 });
agentSchema.index({ lastSeenAt: -1 });

agentSchema.methods.matchesToken = function matchesToken(token) {
  if (!this.tokenHash || !token) return false;
  const incoming = crypto.createHash('sha256').update(String(token)).digest();
  const stored = Buffer.from(this.tokenHash, 'hex');
  if (stored.length !== incoming.length) return false;
  return crypto.timingSafeEqual(stored, incoming);
};

agentSchema.statics.hashToken = function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
};

agentSchema.statics.generateToken = function generateToken() {
  return `agt_${crypto.randomBytes(24).toString('hex')}`;
};

module.exports = mongoose.model('Agent', agentSchema);