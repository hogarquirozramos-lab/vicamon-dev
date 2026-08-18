var myWallet = '';
var myToken = null;
var myCurrentHP = 0;
var myCurrentVC = 0;
var myPhysicalBeasts = [];
var myStats = { wins: 0, losses: 0, rank: null, tier: 0 };
var platformWalletAddress = ''; 

function checkSession() {
  const token = localStorage.getItem('vicamon_token');
  if (token) {
    myToken = token;
    const savedName = localStorage.getItem('vicamon_nick') || 'Entrenador';
    myName = savedName;
    document.getElementById('auth-box').style.display = 'none';
    document.getElementById('step-name').style.display = 'block';
    document.getElementById('inp-name').value = savedName;
    goProfile();
  }
}

function openRegisterModal() {
  document.getElementById('modal-register').classList.remove('hidden');
  document.getElementById('inp-reg-email').focus();
}

function closeRegisterModal() {
  document.getElementById('modal-register').classList.add('hidden');
}

async function register() {
  const email = document.getElementById('inp-reg-email').value.trim();
  const password = document.getElementById('inp-reg-pass').value;
  if(!email || !password) return alert('Debes poner un correo y contraseña');
  if(password.length < 6) return alert('La contraseña debe tener al menos 6 caracteres');
  
  try {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, nick: email.split('@')[0] })
    });
    const data = await res.json();
    if(data.ok) {
      localStorage.setItem('vicamon_token', data.token);
      localStorage.setItem('vicamon_nick', data.user.nick);
      myToken = data.token;
      myName = data.user.nick;
      closeRegisterModal();
      location.reload(); 
    } else {
      alert('Error: ' + data.msg);
    }
  } catch(e) {
    alert('Error de conexión');
  }
}

async function login() {
  const email = document.getElementById('inp-email').value.trim();
  const password = document.getElementById('inp-password').value;
  if(!email || !password) return alert('Debes poner tu correo y contraseña');

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if(data.ok) {
      localStorage.setItem('vicamon_token', data.token);
      localStorage.setItem('vicamon_nick', data.user.nick);
      myToken = data.token;
      myName = data.user.nick;
      location.reload();
    } else {
      if (data.msg === 'Usuario no encontrado') {
        alert('Usuario no encontrado. Crea una cuenta para empezar.');
      } else {
        alert('Error: ' + data.msg);
      }
    }
  } catch(e) {
    alert('Error de conexión con el servidor');
  }
}

function logout() {
  localStorage.removeItem('vicamon_token');
  localStorage.removeItem('vicamon_nick');
  myToken = null;
  myName = '';
  if(ws) { try { ws.close(); } catch(e){} }
  location.reload();
}

function depositWidgetHTML() { return ''; } 

function getPhantom() { return window.phantom?.solana || window.solana || null; }
function copyWallet() { return; }
function openPhantomApp() { return; }
function closeMobileConnectModal() { return; }
function copyText(t) { return; }
function connectPhantom() { return; } 

window.addEventListener('load', async () => { 
  const btnG = document.getElementById('btn-gauntlet'); 
  if (btnG) { btnG.style.display = GAUNTLET_HABILITADO ? 'inline-block' : 'none'; btnG.disabled = true; }
});

async function checkHPNow(fromConnect=false) { 
  if (!myWallet) return; 
  try { 
    const res = await fetch('/hp?wallet='+myWallet); 
    const data = await res.json(); 
    const hp = data.hp || 0; 
    updateHPDisplay(hp); 
    if (data.stats) updateProfileUI(data.stats); 
    if(document.getElementById('s-lobby').classList.contains('active') && ws){ ws.send(JSON.stringify({type:'ping'})); } 
  } catch(e) { } 
}

function updateProfileUI(stats) { 
  if (stats) myStats = stats; 
  const nameEl = document.getElementById('profile-name'); 
  if (nameEl) { 
    nameEl.textContent = myName || 'Jugador'; 
    document.getElementById('profile-email').textContent = myWallet; 
    document.getElementById('profile-wins').textContent = myStats.wins || 0; 
    document.getElementById('profile-losses').textContent = myStats.losses || 0; 
    
    const tierNames = {
      0: { name: '🥚 VicaNoob', color: '#aaa' },
      1: { name: '👑 VicaLegend', color: '#F6E265' },
      2: { name: '🌌 VicaMaster', color: '#CFA9EC' },
      3: { name: '⚔️ VicaWarrior', color: '#85B7EB' },
      4: { name: '🛸 VicaExplorer', color: '#5DCAA5' },
      5: { name: '🎓 VicaTrainer', color: '#F0997B' }
    };
    
    const tierInfo = tierNames[myStats.tier || 0];
    const rankEl = document.getElementById('profile-rank');
    const tierEl = document.getElementById('profile-tier');
    if(rankEl) { rankEl.textContent = tierInfo.name; rankEl.style.color = tierInfo.color; }
    if(tierEl) { tierEl.textContent = tierInfo.name; tierEl.style.color = tierInfo.color; }
  } 
}

function updateHPDisplay(hp){ 
  myCurrentHP = hp || 0; 
  const hpEl=document.getElementById('profile-hp'); if(hpEl){ hpEl.textContent=hp+' HP'; hpEl.style.color=hp>=100?'#5DCAA5':'#EF9F27'; } 
  
  const vcEl=document.getElementById('profile-vc'); if(vcEl){ vcEl.textContent=myCurrentVC+' VC'; vcEl.style.color='#F6E265'; }
  
  const lobbyHp = document.getElementById('lbl-myhp'); 
  if(lobbyHp) lobbyHp.textContent = myCurrentHP + ' HP'; 
  
  const btnG = document.getElementById('btn-gauntlet'); 
  if (btnG && typeof GAUNTLET_HABILITADO !== 'undefined') { 
    btnG.style.display = 'inline-block'; 
    btnG.disabled = myCurrentHP < 100; 
    btnG.textContent = '🏰 Torre (100 HP)'; 
  } 
  
  if(document.getElementById('s-lobby')?.classList.contains('active')){ renderLobbyFromCache(); updateLobbyBadge(); }
  if (typeof calculateLabBalance === 'function') calculateLabBalance();
}

function doCashout(){ return; } 

function redeemPhysicalCode() { const input = document.getElementById('inp-physical-code'); const code = input.value.trim(); if(!code) return; if(ws && ws.readyState === 1) ws.send(JSON.stringify({type:'redeem_physical_code', code: code})); input.value = ''; }
function autoRedeemPhysicalCodes() { const codes = JSON.parse(localStorage.getItem('vicamon_physical_codes') || '[]'); codes.forEach(code => { if(ws && ws.readyState === 1) ws.send(JSON.stringify({type:'redeem_physical_code', code: code})); }); }
function updatePhysicalUI() { const list = document.getElementById('physical-beasts-list'); if(!list) return; if(myPhysicalBeasts.length === 0) { list.innerHTML = '<div style="font-size:11px;color:rgba(255,255,255,.3)">Ningún Vicamon físico invocado</div>'; return; } list.innerHTML = myPhysicalBeasts.map(k => { const b = BEASTS[k]; if(!b) return ''; return `<div style="background:rgba(246,226,102,.1);border:0.5px solid rgba(246,226,102,.3);border-radius:8px;padding:6px;display:flex;align-items:center;gap:6px"><img src="${b.img}" style="width:30px;height:30px;image-rendering:pixelated"><span style="font-size:12px;color:#F6E265;font-weight:600">${b.name}</span></div>`; }).join(''); }
