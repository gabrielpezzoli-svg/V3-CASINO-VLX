// ============================================================
//   CASINO VLX — APP.JS
// ============================================================

import {
  auth, db, googleProvider,
  signInWithPopup, signOut, onAuthStateChanged,
  doc, getDoc, setDoc, updateDoc,
  collection, query, orderBy, limit, onSnapshot
} from "./firebase-config.js";

// ── STATE ────────────────────────────────────────────────────
let currentUser   = null;
let userData      = null;
let unsubLB       = null;

// ── TOAST ────────────────────────────────────────────────────
function toast(msg, type = "") {
  const t = document.getElementById("toast");
  t.textContent  = msg;
  t.className    = "toast show " + type;
  clearTimeout(t._timeout);
  t._timeout = setTimeout(() => { t.className = "toast"; }, 3000);
}

// ── AUTH ─────────────────────────────────────────────────────
document.getElementById("google-login-btn").onclick = async () => {
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (e) {
    document.getElementById("login-error").textContent = "Erreur : " + e.message;
  }
};

document.getElementById("logout-btn").onclick = () => signOut(auth);

onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    await loadOrCreateUser(user);
    showApp();
  } else {
    currentUser = null;
    userData    = null;
    showLogin();
  }
});

async function loadOrCreateUser(user) {
  const ref  = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const newUser = {
      uid:      user.uid,
      name:     user.displayName,
      avatar:   user.photoURL,
      balance:  1500,
      gamesPlayed: 0,
      createdAt: Date.now()
    };
    await setDoc(ref, newUser);
    userData = newUser;
  } else {
    userData = snap.data();
  }
}

async function saveUserData() {
  if (!currentUser) return;
  await updateDoc(doc(db, "users", currentUser.uid), {
    balance:     userData.balance,
    gamesPlayed: userData.gamesPlayed
  });
  updateBalanceUI();
}

// ── UI ───────────────────────────────────────────────────────
function showApp() {
  document.getElementById("login-screen").classList.remove("active");
  document.getElementById("app-screen").classList.add("active");
  document.getElementById("user-avatar").src   = currentUser.photoURL || "";
  document.getElementById("user-name").textContent = currentUser.displayName || "";
  updateBalanceUI();
  switchTab("lobby");
  startLeaderboard();
}

function showLogin() {
  document.getElementById("app-screen").classList.remove("active");
  document.getElementById("login-screen").classList.add("active");
  if (unsubLB) { unsubLB(); unsubLB = null; }
}

function updateBalanceUI() {
  document.getElementById("balance-display").textContent =
    (userData?.balance ?? 0).toLocaleString("fr-FR") + " VLX";
}

// ── NAVIGATION ───────────────────────────────────────────────
window.switchTab = function(name) {
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
  document.getElementById("tab-" + name)?.classList.add("active");
  document.querySelector(`.nav-btn[data-tab="${name}"]`)?.classList.add("active");
  if (name === "leaderboard") renderLeaderboard();
};

document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.onclick = () => switchTab(btn.dataset.tab);
});

// ── BET HELPERS ──────────────────────────────────────────────
window.quickBet = function(id, mult) {
  const el = document.getElementById(id);
  el.value = Math.max(10, Math.round(Number(el.value) * mult));
};
window.setMax = function(id) {
  document.getElementById(id).value = userData?.balance ?? 0;
};

function parseBet(id) {
  const val = Number(document.getElementById(id).value);
  if (!Number.isFinite(val) || val < 10) { toast("Mise minimum : 10 VLX", "lose"); return null; }
  if (val > userData.balance) { toast("Solde insuffisant !", "lose"); return null; }
  return Math.floor(val);
}

// ════════════════════════════════════════════════════════════
//   ROULETTE
// ════════════════════════════════════════════════════════════
// Segments in order (every 72°): ×0, ×0.5, ×1, ×2, ×5
const ROULETTE_SEGMENTS = [0, 0.5, 1, 2, 5];
let rouletteSpinning = false;
let currentRotation  = 0;

window.spinRoulette = async function() {
  if (rouletteSpinning) return;
  const bet = parseBet("roulette-bet");
  if (bet === null) return;

  rouletteSpinning = true;
  document.getElementById("roulette-spin-btn").disabled = true;
  document.getElementById("roulette-result").textContent = "";

  // pick random segment
  const segIdx = Math.floor(Math.random() * 5);
  const mult   = ROULETTE_SEGMENTS[segIdx];

  // spin to that segment (pointer at top = 0°)
  // each segment = 72°. Center of segment i = i*72 + 36°.
  // We want center of segIdx segment under pointer (top).
  // Add extra full rotations for drama.
  const extraSpins = (5 + Math.floor(Math.random() * 5)) * 360;
  const segCenter  = segIdx * 72 + 36;
  const target     = extraSpins + (360 - segCenter);
  currentRotation  = (currentRotation + target) % 36000 + target;

  const wheel = document.getElementById("roulette-wheel");
  wheel.style.transition = "transform 3s cubic-bezier(0.25,0.1,0.1,1)";
  wheel.style.transform  = `rotate(${currentRotation}deg)`;

  await delay(3200);

  // apply result
  const gain = Math.round(bet * mult) - bet;
  userData.balance = Math.max(0, userData.balance + gain);
  userData.gamesPlayed++;
  await saveUserData();

  const resultEl = document.getElementById("roulette-result");
  if (mult === 0) {
    resultEl.textContent = "×0 — Perdu !";
    resultEl.style.color = "var(--red2)";
    toast(`Perdu ${bet} VLX !`, "lose");
  } else if (mult < 1) {
    resultEl.textContent = `×0.5 — +${Math.round(bet*0.5)} VLX`;
    resultEl.style.color = "var(--gold)";
    toast(`×0.5 → +${Math.round(bet*0.5)} VLX`, "");
  } else if (mult === 1) {
    resultEl.textContent = "×1 — Mise remboursée";
    resultEl.style.color = "var(--text)";
    toast("Mise remboursée !", "");
  } else {
    resultEl.textContent = `×${mult} — +${Math.round(bet*mult)} VLX 🎉`;
    resultEl.style.color = "var(--green2)";
    toast(`×${mult} GAGNÉ ! +${Math.round(bet*mult)} VLX 🎉`, "win");
  }

  rouletteSpinning = false;
  document.getElementById("roulette-spin-btn").disabled = false;
};

// ════════════════════════════════════════════════════════════
//   MINES
// ════════════════════════════════════════════════════════════
const GRID_SIZE   = 25;
const MINE_COUNT  = 5;
let minesActive   = false;
let minesBet      = 0;
let minesGrid     = []; // true = mine
let safeRevealed  = 0;

// Multiplier table: safe cells revealed → multiplier
function getMinesMultiplier(safe) {
  // grows based on probability; handcrafted curve
  const table = [1, 1.18, 1.40, 1.68, 2.05, 2.55, 3.25, 4.25, 5.70, 8.0,
                 12.0, 19.0, 33.0, 65.0, 156.0, 500.0, 2000.0, 10000.0, 50000.0, 250000.0];
  return table[Math.min(safe, table.length-1)];
}

window.startMines = function() {
  const bet = parseBet("mines-bet");
  if (bet === null) return;

  minesBet     = bet;
  safeRevealed = 0;
  minesActive  = true;
  userData.balance -= bet;
  updateBalanceUI();

  // Place mines randomly
  const positions = Array.from({length:GRID_SIZE},(_,i)=>i);
  shuffle(positions);
  minesGrid = Array(GRID_SIZE).fill(false);
  for (let i=0;i<MINE_COUNT;i++) minesGrid[positions[i]] = true;

  renderMinesGrid();
  updateMinesInfo();

  document.getElementById("mines-start-btn").disabled  = true;
  document.getElementById("mines-cashout-btn").disabled = true;
  document.getElementById("mines-bet").disabled         = true;
};

window.cashoutMines = async function() {
  if (!minesActive || safeRevealed < 2) return;
  const mult  = getMinesMultiplier(safeRevealed);
  const winAmount = Math.round(minesBet * mult);
  userData.balance += winAmount;
  userData.gamesPlayed++;
  minesActive = false;
  await saveUserData();
  toast(`Cashout ! +${winAmount} VLX (×${mult.toFixed(2)}) 💰`, "win");
  revealAllMines();
  resetMinesButtons();
};

function revealCell(idx) {
  if (!minesActive) return;
  const cells = document.querySelectorAll(".mine-cell");
  const cell  = cells[idx];
  if (cell.classList.contains("revealed")) return;

  cell.classList.add("revealed");

  if (minesGrid[idx]) {
    // MINE!
    cell.classList.add("mine");
    cell.textContent = "💣";
    minesActive = false;
    userData.gamesPlayed++;
    saveUserData();
    toast(`MINE ! Perdu ${minesBet} VLX`, "lose");
    revealAllMines();
    resetMinesButtons();
  } else {
    cell.classList.add("safe");
    cell.textContent = "✓";
    safeRevealed++;
    updateMinesInfo();
    if (safeRevealed >= 2) {
      document.getElementById("mines-cashout-btn").disabled = false;
    }
    // Win condition: all safe cells revealed
    if (safeRevealed === GRID_SIZE - MINE_COUNT) {
      const mult = getMinesMultiplier(safeRevealed);
      const win  = Math.round(minesBet * mult);
      userData.balance += win;
      userData.gamesPlayed++;
      minesActive = false;
      saveUserData();
      toast(`Parfait ! +${win} VLX 🏆`, "win");
      resetMinesButtons();
    }
  }
}

function updateMinesInfo() {
  const mult = getMinesMultiplier(safeRevealed);
  document.getElementById("mines-safe-count").textContent  = safeRevealed;
  document.getElementById("mines-multiplier").textContent  = "×" + mult.toFixed(2);
  document.getElementById("mines-bet-display").textContent = minesBet + " VLX";
  document.getElementById("mines-potential").textContent   = Math.round(minesBet * mult) + " VLX";
}

function renderMinesGrid() {
  const grid = document.getElementById("mines-grid");
  grid.innerHTML = "";
  for (let i=0;i<GRID_SIZE;i++) {
    const cell = document.createElement("div");
    cell.className = "mine-cell";
    cell.textContent = "?";
    cell.onclick = () => revealCell(i);
    grid.appendChild(cell);
  }
}

function revealAllMines() {
  const cells = document.querySelectorAll(".mine-cell");
  cells.forEach((cell, i) => {
    if (minesGrid[i] && !cell.classList.contains("revealed")) {
      cell.classList.add("revealed","mine");
      cell.textContent = "💣";
    }
  });
}

function resetMinesButtons() {
  document.getElementById("mines-start-btn").disabled   = false;
  document.getElementById("mines-cashout-btn").disabled = true;
  document.getElementById("mines-bet").disabled         = false;
}

// ════════════════════════════════════════════════════════════
//   COINFLIP
// ════════════════════════════════════════════════════════════
let chosenSide    = null;
let coinFlipping  = false;

window.chooseSide = function(side) {
  if (coinFlipping) return;
  chosenSide = side;
  document.getElementById("choose-blue").classList.toggle("selected", side==="blue");
  document.getElementById("choose-red").classList.toggle("selected", side==="red");
  document.getElementById("coinflip-btn").disabled = false;
};

window.flipCoin = async function() {
  if (!chosenSide || coinFlipping) return;
  const bet = parseBet("coinflip-bet");
  if (bet === null) return;

  coinFlipping = true;
  document.getElementById("coinflip-btn").disabled = true;
  document.getElementById("coinflip-result").textContent = "";

  const result = Math.random() < 0.5 ? "blue" : "red";
  const coin   = document.getElementById("coin");
  coin.className = "coin flip-" + result;

  await delay(1200);

  const won = result === chosenSide;
  if (won) {
    userData.balance += bet;
    document.getElementById("coinflip-result").innerHTML = `<span style="color:var(--green2)">Gagné +${bet} VLX ! 🎉</span>`;
    toast(`Correct ! +${bet} VLX`, "win");
  } else {
    userData.balance -= bet;
    document.getElementById("coinflip-result").innerHTML = `<span style="color:var(--red2)">Perdu ${bet} VLX</span>`;
    toast(`Perdu ${bet} VLX`, "lose");
  }
  userData.balance   = Math.max(0, userData.balance);
  userData.gamesPlayed++;
  await saveUserData();

  await delay(800);
  coin.className = "coin";
  coinFlipping   = false;
  chosenSide     = null;
  document.getElementById("choose-blue").classList.remove("selected");
  document.getElementById("choose-red").classList.remove("selected");
  document.getElementById("coinflip-btn").disabled = true;
};

// ════════════════════════════════════════════════════════════
//   LEADERBOARD
// ════════════════════════════════════════════════════════════
let leaderboardData = [];

function startLeaderboard() {
  const q = query(collection(db,"users"), orderBy("balance","desc"), limit(20));
  unsubLB = onSnapshot(q, (snap) => {
    leaderboardData = snap.docs.map(d => d.data());
    if (document.getElementById("tab-leaderboard").classList.contains("active")) {
      renderLeaderboard();
    }
  });
}

function renderLeaderboard() {
  const list = document.getElementById("leaderboard-list");
  if (!leaderboardData.length) { list.innerHTML = '<div class="lb-loading">Aucun joueur.</div>'; return; }

  list.innerHTML = "";
  leaderboardData.forEach((u, i) => {
    const rank  = i + 1;
    const isYou = u.uid === currentUser?.uid;
    const medals = ["🥇","🥈","🥉"];
    const rankEl = rank <= 3 ? `<div class="lb-rank gold-rank">${medals[rank-1]}</div>`
                              : `<div class="lb-rank">#${rank}</div>`;
    const entry = document.createElement("div");
    entry.className = "lb-entry" + (rank<=3?" top"+rank:"");
    entry.innerHTML = `
      ${rankEl}
      <div style="display:flex;align-items:center;gap:.5rem">
        <img class="lb-avatar" src="${u.avatar||''}" onerror="this.src=''" alt="">
        <span class="lb-name">${u.name||"Joueur"}${isYou?'<span class="lb-you">VOUS</span>':''}</span>
      </div>
      <div class="lb-balance">${(u.balance||0).toLocaleString("fr-FR")} VLX</div>
      <div class="lb-games">${u.gamesPlayed||0} parties</div>
    `;
    list.appendChild(entry);
  });
}

// ── UTILS ────────────────────────────────────────────────────
function delay(ms) { return new Promise(r => setTimeout(r,ms)); }
function shuffle(arr) {
  for (let i=arr.length-1;i>0;i--) {
    const j=Math.floor(Math.random()*(i+1));
    [arr[i],arr[j]]=[arr[j],arr[i]];
  }
}
