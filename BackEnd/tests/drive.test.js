process.env.JWT_SECRET = 'x'.repeat(48);
process.env.GOOGLE_API_KEY = 'test-key-123';

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../config');
const drive = require('../utils/drive');
const { startMockDrive, googleError, file } = require('./support/mock-drive');

const FOLDER = '1AbCdEfGhIjKlMnOpQrStUv';

// Semua log error ditangkap: API key tidak boleh pernah muncul di log.
const logged = [];
const originalError = console.error;
let mock;

test.before(async () => {
  console.error = (...args) => logged.push(args.map(String).join(' '));
  mock = await startMockDrive();
  config.driveApiBase = mock.baseUrl;
});

test.after(async () => {
  console.error = originalError;
  await mock.close();
});

test.beforeEach(() => {
  mock.reset();
  drive.clearCache();
  config.googleApiKey = 'test-key-123';
});

test('listFolderImages: request ke Drive benar (query, urutan, key, resource key)', async () => {
  mock.handler = () => ({ status: 200, body: { files: [file('DSC001.jpg')] } });
  await drive.listFolderImages(FOLDER, { resourceKey: '0-abcDEF_1' });

  assert.equal(mock.requests.length, 1);
  const r = mock.requests[0];
  assert.equal(r.path, '/drive/v3/files');
  assert.equal(r.query.q, `'${FOLDER}' in parents and mimeType contains 'image/' and trashed = false`);
  assert.equal(r.query.orderBy, 'name_natural');
  assert.equal(r.query.key, 'test-key-123');
  assert.equal(r.query.supportsAllDrives, 'true');
  assert.equal(r.headers['x-goog-drive-resource-keys'], `${FOLDER}/0-abcDEF_1`);
});

test('listFolderImages: tanpa resource key, header tidak dikirim', async () => {
  mock.handler = () => ({ status: 200, body: { files: [] } });
  await drive.listFolderImages(FOLDER);
  assert.equal(mock.requests[0].headers['x-goog-drive-resource-keys'], undefined);
});

test('listFolderImages: mengikuti nextPageToken, termasuk halaman kosong di tengah', async () => {
  mock.handler = (req) => {
    const t = req.query.pageToken;
    if (!t) return { status: 200, body: { files: [file('DSC001.jpg'), file('DSC002.jpg')], nextPageToken: 'p2' } };
    if (t === 'p2') return { status: 200, body: { files: [], nextPageToken: 'p3' } };
    return { status: 200, body: { files: [file('DSC010.jpg')] } };
  };
  const out = await drive.listFolderImages(FOLDER);
  assert.deepEqual(out.photos.map((p) => p.name), ['DSC001.jpg', 'DSC002.jpg', 'DSC010.jpg']);
  assert.equal(out.total, 3);
  assert.equal(out.truncated, false);
  assert.equal(mock.requests.length, 3);
});

test('listFolderImages: ukuran thumbnail galeri dan preview, serta metadata', async () => {
  mock.handler = () => ({ status: 200, body: { files: [file('DSC001.jpg')] } });
  const [p] = (await drive.listFolderImages(FOLDER)).photos;
  assert.equal(p.id, 'id-DSC001.jpg');
  assert.equal(p.thumb, 'https://lh3.googleusercontent.com/drive-storage/DSC001.jpg=s480');
  assert.equal(p.full, 'https://lh3.googleusercontent.com/drive-storage/DSC001.jpg=s1600');
  assert.equal(p.width, 4000);
  assert.equal(p.height, 6000);
});

test('listFolderImages: foto tanpa thumbnail tidak hilang diam-diam', async () => {
  mock.handler = () => ({
    status: 200,
    body: { files: [file('A.jpg'), file('B.jpg', { thumbnailLink: undefined, imageMediaMetadata: undefined })] },
  });
  const out = await drive.listFolderImages(FOLDER);
  assert.equal(out.total, 2);
  assert.equal(out.withoutThumbnail, 1);
  assert.equal(out.photos[1].thumb, null);
  assert.equal(out.photos[1].width, null);
});

test('listFolderImages: berhenti di batas halaman dan menandai truncated', async () => {
  mock.handler = () => ({ status: 200, body: { files: [file('X.jpg')], nextPageToken: 'lagi' } });
  const out = await drive.listFolderImages(FOLDER);
  assert.equal(mock.requests.length, 5);
  assert.equal(out.truncated, true);
});

test('listFolderImages: hasil di-cache, permintaan kedua tidak ke Google', async () => {
  mock.handler = () => ({ status: 200, body: { files: [file('A.jpg')] } });
  await drive.listFolderImages(FOLDER);
  await drive.listFolderImages(FOLDER);
  assert.equal(mock.requests.length, 1);
});

test('listFolderImages: ID folder yang aneh ditolak tanpa menghubungi Google', async () => {
  await assert.rejects(drive.listFolderImages("abc' or '1'='1"), (e) => e.code === 'FOLDER_INACCESSIBLE');
  await assert.rejects(drive.listFolderImages(undefined), (e) => e.code === 'FOLDER_INACCESSIBLE');
  assert.equal(mock.requests.length, 0);
});

const errorCases = [
  ['404 tidak ditemukan', () => googleError(404, 'File not found: x.', 'notFound'), 'FOLDER_INACCESSIBLE', 502],
  ['403 tanpa izin', () => googleError(403, 'Forbidden', 'forbidden'), 'FOLDER_INACCESSIBLE', 502],
  ['403 kuota per user', () => googleError(403, 'Rate Limit Exceeded', 'userRateLimitExceeded'), 'QUOTA', 503],
  ['429 terlalu banyak', () => ({ status: 429, body: {} }), 'QUOTA', 503],
  ['400 API key tidak valid', () => googleError(400, 'API key not valid. Please pass a valid API key.', 'badRequest'), 'MISCONFIGURED', 503],
  ['403 key dibatasi ke API lain', () => googleError(403, 'Requests to this API are blocked. API_KEY_SERVICE_BLOCKED', 'forbidden'), 'MISCONFIGURED', 503],
  ['403 Drive API belum diaktifkan', () => googleError(403, 'Google Drive API has not been used in project 123 before or it is disabled.', 'accessNotConfigured'), 'MISCONFIGURED', 503],
  ['500 Google bermasalah', () => ({ status: 500, body: {} }), 'UNAVAILABLE', 502],
  ['400 parameter ditolak', () => googleError(400, 'Invalid Value', 'invalid'), 'DRIVE_REJECTED', 502],
];

for (const [label, make, code, status] of errorCases) {
  test(`error dari Google dipetakan benar: ${label}`, async () => {
    mock.handler = make;
    await assert.rejects(drive.listFolderImages(FOLDER), (e) => {
      assert.equal(e.code, code);
      assert.equal(e.status, status);
      return true;
    });
  });
}

test('folder tidak terbaca: jawaban asli Google ikut di petunjuk admin, tidak di pesan pelanggan', async () => {
  mock.handler = () => googleError(404, `File not found: ${FOLDER}.`, 'notFound');
  await assert.rejects(drive.checkFolder(FOLDER), (e) => {
    assert.match(e.adminHint, /Jawaban Google: 404 notFound - File not found/);
    assert.match(e.adminHint, /Anyone with the link/);
    assert.doesNotMatch(e.message, /Google|404|notFound|Anyone/);
    assert.doesNotMatch(e.adminHint, /test-key-123/);
    return true;
  });
  mock.handler = () => googleError(403, 'The caller does not have permission', 'forbidden');
  await assert.rejects(drive.checkFolder(FOLDER), (e) => /Jawaban Google: 403 forbidden/.test(e.adminHint));
});

test('pesan untuk pelanggan tidak membocorkan detail teknis', async () => {
  mock.handler = () => googleError(403, 'API_KEY_SERVICE_BLOCKED', 'forbidden');
  await assert.rejects(drive.listFolderImages(FOLDER), (e) => {
    assert.doesNotMatch(e.message, /API|key|Cloud|Google Drive API|restriction/i);
    assert.match(e.adminHint, /API restrictions/);
    return true;
  });
});

test('Google tidak terjangkau: UNAVAILABLE, bukan crash', async () => {
  const dead = await startMockDrive();
  const deadUrl = dead.baseUrl;
  await dead.close();
  config.driveApiBase = deadUrl;
  try {
    await assert.rejects(drive.listFolderImages(FOLDER), (e) => e.code === 'UNAVAILABLE' && e.status === 502);
  } finally {
    config.driveApiBase = mock.baseUrl;
  }
});

test('GOOGLE_API_KEY kosong: NOT_CONFIGURED tanpa menghubungi Google', async () => {
  config.googleApiKey = '';
  await assert.rejects(drive.listFolderImages(FOLDER), (e) => e.code === 'NOT_CONFIGURED' && e.status === 503);
  assert.equal(mock.requests.length, 0);
});

test('checkFolder: folder valid', async () => {
  mock.handler = () => ({ status: 200, body: { id: FOLDER, name: 'Wedding J&D', mimeType: 'application/vnd.google-apps.folder' } });
  assert.deepEqual(await drive.checkFolder(FOLDER), { id: FOLDER, name: 'Wedding J&D' });
  assert.equal(mock.requests[0].path, `/drive/v3/files/${FOLDER}`);
});

test('checkFolder: link ke file (bukan folder) ditolak dengan 400', async () => {
  mock.handler = () => ({ status: 200, body: { id: FOLDER, name: 'a.jpg', mimeType: 'image/jpeg' } });
  await assert.rejects(drive.checkFolder(FOLDER), (e) => e.code === 'NOT_A_FOLDER' && e.status === 400);
});

test('sizedThumb', () => {
  assert.equal(drive.sizedThumb('https://x/y=s220', 480), 'https://x/y=s480');
  assert.equal(drive.sizedThumb('https://x/y=w220-h300', 480), 'https://x/y=w220-h300');
  assert.equal(drive.sizedThumb(undefined, 480), null);
});

test('API key tidak pernah muncul di log', () => {
  assert.ok(logged.length > 0, 'seharusnya ada log error dari tes di atas');
  for (const line of logged) assert.doesNotMatch(line, /test-key-123/);
});
