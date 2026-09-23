// =========================================
// RESET PASSWORD PAGE LOGIC
// The token travels as a query string param (?token=...), the same one the
// server put in the email link. It's only ever sent in the POST body below,
// never displayed or logged anywhere on this page.
// =========================================
const resetForm = document.getElementById("resetForm");
const resetPassword = document.getElementById("resetPassword");
const resetPasswordConfirm = document.getElementById("resetPasswordConfirm");
const resetBtn = document.getElementById("resetBtn");
const resetError = document.getElementById("resetError");
const resetInvalid = document.getElementById("resetInvalid");
const resetSuccess = document.getElementById("resetSuccess");
const resetSubtitle = document.getElementById("resetSubtitle");
const toggleResetPasswordBtn = document.getElementById("toggleResetPassword");

const DASHBOARD_URL = "dashboard.html";
const token = new URLSearchParams(location.search).get("token") || "";

function showResetError(message) {
  resetError.textContent = message;
  resetError.classList.remove("hidden");
}

function clearResetError() {
  resetError.textContent = "";
  resetError.classList.add("hidden");
}

if (!token) {
  // No token in the URL at all - this page was opened directly, not from an email link.
  resetSubtitle.classList.add("hidden");
  resetInvalid.textContent =
    "This link is missing its reset token. Open the link from your email again, or request a new one.";
  resetInvalid.classList.remove("hidden");
} else {
  resetForm.classList.remove("hidden");
}

toggleResetPasswordBtn.addEventListener("click", () => {
  const show = resetPassword.type === "password";
  resetPassword.type = show ? "text" : "password";
  toggleResetPasswordBtn.textContent = show ? "Hide" : "Show";
  toggleResetPasswordBtn.setAttribute("aria-pressed", String(show));
});

[resetPassword, resetPasswordConfirm].forEach((input) =>
  input.addEventListener("input", clearResetError),
);

resetForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearResetError();

  const password = resetPassword.value;
  const passwordConfirm = resetPasswordConfirm.value;

  if (password.length < 8) {
    showResetError("Password must be at least 8 characters.");
    resetPassword.focus();
    return;
  }
  if (password !== passwordConfirm) {
    showResetError("Password and confirmation don't match.");
    resetPasswordConfirm.focus();
    return;
  }

  resetBtn.disabled = true;
  resetBtn.textContent = "Processing...";
  try {
    await api("/api/auth/reset-password", { method: "POST", body: { token, password } });
    resetForm.classList.add("hidden");
    resetSubtitle.classList.add("hidden");
    resetSuccess.textContent = "Password updated. Taking you to your dashboard...";
    resetSuccess.classList.remove("hidden");
    setTimeout(() => location.replace(DASHBOARD_URL), 1500);
  } catch (err) {
    // A used/expired/invalid token is a dead end on this page - point people to
    // requesting a fresh link instead of letting them retry the same broken one.
    if (err.status === 400) {
      resetForm.classList.add("hidden");
      resetSubtitle.classList.add("hidden");
      resetInvalid.textContent = err.message;
      resetInvalid.classList.remove("hidden");
      return;
    }
    showResetError(err.message);
    resetBtn.disabled = false;
    resetBtn.textContent = "Reset Password";
  }
});
