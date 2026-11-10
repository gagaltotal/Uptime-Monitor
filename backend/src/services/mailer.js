// Pengiriman email lewat SMTP.
//
// Dipisahkan dari notifier.js supaya logika transport SMTP hanya hidup di satu
// tempat (dan bisa diuji terpisah). nodemailer membuat koneksi baru per
// pengiriman bila kita tidak memakai pool, sehingga tidak ada koneksi menganggur
// yang perlu ditutup saat channel diedit/dihapus.
const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

const SMTP_TIMEOUT_MS = 10000;

// Normalisasi alamat "From": terima "ops@contoh.com" maupun
// "Uptime Monitor <ops@contoh.com>". Bila kosong, pakai user SMTP lalu host
// sebagai fallback yang tetap terlihat wajar di inbox penerima.
function resolveFrom(channel) {
  const explicit = (channel.emailFrom || '').trim();
  if (explicit) return explicit;
  if (channel.smtpUser) return channel.smtpUser;
  return `uptime-monitor@${channel.smtpHost || 'localhost'}`;
}

// Daftar penerima dirapikan dan dibatasi agar tidak ada header injection
// lewat newline (dibuang oleh validator juga, ini lapisan kedua).
function resolveRecipients(channel) {
  const raw = Array.isArray(channel.emailTo) ? channel.emailTo : [];
  return raw
    .map((addr) => String(addr || '').trim())
    .filter((addr) => addr && !/[\r\n]/.test(addr));
}

function buildTransport(channel) {
  if (!channel.smtpHost) {
    throw new Error('Host SMTP belum diisi untuk channel email ini.');
  }
  return nodemailer.createTransport({
    host: channel.smtpHost,
    port: Number(channel.smtpPort) || 587,
    // `secure: true` berarti TLS langsung (port 465). Bila false, nodemailer
    // otomatis memakai STARTTLS ketika server mengiklankannya.
    secure: !!channel.smtpSecure,
    auth: channel.smtpUser
      ? { user: channel.smtpUser, pass: channel.smtpPassword || '' }
      : undefined,
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
  });
}

/**
 * Mengirim satu email. Melempar error dengan pesan yang ramah operator
 * supaya bisa langsung ditampilkan di UI (mis. saat tombol "Uji coba").
 */
async function sendMail(channel, { subject, text, html }) {
  const to = resolveRecipients(channel);
  if (to.length === 0) {
    throw new Error('Belum ada alamat email penerima pada channel ini.');
  }

  const transport = buildTransport(channel);
  try {
    const info = await transport.sendMail({
      from: resolveFrom(channel),
      to: to.join(', '),
      subject,
      text,
      html: html || undefined,
    });
    return info;
  } finally {
    // Tidak ada pool → tidak ada koneksi persisten; tutup transport apa pun
    // kondisinya agar socket tidak menggantung.
    try {
      transport.close();
    } catch (closeErr) {
      logger.debug(`Gagal menutup transport SMTP: ${closeErr.message}`);
    }
  }
}

/**
 * Memverifikasi kredensial & konektivitas SMTP tanpa mengirim email.
 * Dipakai endpoint uji coba agar operator tahu masalah konfigurasi lebih awal.
 */
async function verifySmtp(channel) {
  const transport = buildTransport(channel);
  try {
    await transport.verify();
  } finally {
    try {
      transport.close();
    } catch (closeErr) {
      logger.debug(`Gagal menutup transport SMTP: ${closeErr.message}`);
    }
  }
}

module.exports = { sendMail, verifySmtp, resolveFrom, resolveRecipients, buildTransport };
