const mongoose = require('mongoose');

// Tipe channel yang didukung. 'email' mengirim notifikasi lewat server SMTP
// (mis. Gmail, Mailgun, postfix internal, dsb) alih-alih webhook/bot.
const CHANNEL_TYPES = ['discord', 'slack', 'telegram', 'email'];

const notificationChannelSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    type: { type: String, enum: CHANNEL_TYPES, required: true },
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

    // --- Email / SMTP -----------------------------------------------------
    // Disimpan pada dokumen yang sama supaya satu channel = satu konfigurasi.
    // Field di bawah hanya dipakai saat type === 'email'; route menghapusnya
    // otomatis ketika sebuah channel diubah ke tipe lain.
    smtpHost: { type: String, trim: true },
    smtpPort: { type: Number, min: 1, max: 65535, default: 587 },
    // true = koneksi TLS implicit (biasanya port 465).
    // false = STARTTLS bila server mendukung (biasanya port 587).
    smtpSecure: { type: Boolean, default: false },
    smtpUser: { type: String, trim: true },
    // Hidden by default — sama seperti token bot, ini kredensial.
    smtpPassword: { type: String, select: false },
    // Opsional. Boleh alamat saja (ops@contoh.com) atau format lengkap
    // ("Uptime Monitor <ops@contoh.com>"). Bila kosong, diturunkan dari
    // smtpUser / smtpHost saat pengiriman.
    emailFrom: { type: String, trim: true },
    // Daftar penerima. Selalu array agar bentuk datanya konsisten; input
    // berupa string dipisah otomatis di validator.
    emailTo: { type: [String], default: undefined },

    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

// Dipakai sebagai pengaman: hanya channel bertipe email yang boleh menyimpan
// kredensial SMTP, supaya secret tidak "tertinggal" saat tipe channel diubah.
notificationChannelSchema.methods.isEmail = function isEmail() {
  return this.type === 'email';
};

module.exports = mongoose.model('NotificationChannel', notificationChannelSchema);
