// admin/maintenance — page script, extracted from admin/maintenance.html.
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

// ── Access gate: super_admin only ─────────────────────────────────────────────
if (!Auth.requireAdmin()) { /* redirects to /dashboard.html for non-admins */ }
if (Auth.getUser()?.role !== 'super_admin') {
  document.body.innerHTML = `
    <div class="ma-denied">
      <div style="font-size:32px;margin-bottom:8px"><i data-icon="lock"></i></div>
      <h2>Restricted to Super Admin</h2>
      <p>Maintenance mode affects every team on the platform. Only <strong>super_admin</strong> can view or change it.</p>
      <p style="margin-top:16px"><a href="./index.html" class="btn btn-primary btn-sm">← Back to Admin</a></p>
    </div>`;
  throw new Error('super_admin required');
}
Layout.render('admin');

// ── Page definitions ──────────────────────────────────────────────────────────
// Keep in sync with PAGE_FILES in assets/js/maintenance.js
const PAGES = [
  // ─── Operations ───────────────────────────────────────────────────────────
  { _group: 'Operations' },
  { id: 'board',                icon: '◫',   label: 'Service Board',           sub: 'board.html' },
  { id: 'jira-templates',       icon: '<i data-icon="zap"></i>',  label: 'Jira Templates',          sub: 'jira-templates.html' },
  { id: 'send-email',           icon: '◈',   label: 'SMC Ticket',              sub: 'send-email.html' },
  { id: 'inbox',                icon: '<i data-icon="inbox"></i>',  label: 'Team Inbox',              sub: 'inbox.html' },
  { id: 'monitoring',           icon: '⊞',   label: 'Monitoring / Jenkins',    sub: 'monitoring.html' },
  { id: 'batch-monitor',        icon: '<i data-icon="trending-up"></i>',  label: 'Batch Monitor',           sub: 'batch-monitor.html' },
  { id: 'batch-file-search',    icon: '<i data-icon="search"></i>',  label: 'Batch File Lookup',       sub: 'batch-file-search.html' },
  { id: 'test-service',         icon: '<i data-icon="test-tube"></i>',  label: 'Test Service',            sub: 'test-service.html' },
  { id: 'ops-runbook',          icon: '<i data-icon="book-open"></i>',  label: 'Ops Runbook',             sub: 'ops-runbook.html' },
  { id: 'ma-services',          icon: '🏗️',  label: 'MA Services',             sub: 'ma-services.html' },
  { id: 'pw-schedule',          icon: '◐',   label: 'PW Schedule',             sub: 'pw-schedule.html' },
  { id: 'restart-monitor',      icon: '⚓',  label: 'EKS Restart Monitor',     sub: 'restart-monitor.html' },
  { id: 'service-performance',  icon: '<i data-icon="bar-chart"></i>',  label: 'Service Performance',     sub: 'service-performance.html' },
  { id: 'alert-monitor',        icon: '<i data-icon="bell"></i>',  label: 'Alert Monitor',           sub: 'alert-monitor.html' },
  { id: 'grafana-alerts',       icon: '<i data-icon="pause"></i>',   label: 'Paused Alerts',           sub: 'grafana-alerts.html' },
  { id: 'uptime',               icon: '<i data-icon="circle"></i>',  label: 'Uptime Monitor',          sub: 'uptime.html' },
  { id: 'syncup',               icon: '<i data-icon="refresh-cw"></i>',  label: 'Daily Sync-up',           sub: 'syncup.html' },
  { id: 'sms-gateway-switches', icon: '<i data-icon="smartphone"></i>',  label: 'SMS Gateway Switches',    sub: 'sms-gateway-switches.html' },
  // ─── Analytics & Reports ──────────────────────────────────────────────────
  { _group: 'Analytics & Reports' },
  { id: 'dashboard',            icon: '⊟',   label: 'Dashboard',               sub: 'dashboard.html' },
  { id: 'analytics',            icon: '<i data-icon="trending-up"></i>',  label: 'Analytics',               sub: 'analytics.html' },
  { id: 'report',               icon: '<i data-icon="clipboard"></i>',  label: 'Report',                  sub: 'report.html' },
  { id: 'weekly-report',        icon: '<i data-icon="bar-chart"></i>',  label: 'Weekly Report',           sub: 'weekly-report.html, weekly-report-form.html' },
  // ─── Knowledge & Collaboration ────────────────────────────────────────────
  { _group: 'Knowledge & Collaboration' },
  { id: 'knowledge-base',       icon: '<i data-icon="book-open"></i>',  label: 'Knowledge Base',          sub: 'knowledge-base.html' },
  { id: 'learn',                icon: '<i data-icon="graduation-cap"></i>',  label: 'Learning / Courses',      sub: 'learn.html, learn-course.html, learn-phase.html' },
  { id: 'exam',                 icon: '<i data-icon="edit"></i>',  label: 'Exams',                   sub: 'exam.html' },
  { id: 'onboarding',           icon: '<i data-icon="compass"></i>',  label: 'Team Onboarding',         sub: 'onboarding.html' },
  { id: 'schedule',             icon: '<i data-icon="calendar"></i>',  label: 'Schedule',                sub: 'schedule.html' },
  { id: 'sheets',               icon: '<i data-icon="bar-chart"></i>',  label: 'Team Docs / Sheets',      sub: 'sheets.html' },
  { id: 'office',               icon: '<i data-icon="building"></i>',  label: 'Office Tools',            sub: 'office.html' },
  { id: 'sabai',                icon: '<i data-icon="target"></i>',  label: 'SABai',                   sub: 'sabai.html' },
  // ─── Automation ───────────────────────────────────────────────────────────
  { _group: 'Automation' },
  { id: 'incident-launcher',  icon: '<i data-icon="zap"></i>',       label: 'Incident Launcher',  sub: 'incident-launcher.html' },
  { id: 'migrate-user',       icon: '<i data-icon="git-merge"></i>', label: 'Migrate User',       sub: 'migrate-user.html' },
  // ─── Others ───────────────────────────────────────────────────────────────
  { _group: 'Others' },
  { id: 'presentation',         icon: '📽️',  label: 'Presentation',            sub: 'presentation.html' },
  { id: 'viewer',               icon: '<i data-icon="eye"></i>',  label: 'Viewer',                  sub: 'viewer.html' },
  { id: 'profile',              icon: '<i data-icon="user"></i>',  label: 'Profile',                 sub: 'profile.html' },
  { id: 'fundout-callback',     icon: '<i data-icon="refresh-cw"></i>',  label: 'Fund-out Callback',       sub: 'fundout-callback.html' },
  { id: 'setup-guide',          icon: '<i data-icon="book-open"></i>',  label: 'Setup Guide',             sub: 'setup-guide.html' },
];

const TOOLS = [
  // ─── Integrations ─────────────────────────────────────────────────────────
  { _group: 'Integrations' },
  { id: 'jira',           icon: '☁',   label: 'Jira Integration',        sub: 'Create Issue / Templates' },
  { id: 'jenkins',        icon: '⊞',   label: 'Jenkins Pipelines',       sub: 'Trigger / Monitor runs' },
  { id: 'n8n-oncall',     icon: '<i data-icon="chip"></i>',  label: 'N8N On-Call',             sub: 'Automated on-call notifications' },
  { id: 'grafana',        icon: '<i data-icon="bar-chart"></i>',  label: 'Grafana Sources',         sub: 'Dashboard / metrics embed' },
  // ─── Notifications & Alerts ───────────────────────────────────────────────
  { _group: 'Notifications & Alerts' },
  { id: 'google-chat',    icon: '<i data-icon="message-circle"></i>',  label: 'Google Chat Alert',       sub: 'Send notifications to chat' },
  { id: 'mail',           icon: '<i data-icon="mail"></i>',  label: 'Email Notifications',     sub: 'SMTP alert sending' },
  { id: 'sms-gateway',    icon: '<i data-icon="smartphone"></i>',  label: 'SMS Gateway',             sub: 'Send SMS alerts' },
  { id: 'batch-alert',    icon: '<i data-icon="siren"></i>',  label: 'Batch Alert',             sub: 'Batch monitoring alerts' },
  { id: 'scheduled-noti', icon: '<i data-icon="clock"></i>',  label: 'Scheduled Notifications', sub: 'Auto-send scheduled messages' },
  // ─── Operations ───────────────────────────────────────────────────────────
  { _group: 'Operations' },
  { id: 'reconcile',      icon: '<i data-icon="refresh-cw"></i>',  label: 'Reconcile Status',        sub: 'Cash-out reconciliation check' },
  { id: 'rundeck',        icon: '<i data-icon="folder"></i>',  label: 'Rundeck sFTP',            sub: 'sFTP file checker' },
];

// ── State ─────────────────────────────────────────────────────────────────────
let _ma = null;
let _globalSaveTimer = null;
let _itemTimers = {};
const _filters = { pages: 'all', tools: 'all' };
const _searches = { pages: '', tools: '' };

// ── Load ──────────────────────────────────────────────────────────────────────
async function loadMA(silent = false) {
  const res = await API.maintenance.get();
  if (!res?.ok) { if (!silent) Toast.error('โหลดไม่ได้'); updateStatusBar(false); return; }
  _ma = res.data.data;
  renderAll();
  updateStatusBar(true);
}

function renderAll() {
  if (!_ma) return;
  renderGlobal();
  renderList('pages', PAGES, 'page', _ma.pages || {});
  renderList('tools', TOOLS, 'tool', _ma.tools || {});
  updateCounts();
}

// ── Global ────────────────────────────────────────────────────────────────────
function renderGlobal() {
  const g = _ma?.global || {};
  const card    = document.getElementById('global-card');
  const badge   = document.getElementById('global-badge');
  const body    = document.getElementById('global-body');
  const footer  = document.getElementById('global-footer');
  const warn    = document.getElementById('global-warn');

  document.getElementById('global-toggle').checked = !!g.active;

  // Preserve fields the user is currently editing
  const msgEl = document.getElementById('global-msg');
  const etaEl = document.getElementById('global-eta');
  if (document.activeElement !== msgEl) msgEl.value = g.message || '';
  if (document.activeElement !== etaEl) etaEl.value = g.eta ? g.eta.slice(0, 16) : '';

  card.classList.toggle('is-active-global', !!g.active);
  body.classList.toggle('hidden', !g.active);
  warn.classList.toggle('show', !!g.active);

  if (g.by_name && g.at) {
    document.getElementById('global-by-name').textContent  = g.by_name;
    document.getElementById('global-by-at').textContent    = fmtDt(g.at);
    document.getElementById('global-by-avatar').textContent = initials(g.by_name);
    footer.classList.remove('hidden');
  } else {
    footer.classList.add('hidden');
  }
}

async function toggleGlobal(active) {
  const msg = document.getElementById('global-msg').value.trim() || 'ระบบปิดปรับปรุงชั่วคราว';
  const eta = document.getElementById('global-eta').value || null;
  const res = await API.maintenance.update({ scope: 'global', active, message: msg, eta });
  if (!res?.ok) { Toast.error('บันทึกไม่ได้'); loadMA(true); return; }
  _ma = res.data.data;
  renderAll();
  Toast.success(active ? '<i data-icon="alert-triangle"></i> Global MA เปิดแล้ว — users ถูก block' : 'Global MA ปิดแล้ว <i data-icon="check"></i>');
}

function scheduleGlobalSave() {
  clearTimeout(_globalSaveTimer);
  _globalSaveTimer = setTimeout(saveGlobal, 800);
}

async function saveGlobal() {
  const active = document.getElementById('global-toggle').checked;
  const msg = document.getElementById('global-msg').value.trim() || 'ระบบปิดปรับปรุงชั่วคราว';
  const eta = document.getElementById('global-eta').value || null;
  const res = await API.maintenance.update({ scope: 'global', active, message: msg, eta });
  if (res?.ok) { _ma = res.data.data; updateCounts(); }
}

// ── List (pages / tools) ──────────────────────────────────────────────────────
function renderList(kind, defs, scope, state) {
  const body = document.getElementById(`${kind}-body`);
  const q    = _searches[kind].toLowerCase();
  const filt = _filters[kind];

  const rowsHtml = [];
  let currentGroupHtml = null;
  let currentGroupItems = 0;

  const flush = () => {
    if (currentGroupHtml && currentGroupItems > 0) {
      rowsHtml.push(currentGroupHtml.replace('__COUNT__', currentGroupItems));
    }
    currentGroupHtml = null;
    currentGroupItems = 0;
  };

  defs.forEach(d => {
    if (d._group) {
      flush();
      currentGroupHtml = `<div class="ma-group-hd" data-group="${escHtml(d._group)}">
        <span>${escHtml(d._group)}</span>
        <span class="grp-count show">__COUNT__</span>
      </div>__ROWS__`;
      currentGroupItems = 0;
      currentGroupHtml = currentGroupHtml.replace('__ROWS__', '');
      return;
    }
    const s = state[d.id] || { active: false, message: '' };

    // Filter: state
    if (filt === 'active'   && !s.active) return;
    if (filt === 'inactive' &&  s.active) return;

    // Filter: search
    if (q) {
      const hay = `${d.label} ${d.sub} ${d.id}`.toLowerCase();
      if (!hay.includes(q)) return;
    }

    const rowHtml = `
      <div class="ma-row${s.active ? ' active' : ''}" id="row-${scope}-${d.id}">
        <div class="ma-row-icon">${d.icon}</div>
        <div class="ma-row-info">
          <div class="ma-row-title">${escHtml(d.label)}</div>
          <div class="ma-row-sub">${escHtml(d.sub)}</div>
        </div>
        <input class="ma-row-msg" type="text"
          id="msg-${scope}-${d.id}"
          placeholder="Custom message (optional)..."
          value="${escHtml(s.message || '')}"
          oninput="scheduleItemSave('${scope}','${d.id}')">
        <div class="ma-row-dot"></div>
        <label class="ma-toggle" title="${s.active ? 'Turn off' : 'Turn on'} MA for ${escHtml(d.label)}">
          <input type="checkbox" ${s.active ? 'checked' : ''}
            onchange="toggleItem('${scope}','${d.id}',this.checked)">
          <span class="ma-slider"></span>
        </label>
      </div>`;

    if (currentGroupHtml !== null) {
      currentGroupHtml += rowHtml;
      currentGroupItems++;
    } else {
      rowsHtml.push(rowHtml);
    }
  });
  flush();

  body.innerHTML = rowsHtml.join('');

  // Empty state
  const hasItems = body.querySelector('.ma-row');
  document.getElementById(`${kind}-empty`).classList.toggle('show', !hasItems);
}

async function toggleItem(scope, id, active) {
  const msg = (document.getElementById(`msg-${scope}-${id}`)?.value || '').trim();
  const res = await API.maintenance.update({ scope, id, active, message: msg });
  if (!res?.ok) { Toast.error('บันทึกไม่ได้'); loadMA(true); return; }
  _ma = res.data.data;
  const row = document.getElementById(`row-${scope}-${id}`);
  if (row) row.classList.toggle('active', active);
  updateCounts();
  Toast.success(active ? `<i data-icon="circle"></i> ${id} MA เปิดแล้ว` : `<i data-icon="check"></i> ${id} MA ปิดแล้ว`);
}

function scheduleItemSave(scope, id) {
  const key = `${scope}-${id}`;
  clearTimeout(_itemTimers[key]);
  _itemTimers[key] = setTimeout(() => saveItem(scope, id), 900);
}

async function saveItem(scope, id) {
  const row = document.getElementById(`row-${scope}-${id}`);
  if (!row) return;
  const active = row.querySelector('input[type=checkbox]').checked;
  if (!active) return;
  const msg = (document.getElementById(`msg-${scope}-${id}`)?.value || '').trim();
  const res = await API.maintenance.update({ scope, id, active, message: msg });
  if (res?.ok) _ma = res.data.data;
}

// ── Search / filter ───────────────────────────────────────────────────────────
function filterList(kind) {
  const input = document.getElementById(`${kind}-search`);
  _searches[kind] = (input.value || '').trim();
  document.getElementById(`${kind}-search-wrap`).classList.toggle('has-value', !!_searches[kind]);
  const defs  = kind === 'pages' ? PAGES : TOOLS;
  const scope = kind === 'pages' ? 'page' : 'tool';
  renderList(kind, defs, scope, _ma?.[kind] || {});
}

function clearSearch(kind) {
  document.getElementById(`${kind}-search`).value = '';
  filterList(kind);
}

function setFilter(kind, filter) {
  _filters[kind] = filter;
  const seg = document.querySelector(`#${kind}-body`).parentElement.querySelector('.ma-seg');
  seg?.querySelectorAll('button').forEach(b => {
    b.classList.toggle('active', b.dataset.filter === filter);
  });
  const defs  = kind === 'pages' ? PAGES : TOOLS;
  const scope = kind === 'pages' ? 'page' : 'tool';
  renderList(kind, defs, scope, _ma?.[kind] || {});
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function updateCounts() {
  const pages = _ma?.pages || {};
  const tools = _ma?.tools || {};

  const knownPages = PAGES.filter(p => p.id);
  const knownTools = TOOLS.filter(t => t.id);
  const pTotal = knownPages.length;
  const tTotal = knownTools.length;
  const pActive = knownPages.filter(p => pages[p.id]?.active).length;
  const tActive = knownTools.filter(t => tools[t.id]?.active).length;

  // Card corner counts
  const pc = document.getElementById('pages-count');
  pc.textContent = `${pActive} active`;
  pc.classList.toggle('hot', pActive > 0);

  const tc = document.getElementById('tools-count');
  tc.textContent = `${tActive} active`;
  tc.classList.toggle('hot', tActive > 0);

  // Segmented filter counts
  document.getElementById('pages-all-count').textContent    = pTotal;
  document.getElementById('pages-active-count').textContent = pActive;
  document.getElementById('tools-all-count').textContent    = tTotal;
  document.getElementById('tools-active-count').textContent = tActive;

  // Top summary
  document.getElementById('tot-pages').textContent = pActive;
  document.getElementById('tot-tools').textContent = tActive;
}

function updateStatusBar(ok) {
  const dot = document.getElementById('conn-dot');
  dot.classList.toggle('stale', !ok);
  document.getElementById('last-sync').textContent = ok
    ? `synced ${new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
    : 'sync failed';
}

function fmtDt(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function initials(name) {
  if (!name) return '—';
  const parts = String(name).trim().split(/\s+/);
  return (parts[0]?.[0] || '') + (parts[1]?.[0] || '');
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Auto-poll ─────────────────────────────────────────────────────────────────
loadMA();
setInterval(() => loadMA(true), 10_000);

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "clearSearch", { configurable: true, get: () => clearSearch, set: (v) => { clearSearch = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "escHtml", { configurable: true, get: () => escHtml, set: (v) => { escHtml = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "filterList", { configurable: true, get: () => filterList, set: (v) => { filterList = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtDt", { configurable: true, get: () => fmtDt, set: (v) => { fmtDt = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "initials", { configurable: true, get: () => initials, set: (v) => { initials = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadMA", { configurable: true, get: () => loadMA, set: (v) => { loadMA = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderAll", { configurable: true, get: () => renderAll, set: (v) => { renderAll = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderGlobal", { configurable: true, get: () => renderGlobal, set: (v) => { renderGlobal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderList", { configurable: true, get: () => renderList, set: (v) => { renderList = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "saveGlobal", { configurable: true, get: () => saveGlobal, set: (v) => { saveGlobal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "saveItem", { configurable: true, get: () => saveItem, set: (v) => { saveItem = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "scheduleGlobalSave", { configurable: true, get: () => scheduleGlobalSave, set: (v) => { scheduleGlobalSave = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "scheduleItemSave", { configurable: true, get: () => scheduleItemSave, set: (v) => { scheduleItemSave = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setFilter", { configurable: true, get: () => setFilter, set: (v) => { setFilter = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toggleGlobal", { configurable: true, get: () => toggleGlobal, set: (v) => { toggleGlobal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toggleItem", { configurable: true, get: () => toggleItem, set: (v) => { toggleItem = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updateCounts", { configurable: true, get: () => updateCounts, set: (v) => { updateCounts = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updateStatusBar", { configurable: true, get: () => updateStatusBar, set: (v) => { updateStatusBar = v; } }); } catch (e) {}
})();
