var labOriginalImg = null; 

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
    calculateLabBalance(); 
});

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

function updateLabMoveUI(selectEl) {
    const box = selectEl.closest('.lab-move-box');
    if(!box) return;
    const type = selectEl.value;
    box.querySelector('.lab-mv-dmg-group').style.display = (type === 'ataque') ? 'block' : 'none';
    box.querySelector('.lab-mv-shield-group').style.display = (type === 'escudo') ? 'block' : 'none';
    box.querySelector('.lab-mv-heal-group').style.display = (type === 'cura') ? 'block' : 'none';
    box.querySelector('.lab-mv-effect-group').style.display = (type === 'ataque') ? 'block' : 'none';
    calculateLabBalance();
}

function calculateLabBalance() {
    let totalPower = 0;
    const moveBoxes = document.querySelectorAll('.lab-move-box');
    
    moveBoxes.forEach(box => {
        const type = box.querySelector('.lab-mv-type').value;
        const effectEl = box.querySelector('.lab-mv-effect');
        const effect = effectEl ? effectEl.value : 'none';
        
        let movePower = 0;
        
        if (type === 'ataque') {
            const dmg = parseInt(box.querySelector('.lab-mv-dmg').value);
            const acc = parseInt(box.querySelector('.lab-mv-acc').value);
            box.querySelector('.lab-mv-dmg-val').textContent = dmg;
            box.querySelector('.lab-mv-acc-val').textContent = acc + '%';
            movePower = dmg * (acc / 100);
        } else if (type === 'escudo') {
            const shield = parseInt(box.querySelector('.lab-mv-shield').value);
            box.querySelector('.lab-mv-shield-val').textContent = shield;
            movePower = shield * 0.8; 
        } else if (type === 'cura') {
            const heal = parseInt(box.querySelector('.lab-mv-heal').value);
            box.querySelector('.lab-mv-heal-val').textContent = heal;
            movePower = heal * 0.8;
        }
        
        const effectValues = { 'none': 0, 'burn': 15, 'poison': 20, 'stun': 30, 'blind': 15 };
        movePower += effectValues[effect] || 0;
        
        totalPower += movePower;
    });
    
    const targetMin = 60;
    const targetMax = 110;
    const absoluteMax = 160; 
    
    const markerEl = document.getElementById('lab-balance-marker');
    const msgEl = document.getElementById('lab-balance-msg');
    const btn = document.getElementById('lab-submit-btn');
    
    let markerPos = Math.min(100, (totalPower / absoluteMax) * 100);
    markerEl.style.left = markerPos + '%';
    
    if (totalPower < targetMin) {
        msgEl.textContent = '⚠ Vicamon Débil. Sube el daño o efectos.';
        msgEl.style.color = '#F6E265'; 
        btn.disabled = false; 
    } else if (totalPower <= targetMax) {
        msgEl.textContent = '✓ Vicamon Balanceado. ¡Listo para enviar!';
        msgEl.style.color = '#5DCAA5'; 
        btn.disabled = false;
    } else {
        msgEl.textContent = '✗ Vicamon Desbalanceado. Baja el daño o efectos.';
        msgEl.style.color = '#F0997B'; 
        btn.disabled = true;
    }
}

function submitLabVicamon() {
    if (isGuest) return alert('Debes conectar tu wallet para crear un Vicamon.');
    if (myCurrentHP < 500) return alert('Necesitas 500 HP para enviar un Vicamon a revisión.');
    if (!labOriginalImg) return alert('Debes subir una imagen de referencia.');
    
    const name = document.getElementById('lab-name').value.trim();
    const sub = document.getElementById('lab-sub').value.trim();
    const el = document.getElementById('lab-element').value;
    
    if (!name || !sub) return alert('Debes ingresar nombre y subtítulo.');
    
    const atkNames = document.querySelectorAll('.lab-mv-name');
    const types = document.querySelectorAll('.lab-mv-type');
    const dmgs = document.querySelectorAll('.lab-mv-dmg');
    const accs = document.querySelectorAll('.lab-mv-acc');
    const shields = document.querySelectorAll('.lab-mv-shield');
    const heals = document.querySelectorAll('.lab-mv-heal');
    const effects = document.querySelectorAll('.lab-mv-effect');
    
    const attacks = [];
    for(let i=0; i<4; i++) {
        const n = atkNames[i].value.trim();
        if(!n) return alert(`Debes nombrar el movimiento ${i+1}.`);
        const type = types[i].value;
        const fx = effects[i] ? effects[i].value : 'none';
        
        attacks.push({
            n: n,
            type: type,
            d: type === 'ataque' ? parseInt(dmgs[i].value) : 0,
            acc: type === 'ataque' ? parseInt(accs[i].value) : 100,
            shield: type === 'escudo' ? parseInt(shields[i].value) : 0,
            heal: type === 'cura' ? parseInt(heals[i].value) : 0,
            fx: fx,
            pp: 5,
            desc: 'Movimiento creado en el Laboratorio.'
        });
    }
    
    const canvas = document.getElementById('lab-canvas');
    const imgData = canvas.toDataURL('image/png');
    
    if (!confirm('¿Estás seguro? Se descontarán 500 HP de tu cuenta y la creación se enviará al admin.')) return;
    
    if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({
            type: 'submit_custom_vicamon',
            beast: { name, sub, el, attacks },
            image: imgData
        }));
        alert('✓ ¡Vicamon enviado a revisión! El admin lo evaluará pronto.');
        show('s-profile');
    } else {
        alert('Error de conexión.');
    }
}

function openQRScanner() {
    const modal = document.getElementById('modal-qr-scanner');
    modal.classList.remove('hidden');
    if (qrScanner) return; 
    qrScanner = new Html5Qrcode("qr-reader");
    qrScanner.start(
        { facingMode: "environment" }, 
        { fps: 10, qrbox: 250 },
        (decodedText) => {
            document.getElementById('inp-physical-code').value = decodedText;
            redeemPhysicalCode();
            closeQRScanner();
        },
        (errorMessage) => { /* Ignorar */ }
    ).catch(err => {
        alert('No se pudo acceder a la cámara. Asegúrate de dar permisos o usa el campo de texto.');
        closeQRScanner();
    });
}

function closeQRScanner() {
    const modal = document.getElementById('modal-qr-scanner');
    modal.classList.add('hidden');
    if (qrScanner) {
        qrScanner.stop().then(() => {
            qrScanner.clear();
            qrScanner = null;
        }).catch(err => {
            qrScanner = null; 
        });
    }
}
