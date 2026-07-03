const GAUNTLET_HABILITADO = true;

const EL = {fuego:'#E8621A', tierra:'#7A9A3E', aire:'#4A9EFF', agua:'#2C6AA0'};
const STCSS = {
  agresivo:'background:rgba(216,90,48,.2);color:#F0997B', 
  defensivo:'background:rgba(15,110,86,.2);color:#5DCAA5', 
  tactico:'background:rgba(83,74,183,.2);color:#AFA9EC', 
  equilibrado:'background:rgba(55,138,221,.2);color:#85B7EB', 
  veneno:'background:rgba(83,150,40,.2);color:#9ECC5A', 
  caos:'background:rgba(212,83,126,.2);color:#ED93B1', 
  soporte:'background:rgba(130,80,180,.2);color:#CFA9EC'
};

let ws=null, myId=null, myName='', myBeast='', myRole='', oppName='', oppBeast='', battleId='';
let mySt={}, oppSt={}, pendingFrom=null, pendingIsTraining=false, pendingIs3v3=false;
let reconnectTimer=null, myWallet='', myCurrentHP=0, isKicked=false;
let myStats = { wins: 0, losses: 0, rank: null };
let gauntletBattleId = null, gauntletSelectedBeast = null;

let pendingChallengeTargetId = null;
let teamSelectionMode = '1v1'; 
let selectedTeam = []; 
let myTeam = [];
let isGauntletChallenge = false;
let lastMsgTime = Date.now(); 

let platformWalletAddress = ''; 

const audioFiles = {
    lobby: new Audio('Audio/lobby.mp3'),
    batalla: new Audio('Audio/batalla.mp3'),
    ataque: new Audio('Audio/ataque.mp3'),
    curacion: new Audio('Audio/curacion.mp3'),
    boton: new Audio('Audio/boton.mp3')
};
audioFiles.lobby.loop = true; audioFiles.lobby.volume = 0.3;
audioFiles.batalla.loop = true; audioFiles.batalla.volume = 0.3;
let currentMusic = null, isMuted = false, challengeBeepInterval = null;

function playMusic(track) { if (currentMusic === audioFiles[track]) return; if (currentMusic) currentMusic.pause(); currentMusic = audioFiles[track]; if (!isMuted) currentMusic.play().catch(e=>{}); }
function playSfx(track) { if (isMuted) return; const sfx = audioFiles[track]; if (!sfx) return; sfx.currentTime = 0; sfx.play().catch(e=>{}); }
function toggleMute() { isMuted = !isMuted; const btn = document.getElementById('btn-mute'); if (isMuted) { if (currentMusic) currentMusic.pause(); btn.textContent = '🔇'; } else { if (currentMusic) currentMusic.play().catch(e=>{}); btn.textContent = '🔊'; } }
function startChallengeBeep() { if (challengeBeepInterval) return; playSfx('boton'); challengeBeepInterval = setInterval(() => { playSfx('boton'); }, 1500); }
function stopChallengeBeep() { if (challengeBeepInterval) { clearInterval(challengeBeepInterval); challengeBeepInterval = null; } }
document.addEventListener('click', (e) => { if(e.target.closest('.btn')) playSfx('boton'); });

window.addEventListener('load', () => { 
  const btnG = document.getElementById('btn-gauntlet'); 
  if (btnG) btnG.style.display = GAUNTLET_HABILITADO ? 'inline-block' : 'none'; 
  fetchPlatformWallet(); 
});

async function fetchPlatformWallet() {
  try {
    const res = await fetch('/platform-wallet');
    const data = await res.json();
    if (data.wallet) {
      platformWalletAddress = data.wallet;
      const loginWalletSpan = document.querySelector('#step-charge div[onclick="copyWallet()"] span');
      if (loginWalletSpan) loginWalletSpan.textContent = platformWalletAddress;
    }
  } catch(e) { console.error("Error cargando wallet de plataforma:", e); }
}

async function disconnectWallet() { try { const phantom = getPhantom(); if (phantom && phantom.isConnected) await phantom.disconnect(); } catch(e) {} myWallet = ''; myName = ''; myBeast = ''; if(ws) { try { ws.close(); } catch(e){} } document.getElementById('btn-phantom').style.display='flex'; document.getElementById('wallet-connected').style.display='none'; document.getElementById('no-phantom').style.display='none'; document.getElementById('inp-name').value = ''; show('s-login'); }

function copyWallet() { 
  if (!platformWalletAddress) return alert('La wallet no se ha cargado aún.');
  navigator.clipboard.writeText(platformWalletAddress).then(() => { 
    alert('¡Dirección copiada! Envía USDC a esa wallet.'); 
  }).catch(() => alert('Dirección: ' + platformWalletAddress)); 
}

function depositWidgetHTML() { 
  const walletAddr = platformWalletAddress || 'Cargando...';
  return `<div style="background:rgba(74,158,255,.06);border:0.5px solid rgba(74,158,255,.2);border-radius:10px;padding:10px 12px"><div style="font-size:11px;color:#85B7EB;margin-bottom:4px">💡 Deposita USDC para obtener HP</div><div style="font-size:10px;color:rgba(255,255,255,.4);margin-bottom:7px">0.10 USDC = 100 HP · cualquier monto funciona</div><div style="display:flex;gap:6px;align-items:center"><div style="flex:1;background:rgba(0,0,0,.35);border-radius:6px;padding:6px 8px;font-family:monospace;font-size:9px;color:#85B7EB;word-break:break-all;cursor:pointer" onclick="copyWallet()">${walletAddr} <span style="color:rgba(255,255,255,.3)">📋</span></div><button class="btn btn-sm" style="font-size:10px;white-space:nowrap;padding:5px 10px" onclick="checkHPNow()">Verificar HP</button></div></div>`; 
}

function getPhantom() { return window.phantom?.solana || window.solana || null; }

async function connectPhantom() {
  await new Promise(r => setTimeout(r, 100));
  const phantom = getPhantom();
  if (!phantom || !phantom.isPhantom) {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const currentUrl = window.location.href;
    if (isMobile) { const deepLink = `https://phantom.app/ul/browse/${currentUrl}`; const noPhantomDiv = document.getElementById('no-phantom'); noPhantomDiv.style.display = 'block'; noPhantomDiv.innerHTML = `<div style="color:#F0997B; font-size:13px; line-height:1.5; text-align:left"><strong>📱 Para jugar desde tu móvil:</strong><br><br>1. Abre la app de <strong>Phantom</strong>.<br>2. Ve a <strong>"Descubrir" (🔍)</strong>.<br>3. Pega este enlace:<div style="background:rgba(0,0,0,.3); padding:8px; margin-top:8px; border-radius:6px; word-break:break-all; font-family:monospace; font-size:10px; color:#85B7EB; cursor:pointer; display:flex; justify-content:space-between; align-items:center" onclick="copyText('${currentUrl}')"><span>${currentUrl}</span><span style="margin-left:8px; white-space:nowrap">📋</span></div><br><button class="btn btn-blue btn-sm" style="width:100%; padding:10px" onclick="window.location.href='${deepLink}'">Intentar abrir automáticamente</button></div>`; document.getElementById('btn-phantom').style.display = 'none'; return; }
    document.getElementById('no-phantom').style.display='block';
    document.getElementById('no-phantom').innerHTML = 'Phantom no detectado. <a href="https://phantom.app" target="_blank" style="color:#F0997B;text-decoration:underline">Instalalo aqui</a>.';
    document.getElementById('btn-phantom').style.display='none'; return;
  }
  try {
    const resp = await phantom.connect();
    myWallet = resp.publicKey.toString();
    document.getElementById('btn-phantom').style.display='none';
    document.getElementById('wallet-connected').style.display='block';
    document.getElementById('wallet-addr').textContent = myWallet.slice(0,8)+'...'+myWallet.slice(-6);
    document.getElementById('wallet-hp').textContent = 'Verificando...';
    const sn = document.getElementById('step-name'); if(sn){ sn.style.opacity='1'; sn.style.pointerEvents='auto'; }
    await checkHPNow(true);
    const savedName = localStorage.getItem('vicamon_nick');
    if (savedName) {
      document.getElementById('inp-name').value = savedName;
      goProfile();
    }
  } catch(e) { console.error('Phantom error:', e); alert('No se pudo conectar Phantom.'); }
}
function copyText(text) { navigator.clipboard.writeText(text).then(() => alert('¡Enlace copiado!')).catch(() => alert('Copia este enlace manualmente: ' + text)); }
window.addEventListener('load', async () => { 
  await new Promise(r => setTimeout(r, 500)); 
  const ph2 = getPhantom(); 
  if (ph2?.isPhantom && ph2.isConnected) {
    try {
      const r2 = await ph2.connect({ onlyIfTrusted: true }); 
      myWallet = r2.publicKey.toString(); 
      document.getElementById('btn-phantom').style.display='none';
