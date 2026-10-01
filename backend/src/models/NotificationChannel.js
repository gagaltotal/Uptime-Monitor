const mongoose = require('mongoose');

const notificationChannelSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    type: { type: String, enum: ['discord', 'slack', 'telegram'], required: true },
    // Hidden by default — webhook URLs are effectively credentials
    // (whoever has them can post as this channel). Only required for
    // Discord/Slack channels; Telegram uses a bot token + chat ID instead.
    webhookUrl: {
      type: String,
      required() {
        return this.type === 'discord' || this.type === 'slack';
      },
      select: false,
    },
    // Hidden by default — the bot token grants full control of the bot.
    telegramBotToken: { type: String, select: false },
    telegramChatId: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('NotificationChannel', notificationChannelSchema);
