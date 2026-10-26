// Game platform server: static files + JSON API. No dependencies (Node 18+).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'db.json');
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const MAX_CHARACTERS = 3;

const CLASS_IDS = ['swordsman', 'assassin', 'mage', 'priest'];
const GENDERS = ['male', 'female'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// ---------- storage ----------
function loadDb() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { users: [], characters: [], skills: [], sessions: {} };
  }
}

let db = loadDb();

function saveDb() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

const uid = (prefix) => prefix + crypto.randomBytes(8).toString('hex');

// ---------- helpers ----------
function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req, limit = 200 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('invalid json'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function authUser(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  const userId = token && db.sessions[token];
  if (!userId) return null;
  return db.users.find((u) => u.id === userId) || null;
}

function requireUser(req, res) {
  const user = authUser(req);
  if (!user) send(res, 401, { error: 'กรุณาเข้าสู่ระบบก่อน' });
  return user;
}

function createSession(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions[token] = userId;
  saveDb();
  return token;
}

function publicUser(u) {
  return { id: u.id, name: u.name, type: u.type };
}

const clean = (v, max) => String(v ?? '').trim().slice(0, max);
const isHex = (v) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
const clampInt = (v, min, max, def) => {
  const n = Number.isInteger(v) ? v : def;
  return Math.min(max, Math.max(min, n));
};

function sanitizeAppearance(a = {}) {
  return {
    skin: isHex(a.skin) ? a.skin : '#ffe0c8',
    hair: isHex(a.hair) ? a.hair : '#3b2a20',
    hairStyle: clampInt(a.hairStyle, 0, 3, 0),
    eyes: clampInt(a.eyes, 0, 2, 0),
    outfit: isHex(a.outfit) ? a.outfit : '#4a7bd0',
    accessory: clampInt(a.accessory, 0, 2, 0),
  };
}

function sanitizeFx(fx = {}) {
  const types = ['burst', 'nova', 'slash', 'projectile', 'beam', 'heal'];
  return {
    type: types.includes(fx.type) ? fx.type : 'burst',
    color: isHex(fx.color) ? fx.color : '#ffcc00',
    color2: isHex(fx.color2) ? fx.color2 : '#ffffff',
    count: clampInt(fx.count, 1, 200, 24),
    size: clampInt(fx.size, 1, 60, 8),
    duration: clampInt(fx.duration, 100, 5000, 600),
    speed: clampInt(fx.speed, 10, 1000, 220),
    shake: clampInt(fx.shake, 0, 20, 0),
  };
}

function sanitizeSkill(s = {}) {
  if (!CLASS_IDS.includes(s.classId)) throw Object.assign(new Error('classId ไม่ถูกต้อง'), { status: 400 });
  const name = clean(s.name, 40);
  if (!name) throw Object.assign(new Error('ต้องใส่ชื่อสกิล'), { status: 400 });
  return {
    id: clean(s.id, 60) || uid('sk_'),
    classId: s.classId,
    name,
    icon: clean(s.icon, 4) || '✦',
    key: clampInt(s.key, 1, 6, 1),
    cooldown: clampInt(s.cooldown, 100, 60000, 1000),
    mp: clampInt(s.mp, 0, 999, 5),
    damage: clampInt(s.damage, 0, 99999, 10),
    range: clampInt(s.range, 20, 800, 120),
    fx: sanitizeFx(s.fx),
    updatedAt: Date.now(),
  };
}

// ---------- auth ----------
async function verifyGoogleCredential(credential) {
  if (!GOOGLE_CLIENT_ID) throw Object.assign(new Error('ยังไม่ได้ตั้งค่า GOOGLE_CLIENT_ID'), { status: 503 });
  const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
  if (!r.ok) throw Object.assign(new Error('Google token ไม่ถูกต้อง'), { status: 401 });
  const info = await r.json();
  if (info.aud !== GOOGLE_CLIENT_ID) throw Object.assign(new Error('Google client ไม่ตรงกัน'), { status: 401 });
  return info;
}

// ---------- routes ----------
async function handleApi(req, res, url) {
  const p = url.pathname;
  const m = req.method;

  if (p === '/api/config' && m === 'GET') {
    return send(res, 200, { googleClientId: GOOGLE_CLIENT_ID, classes: CLASS_IDS, genders: GENDERS, maxCharacters: MAX_CHARACTERS });
  }

  if (p === '/api/auth/guest' && m === 'POST') {
    const user = { id: uid('u_'), name: 'Guest-' + crypto.randomBytes(2).toString('hex'), type: 'guest', createdAt: Date.now() };
    db.users.push(user);
    const token = createSession(user.id);
    return send(res, 200, { token, user: publicUser(user) });
  }

  if (p === '/api/auth/google' && m === 'POST') {
    const body = await readBody(req);
    const info = await verifyGoogleCredential(String(body.credential || ''));
    let user = db.users.find((u) => u.type === 'google' && u.googleSub === info.sub);
    if (!user) {
      user = { id: uid('u_'), name: clean(info.name, 30) || 'Player', type: 'google', googleSub: info.sub, createdAt: Date.now() };
      db.users.push(user);
    }
    const token = createSession(user.id);
    saveDb();
    return send(res, 200, { token, user: publicUser(user) });
  }

  if (p === '/api/auth/logout' && m === 'POST') {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (token && db.sessions[token]) {
      delete db.sessions[token];
      saveDb();
    }
    return send(res, 200, { ok: true });
  }

  if (p === '/api/me' && m === 'GET') {
    const user = requireUser(req, res);
    if (!user) return;
    return send(res, 200, { user: publicUser(user) });
  }

  if (p === '/api/characters' && m === 'GET') {
    const user = requireUser(req, res);
    if (!user) return;
    return send(res, 200, { characters: db.characters.filter((c) => c.userId === user.id) });
  }

  if (p === '/api/characters' && m === 'POST') {
    const user = requireUser(req, res);
    if (!user) return;
    const mine = db.characters.filter((c) => c.userId === user.id);
    if (mine.length >= MAX_CHARACTERS) return send(res, 400, { error: `สร้างตัวละครได้สูงสุด ${MAX_CHARACTERS} ตัว` });
    const body = await readBody(req);
    const name = clean(body.name, 12);
    if (name.length < 2) return send(res, 400, { error: 'ชื่อต้องมีอย่างน้อย 2 ตัวอักษร' });
    if (db.characters.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      return send(res, 400, { error: 'ชื่อนี้ถูกใช้แล้ว' });
    }
    if (!GENDERS.includes(body.gender)) return send(res, 400, { error: 'เพศไม่ถูกต้อง' });
    if (!CLASS_IDS.includes(body.classId)) return send(res, 400, { error: 'อาชีพไม่ถูกต้อง' });
    const ch = {
      id: uid('c_'),
      userId: user.id,
      name,
      gender: body.gender,
      classId: body.classId,
      appearance: sanitizeAppearance(body.appearance),
      level: 1,
      createdAt: Date.now(),
    };
    db.characters.push(ch);
    saveDb();
    return send(res, 201, { character: ch });
  }

  const charMatch = p.match(/^\/api\/characters\/([\w-]+)$/);
  if (charMatch) {
    const user = requireUser(req, res);
    if (!user) return;
    const ch = db.characters.find((c) => c.id === charMatch[1] && c.userId === user.id);
    if (!ch) return send(res, 404, { error: 'ไม่พบตัวละคร' });
    if (m === 'DELETE') {
      db.characters = db.characters.filter((c) => c !== ch);
      saveDb();
      return send(res, 200, { ok: true });
    }
    if (m === 'PUT') {
      const body = await readBody(req);
      if (body.appearance) ch.appearance = sanitizeAppearance(body.appearance);
      saveDb();
      return send(res, 200, { character: ch });
    }
    if (m === 'GET') return send(res, 200, { character: ch });
  }

  if (p === '/api/skills' && m === 'GET') {
    const classId = url.searchParams.get('classId');
    const list = db.skills.filter((s) => !classId || s.classId === classId);
    return send(res, 200, { skills: list });
  }

  if (p === '/api/skills' && m === 'POST') {
    const user = requireUser(req, res);
    if (!user) return;
    const skill = sanitizeSkill(await readBody(req));
    const i = db.skills.findIndex((s) => s.id === skill.id);
    if (i >= 0) db.skills[i] = skill;
    else db.skills.push(skill);
    saveDb();
    return send(res, 200, { skill });
  }

  const skillMatch = p.match(/^\/api\/skills\/([\w-]+)$/);
  if (skillMatch && m === 'DELETE') {
    const user = requireUser(req, res);
    if (!user) return;
    db.skills = db.skills.filter((s) => s.id !== skillMatch[1]);
    saveDb();
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { error: 'ไม่พบ API นี้' });
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end('forbidden');
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else {
      serveStatic(req, res, url);
    }
  } catch (err) {
    if (!res.headersSent) send(res, err.status || 500, { error: err.status ? err.message : 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์' });
    if (!err.status) console.error(err);
  }
});

server.listen(PORT, () => {
  console.log(`Game platform running on http://localhost:${PORT}`);
  if (!GOOGLE_CLIENT_ID) console.log('GOOGLE_CLIENT_ID not set: Google login disabled, guest login only.');
});
