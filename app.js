var GAUNTLET_HABILITADO = true;

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

var ws=null, myId=null, myName='', myBeast='', myRole='', oppName='', oppBeast='', battleId='';
var mySt={}, oppSt={}, pendingFrom=null, pendingIsTraining=false, pendingIs3v3=false;
var reconnectTimer=null, isKicked=false;
var gauntletBattleId = null, gauntletSelectedBeast = null;
var qrScanner = null; 
var pendingChallengeTargetId = null;
var teamSelectionMode = '1v1'; 
var selectedTeam = []; 
var myTeam = [];
var isGauntletChallenge = false;
var isBoardChallenge = false; 
var lastMsgTime = Date.now(); 
window._boardRole = 'p1';

setInterval(() => { if (ws && ws.readyState === 1) { if (Date.now() - lastMsgTime > 25000) { console.log("WS timeout, forzando reconexión..."); try { ws.close(); } catch(e) {} return; } ws.send(JSON.stringify({type:'ping'})); } }, 10000);

function goProfile(){ if(!window.myToken){alert('Inicia sesión primero');return;} myName=document.getElementById('inp-name').value.trim(); if(!myName){alert('Escribe tu nombre de combate');return;} localStorage.setItem('vicamon_nick', myName); updateProfileUI(); if (typeof buildMyVicamonsProfile === 'function') buildMyVicamonsProfile(); autoRedeemPhysicalCodes(); show('s-profile'); updateHPDisplay(myCurrentHP); checkHPNow(false); if (!ws || ws.readyState !== 1) { connectWS(); } }

function enterLobby(){ if(ws && ws.readyState === 1) { show('s-lobby'); if (typeof buildBestiary === 'function') buildBestiary(); ws.send(JSON.stringify({type:'ping'})); } else { if(!myBeast) myBeast = 'aries'; connectWS(); } }
function connectWS(){ clearTimeout(reconnectTimer); isKicked=false; const proto=location.protocol==='https:'?'wss':'ws'; const localWs = new WebSocket(`${proto}://${location.host}`); localWs.onopen=()=>{ clearTimeout(reconnectTimer); lastMsgTime = Date.now(); localWs.send(JSON.stringify({type:'join', token: window.myToken, name:myName, beast:myBeast||'aries'})); }; localWs.onmessage=e=>{ lastMsgTime = Date.now(); try{handleMsg(JSON.parse(e.data));}catch(err){console.error(err);} }; localWs.onerror=()=>{}; localWs.onclose=()=>{ if(ws !== localWs) return; const inBattle=document.getElementById('s-battle').classList.contains('active'); if(!inBattle && !isKicked) reconnectTimer=setTimeout(()=>{ if(myName&&myBeast) connectWS(); },2000); }; ws = localWs; }

function handleMsg(m){
  if(m.type==='joined'){ myId=m.id; if(m.hp !== undefined) { updateHPDisplay(m.hp); myCurrentHP = m.hp; } if(m.vc !== undefined) { myCurrentVC = m.vc; updateHPDisplay(myCurrentHP); } if(m.wallet) window.myWallet = m.wallet; if(m.physicalBeasts) myPhysicalBeasts = m.physicalBeasts; updateLobbyBadge(); updateProfileUI(m.stats); if(document.getElementById('s-login').classList.contains('active') && !isKicked) show('s-lobby'); checkHPNow(false); updatePhysicalUI(); }
  if(m.type==='nickname_updated'){ myName = m.name; updateLobbyBadge(); }
  if(m.type==='kicked'){ isKicked=true; alert(m.msg); show('s-login'); if(ws) ws.close(); }
  if(m.type==='lobby'){ const others=m.players.filter(p=>p.id!==myId); document.getElementById('lbl-online').textContent=m.players.length; renderLobby(others); }
  if(m.type==='leaderboard_update'){ renderLeaderboard(m.top); }
  if(m.type==='chat_message'){ handleChatMessage(m); }
  
  if(m.type === 'tower_status') {
    const hpBtn = document.getElementById('btn-tower-hp');
    const trainBtn = document.getElementById('btn-tower-train');
    if(hpBtn) { hpBtn.disabled = myCurrentHP < 100; hpBtn.textContent = '⚔️ Torre VC (Costo: 100 HP)'; hpBtn.style.opacity = myCurrentHP < 100 ? '0.5' : '1'; }
    if(trainBtn) { 
        trainBtn.textContent = '📅 Torre Diaria (Costo: 50 HP)'; 
        if (!status.trainAvailable) { trainBtn.disabled = true; trainBtn.textContent = '🔒 Torre Diaria (Completada)'; trainBtn.style.opacity = '0.5'; }
        else { trainBtn.disabled = myCurrentHP < 50; trainBtn.style.opacity = myCurrentHP < 50 ? '0.5' : '1'; }
    }
  }

  if(m.type === 'tournament_state') { if (myTournamentMode === m.mode || (!myTournamentMode && document.getElementById('s-tournament').classList.contains('active'))) { handleTournamentState(m); } }
  if(m.type === 'tournament_wait') { alert(m.msg); }
  if(m.type === 'tournament_end') { alert(m.msg); myTournamentMode = null; show('s-lobby'); }

  if(m.type==='gauntlet_next'){ 
    gauntletBattleId = m.battleId; gauntletSelectedBeast = myBeast; const b = BEASTS[m.nextBeast]; 
    document.getElementById('g-title').textContent = `¡Jefe ${m.round - 1}/12 derrotado!`; 
    document.getElementById('g-sub').innerHTML = `El próximo rival es <strong style="color:#CFA9EC">${b.name}</strong> (${m.round}/12).`; 
    const picker = document.getElementById('g-beast-picker'); 
    const availableKeys = Object.entries(BEASTS).filter(([k,b]) => b.cat !== 'Físico' || (myPhysicalBeasts || []).includes(k));
    picker.innerHTML = availableKeys.map(([k,b])=>`<div class="bcard" id="gbc-${k}" style="padding:5px" onclick="selectGauntletBeast('${k}')"><img src="${b.img}" style="width:50px;height:50px"><div class="bname" style="font-size:10px">${b.name}</div></div>`).join(''); 
    document.getElementById('gbc-'+myBeast)?.classList.add('sel'); document.getElementById('modal-gauntlet').classList.remove('hidden'); return; 
  }
  if(m.type==='challenged'){ pendingFrom=m.fromId; pendingIsTraining = !!m.isTraining; pendingIs3v3 = false; const b=BEASTS[m.fromBeast]||{name:m.fromBeast,img:''}; document.getElementById('ch-img').src=b.img; document.getElementById('ch-title').textContent=`¡Reto de ${m.fromName}!`; document.getElementById('ch-sub').textContent=pendingIsTraining ? `${m.fromName} quiere un ENTRENAMIENTO 1v1.` : `${m.fromName} quiere una BATALLA POR HP 1v1 (100 HP).`; document.getElementById('modal-challenged').classList.remove('hidden'); startChallengeBeep(); }
  if(m.type==='challenged_3v3'){ pendingFrom=m.fromId; pendingIs3v3 = true; pendingIsTraining = !!m.isTraining; document.getElementById('ch-img').src='vicamon-logo.png'; document.getElementById('ch-title').textContent=`¡Reto 3v3 de ${m.fromName}!`; document.getElementById('ch-sub').textContent=pendingIsTraining ? `${m.fromName} quiere un ENTRENAMIENTO 3v3.` : `${m.fromName} quiere una BATALLA POR HP 3v3 (300 HP).`; document.getElementById('modal-challenged').classList.remove('hidden'); startChallengeBeep(); }
  if(m.type==='battle_start'){ battleId=m.battleId; myRole=m.role; oppName=m.opponent; oppBeast=m.opponentBeast; window._isTeamBattle = !!m.isTeamBattle; const empty={hp:100,maxHp:100,poisonDmg:0,poisonTurns:0,burnDmg:0,burnTurns:0,shield:0,shieldReflect:0,reflect50:0,stun:false,recharge:0,regen:0,regenTurns:0,blind:0,weakAtk:0,weaken:0,corrode:0,analyzed:0,lastDmgReceived:0,pp:[]}; mySt={...empty}; oppSt={...empty}; const isCpu=!!m.isCpu; const isTraining=!!m.isTraining; let startMsg = `¡Batalla por HP! ${myName} vs ${oppName}`; if(isTraining) startMsg = `¡Entrenamiento! ${myName} vs ${oppName}`; show('s-battle'); renderBattle(!isCpu,[{t:startMsg,c:'hi'}]); }
  if(m.type==='battle_state'){ const me=myRole==='p1'?m.p1:m.p2; const opp=myRole==='p1'?m.p2:m.p1; if (m.isTeamBattle) { mySt = me.activeState; oppSt = opp.activeState; myBeast = me.activeBeast; oppBeast = opp.activeBeast; window._myBench = me.bench; } else { myBeast = me.beast || myBeast; oppBeast = opp.beast || oppBeast; mySt=me.state; oppSt=opp.state; } const prevMyHp=mySt.hp, prevOppHp=oppSt.hp; if(mySt.hp<prevMyHp) animHit('me',prevMyHp-mySt.hp); if(oppSt.hp<prevOppHp) animHit('opp',prevOppHp-oppSt.hp); renderBattle(m.yourTurn,m.logs); }
  if(m.type === 'team_force_switch'){ openSwitchMenu(m.reason); }
  if(m.type==='hp_updated'){ updateHPDisplay(m.hp); myCurrentHP=m.hp||0; if(m.vc !== undefined) { myCurrentVC = m.vc; updateHPDisplay(myCurrentHP); } }
  if(m.type==='physical_code_success'){ if(!myPhysicalBeasts.includes(m.beast)) myPhysicalBeasts.push(m.beast); localStorage.setItem('vicamon_physical_codes', JSON.stringify((JSON.parse(localStorage.getItem('vicamon_physical_codes')||'[]')).concat(m.code).filter((v,i,a)=>a.indexOf(v)===i))); updatePhysicalUI(); buildBestiary(); playSfx('curacion'); }
  
  if(m.type === 'info'){ alert('ℹ️ ' + m.msg); }
  if(m.type==='error'){ alert('⚠ ' + m.msg); show('s-lobby'); }
  if(m.type==='opponent_disconnected'){ const turnBar = document.getElementById('turn-bar'); if(turnBar) turnBar.innerHTML = '<span style="color:#EF9F27">⏳ Rival desconectado. Esperando reconexión (60s)...</span>'; document.querySelectorAll('.atk-btn').forEach(btn => btn.disabled = true); }
  if(m.type==='opponent_reconnected'){ const turnBar = document.getElementById('turn-bar'); if(turnBar) turnBar.innerHTML = '<span>Turno del rival...</span>'; }
  if(m.type==='reconnect_battle'){ battleId = m.battleId; myRole = m.role; oppName = m.opponent; myId = m.id; myBeast = m.myBeast; oppBeast = m.oppBeast; window._isTeamBattle = !!m.isTeamBattle; show('s-battle'); const turnBar = document.getElementById('turn-bar'); if(turnBar) turnBar.innerHTML = '<span style="color:#5DCAA5">✓ ¡Reconectado con éxito! Sincronizando...</span>'; }
  
  if(m.type === 'full_leaderboard') { renderFullLeaderboard(m.list); }
  
  if(m.type==='battle_end'){ 
    const won=m.won; const isTrainingResult = m.isTraining === true; const isCpuResult = m.isCpu === true; const isGauntletResult = m.isGauntlet === true; const isTeamResult = m.isTeamBattle === true; const isTournamentResult = m.isTournament === true; 
    const newHp = m.newHp || 0; const newVC = m.newVC || 0; const hypHp = m.hypotheticalHp || 0; const hypVC = m.hypotheticalVC || 0; 
    if(m.stats) updateProfileUI(m.stats); show('s-result'); 
    if(!isCpuResult && !isTrainingResult && !isGauntletResult) updateHPDisplay(newHp); 
    if(isGauntletResult && won) updateHPDisplay(newHp); 
    if(isTeamResult && !isTrainingResult) updateHPDisplay(newHp); 
    
    let resultBody=''; 
    if(isTournamentResult){
       let btnText = 'Volver al Lobby'; let btnAction = "show('s-lobby'); myTournamentMode = null;";
       if (won && m.waitForNext) { btnText = 'Ir a la Sala del Torneo'; btnAction = "show('s-tournament');"; }
       resultBody=`<div style="background:rgba(246,226,102,.1);border:0.5px solid rgba(246,226,102,.3);border-radius:10px;padding:14px;margin:14px 0;text-align:center"><div style="font-size:20px">${won ? '🏆' : '💀'}</div><div style="color:${won ? '#F6E265' : '#F0997B'};font-weight:700;margin-top:5px">${won ? '¡Victoria en el Torneo!' : 'Derrota en el Torneo'}</div><div style="color:rgba(255,255,255,.8);margin-top:8px;font-size:14px">${m.customMsg || ''}</div></div>`;
       document.getElementById('result-box').innerHTML=`<div class="r-icon">${won ? '🏆' : '💀'}</div><div class="r-title">${won ? '¡Victoria!' : 'Derrota'}</div>${resultBody}<button class="btn btn-blue" onclick="${btnAction}">${btnText}</button>`;
    }
    else if(isTrainingResult || isCpuResult){ 
      if(won){ resultBody=`<div style="background:rgba(93,202,165,.08);border-radius:10px;padding:14px;margin:14px 0;text-align:center"><div style="font-size:20px">&#127891;</div><div style="color:#5DCAA5">Entrenamiento</div><div style="font-size:14px;color:#F6E265;margin-top:8px">Si fuera real habrías ganado:</div><div style="color:#5DCAA5;margin-top:4px">+${hypHp} HP</div><div style="color:#F6E265">+${hypVC} VC</div></div>`; } 
      else { resultBody=`<div style="background:rgba(240,153,122,.08);border-radius:10px;padding:14px;margin:14px 0;text-align:center"><div style="font-size:20px">&#127891;</div><div style="color:#F0997B">Derrota en Entrenamiento</div><div style="font-size:14px;color:#aaa;margin-top:8px">Si fuera real habrías perdido HP, pero recibido:</div><div style="color:#F6E265;margin-top:4px">+${hypVC} VC de consuelo</div></div>`; } 
    } 
    else if(isGauntletResult){ 
      let resultText = '';
      if (m.customMsg) { resultText = `<div style="font-size:14px;color:#F6E265;margin-top:8px;font-weight:700">${m.customMsg}</div>`; }
      if(won){ resultBody=`<div style="background:rgba(246, 226, 102, 0.1);border-radius:10px;padding:14px;margin:14px 0;text-align:center"><div style="color:#F6E265">¡Torre Completada!</div>${resultText}</div>`; } 
      else { resultBody=`<div style="background:rgba(255,255,255,.05);border-radius:10px;padding:14px;margin:14px 0;text-align:center"><div style="color:#F0997B">Torre Fallida</div><div style="color:#CFA9EC;margin-top:8px">Derrotaste ${m.defeated || 0} Vicamons</div>${resultText}</div>`; } 
    }
    else if(isTeamResult){ 
      if(won){ resultBody=`<div style="background:rgba(255,255,255,.05);border-radius:10px;padding:14px;margin:14px 0"><div>Batalla por HP</div><div style="color:#5DCAA5;margin-top:8px">¡Victoria!</div><div style="color:#F6E265;margin-top:4px">+${newVC} VC (HP restante)</div><div style="color:#fff;margin-top:8px;font-weight:700">Total HP: ${newHp}</div></div>`; } 
      else { resultBody=`<div style="background:rgba(255,255,255,.05);border-radius:10px;padding:14px;margin:14px 0"><div>Batalla por HP</div><div style="color:#F0997B;margin-top:8px">Derrota</div><div style="color:#F6E265;margin-top:4px">+${newVC} VC (Consuelo)</div><div style="color:#fff;margin-top:8px;font-weight:700">Total HP: ${newHp}</div></div>`; } 
    } 
    else if(won){ resultBody=`<div style="background:rgba(255,255,255,.05);border-radius:10px;padding:14px;margin:14px 0"><div>¡Victoria!</div><div style="color:#5DCAA5;margin-top:8px">+100 HP (Apuesta del rival)</div><div style="color:#F6E265;margin-top:4px">+${newVC} VC (HP restante)</div><div style="color:#fff;margin-top:8px;font-weight:700">Total HP: ${newHp}</div></div>`; } 
    else { resultBody=`<div style="background:rgba(255,255,255,.05);border-radius:10px;padding:14px;margin:14px 0"><div>Derrota</div><div style="color:#F0997B;margin-top:8px">-100 HP (Apuesta perdida)</div><div style="color:#F6E265;margin-top:4px">+${newVC} VC (Consuelo)</div><div style="color:#fff;margin-top:8px;font-weight:700">Total HP: ${newHp}</div></div>`; } 
    
    if (!isTournamentResult) {
        const icon = won ? '🏆' : '💀'; const title = won ? '¡Victoria!' : 'Derrota'; 
        document.getElementById('result-box').innerHTML=`<div class="r-icon">${icon}</div><div class="r-title">${title}</div>${resultBody}<button class="btn btn-blue" style="margin-top:10px;" onclick="backToLobby()">Volver</button>`; 
    }
    window._isTeamBattle = false; 
  }
}

function checkBeastsAndInit() {
  if (window.BEASTS) { document.getElementById('inp-name').addEventListener('keydown',e=>{if(e.key==='Enter')goProfile();}); } 
  else { setTimeout(checkBeastsAndInit, 50); }
}
checkBeastsAndInit();
