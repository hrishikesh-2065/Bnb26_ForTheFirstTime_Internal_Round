/* ============================================================================
   FairDrop — db.js   (MySQL connection module)

   The ONLY file that knows how to connect to MySQL.
   Everything else does:   const { pool, withTransaction } = require("./db");

   - Uses mysql2/promise with a connection POOL (reuses connections).
   - Credentials come from the .env file (never hardcoded here).
   ============================================================================ */
require("dotenv").config({ quiet: true });
const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "fairdrop",
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true // return DATETIME as plain text, no timezone surprises
});

// Quick connectivity test (used at startup and by GET /health).
async function testConnection() {
  await pool.query("SELECT 1");
  return true;
}

// Run several queries as ONE all-or-nothing unit.
// If anything throws, every change inside is rolled back.
async function withTransaction(work) {
  const conn = await pool.getConnection();
  try {
    // READ COMMITTED: after we lock the drop row, every read sees the latest
    // committed data. (The default REPEATABLE READ can show stale rows to
    // requests that waited for the lock, giving duplicate queue positions.)
    await conn.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
    await conn.beginTransaction();
    const result = await work(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback().catch(function () {});
    throw err;
  } finally {
    conn.release();
  }
}

// Turn a raw MySQL error into a beginner-friendly explanation.
function explainDbError(err) {
  switch (err && err.code) {
    case "ECONNREFUSED":
      return "Cannot reach MySQL. Is MySQL started in XAMPP/WAMP? Check DB_HOST and DB_PORT in .env.";
    case "ER_ACCESS_DENIED_ERROR":
    case "ER_ACCESS_DENIED_NO_PASSWORD_ERROR":
      return "MySQL rejected the username/password. Check DB_USER and DB_PASSWORD in .env.";
    case "ER_BAD_DB_ERROR":
      return "Database '" + (process.env.DB_NAME || "fairdrop") + "' does not exist. Import database/schema.sql in phpMyAdmin.";
    case "ER_NO_SUCH_TABLE":
      return "A table is missing. Import database/schema.sql in phpMyAdmin.";
    default:
      return (err && err.message) || "Unknown database error.";
  }
}

module.exports = { pool, testConnection, withTransaction, explainDbError };
