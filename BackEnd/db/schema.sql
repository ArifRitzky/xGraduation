-- =====================================================================
-- Photo Proofing - skema database (PostgreSQL / Neon)
-- Aman dijalankan berulang kali (CREATE ... IF NOT EXISTS).
-- =====================================================================

-- ---------------------------------------------------------------------
-- admins: akun fotografer/admin.
-- "Sudah login" dan "Drive sudah terhubung" adalah dua status berbeda:
--   - login password   -> password_hash terisi
--   - login Google SSO -> google_sub terisi
--   - Drive terhubung  -> drive_refresh_token + drive_connected_at (TIDAK DIPAKAI, lihat bawah)
--
-- drive_refresh_token & drive_connected_at: sempat dibangun untuk fitur "Hubungkan Google Drive"
-- per-admin (OAuth scope drive.file + Google Picker, supaya folder tidak perlu di-set publik).
-- DIBATALKAN: scope drive.file cuma memberi akses ke file yang eksplisit dipilih user di Picker --
-- memilih FOLDER tidak memberi akses ke ISI foldernya, jadi daftar foto akan selalu kosong.
-- Untuk akses folder yang privat & auto-update perlu scope drive.readonly/drive yang lebih luas,
-- yang berarti proses verifikasi Google (bisa termasuk security assessment berbayar) dan token
-- kedaluwarsa tiap 7 hari selama status "Testing" -- tidak sepadan untuk skala proyek ini.
-- Kolom dibiarkan (tidak dipakai kode manapun) kalau suatu saat mau dipertimbangkan ulang.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admins (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                TEXT NOT NULL UNIQUE,
  name                 TEXT NOT NULL,
  password_hash        TEXT,
  google_sub           TEXT UNIQUE,
  drive_refresh_token  TEXT,
  drive_connected_at   TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT admins_email_lowercase CHECK (email = lower(email)),
  CONSTRAINT admins_has_login_method CHECK (password_hash IS NOT NULL OR google_sub IS NOT NULL)
);

-- ---------------------------------------------------------------------
-- Verifikasi email & lupa password: token TIDAK disimpan mentah, hanya hash
-- SHA-256-nya (lihat utils/tokens.js hashResetToken). Kalau database bocor,
-- token yang ada di email orang tetap tidak bisa dipakai langsung.
-- Ditambahkan lewat ALTER supaya aman dijalankan ulang di database yang
-- sudah berisi data (CREATE TABLE IF NOT EXISTS di atas tidak menambah
-- kolom baru ke tabel yang sudah ada).
-- ---------------------------------------------------------------------
ALTER TABLE admins ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS email_verify_token_hash TEXT;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS email_verify_token_expires TIMESTAMPTZ;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS password_reset_token_hash TEXT;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS password_reset_token_expires TIMESTAMPTZ;

-- Akun yang login lewat Google saja (tidak ada password_hash) dianggap sudah
-- terverifikasi sejak awal (dibuat sekali untuk baris yang sudah ada sebelum
-- kolom ini ditambahkan; baris baru diisi langsung oleh routes/auth.js).
UPDATE admins SET email_verified_at = created_at
WHERE email_verified_at IS NULL AND password_hash IS NULL AND google_sub IS NOT NULL;

-- ---------------------------------------------------------------------
-- projects: satu baris = satu client / satu link.
-- id berupa UUID karena dipakai langsung di URL publik (/client/:id),
-- jadi tidak bisa ditebak dengan mengganti angka.
-- client_password_hash boleh NULL: artinya link tidak dikunci password.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id              UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  drive_folder_link     TEXT NOT NULL,
  drive_folder_id       TEXT NOT NULL,
  whatsapp_number       TEXT NOT NULL,
  max_selection         INTEGER NOT NULL DEFAULT 10,
  client_password_hash  TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT projects_whatsapp_format CHECK (whatsapp_number ~ '^[0-9]{9,15}$'),
  CONSTRAINT projects_max_selection_range CHECK (max_selection BETWEEN 1 AND 500)
);

CREATE INDEX IF NOT EXISTS projects_admin_idx ON projects (admin_id, created_at DESC);

-- ---------------------------------------------------------------------
-- selections: riwayat foto yang dikirim client (OPSIONAL).
-- Belum ada endpoint yang memakainya. Kalau kamu memutuskan pilihan foto
-- cukup lewat WhatsApp, tabel ini boleh dibuang.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS selections (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_names    TEXT[] NOT NULL,
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS selections_project_idx ON selections (project_id, submitted_at DESC);
