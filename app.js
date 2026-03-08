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
let unsubBj1v1 = null;
let currentPage = "login";
let pendingGameInvite = null;
let ginAutoClose = null;
let bj1v1GameId = null;
let bj1v1OppUid = "";
let bj1v1Bet = 0;
let bj1v1Starting = false;
let tombolaUnsub = null;
let tombolaTimerInterval = null;
let tombolaData = null;
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
  if (game === "bourse") { initBourse(); return; }
  if (game === "poker") { showPage("poker"); return; }

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
  stopBourse();
  showPage("lobby");
  initBonus();
};

function updateAllBalances() {
  if (!userData) return;
  const bal = (userData.balance || 0).toLocaleString("fr-FR") + " VLX";
  ["dice","mines","coinflip","tombola","bj1v1","roulette","slots","blackjack","poker","bourse"].forEach(id => {
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

    const inv = userData.pendingGameInvite;
    if (inv && inv.from !== currentUser.uid) {
      const age = Date.now() - inv.sentAt;
      if (age < 60000 && (!pendingGameInvite || pendingGameInvite.gameId !== inv.gameId)) {
        showGameInviteNotif(inv);
      }
    }

    if (userData.gameStarted && !bj1v1GameId && !bj1v1Starting) {
      const gid = userData.gameStarted;
      bj1v1Starting = true;
      updateDoc(doc(db, "users", currentUser.uid), { gameStarted: null }).then(() => {
        getDoc(doc(db, "bj1v1", gid)).then(gs => {
          if (!gs.exists()) { bj1v1Starting = false; return; }
          const g = gs.data();
          startBj1v1(gid, g.players[0], g.players[1], g.bet);
        }).catch(() => { bj1v1Starting = false; });
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
//  MACHINE À SOUS
// ══════════════════════════════════════════════════════════════
const SLOT_SYMBOLS = ["🍒","🍋","🍊","🔔","💎","7️⃣"];
let slotsSpinning = false;

function initSlots() {
  for (let i = 0; i < 3; i++) {
    const strip = document.getElementById("strip-" + i);
    if (!strip) return;
    strip.innerHTML = "";
    for (let j = 0; j < 20; j++) {
      const div = document.createElement("div");
      div.className = "reel-symbol";
      div.textContent = SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)];
      strip.appendChild(div);
    }
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

  const results = [
    Math.floor(Math.random() * SLOT_SYMBOLS.length),
    Math.floor(Math.random() * SLOT_SYMBOLS.length),
    Math.floor(Math.random() * SLOT_SYMBOLS.length)
  ];

  const animPromises = results.map((finalIdx, reelIdx) => {
    return new Promise(resolve => {
      const strip = document.getElementById("strip-" + reelIdx);
      const symbolHeight = 90;
      const totalSymbols = 20;
      strip.innerHTML = "";
      const symbols = [];
      for (let j = 0; j < totalSymbols; j++) {
        symbols.push(SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)]);
      }
      symbols[10] = SLOT_SYMBOLS[finalIdx];
      symbols.forEach(s => {
        const div = document.createElement("div");
        div.className = "reel-symbol";
        div.textContent = s;
        strip.appendChild(div);
      });
      strip.style.transition = "none";
      strip.style.transform = "translateY(0px)";
      const targetY = -(10 * symbolHeight);
      const spinDuration = 800 + reelIdx * 400;
      setTimeout(() => {
        strip.style.transition = `transform ${spinDuration}ms cubic-bezier(.17,.67,.35,1.0)`;
        strip.style.transform = `translateY(${targetY}px)`;
        setTimeout(resolve, spinDuration + 50);
      }, 50);
    });
  });

  await Promise.all(animPromises);

  const finalSymbols = results.map(i => SLOT_SYMBOLS[i]);
  const counts = {};
  finalSymbols.forEach(s => { counts[s] = (counts[s] || 0) + 1; });
  const maxCount = Math.max(...Object.values(counts));

  const msgEl = document.getElementById("slots-result-msg");
  let gain = 0;

  if (maxCount === 3) {
    gain = Math.round(bet * 3.5);
    msgEl.textContent = `${finalSymbols[0]} ${finalSymbols[1]} ${finalSymbols[2]} — JACKPOT ! +${gain} VLX 🎉`;
    msgEl.className = "slots-result-msg win3";
    toast(`JACKPOT 🎰 ! +${gain} VLX (×3.5) 🎉`, "win");
  } else if (maxCount === 2) {
    gain = Math.round(bet * 2);
    msgEl.textContent = `${finalSymbols[0]} ${finalSymbols[1]} ${finalSymbols[2]} — +${gain} VLX (×2)`;
    msgEl.className = "slots-result-msg win2";
    toast(`Deux pareils ! +${gain} VLX (×2)`, "win");
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
//  BLACKJACK (vs Dealer)
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
  for (const c of hand) { total += bjCardValue(c); if (c.val === "A") aces++; }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}
function bjIsRed(suit) { return suit === "♥" || suit === "♦"; }
function bjRenderCard(card, hidden = false) {
  const div = document.createElement("div");
  if (hidden) { div.className = "bj-card bj-card-back"; return div; }
  div.className = "bj-card " + (bjIsRed(card.suit) ? "red" : "black");
  div.innerHTML = `<div><div class="bj-card-val">${card.val}</div><div class="bj-card-suit">${card.suit}</div></div><div class="bj-card-center">${card.suit}</div><div style="transform:rotate(180deg)"><div class="bj-card-val">${card.val}</div><div class="bj-card-suit">${card.suit}</div></div>`;
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
  document.getElementById("bj-dealer-score").textContent = hideDealer ? bjCardValue(bjDealerHand[0]) : bjHandValue(bjDealerHand);
}
window.bjDeal = async function() {
  if (bjPlaying) return;
  const bet = parseBet("bj-bet"); if (!bet) return;
  bjBet = bet; userData.balance -= bet; updateAllBalances();
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
  if (pScore === 21) { status.textContent = "Blackjack ! 🎉"; await delay(400); bjRevealAndFinish(); return; }
  status.textContent = "Votre tour — Tirer ou Rester ?";
};
window.bjHit = async function() {
  if (!bjPlaying) return;
  bjPlayerHand.push(bjDeck.pop()); bjRenderHands(true);
  document.getElementById("bj-double-btn").disabled = true;
  const score = bjHandValue(bjPlayerHand);
  if (score > 21) { document.getElementById("bj-status").textContent = "Bust !"; document.getElementById("bj-status").className = "bj-status lose"; bjFinish("lose"); }
  else if (score === 21) { await bjRevealAndFinish(); }
};
window.bjStand = async function() { if (!bjPlaying) return; await bjRevealAndFinish(); };
window.bjDouble = async function() {
  if (!bjPlaying) return;
  if (bjBet > userData.balance) { toast("Solde insuffisant pour doubler !", "lose"); return; }
  userData.balance -= bjBet; bjBet *= 2; updateAllBalances();
  bjPlayerHand.push(bjDeck.pop()); bjRenderHands(true);
  document.getElementById("bj-double-btn").disabled = true;
  const score = bjHandValue(bjPlayerHand);
  if (score > 21) { document.getElementById("bj-status").textContent = `Bust ! Perdu ${bjBet} VLX`; document.getElementById("bj-status").className = "bj-status lose"; bjFinish("lose"); }
  else { await bjRevealAndFinish(); }
};
async function bjRevealAndFinish() {
  bjRenderHands(false); await delay(600);
  while (bjHandValue(bjDealerHand) < 17) { bjDealerHand.push(bjDeck.pop()); bjRenderHands(false); await delay(500); }
  const pScore = bjHandValue(bjPlayerHand), dScore = bjHandValue(bjDealerHand);
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
    const profilBtn = !isYou ? `<button class="btn-view-profil" onclick="openProfil('${u.uid}')">Profil</button>` : '';
    const e = document.createElement("div");
    e.className = "lb-entry" + (rank<=3?" top"+rank:"");
    e.innerHTML = `${rankEl}<div class="lb-avatar-wrap"><img class="lb-avatar" src="${u.avatar||''}" onerror="this.style.display='none'" alt="">${onlineDot}</div><span class="lb-name">${u.name||"Joueur"}${isYou?'<span class="lb-you">VOUS</span>':''}</span><span class="lb-balance">${(u.balance||0).toLocaleString("fr-FR")} VLX</span>${profilBtn}`;
    list.appendChild(e);
  });
}

// ══════════════════════════════════════════════════════════════
//  PAGE JOUEURS
// ══════════════════════════════════════════════════════════════
function initJoueurs() {
  showPage("joueurs");
  document.getElementById("player-search-input").value = "";
  document.getElementById("players-list").innerHTML = '<div class="lb-loading">Tape un nom pour chercher un joueur.</div>';
}

window.searchPlayers = async function() {
  const input = document.getElementById("player-search-input").value.trim().toLowerCase();
  const list = document.getElementById("players-list");
  if (!input || input.length < 2) { list.innerHTML = '<div class="lb-loading">Tape au moins 2 caractères.</div>'; return; }
  list.innerHTML = '<div class="lb-loading">Recherche...</div>';
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
      e.innerHTML = `<div class="lb-avatar-wrap" style="flex-shrink:0;width:40px;height:40px;"><img class="lb-avatar" src="${u.avatar||''}" onerror="this.style.display='none'" alt="" style="width:40px;height:40px;"><span class="online-dot ${isOnline?'online':'offline'}"></span></div><div class="player-entry-info"><div class="player-entry-name">${u.name||"Joueur"}</div><div class="player-entry-balance">${(u.balance||0).toLocaleString("fr-FR")} VLX</div></div><span style="color:var(--text2);font-size:.85rem">${isOnline?"🟢 En ligne":"⚫ Hors ligne"}</span>`;
      e.onclick = () => openProfil(u.uid);
      list.appendChild(e);
    });
  } catch(err) { list.innerHTML = '<div class="lb-loading">Erreur de recherche.</div>'; }
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
  document.getElementById("send-vlx-amount").value = 100;
  document.getElementById("defi-bet-amount").value = 100;
};

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

// ══════════════════════════════════════════════════════════════
//  ENVOYER UN DÉFI BLACKJACK 1v1
// ══════════════════════════════════════════════════════════════
window.sendDefiFromProfil = async function() {
  if (!profilTargetUid || !profilTargetData) return;
  const bet = parseInt(document.getElementById("defi-bet-amount").value);
  if (!bet || bet < 10) { toast("Mise minimum 10 VLX", "lose"); return; }
  if (bet > userData.balance) { toast("Solde insuffisant !", "lose"); return; }

  const snap = await getDoc(doc(db, "users", profilTargetUid));
  if (!snap.exists()) { toast("Joueur introuvable", "lose"); return; }
  const target = snap.data();
  const isOnline = target.online === true && (Date.now() - (target.lastSeen||0)) < 60000;
  if (!isOnline) { toast("Ce joueur est hors ligne !", "lose"); return; }

  if (target.pendingGameInvite && (Date.now() - target.pendingGameInvite.sentAt) < 60000) {
    toast("Ce joueur a déjà un défi en attente !", "lose"); return;
  }

  const gameId = `bj1v1_${currentUser.uid}_${Date.now()}`;
  await updateDoc(doc(db, "users", profilTargetUid), {
    pendingGameInvite: {
      gameId,
      from: currentUser.uid,
      fromName: userData.name || "Joueur",
      type: "bj1v1",
      bet,
      sentAt: Date.now()
    }
  });
  toast(`⚔️ Défi Blackjack envoyé à ${target.name} !`, "win");
};

// ══════════════════════════════════════════════════════════════
//  BLACKJACK 1v1
// ══════════════════════════════════════════════════════════════
function bj1v1CreateDeck() {
  const deck = [];
  for (const suit of BJ_SUITS) for (const val of BJ_VALUES) deck.push({ suit, val });
  return shuffle2(deck);
}

function startBj1v1(gameId, p1uid, p2uid, bet) {
  bj1v1GameId = gameId;
  bj1v1OppUid = currentUser.uid === p1uid ? p2uid : p1uid;
  bj1v1Bet = bet;
  bj1v1Starting = false;
  showPage("bj1v1");
  updateAllBalances();

  if (unsubBj1v1) { unsubBj1v1(); unsubBj1v1 = null; }
  unsubBj1v1 = onSnapshot(doc(db, "bj1v1", gameId), snap => {
    if (!snap.exists()) return;
    const g = snap.data();
    renderBj1v1(g);
    if (g.status === "finished") finishBj1v1(g);
  });
}

function bj1v1RenderCard(card, hidden = false) {
  const div = document.createElement("div");
  if (hidden) { div.className = "bj-card bj-card-back"; return div; }
  div.className = "bj-card " + (bjIsRed(card.suit) ? "red" : "black");
  div.innerHTML = `<div><div class="bj-card-val">${card.val}</div><div class="bj-card-suit">${card.suit}</div></div><div class="bj-card-center">${card.suit}</div><div style="transform:rotate(180deg)"><div class="bj-card-val">${card.val}</div><div class="bj-card-suit">${card.suit}</div></div>`;
  return div;
}

function renderBj1v1(g) {
  const myCards = document.getElementById("bj1v1-my-cards");
  const oppCards = document.getElementById("bj1v1-opp-cards");
  if (!myCards || !oppCards) return;
  myCards.innerHTML = ""; oppCards.innerHTML = "";

  const myHand = g.hands?.[currentUser.uid] || [];
  const oppHand = g.hands?.[bj1v1OppUid] || [];
  const gameOver = g.status === "finished";

  myHand.forEach(c => myCards.appendChild(bj1v1RenderCard(c)));
  oppHand.forEach(c => oppCards.appendChild(bj1v1RenderCard(c, !gameOver)));

  document.getElementById("bj1v1-my-score-badge").textContent = myHand.length ? bjHandValue(myHand) : "";
  document.getElementById("bj1v1-opp-score-badge").textContent = (gameOver && oppHand.length) ? bjHandValue(oppHand) : (oppHand.length ? "?" : "");
  document.getElementById("bj1v1-my-name").textContent = userData?.name || "Moi";
  document.getElementById("bj1v1-opp-name").textContent = g.names?.[bj1v1OppUid] || "Adversaire";
  document.getElementById("bj1v1-bet-display").textContent = `${bj1v1Bet} VLX`;

  const myStatus = g.playerStatus?.[currentUser.uid];
  const actions = document.getElementById("bj1v1-actions");
  const statusEl = document.getElementById("bj1v1-status");

  if (g.status === "finished") return;

  if (myStatus === "playing") {
    actions.style.display = "flex";
    statusEl.textContent = "🃏 À votre tour — Tirer ou Rester ?";
    statusEl.className = "bj1v1-status your-turn";
  } else if (myStatus === "stand") {
    actions.style.display = "none";
    statusEl.textContent = "⏳ En attente de l'adversaire...";
    statusEl.className = "bj1v1-status opp-turn";
  } else if (myStatus === "bust") {
    actions.style.display = "none";
    statusEl.textContent = "💥 Bust ! En attente de l'adversaire...";
    statusEl.className = "bj1v1-status lose";
  } else {
    actions.style.display = "none";
    statusEl.textContent = "⏳ En attente du démarrage...";
    statusEl.className = "bj1v1-status";
  }
}

async function finishBj1v1(g) {
  if (unsubBj1v1) { unsubBj1v1(); unsubBj1v1 = null; }
  const actions = document.getElementById("bj1v1-actions");
  if (actions) actions.style.display = "none";

  const myHand = g.hands?.[currentUser.uid] || [];
  const oppHand = g.hands?.[bj1v1OppUid] || [];
  const myScore = bjHandValue(myHand);
  const oppScore = bjHandValue(oppHand);
  const prize = bj1v1Bet * 2;
  const statusEl = document.getElementById("bj1v1-status");

  const myCards = document.getElementById("bj1v1-my-cards");
  const oppCards = document.getElementById("bj1v1-opp-cards");
  if (myCards) { myCards.innerHTML = ""; myHand.forEach(c => myCards.appendChild(bj1v1RenderCard(c))); }
  if (oppCards) { oppCards.innerHTML = ""; oppHand.forEach(c => oppCards.appendChild(bj1v1RenderCard(c))); }
  document.getElementById("bj1v1-my-score-badge").textContent = myScore;
  document.getElementById("bj1v1-opp-score-badge").textContent = oppScore;

  const winner = g.winner;
  if (winner === "push") {
    statusEl.textContent = `🤝 Égalité — mise remboursée`;
    statusEl.className = "bj1v1-status push";
    userData.balance += bj1v1Bet;
    await updateDoc(doc(db, "users", currentUser.uid), { balance: userData.balance });
    updateAllBalances();
    toast("Égalité ! Mise remboursée.", "");
  } else if (winner === currentUser.uid) {
    statusEl.textContent = `🏆 Victoire ! +${prize} VLX`;
    statusEl.className = "bj1v1-status win";
    userData.balance += prize;
    await updateDoc(doc(db, "users", currentUser.uid), { balance: userData.balance });
    updateAllBalances();
    toast(`🏆 Victoire au Blackjack 1v1 ! +${prize} VLX`, "win");
  } else {
    if (g.forfeit === currentUser.uid) {
      statusEl.textContent = `🏳️ Abandon — mise perdue`;
    } else {
      statusEl.textContent = `💀 Défaite — ${myScore > 21 ? "Bust" : myScore} vs ${oppScore > 21 ? "Bust" : oppScore}`;
    }
    statusEl.className = "bj1v1-status lose";
    toast(`Défaite au Blackjack 1v1. -${bj1v1Bet} VLX`, "lose");
  }

  userData.gamesPlayed++;
  await saveUserData();
  bj1v1GameId = null;
  setTimeout(() => { if (currentPage === "bj1v1") goToLobby(); }, 3500);
}

window.bj1v1Hit = async function() {
  if (!bj1v1GameId) return;
  const snap = await getDoc(doc(db, "bj1v1", bj1v1GameId));
  if (!snap.exists()) return;
  const g = snap.data();
  if (g.playerStatus?.[currentUser.uid] !== "playing") return;
  if (g.status === "finished") return;

  const hands = JSON.parse(JSON.stringify(g.hands));
  const deck = [...g.deck];
  const newCard = deck.pop();
  hands[currentUser.uid] = [...(hands[currentUser.uid] || []), newCard];

  const myScore = bjHandValue(hands[currentUser.uid]);
  const playerStatus = { ...g.playerStatus };
  let updates = { hands, deck };

  if (myScore >= 21) {
    playerStatus[currentUser.uid] = myScore > 21 ? "bust" : "stand";
    updates.playerStatus = playerStatus;
    const allDone = Object.values(playerStatus).every(s => s !== "playing");
    if (allDone) {
      updates.status = "finished";
      updates.winner = determineWinner(hands, g.players);
    }
  } else {
    updates.playerStatus = playerStatus;
  }

  await updateDoc(doc(db, "bj1v1", bj1v1GameId), updates);
};

window.bj1v1Stand = async function() {
  if (!bj1v1GameId) return;
  const snap = await getDoc(doc(db, "bj1v1", bj1v1GameId));
  if (!snap.exists()) return;
  const g = snap.data();
  if (g.playerStatus?.[currentUser.uid] !== "playing") return;
  if (g.status === "finished") return;

  const playerStatus = { ...g.playerStatus, [currentUser.uid]: "stand" };
  let updates = { playerStatus };

  const allDone = Object.values(playerStatus).every(s => s !== "playing");
  if (allDone) {
    updates.status = "finished";
    updates.winner = determineWinner(g.hands, g.players);
  }
  await updateDoc(doc(db, "bj1v1", bj1v1GameId), updates);
};

function determineWinner(hands, players) {
  const [p1, p2] = players;
  const s1Raw = bjHandValue(hands[p1] || []);
  const s2Raw = bjHandValue(hands[p2] || []);
  const s1 = s1Raw > 21 ? 0 : s1Raw;
  const s2 = s2Raw > 21 ? 0 : s2Raw;
  if (s1Raw > 21 && s2Raw > 21) return "push";
  if (s1 === s2) return "push";
  return s1 > s2 ? p1 : p2;
}

window.quitBj1v1 = async function() {
  if (bj1v1GameId) {
    try {
      const snap = await getDoc(doc(db, "bj1v1", bj1v1GameId));
      if (snap.exists() && snap.data().status !== "finished") {
        await updateDoc(doc(db, "bj1v1", bj1v1GameId), {
          status: "finished",
          winner: bj1v1OppUid,
          forfeit: currentUser.uid
        });
        toast("Vous avez abandonné. Mise perdue.", "lose");
      }
    } catch(e) {}
    if (unsubBj1v1) { unsubBj1v1(); unsubBj1v1 = null; }
    bj1v1GameId = null;
    bj1v1Starting = false;
  }
  goToLobby();
};

// ══════════════════════════════════════════════════════════════
//  NOTIF INVITE DE JEU
// ══════════════════════════════════════════════════════════════
function showGameInviteNotif(inv) {
  pendingGameInvite = inv;
  const notif = document.getElementById("game-invite-notif");
  document.getElementById("gin-text").textContent = `🃏 ${inv.fromName} vous défie au Blackjack 1v1 ! Mise : ${inv.bet} VLX`;
  notif.style.display = "block";
  const fill = document.getElementById("gin-timer-fill");
  fill.style.transition = "none"; fill.style.width = "100%";
  clearTimeout(ginAutoClose);
  setTimeout(() => { fill.style.transition = "width 5s linear"; fill.style.width = "0%"; }, 50);
  ginAutoClose = setTimeout(async () => {
    notif.style.display = "none";
    if (pendingGameInvite) {
      await updateDoc(doc(db, "users", currentUser.uid), { pendingGameInvite: null });
      pendingGameInvite = null;
    }
  }, 5000);
}

window.acceptGameInvite = async function() {
  if (!pendingGameInvite) return;
  clearTimeout(ginAutoClose);
  document.getElementById("game-invite-notif").style.display = "none";
  const inv = pendingGameInvite; pendingGameInvite = null;

  if (inv.bet > userData.balance) { toast("Pas assez de VLX pour accepter !", "lose"); return; }

  const gameRef = doc(db, "bj1v1", inv.gameId);

  userData.balance -= inv.bet;
  await updateDoc(doc(db, "users", currentUser.uid), { balance: userData.balance, pendingGameInvite: null });
  updateAllBalances();

  await updateDoc(doc(db, "users", inv.from), { balance: increment(-inv.bet) });

  const deck = bj1v1CreateDeck();
  const p1 = inv.from, p2 = currentUser.uid;
  const p1hand = [deck.pop(), deck.pop()];
  const p2hand = [deck.pop(), deck.pop()];

  await setDoc(gameRef, {
    players: [p1, p2],
    names: { [p1]: inv.fromName, [p2]: userData.name || "Joueur" },
    bet: inv.bet,
    deck,
    hands: { [p1]: p1hand, [p2]: p2hand },
    playerStatus: { [p1]: "playing", [p2]: "playing" },
    status: "playing",
    createdAt: Date.now()
  });

  await updateDoc(doc(db, "users", inv.from), { gameStarted: inv.gameId });

  startBj1v1(inv.gameId, inv.from, currentUser.uid, inv.bet);
};

window.refuseGameInvite = async function() {
  clearTimeout(ginAutoClose);
  document.getElementById("game-invite-notif").style.display = "none";
  if (pendingGameInvite) {
    await updateDoc(doc(db, "users", currentUser.uid), { pendingGameInvite: null });
    pendingGameInvite = null;
  }
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
window.buyTombolaTickets=async function(){if(!tombolaData||!currentUser)return;const qty=Math.max(1,parseInt(document.getElementById("tombola-qty").value)||1);const cost=qty*TICKET_PRICE;if(cost>userData.balance){toast("Solde insuffisant !","lose");return;}userData.balance-=cost;await updateDoc(doc(db,"users",currentUser.uid),{balance:userData.balance});const newTickets=Array.from({length:qty},(_,i)=>({uid:currentUser.uid,name:userData.name||"Joueur",_id:`${currentUser.uid}_${Date.now()}_${i}`}));await updateDoc(doc(db,"tombola","current"),{tickets:arrayUnion(...newTickets),totalPot:increment(cost)});updateAllBalances();toast(`🎟️ ${qty} ticket(s) achetés pour ${cost} VLX !`,"win");};

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
//  ADMIN PANEL
// ══════════════════════════════════════════════════════════════
const ADMIN_CODE = "4523580303";
let adminAuthenticated = false;
let adminTargetUid = null;
let adminTargetData = null;

window.openAdminPanel = function() {
  adminAuthenticated = false;
  adminTargetUid = null;
  adminTargetData = null;
  const modal = document.getElementById("admin-modal");
  if (!modal) return;
  document.getElementById("admin-auth-step").style.display = "";
  document.getElementById("admin-panel-step").style.display = "none";
  document.getElementById("admin-code-input").value = "";
  document.getElementById("admin-code-error").textContent = "";
  document.getElementById("admin-search-results").innerHTML = "";
  document.getElementById("admin-selected-player").style.display = "none";
  modal.style.display = "flex";
  setTimeout(() => document.getElementById("admin-code-input").focus(), 100);
};

window.closeAdminModal = function() {
  document.getElementById("admin-modal").style.display = "none";
};

window.checkAdminCode = function() {
  const code = document.getElementById("admin-code-input").value.trim();
  if (code === ADMIN_CODE) {
    adminAuthenticated = true;
    document.getElementById("admin-auth-step").style.display = "none";
    document.getElementById("admin-panel-step").style.display = "flex";
    document.getElementById("admin-search-input").value = "";
    document.getElementById("admin-search-results").innerHTML = "";
    document.getElementById("admin-selected-player").style.display = "none";
    setTimeout(() => document.getElementById("admin-search-input").focus(), 100);
  } else {
    document.getElementById("admin-code-error").textContent = "❌ Code incorrect";
    document.getElementById("admin-code-input").value = "";
    setTimeout(() => { document.getElementById("admin-code-error").textContent = ""; }, 2000);
  }
};

window.adminSearchPlayers = async function() {
  if (!adminAuthenticated) return;
  const input = document.getElementById("admin-search-input").value.trim().toLowerCase();
  const resultsEl = document.getElementById("admin-search-results");
  document.getElementById("admin-selected-player").style.display = "none";
  adminTargetUid = null; adminTargetData = null;
  if (!input || input.length < 2) { resultsEl.innerHTML = ""; return; }
  resultsEl.innerHTML = "<div style='color:var(--text2);font-size:.85rem'>Recherche...</div>";
  try {
    const snap = await getDocs(collection(db, "users"));
    const results = [];
    snap.forEach(d => {
      const u = d.data();
      if ((u.name || "").toLowerCase().includes(input)) results.push(u);
    });
    resultsEl.innerHTML = "";
    if (!results.length) { resultsEl.innerHTML = "<div style='color:var(--text2);font-size:.85rem'>Aucun joueur trouvé</div>"; return; }
    results.slice(0, 10).forEach(u => {
      const el = document.createElement("div");
      el.className = "admin-player-result";
      el.innerHTML = `<img src="${u.avatar||''}" onerror="this.style.display='none'" alt=""><span>${u.name||"Joueur"}</span><span style="font-family:var(--ff-mono);color:var(--gold2);font-size:.8rem;margin-left:auto">${(u.balance||0).toLocaleString("fr-FR")} VLX</span>`;
      el.onclick = () => adminSelectPlayer(u);
      resultsEl.appendChild(el);
    });
  } catch(e) { resultsEl.innerHTML = "<div style='color:var(--red2);font-size:.85rem'>Erreur</div>"; }
};

function adminSelectPlayer(u) {
  adminTargetUid = u.uid;
  adminTargetData = u;
  document.getElementById("admin-target-name").textContent = u.name || "Joueur";
  document.getElementById("admin-target-balance").textContent = (u.balance||0).toLocaleString("fr-FR") + " VLX";
  document.getElementById("admin-selected-player").style.display = "";
  document.getElementById("admin-give-amount").value = 1000;
  document.getElementById("admin-search-results").innerHTML = "";
  document.getElementById("admin-search-input").value = u.name || "";
}

window.adminGiveVLX = async function() {
  if (!adminAuthenticated || !adminTargetUid) return;
  const amount = parseInt(document.getElementById("admin-give-amount").value);
  if (!amount || amount < 1) { toast("Montant invalide", "lose"); return; }
  try {
    await updateDoc(doc(db, "users", adminTargetUid), { balance: increment(amount) });
    toast(`✅ ${amount} VLX donnés à ${adminTargetData?.name || adminTargetUid} !`, "win");
    const newBal = (adminTargetData?.balance || 0) + amount;
    document.getElementById("admin-target-balance").textContent = newBal.toLocaleString("fr-FR") + " VLX";
    if (adminTargetData) adminTargetData.balance = newBal;
  } catch(e) { toast("Erreur lors du don", "lose"); }
};

window.adminRemoveVLX = async function() {
  if (!adminAuthenticated || !adminTargetUid) return;
  const amount = parseInt(document.getElementById("admin-give-amount").value);
  if (isNaN(amount) || amount < 1) { toast("Montant invalide", "lose"); return; }
  try {
    const snap = await getDoc(doc(db, "users", adminTargetUid));
    if (!snap.exists()) { toast("Joueur introuvable", "lose"); return; }
    const currentBal = snap.data().balance || 0;
    const newBal = Math.max(0, currentBal - amount);
    await updateDoc(doc(db, "users", adminTargetUid), { balance: newBal });
    const removed = currentBal - newBal;
    toast(`🔻 ${removed} VLX retirés à ${adminTargetData?.name || adminTargetUid} !`, "lose");
    document.getElementById("admin-target-balance").textContent = newBal.toLocaleString("fr-FR") + " VLX";
    if (adminTargetData) adminTargetData.balance = newBal;
  } catch(e) { toast("Erreur lors du retrait : " + e.message, "lose"); }
};

window.adminSetVLX = async function() {
  if (!adminAuthenticated || !adminTargetUid) return;
  const amount = parseInt(document.getElementById("admin-give-amount").value);
  if (isNaN(amount) || amount < 0) { toast("Montant invalide (min 0)", "lose"); return; }
  try {
    await updateDoc(doc(db, "users", adminTargetUid), { balance: amount });
    toast(`📝 Solde de ${adminTargetData?.name || adminTargetUid} défini à ${amount} VLX`, "win");
    document.getElementById("admin-target-balance").textContent = amount.toLocaleString("fr-FR") + " VLX";
    if (adminTargetData) adminTargetData.balance = amount;
  } catch(e) { toast("Erreur lors de la modification : " + e.message, "lose"); }
};

// ══════════════════════════════════════════════════════════════
//  INIT SLOTS
// ══════════════════════════════════════════════════════════════
const slotsObserver = new MutationObserver(() => {
  if (document.getElementById("page-slots")?.classList.contains("active")) initSlots();
});
const slotsPage = document.getElementById("page-slots");
if (slotsPage) slotsObserver.observe(slotsPage, { attributes: true, attributeFilter: ["class"] });

// ══════════════════════════════════════════════════════════════
//  POKER TEXAS HOLD'EM
// ══════════════════════════════════════════════════════════════
const POKER_SUITS = ["♠","♥","♦","♣"];
const POKER_VALUES = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
const POKER_VAL_MAP = {"2":2,"3":3,"4":4,"5":5,"6":6,"7":7,"8":8,"9":9,"10":10,"J":11,"Q":12,"K":13,"A":14};
let pokerState = null;

function pokerCreateDeck() {
  const deck = [];
  for (const s of POKER_SUITS) for (const v of POKER_VALUES) deck.push({suit:s,val:v});
  return shuffle2(deck);
}

function pokerCardValue(v) { return POKER_VAL_MAP[v] || 0; }

function pokerBestHand(cards) {
  const combos = [];
  const n = cards.length;
  for (let i = 0; i < n-4; i++)
    for (let j = i+1; j < n-3; j++)
      for (let k = j+1; k < n-2; k++)
        for (let l = k+1; l < n-1; l++)
          for (let m = l+1; m < n; m++)
            combos.push([cards[i],cards[j],cards[k],cards[l],cards[m]]);
  let best = null, bestScore = -1;
  for (const combo of combos) {
    const score = pokerEval5(combo);
    if (score > bestScore) { bestScore = score; best = combo; }
  }
  return { score: bestScore, hand: best };
}

function pokerEval5(hand) {
  const vals = hand.map(c => pokerCardValue(c.val)).sort((a,b)=>b-a);
  const suits = hand.map(c => c.suit);
  const isFlush = suits.every(s => s === suits[0]);
  const isStraight = vals.every((v,i) => i===0 || vals[i-1]-v===1) ||
    (vals[0]===14 && vals[1]===5 && vals[2]===4 && vals[3]===3 && vals[4]===2);
  const counts = {};
  vals.forEach(v => counts[v] = (counts[v]||0)+1);
  const groups = Object.values(counts).sort((a,b)=>b-a);
  const topVal = vals[0];
  if (isFlush && isStraight) return 8000000 + topVal;
  if (groups[0]===4) return 7000000 + topVal;
  if (groups[0]===3 && groups[1]===2) return 6000000 + topVal;
  if (isFlush) return 5000000 + topVal;
  if (isStraight) return 4000000 + topVal;
  if (groups[0]===3) return 3000000 + topVal;
  if (groups[0]===2 && groups[1]===2) return 2000000 + topVal;
  if (groups[0]===2) return 1000000 + topVal;
  return topVal;
}

function pokerHandName(score) {
  if (score >= 8000000) return "Quinte Flush";
  if (score >= 7000000) return "Carré";
  if (score >= 6000000) return "Full House";
  if (score >= 5000000) return "Couleur";
  if (score >= 4000000) return "Quinte";
  if (score >= 3000000) return "Brelan";
  if (score >= 2000000) return "Double Paire";
  if (score >= 1000000) return "Paire";
  return "Hauteur";
}

function pokerRenderCard(card, hidden=false) {
  const div = document.createElement("div");
  if (hidden) { div.className = "bj-card bj-card-back"; return div; }
  div.className = "bj-card " + (["♥","♦"].includes(card.suit) ? "red" : "black");
  div.innerHTML = `<div><div class="bj-card-val">${card.val}</div><div class="bj-card-suit">${card.suit}</div></div><div class="bj-card-center">${card.suit}</div><div style="transform:rotate(180deg)"><div class="bj-card-val">${card.val}</div><div class="bj-card-suit">${card.suit}</div></div>`;
  return div;
}

function pokerRender() {
  if (!pokerState) return;
  const s = pokerState;

  const communityEl = document.getElementById("poker-community");
  if (communityEl) {
    communityEl.innerHTML = "";
    const shown = s.phase==="preflop"?0:s.phase==="flop"?3:s.phase==="turn"?4:5;
    for (let i = 0; i < 5; i++) {
      if (i < shown) communityEl.appendChild(pokerRenderCard(s.community[i]));
      else { const ph = document.createElement("div"); ph.className="bj-card poker-placeholder"; communityEl.appendChild(ph); }
    }
  }

  const playerEl = document.getElementById("poker-player-cards");
  if (playerEl) { playerEl.innerHTML = ""; s.playerHand.forEach(c => playerEl.appendChild(pokerRenderCard(c))); }

  [0,1].forEach(i => {
    const el = document.getElementById(`poker-bot${i}-cards`);
    if (!el) return;
    el.innerHTML = "";
    if (s.bots[i].folded) { el.innerHTML = '<span class="poker-folded-label">COUCHÉ</span>'; return; }
    const show = s.phase === "showdown";
    s.bots[i].hand.forEach(c => el.appendChild(pokerRenderCard(c, !show)));
  });

  const potEl = document.getElementById("poker-pot");
  if (potEl) potEl.textContent = s.pot + " VLX";
  const betEl = document.getElementById("poker-current-bet");
  if (betEl) betEl.textContent = "Mise actuelle : " + s.currentBet + " VLX";
  const playerChipsEl = document.getElementById("poker-player-chips");
  if (playerChipsEl) playerChipsEl.textContent = s.playerChips + " VLX";

  const phaseEl = document.getElementById("poker-phase");
  if (phaseEl) {
    const phases = {preflop:"Pre-Flop",flop:"Flop",turn:"Turn",river:"River",showdown:"Showdown"};
    phaseEl.textContent = phases[s.phase] || s.phase;
  }

  const actionsEl = document.getElementById("poker-actions");
  const statusEl = document.getElementById("poker-status");
  if (s.phase === "showdown") {
    if (actionsEl) actionsEl.style.display = "none";
  } else if (s.playerTurn) {
    if (actionsEl) actionsEl.style.display = "flex";
    const callBtn = document.getElementById("poker-call-btn");
    const checkBtn = document.getElementById("poker-check-btn");
    const toCall = s.currentBet - s.playerBetThisRound;
    if (callBtn) { callBtn.textContent = toCall > 0 ? `📞 Suivre (${toCall} VLX)` : "📞 Suivre"; callBtn.disabled = toCall > s.playerChips; }
    if (checkBtn) checkBtn.style.display = toCall === 0 ? "flex" : "none";
    if (callBtn) callBtn.style.display = toCall > 0 ? "flex" : "none";
    if (statusEl) { statusEl.textContent = "🎯 À votre tour !"; statusEl.className = "poker-status your-turn"; }
  } else {
    if (actionsEl) actionsEl.style.display = "none";
    if (statusEl) { statusEl.textContent = "⏳ Les bots réfléchissent..."; statusEl.className = "poker-status waiting"; }
  }

  if (s.phase !== "preflop") {
    const allCards = [...s.playerHand, ...s.community.slice(0, s.phase==="flop"?3:s.phase==="turn"?4:5)];
    const { score } = pokerBestHand(allCards);
    const handNameEl = document.getElementById("poker-hand-name");
    if (handNameEl) handNameEl.textContent = pokerHandName(score);
  }
}

window.startPoker = function() {
  const buyIn = parseInt(document.getElementById("poker-buyin").value) || 500;
  if (buyIn < 100) { toast("Buy-in minimum : 100 VLX", "lose"); return; }
  if (buyIn > userData.balance) { toast("Solde insuffisant !", "lose"); return; }

  userData.balance -= buyIn;
  updateAllBalances();

  const deck = pokerCreateDeck();
  const smallBlind = Math.max(10, Math.floor(buyIn * 0.02));
  const bigBlind = smallBlind * 2;

  pokerState = {
    deck,
    phase: "preflop",
    playerHand: [deck.pop(), deck.pop()],
    bots: [
      { hand: [deck.pop(), deck.pop()], chips: buyIn, folded: false, betThisRound: 0 },
      { hand: [deck.pop(), deck.pop()], chips: buyIn, folded: false, betThisRound: 0 }
    ],
    community: [deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop()],
    pot: 0,
    playerChips: buyIn,
    playerBetThisRound: 0,
    currentBet: bigBlind,
    smallBlind, bigBlind,
    playerTurn: true,
    raiseCount: 0
  };

  pokerState.pot += smallBlind + bigBlind;
  pokerState.bots[0].chips -= smallBlind;
  pokerState.bots[1].chips -= bigBlind;
  pokerState.bots[0].betThisRound = smallBlind;
  pokerState.bots[1].betThisRound = bigBlind;

  document.getElementById("poker-lobby").style.display = "none";
  document.getElementById("poker-table").style.display = "flex";
  document.getElementById("poker-status").textContent = "🎯 À votre tour !";
  document.getElementById("poker-status").className = "poker-status your-turn";
  pokerRender();
};

window.pokerFold = function() {
  if (!pokerState?.playerTurn) return;
  pokerState.playerTurn = false;
  const statusEl = document.getElementById("poker-status");
  statusEl.textContent = "🏳️ Vous avez couché.";
  statusEl.className = "poker-status lose";
  document.getElementById("poker-actions").style.display = "none";
  userData.gamesPlayed++;
  saveUserData();
  pokerRender();
  setTimeout(pokerShowNewHandBtn, 1500);
};

window.pokerCheck = function() {
  if (!pokerState?.playerTurn) return;
  pokerState.playerTurn = false;
  pokerRender();
  setTimeout(pokerBotsAct, 700);
};

window.pokerCall = function() {
  if (!pokerState?.playerTurn) return;
  const toCall = Math.min(pokerState.currentBet - pokerState.playerBetThisRound, pokerState.playerChips);
  pokerState.playerChips -= toCall;
  pokerState.pot += toCall;
  pokerState.playerBetThisRound += toCall;
  pokerState.playerTurn = false;
  pokerRender();
  setTimeout(pokerBotsAct, 700);
};

window.pokerRaise = function() {
  if (!pokerState?.playerTurn || pokerState.raiseCount >= 3) return;
  const raiseAmount = pokerState.bigBlind * 2 * (pokerState.raiseCount + 1);
  const toCall = pokerState.currentBet - pokerState.playerBetThisRound;
  const total = toCall + raiseAmount;
  if (total > pokerState.playerChips) { toast("Pas assez de VLX pour relancer !", "lose"); return; }
  pokerState.playerChips -= total;
  pokerState.pot += total;
  pokerState.playerBetThisRound += total;
  pokerState.currentBet += raiseAmount;
  pokerState.raiseCount++;
  pokerState.playerTurn = false;
  pokerRender();
  setTimeout(pokerBotsAct, 700);
};

async function pokerBotsAct() {
  if (!pokerState) return;
  for (let i = 0; i < 2; i++) {
    const bot = pokerState.bots[i];
    if (bot.folded || bot.chips <= 0) continue;
    const allCards = [...bot.hand, ...pokerState.community.slice(0, pokerState.phase==="flop"?3:pokerState.phase==="turn"?4:5)];
    let handStrength = pokerState.phase === "preflop"
      ? (pokerCardValue(bot.hand[0].val) + pokerCardValue(bot.hand[1].val)) / 28
      : pokerBestHand(allCards).score / 9000000;
    const toCall = pokerState.currentBet - bot.betThisRound;
    const rand = Math.random();
    if (handStrength > 0.7) {
      const raise = Math.min(pokerState.bigBlind * 2, bot.chips);
      const total = toCall + raise;
      if (total <= bot.chips) { bot.chips -= total; pokerState.pot += total; bot.betThisRound += total; pokerState.currentBet += raise; }
      else { bot.chips -= toCall; pokerState.pot += toCall; bot.betThisRound += toCall; }
    } else if (handStrength > 0.4 || rand > 0.35) {
      const call = Math.min(toCall, bot.chips);
      bot.chips -= call; pokerState.pot += call; bot.betThisRound += call;
    } else {
      if (toCall > pokerState.bigBlind) bot.folded = true;
      else { const call = Math.min(toCall, bot.chips); bot.chips -= call; pokerState.pot += call; bot.betThisRound += call; }
    }
    pokerRender();
    await delay(400);
  }
  pokerNextPhase();
}

function pokerNextPhase() {
  if (!pokerState) return;
  pokerState.playerBetThisRound = 0;
  pokerState.bots.forEach(b => b.betThisRound = 0);
  pokerState.currentBet = 0;
  pokerState.raiseCount = 0;
  const activeBots = pokerState.bots.filter(b => !b.folded);
  if (activeBots.length === 0) { pokerState.phase = "showdown"; pokerRender(); pokerShowResult(); return; }
  const phases = ["preflop","flop","turn","river","showdown"];
  const idx = phases.indexOf(pokerState.phase);
  if (idx >= 3) { pokerState.phase = "showdown"; pokerRender(); setTimeout(pokerShowResult, 600); return; }
  pokerState.phase = phases[idx + 1];
  pokerState.playerTurn = true;
  pokerRender();
}

function pokerShowResult() {
  if (!pokerState) return;
  pokerState.phase = "showdown";
  pokerState.playerTurn = false;
  pokerRender();
  const activeBots = pokerState.bots.filter(b => !b.folded);
  const statusEl = document.getElementById("poker-status");
  const actEl = document.getElementById("poker-actions");
  if (actEl) actEl.style.display = "none";

  if (activeBots.length === 0) {
    const win = pokerState.pot;
    userData.balance += win; userData.gamesPlayed++;
    saveUserData();
    if (statusEl) { statusEl.textContent = `🏆 Tous les bots ont couché ! +${win} VLX`; statusEl.className = "poker-status win"; }
    toast(`🏆 Vous remportez le pot ! +${win} VLX`, "win");
    setTimeout(pokerShowNewHandBtn, 2500);
    return;
  }

  const communityAll = pokerState.community;
  const playerAll = [...pokerState.playerHand, ...communityAll];
  const { score: playerScore } = pokerBestHand(playerAll);
  let bestBotScore = -1;
  activeBots.forEach(bot => {
    const { score } = pokerBestHand([...bot.hand, ...communityAll]);
    if (score > bestBotScore) bestBotScore = score;
  });

  const pot = pokerState.pot;
  if (playerScore > bestBotScore) {
    userData.balance += pot; userData.gamesPlayed++; saveUserData();
    if (statusEl) { statusEl.textContent = `🏆 Victoire ! ${pokerHandName(playerScore)} — +${pot} VLX`; statusEl.className = "poker-status win"; }
    toast(`🏆 Poker gagné ! ${pokerHandName(playerScore)} — +${pot} VLX`, "win");
  } else if (playerScore === bestBotScore) {
    const half = Math.floor(pot / 2);
    userData.balance += half; userData.gamesPlayed++; saveUserData();
    if (statusEl) { statusEl.textContent = `🤝 Égalité ! +${half} VLX remboursés`; statusEl.className = "poker-status push"; }
    toast("Égalité au poker !", "");
  } else {
    userData.gamesPlayed++; saveUserData();
    if (statusEl) { statusEl.textContent = `💀 Défaite — ${pokerHandName(playerScore)} vs ${pokerHandName(bestBotScore)}`; statusEl.className = "poker-status lose"; }
    toast(`Défaite — ${pokerHandName(playerScore)} vs ${pokerHandName(bestBotScore)}`, "lose");
  }
  setTimeout(pokerShowNewHandBtn, 2500);
}

function pokerShowNewHandBtn() {
  const btn = document.getElementById("poker-new-hand-btn");
  if (btn) btn.style.display = "block";
}

window.pokerNewHand = function() {
  document.getElementById("poker-new-hand-btn").style.display = "none";
  if (userData.balance < 100 && pokerState.playerChips < 100) {
    toast("Plus assez de VLX !", "lose"); pokerQuit(); return;
  }
  const deck = pokerCreateDeck();
  const prevChips = pokerState?.playerChips || 500;
  const smallBlind = Math.max(10, Math.floor(prevChips * 0.02));
  const bigBlind = smallBlind * 2;
  pokerState = {
    deck, phase: "preflop",
    playerHand: [deck.pop(), deck.pop()],
    bots: [
      { hand: [deck.pop(), deck.pop()], chips: pokerState?.bots[0]?.chips || 500, folded: false, betThisRound: 0 },
      { hand: [deck.pop(), deck.pop()], chips: pokerState?.bots[1]?.chips || 500, folded: false, betThisRound: 0 }
    ],
    community: [deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop()],
    pot: 0, playerChips: prevChips, playerBetThisRound: 0,
    currentBet: bigBlind, smallBlind, bigBlind, playerTurn: true, raiseCount: 0
  };
  pokerState.pot += smallBlind + bigBlind;
  pokerState.bots[0].chips -= smallBlind;
  pokerState.bots[1].chips -= bigBlind;
  pokerState.bots[0].betThisRound = smallBlind;
  pokerState.bots[1].betThisRound = bigBlind;
  const statusEl = document.getElementById("poker-status");
  if (statusEl) { statusEl.textContent = "🎯 À votre tour !"; statusEl.className = "poker-status your-turn"; }
  pokerRender();
};

window.pokerQuit = function() {
  if (pokerState?.playerChips > 0) {
    userData.balance += pokerState.playerChips;
    updateAllBalances();
    toast(`Vous quittez avec ${pokerState.playerChips} VLX`, "");
    saveUserData();
  }
  pokerState = null;
  document.getElementById("poker-lobby").style.display = "flex";
  document.getElementById("poker-table").style.display = "none";
};

// ══════════════════════════════════════════════════════════════
//  BOURSE — MARCHÉ LOCAL (prix gérés en mémoire, pas Firestore)
// ══════════════════════════════════════════════════════════════
const BOURSE_ASSETS = [
  { id: "vlxcoin",     name: "VLX Coin",     emoji: "🪙", basePrice: 1000, volatility: 0.13, color: "#d4a017" },
  { id: "bitgold",     name: "BitGold",      emoji: "🥇", basePrice: 5000, volatility: 0.07, color: "#f0c040" },
  { id: "moontoken",   name: "MoonToken",    emoji: "🌙", basePrice: 150,  volatility: 0.24, color: "#a78bfa" },
  { id: "casinoshare", name: "CasinoShare",  emoji: "🎰", basePrice: 800,  volatility: 0.05, color: "#3498db" },
  { id: "wavecoin",    name: "WaveCoin",     emoji: "🌊", basePrice: 300,  volatility: 0.19, color: "#2ecc71" },
  { id: "diamondx",    name: "DiamondX",     emoji: "💎", basePrice: 2000, volatility: 0.16, color: "#e74c3c" },
];

const BOURSE_HISTORY_LEN = 40;
const BOURSE_UPDATE_MS   = 10000; // tick toutes les 10s

// bourseMarketData est volontairement en dehors de initBourse
// pour survivre aux changements de page (lobby → bourse → lobby → bourse)
let bourseMarketData     = null;   // { assets: { id: { price, history[] } }, lastUpdate }
let bourseInvestments    = [];
let bourseSelectedId     = BOURSE_ASSETS[0].id;
let bourseTickTimer      = null;
let bourseCountdownTimer = null;

// ── Arrêt propre ─────────────────────────────────────────────
window.stopBourse = function() {
  clearInterval(bourseTickTimer);
  clearInterval(bourseCountdownTimer);
  bourseTickTimer = bourseCountdownTimer = null;
};

// ── Création marché initial en mémoire ───────────────────────
function createBourseMarketLocal() {
  const assets = {};
  BOURSE_ASSETS.forEach(a => {
    let p = a.basePrice;
    const history = [];
    for (let i = 0; i < BOURSE_HISTORY_LEN; i++) {
      const trend = Math.random() > 0.5 ? 1 : -1;
      p = Math.max(a.basePrice * 0.1, p * (1 + trend * Math.random() * a.volatility * 0.6));
      history.push(Math.round(p * 100) / 100);
    }
    assets[a.id] = { price: history[history.length - 1], history };
  });
  bourseMarketData = { assets, lastUpdate: Date.now() };
}

// ── Tick prix (mise à jour locale) ───────────────────────────
function tickBoursePricesLocal() {
  if (!bourseMarketData) return;
  const assets = {};
  BOURSE_ASSETS.forEach(a => {
    const cur = bourseMarketData.assets?.[a.id] || { price: a.basePrice, history: [] };
    const bias   = (Math.random() - 0.48) * 0.015;
    const noise  = (Math.random() * 2 - 1) * a.volatility;
    const change = 1 + bias + noise;
    const newPrice = Math.max(
      a.basePrice * 0.04,
      Math.round(cur.price * change * 100) / 100
    );
    const history = [...(cur.history || []), newPrice].slice(-BOURSE_HISTORY_LEN);
    assets[a.id] = { price: newPrice, history };
  });
  bourseMarketData = { assets, lastUpdate: Date.now() };
}

// ── Entrée dans la page ───────────────────────────────────────
async function initBourse() {
  stopBourse();
  showPage("bourse");
  // On ne remet PAS bourseSelectedId à 0 pour garder la sélection
  // On ne recrée PAS le marché s'il existe déjà (prix conservés entre les pages)

  // Recharger les investissements (au cas où une vente/achat a eu lieu ailleurs)
  await loadBourseInvestments();

  // Créer le marché seulement si c'est la toute première fois
  if (!bourseMarketData) {
    createBourseMarketLocal();
  }

  renderBourse();

  // Tick automatique local toutes les 10s
  bourseTickTimer = setInterval(() => {
    if (!bourseMarketData) return;
    const age = Date.now() - (bourseMarketData.lastUpdate || 0);
    if (age >= BOURSE_UPDATE_MS) {
      tickBoursePricesLocal();
      renderBourse();
    }
  }, 1000); // vérifie chaque seconde, déclenche si 10s écoulées

  // Compte à rebours affiché
  bourseCountdownTimer = setInterval(() => {
    const el = document.getElementById("bourse-next-tick");
    if (!el || !bourseMarketData) return;
    const remaining = Math.max(0, BOURSE_UPDATE_MS - (Date.now() - (bourseMarketData.lastUpdate || 0)));
    const s = Math.ceil(remaining / 1000);
    el.textContent = `⏱ Prochain tick dans ${s}s`;
  }, 1000);
}

// ── Charger / sauvegarder les investissements (Firestore) ─────
async function loadBourseInvestments() {
  if (!currentUser) return;
  try {
    const snap = await getDoc(doc(db, "investments", currentUser.uid));
    bourseInvestments = snap.exists() ? (snap.data().list || []) : [];
  } catch { bourseInvestments = []; }
}

async function saveBourseInvestments() {
  if (!currentUser) return;
  try {
    await setDoc(doc(db, "investments", currentUser.uid), { list: bourseInvestments });
  } catch(e) {
    console.warn("Erreur sauvegarde investissements:", e);
  }
}
// ── Rendu global ──────────────────────────────────────────────
function renderBourse() {
  renderBourseList();
  renderBourseDetail();
  renderBoursePortfolio();
}

// ── Colonne gauche : liste des 6 actifs ───────────────────────
function renderBourseList() {
  const container = document.getElementById("bourse-assets-list");
  if (!container || !bourseMarketData) return;
  container.innerHTML = "";

  BOURSE_ASSETS.forEach(asset => {
    const data = bourseMarketData.assets?.[asset.id];
    if (!data) return;

    const history = data.history || [data.price];
    const prev    = history.length >= 2 ? history[history.length - 2] : data.price;
    const pct     = ((data.price - prev) / Math.max(prev, 0.01) * 100).toFixed(2);
    const isUp    = data.price >= prev;

    const el = document.createElement("div");
    el.className = "bourse-asset-card" + (bourseSelectedId === asset.id ? " selected" : "");
    el.style.setProperty("--asset-color", asset.color);
    el.innerHTML = `
      <div class="bac-header">
        <span class="bac-emoji">${asset.emoji}</span>
        <div class="bac-names">
          <div class="bac-name">${asset.name}</div>
          <div class="bac-id">${asset.id.toUpperCase()}</div>
        </div>
        <div class="bac-right">
          <div class="bac-price">${data.price.toLocaleString("fr-FR")} VLX</div>
          <div class="bac-change ${isUp ? "up" : "down"}">${isUp ? "▲" : "▼"} ${Math.abs(pct)}%</div>
        </div>
      </div>
      <div class="bac-chart">${bourseDrawMini(history, isUp)}</div>`;
    el.onclick = () => { bourseSelectedId = asset.id; renderBourse(); };
    container.appendChild(el);
  });
}

// ── Colonne droite : détail + achat ──────────────────────────
function renderBourseDetail() {
  const panel = document.getElementById("bourse-detail-panel");
  if (!panel || !bourseMarketData) return;

  const asset = BOURSE_ASSETS.find(a => a.id === bourseSelectedId);
  if (!asset) return;
  const data = bourseMarketData.assets?.[asset.id];
  if (!data) return;

  const history = data.history || [data.price];
  const first   = history[0] || data.price;
  const pctAll  = ((data.price - first) / Math.max(first, 0.01) * 100).toFixed(2);
  const prev    = history.length >= 2 ? history[history.length - 2] : data.price;
  const pctLast = ((data.price - prev) / Math.max(prev, 0.01) * 100).toFixed(2);
  const isUp    = data.price >= prev;
  const vol     = Math.round(asset.volatility * 100);

  panel.innerHTML = `
    <div class="bourse-detail-header">
      <span class="bourse-detail-emoji">${asset.emoji}</span>
      <div class="bourse-detail-info">
        <div class="bourse-detail-name">${asset.name} <span style="font-family:var(--ff-mono);font-size:.75rem;color:var(--text2)">${asset.id.toUpperCase()}</span></div>
        <div class="bourse-detail-price">${data.price.toLocaleString("fr-FR")} VLX</div>
        <div class="bourse-detail-change ${isUp ? "up" : "down"}">
          ${isUp ? "▲" : "▼"} ${Math.abs(pctLast)}% ce tick &nbsp;·&nbsp; ${Number(pctAll) >= 0 ? "+" : ""}${pctAll}% depuis l'ouverture
        </div>
        <div class="bourse-detail-meta">Volatilité ${vol}% · ${BOURSE_HISTORY_LEN} ticks d'historique</div>
      </div>
    </div>
    <div class="bourse-big-chart">${bourseDrawBig(history, isUp, asset.color)}</div>
    <div id="bourse-next-tick" class="bourse-tick-info">⏱ Calcul...</div>
    <div class="bourse-buy-panel">
      <label class="bet-label">Montant à investir (VLX)</label>
      <div class="bet-row">
        <input type="number" id="bourse-invest-amount" class="bet-input" value="100" min="10"/>
        <div class="quick-bets">
          <button onclick="quickBet('bourse-invest-amount',0.5)">½</button>
          <button onclick="quickBet('bourse-invest-amount',2)">×2</button>
          <button onclick="setMax('bourse-invest-amount')">MAX</button>
        </div>
      </div>
      <button class="btn-play" onclick="bourseInvest()">📈 INVESTIR MAINTENANT</button>
    </div>`;
}

// ── Portefeuille personnel ────────────────────────────────────
function renderBoursePortfolio() {
  const container = document.getElementById("bourse-portfolio");
  if (!container) return;
  container.innerHTML = "";

  if (!bourseInvestments.length) {
    container.innerHTML = '<div class="bourse-empty">Aucun investissement actif.<br>Sélectionne un actif et investis !</div>';
    return;
  }

  container.innerHTML = '<div class="bourse-portfolio-title">📊 Mon Portefeuille</div>';

  bourseInvestments.forEach(inv => {
    const asset = BOURSE_ASSETS.find(a => a.id === inv.assetId);
    const data  = bourseMarketData?.assets?.[inv.assetId];
    if (!asset || !data) return;

    const currentValue = Math.round(inv.amount * (data.price / inv.purchasePrice));
    const profit       = currentValue - inv.amount;
    const pct          = ((data.price - inv.purchasePrice) / Math.max(inv.purchasePrice, 0.01) * 100).toFixed(2);
    const isUp         = profit >= 0;

    const el = document.createElement("div");
    el.className = "bourse-inv-row";
    el.style.borderLeftColor = asset.color;
    el.style.borderLeftWidth = "3px";
    el.innerHTML = `
      <div class="bir-left">
        <span class="bir-emoji">${asset.emoji}</span>
        <div>
          <div class="bir-name">${asset.name}</div>
          <div class="bir-detail">
            Investi : ${inv.amount.toLocaleString("fr-FR")} VLX<br>
            Achat : ${inv.purchasePrice.toFixed(2)} VLX · Actuel : ${data.price.toFixed(2)} VLX
          </div>
        </div>
      </div>
      <div class="bir-right">
        <div class="bir-value">${currentValue.toLocaleString("fr-FR")} VLX</div>
        <div class="bir-profit ${isUp ? "up" : "down"}">
          ${isUp ? "+" : ""}${profit.toLocaleString("fr-FR")} VLX (${isUp ? "+" : ""}${pct}%)
        </div>
        <button class="btn-bourse-sell" onclick="bourseSell('${inv.id}')">
          💰 VENDRE ${isUp ? "✅" : "📉"}
        </button>
      </div>`;
    container.appendChild(el);
  });
}

// ── Investir ─────────────────────────────────────────────────
window.bourseInvest = async function() {
  if (!bourseSelectedId || !bourseMarketData) return;
  const amount = parseBet("bourse-invest-amount");
  if (amount === null) return;

  const data = bourseMarketData.assets?.[bourseSelectedId];
  if (!data) { toast("Données du marché indisponibles", "lose"); return; }

  const investment = {
    id: `inv_${currentUser.uid}_${Date.now()}`,
    assetId: bourseSelectedId,
    amount,
    purchasePrice: data.price,
    timestamp: Date.now()
  };

  // Déduire immédiatement
  userData.balance -= amount;
  bourseInvestments.push(investment);

  try {
    await Promise.all([saveUserData(), saveBourseInvestments()]);
    const asset = BOURSE_ASSETS.find(a => a.id === bourseSelectedId);
    toast(`📈 ${amount} VLX investis dans ${asset.name} !`, "win");
    renderBoursePortfolio();
    // Mettre à jour l'affichage du solde dans le header
    const bi = document.getElementById("bourse-invest-amount");
    if (bi) bi.max = userData.balance;
  } catch(e) {
    // Rollback
    userData.balance += amount;
    bourseInvestments.pop();
    updateAllBalances();
    toast("Erreur lors de l'investissement", "lose");
  }
};

// ── Vendre ───────────────────────────────────────────────────
window.bourseSell = async function(invId) {
  const idx = bourseInvestments.findIndex(i => i.id === invId);
  if (idx === -1) return;

  const inv  = bourseInvestments[idx];
  const data = bourseMarketData?.assets?.[inv.assetId];
  if (!data) { toast("Données indisponibles, réessayez dans un instant", "lose"); return; }

  const currentValue = Math.round(inv.amount * (data.price / inv.purchasePrice));
  const profit       = currentValue - inv.amount;

  // Retirer de la liste et créditer
  bourseInvestments.splice(idx, 1);
  userData.balance += currentValue;
  userData.gamesPlayed++;

  try {
    await Promise.all([saveUserData(), saveBourseInvestments()]);
    const asset = BOURSE_ASSETS.find(a => a.id === inv.assetId);
    if (profit >= 0) {
      toast(`💰 ${asset.name} vendu : +${profit.toLocaleString("fr-FR")} VLX 🎉`, "win");
    } else {
      toast(`📉 ${asset.name} vendu : ${profit.toLocaleString("fr-FR")} VLX`, "lose");
    }
    renderBoursePortfolio();
  } catch(e) {
    // Rollback
    bourseInvestments.splice(idx, 0, inv);
    userData.balance -= currentValue;
    userData.gamesPlayed--;
    updateAllBalances();
    toast("Erreur lors de la vente", "lose");
  }
};

// ── Graphique miniature ───────────────────────────────────────
function bourseDrawMini(history, isUp) {
  if (!history || history.length < 2) return "";
  const W = 220, H = 40;
  const min = Math.min(...history);
  const max = Math.max(...history);
  const range = max - min || 1;
  const pts = history.map((v, i) => {
    const x = (i / (history.length - 1)) * W;
    const y = H - ((v - min) / range) * (H - 6) - 3;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const col = isUp ? "#27ae60" : "#e74c3c";
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:40px;display:block;">
    <polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}

// ── Grand graphique avec remplissage ─────────────────────────
function bourseDrawBig(history, isUp, color) {
  if (!history || history.length < 2) return "";
  const W = 500, H = 120;
  const min = Math.min(...history);
  const max = Math.max(...history);
  const range = max - min || 1;

  const pts = history.map((v, i) => {
    const x = (i / (history.length - 1)) * W;
    const y = H - ((v - min) / range) * (H - 12) - 6;
    return [x.toFixed(1), y.toFixed(1)];
  });

  const ptsStr  = pts.map(p => p.join(",")).join(" ");
  const firstPt = pts[0];
  const lastPt  = pts[pts.length - 1];
  const fillPath = `M ${firstPt[0]},${H} L ${firstPt[0]},${firstPt[1]} ${ptsStr} L ${lastPt[0]},${H} Z`;

  const lineCol = isUp ? "#27ae60" : "#e74c3c";
  const fillCol = isUp ? "rgba(39,174,96,.15)" : "rgba(231,76,60,.15)";

  // Ligne de prix actuel
  const lastY = lastPt[1];

  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:120px;display:block;">
    <defs>
      <linearGradient id="bgrd_${bourseSelectedId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${lineCol}" stop-opacity="0.25"/>
        <stop offset="100%" stop-color="${lineCol}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="${fillPath}" fill="url(#bgrd_${bourseSelectedId})"/>
    <polyline points="${ptsStr}" fill="none" stroke="${lineCol}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
    <line x1="0" y1="${lastY}" x2="${W}" y2="${lastY}" stroke="${lineCol}" stroke-width="0.5" stroke-dasharray="4,4" opacity="0.4"/>
    <circle cx="${lastPt[0]}" cy="${lastPt[1]}" r="3.5" fill="${lineCol}" opacity="0.9"/>
  </svg>`;
}

// ══════════════════════════════════════════════════════════════
//  UTILS
// ══════════════════════════════════════════════════════════════
function delay(ms){return new Promise(r=>setTimeout(r,ms));}
function shuffle(arr){for(let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];}}
