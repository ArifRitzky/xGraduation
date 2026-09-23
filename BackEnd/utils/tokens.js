const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { jwtSecret, isProd } = require('../config');

const ADMIN_COOKIE = 'pp_admin';
const clientCookieName = (projectId) => `pp_client_${projectId}`;

// Cookie httpOnly: tidak bisa dibaca JavaScript di browser, jadi aman dari pencurian lewat XSS.
// Di produksi frontend dan backend biasanya beda domain, jadi butuh SameSite=None + Secure.
const cookieBase = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? 'none' : 'lax',
  path: '/',
};

const ADMIN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CLIENT_TTL_MS = 24 * 60 * 60 * 1000;

const signAdminToken = (adminId) =>
  jwt.sign({ typ: 'admin' }, jwtSecret, { subject: adminId, expiresIn: '7d', algorithm: 'HS256' });

const signClientToken = (projectId) =>
  jwt.sign({ typ: 'client' }, jwtSecret, { subject: projectId, expiresIn: '24h', algorithm: 'HS256' });

function verify(token, expectedType) {
  if (typeof token !== 'string' || !token) return null;
  try {
    const payload = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
    return payload.typ === expectedType ? payload : null;
  } catch {
    return null;
  }
}

const verifyAdminToken = (token) => verify(token, 'admin');

// ---------------------------------------------------------------------
// Token verifikasi email & reset password: bukan JWT, karena tidak perlu
// "dibaca" - cukup string acak yang dikirim ke email, lalu dicocokkan
// dengan HASH-nya di database (jangan pernah simpan token mentah-mentah).
// Kalau database bocor, hash ini tidak bisa dipakai untuk menyamar sebagai
// pemilik email (beda dengan menyimpan tokennya langsung).
// ---------------------------------------------------------------------
const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // 24 jam
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000; // 30 menit

function generateRawToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashRawToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

// Token client hanya berlaku untuk project yang sama dengan yang dibuka.
function verifyClientToken(token, projectId) {
  const payload = verify(token, 'client');
  return payload && payload.sub === projectId ? payload : null;
}

module.exports = {
  ADMIN_COOKIE,
  ADMIN_TTL_MS,
  CLIENT_TTL_MS,
  cookieBase,
  clientCookieName,
  signAdminToken,
  signClientToken,
  verifyAdminToken,
  verifyClientToken,
  EMAIL_VERIFY_TTL_MS,
  PASSWORD_RESET_TTL_MS,
  generateRawToken,
  hashRawToken,
};
