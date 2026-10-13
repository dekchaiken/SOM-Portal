// admin/super-email-templates — page script, extracted from admin/super-email-templates.html.
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

if (!Auth.requireAdmin()) {}
if (Auth.getUser()?.role !== 'super_admin') window.location.href = './index.html';
Layout.render('super-email-templates');
Auth.initUserUI();

const TEMPLATE_META = [
  {
    key: 'welcome',
    title: 'Welcome — สร้าง user ใหม่',
    sub: 'ส่งอัตโนมัติหลังจาก admin กด Create User (แนบ temp password)',
    placeholders: ['{name}', '{app_name}'],
  },
  {
    key: 'reset_password_admin',
    title: 'Admin Reset Password',
    sub: 'ส่งเมื่อ admin กด Reset Password ให้ user จากหน้า Users',
    placeholders: ['{name}', '{app_name}'],
  },
  {
    key: 'reset_password_forgot',
    title: 'User Forgot Password',
    sub: 'ส่งเมื่อ user กด "ลืมรหัสผ่าน" จากหน้า Login',
    placeholders: ['{name}', '{app_name}'],
  },
];

const PLACEHOLDER_DESC = {
  '{name}':     'ชื่อผู้รับ',
  '{app_name}': 'ชื่อระบบของทีม',
};

let currentTeam = '';
let currentData = null; // {templates, defaults, placeholders}

async function loadTeams() {
  const res = await API.teams.list();
  if (!res?.ok) { Toast.error('โหลดรายการทีมไม่สำเร็จ'); return; }
  const teams = (res.data?.data || res.data || []).filter(t => t.active !== false);
  const sel = document.getElementById('team-select');
  teams.forEach(t => {
    const o = document.createElement('option');
    o.value = t.slug;
    o.textContent = `${t.name} (${t.slug})`;
    sel.appendChild(o);
  });
  // Pre-select from view-as context or ?team= URL param
  const urlTeam = new URLSearchParams(window.location.search).get('team');
  const preset  = urlTeam || API.getAdminTeam() || '';
  if (preset && teams.some(t => t.slug === preset)) {
    sel.value = preset;
    onTeamChange();
  }
}

async function onTeamChange() {
  currentTeam = document.getElementById('team-select').value;
  const mount = document.getElementById('editor-mount');
  if (!currentTeam) {
    mount.innerHTML = '';
    document.getElementById('team-hint').textContent = 'เลือกทีมเพื่อโหลด/แก้ template';
    return;
  }
  document.getElementById('team-hint').textContent = `กำลังโหลดของทีม "${currentTeam}"…`;

  // Set X-Admin-Team so backend reads/writes the right team's file
  API.setAdminTeam(currentTeam);
  const res = await API.emailTemplates.get();
  if (!res?.ok) {
    Toast.error(res?.data?.message || 'โหลด templates ไม่สำเร็จ');
    mount.innerHTML = '';
    return;
  }
  currentData = res.data.data;
  renderEditor();
  document.getElementById('team-hint').textContent = `แก้ template ของทีม "${currentTeam}"`;
}

function renderEditor() {
  const mount = document.getElementById('editor-mount');
  const t = currentData.templates;
  mount.innerHTML = TEMPLATE_META.map(meta => {
    const cur = t[meta.key] || { subject: '', intro: '', is_default: true };
    const badge = cur.is_default
      ? '<span class="et-card-badge is-default">Default</span>'
      : '<span class="et-card-badge">Custom</span>';
    const chips = meta.placeholders.map(p =>
      `<span class="et-chip" data-insert="${escHtml(p)}" data-key="${escHtml(meta.key)}">
         <code>${escHtml(p)}</code>
         <span class="et-chip-desc">${escHtml(PLACEHOLDER_DESC[p] || '')}</span>
       </span>`
    ).join('');
    return `
      <div class="et-card" data-tpl="${escHtml(meta.key)}">
        <div class="et-card-head">
          <div>
            <div class="et-card-title">${escHtml(meta.title)}</div>
            <div class="et-card-sub">${escHtml(meta.sub)}</div>
          </div>
          ${badge}
        </div>
        <div class="et-field">
          <label class="et-field-label">Subject</label>
          <input type="text" class="et-input" data-field="subject" value="${escHtml(cur.subject)}">
        </div>
        <div class="et-field">
          <label class="et-field-label">Intro (HTML ได้: &lt;strong&gt;, &lt;br&gt;)</label>
          <textarea class="et-textarea" data-field="intro" rows="3">${escHtml(cur.intro)}</textarea>
        </div>
        <div class="et-placeholder-row">${chips}</div>
        <div class="et-card-actions">
          <button class="btn btn-ghost btn-sm" data-action="reset">↺ Reset to default</button>
        </div>
      </div>`;
  }).join('') + `
    <div class="et-save-bar">
      <div style="font-size:11.5px;color:var(--text-muted)">
        แก้แล้วอย่าลืมกด Save — เปลี่ยนทีมโดยไม่ save จะเสียการแก้ไข
      </div>
      <button class="btn btn-primary btn-sm" onclick="saveAll()">
        <i data-icon="save"></i> Save All Templates
      </button>
    </div>
  `;

  // Wire chip inserts + reset buttons
  mount.querySelectorAll('.et-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const key    = chip.dataset.key;
      const insert = chip.dataset.insert;
      const card   = mount.querySelector(`.et-card[data-tpl="${key}"]`);
      // Insert into whichever field was last focused; fallback to subject
      const target = card.querySelector('[data-field]:focus') || card.querySelector('[data-field="subject"]');
      const s = target.selectionStart ?? target.value.length;
      const e = target.selectionEnd   ?? target.value.length;
      target.value = target.value.slice(0, s) + insert + target.value.slice(e);
      target.focus();
      target.setSelectionRange(s + insert.length, s + insert.length);
    });
  });
  mount.querySelectorAll('[data-action="reset"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.et-card');
      const key  = card.dataset.tpl;
      const def  = currentData.defaults[key] || {subject:'', intro:''};
      card.querySelector('[data-field="subject"]').value = def.subject;
      card.querySelector('[data-field="intro"]').value   = def.intro;
      Toast.info('Reset — กด Save เพื่อบันทึก');
    });
  });
}

async function saveAll() {
  if (!currentTeam) { Toast.warning('เลือกทีมก่อน'); return; }
  const payload = {};
  document.querySelectorAll('.et-card').forEach(card => {
    payload[card.dataset.tpl] = {
      subject: card.querySelector('[data-field="subject"]').value.trim(),
      intro:   card.querySelector('[data-field="intro"]').value.trim(),
    };
  });
  const res = await API.emailTemplates.save(payload);
  if (res?.ok) {
    Toast.success(`บันทึก template ของทีม "${currentTeam}" แล้ว`);
    onTeamChange(); // reload to refresh Default/Custom badges
  } else {
    Toast.error(res?.data?.message || 'บันทึกไม่สำเร็จ');
  }
}

document.getElementById('team-select').addEventListener('change', onTeamChange);
loadTeams();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "loadTeams", { configurable: true, get: () => loadTeams, set: (v) => { loadTeams = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "onTeamChange", { configurable: true, get: () => onTeamChange, set: (v) => { onTeamChange = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderEditor", { configurable: true, get: () => renderEditor, set: (v) => { renderEditor = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "saveAll", { configurable: true, get: () => saveAll, set: (v) => { saveAll = v; } }); } catch (e) {}
})();
