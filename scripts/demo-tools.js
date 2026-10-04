/* ============================================================================
   FairDrop — scripts/demo-tools.js   (OPTIONAL demo helpers)

   Real queue positions only show up when OTHER people are in the queue.
   For a solo demo, this script adds pretend people to the real database.

     npm run demo:fill        add 15 demo users to the queue (default)
     node scripts/demo-tools.js fill 30     add 30
     npm run demo:reset       clear queue + reservations, refill all seats

   Demo users are named "queuebot_xxxxxx". They are real rows in MySQL and they
   go through the real queue rules (they never confirm, so their seats expire).
   ============================================================================ */
require("dotenv").config({ quiet: true });
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { pool, explainDbError } = require("../db");
const { joinQueue } = require("../services/queueService");

async function fill(count) {
  const hash = await bcrypt.hash(crypto.randomBytes(16).toString("hex"), 4); // nobody can log in as a bot
  for (let i = 0; i < count; i++) {
    const name = "queuebot_" + crypto.randomBytes(3).toString("hex");
    const [r] = await pool.query("INSERT INTO users (username, password_hash) VALUES (?, ?)", [name, hash]);
    const result = await joinQueue(r.insertId);
    if (result.error) { console.log("Stopped:", result.error); break; }
  }
  console.log("Added demo users to the queue. Check phpMyAdmin: fairdrop -> queue_entries");
}

async function reset() {
  await pool.query("DELETE FROM reservations");
  await pool.query("DELETE FROM queue_entries");
  await pool.query("UPDATE drops SET available_capacity = total_capacity");
  await pool.query("DELETE FROM users WHERE username LIKE 'queuebot\\_%'");
  console.log("Reset done: queue and reservations cleared, all seats free, demo users removed.");
}

(async function main() {
  const command = process.argv[2];
  try {
    if (command === "fill") await fill(parseInt(process.argv[3], 10) || 15);
    else if (command === "reset") await reset();
    else console.log("Usage: node scripts/demo-tools.js fill [count] | reset");
  } catch (err) {
    console.error("Failed:", explainDbError(err));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
