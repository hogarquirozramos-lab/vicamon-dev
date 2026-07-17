// --- MODO TORNEO (FRONTEND) ---
let tournamentData = null;

// Función de prueba para ver la interfaz
function joinTournamentTest() {
    tournamentData = {
        mode: 'HP',
        pot: 100, // Tú entraste, hay 100 HP en el pozo
        slots: [
            { name: myName, status: 'waiting' }, // FIX: Usa tu nombre real
            { name: 'Esperando...', status: 'empty' },
            { name: 'Esperando...', status: 'empty' },
            { name: 'Esperando...', status: 'empty' }
        ],
        status: 'Esperando 3 jugadores más para iniciar...'
    };
    renderTournament();
}

function renderTournament() {
    if (!tournamentData) return;
    
    document.getElementById('tour-mode').textContent = `Torneo ${tournamentData.mode} (100 ${tournamentData.mode === 'HP' ? 'HP' : 'XP'})`;
    document.getElementById('tour-pot').textContent = `${tournamentData.pot} ${tournamentData.mode === 'HP' ? 'HP' : 'XP'}`;
    document.getElementById('tour-status').textContent = tournamentData.status;

    // Llenar los 4 slots de la base (Semifinales)
    for (let i = 0; i < 4; i++) {
        const slot = tournamentData.slots[i];
        const el = document.getElementById(`tour-slot-${i+1}`);
        if (!el) continue;
        
        if (slot.status === 'empty') {
            el.innerHTML = `<span style="color:rgba(255,255,255,.3)">${slot.name}</span>`;
            el.style.borderColor = 'rgba(255,255,255,.1)';
            el.style.boxShadow = 'none';
        } else {
            el.innerHTML = `<span style="color:#fff;font-weight:600">${slot.name}</span>`;
            el.style.borderColor = '#5DCAA5';
            el.style.boxShadow = '0 0 8px rgba(93,202,165,.2)';
        }
    }

    // Limpiar la Final y el Campeón por defecto
    const w1 = document.getElementById('tour-slot-w1');
    const w2 = document.getElementById('tour-slot-w2');
    const champ = document.getElementById('tour-slot-champ');
    
    if (w1) w1.innerHTML = `<span style="color:rgba(255,255,255,.3)">Ganador SF1</span>`;
    if (w2) w2.innerHTML = `<span style="color:rgba(255,255,255,.3)">Ganador SF2</span>`;
    if (champ) champ.innerHTML = `<span style="color:rgba(246,226,102,.5);font-weight:700;font-size:24px">🏆</span><span style="color:rgba(246,226,102,.5);font-size:11px;margin-top:5px">Esperando Campeón</span>`;
}

function leaveTournament() {
    tournamentData = null;
    show('s-lobby');
}
