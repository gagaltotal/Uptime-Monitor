const net = require('net');
const tls = require('tls');
const axios = require('axios');
const ping = require('ping');
const { URL } = require('url');

// ---------------------------------------------------------------------------
// HTTP(S) checker
// ---------------------------------------------------------------------------
// Uses axios with validateStatus: () => true so we can classify the status
// code ourselves against the monitor's expectedStatusCodes instead of axios
// throwing on 4xx/5xx. maxRedirects follows redirects like a browser would.
async function checkHttp(monitor) {
  const startedAt = process.hrtime.bigint();
  try {
    const response = await axios.request({
      url: monitor.url,
      method: monitor.method || 'GET',
      timeout: (monitor.timeout || 10) * 1000,
      maxRedirects: 5,
      validateStatus: () => true,
      headers: { 'User-Agent': 'UptimeMonitor/1.0 (+self-hosted)' },
      // Only relevant for https:// targets; ignored otherwise.
      httpsAgent: monitor.ignoreTlsErrors
        ? new (require('https').Agent)({ rejectUnauthorized: false })
        : undefined,
      // Response bodies are irrelevant to us and can be large; cap it.
      maxContentLength: 5 * 1024 * 1024,
      decompress: true,
    });
    const responseTime = msSince(startedAt);
    const expected = monitor.expectedStatusCodes?.length
      ? monitor.expectedStatusCodes
      : [200];
    const up = expected.includes(response.status);
    return {
      up,
      responseTime,
      statusCode: response.status,
      message: up ? 'OK' : `Kode status tidak sesuai harapan: ${response.status}`,
    };
  } catch (err) {
    return {
      up: false,
      responseTime: null,
      statusCode: null,
      message: describeAxiosError(err),
    };
  }
}

function describeAxiosError(err) {
  if (err.code === 'ECONNABORTED') return 'Waktu tunggu habis (timeout).';
  if (err.code === 'ENOTFOUND') return 'Host tidak dapat ditemukan (DNS gagal).';
  if (err.code === 'ECONNREFUSED') return 'Koneksi ditolak.';
  if (err.code === 'CERT_HAS_EXPIRED') return 'Sertifikat SSL sudah kedaluwarsa.';
  if (err.code && err.code.startsWith('ERR_TLS')) return `Kesalahan TLS: ${err.code}`;
  return err.message || 'Kesalahan tidak diketahui.';
}

// ---------------------------------------------------------------------------
// TCP port checker — raw socket connect, no data exchanged.
// ---------------------------------------------------------------------------
function checkTcpPort(host, port, timeoutSec) {
  return new Promise((resolve) => {
    const startedAt = process.hrtime.bigint();
    const socket = new net.Socket();
    let settled = false;

    const finish = (up, message) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({
        up,
        responseTime: up ? msSince(startedAt) : null,
        statusCode: null,
        message,
      });
    };

    socket.setTimeout((timeoutSec || 10) * 1000);
    socket.once('connect', () => finish(true, 'Port terbuka'));
    socket.once('timeout', () => finish(false, 'Waktu tunggu koneksi habis (timeout).'));
    socket.once('error', (err) => finish(false, err.message || 'Koneksi gagal.'));

    socket.connect(port, host);
  });
}

// ---------------------------------------------------------------------------
// ICMP ping checker — shells out to the system `ping` binary via the `ping`
// package, which uses child_process.spawn with argument arrays (not a shell
// string), so there is no command-injection surface here. The host value is
// additionally restricted to a valid hostname/IP shape by Joi validation
// before it is ever persisted (see validators/index.js), as defense in depth.
// ---------------------------------------------------------------------------
async function checkPing(host, timeoutSec) {
  try {
    const result = await ping.promise.probe(host, {
      timeout: timeoutSec || 10,
      extra: ['-c', '1'],
    });
    if (result.alive) {
      return {
        up: true,
        responseTime: Math.round(parseFloat(result.time)) || 0,
        statusCode: null,
        message: 'Balasan ping diterima',
      };
    }
    return { up: false, responseTime: null, statusCode: null, message: 'Tidak ada balasan ping.' };
  } catch (err) {
    return { up: false, responseTime: null, statusCode: null, message: err.message || 'Ping gagal.' };
  }
}

// ---------------------------------------------------------------------------
// SSL certificate checker — opens a raw TLS connection and reads the peer
// certificate's validity window. rejectUnauthorized:false is intentional
// here (and only here): we want to know the expiry date even for a
// self-signed/expired chain so we can warn about it, rather than throwing.
// ---------------------------------------------------------------------------
function checkSslCertificate(hostname, port, timeoutSec) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      {
        host: hostname,
        port: port || 443,
        servername: hostname,
        rejectUnauthorized: false,
        timeout: (timeoutSec || 10) * 1000,
      },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        if (!cert || !cert.valid_to) {
          reject(new Error('Sertifikat tidak ditemukan.'));
          return;
        }
        const expiresAt = new Date(cert.valid_to);
        const daysRemaining = Math.floor((expiresAt.getTime() - Date.now()) / 86400000);
        resolve({ expiresAt, daysRemaining, issuer: cert.issuer?.O || cert.issuer?.CN });
      }
    );
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('Waktu tunggu koneksi TLS habis.'));
    });
    socket.once('error', (err) => reject(err));
  });
}

// Formats a certificate's distinguished-name objects into a readable string,
// e.g. { C: 'US', O: "Let's Encrypt", CN: 'example.com' } → "Let's Encrypt (CN=example.com)".
function formatDistinguishedName(dn) {
  if (!dn || typeof dn !== 'object') return null;
  const preferred = dn.O || dn.CN || dn.OU;
  const suffix = dn.CN && dn.CN !== preferred ? ` (CN=${dn.CN})` : '';
  if (preferred) return `${preferred}${suffix}`.slice(0, 300);
  // Fallback: join whatever fields exist, most-specific first.
  const parts = Object.entries(dn)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
  return parts ? parts.slice(0, 300) : null;
}

// Rich SSL check used by the SSL/Domain engine. Returns everything the UI
// needs (issuer, subject, serial, validity window, days remaining) or throws
// with a human-readable message that becomes the incident "cause".
function checkSslCertificateDetailed(hostname, port, timeoutSec) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, arg) => {
      if (settled) return;
      settled = true;
      fn(arg);
    };

    let socket;
    try {
      socket = tls.connect({
        host: hostname,
        port: port || 443,
        servername: hostname,
        rejectUnauthorized: false, // read the cert even when the chain is invalid
        timeout: (timeoutSec || 10) * 1000,
      });
    } catch (err) {
      reject(err);
      return;
    }

    socket.once('secureConnect', () => {
      // authorizationError is populated when rejectUnauthorized would have
      // failed (self-signed, hostname mismatch, expired). We still surface the
      // certificate details, but flag the verification problem.
      const authorizationError = socket.authorizationError || null;
      const cert = socket.getPeerCertificate(true);
      socket.end();

      if (!cert || !cert.valid_to) {
        done(reject, new Error('Sertifikat tidak ditemukan pada server.'));
        return;
      }

      const expiresAt = new Date(cert.valid_to);
      if (Number.isNaN(expiresAt.getTime())) {
        done(reject, new Error('Tanggal kedaluwarsa sertifikat tidak valid.'));
        return;
      }
      const validFrom = cert.valid_from ? new Date(cert.valid_from) : null;
      const daysRemaining = Math.floor((expiresAt.getTime() - Date.now()) / 86400000);

      done(resolve, {
        domain: hostname,
        port: port || 443,
        issuer: formatDistinguishedName(cert.issuer),
        subject: formatDistinguishedName(cert.subject),
        serialNumber: cert.serialNumber || null,
        validFrom,
        expiresAt,
        daysRemaining,
        authorizationError: authorizationError ? String(authorizationError) : null,
        authorized: !authorizationError,
      });
    });

    socket.once('timeout', () => {
      socket.destroy();
      done(reject, new Error('Waktu tunggu koneksi TLS habis (timeout).'));
    });
    socket.once('error', (err) => {
      done(reject, err);
    });
  });
}

function msSince(hrtimeStart) {
  const diffNs = process.hrtime.bigint() - hrtimeStart;
  return Number(diffNs / 1000000n);
}

function extractHostnameFromUrl(urlString) {
  try {
    return new URL(urlString).hostname;
  } catch {
    return null;
  }
}

module.exports = {
  checkHttp,
  checkTcpPort,
  checkPing,
  checkSslCertificate,
  checkSslCertificateDetailed,
  extractHostnameFromUrl,
};
