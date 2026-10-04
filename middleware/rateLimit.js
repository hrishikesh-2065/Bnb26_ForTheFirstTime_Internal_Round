/* ============================================================================
   FairDrop — middleware/rateLimit.js   (basic anti-abuse)

   Limits how many requests one IP address can make per minute.
   NOTE: CAPTCHA + rate limiting do NOT stop every bot. They only raise the
   cost of abuse. (IP is used here ONLY to slow abuse down. It is never used
   to identify a user. Users are identified by their login session.)

   Edit the numbers below to make limits stricter or looser.
   ============================================================================ */
const rateLimit = require("express-rate-limit");
const { recordDetected } = require("../services/botMonitor");

function makeLimiter(windowMs, limit, message) {
  return rateLimit({
    windowMs: windowMs,
    limit: limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: function (req, res, next, options) {
      recordDetected(1, message, "rate-limit");
      res.status(options.statusCode).json(options.message);
    },
    message: { success: false, message: message }
  });
}

const MINUTE = 60 * 1000;

module.exports = {
  loginLimiter:    makeLimiter(MINUTE, 10, "Too many login attempts. Wait a minute and try again."),
  registerLimiter: makeLimiter(MINUTE, 10, "Too many registration attempts. Wait a minute and try again."),
  joinLimiter:     makeLimiter(MINUTE, 10, "Too many queue requests. Wait a minute and try again.")
};
