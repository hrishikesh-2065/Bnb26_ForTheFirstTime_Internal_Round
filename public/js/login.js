/* ==========================================================================
   FairDrop — js/login.js   (used by index.html)

   FLOW
     1. Fetch the public reCAPTCHA SITE key from GET /config and draw the checkbox
     2. User fills the form and ticks the CAPTCHA
     3. POST /auth/login  { username, password, captchaToken }
     4. Backend checks CAPTCHA with Google, checks the password hash in MySQL,
        creates a session row, and sets an HttpOnly cookie
     5. On success -> go to dashboard.html

   API  ->  POST /auth/login
     Request : { "username": "...", "password": "...", "captchaToken": "..." }
     Success : { "success": true, "user": { "id": 1, "username": "..." } }
     Failure : { "success": false, "message": "text for the user" }

   SECURITY NOTES
     - The browser never sees the reCAPTCHA SECRET key (only the backend has it).
     - The password is sent once and never stored in the browser.
     - The login session is an HttpOnly cookie. JavaScript cannot read it,
       so there is nothing to save here.
   ========================================================================== */

const API = {
  login: "/auth/login",
  me: "/auth/me",
  config: "/config"
};
const DASHBOARD_PAGE = "dashboard.html";

const form = document.getElementById("loginForm");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const loginBtn = document.getElementById("loginBtn");
const messageBox = document.getElementById("message");
const captchaHint = document.getElementById("captchaHint");

let captchaWidgetId = null;

function showMessage(text, type) {
  messageBox.textContent = text;
  messageBox.className = "message " + (type || "");
}

// Same origin as the backend, so the cookie is sent automatically.
async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body)
  });
  return response.json().catch(function () {
    return { success: false, message: "Unexpected server response." };
  });
}

// ---------- reCAPTCHA ----------
async function setupCaptcha() {
  try {
    const config = await (await fetch(API.config)).json();
    if (!config.recaptchaSiteKey) {
      captchaHint.textContent = "Server has no RECAPTCHA_SITE_KEY in .env.";
      return;
    }
    // Wait until Google's script has loaded, then draw the checkbox.
    const timer = setInterval(function () {
      if (window.grecaptcha && window.grecaptcha.render) {
        clearInterval(timer);
        captchaWidgetId = grecaptcha.render("captchaBox", { sitekey: config.recaptchaSiteKey });
        captchaHint.textContent = "";
      }
    }, 100);
  } catch (err) {
    captchaHint.textContent = "Cannot reach the FairDrop server. Is `npm start` running?";
  }
}

// Already logged in? Skip the login page.
async function redirectIfLoggedIn() {
  try {
    const response = await fetch(API.me, { credentials: "same-origin" });
    if (response.ok) window.location.href = DASHBOARD_PAGE;
  } catch (err) { /* server down: stay on the page */ }
}

// ---------- Form submit ----------
form.addEventListener("submit", async function (event) {
  event.preventDefault();
  showMessage("", "");

  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  const captchaToken = (window.grecaptcha && captchaWidgetId !== null)
    ? grecaptcha.getResponse(captchaWidgetId) : "";

  if (!username) return showMessage("Please enter your username.", "error");
  if (!password) return showMessage("Please enter your password.", "error");
  if (!captchaToken) return showMessage("Please tick the CAPTCHA checkbox.", "error");

  loginBtn.disabled = true;
  loginBtn.textContent = "Logging in...";

  try {
    const result = await postJson(API.login, { username: username, password: password, captchaToken: captchaToken });

    if (result.success) {
      window.location.href = DASHBOARD_PAGE;
      return;
    }
    showMessage(result.message || "Login failed.", "error");
  } catch (err) {
    showMessage("Cannot reach the server. Try again later.", "error");
  }

  // Failed: a CAPTCHA token works only once, so reset the checkbox.
  if (window.grecaptcha && captchaWidgetId !== null) grecaptcha.reset(captchaWidgetId);
  loginBtn.disabled = false;
  loginBtn.textContent = "Log in";
});

redirectIfLoggedIn();
setupCaptcha();
