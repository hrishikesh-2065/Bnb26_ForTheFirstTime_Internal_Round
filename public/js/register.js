/* ==========================================================================
   FairDrop — js/register.js   (used by register.html)

   FLOW
     1. Check the fields in the browser (quick feedback only)
     2. POST /auth/register  { username, password }
     3. Backend validates AGAIN, hashes the password with bcrypt, and runs
        INSERT INTO users (username, password_hash) ...  in MySQL
     4. On success -> go to the login page

   API  ->  POST /auth/register
     Request : { "username": "...", "password": "..." }
     Success : 201 { "success": true, "message": "..." }
     Failure : 400 / 409 { "success": false, "message": "..." }

   SECURITY NOTES
     - Browser checks are for convenience. The backend is the real validator.
     - The password is never saved in localStorage / sessionStorage.
     - The "Confirm password" value is NOT sent; it only exists in the browser.
   ========================================================================== */

const API_REGISTER = "/auth/register";
const LOGIN_PAGE = "index.html";
const MIN_PASSWORD_LENGTH = 8;                  // keep in sync with routes/auth.js
const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/; // keep in sync with routes/auth.js

const form = document.getElementById("registerForm");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const confirmInput = document.getElementById("confirmPassword");
const registerBtn = document.getElementById("registerBtn");
const messageBox = document.getElementById("message");

function showMessage(text, type) {
  messageBox.textContent = text;
  messageBox.className = "message " + (type || "");
}

// Returns { error, field }. error is "" when everything is fine.
function validate(username, password, confirm) {
  if (!username) return { error: "Username is required.", field: usernameInput };
  if (!USERNAME_PATTERN.test(username)) {
    return { error: "Username must be 3–20 letters, numbers or underscores.", field: usernameInput };
  }
  if (!password) return { error: "Password is required.", field: passwordInput };
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: "Password must be at least " + MIN_PASSWORD_LENGTH + " characters.", field: passwordInput };
  }
  if (password !== confirm) return { error: "Passwords do not match.", field: confirmInput };
  return { error: "", field: null };
}

[usernameInput, passwordInput, confirmInput].forEach(function (input) {
  input.addEventListener("input", function () { input.classList.remove("invalid"); });
});

form.addEventListener("submit", async function (event) {
  event.preventDefault();
  showMessage("", "");

  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  const check = validate(username, password, confirmInput.value);
  if (check.error) {
    check.field.classList.add("invalid");
    check.field.focus();
    return showMessage(check.error, "error");
  }

  registerBtn.disabled = true;
  registerBtn.textContent = "Creating account...";

  try {
    const response = await fetch(API_REGISTER, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username, password: password })
    });
    const result = await response.json().catch(function () {
      return { success: false, message: "Unexpected server response." };
    });

    if (result.success) {
      passwordInput.value = "";
      confirmInput.value = "";
      showMessage("Account created. Redirecting to login...", "success");
      setTimeout(function () { window.location.href = LOGIN_PAGE; }, 1200);
      return;
    }
    showMessage(result.message || "Registration failed.", "error");
  } catch (err) {
    showMessage("Cannot reach the server. Is `npm start` running?", "error");
  }

  registerBtn.disabled = false;
  registerBtn.textContent = "Create account";
});
