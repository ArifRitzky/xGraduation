const express = require("express");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const { query } = require("../db");
const { asyncHandler, HttpError } = require("../utils/http");
const { isUuid, extractDriveResourceKey } = require("../utils/validators");
const { listFolderImages } = require("../utils/drive");
const {
  ADMIN_COOKIE,
  CLIENT_TTL_MS,
  cookieBase,
  clientCookieName,
  signClientToken,
  verifyAdminToken,
  verifyClientToken,
} = require("../utils/tokens");

// PUBLIC endpoint for the client page (no admin login required).
const router = express.Router();

router.param("id", (req, res, next, id) => {
  if (!isUuid(id)) return next(new HttpError(404, "Project not found"));
  next();
});

const unlockLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many password attempts. Try again in 15 minutes.",
  },
});

// The photos endpoint triggers a request to Google (though cached for 2 minutes), so it's limited per IP.
const photosLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Try again in a moment." },
});

async function loadProject(id) {
  const { rows } = await query(
    "SELECT id, admin_id, name, whatsapp_number, max_selection, client_password_hash, drive_folder_id, drive_folder_link " +
      "FROM projects WHERE id = $1",
    [id],
  );
  if (!rows[0]) throw new HttpError(404, "Project not found");
  return rows[0];
}

// Before the correct password, the client only knows the project name and that it's locked.
// The photo limit and WhatsApp number are only sent once it's unlocked.
function view(project, unlocked) {
  const requiresPassword = project.client_password_hash !== null;
  const open = !requiresPassword || unlocked;
  const out = {
    id: project.id,
    name: project.name,
    requiresPassword,
    unlocked: open,
  };
  if (open) {
    out.maxSelection = project.max_selection;
    out.whatsappNumber = project.whatsapp_number;
  }
  return out;
}

// If the visitor is the admin who owns this project (clicked "Preview" from the
// dashboard), the project is automatically considered unlocked - the admin doesn't need
// to know/enter the client password. This is NOT a required check: if there's no admin
// session (or a different admin, not the owner), this function just returns false and
// the visitor continues through the normal password flow like a real client.
function isOwnerAdmin(req, project) {
  const payload = verifyAdminToken(req.cookies[ADMIN_COOKIE]);
  return Boolean(payload && payload.sub === project.admin_id);
}

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const project = await loadProject(req.params.id);
    const unlocked =
      isOwnerAdmin(req, project) ||
      Boolean(
        verifyClientToken(
          req.cookies[clientCookieName(project.id)],
          project.id,
        ),
      );
    res.json(view(project, unlocked));
  }),
);

router.post(
  "/:id/unlock",
  unlockLimiter,
  asyncHandler(async (req, res) => {
    const project = await loadProject(req.params.id);

    // Project without a password: nothing needs to be unlocked.
    if (project.client_password_hash === null)
      return res.json(view(project, true));

    const password =
      typeof req.body.password === "string" ? req.body.password : "";
    if (!password) throw new HttpError(400, "Password is required");

    const ok = await bcrypt.compare(password, project.client_password_hash);
    if (!ok) throw new HttpError(401, "Incorrect password");

    res.cookie(clientCookieName(project.id), signClientToken(project.id), {
      ...cookieBase,
      maxAge: CLIENT_TTL_MS,
    });
    res.json(view(project, true));
  }),
);

// Photo list for the gallery. A password-locked project can only be read after /unlock succeeds.
// Photos don't pass through this server: the response contains Google thumbnail URLs loaded directly by the browser.
router.get(
  "/:id/photos",
  photosLimiter,
  asyncHandler(async (req, res) => {
    const project = await loadProject(req.params.id);
    const requiresPassword = project.client_password_hash !== null;
    const unlocked =
      isOwnerAdmin(req, project) ||
      Boolean(
        verifyClientToken(
          req.cookies[clientCookieName(project.id)],
          project.id,
        ),
      );
    if (requiresPassword && !unlocked) {
      return res
        .status(401)
        .json({
          error: "This project is password-locked",
          requiresPassword: true,
        });
    }

    const result = await listFolderImages(project.drive_folder_id, {
      resourceKey: extractDriveResourceKey(project.drive_folder_link),
    });
    res.json(result);
  }),
);

module.exports = router;
