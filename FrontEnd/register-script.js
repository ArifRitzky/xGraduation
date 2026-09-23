// =========================================
// BFCACHE GUARD
// If the browser restores this page from the back/forward cache instead of
// loading it fresh, none of the script below re-runs - so the "already
// logged in? go to dashboard" check further down never fires again, and
// you can end up stuck looking at a stale version of this page. Force a
// reload so that check actually happens.
// =========================================
window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    location.reload();
  }
});

// =========================================
// SIGN UP PAGE LOGIC
// =========================================
const registerForm = document.getElementById("registerForm");
const registerName = document.getElementById("registerName");
const registerEmail = document.getElementById("registerEmail");
const registerPassword = document.getElementById("registerPassword");
const registerPasswordConfirm = document.getElementById("registerPasswordConfirm");
const registerBtn = document.getElementById("registerBtn");
const registerError = document.getElementById("registerError");
const toggleRegisterPasswordBtn = document.getElementById("toggleRegisterPassword");

const DASHBOARD_URL = "dashboard.html";

function showRegisterError(message) {
  registerError.textContent = message;
  registerError.classList.remove("hidden");
}

function clearRegisterError() {
  registerError.textContent = "";
  registerError.classList.add("hidden");
}

// Already have a valid session: go straight to the dashboard, no need to sign up again.
api("/api/auth/me")
  .then(() => location.replace(DASHBOARD_URL))
  .catch(() => {
    // Not logged in (401) or server unreachable: stay on this page.
  });

// =========================================
// SIGN UP / LOG IN WITH GOOGLE
// Same as the login page - if no account exists yet for this email, the
// backend creates one automatically. This button acts as both "sign up" and "log in".
// =========================================
const GOOGLE_CLIENT_ID = window.PHOTOPROOFING_GOOGLE_CLIENT_ID || "";
const googleSignInContainer = document.getElementById("googleSignInContainer");
const loginDivider = document.getElementById("loginDivider");

async function handleGoogleCredential(response) {
  clearRegisterError();
  try {
    await api("/api/auth/google", {
      method: "POST",
      body: { credential: response.credential },
    });
    try {
      await api("/api/auth/me");
    } catch (sessionErr) {
      if (sessionErr.status === 401) {
        throw new ApiError(
          0,
          "Succeeded, but the browser didn't store the session. This usually happens " +
            "when the page and the backend use different hostnames (localhost vs " +
            "127.0.0.1). Open this page from http://localhost:5500.",
        );
      }
      throw sessionErr;
    }
    location.replace(DASHBOARD_URL);
  } catch (err) {
    showRegisterError(err.message);
  }
}

let googleButtonShown = false;

if (GOOGLE_CLIENT_ID && window.google && window.google.accounts) {
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: handleGoogleCredential,
  });
  google.accounts.id.renderButton(googleSignInContainer, {
    type: "standard",
    theme: "outline",
    size: "large",
    text: "signup_with",
    shape: "rectangular",
    width: 320,
  });
  googleSignInContainer.classList.remove("hidden");
  googleButtonShown = true;
}

// =========================================
// EMAIL + PASSWORD SIGN UP: CONTROLLED BY THE SERVER
// Closed by default (the signer's email isn't verified, so someone else could
// register with your email first). The form stays hidden until the server confirms
// sign-up is open, so if the server is unreachable, the form never appears incorrectly.
// =========================================
const signupNotice = document.getElementById("signupNotice");

function showSignupNotice(message) {
  signupNotice.textContent = message;
  signupNotice.classList.remove("hidden");
}

api("/api/auth/options")
  .then((options) => {
    if (options.passwordSignup) {
      registerForm.classList.remove("hidden");
      if (googleButtonShown) loginDivider.classList.remove("hidden");
      return;
    }
    showSignupNotice(
      googleButtonShown
        ? "New accounts are created through your Google account."
        : "New account sign-up isn't open yet.",
    );
  })
  .catch(() => {
    showSignupNotice(
      "Couldn't reach the server. Make sure the backend is running, then reload this page.",
    );
  });

toggleRegisterPasswordBtn.addEventListener("click", () => {
  const show = registerPassword.type === "password";
  registerPassword.type = show ? "text" : "password";
  toggleRegisterPasswordBtn.textContent = show ? "Hide" : "Show";
  toggleRegisterPasswordBtn.setAttribute("aria-pressed", String(show));
});

[registerName, registerEmail, registerPassword, registerPasswordConfirm].forEach((input) =>
  input.addEventListener("input", clearRegisterError),
);

registerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearRegisterError();

  const name = registerName.value.trim();
  const email = registerEmail.value.trim();
  const password = registerPassword.value;
  const passwordConfirm = registerPasswordConfirm.value;

  if (!name || !email || !password || !passwordConfirm) {
    showRegisterError("All fields are required.");
    return;
  }
  if (password.length < 8) {
    showRegisterError("Password must be at least 8 characters.");
    registerPassword.focus();
    return;
  }
  if (password !== passwordConfirm) {
    showRegisterError("Password and confirmation don't match.");
    registerPasswordConfirm.focus();
    return;
  }

  registerBtn.disabled = true;
  registerBtn.textContent = "Processing...";
  try {
    await api("/api/auth/register", { method: "POST", body: { name, email, password } });

    // No session is created at this point - the account needs to be activated via
    // the emailed link before it can log in (see /login in routes/auth.js).
    registerForm.classList.add("hidden");
    document.getElementById("registerSuccessEmail").textContent = email;
    document.getElementById("registerSuccess").classList.remove("hidden");
  } catch (err) {
    showRegisterError(err.message);
    registerBtn.disabled = false;
    registerBtn.textContent = "Create Account";
    if (err.status === 409) {
      registerEmail.select();
    }
  }
});

// ---- Resend activation email (no session yet at this point) ----
const resendActivationBtn = document.getElementById("resendActivationBtn");
const resendActivationMsg = document.getElementById("resendActivationMsg");
resendActivationBtn.addEventListener("click", async () => {
  resendActivationBtn.disabled = true;
  const previousLabel = resendActivationBtn.textContent;
  resendActivationBtn.textContent = "Sending...";
  try {
    await api("/api/auth/verify-email/resend-by-email", {
      method: "POST",
      body: { email: registerEmail.value.trim() },
    });
    resendActivationMsg.textContent = "If that email needs activating, a new link is on its way.";
    resendActivationMsg.classList.remove("hidden");
  } catch (err) {
    resendActivationMsg.textContent = err.message;
    resendActivationMsg.classList.remove("hidden");
  } finally {
    resendActivationBtn.disabled = false;
    resendActivationBtn.textContent = previousLabel;
  }
});