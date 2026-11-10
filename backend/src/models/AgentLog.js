const mongoose = require('mongoose');
const { env } = require('../config/env');

const agentLogSchema = new mongoose.Schema({
  agent: { type: mongoose.Schema.Types.ObjectId, ref: 'Agent', required: true, index: true },
  level: {
    type: String,
    enum: ['debug', 'info', 'warn', 'error'],
    default: 'info',
    index: true,
  },
  source: { type: String, trim: true, maxlength: 120 },
  message: { type: String, required: true, maxlength: 2000 },
  meta: { type: mongoose.Schema.Types.Mixed },
  // Tidak memakai `index: true` di sini: index TTL di bawah sudah menempati
  // key pattern { loggedAt: 1 }. MongoDB menolak dua index dengan key pattern
  // yang sama, jadi index biasa akan bentrok dengan index TTL-nya.
  loggedAt: { type: Date, default: Date.now },
});

agentLogSchema.index({ agent: 1, loggedAt: -1 });
agentLogSchema.index({ agent: 1, level: 1, loggedAt: -1 });

// ---------------------------------------------------------------------------
// Auto-delete TTL
//
// Log agent adalah dokumen bervolume tinggi dan terus bertambah, sehingga tanpa
// pembersihan koleksi ini membengkak di disk server monitor. MongoDB dapat
// menghapus dokumen kedaluwarsa sendiri lewat index TTL: dokumen dihapus
// otomatis oleh mongod (background task tiap ~60 detik) tepat setelah
// `loggedAt` melewati masa simpan (default 7 hari / seminggu, lihat
// AGENT_LOG_RETENTION_DAYS).
//
// Catatan: TTL membuang dokumen berdasarkan `loggedAt` (waktu kejadian), bukan
// waktu insert. Karena loggedAt selalu terisi — dari agent maupun default
// Date.now — index tetap efektif untuk semua dokumen.
//
// Index TTL memakai nama eksplisit dan dibangun oleh migrasi 006
// (006-agent-log-ttl-index.js), bukan oleh autoIndex: di produksi autoIndex
// dimatikan (lihat config/db.js), jadi tanpa migrasi index TTL tidak pernah
// dibangun pada database yang sudah berjalan. Retensi harian di
// services/retention.js tetap dipertahankan sebagai lapisan kedua/fallback.
// ---------------------------------------------------------------------------
const AGENT_LOG_TTL_INDEX_NAME = 'agentlog_ttl_loggedAt';
const AGENT_LOG_TTL_SECONDS = Math.max(1, env.AGENT_LOG_RETENTION_DAYS) * 24 * 60 * 60;

agentLogSchema.index(
  { loggedAt: 1 },
  {
    name: AGENT_LOG_TTL_INDEX_NAME,
    expireAfterSeconds: AGENT_LOG_TTL_SECONDS,
    background: true,
  }
);

// Idempoten: pastikan index TTL ada dengan expireAfterSeconds yang cocok
// dengan nilai env saat ini, lalu kembalikan nilainya. Dipakai migrasi 006 dan
// aman dipanggil berulang.
agentLogSchema.statics.ensureTtlIndex = async function ensureTtlIndex() {
  const collection = this.collection;
  const indexes = await collection.indexes();
  const existing = indexes.find((idx) => idx.name === AGENT_LOG_TTL_INDEX_NAME);

  // MongoDB tidak mengizinkan perubahan expireAfterSeconds pada index yang
  // sudah ada, jadi index lama harus di-drop lebih dulu bila nilainya berbeda
  // (mis. operator mengubah AGENT_LOG_RETENTION_DAYS).
  if (existing && existing.expireAfterSeconds !== AGENT_LOG_TTL_SECONDS) {
    await collection.dropIndex(AGENT_LOG_TTL_INDEX_NAME);
  }

  await collection.createIndex(
    { loggedAt: 1 },
    {
      name: AGENT_LOG_TTL_INDEX_NAME,
      expireAfterSeconds: AGENT_LOG_TTL_SECONDS,
      background: true,
    }
  );

  return AGENT_LOG_TTL_SECONDS;
};

const AgentLog = mongoose.model('AgentLog', agentLogSchema);
AgentLog.AGENT_LOG_TTL_INDEX_NAME = AGENT_LOG_TTL_INDEX_NAME;
AgentLog.AGENT_LOG_TTL_SECONDS = AGENT_LOG_TTL_SECONDS;

module.exports = AgentLog;