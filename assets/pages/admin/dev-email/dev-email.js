// admin/dev-email — page script, extracted from admin/dev-email.html.
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

if (!Auth.requireAuth()) { /* redirected */ }
const _u = Auth.getUser?.();
if (_u && _u.role !== 'dev_sm') window.location.replace('./index.html');
Layout.render('dev-email');

// ── Load SMTP config preview ───────────────────────────
async function loadSmtpConfig() {
  try {
    const res = await API.get('/mail-config/index.php');
    if (!res?.ok) return;
    const d = res.data.data || {};
    document.getElementById('si-host').textContent = d.smtp_host || '(not set)';
    document.getElementById('si-port').textContent = d.smtp_port || '—';
    document.getElementById('si-enc').textContent  = d.smtp_encryption || '—';
    document.getElementById('si-user').textContent = d.smtp_username || '—';
    document.getElementById('si-from').textContent = d.from_name ? `${d.from_name} <${d.from_email || ''}>` : '—';
  } catch {}
}

// ── SMTP Test ──────────────────────────────────────────
async function testSmtp() {
  const btn = document.getElementById('btn-smtp');
  const out = document.getElementById('smtp-result');
  btn.disabled = true; btn.textContent = '⏳ Testing…';
  out.innerHTML = '<span style="color:var(--text-muted)">กำลังเชื่อมต่อ SMTP…</span>';

  const res = await API.mail.testConnection();
  btn.disabled = false; btn.innerHTML = '<i data-icon="search"></i> Test Connection';

  if (!res?.ok) {
    out.innerHTML = `<div class="d-output err">Error: ${escHtml(res?.data?.message || 'unknown')}</div>`;
    return;
  }

  const steps   = res.data.data?.steps || [];
  const overall = res.data.data?.ok;
  const summary = overall
    ? `<div class="d-step-summary ok"><i data-icon="check"></i> All ${steps.length} steps passed — SMTP พร้อมใช้งาน</div>`
    : `<div class="d-step-summary err"><i data-icon="x"></i> Failed at step ${steps.findIndex(s => !s.ok) + 1} of ${steps.length}</div>`;

  const list = document.createElement('div');
  list.className = 'd-steps';
  steps.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'd-step ' + (s.ok ? 'ok' : 'err');
    row.innerHTML = `
      <span class="d-step-num">${i + 1}</span>
      <span class="d-step-tx"><span class="name"></span><span class="detail"></span></span>
      <span class="d-step-badge">${s.ok ? 'OK' : 'FAIL'}</span>`;
    row.querySelector('.name').textContent   = s.label  || '';
    row.querySelector('.detail').textContent = s.detail || '';
    list.appendChild(row);
  });
  out.innerHTML = summary;
  out.appendChild(list);
}

// ── Service subtypes ───────────────────────────────────
let _serviceTypes = [];
async function loadServiceSubtypes() {
  const r = await API.serviceTypes.list();
  if (!r?.ok) return;
  _serviceTypes = r.data.data || [];
  const sel = document.getElementById('mail-subtype');
  _serviceTypes.forEach(t => {
    (t.subtypes || []).forEach(st => {
      const o = document.createElement('option');
      o.value = st.id;
      o.textContent = `${t.name} → ${st.name}` + (st.emails?.length ? ` (${st.emails.length} CC)` : '');
      sel.appendChild(o);
    });
  });
}
document.getElementById('mail-subtype').addEventListener('change', e => {
  const id = e.target.value;
  if (!id) { document.getElementById('mail-cc').value = ''; return; }
  for (const t of _serviceTypes) {
    const st = (t.subtypes || []).find(s => s.id === id);
    if (st) { document.getElementById('mail-cc').value = (st.emails || []).join(', '); return; }
  }
});

// ── Rich editor ────────────────────────────────────────
const _editor = document.getElementById('mail-body');
document.querySelectorAll('.d-editor-btn[data-cmd]').forEach(btn => {
  btn.addEventListener('click', e => { e.preventDefault(); document.execCommand(btn.dataset.cmd, false, null); _editor.focus(); });
});
document.getElementById('mail-img-btn').addEventListener('click', () => document.getElementById('mail-img-input').click());
document.getElementById('mail-img-input').addEventListener('change', e => {
  const file = e.target.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = ev => { document.execCommand('insertHTML', false, `<img src="${ev.target.result}" style="max-width:100%;border-radius:4px;margin:6px 0">`); _editor.focus(); };
  r.readAsDataURL(file); e.target.value = '';
});
_editor.addEventListener('paste', e => {
  const items = e.clipboardData?.items || [];
  for (const item of items) {
    if (item.type?.startsWith('image/')) {
      e.preventDefault();
      const file = item.getAsFile(); if (!file) continue;
      const r = new FileReader();
      r.onload = ev => { document.execCommand('insertHTML', false, `<img src="${ev.target.result}" style="max-width:100%;border-radius:4px;margin:6px 0">`); };
      r.readAsDataURL(file); return;
    }
  }
});
document.addEventListener('DOMContentLoaded', () => { try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch {} });
setupImageResize(_editor);

// ── Send email ─────────────────────────────────────────
async function sendMockEmail() {
  const issue   = document.getElementById('mail-issue').value.trim()   || 'DEV-TEST-001';
  const summary = document.getElementById('mail-summary').value.trim() || 'Test';
  const toRaw   = document.getElementById('mail-to').value.trim();
  const ccRaw   = document.getElementById('mail-cc').value.trim();
  const body    = _editor.innerHTML.trim();
  const branded = document.getElementById('mail-branded').checked;

  if (!toRaw) { Toast.warning('กรอก To อย่างน้อย 1 อีเมล'); return; }

  const to  = toRaw.split(/[,;]/).map(s => s.trim()).filter(Boolean);
  const cc  = ccRaw.split(/[,;]/).map(s => s.trim()).filter(Boolean);
  const btn = document.getElementById('btn-mail');
  const out = document.getElementById('mail-result');

  btn.disabled = true; btn.textContent = '⏳ Sending…';
  out.className = 'd-output info'; out.textContent = 'กำลังส่ง email…';

  const t0  = performance.now();
  const res = await API.mail.send({ to, cc, subject: `[${issue}] ${summary}`, body, isHtml: true, useBranding: branded });
  const ms  = Math.round(performance.now() - t0);
  btn.disabled = false; btn.innerHTML = '<i data-icon="mail"></i> ส่ง Test Email';

  if (res?.ok) {
    out.className = 'd-output ok';
    out.innerHTML = `<i data-icon="check"></i> ส่งสำเร็จ (${ms}ms)\nTo: ${to.join(', ')}\nCC: ${cc.join(', ') || '(none)'}\nSubject: [${issue}] ${summary}`;
    Toast.success('ส่ง test email สำเร็จ');
  } else {
    out.className = 'd-output err';
    out.innerHTML = `<i data-icon="x"></i> ส่งไม่สำเร็จ (${ms}ms)\nStatus: ${res?.status}\nMessage: ${res?.data?.message || 'unknown'}`;
  }
}

// ── Init ───────────────────────────────────────────────
loadSmtpConfig();
loadServiceSubtypes();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "loadServiceSubtypes", { configurable: true, get: () => loadServiceSubtypes, set: (v) => { loadServiceSubtypes = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadSmtpConfig", { configurable: true, get: () => loadSmtpConfig, set: (v) => { loadSmtpConfig = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "sendMockEmail", { configurable: true, get: () => sendMockEmail, set: (v) => { sendMockEmail = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "testSmtp", { configurable: true, get: () => testSmtp, set: (v) => { testSmtp = v; } }); } catch (e) {}
})();
