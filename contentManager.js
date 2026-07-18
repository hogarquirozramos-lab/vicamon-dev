const BEASTS_FALLBACK = require('./beasts.js'); // El respaldo por si la BD falla
const { getAllAttacksDB, getAllVicamonsDB, saveAttackDB, saveVicamonDB } = require('./hp-balance');

let ATTACKS = {};
let BEASTS = {};

async function initializeContent() {
  try {
    console.log("[CONTENT] Inicializando contenido desde BD...");
    let dbAttacks = await getAllAttacksDB();
    let dbVicamons = await getAllVicamonsDB();

    // Si la BD está vacía, migramos desde beasts.js (Solo ocurre la primera vez)
    if (dbAttacks.length === 0 || dbVicamons.length === 0) {
      console.log("[CONTENT] BD vacía. Migrando datos iniciales desde beasts.js...");
      
      // 1. Migrar Ataques
      const uniqueAttacks = {};
      for (const key in BEASTS_FALLBACK) {
        BEASTS_FALLBACK[key].attacks.forEach((atk, i) => {
          const atkId = `${key}_atk${i+1}`;
          if (!uniqueAttacks[atkId]) {
            uniqueAttacks[atkId] = { ...atk, id: atkId, type: 'basico', cost: 0 };
            await saveAttackDB(uniqueAttacks[atkId]);
          }
        });
      }
      
      // 2. Migrar Vicamons
      for (const key in BEASTS_FALLBACK) {
        const b = BEASTS_FALLBACK[key];
        const atkIds = b.attacks.map((_, i) => `${key}_atk${i+1}`);
        const vicamonData = {
          id: key, name: b.name, sub: b.sub, img: b.img, el: b.el, style: b.style, cat: b.cat,
          stats: b.stats || null, attacks: atkIds
        };
        await saveVicamonDB(vicamonData);
      }
      
      // Volvemos a leer la BD ahora con datos
      dbAttacks = await getAllAttacksDB();
      dbVicamons = await getAllVicamonsDB();
      console.log("[CONTENT] Migración completada.");
    }

    // Cargar en Memoria
    ATTACKS = {};
    dbAttacks.forEach(a => ATTACKS[a.id] = a);

    BEASTS = {};
    dbVicamons.forEach(v => {
      // Reconstruir el objeto Vicamon como lo espera el motor de batalla
      BEASTS[v.id] = {
        name: v.name, sub: v.sub, img: v.img, el: v.el, style: v.style, cat: v.cat,
        stats: v.stats,
        attacks: v.attacks.map(atkId => {
          const atkData = ATTACKS[atkId];
          if (!atkData) return { n: 'Desconocido', d: 0, acc: 100, pp: 99, desc: 'Error' };
          return { n: atkData.name, d: atkData.d, acc: atkData.acc, fx: atkData.fx, pp: atkData.pp, desc: atkData.desc };
        })
      };
    });

    console.log(`[CONTENT] ${Object.keys(BEASTS).length} Vicamons y ${Object.keys(ATTACKS).length} Ataques cargados en memoria.`);
    
    // Exponer globalmente para que el resto del servidor los use en lugar de beasts.js
    global.BEASTS_DB = BEASTS;
    global.ATTACKS_DB = ATTACKS;

  } catch(e) {
    console.error("[CONTENT ERROR] No se pudo cargar desde BD. Usando fallback beasts.js", e);
    global.BEASTS_DB = BEASTS_FALLBACK;
    global.ATTACKS_DB = {};
  }
}

module.exports = { initializeContent };
