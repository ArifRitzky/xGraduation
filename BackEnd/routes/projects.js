const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const { requireAdmin } = require('../middleware/auth');
const { asyncHandler, HttpError } = require('../utils/http');
const {
  hasOwn,
  isUuid,
  cleanString,
  validPassword,
  parseMaxSelection,
  normalizePhone,
  extractDriveFolderId,
  extractDriveResourceKey,
} = require('../utils/validators');
const { checkFolder, DriveError } = require('../utils/drive');

const router = express.Router();
router.use(requireAdmin);

// Creating a project / changing the folder link triggers a request to Google using the GOOGLE_API_KEY
// shared by all admins. Limited per ADMIN (not per IP) so one account can't use up everyone's quota.
const folderCheckLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  keyGenerator: (req) => req.admin.id,
  // A PATCH that doesn't change the folder link doesn't contact Google, so it isn't counted.
  skip: (req) => req.method === 'PATCH' && !hasOwn(req.body || {}, 'driveFolderLink'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many project creations/changes in one hour. Try again later.' },
});

// The client password is never sent back, only a flag for whether the project is password-locked.
const COLS = `id, name, drive_folder_link, whatsapp_number, max_selection,
              (client_password_hash IS NOT NULL) AS has_password, created_at, updated_at`;

const toProject = (r) => ({
  id: r.id,
  name: r.name,
  driveFolderLink: r.drive_folder_link,
  whatsappNumber: r.whatsapp_number,
  maxSelection: r.max_selection,
  hasPassword: r.has_password,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

// An ID that isn't a UUID is immediately answered with 404 (passing it to Postgres would cause a 500).
router.param('id', (req, res, next, id) => {
  if (!isUuid(id)) return next(new HttpError(404, 'Project not found'));
  next();
});

// Per-field validation helpers, shared by POST and PATCH.
const fieldRules = {
  name(v) {
    const name = cleanString(v, { max: 120 });
    if (!name) throw new HttpError(400, 'Project name is required (max 120 characters)');
    return name;
  },
  driveFolderLink(v) {
    const folderId = extractDriveFolderId(v);
    if (!folderId) {
      throw new HttpError(
        400,
        'Invalid Google Drive folder link. Example: https://drive.google.com/drive/folders/xxxxxxxx'
      );
    }
    return { link: v.trim(), folderId };
  },
  whatsappNumber(v) {
    const phone = normalizePhone(v);
    if (!phone) {
      throw new HttpError(400, 'Invalid WhatsApp number. Example: 0812-3456-7890 or +62 812 3456 7890');
    }
    return phone;
  },
  maxSelection(v) {
    const n = parseMaxSelection(v);
    if (n === null) throw new HttpError(400, 'Photo selection limit must be a whole number from 1 to 500');
    return n;
  },
  // undefined/null/"" means "no password"; anything else gets hashed.
  async clientPassword(v) {
    if (v === undefined || v === null || v === '') return null;
    if (!validPassword(v, 4)) throw new HttpError(400, 'Client password must be at least 4 characters (max 72)');
    return bcrypt.hash(v, 10);
  },
};

// Makes sure the Drive link is actually a folder the app can read, so no client link silently
// "dies" without anyone knowing. A definite rejection from Google (folder doesn't exist / not
// shared / not a folder) blocks saving. A temporary issue (Google down, quota, API key missing)
// only becomes a warning, since the project is still worth saving.
async function verifyFolder(folderId, link) {
  try {
    await checkFolder(folderId, { resourceKey: extractDriveResourceKey(link) });
    return null;
  } catch (err) {
    if (!(err instanceof DriveError)) throw err;
    if (err.code === 'FOLDER_INACCESSIBLE' || err.code === 'NOT_A_FOLDER') {
      throw new HttpError(400, err.adminHint);
    }
    return err.adminHint;
  }
}

const withWarning = (project, warning) => (warning ? { project, driveWarning: warning } : { project });

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT ${COLS} FROM projects WHERE admin_id = $1 ORDER BY created_at DESC`,
      [req.admin.id]
    );
    res.json({ projects: rows.map(toProject) });
  })
);

router.post(
  '/',
  folderCheckLimiter,
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const name = fieldRules.name(b.name);
    const { link, folderId } = fieldRules.driveFolderLink(b.driveFolderLink);
    const phone = fieldRules.whatsappNumber(b.whatsappNumber);
    const maxSelection = b.maxSelection === undefined ? 10 : fieldRules.maxSelection(b.maxSelection);
    const passwordHash = await fieldRules.clientPassword(b.clientPassword);

    // Check the limit BEFORE contacting Google, so requests that will definitely be rejected don't use quota.
    const { rows: countRows } = await query('SELECT COUNT(*)::int AS n FROM projects WHERE admin_id = $1', [
      req.admin.id,
    ]);
    if (countRows[0].n >= config.maxProjectsPerAdmin) {
      throw new HttpError(
        403,
        `You've reached the ${config.maxProjectsPerAdmin} project limit per account. Delete an old, unused project to add more.`
      );
    }

    const driveWarning = await verifyFolder(folderId, link);

    const { rows } = await query(
      `INSERT INTO projects
         (admin_id, name, drive_folder_link, drive_folder_id, whatsapp_number, max_selection, client_password_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${COLS}`,
      [req.admin.id, name, link, folderId, phone, maxSelection, passwordHash]
    );
    res.status(201).json(withWarning(toProject(rows[0]), driveWarning));
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { rows } = await query(`SELECT ${COLS} FROM projects WHERE id = $1 AND admin_id = $2`, [
      req.params.id,
      req.admin.id,
    ]);
    if (!rows[0]) throw new HttpError(404, 'Project not found');
    res.json({ project: toProject(rows[0]) });
  })
);

// Partial update: only the fields sent are changed. The project ID stays the same,
// so a link already sent to the client doesn't break.
router.patch(
  '/:id',
  folderCheckLimiter,
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const sets = [];
    const vals = [];
    let driveWarning = null;
    const set = (column, value) => {
      vals.push(value);
      sets.push(`${column} = $${vals.length}`);
    };

    if (hasOwn(b, 'name')) set('name', fieldRules.name(b.name));
    if (hasOwn(b, 'driveFolderLink')) {
      const { link, folderId } = fieldRules.driveFolderLink(b.driveFolderLink);
      driveWarning = await verifyFolder(folderId, link);
      set('drive_folder_link', link);
      set('drive_folder_id', folderId);
    }
    if (hasOwn(b, 'whatsappNumber')) set('whatsapp_number', fieldRules.whatsappNumber(b.whatsappNumber));
    if (hasOwn(b, 'maxSelection')) set('max_selection', fieldRules.maxSelection(b.maxSelection));
    if (hasOwn(b, 'clientPassword')) set('client_password_hash', await fieldRules.clientPassword(b.clientPassword));

    if (sets.length === 0) throw new HttpError(400, 'No fields were changed');
    sets.push('updated_at = now()');

    vals.push(req.params.id, req.admin.id);
    const { rows } = await query(
      `UPDATE projects SET ${sets.join(', ')}
        WHERE id = $${vals.length - 1} AND admin_id = $${vals.length}
        RETURNING ${COLS}`,
      vals
    );
    if (!rows[0]) throw new HttpError(404, 'Project not found');
    res.json(withWarning(toProject(rows[0]), driveWarning));
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { rowCount } = await query('DELETE FROM projects WHERE id = $1 AND admin_id = $2', [
      req.params.id,
      req.admin.id,
    ]);
    if (rowCount === 0) throw new HttpError(404, 'Project not found');
    res.json({ deleted: true });
  })
);

module.exports = router;
