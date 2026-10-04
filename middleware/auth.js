/* ============================================================================
   FairDrop — middleware/auth.js   (who is making this request?)

   requireAuth reads the session cookie, looks the session up in MySQL, and
   puts the logged-in user on req.user = { id, username }.
   No valid session -> HTTP 401 and the route never runs.

   IP address = where the request came from.
   Session    = which authenticated user made the request.   <- we use this.
   ============================================================================ */
const crypto = require("crypto");
const { pool } = require("../db");

const COOKIE_NAME = "fairdrop_session";

// The cookie holds a random token. MySQL stores only its SHA-256 hash.
function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ success: false, message: "Please log in." });
  }

  const [rows] = await pool.query(
    `SELECT u.id, u.username
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > NOW()`,
    [hashToken(token)]
  );

  if (rows.length === 0) {
    return res.status(401).json({ success: false, message: "Session expired. Please log in again." });
  }

  req.user = { id: rows[0].id, username: rows[0].username };
  req.sessionHash = hashToken(token);
  next();
}

module.exports = { requireAuth, hashToken, COOKIE_NAME };
