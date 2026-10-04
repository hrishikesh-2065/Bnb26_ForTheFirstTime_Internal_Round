# FairDrop

## FairDrop — Fair Access for High-Demand Drops

FairDrop is a full-stack **fair queue and limited-seat allocation system** built for the problem statement:

> Sell or allocate a limited number of seats to a very large crowd without allowing bots, request flooding, or repeated attempts to gain an unfair advantage.

The project demonstrates the idea using a real **Node.js + Express + MySQL** application. Users register, log in, join a server-controlled queue, receive a temporary reservation when their turn arrives, and must confirm before the reservation expires.

---

## 1. What problem does FairDrop solve?

High-demand ticket sales, event registrations and limited-seat drops can become unfair when automated clients send requests faster than normal users. FairDrop changes the allocation model from **"who can send the fastest request?"** to **"who reaches the front of the server-controlled queue first?"**.

The important rule is simple:

**The browser displays the state; the backend and MySQL decide the state.**

---

## 2. How our app satisfies the problem statement

### 1) High-Concurrency Support

**Problem requirement:** Handle many users competing for limited availability.

**FairDrop implementation:** Queue operations run through MySQL transactions with a row lock on the drop, preventing concurrent requests from allocating the same seat.

**Proof statement:**
> FairDrop serializes competing seat allocations at the database level, so simultaneous users cannot receive the same seat.

---

### 2) Abuse Handling

**Problem requirement:** Detect and respond to automated clients, request flooding and repeated attempts.

**FairDrop implementation:** Login uses server-verified Google reCAPTCHA, while login, registration and queue-join endpoints have rate limits. Queue identity comes from an authenticated session rather than an IP address.

**Proof statement:**
> FairDrop adds reCAPTCHA verification and request rate limiting to make automated abuse and request flooding harder.

**Important limitation:** These controls reduce abuse; they do not claim to stop every sophisticated bot.

---

### 3) Allocation Integrity

**Problem requirement:** Prevent duplicate allocations, overselling and inconsistent inventory.

**FairDrop implementation:** Seat allocation happens inside MySQL transactions. The drop's `available_capacity` is updated together with reservations, and a user cannot hold multiple open allocations for the same drop.

**Proof statement:**
> FairDrop keeps seat inventory and reservations transactionally consistent, preventing duplicate active allocations and overselling.

---

### 4) Reliable Sessions

**Problem requirement:** Maintain user state across refreshes, reconnects and temporary failures.

**FairDrop implementation:** Authenticated users receive a random session token in an HttpOnly cookie; only its SHA-256 hash is stored in MySQL. Dashboard state is re-read from the backend after refresh.

**Proof statement:**
> FairDrop restores authenticated user and queue state from the server-side session and database instead of trusting browser-only state.

---

### 5) Adversarial Testing

**Problem requirement:** Evaluate the system against automated clients and varying traffic conditions.

**FairDrop implementation:** The project includes demo queue bots plus a concurrent stress-test script that sends multiple clients through the real transactional queue logic.

Run:

```bash
npm run demo:stress -- 25
```

The number can be changed for a demonstration, for example:

```bash
npm run demo:stress -- 50
```

**Proof statement:**
> FairDrop can simulate concurrent automated clients against the real queue service to demonstrate how allocation behaves under adversarial load.

---

### 6) Fairness Measurement

**Problem requirement:** Provide measurable evidence of allocation outcomes, performance and adversarial behaviour.

**FairDrop implementation:** The project includes a fairness report that reads the actual MySQL state and reports waiting, reserved, confirmed and expired allocations, confirmation rate, duplicate confirmed allocations and queue-order allocation violations.

Run:

```bash
npm run demo:report
```

**Proof statement:**
> FairDrop produces a measurable report from real database records, showing allocation outcomes and whether duplicate or queue-order violations occurred.

---

## 3. End-to-end working flow

```text
User
  ↓
Register / Login
  ↓
reCAPTCHA + rate limiting
  ↓
Authenticated session
  ↓
Join Fair Queue
  ↓
MySQL transaction + row lock
  ↓
WAITING → RESERVED
  ↓
20-second server-controlled reservation
  ↓
 ┌───────────────┐
 │ Confirm       │ → CONFIRMED → seat secured
 └───────────────┘
          OR
 ┌───────────────┐
 │ Time expires  │ → EXPIRED → seat released
 └───────────────┘
  ↓
Next waiting user is promoted
```

---

## 4. Main features

- User registration and login
- bcrypt password hashing
- Google reCAPTCHA v2 verification
- Server-side sessions using HttpOnly cookies
- MySQL-backed fair queue
- Live queue position
- 20-second temporary seat reservation
- Automatic reservation expiry
- Automatic promotion of the next waiting users
- Transactional seat allocation
- Rate limiting on sensitive endpoints
- Demo queue bots
- Concurrent stress testing
- Fairness / allocation report
- `/health` endpoint for database verification

---

## 5. Technology stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | HTML, CSS, Vanilla JavaScript | User interface and dashboard |
| Backend | Node.js + Express | API, authentication and queue rules |
| Database | MySQL 8 | Persistent users, sessions and allocation state |
| Security | bcrypt + HttpOnly cookies + reCAPTCHA + rate limiting | Authentication and abuse resistance |
| Testing | Node.js demo scripts | Concurrent/adversarial demonstration |

---

## 6. Project structure

```text
FairDrop/
├── public/
│   ├── index.html
│   ├── register.html
│   ├── dashboard.html
│   ├── css/style.css
│   └── js/
├── routes/
│   ├── auth.js
│   └── queue.js
├── middleware/
│   ├── auth.js
│   └── rateLimit.js
├── services/
│   ├── captcha.js
│   └── queueService.js
├── scripts/
│   ├── demo-tools.js
│   ├── stress-test.js
│   └── fairness-report.js
├── database/
│   └── schema.sql
├── db.js
├── server.js
├── .env
├── .env.example
├── package.json
└── README.md
```

---

## 7. Setup on Windows with MySQL Server 8

### Install dependencies

```powershell
npm install
```

### Create the database

If MySQL is installed at the standard MySQL 8 location:

```powershell
& "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root -p
```

Inside MySQL:

```sql
source C:/path/to/FairDrop/database/schema.sql;
SHOW DATABASES;
USE fairdrop;
SHOW TABLES;
```

The expected tables are:

```text
users
sessions
drops
queue_entries
reservations
```

### Configure `.env`

```env
PORT=3000
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=YOUR_MYSQL_PASSWORD
DB_NAME=fairdrop
RECAPTCHA_SITE_KEY=YOUR_SITE_KEY
RECAPTCHA_SECRET_KEY=YOUR_SECRET_KEY
NODE_ENV=development
```

Never commit a real `.env` containing private credentials.

### Start FairDrop

```powershell
npm start
```

Expected output:

```text
FairDrop running at http://localhost:3000
MySQL: CONNECTED (database 'fairdrop')
```

Open:

```text
http://localhost:3000
```

Health check:

```text
http://localhost:3000/health
```

---

## 8. Demonstrating the project for the problem statement

### Demo A — Normal fair allocation

1. Register two or more users.
2. Log in as each user.
3. Join the queue.
4. Show that the server assigns queue positions.
5. When a user reaches the front, a 20-second reservation appears.
6. Confirm one reservation.
7. Let another reservation expire.
8. Show that the released seat moves to the next waiting user.

### Demo B — Automated clients

Run:

```bash
npm run demo:stress -- 25
```

Then show the terminal output and the queue tables in MySQL/phpMyAdmin.

### Demo C — Measurable evidence

Run:

```bash
npm run demo:report
```

Use the report to discuss:

- total queue entries
- waiting users
- active reservations
- confirmed allocations
- expired reservations
- confirmation rate
- duplicate confirmed allocations
- queue-order allocation violations

### Reset demo data

```bash
npm run demo:reset
```

---

## 9. What the browser does NOT control

This is an important part of the project design.

The browser countdown is only a visual display. The actual expiry time is stored by MySQL and checked by the backend.

Similarly:

- The browser cannot decide who gets a seat.
- The browser cannot change queue position.
- The browser cannot confirm an expired reservation.
- The browser cannot directly access MySQL.

This is what makes the demonstration meaningful against fast or modified clients.

---

## 10. Security notes

- Passwords are stored as bcrypt hashes, not plain text.
- Session tokens are stored as hashes in MySQL.
- Session cookies are HttpOnly.
- The reCAPTCHA secret is backend-only.
- Rate limiting protects login, registration and queue joining.
- Database transactions protect allocation integrity.
- MySQL time is the authority for reservation expiry.

For a real production deployment, HTTPS, stronger operational monitoring, distributed rate limiting, secret management and a more advanced bot-detection strategy would be recommended.

---

## 11. Problem-statement conclusion

```text
FairDrop does not simply create a ticket-selling page.

It implements a controlled allocation system in which:

1. users enter a fair server-side queue,
2. concurrent requests are serialized safely,
3. automated abuse is made harder,
4. inventory remains consistent,
5. sessions remain reliable,
6. temporary reservations expire automatically,
7. adversarial traffic can be demonstrated, and
8. allocation outcomes can be measured from real database data.
```

### One-line project explanation

> **FairDrop converts a speed-based high-demand sale into a server-controlled, queue-based and measurable fair-allocation system.**


## Live Bot Defense Dashboard

The dashboard now contains a **Bot Defense** monitor. It shows:

- **Bots detected** — automated clients reported by the terminal stress test or blocked by the real rate limiter.
- **Bots stopped** — clients FairDrop blocked from continuing.
- **Current threat** — active threat count / All clear.
- **Last security event** — the latest reason and time.

The counters are in memory and reset when `server.js` restarts. This keeps the demo simple and avoids adding another database table.

### Demonstrate it

Keep `npm start` running, log in to the FairDrop dashboard, then open another terminal in the project folder and run:

```powershell
npm run demo:stress -- 25
```

The terminal will run 25 concurrent demo clients and then report them to the local dashboard. The **Bots detected** and **Bots stopped** counters will update automatically.

You can also use:

```powershell
npm run demo:stress -- 50
npm run demo:report
```

The demo bot endpoint is restricted to localhost and protected by `BOT_DEMO_KEY`; it is not intended as a public production API.
