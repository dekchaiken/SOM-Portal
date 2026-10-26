// The game world: town map "ดินแดนสวรรค์", player movement, skills, HUD and windows.
const World = (() => {
  const T = 48;            // tile size (px)
  const MAP_W = 30;        // tiles
  const MAP_H = 20;
  const SPEED = 170;       // px / s
  const RADIUS = 12;       // collision half-size of the player

  let canvas, ctx, fx, dpr = 1;
  let running = false;
  let hero = null;         // { character, skills, hp, maxHp, mp, maxMp, x, y, dir, moving, target, cooldowns }
  let skills = [];
  let decor = [];          // { kind, x, y, w, h, solid, color }
  let dummies = [];        // training dummies
  let quest = { hits: 0, goal: 5 };
  let keys = {};
  let cam = { x: 0, y: 0 };
  let lastT = 0;
  let time = 0;
  let openWin = null;
  const keyToSlot = {};

  // ---------- map ----------
  function buildMap() {
    decor = [];
    const cx = (MAP_W * T) / 2;
    const cy = (MAP_H * T) / 2;
    // fountain plaza
    decor.push({ kind: 'fountain', x: cx, y: cy, w: 120, h: 120, solid: true });
    // red carpet from the plaza to the north gate
    decor.push({ kind: 'carpet', x: cx, y: cy - 280, w: 96, h: 480, solid: false });
    // houses along the north and south edges
    const houseColors = ['#ffb3c1', '#b8e0ff', '#c7f5c9', '#ffe6a7', '#e0c3ff'];
    for (let i = 0; i < 5; i++) {
      decor.push({ kind: 'house', x: 150 + i * 240, y: 150, w: 130, h: 96, solid: true, color: houseColors[i] });
      decor.push({ kind: 'house', x: 150 + i * 240, y: MAP_H * T - 280, w: 130, h: 96, solid: true, color: houseColors[(i + 2) % 5] });
    }
    // market stalls
    for (const sx of [300, 1100]) {
      decor.push({ kind: 'stall', x: sx, y: cy - 60, w: 90, h: 60, solid: true, color: '#ff8fa3' });
    }
    // trees
    for (const [tx, ty] of [[60, 420], [60, 640], [1380, 420], [1380, 640], [700, 780], [420, 820], [1000, 820], [1300, 300]]) {
      decor.push({ kind: 'tree', x: tx, y: ty, w: 56, h: 56, solid: true });
    }
    // lanterns along the carpet
    for (const ly of [cy - 360, cy - 180, cy + 110]) {
      decor.push({ kind: 'lantern', x: cx - 70, y: ly, w: 16, h: 16, solid: false });
      decor.push({ kind: 'lantern', x: cx + 70, y: ly, w: 16, h: 16, solid: false });
    }
    // training dummies (place near the east side)
    dummies = [
      { x: 1080, y: 420, hp: 300, maxHp: 300, hurt: 0, respawn: 0 },
      { x: 1080, y: 760, hp: 300, maxHp: 300, hurt: 0, respawn: 0 },
    ];
  }

  function solidRects() {
    return decor.filter((d) => d.solid).map((d) => ({ x: d.x - d.w / 2, y: d.y - d.h / 2, w: d.w, h: d.h }));
  }

  function blocked(x, y) {
    if (x < RADIUS || y < RADIUS || x > MAP_W * T - RADIUS || y > MAP_H * T - RADIUS) return true;
    for (const r of solidRects()) {
      if (x + RADIUS > r.x && x - RADIUS < r.x + r.w && y + RADIUS * 0.5 > r.y && y - RADIUS * 0.5 < r.y + r.h) return true;
    }
    return false;
  }

  // ---------- start ----------
  async function start(character) {
    if (!canvas) init();
    buildMap();
    skills = await loadSkills(character.classId);
    const maxHp = 200 + character.level * 40;
    const maxMp = 80 + character.level * 15;
    hero = {
      character,
      hp: maxHp, maxHp, mp: maxMp, maxMp,
      x: (MAP_W * T) / 2 + 80, y: (MAP_H * T) / 2 + 120,
      dir: 1, moving: false, target: null,
      cooldowns: {},
    };
    quest = { hits: 0, goal: 5 };
    buildHud();
    addChat('ระบบ', 'ยินดีต้อนรับสู่ ดินแดนสวรรค์!');
    addChat('ระบบ', 'WASD / ลูกศร เดิน · คลิกพื้นเพื่อเดินไป · กดเลข 1-6 ใช้สกิล · Enter พิมพ์แชต');
    cam = { x: hero.x - canvas.width / 2 / dpr, y: hero.y - canvas.height / 2 / dpr };
    show();
    if (!running) {
      running = true;
      lastT = performance.now();
      requestAnimationFrame(loop);
    }
  }

  // Defaults first, then the server's copies override them by id.
  async function loadSkills(classId) {
    const byId = new Map((DEFAULT_SKILLS[classId] || []).map((s) => [s.id, s]));
    try {
      const data = await API.get('/api/skills?classId=' + encodeURIComponent(classId));
      for (const s of data.skills || []) byId.set(s.id, s);
    } catch { /* offline: defaults only */ }
    return [...byId.values()].sort((a, b) => a.key - b.key);
  }

  function show() {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    document.getElementById('game').classList.add('active');
  }

  function init() {
    canvas = document.getElementById('world-canvas');
    ctx = canvas.getContext('2d');
    fx = new Effects();
    resize();
    window.addEventListener('resize', resize);

    window.addEventListener('keydown', (e) => {
      if (!running || !document.getElementById('game').classList.contains('active')) return;
      const chat = document.getElementById('chat-input');
      if (document.activeElement === chat) {
        if (e.key === 'Enter') sendChat();
        if (e.key === 'Escape') { chat.blur(); chat.classList.remove('show'); }
        return;
      }
      if (e.key === 'Enter') { chat.classList.add('show'); chat.focus(); e.preventDefault(); return; }
      if (e.key === 'Escape') { closeWindow(); return; }
      const k = e.key.toLowerCase();
      keys[k] = true;
      if (keyToSlot[e.key]) useSkill(keyToSlot[e.key]);
      if (e.key.startsWith('Arrow') || e.key === ' ') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

    canvas.addEventListener('pointerdown', (e) => {
      if (!hero) return;
      const r = canvas.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      hero.target = { x: sx + cam.x, y: sy + cam.y };
    });

    document.getElementById('window-close').addEventListener('click', closeWindow);
    document.getElementById('chat-input').addEventListener('blur', () => {
      setTimeout(() => document.getElementById('chat-input').classList.remove('show'), 0);
    });
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
  }

  // ---------- HUD ----------
  function buildHud() {
    const tr = document.getElementById('hud-topright');
    tr.innerHTML = '';
    for (const m of HUD_TOP_MENUS) tr.appendChild(menuButton(m));

    const bl = document.getElementById('hud-bottomleft');
    bl.innerHTML = '';
    for (const m of HUD_BOTTOM_MENUS) bl.appendChild(menuButton(m));

    const sk = document.getElementById('hud-skills');
    sk.innerHTML = '';
    for (let i = 1; i <= 6; i++) {
      const s = skills.find((x) => x.key === i);
      const b = document.createElement('button');
      b.className = 'skill-slot' + (s ? '' : ' empty');
      b.dataset.slot = i;
      b.innerHTML = `<span class="k">${i}</span><span class="ico">${s ? s.icon : '·'}</span>` +
        `<span class="name">${s ? escapeHtml(s.name) : 'ว่าง'}</span><span class="cd"></span>`;
      b.addEventListener('click', () => useSkill(i));
      sk.appendChild(b);
      if (s) keyToSlot[String(i)] = i;
    }

    document.getElementById('hud-name').textContent = hero.character.name;
    document.getElementById('hud-lv').textContent = 'Lv.' + hero.character.level;
    document.getElementById('quest-step').textContent = `ฝึกฝนกับหุ่นฝึก ${quest.hits}/${quest.goal}`;
  }

  function menuButton(m) {
    const b = document.createElement('button');
    b.className = 'icon-btn';
    b.innerHTML = `<span class="ico">${m.icon}</span>${m.label}`;
    b.addEventListener('click', () => openMenu(m.id));
    return b;
  }

  function openMenu(id) {
    const label = [...HUD_TOP_MENUS, ...HUD_BOTTOM_MENUS].find((m) => m.id === id)?.label || '';
    let body = '';
    if (id === 'status') {
      const c = hero.character;
      body = `<table>
        <tr><td>ชื่อ</td><td>${escapeHtml(c.name)}</td></tr>
        <tr><td>อาชีพ</td><td>${CLASSES[c.classId].name}</td></tr>
        <tr><td>เลเวล</td><td>${c.level}</td></tr>
        <tr><td>HP</td><td>${Math.round(hero.hp)} / ${hero.maxHp}</td></tr>
        <tr><td>MP</td><td>${Math.round(hero.mp)} / ${hero.maxMp}</td></tr>
      </table>`;
    } else if (id === 'skill') {
      body = skills.length
        ? '<table>' + skills.map((s) => `<tr><td>${s.icon} ${escapeHtml(s.name)}</td><td>ปุ่ม ${s.key} · ${(s.cooldown / 1000).toFixed(1)}s · MP ${s.mp}</td></tr>`).join('') + '</table>'
        : '<div class="empty-note">ยังไม่มีสกิลสำหรับอาชีพนี้</div>';
    } else if (id === 'quest') {
      body = `<table><tr><td>📜 เส้นหลัก: เจตนารมณ์แห่งสวรรค์</td><td>${quest.hits}/${quest.goal}</td></tr></table>`;
    } else {
      body = `<div class="empty-note">${label} · อยู่ระหว่างพัฒนา</div>`;
    }
    openWindow(label, body);
  }

  function openWindow(title, html) {
    document.getElementById('window-title').textContent = title;
    document.getElementById('window-body').innerHTML = html;
    document.getElementById('window').hidden = false;
    openWin = title;
  }

  function closeWindow() {
    document.getElementById('window').hidden = true;
    openWin = null;
  }

  function addChat(who, msg) {
    const log = document.getElementById('chat-log');
    const d = document.createElement('div');
    d.innerHTML = `<b>${escapeHtml(who)}:</b> ${escapeHtml(msg)}`;
    log.appendChild(d);
    while (log.children.length > 6) log.removeChild(log.firstChild);
  }

  function sendChat() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    input.value = '';
    input.classList.remove('show');
    input.blur();
    if (text) addChat(hero.character.name, text);
  }

  function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { t.hidden = true; }, 1600);
  }

  function updateHud() {
    document.getElementById('bar-hp').style.width = (hero.hp / hero.maxHp * 100) + '%';
    document.getElementById('bar-mp').style.width = (hero.mp / hero.maxMp * 100) + '%';
    document.getElementById('txt-hp').textContent = `${Math.ceil(hero.hp)} / ${hero.maxHp}`;
    document.getElementById('txt-mp').textContent = `${Math.ceil(hero.mp)} / ${hero.maxMp}`;
    document.getElementById('quest-step').textContent = `ฝึกฝนกับหุ่นฝึก ${Math.min(quest.hits, quest.goal)}/${quest.goal}`;

    const now = performance.now();
    document.querySelectorAll('.skill-slot[data-slot]').forEach((el) => {
      const s = skills.find((x) => x.key === Number(el.dataset.slot));
      if (!s) return;
      const left = (hero.cooldowns[s.id] || 0) - now;
      el.classList.toggle('cooling', left > 0);
      el.querySelector('.cd').textContent = left > 0 ? (left / 1000).toFixed(1) : '';
    });
  }

  // draw the bust portrait in the top-left HUD
  function drawPortrait() {
    const pc = document.getElementById('portrait');
    const pctx = pc.getContext('2d');
    pctx.clearRect(0, 0, pc.width, pc.height);
    pctx.fillStyle = CLASSES[hero.character.classId].color + '55';
    pctx.fillRect(0, 0, pc.width, pc.height);
    // bust framing: head centre lands near the middle of the 64px portrait
    Sprite.draw(pctx, 32, 84, {
      gender: hero.character.gender, classId: hero.character.classId,
      appearance: hero.character.appearance, t: time, s: 1.1,
    });
  }

  // ---------- skills ----------
  function useSkill(slot) {
    if (!hero) return;
    const s = skills.find((x) => x.key === slot);
    if (!s) return;
    const now = performance.now();
    if ((hero.cooldowns[s.id] || 0) > now) return;
    if (hero.mp < s.mp) { showToast('MP ไม่พอ'); return; }
    hero.mp -= s.mp;
    hero.cooldowns[s.id] = now + s.cooldown;
    hero.moving = false;
    hero.target = null;

    const dx = hero.dir;
    fx.spawn(s.fx, hero.x, hero.y - 22, { dx, dy: 0, range: s.range });
    if (s.fx.shake) shake = { amt: s.fx.shake, until: now + 180 };

    if (s.fx.type === 'heal') {
      hero.hp = Math.min(hero.maxHp, hero.hp + 60);
      fx.text(hero.x, hero.y - 60, '+60', '#7dff9b', true);
      return;
    }
    if (s.damage <= 0) return;

    // hit training dummies within range (projectile / beam reach further)
    let hits = 0;
    for (const d of dummies) {
      if (d.hp <= 0) continue;
      const dist = Math.hypot(d.x - hero.x, d.y - hero.y);
      if (dist <= s.range + 30) {
        const crit = Math.random() < 0.2;
        const dmg = Math.round(s.damage * (crit ? 1.8 : 1) * (0.9 + Math.random() * 0.2));
        d.hp -= dmg;
        d.hurt = now;
        hits++;
        fx.text(d.x, d.y - 60, (crit ? 'Crit! ' : '') + dmg, crit ? '#ffd166' : '#ffffff', crit);
        if (d.hp <= 0) { d.respawn = now + 3000; fx.text(d.x, d.y - 80, 'ล้มแล้ว!', '#ffb3c1', true); }
      }
    }
    if (hits) {
      quest.hits = Math.min(quest.goal, quest.hits + 1);
      if (quest.hits === quest.goal) addChat('ระบบ', 'เควสสำเร็จ: เจตนารมณ์แห่งสวรรค์ (ฝึกฝนครบ)');
    }
  }

  let shake = { amt: 0, until: 0 };

  // ---------- update / render ----------
  function update(dt) {
    const now = performance.now();
    time += dt / 1000;

    // movement from keys
    let mx = 0, my = 0;
    if (keys['a'] || keys['arrowleft']) mx -= 1;
    if (keys['d'] || keys['arrowright']) mx += 1;
    if (keys['w'] || keys['arrowup']) my -= 1;
    if (keys['s'] || keys['arrowdown']) my += 1;
    if (mx || my) { hero.target = null; }
    else if (hero.target) {
      const dx = hero.target.x - hero.x;
      const dy = hero.target.y - hero.y;
      const d = Math.hypot(dx, dy);
      if (d < 4) hero.target = null;
      else { mx = dx / d; my = dy / d; }
    }
    const len = Math.hypot(mx, my) || 1;
    const step = SPEED * dt / 1000;
    const vx = (mx / len) * step * (mx || my ? 1 : 0);
    const vy = (my / len) * step * (mx || my ? 1 : 0);
    hero.moving = !!(vx || vy);
    if (vx) hero.dir = vx > 0 ? 1 : -1;
    if (!blocked(hero.x + vx, hero.y)) hero.x += vx;
    if (!blocked(hero.x, hero.y + vy)) hero.y += vy;

    // regen
    hero.mp = Math.min(hero.maxMp, hero.mp + 4 * dt / 1000);
    hero.hp = Math.min(hero.maxHp, hero.hp + 2 * dt / 1000);

    // dummies respawn
    for (const d of dummies) {
      if (d.hp <= 0 && now > d.respawn) { d.hp = d.maxHp; }
    }

    // camera follows hero, clamped to map
    const vw = canvas.width / dpr;
    const vh = canvas.height / dpr;
    const tx = hero.x - vw / 2;
    const ty = hero.y - vh / 2;
    cam.x += (tx - cam.x) * Math.min(1, dt / 90);
    cam.y += (ty - cam.y) * Math.min(1, dt / 90);
    cam.x = Math.max(0, Math.min(MAP_W * T - vw, cam.x));
    cam.y = Math.max(0, Math.min(MAP_H * T - vh, cam.y));

    fx.update(dt);
  }

  function drawGround(vw, vh) {
    const x0 = Math.floor(cam.x / T), x1 = Math.ceil((cam.x + vw) / T);
    const y0 = Math.floor(cam.y / T), y1 = Math.ceil((cam.y + vh) / T);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) continue;
        const even = (tx + ty) % 2 === 0;
        ctx.fillStyle = even ? '#e9d3a8' : '#dfc293';
        ctx.fillRect(tx * T - cam.x, ty * T - cam.y, T, T);
        // little flowers / pebbles for a cute feel
        if ((tx * 7 + ty * 13) % 11 === 0) {
          ctx.fillStyle = '#ffffff99';
          ctx.beginPath();
          ctx.arc(tx * T + 14 - cam.x, ty * T + 30 - cam.y, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    // map border
    ctx.strokeStyle = '#8a6d3b';
    ctx.lineWidth = 6;
    ctx.strokeRect(-cam.x, -cam.y, MAP_W * T, MAP_H * T);
  }

  function drawDecor(kind, d) {
    const x = d.x - cam.x, y = d.y - cam.y;
    if (kind === 'carpet') {
      ctx.fillStyle = '#c0392b';
      ctx.fillRect(x - d.w / 2, y - d.h / 2, d.w, d.h);
      ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 4;
      ctx.strokeRect(x - d.w / 2 + 8, y - d.h / 2 + 8, d.w - 16, d.h - 16);
    } else if (kind === 'fountain') {
      ctx.fillStyle = '#bfc9d6';
      ctx.beginPath(); ctx.arc(x, y, d.w / 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#7fd1ff';
      ctx.beginPath(); ctx.arc(x, y, d.w / 2 - 14, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e6fbff';
      ctx.beginPath(); ctx.arc(x, y - 8 + Math.sin(time * 4) * 2, 6, 0, Math.PI * 2); ctx.fill();
    } else if (kind === 'house') {
      const hx = x - d.w / 2, hy = y - d.h / 2;
      ctx.fillStyle = d.color;
      ctx.fillRect(hx, hy + 20, d.w, d.h - 20);
      ctx.fillStyle = '#c0392b';
      ctx.beginPath(); ctx.moveTo(hx - 10, hy + 24); ctx.lineTo(x, hy - 14); ctx.lineTo(hx + d.w + 10, hy + 24); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#6b4a2b';
      ctx.fillRect(x - 10, hy + d.h - 30, 20, 30);
      ctx.fillStyle = '#bdeaff';
      ctx.fillRect(hx + 14, hy + 34, 22, 20); ctx.fillRect(hx + d.w - 36, hy + 34, 22, 20);
    } else if (kind === 'stall') {
      ctx.fillStyle = '#8a6d3b';
      ctx.fillRect(x - d.w / 2, y - 6, d.w, d.h);
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = i % 2 ? '#ffffff' : d.color;
        ctx.fillRect(x - d.w / 2 + i * 15, y - d.h / 2 - 10, 15, 18);
      }
    } else if (kind === 'tree') {
      ctx.fillStyle = '#7a5230';
      ctx.fillRect(x - 6, y - 10, 12, 26);
      ctx.fillStyle = '#4cbb6b';
      ctx.beginPath(); ctx.arc(x, y - 30, 26, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#6fd88a';
      ctx.beginPath(); ctx.arc(x - 8, y - 36, 10, 0, Math.PI * 2); ctx.fill();
    } else if (kind === 'lantern') {
      ctx.fillStyle = '#5a4a3a';
      ctx.fillRect(x - 2, y - 26, 4, 30);
      ctx.fillStyle = '#ffd166';
      ctx.beginPath(); ctx.arc(x, y - 30, 7 + Math.sin(time * 5 + x) * 0.8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,209,102,.18)';
      ctx.beginPath(); ctx.arc(x, y - 30, 26, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawDummy(d) {
    if (d.hp <= 0) return;
    const x = d.x - cam.x, y = d.y - cam.y;
    const shaking = performance.now() - d.hurt < 150 ? Math.sin(time * 60) * 3 : 0;
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.beginPath(); ctx.ellipse(x, y, 18, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#8a6d3b';
    ctx.fillRect(x - 3 + shaking, y - 60, 6, 56);
    ctx.fillStyle = '#e8c26b';
    ctx.beginPath(); ctx.arc(x + shaking, y - 66, 13, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(x - 18 + shaking, y - 48, 36, 10);
    ctx.fillStyle = '#000'; ctx.fillRect(x - 20, y - 88, 40, 5);
    ctx.fillStyle = '#ff6b6b'; ctx.fillRect(x - 20, y - 88, 40 * d.hp / d.maxHp, 5);
  }

  function drawHero() {
    const x = hero.x - cam.x, y = hero.y - cam.y;
    Sprite.draw(ctx, x, y, {
      gender: hero.character.gender, classId: hero.character.classId,
      appearance: hero.character.appearance, dir: hero.dir, t: time, moving: hero.moving,
    });
    // name tag
    ctx.font = 'bold 13px Sarabun, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#000a';
    const w = ctx.measureText(hero.character.name).width + 14;
    ctx.fillRect(x - w / 2, y - 98, w, 18);
    ctx.fillStyle = '#ffd166';
    ctx.fillText(hero.character.name, x, y - 85);
  }

  function render() {
    const vw = canvas.width / dpr, vh = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#7fb8ff';
    ctx.fillRect(0, 0, vw, vh);

    const sh = performance.now() < shake.until ? shake.amt : 0;
    ctx.save();
    if (sh) ctx.translate((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh);

    drawGround(vw, vh);
    // depth sort: decor, dummies and hero by y
    const things = [
      ...decor.map((d) => ({ y: d.y + (d.kind === 'house' ? d.h / 2 : 0), draw: () => drawDecor(d.kind, d) })),
      ...dummies.map((d) => ({ y: d.y, draw: () => drawDummy(d) })),
      { y: hero.y, draw: drawHero },
    ].sort((a, b) => a.y - b.y);
    for (const t of things) t.draw();
    fx.draw(ctx, cam);

    ctx.restore();

    // target marker
    if (hero.target) {
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(hero.target.x - cam.x, hero.target.y - cam.y, 10 + Math.sin(time * 10) * 2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  let hudTick = 0;
  function loop(now) {
    if (!running) return;
    const dt = Math.min(50, now - lastT);
    lastT = now;
    if (hero) {
      update(dt);
      render();
      hudTick += dt;
      if (hudTick > 100) {
        hudTick = 0;
        updateHud();
        drawPortrait();
      }
    }
    requestAnimationFrame(loop);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  return { start, showToast, addChat };
})();
