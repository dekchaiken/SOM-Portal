// admin/exams — page script, extracted from admin/exams.html.
//
// Wrapped in an IIFE on purpose. When this code lived inline it was run through
// Layout's indirect eval, which kept const/let/class LOCAL; as a plain external
// script those would become global lexical bindings and collide with other pages'
// scripts (both stay loaded across SPA navigation). The IIFE restores that scoping.
//
// Top-level function/var declarations DID leak to global under eval, and inline
// on*="" handlers in the HTML call them, so they are re-published on window below
// via accessor bridges (get + set, so later reassignment stays in sync).
(function () {
'use strict';

if (!Auth.requireAuth()) {}
if (!['super_admin','sm_admin','dev_sm'].includes(Auth.getUser()?.role)) {
  Toast.error('Admin only'); setTimeout(() => location.replace('../dashboard.html'), 800);
}
Layout.render('admin');

// ═══════════════ State ═══════════════
let exams = [];
let editing = null;          // currently editing exam (or null = new)
let editConfig = null;       // config object being edited
let editPreset = 'standard';
let editQuestions = [];
let _allCourses = null;      // cached course list for prereq picker (loaded lazily)
let editCoursePrereqs = [];  // selected course IDs in the current editor session

// ═══════════════ Load + render ═══════════════
async function load() {
  const res = await API.exams.list();
  if (!res?.ok) { Toast.error('โหลด exams ไม่สำเร็จ'); return; }
  exams = res.data?.data || [];
  renderStats();
  renderGrid();
}

function renderStats() {
  const total = exams.length;
  const pub   = exams.filter(e => e.status === 'published').length;
  const draft = exams.filter(e => e.status === 'draft').length;
  const subs  = exams.reduce((a,e) => a + (e.attempts_submitted || 0), 0);
  document.getElementById('stats').innerHTML = `
    <div class="stat-tile orange"><div class="n">${total}</div><div class="l">Total</div></div>
    <div class="stat-tile green"><div class="n">${pub}</div><div class="l">Published</div></div>
    <div class="stat-tile gray"><div class="n">${draft}</div><div class="l">Drafts</div></div>
    <div class="stat-tile blue"><div class="n">${subs}</div><div class="l">Submissions</div></div>
  `;
}

function renderGrid() {
  const grid = document.getElementById('grid');
  const countEl = document.getElementById('grid-count');
  if (countEl) countEl.textContent = `${exams.length} exam${exams.length === 1 ? '' : 's'}`;
  if (!exams.length) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1">
      <div class="icon"><i data-icon="edit"></i></div>
      <div>ยังไม่มีข้อสอบ — กด "+ New Exam" เพื่อสร้าง</div>
    </div>`;
    return;
  }
  const myTeam = Auth.getTeam();
  grid.innerHTML = exams.map(e => {
    const statusPill = ({
      draft:     '<span class="pill pill-gray">Draft</span>',
      published: '<span class="pill pill-green">Published</span>',
      archived:  '<span class="pill pill-red">Archived</span>',
    })[e.status] || '';
    const presetPill = e.preset === 'strict' ? 'pill-red'
                     : e.preset === 'standard' ? 'pill-orange'
                     : e.preset === 'basic' ? 'pill-blue' : 'pill-gray';
    const isShared   = !!e.shared;
    const owner      = e.owner_team || '';
    const iOwn       = !isShared || owner === myTeam;
    const readOnly   = isShared && !iOwn;
    const sharedPill = isShared
      ? (iOwn
          ? '<span class="pill pill-blue" title="ทีมของคุณเป็นเจ้าของ shared exam นี้"><i data-icon="globe"></i> Shared</span>'
          : `<span class="pill pill-gray" title="Shared exam จากทีม ${escHtml(owner)}"><i data-icon="globe"></i> จาก ${escHtml(owner)}</span>`)
      : '';
    const editBtn = readOnly
      ? `<button class="btn btn-ghost btn-sm" disabled title="แก้ไขได้เฉพาะทีมเจ้าของ (${escHtml(owner)})" style="opacity:.5"><i data-icon="eye"></i> ดู</button>`
      : `<button class="btn btn-ghost btn-sm" onclick="openEdit('${e.id}')"><i data-icon="pencil"></i> แก้ไข</button>`;
    const delBtn = readOnly
      ? ''
      : `<button class="btn btn-ghost btn-sm" onclick="delExam('${e.id}','${escHtml(e.title).replaceAll(`'`,'&#39;')}')" style="color:#ef4444; margin-left:auto"><i data-icon="trash"></i> ลบ</button>`;
    return `
      <div class="ex-card" style="--ex-accent:${escHtml(e.cover_color || '#f26419')}">
        <div class="top">
          <div class="ico">${renderIcon(e.icon, '<i data-icon="edit"></i>')}</div>
          <div style="flex:1; min-width:0">
            <div class="ti">${escHtml(e.title)}</div>
            <div class="sub">${escHtml(e.subtitle || e.description || '')}</div>
          </div>
        </div>
        <div class="meta">
          ${statusPill}
          ${sharedPill}
          <span class="pill ${presetPill}">${escHtml(e.preset || 'custom')}</span>
          <span><i data-icon="clipboard"></i> <b>${e.questions_count}</b> ข้อ</span>
          <span><i data-icon="check"></i> <b>${e.pass_score}%</b></span>
          <span><i data-icon="upload"></i> <b>${e.attempts_submitted || 0}</b></span>
          ${(e.attempts_in_progress > 0) ? `<span style="background:color-mix(in srgb, var(--orange) 15%, transparent); border-color:color-mix(in srgb, var(--orange) 40%, transparent); color:var(--orange)"><i data-icon="circle"></i> <b>${e.attempts_in_progress}</b> active</span>` : ''}
        </div>
        <div class="actions">
          ${editBtn}
          <button class="btn btn-ghost btn-sm" onclick="openAttempts('${e.id}','${escHtml(e.title).replaceAll(`'`,'&#39;')}')"><i data-icon="bar-chart"></i> ผลสอบ</button>
          <button class="btn btn-ghost btn-sm" onclick="openReport('${e.id}','${escHtml(e.title).replaceAll(`'`,'&#39;')}')"><i data-icon="trending-up"></i> Report</button>
          ${delBtn}
        </div>
      </div>`;
  }).join('');
}

// ═══════════════ Editor ═══════════════
async function ensureCoursesLoaded() {
  if (_allCourses) return _allCourses;
  const res = await API.courses.listCourses();
  _allCourses = res?.ok ? (res.data?.data || []) : [];
  return _allCourses;
}

async function renderCoursePrereqPicker() {
  const wrap = document.getElementById('cm-exam-courses');
  const courses = await ensureCoursesLoaded();
  if (!courses.length) {
    wrap.innerHTML = '<div style="font-size:11px; color:var(--text-muted); padding:8px">ยังไม่มีคอร์สในระบบ — สร้างคอร์สที่ admin/courses.html ก่อน</div>';
    return;
  }
  const selected = new Set(editCoursePrereqs);
  const knownIds = new Set(courses.map(c => c.id));
  const orphans = editCoursePrereqs.filter(id => !knownIds.has(id));
  const orphanHtml = orphans.map(id => `
    <label style="border:1px solid var(--danger,#e5484d); background:rgba(229,72,77,.08)">
      <input type="checkbox" value="${escHtml(id)}" checked onchange="toggleCoursePrereq(this)">
      <span class="cm-course-icon"><i data-icon="alert-triangle"></i></span>
      <span class="cm-course-title" style="color:var(--danger,#e5484d)">${escHtml(id)} — คอร์สนี้ไม่อยู่ในระบบแล้ว (untick เพื่อลบ)</span>
    </label>
  `).join('');
  wrap.innerHTML = orphanHtml + courses.map(c => `
    <label>
      <input type="checkbox" value="${escHtml(c.id)}" ${selected.has(c.id) ? 'checked' : ''}
             onchange="toggleCoursePrereq(this)">
      <span class="cm-course-icon">${renderIcon(c.icon)}</span>
      <span class="cm-course-title">${escHtml(c.title)}</span>
      ${c.published === false ? '<span class="cm-course-draft">draft</span>' : ''}
    </label>
  `).join('');
  if (window.Icons?.render) window.Icons.render(wrap);
}

function toggleCoursePrereq(cb) {
  const id = cb.value;
  if (cb.checked) {
    if (!editCoursePrereqs.includes(id)) editCoursePrereqs.push(id);
  } else {
    editCoursePrereqs = editCoursePrereqs.filter(x => x !== id);
  }
}

function newExam() {
  editing = null;
  editPreset = 'standard';
  editQuestions = [];
  editCoursePrereqs = [];
  document.getElementById('editor-title').textContent = 'New Exam';
  document.getElementById('f-title').value = '';
  document.getElementById('f-subtitle').value = '';
  document.getElementById('f-description').value = '';
  document.getElementById('f-icon').value = '<i data-icon="edit"></i>';
  document.getElementById('f-color').value = '#f26419';
  document.getElementById('f-pass').value = 70;
  document.getElementById('f-status').value = 'draft';
  document.getElementById('f-popular').checked = false;
  applySharedToggleUI(null);
  applyPreset('standard');
  renderCoursePrereqPicker();
  switchPane('info');
  document.getElementById('editor-modal').classList.add('active');
}

// Wire the "🌐 Share ข้ามทีม" toggle: enabled when the current team owns
// the exam (or when creating a new one). Foreign shared exams open in a
// disabled state to match the API guard's behaviour.
function applySharedToggleUI(e) {
  const chk  = document.getElementById('f-shared');
  const row  = document.getElementById('f-shared-row');
  const note = document.getElementById('f-shared-note');
  const myTeam = Auth.getTeam();
  chk.checked = !!(e?.shared);
  const isNew = !e;
  const owner = e?.owner_team || myTeam;
  const iOwn  = !e?.shared || owner === myTeam;
  chk.disabled = !isNew && !iOwn;
  row.style.opacity = chk.disabled ? '.55' : '1';
  if (!isNew && e?.shared && owner !== myTeam) {
    note.textContent = `Shared exam นี้เป็นของทีม "${owner}" — ทีมของคุณทำได้ แต่แก้ไขไม่ได้`;
  } else if (!isNew && e?.shared) {
    note.textContent = 'Untick ถ้าต้องการยกเลิกการแชร์ — ทีมอื่นจะไม่เห็นทันทีเมื่อกดบันทึก (attempts ที่ทีมอื่นทำไปแล้วยังอยู่)';
  } else {
    note.textContent = 'เมื่อ tick แล้วบันทึก ข้อสอบจะขึ้นในลิสต์ของทุกทีม — course prerequisite ต้องเป็น shared course เท่านั้น';
  }
}

async function openEdit(id) {
  const res = await API.exams.get(id);
  if (!res?.ok) return Toast.error('โหลด exam ไม่สำเร็จ');
  const e = res.data?.data;
  editing = e;
  editPreset = e.preset || 'custom';
  editQuestions = (e.questions || []).map(q => ({ ...q }));
  editCoursePrereqs = Array.isArray(e.course_prerequisites) ? [...e.course_prerequisites] : [];
  document.getElementById('editor-title').innerHTML = '<i data-icon="pencil"></i> Edit Exam';
  document.getElementById('f-title').value = e.title || '';
  document.getElementById('f-subtitle').value = e.subtitle || '';
  document.getElementById('f-description').value = e.description || '';
  document.getElementById('f-icon').value = e.icon || '<i data-icon="edit"></i>';
  document.getElementById('f-color').value = e.cover_color || '#f26419';
  // Use `??` not `||` — `0` is a valid pass_score meaning "no threshold, keep any score".
  // With `||` the field would silently reset to 70 every time admin opens the edit modal.
  document.getElementById('f-pass').value = e.pass_score ?? 70;
  document.getElementById('f-status').value = e.status || 'draft';
  document.getElementById('f-popular').checked = !!e.is_popular;
  applySharedToggleUI(e);
  setPresetActive(editPreset);
  editConfig = JSON.parse(JSON.stringify(e.config || {}));
  applyConfigToUI();
  renderCoursePrereqPicker();
  renderQuestions();
  switchPane('info');
  document.getElementById('editor-modal').classList.add('active');
}

function switchPane(name) {
  document.querySelectorAll('.ex-tab').forEach(t => t.classList.toggle('active', t.dataset.pane === name));
  document.querySelectorAll('.ex-pane').forEach(p => p.classList.toggle('active', p.dataset.pane === name));
}
document.querySelectorAll('.ex-tab').forEach(t => t.addEventListener('click', () => switchPane(t.dataset.pane)));

// Close
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => {
  document.getElementById('editor-modal').classList.remove('active');
}));
document.querySelectorAll('[data-close-att]').forEach(b => b.addEventListener('click', () => {
  document.getElementById('att-modal').classList.remove('active');
}));
document.querySelectorAll('[data-close-rep]').forEach(b => b.addEventListener('click', () => {
  document.getElementById('rep-modal').classList.remove('active');
}));

document.getElementById('btn-create').addEventListener('click', newExam);

// ═══════════════ Preset & config UI ═══════════════
function setPresetActive(name) {
  document.querySelectorAll('.preset-chip').forEach(c => c.classList.toggle('active', c.dataset.preset === name));
  editPreset = name;
}

document.querySelectorAll('.preset-chip').forEach(c => {
  c.addEventListener('click', () => applyPreset(c.dataset.preset));
});

async function applyPreset(name) {
  setPresetActive(name);
  if (name === 'custom') {
    // keep current config
    if (!editConfig) {
      const r = await API.exams.preset('basic');
      editConfig = r?.data?.data?.config || {};
    }
  } else {
    const r = await API.exams.preset(name);
    editConfig = r?.data?.data?.config || {};
  }
  applyConfigToUI();
}

function getCfgPath(path) {
  return path.split('.').reduce((o,k) => (o ? o[k] : undefined), editConfig);
}
function setCfgPath(path, val) {
  const parts = path.split('.');
  let o = editConfig;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!o[parts[i]] || typeof o[parts[i]] !== 'object') o[parts[i]] = {};
    o = o[parts[i]];
  }
  o[parts[parts.length - 1]] = val;
}

function applyConfigToUI() {
  document.querySelectorAll('[data-cfg]').forEach(el => {
    const path = el.dataset.cfg;
    const v = getCfgPath(path);
    if (el.type === 'checkbox') {
      el.checked = !!v;
    } else if (el.type === 'datetime-local') {
      el.value = v ? String(v).slice(0, 16) : '';
    } else if (el.tagName === 'SELECT') {
      el.value = (v === true ? 'true' : v === false ? 'false' : (v ?? ''));
    } else {
      el.value = (v ?? '');
    }
  });
  // Toggle "on" class for feat-rows
  document.querySelectorAll('.feat-row').forEach(r => {
    const cb = r.querySelector('input[type=checkbox][data-cfg$=".enabled"]');
    if (cb) r.classList.toggle('on', cb.checked);
  });
  // stratified visibility
  const strat = getCfgPath('pool.stratified');
  document.getElementById('strat-cats').style.display = strat ? '' : 'none';
  renderStratList();
  renderTabDetectionPreview();
}

// Rebuild the "with these settings, X will happen" preview under Tab Detection.
// Uses live DOM values (not saved config) so admin sees the effect of unsaved edits.
function renderTabDetectionPreview() {
  const box = document.getElementById('tabdet-preview');
  if (!box) return;
  const enabled = document.querySelector('[data-cfg="tab_detection.enabled"]')?.checked;
  if (!enabled) {
    box.innerHTML = `<span class="tp-lbl">OFF</span>ปิดใช้งาน — ระบบจะไม่นับหรือแจ้งเตือนการสลับแท็บใด ๆ`;
    return;
  }
  const max     = Number(document.querySelector('[data-cfg="tab_detection.max_violations"]')?.value || 0);
  const action  = document.querySelector('[data-cfg="tab_detection.action"]')?.value || 'log';
  const penalty = Number(document.querySelector('[data-cfg="tab_detection.penalty_pct"]')?.value || 0);
  const perQ    = Number(document.querySelector('[data-cfg="tab_detection.per_question_max"]')?.value || 0);
  const oneAtATime = !!document.querySelector('[data-cfg="one_at_a_time.enabled"]')?.checked;

  const quotaText = max > 0
    ? `ผู้สอบสลับแท็บได้ <b>${max} ครั้ง</b> — ครั้งที่ <b>${max + 1}</b>`
    : 'ทุกครั้งที่สลับแท็บ (ไม่มีโควตา)';

  const actionText = ({
    log:          'ระบบ<b>บันทึก log</b> อย่างเดียว ผู้สอบไม่รู้ตัว ไม่มีผลกับคะแนน',
    warn:         'ระบบ<b>โชว์ pop-up เตือน</b>ผู้สอบว่าสลับแท็บ ไม่มีผลกับคะแนน',
    penalty:      `ระบบ<b>หักคะแนน ${penalty}%</b>ตอนส่งข้อสอบ (สอบเสร็จก่อนถึงจะหัก)`,
    force_submit: 'ระบบ<b>บังคับส่งข้อสอบทันที</b> จบเกมทันทีที่เกินโควตา',
  })[action] || 'บันทึก log อย่างเดียว';

  let html = `<span class="tp-lbl">PREVIEW</span><b>[Exam-wide]</b> ${quotaText} จะ${actionText}`;

  if (perQ > 0) {
    if (oneAtATime) {
      html += `<br><span class="tp-lbl" style="background:#ef4444">PER-Q</span>ในข้อเดียวสลับแท็บได้ <b>${perQ} ครั้ง</b> — ครั้งที่ <b>${perQ + 1}</b> ระบบ<b>ล็อกข้อนั้น</b> ให้เลื่อนไปข้อถัดไปทันที (กลับมาแก้ไม่ได้ · คะแนนข้อนั้น = 0)`;
    } else {
      html += `<br><span class="tp-lbl" style="background:#f59e0b">WARN</span>ตั้ง per-question ไว้ <b>${perQ}</b> แต่ยัง<b>ไม่ได้เปิด One-at-a-time</b> — feature นี้จะไม่ทำงาน กรุณาเปิดใน card ด้านบน`;
    }
  }

  box.innerHTML = html;
}

function readUIToConfig() {
  document.querySelectorAll('[data-cfg]').forEach(el => {
    const path = el.dataset.cfg;
    let v;
    if (el.type === 'checkbox') v = el.checked;
    else if (el.type === 'number') v = el.value === '' ? 0 : Number(el.value);
    else if (el.tagName === 'SELECT') {
      v = el.value;
      if (v === 'true')  v = true;
      if (v === 'false') v = false;
    } else v = el.value;
    setCfgPath(path, v);
  });
  // categories from strat list
  const cats = [];
  document.querySelectorAll('#strat-list .strat-row').forEach(r => {
    const name = r.querySelector('[data-strat=name]').value.trim();
    const cnt  = Number(r.querySelector('[data-strat=count]').value || 0);
    if (name) cats.push({ name, count: cnt });
  });
  setCfgPath('pool.categories', cats);
}

function renderStratList() {
  const wrap = document.getElementById('strat-list');
  const cats = getCfgPath('pool.categories') || [];
  wrap.innerHTML = cats.map((c, i) => `
    <div class="strat-row">
      <input type="text" data-strat="name"  placeholder="ชื่อหมวด เช่น Networking" value="${escHtml(c.name)}" style="flex:2">
      <input type="number" data-strat="count" placeholder="จำนวน" value="${c.count}" min="0" style="flex:1">
      <button class="icon-x" onclick="rmStrat(${i})" title="ลบหมวดนี้">×</button>
    </div>`).join('');
}
function rmStrat(i) {
  readUIToConfig();
  const cats = getCfgPath('pool.categories') || [];
  cats.splice(i, 1);
  setCfgPath('pool.categories', cats);
  renderStratList();
}
document.getElementById('strat-add').addEventListener('click', () => {
  readUIToConfig();
  const cats = getCfgPath('pool.categories') || [];
  cats.push({ name: '', count: 0 });
  setCfgPath('pool.categories', cats);
  renderStratList();
});

// Any change in cfg fields → mark Custom + re-toggle row state
document.addEventListener('input', (e) => {
  if (!e.target.matches('[data-cfg]')) return;
  if (editPreset !== 'custom') setPresetActive('custom');
  // Toggle .on
  if (e.target.matches('input[type=checkbox][data-cfg$=".enabled"]')) {
    e.target.closest('.feat-row')?.classList.toggle('on', e.target.checked);
  }
  if (e.target.matches('[data-cfg="pool.stratified"]')) {
    document.getElementById('strat-cats').style.display = (e.target.value === 'true') ? '' : 'none';
  }
  if (e.target.matches('[data-cfg^="tab_detection."]') ||
      e.target.matches('[data-cfg="one_at_a_time.enabled"]')) {
    renderTabDetectionPreview();
  }
});

// ═══════════════ Question builder ═══════════════
document.querySelectorAll('[data-add]').forEach(b => {
  b.addEventListener('click', () => addQuestion(b.dataset.add));
});

function addQuestion(type) {
  const q = { id: 'q_' + Math.random().toString(36).slice(2,10), type, prompt: '', explain: '', category: '' };
  if (type === 'single')    { q.choices = ['', '', '', '']; q.answer = 0; }
  if (type === 'multi')     { q.choices = ['', '', '', '']; q.answer = []; }
  if (type === 'truefalse') { q.answer = true; }
  if (type === 'short')     { q.answer = ''; q.match_mode = 'exact'; q.case_sensitive = false; }
  editQuestions.push(q);
  renderQuestions();
}

// Resolve an image path that was stored relative to the app root. On
// admin/exams.html the current pathname includes /admin/, so a bare relative
// URL like "uploads/courses/7eleven/x.png" would resolve to /admin/uploads/...
// — wrong. Prepend the detected app base instead. API_BASE is defined by
// api.js; strip the trailing "/api" to get the app root.
function resolveAssetUrl(path) {
  if (!path) return '';
  if (/^(https?:)?\/\//i.test(path)) return path;
  if (path.startsWith('/'))          return path;
  const base = API_BASE.replace(/\/api$/, '');
  return base + '/' + path.replace(/^\.?\/*/, '');
}

function renderQuestions() {
  const list = document.getElementById('qb-list');
  document.getElementById('q-count').textContent = `${editQuestions.length} ข้อ`;
  if (!editQuestions.length) {
    list.innerHTML = `<div class="empty"><div class="icon">❓</div><div>ยังไม่มีข้อสอบ — กดปุ่มด้านบนเพื่อเพิ่ม</div></div>`;
    return;
  }
  list.innerHTML = editQuestions.map((q, i) => qbCardHtml(q, i)).join('');
}

const TYPE_LABELS = {
  single:    '📝 Single choice',
  multi:     '☑️ Multi choice',
  truefalse: '⚖️ True / False',
  short:     '✏️ Short answer',
};

function qbCardHtml(q, i) {

  let body = '';
  if (q.type === 'single' || q.type === 'multi') {
    body = `
      <div class="qb-choices-label">ตัวเลือก ${q.type === 'single' ? '(เลือก 1 ข้อที่ถูก)' : '(ติ๊กข้อที่ถูก ได้หลายข้อ)'}</div>
      ${(q.choices || []).map((ch, j) => {
        const correct = isChoiceCorrect(q, j);
        const letter = String.fromCharCode(65 + j);
        return `
        <div class="qb-choice ${correct ? 'is-correct' : ''}">
          <span class="corr">
            <input type="${q.type === 'single' ? 'radio' : 'checkbox'}"
                   name="qcorr_${i}"
                   ${correct ? 'checked' : ''}
                   title="ติ๊กถ้าข้อนี้ถูก"
                   onchange="setQAnswer(${i}, ${j}, this.checked)">
          </span>
          <span class="qb-letter">${letter}</span>
          <input type="text" placeholder="ตัวเลือก ${letter}" value="${escHtml(ch)}" oninput="setQChoice(${i}, ${j}, this.value)">
          <button class="icon-x" onclick="rmQChoice(${i}, ${j})" title="ลบตัวเลือกนี้">×</button>
        </div>`;
      }).join('')}
      <button class="qb-add-choice" type="button" onclick="addQChoice(${i})">+ เพิ่มตัวเลือก</button>
    `;
  } else if (q.type === 'truefalse') {
    body = `
      <div class="qb-choices-label">เลือกคำตอบที่ถูก</div>
      <div class="qb-tf">
        <label class="${q.answer === true ? 'selected' : ''}">
          <input type="radio" name="tf_${i}" ${q.answer === true ? 'checked' : ''} onchange="setQAnswer(${i}, true)">
          ✓ True
        </label>
        <label class="${q.answer === false ? 'selected' : ''}">
          <input type="radio" name="tf_${i}" ${q.answer === false ? 'checked' : ''} onchange="setQAnswer(${i}, false)">
          ✗ False
        </label>
      </div>
    `;
  } else if (q.type === 'short') {
    const accepted = Array.isArray(q.answer) ? q.answer.join(' | ') : (q.answer || '');
    body = `
      <div class="feat-config-grid" style="margin-top:0">
        <div>
          <label>คำตอบที่รับได้ (คั่นด้วย <code>|</code> ถ้ามีหลายคำ)</label>
          <input type="text" class="qb-prompt" style="min-height:auto; padding:9px 12px; font-size:13px"
                 placeholder="เช่น 3 | สาม | three"
                 value="${escHtml(accepted)}" oninput="setQShortAns(${i}, this.value)">
        </div>
        <div>
          <label>โหมดเทียบ</label>
          <select onchange="setQ(${i},'match_mode',this.value)" style="padding:9px 12px; font-size:13px; width:100%; border-radius:8px; border:1px solid var(--border); background:var(--bg); color:var(--text)">
            ${['exact','contains','regex'].map(m => `<option value="${m}" ${q.match_mode===m?'selected':''}>${m}</option>`).join('')}
          </select>
        </div>
        <div>
          <label>Case sensitive</label>
          <select onchange="setQ(${i},'case_sensitive',this.value==='true')" style="padding:9px 12px; font-size:13px; width:100%; border-radius:8px; border:1px solid var(--border); background:var(--bg); color:var(--text)">
            <option value="false" ${!q.case_sensitive?'selected':''}>ไม่ — ตัวพิมพ์ใหญ่/เล็กเหมือนกัน</option>
            <option value="true"  ${q.case_sensitive?'selected':''}>ใช่ — ต้องตรงเป๊ะ</option>
          </select>
        </div>
      </div>
    `;
  }

  return `
    <div class="qb">
      <div class="qb-head">
        <div class="qb-num">ข้อ ${i + 1}</div>
        <select class="qb-type-select" onchange="changeQType(${i}, this.value)" title="เปลี่ยนประเภทคำถาม">
          ${Object.entries(TYPE_LABELS).map(([k,v]) =>
            `<option value="${k}" ${q.type===k?'selected':''}>${v}</option>`
          ).join('')}
        </select>
        <input type="text" class="qb-cat" placeholder="หมวด (สำหรับ stratified)"
               value="${escHtml(q.category || '')}"
               oninput="setQ(${i},'category',this.value)">
        <button class="icon-x lg" onclick="rmQuestion(${i})" title="ลบข้อนี้" style="margin-left:auto">×</button>
      </div>
      <div class="qb-prompt-wrap">
        <label>โจทย์</label>
        <textarea class="qb-prompt" placeholder="พิมพ์โจทย์ที่นี่…" oninput="setQ(${i},'prompt',this.value)">${escHtml(q.prompt || '')}</textarea>
      </div>
      <div class="qb-image-wrap">
        <label>รูปประกอบ (optional) — ใช้สำหรับ diagram / screenshot ที่คำถามอ้างถึง</label>
        ${q.image
          ? `<div class="qb-image-preview">
              <img src="${escHtml(resolveAssetUrl(q.image))}" alt="Question image">
              <div class="qb-img-actions">
                <button onclick="removeQImage(${i})" title="ลบรูป">×</button>
              </div>
            </div>`
          : `<label class="qb-image-empty" for="q-img-input-${i}">
              <span class="ic">📷</span>
              <span class="lbl">
                <b>คลิกเพื่ออัปโหลดรูป</b>
                <span>JPG · PNG · GIF · WEBP · สูงสุด 5MB</span>
              </span>
              <input type="file" id="q-img-input-${i}" accept="image/*" style="display:none"
                     onchange="uploadQImage(${i}, this)">
            </label>`
        }
      </div>
      ${body}
      <div class="qb-explain">
        <label>คำอธิบาย <span style="font-weight:400; text-transform:none; color:var(--text-muted)">(แสดงให้ผู้สอบหลังสอบเสร็จ ถ้าเปิด show explains)</span></label>
        <input type="text" placeholder="เช่น เพราะว่า..." value="${escHtml(q.explain || '')}" oninput="setQ(${i},'explain',this.value)">
      </div>
    </div>`;
}
function isChoiceCorrect(q, j) {
  if (q.type === 'single') return Number(q.answer) === j;
  if (q.type === 'multi')  return Array.isArray(q.answer) && q.answer.includes(j);
  return false;
}
function setQ(i, key, val)            { editQuestions[i][key] = val; }
function setQChoice(i, j, val)        { editQuestions[i].choices[j] = val; }

// ── Question image upload / remove ──────────────────────────
// The upload endpoint is api/upload.php — we send scope=exam-images so it
// lands in uploads/exam-images/ instead of the board folder.
async function uploadQImage(i, inputEl) {
  const file = inputEl.files?.[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    Toast.error('ไฟล์ใหญ่เกิน 5MB'); return;
  }
  if (!file.type.startsWith('image/')) {
    Toast.error('เลือกไฟล์รูปภาพเท่านั้น (JPG/PNG/GIF/WEBP)'); return;
  }

  // ── Show instant local preview using object URL ────────────────
  //    Admin can see what they picked BEFORE upload finishes — no wait staring.
  //    We swap to the server URL once the response comes back.
  const localUrl = URL.createObjectURL(file);
  const wrap = inputEl.closest('.qb-image-wrap');
  if (wrap) {
    wrap.innerHTML = `
      <label>รูปประกอบ (optional) — ใช้สำหรับ diagram / screenshot ที่คำถามอ้างถึง</label>
      <div class="qb-image-preview qb-image-uploading">
        <img src="${localUrl}" alt="Uploading…">
        <div class="qb-upload-overlay">
          <div class="qb-upload-spinner"></div>
          <div class="qb-upload-text">กำลังอัปโหลด...</div>
        </div>
      </div>
    `;
  }

  const fd = new FormData();
  fd.append('image', file);
  fd.append('scope', 'exam-images');

  const res = await API.upload('/upload.php', fd);

  // Release the local object URL — we're switching to the server URL now
  URL.revokeObjectURL(localUrl);

  if (!res?.ok) {
    Toast.error(res?.data?.message || 'อัปโหลดไม่สำเร็จ');
    renderQuestions();   // roll UI back to drop-zone
    return;
  }
  editQuestions[i].image = res.data?.data?.url || '';
  if (editPreset !== 'custom') setPresetActive('custom');
  Toast.success('อัปโหลดสำเร็จ');
  renderQuestions();
}

function removeQImage(i) {
  if (!editQuestions[i].image) return;
  delete editQuestions[i].image;
  if (editPreset !== 'custom') setPresetActive('custom');
  renderQuestions();
}

function addQChoice(i)                { editQuestions[i].choices.push(''); renderQuestions(); }
function rmQChoice(i, j) {
  editQuestions[i].choices.splice(j, 1);
  if (editQuestions[i].type === 'single') {
    if (editQuestions[i].answer >= editQuestions[i].choices.length) editQuestions[i].answer = 0;
  } else if (editQuestions[i].type === 'multi') {
    editQuestions[i].answer = (editQuestions[i].answer || []).filter(x => x !== j).map(x => x > j ? x - 1 : x);
  }
  renderQuestions();
}
function setQAnswer(i, jOrBool, checked) {
  const q = editQuestions[i];
  if (q.type === 'single')    q.answer = jOrBool;
  else if (q.type === 'truefalse') q.answer = jOrBool;
  else if (q.type === 'multi') {
    const arr = new Set(Array.isArray(q.answer) ? q.answer : []);
    if (checked) arr.add(jOrBool); else arr.delete(jOrBool);
    q.answer = [...arr].sort((a,b)=>a-b);
  }
}
function setQShortAns(i, val) {
  const arr = val.split('|').map(s => s.trim()).filter(Boolean);
  editQuestions[i].answer = arr.length > 1 ? arr : (arr[0] || '');
}
function rmQuestion(i) { editQuestions.splice(i, 1); renderQuestions(); }

// Change question type while preserving prompt/category/explain
function changeQType(i, newType) {
  const q = editQuestions[i];
  if (!q || q.type === newType) return;

  // Remember preserved fields
  const preserved = {
    id:       q.id,
    prompt:   q.prompt   || '',
    category: q.category || '',
    explain:  q.explain  || '',
  };

  // Try to carry over choices/answer when sensible
  let carriedChoices = q.choices ? [...q.choices] : null;

  const next = { ...preserved, type: newType };

  if (newType === 'single') {
    next.choices = carriedChoices && carriedChoices.length >= 2
                   ? carriedChoices
                   : ['', '', '', ''];
    // If old type was multi, take first selected as answer
    if (q.type === 'multi' && Array.isArray(q.answer) && q.answer.length) {
      next.answer = q.answer[0];
    } else {
      next.answer = 0;
    }
  } else if (newType === 'multi') {
    next.choices = carriedChoices && carriedChoices.length >= 2
                   ? carriedChoices
                   : ['', '', '', ''];
    if (q.type === 'single' && typeof q.answer === 'number') {
      next.answer = [q.answer];
    } else {
      next.answer = [];
    }
  } else if (newType === 'truefalse') {
    next.answer = (q.type === 'truefalse') ? !!q.answer : true;
  } else if (newType === 'short') {
    next.answer = '';
    next.match_mode = q.match_mode || 'exact';
    next.case_sensitive = !!q.case_sensitive;
  }

  editQuestions[i] = next;
  renderQuestions();
  Toast.success(`เปลี่ยนเป็น ${TYPE_LABELS[newType]} แล้ว`);
}

// ═══════════════ Save ═══════════════
document.getElementById('btn-save').addEventListener('click', async () => {
  readUIToConfig();
  const title = document.getElementById('f-title').value.trim();
  if (!title) { Toast.error('Title required'); switchPane('info'); return; }
  if (!editQuestions.length) { Toast.error('ต้องมีข้อสอบอย่างน้อย 1 ข้อ'); switchPane('questions'); return; }

  const payload = {
    title,
    subtitle:    document.getElementById('f-subtitle').value.trim(),
    description: document.getElementById('f-description').value.trim(),
    icon:        document.getElementById('f-icon').value.trim() || '📝',
    cover_color: document.getElementById('f-color').value,
    // `.value` is a string; "0" is truthy so `|| 70` doesn't corrupt it — but
    // "" (empty field) would fall back to 70. Preserve intent: empty → 0.
    pass_score:  Number(document.getElementById('f-pass').value) || 0,
    status:      document.getElementById('f-status').value,
    preset:      editPreset,
    is_popular:  document.getElementById('f-popular').checked,
    shared:      document.getElementById('f-shared').checked,
    config:      editConfig,
    questions:   editQuestions,
    course_prerequisites: [...editCoursePrereqs],
  };

  const btn = document.getElementById('btn-save');
  btn.disabled = true;
  const res = editing
    ? await API.exams.update(editing.id, payload)
    : await API.exams.create(payload);
  btn.disabled = false;
  if (!res?.ok) return Toast.error(res?.data?.message || 'Save failed');
  Toast.success('บันทึกแล้ว');
  document.getElementById('editor-modal').classList.remove('active');
  load();
});

// ═══════════════ Delete ═══════════════
async function delExam(id, title) {
  if (!await confirmDialog(`การลบจะทำให้ข้อมูล attempt ของผู้สอบถูกลบไปด้วย — กู้คืนไม่ได้\n\nลบ "${title}" ?`, 'ลบข้อสอบ')) return;
  const res = await API.exams.delete(id);
  if (!res?.ok) return Toast.error(res?.data?.message || 'Delete failed');
  Toast.success('ลบแล้ว');
  load();
}

// ═══════════════ Attempts viewer ═══════════════
// ═══════════════ Attempts modal (redesigned) ═══════════════
let _attemptsAll = [];
let _attemptsExamId = null;
let _attemptsExamTitle = '';
let _attemptsFilter = 'all';
// Not-attempted set derived from /exams/report — needed so 📊 ผลสอบ can show
// the "ยังไม่ได้ทำ" chip + user list without needing to also open 📈 Report.
let _attemptsNotAttempted = [];
let _attemptsEligibleCount = 0;
let _attemptsExamPassScore = 70;

function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] || '') + (parts[1]?.[0] || '');
}

function duration(startISO, endISO) {
  if (!startISO || !endISO) return null;
  const s = new Date(startISO).getTime();
  const e = new Date(endISO).getTime();
  if (!s || !e || e < s) return null;
  const sec = Math.round((e - s) / 1000);
  const mm = Math.floor(sec / 60), ss = sec % 60;
  return `${mm} น. ${ss} วิ`;
}

async function openAttempts(id, title) {
  _attemptsExamId = id;
  _attemptsExamTitle = title;
  _attemptsFilter = 'all';
  document.getElementById('att-title').textContent = '📊 ผลสอบ — ' + title;
  document.getElementById('att-body').innerHTML = '<div data-skel="list" data-rows="3"></div>';
  document.getElementById('att-modal').classList.add('active');

  // Load attempts + report side-by-side. Report gives us the not-attempted list
  // that isn't derivable from attempts.json alone (users who never touched the
  // exam have no attempts record).
  const [attRes, repRes] = await Promise.all([
    API.exams.listAttempts(id),
    API.exams.report(id),
  ]);
  if (!attRes?.ok) {
    document.getElementById('att-body').innerHTML =
      '<div class="att-empty"><div class="icon">⚠️</div><div>โหลดไม่สำเร็จ</div></div>';
    return;
  }
  _attemptsAll = attRes.data?.data || [];
  const rep = repRes?.data?.data || {};
  _attemptsNotAttempted   = rep.not_attempted || [];
  _attemptsEligibleCount  = rep.overview?.eligible_users ?? _attemptsAll.length;
  _attemptsExamPassScore  = rep.exam?.pass_score ?? 70;
  renderAttempts();
}

function renderAttempts() {
  const rows = _attemptsAll;
  const body = document.getElementById('att-body');

  // Aggregate stats — always computed so the hero + filter chips still show
  // even when nobody has attempted the exam yet.
  const total = rows.length;
  const submitted = rows.filter(r => r.status === 'submitted');
  const passed = submitted.filter(r => r.passed).length;
  const failed = submitted.length - passed;
  const inProgress = rows.filter(r => r.status === 'in_progress').length;
  const avgScore = submitted.length
    ? Math.round(submitted.reduce((s, r) => s + (r.score || 0), 0) / submitted.length)
    : 0;
  const passRate = submitted.length ? Math.round(passed / submitted.length * 100) : 0;
  const notCount = _attemptsNotAttempted.length;
  const eligible = _attemptsEligibleCount;
  // "ทำแล้ว" = unique users who have at least one attempt (any status).
  // This is different from `total` (which counts attempts, not people).
  const uniqueAttemptUsers = new Set(rows.map(r => r.user_id)).size;

  // Filter
  const filter = _attemptsFilter;
  let filtered = rows;
  if (filter === 'passed') filtered = rows.filter(r => r.status === 'submitted' && r.passed);
  else if (filter === 'failed') filtered = rows.filter(r => r.status === 'submitted' && !r.passed);
  else if (filter === 'in_progress') filtered = rows.filter(r => r.status === 'in_progress');

  // Special view: "🚫 ยังไม่ได้ทำ" renders user chips instead of attempt cards
  const notAttemptedListHtml = filter === 'not_attempted' ? `
    <div class="att-list">
      ${notCount === 0
        ? `<div class="att-empty"><div class="icon">🎉</div><div>ทุกคน (${eligible} คน) ทำข้อสอบครบแล้ว</div></div>`
        : `<div style="padding:16px;background:var(--bg-card);border:1px solid var(--border);border-radius:10px">
             <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">รายชื่อผู้ที่ยังไม่ได้เริ่มทำข้อสอบนี้ — อิงจาก users.json ของทีมนี้ ที่ <code>exam_include ≠ false</code></div>
             <div style="display:flex;flex-wrap:wrap;gap:8px">
               ${_attemptsNotAttempted.map(u => `
                 <div style="display:inline-flex;align-items:center;gap:8px;padding:6px 12px;background:var(--bg);border:1px solid var(--border);border-radius:20px;font-size:12px">
                   <div style="width:24px;height:24px;border-radius:50%;background:var(--orange);color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700">${escHtml((u.name || '?').charAt(0).toUpperCase())}</div>
                   <span>${escHtml(u.name)}</span>
                   ${u.email ? `<span style="color:var(--text-muted);font-size:10px">${escHtml(u.email)}</span>` : ''}
                 </div>`).join('')}
             </div>
             <div style="margin-top:16px;text-align:center">
               <button class="btn btn-primary" onclick="openReminderModalFromAttempts()" style="font-size:12px">🔔 ส่ง Reminder เข้า Google Chat</button>
             </div>
           </div>`}
    </div>` : `
    <div class="att-list">
      ${filtered.length === 0
        ? '<div class="att-empty"><div class="icon">🔍</div><div>ไม่มี attempt ที่ตรงตัวกรอง</div></div>'
        : filtered.map(a => attemptCardHtml(a)).join('')}
    </div>`;

  body.innerHTML = `
    <div class="att-hero">
      <div class="att-hero-title">ภาพรวม</div>
      <div class="att-stats">
        <div class="att-stat-cell accent"><div class="n">${eligible}</div><div class="l">Eligible ทั้งหมด</div></div>
        <div class="att-stat-cell green"><div class="n">${uniqueAttemptUsers}</div><div class="l">ทำแล้ว</div></div>
        <div class="att-stat-cell" style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.25)"><div class="n" style="color:#ef4444">${notCount}</div><div class="l">ยังไม่ได้ทำ</div></div>
        <div class="att-stat-cell blue"><div class="n">${inProgress}</div><div class="l">กำลังทำ</div></div>
        <div class="att-stat-cell"><div class="n">${passRate}<span style="font-size:14px;opacity:.6">%</span></div><div class="l">Pass Rate</div></div>
        <div class="att-stat-cell"><div class="n">${avgScore}<span style="font-size:14px;opacity:.6">%</span></div><div class="l">คะแนนเฉลี่ย</div></div>
      </div>
    </div>

    <div class="att-filter">
      <span class="att-filter-label">กรอง</span>
      <span class="att-chip ${filter==='all'?'active':''}" onclick="filterAttempts('all')">ทำแล้ว (attempts) <span class="ct">${total}</span></span>
      <span class="att-chip ${filter==='passed'?'active':''}" onclick="filterAttempts('passed')">ผ่าน <span class="ct">${passed}</span></span>
      <span class="att-chip ${filter==='failed'?'active':''}" onclick="filterAttempts('failed')">ไม่ผ่าน <span class="ct">${failed}</span></span>
      <span class="att-chip ${filter==='in_progress'?'active':''}" onclick="filterAttempts('in_progress')">กำลังทำ <span class="ct">${inProgress}</span></span>
      <span class="att-chip ${filter==='not_attempted'?'active':''}" style="${filter==='not_attempted' ? 'background:rgba(239,68,68,.15);border-color:#ef4444;color:#ef4444' : 'color:#ef4444'}" onclick="filterAttempts('not_attempted')">🚫 ยังไม่ได้ทำ <span class="ct">${notCount}</span></span>
      <div class="att-filter-actions">
        <button class="btn btn-ghost btn-sm" onclick="openReminderModalFromAttempts()" style="color:#4285F4;font-weight:600">🔔 Reminder</button>
        <button class="btn btn-ghost btn-sm" onclick="resetAllAttempts('${_attemptsExamId}')" style="color:#ef4444"><i data-icon="trash"></i> ลบทั้งหมด</button>
      </div>
    </div>

    ${notAttemptedListHtml}
  `;
}

function attemptCardHtml(a) {
  const status = a.status === 'submitted' ? (a.passed ? 'passed' : 'failed') : 'in_progress';
  const tagText = status === 'passed' ? '✓ ผ่าน' : status === 'failed' ? '✗ ไม่ผ่าน' : '● กำลังทำ';
  const v = a.violations || {};
  const violationChips = Object.entries(v)
    .filter(([_, n]) => n > 0)
    .map(([k, n]) => {
      const map = {
        tab_switch: { ic: '🚪', label: 'สลับแท็บ' },
        blur:       { ic: '💫', label: 'หน้าจอเสียโฟกัส' },
        fullscreen_exit: { ic: '🖥', label: 'ออก fullscreen' },
        copy:       { ic: '📋', label: 'พยายาม copy' },
        paste:      { ic: '📎', label: 'พยายาม paste' },
      };
      const m = map[k] || { ic: '⚠️', label: k };
      return `<span class="att-vchip"><span class="ic">${m.ic}</span>${m.label} ×${n}</span>`;
    }).join('');

  const dur = duration(a.started_at, a.submitted_at);
  const scoreDisplay = a.status === 'submitted'
    ? `<div class="att-score-pct">${a.score}<span class="pct">%</span></div>`
    : `<div class="att-score-pct">—</div>`;

  return `
    <div class="att-card ${status}" data-att-id="${a.id}">
      <div class="att-card-row">
        <div class="att-avatar">${escHtml(initials(a.user_name || a.user_id))}</div>
        <div class="att-user-block">
          <div class="att-user-name">${escHtml(a.user_name || a.user_id)}</div>
          <div class="att-user-meta">
            <span>🕒 เริ่ม ${a.started_at ? fmtDate(a.started_at) : '-'}</span>
            ${a.submitted_at ? `<span class="sep">·</span><span>ส่ง ${fmtDate(a.submitted_at)}</span>` : ''}
            ${dur ? `<span class="sep">·</span><span>⏱ ${dur}</span>` : ''}
            ${a.auto_submitted ? `<span class="sep">·</span><span style="color:#f59e0b">⚙ ระบบบังคับส่ง</span>` : ''}
          </div>
        </div>
        <div class="att-score">
          ${scoreDisplay}
          <div class="att-score-tag">${tagText}</div>
        </div>
        <div class="att-actions">
          <button class="att-icon-btn" onclick="toggleTimeline('${a.id}')" title="ดู timeline">📅</button>
          <button class="att-icon-btn danger" onclick="resetAttempt('${a.id}','${escHtml(a.user_name||'').replaceAll(`'`,'&#39;')}','${_attemptsExamId}')" title="ลบ attempt นี้"><i data-icon="trash"></i></button>
        </div>
      </div>
      ${violationChips ? `<div class="att-violations">${violationChips}</div>` : ''}
      <div class="att-timeline" id="att-timeline-${a.id}">
        <div class="att-timeline-title">Timeline (กำลังโหลด…)</div>
      </div>
    </div>
  `;
}

function filterAttempts(f) {
  _attemptsFilter = f;
  renderAttempts();
}

// Cache events per attempt so the fullscreen modal can reuse what the inline
// drawer already fetched — avoids a second network round-trip when admin
// clicks ⛶ to expand.
const _timelineCache = new Map();

function _tlEventClass(t) {
  if (['tab_switch','blur','focus','fullscreen_exit','paste','copy','devtools','question_skipped'].includes(t)) return 'security';
  if (t === 'policy_consent') return 'consent';
  if (t === 'attempt_submit' || t === 'attempt_auto_submit') return 'submit';
  if (t === 'attempt_start') return 'start';
  return 'action';
}
function _tlFmtData(e) {
  const d = e.data || {};
  const bits = [];
  if (d.q_index !== undefined) bits.push(`ข้อ <b>${d.q_index}</b>`);
  if (d.score !== undefined) bits.push(`คะแนน <b>${d.score}%</b>`);
  if (d.passed !== undefined) bits.push(`<b>${d.passed ? 'ผ่าน' : 'ไม่ผ่าน'}</b>`);
  if (d.duration_sec) {
    const mm = Math.floor(d.duration_sec/60), ss = d.duration_sec%60;
    bits.push(`ใช้เวลา <b>${mm}น ${ss}ว</b>`);
  }
  if (d.questions_picked) bits.push(`<b>${d.questions_picked}</b> ข้อ`);
  if (d.correct_count !== undefined) bits.push(`ถูก <b>${d.correct_count}/${d.total_count}</b>`);
  if (d.reason) bits.push(d.reason);
  return bits.join(' · ');
}
function _tlRenderEventList(events) {
  return events.map(e => `
    <div class="att-event ${_tlEventClass(e.type)}">
      <div class="att-event-row1">
        <span class="att-event-label">${escHtml(e.label || e.type)}</span>
        ${e.violation_count ? `<span class="att-event-vcount">×${e.violation_count}</span>` : ''}
        <span class="att-event-ts">${fmtDateTime(e.ts)}</span>
      </div>
      ${_tlFmtData(e) ? `<div class="att-event-data">${_tlFmtData(e)}</div>` : ''}
    </div>
  `).join('');
}

async function toggleTimeline(attId) {
  const card = document.querySelector(`.att-card[data-att-id="${attId}"]`);
  if (!card) return;
  const wasOpen = card.classList.contains('expanded');
  // Close all others
  document.querySelectorAll('.att-card.expanded').forEach(c => c.classList.remove('expanded'));
  if (wasOpen) return;

  card.classList.add('expanded');
  const tl = card.querySelector(`#att-timeline-${attId}`);
  tl.innerHTML = '<div class="att-timeline-title">Timeline (กำลังโหลด…)</div>';

  const res = await API.exams.attemptEvents(attId);
  if (!res?.ok) {
    tl.innerHTML = '<div class="att-timeline-title">Timeline</div><div style="color:var(--text-muted); font-size:12px">โหลด events ไม่สำเร็จ</div>';
    return;
  }
  const events = res.data?.data?.events || [];
  if (!events.length) {
    tl.innerHTML = '<div class="att-timeline-title">Timeline</div><div style="color:var(--text-muted); font-size:12px">ไม่มี events</div>';
    return;
  }

  // Cache for the fullscreen modal so it can reuse without re-fetching.
  const userName = card.querySelector('.att-user-name')?.textContent || '';
  _timelineCache.set(attId, { events, userName });

  tl.innerHTML = `
    <div class="att-timeline-title">
      Timeline (${events.length} events)
      <button class="tl-expand" onclick="openTimelineModal('${attId}')" title="ขยายเต็มจอ">⛶ ขยาย</button>
    </div>
    <div class="att-event-list">
      ${_tlRenderEventList(events)}
    </div>
  `;
}

function openTimelineModal(attId) {
  const cached = _timelineCache.get(attId);
  if (!cached) return;
  const { events, userName } = cached;

  // Summary chips — group events by category so admin can see anti-cheat
  // count at a glance before scrolling.
  const counts = { security: 0, submit: 0, consent: 0, start: 0, action: 0 };
  events.forEach(e => { counts[_tlEventClass(e.type)]++; });

  const chips = [];
  chips.push(`<span class="chip">📅 <b>${events.length}</b> events</span>`);
  if (counts.security)  chips.push(`<span class="chip danger">⚠️ Security <b>${counts.security}</b></span>`);
  if (counts.submit)    chips.push(`<span class="chip success">✓ Submit <b>${counts.submit}</b></span>`);
  if (counts.consent)   chips.push(`<span class="chip">📝 Consent <b>${counts.consent}</b></span>`);
  if (counts.start)     chips.push(`<span class="chip">▶ Start <b>${counts.start}</b></span>`);
  if (counts.action)    chips.push(`<span class="chip">• Action <b>${counts.action}</b></span>`);

  document.getElementById('tl-modal-title').textContent   = `📅 Timeline — ${userName}`;
  document.getElementById('tl-modal-summary').innerHTML   = chips.join('');
  document.getElementById('tl-modal-list').innerHTML      = `<div class="att-event-list" style="max-height:none">${_tlRenderEventList(events)}</div>`;
  document.getElementById('tl-modal').classList.add('active');
}

function closeTimelineModal() {
  document.getElementById('tl-modal').classList.remove('active');
}

// Close on backdrop click and Escape (mirrors modal patterns elsewhere in this file)
document.getElementById('tl-modal').addEventListener('click', e => {
  if (e.target.id === 'tl-modal') closeTimelineModal();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('tl-modal').classList.contains('active')) {
    closeTimelineModal();
  }
});

function fmtDateTime(s) {
  try {
    const d = new Date(s);
    return d.toLocaleString('th-TH', { hour:'2-digit', minute:'2-digit', second:'2-digit', day:'2-digit', month:'short' });
  } catch { return s; }
}

async function resetAttempt(attemptId, userName, examId) {
  if (!await confirmDialog(`ลบ attempt ของ "${userName}" ?`, 'Reset Attempt')) return;
  const res = await API.exams.resetAttempt(attemptId);
  if (!res?.ok) return Toast.error(res?.data?.message || 'Reset failed');
  Toast.success('ลบแล้ว');
  openAttempts(examId, document.getElementById('att-title').textContent.replace(/^📊 Attempts — /, ''));
  load();
}

async function resetAllAttempts(examId) {
  if (!await confirmDialog('จะลบ attempts ทั้งหมดของข้อสอบนี้ — ผู้สอบทุกคน กู้คืนไม่ได้', 'Reset ทั้งหมด')) return;
  const res = await API.exams.resetExamAttempts(examId);
  if (!res?.ok) return Toast.error(res?.data?.message || 'Reset failed');
  Toast.success(`ลบแล้ว (${res.data?.data?.removed || 0} attempt)`);
  document.getElementById('att-modal').classList.remove('active');
  load();
}

function fmtDate(s) {
  try { return new Date(s).toLocaleString('th-TH', { dateStyle:'short', timeStyle:'short' }); }
  catch { return s; }
}

// ═══════════════ Report (per-exam analytics) ═══════════════
let _report = null;

async function openReport(examId, title) {
  document.getElementById('rep-title').textContent = '📈 Report — ' + title;
  document.getElementById('rep-body').innerHTML = '<div data-skel="list" data-rows="3"></div>';
  document.getElementById('rep-modal').classList.add('active');

  const res = await API.exams.report(examId);
  if (!res?.ok) {
    document.getElementById('rep-body').innerHTML =
      '<div class="rep-empty"><div class="icon">⚠️</div><div>โหลด report ไม่สำเร็จ</div></div>';
    return;
  }
  _report = res.data?.data || null;
  renderReport();
}

function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  if (sec < 60) return sec + ' วินาที';
  const m = Math.floor(sec / 60), s = sec % 60;
  if (m < 60) return `${m} น. ${s} วิ`;
  const h = Math.floor(m / 60), mm = m % 60;
  return `${h} ชม. ${mm} น.`;
}

function fmtDateOnly(s) {
  try { return new Date(s).toLocaleDateString('th-TH', { month:'short', day:'numeric' }); }
  catch { return s; }
}

function repInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase();
}

function renderReport() {
  const r = _report;
  if (!r) return;
  const body = document.getElementById('rep-body');
  const ex   = r.exam;
  const ov   = r.overview;
  const accent = ex.cover_color || '#f26419';

  // ─── Empty state — no attempts at all ───
  if (ov.total_attempts === 0) {
    body.innerHTML = `
      <div class="rep-hero" style="--rep-accent:${escHtml(accent)}">
        <div class="rep-hero-ico">${renderIcon(ex.icon, '<i data-icon="trending-up"></i>')}</div>
        <div class="rep-hero-body">
          <div class="rep-hero-eyebrow">Report · Snapshot · ${escHtml(new Date().toLocaleString('th-TH', {dateStyle:'medium', timeStyle:'short'}))}</div>
          <h2>${escHtml(ex.title)}</h2>
          <p>${ex.questions_count} ข้อ · ${ex.pass_score > 0 ? `เกณฑ์ผ่าน ${ex.pass_score}%` : 'ไม่มีเกณฑ์ผ่าน'}</p>
        </div>
      </div>
      <div class="rep-empty">
        <div class="icon">📭</div>
        <div>ยังไม่มีคนทำข้อสอบนี้ — กลับมาดูภายหลังครับ</div>
      </div>`;
    return;
  }

  // ─── Hero ───
  const heroHtml = `
    <div class="rep-hero" style="--rep-accent:${escHtml(accent)}">
      <div class="rep-hero-ico">${renderIcon(ex.icon, '<i data-icon="trending-up"></i>')}</div>
      <div class="rep-hero-body">
        <div class="rep-hero-eyebrow">Report · Snapshot · ${escHtml(new Date().toLocaleString('th-TH', {dateStyle:'medium', timeStyle:'short'}))}</div>
        <h2>${escHtml(ex.title)}</h2>
        <p>${ex.questions_count} ข้อ · ${ex.pass_score > 0 ? `เกณฑ์ผ่าน <b>${ex.pass_score}%</b>` : '<b>ไม่มีเกณฑ์ผ่าน</b>'}</p>
        <div class="rep-hero-meta">
          ${ov.first_attempt_at ? `<span>📅 เริ่มมีคนทำ <b>${escHtml(fmtDate(ov.first_attempt_at))}</b></span>` : ''}
          ${ov.last_attempt_at  ? `<span>·</span><span>🕒 ล่าสุด <b>${escHtml(fmtDate(ov.last_attempt_at))}</b></span>` : ''}
        </div>
      </div>
    </div>`;

  // ─── KPI tiles ───
  const kpisHtml = `
    <div class="rep-kpis">
      <div class="rep-kpi accent">
        <div class="n">${ov.unique_users}</div>
        <div class="l">ผู้เข้าสอบ</div>
        <div class="sub">${ov.total_attempts} ครั้งทั้งหมด</div>
      </div>
      <div class="rep-kpi green">
        <div class="n">${ov.passed}</div>
        <div class="l">ผ่าน</div>
        <div class="sub">${ov.pass_rate}% pass rate</div>
      </div>
      <div class="rep-kpi red">
        <div class="n">${ov.failed}</div>
        <div class="l">ไม่ผ่าน</div>
        <div class="sub">${ov.submitted} ส่งทั้งหมด</div>
      </div>
      <div class="rep-kpi blue">
        <div class="n">${ov.avg_score}<span class="u">%</span></div>
        <div class="l">เฉลี่ย</div>
        <div class="sub">median ${ov.median_score}% · ดีสุด ${ov.max_score}%</div>
      </div>
      <div class="rep-kpi amber">
        <div class="n">${fmtDur(ov.avg_duration_sec).replace(/\s.+$/,'')}<span class="u">${fmtDur(ov.avg_duration_sec).split(' ').slice(1).join(' ')}</span></div>
        <div class="l">เวลาเฉลี่ย</div>
        <div class="sub">ต่อ attempt</div>
      </div>
      ${ov.in_progress > 0 ? `
        <div class="rep-kpi amber">
          <div class="n">${ov.in_progress}</div>
          <div class="l">กำลังทำ</div>
          <div class="sub">ยังไม่ส่ง</div>
        </div>` : ''}
      ${ov.total_violations > 0 ? `
        <div class="rep-kpi red">
          <div class="n">${ov.total_violations}</div>
          <div class="l">Violations</div>
          <div class="sub">รวมทุกประเภท</div>
        </div>` : ''}
    </div>`;

  // ─── Score distribution ───
  const maxBucket = Math.max(1, ...r.distribution.map(b => b.count));
  const bucketColor = ['#ef4444','#f97316','#eab308','#3b82f6','#10b981'];
  const distHtml = `
    <div class="rep-card">
      <div class="rep-card-head">📊 Score Distribution <span class="sub">${ov.submitted} attempts ที่ส่งแล้ว</span></div>
      <div class="rep-bars">
        ${r.distribution.map((b, i) => `
          <div class="rep-bar-row">
            <div class="rep-bar-label">${b.label}</div>
            <div class="rep-bar-track">
              <div class="rep-bar-fill" style="--bar-color:${bucketColor[i]}; width:${(b.count / maxBucket * 100).toFixed(1)}%"></div>
            </div>
            <div class="rep-bar-count">${b.count}</div>
          </div>
        `).join('')}
      </div>
    </div>`;

  // ─── Timeline sparkline (last 30 days) ───
  const tl = r.timeline;
  const tlMax = Math.max(1, ...tl.map(d => d.count));
  const tlTotal = tl.reduce((s, d) => s + d.count, 0);
  const tlHtml = `
    <div class="rep-card">
      <div class="rep-card-head">🕒 Activity — 30 วันหลัง <span class="sub">${tlTotal} submissions</span></div>
      <div class="rep-spark">
        ${tl.map(d => `
          <div class="rep-spark-bar ${d.count === 0 ? 'zero' : ''}"
               style="height:${d.count === 0 ? 4 : Math.max(4, d.count / tlMax * 100)}%"
               title="${d.date} — ${d.count} attempts"></div>
        `).join('')}
      </div>
      <div class="rep-spark-meta">
        <span>${fmtDateOnly(tl[0]?.date)}</span>
        <span>${fmtDateOnly(tl[tl.length-1]?.date)}</span>
      </div>
    </div>`;

  // ─── Leaderboard ───
  const lbRows = r.leaderboard.map((u, i) => {
    const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
    const statusLabel = ({passed:'PASSED', failed:'FAILED', in_progress:'IN PROGRESS', never:'NEVER'})[u.status] || u.status;
    const bestScoreCell = u.best_score === null
      ? `<span class="rep-score-pill idle">—</span>`
      : `<span class="rep-score-pill ${u.best_passed ? 'pass' : 'fail'}">${u.best_score}%</span>`;
    const latestScoreCell = u.latest_score === null
      ? `<span style="color:var(--text-muted)">—</span>`
      : `${u.latest_score}%`;
    return `
      <tr>
        <td><span class="rep-rank ${rankClass}">${i+1}</span></td>
        <td>
          <div class="rep-user">
            <div class="rep-avatar">${escHtml(repInitials(u.user_name))}</div>
            <div>
              <div class="rep-user-name">${escHtml(u.user_name)}</div>
              <div style="font-size:10.5px; color:var(--text-muted)">${u.last_attempted_at ? 'ทำล่าสุด ' + fmtDate(u.last_attempted_at) : '—'}</div>
            </div>
          </div>
        </td>
        <td class="right">${u.attempts}</td>
        <td class="right">${bestScoreCell}</td>
        <td class="right">${latestScoreCell}</td>
        <td class="right">${u.total_duration_sec > 0 ? fmtDur(u.total_duration_sec) : '—'}</td>
        <td class="right">${u.violations_total > 0 ? `<span style="color:#ef4444">${u.violations_total}</span>` : '0'}</td>
        <td class="right"><span class="rep-status-pill ${u.status}">${statusLabel}</span></td>
      </tr>`;
  }).join('');

  const lbHtml = `
    <div class="rep-section-label">
      🏆 Leaderboard
      <span class="ct">${r.leaderboard.length} คน</span>
    </div>
    <div class="rep-table-wrap">
      <table class="rep-table">
        <thead>
          <tr>
            <th style="width:50px">#</th>
            <th>ผู้สอบ</th>
            <th class="right">Attempts</th>
            <th class="right">Best</th>
            <th class="right">Latest</th>
            <th class="right">Time</th>
            <th class="right">Violations</th>
            <th class="right">Status</th>
          </tr>
        </thead>
        <tbody>${lbRows}</tbody>
      </table>
    </div>`;

  // ─── Question heatmap ───
  const qHtml = r.questions.length ? `
    <div class="rep-section-label">
      🎯 Question Analytics
      <span class="ct">เรียงข้อยากที่สุดก่อน</span>
    </div>
    <div class="rep-table-wrap">
      ${r.questions.map(q => {
        const rate = q.correct_rate;
        const color = q.asked === 0 ? '#94a3b8'
                    : rate < 40 ? '#ef4444'
                    : rate < 70 ? '#f59e0b'
                    : '#10b981';
        return `
          <div class="rep-qrow">
            <div class="rep-q-prompt">
              ${q.category ? `<span class="cat">${escHtml(q.category)}</span>` : ''}
              ${escHtml(q.prompt || '(ไม่มี prompt)')}
            </div>
            <div>
              <div class="rep-q-rate">
                <div class="rep-q-rate-fill" style="--q-color:${color}; width:${rate}%"></div>
              </div>
              <div class="rep-q-rate-label" style="--q-color:${color}; margin-top:4px">
                ${q.asked === 0 ? 'ไม่ได้สุ่ม' : rate + '%'}
              </div>
            </div>
            <div class="rep-q-asked">${q.asked > 0 ? `${q.correct}/${q.asked}` : '—'}</div>
          </div>`;
      }).join('')}
    </div>` : '';

  // ─── Not-attempted section ───
  const na = r.not_attempted || [];
  const naHtml = na.length ? `
    <div class="rep-section-label" style="margin-top:20px">
      🚫 ยังไม่ได้ทำข้อสอบ
      <span class="ct" style="background:rgba(239,68,68,.12);color:#ef4444">${na.length} คน</span>
      <button class="btn btn-primary btn-sm" style="margin-left:auto;font-size:11px" onclick="openReminderModal()">🔔 ส่ง Reminder ทั้งหมด</button>
    </div>
    <div class="rep-table-wrap" style="padding:10px">
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        ${na.map(u => `
          <div style="display:inline-flex;align-items:center;gap:8px;padding:6px 12px;background:var(--bg);border:1px solid var(--border);border-radius:20px;font-size:12px">
            <div style="width:22px;height:22px;border-radius:50%;background:var(--orange);color:#fff;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700">${escHtml((u.name || '?').charAt(0).toUpperCase())}</div>
            <span>${escHtml(u.name)}</span>
          </div>`).join('')}
      </div>
    </div>` : (r.overview.eligible_users > 0 ? `
    <div class="rep-section-label" style="margin-top:20px">
      🎉 ทุกคนทำข้อสอบครบแล้ว
      <span class="ct" style="background:rgba(16,185,129,.12);color:#10b981">${r.overview.eligible_users}/${r.overview.eligible_users}</span>
    </div>` : '');

  body.innerHTML = heroHtml + kpisHtml +
    `<div class="rep-grid-2">${distHtml}${tlHtml}</div>` +
    naHtml + lbHtml + qHtml;
}

// ─── Export CSV (leaderboard) ───
function reportExportCsv() {
  const r = _report;
  if (!r) return;
  const rows = [
    ['Rank','Name','Attempts','Best Score','Latest Score','Time (sec)','Violations','Status','Last Attempt']
  ];
  r.leaderboard.forEach((u, i) => {
    rows.push([
      i + 1,
      u.user_name,
      u.attempts,
      u.best_score ?? '',
      u.latest_score ?? '',
      u.total_duration_sec,
      u.violations_total,
      u.status,
      u.last_attempted_at || '',
    ]);
  });
  const csv = rows.map(r => r.map(cell => {
    const s = String(cell ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type:'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const safeTitle = (r.exam.title || 'exam').replace(/[^\w\-]+/g, '_');
  a.download = `report_${safeTitle}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  Toast.success('ดาวน์โหลด CSV แล้ว');
}

function reportPrint() {
  window.print();
}

async function reportCopySummary() {
  const r = _report;
  if (!r) return;
  const ov = r.overview;
  const md = [
    `# ${r.exam.title}`,
    ``,
    `📅 _${new Date().toLocaleString('th-TH', {dateStyle:'medium', timeStyle:'short'})}_`,
    ``,
    `## ภาพรวม`,
    `- ผู้สอบ: **${ov.unique_users}** คน (${ov.total_attempts} attempts)`,
    `- ผ่าน: **${ov.passed}** / ไม่ผ่าน: **${ov.failed}** — pass rate **${ov.pass_rate}%**`,
    `- คะแนนเฉลี่ย: **${ov.avg_score}%** (median ${ov.median_score}%, min ${ov.min_score}%, max ${ov.max_score}%)`,
    `- เวลาเฉลี่ยต่อ attempt: **${fmtDur(ov.avg_duration_sec)}**`,
    ov.total_violations > 0 ? `- Violations: **${ov.total_violations}**` : '',
    ``,
    `## Leaderboard`,
    `| # | ผู้สอบ | Best | Latest | Status |`,
    `|---|---|---|---|---|`,
    ...r.leaderboard.map((u, i) => `| ${i+1} | ${u.user_name} | ${u.best_score ?? '—'}% | ${u.latest_score ?? '—'}% | ${u.status} |`),
  ].filter(Boolean).join('\n');
  try {
    await navigator.clipboard.writeText(md);
    Toast.success('คัดลอกสรุป (markdown) แล้ว');
  } catch (e) {
    Toast.error('คัดลอกไม่สำเร็จ');
  }
}

window.openEdit = openEdit;
window.delExam = delExam;
window.openAttempts = openAttempts;
window.openReport = openReport;
window.reportExportCsv = reportExportCsv;
window.reportPrint = reportPrint;
window.reportCopySummary = reportCopySummary;

// ═════ Exam Reminder Modal ═════
const RemState = {
  examId:       null,
  examTitle:    '',
  target:       'not_attempted',
  notAttempted: [],
  failed:       [],
  selectedIds:  new Set(),
  defaultWebhooks: [],
  examUrl:      '',
};

// Called from 📈 Report modal — uses the already-loaded _report object
async function openReminderModal() {
  if (!_report) { Toast.warning('ต้องเปิดหน้า Report ของข้อสอบก่อน'); return; }
  return _openReminderModalWith({
    examId:    _report.exam.id,
    examTitle: _report.exam.title,
    examIcon:  _report.exam.icon || '📝',
  });
}

// Called from 📊 ผลสอบ modal — uses the state captured in openAttempts()
async function openReminderModalFromAttempts() {
  if (!_attemptsExamId) { Toast.warning('ยังไม่ได้เปิดหน้าผลสอบ'); return; }
  return _openReminderModalWith({
    examId:    _attemptsExamId,
    examTitle: _attemptsExamTitle,
    examIcon:  '📝',
  });
}

async function _openReminderModalWith({examId, examTitle, examIcon}) {
  RemState.examId       = examId;
  RemState.examTitle    = examTitle;
  RemState.notAttempted = [];
  RemState.failed       = [];
  RemState.target       = 'not_attempted';
  RemState.selectedIds  = new Set();

  document.getElementById('rem-exam-title').textContent = `${examIcon} ${examTitle}`;
  document.getElementById('rem-not-count').textContent    = 0;
  document.getElementById('rem-failed-count').textContent = 0;
  document.getElementById('rem-message').value  = '';
  document.getElementById('rem-deadline').value = '';
  document.getElementById('rem-webhooks').value = '';
  document.getElementById('rem-result').innerHTML = '';

  // Single round-trip fetches both candidate lists + webhooks + exam URL.
  await refreshReminderPreview();
  switchReminderTab('not_attempted');
  Modal.open('rem-modal');
}
function closeReminderModal() { Modal.close('rem-modal'); }

function switchReminderTab(tab) {
  RemState.target = tab;
  const setBtn = (id, active) => {
    const el = document.getElementById(id);
    el.classList.toggle('btn-primary', active);
    el.classList.toggle('btn-ghost',   !active);
  };
  setBtn('rem-tab-not',    tab === 'not_attempted');
  setBtn('rem-tab-failed', tab === 'failed');
  setBtn('rem-tab-custom', tab === 'custom');

  // Reset the checkbox selection when entering custom mode so admins start
  // from a clean slate (previously we'd carry over the not_attempted set
  // and quietly pre-check everyone).
  if (tab === 'custom') RemState.selectedIds = new Set();

  renderReminderTargetList();
  renderReminderPreview();
}

function renderReminderTargetList() {
  const el = document.getElementById('rem-target-list');
  if (RemState.target === 'not_attempted' || RemState.target === 'failed') {
    const list = RemState.target === 'failed' ? RemState.failed : RemState.notAttempted;
    if (!list.length) {
      const empty = RemState.target === 'failed'
        ? '🎉 ไม่มีคนที่สอบไม่ผ่าน'
        : '🎉 ทุกคนทำข้อสอบครบแล้ว';
      el.innerHTML = `<div style="text-align:center;color:var(--text-muted);padding:20px">${empty}</div>`;
      return;
    }
    el.innerHTML = list.map(u =>
      `<div style="padding:4px 8px;color:var(--text)">• ${escHtml(u.name)}</div>`
    ).join('');
    // In fixed-target mode, all are selected implicitly
    RemState.selectedIds = new Set(list.map(u => u.user_id));
  } else {
    // Custom mode: pick from union of both "needs reminder" buckets.
    // Sending to already-passed users doesn't make sense so they're not shown.
    const seen = new Set();
    const candidates = [];
    [...RemState.notAttempted, ...RemState.failed].forEach(u => {
      if (seen.has(u.user_id)) return;
      seen.add(u.user_id);
      candidates.push(u);
    });
    if (!candidates.length) {
      el.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px">ไม่มี user ที่ต้องเตือน</div>';
      return;
    }
    el.innerHTML = candidates.map(u => {
      const checked = RemState.selectedIds.has(u.user_id) ? 'checked' : '';
      const badge = RemState.failed.some(f => f.user_id === u.user_id)
        ? '<span style="font-size:10px;color:#ef4444;margin-left:4px">❌ ไม่ผ่าน</span>'
        : '<span style="font-size:10px;color:var(--text-muted);margin-left:4px">🚫 ยังไม่ได้ทำ</span>';
      return `<label style="display:flex;align-items:center;gap:8px;padding:4px 8px;cursor:pointer">
        <input type="checkbox" data-uid="${escHtml(u.user_id)}" ${checked} style="accent-color:var(--orange)">
        <span>${escHtml(u.name)}</span>${badge}
      </label>`;
    }).join('');
    el.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.addEventListener('change', e => {
        const uid = e.target.dataset.uid;
        if (e.target.checked) RemState.selectedIds.add(uid);
        else                  RemState.selectedIds.delete(uid);
        renderReminderPreview();
      });
    });
  }
}

async function refreshReminderPreview() {
  const p = new URLSearchParams({
    exam_id: RemState.examId,
    action:  'preview',
    target:  'not_attempted',
    extra_message: document.getElementById('rem-message').value.trim(),
    deadline:      document.getElementById('rem-deadline').value.trim(),
  });
  const res = await API.get(`/exams/reminder.php?${p.toString()}`);
  const d = res?.data?.data || {};
  RemState.defaultWebhooks = d.default_webhooks || [];
  RemState.notAttempted    = d.not_attempted_list || [];
  RemState.failed          = d.failed_list        || [];
  RemState.examUrl         = d.exam_url || '';
  document.getElementById('rem-not-count').textContent    = RemState.notAttempted.length;
  document.getElementById('rem-failed-count').textContent = RemState.failed.length;
  updateReminderWebhookHint();
  renderReminderPreview(d.card);
}

function updateReminderWebhookHint() {
  const n = RemState.defaultWebhooks.length;
  document.getElementById('rem-webhook-hint').innerHTML = n > 0
    ? `พบ default ใน System Settings แล้ว <strong>${n}</strong> URL — จะใช้ค่านั้นถ้าเว้นว่าง`
    : `⚠️ ยังไม่มี default — กรุณากรอกที่นี่ หรือตั้งที่ <a href="./system-settings.html" style="color:var(--orange)">System Settings</a>`;
}

// Renders the preview card. Called client-side each time inputs change —
// uses the last card returned by refreshReminderPreview() and just swaps
// names/message/deadline inline (no round-trip needed for those).
function renderReminderPreview(cardFromServer) {
  const el = document.getElementById('rem-preview');
  const src = RemState.target === 'failed'
    ? RemState.failed
    : RemState.target === 'custom'
      ? [...RemState.notAttempted, ...RemState.failed].filter(u => RemState.selectedIds.has(u.user_id))
      : RemState.notAttempted;
  // De-dupe (custom source unions both lists so a user could appear twice)
  const seen = new Set();
  const names = [];
  src.forEach(u => { if (!seen.has(u.user_id)) { seen.add(u.user_id); names.push(u.name); } });
  const msg      = document.getElementById('rem-message').value.trim();
  const deadline = document.getElementById('rem-deadline').value.trim();
  const passScore = _report?.exam?.pass_score ?? _attemptsExamPassScore ?? 70;

  const targetLabel = RemState.target === 'failed'
    ? '❌ ทำแล้วแต่ยังไม่ผ่าน'
    : RemState.target === 'custom'
      ? '✏️ ผู้รับที่เลือกเอง'
      : '🚫 ยังไม่ได้ทำข้อสอบ';
  const emptyLabel = RemState.target === 'failed'
    ? '<i>ไม่มีคนที่สอบไม่ผ่าน 🎉</i>'
    : RemState.target === 'custom'
      ? '<i>ยังไม่ได้เลือกใคร</i>'
      : '<i>ทุกคนทำข้อสอบครบแล้ว 🎉</i>';

  const shown = names.slice(0, 15);
  const overflow = names.length - shown.length;
  const nameList = shown.length
    ? shown.map(n => `• ${escHtml(n)}`).join('<br>') + (overflow > 0 ? `<br><span style="color:#94a3b8">…และอีก ${overflow} คน</span>` : '')
    : emptyLabel;

  const chipParts = [`<b>PASS SCORE</b> · <span style="color:#F26419">${passScore}%</span>`];
  if (deadline) chipParts.push(`<b>Deadline</b> · <span style="color:#F26419">${escHtml(deadline)}</span>`);

  const urlBlock = RemState.examUrl ? `
    <div style="margin-bottom:10px">
      <div style="font-size:10px;color:#64748b;letter-spacing:.05em;margin-bottom:2px">🔗 EXAM LINK</div>
      <a href="${escHtml(RemState.examUrl)}" target="_blank" style="color:#1d4ed8;word-break:break-all;font-size:12px">${escHtml(RemState.examUrl)}</a>
    </div>` : '';

  el.innerHTML = `
    <div style="border-bottom:1px solid #e2e8f0;padding-bottom:10px;margin-bottom:10px;display:flex;align-items:center;gap:10px">
      <div style="width:32px;height:32px;border-radius:50%;background:#F26419;color:#fff;display:flex;align-items:center;justify-content:center;font-size:16px">🔔</div>
      <div>
        <div style="font-weight:700;font-size:14px">🔔 Exam Reminder</div>
        <div style="font-size:11px;color:#64748b">SOM-Portal · Reminder</div>
      </div>
    </div>
    <div style="margin-bottom:10px">
      <div style="font-size:10px;color:#64748b;letter-spacing:.05em;margin-bottom:2px">📑 PENDING EXAM</div>
      <div style="font-weight:700">${escHtml(RemState.examTitle)}</div>
    </div>
    <div style="margin-bottom:10px;padding:8px 10px;background:#f1f5f9;border-radius:6px;font-size:12px">
      ${chipParts.join('&nbsp;&nbsp;·&nbsp;&nbsp;')}
    </div>
    ${urlBlock}
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:12px 0">
    <div style="margin-bottom:10px">
      <div style="font-size:10px;color:#64748b;letter-spacing:.05em;margin-bottom:4px">👤 ${escHtml(targetLabel)} (${names.length} คน)</div>
      <div style="line-height:1.7">${nameList}</div>
    </div>
    ${msg ? `<hr style="border:none;border-top:1px solid #e2e8f0;margin:12px 0">
      <div>
        <div style="font-size:10px;color:#64748b;letter-spacing:.05em;margin-bottom:4px">📝 ADMIN MESSAGE</div>
        <div style="line-height:1.6">${escHtml(msg).replace(/\n/g,'<br>')}</div>
      </div>` : ''}
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:12px 0">
    <div style="font-size:11px;color:#94a3b8">🕐 SOM-Portal · ${new Date().toLocaleDateString('th-TH')} · Reminder</div>
  `;
}

async function sendReminder() {
  let names;
  if (RemState.target === 'failed') {
    names = RemState.failed;
  } else if (RemState.target === 'custom') {
    // Selection may reference either bucket — pick from the union
    const pool = [...RemState.notAttempted, ...RemState.failed];
    const seen = new Set();
    names = pool.filter(u => {
      if (seen.has(u.user_id) || !RemState.selectedIds.has(u.user_id)) return false;
      seen.add(u.user_id);
      return true;
    });
  } else {
    names = RemState.notAttempted;
  }
  if (!names.length) { Toast.warning('ไม่มีผู้รับ reminder'); return; }

  const btn  = document.getElementById('rem-send-btn');
  const text = document.getElementById('rem-send-text');
  btn.disabled = true; text.textContent = '⏳ กำลังส่ง...';

  const webhookRaw = document.getElementById('rem-webhooks').value.trim();
  const webhooks = webhookRaw ? webhookRaw.split(/\r?\n/).map(x=>x.trim()).filter(Boolean) : [];

  const res = await API.post('/exams/reminder.php?action=send', {
    exam_id:       RemState.examId,
    target:        RemState.target,
    user_ids:      RemState.target === 'custom' ? [...RemState.selectedIds] : [],
    extra_message: document.getElementById('rem-message').value.trim(),
    deadline:      document.getElementById('rem-deadline').value.trim(),
    chat_webhook_urls: webhooks,
  });

  btn.disabled = false; text.textContent = '📤 ส่ง Reminder';
  const box = document.getElementById('rem-result');
  if (res?.ok) {
    const d = res.data?.data || {};
    box.innerHTML = `<span style="color:#10b981">✓ ยิงสำเร็จ ${d.sent}/${d.webhook_count} webhook — ${d.resolved_names?.length || 0} ชื่อ</span>`;
    Toast.success(res.data?.message || 'ส่ง reminder สำเร็จ');
    setTimeout(closeReminderModal, 1500);
  } else {
    box.innerHTML = `<span style="color:#ef4444">✗ ${escHtml(res?.data?.message || 'ส่งไม่สำเร็จ')}</span>`;
    Toast.error(res?.data?.message || 'ส่ง reminder ไม่สำเร็จ');
  }
}

// Live message/deadline refresh: they only affect the client-side preview
// (server preview is not called again on every keystroke — only the initial fetch)
document.addEventListener('input', e => {
  if (e.target && (e.target.id === 'rem-message' || e.target.id === 'rem-deadline')) {
    renderReminderPreview();
  }
});

window.openReminderModal             = openReminderModal;
window.openReminderModalFromAttempts = openReminderModalFromAttempts;
window.closeReminderModal            = closeReminderModal;
window.switchReminderTab             = switchReminderTab;
window.renderReminderPreview         = renderReminderPreview;
window.sendReminder                  = sendReminder;
window.resetAttempt = resetAttempt;
window.resetAllAttempts = resetAllAttempts;
window.filterAttempts = filterAttempts;
window.toggleTimeline = toggleTimeline;
window.openTimelineModal = openTimelineModal;
window.closeTimelineModal = closeTimelineModal;
window.renderTabDetectionPreview = renderTabDetectionPreview;
window.uploadQImage = uploadQImage;
window.removeQImage = removeQImage;
window.setQ = setQ;
window.setQChoice = setQChoice;
window.addQChoice = addQChoice;
window.rmQChoice = rmQChoice;
window.setQAnswer = setQAnswer;
window.setQShortAns = setQShortAns;
window.rmQuestion = rmQuestion;
window.rmStrat = rmStrat;
window.changeQType = changeQType;

load();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "_openReminderModalWith", { configurable: true, get: () => _openReminderModalWith, set: (v) => { _openReminderModalWith = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeReminderModal", { configurable: true, get: () => closeReminderModal, set: (v) => { closeReminderModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openReminderModal", { configurable: true, get: () => openReminderModal, set: (v) => { openReminderModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openReminderModalFromAttempts", { configurable: true, get: () => openReminderModalFromAttempts, set: (v) => { openReminderModalFromAttempts = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "refreshReminderPreview", { configurable: true, get: () => refreshReminderPreview, set: (v) => { refreshReminderPreview = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderReminderPreview", { configurable: true, get: () => renderReminderPreview, set: (v) => { renderReminderPreview = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderReminderTargetList", { configurable: true, get: () => renderReminderTargetList, set: (v) => { renderReminderTargetList = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "reportCopySummary", { configurable: true, get: () => reportCopySummary, set: (v) => { reportCopySummary = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "reportPrint", { configurable: true, get: () => reportPrint, set: (v) => { reportPrint = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "sendReminder", { configurable: true, get: () => sendReminder, set: (v) => { sendReminder = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "switchReminderTab", { configurable: true, get: () => switchReminderTab, set: (v) => { switchReminderTab = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updateReminderWebhookHint", { configurable: true, get: () => updateReminderWebhookHint, set: (v) => { updateReminderWebhookHint = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_tlEventClass", { configurable: true, get: () => _tlEventClass, set: (v) => { _tlEventClass = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_tlFmtData", { configurable: true, get: () => _tlFmtData, set: (v) => { _tlFmtData = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_tlRenderEventList", { configurable: true, get: () => _tlRenderEventList, set: (v) => { _tlRenderEventList = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "addQChoice", { configurable: true, get: () => addQChoice, set: (v) => { addQChoice = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "addQuestion", { configurable: true, get: () => addQuestion, set: (v) => { addQuestion = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "applyConfigToUI", { configurable: true, get: () => applyConfigToUI, set: (v) => { applyConfigToUI = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "applyPreset", { configurable: true, get: () => applyPreset, set: (v) => { applyPreset = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "applySharedToggleUI", { configurable: true, get: () => applySharedToggleUI, set: (v) => { applySharedToggleUI = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "attemptCardHtml", { configurable: true, get: () => attemptCardHtml, set: (v) => { attemptCardHtml = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "changeQType", { configurable: true, get: () => changeQType, set: (v) => { changeQType = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeTimelineModal", { configurable: true, get: () => closeTimelineModal, set: (v) => { closeTimelineModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "delExam", { configurable: true, get: () => delExam, set: (v) => { delExam = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "duration", { configurable: true, get: () => duration, set: (v) => { duration = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "ensureCoursesLoaded", { configurable: true, get: () => ensureCoursesLoaded, set: (v) => { ensureCoursesLoaded = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "filterAttempts", { configurable: true, get: () => filterAttempts, set: (v) => { filterAttempts = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtDate", { configurable: true, get: () => fmtDate, set: (v) => { fmtDate = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtDateOnly", { configurable: true, get: () => fmtDateOnly, set: (v) => { fmtDateOnly = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtDateTime", { configurable: true, get: () => fmtDateTime, set: (v) => { fmtDateTime = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtDur", { configurable: true, get: () => fmtDur, set: (v) => { fmtDur = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "getCfgPath", { configurable: true, get: () => getCfgPath, set: (v) => { getCfgPath = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "initials", { configurable: true, get: () => initials, set: (v) => { initials = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "isChoiceCorrect", { configurable: true, get: () => isChoiceCorrect, set: (v) => { isChoiceCorrect = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "load", { configurable: true, get: () => load, set: (v) => { load = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "newExam", { configurable: true, get: () => newExam, set: (v) => { newExam = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openAttempts", { configurable: true, get: () => openAttempts, set: (v) => { openAttempts = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openEdit", { configurable: true, get: () => openEdit, set: (v) => { openEdit = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openReport", { configurable: true, get: () => openReport, set: (v) => { openReport = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openTimelineModal", { configurable: true, get: () => openTimelineModal, set: (v) => { openTimelineModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "qbCardHtml", { configurable: true, get: () => qbCardHtml, set: (v) => { qbCardHtml = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "readUIToConfig", { configurable: true, get: () => readUIToConfig, set: (v) => { readUIToConfig = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "removeQImage", { configurable: true, get: () => removeQImage, set: (v) => { removeQImage = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderAttempts", { configurable: true, get: () => renderAttempts, set: (v) => { renderAttempts = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderCoursePrereqPicker", { configurable: true, get: () => renderCoursePrereqPicker, set: (v) => { renderCoursePrereqPicker = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderGrid", { configurable: true, get: () => renderGrid, set: (v) => { renderGrid = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderQuestions", { configurable: true, get: () => renderQuestions, set: (v) => { renderQuestions = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderReport", { configurable: true, get: () => renderReport, set: (v) => { renderReport = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderStats", { configurable: true, get: () => renderStats, set: (v) => { renderStats = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderStratList", { configurable: true, get: () => renderStratList, set: (v) => { renderStratList = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderTabDetectionPreview", { configurable: true, get: () => renderTabDetectionPreview, set: (v) => { renderTabDetectionPreview = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "repInitials", { configurable: true, get: () => repInitials, set: (v) => { repInitials = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "reportExportCsv", { configurable: true, get: () => reportExportCsv, set: (v) => { reportExportCsv = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "resetAllAttempts", { configurable: true, get: () => resetAllAttempts, set: (v) => { resetAllAttempts = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "resetAttempt", { configurable: true, get: () => resetAttempt, set: (v) => { resetAttempt = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "resolveAssetUrl", { configurable: true, get: () => resolveAssetUrl, set: (v) => { resolveAssetUrl = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "rmQChoice", { configurable: true, get: () => rmQChoice, set: (v) => { rmQChoice = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "rmQuestion", { configurable: true, get: () => rmQuestion, set: (v) => { rmQuestion = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "rmStrat", { configurable: true, get: () => rmStrat, set: (v) => { rmStrat = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setCfgPath", { configurable: true, get: () => setCfgPath, set: (v) => { setCfgPath = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setPresetActive", { configurable: true, get: () => setPresetActive, set: (v) => { setPresetActive = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setQ", { configurable: true, get: () => setQ, set: (v) => { setQ = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setQAnswer", { configurable: true, get: () => setQAnswer, set: (v) => { setQAnswer = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setQChoice", { configurable: true, get: () => setQChoice, set: (v) => { setQChoice = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setQShortAns", { configurable: true, get: () => setQShortAns, set: (v) => { setQShortAns = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "switchPane", { configurable: true, get: () => switchPane, set: (v) => { switchPane = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toggleCoursePrereq", { configurable: true, get: () => toggleCoursePrereq, set: (v) => { toggleCoursePrereq = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toggleTimeline", { configurable: true, get: () => toggleTimeline, set: (v) => { toggleTimeline = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "uploadQImage", { configurable: true, get: () => uploadQImage, set: (v) => { uploadQImage = v; } }); } catch (e) {}
})();
