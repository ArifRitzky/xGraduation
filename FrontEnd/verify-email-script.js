// =========================================
// VERIFY EMAIL PAGE LOGIC
// Reads the token from the URL (?token=...), sends it to the server once,
// then reports success or failure. There's nothing for the person to type -
// this page just runs itself as soon as it loads.
// =========================================
const verifyTitle = document.getElementById("verifyTitle");
const verifyMessage = document.getElementById("verifyMessage");

const DASHBOARD_URL = "dashboard.html";
const token = new URLSearchParams(location.search).get("token") || "";

async function run() {
  if (!token) {
    verifyTitle.textContent = "Link is missing its token";
    verifyMessage.textContent =
      "Open the verification link from your email again, or request a new one from your dashboard.";
    return;
  }

  try {
    await api("/api/auth/verify-email", { method: "POST", body: { token } });
    verifyTitle.textContent = "Email verified";
    verifyMessage.textContent = "Taking you to your dashboard...";
    setTimeout(() => location.replace(DASHBOARD_URL), 1500);
  } catch (err) {
    verifyTitle.textContent = "Verification failed";
    verifyMessage.textContent =
      err.status === 400
        ? "This link is invalid or has expired. Log in and request a new verification email from your dashboard."
        : err.message;
  }
}

run();
