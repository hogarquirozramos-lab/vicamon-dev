const http = require('http');
const fs   = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const {
  getHP, addHP, hasHP, lockHP, unlockHP, settleMatch, cashout,
  getPlatformHp, getPlatformUsdc, clearPlatformHp,
  PLATFORM_WALLET, PLATFORM_THRESHOLD, USDC_PER_HP,
  getAllPlayersDebug, updatePlayerName, updatePlayerStats, getTopPlayers,
  getPlayerStats, getPlayerRank, settleGauntlet
} = require('./hp-balance');
const { sendUSDC } = require('./transfer');
const BEASTS = require('./beasts.js');
const BEAST_KEYS = Object.keys(BEASTS);

// IMPORTAR MÓDULOS
const { lobby, battles, processedTx, uid, send, broadcast, pushLobby, pushBattle, pushCpuBattle } = require('./state');
const { getStartState, processTurn, endBattle } = require('./battleEngine');
const { CPU_ID, processCpuPlayerTurn, scheduleCpuTurn } = require('./cpuLogic');
const { processGauntletPlayerTurn, endGauntlet, scheduleGauntletCpuTurn } = require('./gauntletManager');
const { pushTeamBattle, processTeamTurn, processTeamSwitch, endTeamBattle } = require('./teamEngine'); // NUEVO

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
  if (urlPath === '/hp') { const wallet = new URL(req.url, 'http://localhost').searchParams.get('wallet') || ''; const hp = await getHP(wallet); const stats = await getPlayerStats(wallet); const rank = await getPlayerRank(wallet); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ hp, wallet, stats: { wins: stats.wins, losses: stats.losses, rank } })); return; }
  if (urlPath === '/payment' && req.method === 'POST') {
    const secret = req.headers['x-internal-secret'];
    if (secret !== (process.env.INTERNAL_SECRET || 'dev-secret')) { res.writeHead(403); res.end(JSON.stringify({ error: 'Forbidden' })); return; }
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { wallet, amount, signature, memo } = JSON.parse(body);
        if (processedTx.has(signature)) { res.writeHead(200); res.end(JSON.stringify({ ok: false, reason: 'duplicate' })); return; }
        processedTx.add(signature);
        const hp = Math.round((amount / 100_000) * 100);
        const newBalance = await addHP(wallet, hp);
        lobby.forEach(p => { if (p.wallet === wallet) send(p.ws, { type: 'hp_updated', hp: newBalance }); });
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

    if (msg.type === 'join') {
      const wallet = msg.wallet || '';
      for (const [oldId, p] of lobby) {
        if (p.wallet === wallet && oldId !== id) {
          send(p.ws, { type: 'kicked', msg: 'Tu wallet se conectó en otra pestaña. Esta sesión se cerrará.' });
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

    if (msg.type === 'change_beast') {
      const p = lobby.get(id);
      if (p && !p.inBattle) { p.beast = msg.beast; await pushLobby(); }
    }

    // --- 1v1 ---
    if (msg.type === 'challenge') {
      const challenger = lobby.get(id); const target = lobby.get(msg.targetId);
      if (!challenger || !target || target.inBattle || challenger.inBattle) return;
      const challengerHP = await getHP(challenger.wallet); const targetHP = await getHP(target.wallet);
      if (challengerHP < 100) { send(ws, { type: 'error', msg: `Necesitas al menos 100 HP para retar. Tienes ${challengerHP} HP.` }); return; }
      if (targetHP < 100) { send(ws, { type: 'error', msg: `Ese jugador solo tiene ${targetHP} HP, necesita mínimo 100 HP.` }); return; }
      send(target.ws, { type: 'challenged', fromId: id, fromName: challenger.name, fromBeast: challenger.beast, isTraining: false });
    }

    if (msg.type === 'accept') {
      const p1 = lobby.get(msg.fromId), p2 = lobby.get(id);
      if (!p1 || !p2 || p1.inBattle || p2.inBattle) return;
      if (msg.isTraining) {
        p1.inBattle = true; p2.inBattle = true;
        const bId = `btrain${uid()}`;
        battles.set(bId, { p1id: msg.fromId, p2id: id, st1: getStartState(p1.beast), st2: getStartState(p2.beast), turnId: msg.fromId, logs: [{t: `¡Entrenamiento amistoso! ${p1.name} vs ${p2.name}`, c: 'hi'}], isTraining: true });
        send(p1.ws, { type: 'battle_start', battleId: bId, role: 'p1', opponent: p2.name, opponentBeast: p2.beast, isTraining: true });
        send(p2.ws, { type: 'battle_start', battleId: bId, role: 'p2', opponent: p1.name, opponentBeast: p1.beast, isTraining: true });
        await pushLobby(); setTimeout(() => pushBattle(bId), 120);
      } else {
        if (!await hasHP(p1.wallet, 100) || !await hasHP(p2.wallet, 100)) { send(p1.ws, { type: 'error', msg: 'Fondos insuficientes para iniciar la batalla.' }); return; }
        await lockHP(p1.wallet, 100); await lockHP(p2.wallet, 100);
        p1.inBattle = true; p2.inBattle = true;
        const bId = `b${uid()}`;
        battles.set(bId, { p1id: msg.fromId, p2id: id, st1: getStartState(p1.beast), st2: getStartState(p2.beast), turnId: msg.fromId, logs: [], isCpu: false });
        battles.get(bId).logs.push({t: `¡Combate! ${p1.name} vs ${p2.name}`, c: 'hi'});
        send(p1.ws, { type: 'battle_start', battleId: bId, role: 'p1', opponent: p2.name, opponentBeast: p2.beast });
        send(p2.ws, { type: 'battle_start', battleId: bId, role: 'p2', opponent: p1.name, opponentBeast: p1.beast });
        await pushLobby(); setTimeout(() => pushBattle(bId), 120);
      }
    }

    // --- 3v3 (NUEVO) ---
    if (msg.type === 'challenge_3v3') {
      const challenger = lobby.get(id); const target = lobby.get(msg.targetId);
      if (!challenger || !target || target.inBattle || challenger.inBattle) return;
      const challengerHP = await getHP(challenger.wallet); const targetHP = await getHP(target.wallet);
      if (challengerHP < 300) { send(ws, { type: 'error', msg: `Necesitas 300 HP para 3v3. Tienes ${challengerHP} HP.` }); return; }
      if (targetHP < 300) { send(ws, { type: 'error', msg: `Ese jugador solo tiene ${targetHP} HP, necesita 300 HP.` }); return; }
      challenger.team = msg.team; // Guardar equipo temporalmente
      send(target.ws, { type: 'challenged_3v3', fromId: id, fromName: challenger.name });
    }

    if (msg.type === 'accept_3v3') {
      const p1 = lobby.get(msg.fromId), p2 = lobby.get(id);
      if (!p1 || !p2 || p1.inBattle || p2.inBattle) return;
      if (!await hasHP(p1.wallet, 300) || !await hasHP(p2.wallet, 300)) { send(p1.ws, { type: 'error', msg: 'Fondos insuficientes para iniciar la batalla 3v3.' }); return; }
      
      await lockHP(p1.wallet, 300); await lockHP(p2.wallet, 300);
      p1.inBattle = true; p2.inBattle = true;
      p2.team = msg.team; // Guardar equipo del retado
      
      const bId = `bteam${uid()}`;
      const team1States = p1.team.map(k => getStartState(k));
      const team2States = p2.team.map(k => getStartState(k));
      
      battles.set(bId, { 
        p1id: msg.fromId, p2id: id, 
        team1: team1States, team2: team2States, 
        active1: 0, active2: 0, 
        turnId: msg.fromId, 
        logs: [{t: `¡Combate 3v3! ${p1.name} vs ${p2.name}`, c: 'hi'}], 
        isTeamBattle: true 
      });
      
      send(p1.ws, { type: 'battle_start', battleId: bId, role: 'p1', opponent: p2.name, opponentBeast: p2.team[0], isTeamBattle: true });
      send(p2.ws, { type: 'battle_start', battleId: bId, role: 'p2', opponent: p1.name, opponentBeast: p1.team[0], isTeamBattle: true });
      
      await pushLobby(); 
      setTimeout(() => pushTeamBattle(bId), 120);
    }

    // --- ACCIONES DE BATALLA ---
    if (msg.type === 'attack') {
      const b = battles.get(msg.battleId); if (!b) return;
      if (b.isTeamBattle) await processTeamTurn(msg.battleId, id, msg.index);
      else if (b.isGauntlet) await processGauntletPlayerTurn(msg.battleId, id, msg.index);
      else if (b.isCpu) await processCpuPlayerTurn(msg.battleId, id, msg.index);
      else await processTurn(msg.battleId, id, msg.index);
    }

    // NUEVO: Cambiar Vicamon en 3v3
    if (msg.type === 'team_switch') {
      await processTeamSwitch(msg.battleId, id, msg.index);
    }

    if (msg.type === 'surrender') {
      const b = battles.get(msg.battleId); if (!b) return;
      if (b.isTeamBattle) {
        const otherId = b.p1id === id ? b.p2id : b.p1id;
        await endTeamBattle(msg.battleId, otherId, id, 0);
      } else if (b.isGauntlet) {
        await endGauntlet(msg.battleId, id, false);
      } else if (b.isCpu) {
        await endBattle(msg.battleId, CPU_ID, id, 0, true);
      } else if (b.p1id === id || b.p2id === id) {
        const otherId = b.p1id === id ? b.p2id : b.p1id;
        await endBattle(msg.battleId, otherId, id, 0, true);
      }
    }

    // --- CPU / GAUNTLET ---
    if (msg.type === 'challenge_gauntlet') {
      const pl = lobby.get(id);
      if (!pl || pl.inBattle) return;
      if (!await hasHP(pl.wallet, 100)) { send(ws, { type: 'error', msg: 'Necesitas al menos 100 HP para entrar a la Torre de Batalla.' }); return; }
      await lockHP(pl.wallet, 100);
      pl.inBattle = true;
      const cpuBeast = BEAST_KEYS[0];
      const bId = `bgauntlet${uid()}`;
      battles.set(bId, { p1id: CPU_ID, p2id: id, st1: getStartState(cpuBeast), st2: getStartState(pl.beast), turnId: CPU_ID, logs: [{t: `¡Torre de Batalla iniciada! ${pl.name} vs Aries (1/12)`, c: 'hi'}], isCpu: true, isGauntlet: true, gauntletIndex: 0, cpuIsP1: true, cpuBeast });
      send(ws, { type: 'battle_start', battleId: bId, role: 'p2', opponent: 'Zodiac Master', opponentBeast: cpuBeast, isCpu: true, isGauntlet: true });
      await pushLobby();
      setTimeout(() => { pushCpuBattle(bId); scheduleGauntletCpuTurn(bId); }, 200);
    }

    if (msg.type === 'gauntlet_continue') {
      const b = battles.get(msg.battleId); if (!b || !b.isGauntlet) return;
      const pl = lobby.get(id);
      if (msg.beast) pl.beast = msg.beast;
      b.st2 = getStartState(pl.beast);
      b.st1 = getStartState(b.cpuBeast);
      b.turnId = CPU_ID;
      pushCpuBattle(msg.battleId);
      scheduleGauntletCpuTurn(msg.battleId);
    }

    if (msg.type === 'challenge_cpu') {
      const pl = lobby.get(id);
      if (!pl || pl.inBattle) return;
      pl.inBattle = true;
      const cpuBeast = BEAST_KEYS[Math.floor(Math.random() * BEAST_KEYS.length)];
      const bId = `bcpu${uid()}`;
      battles.set(bId, { p1id: CPU_ID, p2id: id, st1: getStartState(cpuBeast), st2: getStartState(pl.beast), turnId: CPU_ID, logs: [{t: `¡Zodiac Master invoca ${cpuBeast}! ¡Entrenamiento gratuito!`, c: 'hi'}], isCpu: true, cpuIsP1: true, cpuBeast });
      send(ws, { type: 'battle_start', battleId: bId, role: 'p2', opponent: 'Zodiac Master', opponentBeast: cpuBeast, isCpu: true });
      await pushLobby();
      setTimeout(() => { pushCpuBattle(bId); scheduleCpuTurn(bId); }, 200);
    }

    // --- ECONOMÍA Y CHAT ---
    if (msg.type === 'cashout') {
      const pl = lobby.get(id);
      if (!pl || pl.inBattle) { send(ws, { type: 'cashout_result', ok: false, reason: 'En batalla o no conectado' }); return; }
      const currentHp = await getHP(pl.wallet);
      if (currentHp <= 0) { send(ws, { type: 'cashout_result', ok: false, reason: 'No tienes HP para retirar' }); return; }
      const usdcNeeded = parseFloat((currentHp * 0.001).toFixed(6));
      getPlatformUSDCBalance().then(async balance => {
        if (balance < usdcNeeded) { send(ws, { type: 'cashout_result', ok: false, reason: `Fondos insuficientes en plataforma.` }); return; }
        const result = await cashout(pl.wallet);
        if (!result.ok) { send(ws, { type: 'cashout_result', ok: false, reason: 'Error al procesar' }); return; }
        send(ws, { type: 'cashout_result', ok: true, hp: result.hp, usdc: result.usdc, status: 'processing' });
        sendUSDC(pl.wallet, result.usdc)
          .then(sig => send(ws, { type: 'cashout_result', ok: true, hp: result.hp, usdc: result.usdc, status: 'confirmed', tx: sig }))
          .catch(async e => { await addHP(pl.wallet, result.hp); send(ws, { type: 'cashout_result', ok: false, reason: 'Error al enviar USDC: ' + e.message }); });
      }).catch(e => send(ws, { type: 'cashout_result', ok: false, reason: 'No se pudo verificar balance' }));
    }

    if (msg.type === 'chat_message') {
      const p = lobby.get(id); if (!p) return;
      const text = (msg.text || '').slice(0, 200); 
      broadcast({ type: 'chat_message', name: p.name, text: text });
    }

    if (msg.type === 'ping') {
      const p = lobby.get(id);
      if (p) { const hp = await getHP(p.wallet || ''); send(ws, { type: 'hp_updated', hp }); await pushLobby(); }
    }

    if (msg.type === 'leave_lobby') {
      const p = lobby.get(id);
      if (p && !p.inBattle) { lobby.delete(id); await pushLobby(); }
    }
  });

  ws.on('close', async () => {
    const p = lobby.get(id); if (!p) return;
    for (const [bId, b] of battles) {
      if (b.isTraining && (b.p1id === id || b.p2id === id)) { battles.delete(bId); } 
      else if (b.isTeamBattle && (b.p1id === id || b.p2id === id)) { 
        const otherId = b.p1id === id ? b.p2id : b.p1id;
        await endTeamBattle(bId, otherId, id, 0);
      } 
      else if (b.isGauntlet && b.p2id === id) { await endGauntlet(bId, id, false); } 
      else if (b.isCpu && b.p2id === id) { battles.delete(bId); } 
      else if (b.p1id === id || b.p2id === id) {
        const otherId = b.p1id === id ? b.p2id : b.p1id;
        if (p.wallet) await unlockHP(p.wallet, 100);
        const other = lobby.get(otherId);
        if (other?.wallet) await unlockHP(other.wallet, 100);
        await endBattle(bId, otherId, id, 100, true);
      }
    }
    lobby.delete(id);
    await pushLobby();
  });
});

setTimeout(() => { try { require('./payment-monitor'); } catch(e) { console.error('[ERROR] No se pudo iniciar el monitor de pagos:', e.message); } }, 5000);
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Zodiac Battle corriendo en http://localhost:${PORT}`));
