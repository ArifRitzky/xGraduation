// routes/drive.js
// Alur "Hubungkan Google Drive" per-admin (Opsi B: drive.file + Google Picker).
//
// BEDA dengan /api/auth/google: itu untuk identitas login (siapa kamu), scope-nya cuma
// openid/email/profile. Ini untuk OTORISASI akses Drive (folder mana yang boleh dibaca
// app), scope-nya https://www.googleapis.com/auth/drive.file - dan HANYA berlaku untuk
// file/folder yang admin pilih secara eksplisit lewat Google Picker, bukan seluruh Drive-nya.
//
// Alurnya pakai "popup code flow" dari Google Identity Services (ux_mode: 'popup' di
// frontend), BUKAN redirect berbasis URL. Konsekuensinya redirect_uri yang dipakai saat
// menukar code harus persis string 'postmessage' - bukan URL app kita. Kalau ini salah,
// Google membalas "Error 400: invalid_request ... doesn't comply with Google's OAuth 2.0
// policy for keeping apps secure", yang membingungkan karena kelihatannya soal keamanan
// padahal cuma soal parameter ini.
const express = require("express");
const rateLimit = require("express-rate-limit");
const { OAuth2Client } = require("google-auth-library");
const config = require("../config");
const { query } = require("../db");
const { requireAdmin } = require("../middleware/auth");
const { asyncHandler, HttpError } = require("../utils/http");
const { encrypt, decrypt } = require("../utils/crypto");

const router = express.Router();
router.use(requireAdmin);

const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

function assertConfigured() {
  if (!config.googleClientId || !config.googleClientSecret) {
    throw new HttpError(
      503,
      "Hubungkan Google Drive belum dikonfigurasi di server.",
    );
  }
  if (!config.encryptionKey) {
    throw new HttpError(
      503,
      "Server belum siap menyimpan koneksi Drive dengan aman.",
    );
  }
}

function newOAuthClient() {
  return new OAuth2Client(config.googleClientId, config.googleClientSecret);
}

// Dipakai route lain (nanti utils/drive.js) untuk dapat access token yang masih berlaku
// dari refresh token tersimpan milik admin tertentu. Diekspor supaya tidak duplikat logic.
async function getAccessTokenForAdmin(adminId) {
  const { rows } = await query(
    "SELECT drive_refresh_token FROM admins WHERE id = $1",
    [adminId],
  );
  const encrypted = rows[0] && rows[0].drive_refresh_token;
  if (!encrypted) return null;

  const client = newOAuthClient();
  client.setCredentials({ refresh_token: decrypt(encrypted) });
  try {
    const { token } = await client.getAccessToken();
    return token || null;
  } catch (err) {
    // Refresh token biasanya invalid karena admin mencabut akses lewat akun Google-nya
    // sendiri (bukan lewat app ini). Bersihkan status "connected" supaya UI tidak
    // berpura-pura Drive masih tersambung.
    await query(
      "UPDATE admins SET drive_refresh_token = NULL, drive_connected_at = NULL WHERE id = $1",
      [adminId],
    );
    return null;
  }
}

const connectLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  keyGenerator: (req) => req.admin.id,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Terlalu banyak percobaan menghubungkan Drive. Coba lagi nanti.",
  },
});

router.post(
  "/connect",
  connectLimiter,
  asyncHandler(async (req, res) => {
    assertConfigured();

    const code = typeof req.body.code === "string" ? req.body.code : "";
    if (!code)
      throw new HttpError(400, "Kode otorisasi Google tidak ditemukan.");

    const client = newOAuthClient();
    let tokens;
    try {
      // redirect_uri WAJIB 'postmessage' untuk popup code flow - lihat catatan di atas file.
      ({ tokens } = await client.getToken({
        code,
        redirect_uri: "postmessage",
      }));
    } catch (err) {
      throw new HttpError(
        400,
        'Google menolak kode otorisasi ini. Coba klik "Hubungkan Google Drive" lagi dari awal.',
      );
    }

    if (!tokens.refresh_token) {
      // Google cuma mengirim refresh_token sekali (saat consent pertama kali, atau kalau
      // prompt=consent dipaksa). Kalau frontend lupa set access_type/prompt yang benar,
      // ini yang bakal kejadian terus-menerus.
      throw new HttpError(
        400,
        "Google tidak memberi izin jangka panjang (refresh token). Pastikan frontend meminta " +
          "access_type=offline&prompt=consent, lalu coba hubungkan ulang.",
      );
    }

    await query(
      "UPDATE admins SET drive_refresh_token = $1, drive_connected_at = now(), updated_at = now() WHERE id = $2",
      [encrypt(tokens.refresh_token), req.admin.id],
    );

    res.json({ driveConnected: true });
  }),
);

router.post(
  "/disconnect",
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      "SELECT drive_refresh_token FROM admins WHERE id = $1",
      [req.admin.id],
    );
    const encrypted = rows[0] && rows[0].drive_refresh_token;

    if (encrypted && config.encryptionKey) {
      // Best-effort: cabut token di sisi Google juga, bukan cuma lupakan di DB kita.
      // Kalau tokennya sudah invalid/dicabut duluan oleh admin, biarkan saja.
      try {
        const client = newOAuthClient();
        await client.revokeToken(decrypt(encrypted));
      } catch (err) {
        // sengaja diam - disconnect tetap lanjut
      }
    }

    await query(
      "UPDATE admins SET drive_refresh_token = NULL, drive_connected_at = NULL WHERE id = $1",
      [req.admin.id],
    );
    res.json({ driveConnected: false });
  }),
);

// Dipakai frontend sesaat sebelum membuka Google Picker - token ini SENGAJA berumur
// pendek (dari Google, biasanya ~1 jam) dan scope-nya cuma drive.file, jadi aman
// diteruskan ke browser untuk satu sesi Picker. Refresh token aslinya tidak pernah
// meninggalkan server.
router.get(
  "/picker-token",
  asyncHandler(async (req, res) => {
    const accessToken = await getAccessTokenForAdmin(req.admin.id);
    if (!accessToken) {
      throw new HttpError(
        409,
        "Google Drive belum terhubung. Hubungkan dulu dari dashboard.",
      );
    }
    res.json({ accessToken, scope: DRIVE_FILE_SCOPE });
  }),
);

module.exports = router;
module.exports.getAccessTokenForAdmin = getAccessTokenForAdmin;
