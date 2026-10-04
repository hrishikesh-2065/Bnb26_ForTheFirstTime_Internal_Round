/* ============================================================================
   FairDrop — routes/queue.js   (protected queue endpoints)

   POST /queue/join      join the fair queue (creates a queue_entries row)
   GET  /queue/status    my position / reservation / seats left
   POST /queue/confirm   confirm my active 20-second reservation

   Every route requires a valid login session (requireAuth).
   The rules themselves live in services/queueService.js.
   ============================================================================ */
const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { joinLimiter } = require("../middleware/rateLimit");
const queue = require("../services/queueService");

const router = express.Router();

router.post("/join", joinLimiter, requireAuth, async function (req, res) {
  const result = await queue.joinQueue(req.user.id);
  if (result.error) {
    return res.status(result.status || 400).json({ success: false, message: result.error });
  }
  res.json({ success: true, message: "You joined the fair queue." });
});

router.get("/status", requireAuth, async function (req, res) {
  const status = await queue.getStatus(req.user.id);
  if (!status) {
    return res.status(500).json({ success: false, message: "No drop exists. Import database/schema.sql." });
  }
  res.json({ success: true, ...status });
});

router.post("/confirm", requireAuth, async function (req, res) {
  const result = await queue.confirmReservation(req.user.id);
  if (result.error) {
    return res.status(result.status || 400).json({ success: false, message: result.error });
  }
  res.json({ success: true, message: "Reservation confirmed." });
});

module.exports = router;
