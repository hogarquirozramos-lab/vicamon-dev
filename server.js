const http = require('http');
const fs   = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const {
  getHP, addHP, hasHP, lockHP, unlockHP, settleMatch, cashout,
  getPlatformHp, getPlatformUsdc, clearPlatformHp,
  PLATFORM_WALLET, PLATFORM_THRESHOLD, USDC_PER_HP,
  getAllPlayersDebug, updatePlayerName, updatePlayerStats, getTopPlayers,
  getPlayerStats, getPlayerRank, settleGauntlet,
  isTxProcessed, markTxProcessed, adminSetHP, adminResetPlatform, adminUnlockAllHP
} = require('./hp-balance');
const { sendUSDC } = require('./transfer');
const BEASTS = require('./beasts.js');
const BEAST_KEYS = Object.keys(BEASTS);

const { lobby, battles, uid, send, broadcast, pushLobby, pushBattle, pushCpuBattle } = require('./state');
const { getStartState, processTurn, endBattle } = require('./battleEngine');
const { CPU_ID, processCpuPlayerTurn, scheduleCpuTurn } = require('./cpuLogic');
const { processGauntletPlayerTurn, endGauntlet, scheduleGauntletCpuTurn } = require('./gauntletManager');
const { pushTeamBattle, processTeamTurn, processTeamSwitch, processTeamCpuPlayerTurn, endTeamBattle } = require('./teamEngine');

// Usamos la variable que ya tienes configurada en Render
const ADMIN_PASS = process.env.ADMIN_PASSWORD || process.env.INTERNAL_SECRET || 'vicamon_secret_key_07012010';

async function getPlatformUSDCBalance() {
  const { Connection, PublicKey } = require('@solana/web3.js');
  const PLATFORM_TA = '4pxEcSJPaC1baZp8pGtpnwmMCcZnU3T6UrVyv577n3Di';
  const RPCS = ['https://api.mainnet-beta.solana.com', 'https://solana-mainnet.rpc.extrnode.com', 'https://solana.public-rpc.com'];
  for (const rpc of RPCS) { try { const conn = new Connection(rpc, 'confirmed'); const info = await conn.getTokenAccountBalance(new PublicKey(PLATFORM_TA)); return parseFloat(info.value.uiAmount || 0); } catch(e) {} }
  return 0;
}

const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.png':'image/png', '.jpg':'image/jpeg', '.gif':'image/gif', '.svg':'image/svg+xml', '.ico':'image/x-icon' };

const server = http.createServer(async (req, res) => {
  const urlPath = req.url.split('?')[0];
  
  if (urlPath === '/ver-db-secreta') { try { const players = await getAllPlayersDebug(); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(players, null, 2)); } catch(e) { res.writeHead(500); res.end('Error leyendo DB'); } return; }
  
  if (urlPath === '/admin') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html lang="es"><head><meta charset="UTF-8"><title>Admin - VICAMON</title>
      <style>
        body { font-family: system-ui; background: #0a0a0f; color: #fff; padding: 20px; max-width: 1000px; margin: 0 auto; }
        .header { display: flex; gap: 10px; margin-bottom: 20px; align-items: center; }
        input, button { background: #1a1a24; border: 1px solid #333; color: #fff; padding: 10px; border-radius: 8px; outline: none; }
        button { cursor: pointer; background: #4a9eff; border: none; font-weight: bold; }
        .plat-info { background: #14141e; padding: 15px; border-radius: 12px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; }
        .plat-info span { font-size: 14px; color: #85B7EB; }
        .plat-info b { font-size: 18px; color: #5DCAA5; }
        table { width: 100%; border-collapse: collapse; background: #14141e; border-radius: 12px; overflow: hidden; }
        th, td { padding: 12px; border-bottom: 1px solid #2a2a35; text-align: left; font-size: 14px; }
        th { color: #85B7EB; text-transform: uppercase; font-size: 12px; }
        td input { width: 80px; padding: 5px; background: #111; border: 1px solid #333; text-align: center; color: #fff; border-radius: 4px; }
        .btn-save { background: #5DCAA5; padding: 8px 16px; color: #000; }
        .admin-actions { margin-top: 20px; display: flex; gap: 10px; }
      </style></head><body>
        <h1>Panel de Administración</h1>
        <div class="header">
          <input type="password" id="pass" placeholder="Contraseña de admin">
          <button onclick="loadData()">Desbloquear y Cargar</button>
        </div>
        <div class="plat-info" id="plat-info" style="display:none">
          <span>HP Ganados por la Plataforma (Comisiones):</span>
          <b id="plat-hp">-</b>
        </div>
        <table id="tbl" style="display:none">
          <thead><tr><th>Wallet</th><th>Nickname</th><th>HP</th><th>HP Bloqueados</th><th>Acción</th></tr></thead>
          <tbody id="data"></tbody>
        </table>
        <div class="admin-actions">
          <button onclick="resetPlatformHP()" style="display:none" id="btn-reset-plat">Resetear HP Plataforma</button>
          <button onclick="unlockAllHP()" style="display:none" id="btn-unlock-hp">Desbloquear HP de todos</button>
        </div>
        <script>
          let globalPass = '';
          async function loadData() {
            globalPass = document.getElementById('pass').value;
            if(!globalPass) return alert('Ingresa la contraseña');
            const res = await fetch('/admin-data?pass=' + encodeURIComponent(globalPass));
            if(!res.ok) { alert('Contraseña incorrecta'); return; }
            const data = await res.json();
            document.getElementById('plat-info').style.display = 'flex';
            document.getElementById('tbl').style.display = 'table';
            document.getElementById('btn-reset-plat').style.display = 'block';
            document.getElementById('btn-unlock-hp').style.display = 'block';
            document.getElementById('plat-hp').textContent = data.platformHp + ' HP (' + (data.platformHp * 0.001) + ' USDC)';
            document.getElementById('data').innerHTML = data.players.map(p => \`
              <tr>
                <td>\${p.wallet.slice(0,8)}...\${p.wallet.slice(-4)}</td>
                <td>\${p.last_name || '-'}</td>
                <td><input type="number" value="\${p.hp}" id="hp-\${p.wallet}"></td>
                <td>\${p.locked_hp || 0}</td>
                <td><button class="btn-save" onclick="saveHP('\${p.wallet}')">Guardar</button></td>
              </tr>
            \`).join('');
          }
          async function saveHP(wallet) {
            const hp = document.getElementById('hp-' + wallet).value;
            const res = await fetch('/admin-update-hp', {
              method: 'POST', headers: {'Content-Type':'application/json'},
              body: JSON.stringify({ pass: globalPass, wallet, hp: parseInt(hp) })
            });
            const data = await res.json();
            if(data.ok) alert('✓ HP actualizado a ' + hp); else alert('Error al actualizar');
          }
          async function resetPlatformHP() {
            if(!confirm('¿Resetear los HP de la plataforma a 0?')) return;
            const res = await fetch('/admin-reset-platform', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ pass: globalPass }) });
            if(res.ok) alert('✓ HP de la plataforma reseteados.');
          }
          async function unlockAllHP() {
            if(!confirm('¿Desbloquear todos los HP de jugadores? (Solo usar si hay bug)')) return;
            const res = await fetch('/admin-unlock-hp', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ pass: globalPass }) });
            if(res.ok) alert('✓ HP desbloqueados.');
          }
        </script>
      </body></html>
    `);
    return;
  }

  if (urlPath === '/admin-data') {
    const pass = new URL(req.url, 'http://localhost').searchParams.get('pass') || '';
    if (pass !== ADMIN_PASS) { res.writeHead(403); res.end('Forbidden'); return; }
    try {
      const players = await getAllPlayersDebug();
      const platformHp = await getPlatformHp(); 
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ players, platformHp })); 
    } catch(e) { res.writeHead(500); res.end('Error'); }
    return;
  }

  if (urlPath === '/admin-update-hp' && req.method === 'POST') {
    let body = ''; req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { pass, wallet, hp } = JSON.parse(body);
        if (pass !== ADMIN_PASS) { res.writeHead(403); res.end(JSON.stringify({ ok: false })); return; }
        await adminSetHP(wallet, parseInt(hp));
        res.writeHead(200); res.end(JSON.stringify({ ok: true }));
      } catch(e) { res.writeHead(400); res.end(JSON.stringify({ ok: false })); }
    });
    return;
  }
  if (urlPath === '/admin-reset-platform' && req.method === 'POST') {
    let body = ''; req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { pass } = JSON.parse(body);
        if (pass !== ADMIN_PASS) { res.writeHead(403); res.end(JSON.stringify({ ok: false })); return; }
        await adminResetPlatform();
        res.writeHead(200); res.end(JSON.stringify({ ok: true }));
      } catch(e) { res.writeHead(400); res.end(JSON.stringify({ ok: false })); }
    });
    return;
  }
  if (urlPath === '/admin-unlock-hp' && req.method === 'POST') {
    let body = ''; req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { pass } = JSON.parse(body);
        if (pass !== ADMIN_PASS) { res.writeHead(403); res.end(JSON.stringify({ ok: false })); return; }
        await adminUnlockAllHP();
        res.writeHead(200); res.end(JSON.stringify({ ok: true }));
      } catch(e) { res.writeHead(400); res.end(JSON.stringify({ ok: false })); }
    });
    return;
  }

  if (urlPath === '/hp') { const wallet = new URL(req.url, 'http://localhost').searchParams.get('wallet') || ''; const hp = await getHP(wallet); const stats = await getPlayerStats(wallet); const rank = await getPlayerRank(wallet); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ hp, wallet, stats: { wins: stats.wins, losses: stats.losses, rank } })); return; }
  
  if (urlPath === '/payment' && req.method === 'POST') {
    const secret = req.headers['x-internal-secret'];
    if (secret !== (process.env.INTERNAL_SECRET || 'dev-secret')) { res.writeHead(403); res.end(JSON.stringify({ error: 'Forbidden' })); return; }
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { wallet, amount, signature, memo } = JSON.parse(body);
        if (await isTxProcessed(signature)) { res.writeHead(200); res.end(JSON.stringify({ ok: false, reason: 'duplicate' })); return; }
        const hp = Math.round((amount / 100_000) * 100);
        const newBalance = await addHP(wallet, hp);
        lobby.forEach(p => { if (p.wallet === wallet) send(p.ws, { type: 'hp_updated', hp: newBalance }); });
        await markTxProcessed(signature);
        res.writeHead(200); res.end(JSON.stringify({ ok: true, wallet, hp, newBalance }));
        checkPlatformTransfer();
      } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }
  
  const file = urlPath === '/' ? '/index.html' : urlPath;
  const fp = path.join(__dirname, file);
  fs.readFile(fp, (err, data) => { if (err) { res.writeHead(404); res.end('Not found'); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' }); res.end(data); });
});

const wss = new WebSocketServer({ server });

async function checkPlatformTransfer() {
  const usdc = await getPlatformUsdc();
  if (usdc < PLATFORM_THRESHOLD) return;
  try { const sig = await sendUSDC(PLATFORM_WALLET, usdc); const hpCleared = Math.round(usdc / USDC_PER_HP); await clearPlatformHp(hpCleared); } catch (e) {}
}

wss.on('connection', ws => {
  const id = uid();

  ws.on('message', async raw => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    try {
      if (msg.type === 'join') {
        const wallet = msg.wallet || '';
        for (const [oldId, p] of lobby) {
          if (p.wallet === wallet && oldId !== id) {
            send(p.ws, { type: 'kicked', msg: 'Tu wallet se conectó en otra pestaña.' });
            if (!p.inBattle) lobby.delete(oldId);
            try { p.ws.close(); } catch(e) {}
          }
        }
        lobby.set(id, { ws, name: msg.name, beast: msg.beast, wallet, inBattle: false, id });
        await updatePlayerName(wallet, msg.name);
        const hp = await getHP(wallet);
        const stats = await getPlayerStats(wallet);
        const rank = await getPlayerRank(wallet);
        send(ws, { type: 'joined', id, hp, stats: { wins: stats.wins, losses: stats.losses, rank } });
        const top = await getTopPlayers(3);
        send(ws, { type: 'leaderboard_update', top });
        await pushLobby();
      }

      if (msg.type === 'change_beast') { const p = lobby.get(id); if (p && !p.inBattle) { p.beast = msg.beast; await pushLobby(); } }
      if (msg.type === 'update_nickname') { 
        const p = lobby.get(id); if (p) { 
          p.name = msg.name; 
          await updatePlayerName(p.wallet, msg.name); 
          await pushLobby(); 
          send(ws, { type: 'nickname_updated', name: msg.name });
        } 
      }

      if (msg.type === 'challenge') {
        const challenger = lobby.get(id); const target = lobby.get(msg.targetId);
        if (!challenger || !target || target.inBattle || challenger.inBattle) return;
        const challengerHP = await getHP(challenger.wallet); const targetHP = await getHP(target.wallet);
        if (challengerHP < 100) { send(ws, { type: 'error', msg: `Necesitas 100 HP.` }); return; }
        if (targetHP < 100) { send(ws, { type: 'error', msg: `Ese jugador no tiene 100 HP.` }); return; }
        send(target.ws, { type: 'challenged', fromId: id, fromName: challenger.name, fromBeast: challenger.beast, isTraining: false });
      }
      if (msg.type === 'challenge_training') {
        const challenger = lobby.get(id); const target = lobby.get(msg.targetId);
        if (!challenger || !target || target.inBattle || challenger.inBattle) return;
        send(target.ws, { type: 'challenged', fromId: id, fromName: challenger.name, fromBeast: challenger.beast, isTraining: true });
      }
      if (msg.type === 'accept') {
        const p1 = lobby.get(msg.fromId), p2 = lobby.get(id);
        if (!p1 || !p2 || p1.inBattle || p2.inBattle) return;
        if (msg.isTraining) {
          p1.inBattle = true; p2.inBattle = true;
          const bId = `btrain${uid()}`;
          battles.set(bId, { p1id: msg.fromId, p2id: id, st1: getStartState(p1.beast), st2: getStartState(p2.beast), turnId: msg.fromId, logs: [{t: `¡Entrenamiento 1v1!`, c: 'hi'}], isTraining: true });
          send(p1.ws, { type: 'battle_start', battleId: bId, role: 'p1', opponent: p2.name, opponentBeast: p2.beast, isTraining: true });
          send(p2.ws, { type: 'battle_start', battleId: bId, role: 'p2', opponent: p1.name, opponentBeast: p1.beast, isTraining: true });
          await pushLobby(); setTimeout(() => pushBattle(bId), 120);
        } else {
          if (!await hasHP(p1.wallet, 100) || !await hasHP(p2.wallet, 100)) { send(p1.ws, { type: 'error', msg: 'Fondos insuficientes.' }); return; }
          await lockHP(p1.wallet, 100); await lockHP(p2.wallet, 100);
          p1.inBattle = true; p2.inBattle = true;
          const bId = `b${uid()}`;
          battles.set(bId, { p1id: msg.fromId, p2id: id, st1: getStartState(p1.beast), st2: getStartState(p2.beast), turnId: msg.fromId, logs: [], isCpu: false });
          battles.get(bId).logs.push({t: `¡Combate 1v1!`, c: 'hi'});
          send(p1.ws, { type: 'battle_start', battleId: bId, role: 'p1', opponent: p2.name, opponentBeast: p2.beast });
          send(p2.ws, { type: 'battle_start', battleId: bId, role: 'p2', opponent: p1.name, opponentBeast: p1.beast });
          await pushLobby(); setTimeout(() => pushBattle(bId), 120);
        }
      }

      if (msg.type === 'challenge_3v3') {
        const challenger = lobby.get(id); const target = lobby.get(msg.targetId);
        if (!challenger || !target || target.inBattle || challenger.inBattle) return;
        const challengerHP = await getHP(challenger.wallet); const targetHP = await getHP(target.wallet);
        if (challengerHP < 300) { send(ws, { type: 'error', msg: `Necesitas 300 HP.` }); return; }
        if (targetHP < 300) { send(ws, { type: 'error', msg: `Ese jugador no tiene 300 HP.` }); return; }
        challenger.team = msg.team;
        send(target.ws, { type: 'challenged_3v3', fromId: id, fromName: challenger.name, isTraining: false });
      }
      if (msg.type === 'challenge_3v3_training') {
        const challenger = lobby.get(id); const target = lobby.get(msg.targetId);
        if (!challenger || !target || target.inBattle || challenger.inBattle) return;
        challenger.team = msg.team;
        send(target.ws, { type: 'challenged_3v3', fromId: id, fromName: challenger.name, isTraining: true });
      }
      if (msg.type === 'accept_3v3') {
        const p1 = lobby.get(msg.fromId), p2 = lobby.get(id);
        if (!p1 || !p2 || p1.inBattle || p2.inBattle) return;
        p2.team = msg.team;
        if (!msg.isTraining) {
          if (!await hasHP(p1.wallet, 300) || !await hasHP(p2.wallet, 300)) { send(p1.ws, { type: 'error', msg: 'Fondos insuficientes para 3v3.' }); return; }
          await lockHP(p1.wallet, 300); await lock
