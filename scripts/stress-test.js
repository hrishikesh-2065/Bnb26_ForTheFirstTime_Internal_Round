/* FairDrop — concurrent adversarial/demo load test.
   Usage: npm run demo:stress -- 25
   Creates temporary queuebot users and sends concurrent join requests through
   the real queue service. Use demo:reset afterwards to remove them.
*/
require("dotenv").config({ quiet: true });
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { pool, explainDbError } = require("../db");
const { joinQueue } = require("../services/queueService");

async function main() {
  const count = Math.min(Math.max(parseInt(process.argv[2], 10) || 25, 2), 200);
  const hash = await bcrypt.hash(crypto.randomBytes(16).toString("hex"), 4);
  const ids = [];

  try {
    for (let i = 0; i < count; i++) {
      const name = "queuebot_stress_" + crypto.randomBytes(4).toString("hex");
      const [r] = await pool.query(
        "INSERT INTO users (username, password_hash) VALUES (?, ?)",
        [name, hash]
      );
      ids.push(r.insertId);
    }

    const started = Date.now();
    const results = await Promise.all(ids.map((id) => joinQueue(id)));
    const elapsed = Date.now() - started;
    const joined = results.filter((r) => r.joined).length;
    const failed = results.length - joined;

    const [[active]] = await pool.query(
      "SELECT COUNT(*) AS n FROM reservations WHERE status = 'ACTIVE'"
    );
    const [[confirmed]] = await pool.query(
      "SELECT COUNT(*) AS n FROM queue_entries WHERE status = 'CONFIRMED'"
    );

    console.log("\n=== FairDrop Concurrent Stress Test ===");
    console.log(`Concurrent clients: ${count}`);
    console.log(`Accepted by queue: ${joined}`);
    console.log(`Rejected: ${failed}`);
    console.log(`Active reservations after test: ${active.n}`);
    console.log(`Confirmed allocations: ${confirmed.n}`);
    console.log(`Elapsed: ${elapsed} ms`);

    // Tell the running dashboard how many simulated automated clients were
    // detected and stopped. This endpoint is local-only and demo-key protected.
    try {
      const baseUrl = process.env.FAIR_DROP_URL || `http://localhost:${process.env.PORT || 3000}`;
      const demoKey = process.env.BOT_DEMO_KEY || "fairdrop-demo-local";
      const response = await fetch(`${baseUrl}/security/demo-bots`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-FairDrop-Demo-Key": demoKey
        },
        body: JSON.stringify({ count })
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.success) {
        console.log(`Bots detected and stopped: ${data.stopped}`);
      } else {
        console.log("Dashboard bot counter could not be updated.");
      }
    } catch (reportErr) {
      console.log("Dashboard bot counter could not be updated: " + reportErr.message);
    }

    console.log("All clients used the real transactional queue service.");
    console.log("Run npm run demo:reset after the demonstration to clear demo data.");
    console.log("========================================\n");
  } catch (err) {
    console.error("Stress test failed:", explainDbError(err));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
