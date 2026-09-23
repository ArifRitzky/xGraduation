// Fungsi validasi murni (tanpa dependency) supaya mudah dites.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

const isEmail = (v) => typeof v === 'string' && v.length <= 254 && EMAIL_RE.test(v);

// Mengembalikan string yang sudah di-trim, atau null kalau tidak valid.
function cleanString(v, { min = 1, max = 200 } = {}) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length >= min && s.length <= max ? s : null;
}

// bcrypt hanya membaca 72 byte pertama, jadi password lebih panjang ditolak.
function validPassword(v, min) {
  return typeof v === 'string' && v.length >= min && Buffer.byteLength(v, 'utf8') <= 72;
}

function parseMaxSelection(v) {
  let n = v;
  if (typeof v === 'string' && v.trim() !== '') n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 500 ? n : null;
}

// Format wa.me: hanya angka, tanpa "+", tanpa "0" di depan.
// "0812-3456-7890", "81234567890", "+62 812 3456 7890", "6281234567890"
// semuanya menjadi "6281234567890". Nomor luar negeri harus diawali "+".
function normalizePhone(input) {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  const hasPlus = raw.startsWith('+');
  let digits = raw.replace(/\D/g, '');
  if (!digits) return null;

  if (hasPlus || digits.startsWith('62')) {
    // sudah berformat internasional
  } else if (digits.startsWith('0')) {
    digits = '62' + digits.slice(1);
  } else if (digits.startsWith('8')) {
    digits = '62' + digits;
  } else {
    return null;
  }

  // Kasus "+62 0812..." (angka 0 ikut terketik setelah kode negara).
  if (digits.startsWith('620')) digits = '62' + digits.slice(3);

  return /^\d{9,15}$/.test(digits) ? digits : null;
}

// Drive API butuh ID folder, bukan URL utuh.
function extractDriveFolderId(link) {
  if (typeof link !== 'string') return null;
  let url;
  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== 'drive.google.com') return null;

  const fromPath = url.pathname.match(/\/folders\/([A-Za-z0-9_-]{10,})/);
  if (fromPath) return fromPath[1];

  const fromQuery = url.searchParams.get('id');
  return fromQuery && /^[A-Za-z0-9_-]{10,}$/.test(fromQuery) ? fromQuery : null;
}

// Link folder yang dibagikan lewat "Anyone with the link" kadang memuat ?resourcekey=...
// Google mensyaratkannya untuk sebagian file yang dibagikan lewat link (dikirim lewat header).
function extractDriveResourceKey(link) {
  if (typeof link !== 'string') return null;
  let url;
  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== 'drive.google.com') return null;
  const key = url.searchParams.get('resourcekey');
  return key && /^[A-Za-z0-9_-]{3,100}$/.test(key) ? key : null;
}

module.exports = {
  hasOwn,
  isUuid,
  isEmail,
  cleanString,
  validPassword,
  parseMaxSelection,
  normalizePhone,
  extractDriveFolderId,
  extractDriveResourceKey,
};
