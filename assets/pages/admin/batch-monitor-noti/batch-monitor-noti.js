// admin/batch-monitor-noti — page script, extracted from admin/batch-monitor-noti.html.
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
Layout.render('admin');

let servers     = [];
let recent      = [];
let tracked     = {};
let selectedTab = '__all__';
let mdServerId  = '';

let storage = {};

async function loadAll() {
  const res = await API.batchMonitorNoti.list();
  if (!res?.ok) return toast('โหลดข้อมูลไม่สำเร็จ', 'error');
  servers = res.data.data?.servers         || [];
  recent  = res.data.data?.recent          || [];
  tracked = res.data.data?.trackedByServer || {};
  storage = res.data.data?.storage         || {};
  renderServers();
  renderTabs();
  renderActivity();
  renderStorage();
}

function fmtBytes(n) {
  if (!n) return '0 B';
  if (n < 1024) return n + ' B';
  if (n < 1024*1024) return (n/1024).toFixed(1) + ' KB';
  return (n/1024/1024).toFixed(2) + ' MB';
}

function renderStorage() {
  const el = document.getElementById('storage-chip');
  if (!el) return;
  const s = storage;
  el.innerHTML = `
    <span title="state.json — 1 entry per Jenkins job, auto-prune deleted jobs">
      state <b>${s.stateEntries ?? 0}</b> · ${fmtBytes(s.stateBytes)}
    </span>
    <span style="opacity:.4">·</span>
    <span title="log.json — capped at ${s.logCap ?? 500} entries (oldest pruned)">
      log <b>${s.logEntries ?? 0}</b>/${s.logCap ?? 500} · ${fmtBytes(s.logBytes)}
    </span>`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleString('th-TH', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
}

// ═══════════════════════════════════════════════════
// LEFT — Jenkins Servers list
// ═══════════════════════════════════════════════════
function renderServers() {
  const list = document.getElementById('srv-list');
  const activeCount = servers.filter(s => s.srvEnabled && s.hasWebhook && s.enabled).length;
  document.getElementById('srv-count').textContent =
    `${servers.length} servers · ${activeCount} active`;

  if (!servers.length) {
    list.innerHTML = `<div class="log-empty">
      ยังไม่มี Jenkins server — เพิ่มก่อนที่ <a href="./jenkins-servers.html" style="color:var(--bmn-accent)">Admin → Jenkins</a>
    </div>`;
    return;
  }

  list.innerHTML = servers.map(s => {
    let statusHtml;
    if (!s.srvEnabled) {
      statusHtml = `<span class="srv-status st-disabled"><span class="srv-status-dot"></span>disabled</span>`;
    } else if (!s.hasWebhook) {
      statusHtml = `<span class="srv-status st-nourl"><span class="srv-status-dot"></span>no url</span>`;
    } else if (s.enabled) {
      statusHtml = `<span class="srv-status st-on"><span class="srv-status-dot"></span>on</span>`;
    } else {
      statusHtml = `<span class="srv-status st-paused"><span class="srv-status-dot"></span>paused</span>`;
    }

    const toggleHtml = (s.srvEnabled && s.hasWebhook)
      ? `<label class="tog" title="${s.enabled ? 'ปิด' : 'เปิด'}" onclick="event.stopPropagation()">
           <input type="checkbox" ${s.enabled ? 'checked' : ''}
                  onchange="quickToggle('${esc(s.id)}', this.checked)">
           <span class="tog-slider"></span>
         </label>`
      : '';

    const urlHtml = s.hasWebhook
      ? `<div class="srv-item-url">${esc(s.webhookMasked)}</div>`
      : `<div class="srv-item-url empty">— ยังไม่ได้ตั้ง webhook URL —</div>`;

    const cnts = s.trackedCounts || {};
    const fail = (cnts.FAILURE||0) + (cnts.UNSTABLE||0);
    const track = s.trackedTotal || 0;

    const isSelected = selectedTab === s.id;

    return `
      <div class="srv-item ${isSelected ? 'selected' : ''}" onclick="selectTab('${esc(s.id)}')">
        <div class="srv-item-top">
          <div class="srv-item-name">${esc(s.display)}</div>
          ${toggleHtml}
          ${statusHtml}
        </div>
        <div class="srv-item-meta">
          <span>${s.ignoreRules} rules</span>
          <span class="dot"></span>
          <span>${track} tracked</span>
          ${fail > 0 ? `<span class="dot"></span><span style="color:var(--bmn-fail);font-weight:700">${fail} fail</span>` : ''}
        </div>
        ${urlHtml}
        <div class="srv-item-actions">
          <button class="btn-mini primary" onclick="event.stopPropagation();mdOpen('${esc(s.id)}')">${s.hasWebhook ? '<i data-icon=\"pencil\"></i> Edit' : '+ Add Webhook'}</button>
          ${s.hasWebhook ? `<button class="btn-mini test" onclick="event.stopPropagation();quickTest('${esc(s.id)}')"><i data-icon=\"test-tube\"></i> Test</button>` : ''}
        </div>
      </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════
// RIGHT — Tabs + Summary + Logs + Tracked
// ═══════════════════════════════════════════════════
function renderTabs() {
  const el = document.getElementById('act-tabs');
  const tabs = [
    `<div class="act-tab ${selectedTab==='__all__'?'active':''}" onclick="selectTab('__all__')">
       All <span class="act-tab-count">${recent.length}</span>
     </div>`
  ];
  for (const s of servers) {
    if (!s.hasWebhook && !tracked[s.id]?.length) continue;
    const cR = recent.filter(r => r.server === s.id).length;
    const cT = (tracked[s.id] || []).length;
    tabs.push(
      `<div class="act-tab ${selectedTab===s.id?'active':''}" onclick="selectTab('${esc(s.id)}')">
         ${esc(s.display)}
         <span class="act-tab-count">${cR}/${cT}</span>
       </div>`
    );
  }
  el.innerHTML = tabs.join('');
}

function selectTab(serverId) {
  selectedTab = serverId;
  renderTabs();
  renderServers();  // to update .selected highlight
  renderActivity();
}

function renderActivity() {
  renderSummary();
  renderLog();
  renderTracked();
}

function renderSummary() {
  const el = document.getElementById('sum-strip');
  let counts = { SUCCESS:0, FAILURE:0, ABORTED:0, UNSTABLE:0 };
  let total = 0;
  let lastUpd = null;

  if (selectedTab === '__all__') {
    for (const s of servers) {
      total += s.trackedTotal || 0;
      for (const k of Object.keys(counts)) counts[k] += s.trackedCounts?.[k] || 0;
      if (s.trackedUpdated && (!lastUpd || s.trackedUpdated > lastUpd)) lastUpd = s.trackedUpdated;
    }
  } else {
    const s = servers.find(x => x.id === selectedTab);
    if (s) {
      total = s.trackedTotal || 0;
      counts = { ...counts, ...(s.trackedCounts || {}) };
      lastUpd = s.trackedUpdated;
    }
  }

  const fail = counts.FAILURE + counts.UNSTABLE;
  el.innerHTML = `
    <div class="sum-chip sum-total"><span class="num">${total}</span> tracked</div>
    <div class="sum-chip sum-success"><span class="num">${counts.SUCCESS}</span> success</div>
    <div class="sum-chip sum-fail"><span class="num">${fail}</span> fail</div>
    <div class="sum-chip sum-abort"><span class="num">${counts.ABORTED}</span> aborted</div>
    <span class="sum-time">${lastUpd ? '↻ ' + fmtTime(lastUpd) : 'ยังไม่ได้ tick'}</span>`;
}

function renderLog() {
  const el   = document.getElementById('log-list');
  const list = selectedTab === '__all__' ? recent : recent.filter(r => r.server === selectedTab);
  document.getElementById('log-count').textContent = `${list.length} items`;

  if (!list.length) {
    el.innerHTML = `<div class="log-empty">
      ยังไม่มีการแจ้งเตือน — รอเมื่อ job เปลี่ยน state ครั้งแรก
    </div>`;
    return;
  }

  el.innerHTML = list.map(r => {
    const dotCls = r.status === 'sent' ? 'dot-sent'
                 : r.status === 'failed' ? 'dot-failed' : 'dot-pending';
    return `
      <div class="log-row">
        <span class="log-dot ${dotCls}"></span>
        <span class="log-trans trans-${esc(r.transition)}">${esc((r.transition||'').replace('_',' '))}</span>
        <span class="log-job">
          ${selectedTab === '__all__' ? `<span class="server-tag">${esc(r.server)}</span>` : ''}
          ${esc(r.job)} <span style="color:var(--bmn-muted);font-weight:500">#${esc(r.buildNumber ?? '')}</span>
        </span>
        <span class="log-time">${esc(fmtTime(r.sent_at))}</span>
      </div>`;
  }).join('');
}

function renderTracked() {
  const el = document.getElementById('track-list');
  let rows = [];
  if (selectedTab === '__all__') {
    for (const [sid, jobs] of Object.entries(tracked)) {
      for (const j of jobs) rows.push({ ...j, server: sid });
    }
    const rank = { FAILURE:0, UNSTABLE:1, ABORTED:2, SUCCESS:3 };
    rows.sort((a,b) => (rank[a.result]??9)-(rank[b.result]??9)
                   || String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
    rows = rows.slice(0, 250);
  } else {
    rows = (tracked[selectedTab] || []).map(j => ({ ...j, server: selectedTab }));
  }
  if (!rows.length) {
    el.innerHTML = `<div class="log-empty">
      ยังไม่มี state — รอ tick แรก scan Jenkins เสร็จ · หรือ server ยัง PAUSED
    </div>`;
    return;
  }
  el.innerHTML = rows.map(j => {
    const nice = String(j.jobPath || '').replace(/\/job\//g, ' / ').replace(/^ \/ /, '').replace(/%20/g,' ');
    return `
      <div class="track-row">
        <span class="track-status ts-${esc(j.result)}">${esc(j.result)}</span>
        <span class="track-job" title="${esc(j.jobPath)}">${
          selectedTab === '__all__' ? `<span class="srv-prefix">${esc(j.server)} · </span>` : ''
        }${esc(nice)}</span>
        <span class="track-build">#${esc(j.buildNumber ?? '?')}</span>
        <span class="track-updated">${esc(fmtTime(j.updatedAt))}</span>
      </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════
// Actions
// ═══════════════════════════════════════════════════
async function quickToggle(serverId, on) {
  const res = await API.batchMonitorNoti.save(serverId, { enabled: on });
  if (!res?.ok) { toast(res?.data?.message || 'บันทึกไม่สำเร็จ', 'error'); loadAll(); return; }
  toast(on ? `${serverId} → ON` : `${serverId} → PAUSED`, 'ok');
  const s = servers.find(x => x.id === serverId);
  if (s) s.enabled = on;
  renderServers();
}

function mdOpen(serverId) {
  const s = servers.find(x => x.id === serverId);
  if (!s) return;
  mdServerId = serverId;
  document.getElementById('md-server-display').textContent = `${s.display}  ·  ${s.id}`;
  document.getElementById('md-enabled').checked = s.hasWebhook ? s.enabled : true;
  document.getElementById('md-url').value = '';
  document.getElementById('md-url').placeholder = s.hasWebhook
    ? `เดิม: ${s.webhookMasked}  (เว้นว่างเพื่อไม่เปลี่ยน)`
    : 'https://chat.googleapis.com/v1/spaces/…/messages?key=…&token=…';
  document.getElementById('modal-wrap').classList.add('open');
}
function mdClose() { document.getElementById('modal-wrap').classList.remove('open'); mdServerId = ''; }

async function mdSave() {
  if (!mdServerId) return;
  const enabled = document.getElementById('md-enabled').checked;
  const url = document.getElementById('md-url').value.trim();
  const s = servers.find(x => x.id === mdServerId);
  const body = { enabled };
  if (url) body.webhook_url = url;
  else if (!s?.hasWebhook && enabled) return toast('เปิดใช้งานต้องกรอก Webhook URL', 'warn');

  const res = await API.batchMonitorNoti.save(mdServerId, body);
  if (!res?.ok) return toast(res?.data?.message || 'บันทึกไม่สำเร็จ', 'error');
  toast('บันทึกแล้ว', 'ok');
  mdClose();
  loadAll();
}

async function mdTest() {
  if (!mdServerId) return;
  const url = document.getElementById('md-url').value.trim();
  const res = await API.batchMonitorNoti.test(mdServerId, url);
  if (res?.ok) toast('ส่ง test card สำเร็จ <i data-icon=\"check\"></i>', 'ok');
  else toast(res?.data?.message || 'ส่ง test ไม่สำเร็จ', 'error');
}

async function quickTest(serverId) {
  const res = await API.batchMonitorNoti.test(serverId, '');
  if (res?.ok) toast(`Test → ${serverId} <i data-icon=\"check\"></i>`, 'ok');
  else toast(res?.data?.message || 'ส่ง test ไม่สำเร็จ', 'error');
}

async function mdDelete() {
  if (!mdServerId) return;
  if (!confirm(`ลบ webhook config ของ ${mdServerId}?`)) return;
  const res = await API.batchMonitorNoti.delete(mdServerId);
  if (!res?.ok) return toast(res?.data?.message || 'ลบไม่สำเร็จ', 'error');
  toast('ลบแล้ว', 'ok');
  mdClose();
  loadAll();
}

function toast(msg, type = 'info') {
  const T = (typeof Toast !== 'undefined') ? Toast : null;
  if (!T) return console.log(`[${type}]`, msg);
  if (type === 'ok' || type === 'success') return T.success(msg);
  if (type === 'error' || type === 'err')  return T.error(msg);
  if (type === 'warn' || type === 'warning') return T.warning(msg);
  return T.info(msg);
}

loadAll();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "esc", { configurable: true, get: () => esc, set: (v) => { esc = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtBytes", { configurable: true, get: () => fmtBytes, set: (v) => { fmtBytes = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtTime", { configurable: true, get: () => fmtTime, set: (v) => { fmtTime = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadAll", { configurable: true, get: () => loadAll, set: (v) => { loadAll = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "mdClose", { configurable: true, get: () => mdClose, set: (v) => { mdClose = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "mdDelete", { configurable: true, get: () => mdDelete, set: (v) => { mdDelete = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "mdOpen", { configurable: true, get: () => mdOpen, set: (v) => { mdOpen = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "mdSave", { configurable: true, get: () => mdSave, set: (v) => { mdSave = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "mdTest", { configurable: true, get: () => mdTest, set: (v) => { mdTest = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "quickTest", { configurable: true, get: () => quickTest, set: (v) => { quickTest = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "quickToggle", { configurable: true, get: () => quickToggle, set: (v) => { quickToggle = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderActivity", { configurable: true, get: () => renderActivity, set: (v) => { renderActivity = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderLog", { configurable: true, get: () => renderLog, set: (v) => { renderLog = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderServers", { configurable: true, get: () => renderServers, set: (v) => { renderServers = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderStorage", { configurable: true, get: () => renderStorage, set: (v) => { renderStorage = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderSummary", { configurable: true, get: () => renderSummary, set: (v) => { renderSummary = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderTabs", { configurable: true, get: () => renderTabs, set: (v) => { renderTabs = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderTracked", { configurable: true, get: () => renderTracked, set: (v) => { renderTracked = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "selectTab", { configurable: true, get: () => selectTab, set: (v) => { selectTab = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toast", { configurable: true, get: () => toast, set: (v) => { toast = v; } }); } catch (e) {}
})();
