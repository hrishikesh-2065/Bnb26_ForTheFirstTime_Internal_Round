/* ============================================================================
   FairDrop — server.js   (start here: `npm start`)

   Express app that
     1. serves the website from /public
     2. exposes the JSON API   (/auth/*, /queue/*, /health, /config)
     3. talks to MySQL through db.js
     4. runs a 1-second timer that expires reservations and promotes the queue

   Browser -> Express API -> MySQL -> (you look at it in phpMyAdmin)
   ============================================================================ */
require("dotenv").config({ quiet: true });

const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const { pool, testConnection, explainDbError } = require("./db");
const { tickAllDrops } = require("./services/queueService");
const { requireAuth } = require("./middleware/auth");
const { getStats, recordDetected } = require("./services/botMonitor");

const authRoutes = require("./routes/auth");
const queueRoutes = require("./routes/queue");

const app = express();
const PORT = process.env.PORT || 3000;

app.disable("x-powered-by");
app.use(express.json({ limit: "10kb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public"))); // index.html, register.html, ...

// ---- API routes ----
app.use("/auth", authRoutes);
app.use("/queue", queueRoutes);

// Public settings the frontend needs. The SITE key is public by design.
// (The reCAPTCHA SECRET key is never sent to the browser.)
app.get("/config", function (req, res) {
  res.json({ success: true, recaptchaSiteKey: process.env.RECAPTCHA_SITE_KEY || "" });
});

// Live security counters for the authenticated dashboard. These are display-only
// and reset when the Node process restarts.
app.get("/security/bot-stats", requireAuth, function (req, res) {
  res.json({ success: true, ...getStats() });
});

// Local-only endpoint used by scripts/stress-test.js to report simulated bot
// clients to the live dashboard. It cannot be called from another machine.
app.post("/security/demo-bots", function (req, res) {
  const remote = String(req.socket.remoteAddress || "");
  const localOnly = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
  const expected = process.env.BOT_DEMO_KEY || (process.env.NODE_ENV === "production" ? "" : "fairdrop-demo-local");
  const supplied = req.get("x-fairdrop-demo-key") || "";
  if (!localOnly || !expected || supplied !== expected) {
    return res.status(403).json({ success: false, message: "Demo bot endpoint is local-only." });
  }

  const count = Math.min(Math.max(Number(req.body && req.body.count) || 0, 0), 2000);
  if (!count) return res.status(400).json({ success: false, message: "count must be between 1 and 2000." });
  recordDetected(count, "Concurrent automated clients stopped by FairDrop demo defense", "terminal-stress-test");
  res.json({ success: true, ...getStats() });
});

// Health check: proves the backend can really talk to MySQL.
app.get("/health", async function (req, res) {
  try {
    await testConnection();
  } catch (err) {
    return res.status(503).json({ success: false, database: "disconnected", message: explainDbError(err) });
  }
  try {
    const [[row]] = await pool.query("SELECT COUNT(*) AS n FROM users");
    res.json({ success: true, database: "connected", users: row.n });
  } catch (err) {
    res.status(503).json({ success: false, database: "connected", schema: "missing", message: explainDbError(err) });
  }
});

// Unknown URL
app.use(function (req, res) {
  res.status(404).json({ success: false, message: "Not found." });
});

// Any error thrown inside a route lands here (Express 5 forwards async errors).
app.use(function (err, req, res, next) {
  console.error("[error]", req.method, req.originalUrl, "-", err.code || "", err.message);
  const isDb = err.code && (String(err.code).startsWith("ER_") || err.code === "ECONNREFUSED" || err.code === "PROTOCOL_CONNECTION_LOST");
  if (isDb) {
    return res.status(503).json({ success: false, message: explainDbError(err) });
  }
  res.status(500).json({ success: false, message: "Server error." });
});

// ---- Start ----
app.listen(PORT, async function () {
  console.log("FairDrop running at http://localhost:" + PORT);

  try {
    await testConnection();
    const [[row]] = await pool.query("SELECT DATABASE() AS db");
    console.log("MySQL: CONNECTED (database '" + row.db + "')");
  } catch (err) {
    console.log("MySQL: FAILED  ->  " + explainDbError(err));
  }

  if (!process.env.RECAPTCHA_SECRET_KEY) {
    console.log("WARNING: RECAPTCHA_SECRET_KEY is empty in .env. Login will not work.");
  }

  // Every second: expire late reservations, give free seats to the queue.
  let ticking = false;
  let lastTickError = "";
  setInterval(async function () {
    if (ticking) return;
    ticking = true;
    try {
      await tickAllDrops();
      lastTickError = "";
    } catch (err) {
      if (err.message !== lastTickError) { // log each new problem once, not every second
        console.log("[queue timer] " + explainDbError(err));
        lastTickError = err.message;
      }
    } finally {
      ticking = false;
    }
  }, 1000);

  // Every 10 minutes: delete expired login sessions.
  setInterval(function () {
    pool.query("DELETE FROM sessions WHERE expires_at <= NOW()").catch(function () {});
  }, 10 * 60 * 1000);
});
