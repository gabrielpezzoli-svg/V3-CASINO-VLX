// ═════════════════════════════════════════════════════════════
//   ADMIN
// ═════════════════════════════════════════════════════════════
const ADMIN_ID = "GABRIEL";
const ADMIN_PW = "Gaby2023+*";
let adminLoggedIn = false;
let adminSelectedUser = null;
let allUsersData = [];

window.showAdminLogin = function() {
  const box = document.getElementById("admin-login-box");
  box.style.display = box.style.display === "none" ? "block" : "none";
};

window.tryAdminLogin = function() {
  const id = document.getElementById("admin-id-input").value.trim();
  const pw = document.getElementById("admin-pw-input").value;
  if (id === ADMIN_ID && pw === ADMIN_PW) {
    adminLoggedIn = true;
    loadAdminPanel();
    showPage("admin");
  } else {
    document.getElementById("admin-login-error").textContent = "Identifiant ou mot de passe incorrect.";
  }
};

async function loadAdminPanel() {
  const list = document.getElementById("admin-list");
  list.innerHTML = '<div class="lb-loading">Chargement...</div>';

  const { collection, query, orderBy, getDocs, limit } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

  const q = query(collection(db, "users"), orderBy("balance", "desc"));
  const snap = await getDocs(q);
  allUsersData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderAdminList();
}

function renderAdminList() {
  const list = document.getElementById("admin-list");
  list.innerHTML = "";
  allUsersData.forEach(u => {
    const e = document.createElement("div");
    e.className = "admin-entry" + (u.banned ? " admin-banned" : "");
    e.innerHTML = `
      <img class="lb-avatar" src="${u.avatar || ''}" onerror="this.style.display='none'" alt="">
      <span class="lb-name">${u.name || "Joueur"}${u.banned ? ' <span class="admin-ban-badge">BANNI</span>' : ''}</span>
      <span class="lb-balance" style="font-family:var(--ff-mono);color:var(--gold2)">${(u.balance || 0).toLocaleString("fr-FR")} VLX</span>
      <button class="btn-admin-manage" onclick="openAdminModal('${u.id}')">⚙ Gérer</button>
    `;
    list.appendChild(e);
  });
}

window.openAdminModal = function(uid) {
  adminSelectedUser = allUsersData.find(u => u.id === uid);
  if (!adminSelectedUser) return;
  document.getElementById("admin-modal-username").textContent = adminSelectedUser.name || "Joueur";
  document.getElementById("admin-modal-balance").textContent = (adminSelectedUser.balance || 0).toLocaleString("fr-FR") + " VLX";
  document.getElementById("admin-amount").value = "";
  document.getElementById("admin-modal").style.display = "flex";
};

window.closeAdminModal = function() {
  document.getElementById("admin-modal").style.display = "none";
  adminSelectedUser = null;
};

window.adminAdd = async function() {
  if (!adminSelectedUser) return;
  const amount = parseInt(document.getElementById("admin-amount").value);
  if (!amount || amount <= 0) { toast("Montant invalide", "lose"); return; }
  const newBal = (adminSelectedUser.balance || 0) + amount;
  await updateDoc(doc(db, "users", adminSelectedUser.id), { balance: newBal });
  adminSelectedUser.balance = newBal;
  const u = allUsersData.find(u => u.id === adminSelectedUser.id);
  if (u) u.balance = newBal;
  document.getElementById("admin-modal-balance").textContent = newBal.toLocaleString("fr-FR") + " VLX";
  renderAdminList();
  toast(`+${amount} VLX ajoutés à ${adminSelectedUser.name}`, "win");
};

window.adminRemove = async function() {
  if (!adminSelectedUser) return;
  const amount = parseInt(document.getElementById("admin-amount").value);
  if (!amount || amount <= 0) { toast("Montant invalide", "lose"); return; }
  const newBal = Math.max(0, (adminSelectedUser.balance || 0) - amount);
  await updateDoc(doc(db, "users", adminSelectedUser.id), { balance: newBal });
  adminSelectedUser.balance = newBal;
  const u = allUsersData.find(u => u.id === adminSelectedUser.id);
  if (u) u.balance = newBal;
  document.getElementById("admin-modal-balance").textContent = newBal.toLocaleString("fr-FR") + " VLX";
  renderAdminList();
  toast(`-${amount} VLX retirés de ${adminSelectedUser.name}`, "lose");
};

window.adminBan = async function() {
  if (!adminSelectedUser) return;
  if (!confirm(`Bannir ${adminSelectedUser.name} ?`)) return;
  await updateDoc(doc(db, "users", adminSelectedUser.id), { banned: true });
  const u = allUsersData.find(u => u.id === adminSelectedUser.id);
  if (u) u.banned = true;
  renderAdminList();
  closeAdminModal();
  toast(`${adminSelectedUser.name} a été banni`, "lose");
};

window.adminDelete = async function() {
  if (!adminSelectedUser) return;
  if (!confirm(`Supprimer définitivement le compte de ${adminSelectedUser.name} ?`)) return;
  const { deleteDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
  await deleteDoc(doc(db, "users", adminSelectedUser.id));
  allUsersData = allUsersData.filter(u => u.id !== adminSelectedUser.id);
  renderAdminList();
  closeAdminModal();
  toast(`Compte supprimé`, "lose");
};
