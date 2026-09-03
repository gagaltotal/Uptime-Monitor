const axios = require('axios');
const NotificationChannel = require('../models/NotificationChannel');
const logger = require('../utils/logger');

const COLOR_DOWN = 0xf5484b;
const COLOR_UP = 0x34d399;
const COLOR_WARN = 0xf0a94e;

async function getActiveChannels(monitor) {
  if (!monitor.notificationChannels || monitor.notificationChannels.length === 0) return [];
  return NotificationChannel.find({
    _id: { $in: monitor.notificationChannels },
    isActive: true,
  }).select('+webhookUrl');
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
        }
      } catch (err) {
        // A failing webhook must never break the monitoring loop for
        // everyone else — log and move on.
        logger.warn(`Gagal mengirim notifikasi via channel "${channel.name}"`, err.message);
      }
    })
  );
}

async function sendDiscord(webhookUrl, embed) {
  await axios.post(webhookUrl, { embeds: [embed] }, { timeout: 8000 });
}

async function sendSlack(webhookUrl, text) {
  await axios.post(webhookUrl, { text }, { timeout: 8000 });
}

function targetLabel(monitor) {
  if (monitor.type === 'http') return monitor.url;
  if (monitor.type === 'tcp') return `${monitor.host}:${monitor.port}`;
  return monitor.host;
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

async function sendTestNotification(channel) {
  const embed = {
    title: '✅ Notifikasi uji coba',
    description: 'Jika Anda melihat pesan ini, channel notifikasi berhasil terhubung.',
    color: COLOR_UP,
    timestamp: new Date().toISOString(),
  };
  if (channel.type === 'discord') {
    await sendDiscord(channel.webhookUrl, embed);
  } else {
    await sendSlack(channel.webhookUrl, '✅ Notifikasi uji coba dari Uptime Monitor.');
  }
}

module.exports = { notifyDown, notifyRecovery, notifySslExpiry, sendTestNotification };
