// Skill Lab: design skills and their effects, preview live, save to the server.
(() => {
  const $ = (id) => document.getElementById(id);
  let skills = [];       // all skills shown in the list (server + defaults)
  let current = null;    // skill being edited
  let stopPreview = null;

  const FIELDS = {
    name: 'f-name', icon: 'f-icon', classId: 'f-class', key: 'f-key',
    cooldown: 'f-cooldown', mp: 'f-mp', damage: 'f-damage', range: 'f-range',
  };
  const FX_FIELDS = {
    type: 'f-type', duration: 'f-duration', color: 'f-color', color2: 'f-color2',
    count: 'f-count', size: 'f-size', speed: 'f-speed', shake: 'f-shake',
  };

  function blankSkill(classId = 'swordsman') {
    return {
      id: '', classId, name: 'สกิลใหม่', icon: '✦', key: 1, cooldown: 1000, mp: 5, damage: 20, range: 120,
      fx: { type: 'burst', color: '#ffcc00', color2: '#ffffff', count: 24, size: 8, duration: 600, speed: 220, shake: 0 },
    };
  }

  async function loadSkills() {
    const defaults = Object.values(DEFAULT_SKILLS).flat().map((s) => ({ ...s, _builtin: true }));
    let server = [];
    try {
      server = (await API.get('/api/skills')).skills;
    } catch { /* offline: defaults only */ }
    const byId = new Map(defaults.map((s) => [s.id, s]));
    for (const s of server) byId.set(s.id, s); // server copy overrides a default with the same id
    skills = [...byId.values()];
  }

  function fillSelects() {
    const cls = Object.keys(CLASSES);
    $('f-class').innerHTML = cls.map((c) => `<option value="${c}">${CLASSES[c].name}</option>`).join('');
    $('f-filter').innerHTML = '<option value="">ทุกอาชีพ</option>' +
      cls.map((c) => `<option value="${c}">${CLASSES[c].name}</option>`).join('');
  }

  function renderList() {
    const filter = $('f-filter').value;
    const list = $('skill-list');
    list.innerHTML = '';
    for (const s of skills.filter((x) => !filter || x.classId === filter)) {
      const el = document.createElement('div');
      el.className = 'skill-item' + (current && current.id === s.id ? ' on' : '');
      el.innerHTML = `<span style="font-size:22px"></span><div><b></b><div class="note"></div></div>`;
      el.children[0].textContent = s.icon;
      el.children[1].querySelector('b').textContent = s.name;
      el.children[1].querySelector('.note').textContent =
        `${CLASSES[s.classId].name} · ปุ่ม ${s.key}${s._builtin ? ' · ค่าเริ่มต้น' : ''}`;
      el.addEventListener('click', () => select(s));
      list.appendChild(el);
    }
  }

  function select(s) {
    current = JSON.parse(JSON.stringify(s));
    current._builtin = !!s._builtin;
    writeForm();
    renderList();
    $('save-msg').textContent = '';
    $('save-err').textContent = '';
  }

  function writeForm() {
    const s = current;
    $('f-name').value = s.name;
    $('f-icon').value = s.icon;
    $('f-class').value = s.classId;
    $('f-key').value = String(s.key);
    $('f-cooldown').value = s.cooldown;
    $('f-mp').value = s.mp;
    $('f-damage').value = s.damage;
    $('f-range').value = s.range;
    for (const [k, id] of Object.entries(FX_FIELDS)) $(id).value = s.fx[k];
    syncLabels();
    replay();
  }

  function readForm() {
    const num = (id) => Number($(id).value);
    current.name = $('f-name').value.trim();
    current.icon = $('f-icon').value.trim() || '✦';
    current.classId = $('f-class').value;
    current.key = num('f-key');
    current.cooldown = num('f-cooldown');
    current.mp = num('f-mp');
    current.damage = num('f-damage');
    current.range = num('f-range');
    current.fx = {
      type: $('f-type').value,
      duration: num('f-duration'),
      color: $('f-color').value,
      color2: $('f-color2').value,
      count: num('f-count'),
      size: num('f-size'),
      speed: num('f-speed'),
      shake: num('f-shake'),
    };
    return current;
  }

  function syncLabels() {
    $('v-count').textContent = $('f-count').value;
    $('v-size').textContent = $('f-size').value;
    $('v-speed').textContent = $('f-speed').value;
    $('v-shake').textContent = $('f-shake').value;
  }

  function replay() {
    stopPreview?.();
    const [dx, dy] = $('f-dir').value.split(',').map(Number);
    stopPreview = previewEffect($('lab-preview'), readForm().fx, { dx, dy });
  }

  async function save(e) {
    e.preventDefault();
    $('save-msg').textContent = '';
    $('save-err').textContent = '';
    readForm();
    if (!current.name) { $('save-err').textContent = 'ต้องใส่ชื่อสกิล'; return; }
    if (!API.token) { $('save-err').textContent = 'เข้าสู่ระบบที่หน้าเกมก่อน แล้วค่อยกลับมาบันทึก'; return; }
    const body = { ...current };
    delete body._builtin;
    if (!body.id) body.id = 'sk_' + Date.now().toString(36);
    try {
      const data = await API.post('/api/skills', body);
      const saved = { ...data.skill };
      const i = skills.findIndex((s) => s.id === saved.id);
      if (i >= 0) skills[i] = saved; else skills.push(saved);
      current = { ...saved };
      $('save-msg').textContent = 'บันทึกแล้ว · ใช้ในเกมครั้งถัดไปที่เข้าโลก';
      renderList();
    } catch (err) {
      $('save-err').textContent = err.message;
    }
  }

  async function remove() {
    if (!current || !current.id) return;
    if (current._builtin && !skills.find((s) => s.id === current.id && !s._builtin)) {
      $('save-err').textContent = 'สกิลค่าเริ่มต้นลบไม่ได้ ลองกด "คืนค่าเริ่มต้น" แทน';
      return;
    }
    if (!confirm(`ลบสกิล "${current.name}" ?`)) return;
    try {
      await API.del('/api/skills/' + current.id);
      await loadSkills(); // a deleted override may fall back to its default
      select(skills[0] || blankSkill());
      $('save-msg').textContent = 'ลบแล้ว';
    } catch (err) {
      $('save-err').textContent = err.message;
    }
  }

  function resetDefault() {
    if (!current) return;
    const def = Object.values(DEFAULT_SKILLS).flat().find((s) => s.id === current.id);
    if (!def) { $('save-err').textContent = 'สกิลนี้ไม่มีค่าเริ่มต้น'; return; }
    select({ ...def, _builtin: true });
  }

  async function boot() {
    API.init();
    fillSelects();
    await loadSkills();
    renderList();
    select(skills[0] || blankSkill());

    $('f-filter').addEventListener('change', renderList);
    $('btn-new').addEventListener('click', () => select(blankSkill($('f-filter').value || 'swordsman')));
    $('btn-delete').addEventListener('click', remove);
    $('btn-reset').addEventListener('click', resetDefault);
    $('btn-replay').addEventListener('click', replay);
    $('f-dir').addEventListener('change', replay);
    $('form').addEventListener('submit', save);
    for (const id of ['f-count', 'f-size', 'f-speed', 'f-shake']) {
      $(id).addEventListener('input', syncLabels);
    }
    for (const id of [...Object.values(FX_FIELDS)]) {
      $(id).addEventListener('change', replay);
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
