// --- MODO TORNEO (FRONTEND) ---
let tournamentData = null;
let myTournamentMode = null;

function openTournamentMenu(mode) {
    myTournamentMode = mode;
    tournamentData = null; // Limpiar datos previos
    show('s-tournament');
    // Pedirle al servidor el estado actual de este torneo
    if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'get_tournament_state', mode: mode }));
    }
}

function handleTournamentState(data) {
    tournamentData = data;
    renderTournament();
}

function joinTournament() {
    if (!myTournamentMode) return;
    if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'join_tournament', mode: myTournamentMode }));
    }
}

function leaveTournament() {
    if (myTournamentMode && ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'leave_tournament', mode: myTournamentMode }));
    }
    myTournamentMode = null;
    tournamentData = null;
    show('s-lobby');
}

function renderTournament() {
    if (!tournamentData) return;
    
    const isHP = tournamentData.mode === 'HP';
    document.getElementById('tour-mode').textContent = `Torneo ${tournamentData.mode} (100 ${isHP ? 'HP' : 'XP'})`;
    document.getElementById('tour-pot').textContent = `${tournamentData.pot} ${isHP ? 'HP' : 'XP'}`;
    
    let statusText = 'Esperando jugadores...';
    if (tournamentData.status === 'ongoing') statusText = '¡Torneo en curso!';
    if (tournamentData.status === 'finished') statusText = 'El torneo ha terminado.';
    document.getElementById('tour-status').textContent = statusText;

    const slots = tournamentData.slots || [];
    for (let i = 0; i < 4; i++) {
        const slot = slots[i];
        const el = document.getElementById(`tour-slot-${i+1}`);
        if (!el) continue;
        
        if (!slot) {
            el.innerHTML = `<span style="color:rgba(255,255,255,.3)">Esperando J${i+1}...</span>`;
            el.style.borderColor = 'rgba(255,255,255,.1)';
            el.style.boxShadow = 'none';
        } else {
            el.innerHTML = `<span style="color:#fff;font-weight:600">${slot.name}</span>`;
            el.style.borderColor = '#5DCAA5';
            el.style.boxShadow = '0 0 8px rgba(93,202,165,.2)';
        }
    }

    // Actualizar Final y Campeón si hay datos
    const bracket = tournamentData.bracket || { f: [null, null], champ: null };
    const w1 = document.getElementById('tour-slot-w1');
    const w2 = document.getElementById('tour-slot-w2');
    const champ = document.getElementById('tour-slot-champ');

    if (bracket.f && bracket.f[0]) {
        const p = lobbyPlayers.find(pl => pl.id === bracket.f[0]); // Asumiendo que tenemos acceso a los nombres, o el servidor lo manda
        const name = bracket.f[0] === myId ? myName : 'Ganador SF1'; // Simplificado por ahora
        if(w1) w1.innerHTML = `<span style="color:#F6E265;font-weight:600">${name}</span>`;
    } else {
        if(w1) w1.innerHTML = `<span style="color:rgba(255,255,255,.3)">Ganador SF1</span>`;
    }

    if (bracket.f && bracket.f[1]) {
        const name = bracket.f[1] === myId ? myName : 'Ganador SF2';
        if(w2) w2.innerHTML = `<span style="color:#F6E265;font-weight:600">${name}</span>`;
    } else {
        if(w2) w2.innerHTML = `<span style="color:rgba(255,255,255,.3)">Ganador SF2</span>`;
    }

    if (bracket.champ) {
        const name = bracket.champ === myId ? myName : '🏆 Campeón';
        if(champ) champ.innerHTML = `<span style="color:#F6E265;font-weight:700;font-size:16px">${name}</span><span style="color:rgba(246,226,102,.5);font-size:11px;margin-top:5px">¡Felicidades!</span>`;
    } else {
        if(champ) champ.innerHTML = `<span style="color:rgba(246,226,102,.5);font-weight:700;font-size:24px">🏆</span><span style="color:rgba(246,226,102,.5);font-size:11px;margin-top:5px">Esperando Campeón</span>`;
    }
}
