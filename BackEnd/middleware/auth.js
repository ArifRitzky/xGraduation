const { query } = require('../db');
const { ADMIN_COOKIE, verifyAdminToken } = require('../utils/tokens');
const { asyncHandler, HttpError } = require('../utils/http');

// Protects admin-only endpoints. The result is made available on req.admin.
const requireAdmin = asyncHandler(async (req, res, next) => {
  const payload = verifyAdminToken(req.cookies[ADMIN_COOKIE]);
  if (!payload) throw new HttpError(401, 'Not logged in or the session has expired');

  // Check the database: if the account has been deleted, the token is automatically invalid.
  const { rows } = await query(
    'SELECT id, email, name, email_verified_at FROM admins WHERE id = $1',
    [payload.sub]
  );
  if (!rows[0]) throw new HttpError(401, 'Account not found');

  req.admin = rows[0];
  next();
});

module.exports = { requireAdmin };
