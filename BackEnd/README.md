# Photo Proofing - Backend (Langkah 2: foto dari Google Drive)

Express + PostgreSQL (Neon). Isi sampai tahap ini: login admin (password), CRUD project,
endpoint publik untuk halaman client dengan gerbang password di sisi server, dan **daftar foto
dari folder Google Drive** (folder dibagikan "Anyone with the link", dibaca dengan API key).
Google SSO belum ada (tahap berikutnya).

## Update dari versi sebelumnya (kalau backend langkah 1 sudah jalan)

1. Ekstrak zip ke folder backend lama, pilih "Replace". `.env` dan `node_modules` kamu tidak tertimpa
   karena tidak ada di dalam zip.
2. Ikuti bagian **Setup Google Drive** di bawah (buat API key, isi `GOOGLE_API_KEY` di `.env`).
3. Restart server (Ctrl+C, lalu `npm run dev`). Tidak ada dependency baru dan tidak ada perubahan database.
4. Jalankan `npm test`. Semua tes harus lulus (48 tes).
5. Tes dengan folder Drive sungguhan lewat `requests.http` (langkah 4 dan 12).

## Struktur folder

```
index.js              server + pemasangan route
config.js             baca & validasi .env
db.js                 koneksi ke Neon
db/schema.sql         definisi tabel
routes/               auth.js, projects.js, client.js
middleware/auth.js    penjaga endpoint admin
utils/                validasi, token, helper, drive.js (akses Google Drive)
scripts/              migrate.js (buat tabel), seed-admin.js (buat admin)
tests/                tes otomatis (validasi, modul Drive, API) + server Drive tiruan di tests/support
requests.http         kumpulan request untuk tes endpoint
```

## Cara menjalankan (urut, dari nol)

Semua perintah dijalankan di terminal yang sudah berada di folder backend ini.

**1. Timpa folder lama.** Ekstrak zip, salin isinya ke folder backend lama dan pilih "Replace".
File `.env` kamu aman karena tidak ada di dalam zip.

**2. Install dependency baru.**

```
npm install
```

**3. Lengkapi file `.env`.** Buka `.env`, pastikan `DATABASE_URL` masih terisi, lalu tambahkan
baris-baris dari `.env.example`: `JWT_SECRET`, `CLIENT_ORIGIN`, `PORT`, `GOOGLE_API_KEY`
(cara membuat `GOOGLE_API_KEY` ada di bagian **Setup Google Drive** di bawah).

Untuk `JWT_SECRET`, jalankan perintah ini, lalu tempel hasilnya (deretan huruf-angka panjang)
setelah `JWT_SECRET=` tanpa spasi:

```
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

**4. Buat ulang tabel di Neon.** Tabel lama masih kosong, dan strukturnya mungkin beda dengan
skema baru, jadi kita reset:

```
npm run db:reset
```

Ketik `RESET` lalu Enter. Kalau berhasil, muncul `Schema siap. Tabel di database: admins, projects, selections`.
(Kalau nanti kamu hanya ingin membuat tabel yang belum ada tanpa menghapus apa pun, pakai `npm run db:setup`.)

**5. Buat akun admin pertama.**

```
npm run seed:admin
```

Isi email, nama, dan password. Saat mengetik password, layar tidak menampilkan apa pun. Itu normal.

**6. Jalankan server.**

```
npm run dev
```

Buka `http://localhost:3000/health`, harus muncul `"database": "connected"`.

**7. Tes semua endpoint.** Install ekstensi **REST Client** di VS Code, buka `requests.http`,
ganti email dan password di langkah 2, lalu klik "Send Request" satu per satu dari atas.
Di dalamnya sudah ada tes password client yang salah dan benar, serta tes setelah logout.

Catatan: `nodemon` tidak memuat ulang saat `.env` diubah. Setelah mengedit `.env`,
hentikan server (Ctrl+C) lalu `npm run dev` lagi.

## Setup Google Drive

Backend membaca daftar foto dari folder Drive yang dibagikan **"Anyone with the link"** memakai API key.
Foto tidak disimpan di server dan tidak lewat server: browser memuat gambar langsung dari alamat thumbnail Google.

**1. Buat API key.** Di console.cloud.google.com, pilih project, buka *APIs & Services > Credentials*,
klik *Create credentials > API key*, lalu salin key-nya. Pastikan *Google Drive API* sudah di-Enable
di *APIs & Services > Library*.

**2. Batasi key.** Klik key tadi, di bagian *API restrictions* pilih *Restrict key* dan centang hanya
*Google Drive API*. Jangan pasang *Application restrictions* berbasis website (HTTP referrer), karena
permintaan datang dari server, bukan dari browser, dan akan ditolak Google.

**3. Simpan di `.env`** sebagai `GOOGLE_API_KEY=...` (tanpa spasi dan tanpa tanda kutip), lalu restart server.
Key ini hanya boleh ada di server. Jangan dimasukkan ke file frontend atau dibagikan.

**4. Siapkan folder tes.** Buat folder di Drive-mu, isi beberapa foto, klik kanan, *Share*, ubah
*General access* ke *Anyone with the link* dengan peran *Viewer*, lalu salin link-nya ke `requests.http`.

**Kenapa bukan OAuth per-admin?** Ini sempat dicoba (admin klik "Hubungkan Drive", pilih folder lewat
Google Picker, scope `drive.file`), supaya folder tidak perlu di-set publik. Dibatalkan karena scope
`drive.file` hanya memberi akses ke file yang eksplisit dipilih user di Picker -- memilih FOLDER tidak
memberi akses ke isi foldernya, jadi daftar foto akan selalu kosong. Alternatif yang benar-benar bisa baca
isi folder (`drive.readonly`) butuh proses verifikasi Google dan token yang kedaluwarsa tiap 7 hari selama
status "Testing" -- tidak sepadan untuk skala proyek ini. Detail di komentar `db/schema.sql`.

## Login admin

Tiga cara login admin, bisa dipakai berbarengan:
- **Password**: `POST /api/auth/login`. Dibuat lewat `npm run seed:admin` atau lewat pendaftaran di bawah.
- **Google Sign-In**: `POST /api/auth/google` (body `{ "credential": "<ID token dari Google Identity Services>" }`).
  Butuh `GOOGLE_CLIENT_ID` terisi di `.env` (bikin di *Google Cloud Console > Credentials > OAuth client ID >
  Web application*). Kalau kosong, tombol Google mati di frontend dan endpoint ini menjawab 503; login password
  tetap jalan. Login Google pertama kali otomatis membuat akun admin baru (email dari Google sudah terverifikasi).
- **Pendaftaran email + password**: `POST /api/auth/register`, MATI secara default (`ALLOW_PASSWORD_SIGNUP=false`)
  karena email pendaftar belum diverifikasi -- orang lain bisa duluan mendaftar pakai emailmu. Nyalakan hanya kalau
  kamu sudah punya verifikasi email sendiri.

`GET /api/auth/options` dipakai frontend untuk tahu tombol apa yang boleh ditampilkan di halaman login/daftar.

### Lupa password & verifikasi email

Butuh dua variabel di `.env` supaya aktif:
- `APP_URL`: alamat frontend (bukan backend ini), dipakai untuk membuat link di email, misalnya
  `http://localhost:5500` (folder `Project Photo Selector` dibuka lewat Live Server) atau alamat domain saat deploy.
  Kalau kosong, `POST /api/auth/forgot-password` dan `POST /api/auth/verify-email/resend` menjawab 503.
- `SMTP_HOST` (+`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM`): kredensial SMTP untuk benar-benar mengirim
  email. Kosongkan saat development -- email tidak terkirim, tapi isinya (termasuk link verifikasi/reset)
  dicetak ke log server (`utils/mailer.js`), jadi tetap bisa dites manual dengan menyalin link dari terminal.

Alurnya:
- Daftar lewat email+password -> server membuat token verifikasi (berlaku 24 jam, disimpan sebagai hash SHA-256,
  bukan mentah) dan mengirim email dengan link ke `verify-email.html?token=...` di frontend. Login tetap berhasil
  meskipun belum verifikasi -- dashboard menampilkan pengingat dengan tombol "Resend" (`POST
  /api/auth/verify-email/resend`, butuh sesi admin, dibatasi 3x/15 menit).
- Lupa password -> `POST /api/auth/forgot-password` (dibatasi 5x/jam per IP). Respons selalu sama (`{ ok: true }`)
  baik email terdaftar atau tidak, dan baik akun punya password atau login-Google-saja, supaya endpoint ini tidak
  bisa dipakai menebak email siapa yang punya akun. Kalau akun ditemukan dan punya password, token reset (berlaku
  30 menit, sekali pakai) dikirim ke email menuju `reset-password.html?token=...`. Kalau akun login-Google-saja,
  emailnya diberi tahu untuk pakai tombol Google, bukan reset password.
- Login lewat Google atau berhasil reset password otomatis menandai email sebagai terverifikasi (Google sudah
  memverifikasi emailnya sendiri; berhasil reset password membuktikan orang itu memang punya akses ke inbox-nya).

Karena pendaftaran (lewat Google) terbuka untuk admin mana pun, dan semua admin berbagi satu `GOOGLE_API_KEY`,
jumlah project per admin dibatasi lewat `MAX_PROJECTS_PER_ADMIN` (default 50), dan pembuatan project dibatasi
laju per admin (30x/jam) supaya satu admin tidak menghabiskan kuota Google untuk admin lain.

## Daftar endpoint

| Method | Path | Akses | Fungsi |
|---|---|---|---|
| GET | `/health` | publik | cek server dan database |
| GET | `/api/auth/options` | publik | fitur login apa yang aktif (Google / pendaftaran password) |
| POST | `/api/auth/login` | publik | login admin (email+password), mengirim cookie sesi |
| POST | `/api/auth/register` | publik, default mati | daftar admin baru lewat email+password |
| POST | `/api/auth/google` | publik | login/daftar admin lewat Google Sign-In |
| POST | `/api/auth/logout` | publik | hapus cookie sesi |
| GET | `/api/auth/me` | admin | data admin yang sedang login |
| POST | `/api/auth/forgot-password` | publik | minta link reset password lewat email |
| POST | `/api/auth/reset-password` | publik (butuh token) | atur password baru lewat token dari email |
| POST | `/api/auth/verify-email` | publik (butuh token) | verifikasi email lewat token dari email |
| POST | `/api/auth/verify-email/resend` | admin | kirim ulang email verifikasi |
| GET | `/api/projects` | admin | daftar project milik admin |
| POST | `/api/projects` | admin | buat project |
| GET | `/api/projects/:id` | admin | detail project |
| PATCH | `/api/projects/:id` | admin | ubah sebagian field (ID tetap, link client tidak mati) |
| DELETE | `/api/projects/:id` | admin | hapus project |
| GET | `/api/client/:id` | publik | nama project + status kunci password |
| POST | `/api/client/:id/unlock` | publik | kirim password client; kalau benar, dapat batas foto dan nomor WA |
| GET | `/api/client/:id/photos` | publik, setelah unlock | daftar foto di folder Drive project (nama, ukuran, alamat thumbnail) |

Body `POST /api/projects`: `name`, `driveFolderLink`, `whatsappNumber`, `maxSelection` (default 10),
`clientPassword` (opsional; kosong berarti link tidak dikunci). Nomor WA dinormalisasi otomatis
ke format wa.me (`0812-3456-7890` menjadi `6281234567890`).
Di `PATCH`, kirim `"clientPassword": null` untuk menghapus password.

Saat `POST` atau `PATCH` (kalau link folder ikut diubah), server memeriksa folder ke Google:
- Folder tidak ditemukan, belum dibagikan, atau link-nya bukan folder: **ditolak dengan 400** dan pesan petunjuk.
- Google sedang bermasalah, kuota habis, atau `GOOGLE_API_KEY` belum diisi: project **tetap tersimpan**
  dan response memuat `driveWarning`.

Response `GET /api/client/:id/photos`:

```json
{
  "total": 2,
  "photos": [
    { "id": "...", "name": "DSC001.jpg", "width": 4000, "height": 6000,
      "thumb": "https://...=s480", "full": "https://...=s1600" }
  ],
  "withoutThumbnail": 0,
  "truncated": false
}
```

`name` dipakai untuk pesan WhatsApp, `thumb` untuk galeri, `full` untuk preview (lightbox).

## Keputusan desain yang perlu kamu tahu

- **Sesi lewat cookie httpOnly**, bukan token di localStorage, jadi tidak bisa dicuri lewat XSS.
  Konsekuensinya frontend harus memanggil API dengan `fetch(url, { credentials: 'include' })`.
- **Password client diverifikasi di server.** Sebelum benar, API tidak mengirim nomor WA maupun batas foto.
- **Login dibatasi 10 percobaan gagal per 15 menit per IP** (login admin dan password client).
- **Semua query project difilter `admin_id`**, jadi kalau nanti ada lebih dari satu admin, datanya tidak bercampur.
- **Folder "Anyone with the link" berarti foto tidak dilindungi di sisi Google.** Password client hanya
  melindungi halaman dan daftar foto di aplikasi ini. Siapa pun yang memegang link Drive-nya bisa membuka
  folder langsung, dan bisa mengunduh file asli kecuali pemilik mematikan opsi unduh untuk viewer.
  Link Drive tidak pernah dikirim ke halaman client.
- **Hanya isi langsung folder yang ditampilkan.** Foto di dalam subfolder tidak ikut. Urutan mengikuti
  nama file secara natural (`DSC2` sebelum `DSC10`). Yang ditampilkan hanya file bertipe gambar.
- **Daftar foto di-cache 2 menit** per folder untuk menghemat kuota Google. Foto yang baru diunggah
  muncul paling lama 2 menit kemudian.
- **Alamat thumbnail Google berlaku beberapa jam.** Halaman client sebaiknya memuat ulang daftar foto
  (atau menangani gambar yang gagal dimuat) kalau tab dibiarkan terbuka lama.
- **Ukuran `thumb` dan `full` didapat dengan mengganti angka di ujung alamat thumbnail (`=s220`).**
  Ini praktik yang umum, tetapi tidak tercantum di dokumentasi resmi Google. Kalau preview terlihat kecil
  atau buram, periksa ini lebih dulu.
- **Folder dengan `resourcekey` di link-nya** (Google memakainya untuk sebagian file yang dibagikan lewat link)
  diteruskan otomatis lewat header `X-Goog-Drive-Resource-Keys`.
- **Endpoint foto dibatasi 60 permintaan per menit per IP.**

## Tes otomatis

```
npm test
```

Ada 48 tes: fungsi validasi, modul Drive, dan API (gerbang password, verifikasi folder). Tes memakai
**server Google Drive tiruan** dan database di memori, jadi tidak butuh internet atau `.env`.
Artinya tes ini membuktikan logika kode kita, **bukan** perilaku Google yang sebenarnya. Perilaku asli
Drive hanya bisa dibuktikan dengan folder sungguhan lewat `requests.http` (langkah 4 dan 12).

## Troubleshooting

- **`[config] JWT_SECRET belum diisi`**: langkah 3 belum dilakukan, atau server belum di-restart setelah edit `.env`.
- **Login sukses tapi `/api/auth/me` menjawab 401 dari halaman frontend**: pastikan alamat frontend dan API memakai
  host yang sama. Frontend di `http://127.0.0.1:5500` harus memanggil `http://127.0.0.1:3000`,
  bukan `localhost:3000`, karena browser menganggap keduanya situs berbeda dan tidak mengirim cookie.
- **Membuat project ditolak dengan "Folder tidak ditemukan atau belum dibagikan"**: folder belum diatur
  *Anyone with the link* (peran Viewer), atau link-nya salah. Untuk folder privat, Google menjawab
  "tidak ditemukan", bukan "dilarang", jadi pesannya memang mirip.
- **Response memuat `driveWarning` yang menyebut `GOOGLE_API_KEY`**: key belum diisi di `.env`, atau server
  belum di-restart setelah mengisinya.
- **Pesan "Google menolak API key server"** (muncul di `driveWarning` dan di log terminal): periksa tiga hal.
  Key benar dan tidak terpotong saat disalin. *Google Drive API* sudah di-Enable di project yang sama
  dengan key. *API restrictions* mengizinkan Google Drive API, dan tidak ada *Application restrictions*
  berbasis website atau IP yang tidak cocok dengan server ini.
- **Foto muncul di daftar tetapi gambarnya tidak tampil di browser**: buka alamat `thumb` langsung di tab baru.
  Kalau kosong atau error, kirim status yang tampil. Ini bagian yang hanya bisa dites dengan Drive sungguhan.
- **Foto ada di Drive tetapi tidak muncul di daftar**: fotonya ada di subfolder, bukan langsung di folder yang
  ditempel, atau baru diunggah kurang dari 2 menit lalu (cache), atau bukan file gambar.
- **Error CORS di browser**: alamat frontend belum ada di `CLIENT_ORIGIN` di `.env`.
- **Saat deploy**: set `NODE_ENV=production` (cookie jadi `Secure` + `SameSite=None`, wajib HTTPS)
  dan isi `CLIENT_ORIGIN` dengan alamat frontend yang sebenarnya.
