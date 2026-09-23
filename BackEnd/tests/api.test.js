// Tes level API: aplikasi Express asli, tetapi database diganti versi di memori
// dan Google Drive diganti server tiruan. Tidak ada koneksi keluar.
process.env.JWT_SECRET = 'x'.repeat(48);
process.env.DATABASE_URL = 'postgresql://tidak-dipakai';
process.env.GOOGLE_API_KEY = 'test-key-123';
process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';

const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('node:crypto');
const { OAuth2Client } = require('google-auth-library');

// --- database tiruan (dipasang sebelum route dimuat) -------------------------------------------
const ADMIN_ID = '99999999-9999-4999-8999-999999999999';
const LOCKED_ID = '3f2b8c1e-9a4d-4e7b-8c21-5d6e7f8a9b0c';
const OPEN_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ADMIN_ID = '88888888-8888-4888-8888-888888888888';
const FOLDER = '1AbCdEfGhIjKlMnOpQrStUv';

const projects = {
  [LOCKED_ID]: {
    id: LOCKED_ID,
    admin_id: ADMIN_ID,
    name: 'Wedding J&D',
    whatsapp_number: '6281234567890',
    max_selection: 10,
    client_password_hash: bcrypt.hashSync('rahasia123', 4),
    drive_folder_id: FOLDER,
    drive_folder_link: `https://drive.google.com/drive/folders/${FOLDER}?resourcekey=0-abc_DEF&usp=sharing`,
  },
  [OPEN_ID]: {
    id: OPEN_ID,
    admin_id: ADMIN_ID,
    name: 'Prewedding tanpa password',
    whatsapp_number: '6281234567890',
    max_selection: 5,
    client_password_hash: null,
    drive_folder_id: FOLDER,
    drive_folder_link: `https://drive.google.com/drive/folders/${FOLDER}`,
  },
};

const db = { inserts: 0, updates: 0, projectCount: 0 };
const admins = []; // isi tabel admins (di memori)
const adminRow = (a) => ({
  id: a.id,
  email: a.email,
  name: a.name,
  google_sub: a.google_sub,
  password_hash: a.password_hash || null,
  email_verified_at: a.email_verified_at || null,
});
const projectRow = (id, name, link, phone, max, hasPassword) => ({
  id,
  name,
  drive_folder_link: link,
  whatsapp_number: phone,
  max_selection: max,
  has_password: hasPassword,
  created_at: new Date('2026-09-21T00:00:00Z'),
  updated_at: new Date('2026-09-21T00:00:00Z'),
});

async function fakeQuery(text, params = []) {
  const sql = text.replace(/\s+/g, ' ').trim();
  if (sql.startsWith('SELECT 1')) return { rows: [{}] };
  if (sql.includes('FROM admins WHERE id')) {
    const known = admins.find((a) => a.id === params[0]);
    if (known) return { rows: [adminRow(known)] };
    return {
      rows:
        params[0] === ADMIN_ID || params[0] === OTHER_ADMIN_ID
          ? [{ id: params[0], email: 'a@b.co', name: 'Admin', email_verified_at: new Date() }]
          : [],
    };
  }
  if (sql.startsWith('SELECT id, admin_id, name, whatsapp_number')) return { rows: projects[params[0]] ? [projects[params[0]]] : [] };
  if (sql.startsWith('INSERT INTO projects')) {
    db.inserts += 1;
    const [, name, link, , phone, max, hash] = params;
    return { rows: [projectRow('22222222-2222-4222-8222-222222222222', name, link, phone, max, hash !== null)] };
  }
  if (sql.startsWith('UPDATE projects')) {
    db.updates += 1;
    return { rows: [projectRow(LOCKED_ID, 'Wedding J&D', 'https://drive.google.com/x', '6281234567890', 10, true)] };
  }
  if (sql.startsWith('SELECT COUNT(*)::int AS n FROM projects')) return { rows: [{ n: db.projectCount }] };
  if (sql.includes('FROM admins WHERE google_sub = $1')) return { rows: admins.filter((a) => a.google_sub === params[0]).map(adminRow) };
  if (sql.includes('FROM admins WHERE email = $1')) return { rows: admins.filter((a) => a.email === params[0]).map(adminRow) };
  if (sql.includes('FROM admins') && sql.includes('WHERE password_reset_token_hash = $1')) {
    const match = admins.find((a) => a.password_reset_token_hash === params[0] && a.password_reset_token_expires > Date.now());
    return { rows: match ? [adminRow(match)] : [] };
  }
  if (sql.includes('FROM admins') && sql.includes('WHERE email_verify_token_hash = $1')) {
    const match = admins.find((a) => a.email_verify_token_hash === params[0] && a.email_verify_token_expires > Date.now());
    return { rows: match ? [adminRow(match)] : [] };
  }
  if (sql.startsWith('INSERT INTO admins') && sql.includes('google_sub, email_verified_at')) {
    const row = {
      id: randomUUID(),
      email: params[0],
      name: params[1],
      google_sub: params[2],
      password_hash: null,
      email_verified_at: new Date(),
    };
    admins.push(row);
    return { rows: [adminRow(row)] };
  }
  if (sql.startsWith('INSERT INTO admins') && sql.includes('email_verify_token_hash, email_verify_token_expires')) {
    const row = {
      id: randomUUID(),
      email: params[0],
      name: params[1],
      google_sub: null,
      password_hash: params[2],
      email_verify_token_hash: params[3],
      email_verify_token_expires: Date.now() + 24 * 60 * 60 * 1000,
      email_verified_at: null,
    };
    admins.push(row);
    return { rows: [adminRow(row)] };
  }
  if (sql.startsWith('UPDATE admins SET google_sub = $1')) {
    const target = admins.find((a) => a.id === params[1]);
    if (target) {
      target.google_sub = params[0];
      if (!target.email_verified_at) target.email_verified_at = new Date();
    }
    return { rows: [] };
  }
  if (sql.startsWith('UPDATE admins SET password_reset_token_hash = $1')) {
    const target = admins.find((a) => a.id === params[1]);
    if (target) {
      target.password_reset_token_hash = params[0];
      target.password_reset_token_expires = Date.now() + 30 * 60 * 1000;
    }
    return { rows: [] };
  }
  if (sql.startsWith('UPDATE admins') && sql.includes('SET password_hash = $1, password_reset_token_hash = NULL')) {
    const target = admins.find((a) => a.id === params[1]);
    if (target) {
      target.password_hash = params[0];
      target.password_reset_token_hash = null;
      target.password_reset_token_expires = null;
      if (!target.email_verified_at) target.email_verified_at = new Date();
    }
    return { rows: [] };
  }
  if (sql.startsWith('UPDATE admins') && sql.includes('SET email_verified_at = now(), email_verify_token_hash = NULL')) {
    const target = admins.find((a) => a.id === params[0]);
    if (target) {
      target.email_verified_at = new Date();
      target.email_verify_token_hash = null;
      target.email_verify_token_expires = null;
    }
    return { rows: [] };
  }
  if (sql.startsWith('UPDATE admins SET email_verify_token_hash = $1')) {
    const target = admins.find((a) => a.id === params[1]);
    if (target) {
      target.email_verify_token_hash = params[0];
      target.email_verify_token_expires = Date.now() + 24 * 60 * 60 * 1000;
    }
    return { rows: [] };
  }
  throw new Error(`Query tidak dikenal di tes: ${sql}`);
}

const dbPath = require.resolve('../db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: fakeQuery, pool: {} } };

const config = require('../config');
const drive = require('../utils/drive');
const { signAdminToken, signClientToken } = require('../utils/tokens');
const app = require('../index');
const { startMockDrive, googleError, file } = require('./support/mock-drive');

// Google Sign-In tiruan: isi "token"-nya langsung berupa JSON payload. "TOKEN-RUSAK" ditolak seperti token palsu.
const googleCalls = [];
OAuth2Client.prototype.verifyIdToken = async function ({ idToken, audience }) {
  googleCalls.push({ audience });
  if (idToken === 'TOKEN-RUSAK') throw new Error('Invalid token signature');
  return { getPayload: () => JSON.parse(idToken) };
};

// --- setup -------------------------------------------------------------------------------------
let mock;
let server;
let base;
const originalError = console.error;

test.before(async () => {
  console.error = () => {};
  mock = await startMockDrive();
  config.driveApiBase = mock.baseUrl;
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  console.error = originalError;
  await new Promise((resolve) => server.close(resolve));
  await mock.close();
});

test.beforeEach(() => {
  mock.reset();
  drive.clearCache();
  config.googleApiKey = 'test-key-123';
  db.inserts = 0;
  db.updates = 0;
  db.projectCount = 0;
  admins.length = 0;
  googleCalls.length = 0;
  config.allowPasswordSignup = false;
  config.appUrl = 'http://localhost:5500';
});

const okFiles = () => ({ status: 200, body: { files: [file('DSC001.jpg'), file('DSC002.jpg')] } });
const adminCookie = () => `pp_admin=${signAdminToken(ADMIN_ID)}`;
const clientCookie = (id) => `pp_client_${id}=${signClientToken(id)}`;

async function call(path, { method = 'GET', cookie, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null), res };
}

// --- GET /api/client/:id/photos ----------------------------------------------------------------
test('foto: project berpassword dan belum dibuka -> 401, Google TIDAK dihubungi', async () => {
  const { status, json } = await call(`/api/client/${LOCKED_ID}/photos`);
  assert.equal(status, 401);
  assert.equal(json.requiresPassword, true);
  assert.equal(json.photos, undefined);
  assert.equal(mock.requests.length, 0);
});

test('foto: alur lengkap unlock -> daftar foto', async () => {
  mock.handler = okFiles;

  const wrong = await call(`/api/client/${LOCKED_ID}/unlock`, { method: 'POST', body: { password: 'salah' } });
  assert.equal(wrong.status, 401);

  const unlock = await call(`/api/client/${LOCKED_ID}/unlock`, { method: 'POST', body: { password: 'rahasia123' } });
  assert.equal(unlock.status, 200);
  const setCookie = unlock.res.headers.getSetCookie ? unlock.res.headers.getSetCookie()[0] : unlock.res.headers.get('set-cookie');
  const cookie = setCookie.split(';')[0];

  const { status, json } = await call(`/api/client/${LOCKED_ID}/photos`, { cookie });
  assert.equal(status, 200);
  assert.deepEqual(json.photos.map((p) => p.name), ['DSC001.jpg', 'DSC002.jpg']);
  assert.equal(json.total, 2);
  assert.match(json.photos[0].thumb, /=s480$/);
  assert.match(json.photos[0].full, /=s1600$/);

  // resource key dari link project diteruskan ke Google
  assert.equal(mock.requests[0].headers['x-goog-drive-resource-keys'], `${FOLDER}/0-abc_DEF`);
  assert.equal(mock.requests[0].query.q.includes(`'${FOLDER}' in parents`), true);
});

test('foto: cookie milik project lain ditolak', async () => {
  const { status } = await call(`/api/client/${LOCKED_ID}/photos`, { cookie: clientCookie(OPEN_ID).replace(OPEN_ID, LOCKED_ID) });
  assert.equal(status, 401);
  assert.equal(mock.requests.length, 0);
});

test('foto: cookie palsu ditolak', async () => {
  const { status } = await call(`/api/client/${LOCKED_ID}/photos`, { cookie: `pp_client_${LOCKED_ID}=bukan-token` });
  assert.equal(status, 401);
});

// --- Admin pemilik project boleh membuka tanpa password client (klik "Preview" di dashboard) -------
test('foto: admin PEMILIK project boleh membuka project berpassword tanpa password client', async () => {
  mock.handler = okFiles;
  const { status, json } = await call(`/api/client/${LOCKED_ID}/photos`, { cookie: adminCookie() });
  assert.equal(status, 200);
  assert.equal(json.total, 2);
});

test('client: admin pemilik langsung terbuka, dan melihat nomor WhatsApp + batas foto', async () => {
  const { status, json } = await call(`/api/client/${LOCKED_ID}`, { cookie: adminCookie() });
  assert.equal(status, 200);
  assert.equal(json.unlocked, true);
  assert.equal(json.maxSelection, 10);
  assert.equal(json.whatsappNumber, '6281234567890');
});

test('foto: admin LAIN (bukan pemilik) TIDAK boleh melewati password, Google tidak dihubungi', async () => {
  const otherAdmin = `pp_admin=${signAdminToken(OTHER_ADMIN_ID)}`;
  const photos = await call(`/api/client/${LOCKED_ID}/photos`, { cookie: otherAdmin });
  assert.equal(photos.status, 401);
  assert.equal(mock.requests.length, 0);

  const info = await call(`/api/client/${LOCKED_ID}`, { cookie: otherAdmin });
  assert.equal(info.json.unlocked, false);
  assert.equal(info.json.whatsappNumber, undefined);
});

test('foto: cookie admin palsu tidak membuka apa pun', async () => {
  const { status } = await call(`/api/client/${LOCKED_ID}/photos`, { cookie: 'pp_admin=bukan-token' });
  assert.equal(status, 401);
});

test('foto: token client tidak bisa dipakai sebagai token admin', async () => {
  const { status } = await call(`/api/client/${LOCKED_ID}/photos`, { cookie: `pp_admin=${signClientToken(LOCKED_ID)}` });
  assert.equal(status, 401);
  assert.equal(mock.requests.length, 0);
});

test('foto: project tanpa password bisa dibuka langsung', async () => {
  mock.handler = okFiles;
  const { status, json } = await call(`/api/client/${OPEN_ID}/photos`);
  assert.equal(status, 200);
  assert.equal(json.total, 2);
  // link tanpa resourcekey -> header tidak dikirim
  assert.equal(mock.requests[0].headers['x-goog-drive-resource-keys'], undefined);
});

test('foto: ID tidak dikenal atau bukan UUID -> 404', async () => {
  assert.equal((await call('/api/client/44444444-4444-4444-8444-444444444444/photos')).status, 404);
  assert.equal((await call('/api/client/bukan-uuid/photos')).status, 404);
});

test('foto: folder belum dibagikan -> 502, pesan aman untuk pelanggan', async () => {
  mock.handler = () => googleError(404, 'File not found', 'notFound');
  const { status, json } = await call(`/api/client/${OPEN_ID}/photos`);
  assert.equal(status, 502);
  assert.match(json.error, /Hubungi pemilik studio/);
  assert.doesNotMatch(json.error, /Anyone|API|key/i);
});

test('foto: kuota Google habis -> 503', async () => {
  mock.handler = () => googleError(403, 'Rate Limit Exceeded', 'rateLimitExceeded');
  const { status } = await call(`/api/client/${OPEN_ID}/photos`);
  assert.equal(status, 503);
});

test('foto: GOOGLE_API_KEY kosong -> 503, bukan crash', async () => {
  config.googleApiKey = '';
  const { status, json } = await call(`/api/client/${OPEN_ID}/photos`);
  assert.equal(status, 503);
  assert.doesNotMatch(json.error, /GOOGLE_API_KEY/);
});

test('endpoint client yang lama tetap bekerja (tidak ada regresi)', async () => {
  const before = await call(`/api/client/${LOCKED_ID}`);
  assert.equal(before.status, 200);
  assert.equal(before.json.requiresPassword, true);
  assert.equal(before.json.whatsappNumber, undefined); // tidak bocor sebelum password benar
  assert.equal(before.json.maxSelection, undefined);
  assert.equal(before.json.driveFolderLink, undefined);
  assert.equal(before.json.drive_folder_id, undefined);

  const open = await call(`/api/client/${OPEN_ID}`);
  assert.equal(open.json.whatsappNumber, '6281234567890');
  assert.equal(open.json.drive_folder_id, undefined);
});

// --- POST/PATCH /api/projects: verifikasi folder ------------------------------------------------
const goodBody = (link) => ({
  name: 'Wedding Baru',
  driveFolderLink: link,
  whatsappNumber: '0812-3456-7890',
  maxSelection: 12,
  clientPassword: 'rahasia123',
});
const goodLink = `https://drive.google.com/drive/folders/${FOLDER}?usp=sharing`;

test('buat project: butuh login admin', async () => {
  const { status } = await call('/api/projects', { method: 'POST', body: goodBody(goodLink) });
  assert.equal(status, 401);
  assert.equal(mock.requests.length, 0);
});

test('buat project: folder valid -> 201, tanpa peringatan', async () => {
  mock.handler = () => ({ status: 200, body: { id: FOLDER, name: 'Wedding', mimeType: 'application/vnd.google-apps.folder' } });
  const { status, json } = await call('/api/projects', { method: 'POST', cookie: adminCookie(), body: goodBody(goodLink) });
  assert.equal(status, 201);
  assert.equal(json.project.name, 'Wedding Baru');
  assert.equal(json.project.whatsappNumber, '6281234567890');
  assert.equal(json.driveWarning, undefined);
  assert.equal(db.inserts, 1);
  assert.equal(mock.requests[0].path, `/drive/v3/files/${FOLDER}`);
});

test('buat project: folder belum dibagikan -> 400 dengan petunjuk, TIDAK disimpan', async () => {
  mock.handler = () => googleError(404, 'File not found', 'notFound');
  const { status, json } = await call('/api/projects', { method: 'POST', cookie: adminCookie(), body: goodBody(goodLink) });
  assert.equal(status, 400);
  assert.match(json.error, /Anyone with the link/);
  assert.equal(db.inserts, 0);
});

test('buat project: link ke file (bukan folder) -> 400, TIDAK disimpan', async () => {
  mock.handler = () => ({ status: 200, body: { id: FOLDER, name: 'foto.jpg', mimeType: 'image/jpeg' } });
  const { status, json } = await call('/api/projects', { method: 'POST', cookie: adminCookie(), body: goodBody(goodLink) });
  assert.equal(status, 400);
  assert.match(json.error, /bukan folder/);
  assert.equal(db.inserts, 0);
});

test('buat project: Google sedang bermasalah -> tetap tersimpan + driveWarning', async () => {
  mock.handler = () => ({ status: 503, body: {} });
  const { status, json } = await call('/api/projects', { method: 'POST', cookie: adminCookie(), body: goodBody(goodLink) });
  assert.equal(status, 201);
  assert.match(json.driveWarning, /Google Drive/);
  assert.equal(db.inserts, 1);
});

test('buat project: API key belum diisi -> tetap tersimpan + driveWarning yang menyebut GOOGLE_API_KEY', async () => {
  config.googleApiKey = '';
  const { status, json } = await call('/api/projects', { method: 'POST', cookie: adminCookie(), body: goodBody(goodLink) });
  assert.equal(status, 201);
  assert.match(json.driveWarning, /GOOGLE_API_KEY/);
  assert.equal(mock.requests.length, 0);
});

test('buat project: validasi field lain tetap berjalan sebelum menghubungi Google', async () => {
  const bad = { ...goodBody(goodLink), whatsappNumber: 'abc' };
  const { status } = await call('/api/projects', { method: 'POST', cookie: adminCookie(), body: bad });
  assert.equal(status, 400);
  assert.equal(mock.requests.length, 0);
});

test('ubah project: hanya memeriksa Google kalau link folder ikut diubah', async () => {
  const noLink = await call(`/api/projects/${LOCKED_ID}`, { method: 'PATCH', cookie: adminCookie(), body: { maxSelection: 15 } });
  assert.equal(noLink.status, 200);
  assert.equal(mock.requests.length, 0);

  mock.handler = () => googleError(404, 'File not found', 'notFound');
  const withLink = await call(`/api/projects/${LOCKED_ID}`, { method: 'PATCH', cookie: adminCookie(), body: { driveFolderLink: goodLink } });
  assert.equal(withLink.status, 400);
  assert.equal(db.updates, 1); // hanya PATCH pertama yang sampai ke database
});

// --- Batas project per admin & laju pembuatan project (pendaftaran terbuka, kuota Google dipakai bersama) ---
test('buat project: batas jumlah project per akun tercapai -> 403, Google TIDAK dihubungi', async () => {
  db.projectCount = config.maxProjectsPerAdmin;
  const { status, json } = await call('/api/projects', { method: 'POST', cookie: adminCookie(), body: goodBody(goodLink) });
  assert.equal(status, 403);
  assert.match(json.error, new RegExp(`Batas ${config.maxProjectsPerAdmin} project`));
  assert.equal(mock.requests.length, 0);
  assert.equal(db.inserts, 0);
});

test('buat project: satu di bawah batas masih boleh', async () => {
  db.projectCount = config.maxProjectsPerAdmin - 1;
  mock.handler = () => ({ status: 200, body: { id: FOLDER, name: 'Wedding', mimeType: 'application/vnd.google-apps.folder' } });
  const { status } = await call('/api/projects', { method: 'POST', cookie: adminCookie(), body: goodBody(goodLink) });
  assert.equal(status, 201);
});

test('buat project: dibatasi 30x per jam PER ADMIN, admin lain tidak ikut terhambat', async () => {
  const other = `pp_admin=${signAdminToken(OTHER_ADMIN_ID)}`;
  const statuses = [];
  for (let i = 0; i < 31; i += 1) {
    statuses.push((await call('/api/projects', { method: 'POST', cookie: other, body: {} })).status);
  }
  assert.deepEqual(statuses.slice(0, 30), Array(30).fill(400)); // ditolak validasi, tapi tetap dihitung
  assert.equal(statuses[30], 429);
  assert.equal(mock.requests.length, 0);

  // admin utama tidak terpengaruh
  const main = await call('/api/projects', { method: 'POST', cookie: adminCookie(), body: {} });
  assert.equal(main.status, 400);
});

// --- Pendaftaran terbuka: hanya lewat Google secara default -----------------------------------------
const gToken = (over = {}) =>
  JSON.stringify({ sub: 'g-sub-1', email: 'Foto@Studio.co', email_verified: true, name: 'Rina Fotografer', ...over });
const loginGoogle = (credential) => call('/api/auth/google', { method: 'POST', body: { credential } });
const addAdmin = (over = {}) => {
  const a = { id: randomUUID(), email: 'x@y.co', name: 'X', google_sub: null, password_hash: null, ...over };
  admins.push(a);
  return a;
};

test('opsi pendaftaran: Google aktif, email + password ditutup secara default', async () => {
  const { status, json } = await call('/api/auth/options');
  assert.equal(status, 200);
  assert.deepEqual(json, { googleLogin: true, passwordSignup: false });
});

test('daftar email + password: ditolak 403 secara default, tidak ada akun dibuat', async () => {
  const { status, json } = await call('/api/auth/register', {
    method: 'POST',
    body: { name: 'Penyerang', email: 'korban@studio.co', password: 'password-penyerang' },
  });
  assert.equal(status, 403);
  assert.match(json.error, /Google/);
  assert.equal(admins.length, 0);
});

test('daftar email + password: tetap berfungsi kalau sengaja dinyalakan', async () => {
  config.allowPasswordSignup = true;
  const { status } = await call('/api/auth/register', {
    method: 'POST',
    body: { name: 'Budi', email: 'budi@studio.co', password: 'password-budi-1' },
  });
  assert.equal(status, 201);
  assert.equal(admins.length, 1);
  assert.equal((await call('/api/auth/options')).json.passwordSignup, true);
});

test('google: email baru -> akun dibuat otomatis (email huruf kecil), cookie sesi terkirim', async () => {
  const { status, json, res } = await loginGoogle(gToken());
  assert.equal(status, 200);
  assert.equal(admins.length, 1);
  assert.equal(admins[0].email, 'foto@studio.co');
  assert.equal(admins[0].google_sub, 'g-sub-1');
  assert.equal(admins[0].password_hash, null);
  assert.equal(json.admin.id, admins[0].id);
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie().join(';') : res.headers.get('set-cookie');
  assert.match(setCookie, /pp_admin=/);
  assert.equal(googleCalls[0].audience, process.env.GOOGLE_CLIENT_ID); // token dicek untuk client ID kita
});

test('google: akun dengan email itu sudah ada -> ditautkan, tidak dibuat ganda', async () => {
  const existing = addAdmin({ email: 'foto@studio.co', password_hash: 'hash' });
  const { status, json } = await loginGoogle(gToken());
  assert.equal(status, 200);
  assert.equal(admins.length, 1);
  assert.equal(existing.google_sub, 'g-sub-1');
  assert.equal(json.admin.id, existing.id);
});

test('google: dicari lewat ID Google lebih dulu, bukan email (mencegah salah akun)', async () => {
  const byEmail = addAdmin({ email: 'foto@studio.co' });
  const bySub = addAdmin({ email: 'email-lama@studio.co', google_sub: 'g-sub-1' });
  const { status, json } = await loginGoogle(gToken());
  assert.equal(status, 200);
  assert.equal(json.admin.id, bySub.id);
  assert.equal(byEmail.google_sub, null); // akun lain tidak disentuh
  assert.equal(admins.length, 2);
});

test('google: email belum terverifikasi atau tidak ada penandanya -> 401, tidak ada akun dibuat', async () => {
  for (const payload of [{ email_verified: false }, { email_verified: undefined }, { email_verified: 'false' }]) {
    assert.equal((await loginGoogle(gToken(payload))).status, 401);
  }
  assert.equal(admins.length, 0);
});

test('google: email sama tetapi akun Google berbeda -> 403', async () => {
  addAdmin({ email: 'foto@studio.co', google_sub: 'sub-milik-orang-lain' });
  const { status } = await loginGoogle(gToken());
  assert.equal(status, 403);
});

// --- Lupa password / reset password ------------------------------------------------------------

test('lupa password: akun ada dan punya password -> token tersimpan, respons generik', async () => {
  const admin = addAdmin({ email: 'foto@studio.co', password_hash: 'hash-lama' });
  const { status, json } = await call('/api/auth/forgot-password', {
    method: 'POST',
    body: { email: 'Foto@Studio.co' },
  });
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.notEqual(admin.password_reset_token_hash, undefined);
  assert.equal(admin.password_reset_token_hash !== null, true);
});

test('lupa password: email tidak terdaftar -> respons sama (200), tidak membocorkan apa pun', async () => {
  const { status, json } = await call('/api/auth/forgot-password', {
    method: 'POST',
    body: { email: 'tidak-ada@studio.co' },
  });
  assert.equal(status, 200);
  assert.equal(json.ok, true);
});

test('lupa password: akun login Google saja (tanpa password) -> tetap 200, token TIDAK dibuat', async () => {
  const admin = addAdmin({ email: 'google-only@studio.co', google_sub: 'g-only', password_hash: null });
  const { status } = await call('/api/auth/forgot-password', {
    method: 'POST',
    body: { email: 'google-only@studio.co' },
  });
  assert.equal(status, 200);
  assert.equal(admin.password_reset_token_hash, undefined);
});

test('lupa password: APP_URL belum diisi -> 503', async () => {
  config.appUrl = '';
  const { status } = await call('/api/auth/forgot-password', {
    method: 'POST',
    body: { email: 'siapapun@studio.co' },
  });
  assert.equal(status, 503);
});

test('reset password: token valid -> password diganti, sesi baru diberikan, token dipakai sekali', async () => {
  const admin = addAdmin({ email: 'foto@studio.co', password_hash: 'hash-lama' });
  await call('/api/auth/forgot-password', { method: 'POST', body: { email: admin.email } });
  // Token asli dikirim lewat email (di tes, kita tidak punya inbox sungguhan) - jadi di sini kita
  // buat token baru dan menaruh hash-nya langsung, persis seperti yang dilakukan endpoint.
  const { generateRawToken, hashRawToken } = require('../utils/tokens');
  const token = generateRawToken();
  admin.password_reset_token_hash = hashRawToken(token);
  admin.password_reset_token_expires = Date.now() + 30 * 60 * 1000;

  const { status, json, res } = await call('/api/auth/reset-password', {
    method: 'POST',
    body: { token, password: 'password-baru-1' },
  });
  assert.equal(status, 200);
  assert.equal(json.admin.email, 'foto@studio.co');
  assert.equal(await bcrypt.compare('password-baru-1', admin.password_hash), true);
  assert.equal(admin.password_reset_token_hash, null);
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie().join(';') : res.headers.get('set-cookie');
  assert.match(setCookie, /pp_admin=/);

  const reuse = await call('/api/auth/reset-password', {
    method: 'POST',
    body: { token, password: 'password-baru-2' },
  });
  assert.equal(reuse.status, 400);
});

test('reset password: token salah atau kedaluwarsa -> 400', async () => {
  const { status } = await call('/api/auth/reset-password', {
    method: 'POST',
    body: { token: 'token-tidak-valid', password: 'password-apapun' },
  });
  assert.equal(status, 400);
});

test('reset password: password kurang dari 8 karakter -> 400', async () => {
  const { status } = await call('/api/auth/reset-password', {
    method: 'POST',
    body: { token: 'apapun', password: 'pendek' },
  });
  assert.equal(status, 400);
});

// --- Verifikasi email ----------------------------------------------------------------------------

test('verifikasi email: token valid -> email_verified_at terisi, token dipakai sekali', async () => {
  const { generateRawToken, hashRawToken } = require('../utils/tokens');
  const token = generateRawToken();
  const admin = addAdmin({
    email: 'baru@studio.co',
    password_hash: 'hash',
    email_verify_token_hash: hashRawToken(token),
    email_verify_token_expires: Date.now() + 24 * 60 * 60 * 1000,
  });

  const { status, json } = await call('/api/auth/verify-email', { method: 'POST', body: { token } });
  assert.equal(status, 200);
  assert.equal(json.admin.emailVerified, true);
  assert.notEqual(admin.email_verified_at, null);

  const reuse = await call('/api/auth/verify-email', { method: 'POST', body: { token } });
  assert.equal(reuse.status, 400);
});

test('verifikasi email: token salah -> 400', async () => {
  const { status } = await call('/api/auth/verify-email', { method: 'POST', body: { token: 'salah' } });
  assert.equal(status, 400);
});

test('kirim ulang verifikasi: butuh sesi admin, akun belum verifikasi -> token baru dibuat', async () => {
  const admin = addAdmin({ id: ADMIN_ID, email: 'a@b.co', password_hash: 'hash', email_verified_at: null });
  const { status, json } = await call('/api/auth/verify-email/resend', {
    method: 'POST',
    cookie: adminCookie(),
  });
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.notEqual(admin.email_verify_token_hash, undefined);
});

test('kirim ulang verifikasi: tanpa sesi -> 401', async () => {
  const { status } = await call('/api/auth/verify-email/resend', { method: 'POST' });
  assert.equal(status, 401);
});

test('google: token palsu -> 401, tidak ada akun dibuat', async () => {
  assert.equal((await loginGoogle('TOKEN-RUSAK')).status, 401);
  assert.equal((await loginGoogle('')).status, 400);
  assert.equal(admins.length, 0);
});
