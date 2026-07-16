const BEASTS = require('./beasts.js');
const { lobby, battles, send, pushLobby, broadcast, pushBoardState } = require('./state');
const { getStartState, applyAtk, tickEffects } = require('./battleEngine');
const { settleTeamMatch, updatePlayerStats, getPlayerStats, getPlayerRank, getTopPlayers } = require('./hp-balance');
const { cpuPickAttack } = require('./cpuAI');

const CPU_ID = -1;
const CPU_NAME = 'Zodiac Master';

function setupBoard(p1, p2, p1Team, p2Team) {
  const grid = [
      [0, 'p2_1', 0, 'p2_2', 0, 'p2_3', 0],
      [0, 0, 'rock', 0, 'rock', 0, 0],
      ['heart', 0, 0, 'chest', 0, 0, 'heart'],
      [0, 'rock', 0, 0, 0, 'rock', 0],
      ['heart', 0, 0, 'chest', 0, 0, 'heart'],
      [0, 0, 'rock', 0, 'rock', 0, 0],
      [0, 'p1_1', 0, 'p1_2', 0, 'p1_3', 0]
  ];
  
  const pieces = {};
  p1Team.forEach((beast, i) => pieces[`p1_${i+1}`] = { owner: p1.id, beast: beast, st: getStartState(beast), isDead: false });
  p2Team.forEach((beast, i) => pieces[`p2_${i+1}`] = { owner: p2.id, beast: beast, st: getStartState(beast), isDead: false });
  
  return { grid, pieces, turn: p1.id };
}

async function handleBoardMove(bId, playerId, fromR, fromC, toR, toC) {
  const b = battles.get(bId); if (!b || !b.board) return;
  if (b.board.turn !== playerId) return;
  
  const pieceId = b.board.grid[fromR][fromC];
  if (!pieceId || b.board.pieces[pieceId].owner !== playerId) return;
  
  const targetVal = b.board.grid[toR][toC];
  if (targetVal === 'rock') return;
  if (typeof targetVal === 'string' && (targetVal.startsWith('p1') || targetVal.startsWith('p2'))) return;
  
  const dr = Math.abs(toR - fromR);
  const dc = Math.abs(toC - fromC);
  if (dr > 1 || dc > 1 || (dr === 0 && dc === 0)) return;
  
  // Efectos de casillas
  if (targetVal === 'heart') {
      b.board.pieces[pieceId].st.hp = Math.min(100, b.board.pieces[pieceId].st.hp + 15);
      b.logs.push({t: `❤️ ${BEASTS[b.board.pieces[pieceId].beast].name} curó 15 HP.`, c:'good'});
  } else if (targetVal === 'chest') {
      const effect = Math.random() > 0.5 ? { msg: '¡Trampa! -20 HP.', hp: -20 } : { msg: '¡Energía! +20 HP.', hp: 20 };
      b.board.pieces[pieceId].st.hp = Math.max(0, Math.min(100, b.board.pieces[pieceId].st.hp + effect.hp));
      b.logs.push({t: `🧰 ${BEASTS[b.board.pieces[pieceId].beast].name} abrió un cofre. ${effect.msg}`, c:'special'});
  } else {
      b.logs.push({t: `${BEASTS[b.board.pieces[pieceId].beast].name} se movió.`, c:'normal'});
  }
  
  b.board.grid[fromR][fromC] = 0;
  b.board.grid[toR][toC] = pieceId;
  
  // Cambiar turno
  b.board.turn = b.p1id === playerId ? b.p2id : b.p1id;
  pushBoardState(bId);
  
  // Si es turno de la CPU, mover
  if (b.isCpu && b.board.turn === CPU_ID) {
      setTimeout(() => doCpuBoardMove(bId), 1000);
  }
}

function handleBoardAttack(bId, playerId, fromR, fromC, toR, toC) {
  const b = battles.get(bId); if (!b || !b.board) return;
  if (b.board.turn !== playerId) return;
  
  const atkId = b.board.grid[fromR][fromC];
  const defId = b.board.grid[toR][toC];
  
  if (!atkId || !defId) return;
  if (b.board.pieces[atkId].owner !== playerId) return;
  if (b.board.pieces[defId].owner === playerId) return;
  
  const isAdj = Math.abs(fromR - toR) <= 1 && Math.abs(fromC - toC) <= 1;
  if (!isAdj) return;
  
  // Iniciar sub-batalla 1v1 real
  b.activeBattle = { atkId, defId, fromR, fromC, toR, toC };
  b.st1 = b.board.pieces[atkId].st; // Attacker es P1 temporalmente
  b.st2 = b.board.pieces[defId].st; // Defender es P2 temporalmente
  b.p1Beast = b.board.pieces[atkId].beast;
  b.p2Beast = b.board.pieces[defId].beast;
  b.turnId = b.board.pieces[atkId].owner; // El atacante pega primero
  b.logs.push({t: `¡${BEASTS[b.p1Beast].name} ataca a ${BEASTS[b.p2Beast].name}!`, c:'hi'});
  
  // Avisar al frontend que empiece la batalla
  const p1 = lobby.get(b.p1id), p2 = lobby.get(b.p2id);
  send(p1.ws, { type: 'board_battle_start', battleId: bId, myBeast: b.p1Beast, oppBeast: b.p2Beast, isP1: b.turnId === b.p1id });
  if (p2 && !b.isCpu) send(p2.ws, { type: 'board_battle_start', battleId: bId, myBeast: b.p2Beast, oppBeast: b.p1Beast, isP1: b.turnId === b.p2id });
  
  // Forzar actualización de UI de batalla
  b.turnId === b.p1id ? require('./state').pushBattle(bId) : require('./state').pushCpuBattle(bId);
  
  if (b.turnId === CPU_ID) {
      setTimeout(() => doCpuBoardAttack(bId), 1000);
  }
}

// Lógica de la CPU en el tablero
function doCpuBoardMove(bId) {
  const b = battles.get(bId); if (!b || !b.board) return;
  
  // IA Simple: Encontrar la ficha del jugador más cercana y moverse hacia ella
  let cpuPieces = [], playerPieces = [];
  for(let r=0; r<7; r++) {
    for(let c=0; c<7; c++) {
      const id = b.board.grid[r][c];
      if(id && id.startsWith('p2')) cpuPieces.push({id, r, c});
      if(id && id.startsWith('p1')) playerPieces.push({id, r, c});
    }
  }
  
  if(cpuPieces.length === 0 || playerPieces.length === 0) return;
  
  // Tomar la primera ficha CPU disponible
  const cpu = cpuPieces[0];
  // Encontrar el jugador más cercano
  let target = playerPieces[0];
  let minDist = Math.abs(cpu.r - target.r) + Math.abs(cpu.c - target.c);
  for(const p of playerPieces) {
    const dist = Math.abs(cpu.r - p.r) + Math.abs(cpu.c - p.c);
    if(dist < minDist) { minDist = dist; target = p; }
  }
  
  // Moverse 1 paso hacia el objetivo
  let dr = target.r > cpu.r ? 1 : (target.r < cpu.r ? -1 : 0);
  let dc = target.c > cpu.c ? 1 : (target.c < cpu.c ? -1 : 0);
  
  // Verificar si está adyacente para atacar
  if(Math.abs(cpu.r - target.r) <= 1 && Math.abs(cpu.c - target.c) <= 1) {
    handleBoardAttack(bId, CPU_ID, cpu.r, cpu.c, target.r, target.c);
    return;
  }
  
  let newR = cpu.r + dr;
  let newC = cpu.c + dc;
  
  // Si la casilla está ocupada, intentar moverse en otra dirección
  if(b.board.grid[newR][newC] !== 0 && b.board.grid[newR][newC] !== 'heart' && b.board.grid[newR][newC] !== 'chest') {
    if(dr === 0) newC = cpu.c + (dc === 0 ? 1 : 0); // Movimiento raro
    else newR = cpu.r; // Intentar mover en recto
  }
  
  handleBoardMove(bId, CPU_ID, cpu.r, cpu.c, newR, newC);
}

function doCpuBoardAttack(bId) {
  const b = battles.get(bId); if(!b || !b.activeBattle || b.turnId !== CPU_ID) return;
  const idx = cpuPickAttack(b.st1, b.st2, b.p1Beast);
  // Usar processTurn estándar
  require('./battleEngine').processTurn(bId, CPU_ID, idx);
}

// Cuando termina una batalla 1v1 en el tablero
async function resolveBoardBattle(bId, winnerId, loserId, winnerHp) {
  const b = battles.get(bId); if(!b || !b.activeBattle) return false;
  
  const atkId = b.activeBattle.atkId;
  const defId = b.activeBattle.defId;
  const atkPiece = b.board.pieces[atkId];
  const defPiece = b.board.pieces[defId];
  
  // winnerId y loserId son IDs de jugador. El atacante es P1, defensor P2
  const attackerWon = winnerId === atkPiece.owner;
  
  if(attackerWon) {
    defPiece.isDead = true;
    defPiece.st.hp = 0;
    b.board.grid[b.activeBattle.toR][b.activeBattle.toC] = 0; // Eliminar defensor
    b.board.grid[b.activeBattle.fromR][b.activeBattle.fromC] = 0; // Vaciar atacante
    b.board.grid[b.activeBattle.toR][b.activeBattle.toC] = atkId; // Atacante ocupa lugar
    b.logs.push({t: `¡${BEASTS[atkPiece.beast].name} derrotó a ${BEASTS[defPiece.beast].name}!`, c:'good'});
  } else {
    atkPiece.isDead = true;
    atkPiece.st.hp = 0;
    b.board.grid[b.activeBattle.fromR][b.activeBattle.fromC] = 0; // Eliminar atacante
    b.logs.push({t: `¡${BEASTS[defPiece.beast].name} repelió el ataque y derrotó a ${BEASTS[atkPiece.beast].name}!`, c:'bad'});
  }
  
  b.activeBattle = null;
  
  // Verificar Game Over
  let p1Alive = 0, p2Alive = 0;
  for(const id in b.board.pieces) {
    if(!b.board.pieces[id].isDead) {
      if(id.startsWith('p1')) p1Alive++;
      else p2Alive++;
    }
  }
  
  if(p1Alive === 0 || p2Alive === 0) {
    // El partido terminó
    const winnerTeamId = p1Alive > 0 ? b.p1id : b.p2id;
    const loserTeamId = p1Alive === 0 ? b.p1id : b.p2id;
    await endBoardMatch(bId, winnerTeamId, loserTeamId, 0); // HP restante no afecta el pozo en tablero, es equipo completo
    return true;
  }
  
  // Continuar el tablero
  b.board.turn = b.p1id === winnerId ? b.p2id : b.p1id; // Cambia el turno al perdedor de la escaramuza? O al ganador? Digamos al perdedor para compensar.
  pushBoardState(bId);
  
  // Avisar al frontend que vuelva al tablero
  const p1 = lobby.get(b.p1id), p2 = lobby.get(b.p2id);
  send(p1.ws, { type: 'board_resume', battleId: bId });
  if (p2 && !b.isCpu) send(p2.ws, { type: 'board_resume', battleId: bId });
  
  if (b.isCpu && b.board.turn === CPU_ID) {
      setTimeout(() => doCpuBoardMove(bId), 1000);
  }
  
  return true;
}

async function endBoardMatch(bId, winnerId, loserId, winnerRemainingHp) {
  const b = battles.get(bId);
  const isTraining = b?.isTraining || false;
  const isCpu = b?.isCpu || false;
  const winner = lobby.get(winnerId);
  const loser = lobby.get(loserId);
  
  if (isTraining || isCpu) {
    let winnerXp = 300; 
    if(winner) winner.ws.send(JSON.stringify({ type:'battle_end', won:true, isTeamBattle:true, isBoardBattle:true, isTraining:true, winnerXp, loserXp:0 }));
    if(loser) loser.ws.send(JSON.stringify({ type:'battle_end', won:false, isTeamBattle:true, isBoardBattle:true, isTraining:true, winnerXp, loserXp:0 }));
  } else {
    const winnerWallet = winner?.wallet || '';
    const loserWallet = loser?.wallet || '';
    const result = await settleTeamMatch(winnerWallet, loserWallet, winnerRemainingHp);
    await updatePlayerStats(winnerWallet, loserWallet);
    const wStats = await getPlayerStats(winnerWallet);
    const wRank = await getPlayerRank(winnerWallet);
    if(winner) winner.ws.send(JSON.stringify({ type:'battle_end', won:true, isTeamBattle:true, isBoardBattle:true, winnerHp:0, newHp: result.winnerNewHp, stats: { wins: wStats.wins, losses: wStats.losses, rank: wRank } }));
    if(loser) loser.ws.send(JSON.stringify({ type:'battle_end', won:false, isTeamBattle:true, isBoardBattle:true, winnerHp:0, newHp: 0 }));
    const top = await getTopPlayers(3);
    broadcast({ type: 'leaderboard_update', top });
  }
  if (winner) winner.inBattle = false;
  if (loser) loser.inBattle = false;
  battles.delete(bId);
  await pushLobby();
}

module.exports = { setupBoard, handleBoardMove, handleBoardAttack, resolveBoardBattle, doCpuBoardMove };
