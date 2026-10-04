/* ==========================================================================
   FairDrop — js/dashboard.js   (used by dashboard.html)

   THE KEY IDEA
     This page never decides anything. It asks the server "what is my status?"
     (GET /queue/status) and just DRAWS the answer. Position, seats and the
     20-second reservation all live in MySQL. The countdown number on screen is
     only a picture of the server's time; the server expires the reservation.

   API (all need the login cookie; 401 = not logged in -> back to login page)
     GET  /auth/me         -> { success, user: { id, username } }
     POST /auth/logout     -> { success }
     POST /queue/join      -> { success, message }
     POST /queue/confirm   -> { success, message }
     GET  /queue/status    -> {
         success: true,
         drop: { id, code: "D001", name: "FairDrop Launch", live: true },
         seatsRemaining: 7,
         queue: {
           state: "none" | "waiting" | "reserved" | "confirmed" | "expired",
           position: 3,        // when waiting (from queue_entries.position)
           msLeft: 14250,      // when reserved (from reservations.expires_at)
           secondsLeft: 15
         }
       }

   CODE MAP
     1 CONFIG / ELEMENTS    2 API FUNCTIONS    3 UI RENDERING    4 EVENTS + STARTUP
   ========================================================================== */

// ---------- 1. CONFIG / ELEMENTS ----------
const LOGIN_PAGE = "index.html";
const POLL_MS = 1500;          // how often to ask the server for status

const el = {
  username: document.getElementById("usernameDisplay"),
  logoutBtn: document.getElementById("logoutBtn"),
  dropCode: document.getElementById("dropCode"),
  dropName: document.getElementById("dropName"),
  dropStatus: document.getElementById("dropStatus"),
  seats: document.getElementById("seatsRemaining"),
  queueStatus: document.getElementById("queueStatus"),
  joinPanel: document.getElementById("joinPanel"),
  joinBtn: document.getElementById("joinBtn"),
  waitingPanel: document.getElementById("waitingPanel"),
  queuePosition: document.getElementById("queuePosition"),
  waitingText: document.getElementById("waitingText"),
  reservationPanel: document.getElementById("reservationPanel"),
  timer: document.getElementById("timer"),
  confirmBtn: document.getElementById("confirmBtn"),
  confirmedPanel: document.getElementById("confirmedPanel"),
  expiredPanel: document.getElementById("expiredPanel"),
  message: document.getElementById("message"),
  botsDetected: document.getElementById("botsDetected"),
  botsStopped: document.getElementById("botsStopped"),
  botActivity: document.getElementById("botActivity"),
  botLastEvent: document.getElementById("botLastEvent")
};

// Display-only state (never trusted for anything important)
let reservationEndsAt = 0;   // browser time when the visual countdown hits 0
let dismissedState = "";     // result panel closed with "Back to drop"
let lastState = "none";

function showMessage(text, type) {
  el.message.textContent = text;
  el.message.className = "message " + (type || "");
}

// ---------- 2. API FUNCTIONS ----------
// One helper for every request. Redirects to login when the session is gone.
async function api(method, path) {
  const options = {
    method: method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" }
  };
  if (method !== "GET") options.body = "{}";

  const response = await fetch(path, options);
  if (response.status === 401) {
    window.location.href = LOGIN_PAGE;
    return { success: false, message: "Please log in again." };
  }
  return response.json().catch(function () {
    return { success: false, message: "Unexpected server response." };
  });
}

const apiMe = function () { return api("GET", "/auth/me"); };
const apiLogout = function () { return api("POST", "/auth/logout"); };
const apiJoinQueue = function () { return api("POST", "/queue/join"); };
const apiConfirm = function () { return api("POST", "/queue/confirm"); };
const apiStatus = function () { return api("GET", "/queue/status"); };

async function refreshBotStats() {
  try {
    const stats = await api("GET", "/security/bot-stats");
    if (!stats.success) return;
    el.botsDetected.textContent = stats.detected;
    el.botsStopped.textContent = stats.stopped;
    el.botActivity.textContent = stats.active > 0 ? stats.active + " active" : "All clear";
    if (stats.lastEventAt) {
      const when = new Date(stats.lastEventAt);
      el.botLastEvent.textContent = stats.lastReason + " • " + when.toLocaleTimeString();
    } else {
      el.botLastEvent.textContent = "Waiting for security events…";
    }
  } catch (err) {
    // Security stats are display-only; a temporary failure must not break the queue UI.
  }
}

// ---------- 3. UI RENDERING ----------
function showPanels(visible) {
  const all = {
    join: el.joinPanel,
    waiting: el.waitingPanel,
    reservation: el.reservationPanel,
    confirmed: el.confirmedPanel,
    expired: el.expiredPanel
  };
  Object.keys(all).forEach(function (name) {
    all[name].classList.toggle("hidden", visible.indexOf(name) === -1);
  });
}

function renderStatus(status) {
  el.dropCode.textContent = "DROP " + status.drop.code;
  el.dropName.textContent = status.drop.name;
  el.dropStatus.textContent = status.drop.live ? "● DROP LIVE" : "● DROP CLOSED";
  el.seats.textContent = status.seatsRemaining;

  const q = status.queue;

  if (q.state !== lastState) {
    if (q.state !== dismissedState) dismissedState = "";
    lastState = q.state;
  }

  switch (q.state) {
    case "waiting": {
      el.queueStatus.textContent = "In queue";
      el.queuePosition.textContent = "#" + q.position;
      const ahead = q.position - 1;
      el.waitingText.textContent = ahead === 0
        ? "You are next. Keep this page open."
        : ahead + (ahead === 1 ? " person is" : " people are") + " ahead of you. Keep this page open.";
      showPanels(["waiting"]);
      break;
    }
    case "reserved":
      el.queueStatus.textContent = "Seat held";
      reservationEndsAt = Date.now() + q.msLeft;   // server time -> local picture
      showPanels(["reservation"]);
      updateTimer();
      break;

    case "confirmed":
      el.queueStatus.textContent = "Confirmed";
      showPanels(dismissedState === "confirmed" ? ["join"] : ["confirmed"]);
      break;

    case "expired":
      el.queueStatus.textContent = "Expired";
      showPanels(dismissedState === "expired" ? ["join"] : ["expired"]);
      break;

    default: // "none"
      el.queueStatus.textContent = "Not in queue";
      showPanels(["join"]);
  }
}

// Redraws the big countdown number (display only).
function updateTimer() {
  if (el.reservationPanel.classList.contains("hidden")) return;

  const left = Math.max(0, Math.ceil((reservationEndsAt - Date.now()) / 1000));
  el.timer.textContent = left;
  el.timer.classList.toggle("low", left <= 5);
  el.confirmBtn.disabled = left === 0;

  if (left === 0) refreshStatus(); // picture hit zero -> ask the server what really happened
}

async function refreshStatus() {
  try {
    const status = await apiStatus();
    if (status.success) {
      renderStatus(status);
    } else if (status.message) {
      showMessage(status.message, "error");
    }
  } catch (err) {
    showMessage("Lost connection to the server.", "error");
  }
}

// ---------- 4. EVENTS + STARTUP ----------
el.joinBtn.addEventListener("click", async function () {
  showMessage("", "");
  el.joinBtn.disabled = true;
  try {
    const result = await apiJoinQueue();
    if (!result.success) showMessage(result.message || "Could not join the queue.", "error");
    await refreshStatus();
  } catch (err) {
    showMessage("Cannot reach the server.", "error");
  } finally {
    el.joinBtn.disabled = false;
  }
});

el.confirmBtn.addEventListener("click", async function () {
  showMessage("", "");
  el.confirmBtn.disabled = true;
  try {
    const result = await apiConfirm();
    if (!result.success) showMessage(result.message || "Could not confirm.", "error");
    await refreshStatus(); // the server's answer decides what we show
  } catch (err) {
    showMessage("Cannot reach the server.", "error");
  }
});

document.querySelectorAll("[data-action='reset']").forEach(function (btn) {
  btn.addEventListener("click", function () {
    dismissedState = lastState;
    showMessage("", "");
    refreshStatus();
  });
});

el.logoutBtn.addEventListener("click", async function () {
  try { await apiLogout(); } catch (err) { /* leave anyway */ }
  window.location.href = LOGIN_PAGE;
});

(async function init() {
  // Ask the server who is logged in. 401 -> api() sends us to the login page.
  const me = await apiMe();
  if (!me.success) return;
  el.username.textContent = me.user.username;

  refreshStatus();
  refreshBotStats();
  setInterval(refreshStatus, POLL_MS);  // keep status fresh
  setInterval(refreshBotStats, POLL_MS); // keep security monitor live
  setInterval(updateTimer, 250);        // smooth visual countdown
})();
