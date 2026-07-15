// --- MODO TABLERO 5x5 (FASE 2: COMBATE) ---
let boardState = null;
let selectedPiece = null;
let boardBattleData = null;
let originalSurrenderBtn = null;

function initBoardTest() {
    boardState = {
        grid: [
            [0, 'en1', 'en2', 'en3', 0],
            [0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0],
            [0, 'me1', 'me2', 'me3', 0]
        ],
        turn: 'me',
        pieces: {
            'me1': { name: 'aries', img: 'Aries.png', hp: 100 },
            'me2': { name: 'tauro', img: 'Tauro.png', hp: 100 },
            'me3': { name: 'leo', img: 'Leo.png', hp: 100 },
            'en1': { name: 'cancer', img: 'Cancer.png', hp: 100 },
            'en2': { name: 'escorpio', img: 'Escorpio.png', hp: 100 },
            'en3': { name: 'acuario', img: 'Acuario.png', hp: 100 }
        }
    };
    selectedPiece = null;
    renderBoard();
    document.getElementById('board-turn-info').textContent = 'Tu Turno (Prueba)';
    document.getElementById('board-log').textContent = 'Selecciona un Vicamon para mover o atacar.';
}

function renderBoard() {
    const gridEl = document.getElementById('board-grid');
    gridEl.innerHTML = '';
    
    for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
            const cellVal = boardState.grid[r][c];
            const cell = document.createElement('div');
            cell.style.cssText = `background:rgba(255,255,255,.03);border-radius:4px;display:flex;align-items:center;justify-content:center;cursor:pointer;position:relative;border:2px solid rgba(255,255,255,.1);box-sizing:border-box;overflow:hidden;min-width:0;min-height:0;`;
            cell.dataset.r = r;
            cell.dataset.c = c;
            cell.onclick = () => handleCellClick(r, c);

            if (cellVal !== 0) {
                const piece = boardState.pieces[cellVal];
                const isMine = cellVal.startsWith('me');
                cell.innerHTML = `<img src="${piece.img}" style="width:80%;height:80%;object-fit:contain;image-rendering:pixelated;${isMine ? '' : 'transform:scaleX(-1);'}"><div style="position:absolute;bottom:2px;font-size:9px;background:rgba(0,0,0,.8);padding:1px 4px;border-radius:4px;color:#fff">${piece.hp}</div>`;
                cell.style.borderColor = isMine ? '#5DCAA5' : '#F0997B';
            }

            if (selectedPiece && selectedPiece.r === r && selectedPiece.c === c) {
                cell.style.boxShadow = 'inset 0 0 0 2px #4a9eff';
                cell.style.borderColor = '#4a9eff';
            }

            if (selectedPiece && isValidMove(selectedPiece.r, selectedPiece.c, r, c)) {
                cell.style.background = 'rgba(93,202,165,.2)';
                cell.style.borderColor = '#5DCAA5';
            }

            // NUEVO: Resaltar enemigos adyacentes para atacar
            if (selectedPiece && cellVal !== 0 && cellVal.startsWith('en')) {
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
}

function handleCellClick(r, c) {
    const cellVal = boardState.grid[r][c];

    // 1. Si hay una ficha mía, la selecciono
    if (cellVal !== 0 && cellVal.startsWith('me')) {
        selectedPiece = { r, c, id: cellVal };
        document.getElementById('board-log').textContent = `${boardState.pieces[cellVal].name} seleccionado. Mueve 1 casilla o ataca a un rival adyacente.`;
        renderBoard();
        return;
    }

    // 2. Si tengo una ficha seleccionada y hago clic en un enemigo adyacente -> BATALLA
    if (selectedPiece && cellVal !== 0 && cellVal.startsWith('en')) {
        const isAdj = Math.abs(selectedPiece.r - r) <= 1 && Math.abs(selectedPiece.c - c) <= 1;
        if (isAdj) {
            startBoardBattle(selectedPiece.id, cellVal, selectedPiece.r, selectedPiece.c, r, c);
            return;
        }
    }

    // 3. Si tengo una ficha seleccionada y hago clic en una casilla vacía válida -> MOVER
    if (selectedPiece && isValidMove(selectedPiece.r, selectedPiece.c, r, c)) {
        movePiece(selectedPiece.r, selectedPiece.c, r, c);
    }
}

function isValidMove(fromR, fromC, toR, toC) {
    const targetVal = boardState.grid[toR][toC];
    if (targetVal !== 0) return false;

    const dr = Math.abs(toR - fromR);
    const dc = Math.abs(toC - fromC);
    
    if (dr > 1 || dc > 1) return false;
    if (dr === 0 && dc === 0) return false;

    return true;
}

function movePiece(fromR, fromC, toR, toC) {
    const pieceId = boardState.grid[fromR][fromC];
    boardState.grid[fromR][fromC] = 0;
    boardState.grid[toR][toC] = pieceId;
    
    document.getElementById('board-log').textContent = `${boardState.pieces[pieceId].name} se ha movido.`;
    selectedPiece = null;
    renderBoard();
}

// --- LÓGICA DE BATALLA SIMULADA PARA EL TABLERO ---
function startBoardBattle(myId, enId, fromR, fromC, toR, toC) {
    const myPiece = boardState.pieces[myId];
    const enPiece = boardState.pieces[enId];
    
    boardBattleData = { myId, enId, fromR, fromC, toR, toC };
    
    // Configuramos el estado local de batalla
    mySt = { hp: myPiece.hp, maxHp: 100, poisonTurns:0, burnTurns:0, shield:0, reflect50:0, stun:false, recharge:0, blind:0, weakAtk:0, weaken:0, analyzed:0, pp: [99,99,99,99] };
    oppSt = { hp: enPiece.hp, maxHp: 100, poisonTurns:0, burnTurns:0, shield:0, reflect50:0, stun:false, recharge:0, blind:0, weakAtk:0, weaken:0, analyzed:0, pp: [99,99,99,99] };
    myBeast = myPiece.name;
    oppBeast = enPiece.name;
    myName = 'Tú';
    oppName = 'Rival';
    
    show('s-battle');
    
    // Interceptamos el botón de rendirse para que no envíe al servidor
    const surrBtn = document.querySelector('#s-battle .btn-red');
    originalSurrenderBtn = surrBtn.outerHTML; // Guardamos el original
    surrBtn.textContent = '🏳️ Huir';
    surrBtn.onclick = () => endBoardBattle(false, true);
    
    document.getElementById('f-me').innerHTML = panelHTML(mySt, myBeast, myName+' (tú)','me');
    document.getElementById('f-opp').innerHTML = panelHTML(oppSt, oppBeast, oppName,'opp');
    
    const b = BEASTS[myBeast];
    document.getElementById('atk-grid').innerHTML = b.attacks.map((a,i) => 
        `<button class="atk-btn" onclick="doBoardAttack(${i})">
            <div class="atk-top"><div class="atk-name">${a.n}</div><div class="atk-dmg ${dmgClass(a)}">${dmgLabel(a)}</div></div>
            <div class="atk-desc">${a.desc}</div>
        </button>`
    ).join('');
    
    document.getElementById('turn-bar').innerHTML = '<span>Tu turno (Tablero)</span>';
    document.getElementById('log-box').innerHTML = '<div class="ll lc-hi">¡Batalla de Tablero iniciada!</div>';
}

function doBoardAttack(i) {
    const b = BEASTS[myBeast];
    const atk = b.attacks[i];
    
    const hit = Math.random() * 100 < atk.acc;
    if (hit) {
        let dmg = atk.d;
        if(atk.fx === 'double') dmg = atk.d * 2;
        if(atk.fx === 'triple') dmg = atk.d * 3;
        
        oppSt.hp = Math.max(0, oppSt.hp - dmg);
        document.getElementById('log-box').innerHTML += `<div class="ll lc-normal">Tu ${BEASTS[myBeast].name} usó ${atk.n} y causó ${dmg} de daño.</div>`;
    } else {
        document.getElementById('log-box').innerHTML += `<div class="ll lc-bad">Tu ${BEASTS[myBeast].name} usó ${atk.n} pero falló.</div>`;
    }
    
    document.getElementById('f-opp').innerHTML = panelHTML(oppSt, oppBeast, oppName,'opp');
    
    if (oppSt.hp <= 0) {
        endBoardBattle(true, false);
        return;
    }
    
    // El rival ataca automáticamente
    setTimeout(() => {
        const enB = BEASTS[oppBeast];
        const eAtk = enB.attacks[Math.floor(Math.random() * 4)];
        const eHit = Math.random() * 100 < eAtk.acc;
        if (eHit) {
            let eDmg = eAtk.d;
            if(eAtk.fx === 'double') eDmg = eAtk.d * 2;
            mySt.hp = Math.max(0, mySt.hp - eDmg);
            document.getElementById('log-box').innerHTML += `<div class="ll lc-bad">El ${BEASTS[oppBeast].name} rival usó ${eAtk.n} y te causó ${eDmg} de daño.</div>`;
        } else {
            document.getElementById('log-box').innerHTML += `<div class="ll lc-good">El ${BEASTS[oppBeast].name} rival falló.</div>`;
        }
        document.getElementById('f-me').innerHTML = panelHTML(mySt, myBeast, myName+' (tú)','me');
        
        if (mySt.hp <= 0) {
            endBoardBattle(false, false);
        }
    }, 800);
}

function endBoardBattle(won, fled) {
    const data = boardBattleData;
    
    // Restauramos el botón de rendirse original
    const surrBtn = document.querySelector('#s-battle .btn-red');
    if(surrBtn) {
        surrBtn.textContent = '🏳️ Rendirse';
        surrBtn.onclick = surrender;
    }

    if (fled) {
        document.getElementById('board-log').textContent = 'Huiste de la batalla.';
    } else if (won) {
        boardState.pieces[data.myId].hp = mySt.hp; // Guardamos el HP restante
        // Eliminamos al rival del tablero
        boardState.pieces[data.enId].hp = 0; 
        boardState.grid[data.toR][data.toC] = 0;
        // Mi ficha ocupa el lugar del rival
        boardState.grid[data.fromR][data.fromC] = 0;
        boardState.grid[data.toR][data.toC] = data.myId;
        document.getElementById('board-log').textContent = `¡Ganaste! Tu ${BEASTS[myBeast].name} derrotó a ${BEASTS[oppBeast].name}.`;
    } else {
        // Mi ficha es eliminada
        boardState.pieces[data.myId].hp = 0;
        boardState.grid[data.fromR][data.fromC] = 0;
        document.getElementById('board-log').textContent = `Tu ${BEASTS[myBeast].name} fue derrotado.`;
    }
    
    selectedPiece = null;
    boardBattleData = null;
    
    show('s-board');
    renderBoard();
    checkGameOver();
}

function checkGameOver() {
    let myAlive = 0, enAlive = 0;
    for(const id in boardState.pieces) {
        if(boardState.pieces[id].hp > 0) {
            if(id.startsWith('me')) myAlive++;
            else enAlive++;
        }
    }
    
    if(myAlive === 0) {
        document.getElementById('board-log').innerHTML = '☠️ ¡Has perdido todos tus Vicamons! (Game Over)';
        document.getElementById('board-turn-info').textContent = 'Derrota';
    } else if(enAlive === 0) {
        document.getElementById('board-log').innerHTML = '🏆 ¡Has derrotado a todos los Vicamons rivales! (Victoria)';
        document.getElementById('board-turn-info').textContent = 'Victoria';
    }
}
