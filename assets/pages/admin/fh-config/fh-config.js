// admin/fh-config — page script, extracted from admin/fh-config.html.
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
Layout.render('fh-config');

const PROJECTS = ['tmn', 'nano', 'welth', 'all'];

/* per-project tag state */
const tags = {
  tmn:   { to: [], cc: [] },
  nano:  { to: [], cc: [] },
  welth: { to: [], cc: [] },
  all:   { to: [], cc: [] },
};

let activeProj = 'tmn';

function switchProj(proj) {
  activeProj = proj;
  PROJECTS.forEach(p => {
    document.getElementById(`pill-${p}`).classList.toggle('active', p === proj);
    document.getElementById(`panel-${p}`).style.display = p === proj ? '' : 'none';
  });
}

/* ── Email tag helpers ── */
function focusTagInput(id) {
  document.getElementById(id)?.focus();
}

function renderTags(proj, field) {
  const arr  = tags[proj][field];
  const wrap = document.getElementById(`${field}-wrap-${proj}`);
  wrap.innerHTML = '';

  arr.forEach((email, idx) => {
    const tag = document.createElement('span');
    tag.className = 'email-tag';
    tag.innerHTML = `${escHtml(email)}<button type="button" onclick="removeTag('${proj}','${field}',${idx})">×</button>`;
    wrap.appendChild(tag);
  });

  const input = document.createElement('input');
  input.className   = 'email-tag-input';
  input.id          = `${field}-input-${proj}`;
  input.placeholder = arr.length ? '' : 'email@example.com แล้วกด Enter หรือ Space';
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      e.preventDefault();
      addTag(proj, field, input.value.trim());
    }
    if (e.key === 'Backspace' && !input.value && arr.length) {
      removeTag(proj, field, arr.length - 1);
    }
  });
  input.addEventListener('blur', () => {
    if (input.value.trim()) addTag(proj, field, input.value.trim());
  });
  wrap.appendChild(input);
}

function addTag(proj, field, email) {
  const clean = email.replace(/,$/, '').trim();
  if (!clean) return;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
    Toast.show(`"${clean}" ไม่ใช่ email ที่ถูกต้อง`, 'error'); return;
  }
  if (!tags[proj][field].includes(clean)) tags[proj][field].push(clean);
  renderTags(proj, field);
}

function removeTag(proj, field, idx) {
  tags[proj][field].splice(idx, 1);
  renderTags(proj, field);
  document.getElementById(`${field}-input-${proj}`)?.focus();
}

/* ── Load ── */
async function loadConfig() {
  const res = await API.fhEmailConfig.get();
  if (!res?.ok) { Toast.show('โหลด config ไม่สำเร็จ', 'error'); return; }
  const cfg = res.data.data || {};
  PROJECTS.forEach(proj => {
    const p = cfg[proj] || {};
    tags[proj].to = [...(p.to || [])];
    tags[proj].cc = [...(p.cc || [])];
    renderTags(proj, 'to');
    renderTags(proj, 'cc');
    document.getElementById(`dear-${proj}`).value    = p.dear    || '';
    document.getElementById(`subject-${proj}`).value = p.subject || '';
  });
}

/* ── Save ── */
async function saveConfig() {
  const btn = document.getElementById('save-btn');
  btn.disabled = true; btn.textContent = 'กำลังบันทึก...';

  /* flush any un-committed text in active input fields */
  PROJECTS.forEach(proj => {
    ['to', 'cc'].forEach(field => {
      const inp = document.getElementById(`${field}-input-${proj}`);
      if (inp?.value.trim()) addTag(proj, field, inp.value.trim());
    });
  });

  const body = {};
  PROJECTS.forEach(proj => {
    body[proj] = {
      to:      [...tags[proj].to],
      cc:      [...tags[proj].cc],
      dear:    document.getElementById(`dear-${proj}`).value.trim(),
      subject: document.getElementById(`subject-${proj}`).value.trim(),
    };
  });

  const res = await API.fhEmailConfig.save(body);
  btn.disabled = false; btn.textContent = 'บันทึก';

  if (!res?.ok) { Toast.show(res?.data?.message || 'บันทึกไม่สำเร็จ', 'error'); return; }
  Toast.show('บันทึก Email Config สำเร็จ', 'success');

  const badge = document.getElementById('saved-badge');
  badge.classList.add('show');
  setTimeout(() => badge.classList.remove('show'), 2500);
}

/* ── Init ── */
loadConfig();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "addTag", { configurable: true, get: () => addTag, set: (v) => { addTag = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "focusTagInput", { configurable: true, get: () => focusTagInput, set: (v) => { focusTagInput = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadConfig", { configurable: true, get: () => loadConfig, set: (v) => { loadConfig = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "removeTag", { configurable: true, get: () => removeTag, set: (v) => { removeTag = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderTags", { configurable: true, get: () => renderTags, set: (v) => { renderTags = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "saveConfig", { configurable: true, get: () => saveConfig, set: (v) => { saveConfig = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "switchProj", { configurable: true, get: () => switchProj, set: (v) => { switchProj = v; } }); } catch (e) {}
})();
