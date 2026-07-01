const BEASTS = require('./beasts.js');
const { lobby, battles, send, broadcast, pushLobby } = require('./state');
const { applyAtk, tickEffects, getStartState } = require('./battleEngine');
const { settleTeamMatch, updatePlayerStats, getPlayerStats, getPlayerRank, getTopPlayers } = require('./hp-balance');

// Envía el estado de la batalla 3v3 a los jugadores (incluye los bancos)
function pushTeamBattle(bId) {
  const b = battles.get(bId); if (!b) return;
  const p1 = lobby.get(b.p1id), p2 = lobby.get(b.p2id);
  if (!p1 || !p2) return;

  const formatSide = (player, teamStates, activeIdx) => {
    return {
      name: player.name,
      activeBeast: player.team[activeIdx],
      activeState: teamStates[activeIdx],
      bench: player.team.map((beastKey, i) => ({
        beast: beastKey,
        state: teamStates[i],
        isDead: teamStates[i].hp <= 0,
        isActive: i === activeIdx
      }))
    };
  };

  const p1Side = formatSide(p1, b.team1, b.active1);
  const p2Side = formatSide(p2, b.team2, b.active2);

  const base = { type: 'battle_state', battleId: bId, p1: p1Side, p2: p2Side, logs: b.logs.slice(-14), isTeamBattle: true };
  send(p1.ws, { ...base, yourTurn: b.turnId === b.p1id });
  send(p2.ws, { ...base, yourTurn: b.turnId === b.p2id });
}

async function endTeamBattle(bId, winnerId, loserId, winnerRemainingHp) {
  const b = battles.get(bId);
  const winner = lobby.get(winnerId);
  const loser = lobby.get(loserId);
  const hp = Math.max(0, Math.min(300, winnerRemainingHp));

  const winnerWallet = winner?.wallet || '';
  const loserWallet = loser?.wallet || '';
  
  const result = await settleTeamMatch(winnerWallet, loserWallet, hp);
  await updatePlayerStats(winnerWallet, loserWallet);
  
  const wStats = await getPlayerStats(winnerWallet);
  const lStats = await getPlayerStats(loserWallet);
  const wRank = await getPlayerRank(winnerWallet);
  const lRank = await getPlayerRank(loserWallet);

  if(winner) winner.ws.send(JSON.stringify({ type:'battle_end', won:true, isTeamBattle:true, winnerHp:hp, newHp: result.winnerNewHp, stats: { wins: wStats.wins, losses: wStats.losses, rank: wRank } }));
  if(loser) loser.ws.send(JSON.stringify({ type:'battle_end', won:false, isTeamBattle:true, winnerHp:hp, newHp: 0, stats: { wins: lStats.wins, losses: lStats.losses, rank: lRank } }));

  if (winner) winner.inBattle = false;
  if (loser) loser.inBattle = false;
  battles.delete(bId);
  await pushLobby();
  const top = await getTopPlayers(3);
  broadcast({ type: 'leaderboard_update', top });
}

async function checkTeamDeath(bId, isP1Attacker) {
  const b = battles.get(bId); if (!b) return false;
  const aSt = isP1Attacker ? b.team1[b.active1] : b.team2[b.active2];
  const dSt = isP1Attacker ? b.team2[b.active2] : b.team1[b.active1];
  const aId = isP1Attacker ? b.p1id : b.p2id;
  const dId = isP1Attacker ? b.p2id : b.p1id;
  const aPlayer = lobby.get(aId);
  const dPlayer = lobby.get(dId);

  // ¿Murió el defensor?
  if (dSt.hp <= 0) {
    const defenderTeam = isP1Attacker ? b.team2 : b.team1;
    const defenderActive = isP1Attacker ? b.active2 : b.active1;
    const livingBench = [];
    
    defenderTeam.forEach((st, i) => {
      if (i !== defenderActive && st.hp > 0) livingBench.push(i);
    });

    if (livingBench.length === 0) {
      // El defensor no tiene más Vicamons vivos. Gana el atacante.
      const winnerRemainingHp = (isP1Attacker ? b.team1 : b.team2).reduce((sum, st) => sum + Math.max(0, st.hp), 0);
      await endTeamBattle(bId, aId, dId, winnerRemainingHp);
      return true;
    } else {
      // Forzar cambio al defensor
      b.turnId = -4; // Bloquear ataques
      pushTeamBattle(bId);
      send(dPlayer.ws, { type: 'team_force_switch', battleId: bId, reason: '¡Tu Vicamon fue derrotado! Elige el siguiente.' });
      return true;
    }
  }

  // ¿Murió el atacante (por retroceso o daño por turno)?
  if (aSt.hp <= 0) {
    const attackerTeam = isP1Attacker ? b.team1 : b.team2;
    const attackerActive = isP1Attacker ? b.active1 : b.active2;
    const livingBench = [];
    
    attackerTeam.forEach((st, i) => {
      if (i !== attackerActive && st.hp > 0) livingBench.push(i);
    });

    if (livingBench.length === 0) {
      // El atacante no tiene más Vicamons vivos. Gana el defensor.
      const winnerRemainingHp = (isP1Attacker ? b.team2 : b.team1).reduce((sum, st) => sum + Math.max(0, st.hp), 0);
      await endTeamBattle(bId, dId, aId, winnerRemainingHp);
      return true;
    } else {
      // Forzar cambio al atacante
      b.turnId = -4;
      pushTeamBattle(bId);
      send(aPlayer.ws, { type: 'team_force_switch', battleId: bId, reason: '¡Tu Vicamon fue derrotado! Elige el siguiente.' });
      return true;
    }
  }
  return false;
}

async function processTeamTurn(bId, attackerId, atkIndex) {
  const b = battles.get(bId); if (!b) return true;
  if (b.turnId !== attackerId) return false;
  
  const isP1 = b.p1id === attackerId;
  const aSt = isP1 ? b.team1[b.active1] : b.team2[b.active2];
  const dSt = isP1 ? b.team2[b.active2] : b.team1[b.active1];
  const aPlayer = lobby.get(attackerId);
  const dPlayer = lobby.get(isP1 ? b.p2id : b.p1id);
  if (!aPlayer || !dPlayer) return true;

  b.logs.push(...tickEffects(aSt));
  if (await checkTeamDeath(bId, isP1)) return true;

  if (aSt.stun) {
    aSt.stun = false; b.logs.push({t: `${aPlayer.name} aturdido — pierde turno`, c: 'special'});
  } else if (aSt.recharge > 0) {
    aSt.recharge--; b.logs.push({t: `${aPlayer.name} recargando...`, c: 'special'});
  } else if (atkIndex >= 0) {
    const atkKey = isP1 ? aPlayer.team[b.active1] : aPlayer.team[b.active2];
    const atk = BEASTS[atkKey]?.attacks[atkIndex];
    if (!atk) return false;
    if (aSt.pp[atkIndex] <= 0) {
      b.logs.push({t: `${aPlayer.name} intentó usar ${atk.n} pero no tiene PP. ¡Turno perdido!`, c: 'bad'});
      b.turnId = isP1 ? b.p2id : b.p1id; pushTeamBattle(bId); return false;
    }
    if (aSt.pp[atkIndex] < 99) aSt.pp[atkIndex]--;
    b.logs.push(...applyAtk(aSt, dSt, atk, BEASTS[atkKey].name));
    if (await checkTeamDeath(bId, isP1)) return true;
  }
  
  b.turnId = isP1 ? b.p2id : b.p1id;
  pushTeamBattle(bId);
  return false;
}

async function processTeamSwitch(bId, playerId, switchToIndex) {
  const b = battles.get(bId); if (!b) return;
  const isP1 = b.p1id === playerId;
  const player = lobby.get(playerId);
  
  const wasForced = (b.turnId === -4);
  const team = isP1 ? b.team1 : b.team2;
  
  if (switchToIndex < 0 || switchToIndex >= team.length) return;
  if (team[switchToIndex].hp <= 0) {
    send(player.ws, { type: 'error', msg: 'Ese Vicamon está debilitado.' });
    return;
  }
  
  if (isP1) b.active1 = switchToIndex; else b.active2 = switchToIndex;
  b.logs.push({t: `${player.name} cambia a ${BEASTS[player.team[switchToIndex]].name}`, c: 'special'});
  
  // Si fue un cambio forzado, el jugador que cambió pierde el turno (el rival ataca).
  // Si fue voluntario, también pierde el turno.
  b.turnId = isP1 ? b.p2id : b.p1id;
  
  pushTeamBattle(bId);
}

module.exports = { pushTeamBattle, processTeamTurn, processTeamSwitch, endTeamBattle };
