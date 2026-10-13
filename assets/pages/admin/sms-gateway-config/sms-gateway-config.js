// admin/sms-gateway-config — page script, extracted from admin/sms-gateway-config.html.
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
Layout.render('sms-gateway-config');

const _data = { tmn: [], nano: [], welth: [] };
let _tab = 'tmn';

async function loadAll() {
  await Promise.all([loadProject('tmn'), loadProject('nano'), loadProject('welth')]);
  renderHistory();
}

async function loadProject(p) {
  setStatus(p, 'loading', 'Loading');
  const res = await API.smsGateway.list(p);
  if (!res?.ok) { setStatus(p, 'error', 'Error'); return; }
  _data[p] = res.data.data || [];
  renderCard(p);
  setStatus(p, 'ok', 'OK');
}

function renderCard(p) {
  const records = _data[p];
  const now     = new Date();
  const ym      = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthCt = records.filter(r => (r.switch_start || '').startsWith(ym)).length;
  const maxBuild = records.reduce((mx, r) => Math.max(mx, r.build_number || 0), 0);

  document.getElementById(`stats-${p}`).innerHTML = `
    <div class="gw-stat"><div class="gw-stat-val">${records.length}</div><div class="gw-stat-lbl">Total Switches</div></div>
    <div class="gw-stat"><div class="gw-stat-val">${monthCt}</div><div class="gw-stat-lbl">This Month</div></div>
    <div class="gw-stat"><div class="gw-stat-val">${maxBuild || '—'}</div><div class="gw-stat-lbl">Last Build #</div></div>`;

  const latest = records[0];
  const latestEl = document.getElementById(`latest-${p}`);
  if (!latest) {
    latestEl.innerHTML = `<div class="gw-latest-lbl">Latest Switch</div><div style="color:var(--text-muted);font-size:11px">ไม่มีข้อมูล</div>`;
    return;
  }
  latestEl.innerHTML = `
    <div class="gw-latest-lbl">Latest Switch</div>
    <div class="gw-switch-row">
      <span class="gw-gw-pill">${escHtml(latest.from_gateway || '—')}</span>
      <span class="gw-arrow">→</span>
      <span class="gw-gw-pill">${escHtml(latest.to_gateway || '—')}</span>
    </div>
    <div class="gw-switch-meta">${fmtDt(latest.switch_start)} · Build #${latest.build_number || '?'} · ${escHtml(latest.triggered_by || 'unknown')}</div>`;
}

async function syncProject(p) {
  const btn = document.getElementById(`sync-btn-${p}`);
  const msg = document.getElementById(`sync-msg-${p}`);
  btn.disabled  = true;
  btn.textContent = 'Syncing...';
  document.getElementById(`card-${p}`).classList.add('syncing');
  msg.className = 'gw-sync-msg';
  msg.textContent = 'กำลัง sync...';

  const res = await API.smsGateway.sync(p);
  btn.disabled    = false;
  btn.textContent = '↺ Sync from Jenkins';
  document.getElementById(`card-${p}`).classList.remove('syncing');

  if (!res?.ok) {
    msg.className   = 'gw-sync-msg err';
    msg.textContent = res?.data?.message || 'Sync ไม่สำเร็จ';
    return;
  }
  msg.className   = 'gw-sync-msg ok';
  msg.textContent = res.data?.message || 'Sync สำเร็จ';
  await loadProject(p);
  renderHistory();
}

function switchTab(p) {
  _tab = p;
  document.getElementById('tab-tmn').classList.toggle('active',   p === 'tmn');
  document.getElementById('tab-nano').classList.toggle('active',  p === 'nano');
  document.getElementById('tab-welth').classList.toggle('active', p === 'welth');
  renderHistory();
}

function renderHistory() {
  const records = (_data[_tab] || []).slice(0, 50);
  const tbody   = document.getElementById('ht-tbody');
  if (!records.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="ht-empty">ไม่มีข้อมูล</td></tr>`;
    return;
  }
  tbody.innerHTML = records.map(r => `
    <tr>
      <td style="font-weight:700">#${r.build_number || '?'}</td>
      <td style="white-space:nowrap">${fmtDt(r.switch_start)}</td>
      <td><span style="background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:2px 7px;font-size:10.5px">${escHtml(r.from_gateway || '—')}</span></td>
      <td><span style="background:rgba(242,100,25,.08);border:1px solid rgba(242,100,25,.2);border-radius:4px;padding:2px 7px;font-size:10.5px;color:var(--orange)">${escHtml(r.to_gateway || '—')}</span></td>
      <td>${escHtml(r.triggered_by || '—')}</td>
      <td style="color:var(--text-muted)">${escHtml(r.remark || '—')}</td>
    </tr>`).join('');
}

function setStatus(p, cls, label) {
  const el = document.getElementById(`status-${p}`);
  el.className = `gw-status ${cls}`;
  el.innerHTML = `<span class="gw-status-dot"></span>${label}`;
}

function fmtDt(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('th-TH', { day:'numeric', month:'short', year:'2-digit', hour:'2-digit', minute:'2-digit' });
}

loadAll();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "fmtDt", { configurable: true, get: () => fmtDt, set: (v) => { fmtDt = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadAll", { configurable: true, get: () => loadAll, set: (v) => { loadAll = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadProject", { configurable: true, get: () => loadProject, set: (v) => { loadProject = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderCard", { configurable: true, get: () => renderCard, set: (v) => { renderCard = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderHistory", { configurable: true, get: () => renderHistory, set: (v) => { renderHistory = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setStatus", { configurable: true, get: () => setStatus, set: (v) => { setStatus = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "switchTab", { configurable: true, get: () => switchTab, set: (v) => { switchTab = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "syncProject", { configurable: true, get: () => syncProject, set: (v) => { syncProject = v; } }); } catch (e) {}
})();
