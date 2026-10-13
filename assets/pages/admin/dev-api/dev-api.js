// admin/dev-api — page script, extracted from admin/dev-api.html.
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
Layout.render('dev-api');

// ── Shortcuts ──────────────────────────────────────────
const SHORTCUTS = [
  { m:'GET',  p:'/health/index.php',            label:'Health' },
  { m:'GET',  p:'/auth/me.php',                 label:'Me' },
  { m:'GET',  p:'/users/index.php',             label:'Users' },
  { m:'GET',  p:'/board/index.php?limit=10',    label:'Board' },
  { m:'GET',  p:'/system-settings/index.php',   label:'Settings' },
  { m:'GET',  p:'/dev/',                        label:'Dev Stats' },
  { m:'GET',  p:'/log/index.php?type=activity&limit=20', label:'Activity Log' },
  { m:'GET',  p:'/log/index.php?type=security&limit=20', label:'Security Log' },
  { m:'GET',  p:'/jenkins-servers/index.php',   label:'Jenkins Svrs' },
  { m:'GET',  p:'/templates/index.php',         label:'Templates' },
  { m:'GET',  p:'/notifications/index.php',     label:'Notifications' },
  { m:'POST', p:'/auth/logout.php',             label:'Logout', b:'{}' },
];

document.getElementById('shortcut-list').innerHTML = SHORTCUTS.map((s,i) =>
  `<span class="shortcut-chip" onclick="loadShortcut(${i})">
    <span class="pill ${s.m==='GET'?'G':'P'}">${s.m}</span>${escHtml(s.label)}
  </span>`
).join('');

function loadShortcut(i) {
  const s = SHORTCUTS[i];
  document.getElementById('api-method').value = s.m;
  document.getElementById('api-path').value   = s.p;
  document.getElementById('api-body').value   = s.b || '';
}

// ── State ──────────────────────────────────────────────
let _history = [];
let _lastResponse = null;

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
}

// ── Send ───────────────────────────────────────────────
async function sendRequest() {
  const method = document.getElementById('api-method').value;
  const path   = document.getElementById('api-path').value.trim();
  const bodyRaw= document.getElementById('api-body').value.trim();
  const out    = document.getElementById('api-result');
  const btn    = document.getElementById('btn-send');
  const pretty = document.getElementById('pretty-print').checked;

  if (!path) { Toast.warning('กรอก path ก่อน'); return; }

  let body = null;
  if (bodyRaw && ['POST','PUT','PATCH'].includes(method)) {
    try { body = JSON.parse(bodyRaw); }
    catch (e) { out.className = 'd-output err'; out.textContent = 'JSON parse error: ' + e.message; return; }
  }

  btn.disabled = true; btn.textContent = '⏳ Sending…';
  out.className = 'd-output info';
  out.textContent = `${method} ${path}\n\nSending…`;
  document.getElementById('api-meta-bar').style.display = 'none';

  const t0  = performance.now();
  const res = await API.request(method, path, body);
  const ms  = Math.round(performance.now() - t0);
  btn.disabled = false; btn.innerHTML = '<i data-icon="play"></i> Send Request';

  _lastResponse = res?.data;
  const ok = res?.ok ?? false;
  const st = res?.status ?? 0;
  const json = pretty
    ? JSON.stringify(res?.data, null, 2)
    : JSON.stringify(res?.data);

  out.className = 'd-output ' + (ok ? 'ok' : 'err');
  out.textContent = `${method} ${path}\nHTTP ${st} · ${ms}ms\n\n${json}`;

  // Meta bar
  const metaBar = document.getElementById('api-meta-bar');
  const metaSt  = document.getElementById('api-meta-status');
  metaSt.textContent = `HTTP ${st}`;
  metaSt.className   = 'meta-status ' + (ok ? 'ok' : 'err');
  document.getElementById('api-meta-time').textContent = `${ms}ms`;
  document.getElementById('api-meta-size').textContent = `${new TextEncoder().encode(json).length} bytes`;
  metaBar.style.display = 'flex';

  // History
  _history.unshift({ method, path, body: bodyRaw, status: st, ok, ms, ts: Date.now() });
  if (_history.length > 50) _history.length = 50;
  renderHistory();
}

function clearResult() {
  document.getElementById('api-result').className = 'd-output';
  document.getElementById('api-result').textContent = '';
  document.getElementById('api-meta-bar').style.display = 'none';
  _lastResponse = null;
}

function copyResponse() {
  if (_lastResponse == null) return;
  navigator.clipboard?.writeText(JSON.stringify(_lastResponse, null, 2))
    .then(() => Toast.success('Copied JSON'));
}

// ── History ────────────────────────────────────────────
function renderHistory() {
  const list = document.getElementById('hist-list');
  document.getElementById('hist-count').textContent = `${_history.length} requests`;

  if (!_history.length) {
    list.innerHTML = '<div class="hist-empty">ยังไม่มี history — ส่ง request ก่อน</div>';
    return;
  }

  list.innerHTML = _history.map((h, i) => {
    const msClass = h.ms > 1000 ? 'slow' : '';
    const stClass = h.ok ? 'ok' : 'err';
    return `<div class="hist-item" onclick="restoreHistory(${i})">
      <span class="m-pill ${h.method}">${h.method}</span>
      <span class="hist-path" title="${escHtml(h.path)}">${escHtml(h.path)}</span>
      <span class="hist-status ${stClass}">${h.status}</span>
      <span class="hist-ms ${msClass}" style="text-align:right">${h.ms}ms</span>
      <span class="hist-ts">${fmtTime(h.ts)}</span>
    </div>`;
  }).join('');
}

function restoreHistory(i) {
  const h = _history[i];
  if (!h) return;
  document.getElementById('api-method').value = h.method;
  document.getElementById('api-path').value   = h.path;
  document.getElementById('api-body').value   = h.body || '';
  Toast.success('Loaded from history');
}

function clearHistory() {
  _history = [];
  _lastResponse = null;
  renderHistory();
}

// Keyboard: Ctrl+Enter to send
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    sendRequest();
  }
});

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "clearHistory", { configurable: true, get: () => clearHistory, set: (v) => { clearHistory = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "clearResult", { configurable: true, get: () => clearResult, set: (v) => { clearResult = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "copyResponse", { configurable: true, get: () => copyResponse, set: (v) => { copyResponse = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtTime", { configurable: true, get: () => fmtTime, set: (v) => { fmtTime = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadShortcut", { configurable: true, get: () => loadShortcut, set: (v) => { loadShortcut = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderHistory", { configurable: true, get: () => renderHistory, set: (v) => { renderHistory = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "restoreHistory", { configurable: true, get: () => restoreHistory, set: (v) => { restoreHistory = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "sendRequest", { configurable: true, get: () => sendRequest, set: (v) => { sendRequest = v; } }); } catch (e) {}
})();
