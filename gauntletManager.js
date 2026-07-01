const BEASTS = require('./beasts.js');
const BEAST_KEYS = Object.keys(BEASTS);
const { lobby, battles, pushCpuBattle, broadcast, send, pushLobby } = require('./state');
const { applyAtk, tickEffects, getStartState } = require('./battleEngine');
const { settleGauntlet, getPlayerStats, getPlayerRank, getTopPlayers } = require('./hp-balance');

const CPU_ID = -1;
const CPU_NAME = 'Zodiac Master';

async function endGauntlet(bId, playerId, won) {
  const b = battles.get(bId);
  const pl = lobby.get(playerId);
  if (!pl) return;
  const wallet = pl.wallet;
  const newHp = await settleGauntlet(wallet, won);
  // No actualizamos stats (V/D) para el ranking, como acordamos.
  const stats = await getPlayerStats(wallet);
  const rank = await getPlayerRank(wallet);
  send(pl.ws, { type:'battle_end', won, isGauntlet: true, newHp, stats: { wins: stats.wins, losses: stats.losses, rank } });
  pl.inBattle = false;
  battles.delete(bId);
  await pushLobby();
  const top = await getTopPlayers(3);
  broadcast({ type: 'leaderboard_update', top });
}

async function checkGauntletCpuDeath(bId) {
  const b = battles.get(bId); if (!b) return false;
  const cpuSt = b.cpuIsP1 ? b.st1 : b.st2;
  const plSt  = b.cpuIsP1 ? b.st2 : b.st1;
  const plId  = b.cpuIsP1 ? b.p2id : b.p1id;
  
  if (cpuSt.hp <= 0) {
    b.turnId = -2; // Bloquear ataques
    pushCpuBattle(bId); 
    setTimeout(() => {
      const bb = battles.get(bId); if (!bb) return;
      bb.gauntletIndex++;
      if (bb.gauntletIndex >= BEAST_KEYS.length) {
        endGauntlet(bId, plId, true);
      } else {
        const pl = lobby.get(plId);
        if (!pl) return endGauntlet(bId, plId, false);
        bb.cpuBeast = BEAST_KEYS[bb.gauntletIndex];
        bb.st1 = getStartState(bb.cpuBeast);
        bb.turnId = CPU_ID; 
        bb.logs.push({t:`¡Jefe derrotado! Prepárate para ${BEASTS[bb.cpuBeast].name} (${bb.gauntletIndex+1}/12). HP restaurado.`, c:'good'});
        send(pl.ws, { type: 'gauntlet_next', battleId: bId, nextBeast: bb.cpuBeast, round: bb.gauntletIndex+1, logs: bb.logs.slice(-14) });
      }
    }, 1500); 
    return true;
  }
  if (plSt.hp <= 0) {
    b.turnId = -2;
    pushCpuBattle(bId);
    setTimeout(() => endGauntlet(bId, plId, false), 1500);
    return true;
  }
  return false;
}

function cpuPickAttack(cpuSt, oppSt, beastKey) {
  const atks = BEASTS[beastKey]?.attacks || [];
  const validIndices = []; 
  const weights = [];
  atks.forEach((a, i) => {
    if (cpuSt.pp[i] > 0 || cpuSt.pp[i] === undefined || cpuSt.pp[i] === 99) {
      validIndices.push(i); 
      let s = 2;
      if (a.d > 30 && oppSt.hp < 40) s = 5;
      if ((a.fx === 'poison5' || a.fx === 'poison3l') && oppSt.poisonTurns === 0 && oppSt.hp > 40) s = 4;
      if ((a.fx === 'heal20' || a.fx === 'heal30' || a.fx === 'fortress') && cpuSt.hp < 35) s = 5;
      if ((a.fx === 'shield2' || a.fx === 'shield1r') && cpuSt.hp < 45 && cpuSt.shield === 0) s = 4;
      if (a.fx === 'poisonDouble' && oppSt.poisonTurns > 0) s = 6;
      if (a.fx === 'recharge' && cpuSt.recharge === 0 && oppSt.hp > 60) s = 1;
      weights.push(s);
    }
  });
  if (validIndices.length === 0) return 0;
  const tot = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * tot, idx = validIndices[0];
  for (let i = 0; i < validIndices.length; i++) { 
    r -= weights[i]; 
    if (r <= 0) { idx = validIndices[i]; break; } 
  }
  return idx;
}

function scheduleGauntletCpuTurn(bId) {
  const b = battles.get(bId); if (!b || !b.isCpu || b.turnId !== CPU_ID) return;
  setTimeout(async () => { 
    const bb = battles.get(bId); if (!bb || bb.turnId !== CPU_ID) return; 
    await doGauntletCpuTurn(bId); 
  }, 1100 + Math.random() * 600);
}

async function doGauntletCpuTurn(bId) {
  const b = battles.get(bId); if (!b) return;
  const cpuSt = b.cpuIsP1 ? b.st1 : b.st2;
  const plSt  = b.cpuIsP1 ? b.st2 : b.st1;
  const plId  = b.cpuIsP1 ? b.p2id : b.p1id;
  const pl = lobby.get(plId); if (!pl) return;

  b.logs.push(...tickEffects(cpuSt));
  if (await checkGauntletCpuDeath(bId)) return;

  if (cpuSt.stun) { 
    cpuSt.stun = false; 
    b.logs.push({t: `${CPU_NAME} aturdido — pierde turno`, c: 'special'}); 
  } else if (cpuSt.recharge > 0) { 
    cpuSt.recharge--; 
    b.logs.push({t: `${CPU_NAME} recargando...`, c: 'special'}); 
  } else {
    const idx = cpuPickAttack(cpuSt, plSt, b.cpuBeast);
    const atk = BEASTS[b.cpuBeast].attacks[idx];
    if (cpuSt.pp[idx] < 99) cpuSt.pp[idx]--;
    b.logs.push(...applyAtk(cpuSt, plSt, atk, CPU_NAME));
    if (await checkGauntletCpuDeath(bId)) return;
  }

  b.turnId = plId;
  pushCpuBattle(bId);

  const bb = battles.get(bId); if (!bb) return;
  const plStNow = b.cpuIsP1 ? bb.st2 : bb.st1;
  if (plStNow.stun || plStNow.recharge > 0) {
    setTimeout(async () => { 
      const bbb = battles.get(bId); if (!bbb || bbb.turnId !== plId) return; 
      await processGauntletPlayerTurn(bId, plId, -1); 
    }, 900);
  }
}

async function processGauntletPlayerTurn(bId, playerId, atkIndex) {
  const b = battles.get(bId); if (!b || !b.isCpu || b.turnId !== playerId) return;
  const plIsP1 = !b.cpuIsP1;
  const plSt = plIsP1 ? b.st1 : b.st2;
  const cpuSt = plIsP1 ? b.st2 : b.st1;
  const pl = lobby.get(playerId); if (!pl) return;

  b.logs.push(...tickEffects(plSt));
  if (await checkGauntletCpuDeath(bId)) return;

  if (plSt.stun) { 
    plSt.stun = false; 
    b.logs.push({t: `${pl.name} aturdido — pierde turno`, c: 'special'}); 
  } else if (plSt.recharge > 0) { 
    plSt.recharge--; 
    b.logs.push({t: `${pl.name} recargando...`, c: 'special'}); 
  } else if (atkIndex >= 0) {
    const atks = BEASTS[pl.beast]?.attacks;
    const atk = atks?.[atkIndex]; if (!atk) return;
    if (plSt.pp[atkIndex] <= 0) {
      b.logs.push({t: `${pl.name} intentó usar ${atk.n} pero no tiene PP. ¡Turno perdido!`, c: 'bad'});
      b.turnId = CPU_ID; pushCpuBattle(bId); scheduleGauntletCpuTurn(bId); return;
    }
    if (plSt.pp[atkIndex] < 99) plSt.pp[atkIndex]--;
    b.logs.push(...applyAtk(plSt, cpuSt, atk, pl.name));
    if (await checkGauntletCpuDeath(bId)) return;
  }
  
  b.turnId = CPU_ID; 
  pushCpuBattle(bId); 
  scheduleGauntletCpuTurn(bId);
}

module.exports = { 
  processGauntletPlayerTurn 
};
