// --- MODO TORNEO (FRONTEND) ---
let tournamentData = null;

function joinTournamentTest() {
    // Simulación de datos para probar la interfaz
    tournamentData = {
        mode: 'HP',
        pot: 100,
        slots: [
            { id: 1, name: 'Tú (Invitado)', status: 'waiting' },
            { id: null, name: 'Esperando...', status: 'empty' },
            { id: null, name: 'Esperando...', status: 'empty' },
            { id: null, name: 'Esperando...', status: 'empty' }
        ],
        status: 'Esperando 3 jugadores más...'
    };
    renderTournament();
}

function renderTournament() {
    if (!tournamentData) return;
    
    document.getElementById('tour-mode').textContent = `Torneo ${tournamentData.mode} (100 ${tournamentData.mode === 'HP' ? 'HP' : 'XP'})`;
    document.getElementById('tour-pot').textContent = `${tournamentData.pot} ${tournamentData.mode === 'HP' ? 'HP' : 'XP'}`;
    document.getElementById('tour-status').textContent = tournamentData.status;

    // Llenar slots de semifinales
    for (let i = 0; i < 2; i++) {
        const slot = tournamentData.slots[i];
        const el = document.getElementById(`tour-slot-${i+1}`);
        if (slot.status === 'empty') {
            el.innerHTML = `<span style="color:rgba(255,255,255,.3)">Esperando J${i+1}...</span>`;
            el.style.borderColor = 'rgba(255,255,255,.1)';
        } else {
            el.innerHTML = `<span style="color:#fff;font-weight:600">${slot.name}</span>`;
            el.style.borderColor = '#5DCAA5';
        }
    }

    // Llenar slots 3 y 4 (en el HTML se ven como los de la final, pero son SF2)
    for (let i = 2; i < 4; i++) {
        const slot = tournamentData.slots[i];
        const el = document.getElementById(`tour-slot-w${i-1}`); // w1 y w2
        if (slot.status === 'empty') {
            el.innerHTML = `<span style="color:rgba(255,255,255,.3)">Esperando J${i+1}...</span>`;
            el.style.borderColor = 'rgba(255,255,255,.1)';
        } else {
            el.innerHTML = `<span style="color:#fff;font-weight:600">${slot.name}</span>`;
            el.style.borderColor = '#5DCAA5';
        }
    }
}

function leaveTournament() {
    tournamentData = null;
    show('s-lobby');
    // Aquí más adelante: avisar al servidor que el jugador salió para devolverle el HP
}
