// =========================================
// FORGOT PASSWORD PAGE LOGIC
// The server always answers the same way whether or not the email is
// registered (see routes/auth.js), so this page never reveals that either -
// it just shows one generic success message and gets out of the way.
// =========================================
const forgotForm = document.getElementById("forgotForm");
const forgotEmail = document.getElementById("forgotEmail");
const forgotBtn = document.getElementById("forgotBtn");
const forgotError = document.getElementById("forgotError");
const forgotSuccess = document.getElementById("forgotSuccess");

function showForgotError(message) {
  forgotError.textContent = message;
  forgotError.classList.remove("hidden");
}

function clearForgotError() {
  forgotError.textContent = "";
  forgotError.classList.add("hidden");
}

forgotEmail.addEventListener("input", clearForgotError);

forgotForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearForgotError();

  const email = forgotEmail.value.trim();
  if (!email) {
    showForgotError("Enter your email.");
    return;
  }

  forgotBtn.disabled = true;
  forgotBtn.textContent = "Sending...";
  try {
    await api("/api/auth/forgot-password", { method: "POST", body: { email } });
    forgotForm.classList.add("hidden");
    forgotSuccess.textContent =
      "If an account exists for that email, we've sent a link to reset the password. Check your inbox (and spam folder).";
    forgotSuccess.classList.remove("hidden");
  } catch (err) {
    showForgotError(err.message);
    forgotBtn.disabled = false;
    forgotBtn.textContent = "Send Reset Link";
  }
});
