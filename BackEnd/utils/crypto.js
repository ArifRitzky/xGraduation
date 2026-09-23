// utils/crypto.js
// Enkripsi/dekripsi refresh token Drive sebelum disimpan ke database.
// AES-256-GCM: authenticated encryption - ciphertext yang dirusak (tampered)
// ketahuan saat didekripsi (throw), bukan diam-diam menghasilkan data salah.
const crypto = require("crypto");
const config = require("../config");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // rekomendasi standar untuk GCM

function getKey() {
  if (!config.encryptionKey) {
    throw new Error(
      "ENCRYPTION_KEY belum diisi di .env. Generate dengan: " +
        `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    );
  }
  const key = Buffer.from(config.encryptionKey, "hex");
  if (key.length !== 32) {
    throw new Error(
      "ENCRYPTION_KEY harus 32 byte dalam hex (64 karakter heksadesimal).",
    );
  }
  return key;
}

// Format tersimpan: "iv:authTag:ciphertext", masing-masing base64.
function encrypt(plaintext) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

function decrypt(stored) {
  const parts = typeof stored === "string" ? stored.split(":") : [];
  const [ivB64, authTagB64, ciphertextB64] = parts;
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error(
      "Format data terenkripsi tidak valid (rusak atau bukan hasil encrypt()).",
    );
  }
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getKey(),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

module.exports = { encrypt, decrypt };
