/* ============================================================================
   FairDrop — services/queueService.js   (the queue brain)

   ALL queue rules live here, and ALL of them run inside MySQL transactions.
   The browser never decides anything.

   THE RULES
     - A drop has a number of seats (drops.available_capacity).
     - A user joins -> a queue_entries row with status WAITING and a position.
     - When a seat is free, the first WAITING user gets a reservation:
         reservations row, status ACTIVE, expires_at = MySQL NOW + 20 seconds
         queue_entries.status becomes RESERVED, one seat is taken off the drop.
     - Confirm in time  -> reservation + entry become CONFIRMED (seat is theirs).
     - Not in time      -> reservation + entry become EXPIRED, seat goes back
                           to the drop, next WAITING user is promoted.

   advanceQueue() does the expire + promote work. It is called:
     - every second by a timer in server.js (so the DB changes by itself), and
     - at the start of join / status / confirm (so answers are always fresh).
   It first locks the drop row (FOR UPDATE), so two requests can never
   hand the same seat to two people.
   ============================================================================ */
const { withTransaction } = require("../db");

const RESERVATION_SECONDS = 20; // <-- change the hold time here

// The sample app has ONE drop: the first row of the drops table.
async function getCurrentDrop(conn) {
  const [rows] = await conn.query(
    "SELECT id, name, total_capacity, available_capacity FROM drops ORDER BY id LIMIT 1"
  );
  return rows[0] || null;
}

// After people leave the WAITING list, close the gaps: 1, 2, 3, ...
async function renumberWaiting(conn, dropId) {
  const [waiting] = await conn.query(
    "SELECT id FROM queue_entries WHERE drop_id = ? AND status = 'WAITING' ORDER BY position, id",
    [dropId]
  );
  for (let i = 0; i < waiting.length; i++) {
    await conn.query("UPDATE queue_entries SET position = ? WHERE id = ?", [i + 1, waiting[i].id]);
  }
}

// Expire old reservations, then give free seats to the people waiting longest.
// MUST be called inside a transaction (it locks the drop row).
async function advanceQueue(conn, dropId) {
  const [[drop]] = await conn.query(
    "SELECT available_capacity FROM drops WHERE id = ? FOR UPDATE",
    [dropId]
  );
  let available = drop.available_capacity;

  // 1) EXPIRE: active reservations whose time (MySQL clock) has run out
  const [expired] = await conn.query(
    "SELECT id, queue_entry_id FROM reservations WHERE drop_id = ? AND status = 'ACTIVE' AND expires_at <= NOW(3)",
    [dropId]
  );
  for (const r of expired) {
    await conn.query("UPDATE reservations SET status = 'EXPIRED' WHERE id = ?", [r.id]);
    await conn.query("UPDATE queue_entries SET status = 'EXPIRED' WHERE id = ?", [r.queue_entry_id]);
    available += 1; // seat released
  }

  // 2) PROMOTE: first WAITING users get a 20-second reservation
  let promoted = 0;
  if (available > 0) {
    const [waiting] = await conn.query(
      "SELECT id, user_id FROM queue_entries WHERE drop_id = ? AND status = 'WAITING' ORDER BY position, id LIMIT ?",
      [dropId, available]
    );
    for (const w of waiting) {
      await conn.query(
        `INSERT INTO reservations (user_id, drop_id, queue_entry_id, reserved_at, expires_at, status)
         VALUES (?, ?, ?, NOW(3), DATE_ADD(NOW(3), INTERVAL ? SECOND), 'ACTIVE')`,
        [w.user_id, dropId, w.id, RESERVATION_SECONDS]
      );
      await conn.query("UPDATE queue_entries SET status = 'RESERVED' WHERE id = ?", [w.id]);
      available -= 1;
      promoted += 1;
    }
    if (promoted > 0) await renumberWaiting(conn, dropId);
  }

  if (available !== drop.available_capacity) {
    await conn.query("UPDATE drops SET available_capacity = ? WHERE id = ?", [available, dropId]);
  }
  return { expired: expired.length, promoted: promoted, available: available };
}

// Called every second by server.js. Keeps the database moving on its own.
async function tickAllDrops() {
  await withTransaction(async function (conn) {
    const [drops] = await conn.query("SELECT id FROM drops");
    for (const d of drops) await advanceQueue(conn, d.id);
  });
}

// Add a user to the queue. Returns { error } or { joined: true }.
async function joinQueue(userId) {
  return withTransaction(async function (conn) {
    const drop = await getCurrentDrop(conn);
    if (!drop) return { error: "No drop exists. Import database/schema.sql.", status: 500 };

    const state = await advanceQueue(conn, drop.id); // also locks the drop row

    const [open] = await conn.query(
      "SELECT status FROM queue_entries WHERE user_id = ? AND drop_id = ? AND status IN ('WAITING','RESERVED','CONFIRMED') LIMIT 1",
      [userId, drop.id]
    );
    if (open.length > 0) {
      const msg = open[0].status === "CONFIRMED"
        ? "You already confirmed a seat for this drop."
        : "You are already in the queue.";
      return { error: msg, status: 409 };
    }

    // Sold out = no free seat and nobody is holding one that could come back
    const [[active]] = await conn.query(
      "SELECT COUNT(*) AS n FROM reservations WHERE drop_id = ? AND status = 'ACTIVE'",
      [drop.id]
    );
    if (state.available === 0 && active.n === 0) {
      return { error: "Sold out. All seats are confirmed.", status: 409 };
    }

    const [[waiting]] = await conn.query(
      "SELECT COUNT(*) AS n FROM queue_entries WHERE drop_id = ? AND status = 'WAITING'",
      [drop.id]
    );
    await conn.query(
      "INSERT INTO queue_entries (user_id, drop_id, position, status) VALUES (?, ?, ?, 'WAITING')",
      [userId, drop.id, waiting.n + 1]
    );

    await advanceQueue(conn, drop.id); // may promote this user straight away
    return { joined: true };
  });
}

// Confirm the user's active reservation. Returns { error } or { confirmed: true }.
async function confirmReservation(userId) {
  return withTransaction(async function (conn) {
    const drop = await getCurrentDrop(conn);
    if (!drop) return { error: "No drop exists.", status: 500 };

    await advanceQueue(conn, drop.id); // expires anything late BEFORE we check

    const [rows] = await conn.query(
      "SELECT id, queue_entry_id FROM reservations WHERE user_id = ? AND drop_id = ? AND status = 'ACTIVE' FOR UPDATE",
      [userId, drop.id]
    );
    if (rows.length === 0) {
      return { error: "No active reservation. It may have expired. Join the queue again.", status: 409 };
    }

    await conn.query("UPDATE reservations SET status = 'CONFIRMED' WHERE id = ?", [rows[0].id]);
    await conn.query("UPDATE queue_entries SET status = 'CONFIRMED' WHERE id = ?", [rows[0].queue_entry_id]);
    return { confirmed: true };
  });
}

// Everything the dashboard needs, read from MySQL.
async function getStatus(userId) {
  return withTransaction(async function (conn) {
    const drop = await getCurrentDrop(conn);
    if (!drop) return null;

    const state = await advanceQueue(conn, drop.id);

    const [entries] = await conn.query(
      "SELECT id, position, status FROM queue_entries WHERE user_id = ? AND drop_id = ? ORDER BY id DESC LIMIT 1",
      [userId, drop.id]
    );

    const queue = { state: "none", position: 0, secondsLeft: 0, msLeft: 0 };
    if (entries.length > 0) {
      const e = entries[0];
      queue.state = e.status.toLowerCase(); // waiting | reserved | confirmed | expired
      if (e.status === "WAITING") queue.position = e.position;
      if (e.status === "RESERVED") {
        const [[r]] = await conn.query(
          `SELECT GREATEST(0, TIMESTAMPDIFF(MICROSECOND, NOW(3), expires_at) DIV 1000) AS ms
             FROM reservations WHERE queue_entry_id = ? AND status = 'ACTIVE'`,
          [e.id]
        );
        queue.msLeft = r ? Number(r.ms) : 0;
        queue.secondsLeft = Math.ceil(queue.msLeft / 1000);
      }
    }

    return {
      drop: {
        id: drop.id,
        code: "D" + String(drop.id).padStart(3, "0"),
        name: drop.name,
        live: true
      },
      seatsRemaining: state.available,
      queue: queue
    };
  });
}

module.exports = {
  RESERVATION_SECONDS, advanceQueue, tickAllDrops,
  joinQueue, confirmReservation, getStatus, getCurrentDrop
};
