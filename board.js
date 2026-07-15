// --- MODO TABLERO 5x5 ---
let boardState = null;
let selectedPiece = null;

function initBoardTest() {
    // Estado inicial de prueba (3 vs 3)
    boardState = {
        grid: [
            [0, 'en1', 'en2', 'en3', 0], // Fila 0 (Arriba - Rival/Master)
            [0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0],
            [0, 'me1', 'me2', 'me3', 0]  // Fila 4 (Abajo - Tú)
        ],
        turn: 'me',
        pieces: {
            'me1': { name: 'Aries', img: 'Aries.png', hp: 100 },
            'me2': { name: 'Tauro', img: 'Tauro.png', hp: 100 },
            'me3': { name: 'Leo', img: 'Leo.png', hp: 100 },
            'en1': { name: 'Cancer', img: 'Cancer.png', hp: 100 },
            'en2': { name: 'Escorpio', img: 'Escorpio.png', hp: 100 },
            'en3': { name: 'Acuario', img: 'Acuario.png', hp: 100 }
        }
    };
    selectedPiece = null;
    renderBoard();
    document.getElementById('board-turn-info').textContent = 'Tu Turno (Prueba)';
    document.getElementById('board-log').textContent = 'Selecciona un Vicamon para mover.';
}

function renderBoard() {
    const gridEl = document.getElementById('board-grid');
    gridEl.innerHTML = '';
    
    for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
            const cellVal = boardState.grid[r][c];
            const cell = document.createElement('div');
            
            // FIX: Agregado min-width y min-height para evitar que la imagen deforme la celda
            cell.style.cssText = `background:rgba(255,255,255,.03);border-radius:4px;display:flex;align-items:center;justify-content:center;cursor:pointer;position:relative;border:2px solid rgba(255,255,255,.1);box-sizing:border-box;overflow:hidden;min-width:0;min-height:0;`;
            cell.dataset.r = r;
            cell.dataset.c = c;
            
            cell.onclick = () => handleCellClick(r, c);

            if (cellVal !== 0) {
                const piece = boardState.pieces[cellVal];
                const isMine = cellVal.startsWith('me');
                // FIX: object-fit: contain asegura que la imagen nunca se deforme
                cell.innerHTML = `<img src="${piece.img}" style="width:80%;height:80%;object-fit:contain;image-rendering:pixelated;${isMine ? '' : 'transform:scaleX(-1);'}"><div style="position:absolute;bottom:2px;font-size:9px;background:rgba(0,0,0,.8);padding:1px 4px;border-radius:4px;color:#fff">${piece.hp}</div>`;
                cell.style.borderColor = isMine ? '#5DCAA5' : '#F0997B';
            }

            // Resaltar casilla seleccionada
            if (selectedPiece && selectedPiece.r === r && selectedPiece.c === c) {
                cell.style.boxShadow = 'inset 0 0 0 2px #4a9eff';
                cell.style.borderColor = '#4a9eff';
            }

            // Resaltar movimientos válidos
            if (selectedPiece && isValidMove(selectedPiece.r, selectedPiece.c, r, c)) {
                cell.style.background = 'rgba(93,202,165,.2)';
                cell.style.borderColor = '#5DCAA5';
            }

            gridEl.appendChild(cell);
        }
    }
}

function handleCellClick(r, c) {
    const cellVal = boardState.grid[r][c];

    // 1. Si hay una ficha mía, la selecciono
    if (cellVal !== 0 && cellVal.startsWith('me')) {
        selectedPiece = { r, c, id: cellVal };
        document.getElementById('board-log').textContent = `${boardState.pieces[cellVal].name} seleccionado. Mueve hasta 2 casillas.`;
        renderBoard();
        return;
    }

    // 2. Si tengo una ficha seleccionada y hago clic en una casilla válida
    if (selectedPiece && isValidMove(selectedPiece.r, selectedPiece.c, r, c)) {
        movePiece(selectedPiece.r, selectedPiece.c, r, c);
    }
}

function isValidMove(fromR, fromC, toR, toC) {
    const targetVal = boardState.grid[toR][toC];
    if (targetVal !== 0) return false; // No puede moverse a casillas ocupadas por ahora

    const dr = Math.abs(toR - fromR);
    const dc = Math.abs(toC - fromC);
    
    // REGLA NUEVA: Máximo 1 casilla en cualquier dirección (como el Rey de ajedrez)
    if (dr > 1 || dc > 1) return false;
    if (dr === 0 && dc === 0) return false;

    return true;
}

function movePiece(fromR, fromC, toR, toC) {
    const pieceId = boardState.grid[fromR][fromC];
    boardState.grid[fromR][fromC] = 0;
    boardState.grid[toR][toC] = pieceId;
    
    document.getElementById('board-log').textContent = `${boardState.pieces[cellVal].name} seleccionado. Mueve 1 casilla en cualquier dirección.`;
    
    selectedPiece = null;
    renderBoard();
    
    // Aquí más adelante: comprobar si está al lado de un rival para iniciar batalla
    checkBattleProximity(toR, toC);
}

function checkBattleProximity(r, c) {
    // Revisa las 8 casillas adyacentes para ver si hay un rival
    const directions = [
        [-1,-1], [-1,0], [-1,1],
        [0,-1],          [0,1],
        [1,-1],  [1,0],  [1,1]
    ];

    for (const [dr, dc] of directions) {
        const newR = r + dr;
        const newC = c + dc;
        if (newR >= 0 && newR < 5 && newC >= 0 && newC < 5) {
            const adjVal = boardState.grid[newR][newC];
            if (adjVal !== 0 && adjVal.startsWith('en')) {
                document.getElementById('board-log').innerHTML = `⚠️ ¡<strong>${boardState.pieces[adjVal].name}</strong> está al lado! (Próximo paso: Iniciar Batalla)`;
                return;
            }
        }
    }
}
