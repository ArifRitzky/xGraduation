// Google Drive access via API key, for folders shared as "Anyone with the link".
// The backend only READS the file list. Photos themselves aren't stored and don't pass
// through this server: the browser loads images directly from Google's thumbnail URLs.
const config = require('../config');
const { HttpError } = require('./http');

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const FOLDER_ID_RE = /^[A-Za-z0-9_-]{10,}$/;

const REQUEST_TIMEOUT_MS = 10_000;
const PAGE_SIZE = 1000;
const MAX_PAGES = 5; // safety limit: max 5000 files per folder
const CACHE_TTL_MS = 2 * 60 * 1000; // Google thumbnail links are valid for a few hours, so 2 minutes is safe
const CACHE_MAX_ENTRIES = 200;

const THUMB_SIZE = 480; // gallery
const FULL_SIZE = 1600; // preview (lightbox)

// Message that's safe to show clients (no technical detail).
const MSG_CLIENT_UNAVAILABLE = 'Photos can\'t be shown right now. Contact the studio owner.';
const MSG_CLIENT_BUSY = 'The photo server is busy right now. Try again shortly.';

// code: marks the kind of problem. adminHint: technical explanation for the admin/logs, never sent to the client.
class DriveError extends HttpError {
  constructor(code, status, message, adminHint) {
    super(status, message);
    this.code = code;
    this.adminHint = adminHint || message;
  }
}

const log = (...args) => console.error('[drive]', ...args);

function classify(status, body) {
  const googleMessage = (body && body.error && body.error.message) || '';
  const text = JSON.stringify((body && body.error) || body || '');

  if (status === 429 || /rateLimitExceeded|userRateLimitExceeded|quotaExceeded|dailyLimitExceeded|RATE_LIMIT_EXCEEDED|RESOURCE_EXHAUSTED/i.test(text)) {
    return new DriveError(
      'QUOTA',
      503,
      MSG_CLIENT_BUSY,
      'Google is throttling requests (quota). Try again shortly.'
    );
  }

  if (
    status === 401 ||
    /API_KEY_INVALID|keyInvalid|API key not valid|API_KEY_SERVICE_BLOCKED|API_KEY_HTTP_REFERRER_BLOCKED|API_KEY_IP_ADDRESS_BLOCKED|ipRefererBlocked|SERVICE_DISABLED|accessNotConfigured|has not been used in project|unregistered callers/i.test(
      text
    )
  ) {
    return new DriveError(
      'MISCONFIGURED',
      503,
      MSG_CLIENT_UNAVAILABLE,
      'Google rejected the server API key. Check the Google Cloud Console: the key is correct, ' +
        'the Google Drive API is Enabled, and "API restrictions" allows the Google Drive API. ' +
        `Message from Google: ${googleMessage || `status ${status}`}`
    );
  }

  // Untuk file privat, Drive menjawab 404 (bukan 403) kalau diakses tanpa izin.
  if (status === 404 || status === 403) {
    // Google's original response is shown to the admin so the cause can be identified
    // (wrong ID, private folder, permission denied, etc). It doesn't contain any secrets.
    const reason = (body && body.error && body.error.errors && body.error.errors[0] && body.error.errors[0].reason) || '';
    const detail = `Google's response: ${status}${reason ? ` ${reason}` : ''}${googleMessage ? ` - ${googleMessage}` : ''}`;
    return new DriveError(
      'FOLDER_INACCESSIBLE',
      502,
      MSG_CLIENT_UNAVAILABLE,
      'Folder not found or not shared yet. Make sure the folder is set to "Anyone with the link" ' +
        `with the Viewer role, and that the pasted link is your actual folder link. (${detail})`
    );
  }

  if (status >= 500) {
    return new DriveError(
      'UNAVAILABLE',
      502,
      'Google Drive is having issues right now. Try again shortly.',
      `Google Drive responded with status ${status}.`
    );
  }

  return new DriveError(
    'DRIVE_REJECTED',
    502,
    MSG_CLIENT_UNAVAILABLE,
    `Google Drive rejected the request (status ${status}): ${googleMessage || 'no details'}`
  );
}

async function driveRequest(path, params, resourceKeys) {
  if (!config.googleApiKey) {
    throw new DriveError(
      'NOT_CONFIGURED',
      503,
      MSG_CLIENT_UNAVAILABLE,
      'GOOGLE_API_KEY is not set in the server .env file. Set it, then restart the server.'
    );
  }

  const query = new URLSearchParams(params);
  query.set('key', config.googleApiKey);
  const url = `${config.driveApiBase.replace(/\/$/, '')}${path}?${query.toString()}`;

  const headers = { Accept: 'application/json' };
  if (resourceKeys) headers['X-Goog-Drive-Resource-Keys'] = resourceKeys;

  let res;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (err) {
    // The URL is deliberately not logged because it contains the API key.
    log('Could not reach Google Drive:', err.name === 'TimeoutError' ? 'timeout' : err.message);
    throw new DriveError(
      'UNAVAILABLE',
      502,
      'Could not reach Google Drive. Try again shortly.',
      'Server could not reach Google Drive (network issue or timeout).'
    );
  }

  let body = null;
  try {
    body = await res.json();
  } catch {
    // empty body or not JSON: handled via the status check below
  }

  if (!res.ok) {
    const err = classify(res.status, body);
    log(err.code, `status=${res.status}`, err.adminHint);
    throw err;
  }
  return body || {};
}

function assertFolderId(folderId) {
  if (typeof folderId !== 'string' || !FOLDER_ID_RE.test(folderId)) {
    throw new DriveError(
      'FOLDER_INACCESSIBLE',
      502,
      MSG_CLIENT_UNAVAILABLE,
      'Invalid Google Drive folder ID.'
    );
  }
}

const resourceKeyHeader = (folderId, resourceKey) => (resourceKey ? `${folderId}/${resourceKey}` : undefined);

// Drive thumbnail URLs usually end in "=s220". Changing the number requests a different size.
// This is common practice but not documented officially by Google, so if the format changes,
// the URL is returned as-is (the image still shows, just at a smaller size).
function sizedThumb(thumbnailLink, size) {
  if (!thumbnailLink) return null;
  return /=s\d+$/.test(thumbnailLink) ? thumbnailLink.replace(/=s\d+$/, `=s${size}`) : thumbnailLink;
}

const cache = new Map();
const clearCache = () => cache.clear();

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value) {
  if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), value });
}

// Lists all images DIRECTLY inside the folder (subfolder contents aren't included),
// sorted by name naturally (DSC2 before DSC10).
async function listFolderImages(folderId, { resourceKey } = {}) {
  assertFolderId(folderId);

  const cacheKey = `${folderId}/${resourceKey || ''}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const files = [];
  let pageToken;
  let pages = 0;
  let truncated = false;

  do {
    const params = {
      q: `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`,
      orderBy: 'name_natural',
      pageSize: String(PAGE_SIZE),
      fields: 'nextPageToken,files(id,name,mimeType,thumbnailLink,imageMediaMetadata(width,height))',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    };
    if (pageToken) params.pageToken = pageToken;

    const data = await driveRequest('/files', params, resourceKeyHeader(folderId, resourceKey));
    if (Array.isArray(data.files)) files.push(...data.files);

    // Google can send an empty or partial page before the list is exhausted, so always follow the token.
    pageToken = data.nextPageToken;
    pages += 1;
    if (pageToken && pages >= MAX_PAGES) {
      truncated = true;
      break;
    }
  } while (pageToken);

  const photos = files.map((f) => ({
    id: f.id,
    name: f.name,
    width: (f.imageMediaMetadata && f.imageMediaMetadata.width) || null,
    height: (f.imageMediaMetadata && f.imageMediaMetadata.height) || null,
    thumb: sizedThumb(f.thumbnailLink, THUMB_SIZE),
    full: sizedThumb(f.thumbnailLink, FULL_SIZE),
  }));

  const result = {
    photos,
    total: photos.length,
    // Newly uploaded photos sometimes don't have a thumbnail yet; flagged so they don't silently disappear.
    withoutThumbnail: photos.filter((p) => !p.thumb).length,
    truncated,
  };
  cacheSet(cacheKey, result);
  return result;
}

// Used when the admin creates/changes a project: makes sure the link is actually a readable folder.
async function checkFolder(folderId, { resourceKey } = {}) {
  assertFolderId(folderId);
  const data = await driveRequest(
    `/files/${folderId}`,
    { fields: 'id,name,mimeType', supportsAllDrives: 'true' },
    resourceKeyHeader(folderId, resourceKey)
  );
  if (data.mimeType !== FOLDER_MIME) {
    throw new DriveError(
      'NOT_A_FOLDER',
      400,
      'This link isn\'t a Google Drive folder. Paste a folder link, not a file link.'
    );
  }
  return { id: data.id, name: data.name };
}

module.exports = { DriveError, listFolderImages, checkFolder, sizedThumb, clearCache };
