// --- MODO TABLERO 7x7 (FRONTEND) ---
let boardState = null;
let selectedPiece = null;

function renderBoardState(grid, pieces, yourTurn, logs) {
    boardState = { grid, pieces };
    const gridEl = document.getElementById('board-grid');
    gridEl.innerHTML = '';
    
    document.getElementById('board-turn-info').textContent = yourTurn ? 'Tu Turno' : 'Turno del Rival';
    document.getElementById('board-log').textContent = yourTurn ? 'Selecciona un Vicamon para mover o atacar.' : 'Esperando movimiento del rival...';

    for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 7; c++) {
            const cellVal = boardState.grid[r][c];
            const cell = document.createElement('div');
            cell.style.cssText = `background:rgba(0,0,0,.4);border-radius:4px;display:flex;align-items:center;justify-content:center;cursor:pointer;position:relative;border:1px solid rgba(255,255,255,.1);box-sizing:border-box;overflow:hidden;min-width:0;min-height:0;`;
            
            if (!yourTurn) cell.style.cursor = 'not-allowed';

            cell.onclick = () => {
                if (!yourTurn) return;
                handleBoardCellClick(r, c);
            };

            // Dibujar elementos del mapa
            if (cellVal === 'rock') {
                cell.innerHTML = '🪨'; cell.style.background = 'rgba(80,80,80,.5)'; cell.style.cursor = 'not-allowed';
            } else if (cellVal === 'heart') {
                cell.innerHTML = '❤️'; cell.style.background = 'rgba(216, 80, 80, 0.2)';
            } else if (cellVal === 'chest') {
                cell.innerHTML = '🧰'; cell.style.background = 'rgba(246,226,102,.2)';
            }

            // Dibujar Vicamons
            if (typeof cellVal === 'string' && (cellVal.startsWith('p1') || cellVal.startsWith('p2'))) {
                const piece = boardState.pieces[cellVal];
                if (piece && !piece.isDead) {
                    const b = BEASTS[piece.beast];
                    const isMine = cellVal.startsWith(window._boardRole);
                    cell.innerHTML = `<img src="${b.img}" style="width:80%;height:80%;object-fit:contain;image-rendering:pixelated;${isMine ? '' : 'transform:scaleX(-1);'}"><div style="position:absolute;bottom:0;font-size:8px;background:rgba(0,0,0,.8);padding:1px 3px;border-radius:4px;color:#fff">${piece.hp}</div>`;
                    cell.style.borderColor = isMine ? '#5DCAA5' : '#F0997B';
                }
            }

            // Resaltar casilla seleccionada
            if (selectedPiece && selectedPiece.r === r && selectedPiece.c === c) {
                cell.style.boxShadow = 'inset 0 0 0 2px #4a9eff';
                cell.style.borderColor = '#4a9eff';
            }

            // Resaltar movimientos válidos
            if (selectedPiece && isValidBoardMove(selectedPiece.r, selectedPiece.c, r, c)) {
                cell.style.background = 'rgba(93,202,165,.2)';
                cell.style.borderColor = '#5DCAA5';
            }

            // Resaltar enemigos adyacentes para atacar
            if (selectedPiece && typeof cellVal === 'string' && !cellVal.startsWith(window._boardRole) && (cellVal.startsWith('p1') || cellVal.startsWith('p2'))) {
                const isAdj = Math.abs(selectedPiece.r - r) <= 1 && Math.abs(selectedPiece.c - c) <= 1;
                if (isAdj) {
                    cell.style.background = 'rgba(240,153,122,.2)';
                    cell.style.borderColor = '#F0997B';
                    cell.style.boxShadow = 'inset 0 0 0 2px #F0997B';
                }
            }

            gridEl.appendChild(cell);
        }
    }

    // Actualizar logs
    if(logs && logs.length > 0) {
        document.getElementById('board-log').textContent = logs[logs.length-1].t;
    }
}

function handleBoardCellClick(r, c) {
    const cellVal = boardState.grid[r][c];

    // 1. Si hay una ficha mía, la selecciono
    if (typeof cellVal === 'string' && cellVal.startsWith(window._boardRole)) {
        selectedPiece = { r, c, id: cellVal };
        document.getElementById('board-log').textContent = `${BEASTS[boardState.pieces[cellVal].beast].name} seleccionado.`;
        renderBoardState(boardState.grid, boardState.pieces, true, null);
        return;
    }

    // 2. Si tengo una ficha seleccionada y hago clic en un enemigo adyacente -> ATACAR
    if (selectedPiece && typeof cellVal === 'string' && !cellVal.startsWith(window._boardRole) && (cellVal.startsWith('p1') || cellVal.startsWith('p2'))) {
        const isAdj = Math.abs(selectedPiece.r - r) <= 1 && Math.abs(selectedPiece.c - c) <= 1;
        if (isAdj) {
            ws.send(JSON.stringify({type: 'board_attack', battleId: battleId, fromR: selectedPiece.r, fromC: selectedPiece.c, toR: r, toC: c}));
            selectedPiece = null;
            return;
        }
    }

    // 3. Si tengo una ficha seleccionada y hago clic en una casilla válida -> MOVER
    if (selectedPiece && isValidBoardMove(selectedPiece.r, selectedPiece.c, r, c)) {
        ws.send(JSON.stringify({type: 'board_move', battleId: battleId, fromR: selectedPiece.r, fromC: selectedPiece.c, toR: r, toC: c}));
        selectedPiece = null;
    }
}

function isValidBoardMove(fromR, fromC, toR, toC) {
    const targetVal = boardState.grid[toR][toC];
    if (targetVal === 'rock') return false;
    if (typeof targetVal === 'string' && (targetVal.startsWith('p1') || targetVal.startsWith('p2'))) return false;

    const dr = Math.abs(toR - fromR);
    const dc = Math.abs(toC - fromC);
    
    if (dr > 1 || dc > 1) return false;
    if (dr === 0 && dc === 0) return false;

    return true;
}
