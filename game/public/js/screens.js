// Screen flow: splash -> login -> character select -> creator -> enter loader -> world.
const Screens = (() => {
  let config = { googleClientId: '', classes: [], genders: [], maxCharacters: 3 };
  let user = null;
  let characters = [];
  let stopPreview = null;

  const $ = (id) => document.getElementById(id);

  function show(name) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === name));
  }

  // ---------- splash ----------
  const TIPS = [
    'กดเลข 1-6 เพื่อใช้สกิลได้ทันที',
    'คลิกพื้นเพื่อให้ตัวละครเดินไปยังจุดนั้น',
    'สกิลทุกอันออกแบบได้ที่ Skill Lab (/skill-lab.html)',
    'ชนะหุ่นฝึกเพื่อทำเควส "เจตนารมณ์แห่งสวรรค์"',
  ];

  function runSplash() {
    return new Promise((resolve) => {
      const bar = $('splash-bar');
      const tip = $('splash-tip');
      const start = performance.now();
      const dur = 2600;
      let tipIdx = 0;
      const tipTimer = setInterval(() => { tip.textContent = TIPS[tipIdx++ % TIPS.length]; }, 900);
      function tick(now) {
        const k = Math.min(1, (now - start) / dur);
        bar.style.width = (k * 100).toFixed(1) + '%';
        if (k < 1) requestAnimationFrame(tick);
        else { clearInterval(tipTimer); setTimeout(resolve, 250); }
      }
      requestAnimationFrame(tick);
    });
  }

  // ---------- login ----------
  function setLoginError(msg) { $('login-error').textContent = msg || ''; }

  function loadGoogle() {
    const slot = $('google-btn');
    if (!config.googleClientId) {
      slot.innerHTML = '<button class="btn" disabled>Google Login (ยังไม่ได้ตั้งค่า)</button>';
      $('login-hint').textContent = 'ตั้งค่า GOOGLE_CLIENT_ID ตอนรันเซิร์ฟเวอร์เพื่อเปิดใช้ Google Login';
      return;
    }
    let tries = 0;
    const tryInit = () => {
      if (window.google?.accounts?.id) {
        google.accounts.id.initialize({ client_id: config.googleClientId, callback: onGoogleCredential });
        google.accounts.id.renderButton(slot, { theme: 'filled_black', size: 'large', text: 'continue_with', shape: 'pill', width: 280 });
      } else if (tries++ < 40) {
        setTimeout(tryInit, 150);
      } else {
        slot.innerHTML = '<span class="hint">โหลด Google ไม่สำเร็จ</span>';
      }
    };
    tryInit();
  }

  async function onGoogleCredential(resp) {
    setLoginError('');
    try {
      const data = await API.post('/api/auth/google', { credential: resp.credential });
      API.setToken(data.token);
      user = data.user;
      await goCharSelect();
    } catch (e) {
      setLoginError(e.message);
    }
  }

  async function guestLogin() {
    setLoginError('');
    try {
      const data = await API.post('/api/auth/guest');
      API.setToken(data.token);
      user = data.user;
      await goCharSelect();
    } catch (e) {
      setLoginError(e.message);
    }
  }

  // ---------- character select ----------
  async function goCharSelect() {
    $('charselect-error').textContent = '';
    try {
      const data = await API.get('/api/characters');
      characters = data.characters;
    } catch (e) {
      if (e.status === 401) return goLogin();
      $('charselect-error').textContent = e.message;
    }
    renderCharList();
    show('charselect');
  }

  function renderCharList() {
    const list = $('char-list');
    list.innerHTML = '';
    for (const c of characters) {
      const el = document.createElement('div');
      el.className = 'char-slot';
      el.innerHTML = `<canvas width="120" height="120"></canvas><div><b></b></div>
        <div class="cls"></div><button class="del">ลบตัวละคร</button>`;
      el.querySelector('b').textContent = c.name;
      el.querySelector('.cls').textContent = `${CLASSES[c.classId].name} · Lv.${c.level}`;
      drawBust(el.querySelector('canvas'), c);
      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('del')) return;
        enterWorld(c);
      });
      el.querySelector('.del').addEventListener('click', () => deleteCharacter(c));
      list.appendChild(el);
    }
    if (characters.length < config.maxCharacters) {
      const add = document.createElement('div');
      add.className = 'char-slot empty';
      add.textContent = '+ สร้างตัวละคร';
      add.addEventListener('click', openCreator);
      list.appendChild(add);
    }
  }

  function drawBust(canvas, c) {
    const x = canvas.getContext('2d');
    x.clearRect(0, 0, canvas.width, canvas.height);
    x.fillStyle = CLASSES[c.classId].color + '44';
    x.beginPath(); x.arc(60, 60, 56, 0, Math.PI * 2); x.fill();
    Sprite.draw(x, 60, 104, { gender: c.gender, classId: c.classId, appearance: c.appearance, s: 1.5 });
  }

  async function deleteCharacter(c) {
    if (!confirm(`ลบตัวละคร "${c.name}" ? การลบนี้กู้คืนไม่ได้`)) return;
    try {
      await API.del('/api/characters/' + c.id);
      await goCharSelect();
    } catch (e) {
      $('charselect-error').textContent = e.message;
    }
  }

  // ---------- creator ----------
  const state = {
    name: '',
    gender: 'male',
    classId: 'swordsman',
    appearance: { ...DEFAULT_APPEARANCE },
  };

  function openCreator() {
    Object.assign(state, { name: '', gender: 'male', classId: 'swordsman', appearance: { ...DEFAULT_APPEARANCE } });
    $('char-name').value = '';
    $('creator-error').textContent = '';
    buildOptions();
    show('creator');
    startPreview();
  }

  function chipGroup(id, items, isOn, onPick) {
    const box = $(id);
    box.innerHTML = '';
    for (const it of items) {
      const b = document.createElement('button');
      b.className = 'chip' + (isOn(it) ? ' on' : '');
      b.textContent = it.label;
      b.addEventListener('click', () => { onPick(it); buildOptions(); });
      box.appendChild(b);
    }
  }

  function swatchGroup(id, colors, key) {
    const box = $(id);
    box.innerHTML = '';
    for (const col of colors) {
      const b = document.createElement('button');
      b.className = 'swatch' + (state.appearance[key] === col ? ' on' : '');
      b.style.background = col;
      b.title = col;
      b.addEventListener('click', () => { state.appearance[key] = col; buildOptions(); });
      box.appendChild(b);
    }
  }

  function buildOptions() {
    chipGroup('opt-gender', [
      { v: 'male', label: 'ชาย' }, { v: 'female', label: 'หญิง' },
    ], (it) => it.v === state.gender, (it) => { state.gender = it.v; });

    chipGroup('opt-class', config.classes.map((id) => ({ v: id, label: CLASSES[id].name })),
      (it) => it.v === state.classId, (it) => { state.classId = it.v; });
    $('class-desc').textContent = CLASSES[state.classId].desc;

    chipGroup('opt-hairStyle', APPEARANCE_OPTIONS.hairStyle,
      (it) => it.v === state.appearance.hairStyle, (it) => { state.appearance.hairStyle = it.v; });
    swatchGroup('opt-hair', APPEARANCE_OPTIONS.hair, 'hair');
    swatchGroup('opt-skin', APPEARANCE_OPTIONS.skin, 'skin');
    swatchGroup('opt-outfit', APPEARANCE_OPTIONS.outfit, 'outfit');
    chipGroup('opt-eyes', APPEARANCE_OPTIONS.eyes,
      (it) => it.v === state.appearance.eyes, (it) => { state.appearance.eyes = it.v; });
    chipGroup('opt-accessory', APPEARANCE_OPTIONS.accessory,
      (it) => it.v === state.appearance.accessory, (it) => { state.appearance.accessory = it.v; });
  }

  function randomize() {
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    state.gender = pick(config.genders);
    state.classId = pick(config.classes);
    state.appearance = {
      hairStyle: pick(APPEARANCE_OPTIONS.hairStyle).v,
      hair: pick(APPEARANCE_OPTIONS.hair),
      skin: pick(APPEARANCE_OPTIONS.skin),
      outfit: pick(APPEARANCE_OPTIONS.outfit),
      eyes: pick(APPEARANCE_OPTIONS.eyes).v,
      accessory: pick(APPEARANCE_OPTIONS.accessory).v,
    };
    buildOptions();
  }

  // live preview of the designed character on a soft aura
  function startPreview() {
    stopPreview?.();
    const canvas = $('preview');
    const ctx = canvas.getContext('2d');
    let running = true;
    stopPreview = () => { running = false; };
    const t0 = performance.now();
    (function frame(now) {
      if (!running || !$('creator').classList.contains('active')) return;
      const t = (now - t0) / 1000;
      const col = CLASSES[state.classId].color;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const g = ctx.createRadialGradient(180, 300, 10, 180, 300, 150);
      g.addColorStop(0, col + 'aa');
      g.addColorStop(1, col + '00');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(180, 300, 150, 0, Math.PI * 2); ctx.fill();
      Sprite.draw(ctx, 180, 360, {
        gender: state.gender, classId: state.classId, appearance: state.appearance, t, s: 3.2,
      });
      requestAnimationFrame(frame);
    })(t0);
  }

  async function createCharacter() {
    const name = $('char-name').value.trim();
    $('creator-error').textContent = '';
    if (name.length < 2) { $('creator-error').textContent = 'ชื่อต้องมีอย่างน้อย 2 ตัวอักษร'; return; }
    try {
      const data = await API.post('/api/characters', {
        name, gender: state.gender, classId: state.classId, appearance: state.appearance,
      });
      stopPreview?.();
      enterWorld(data.character);
    } catch (e) {
      if (e.status === 401) return goLogin();
      $('creator-error').textContent = e.message;
    }
  }

  // ---------- enter-world loader ----------
  function enterWorld(character) {
    stopPreview?.();
    show('enter-loader');
    const canvas = $('enter-canvas');
    const ctx = canvas.getContext('2d');
    const bar = $('enter-bar');
    const tip = $('enter-tip');
    const dur = 2800;
    const t0 = performance.now();
    const stars = Array.from({ length: 60 }, () => ({ x: Math.random(), y: Math.random(), s: Math.random() * 2 + 0.5 }));
    let tipIdx = 0;
    tip.textContent = TIPS[0];
    const tipTimer = setInterval(() => { tip.textContent = TIPS[++tipIdx % TIPS.length]; }, 900);

    (function frame(now) {
      const k = Math.min(1, (now - t0) / dur);
      const w = canvas.width, h = canvas.height;
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#2b1c5c'); sky.addColorStop(1, '#f7a8c4');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
      for (const s of stars) {
        ctx.fillStyle = `rgba(255,255,255,${0.4 + 0.6 * Math.abs(Math.sin(now / 300 + s.x * 10))})`;
        ctx.beginPath(); ctx.arc(s.x * w, s.y * h * 0.6, s.s, 0, Math.PI * 2); ctx.fill();
      }
      // rising portal ring that grows with progress
      const cx = w / 2, cy = h * 0.6;
      ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.ellipse(cx, cy, 40 + k * 120, 14 + k * 36, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#8ee3ff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(cx, cy, 30 + k * 110, 10 + k * 32, 0, 0, Math.PI * 2); ctx.stroke();
      // character rising through the portal
      const cdx = cx, cdy = cy - 10 + (1 - k) * 60;
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, w, cy); ctx.clip();
      Sprite.draw(ctx, cdx, cdy + 30, { gender: character.gender, classId: character.classId, appearance: character.appearance, t: now / 1000, s: 2.4 });
      ctx.restore();

      bar.style.width = (k * 100).toFixed(1) + '%';
      if (k < 1) {
        requestAnimationFrame(frame);
      } else {
        clearInterval(tipTimer);
        World.start(character);
      }
    })(t0);
  }

  // ---------- nav ----------
  function goLogin() {
    API.setToken(null);
    user = null;
    setLoginError('');
    show('login');
  }

  async function logout() {
    try { await API.post('/api/auth/logout'); } catch { /* ignore */ }
    goLogin();
  }

  async function boot() {
    API.init();
    try { config = await API.get('/api/config'); } catch { /* keep defaults */ }

    $('btn-guest').addEventListener('click', guestLogin);
    $('btn-logout').addEventListener('click', logout);
    $('btn-new-char').addEventListener('click', openCreator);
    $('btn-random').addEventListener('click', randomize);
    $('btn-creator-back').addEventListener('click', () => { stopPreview?.(); goCharSelect(); });
    $('btn-create').addEventListener('click', createCharacter);
    $('char-name').addEventListener('input', (e) => { state.name = e.target.value; });

    await runSplash();
    loadGoogle();

    if (API.token) {
      try {
        const me = await API.get('/api/me');
        user = me.user;
        return goCharSelect();
      } catch {
        API.setToken(null);
      }
    }
    show('login');
  }

  return { boot };
})();

document.addEventListener('DOMContentLoaded', () => Screens.boot());
