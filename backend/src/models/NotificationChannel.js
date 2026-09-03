const mongoose = require('mongoose');

const notificationChannelSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    type: { type: String, enum: ['discord', 'slack'], required: true },
    // Hidden by default — webhook URLs are effectively credentials
    // (whoever has them can post as this channel).
    webhookUrl: { type: String, required: true, select: false },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('NotificationChannel', notificationChannelSchema);
