// admin/devtools — page script, extracted from admin/devtools.html.
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

// ── Role gate: Dev SM only ─────────────────────────────────
if (!Auth.requireAuth()) { /* redirected */ }
const _user = Auth.getUser?.();
if (_user && _user.role !== 'dev_sm') {
  // Other roles → redirect to admin overview
  window.location.replace('./index.html');
}

Layout.render('devtools');

// ══════════════════════════════════════════════════════════
//   1. SESSION INSPECTOR
// ══════════════════════════════════════════════════════════
function decodeJwt(token) {
  try {
    const [, payloadB64] = token.split('.');
    const json = atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decodeURIComponent(escape(json)));
  } catch { return null; }
}

function loadSession() {
  const token  = Auth.getToken();
  const user   = Auth.getUser() || {};
  const decoded = token ? decodeJwt(token) : null;
  const exp    = decoded?.exp ? new Date(decoded.exp * 1000) : null;
  const iat    = decoded?.iat ? new Date(decoded.iat * 1000) : null;
  const remain = exp ? Math.max(0, Math.round((exp - Date.now()) / 60000)) : null;

  const kv = document.getElementById('sess-kv');
  kv.innerHTML = `
    <dt>User ID</dt><dd>${escHtml(user.id || decoded?.sub || '—')}</dd>
    <dt>Username</dt><dd>${escHtml(user.username || decoded?.username || '—')}</dd>
    <dt>Display Name</dt><dd>${escHtml(user.name || decoded?.name || '—')}</dd>
    <dt>Role</dt><dd><span style="color:var(--orange);font-weight:700">${escHtml(user.role || decoded?.role || '—')}</span></dd>
    <dt>Token Issued</dt><dd>${iat ? iat.toLocaleString('th-TH') : '—'}</dd>
    <dt>Token Expires</dt><dd>${exp ? exp.toLocaleString('th-TH') + ' (' + remain + ' min remaining)' : '—'}</dd>
    <dt>Browser</dt><dd>${escHtml(navigator.userAgent.slice(0, 80))}</dd>
    <dt>API Base</dt><dd>${escHtml(window.location.origin)} + /api</dd>
  `;
  document.getElementById('sess-payload').textContent =
    decoded ? JSON.stringify(decoded, null, 2) : '(ไม่มี token)';
}
async function copyToken() {
  const token = Auth.getToken();
  if (!token) { Toast.warning('ไม่มี token'); return; }
  await navigator.clipboard.writeText(token);
  Toast.success('Copied JWT token');
}

// ══════════════════════════════════════════════════════════
//   2. HEALTH CHECK
// ══════════════════════════════════════════════════════════
async function loadHealth(fresh = true) {
  const btn = document.getElementById('btn-health');
  btn.disabled = true; btn.textContent = '⏳ ตรวจสอบ…';
  const t0  = performance.now();
  const res = await API.health.check(fresh);
  const ms  = Math.round(performance.now() - t0);
  btn.disabled = false; btn.textContent = '↻ ตรวจสอบ (force fresh)';

  const list = document.getElementById('health-list');
  if (!res?.ok) {
    list.innerHTML = `<div class="dt-output err">Error ${res?.status}: ${escHtml(res?.data?.message || 'unknown')}</div>`;
    return;
  }

  const svcs = res.data.data?.services || {};
  const checked = res.data.data?.checked_at || '';
  document.getElementById('health-meta').textContent = `Round-trip: ${ms}ms · Checked: ${checked}`;

  const rows = [];
  // Jira
  const j = svcs.jira || {};
  rows.push(makeHealthRow('Jira', j.status, j.detail || j.status, j.latency_ms));
  // SMTP
  const s = svcs.smtp || {};
  rows.push(makeHealthRow('SMTP', s.status, s.detail || s.status, null));
  // Jenkins servers
  const jks = Array.isArray(svcs.jenkins) ? svcs.jenkins : [];
  if (!jks.length) {
    rows.push(makeHealthRow('Jenkins', 'not_configured', 'No servers configured', null));
  } else {
    jks.forEach(jk => {
      rows.push(makeHealthRow('Jenkins · ' + (jk.display || jk.id), jk.status, jk.detail || jk.status, jk.latency_ms));
    });
  }
  list.innerHTML = rows.join('');
}
function makeHealthRow(name, status, detail, ms) {
  const dotCls = status === 'ok' ? 'ok'
               : status === 'timeout' ? 'warn'
               : status === 'not_configured' ? 'nc' : 'err';
  return `<div class="dt-health-row">
    <span class="dt-health-dot ${dotCls}"></span>
    <span class="dt-health-name">${escHtml(name)}</span>
    <span class="dt-health-status">${escHtml(detail || status || '')}</span>
    <span class="dt-health-ms">${ms != null ? ms + 'ms' : ''}</span>
  </div>`;
}

// ══════════════════════════════════════════════════════════
//   3. SMTP TEST
// ══════════════════════════════════════════════════════════
async function testSmtp() {
  const btn = document.getElementById('btn-smtp');
  const out = document.getElementById('smtp-result');
  btn.disabled = true; btn.textContent = '⏳ Testing…';
  out.innerHTML = '<span style="color:var(--text-muted)">กำลังเชื่อมต่อ SMTP…</span>';

  const res = await API.mail.testConnection();
  btn.disabled = false; btn.innerHTML = '<i data-icon="search"></i> Test Connection';

  if (!res?.ok) {
    out.innerHTML = `<div class="dt-output err">Error: ${escHtml(res?.data?.message || 'unknown')}</div>`;
    return;
  }
  const steps = res.data.data?.steps || [];
  const overall = res.data.data?.ok;
  const summary = overall
    ? `<div class="dt-step-summary ok"><i data-icon="check"></i> All ${steps.length} steps passed — SMTP server พร้อมใช้งาน</div>`
    : `<div class="dt-step-summary err"><i data-icon="x"></i> Test failed at step ${steps.findIndex(s => !s.ok) + 1} of ${steps.length}</div>`;

  // Render detail safely without auto-linkify (use textContent on cloned nodes)
  const list = document.createElement('div');
  list.className = 'dt-steps';
  steps.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'dt-step ' + (s.ok ? 'ok' : 'err');
    row.innerHTML = `
      <span class="dt-step-num">${i + 1}</span>
      <span class="dt-step-tx">
        <span class="name"></span>
        <span class="detail"></span>
      </span>
      <span class="dt-step-badge">${s.ok ? 'OK' : 'FAIL'}</span>`;
    row.querySelector('.name').textContent   = s.label || '';
    row.querySelector('.detail').textContent = s.detail || '';
    list.appendChild(row);
  });
  out.innerHTML = summary;
  out.appendChild(list);
}

// ══════════════════════════════════════════════════════════
//   4. EMAIL TESTER
// ══════════════════════════════════════════════════════════
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
    if (st) {
      document.getElementById('mail-cc').value = (st.emails || []).join(', ');
      return;
    }
  }
});

// ── Rich editor: toolbar, paste-image, keyboard shortcuts ──
const _mailEditor = document.getElementById('mail-body');

document.querySelectorAll('.dt-editor-btn[data-cmd]').forEach(btn => {
  btn.addEventListener('click', e => {
    e.preventDefault();
    document.execCommand(btn.dataset.cmd, false, null);
    _mailEditor.focus();
  });
});

// Image picker (toolbar button)
document.getElementById('mail-img-btn').addEventListener('click', () => {
  document.getElementById('mail-img-input').click();
});
document.getElementById('mail-img-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const r = new FileReader();
  r.onload = ev => {
    document.execCommand('insertHTML', false,
      `<img src="${ev.target.result}" style="max-width:100%;height:auto;border-radius:4px;margin:6px 0">`);
    _mailEditor.focus();
  };
  r.readAsDataURL(file);
  e.target.value = '';
});

// Paste handler — convert clipboard images to inline base64 img
_mailEditor.addEventListener('paste', e => {
  const items = e.clipboardData?.items || [];
  for (const item of items) {
    if (item.type?.startsWith('image/')) {
      e.preventDefault();
      const file = item.getAsFile();
      if (!file) continue;
      const r = new FileReader();
      r.onload = ev => {
        document.execCommand('insertHTML', false,
          `<img src="${ev.target.result}" style="max-width:100%;height:auto;border-radius:4px;margin:6px 0">`);
      };
      r.readAsDataURL(file);
      return;
    }
  }
  // Plain text: strip rich formatting from external sources
  const text = e.clipboardData?.getData('text/plain');
  if (text && !e.clipboardData.types.includes('text/html')) {
    e.preventDefault();
    document.execCommand('insertText', false, text);
  }
});

// Make Enter create <p> instead of <div> (cleaner HTML output)
document.addEventListener('DOMContentLoaded', () => {
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch {}
});

// Enable click-to-resize for any image inserted into the editor
setupImageResize(_mailEditor);

async function sendMockEmail() {
  const issue   = document.getElementById('mail-issue').value.trim() || 'DEV-TEST-000';
  const summary = document.getElementById('mail-summary').value.trim() || 'Test';
  const toRaw   = document.getElementById('mail-to').value.trim();
  const ccRaw   = document.getElementById('mail-cc').value.trim();
  const body    = _mailEditor.innerHTML.trim();
  const branded = document.getElementById('mail-branded').checked;

  if (!toRaw) { Toast.warning('กรอก To อย่างน้อย 1 อีเมล'); return; }

  const to = toRaw.split(/[,;]/).map(s => s.trim()).filter(Boolean);
  const cc = ccRaw.split(/[,;]/).map(s => s.trim()).filter(Boolean);

  const btn = document.getElementById('btn-mail');
  const out = document.getElementById('mail-result');
  btn.disabled = true; btn.textContent = '⏳ ส่ง…';
  out.className = 'dt-output info';
  out.textContent = 'กำลังส่ง email…';

  const t0 = performance.now();
  const res = await API.mail.send({
    to, cc,
    subject: `[${issue}] ${summary}`,
    body,
    isHtml: true,
    useBranding: branded,
  });
  const ms = Math.round(performance.now() - t0);
  btn.disabled = false; btn.innerHTML = '<i data-icon="mail"></i> ส่ง Test Email';

  if (res?.ok) {
    out.className = 'dt-output ok';
    out.innerHTML = `<i data-icon="check"></i> ส่งสำเร็จ (${ms}ms)\nTo: ${to.join(', ')}\nCC: ${cc.join(', ') || '(none)'}\nSubject: [${issue}] ${summary}`;
    Toast.success('ส่ง test email สำเร็จ');
  } else {
    out.className = 'dt-output err';
    out.innerHTML = `<i data-icon="x"></i> ส่งไม่สำเร็จ (${ms}ms)\nStatus: ${res?.status}\nMessage: ${res?.data?.message || 'unknown'}`;
  }
}

// ══════════════════════════════════════════════════════════
//   5. API TESTER
// ══════════════════════════════════════════════════════════
async function callApi() {
  const method = document.getElementById('api-method').value;
  const path   = document.getElementById('api-path').value.trim();
  const bodyRaw= document.getElementById('api-body').value.trim();
  const out    = document.getElementById('api-result');
  const btn    = document.getElementById('btn-api');

  if (!path) { Toast.warning('กรอก path'); return; }

  let body = null;
  if (bodyRaw && ['POST','PUT','PATCH'].includes(method)) {
    try { body = JSON.parse(bodyRaw); }
    catch (e) { out.className = 'dt-output err'; out.textContent = 'JSON parse error: ' + e.message; return; }
  }

  btn.disabled = true; btn.textContent = '⏳…';
  out.className = 'dt-output info';
  out.textContent = `<span class="dt-method ${method}">${method}</span> ${path}\n\nกำลังส่ง…`;

  const t0 = performance.now();
  const res = await API.request(method, path, body);
  const ms  = Math.round(performance.now() - t0);
  btn.disabled = false; btn.innerHTML = '<i data-icon="play"></i> Send Request';

  document.getElementById('api-meta').textContent = `${ms}ms · HTTP ${res?.status}`;

  out.className = 'dt-output ' + (res?.ok ? 'ok' : 'err');
  out.innerHTML = `<span class="dt-method ${method}">${method}</span> <b>${escHtml(path)}</b>\n` +
    `<span style="color:var(--text-muted)">HTTP ${res?.status} · ${ms}ms</span>\n\n` +
    escHtml(JSON.stringify(res?.data, null, 2));
}

// ══════════════════════════════════════════════════════════
//   6. LOGS
// ══════════════════════════════════════════════════════════
let _logTab = 'activity';
function switchLogTab(tab) {
  _logTab = tab;
  document.querySelectorAll('.dt-tab').forEach(t => t.classList.toggle('active', t.dataset.log === tab));
  loadLogs();
}
async function loadLogs() {
  const list = document.getElementById('logs-list');
  list.innerHTML = '<span style="color:var(--text-muted)">Loading…</span>';

  const t0 = performance.now();
  const res = await API.logs.query({ type: _logTab, limit: 50 });
  const ms = Math.round(performance.now() - t0);

  if (!res?.ok) {
    list.innerHTML = `<div class="dt-output err">Error: ${escHtml(res?.data?.message || 'unknown')}</div>`;
    return;
  }

  const items = res.data.data?.items || [];
  document.getElementById('logs-meta').textContent = `${items.length} entries · ${ms}ms`;

  if (!items.length) {
    list.innerHTML = '<div style="color:var(--text-muted);font-size:11px">ไม่มี log</div>';
    return;
  }

  list.innerHTML = items.map(e => {
    const ts = e.ts ? new Date(e.ts).toLocaleString('th-TH', {hour12:false}) : '';
    const detail = e.detail ? JSON.stringify(e.detail) : '';
    const cls = _logTab === 'security' ? ' sec' : '';
    return `<div class="dt-log-row${cls}">
      <span class="ts">${escHtml(ts.slice(11))}</span>
      <span class="ac">${escHtml(e.action || e.event || '')}</span>
      <span class="dt">${escHtml(e.user_name || '')} · ${escHtml(detail)}</span>
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════
//   INIT
// ══════════════════════════════════════════════════════════
loadSession();
loadHealth(false);
loadServiceSubtypes();
loadLogs();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "callApi", { configurable: true, get: () => callApi, set: (v) => { callApi = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "copyToken", { configurable: true, get: () => copyToken, set: (v) => { copyToken = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "decodeJwt", { configurable: true, get: () => decodeJwt, set: (v) => { decodeJwt = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadHealth", { configurable: true, get: () => loadHealth, set: (v) => { loadHealth = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadLogs", { configurable: true, get: () => loadLogs, set: (v) => { loadLogs = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadServiceSubtypes", { configurable: true, get: () => loadServiceSubtypes, set: (v) => { loadServiceSubtypes = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadSession", { configurable: true, get: () => loadSession, set: (v) => { loadSession = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "makeHealthRow", { configurable: true, get: () => makeHealthRow, set: (v) => { makeHealthRow = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "sendMockEmail", { configurable: true, get: () => sendMockEmail, set: (v) => { sendMockEmail = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "switchLogTab", { configurable: true, get: () => switchLogTab, set: (v) => { switchLogTab = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "testSmtp", { configurable: true, get: () => testSmtp, set: (v) => { testSmtp = v; } }); } catch (e) {}
})();
