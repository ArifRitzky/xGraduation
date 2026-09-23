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
// LOGIN PAGE LOGIC
// =========================================
const loginForm = document.getElementById("loginForm");
const loginEmail = document.getElementById("loginEmail");
const loginPassword = document.getElementById("loginPassword");
const loginBtn = document.getElementById("loginBtn");
const loginError = document.getElementById("loginError");
const togglePasswordBtn = document.getElementById("togglePassword");

const DASHBOARD_URL = "dashboard.html";

function showLoginError(message) {
  loginError.textContent = message;
  loginError.classList.remove("hidden");
}

const resendActivationBtn = document.getElementById("resendActivationBtn");

function clearLoginError() {
  loginError.textContent = "";
  loginError.classList.add("hidden");
  resendActivationBtn.classList.add("hidden");
}

// Already have a valid session: go straight to the dashboard.
api("/api/auth/me")
  .then(() => location.replace(DASHBOARD_URL))
  .catch(() => {
    // Not logged in (401) or server unreachable: stay on this page.
  });

// =========================================
// LOGIN WITH GOOGLE
// =========================================
const GOOGLE_CLIENT_ID = window.PHOTOPROOFING_GOOGLE_CLIENT_ID || "";
const googleSignInContainer = document.getElementById("googleSignInContainer");
const loginDivider = document.getElementById("loginDivider");

async function handleGoogleCredential(response) {
  clearLoginError();
  try {
    await api("/api/auth/google", {
      method: "POST",
      body: { credential: response.credential },
    });

    // Same as password login: make sure the browser actually stored the session.
    try {
      await api("/api/auth/me");
    } catch (sessionErr) {
      if (sessionErr.status === 401) {
        throw new ApiError(
          0,
          "Google login succeeded, but the browser didn't store the session. This " +
            "usually happens when the page and the backend use different hostnames " +
            "(localhost vs 127.0.0.1). Open this page from http://localhost:5500.",
        );
      }
      throw sessionErr;
    }
    location.replace(DASHBOARD_URL);
  } catch (err) {
    showLoginError(err.message);
  }
}

// If the client ID isn't set in app-config.js, or the Google script fails to load
// (blocked by the network, etc.), the button and the "or" divider are hidden - the
// email/password form remains the only way to log in, nothing breaks.
if (GOOGLE_CLIENT_ID && window.google && window.google.accounts) {
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: handleGoogleCredential,
  });

  // Google's renderButton only accepts a fixed pixel width (no "100%"),
  // so we measure the actual space inside the login card and clamp to
  // that instead of hardcoding 320px - a fixed 320px overflows narrow
  // phone screens and forces the whole page to scroll sideways.
  const loginCard = document.querySelector(".login-card");
  const cardStyles = getComputedStyle(loginCard);
  const availableWidth =
    loginCard.clientWidth - parseFloat(cardStyles.paddingLeft) - parseFloat(cardStyles.paddingRight);
  const googleButtonWidth = Math.max(220, Math.min(320, Math.floor(availableWidth)));

  google.accounts.id.renderButton(googleSignInContainer, {
    type: "standard",
    theme: "outline",
    size: "large",
    text: "signin_with",
    shape: "rectangular",
    width: googleButtonWidth,
  });
  googleSignInContainer.classList.remove("hidden");
  loginDivider.classList.remove("hidden");
}

togglePasswordBtn.addEventListener("click", () => {
  const show = loginPassword.type === "password";
  loginPassword.type = show ? "text" : "password";
  togglePasswordBtn.textContent = show ? "Hide" : "Show";
  togglePasswordBtn.setAttribute("aria-pressed", String(show));
});

[loginEmail, loginPassword].forEach((input) =>
  input.addEventListener("input", clearLoginError),
);

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearLoginError();

  const email = loginEmail.value.trim();
  const password = loginPassword.value;
  if (!email || !password) {
    showLoginError("Enter your email and password.");
    (email ? loginPassword : loginEmail).focus();
    return;
  }

  loginBtn.disabled = true;
  loginBtn.textContent = "Processing...";
  try {
    await api("/api/auth/login", { method: "POST", body: { email, password } });

    // Make sure the browser actually stored the session before moving to the dashboard.
    // Otherwise the dashboard would immediately bounce back to this page.
    try {
      await api("/api/auth/me");
    } catch (sessionErr) {
      if (sessionErr.status === 401) {
        throw new ApiError(
          0,
          "Email and password were correct, but the browser didn't store the login " +
            "session. This usually happens when the page and the backend use different " +
            "hostnames (localhost vs 127.0.0.1). Open this page from " +
            "http://localhost:5500 and make sure app-config.js points to http://localhost:3000.",
        );
      }
      throw sessionErr;
    }
    location.replace(DASHBOARD_URL);
  } catch (err) {
    showLoginError(err.message);
    loginBtn.disabled = false;
    loginBtn.textContent = "Log In";
    if (err.status === 401) {
      loginPassword.select();
    }
    if (err.status === 403) {
      // Account exists but hasn't been activated yet - offer to resend the link.
      resendActivationBtn.classList.remove("hidden");
    }
  }
});

resendActivationBtn.addEventListener("click", async () => {
  resendActivationBtn.disabled = true;
  const previousLabel = resendActivationBtn.textContent;
  resendActivationBtn.textContent = "Sending...";
  try {
    await api("/api/auth/verify-email/resend-by-email", {
      method: "POST",
      body: { email: loginEmail.value.trim() },
    });
    showLoginError("If that email needs activating, a new link is on its way.");
  } catch (err) {
    showLoginError(err.message);
  } finally {
    resendActivationBtn.disabled = false;
    resendActivationBtn.textContent = previousLabel;
  }
});