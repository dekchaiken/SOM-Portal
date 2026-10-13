// admin/mail-logs — page script, extracted from admin/mail-logs.html.
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
Layout.render('mail-logs');

const LIMIT = 50;
let _offset = 0;
let _total  = 0;
let _searchTimer = null;

function schedSearch() {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(() => { _offset = 0; load(); }, 300);
}

async function load() {
  const search = document.getElementById('f-search').value.trim();
  const status = document.getElementById('f-status').value;

  const res = await API.mail.getLogs({ search, status, limit: LIMIT, offset: _offset });
  if (!res?.ok) { Toast.error('โหลดไม่ได้'); return; }

  const d = res.data.data;
  _total = d.total;

  document.getElementById('stat-total').textContent  = d.total;
  document.getElementById('stat-today').textContent  = d.today;
  document.getElementById('stat-failed').textContent = d.failed;

  renderTable(d.logs);
  renderPagination();
}

function renderTable(logs) {
  const tbody = document.getElementById('ml-tbody');
  if (!logs.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="ml-empty"><div class="ml-empty-icon"><i data-icon="mail"></i></div>ไม่มีรายการ</td></tr>`;
    return;
  }
  tbody.innerHTML = logs.map(l => {
    const toList  = (l.to || []);
    const toLabel = toList[0] || '—';
    const toMore  = toList.length > 1 ? `<span class="ml-to-more">+${toList.length - 1} more</span>` : '';
    const badge   = l.status === 'sent'
      ? `<span class="ml-badge sent"><span class="ml-badge-dot"></span>Sent</span>`
      : `<span class="ml-badge failed"><span class="ml-badge-dot"></span>Failed</span>`;
    const errRow  = l.error ? `<div class="ml-error"><i data-icon="alert-triangle"></i> ${escHtml(l.error)}</div>` : '';
    return `<tr>
      <td style="white-space:nowrap">${fmtDt(l.sent_at)}</td>
      <td><span class="ml-to">${escHtml(toLabel)}</span>${toMore}</td>
      <td>${escHtml(l.subject || '—')}${errRow}</td>
      <td><span class="ml-type">${escHtml(l.type || '—')}</span></td>
      <td>${badge}</td>
      <td>${escHtml(l.sent_by_name || l.sent_by || '—')}</td>
    </tr>`;
  }).join('');
}

function renderPagination() {
  const pag = document.getElementById('ml-pagination');
  if (_total <= LIMIT) { pag.style.display = 'none'; return; }
  pag.style.display = '';
  const from = _offset + 1;
  const to   = Math.min(_offset + LIMIT, _total);
  document.getElementById('pag-info').textContent   = `${from}–${to} of ${_total}`;
  document.getElementById('btn-prev').disabled      = _offset === 0;
  document.getElementById('btn-next').disabled      = _offset + LIMIT >= _total;
}

function pagePrev() { if (_offset > 0) { _offset = Math.max(0, _offset - LIMIT); load(); } }
function pageNext() { if (_offset + LIMIT < _total) { _offset += LIMIT; load(); } }

function fmtDt(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('th-TH', { day:'numeric', month:'short', year:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit' });
}

load();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "fmtDt", { configurable: true, get: () => fmtDt, set: (v) => { fmtDt = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "load", { configurable: true, get: () => load, set: (v) => { load = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "pageNext", { configurable: true, get: () => pageNext, set: (v) => { pageNext = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "pagePrev", { configurable: true, get: () => pagePrev, set: (v) => { pagePrev = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderPagination", { configurable: true, get: () => renderPagination, set: (v) => { renderPagination = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderTable", { configurable: true, get: () => renderTable, set: (v) => { renderTable = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "schedSearch", { configurable: true, get: () => schedSearch, set: (v) => { schedSearch = v; } }); } catch (e) {}
})();
