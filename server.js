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
