import {
  auth, db, googleProvider,
  signInWithPopup, signOut, onAuthStateChanged,
  doc, getDoc, setDoc, updateDoc,
  collection, query, orderBy, limit, onSnapshot
} from "./firebase-config.js";

let currentUser = null, userData = null, unsubLB = null, currentPage = "login";

// ── TOAST ─────────────────────────────────────────────────────
function toast(msg, type="") {
  const t = document.getElementById("toast");
  t.textContent = msg; t.className = "toast show " + type;
  clearTimeout(t._t); t._t = setTimeout(() => t.className="toast", 3000);
}

// ── NAVIGATION ────────────────────────────────────────────────
function showPage(name) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.getElementById("page-"+name).classList.add("active");
  currentPage = name; updateAllBalances();
}
window.goToGame = function(game) {
  if (game==="leaderboard") renderLeaderboard();
  showPage(game);
};
window.goToLobby = function() { showPage("lobby"); };

function updateAllBalances() {
  const bal = (userData?.balance ?? 0).toLocaleString("fr-FR") + " VLX";
  ["dice","mines","coinflip"].forEach(id => {
    const el = document.getElementById(id+"-balance");
    if (el) el.textContent = bal;
  });
  const bd = document.getElementById("balance-display");
  if (bd) bd.textContent = bal;
}

// ── AUTH ──────────────────────────────────────────────────────
document.getElementById("google-login-btn").onclick = async () => {
  try { await signInWithPopup(auth, googleProvider); }
  catch(e) { document.getElementById("login-error").textContent = "Erreur : "+e.message; }
};
document.getElementById("logout-btn").onclick = () => signOut(auth);

onAuthStateChanged(auth, async user => {
  if (user) {
    currentUser = user;
    await loadOrCreateUser(user);
    document.getElementById("user-avatar").src = user.photoURL||"";
    document.getElementById("lobby-username").textContent = user.displayName||"";
    startLeaderboard();
    showPage("lobby");
  } else {
    currentUser = null; userData = null;
    if (unsubLB) { unsubLB(); unsubLB=null; }
    showPage("login");
  }
});

async function loadOrCreateUser(user) {
  const ref = doc(db,"users",user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const u = {uid:user.uid,name:user.displayName,avatar:user.photoURL,balance:1500,gamesPlayed:0,createdAt:Date.now()};
    await setDoc(ref,u); userData=u;
  } else userData=snap.data();
}
async function saveUserData() {
  if (!currentUser) return;
  await updateDoc(doc(db,"users",currentUser.uid),{balance:userData.balance,gamesPlayed:userData.gamesPlayed});
  updateAllBalances();
}

// ── BET HELPERS ───────────────────────────────────────────────
window.quickBet = (id,mult) => {
  const el=document.getElementById(id); el.value=Math.max(10,Math.round(Number(el.value)*mult));
};
window.setMax = id => { document.getElementById(id).value=userData?.balance??0; };
function parseBet(id) {
  const v=Number(document.getElementById(id).value);
  if(!Number.isFinite(v)||v<10){toast("Mise minimum : 10 VLX","lose");return null;}
  if(v>userData.balance){toast("Solde insuffisant !","lose");return null;}
  return Math.floor(v);
}

// ═════════════════════════════════════════════════════════════
//   DICE
// ═════════════════════════════════════════════════════════════
let diceTarget    = 50;
let diceDirection = "under"; // "under" = résultat < cible | "over" = résultat > cible
let diceRolling   = false;

// Probabilité de gagner
function diceWinChance() {
  if (diceDirection === "under") return (diceTarget - 1) / 100;  // 1..target-1 gagne
  else                           return (100 - diceTarget) / 100; // target+1..100 gagne
}

// Multiplicateur avec avantage maison de 2%
function diceMultiplier() {
  const chance = diceWinChance();
  if (chance <= 0) return 0;
  return Math.round((0.98 / chance) * 100) / 100;
}

function updateDiceUI() {
  const target = diceTarget;
  const dir    = diceDirection;
  const mult   = diceMultiplier();
  const chance = diceWinChance();

  document.getElementById("dice-target-display").textContent = target;
  document.getElementById("dice-mult-display").textContent   = "×" + mult.toFixed(2);

  // Barre verte = zone gagnante
  const bar = document.getElementById("dice-bar-win");
  if (dir === "under") {
    // Zone gagnante : gauche → target-1
    bar.style.left  = "0%";
    bar.style.width = ((target - 1) / 100 * 100) + "%";
    bar.style.borderRadius = "22px 0 0 22px";
  } else {
    // Zone gagnante : target+1 → droite
    bar.style.left  = (target / 100 * 100) + "%";
    bar.style.width = ((100 - target) / 100 * 100) + "%";
    bar.style.borderRadius = "0 22px 22px 0";
  }
}

window.adjustTarget = function(delta) {
  diceTarget = Math.max(2, Math.min(98, diceTarget + delta));
  updateDiceUI();
};

window.setDirection = function(dir) {
  diceDirection = dir;
  document.getElementById("dir-under").classList.toggle("active", dir==="under");
  document.getElementById("dir-over").classList.toggle("active",  dir==="over");
  updateDiceUI();
};

window.rollDice = async function() {
  if (diceRolling) return;
  const bet = parseBet("dice-bet");
  if (bet === null) return;

  const chance = diceWinChance();
  if (chance <= 0) { toast("Zone impossible !", "lose"); return; }

  diceRolling = true;
  document.getElementById("dice-roll-btn").disabled = true;

  // Tirage 1–100
  const result = Math.floor(Math.random() * 100) + 1;

  // Animation du marqueur : parcourt la barre en 1s avant de s'arrêter au bon endroit
  const marker = document.getElementById("dice-bar-marker");
  marker.style.display = "block";
  marker.style.transition = "none";
  marker.style.left = "0%";

  // Petite pause pour que le reset soit visible
  await delay(50);

  // Déplace le marqueur vers la position finale
  marker.style.transition = "left 0.9s cubic-bezier(.25,.8,.25,1)";
  marker.style.left = (result / 100 * 100) + "%";

  await delay(1000);

  // Résultat
  const won = diceDirection==="under" ? result < diceTarget : result > diceTarget;
  const mult = diceMultiplier();
  const gain = won ? Math.round(bet * mult) - bet : -bet;

  userData.balance = Math.max(0, userData.balance + gain);
  userData.gamesPlayed++;
  await saveUserData();

  // Affichage du chiffre tiré
  const rolledEl = document.getElementById("dice-rolled");
  rolledEl.textContent = result;
  rolledEl.className   = "dice-rolled " + (won ? "win" : "lose");

  // Couleur de la barre selon résultat
  const barWin = document.getElementById("dice-bar-win");
  barWin.style.background = won
    ? "linear-gradient(90deg,var(--green),#2ecc71)"
    : "linear-gradient(90deg,var(--red),var(--red2))";
  setTimeout(() => {
    barWin.style.background = "linear-gradient(90deg,var(--green),#2ecc71)";
  }, 1500);

  if (won) {
    toast(`Gagné ! +${Math.round(bet*mult)} VLX (×${mult.toFixed(2)}) 🎉`, "win");
  } else {
    toast(`Perdu ${bet} VLX — résultat : ${result}`, "lose");
  }

  await delay(400);
  diceRolling = false;
  document.getElementById("dice-roll-btn").disabled = false;
};

// Init la barre dès le chargement de la page dice
window.goToGame = function(game) {
  if (game==="leaderboard") renderLeaderboard();
  if (game==="dice") { updateDiceUI(); }
  showPage(game);
};

// ═════════════════════════════════════════════════════════════
//   MINES
// ═════════════════════════════════════════════════════════════
const GRID_SIZE=25, MINE_COUNT=5;
let minesActive=false, minesBet=0, minesGrid=[], safeRevealed=0;

function getMinesMultiplier(safe) {
  const t=[1,1.18,1.40,1.68,2.05,2.55,3.25,4.25,5.70,8.0,12,19,33,65,156,500,2000,10000,50000,250000];
  return t[Math.min(safe,t.length-1)];
}
window.startMines = function() {
  const bet=parseBet("mines-bet"); if(!bet) return;
  minesBet=bet; safeRevealed=0; minesActive=true;
  userData.balance-=bet; updateAllBalances();
  const pos=Array.from({length:GRID_SIZE},(_,i)=>i); shuffle(pos);
  minesGrid=Array(GRID_SIZE).fill(false);
  for(let i=0;i<MINE_COUNT;i++) minesGrid[pos[i]]=true;
  renderMinesGrid(); updateMinesInfo();
  document.getElementById("mines-start-btn").disabled=true;
  document.getElementById("mines-cashout-btn").disabled=true;
  document.getElementById("mines-bet").disabled=true;
};
window.cashoutMines = async function() {
  if(!minesActive||safeRevealed<2) return;
  const mult=getMinesMultiplier(safeRevealed), win=Math.round(minesBet*mult);
  userData.balance+=win; userData.gamesPlayed++; minesActive=false;
  await saveUserData();
  toast(`Cashout ! +${win} VLX (×${mult.toFixed(2)}) 💰`,"win");
  revealAllMines(); resetMinesButtons();
};
function revealCell(idx) {
  if(!minesActive) return;
  const cells=document.querySelectorAll(".mine-cell"), cell=cells[idx];
  if(cell.classList.contains("revealed")) return;
  cell.classList.add("revealed");
  if(minesGrid[idx]) {
    cell.classList.add("mine"); cell.textContent="💣";
    minesActive=false; userData.gamesPlayed++; saveUserData();
    toast(`MINE ! Perdu ${minesBet} VLX 💥`,"lose");
    revealAllMines(); resetMinesButtons();
  } else {
    cell.classList.add("safe"); cell.textContent="✓";
    safeRevealed++; updateMinesInfo();
    if(safeRevealed>=2) document.getElementById("mines-cashout-btn").disabled=false;
    if(safeRevealed===GRID_SIZE-MINE_COUNT) {
      const mult=getMinesMultiplier(safeRevealed), win=Math.round(minesBet*mult);
      userData.balance+=win; userData.gamesPlayed++; minesActive=false;
      saveUserData(); toast(`Parfait ! +${win} VLX 🏆`,"win"); resetMinesButtons();
    }
  }
}
function updateMinesInfo() {
  const mult=getMinesMultiplier(safeRevealed);
  document.getElementById("mines-safe-count").textContent=safeRevealed;
  document.getElementById("mines-multiplier").textContent="×"+mult.toFixed(2);
  document.getElementById("mines-bet-display").textContent=minesBet+" VLX";
  document.getElementById("mines-potential").textContent=Math.round(minesBet*mult)+" VLX";
}
function renderMinesGrid() {
  const g=document.getElementById("mines-grid"); g.innerHTML="";
  for(let i=0;i<GRID_SIZE;i++){
    const c=document.createElement("div"); c.className="mine-cell"; c.textContent="?";
    c.onclick=()=>revealCell(i); g.appendChild(c);
  }
}
function revealAllMines() {
  document.querySelectorAll(".mine-cell").forEach((c,i)=>{
    if(minesGrid[i]&&!c.classList.contains("revealed")){c.classList.add("revealed","mine");c.textContent="💣";}
  });
}
function resetMinesButtons() {
  document.getElementById("mines-start-btn").disabled=false;
  document.getElementById("mines-cashout-btn").disabled=true;
  document.getElementById("mines-bet").disabled=false;
}

// ═════════════════════════════════════════════════════════════
//   COINFLIP
// ═════════════════════════════════════════════════════════════
let chosenSide=null, coinFlipping=false;
window.chooseSide = function(side) {
  if(coinFlipping) return;
  chosenSide=side;
  document.getElementById("choose-blue").classList.toggle("selected",side==="blue");
  document.getElementById("choose-red").classList.toggle("selected",side==="red");
  document.getElementById("coinflip-btn").disabled=false;
};
window.flipCoin = async function() {
  if(!chosenSide||coinFlipping) return;
  const bet=parseBet("coinflip-bet"); if(!bet) return;
  coinFlipping=true; document.getElementById("coinflip-btn").disabled=true;
  document.getElementById("coinflip-result").textContent="";
  const result=Math.random()<.5?"blue":"red";
  const coin=document.getElementById("coin"); coin.className="coin flip-"+result;
  await delay(1400);
  const won=result===chosenSide;
  userData.balance=Math.max(0,userData.balance+(won?bet:-bet)); userData.gamesPlayed++;
  await saveUserData();
  document.getElementById("coinflip-result").innerHTML=won
    ?`<span style="color:var(--green2)">Gagné ! +${bet} VLX 🎉</span>`
    :`<span style="color:var(--red2)">Perdu ${bet} VLX</span>`;
  toast(won?`Correct ! +${bet} VLX`:`Perdu ${bet} VLX`, won?"win":"lose");
  await delay(900);
  coin.className="coin"; coinFlipping=false; chosenSide=null;
  document.getElementById("choose-blue").classList.remove("selected");
  document.getElementById("choose-red").classList.remove("selected");
  document.getElementById("coinflip-btn").disabled=true;
};

// ═════════════════════════════════════════════════════════════
//   LEADERBOARD
// ═════════════════════════════════════════════════════════════
let leaderboardData=[];
function startLeaderboard() {
  const q=query(collection(db,"users"),orderBy("balance","desc"),limit(20));
  unsubLB=onSnapshot(q,snap=>{
    leaderboardData=snap.docs.map(d=>d.data());
    if(currentPage==="leaderboard") renderLeaderboard();
  });
}
function renderLeaderboard() {
  const list=document.getElementById("leaderboard-list");
  if(!leaderboardData.length){list.innerHTML='<div class="lb-loading">Aucun joueur encore.</div>';return;}
  list.innerHTML="";
  leaderboardData.forEach((u,i)=>{
    const rank=i+1, isYou=u.uid===currentUser?.uid;
    const medals=["🥇","🥈","🥉"];
    const rankEl=rank<=3?`<div class="lb-rank gold-rank">${medals[rank-1]}</div>`:`<div class="lb-rank">#${rank}</div>`;
    const e=document.createElement("div");
    e.className="lb-entry"+(rank<=3?" top"+rank:"");
    e.innerHTML=`${rankEl}<img class="lb-avatar" src="${u.avatar||''}" onerror="this.style.display='none'" alt=""><span class="lb-name">${u.name||"Joueur"}${isYou?'<span class="lb-you">VOUS</span>':''}</span><span class="lb-balance">${(u.balance||0).toLocaleString("fr-FR")} VLX</span>`;
    list.appendChild(e);
  });
}

// ── UTILS ─────────────────────────────────────────────────────
function delay(ms){return new Promise(r=>setTimeout(r,ms));}
function shuffle(arr){for(let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];}}
