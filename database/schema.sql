-- ============================================================================
-- FairDrop — database/schema.sql
-- Import this file in phpMyAdmin (Import tab) or run:  mysql -u root -p < schema.sql
--
-- It creates the "fairdrop" database, 5 tables and ONE sample drop.
-- Safe to re-run: tables are created only if they do not exist yet.
-- (To wipe everything and start over, uncomment the DROP lines below.)
-- ============================================================================

CREATE DATABASE IF NOT EXISTS fairdrop
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE fairdrop;

-- DROP TABLE IF EXISTS reservations;
-- DROP TABLE IF EXISTS queue_entries;
-- DROP TABLE IF EXISTS sessions;
-- DROP TABLE IF EXISTS drops;
-- DROP TABLE IF EXISTS users;

-- ---------------------------------------------------------------------------
-- 1) users — one row per registered account
--    password_hash holds a bcrypt hash. The real password is NEVER stored.
--    utf8mb4_unicode_ci makes the UNIQUE username case-insensitive
--    ("Hrishikesh" and "hrishikesh" count as the same name).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username      VARCHAR(20)  NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 2) sessions — one row per active login
--    The browser holds a random value in an HttpOnly cookie. This table stores
--    only the SHA-256 HASH of that value (in the "token" column), so a leaked
--    database cannot be used to hijack sessions.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    INT UNSIGNED NOT NULL,
  token      CHAR(64)     NOT NULL,
  expires_at DATETIME     NOT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sessions_token (token),
  KEY idx_sessions_user (user_id),
  KEY idx_sessions_expires (expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 3) drops — the limited-seat events people queue for
--    available_capacity = seats that are neither held (20 s) nor confirmed.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS drops (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name               VARCHAR(100) NOT NULL,
  total_capacity     INT UNSIGNED NOT NULL,
  available_capacity INT UNSIGNED NOT NULL,
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 4) queue_entries — one row each time a user joins the queue
--    position : live place in line while status = WAITING (1 = next up)
--    status   : WAITING   in line
--               RESERVED  turn reached, seat held for 20 seconds
--               CONFIRMED user confirmed in time (seat is theirs)
--               EXPIRED   user did not confirm in time (seat released)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS queue_entries (
  id        INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id   INT UNSIGNED NOT NULL,
  drop_id   INT UNSIGNED NOT NULL,
  position  INT UNSIGNED NOT NULL,
  status    ENUM('WAITING','RESERVED','CONFIRMED','EXPIRED') NOT NULL DEFAULT 'WAITING',
  joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_queue_drop_status (drop_id, status, position),
  KEY idx_queue_user_drop (user_id, drop_id),
  CONSTRAINT fk_queue_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_queue_drop FOREIGN KEY (drop_id) REFERENCES drops (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 5) reservations — the temporary 20-second seat holds
--    expires_at is set by MySQL (NOW + 20 s). The backend/DB clock is the only
--    authority. The browser countdown is just a picture of this value.
--    status : ACTIVE    hold is running
--             CONFIRMED user confirmed before expires_at
--             EXPIRED   time ran out, seat went back to the drop
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reservations (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id        INT UNSIGNED NOT NULL,
  drop_id        INT UNSIGNED NOT NULL,
  queue_entry_id INT UNSIGNED NOT NULL,
  reserved_at    DATETIME(3)  NOT NULL,
  expires_at     DATETIME(3)  NOT NULL,
  status         ENUM('ACTIVE','CONFIRMED','EXPIRED') NOT NULL DEFAULT 'ACTIVE',
  PRIMARY KEY (id),
  KEY idx_res_drop_status (drop_id, status, expires_at),
  KEY idx_res_entry (queue_entry_id),
  CONSTRAINT fk_res_user  FOREIGN KEY (user_id)        REFERENCES users (id)          ON DELETE CASCADE,
  CONSTRAINT fk_res_drop  FOREIGN KEY (drop_id)        REFERENCES drops (id)          ON DELETE CASCADE,
  CONSTRAINT fk_res_entry FOREIGN KEY (queue_entry_id) REFERENCES queue_entries (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Sample drop (inserted only if the drops table is empty).
-- 10 seats. Change total/available here if you want a bigger or smaller drop.
-- ---------------------------------------------------------------------------
INSERT INTO drops (name, total_capacity, available_capacity)
SELECT 'FairDrop Launch', 10, 10
WHERE NOT EXISTS (SELECT 1 FROM drops);
