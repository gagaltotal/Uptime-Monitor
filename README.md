# Uptime Monitor

Aplikasi pemantauan server & situs web **self-hosted** — alternatif open-source untuk UptimeRobot yang bisa Anda jalankan sepenuhnya di infrastruktur Anda sendiri, tanpa data yang mengalir ke pihak ketiga.

## Fitur

- **Dashboard real-time** — gambaran umum seluruh monitor, terhubung lewat WebSocket sehingga status ter-update tanpa refresh.
- **Tiga jenis pengecekan**: HTTP(S), TCP port, dan ICMP ping.
- **Pemantauan sertifikat SSL** otomatis untuk setiap monitor HTTPS, lengkap dengan peringatan sebelum kedaluwarsa.
- **Riwayat uptime/downtime & waktu respons**, divisualisasikan dalam grafik.
- **Deteksi insiden otomatis** — setiap kali layanan down, insiden tercatat lengkap dengan durasi.
- **Notifikasi Discord & Slack** saat layanan down, pulih kembali, atau SSL akan kedaluwarsa.
- **Halaman status publik** yang bisa dibuat dan dibagikan ke pengguna Anda (`/status/nama-halaman`).
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
├── backend/               # API Node.js + Express + Socket.IO
│   └── src/
│       ├── models/        # Skema Mongoose (Monitor, Heartbeat, Incident, ...)
│       ├── middleware/    # auth, keamanan (helmet/rate-limit/sanitize), error handler
│       ├── validators/    # Skema validasi Joi
│       ├── services/      # Engine pemantauan, checker HTTP/TCP/Ping/SSL, notifier
│       ├── migrations/    # Migrasi database bernomor + runner
│       ├── seeders/       # Seeder akun admin
│       ├── cli/           # Entry point `npm run migrate` & `npm run seed`
│       └── routes/        # Endpoint REST API
└── frontend/               # Dashboard React + MUI
    └── src/
        ├── pages/          # Dashboard, Detail Monitor, Insiden, Halaman Status, dst.
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

## Masalah Umum

**Monitor tipe "Ping" selalu gagal.** ICMP ping butuh kapabilitas jaringan khusus di dalam container. Pastikan `cap_add: [NET_RAW]` pada service `backend` di `docker-compose.yml` tidak dihapus. Jika masih gagal di host tertentu (beberapa kernel membatasi ICMP unprivileged), gunakan monitor tipe **TCP Port** sebagai alternatif — HTTP dan TCP tidak memerlukan kapabilitas khusus sama sekali.

**Login gagal / langsung ter-logout setelah refresh halaman.** Biasanya karena `CORS_ORIGIN` di `.env` tidak sama persis dengan URL yang dipakai mengakses dashboard di browser. Perbaiki lalu `docker compose up -d --build` ulang.

**Notifikasi Discord/Slack tidak terkirim.** Gunakan tombol uji coba (ikon 🧪) di **Pengaturan → Notifikasi** untuk memastikan URL webhook benar. Backend menolak URL yang tidak cocok dengan pola resmi Discord/Slack.

## Lisensi

MIT — bebas digunakan, dimodifikasi, dan disebarkan.
