const { lobby, battles, send, broadcast, pushBattle } = require('./state');
const { getStartState } = require('./battleEngine');
const { lockHP, unlockHP, addHP, updatePlayerStats, getTopPlayers } = require('./hp-balance');

// Almacén de torneos activos
const tournaments = {
    HP: { players: [], status: 'waiting', pot: 0, bracket: { sf1: [], sf2: [], f: [], champ: null } },
    XP: { players: [], status: 'waiting', pot: 0, bracket: { sf1: [], sf2: [], f: [], champ: null } }
};

function getTournamentState(mode) {
    const tour = tournaments[mode];
    if (!tour) return null;
    return {
        mode: mode,
        status: tour.status,
        pot: tour.pot,
        slots: tour.players.map(p => ({ id: p.id, name: p.name })),
        bracket: tour.bracket
    };
}

function broadcastTournamentState(mode) {
    const state = getTournamentState(mode);
    if (!state) return;
    
    const tour = tournaments[mode];
    if (!tour) return;

    // Avisar a los que están en el torneo
    tour.players.forEach(p => {
        const pl = lobby.get(p.id);
        if (pl) send(pl.ws, { type: 'tournament_state', ...state });
    });
    
    // Avisar a los que están en el lobby
    lobby.forEach(p => {
        if (!p.inTournament) send(p.ws, { type: 'tournament_state', ...state });
    });
}

async function joinTournament(playerId, mode) {
    const player = lobby.get(playerId);
    if (!player) return;

    if (!tournaments[mode]) return;

    const tour = tournaments[mode];

    if (tour.status !== 'waiting') {
        return send(player.ws, { type: 'error', msg: 'El torneo ya empezó o no está disponible.' });
    }

    if (tour.players.find(p => p.id === playerId)) {
        return send(player.ws, { type: 'error', msg: 'Ya estás en este torneo.' });
    }

    if (tour.players.length >= 4) {
        return send(player.ws, { type: 'error', msg: 'El torneo está lleno.' });
    }

    if (mode === 'HP') {
        if (player.isGuest) return send(player.ws, { type: 'error', msg: 'Los invitados no pueden jugar por HP.' });
        const locked = await lockHP(player.wallet, 100);
        if (!locked) return send(player.ws, { type: 'error', msg: 'Necesitas 100 HP disponibles.' });
        tour.pot += 100;
    }

    tour.players.push({ id: playerId, name: player.name, wallet: player.wallet, isGuest: player.isGuest, eliminated: false });
    player.inTournament = mode;

    broadcastTournamentState(mode);

    if (tour.players.length === 4) {
        startTournament(mode);
    }
}

async function leaveTournament(playerId, mode) {
    const tour = tournaments[mode];
    if (!tour || tour.status !== 'waiting') return;

    const idx = tour.players.findIndex(p => p.id === playerId);
    if (idx === -1) return;

    const player = tour.players[idx];
    tour.players.splice(idx, 1);
    
    const p = lobby.get(playerId);
    if(p) p.inTournament = false;

    if (mode === 'HP') {
        await unlockHP(player.wallet, 100);
        tour.pot -= 100;
    }

    broadcastTournamentState(mode);
}

function startTournament(mode) {
    const tour = tournaments[mode];
    tour.status = 'ongoing';
    
    // Mezclar jugadores para las llaves
    const shuffled = [...tour.players].sort(() => Math.random() - 0.5);
    const [p1, p2, p3, p4] = shuffled;
    
    tour.bracket = {
        sf1: [p1.id, p2.id],
        sf2: [p3.id, p4.id],
        f: [null, null],
        champ: null
    };

    broadcastTournamentState(mode);

    // Iniciar Semifinales
    startTournamentMatch(p1.id, p2.id, mode, 'sf1');
    startTournamentMatch(p3.id, p4.id, mode, 'sf2');
}

function startTournamentMatch(p1Id, p2Id, mode, round) {
    const p1 = lobby.get(p1Id);
    const p2 = lobby.get(p2Id);
    if (!p1 || !p2) {
        // Si alguien se desconectó antes de empezar, el otro gana por defecto
        const winnerId = p1 ? p1Id : p2Id;
        const loserId = p1 ? p2Id : p1Id;
        reportTournamentResult(null, winnerId, loserId, mode, round);
        return;
    }

    const bId = `tour_${round}_${Date.now()}`;
    battles.set(bId, {
        p1id: p1Id, p2id: p2Id,
        st1: getStartState(p1.beast),
        st2: getStartState(p2.beast),
        turnId: p1Id, logs: [{t: `¡Batalla de Torneo (${round.toUpperCase()})!`, c: 'hi'}],
        isTournament: true, tourMode: mode, tourRound: round, 
        p1Wallet: p1.wallet, p2Wallet: p2.wallet,
        p1Beast: p1.beast, p2Beast: p2.beast
    });

    send(p1.ws, { type: 'battle_start', battleId: bId, role: 'p1', opponent: p2.name, opponentBeast: p2.beast, isTournament: true });
    send(p2.ws, { type: 'battle_start', battleId: bId, role: 'p2', opponent: p1.name, opponentBeast: p1.beast, isTournament: true });
    
    setTimeout(() => pushBattle(bId), 120);
}

async function reportTournamentResult(bId, winnerId, loserId, mode, round) {
    // Si se llama desde battleEngine, bId no será null, recuperamos los datos
    if (bId) {
        const b = battles.get(bId);
        if (!b) return;
        mode = b.tourMode;
        round = b.tourRound;
        
        // FIX: Actualizar estadísticas solo si es un torneo de HP
        if (mode === 'HP' && b.p1Wallet && b.p2Wallet) {
            const winnerWallet = b.p1id === winnerId ? b.p1Wallet : b.p2Wallet;
            const loserWallet = b.p1id === loserId ? b.p1Wallet : b.p2Wallet;
            if (winnerWallet && loserWallet) {
                await updatePlayerStats(winnerWallet, loserWallet);
                const top = await getTopPlayers(3);
                broadcast({ type: 'leaderboard_update', top });
            }
        }
    }

    const tour = tournaments[mode];
    if (!tour) return;

    // Marcar perdedor como eliminado
    const loser = tour.players.find(p => p.id === loserId);
    if (loser) loser.eliminated = true;
    const loserPl = lobby.get(loserId);
    if(loserPl) loserPl.inTournament = false; // Ya puede jugar otras cosas

    // Avanzar ganador
    if (round === 'sf1') {
        tour.bracket.f[0] = winnerId;
    } else if (round === 'sf2') {
        tour.bracket.f[1] = winnerId;
    } else if (round === 'final') {
        tour.bracket.champ = winnerId;
        await endTournament(mode, winnerId, loserId);
        return;
    }

    // Si ambas semifinales terminaron, iniciar la final
    if (tour.bracket.f[0] && tour.bracket.f[1]) {
        broadcastTournamentState(mode);
        startTournamentMatch(tour.bracket.f[0], tour.bracket.f[1], mode, 'final');
    } else {
        // Avisar al ganador que espere la otra semifinal
        const winnerPl = lobby.get(winnerId);
        if (winnerPl) send(winnerPl.ws, { type: 'tournament_wait', msg: '¡Ganaste! Esperando al ganador de la otra llave...' });
        broadcastTournamentState(mode);
    }
}

async function endTournament(mode, champId, runnerUpId) {
    const tour = tournaments[mode];
    tour.status = 'finished';

    const champ = lobby.get(champId);
    const runnerUp = lobby.get(runnerUpId);

    let champMsg = '¡Eres el Campeón del Torneo! 🏆';
    let runnerMsg = 'Quedaste en 2do lugar.';

    if (mode === 'HP') {
        await addHP(champ.wallet, 250);
        await addHP(runnerUp.wallet, 125);
        champMsg += ' Ganaste 250 HP.';
        runnerMsg += ' Recuperas 125 HP.';
    } else {
        champMsg += ' Ganaste 500 XP.';
    }

    if (champ) {
        send(champ.ws, { type: 'battle_end', won: true, isTournament: true, isTraining: (mode==='XP'), customMsg: champMsg });
        champ.inTournament = false;
    }
    if (runnerUp) {
        send(runnerUp.ws, { type: 'battle_end', won: false, isTournament: true, isTraining: (mode==='XP'), customMsg: runnerMsg });
        runnerUp.inTournament = false;
    }

    // Avisar a los eliminados en semifinales que el torneo terminó
    tour.players.forEach(p => {
        if (p.eliminated) {
            const pl = lobby.get(p.id);
            if (pl) send(pl.ws, { type: 'tournament_end', msg: `El torneo terminó. Campeón: ${champ?.name || 'Nadie'}` });
        }
    });

    broadcastTournamentState(mode);
    
    // Resetear torneo después de 10 segundos
    setTimeout(() => {
        tournaments[mode] = { players: [], status: 'waiting', pot: 0, bracket: { sf1: [], sf2: [], f: [], champ: null } };
        lobby.forEach(p => send(p.ws, { type: 'tournament_state', mode: mode, status: 'waiting', pot: 0, slots: [], bracket: { sf1: [], sf2: [], f: [], champ: null } }));
    }, 10000);
}

module.exports = { 
    joinTournament, 
    leaveTournament, 
    reportTournamentResult, 
    broadcastTournamentState 
};
