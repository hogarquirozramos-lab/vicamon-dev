const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createUser, getUserByEmail } = require('./hp-balance');

const JWT_SECRET = process.env.JWT_SECRET || process.env.INTERNAL_SECRET || 'super-secret-dev-key';

async function handleAuthRoutes(req, res, urlPath) {
  if (urlPath === '/api/register' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { email, password, nick } = JSON.parse(body);
        if (!email || !password) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, msg: 'Faltan correo o contraseña' }));
        }
        
        const existing = await getUserByEmail(email.toLowerCase());
        if (existing) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, msg: 'El correo ya está registrado' }));
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const cleanNick = (nick || 'Entrenador').substring(0, 20);
        const user = await createUser(email.toLowerCase(), hashedPassword, cleanNick);
        
        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, token, user: { id: user.id, email: user.email, nick: cleanNick } }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, msg: 'Error interno del servidor' }));
      }
    });
    return true;
  }

  if (urlPath === '/api/login' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { email, password } = JSON.parse(body);
        if (!email || !password) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, msg: 'Faltan credenciales' }));
        }

        const user = await getUserByEmail(email.toLowerCase());
        if (!user) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, msg: 'Usuario no encontrado' }));
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, msg: 'Contraseña incorrecta' }));
        }

        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, token, user: { id: user.id, email: user.email, nick: user.last_name } }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, msg: 'Error interno del servidor' }));
      }
    });
    return true;
  }

  return false;
}

module.exports = { handleAuthRoutes };
