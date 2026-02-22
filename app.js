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
  if (game === "roulette") initRouletteStrip();
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
//   ROULETTE — CANVAS INFINI
// ════════════════════════════════════════════════════════════

const SEGS = [
  { mult:0,   label:"×0",   color:"#7a0000", text:"#ff6b6b" },
  { mult:0.5, label:"×0.5", color:"#0d3566", text:"#74b9ff" },
  { mult:1,   label:"×1",   color:"#2d2d2d", text:"#dfe6e9" },
  { mult:2,   label:"×2",   color:"#1a5c1a", text:"#55efc4" },
  { mult:5,   label:"×5",   color:"#7a4400", text:"#fdcb6e" },
];

const CELL_W = 100;  // largeur case px
const CELL_H = 100;  // hauteur case px

let canvas, ctx;
let rouletteSpinning = false;
let animOffset = 0;   // position actuelle (px, défile vers gauche)
let animId     = null;

function initRouletteStrip() {
  canvas = document.getElementById("roulette-canvas");
  if (!canvas) return;
  ctx = canvas.getContext("2d");
  canvas.width  = canvas.offsetWidth;
  canvas.height = CELL_H;
  drawStrip(animOffset);
}

// Dessine la bande à une position donnée
function drawStrip(offset) {
  if (!canvas || !ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  const patternW = SEGS.length * CELL_W;

  ctx.clearRect(0, 0, W, H);

  // Calcul du décalage normalisé (modulo pour boucler)
  const norm = ((offset % patternW) + patternW) % patternW;

  // On dessine assez de cases pour couvrir tout le canvas + débords
  const startCell = Math.floor(norm / CELL_W);
  const startX    = -(norm % CELL_W);

  for (let i = -1; i < Math.ceil(W / CELL_W) + 2; i++) {
    const segIdx = ((startCell + i) % SEGS.length + SEGS.length) % SEGS.length;
    const seg    = SEGS[segIdx];
    const x      = startX + i * CELL_W;

    // Fond
    ctx.fillStyle = seg.color;
    ctx.fillRect(x, 0, CELL_W, H);

    // Séparateur
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, 0, CELL_W, H);

    // Multiplicateur
    ctx.fillStyle = seg.text;
    ctx.font      = "bold 24px 'DM Mono', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(seg.label, x + CELL_W / 2, H / 2);
  }

  // Dégradés sur les côtés
  const fadeW = 100;
  const gradL = ctx.createLinearGradient(0, 0, fadeW, 0);
  gradL.addColorStop(0, "#0a0a0f");
  gradL.addColorStop(1, "transparent");
  ctx.fillStyle = gradL;
  ctx.fillRect(0, 0, fadeW, H);

  const gradR = ctx.createLinearGradient(W - fadeW, 0, W, 0);
  gradR.addColorStop(0, "transparent");
  gradR.addColorStop(1, "#0a0a0f");
  ctx.fillStyle = gradR;
  ctx.fillRect(W - fadeW, 0, fadeW, H);

  // Surlignage central (case active)
  const cx = W / 2;
  ctx.strokeStyle = "rgba(212, 160, 23, 0.8)";
  ctx.lineWidth   = 3;
  ctx.strokeRect(cx - CELL_W / 2, 2, CELL_W, H - 4);
}

// Easing ease-out cubique
function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

window.spinRoulette = async function() {
  if (rouletteSpinning) return;
  const bet = parseBet("roulette-bet");
  if (bet === null) return;

  rouletteSpinning = true;
  document.getElementById("roulette-spin-btn").disabled = true;
  document.getElementById("roulette-result").textContent = "";

  // Tirage
  const winIdx = Math.floor(Math.random() * SEGS.length);
  const winner = SEGS[winIdx];

  // On veut que la case gagnante soit exactement au centre du canvas
  // Centre = canvas.width / 2
  // On calcule la distance à parcourir :
  //  - tours complets : 5 à 8 fois le pattern
  //  - + position de la case gagnante centrée
  const W          = canvas.width;
  const patternW   = SEGS.length * CELL_W;
  const extraTurns = (5 + Math.floor(Math.random() * 4)) * patternW;

  // Position du centre de la case gagnante dans le pattern
  const winCellCenter = winIdx * CELL_W + CELL_W / 2;
  // On veut que winCellCenter soit sous W/2 (le pointeur central)
  // offset final = winCellCenter - W/2 + extraTurns
  const targetOffset = animOffset + extraTurns + (winCellCenter - (animOffset % patternW + patternW) % patternW);

  const startOffset = animOffset;
  const totalDist   = targetOffset - startOffset;
  const duration    = 3500; // ms
  const startTime   = performance.now();

  if (animId) cancelAnimationFrame(animId);

  function animate(now) {
    const elapsed  = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased    = easeOut(progress);

    animOffset = startOffset + totalDist * eased;
    drawStrip(animOffset);

    if (progress < 1) {
      animId = requestAnimationFrame(animate);
    } else {
      animOffset = targetOffset;
      drawStrip(animOffset);
      finishSpin(winner, bet);
    }
  }

  animId = requestAnimationFrame(animate);
};

async function finishSpin(winner, bet) {
  // Petit rebond
  const bounce = animOffset - 5;
  await animateTo(bounce, 100);
  await animateTo(animOffset + 5, 150);

  const gain = Math.round(bet * winner.mult) - bet;
  userData.balance = Math.max(0, userData.balance + gain);
  userData.gamesPlayed++;
  await saveUserData();

  const resultEl = document.getElementById("roulette-result");
  if (winner.mult === 0) {
    resultEl.innerHTML = `<span style="color:var(--red2)">×0 — Perdu ${bet} VLX 💀</span>`;
    toast(`Perdu ${bet} VLX`, "lose");
  } else if (winner.mult < 1) {
    resultEl.innerHTML = `<span style="color:var(--gold)">×0.5 → +${Math.round(bet*0.5)} VLX</span>`;
    toast(`×0.5 → +${Math.round(bet*0.5)} VLX`, "");
  } else if (winner.mult === 1) {
    resultEl.innerHTML = `<span style="color:var(--text)">×1 — Mise remboursée</span>`;
    toast("Mise remboursée !", "");
  } else {
    resultEl.innerHTML = `<span style="color:var(--green2)">×${winner.mult} — GAGNÉ +${Math.round(bet*winner.mult)} VLX 🎉</span>`;
    toast(`×${winner.mult} ! +${Math.round(bet*winner.mult)} VLX 🎉`, "win");
  }

  rouletteSpinning = false;
  document.getElementById("roulette-spin-btn").disabled = false;
}

function animateTo(target, duration) {
  return new Promise(resolve => {
    const start     = animOffset;
    const dist      = target - start;
    const startTime = performance.now();
    function step(now) {
      const t = Math.min((now - startTime) / duration, 1);
      animOffset = start + dist * t;
      drawStrip(animOffset);
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    }
    requestAnimationFrame(step);
  });
}

// Redimensionnement
window.addEventListener("resize", () => {
  if (currentPage === "roulette") initRouletteStrip();
});

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
