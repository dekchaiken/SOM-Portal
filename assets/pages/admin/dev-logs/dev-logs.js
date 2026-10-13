// admin/dev-logs — page script, extracted from admin/dev-logs.html.
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

// ── Auth gate: dev_sm only ─────────────────────────────────
Auth.requireAuth();
const _u = Auth.getUser?.();
if (_u && _u.role !== 'dev_sm') {
  window.location.replace('../index.html');
}

Layout.render('dev-logs');

// ── State ──────────────────────────────────────────────────
let _activeTab   = 'activity';
let _currentPage = 1;
let _totalItems  = 0;
let _allItems    = [];    // accumulated items across pages
let _debounceTimer = null;

// ── Helpers ────────────────────────────────────────────────
function fmtDateTime(ts) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString('th-TH', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    });
  } catch { return String(ts).replace('T', ' ').slice(0, 19); }
}

function truncDetail(detail, max) {
  if (!detail) return '';
  const s = typeof detail === 'string' ? detail : JSON.stringify(detail);
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function fullDetail(detail) {
  if (!detail) return '';
  if (typeof detail === 'string') return detail;
  try { return JSON.stringify(detail, null, 2); } catch { return String(detail); }
}

function debounceFetch() {
  clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(() => fetchLogs(true), 320);
}

function clearSearch() {
  document.getElementById('log-search').value = '';
  fetchLogs(true);
}

// ── Tab switch ─────────────────────────────────────────────
function switchTab(tab) {
  _activeTab = tab;
  _currentPage = 1;
  _allItems = [];
  document.querySelectorAll('.log-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  fetchLogs(true);
}

// ── Main fetch ─────────────────────────────────────────────
async function fetchLogs(reset) {
  if (reset) {
    _currentPage = 1;
    _allItems    = [];
  }

  const btn  = document.getElementById('btn-load');
  const list = document.getElementById('log-list');
  btn.disabled = true;

  if (reset) {
    list.innerHTML = '<div class="loading-row"><span class="spin"></span> กำลังโหลด logs…</div>';
    document.getElementById('load-more-row').style.display = 'none';
    document.getElementById('log-stats-bar').style.display = 'none';
  } else {
    document.getElementById('btn-more').disabled = true;
    document.getElementById('btn-more').textContent = '⏳ Loading…';
  }

  const limit  = parseInt(document.getElementById('log-limit').value, 10) || 100;
  const search = document.getElementById('log-search').value.trim();

  const params = {
    type:  _activeTab,
    limit: limit,
    page:  _currentPage,
  };
  if (search) params.search = search;

  const t0  = performance.now();
  const res = await API.logs.query(params);
  const ms  = Math.round(performance.now() - t0);

  btn.disabled = false;
  btn.innerHTML = '↺ Load / Refresh';

  if (!res?.ok) {
    list.innerHTML = `<div class="state-error">Error ${res?.status || ''}: ${escHtml(res?.data?.message || 'โหลด logs ไม่สำเร็จ')}</div>`;
    Toast.error('โหลด logs ไม่สำเร็จ');
    return;
  }

  const payload   = res.data?.data || res.data || {};
  const items     = payload.items || [];
  const total     = payload.total ?? items.length;

  _totalItems = total;
  _allItems   = reset ? items : [..._allItems, ...items];

  renderLogs(_allItems);
  updateStats(_allItems.length, total, _currentPage, ms);
  updateLoadMore(_allItems.length, total);
}

// ── Render log rows ────────────────────────────────────────
function renderLogs(items) {
  const list  = document.getElementById('log-list');
  const isSec = _activeTab === 'security';

  if (!items.length) {
    list.innerHTML = `<div class="state-empty">ไม่พบ log entries ที่ตรงกัน</div>`;
    return;
  }

  const rows = items.map((e, idx) => {
    const action = e.action || e.event || '';
    const ts     = fmtDateTime(e.ts);
    const user   = e.user_name || e.user_id || '—';
    const detail = e.detail;
    const shortD = escHtml(truncDetail(detail, 120));
    const fullD  = escHtml(fullDetail(detail));
    const rowCls = isSec ? 'log-row sec' : 'log-row';
    const acCls  = isSec ? 'lr-action sec' : 'lr-action act';
    const hasMore = fullDetail(detail).length > 120;
    const uid    = 'det-' + idx;

    return `<div class="${rowCls}">
      <div class="lr-ts">${escHtml(ts)}</div>
      <div class="lr-user" title="${escHtml(user)}">${escHtml(user)}</div>
      <div class="${acCls}">${escHtml(action)}</div>
      <div class="lr-detail">
        ${hasMore
          ? `<span class="detail-short" onclick="toggleDetail('${uid}')" title="คลิกเพื่อดูเพิ่มเติม">${shortD}</span>
             <pre class="detail-full" id="${uid}">${fullD}</pre>`
          : `<span>${shortD}</span>`
        }
      </div>
    </div>`;
  }).join('');

  list.innerHTML = rows;
}

function toggleDetail(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('expanded');
}

// ── Stats bar ──────────────────────────────────────────────
function updateStats(showing, total, page, ms) {
  const bar = document.getElementById('log-stats-bar');
  bar.style.display = 'flex';
  document.getElementById('stat-total').textContent   = total.toLocaleString();
  document.getElementById('stat-showing').textContent = showing.toLocaleString();
  document.getElementById('stat-page').textContent    = page;
  document.getElementById('log-meta-right').textContent = `${ms}ms`;
}

// ── Load more ──────────────────────────────────────────────
function updateLoadMore(showing, total) {
  const row  = document.getElementById('load-more-row');
  const info = document.getElementById('load-more-info');
  const btn  = document.getElementById('btn-more');

  if (showing < total) {
    row.style.display = 'flex';
    btn.disabled = false;
    btn.innerHTML = '<i data-icon="arrow-down"></i> Load More';
    info.textContent = `แสดง ${showing.toLocaleString()} จาก ${total.toLocaleString()} รายการ`;
  } else {
    row.style.display = showing > 0 ? 'flex' : 'none';
    btn.style.display = 'none';
    info.textContent  = showing > 0 ? `แสดงครบ ${showing.toLocaleString()} รายการ` : '';
  }
}

async function loadMore() {
  _currentPage++;
  await fetchLogs(false);
}

// ── Export ─────────────────────────────────────────────────
function exportLogs() {
  if (!_allItems.length) {
    Toast.warning('ไม่มีข้อมูลสำหรับ export');
    return;
  }
  const blob = new Blob(
    [JSON.stringify({ type: _activeTab, exported_at: new Date().toISOString(), total: _allItems.length, items: _allItems }, null, 2)],
    { type: 'application/json' }
  );
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  a.href     = url;
  a.download = `logs-${_activeTab}-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
  Toast.success(`Export ${_allItems.length} รายการ สำเร็จ`);
}

// ── Init ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  fetchLogs(true);
});

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "clearSearch", { configurable: true, get: () => clearSearch, set: (v) => { clearSearch = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "debounceFetch", { configurable: true, get: () => debounceFetch, set: (v) => { debounceFetch = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "exportLogs", { configurable: true, get: () => exportLogs, set: (v) => { exportLogs = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fetchLogs", { configurable: true, get: () => fetchLogs, set: (v) => { fetchLogs = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtDateTime", { configurable: true, get: () => fmtDateTime, set: (v) => { fmtDateTime = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fullDetail", { configurable: true, get: () => fullDetail, set: (v) => { fullDetail = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadMore", { configurable: true, get: () => loadMore, set: (v) => { loadMore = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderLogs", { configurable: true, get: () => renderLogs, set: (v) => { renderLogs = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "switchTab", { configurable: true, get: () => switchTab, set: (v) => { switchTab = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toggleDetail", { configurable: true, get: () => toggleDetail, set: (v) => { toggleDetail = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "truncDetail", { configurable: true, get: () => truncDetail, set: (v) => { truncDetail = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updateLoadMore", { configurable: true, get: () => updateLoadMore, set: (v) => { updateLoadMore = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updateStats", { configurable: true, get: () => updateStats, set: (v) => { updateStats = v; } }); } catch (e) {}
})();
