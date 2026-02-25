import {
  auth, db, googleProvider,
  signInWithPopup, signOut, onAuthStateChanged,
  doc, getDoc, setDoc, updateDoc,
  collection, query, orderBy, limit, onSnapshot
} from "./firebase-config.js";

import {
  getDocs, deleteDoc, arrayUnion, arrayRemove, increment, writeBatch, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let currentUser = null;
let userData = null;
let unsubLB = null;
let unsubMe = null;
let unsubMorpion = null;
let currentPage = "login";
let pendingGameInvite = null;
let ginAutoClose = null;
let morpionGameId = null;
let morpionMySymbol = "";
let morpionOppUid = "";
let morpionBet = 0;
let morpionManches = 3;
let tombolaUnsub = null;
let tombolaTimerInterval = null;
let tombolaData = null;

// Profil cible courant (page profil joueur)
let profilTargetUid = null;
let profilTargetData = null;

// ══════════════════════════════════════════════════════════════
//  TOAST
// ══════════════════════════════════════════════════════════════
function toast(msg, type = "") {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "toast show " + type;
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.className = "toast"; }, 3000);
}

// ══════════════════════════════════════════════════════════════
//  NAVIGATION
// ══════════════════════════════════════════════════════════════
function showPage(name) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.getElementById("page-" + name).classList.add("active");
  currentPage = name;
  updateAllBalances();
}
window.showPage = showPage;
window.goToPage = function(name) { showPage(name); };

window.goToGame = function(game) {
  if (game === "leaderboard") renderLeaderboard();
  if (game === "dice") updateDiceUI();
  if (game === "tombola") initTombola();
  if (game === "joueurs") initJoueurs();
  if (game === "roulette") {
    showPage("roulette");
    setTimeout(() => {
      ballTrack = 0.88;
      ballAngle = -Math.PI / 2;
      drawRoulette(rouletteAngle);
    }, 50);
    return;
  }
  showPage(game);
};

window.goToLobby = function() {
  showPage("lobby");
  initBonus();
};

function updateAllBalances() {
  if (!userData) return;
  const bal = (userData.balance || 0).toLocaleString("fr-FR") + " VLX";
  ["dice", "mines", "coinflip", "tombola", "morpion", "roulette", "slots", "blackjack"].forEach(id => {
    const el = document.getElementById(id + "-balance");
    if (el) el.textContent = bal;
  });
  const bd = document.getElementById("balance-display");
  if (bd) bd.textContent = bal;
}

// ══════════════════════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════════════════════
document.getElementById("google-login-btn").onclick = async () => {
  try { await signInWithPopup(auth, googleProvider); }
  catch (e) { document.getElementById("login-error").textContent = "Erreur : " + e.message; }
};

document.getElementById("logout-btn").onclick = async () => {
  if (currentUser) {
    await updateDoc(doc(db, "users", currentUser.uid), { online: false });
  }
  await signOut(auth);
};

onAuthStateChanged(auth, async user => {
  if (user) {
    currentUser = user;
    await loadOrCreateUser(user);
    if (!userData) return;
    await updateDoc(doc(db, "users", user.uid), { online: true, lastSeen: Date.now() });
    document.getElementById("user-avatar").src = user.photoURL || "";
    document.getElementById("lobby-username").textContent = userData.name || user.displayName || "";
    startLeaderboard();
    listenMyDoc();
    showPage("lobby");
    initBonus();
    setInterval(() => {
      if (currentUser) updateDoc(doc(db, "users", currentUser.uid), { online: true, lastSeen: Date.now() });
    }, 30000);
  } else {
    currentUser = null; userData = null;
    if (unsubLB) { unsubLB(); unsubLB = null; }
    if (unsubMe) { unsubMe(); unsubMe = null; }
    showPage("login");
  }
});

async function loadOrCreateUser(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const u = {
      uid: user.uid, name: user.displayName || "Joueur",
      avatar: user.photoURL || "", balance: 1500, gamesPlayed: 0,
      lastBonus: 0, createdAt: Date.now(), online: true, lastSeen: Date.now()
    };
    await setDoc(ref, u); userData = u;
  } else {
    userData = snap.data();
    if (userData.banned) { toast("Votre compte a été banni.", "lose"); userData = null; await signOut(auth); }
  }
}

async function saveUserData() {
  if (!currentUser || !userData) return;
  await updateDoc(doc(db, "users", currentUser.uid), { balance: userData.balance, gamesPlayed: userData.gamesPlayed });
  updateAllBalances();
}

// ══════════════════════════════════════════════════════════════
//  ÉCOUTE MON DOCUMENT EN TEMPS RÉEL
// ══════════════════════════════════════════════════════════════
function listenMyDoc() {
  if (unsubMe) unsubMe();
  unsubMe = onSnapshot(doc(db, "users", currentUser.uid), snap => {
    if (!snap.exists()) return;
    userData = snap.data();
    updateAllBalances();
    // Détecter invite de jeu
    const inv = userData.pendingGameInvite;
    if (inv && inv.from !== currentUser.uid) {
      const age = Date.now() - inv.sentAt;
      if (age < 60000 && (!pendingGameInvite || pendingGameInvite.gameId !== inv.gameId)) showGameInviteNotif(inv);
    }
    if (userData.gameStarted && !morpionGameId) {
      const gid = userData.gameStarted;
      updateDoc(doc(db, "users", currentUser.uid), { gameStarted: null });
      getDoc(doc(db, "morpion", gid)).then(gs => {
        if (!gs.exists()) return;
        const g = gs.data();
        startMorpion(gid, g.players[0], g.players[1], g.bet, g.manches);
      });
    }
  });
}

// ══════════════════════════════════════════════════════════════
//  BET HELPERS
// ══════════════════════════════════════════════════════════════
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

// ══════════════════════════════════════════════════════════════
//  ROULETTE — 37 CASES
// ══════════════════════════════════════════════════════════════
const WHEEL_ORDER = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
function rouletteColor(n) {
  if (n === 0) return "green";
  const reds = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
  return reds.has(n) ? "red" : "black";
}
const SLOT_COUNT = 37, SLOT_ANGLE = (2 * Math.PI) / 37, TAU = 2 * Math.PI;
let rouletteAngle = 0, rouletteSpinning = false, rouletteSelectedColor = null;
let ballWheelOffset = 0, ballVisible = false, ballTrackR = 0.74;
const ROUL_COLORS = { green:{fill:"#1a5c1a",text:"#fff"}, red:{fill:"#7a0000",text:"#fff"}, black:{fill:"#1a1a1a",text:"#ddd"} };

window.selectRouletteColor = function(color) {
  rouletteSelectedColor = color;
  ["red","green","black"].forEach(c => document.getElementById("rb-"+c)?.classList.toggle("selected",c===color));
  const btn = document.getElementById("roulette-spin-btn");
  if (btn) { btn.disabled = false; btn.textContent = "🎡 LANCER"; }
};

function drawRoulette(angle) {
  const canvas = document.getElementById("roulette-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d"), W = canvas.width, H = canvas.height;
  const cx = W/2, cy = H/2, R = Math.min(cx,cy)-6, Ri = R*0.26;
  ctx.clearRect(0,0,W,H);
  ctx.save(); ctx.shadowColor="rgba(212,160,23,0.5)"; ctx.shadowBlur=28;
  ctx.beginPath(); ctx.arc(cx,cy,R+3,0,TAU); ctx.strokeStyle="#d4a017"; ctx.lineWidth=3; ctx.stroke(); ctx.restore();
  WHEEL_ORDER.forEach((num,i)=>{
    const startA=angle+i*SLOT_ANGLE-SLOT_ANGLE/2, endA=startA+SLOT_ANGLE, col=rouletteColor(num);
    ctx.beginPath(); ctx.moveTo(cx,cy); ctx.arc(cx,cy,R,startA,endA); ctx.closePath();
    ctx.fillStyle=ROUL_COLORS[col].fill; ctx.fill(); ctx.strokeStyle="#0a0a0f"; ctx.lineWidth=1.2; ctx.stroke();
    const midA=startA+SLOT_ANGLE/2, tx=cx+R*0.74*Math.cos(midA), ty=cy+R*0.74*Math.sin(midA);
    ctx.save(); ctx.translate(tx,ty); ctx.rotate(midA+Math.PI/2); ctx.fillStyle=ROUL_COLORS[col].text;
    ctx.font=`bold ${R<140?8:10}px 'DM Mono',monospace`; ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText(String(num),0,0); ctx.restore();
  });
  ctx.beginPath(); ctx.arc(cx,cy,R,0,TAU); ctx.strokeStyle="#d4a017"; ctx.lineWidth=5; ctx.stroke();
  for(let i=0;i<SLOT_COUNT;i++){const a=angle+i*SLOT_ANGLE;ctx.beginPath();ctx.moveTo(cx+(R-8)*Math.cos(a),cy+(R-8)*Math.sin(a));ctx.lineTo(cx+(R+1)*Math.cos(a),cy+(R+1)*Math.sin(a));ctx.strokeStyle="#d4a017";ctx.lineWidth=2;ctx.stroke();}
  const grad=ctx.createRadialGradient(cx,cy,0,cx,cy,Ri);
  grad.addColorStop(0,"#2a2a3a"); grad.addColorStop(1,"#0f0f18");
  ctx.beginPath(); ctx.arc(cx,cy,Ri,0,TAU); ctx.fillStyle=grad; ctx.fill(); ctx.strokeStyle="#d4a017"; ctx.lineWidth=2.5; ctx.stroke();
  ctx.fillStyle="#d4a017"; ctx.font=`bold ${R<140?13:17}px 'Playfair Display',serif`; ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.fillText("VLX",cx,cy);
  if(ballVisible){const bAngle=angle+ballWheelOffset,bR=R*ballTrackR,bx=cx+bR*Math.cos(bAngle),by=cy+bR*Math.sin(bAngle),br=R*0.048;
    ctx.save(); ctx.shadowColor="rgba(0,0,0,0.9)"; ctx.shadowBlur=12;
    const rg=ctx.createRadialGradient(bx-br*0.35,by-br*0.35,br*0.05,bx,by,br);
    rg.addColorStop(0,"#fff"); rg.addColorStop(0.5,"#ddd"); rg.addColorStop(1,"#888");
    ctx.beginPath(); ctx.arc(bx,by,br,0,TAU); ctx.fillStyle=rg; ctx.fill(); ctx.restore();}
}

function easeOutRoulette(t){return 1-Math.pow(1-t,4);}

window.spinRoulette = async function() {
  if(rouletteSpinning) return;
  if(!rouletteSelectedColor){toast("Choisis une couleur d'abord !","lose");return;}
  const bet=parseBet("roulette-bet"); if(bet===null) return;
  rouletteSpinning=true; ballVisible=false;
  document.getElementById("roulette-spin-btn").disabled=true;
  document.getElementById("roulette-result-box").style.visibility="hidden";
  const result=WHEEL_ORDER[Math.floor(Math.random()*SLOT_COUNT)], resultColor=rouletteColor(result), winIdx=WHEEL_ORDER.indexOf(result);
  const TARGET_ABS=-Math.PI/2-winIdx*SLOT_ANGLE, turns=8;
  const diff=((TARGET_ABS-rouletteAngle)%TAU+TAU)%TAU, targetAngle=rouletteAngle+diff+turns*TAU;
  const startAngle=rouletteAngle, duration=5000, startTime=performance.now();
  function animate(now){
    const t=Math.min((now-startTime)/duration,1);
    rouletteAngle=startAngle+(targetAngle-startAngle)*easeOutRoulette(t);
    drawRoulette(rouletteAngle);
    if(t<1){requestAnimationFrame(animate);}
    else{rouletteAngle=targetAngle;ballWheelOffset=-Math.PI/2-rouletteAngle;ballTrackR=0.74;ballVisible=true;drawRoulette(rouletteAngle);endSpinRoulette(result,resultColor,bet);}
  }
  requestAnimationFrame(animate);
};

async function endSpinRoulette(result,resultColor,bet){
  const won=resultColor===rouletteSelectedColor, mult=resultColor==="green"?20:2, gain=won?bet*mult-bet:-bet;
  userData.balance=Math.max(0,userData.balance+gain); userData.gamesPlayed++; await saveUserData();
  const box=document.getElementById("roulette-result-box"), numEl=document.getElementById("roulette-result-num"), lblEl=document.getElementById("roulette-result-label");
  box.style.visibility="visible"; numEl.textContent=result;
  numEl.style.color=resultColor==="green"?"#2ecc71":resultColor==="red"?"#e74c3c":"#aaa";
  if(won){lblEl.textContent=`+${bet*mult} VLX (×${mult}) 🎉`;lblEl.style.color="#27ae60";toast(`${result} ${resultColor==="green"?"🟢 VERT":resultColor==="red"?"🔴 ROUGE":"⚫ NOIR"} ! +${bet*mult} VLX 🎉`,"win");}
  else{const cn=resultColor==="green"?"🟢 VERT":resultColor==="red"?"🔴 ROUGE":"⚫ NOIR";lblEl.textContent=`${cn} — Perdu ${bet} VLX`;lblEl.style.color="#e74c3c";toast(`${result} — Perdu ${bet} VLX`,"lose");}
  rouletteSpinning=false;
  const btn=document.getElementById("roulette-spin-btn"); if(btn){btn.disabled=false;btn.textContent="🎡 LANCER";}
}

// ══════════════════════════════════════════════════════════════
//  DICE
// ══════════════════════════════════════════════════════════════
let diceTarget=50, diceDirection="under", diceRolling=false;
function diceWinChance(){return diceDirection==="under"?(diceTarget-1)/100:(100-diceTarget)/100;}
function diceMultiplier(){const c=diceWinChance();return c<=0?0:Math.round((0.98/c)*100)/100;}
function updateDiceUI(){
  document.getElementById("dice-target-display").textContent=diceTarget;
  document.getElementById("dice-mult-display").textContent="×"+diceMultiplier().toFixed(2);
  const bar=document.getElementById("dice-bar-win");
  if(diceDirection==="under"){bar.style.left="0%";bar.style.width=(diceTarget-1)+"%";bar.style.borderRadius="22px 0 0 22px";}
  else{bar.style.left=diceTarget+"%";bar.style.width=(100-diceTarget)+"%";bar.style.borderRadius="0 22px 22px 0";}
}
window.adjustTarget=d=>{diceTarget=Math.max(2,Math.min(98,diceTarget+d));updateDiceUI();};
window.setDirection=dir=>{diceDirection=dir;document.getElementById("dir-under").classList.toggle("active",dir==="under");document.getElementById("dir-over").classList.toggle("active",dir==="over");updateDiceUI();};
window.rollDice=async function(){
  if(diceRolling)return;const bet=parseBet("dice-bet");if(!bet)return;
  if(diceWinChance()<=0){toast("Zone impossible !","lose");return;}
  diceRolling=true;document.getElementById("dice-roll-btn").disabled=true;
  const result=Math.floor(Math.random()*100)+1;
  const marker=document.getElementById("dice-bar-marker");
  marker.style.display="block";marker.style.transition="none";marker.style.left="0%";
  await delay(50);marker.style.transition="left 0.9s cubic-bezier(.25,.8,.25,1)";marker.style.left=result+"%";
  await delay(1000);
  const won=diceDirection==="under"?result<diceTarget:result>diceTarget, mult=diceMultiplier();
  userData.balance=Math.max(0,userData.balance+(won?Math.round(bet*mult)-bet:-bet));userData.gamesPlayed++;await saveUserData();
  const rolledEl=document.getElementById("dice-rolled");rolledEl.textContent=result;rolledEl.className="dice-rolled "+(won?"win":"lose");
  const barWin=document.getElementById("dice-bar-win");barWin.style.background=won?"linear-gradient(90deg,var(--green),#2ecc71)":"linear-gradient(90deg,var(--red),var(--red2))";
  setTimeout(()=>{barWin.style.background="linear-gradient(90deg,var(--green),#2ecc71)";},1500);
  toast(won?`Gagné ! +${Math.round(bet*mult)} VLX (×${mult.toFixed(2)}) 🎉`:`Perdu ${bet} VLX — résultat : ${result}`,won?"win":"lose");
  await delay(400);diceRolling=false;document.getElementById("dice-roll-btn").disabled=false;
};

// ══════════════════════════════════════════════════════════════
//  MINES
// ══════════════════════════════════════════════════════════════
const GRID_SIZE=25, MINE_COUNT=5;
let minesActive=false, minesBet=0, minesGrid=[], safeRevealed=0;
function getMinesMultiplier(safe){const t=[1,1.18,1.40,1.68,2.05,2.55,3.25,4.25,5.70,8.0,12,19,33,65,156,500,2000,10000,50000,250000];return t[Math.min(safe,t.length-1)];}
window.startMines=function(){const bet=parseBet("mines-bet");if(!bet)return;minesBet=bet;safeRevealed=0;minesActive=true;userData.balance-=bet;updateAllBalances();const pos=Array.from({length:GRID_SIZE},(_,i)=>i);shuffle(pos);minesGrid=Array(GRID_SIZE).fill(false);for(let i=0;i<MINE_COUNT;i++)minesGrid[pos[i]]=true;renderMinesGrid();updateMinesInfo();document.getElementById("mines-start-btn").disabled=true;document.getElementById("mines-cashout-btn").disabled=true;document.getElementById("mines-bet").disabled=true;};
window.cashoutMines=async function(){if(!minesActive||safeRevealed<2)return;const mult=getMinesMultiplier(safeRevealed),win=Math.round(minesBet*mult);userData.balance+=win;userData.gamesPlayed++;minesActive=false;await saveUserData();toast(`Cashout ! +${win} VLX (×${mult.toFixed(2)}) 💰`,"win");revealAllMines();resetMinesButtons();};
function revealCell(idx){if(!minesActive)return;const cells=document.querySelectorAll(".mine-cell"),cell=cells[idx];if(cell.classList.contains("revealed"))return;cell.classList.add("revealed");if(minesGrid[idx]){cell.classList.add("mine");cell.textContent="💣";minesActive=false;userData.gamesPlayed++;saveUserData();toast(`MINE ! Perdu ${minesBet} VLX 💥`,"lose");revealAllMines();resetMinesButtons();}else{cell.classList.add("safe");cell.textContent="✓";safeRevealed++;updateMinesInfo();if(safeRevealed>=2)document.getElementById("mines-cashout-btn").disabled=false;if(safeRevealed===GRID_SIZE-MINE_COUNT){const mult=getMinesMultiplier(safeRevealed),win=Math.round(minesBet*mult);userData.balance+=win;userData.gamesPlayed++;minesActive=false;saveUserData();toast(`Parfait ! +${win} VLX 🏆`,"win");resetMinesButtons();}}}
function updateMinesInfo(){const mult=getMinesMultiplier(safeRevealed);document.getElementById("mines-safe-count").textContent=safeRevealed;document.getElementById("mines-multiplier").textContent="×"+mult.toFixed(2);document.getElementById("mines-bet-display").textContent=minesBet+" VLX";document.getElementById("mines-potential").textContent=Math.round(minesBet*mult)+" VLX";}
function renderMinesGrid(){const g=document.getElementById("mines-grid");g.innerHTML="";for(let i=0;i<GRID_SIZE;i++){const c=document.createElement("div");c.className="mine-cell";c.textContent="?";c.onclick=()=>revealCell(i);g.appendChild(c);}}
function revealAllMines(){document.querySelectorAll(".mine-cell").forEach((c,i)=>{if(minesGrid[i]&&!c.classList.contains("revealed")){c.classList.add("revealed","mine");c.textContent="💣";}});}
function resetMinesButtons(){document.getElementById("mines-start-btn").disabled=false;document.getElementById("mines-cashout-btn").disabled=true;document.getElementById("mines-bet").disabled=false;}

// ══════════════════════════════════════════════════════════════
//  COINFLIP
// ══════════════════════════════════════════════════════════════
let chosenSide=null, coinFlipping=false;
window.chooseSide=function(side){if(coinFlipping)return;chosenSide=side;document.getElementById("choose-blue").classList.toggle("selected",side==="blue");document.getElementById("choose-red").classList.toggle("selected",side==="red");document.getElementById("coinflip-btn").disabled=false;};
window.flipCoin=async function(){if(!chosenSide||coinFlipping)return;const bet=parseBet("coinflip-bet");if(!bet)return;coinFlipping=true;document.getElementById("coinflip-btn").disabled=true;document.getElementById("coinflip-result").textContent="";const result=Math.random()<.5?"blue":"red";const coin=document.getElementById("coin");coin.className="coin flip-"+result;await delay(1400);const won=result===chosenSide;userData.balance=Math.max(0,userData.balance+(won?bet:-bet));userData.gamesPlayed++;await saveUserData();document.getElementById("coinflip-result").innerHTML=won?`<span style="color:var(--green2)">Gagné ! +${bet} VLX 🎉</span>`:`<span style="color:var(--red2)">Perdu ${bet} VLX</span>`;toast(won?`Correct ! +${bet} VLX`:`Perdu ${bet} VLX`,won?"win":"lose");await delay(900);coin.className="coin";coinFlipping=false;chosenSide=null;document.getElementById("choose-blue").classList.remove("selected");document.getElementById("choose-red").classList.remove("selected");document.getElementById("coinflip-btn").disabled=true;};

// ══════════════════════════════════════════════════════════════
//  MACHINE À SOUS (SLOTS)
// ══════════════════════════════════════════════════════════════
const SLOT_SYMBOLS = ["🍒","🍋","🍊","🔔","💎","7️⃣"];
let slotsSpinning = false;

function initSlots() {
  for (let i = 0; i < 3; i++) {
    const strip = document.getElementById("strip-" + i);
    if (!strip) return;
    strip.innerHTML = "";
    // Remplir chaque reel avec des symboles
    for (let j = 0; j < 20; j++) {
      const div = document.createElement("div");
      div.className = "reel-symbol";
      div.textContent = SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)];
      strip.appendChild(div);
    }
    // Position initiale : montrer symbol[0]
    strip.style.transform = "translateY(0px)";
  }
}

window.spinSlots = async function() {
  if (slotsSpinning) return;
  const bet = parseBet("slots-bet"); if (!bet) return;
  slotsSpinning = true;
  const btn = document.getElementById("slots-spin-btn");
  btn.disabled = true;
  document.getElementById("slots-result-msg").textContent = "";
  document.getElementById("slots-result-msg").className = "slots-result-msg";

  userData.balance -= bet;
  updateAllBalances();

  // Choisir le résultat final pour chaque reel
  const results = [
    Math.floor(Math.random() * SLOT_SYMBOLS.length),
    Math.floor(Math.random() * SLOT_SYMBOLS.length),
    Math.floor(Math.random() * SLOT_SYMBOLS.length)
  ];

  // Animer chaque reel avec décalage
  const animPromises = results.map((finalIdx, reelIdx) => {
    return new Promise(resolve => {
      const strip = document.getElementById("strip-" + reelIdx);
      const symbolHeight = 90;
      const totalSymbols = 20;

      // Regénérer le strip avec le résultat final à la position centrale
      strip.innerHTML = "";
      const symbols = [];
      for (let j = 0; j < totalSymbols; j++) {
        symbols.push(SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)]);
      }
      // Forcer le résultat à la position d'affichage (index 10)
      symbols[10] = SLOT_SYMBOLS[finalIdx];
      symbols.forEach(s => {
        const div = document.createElement("div");
        div.className = "reel-symbol";
        div.textContent = s;
        strip.appendChild(div);
      });

      // Partir de 0, animer jusqu'à la position cible
      strip.style.transition = "none";
      strip.style.transform = "translateY(0px)";

      const targetY = -(10 * symbolHeight); // centrer sur index 10
      const spinDuration = 800 + reelIdx * 400; // décalage progressif

      setTimeout(() => {
        strip.style.transition = `transform ${spinDuration}ms cubic-bezier(.17,.67,.35,1.0)`;
        strip.style.transform = `translateY(${targetY}px)`;
        setTimeout(resolve, spinDuration + 50);
      }, 50);
    });
  });

  await Promise.all(animPromises);

  // Calculer résultat
  const finalSymbols = results.map(i => SLOT_SYMBOLS[i]);
  const counts = {};
  finalSymbols.forEach(s => { counts[s] = (counts[s] || 0) + 1; });
  const maxCount = Math.max(...Object.values(counts));

  const msgEl = document.getElementById("slots-result-msg");
  let gain = 0;

  if (maxCount === 3) {
    gain = Math.round(bet * 2.5);
    msgEl.textContent = `${finalSymbols[0]} ${finalSymbols[1]} ${finalSymbols[2]} — JACKPOT ! +${gain} VLX 🎉`;
    msgEl.className = "slots-result-msg win3";
    toast(`JACKPOT 🎰 ! +${gain} VLX (×2.5) 🎉`, "win");
  } else if (maxCount === 2) {
    gain = Math.round(bet * 1.5);
    msgEl.textContent = `${finalSymbols[0]} ${finalSymbols[1]} ${finalSymbols[2]} — +${gain} VLX (×1.5)`;
    msgEl.className = "slots-result-msg win2";
    toast(`Deux pareils ! +${gain} VLX (×1.5)`, "win");
  } else {
    msgEl.textContent = `${finalSymbols[0]} ${finalSymbols[1]} ${finalSymbols[2]} — Pas de chance...`;
    msgEl.className = "slots-result-msg lose";
    toast(`Perdu ${bet} VLX`, "lose");
  }

  userData.balance += gain;
  userData.gamesPlayed++;
  await saveUserData();

  slotsSpinning = false;
  btn.disabled = false;
};

// ══════════════════════════════════════════════════════════════
//  BLACKJACK
// ══════════════════════════════════════════════════════════════
const BJ_SUITS = ["♠","♥","♦","♣"];
const BJ_VALUES = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
let bjDeck = [], bjPlayerHand = [], bjDealerHand = [], bjBet = 0, bjPlaying = false;

function bjCreateDeck() {
  const deck = [];
  for (const suit of BJ_SUITS) for (const val of BJ_VALUES) deck.push({ suit, val });
  return shuffle2(deck);
}

function shuffle2(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i+1)); [a[i],a[j]] = [a[j],a[i]]; }
  return a;
}

function bjCardValue(card) {
  if (["J","Q","K"].includes(card.val)) return 10;
  if (card.val === "A") return 11;
  return parseInt(card.val);
}

function bjHandValue(hand) {
  let total = 0, aces = 0;
  for (const c of hand) {
    total += bjCardValue(c);
    if (c.val === "A") aces++;
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

function bjIsRed(suit) { return suit === "♥" || suit === "♦"; }

function bjRenderCard(card, hidden = false) {
  const div = document.createElement("div");
  if (hidden) { div.className = "bj-card bj-card-back"; return div; }
  div.className = "bj-card " + (bjIsRed(card.suit) ? "red" : "black");
  div.innerHTML = `
    <div>
      <div class="bj-card-val">${card.val}</div>
      <div class="bj-card-suit">${card.suit}</div>
    </div>
    <div class="bj-card-center">${card.suit}</div>
    <div style="transform:rotate(180deg)">
      <div class="bj-card-val">${card.val}</div>
      <div class="bj-card-suit">${card.suit}</div>
    </div>`;
  return div;
}

function bjRenderHands(hideDealer = true) {
  const pc = document.getElementById("bj-player-cards");
  const dc = document.getElementById("bj-dealer-cards");
  if (!pc || !dc) return;
  pc.innerHTML = ""; dc.innerHTML = "";
  bjPlayerHand.forEach(c => pc.appendChild(bjRenderCard(c)));
  bjDealerHand.forEach((c, i) => dc.appendChild(bjRenderCard(c, hideDealer && i === 1)));
  document.getElementById("bj-player-score").textContent = bjHandValue(bjPlayerHand);
  document.getElementById("bj-dealer-score").textContent = hideDealer
    ? bjCardValue(bjDealerHand[0])
    : bjHandValue(bjDealerHand);
}

window.bjDeal = async function() {
  if (bjPlaying) return;
  const bet = parseBet("bj-bet"); if (!bet) return;
  bjBet = bet;
  userData.balance -= bet;
  updateAllBalances();
  bjDeck = bjCreateDeck();
  bjPlayerHand = [bjDeck.pop(), bjDeck.pop()];
  bjDealerHand = [bjDeck.pop(), bjDeck.pop()];
  bjPlaying = true;

  document.getElementById("bj-deal-btn").style.display = "none";
  document.getElementById("bj-actions").style.display = "flex";
  document.getElementById("bj-double-btn").disabled = false;

  bjRenderHands(true);

  const pScore = bjHandValue(bjPlayerHand);
  const status = document.getElementById("bj-status");
  status.className = "bj-status playing";

  if (pScore === 21) {
    status.textContent = "Blackjack ! 🎉";
    await delay(400);
    bjRevealAndFinish();
    return;
  }
  status.textContent = "Votre tour — Tirer ou Rester ?";
};

window.bjHit = async function() {
  if (!bjPlaying) return;
  bjPlayerHand.push(bjDeck.pop());
  bjRenderHands(true);
  document.getElementById("bj-double-btn").disabled = true;
  const score = bjHandValue(bjPlayerHand);
  if (score > 21) {
    document.getElementById("bj-status").textContent = "Bust ! Vous avez dépassé 21.";
    document.getElementById("bj-status").className = "bj-status lose";
    bjFinish("lose");
  } else if (score === 21) {
    await bjRevealAndFinish();
  }
};

window.bjStand = async function() {
  if (!bjPlaying) return;
  await bjRevealAndFinish();
};

window.bjDouble = async function() {
  if (!bjPlaying) return;
  if (bjBet > userData.balance) { toast("Solde insuffisant pour doubler !", "lose"); return; }
  userData.balance -= bjBet;
  bjBet *= 2;
  updateAllBalances();
  bjPlayerHand.push(bjDeck.pop());
  bjRenderHands(true);
  document.getElementById("bj-double-btn").disabled = true;
  const score = bjHandValue(bjPlayerHand);
  if (score > 21) {
    document.getElementById("bj-status").textContent = `Bust ! Perdu ${bjBet} VLX`;
    document.getElementById("bj-status").className = "bj-status lose";
    bjFinish("lose");
  } else {
    await bjRevealAndFinish();
  }
};

async function bjRevealAndFinish() {
  // Dealer joue
  bjRenderHands(false);
  await delay(600);
  while (bjHandValue(bjDealerHand) < 17) {
    bjDealerHand.push(bjDeck.pop());
    bjRenderHands(false);
    await delay(500);
  }
  const pScore = bjHandValue(bjPlayerHand);
  const dScore = bjHandValue(bjDealerHand);
  let outcome;
  if (pScore > 21) outcome = "lose";
  else if (dScore > 21) outcome = "win";
  else if (pScore > dScore) outcome = "win";
  else if (pScore === dScore) outcome = "push";
  else outcome = "lose";
  bjFinish(outcome);
}

async function bjFinish(outcome) {
  bjPlaying = false;
  document.getElementById("bj-actions").style.display = "none";
  document.getElementById("bj-deal-btn").style.display = "";
  const status = document.getElementById("bj-status");
  bjRenderHands(false);

  if (outcome === "win") {
    const pScore = bjHandValue(bjPlayerHand);
    const isNaturalBJ = pScore === 21 && bjPlayerHand.length === 2;
    const mult = isNaturalBJ ? 2.5 : 2;
    const gain = Math.round(bjBet * mult);
    userData.balance += gain;
    status.textContent = `Gagné ! +${gain} VLX ${isNaturalBJ ? "🃏 BLACKJACK !" : "🎉"}`;
    status.className = "bj-status win";
    toast(`Blackjack : +${gain} VLX 🎉`, "win");
  } else if (outcome === "push") {
    userData.balance += bjBet;
    status.textContent = `Égalité — mise remboursée (${bjBet} VLX)`;
    status.className = "bj-status push";
    toast("Égalité — mise remboursée", "");
  } else {
    status.textContent = `Perdu ${bjBet} VLX — Dealer : ${bjHandValue(bjDealerHand)}`;
    status.className = "bj-status lose";
    toast(`Perdu ${bjBet} VLX`, "lose");
  }
  userData.gamesPlayed++;
  await saveUserData();
}

// ══════════════════════════════════════════════════════════════
//  LEADERBOARD
// ══════════════════════════════════════════════════════════════
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
  if (!leaderboardData.length) { list.innerHTML = '<div class="lb-loading">Aucun joueur encore.</div>'; return; }
  list.innerHTML = "";
  leaderboardData.forEach((u, i) => {
    const rank = i + 1, isYou = u.uid === currentUser?.uid;
    const medals = ["🥇","🥈","🥉"];
    const rankEl = rank <= 3 ? `<div class="lb-rank gold-rank">${medals[rank-1]}</div>` : `<div class="lb-rank">#${rank}</div>`;
    const isOnline = u.online === true && (Date.now() - (u.lastSeen||0)) < 60000;
    const onlineDot = `<span class="online-dot ${isOnline?'online':'offline'}"></span>`;
    // Bouton voir profil (pas pour soi-même)
    const profilBtn = !isYou ? `<button class="btn-view-profil" onclick="openProfil('${u.uid}')">Profil</button>` : '';
    const e = document.createElement("div");
    e.className = "lb-entry" + (rank<=3?" top"+rank:"");
    e.innerHTML = `${rankEl}<div class="lb-avatar-wrap"><img class="lb-avatar" src="${u.avatar||''}" onerror="this.style.display='none'" alt="">${onlineDot}</div><span class="lb-name">${u.name||"Joueur"}${isYou?'<span class="lb-you">VOUS</span>':''}</span><span class="lb-balance">${(u.balance||0).toLocaleString("fr-FR")} VLX</span>${profilBtn}`;
    list.appendChild(e);
  });
}

// ══════════════════════════════════════════════════════════════
//  PAGE JOUEURS — RECHERCHE
// ══════════════════════════════════════════════════════════════
function initJoueurs() {
  showPage("joueurs");
  document.getElementById("player-search-input").value = "";
  document.getElementById("players-list").innerHTML = '<div class="lb-loading">Tape un nom pour chercher un joueur.</div>';
}

window.searchPlayers = async function() {
  const input = document.getElementById("player-search-input").value.trim().toLowerCase();
  const list = document.getElementById("players-list");
  if (!input || input.length < 2) {
    list.innerHTML = '<div class="lb-loading">Tape au moins 2 caractères.</div>';
    return;
  }
  list.innerHTML = '<div class="lb-loading">Recherche...</div>';
  // Récupère tous les users et filtre côté client (Firestore ne supporte pas ILIKE)
  try {
    const snap = await getDocs(collection(db, "users"));
    const results = [];
    snap.forEach(d => {
      const u = d.data();
      if (u.uid === currentUser.uid) return;
      if ((u.name || "").toLowerCase().includes(input)) results.push(u);
    });
    if (!results.length) { list.innerHTML = '<div class="lb-loading">Aucun joueur trouvé.</div>'; return; }
    list.innerHTML = "";
    results.slice(0, 20).forEach(u => {
      const isOnline = u.online === true && (Date.now() - (u.lastSeen||0)) < 60000;
      const e = document.createElement("div");
      e.className = "player-entry";
      e.innerHTML = `
        <div class="lb-avatar-wrap" style="flex-shrink:0;width:40px;height:40px;">
          <img class="lb-avatar" src="${u.avatar||''}" onerror="this.style.display='none'" alt="" style="width:40px;height:40px;">
          <span class="online-dot ${isOnline?'online':'offline'}"></span>
        </div>
        <div class="player-entry-info">
          <div class="player-entry-name">${u.name||"Joueur"}</div>
          <div class="player-entry-balance">${(u.balance||0).toLocaleString("fr-FR")} VLX</div>
        </div>
        <span style="color:var(--text2);font-size:.85rem">${isOnline?"🟢 En ligne":"⚫ Hors ligne"}</span>
      `;
      e.onclick = () => openProfil(u.uid);
      list.appendChild(e);
    });
  } catch(err) {
    list.innerHTML = '<div class="lb-loading">Erreur de recherche.</div>';
  }
};

// ══════════════════════════════════════════════════════════════
//  PAGE PROFIL JOUEUR
// ══════════════════════════════════════════════════════════════
window.openProfil = async function(uid) {
  profilTargetUid = uid;
  showPage("profil");
  document.getElementById("profil-name").textContent = "Chargement...";
  document.getElementById("profil-balance").textContent = "";
  document.getElementById("profil-status").textContent = "";
  document.getElementById("profil-avatar").src = "";

  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) { toast("Joueur introuvable", "lose"); goToPage("joueurs"); return; }
  profilTargetData = snap.data();
  const u = profilTargetData;
  const isOnline = u.online === true && (Date.now() - (u.lastSeen||0)) < 60000;

  document.getElementById("profil-avatar").src = u.avatar || "";
  document.getElementById("profil-name").textContent = u.name || "Joueur";
  document.getElementById("profil-balance").textContent = (u.balance||0).toLocaleString("fr-FR") + " VLX";
  document.getElementById("profil-status").textContent = isOnline ? "🟢 En ligne" : "⚫ Hors ligne";
  const dot = document.getElementById("profil-online-dot");
  dot.className = "online-dot " + (isOnline ? "online" : "offline");
  // Reset champs
  document.getElementById("send-vlx-amount").value = 100;
  document.getElementById("defi-bet-amount").value = 100;
};

// ── Envoyer VLX ──
window.sendVLX = async function() {
  if (!profilTargetUid || !profilTargetData) return;
  const amount = parseInt(document.getElementById("send-vlx-amount").value);
  if (!amount || amount < 1) { toast("Montant invalide", "lose"); return; }
  if (amount > userData.balance) { toast("Solde insuffisant !", "lose"); return; }
  const confirmed = confirm(`Envoyer ${amount} VLX à ${profilTargetData.name} ?`);
  if (!confirmed) return;
  userData.balance -= amount;
  await updateDoc(doc(db, "users", currentUser.uid), { balance: userData.balance });
  await updateDoc(doc(db, "users", profilTargetUid), { balance: increment(amount) });
  updateAllBalances();
  toast(`💸 ${amount} VLX envoyés à ${profilTargetData.name} !`, "win");
};

// ── Défi Morpion depuis profil ──
window.sendDefiFromProfil = async function() {
  if (!profilTargetUid || !profilTargetData) return;
  const bet = parseInt(document.getElementById("defi-bet-amount").value);
  if (!bet || bet < 10) { toast("Mise minimum 10 VLX", "lose"); return; }
  if (bet > userData.balance) { toast("Solde insuffisant !", "lose"); return; }
  // Vérifier que la cible est en ligne
  const snap = await getDoc(doc(db, "users", profilTargetUid));
  if (!snap.exists()) { toast("Joueur introuvable", "lose"); return; }
  const target = snap.data();
  const isOnline = target.online === true && (Date.now() - (target.lastSeen||0)) < 60000;
  if (!isOnline) { toast("Ce joueur est hors ligne !", "lose"); return; }

  const gameId = `morpion_${currentUser.uid}_${Date.now()}`;
  await updateDoc(doc(db, "users", profilTargetUid), {
    pendingGameInvite: {
      gameId, from: currentUser.uid,
      fromName: userData.name || "Joueur",
      manches: 3, bet, sentAt: Date.now()
    }
  });
  toast(`⚔️ Défi envoyé à ${profilTargetData.name} !`, "win");
};

// ══════════════════════════════════════════════════════════════
//  BONUS
// ══════════════════════════════════════════════════════════════
const BONUS_AMOUNT=50, BONUS_COOLDOWN=5*60*1000;
let bonusInterval=null;
function initBonus(){clearInterval(bonusInterval);updateBonusUI();bonusInterval=setInterval(updateBonusUI,1000);}
function timeUntilNextBonus(){return Math.max(0,(userData?.lastBonus||0)+BONUS_COOLDOWN-Date.now());}
function updateBonusUI(){const card=document.getElementById("bonus-card");const label=document.getElementById("bonus-label");const timerEl=document.getElementById("bonus-timer");if(!card)return;const remaining=timeUntilNextBonus();if(remaining<=0){card.classList.add("ready");card.classList.remove("claimed");label.style.display="";label.textContent="RÉCLAMER →";timerEl.style.display="none";}else{card.classList.remove("ready");card.classList.add("claimed");label.style.display="none";timerEl.style.display="";const m=Math.floor(remaining/60000),s=Math.floor((remaining%60000)/1000);timerEl.textContent=`${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;}}
window.claimBonus=async function(){if(timeUntilNextBonus()>0||!currentUser||!userData)return;userData.balance+=BONUS_AMOUNT;userData.lastBonus=Date.now();await updateDoc(doc(db,"users",currentUser.uid),{balance:userData.balance,lastBonus:userData.lastBonus});updateAllBalances();updateBonusUI();toast(`+${BONUS_AMOUNT} VLX réclamés ! 🎁`,"win");};
const lobbyObserver=new MutationObserver(()=>{if(document.getElementById("page-lobby")?.classList.contains("active"))initBonus();});
lobbyObserver.observe(document.getElementById("page-lobby"),{attributes:true,attributeFilter:["class"]});

// ══════════════════════════════════════════════════════════════
//  TOMBOLA
// ══════════════════════════════════════════════════════════════
const TICKET_PRICE=50;
function initTombola(){if(tombolaUnsub)tombolaUnsub();tombolaUnsub=onSnapshot(doc(db,"tombola","current"),snap=>{if(!snap.exists()){createNewTombola();return;}tombolaData=snap.data();renderTombola();startTombolaTimer();});const qtyInput=document.getElementById("tombola-qty");if(qtyInput){qtyInput.oninput=()=>{const n=Math.max(1,parseInt(qtyInput.value)||1);const el=document.getElementById("tombola-total-cost");if(el)el.textContent=n*TICKET_PRICE;};}}
async function createNewTombola(){await setDoc(doc(db,"tombola","current"),{drawAt:Date.now()+24*60*60*1000,tickets:[],totalPot:0,createdAt:Date.now()});}
function startTombolaTimer(){clearInterval(tombolaTimerInterval);tombolaTimerInterval=setInterval(async()=>{if(!tombolaData)return;const remaining=tombolaData.drawAt-Date.now();const el=document.getElementById("tombola-timer");if(remaining<=0){clearInterval(tombolaTimerInterval);if(el)el.textContent="Tirage en cours...";await runTombolaDraw();}else{const h=Math.floor(remaining/3600000);const m=Math.floor((remaining%3600000)/60000);const s=Math.floor((remaining%60000)/1000);if(el)el.textContent=`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;} },1000);}
async function runTombolaDraw(){if(!tombolaData)return;const tickets=tombolaData.tickets||[];if(tickets.length===0){await setDoc(doc(db,"tombola","current"),{drawAt:Date.now()+24*60*60*1000,tickets:[],totalPot:0,createdAt:Date.now()});return;}const winner=tickets[Math.floor(Math.random()*tickets.length)];const pot=tombolaData.totalPot||0;await updateDoc(doc(db,"users",winner.uid),{balance:increment(pot)});await setDoc(doc(db,"tombola","current"),{drawAt:Date.now()+24*60*60*1000,tickets:[],totalPot:0,createdAt:Date.now()});if(winner.uid===currentUser?.uid){userData.balance+=pot;updateAllBalances();toast(`🎉 Vous avez gagné la tombola ! +${pot} VLX`,"win");}}
function renderTombola(){if(!tombolaData)return;const pot=tombolaData.totalPot||0;const tickets=tombolaData.tickets||[];const potEl=document.getElementById("tombola-pot");if(potEl)potEl.textContent=pot.toLocaleString("fr-FR")+" VLX";const myTickets=tickets.filter(t=>t.uid===currentUser?.uid).length;const myEl=document.getElementById("tombola-my-tickets");if(myEl)myEl.innerHTML=`Vous avez <strong>${myTickets}</strong> ticket(s) — ${tickets.length} au total`;const partEl=document.getElementById("tombola-participants");if(!partEl)return;const counts={};tickets.forEach(t=>{if(!counts[t.uid])counts[t.uid]={name:t.name,count:0};counts[t.uid].count++;});const sorted=Object.entries(counts).sort((a,b)=>b[1].count-a[1].count).slice(0,10);partEl.innerHTML=sorted.length?`<div class="tombola-part-title">Participants</div>`+sorted.map(([uid,d])=>`<div class="tombola-part-row">${uid===currentUser?.uid?'<strong>Vous</strong>':d.name} <span>${d.count} ticket(s) — ${Math.round(d.count/tickets.length*100)}%</span></div>`).join(""):"";}
window.buyTombolaTickets=async function(){
  if(!tombolaData||!currentUser)return;
  const qty=Math.max(1,parseInt(document.getElementById("tombola-qty").value)||1);
  const cost=qty*TICKET_PRICE;
  if(cost>userData.balance){toast("Solde insuffisant !","lose");return;}
  userData.balance-=cost;
  await updateDoc(doc(db,"users",currentUser.uid),{balance:userData.balance});
  const newTickets=Array.from({length:qty},(_,i)=>({uid:currentUser.uid,name:userData.name||"Joueur",_id:`${currentUser.uid}_${Date.now()}_${i}`}));
  await updateDoc(doc(db,"tombola","current"),{tickets:arrayUnion(...newTickets),totalPot:increment(cost)});
  updateAllBalances();
  toast(`🎟️ ${qty} ticket(s) achetés pour ${cost} VLX !`,"win");
};

// ══════════════════════════════════════════════════════════════
//  MORPION — INVITATIONS
// ══════════════════════════════════════════════════════════════
function showGameInviteNotif(inv) {
  pendingGameInvite = inv;
  const notif = document.getElementById("game-invite-notif");
  document.getElementById("gin-text").textContent = `🎮 ${inv.fromName} vous défie au Morpion ! ${inv.manches} manches — ${inv.bet} VLX`;
  notif.style.display = "block";
  const fill = document.getElementById("gin-timer-fill");
  fill.style.transition = "none"; fill.style.width = "100%";
  clearTimeout(ginAutoClose);
  setTimeout(() => { fill.style.transition = "width 5s linear"; fill.style.width = "0%"; }, 50);
  ginAutoClose = setTimeout(() => { notif.style.display = "none"; }, 5000);
}

window.acceptGameInvite = async function() {
  if (!pendingGameInvite) return;
  clearTimeout(ginAutoClose);
  document.getElementById("game-invite-notif").style.display = "none";
  const inv = pendingGameInvite; pendingGameInvite = null;
  if (inv.bet > userData.balance) { toast("Pas assez de VLX pour accepter !", "lose"); return; }
  const gameRef = doc(db, "morpion", inv.gameId);
  await setDoc(gameRef, {
    players: [inv.from, currentUser.uid],
    names: { [inv.from]: inv.fromName, [currentUser.uid]: userData.name || "Joueur" },
    manches: inv.manches, bet: inv.bet,
    scores: { [inv.from]: 0, [currentUser.uid]: 0 },
    board: Array(9).fill(""), currentTurn: inv.from,
    status: "playing", manche: 1, lastActivity: Date.now()
  });
  await updateDoc(doc(db, "users", currentUser.uid), { pendingGameInvite: null });
  await updateDoc(doc(db, "users", inv.from), { pendingGameInvite: null, gameStarted: inv.gameId });
  startMorpion(inv.gameId, inv.from, currentUser.uid, inv.bet, inv.manches);
};

window.refuseGameInvite = async function() {
  clearTimeout(ginAutoClose);
  document.getElementById("game-invite-notif").style.display = "none";
  if (pendingGameInvite) { await updateDoc(doc(db, "users", currentUser.uid), { pendingGameInvite: null }); pendingGameInvite = null; }
};

// ══════════════════════════════════════════════════════════════
//  MORPION — JEU
// ══════════════════════════════════════════════════════════════
function startMorpion(gameId,p1uid,p2uid,bet,manches){morpionGameId=gameId;morpionMySymbol=currentUser.uid===p1uid?"X":"O";morpionOppUid=currentUser.uid===p1uid?p2uid:p1uid;morpionBet=bet;morpionManches=manches;showPage("morpion");document.getElementById("morpion-scores").style.display="flex";userData.balance-=bet;updateDoc(doc(db,"users",currentUser.uid),{balance:userData.balance});updateAllBalances();if(unsubMorpion)unsubMorpion();unsubMorpion=onSnapshot(doc(db,"morpion",gameId),snap=>{if(!snap.exists())return;const g=snap.data();renderMorpionBoard(g);updateMorpionStatus(g);if(g.status==="finished")finishMorpion(g);else if(g.status==="manche_end"){setTimeout(async()=>{await updateDoc(doc(db,"morpion",gameId),{board:Array(9).fill(""),status:"playing",currentTurn:g.players[0]});},1800);}});}
function renderMorpionBoard(g){const cells=document.querySelectorAll(".morpion-cell");cells.forEach((c,i)=>{c.textContent=g.board[i]||"";c.className="morpion-cell"+(g.board[i]==="X"?" x":g.board[i]==="O"?" o":"");});const me=g.scores[currentUser.uid]||0;const opp=g.scores[morpionOppUid]||0;const sMe=document.getElementById("morpion-score-me"),sOpp=document.getElementById("morpion-score-opp");if(sMe)sMe.textContent=me;if(sOpp)sOpp.textContent=opp;const info=document.getElementById("morpion-info");if(info)info.textContent=`Manche ${g.manche}/${morpionManches} — Vous: ${morpionMySymbol}`;}
function updateMorpionStatus(g){const st=document.getElementById("morpion-status");if(!st)return;if(g.status==="playing"){if(g.currentTurn===currentUser.uid){st.textContent="🟢 À votre tour !";st.className="morpion-status your-turn";}else{st.textContent="⏳ Tour adverse...";st.className="morpion-status opp-turn";}}else if(g.status==="manche_end"){const winner=g.mancheWinner;if(winner===currentUser.uid){st.textContent="✅ Manche gagnée !";st.className="morpion-status your-turn";}else if(!winner){st.textContent="🤝 Manche nulle !";st.className="morpion-status";}else{st.textContent="❌ Manche perdue.";st.className="morpion-status opp-turn";}}}
window.playMorpion=async function(idx){if(!morpionGameId)return;const snap=await getDoc(doc(db,"morpion",morpionGameId));if(!snap.exists())return;const g=snap.data();if(g.status!=="playing"||g.currentTurn!==currentUser.uid||g.board[idx]!=="")return;const newBoard=[...g.board];newBoard[idx]=morpionMySymbol;const winnerSymbol=checkMorpionWinner(newBoard);const isFull=newBoard.every(c=>c!=="");let updates={board:newBoard,currentTurn:morpionOppUid,lastActivity:Date.now()};if(winnerSymbol||isFull){const newScores={...g.scores};let mancheWinner=null;if(winnerSymbol){newScores[currentUser.uid]=(newScores[currentUser.uid]||0)+1;mancheWinner=currentUser.uid;}const toWin=Math.ceil(g.manches/2);const gameOver=newScores[currentUser.uid]>=toWin||newScores[morpionOppUid]>=toWin||g.manche>=g.manches;updates={...updates,scores:newScores,mancheWinner,manche:g.manche+1,status:gameOver?"finished":"manche_end"};}await updateDoc(doc(db,"morpion",morpionGameId),updates);};
function checkMorpionWinner(board){const lines=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];for(const[a,b,c]of lines){if(board[a]&&board[a]===board[b]&&board[a]===board[c])return board[a];}return null;}
async function finishMorpion(g){if(unsubMorpion){unsubMorpion();unsubMorpion=null;}const myScore=g.scores[currentUser.uid]||0;const oppScore=g.scores[morpionOppUid]||0;const prize=morpionBet*2;const st=document.getElementById("morpion-status");if(myScore>oppScore){if(st){st.textContent=`🏆 Victoire ! +${prize} VLX`;st.className="morpion-status win";}userData.balance+=prize;await updateDoc(doc(db,"users",currentUser.uid),{balance:userData.balance});updateAllBalances();toast(`🏆 Victoire au Morpion ! +${prize} VLX`,"win");}else if(myScore===oppScore){if(st){st.textContent="🤝 Égalité — mise remboursée";st.className="morpion-status";}userData.balance+=morpionBet;await updateDoc(doc(db,"users",currentUser.uid),{balance:userData.balance});updateAllBalances();toast("Égalité ! Mise remboursée.","");}else{if(st){st.textContent=`💀 Défaite — perdu ${morpionBet} VLX`;st.className="morpion-status lose";}toast(`Défaite au Morpion. -${morpionBet} VLX`,"lose");}morpionGameId=null;setTimeout(()=>{if(currentPage==="morpion")goToLobby();},3000);}
window.quitMorpion=async function(){if(morpionGameId){const snap=await getDoc(doc(db,"morpion",morpionGameId));if(snap.exists()&&snap.data().status==="playing"){await updateDoc(doc(db,"morpion",morpionGameId),{status:"finished",forfeit:currentUser.uid,scores:{...snap.data().scores,[morpionOppUid]:99}});toast("Vous avez abandonné. Mise perdue.","lose");}if(unsubMorpion){unsubMorpion();unsubMorpion=null;}morpionGameId=null;}goToLobby();};

// ══════════════════════════════════════════════════════════════
//  MODIFIER LE BLAZE
// ══════════════════════════════════════════════════════════════
window.openEditName = function() {
  const modal = document.getElementById("edit-name-modal");
  const input = document.getElementById("edit-name-input");
  if (!modal || !input) return;
  input.value = userData?.name || "";
  modal.style.display = "flex";
  setTimeout(() => input.focus(), 100);
};
window.closeEditName = function() {
  const modal = document.getElementById("edit-name-modal");
  if (modal) modal.style.display = "none";
};
window.saveEditName = async function() {
  const input = document.getElementById("edit-name-input");
  if (!input || !currentUser || !userData) return;
  const newName = input.value.trim();
  if (!newName || newName.length < 2) { toast("Nom trop court (min 2 caractères)", "lose"); return; }
  if (newName.length > 20) { toast("Nom trop long (max 20 caractères)", "lose"); return; }
  await updateDoc(doc(db, "users", currentUser.uid), { name: newName });
  userData.name = newName;
  document.getElementById("lobby-username").textContent = newName;
  closeEditName();
  toast(`Blaze mis à jour : ${newName} ✅`, "win");
};

// ══════════════════════════════════════════════════════════════
//  INIT SLOTS au chargement de la page
// ══════════════════════════════════════════════════════════════
const slotsObserver = new MutationObserver(() => {
  if (document.getElementById("page-slots")?.classList.contains("active")) initSlots();
});
const slotsPage = document.getElementById("page-slots");
if (slotsPage) slotsObserver.observe(slotsPage, { attributes: true, attributeFilter: ["class"] });

// ══════════════════════════════════════════════════════════════
//  UTILS
// ══════════════════════════════════════════════════════════════
function delay(ms){return new Promise(r=>setTimeout(r,ms));}
function shuffle(arr){for(let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];}}
