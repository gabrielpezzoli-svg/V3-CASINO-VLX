import {
  auth, db, googleProvider,
  signInWithPopup, signOut, onAuthStateChanged,
  doc, getDoc, setDoc, updateDoc,
  collection, query, orderBy, limit, onSnapshot
} from "./firebase-config.js";

let currentUser  = null;
let userData     = null;
let unsubLB      = null;
let currentPage  = "login";

// ── TOAST ────────────────────────────────────────────────────
function toast(msg, type = "") {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className   = "toast show " + type;
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.className = "toast"; }, 3000);
}

// ── NAVIGATION ───────────────────────────────────────────────
function showPage(name) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.getElementById("page-" + name).classList.add("active");
  currentPage = name;
  updateAllBalances();
}
window.goToGame = function(game) {
  if (game === "leaderboard") renderLeaderboard();
  showPage(game);
};
window.goToLobby = function() { showPage("lobby"); };

function updateAllBalances() {
  const bal = (userData?.balance ?? 0).toLocaleString("fr-FR") + " VLX";
  ["roulette","mines","coinflip"].forEach(id => {
    const el = document.getElementById(id + "-balance");
    if (el) el.textContent = bal;
  });
  const bd = document.getElementById("balance-display");
  if (bd) bd.textContent = bal;
}

// ── AUTH ─────────────────────────────────────────────────────
document.getElementById("google-login-btn").onclick = async () => {
  try { await signInWithPopup(auth, googleProvider); }
  catch (e) { document.getElementById("login-error").textContent = "Erreur : " + e.message; }
};
document.getElementById("logout-btn").onclick = () => signOut(auth);

onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    await loadOrCreateUser(user);
    document.getElementById("user-avatar").src = user.photoURL || "";
    document.getElementById("lobby-username").textContent = user.displayName || "";
    startLeaderboard();
    buildStrip();
    showPage("lobby");
  } else {
    currentUser = null; userData = null;
    if (unsubLB) { unsubLB(); unsubLB = null; }
    showPage("login");
  }
});

async function loadOrCreateUser(user) {
  const ref  = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const newUser = { uid:user.uid, name:user.displayName, avatar:user.photoURL, balance:1500, gamesPlayed:0, createdAt:Date.now() };
    await setDoc(ref, newUser);
    userData = newUser;
  } else { userData = snap.data(); }
}

async function saveUserData() {
  if (!currentUser) return;
  await updateDoc(doc(db, "users", currentUser.uid), { balance:userData.balance, gamesPlayed:userData.gamesPlayed });
  updateAllBalances();
}

// ── BET HELPERS ──────────────────────────────────────────────
window.quickBet = (id, mult) => {
  const el = document.getElementById(id);
  el.value = Math.max(10, Math.round(Number(el.value) * mult));
};
window.setMax = (id) => { document.getElementById(id).value = userData?.balance ?? 0; };

function parseBet(id) {
  const val = Number(document.getElementById(id).value);
  if (!Number.isFinite(val) || val < 10) { toast("Mise minimum : 10 VLX", "lose"); return null; }
  if (val > userData.balance)             { toast("Solde insuffisant !", "lose"); return null; }
  return Math.floor(val);
}

// ════════════════════════════════════════════════════════════
//   ROULETTE — BANDE DÉFILANTE
// ════════════════════════════════════════════════════════════

// Segments avec leurs propriétés
const SEGMENTS = [
  { mult:0,   label:"×0",   cls:"c0"  },
  { mult:0.5, label:"×0.5", cls:"c05" },
  { mult:1,   label:"×1",   cls:"c1"  },
  { mult:2,   label:"×2",   cls:"c2"  },
  { mult:5,   label:"×5",   cls:"c5"  },
];

const CELL_W        = 90;   // largeur d'une case en px
const STRIP_COPIES  = 8;    // répétitions pour la bande infinie
let stripOffset     = 0;    // position actuelle (px, négative)
let rouletteSpinning = false;

// Construit la bande avec STRIP_COPIES répétitions du pattern
function buildStrip() {
  const strip = document.getElementById("roulette-strip");
  strip.innerHTML = "";
  for (let r = 0; r < STRIP_COPIES; r++) {
    SEGMENTS.forEach(seg => {
      const cell = document.createElement("div");
      cell.className = "strip-cell " + seg.cls;
      cell.innerHTML = `<span class="cell-mult">${seg.label}</span>`;
      strip.appendChild(cell);
    });
  }
  // Position initiale : centrer sur le milieu de la bande
  const totalCells = SEGMENTS.length * STRIP_COPIES;
  const viewportCenter = document.querySelector(".strip-viewport").offsetWidth / 2;
  // On démarre au centre de la bande
  stripOffset = -(Math.floor(totalCells / 2) * CELL_W - viewportCenter + CELL_W / 2);
  strip.style.transform = `translateX(${stripOffset}px)`;
}

window.spinRoulette = async function() {
  if (rouletteSpinning) return;
  const bet = parseBet("roulette-bet");
  if (bet === null) return;

  rouletteSpinning = true;
  document.getElementById("roulette-spin-btn").disabled = true;
  document.getElementById("roulette-result").textContent = "";

  // Tirage aléatoire du segment gagnant
  const winIdx = Math.floor(Math.random() * SEGMENTS.length);
  const winner = SEGMENTS[winIdx];

  const strip      = document.getElementById("roulette-strip");
  const viewport   = document.querySelector(".strip-viewport");
  const vpCenter   = viewport.offsetWidth / 2;
  const totalWidth = SEGMENTS.length * CELL_W * STRIP_COPIES;

  // On tire 4 à 7 tours complets + position cible
  const extraRolls     = (4 + Math.floor(Math.random() * 4)) * SEGMENTS.length * CELL_W;
  // Centre de la case gagnante dans la copie du milieu
  const targetCopyStart = Math.floor(STRIP_COPIES / 2) * SEGMENTS.length * CELL_W;
  const targetCellCenter = targetCopyStart + winIdx * CELL_W + CELL_W / 2;
  // Décalage final pour centrer la case gagnante dans le viewport
  const finalOffset = -(targetCellCenter - vpCenter + extraRolls);

  // Animation CSS
  strip.style.transition = "transform 3.5s cubic-bezier(0.12, 0.8, 0.3, 1)";
  strip.style.transform  = `translateX(${finalOffset}px)`;
  stripOffset = finalOffset;

  await delay(3700);

  // Légère vibration d'arrêt
  strip.style.transition = "transform 0.15s ease";
  strip.style.transform  = `translateX(${finalOffset + 3}px)`;
  await delay(80);
  strip.style.transform  = `translateX(${finalOffset}px)`;
  await delay(150);

  // Résultat
  const gain = Math.round(bet * winner.mult) - bet;
  userData.balance = Math.max(0, userData.balance + gain);
  userData.gamesPlayed++;
  await saveUserData();

  const resultEl = document.getElementById("roulette-result");
  if (winner.mult === 0) {
    resultEl.innerHTML = `<span style="color:var(--red2)">×0 — Perdu ${bet} VLX</span>`;
    toast(`Perdu ${bet} VLX 💀`, "lose");
  } else if (winner.mult < 1) {
    resultEl.innerHTML = `<span style="color:var(--gold)">×0.5 → +${Math.round(bet*0.5)} VLX</span>`;
    toast(`×0.5 → +${Math.round(bet*0.5)} VLX`, "");
  } else if (winner.mult === 1) {
    resultEl.innerHTML = `<span style="color:var(--text)">×1 — Mise remboursée</span>`;
    toast("Mise remboursée !", "");
  } else {
    resultEl.innerHTML = `<span style="color:var(--green2)">×${winner.mult} — GAGNÉ ! +${Math.round(bet*winner.mult)} VLX 🎉</span>`;
    toast(`×${winner.mult} ! +${Math.round(bet*winner.mult)} VLX 🎉`, "win");
  }

  rouletteSpinning = false;
  document.getElementById("roulette-spin-btn").disabled = false;
};

// ════════════════════════════════════════════════════════════
//   MINES
// ════════════════════════════════════════════════════════════
const GRID_SIZE  = 25;
const MINE_COUNT = 5;
let minesActive  = false;
let minesBet     = 0;
let minesGrid    = [];
let safeRevealed = 0;

function getMinesMultiplier(safe) {
  const table = [1,1.18,1.40,1.68,2.05,2.55,3.25,4.25,5.70,8.0,12.0,19.0,33.0,65.0,156.0,500.0,2000.0,10000.0,50000.0,250000.0];
  return table[Math.min(safe, table.length-1)];
}

window.startMines = function() {
  const bet = parseBet("mines-bet");
  if (bet === null) return;
  minesBet = bet; safeRevealed = 0; minesActive = true;
  userData.balance -= bet; updateAllBalances();
  const pos = Array.from({length:GRID_SIZE},(_,i)=>i);
  shuffle(pos);
  minesGrid = Array(GRID_SIZE).fill(false);
  for (let i=0;i<MINE_COUNT;i++) minesGrid[pos[i]] = true;
  renderMinesGrid(); updateMinesInfo();
  document.getElementById("mines-start-btn").disabled   = true;
  document.getElementById("mines-cashout-btn").disabled = true;
  document.getElementById("mines-bet").disabled         = true;
};

window.cashoutMines = async function() {
  if (!minesActive || safeRevealed < 2) return;
  const mult = getMinesMultiplier(safeRevealed);
  const win  = Math.round(minesBet * mult);
  userData.balance += win; userData.gamesPlayed++;
  minesActive = false;
  await saveUserData();
  toast(`Cashout ! +${win} VLX (×${mult.toFixed(2)}) 💰`, "win");
  revealAllMines(); resetMinesButtons();
};

function revealCell(idx) {
  if (!minesActive) return;
  const cells = document.querySelectorAll(".mine-cell");
  const cell  = cells[idx];
  if (cell.classList.contains("revealed")) return;
  cell.classList.add("revealed");
  if (minesGrid[idx]) {
    cell.classList.add("mine"); cell.textContent = "💣";
    minesActive = false; userData.gamesPlayed++;
    saveUserData();
    toast(`MINE ! Perdu ${minesBet} VLX 💥`, "lose");
    revealAllMines(); resetMinesButtons();
  } else {
    cell.classList.add("safe"); cell.textContent = "✓";
    safeRevealed++; updateMinesInfo();
    if (safeRevealed >= 2) document.getElementById("mines-cashout-btn").disabled = false;
    if (safeRevealed === GRID_SIZE - MINE_COUNT) {
      const mult = getMinesMultiplier(safeRevealed);
      const win  = Math.round(minesBet * mult);
      userData.balance += win; userData.gamesPlayed++;
      minesActive = false; saveUserData();
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
    cell.className = "mine-cell"; cell.textContent = "?";
    cell.onclick = () => revealCell(i);
    grid.appendChild(cell);
  }
}

function revealAllMines() {
  document.querySelectorAll(".mine-cell").forEach((cell,i) => {
    if (minesGrid[i] && !cell.classList.contains("revealed")) {
      cell.classList.add("revealed","mine"); cell.textContent = "💣";
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
let chosenSide = null, coinFlipping = false;

window.chooseSide = function(side) {
  if (coinFlipping) return;
  chosenSide = side;
  document.getElementById("choose-blue").classList.toggle("selected", side==="blue");
  document.getElementById("choose-red").classList.toggle("selected",  side==="red");
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
  await delay(1400);
  const won = result === chosenSide;
  userData.balance = Math.max(0, userData.balance + (won ? bet : -bet));
  userData.gamesPlayed++;
  await saveUserData();
  const resultEl = document.getElementById("coinflip-result");
  if (won) {
    resultEl.innerHTML = `<span style="color:var(--green2)">Gagné ! +${bet} VLX 🎉</span>`;
    toast(`Correct ! +${bet} VLX`, "win");
  } else {
    resultEl.innerHTML = `<span style="color:var(--red2)">Perdu ${bet} VLX</span>`;
    toast(`Perdu ${bet} VLX`, "lose");
  }
  await delay(900);
  coin.className = "coin";
  coinFlipping = false; chosenSide = null;
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
  unsubLB = onSnapshot(q, snap => {
    leaderboardData = snap.docs.map(d => d.data());
    if (currentPage === "leaderboard") renderLeaderboard();
  });
}

function renderLeaderboard() {
  const list = document.getElementById("leaderboard-list");
  if (!leaderboardData.length) { list.innerHTML='<div class="lb-loading">Aucun joueur encore.</div>'; return; }
  list.innerHTML = "";
  leaderboardData.forEach((u, i) => {
    const rank  = i + 1;
    const isYou = u.uid === currentUser?.uid;
    const medals = ["🥇","🥈","🥉"];
    const rankEl = rank<=3 ? `<div class="lb-rank gold-rank">${medals[rank-1]}</div>` : `<div class="lb-rank">#${rank}</div>`;
    const entry = document.createElement("div");
    entry.className = "lb-entry" + (rank<=3?" top"+rank:"");
    entry.innerHTML = `${rankEl}<img class="lb-avatar" src="${u.avatar||''}" onerror="this.style.display='none'" alt=""><span class="lb-name">${u.name||"Joueur"}${isYou?'<span class="lb-you">VOUS</span>':''}</span><span class="lb-balance">${(u.balance||0).toLocaleString("fr-FR")} VLX</span>`;
    list.appendChild(entry);
  });
}

// ── UTILS ────────────────────────────────────────────────────
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function shuffle(arr) {
  for (let i=arr.length-1;i>0;i--) {
    const j=Math.floor(Math.random()*(i+1));
    [arr[i],arr[j]]=[arr[j],arr[i]];
  }
}
