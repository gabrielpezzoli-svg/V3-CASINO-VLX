import {
  auth, db, googleProvider,
  signInWithPopup, signOut, onAuthStateChanged,
  doc, getDoc, setDoc, updateDoc,
  collection, query, orderBy, limit, onSnapshot
} from "./firebase-config.js";

import { getDocs, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let currentUser = null, userData = null, unsubLB = null, currentPage = "login";

// ── TOAST ──────────────────────────────────────────────────────
function toast(msg, type = "") {
  const t = document.getElementById("toast");
  t.textContent = msg; t.className = "toast show " + type;
  clearTimeout(t._t); t._t = setTimeout(() => t.className = "toast", 3000);
}

// ── NAVIGATION ─────────────────────────────────────────────────
function showPage(name) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.getElementById("page-" + name).classList.add("active");
  currentPage = name;
  updateAllBalances();
}
window.showPage = showPage;

window.goToGame = function (game) {
  if (game === "leaderboard") renderLeaderboard();
  if (game === "dice") updateDiceUI();
  showPage(game);
};
window.goToLobby = function () {
  showPage("lobby");
  initBonus();
};

function updateAllBalances() {
  const bal = (userData?.balance ?? 0).toLocaleString("fr-FR") + " VLX";
  ["dice", "mines", "coinflip"].forEach(id => {
    const el = document.getElementById(id + "-balance");
    if (el) el.textContent = bal;
  });
  const bd = document.getElementById("balance-display");
  if (bd) bd.textContent = bal;
}

// ── AUTH ───────────────────────────────────────────────────────
document.getElementById("google-login-btn").onclick = async () => {
  try { await signInWithPopup(auth, googleProvider); }
  catch (e) { document.getElementById("login-error").textContent = "Erreur : " + e.message; }
};
document.getElementById("logout-btn").onclick = () => signOut(auth);

onAuthStateChanged(auth, async user => {
  if (user) {
    currentUser = user;
    await loadOrCreateUser(user);
    if (!userData) return;
    document.getElementById("user-avatar").src = user.photoURL || "";
    document.getElementById("lobby-username").textContent = user.displayName || "";
    startLeaderboard();
    showPage("lobby");
    initBonus();
  } else {
    currentUser = null; userData = null;
    if (unsubLB) { unsubLB(); unsubLB = null; }
    showPage("login");
  }
});

async function loadOrCreateUser(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const u = { uid: user.uid, name: user.displayName, avatar: user.photoURL, balance: 1500, gamesPlayed: 0, lastBonus: 0, createdAt: Date.now() };
    await setDoc(ref, u);
    userData = u;
  } else {
    userData = snap.data();
    if (userData.banned) {
      toast("Votre compte a été banni.", "lose");
      userData = null;
      await signOut(auth);
    }
  }
}

async function saveUserData() {
  if (!currentUser) return;
  await updateDoc(doc(db, "users", currentUser.uid), { balance: userData.balance, gamesPlayed: userData.gamesPlayed });
  updateAllBalances();
}

// ── BET HELPERS ────────────────────────────────────────────────
window.quickBet = (id, mult) => {
  const el = document.getElementById(id);
  el.value = Math.max(10, Math.round(Number(el.value) * mult));
};
window.setMax = id => { document.getElementById(id).value = userData?.balance ?? 0; };
function parseBet(id) {
  const v = Number(document.getElementById(id).value);
  if (!Number.isFinite(v) || v < 10) { toast("Mise minimum : 10 VLX", "lose"); return null; }
  if (v > userData.balance) { toast("Solde insuffisant !", "lose"); return null; }
  return Math.floor(v);
}

// ═══════════════════════════════════════════════════════════════
//   DICE
// ═══════════════════════════════════════════════════════════════
let diceTarget = 50, diceDirection = "under", diceRolling = false;

function diceWinChance() {
  return diceDirection === "under" ? (diceTarget - 1) / 100 : (100 - diceTarget) / 100;
}
function diceMultiplier() {
  const c = diceWinChance();
  return c <= 0 ? 0 : Math.round((0.98 / c) * 100) / 100;
}
function updateDiceUI() {
  document.getElementById("dice-target-display").textContent = diceTarget;
  document.getElementById("dice-mult-display").textContent = "×" + diceMultiplier().toFixed(2);
  const bar = document.getElementById("dice-bar-win");
  if (diceDirection === "under") {
    bar.style.left = "0%"; bar.style.width = (diceTarget - 1) + "%"; bar.style.borderRadius = "22px 0 0 22px";
  } else {
    bar.style.left = diceTarget + "%"; bar.style.width = (100 - diceTarget) + "%"; bar.style.borderRadius = "0 22px 22px 0";
  }
}
window.adjustTarget = d => { diceTarget = Math.max(2, Math.min(98, diceTarget + d)); updateDiceUI(); };
window.setDirection = dir => {
  diceDirection = dir;
  document.getElementById("dir-under").classList.toggle("active", dir === "under");
  document.getElementById("dir-over").classList.toggle("active", dir === "over");
  updateDiceUI();
};
window.rollDice = async function () {
  if (diceRolling) return;
  const bet = parseBet("dice-bet"); if (!bet) return;
  if (diceWinChance() <= 0) { toast("Zone impossible !", "lose"); return; }
  diceRolling = true;
  document.getElementById("dice-roll-btn").disabled = true;
  const result = Math.floor(Math.random() * 100) + 1;
  const marker = document.getElementById("dice-bar-marker");
  marker.style.display = "block"; marker.style.transition = "none"; marker.style.left = "0%";
  await delay(50);
  marker.style.transition = "left 0.9s cubic-bezier(.25,.8,.25,1)";
  marker.style.left = result + "%";
  await delay(1000);
  const won = diceDirection === "under" ? result < diceTarget : result > diceTarget;
  const mult = diceMultiplier();
  userData.balance = Math.max(0, userData.balance + (won ? Math.round(bet * mult) - bet : -bet));
  userData.gamesPlayed++;
  await saveUserData();
  const rolledEl = document.getElementById("dice-rolled");
  rolledEl.textContent = result; rolledEl.className = "dice-rolled " + (won ? "win" : "lose");
  const barWin = document.getElementById("dice-bar-win");
  barWin.style.background = won ? "linear-gradient(90deg,var(--green),#2ecc71)" : "linear-gradient(90deg,var(--red),var(--red2))";
  setTimeout(() => { barWin.style.background = "linear-gradient(90deg,var(--green),#2ecc71)"; }, 1500);
  toast(won ? `Gagné ! +${Math.round(bet * mult)} VLX (×${mult.toFixed(2)}) 🎉` : `Perdu ${bet} VLX — résultat : ${result}`, won ? "win" : "lose");
  await delay(400);
  diceRolling = false;
  document.getElementById("dice-roll-btn").disabled = false;
};

// ═══════════════════════════════════════════════════════════════
//   MINES
// ═══════════════════════════════════════════════════════════════
const GRID_SIZE = 25, MINE_COUNT = 5;
let minesActive = false, minesBet = 0, minesGrid = [], safeRevealed = 0;

function getMinesMultiplier(safe) {
  const t = [1, 1.18, 1.40, 1.68, 2.05, 2.55, 3.25, 4.25, 5.70, 8.0, 12, 19, 33, 65, 156, 500, 2000, 10000, 50000, 250000];
  return t[Math.min(safe, t.length - 1)];
}
window.startMines = function () {
  const bet = parseBet("mines-bet"); if (!bet) return;
  minesBet = bet; safeRevealed = 0; minesActive = true;
  userData.balance -= bet; updateAllBalances();
  const pos = Array.from({ length: GRID_SIZE }, (_, i) => i); shuffle(pos);
  minesGrid = Array(GRID_SIZE).fill(false);
  for (let i = 0; i < MINE_COUNT; i++) minesGrid[pos[i]] = true;
  renderMinesGrid(); updateMinesInfo();
  document.getElementById("mines-start-btn").disabled = true;
  document.getElementById("mines-cashout-btn").disabled = true;
  document.getElementById("mines-bet").disabled = true;
};
window.cashoutMines = async function () {
  if (!minesActive || safeRevealed < 2) return;
  const mult = getMinesMultiplier(safeRevealed), win = Math.round(minesBet * mult);
  userData.balance += win; userData.gamesPlayed++; minesActive = false;
  await saveUserData();
  toast(`Cashout ! +${win} VLX (×${mult.toFixed(2)}) 💰`, "win");
  revealAllMines(); resetMinesButtons();
};
function revealCell(idx) {
  if (!minesActive) return;
  const cells = document.querySelectorAll(".mine-cell"), cell = cells[idx];
  if (cell.classList.contains("revealed")) return;
  cell.classList.add("revealed");
  if (minesGrid[idx]) {
    cell.classList.add("mine"); cell.textContent = "💣";
    minesActive = false; userData.gamesPlayed++; saveUserData();
    toast(`MINE ! Perdu ${minesBet} VLX 💥`, "lose");
    revealAllMines(); resetMinesButtons();
  } else {
    cell.classList.add("safe"); cell.textContent = "✓";
    safeRevealed++; updateMinesInfo();
    if (safeRevealed >= 2) document.getElementById("mines-cashout-btn").disabled = false;
    if (safeRevealed === GRID_SIZE - MINE_COUNT) {
      const mult = getMinesMultiplier(safeRevealed), win = Math.round(minesBet * mult);
      userData.balance += win; userData.gamesPlayed++; minesActive = false;
      saveUserData(); toast(`Parfait ! +${win} VLX 🏆`, "win"); resetMinesButtons();
    }
  }
}
function updateMinesInfo() {
  const mult = getMinesMultiplier(safeRevealed);
  document.getElementById("mines-safe-count").textContent = safeRevealed;
  document.getElementById("mines-multiplier").textContent = "×" + mult.toFixed(2);
  document.getElementById("mines-bet-display").textContent = minesBet + " VLX";
  document.getElementById("mines-potential").textContent = Math.round(minesBet * mult) + " VLX";
}
function renderMinesGrid() {
  const g = document.getElementById("mines-grid"); g.innerHTML = "";
  for (let i = 0; i < GRID_SIZE; i++) {
    const c = document.createElement("div"); c.className = "mine-cell"; c.textContent = "?";
    c.onclick = () => revealCell(i); g.appendChild(c);
  }
}
function revealAllMines() {
  document.querySelectorAll(".mine-cell").forEach((c, i) => {
    if (minesGrid[i] && !c.classList.contains("revealed")) { c.classList.add("revealed", "mine"); c.textContent = "💣"; }
  });
}
function resetMinesButtons() {
  document.getElementById("mines-start-btn").disabled = false;
  document.getElementById("mines-cashout-btn").disabled = true;
  document.getElementById("mines-bet").disabled = false;
}

// ═══════════════════════════════════════════════════════════════
//   COINFLIP
// ═══════════════════════════════════════════════════════════════
let chosenSide = null, coinFlipping = false;
window.chooseSide = function (side) {
  if (coinFlipping) return;
  chosenSide = side;
  document.getElementById("choose-blue").classList.toggle("selected", side === "blue");
  document.getElementById("choose-red").classList.toggle("selected", side === "red");
  document.getElementById("coinflip-btn").disabled = false;
};
window.flipCoin = async function () {
  if (!chosenSide || coinFlipping) return;
  const bet = parseBet("coinflip-bet"); if (!bet) return;
  coinFlipping = true; document.getElementById("coinflip-btn").disabled = true;
  document.getElementById("coinflip-result").textContent = "";
  const result = Math.random() < .5 ? "blue" : "red";
  const coin = document.getElementById("coin"); coin.className = "coin flip-" + result;
  await delay(1400);
  const won = result === chosenSide;
  userData.balance = Math.max(0, userData.balance + (won ? bet : -bet)); userData.gamesPlayed++;
  await saveUserData();
  document.getElementById("coinflip-result").innerHTML = won
    ? `<span style="color:var(--green2)">Gagné ! +${bet} VLX 🎉</span>`
    : `<span style="color:var(--red2)">Perdu ${bet} VLX</span>`;
  toast(won ? `Correct ! +${bet} VLX` : `Perdu ${bet} VLX`, won ? "win" : "lose");
  await delay(900);
  coin.className = "coin"; coinFlipping = false; chosenSide = null;
  document.getElementById("choose-blue").classList.remove("selected");
  document.getElementById("choose-red").classList.remove("selected");
  document.getElementById("coinflip-btn").disabled = true;
};

// ═══════════════════════════════════════════════════════════════
//   LEADERBOARD
// ═══════════════════════════════════════════════════════════════
let leaderboardData = [];
function startLeaderboard() {
  const q = query(collection(db, "users"), orderBy("balance", "desc"), limit(20));
  unsubLB = onSnapshot(q, snap => {
    leaderboardData = snap.docs.map(d => d.data());
    if (currentPage === "leaderboard") renderLeaderboard();
  });
}
function renderLeaderboard() {
  const list = document.getElementById("leaderboard-list");
  if (!leaderboardData.length) { list.innerHTML = '<div class="lb-loading">Aucun joueur encore.</div>'; return; }
  list.innerHTML = "";
  leaderboardData.forEach((u, i) => {
    const rank = i + 1, isYou = u.uid === currentUser?.uid;
    const medals = ["🥇", "🥈", "🥉"];
    const rankEl = rank <= 3 ? `<div class="lb-rank gold-rank">${medals[rank - 1]}</div>` : `<div class="lb-rank">#${rank}</div>`;
    const e = document.createElement("div");
    e.className = "lb-entry" + (rank <= 3 ? " top" + rank : "");
    e.innerHTML = `${rankEl}<img class="lb-avatar" src="${u.avatar || ''}" onerror="this.style.display='none'" alt=""><span class="lb-name">${u.name || "Joueur"}${isYou ? '<span class="lb-you">VOUS</span>' : ''}</span><span class="lb-balance">${(u.balance || 0).toLocaleString("fr-FR")} VLX</span>`;
    list.appendChild(e);
  });
}

// ── UTILS ──────────────────────────────────────────────────────
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[arr[i], arr[j]] = [arr[j], arr[i]]; } }

// ═══════════════════════════════════════════════════════════════
//   BONUS HORAIRE
// ═══════════════════════════════════════════════════════════════
const BONUS_AMOUNT = 50, BONUS_COOLDOWN = 60 * 60 * 1000;
let bonusInterval = null;

function initBonus() {
  clearInterval(bonusInterval);
  updateBonusUI();
  bonusInterval = setInterval(updateBonusUI, 1000);
}
function timeUntilNextBonus() {
  return Math.max(0, (userData?.lastBonus || 0) + BONUS_COOLDOWN - Date.now());
}
function updateBonusUI() {
  const card = document.getElementById("bonus-card");
  const label = document.getElementById("bonus-label");
  const timerEl = document.getElementById("bonus-timer");
  if (!card) return;
  const remaining = timeUntilNextBonus();
  if (remaining <= 0) {
    card.classList.add("ready"); card.classList.remove("claimed");
    label.style.display = ""; label.textContent = "RÉCLAMER →";
    timerEl.style.display = "none";
  } else {
    card.classList.remove("ready"); card.classList.add("claimed");
    label.style.display = "none"; timerEl.style.display = "";
    const h = Math.floor(remaining / 3600000);
    const m = Math.floor((remaining % 3600000) / 60000);
    const s = Math.floor((remaining % 60000) / 1000);
    timerEl.textContent = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
}
window.claimBonus = async function () {
  if (timeUntilNextBonus() > 0 || !currentUser || !userData) return;
  userData.balance += BONUS_AMOUNT;
  userData.lastBonus = Date.now();
  await updateDoc(doc(db, "users", currentUser.uid), { balance: userData.balance, lastBonus: userData.lastBonus });
  updateAllBalances(); updateBonusUI();
  toast(`+${BONUS_AMOUNT} VLX réclamés ! 🎁`, "win");
};

const lobbyObserver = new MutationObserver(() => {
  if (document.getElementById("page-lobby")?.classList.contains("active")) initBonus();
});
lobbyObserver.observe(document.getElementById("page-lobby"), { attributes: true, attributeFilter: ["class"] });

// ═══════════════════════════════════════════════════════════════
//   ADMIN
// ═══════════════════════════════════════════════════════════════
const ADMIN_ID = "GABRIEL";
const ADMIN_PW = "Gaby2023";
let adminSelectedUser = null;
let allUsersData = [];

// Toggle le panneau login admin sous la carte
window.toggleAdminCard = function () {
  const panel = document.getElementById("admin-login-panel");
  const isVisible = panel.style.display !== "none";
  panel.style.display = isVisible ? "none" : "block";
  if (!isVisible) {
    document.getElementById("admin-id-input").focus();
    document.getElementById("admin-login-error").textContent = "";
  }
};

window.tryAdminLogin = function () {
  const id = document.getElementById("admin-id-input").value.trim();
  const pw = document.getElementById("admin-pw-input").value;
  const errEl = document.getElementById("admin-login-error");
  if (id === ADMIN_ID && pw === ADMIN_PW) {
    errEl.textContent = "";
    document.getElementById("admin-id-input").value = "";
    document.getElementById("admin-pw-input").value = "";
    document.getElementById("admin-login-panel").style.display = "none";
    loadAdminPanel();
    showPage("admin");
  } else {
    errEl.textContent = "❌ Identifiant ou mot de passe incorrect.";
  }
};

async function loadAdminPanel() {
  const list = document.getElementById("admin-list");
  list.innerHTML = '<div class="lb-loading">Chargement des joueurs...</div>';
  const q = query(collection(db, "users"), orderBy("balance", "desc"));
  const snap = await getDocs(q);
  allUsersData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderAdminList();
}

function renderAdminList() {
  const list = document.getElementById("admin-list");
  list.innerHTML = "";
  if (!allUsersData.length) {
    list.innerHTML = '<div class="lb-loading">Aucun joueur trouvé.</div>';
    return;
  }
  allUsersData.forEach(u => {
    const e = document.createElement("div");
    e.className = "admin-entry" + (u.banned ? " admin-banned" : "");
    e.innerHTML = `
      <img class="lb-avatar" src="${u.avatar || ''}" onerror="this.style.display='none'" alt="">
      <div class="admin-entry-info">
        <span class="admin-entry-name">${u.name || "Joueur"}${u.banned ? ' <span class="admin-ban-badge">BANNI</span>' : ''}</span>
        <span class="admin-entry-balance">${(u.balance || 0).toLocaleString("fr-FR")} VLX</span>
      </div>
      <button class="btn-admin-manage" onclick="openAdminModal('${u.id}')">⚙ Gérer</button>
    `;
    list.appendChild(e);
  });
}

window.openAdminModal = function (uid) {
  adminSelectedUser = allUsersData.find(u => u.id === uid);
  if (!adminSelectedUser) return;
  document.getElementById("admin-modal-username").textContent = adminSelectedUser.name || "Joueur";
  document.getElementById("admin-modal-balance").textContent = (adminSelectedUser.balance || 0).toLocaleString("fr-FR") + " VLX";
  document.getElementById("admin-amount").value = "";
  document.getElementById("admin-modal").style.display = "flex";
};

window.closeAdminModal = function () {
  document.getElementById("admin-modal").style.display = "none";
  adminSelectedUser = null;
};

window.adminAdd = async function () {
  if (!adminSelectedUser) return;
  const amount = parseInt(document.getElementById("admin-amount").value);
  if (!amount || amount <= 0) { toast("Montant invalide", "lose"); return; }
  const newBal = (adminSelectedUser.balance || 0) + amount;
  await updateDoc(doc(db, "users", adminSelectedUser.id), { balance: newBal });
  adminSelectedUser.balance = newBal;
  allUsersData.find(u => u.id === adminSelectedUser.id).balance = newBal;
  document.getElementById("admin-modal-balance").textContent = newBal.toLocaleString("fr-FR") + " VLX";
  renderAdminList();
  toast(`✅ +${amount} VLX ajoutés à ${adminSelectedUser.name}`, "win");
};

window.adminRemove = async function () {
  if (!adminSelectedUser) return;
  const amount = parseInt(document.getElementById("admin-amount").value);
  if (!amount || amount <= 0) { toast("Montant invalide", "lose"); return; }
  const newBal = Math.max(0, (adminSelectedUser.balance || 0) - amount);
  await updateDoc(doc(db, "users", adminSelectedUser.id), { balance: newBal });
  adminSelectedUser.balance = newBal;
  allUsersData.find(u => u.id === adminSelectedUser.id).balance = newBal;
  document.getElementById("admin-modal-balance").textContent = newBal.toLocaleString("fr-FR") + " VLX";
  renderAdminList();
  toast(`-${amount} VLX retirés de ${adminSelectedUser.name}`, "lose");
};

window.adminBan = async function () {
  if (!adminSelectedUser) return;
  const newBan = !adminSelectedUser.banned;
  if (!confirm(`${newBan ? "Bannir" : "Débannir"} ${adminSelectedUser.name} ?`)) return;
  await updateDoc(doc(db, "users", adminSelectedUser.id), { banned: newBan });
  adminSelectedUser.banned = newBan;
  allUsersData.find(u => u.id === adminSelectedUser.id).banned = newBan;
  renderAdminList();
  closeAdminModal();
  toast(newBan ? `🚫 ${adminSelectedUser.name} a été banni` : `✅ ${adminSelectedUser.name} a été débanni`, newBan ? "lose" : "win");
};

window.adminDelete = async function () {
  if (!adminSelectedUser) return;
  if (!confirm(`Supprimer définitivement le compte de ${adminSelectedUser.name} ?`)) return;
  await deleteDoc(doc(db, "users", adminSelectedUser.id));
  allUsersData = allUsersData.filter(u => u.id !== adminSelectedUser.id);
  renderAdminList();
  closeAdminModal();
  toast(`🗑️ Compte supprimé`, "lose");
};
