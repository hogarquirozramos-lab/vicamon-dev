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
  
  // FIX: Configurar variables para que pushCpuBattle/pushBattle funcione
  b.turnId = b.board.pieces[atkId].owner; 
  b.cpuIsP1 = (b.turnId === CPU_ID);
  b.cpuBeast = b.cpuIsP1 ? b.p1Beast : b.p2Beast;
  b.isCpu = true; // Aseguramos que use la lógica de CPU si lo ataca el master
  
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

// Lógica de la CPU en el tablero (Mejorada para no atascarse)
function doCpuBoardMove(bId) {
  const b = battles.get(bId); if (!b || !b.board) return;
  
  let cpuPieces = [], playerPieces = [];
  for(let r=0; r<7; r++) {
    for(let c=0; c<7; c++) {
      const id = b.board.grid[r][c];
      if(id && id.startsWith('p2')) cpuPieces.push({id, r, c});
      if(id && id.startsWith('p1')) playerPieces.push({id, r, c});
    }
  }
  
  if(cpuPieces.length === 0 || playerPieces.length === 0) return;
  
  const cpu = cpuPieces[0];
  let target = playerPieces[0];
  let minDist = Math.abs(cpu.r - target.r) + Math.abs(cpu.c - target.c);
  for(const p of playerPieces) {
    const dist = Math.abs(cpu.r - p.r) + Math.abs(cpu.c - p.c);
    if(dist < minDist) { minDist = dist; target = p; }
  }
  
  // Si está al lado, ataca
  if(Math.abs(cpu.r - target.r) <= 1 && Math.abs(cpu.c - target.c) <= 1) {
    handleBoardAttack(bId, CPU_ID, cpu.r, cpu.c, target.r, target.c);
    return;
  }
  
  // Buscar el mejor movimiento posible
  let bestMove = null;
  let bestDist = minDist;
  const directions = [[-1,-1], [-1,0], [-1,1], [0,-1], [0,1], [1,-1], [1,0], [1,1]];
  
  for(const [dr, dc] of directions) {
    const newR = cpu.r + dr;
    const newC = cpu.c + dc;
    if(newR >= 0 && newR < 7 && newC >= 0 && newC < 7) {
      const val = b.board.grid[newR][newC];
      if(val === 0 || val === 'heart' || val === 'chest') {
        const dist = Math.abs(newR - target.r) + Math.abs(newC - target.c);
        if(dist < bestDist) {
          bestDist = dist;
          bestMove = {r: newR, c: newC};
        }
      }
    }
  }
  
  if(bestMove) {
    handleBoardMove(bId, CPU_ID, cpu.r, cpu.c, bestMove.r, bestMove.c);
  } else {
    // Si no hay mejor movimiento, pasa el turno
    b.logs.push({t: `${BEASTS[b.board.pieces[cpu.id].beast].name} no puede moverse.`, c:'special'});
    b.board.turn = b.p1id; 
    pushBoardState(bId);
  }
}

function doCpuBoardAttack(bId) {
  const b = battles.get(bId); if(!b || !b.activeBattle || b.turnId !== CPU_ID) return;
  const idx = cpuPickAttack(b.st1, b.st2, b.p1Beast);
  require('./battleEngine').processTurn(bId, CPU_ID, idx);
}

async function resolveBoardBattle(bId, winnerId, loserId, winnerHp) {
  const b = battles.get(bId); if(!b || !b.activeBattle) return false;
  
  const atkId = b.activeBattle.atkId;
  const defId = b.activeBattle.defId;
  const atkPiece = b.board.pieces[atkId];
  const defPiece = b.board.pieces[defId];
  
  const attackerWon = winnerId === atkPiece.owner;
  
  if(attackerWon) {
    defPiece.isDead = true;
    defPiece.st.hp = 0;
    b.board.grid[b.activeBattle.toR][b.activeBattle.toC] = 0; 
    b.board.grid[b.activeBattle.fromR][b.activeBattle.fromC] = 0; 
    b.board.grid[b.activeBattle.toR][b.activeBattle.toC] = atkId; 
    b.logs.push({t: `¡${BEASTS[atkPiece.beast].name} derrotó a ${BEASTS[defPiece.beast].name}!`, c:'good'});
  } else {
    atkPiece.isDead = true;
    atkPiece.st.hp = 0;
    b.board.grid[b.activeBattle.fromR][b.activeBattle.fromC] = 0; 
    b.logs.push({t: `¡${BEASTS[defPiece.beast].name} repelió el ataque y derrotó a ${BEASTS[atkPiece.beast].name}!`, c:'bad'});
  }
  
  b.activeBattle = null;
  
  let p1Alive = 0, p2Alive = 0;
  for(const id in b.board.pieces) {
    if(!b.board.pieces[id].isDead) {
      if(id.startsWith('p1')) p1Alive++;
      else p2Alive++;
    }
  }
  
  if(p1Alive === 0 || p2Alive === 0) {
    const winnerTeamId = p1Alive > 0 ? b.p1id : b.p2id;
    const loserTeamId = p1Alive === 0 ? b.p1id : b.p2id;
    await endBoardMatch(bId, winnerTeamId, loserTeamId, 0); 
    return true;
  }
  
  b.board.turn = b.p1id === winnerId ? b.p2id : b.p1id; 
  pushBoardState(bId);
  
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

module.exports = { setupBoard, handleBoardMove, handleBoardAttack, resolveBoardBattle, doCpuBoardMove, endBoardMatch };
