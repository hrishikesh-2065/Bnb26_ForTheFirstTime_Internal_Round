/* FairDrop — measurable fairness / allocation report.
   Usage: npm run demo:report
*/
require("dotenv").config({ quiet: true });
const { pool, explainDbError } = require("../db");

async function main() {
  try {
    const [[summary]] = await pool.query(`
      SELECT
        COUNT(*) AS total_entries,
        SUM(status = 'WAITING') AS waiting,
        SUM(status = 'RESERVED') AS reserved,
        SUM(status = 'CONFIRMED') AS confirmed,
        SUM(status = 'EXPIRED') AS expired
      FROM queue_entries
    `);

    const [[drop]] = await pool.query(`
      SELECT name, total_capacity, available_capacity
      FROM drops ORDER BY id LIMIT 1
    `);

    const [[dupes]] = await pool.query(`
      SELECT COUNT(*) AS duplicate_confirmed_users
      FROM (
        SELECT user_id FROM queue_entries
        WHERE status = 'CONFIRMED'
        GROUP BY user_id, drop_id
        HAVING COUNT(*) > 1
      ) x
    `);

    const [allocations] = await pool.query(`
      SELECT r.id, r.user_id, r.reserved_at, q.joined_at, q.id AS queue_entry_id
      FROM reservations r
      JOIN queue_entries q ON q.id = r.queue_entry_id
      WHERE r.status IN ('ACTIVE','CONFIRMED')
      ORDER BY r.reserved_at, r.id
    `);

    let orderViolations = 0;
    for (let i = 0; i < allocations.length; i++) {
      for (let j = i + 1; j < allocations.length; j++) {
        if (new Date(allocations[i].joined_at) > new Date(allocations[j].joined_at)) {
          orderViolations++;
        }
      }
    }

    const confirmed = Number(summary.confirmed || 0);
    const expired = Number(summary.expired || 0);
    const attempted = confirmed + expired;
    const confirmationRate = attempted ? ((confirmed / attempted) * 100).toFixed(1) : "0.0";

    console.log("\n=== FairDrop Fairness Report ===");
    console.log(`Drop: ${drop ? drop.name : "none"}`);
    console.log(`Capacity: ${drop ? drop.total_capacity : 0}`);
    console.log(`Available seats: ${drop ? drop.available_capacity : 0}`);
    console.log(`Queue entries: ${summary.total_entries || 0}`);
    console.log(`Waiting: ${summary.waiting || 0}`);
    console.log(`Reserved: ${summary.reserved || 0}`);
    console.log(`Confirmed: ${confirmed}`);
    console.log(`Expired: ${expired}`);
    console.log(`Confirmation rate after reservation: ${confirmationRate}%`);
    console.log(`Duplicate confirmed allocations: ${dupes.duplicate_confirmed_users}`);
    console.log(`Queue-order allocation violations: ${orderViolations}`);
    console.log("================================\n");
  } catch (err) {
    console.error("Report failed:", explainDbError(err));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
