require("dotenv").config();

function fail(message) {
  console.error(`[config] ${message}`);
  process.exit(1);
}

const jwtSecret = (process.env.JWT_SECRET || "").trim();
if (!jwtSecret) {
  fail(
    "JWT_SECRET belum diisi di file .env. Buat dengan:\n" +
      "  node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\"",
  );
}
if (jwtSecret.length < 32)
  fail("JWT_SECRET terlalu pendek (minimal 32 karakter).");

const defaultOrigins =
  "http://localhost:5500,http://127.0.0.1:5500,http://localhost:5173";

// Pendaftaran akun admin lewat email + password. DEFAULT MATI: email pendaftar belum diverifikasi, jadi
// orang lain bisa mendaftar dengan emailmu lebih dulu. Akun baru dibuat lewat "Masuk dengan Google"
// (email dari Google sudah terverifikasi).
const allowPasswordSignup =
  (process.env.ALLOW_PASSWORD_SIGNUP || "").trim().toLowerCase() === "true";
if (allowPasswordSignup && process.env.NODE_ENV === "production") {
  console.warn(
    "[config] ALLOW_PASSWORD_SIGNUP aktif di produksi, padahal email pendaftar belum diverifikasi. " +
      "Matikan sampai verifikasi email dibuat.",
  );
}

// Alamat frontend (BUKAN backend) tempat link verifikasi email & reset password mengarah,
// misalnya "http://localhost:5500" saat development atau "https://app.domainmu.com" saat deploy.
// Wajib diisi kalau memakai fitur lupa-password/verifikasi email; kalau kosong, endpoint terkait
// menjawab 503 (rate limiter tetap dipakai lebih dulu, sama seperti pola googleClient di atas).
const appUrl = (process.env.APP_URL || "").trim().replace(/\/$/, "");

// Konfigurasi SMTP untuk mengirim email verifikasi & reset password. Sengaja tidak wajib:
// kalau SMTP_HOST kosong, email tidak benar-benar terkirim - isinya dicetak ke console
// (lihat utils/mailer.js), supaya tetap bisa dites di localhost tanpa akun SMTP asli.
const smtp = {
  host: (process.env.SMTP_HOST || "").trim(),
  port: parseInt(process.env.SMTP_PORT, 10) || 587,
  user: (process.env.SMTP_USER || "").trim(),
  pass: (process.env.SMTP_PASS || "").trim(),
  from: (process.env.SMTP_FROM || "Client Photo Proofing <no-reply@example.com>").trim(),
};

// Batas jumlah project per admin. Melindungi kuota GOOGLE_API_KEY yang dipakai bersama semua admin.
const maxProjectsPerAdmin =
  parseInt(process.env.MAX_PROJECTS_PER_ADMIN, 10) > 0
    ? parseInt(process.env.MAX_PROJECTS_PER_ADMIN, 10)
    : 50;

module.exports = {
  isProd: process.env.NODE_ENV === "production",
  port: Number(process.env.PORT) || 3000,
  jwtSecret,
  // Kunci API Google untuk membaca folder Drive yang dibagikan "Anyone with the link".
  // Sengaja tidak wajib: kalau kosong, endpoint lain tetap jalan dan endpoint foto menjawab 503.
  googleApiKey: (process.env.GOOGLE_API_KEY || "").trim(),
  // Client ID OAuth untuk "Login dengan Google" admin. BEDA dengan GOOGLE_API_KEY di atas.
  // Sengaja tidak wajib: kalau kosong, endpoint /api/auth/google menjawab 503, login
  // password tetap jalan seperti biasa.
  googleClientId: (process.env.GOOGLE_CLIENT_ID || "").trim(),
  allowPasswordSignup,
  maxProjectsPerAdmin,
  appUrl,
  smtp,
  // Hanya diubah oleh tes otomatis (server Drive tiruan).
  driveApiBase: (
    process.env.DRIVE_API_BASE || "https://www.googleapis.com/drive/v3"
  ).trim(),
  clientOrigins: (process.env.CLIENT_ORIGIN || defaultOrigins)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};
