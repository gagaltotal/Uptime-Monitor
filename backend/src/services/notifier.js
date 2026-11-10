const axios = require('axios');
const NotificationChannel = require('../models/NotificationChannel');
const logger = require('../utils/logger');
const { sendMail } = require('./mailer');

const COLOR_DOWN = 0xf5484b;
const COLOR_UP = 0x34d399;
const COLOR_WARN = 0xf0a94e;

async function getActiveChannels(monitor) {
  if (!monitor.notificationChannels || monitor.notificationChannels.length === 0) return [];
  return NotificationChannel.find({
    _id: { $in: monitor.notificationChannels },
    isActive: true,
  }).select('+webhookUrl +telegramBotToken +smtpPassword');
}

async function dispatch(monitor, embed, plainText) {
  const channels = await getActiveChannels(monitor);
  await Promise.all(
    channels.map(async (channel) => {
      try {
        if (channel.type === 'discord') {
          await sendDiscord(channel.webhookUrl, embed);
        } else if (channel.type === 'slack') {
          await sendSlack(channel.webhookUrl, plainText);
        } else if (channel.type === 'telegram') {
          await sendTelegram(channel.telegramBotToken, channel.telegramChatId, plainText);
        } else if (channel.type === 'email') {
          await sendEmail(channel, embed, plainText);
        }
      } catch (err) {
        // A failing webhook must never break the monitoring loop for
        // everyone else — log and move on.
        logger.warn(`Gagal mengirim notifikasi via channel "${channel.name}"`, err.message);
      }
    })
  );
}

// Email memakai judul embed sebagai subject dan teks biasa sebagai body,
// ditambah versi HTML sederhana supaya tampil rapi di klien email.
async function sendEmail(channel, embed, plainText) {
  const fields = Array.isArray(embed.fields) ? embed.fields : [];
  const escapeHtml = (value) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const html = [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f2937">',
    `<h2 style="margin:0 0 12px;font-size:18px">${escapeHtml(embed.title || 'Notifikasi Uptime Monitor')}</h2>`,
    embed.description
      ? `<p style="margin:0 0 12px;color:#4b5563">${escapeHtml(embed.description)}</p>`
      : '',
    fields.length
      ? `<table style="border-collapse:collapse">${fields
          .map(
            (f) =>
              `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;white-space:nowrap">${escapeHtml(
                f.name
              )}</td><td style="padding:4px 0;font-weight:600">${escapeHtml(f.value)}</td></tr>`
          )
          .join('')}</table>`
      : '',
    '<p style="margin:16px 0 0;font-size:12px;color:#9ca3af">Dikirim otomatis oleh Uptime Monitor.</p>',
    '</div>',
  ].join('');

  await sendMail(channel, {
    subject: embed.title || 'Notifikasi Uptime Monitor',
    text: plainText,
    html,
  });
}

async function sendDiscord(webhookUrl, embed) {
  await axios.post(webhookUrl, { embeds: [embed] }, { timeout: 8000 });
}

async function sendSlack(webhookUrl, text) {
  await axios.post(webhookUrl, { text }, { timeout: 8000 });
}

async function sendTelegram(botToken, chatId, text) {
  await axios.post(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    { chat_id: chatId, text },
    { timeout: 8000 }
  );
}

function targetLabel(monitor) {
  if (monitor.type === 'http') return monitor.url;
  if (monitor.type === 'tcp') return `${monitor.host}:${monitor.port}`;
  if (monitor.host) return monitor.host;
  // SSL/Domain monitors carry `domain` (and an optional non-443 port) instead.
  if (monitor.domain) {
    return monitor.port && monitor.port !== 443 ? `${monitor.domain}:${monitor.port}` : monitor.domain;
  }
  return monitor.name || '-';
}

function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('id-ID', { dateStyle: 'full', timeStyle: 'short' });
}

async function notifyDown(monitor, incident) {
  const target = targetLabel(monitor);
  const embed = {
    title: `🔴 ${monitor.name} sedang DOWN`,
    description: incident.cause || 'Pemeriksaan gagal.',
    color: COLOR_DOWN,
    fields: [
      { name: 'Target', value: target, inline: true },
      { name: 'Sejak', value: new Date(incident.startedAt).toLocaleString('id-ID'), inline: true },
    ],
    timestamp: new Date().toISOString(),
  };
  const text = `🔴 *${monitor.name}* sedang DOWN\nTarget: ${target}\nPenyebab: ${incident.cause || 'Pemeriksaan gagal.'}`;
  await dispatch(monitor, embed, text);
}

async function notifyRecovery(monitor, incident) {
  const target = targetLabel(monitor);
  const durationLabel = incident.durationSeconds
    ? `${Math.round(incident.durationSeconds / 60)} menit`
    : '-';
  const embed = {
    title: `🟢 ${monitor.name} sudah pulih (UP)`,
    color: COLOR_UP,
    fields: [
      { name: 'Target', value: target, inline: true },
      { name: 'Durasi downtime', value: durationLabel, inline: true },
    ],
    timestamp: new Date().toISOString(),
  };
  const text = `🟢 *${monitor.name}* sudah kembali UP\nTarget: ${target}\nDurasi downtime: ${durationLabel}`;
  await dispatch(monitor, embed, text);
}

async function notifySslExpiry(monitor, daysRemaining) {
  const embed = {
    title: `🟡 Sertifikat SSL "${monitor.name}" akan segera kedaluwarsa`,
    description: `Sertifikat akan kedaluwarsa dalam ${daysRemaining} hari.`,
    color: COLOR_WARN,
    fields: [{ name: 'Target', value: targetLabel(monitor), inline: true }],
    timestamp: new Date().toISOString(),
  };
  const text = `🟡 Sertifikat SSL *${monitor.name}* akan kedaluwarsa dalam ${daysRemaining} hari.`;
  await dispatch(monitor, embed, text);
}

// ---- Dedicated SSL/Domain monitor notifications -------------------------
// These take an SslMonitor document (fields: name, domain, port, issuer,
// expiresAt, daysRemaining). They are additive and do not alter the
// existing monitor/agent notification paths.

function sslTargetLabel(ssl) {
  return ssl.port && ssl.port !== 443 ? `${ssl.domain}:${ssl.port}` : ssl.domain;
}

async function notifySslExpiring(sslMonitor, incident) {
  const target = sslTargetLabel(sslMonitor);
  const days = sslMonitor.daysRemaining;
  const embed = {
    title: `🟡 Sertifikat SSL "${sslMonitor.name}" akan segera kedaluwarsa`,
    description: `Sertifikat untuk ${target} akan kedaluwarsa dalam ${days} hari.`,
    color: COLOR_WARN,
    fields: [
      { name: 'Domain', value: target, inline: true },
      { name: 'Issuer', value: sslMonitor.issuer || '-', inline: true },
      { name: 'Kedaluwarsa', value: formatDate(sslMonitor.expiresAt), inline: false },
      { name: 'Sisa hari', value: `${days} hari`, inline: true },
    ],
    timestamp: new Date().toISOString(),
  };
  const text = `🟡 *Sertifikat SSL ${target}* akan kedaluwarsa dalam ${days} hari\nIssuer: ${sslMonitor.issuer || '-'}\nKedaluwarsa: ${formatDate(sslMonitor.expiresAt)}`;
  await dispatch(sslMonitor, embed, text);
}

async function notifySslExpired(sslMonitor, incident) {
  const target = sslTargetLabel(sslMonitor);
  const embed = {
    title: `🔴 Sertifikat SSL "${sslMonitor.name}" TELAH KEDALUWARSA`,
    description: `Sertifikat untuk ${target} sudah kedaluwarsa. Segera perbarui untuk menghindari gangguan.`,
    color: COLOR_DOWN,
    fields: [
      { name: 'Domain', value: target, inline: true },
      { name: 'Issuer', value: sslMonitor.issuer || '-', inline: true },
      { name: 'Kedaluwarsa', value: formatDate(sslMonitor.expiresAt), inline: false },
    ],
    timestamp: new Date().toISOString(),
  };
  const text = `🔴 *Sertifikat SSL ${target}* TELAH KEDALUWARSA\nIssuer: ${sslMonitor.issuer || '-'}\nKedaluwarsa: ${formatDate(sslMonitor.expiresAt)}`;
  await dispatch(sslMonitor, embed, text);
}

async function notifySslError(sslMonitor, incident) {
  const target = sslTargetLabel(sslMonitor);
  const embed = {
    title: `⚠️ Gagal memeriksa sertifikat "${sslMonitor.name}"`,
    description: incident?.cause || sslMonitor.lastMessage || 'Pengecekan TLS gagal.',
    color: COLOR_DOWN,
    fields: [{ name: 'Domain', value: target, inline: true }],
    timestamp: new Date().toISOString(),
  };
  const text = `⚠️ Pengecekan SSL *${target}* gagal\n${incident?.cause || sslMonitor.lastMessage || 'Tidak diketahui.'}`;
  await dispatch(sslMonitor, embed, text);
}

async function notifySslRecovered(sslMonitor, incident) {
  const target = sslTargetLabel(sslMonitor);
  const embed = {
    title: `🟢 Sertifikat SSL "${sslMonitor.name}" sehat kembali`,
    description: `Sertifikat untuk ${target} sudah valid dan aman.`,
    color: COLOR_UP,
    fields: [
      { name: 'Domain', value: target, inline: true },
      { name: 'Issuer', value: sslMonitor.issuer || '-', inline: true },
      { name: 'Kedaluwarsa', value: formatDate(sslMonitor.expiresAt), inline: false },
      { name: 'Sisa hari', value: `${sslMonitor.daysRemaining ?? '-'} hari`, inline: true },
    ],
    timestamp: new Date().toISOString(),
  };
  const text = `🟢 Sertifikat SSL *${target}* sehat kembali. Kedaluwarsa ${formatDate(sslMonitor.expiresAt)} (${sslMonitor.daysRemaining ?? '-'} hari lagi).`;
  await dispatch(sslMonitor, embed, text);
}

async function sendTestNotification(channel) {
  const embed = {
    title: '✅ Notifikasi uji coba',
    description: 'Jika Anda melihat pesan ini, channel notifikasi berhasil terhubung.',
    color: COLOR_UP,
    timestamp: new Date().toISOString(),
  };
  if (channel.type === 'discord') {
    await sendDiscord(channel.webhookUrl, embed);
  } else if (channel.type === 'slack') {
    await sendSlack(channel.webhookUrl, '✅ Notifikasi uji coba dari Uptime Monitor.');
  } else if (channel.type === 'telegram') {
    await sendTelegram(
      channel.telegramBotToken,
      channel.telegramChatId,
      '✅ Notifikasi uji coba dari Uptime Monitor.'
    );
  } else if (channel.type === 'email') {
    await sendEmail(
      channel,
      {
        ...embed,
        fields: [{ name: 'Server SMTP', value: `${channel.smtpHost}:${channel.smtpPort}`, inline: true }],
      },
      '✅ Notifikasi uji coba dari Uptime Monitor.\n\nJika Anda menerima email ini, konfigurasi SMTP sudah benar.'
    );
  }
}

module.exports = {
  notifyDown,
  notifyRecovery,
  notifySslExpiry,
  notifySslExpiring,
  notifySslExpired,
  notifySslError,
  notifySslRecovered,
  sendTestNotification,
};
