/* ============================================================================
   FairDrop — services/botMonitor.js

   Small in-memory security dashboard for live demonstrations.
   - Real rate-limit blocks are counted here.
   - Local stress-test bots can report themselves through the protected demo
     endpoint, so the dashboard can show the terminal attack in real time.
   - Counters reset whenever the Node server restarts.
   ============================================================================ */

const state = {
  detected: 0,
  stopped: 0,
  lastEventAt: null,
  lastSource: "none",
  lastReason: "none"
};

function recordDetected(count, reason, source) {
  const n = Math.max(0, Number(count) || 0);
  if (!n) return;
  state.detected += n;
  state.stopped += n;
  state.lastEventAt = new Date().toISOString();
  state.lastSource = source || "rate-limit";
  state.lastReason = reason || "Automated traffic blocked";
}

function getStats() {
  return {
    detected: state.detected,
    stopped: state.stopped,
    active: Math.max(0, state.detected - state.stopped),
    lastEventAt: state.lastEventAt,
    lastSource: state.lastSource,
    lastReason: state.lastReason
  };
}

function reset() {
  state.detected = 0;
  state.stopped = 0;
  state.lastEventAt = null;
  state.lastSource = "none";
  state.lastReason = "none";
}

module.exports = { recordDetected, getStats, reset };
