const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Asegurar estructura de DB
pool.query(`CREATE TABLE IF NOT EXISTS players (
  id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE, password VARCHAR(255), wallet VARCHAR(50) UNIQUE,
  hp INTEGER DEFAULT 100, locked_hp INTEGER DEFAULT 0, vc INTEGER DEFAULT 0,
  wins INTEGER DEFAULT 0, losses INTEGER DEFAULT 0, last_name VARCHAR(20), tower_train_date VARCHAR(10), last_hp_reset VARCHAR(10)
);`).catch(e => console.error("Error creando tabla players:", e));

pool.query(`CREATE TABLE IF NOT EXISTS platform (
  id INTEGER PRIMARY KEY DEFAULT 1, hp INTEGER DEFAULT 0, 
  tour_hp_prize INTEGER DEFAULT 200, tour_vc_prize INTEGER DEFAULT 100,
  tower_t1_hp INTEGER DEFAULT 30, tower_t1_vc INTEGER DEFAULT 5,
  tower_t2_hp INTEGER DEFAULT 50, tower_t2_vc INTEGER DEFAULT 10,
  tower_t3_hp INTEGER DEFAULT 100, tower_t3_vc INTEGER DEFAULT 100,
  tower_daily_vc INTEGER DEFAULT 15
);`).catch(e=>{});
pool.query(`INSERT INTO platform (id, hp) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;`).catch(e=>{});

pool.query(`ALTER TABLE platform ADD COLUMN IF NOT EXISTS tour_hp_prize INTEGER DEFAULT 200;`).catch(e=>{});
pool.query(`ALTER TABLE platform ADD COLUMN IF NOT EXISTS tour_vc_prize INTEGER DEFAULT 100;`).catch(e=>{});
pool.query(`ALTER TABLE platform ADD COLUMN IF NOT EXISTS tower_t1_hp INTEGER DEFAULT 30;`).catch(e=>{});
pool.query(`ALTER TABLE platform ADD COLUMN IF NOT EXISTS tower_t1_vc INTEGER DEFAULT 5;`).catch(e=>{});
pool.query(`ALTER TABLE platform ADD COLUMN IF NOT EXISTS tower_t2_hp INTEGER DEFAULT 50;`).catch(e=>{});
pool.query(`ALTER TABLE platform ADD COLUMN IF NOT EXISTS tower_t2_vc INTEGER DEFAULT 10;`).catch(e=>{});
pool.query(`ALTER TABLE platform ADD COLUMN IF NOT EXISTS tower_t3_hp INTEGER DEFAULT 100;`).catch(e=>{});
pool.query(`ALTER TABLE platform ADD COLUMN IF NOT EXISTS tower_t3_vc INTEGER DEFAULT 100;`).catch(e=>{});
pool.query(`ALTER TABLE platform ADD COLUMN IF NOT EXISTS tower_daily_vc INTEGER DEFAULT 15;`).catch(e=>{});

pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS vc INTEGER DEFAULT 0;`).catch(e=>{});
pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS last_hp_reset VARCHAR(10);`).catch(e=>{});
pool.query(`CREATE TABLE IF NOT EXISTS processed_txs (signature VARCHAR(100) PRIMARY KEY);`).catch(e=>{});
pool.query(`CREATE TABLE IF NOT EXISTS attacks (id VARCHAR(50) PRIMARY KEY, name VARCHAR(50), d INT, acc INT, fx VARCHAR(50), pp INT, description TEXT, type VARCHAR(20), cost INT);`).catch(e => console.error("Error creando tabla attacks:", e));
pool.query(`CREATE TABLE IF NOT EXISTS vicamons (id VARCHAR(50) PRIMARY KEY, name VARCHAR(50), sub VARCHAR(50), img VARCHAR(100), el VARCHAR(20), style VARCHAR(20), cat VARCHAR(20), stats JSONB, attacks JSONB);`).catch(e => console.error("Error creando tabla vicamons:", e));

// NUEVA TABLA: VICAMONS POSEÍDOS
pool.query(`CREATE TABLE IF NOT EXISTS owned_vicamons (
  id SERIAL PRIMARY KEY,
  owner_wallet VARCHAR(50),
  beast_key VARCHAR(50),
  custom_name VARCHAR(20),
  level INTEGER DEFAULT 1,
  xp INTEGER DEFAULT 0,
  atk INTEGER DEFAULT 0,
  def INTEGER DEFAULT 0,
  spd INTEGER DEFAULT 0,
  hunger INTEGER DEFAULT 100,
  happiness INTEGER DEFAULT 100,
  energy INTEGER DEFAULT 100,
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`).catch(e => console.error("Error creando tabla owned_vicamons:", e));

const USDC_PER_HP = 0.001;
const PLATFORM_WALLET = process.env.PLATFORM_WALLET || 'U3jwNBDnw4kCQ5CYRp5mAf4hbr4dadyUGXDhXdyLXMv';

async function checkDailyReset(wallet) {
  const today = new Date().toISOString().split('T')[0];
  const res = await pool.query('SELECT last_hp_reset, hp FROM players WHERE wallet = $1', [wallet]);
  if (res.rows.length > 0) {
    const p = res.rows[0];
    if (p.last_hp_reset !== today && p.hp < 100) {
      await pool.query('UPDATE players SET hp = 100, last_hp_reset = $1 WHERE wallet = $2', [today, wallet]);
      return 100;
    }
  }
  return res.rows.length > 0 ? res.rows[0].hp : 0;
}

let cachedExcedente = 0;
async function updateCachedExcedente() {
  try {
    const platformHp = await getPlatformHp();
    const playersHp = await getTotalPlayersHP();
    cachedExcedente = platformHp - playersHp;
  } catch(e) { console.error("Error actualizando excedente caché:", e); }
}
setInterval(updateCachedExcedente, 10000);
updateCachedExcedente(); 

async function createUser(email, hashedPassword, nick) {
  const today = new Date().toISOString().split('T')[0];
  await pool.query(`INSERT INTO players (email, wallet, password, last_name, hp, vc, wins, losses, last_hp_reset) VALUES ($1, $1, $2, $3, 100, 0, 0, 0, $4)`, [email, hashedPassword, nick, today]);
  const res = await pool.query('SELECT id, email, last_name FROM players WHERE email = $1', [email]);
  return res.rows[0];
}
async function getUserByEmail(email) { const res = await pool.query('SELECT * FROM players WHERE email = $1', [email]); return res.rows[0]; }

async function getAllPlayersDebug() { const res = await pool.query('SELECT id, email, wallet, hp, locked_hp, vc, wins, losses, last_name FROM players'); return res.rows; }
async function isTxProcessed(signature) { const res = await pool.query('SELECT 1 FROM processed_txs WHERE signature = $1', [signature]); return res.rows.length > 0; }
async function markTxProcessed(signature) { await pool.query('INSERT INTO processed_txs (signature) VALUES ($1) ON CONFLICT DO NOTHING', [signature]); }
async function adminSetHP(wallet, hp) { await pool.query(`INSERT INTO players (wallet, hp) VALUES ($1, $2) ON CONFLICT (wallet) DO UPDATE SET hp = $2`, [wallet, hp]); return await getHP(wallet); }
async function adminResetPlatform() { await pool.query('UPDATE platform SET hp = 0 WHERE id = 1'); }
async function adminUnlockAllHP() { await pool.query('UPDATE players SET hp = hp + locked_hp, locked_hp = 0'); }
async function updatePlayerName(wallet, name) { await pool.query(`INSERT INTO players (wallet, last_name) VALUES ($1, $2) ON CONFLICT (wallet) DO UPDATE SET last_name = $2`, [wallet, name]); }
async function updatePlayerStats(winnerWallet, loserWallet) { await pool.query('UPDATE players SET wins = wins + 1 WHERE wallet = $1', [winnerWallet]); await pool.query('UPDATE players SET losses = losses + 1 WHERE wallet = $1', [loserWallet]); }
async function getTopPlayers(limit = 3) { const res = await pool.query('SELECT last_name, wins, losses FROM players WHERE wins > 0 ORDER BY wins DESC, losses ASC LIMIT $1', [limit]); return res.rows; }

async function getLeaderboard(limit = 100) {
    const tRes = await pool.query('SELECT COUNT(*) as total FROM players WHERE wins > 0 OR losses > 0');
    const totalRanked = parseInt(tRes.rows[0].total, 10);
    if (totalRanked === 0) return [];
    const res = await pool.query('SELECT last_name, wins, losses FROM players WHERE wins > 0 OR losses > 0 ORDER BY wins DESC, losses ASC LIMIT $1', [limit]);
    return res.rows.map((p, index) => {
        const rank = index + 1; let tier = 5; 
        if (totalRanked > 0) {
            const percentile = (rank / totalRanked) * 100;
            if (percentile <= 5) tier = 1; else if (percentile <= 15) tier = 2; else if (percentile <= 30) tier = 3; else if (percentile <= 50) tier = 4; else tier = 5;
        }
        return { ...p, rank, tier };
    });
}

async function getPlayerStats(wallet) {
  const res = await pool.query('SELECT wins, losses FROM players WHERE wallet = $1', [wallet]);
  if (res.rows.length === 0) return { wins: 0, losses: 0, rank: null, tier: 0, totalRanked: 0 };
  const { wins, losses } = res.rows[0]; let rank = null, tier = 0, totalRanked = 0;
  if (wins > 0 || losses > 0) {
    const rRes = await pool.query('SELECT COUNT(*) + 1 as rank FROM players WHERE wins > $1 OR (wins = $1 AND losses < $2)', [wins, losses]);
    const tRes = await pool.query('SELECT COUNT(*) as total FROM players WHERE wins > 0 OR losses > 0');
    rank = parseInt(rRes.rows[0].rank, 10); totalRanked = parseInt(tRes.rows[0].total, 10);
    if (totalRanked > 0) {
      const percentile = (rank / totalRanked) * 100;
      if (percentile <= 5) tier = 1; else if (percentile <= 15) tier = 2; else if (percentile <= 30) tier = 3; else if (percentile <= 50) tier = 4; else tier = 5;
    } else { tier = 5; }
  } else { tier = 0; }
  return { wins, losses, rank, tier, totalRanked };
}
async function getPlayerRank(wallet) { const stats = await getPlayerStats(wallet); return stats.rank; }

async function getVC(wallet) { const res = await pool.query('SELECT vc FROM players WHERE wallet = $1', [wallet]); return res.rows.length > 0 ? res.rows[0].vc : 0; }
async function addVC(wallet, amount) { await pool.query('UPDATE players SET vc = vc + $1 WHERE wallet = $2', [amount, wallet]); return await getVC(wallet); }
async function hasVC(wallet, amount) { return (await getVC(wallet)) >= amount; }
async function spendVC(wallet, amount) { 
  const client = await pool.connect(); 
  try { await client.query('BEGIN'); const res = await client.query('SELECT vc FROM players WHERE wallet = $1 FOR UPDATE', [wallet]); const currentVc = res.rows.length > 0 ? res.rows[0].vc : 0; if (currentVc < amount) { await client.query('ROLLBACK'); return false; } await client.query('UPDATE players SET vc = vc - $1 WHERE wallet = $2', [amount, wallet]); await client.query('COMMIT'); return true; } catch(e) { await client.query('ROLLBACK'); return false; } finally { client.release(); } 
}

async function getHP(wallet) { const hp = await checkDailyReset(wallet); return hp; }
async function addHP(wallet, hp) { await pool.query(`INSERT INTO players (wallet, hp, locked_hp) VALUES ($1, $2, 0) ON CONFLICT (wallet) DO UPDATE SET hp = players.hp + $2`, [wallet, hp]); return await getHP(wallet); }
async function hasHP(wallet, amount = 100) { return (await getHP(wallet)) >= amount; }
async function lockHP(wallet, amount = 100) { const client = await pool.connect(); try { await client.query('BEGIN'); const res = await client.query('SELECT hp FROM players WHERE wallet = $1 FOR UPDATE', [wallet]); const currentHp = res.rows.length > 0 ? res.rows[0].hp : 0; if (currentHp < amount) { await client.query('ROLLBACK'); return false; } await client.query('UPDATE players SET hp = hp - $1, locked_hp = locked_hp + $1 WHERE wallet = $2', [amount, wallet]); await client.query('COMMIT'); return true; } catch(e) { await client.query('ROLLBACK'); return false; } finally { client.release(); } }
async function unlockHP(wallet, amount = 100) { await pool.query('UPDATE players SET hp = hp + $1, locked_hp = GREATEST(0, locked_hp - $1) WHERE wallet = $2', [amount, wallet]); }

async function settleMatch(winnerWallet, loserWallet, winnerHp) { 
  const client = await pool.connect(); 
  try { await client.query('BEGIN'); const hp = Math.max(0, Math.min(100, winnerHp)); const winnerVC = Math.floor(hp); const loserVC = Math.floor((100 - hp) * 0.10);
    await client.query('UPDATE players SET locked_hp = GREATEST(0, locked_hp - 100), hp = hp + 100, vc = vc + $1 WHERE wallet = $2', [winnerVC, winnerWallet]);
    await client.query('UPDATE players SET locked_hp = GREATEST(0, locked_hp - 100), vc = vc + $1 WHERE wallet = $2', [loserVC, loserWallet]);
    await client.query('COMMIT'); return { winnerNewHp: await getHP(winnerWallet), winnerNewVc: await getVC(winnerWallet), loserNewHp: await getHP(loserWallet), loserNewVc: await getVC(loserWallet) }; } catch(e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); } 
}
async function settleTeamMatch(winnerWallet, loserWallet, winnerRemainingHp, teamSize) { 
  const client = await pool.connect(); 
  try { await client.query('BEGIN'); const stake = teamSize * 100; const hp = Math.max(0, Math.min(stake, winnerRemainingHp)); const winnerVC = Math.floor(hp); const loserVC = Math.floor((stake - hp) * 0.10);
    await client.query('UPDATE players SET locked_hp = GREATEST(0, locked_hp - $1), hp = hp + $1, vc = vc + $2 WHERE wallet = $3', [stake, winnerVC, winnerWallet]);
    await client.query('UPDATE players SET locked_hp = GREATEST(0, locked_hp - $1), vc = vc + $2 WHERE wallet = $3', [stake, loserVC, loserWallet]);
    await client.query('COMMIT'); return { winnerNewHp: await getHP(winnerWallet), winnerNewVc: await getVC(winnerWallet), loserNewHp: await getHP(loserWallet), loserNewVc: await getVC(loserWallet) }; } catch(e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); } 
}

async function getPrizes() { const res = await pool.query('SELECT * FROM platform WHERE id = 1'); return res.rows.length > 0 ? res.rows[0] : null; }
async function savePrizes(data) {
  await pool.query(`UPDATE platform SET tour_hp_prize = $1, tour_vc_prize = $2, tower_t1_hp = $3, tower_t1_vc = $4, tower_t2_hp = $5, tower_t2_vc = $6, tower_t3_hp = $7, tower_t3_vc = $8, tower_daily_vc = $9 WHERE id = 1`, [data.tour_hp, data.tour_vc, data.tower_t1_hp, data.tower_t1_vc, data.tower_t2_hp, data.tower_t2_vc, data.tower_t3_hp, data.tower_t3_vc, data.tower_daily_vc]);
}

async function getTowerStatus() { return { grandAvailable: true, trainAvailable: true, excedente: 1000 }; }
async function checkTowerDailyWin(wallet) { const res = await pool.query('SELECT tower_train_date FROM players WHERE wallet = $1', [wallet]); if (res.rows.length > 0) { const today = new Date().toISOString().split('T')[0]; return res.rows[0].tower_train_date === today; } return false; }
async function claimTowerDailyWin(wallet) { const today = new Date().toISOString().split('T')[0]; await pool.query('UPDATE players SET tower_train_date = $1 WHERE wallet = $2', [today, wallet]); }

// NUEVAS FUNCIONES: VICAMONS POSEÍDOS
async function getOwnedVicamons(wallet) {
  const res = await pool.query('SELECT * FROM owned_vicamons WHERE owner_wallet = $1', [wallet]);
  return res.rows;
}

async function createInitialVicamon(wallet, beastKey, customName) {
  // Verificar si ya tiene un Vicamon inicial para evitar duplicados
  const existing = await pool.query('SELECT id FROM owned_vicamons WHERE owner_wallet = $1', [wallet]);
  if (existing.rows.length > 0) return; // Si ya tiene uno, no hace nada
  
  const cleanName = (customName || 'Vicamon').substring(0, 20);
  await pool.query('INSERT INTO owned_vicamons (owner_wallet, beast_key, custom_name) VALUES ($1, $2, $3)', [wallet, beastKey, cleanName]);
}

async function getTotalPlayersHP() { const res = await pool.query('SELECT COALESCE(SUM(hp), 0) as total_hp, COALESCE(SUM(locked_hp), 0) as total_locked FROM players'); const totalHp = res.rows.length > 0 ? parseInt(res.rows[0].total_hp, 10) : 0; const totalLocked = res.rows.length > 0 ? parseInt(res.rows[0].total_locked, 10) : 0; return totalHp + totalLocked; }
async function getExcedente() { return cachedExcedente; }
async function checkOwnerWithdrawal() { return { shouldWithdraw: false }; }
async function setPlatformHp(hp) { await pool.query('UPDATE platform SET hp = $1 WHERE id = 1', [hp]); updateCachedExcedente(); }
async function addPlatformHp(hp) { await pool.query('UPDATE platform SET hp = hp + $1 WHERE id = 1', [hp]); updateCachedExcedente(); }
async function cashout(wallet) { return { ok: true, hp: 0, usdc: 0 }; }
async function getPlatformHp() { const res = await pool.query('SELECT hp FROM platform WHERE id = 1'); return res.rows.length > 0 ? res.rows[0].hp : 0; }
async function getPlatformUsdc() { return parseFloat(((await getPlatformHp()) * USDC_PER_HP).toFixed(6)); }
async function clearPlatformHp(hp) { await pool.query('UPDATE platform SET hp = GREATEST(0, hp - $1) WHERE id = 1', [hp]); updateCachedExcedente(); }
async function getAllAttacksDB() { const res = await pool.query('SELECT * FROM attacks'); return res.rows; }
async function getAllVicamonsDB() { const res = await pool.query('SELECT * FROM vicamons'); return res.rows; }
async function saveAttackDB(data) { await pool.query(`INSERT INTO attacks (id, name, d, acc, fx, pp, description, type, cost) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO UPDATE SET name=$2, d=$3, acc=$4, fx=$5, pp=$6, description=$7, type=$8, cost=$9`, [data.id, data.name, data.d, data.acc, data.fx, data.pp, data.desc, data.type, data.cost]); }
async function saveVicamonDB(data) { await pool.query(`INSERT INTO vicamons (id, name, sub, img, el, style, cat, stats, attacks) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO UPDATE SET name=$2, sub=$3, img=$4, el=$5, style=$6, cat=$7, stats=$8, attacks=$9`, [data.id, data.name, data.sub, data.img, data.el, data.style, data.cat, JSON.stringify(data.stats), JSON.stringify(data.attacks)]); }

module.exports = {
  getHP, addHP, hasHP, lockHP, unlockHP, settleMatch, settleTeamMatch, cashout,
  getPlatformHp, getPlatformUsdc, clearPlatformHp, setPlatformHp, addPlatformHp,
  PLATFORM_WALLET, PLATFORM_THRESHOLD: 1.00, USDC_PER_HP,
  getAllPlayersDebug, updatePlayerName, updatePlayerStats, getTopPlayers, getLeaderboard,
  getPlayerStats, getPlayerRank,
  isTxProcessed, markTxProcessed,
  adminSetHP, adminResetPlatform, adminUnlockAllHP,
  getTowerStatus, checkTowerDailyWin, claimTowerDailyWin,
  getExcedente, getTotalPlayersHP, checkOwnerWithdrawal,
  getAllAttacksDB, getAllVicamonsDB, saveAttackDB, saveVicamonDB,
  createUser, getUserByEmail,
  getVC, addVC, hasVC, spendVC,
  getPrizes, savePrizes,
  // NUEVAS EXPORTACIONES
  getOwnedVicamons, createInitialVicamon
};
