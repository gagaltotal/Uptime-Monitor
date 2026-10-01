# Uptime Monitor

Aplikasi pemantauan server & situs web **self-hosted** — alternatif open-source untuk UptimeRobot yang bisa Anda jalankan sepenuhnya di infrastruktur Anda sendiri, tanpa data yang mengalir ke pihak ketiga.

## Fitur

- **Dashboard real-time** — gambaran umum seluruh monitor, terhubung lewat WebSocket sehingga status ter-update tanpa refresh.
- **Tiga jenis pengecekan**: HTTP(S), TCP port, dan ICMP ping.
- **Pemantauan sertifikat SSL** otomatis untuk setiap monitor HTTPS, lengkap dengan peringatan sebelum kedaluwarsa.
- **Riwayat uptime/downtime & waktu respons**, divisualisasikan dalam grafik.
- **Deteksi insiden otomatis** — setiap kali layanan down, insiden tercatat lengkap dengan durasi.
- **Notifikasi Discord, Slack & Telegram** saat layanan down, pulih kembali, atau SSL akan kedaluwarsa.
- **Halaman status publik** yang bisa dibuat dan dibagikan ke pengguna Anda (`/status/nama-halaman`).
- **Pemantauan melalui Agent** — pasang agen di server Anda dan dapatkan detail CPU, memori, disk, jaringan, proses, dan uptime host secara real-time. Bisa digunakan untuk memantau host yang tidak bisa diakses dari luar (di balik NAT/firewall).
- Dikemas penuh dengan **Docker Compose** — satu perintah untuk menjalankan semuanya.

## Teknologi

| Bagian | Teknologi |
|---|---|
| Frontend | React 18 + Material UI 6 + Vite + `@mui/x-charts` |
| Backend | Node.js + Express 4 + Socket.IO |
| Database | MongoDB 7 (Mongoose) |
| Deployment | Docker + Docker Compose, nginx sebagai reverse proxy |

## Menjalankan dengan Docker (disarankan)

**Prasyarat:** Docker & Docker Compose terpasang.

```bash
# 1. Salin file environment lalu isi nilai-nilainya
cp .env.example .env

# 2. WAJIB: buat secret JWT yang kuat & acak (jalankan dua kali, hasilnya berbeda)
openssl rand -hex 64   # → tempel ke JWT_ACCESS_SECRET
openssl rand -hex 64   # → tempel ke JWT_REFRESH_SECRET
openssl rand -hex 24   # → tempel ke MONGO_ROOT_PASSWORD

# 3. Edit .env dan isi ketiga nilai di atas (lihat komentar di dalam file)
nano .env

# 4. Jalankan seluruh stack
docker compose up -d --build

# 5. Buka di browser
open http://localhost:3000
```

Saat pertama kali dibuka, Anda akan diarahkan ke halaman **Setup** untuk membuat akun admin. Setelah akun pertama dibuat, pendaftaran publik otomatis nonaktif — pengguna tambahan hanya bisa dibuat oleh admin yang sudah login (menu **Pengaturan → Pengguna**).

### Menghentikan / memperbarui

```bash
docker compose down          # hentikan (data tetap tersimpan di volume)
docker compose up -d --build # jalankan ulang setelah ada perubahan kode
docker compose logs -f backend   # lihat log backend (mis. debug notifikasi)
```

## Konfigurasi (`.env`)

| Variabel | Wajib diganti? | Keterangan |
|---|---|---|
| `MONGO_ROOT_PASSWORD` | **Ya** | Password root MongoDB. |
| `JWT_ACCESS_SECRET` | **Ya** | Kunci penandatanganan access token (min. 32 karakter, harus acak). |
| `JWT_REFRESH_SECRET` | **Ya** | Kunci refresh token — **harus berbeda** dari `JWT_ACCESS_SECRET`. |
| `CORS_ORIGIN` | Ya, jika bukan `localhost` | Origin persis tempat Anda mengakses dashboard. |
| `COOKIE_SECURE` | Ya, saat pakai HTTPS | Set `true` hanya jika aplikasi sudah di belakang HTTPS. |
| `FRONTEND_PORT` | Opsional | Port host untuk mengakses dashboard (default `3000`). |
| `HEARTBEAT_RETENTION_DAYS` | Opsional | Berapa lama histori pengecekan disimpan (default 90 hari). |

### Mengakses dari domain atau IP LAN lain

Jika dashboard diakses lewat domain (mis. `https://status.contoh.com`) atau IP LAN (mis. `http://192.168.1.10:3000`), **wajib** ubah `CORS_ORIGIN` di `.env` agar sama persis dengan URL tersebut, lalu `docker compose up -d --build` ulang. Jika tidak, login akan gagal karena cookie refresh-token ditolak browser.

### Mengaktifkan HTTPS

Container frontend melayani HTTP polos di port 80 (dipetakan ke `FRONTEND_PORT`). Untuk HTTPS di produksi, tempatkan reverse proxy TLS-terminating (Caddy, Traefik, atau nginx-proxy-manager) di depannya, lalu set `COOKIE_SECURE=true` dan `CORS_ORIGIN` ke URL HTTPS Anda. Contoh minimal dengan Caddy:

```
status.contoh.com {
    reverse_proxy localhost:3000
}
```

## Migrasi Database & Seeder Admin

### Migrasi

Perubahan struktur/data database dikelola lewat file bernomor di `backend/src/migrations/`. Secara default migrasi **berjalan otomatis** setiap backend start (`AUTO_MIGRATE=true`) — aman karena setiap migrasi bersifat idempoten dan dilindungi lock, sehingga beberapa container yang start bersamaan tidak akan saling tabrakan.

Menjalankan manual:

```bash
docker compose exec backend npm run migrate           # jalankan yang tertunda
docker compose exec backend npm run migrate:status    # lihat status tiap migrasi
docker compose exec backend npm run migrate:down      # rollback 1 terakhir
docker compose exec backend npm run migrate:down -- 3 # rollback 3 terakhir
```

Membuat migrasi baru — cukup tambahkan file dengan prefix nomor urut berikutnya:

```js
// backend/src/migrations/004-nama-migrasi-anda.js
exports.description = 'Penjelasan singkat migrasi ini';

exports.up = async () => {
  // perubahan Anda di sini (tulis idempoten agar aman diulang)
};

exports.down = async () => {
  // cara membalikkannya (boleh dikosongkan jika tidak relevan)
};
```

### Seeder Admin

Secara default aplikasi memakai halaman **/setup** di browser untuk membuat admin pertama. Jika Anda lebih suka admin dibuat otomatis (misalnya untuk deployment otomatis), isi `SEED_ADMIN_EMAIL` di `.env`:

```bash
SEED_ADMIN_EMAIL=admin@contoh.com
SEED_ADMIN_NAME=Administrator
SEED_ADMIN_PASSWORD=          # kosongkan → sistem buatkan kata sandi acak
```

Jika `SEED_ADMIN_PASSWORD` dikosongkan, seeder membuat kata sandi acak yang kuat dan menampilkannya **sekali** di log:

```bash
docker compose logs backend | grep -A4 "AKUN ADMIN DIBUAT"
```

Ini sengaja dijadikan perilaku default agar **tidak ada kredensial bawaan** yang tertulis di dalam proyek — dashboard pemantauan yang terekspos internet dengan admin `admin/admin123` adalah pintu terbuka. Kata sandi umum seperti `admin123` atau `password` akan **ditolak saat startup**, bukan sekadar diberi peringatan.

Menjalankan seeder manual:

```bash
docker compose exec backend npm run seed                       # buat admin dari .env
docker compose exec backend npm run seed:force                 # reset kata sandi admin
docker compose exec backend npm run seed -- --email a@b.com --password "RahasiaKuat123"
```

Seeder bersifat idempoten: jika akun sudah ada, akun tersebut **tidak disentuh** kecuali Anda memakai `--force`. Reset dengan `--force` juga otomatis membatalkan seluruh sesi login lama akun tersebut.

> **Lupa kata sandi admin?** Gunakan `docker compose exec backend npm run seed:force` (dengan `SEED_ADMIN_EMAIL` terisi di `.env`). Kata sandi baru akan ditampilkan di log.

## Keamanan

Aplikasi ini dirancang dengan asumsi akan diekspos ke internet (untuk memantau situs publik), sehingga setiap lapisan diberi perhatian khusus:

- **Injeksi NoSQL** — seluruh query memakai Mongoose (bukan string mentah), ditambah `express-mongo-sanitize` yang membuang operator (`$`, `.`) dari input pengguna, dan validasi tipe data via Joi yang secara alami menolak payload objek pada field yang seharusnya string (menutup celah bypass login klasik `{"email": {"$gt": ""}}`).
- **XSS** — React meng-escape seluruh output secara default (`dangerouslySetInnerHTML` tidak dipakai sama sekali di aplikasi ini), ditambah header `Content-Security-Policy` ketat dari nginx (`script-src 'self'` — tidak ada CDN eksternal, bahkan font di-self-host).
- **LFI (Local File Inclusion)** — aplikasi ini sengaja **tidak memiliki** fitur unggah/baca file berdasarkan path yang dikontrol pengguna (logo halaman status memakai URL eksternal, bukan upload), sehingga kelas kerentanan ini tidak memiliki permukaan serangan untuk dieksploitasi.
- **RCE (Remote Code Execution)** — tidak ada `eval`, `exec`, atau `child_process` dengan input mentah pengguna. Fitur ping memvalidasi ketat format hostname/IP lewat Joi sebelum diteruskan ke pustaka ping (yang sendiri menggunakan `spawn` dengan argumen array, bukan shell string).
- **Bypass token / CSRF** — access token JWT berumur pendek (15 menit) disimpan **di memori**, bukan `localStorage` (kebal dari pencurian via XSS). Refresh token disimpan di cookie `httpOnly` + `sameSite` (tidak bisa dibaca JavaScript maupun dikirim otomatis lintas situs), dan dirotasi setiap dipakai. Mengganti password otomatis membatalkan seluruh sesi lain via mekanisme `tokenVersion`.
- **Brute-force login** — rate limiting berlapis (per-IP di level aplikasi) ditambah penguncian akun otomatis 15 menit setelah 5x kegagalan login.
- **Mass assignment** — validasi Joi memakai `stripUnknown: true`, sehingga field yang tidak didefinisikan skema (mis. mencoba mengirim `role` atau `tokenVersion` lewat body request) otomatis dibuang sebelum mencapai database.
- **Kontainer non-root** — backend berjalan sebagai user tanpa privilege; kapabilitas `NET_RAW` untuk ping diberikan secara presisi lewat `setcap` pada binary ping saja, bukan dengan menjalankan seluruh container sebagai root.
- **Isolasi jaringan** — MongoDB tidak memiliki akses ke internet maupun port yang terbuka ke host sama sekali (lihat `docker-compose.yml`); hanya bisa diakses dari container backend melalui jaringan Docker internal.
- **Halaman status publik** hanya mengembalikan label & status yang Anda tentukan — URL/host/port asli monitor tidak pernah diekspos ke pengunjung publik.

> Tidak ada sistem yang 100% kebal. Selalu jaga `.env` tetap rahasia, perbarui image Docker secara berkala (`docker compose pull && docker compose up -d --build`), dan gunakan HTTPS + password admin yang kuat di produksi.

## Struktur Proyek

```
uptime-monitor/
├── docker-compose.yml
├── .env.example
├── agent/                 # Agent Monitoring
├── backend/               # API Node.js + Express + Socket.IO
│   └── src/
│       ├── models/        # Skema Mongoose (Agent, Monitor, Heartbeat, Incident, ...)
│       ├── middleware/    # auth, keamanan (helmet/rate-limit/sanitize), error handler
│       ├── validators/    # Skema validasi Joi
│       ├── services/      # Engine pemantauan, Agent, checker HTTP/TCP/Ping/SSL, notifier
│       ├── migrations/    # Migrasi database bernomor + runner
│       ├── seeders/       # Seeder akun admin
│       ├── cli/           # Entry point `npm run migrate` & `npm run seed`
│       └── routes/        # Endpoint REST API
└── frontend/               # Dashboard React + MUI
    └── src/
        ├── pages/          # Dashboard, Detail Monitor, Insiden, Halaman Status, Agent, dst.
        ├── components/     # Komponen UI (baris monitor, grafik, form, dsb.)
        └── context/        # Autentikasi & koneksi real-time
```

## Menjalankan untuk Pengembangan (tanpa Docker)

Butuh Node.js 20+ dan instance MongoDB (lokal atau Docker: `docker run -d -p 27017:27017 mongo:7`).

```bash
# Backend
cd backend
cp ../.env.example .env   # sesuaikan MONGO_URI ke mongodb://localhost:27017/uptime_monitor
npm install
npm run dev                # nodemon, restart otomatis saat kode berubah — http://localhost:5000

# Frontend (terminal terpisah)
cd frontend
npm install
npm run dev                 # http://localhost:5173, proxy otomatis ke backend
```

## Agent Monitoring

Fitur ini memungkinkan Anda memantau **server host secara menyeluruh** — CPU, memori, disk, jaringan, proses, uptime, dan load average — melalui agen ringan yang berjalan di masing-masing server. Agen mengirim metrik berkala ke backend dan membuat insiden otomatis saat ambang batas dilampaui.

### Membuat Agent di Dashboard

1. Buka **Agent** di sidebar navigasi.
2. Klik **Tambah Agent**, isi nama dan deskripsi opsional.
3. Setelah disimpan, token `agt_...` akan **ditampilkan sekali** — simpan dengan aman. Token ini digunakan agen untuk autentikasi (bukan JWT).
4. Pilih channel notifikasi yang ingin menerima alert dari agent ini (reuse notifikasi Discord/Slack/Telegram yang sudah dikonfigurasi).

### Menginstal Agent Bash

Salin skrip `agent/uptime-agent.sh` ke server yang akan dipantau:

```bash
# Di server target — buat direktori config
sudo mkdir -p /etc/uptime-agent
sudo chmod 700 /etc/uptime-agent

# Salin skrip dan config example
sudo cp agent/uptime-agent.sh /usr/local/bin/uptime-agent.sh
sudo chmod +x /usr/local/bin/uptime-agent.sh

# Salin config example dan sesuaikan
sudo cp agent/agent.conf.example /etc/uptime-agent/agent.conf
sudo chmod 600 /etc/uptime-agent/agent.conf
```

Edit `/etc/uptime-agent/agent.conf`:

```bash
UPTIME_SERVER_URL=https://uptime.example.com   # URL dashboard Anda
UPTIME_AGENT_TOKEN=agt_xxxxxxxxxxxxxxxxxxxx     # token dari dashboard
UPTIME_INTERVAL=60                              # detik antar laporan
UPTIME_SEND_LOGS=true                           # kirim log koneksi gagal
UPTIME_HTTP_TIMEOUT=10                           # detik
```

### Mode Jalannya

| Mode | Keterangan |
|---|---|
| (default) | Loop terus-menerus, kirim laporan setiap `UPTIME_INTERVAL` detik |
| `--once` | Kumpulkan dan kirim satu laporan, lalu keluar |
| `--print` | Kumpulkan dan cetak JSON payload tanpa kirim |
| `--selftest` | Kumpulkan metrik dan cetak ringkasan human-readable |

Contoh:

```bash
/usr/local/bin/uptime-agent.sh --once
/usr/local/bin/uptime-agent.sh --print
/usr/local/bin/uptime-agent.sh --selftest
```

### Menjalankan sebagai systemd Service

Salin unit file dan aktifkan:

```bash
sudo cp agent/uptime-agent.service /etc/systemd/system/uptime-agent.service
sudo systemctl daemon-reload
sudo systemctl enable --now uptime-agent
sudo systemctl status uptime-agent
```

Log: `journalctl -u uptime-agent -f`

### Variabel Environment / Config

| Variabel | Default | Keterangan |
|---|---|---|
| `UPTIME_SERVER_URL` | — | URL dashboard (wajib) |
| `UPTIME_AGENT_TOKEN` | — | Token agent `agt_...` (wajib) |
| `UPTIME_INTERVAL` | `60` | Detik antar report |
| `UPTIME_SEND_LOGS` | `false` | Kirim log saat koneksi gagal |
| `UPTIME_HTTP_TIMEOUT` | `10` | Detik timeout HTTP |

Config precedence: environment variable → `/etc/uptime-agent/agent.conf`.

### Cara Kerja & Ambang Batas

- Agent mengirim metrik (`cpuPercent`, `memoryPercent`, `diskPercent`, `loadAverage`, `uptimeSeconds`, `processCount`) ke `POST /api/agents/report` dengan header `x-agent-token`.
- Insiden dibuat otomatis saat metrik **≥ 90%** (CPU, memori, disk) atau agent **tidak melaporkan selama 180 detik** (status `disconnected`).
- Insiden otomatis **resolve** saat metrik kembali normal atau agent melaporkan lagi.
- Log dikirim ke `POST /api/agents/logs` (hanya jika `UPTIME_SEND_LOGS=true` dan ada ≥3 kegagalan berturut-turut).

### Notifikasi & Retensi

- Notifikasi **menggunakan ulang** channel Discord/Slack/Telegram yang sudah ada — tidak ada infrastruktur notifikasi baru.
- Retensi default: metrik **30 hari**, log **14 hari** (bisa diubah di `.env`).

### Cross-Distro

Skrip agent mendukung **Debian/Ubuntu, RHEL/CentOS/Fedora, Alpine, Arch** — auto-detect package manager (`apt`, `yum/dnf`, `apk`, `pacman`) untuk menginstal `jq`, `bc`, `iproute2`/`ip`, `procps-ng`/`ps`, `df`, `uptime`.

## Masalah Umum

**Monitor tipe "Ping" selalu gagal.** ICMP ping butuh kapabilitas jaringan khusus di dalam container. Pastikan `cap_add: [NET_RAW]` pada service `backend` di `docker-compose.yml` tidak dihapus. Jika masih gagal di host tertentu (beberapa kernel membatasi ICMP unprivileged), gunakan monitor tipe **TCP Port** sebagai alternatif — HTTP dan TCP tidak memerlukan kapabilitas khusus sama sekali.

**Login gagal / langsung ter-logout setelah refresh halaman.** Biasanya karena `CORS_ORIGIN` di `.env` tidak sama persis dengan URL yang dipakai mengakses dashboard di browser. Perbaiki lalu `docker compose up -d --build` ulang.

**Notifikasi Discord/Slack tidak terkirim.** Gunakan tombol uji coba (ikon 🧪) di **Pengaturan → Notifikasi** untuk memastikan URL webhook benar. Backend menolak URL yang tidak cocok dengan pola resmi Discord/Slack.

**Notifikasi Telegram tidak terkirim.** Di **Pengaturan → Notifikasi**, pilih tipe **Telegram** lalu isi **Bot Token** (dari [@BotFather](https://t.me/BotFather)) dan **Chat ID** tujuan (ID pengguna, grup, atau channel). Pastikan bot sudah pernah menerima pesan/kirim `/start` pada chat tersebut, dan untuk grup/channel bot harus ditambahkan sebagai anggota. Gunakan tombol uji coba (ikon 🧪) untuk memverifikasi bot token dan chat ID.

## Lisensi

MIT — bebas digunakan, dimodifikasi, dan disebarkan.
