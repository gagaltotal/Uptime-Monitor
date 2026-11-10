const AgentLog = require('../models/AgentLog');
const { env } = require('../config/env');
const logger = require('../utils/logger');

exports.description =
  'Auto-delete log agent: membangun index TTL pada loggedAt (default 7 hari) dan membersihkan backlog lama';

// Latar belakang
// -------------
// Koleksi agentlogs terus bertambah selama ada agent yang melapor dan tidak
// pernah menyusut sendiri. Agar tidak membengkak di disk server monitor, model
// AgentLog mendeklarasikan index TTL { loggedAt: 1 } dengan expireAfterSeconds
// = AGENT_LOG_RETENTION_DAYS * 86400 (default 7 hari / seminggu). mongod lalu
// menghapus dokumen kedaluwarsa secara otomatis di background.
//
// Migrasi ini perlu ada karena di produksi autoIndex dimatikan
// (lihat config/db.js): tanpa migrasi, index TTL tidak akan pernah dibangun
// pada database yang sudah berjalan — fitur auto-delete hanya akan aktif pada
// instalasi baru.
//
// Idempoten: menyelaraskan index TTL lewat AgentLog.ensureTtlIndex() (aman
// dipanggil berulang) lalu menghapus backlog yang sudah melewati masa simpan.

exports.up = async () => {
  const seconds = await AgentLog.ensureTtlIndex();
  logger.debug(
    `  index TTL log agent siap (${AgentLog.AGENT_LOG_TTL_INDEX_NAME}, ${seconds}s).`
  );

  // Bersihkan backlog sekaligus agar disk lega tanpa menunggu siklus TTL.
  // TTL memindai secara periodik (~60 detik) sedangkan data lama bisa sangat
  // banyak pada instalasi yang sudah lama berjalan.
  const cutoff = new Date(Date.now() - seconds * 1000);
  const result = await AgentLog.deleteMany({ loggedAt: { $lt: cutoff } });
  if (result.deletedCount > 0) {
    logger.info(
      `Auto-delete log agent: menghapus ${result.deletedCount} log lebih lama dari ${env.AGENT_LOG_RETENTION_DAYS} hari.`
    );
  }
};

// Sengaja no-op: menghapus index TTL saat rollback akan mematikan fitur
// auto-delete dan membuat koleksi kembali membengkak. Data yang sudah terhapus
// juga tidak bisa dikembalikan, jadi rollback tidak memberi manfaat.
exports.down = async () => {};