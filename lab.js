var labOriginalImg = null; 

// NUEVO: Pool de movimientos predefinidos (estilo Pokémon)
const MOVE_POOL = [
    // --- Ataques Básicos ---
    { n: 'Golpe Básico', d: 20, acc: 100, fx: null, pp: 99, desc: 'Confiable, nunca falla. PP infinito.', pts: 20, type: 'atk' },
    { n: 'Súper Golpe', d: 35, acc: 80, fx: null, pp: 5, desc: 'Mucho daño, pero puede fallar.', pts: 28, type: 'atk' },
    { n: 'Golpe Rápido', d: 15, acc: 100, fx: 'double', pp: 10, desc: 'Golpea dos veces seguidas.', pts: 24, type: 'atk' },
    { n: 'Embestida', d: 40, acc: 75, fx: null, pp: 5, desc: 'Devastador, pero impreciso.', pts: 30, type: 'atk' },
    { n: 'Drenaje', d: 15, acc: 100, fx: 'drain10', pp: 5, desc: 'Daña 15 HP y te cura 10 HP.', pts: 25, type: 'atk' },
    
    // --- Ataques con Estado (Debuffs) ---
    { n: 'Lanzallamas', d: 18, acc: 100, fx: 'burn', pp: 5, desc: 'Daño + Quema al rival (6 HP/turno).', pts: 28, type: 'atk' },
    { n: 'Picadura Tóxica', d: 6, acc: 100, fx: 'poison5', pp: 5, desc: 'Daño leve + Veneno grave (8 HP/turno).', pts: 26, type: 'atk' },
    { n: 'Carga Cegadora', d: 15, acc: 85, fx: 'blind', pp: 5, desc: 'Daño + Ciega al rival (baja su precisión).', pts: 24, type: 'atk' },
    
    // --- Defensas y Curas ---
    { n: 'Escudo', d: 0, acc: 100, fx: 'shield2', pp: 5, desc: 'Bloquea los próximos 2 ataques.', pts: 25, type: 'buff' },
    { n: 'Cura Menor', d: 0, acc: 100, fx: 'heal20', pp: 5, desc: 'Restaura 20 HP.', pts: 20, type: 'buff' },
    { n: 'Fortaleza', d: 0, acc: 100, fx: 'fortress', pp: 3, desc: 'Escudo + Cura 15 HP + Regeneración.', pts: 35, type: 'buff' },
    { n: 'Purificar', d: 0, acc: 100, fx: 'purify', pp: 3, desc: 'Cura tus estados negativos + 15 HP.', pts: 22, type: 'buff' },
    
    // --- Soporte / Control ---
    { n: 'Debilitar', d: 0, acc: 100, fx: 'weaken', pp: 3, desc: 'El rival hace 25% menos de daño (2 turnos).', pts: 20, type: 'debuff' },
    { n: 'Onda Aturdidora', d: 0, acc: 80, fx: 'stun', pp: 3, desc: 'El rival pierde su próximo turno.', pts: 25, type: 'debuff' }
];

document.addEventListener('DOMContentLoaded', () => {
    const imgInput = document.getElementById('lab-img-input');
    if(imgInput) {
        imgInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                labOriginalImg = new Image();
                labOriginalImg.onload = () => {
                    processLabImage();
                };
                labOriginalImg.src = event.target.result;
            };
            reader.readAsDataURL(file);
        });
    }
    
    populateMoveSelects();
    calculateLabBalance(); 
});

function populateMoveSelects() {
    const selects = document.querySelectorAll('.lab-mv-select');
    selects.forEach((sel, idx) => {
        let html = '<option value="" style="background:#1a1a24;color:#fff">-- Selecciona un Movimiento --</option>';
        MOVE_POOL.forEach((mv, i) => {
            let typeIcon = mv.type === 'atk' ? '⚔️' : mv.type === 'buff' ? '🛡️' : '✨';
            html += `<option value="${i}" style="background:#1a1a24;color:#fff">${typeIcon} ${mv.n}</option>`;
        });
        sel.innerHTML = html;
        sel.onchange = () => {
            calculateLabBalance();
            updateMoveDescriptions();
        };
    });
}

function updateMoveDescriptions() {
    const selects = document.querySelectorAll('.lab-mv-select');
    selects.forEach(sel => {
        const descEl = sel.parentElement.querySelector('.lab-mv-desc');
        if (!descEl) return;
        
        if (sel.value === "") {
            descEl.innerHTML = '<span style="color:rgba(255,255,255,.3)">Selecciona un movimiento para ver su efecto.</span>';
            return;
        }
        
        const mv = MOVE_POOL[parseInt(sel.value)];
        let typeText = mv.type === 'atk' ? '⚔️ Ataque' : mv.type === 'buff' ? '🛡️ Defensa' : '✨ Soporte';
        let statsText = `Daño: ${mv.d} | Prec: ${mv.acc}% | PP: ${mv.pp === 99 ? '∞' : mv.pp}`;
        
        descEl.innerHTML = `<strong style="color:#85B7EB">${typeText}</strong> · ${mv.desc} <br><span style="font-size:9px;color:rgba(255,255,255,.4)">${statsText}</span>`;
    });
}

function processLabImage() {
    if (!labOriginalImg) return;
    const canvas = document.getElementById('lab-canvas');
    if(!canvas) return;
    const ctx = canvas.getContext('2d');
    
    const pixelSize = parseInt(document.getElementById('lab-pixel-size').value);
    const paletteSize = parseInt(document.getElementById('lab-color-palette').value);
    
    const w = canvas.width;
    const h = canvas.height;
    
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    tempCanvas.width = Math.max(1, Math.floor(w / pixelSize));
    tempCanvas.height = Math.max(1, Math.floor(h / pixelSize));
    
    const imgW = labOriginalImg.width;
    const imgH = labOriginalImg.height;
    const size = Math.min(imgW, imgH);
    const sx = (imgW - size) / 2;
    const sy = (imgH - size) / 2;
    
    tempCtx.drawImage(labOriginalImg, sx, sy, size, size, 0, 0, tempCanvas.width, tempCanvas.height);
    
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(tempCanvas, 0, 0, w, h);
    
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;
    const step = 255 / (paletteSize - 1);
    
    for (let i = 0; i < data.length; i += 4) {
        data[i] = Math.round(data[i] / step) * step;     
        data[i+1] = Math.round(data[i+1] / step) * step; 
        data[i+2] = Math.round(data[i+2] / step) * step; 
    }
    ctx.putImageData(imageData, 0, 0);
}

function calculateLabBalance() {
    const selects = document.querySelectorAll('.lab-mv-select');
    let totalPower = 0;
    let buffCount = 0;
    let atkCount = 0;
    let emptyCount = 0;
    let uniqueMoves = new Set();

    selects.forEach(sel => {
        if (sel.value === "") {
            emptyCount++;
            return;
        }
        const mv = MOVE_POOL[parseInt(sel.value)];
        totalPower += mv.pts;
        uniqueMoves.add(mv.n);
        
        if (mv.type === 'buff') buffCount++;
        if (mv.type === 'atk') atkCount++;
    });

    const markerEl = document.getElementById('lab-balance-marker');
    const msgEl = document.getElementById('lab-balance-msg');
    const btn = document.getElementById('lab-submit-btn');
    
    const absoluteMax = 160; 
    let markerPos = Math.min(100, (totalPower / absoluteMax) * 100);
    markerEl.style.left = markerPos + '%';
    
    // Reglas de Validación
    if (emptyCount > 0) {
        msgEl.textContent = 'Te faltan elegir movimientos.';
        msgEl.style.color = '#EF9F27'; 
        btn.disabled = true;
        return;
    }
    
    if (uniqueMoves.size < 4) {
        msgEl.textContent = 'No puedes repetir movimientos.';
        msgEl.style.color = '#F0997B'; 
        btn.disabled = true;
        return;
    }
    
    if (buffCount > 2) {
        msgEl.textContent = 'Máximo 2 movimientos defensivos/curas.';
        msgEl.style.color = '#F0997B'; 
        btn.disabled = true;
        return;
    }
    
    if (atkCount === 0) {
        msgEl.textContent = 'Debes tener al menos 1 movimiento de ataque.';
        msgEl.style.color = '#F0997B'; 
        btn.disabled = true;
        return;
    }

    // Evaluación de Puntos
    if (totalPower < 70) {
        msgEl.textContent = '⚠ Vicamon Débil. Sube el daño o efectos.';
        msgEl.style.color = '#F6E265'; 
        btn.disabled = false; 
    } else if (totalPower <= 120) {
        msgEl.textContent = '✓ Vicamon Balanceado. ¡Listo para enviar!';
        msgEl.style.color = '#5DCAA5';
