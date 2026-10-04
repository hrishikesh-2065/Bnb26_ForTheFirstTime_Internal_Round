/* ============================================================================
   FairDrop — routes/auth.js   (accounts + login sessions)

   POST /auth/register   create account  -> INSERT into MySQL "users"
   POST /auth/login      check password + CAPTCHA, create a session
   POST /auth/logout     delete the session
   GET  /auth/me         who am I? (also tells the frontend if still logged in)

   Passwords: hashed with bcrypt. The plain password is never stored or logged.
   Sessions : random token in an HttpOnly cookie; MySQL stores its SHA-256 hash.
   ============================================================================ */
const crypto = require("crypto");
const express = require("express");
const bcrypt = require("bcryptjs");
const { pool } = require("../db");
const { requireAuth, hashToken, COOKIE_NAME } = require("../middleware/auth");
const { loginLimiter, registerLimiter } = require("../middleware/rateLimit");
const { verifyCaptcha } = require("../services/captcha");

const router = express.Router();

// ---- Rules (change here) ----
const BCRYPT_ROUNDS = 12;                       // higher = slower = harder to crack
const SESSION_HOURS = 2;                        // how long a login lasts
const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD_BYTES = 72;                  // bcrypt ignores anything longer

// A fake hash used when the username does not exist, so "unknown user" and
// "wrong password" take the same time (stops username guessing by timing).
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", BCRYPT_ROUNDS);

function cookieOptions() {
  return {
    httpOnly: true,                                  // JavaScript cannot read it
    sameSite: "lax",                                 // not sent from other sites
    secure: process.env.NODE_ENV === "production",   // HTTPS only in production
    maxAge: SESSION_HOURS * 60 * 60 * 1000,
    path: "/"
  };
}

// ---------------------------------------------------------------- REGISTER
router.post("/register", registerLimiter, async function (req, res) {
  const username = typeof req.body.username === "string" ? req.body.username.trim() : "";
  const password = typeof req.body.password === "string" ? req.body.password : "";

  // 1-2) validate username + password
  if (!USERNAME_PATTERN.test(username)) {
    return res.status(400).json({ success: false, message: "Username must be 3-20 letters, numbers or underscores." });
  }
  if (password.length < MIN_PASSWORD) {
    return res.status(400).json({ success: false, message: "Password must be at least " + MIN_PASSWORD + " characters." });
  }
  if (Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES) {
    return res.status(400).json({ success: false, message: "Password is too long (max 72 bytes)." });
  }

  // 3) does the username already exist?
  const [existing] = await pool.query("SELECT id FROM users WHERE username = ?", [username]);
  if (existing.length > 0) {
    return res.status(409).json({ success: false, message: "That username is already taken." });
  }

  // 4) hash the password (bcrypt)
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  // 5) INSERT into MySQL  (this is the row you will see in phpMyAdmin)
  try {
    await pool.query("INSERT INTO users (username, password_hash) VALUES (?, ?)", [username, passwordHash]);
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") { // two people registered the same name at once
      return res.status(409).json({ success: false, message: "That username is already taken." });
    }
    throw err;
  }

  // 6) answer
  res.status(201).json({ success: true, message: "Account created. You can log in now." });
});

// ------------------------------------------------------------------- LOGIN
router.post("/login", loginLimiter, async function (req, res) {
  const username = typeof req.body.username === "string" ? req.body.username.trim() : "";
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const captchaToken = typeof req.body.captchaToken === "string" ? req.body.captchaToken : "";

  if (!username || !password) {
    return res.status(400).json({ success: false, message: "Username and password are required." });
  }

  // CAPTCHA first: verified with Google using the SECRET key (server only)
  const captcha = await verifyCaptcha(captchaToken);
  if (!captcha.ok) {
    return res.status(captcha.status).json({ success: false, message: captcha.reason });
  }

  // Find the user in MySQL and compare the password with the stored hash
  const [rows] = await pool.query("SELECT id, username, password_hash FROM users WHERE username = ?", [username]);
  const user = rows[0];
  const passwordOk = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);

  if (!user || !passwordOk) {
    return res.status(401).json({ success: false, message: "Invalid username or password." });
  }

  // Create the session: random token -> cookie; its hash -> MySQL "sessions"
  const token = crypto.randomBytes(32).toString("hex");
  await pool.query(
    "INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR))",
    [user.id, hashToken(token), SESSION_HOURS]
  );

  res.cookie(COOKIE_NAME, token, cookieOptions());
  res.json({ success: true, message: "Login successful.", user: { id: user.id, username: user.username } });
});

// ------------------------------------------------------------------ LOGOUT
router.post("/logout", async function (req, res) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (token) await pool.query("DELETE FROM sessions WHERE token = ?", [hashToken(token)]);
  res.clearCookie(COOKIE_NAME, { path: "/" });
  res.json({ success: true, message: "Logged out." });
});

// ---------------------------------------------------------------------- ME
router.get("/me", requireAuth, function (req, res) {
  res.json({ success: true, user: req.user });
});

module.exports = router;
