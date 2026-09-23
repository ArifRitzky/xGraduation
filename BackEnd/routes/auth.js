const express = require("express");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const { OAuth2Client } = require("google-auth-library");
const config = require("../config");
const { query } = require("../db");
const { requireAdmin } = require("../middleware/auth");
const { asyncHandler, HttpError } = require("../utils/http");
const {
  ADMIN_COOKIE,
  ADMIN_TTL_MS,
  cookieBase,
  signAdminToken,
  generateRawToken,
  hashRawToken,
} = require("../utils/tokens");
const mailer = require("../utils/mailer");

const router = express.Router();

// null when GOOGLE_CLIENT_ID isn't set - the /google endpoint will respond 503,
// other endpoints (password login) keep working normally.
const googleClient = config.googleClientId
  ? new OAuth2Client(config.googleClientId)
  : null;

// Used so the response time is the same whether the email exists or not (prevents email enumeration).
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", 10);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many login attempts. Try again in 15 minutes.",
  },
});

// Stricter than login: creating an account is done far less often than trying to
// log in, so a low limit here won't get in the way of real users.
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error:
      "Too many sign-up attempts from this address. Try again in 1 hour.",
  },
});

// Sama alasan dengan registerLimiter: minta reset password bukan hal yang wajar
// dilakukan berkali-kali dalam waktu singkat oleh pengguna asli.
const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many password reset requests. Try again in 1 hour.",
  },
});

const resendVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many verification emails requested. Try again in 15 minutes.",
  },
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Email + password sign-up is closed by default (see config.allowPasswordSignup).
// Checked BEFORE the rate limiter, so rejected attempts don't use up the quota.
function requirePasswordSignup(req, res, next) {
  if (config.allowPasswordSignup) return next();
  next(
    new HttpError(
      403,
      "Sign-up with email and password is closed. Sign up with your Google account (the Log In with Google button).",
    ),
  );
}

const publicAdmin = (row) => ({
  id: row.id,
  email: row.email,
  name: row.name,
  // false hanya berarti "belum klik link verifikasi" - tidak memblokir login,
  // dashboard cukup menunjukkan pengingat (lihat GET /me di bawah).
  emailVerified: Boolean(row.email_verified_at),
});

// Dipakai oleh /register dan /verify-email/resend supaya link yang dikirim
// selalu mengarah ke frontend yang benar, bukan ke backend ini sendiri.
function buildLink(path, token) {
  return `${config.appUrl}${path}?token=${encodeURIComponent(token)}`;
}

// Used by the sign-up page to know which button and form are allowed to be shown.
router.get("/options", (req, res) => {
  res.json({
    googleLogin: Boolean(googleClient),
    passwordSignup: config.allowPasswordSignup,
  });
});

router.post(
  "/login",
  loginLimiter,
  asyncHandler(async (req, res) => {
    const email =
      typeof req.body.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";
    const password =
      typeof req.body.password === "string" ? req.body.password : "";
    if (!email || !password)
      throw new HttpError(400, "Email and password are required");

    const { rows } = await query(
      `SELECT id, email, name, password_hash, email_verified_at FROM admins WHERE email = $1`,
      [email],
    );
    const admin = rows[0];

    const passwordOk = await bcrypt.compare(
      password,
      (admin && admin.password_hash) || DUMMY_HASH,
    );
    if (!admin || !admin.password_hash || !passwordOk) {
      throw new HttpError(401, "Incorrect email or password");
    }

    // Password accounts must click the activation link sent at sign-up before
    // they can log in. Google accounts are already verified by Google, so this
    // never blocks them (email_verified_at is set the moment they're created).
    if (!admin.email_verified_at) {
      throw new HttpError(
        403,
        "Please activate your account first. Check your inbox (and spam folder) for the activation link we sent when you signed up.",
      );
    }

    res.cookie(ADMIN_COOKIE, signAdminToken(admin.id), {
      ...cookieBase,
      maxAge: ADMIN_TTL_MS,
    });
    res.json({ admin: publicAdmin(admin) });
  }),
);

router.post("/logout", (req, res) => {
  res.clearCookie(ADMIN_COOKIE, cookieBase);
  res.json({ ok: true });
});

router.post(
  "/register",
  requirePasswordSignup,
  registerLimiter,
  asyncHandler(async (req, res) => {
    const name =
      typeof req.body.name === "string"
        ? req.body.name.trim().slice(0, 120)
        : "";
    const email =
      typeof req.body.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";
    const password =
      typeof req.body.password === "string" ? req.body.password : "";

    if (!name) throw new HttpError(400, "Name is required");
    if (!email || !EMAIL_RE.test(email))
      throw new HttpError(400, "Invalid email");
    if (password.length < 8)
      throw new HttpError(400, "Password must be at least 8 characters");
    if (password.length > 72)
      throw new HttpError(400, "Password must be at most 72 characters");

    // Account activation requires a working link back to the frontend - without
    // APP_URL there's no way to build that link, so sign-up can't be completed.
    if (!config.appUrl) {
      throw new HttpError(
        503,
        "Sign-up isn't fully configured on the server yet (missing APP_URL).",
      );
    }

    const existing = await query("SELECT id FROM admins WHERE email = $1", [
      email,
    ]);
    if (existing.rows[0]) {
      throw new HttpError(
        409,
        "This email is already registered. Try logging in, or use a different email.",
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const rawVerifyToken = generateRawToken();
    const { rows } = await query(
      `INSERT INTO admins (email, name, password_hash, email_verify_token_hash, email_verify_token_expires)
       VALUES ($1, $2, $3, $4, now() + interval '24 hours')
       RETURNING id, email, name, email_verified_at`,
      [email, name, passwordHash, hashRawToken(rawVerifyToken)],
    );
    const admin = rows[0];

    // No login cookie here on purpose: the account isn't active yet. The person
    // must click the activation link we just emailed before they can log in
    // (enforced in /login above). If the email fails to send (SMTP misconfigured,
    // etc.) they can ask for a new link via /verify-email/resend-by-email.
    mailer
      .sendVerifyEmail(admin.email, buildLink("/verify-email.html", rawVerifyToken))
      .catch((err) => console.error("[auth/register] Gagal kirim email verifikasi:", err.message));

    res.status(201).json({
      ok: true,
      message: "Account created. Check your email to activate your account before logging in.",
      email: admin.email,
    });
  }),
);

router.post(
  "/google",
  loginLimiter,
  asyncHandler(async (req, res) => {
    if (!googleClient) {
      throw new HttpError(
        503,
        "Google login isn't configured on the server yet.",
      );
    }

    const credential =
      typeof req.body.credential === "string" ? req.body.credential : "";
    if (!credential) throw new HttpError(400, "Google token not found.");

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: config.googleClientId,
      });
      payload = ticket.getPayload();
    } catch (err) {
      throw new HttpError(
        401,
        "The Google token is invalid or has expired. Please log in again.",
      );
    }

    const emailVerified =
      payload &&
      (payload.email_verified === true || payload.email_verified === "true");
    if (!payload || !payload.email || !emailVerified) {
      throw new HttpError(
        401,
        "This Google account can't be used to log in.",
      );
    }

    const email = payload.email.trim().toLowerCase();
    const googleSub = payload.sub;

    // Look up by the Google account ID (googleSub) first: that ID doesn't change even if
    // the email changes. Only then look up by email. A single "email OR sub" query could
    // return two different rows and pick one of them arbitrarily.
    let admin = (
      await query(
        `SELECT id, email, name, google_sub, email_verified_at FROM admins WHERE google_sub = $1`,
        [googleSub],
      )
    ).rows[0];

    if (!admin) {
      admin = (
        await query(
          `SELECT id, email, name, google_sub, email_verified_at FROM admins WHERE email = $1`,
          [email],
        )
      ).rows[0];

      if (!admin) {
        // No account exists yet for this email. The email from Google is already verified, so
        // it's safe to use to create a new account (sign-up is open to other photographers). No
        // password_hash: login is via Google, per the admin_has_login_method constraint (google_sub is enough).
        const inserted = await query(
          `INSERT INTO admins (email, name, google_sub, email_verified_at)
           VALUES ($1, $2, $3, now())
           RETURNING id, email, name, email_verified_at`,
          [email, payload.name || email, googleSub],
        );
        admin = inserted.rows[0];
      } else if (!admin.google_sub) {
        // An account with this email already exists (created before Google login existed) - link the Google
        // account. Google has already verified this email, so mark it verified here too if it wasn't yet.
        await query(
          "UPDATE admins SET google_sub = $1, email_verified_at = COALESCE(email_verified_at, now()), updated_at = now() WHERE id = $2",
          [googleSub, admin.id],
        );
        admin.email_verified_at = admin.email_verified_at || new Date();
      } else {
        // Email matches but the Google account is different (rare case) - reject rather than guess.
        throw new HttpError(
          403,
          "This Google account doesn't match the registered admin.",
        );
      }
    }

    res.cookie(ADMIN_COOKIE, signAdminToken(admin.id), {
      ...cookieBase,
      maxAge: ADMIN_TTL_MS,
    });
    res.json({ admin: publicAdmin(admin) });
  }),
);

// Used by the frontend to check whether the session is still valid when a page loads.
router.get("/me", requireAdmin, (req, res) => {
  res.json({ admin: publicAdmin(req.admin) });
});

// =========================================
// FORGOT PASSWORD / RESET PASSWORD
// =========================================

router.post(
  "/forgot-password",
  forgotPasswordLimiter,
  asyncHandler(async (req, res) => {
    const email =
      typeof req.body.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";
    if (!email || !EMAIL_RE.test(email))
      throw new HttpError(400, "Enter a valid email address");

    if (!config.appUrl) {
      throw new HttpError(
        503,
        "Password reset isn't configured on the server yet.",
      );
    }

    const { rows } = await query(
      `SELECT id, email, password_hash FROM admins WHERE email = $1`,
      [email],
    );
    const admin = rows[0];

    // Same response whether or not the account exists, and whether or not it has a
    // password - this prevents an attacker from using this endpoint to find out which
    // emails are registered (same idea as DUMMY_HASH in /login above).
    if (admin && admin.password_hash) {
      const rawToken = generateRawToken();
      await query(
        `UPDATE admins SET password_reset_token_hash = $1, password_reset_token_expires = now() + interval '30 minutes'
         WHERE id = $2`,
        [hashRawToken(rawToken), admin.id],
      );
      mailer
        .sendResetPasswordEmail(admin.email, buildLink("/reset-password.html", rawToken))
        .catch((err) => console.error("[auth/forgot-password] Gagal kirim email:", err.message));
    } else if (admin && !admin.password_hash) {
      // Account exists but logs in via Google only - let them know by email (not in the
      // HTTP response, so a stranger probing this endpoint learns nothing either way).
      mailer
        .sendGoogleOnlyNotice(admin.email)
        .catch((err) => console.error("[auth/forgot-password] Gagal kirim email:", err.message));
    }

    res.json({
      ok: true,
      message:
        "If an account exists for that email, we've sent a link to reset the password.",
    });
  }),
);

router.post(
  "/reset-password",
  asyncHandler(async (req, res) => {
    const token = typeof req.body.token === "string" ? req.body.token : "";
    const password =
      typeof req.body.password === "string" ? req.body.password : "";
    if (!token) throw new HttpError(400, "Missing reset token");
    if (password.length < 8)
      throw new HttpError(400, "Password must be at least 8 characters");
    if (password.length > 72)
      throw new HttpError(400, "Password must be at most 72 characters");

    const { rows } = await query(
      `SELECT id, email, name FROM admins
       WHERE password_reset_token_hash = $1 AND password_reset_token_expires > now()`,
      [hashRawToken(token)],
    );
    const admin = rows[0];
    if (!admin)
      throw new HttpError(
        400,
        "This reset link is invalid or has expired. Request a new one.",
      );

    const passwordHash = await bcrypt.hash(password, 10);
    // Clearing the token here means the link can only be used once, even if the
    // person still has the email sitting in their inbox.
    await query(
      `UPDATE admins
       SET password_hash = $1, password_reset_token_hash = NULL, password_reset_token_expires = NULL,
           email_verified_at = COALESCE(email_verified_at, now()), updated_at = now()
       WHERE id = $2`,
      [passwordHash, admin.id],
    );

    // Log the person straight in - they just proved they control the email inbox,
    // which is at least as strong as a normal password login.
    res.cookie(ADMIN_COOKIE, signAdminToken(admin.id), {
      ...cookieBase,
      maxAge: ADMIN_TTL_MS,
    });
    res.json({
      admin: publicAdmin({ ...admin, email_verified_at: new Date() }),
    });
  }),
);

// =========================================
// EMAIL VERIFICATION
// =========================================

router.post(
  "/verify-email",
  asyncHandler(async (req, res) => {
    const token = typeof req.body.token === "string" ? req.body.token : "";
    if (!token) throw new HttpError(400, "Missing verification token");

    const { rows } = await query(
      `SELECT id, email, name FROM admins
       WHERE email_verify_token_hash = $1 AND email_verify_token_expires > now()`,
      [hashRawToken(token)],
    );
    const admin = rows[0];
    if (!admin)
      throw new HttpError(
        400,
        "This verification link is invalid or has expired. Request a new one.",
      );

    await query(
      `UPDATE admins
       SET email_verified_at = now(), email_verify_token_hash = NULL, email_verify_token_expires = NULL,
           updated_at = now()
       WHERE id = $1`,
      [admin.id],
    );

    res.json({
      admin: publicAdmin({ ...admin, email_verified_at: new Date() }),
    });
  }),
);

// Used right after sign-up / on a failed login for an unactivated account - at that
// point the person has no session yet, so this takes the email directly instead of
// requiring requireAdmin. Same email-enumeration protection as /forgot-password:
// the response never reveals whether the address is registered or already verified.
const resendActivationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Try again in 15 minutes." },
});

router.post(
  "/verify-email/resend-by-email",
  resendActivationLimiter,
  asyncHandler(async (req, res) => {
    const email =
      typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (!email || !EMAIL_RE.test(email))
      throw new HttpError(400, "Enter a valid email address");

    if (config.appUrl) {
      const { rows } = await query(
        `SELECT id, email, email_verified_at, password_hash FROM admins WHERE email = $1`,
        [email],
      );
      const admin = rows[0];
      if (admin && admin.password_hash && !admin.email_verified_at) {
        const rawToken = generateRawToken();
        await query(
          `UPDATE admins SET email_verify_token_hash = $1, email_verify_token_expires = now() + interval '24 hours'
           WHERE id = $2`,
          [hashRawToken(rawToken), admin.id],
        );
        mailer
          .sendVerifyEmail(admin.email, buildLink("/verify-email.html", rawToken))
          .catch((err) => console.error("[auth/resend-by-email] Gagal kirim email:", err.message));
      }
    }

    res.json({
      ok: true,
      message: "If that email needs activating, a new link is on its way.",
    });
  }),
);

// Requires an active session (rather than taking an email in the body) so a stranger
// can't use this to spam someone else's inbox with verification emails.
router.post(
  "/verify-email/resend",
  requireAdmin,
  resendVerifyLimiter,
  asyncHandler(async (req, res) => {
    if (req.admin.email_verified_at) {
      return res.json({ ok: true, alreadyVerified: true });
    }
    if (!config.appUrl) {
      throw new HttpError(
        503,
        "Email verification isn't configured on the server yet.",
      );
    }

    const rawToken = generateRawToken();
    await query(
      `UPDATE admins SET email_verify_token_hash = $1, email_verify_token_expires = now() + interval '24 hours'
       WHERE id = $2`,
      [hashRawToken(rawToken), req.admin.id],
    );
    await mailer.sendVerifyEmail(
      req.admin.email,
      buildLink("/verify-email.html", rawToken),
    );

    res.json({ ok: true });
  }),
);

module.exports = router;
