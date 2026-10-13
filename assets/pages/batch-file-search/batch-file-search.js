// batch-file-search — page script, extracted from batch-file-search.html.
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

Auth.requireAuth();
  // Access is now controlled by the `batch-file-search` feature grant (see
  // super-team-permissions.html); the sidebar hides the entry entirely for
  // teams without the grant. Any user landing here has been authorised.
  //
  // The "Manage index" CTA still belongs to SM — non-SM teams get search
  // access but not crawler-config access.
  //
  // View-as aware: when super_admin uses the .sa-team-ctx switcher to preview
  // team X, treat them as an X member (hide admin CTAs), so the previewed UI
  // matches what a real X user sees. Only "raw" super_admin (no view-as set)
  // sees the CTA.
  (function () {
    const u = Auth.getUser?.();
    if (!u) return;
    const viewAs = Auth._getViewAsTeam?.() || null;
    const effectiveTeam = viewAs?.slug || u.team;
    const isRawSuper    = u.role === 'super_admin' && !viewAs;
    if (effectiveTeam === 'sm' || isRawSuper) {
      const btn = document.getElementById('manage-index-btn');
      if (btn) btn.style.display = '';
    }
  })();
  Layout.render('batch-file-search');

  const input     = document.getElementById('lookup-input');
  const goBtn     = document.getElementById('lookup-go');
  const normPrev  = document.getElementById('norm-preview');
  const resultsEl = document.getElementById('results');

  input.addEventListener('input', () => {
    const raw = input.value.trim();
    if (!raw) { normPrev.textContent = ''; return; }
    const norm = raw.replace(/\d{6,}/g, '<N>');
    normPrev.innerHTML = 'Normalized: <b style="color:var(--text);">' + escHtml(norm) + '</b>';
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) doLookup();
  });

  function clearAll() {
    input.value = '';
    normPrev.textContent = '';
    resultsEl.innerHTML = '';
    input.focus();
  }

  async function doLookup() {
    const raw = input.value.trim();
    if (!raw) { Toast.error('พิมพ์ชื่อไฟล์ก่อนครับ'); return; }

    goBtn.disabled = true;
    const original = goBtn.textContent;
    goBtn.textContent = 'Searching…';
    resultsEl.innerHTML = '<div class="sn-empty"><div class="sn-empty-title">Searching…</div></div>';

    const res = await API.batchFileIndex.lookup(raw);
    goBtn.disabled = false;
    goBtn.textContent = original;

    if (!res?.ok || !res.data?.success) {
      Toast.error(res?.data?.message || 'Lookup failed');
      resultsEl.innerHTML = '<div class="sn-empty"><div class="sn-empty-title" style="color:#dc2626;">Lookup failed</div><div class="sn-empty-desc">' + escHtml(res?.data?.message || 'unknown error') + '</div></div>';
      return;
    }

    renderResults(res.data.data || {});
  }

  function renderResults(d) {
    const matches = d.matches || [];
    const summary = `
      <div class="sn-result-summary">
        <div>Normalized: <b class="sn-mono">${escHtml(d.normalized || '')}</b></div>
        <div>Total matches: <b>${d.total ?? 0}</b></div>
        <div>Index size: <b>${(d.index_size ?? 0).toLocaleString()}</b> patterns</div>
        ${d.tier ? `<div>Best tier: ${badgeForTier(d.tier)}</div>` : ''}
      </div>
    `;

    if (!matches.length) {
      resultsEl.innerHTML = summary + `
        <div class="sn-card">
          <div class="sn-empty">
            <div class="sn-empty-icon">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="8" x2="14" y1="11" y2="11"/></svg>
            </div>
            <div class="sn-empty-title">ไม่พบ match ใน index</div>
            <div class="sn-empty-desc">
              อาจเพราะ (1) job ยังไม่ได้ index บน server ที่ครอบคลุมไฟล์นี้ ·
              (2) log ของ job ไม่ได้พิมพ์ชื่อไฟล์ออกมา ·
              (3) format ชื่อไฟล์ต่างจาก log จริง<br><br>
              ลอง: crawl+index server เพิ่มที่ <b>Admin → Batch File Index</b> หรือลบส่วน date/ID ในชื่อก่อนค้น
            </div>
          </div>
        </div>
      `;
      return;
    }

    const rows = matches.map(m => renderMatchRow(m)).join('');
    resultsEl.innerHTML = summary + `<div class="sn-result-list">${rows}</div>`;
  }

  function renderMatchRow(m) {
    const e   = m.entry || {};
    const bm  = m.batch_meta || null;
    return `
      <div class="sn-result-row">
        <div class="sn-result-head">
          ${badgeForTier(m.confidence, m.score)}
          <div class="sn-result-title">${escHtml(e.job_name || '(unknown job)')}</div>
          <span class="sn-badge">${escHtml(e.server_display || e.server_id || '')}</span>
        </div>
        <div class="sn-result-meta">
          <span>Key: <b class="sn-mono">${escHtml(m.pattern || '')}</b></span>
          <span>Last: <b>#${e.last_seen_build ?? '—'}</b>, ${e.last_seen_at ? fmtRelTime(e.last_seen_at) : '—'}</span>
          ${e.first_seen_at ? `<span>First: ${fmtRelTime(e.first_seen_at)}</span>` : ''}
        </div>
        ${bm ? `
          <div class="sn-result-batch">
            ${bm.dev_owner  ? `<div><b>Dev owner:</b> ${escHtml(bm.dev_owner)}</div>` : ''}
            ${bm.sm_rerun   ? `<div><b>SM rerun:</b> ${escHtml(bm.sm_rerun)}</div>` : ''}
            ${bm.category   ? `<div><b>Category:</b> ${escHtml(bm.category)}</div>` : ''}
            ${bm.note       ? `<div><b>Note:</b> ${escHtml(bm.note)}</div>` : ''}
          </div>
        ` : ''}
        ${e.log_snippet ? `<div class="sn-result-snippet">${escHtml(e.log_snippet)}</div>` : ''}
        <div class="sn-result-actions">
          ${e.job_url ? `<a class="sn-btn sn-btn-outline sn-btn-sm" href="${escAttr(e.job_url)}" target="_blank" rel="noopener">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/></svg>
            Open Jenkins
          </a>` : ''}
          ${bm?.manual_url && bm.manual_url !== e.job_url ? `<a class="sn-btn sn-btn-ghost sn-btn-sm" href="${escAttr(bm.manual_url)}" target="_blank" rel="noopener">Manual URL</a>` : ''}
          ${e.raw_sample ? `<button class="sn-btn sn-btn-ghost sn-btn-sm" onclick="navigator.clipboard.writeText(this.dataset.raw); Toast.success('Copied raw sample');" data-raw="${escAttr(e.raw_sample)}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
            Copy sample
          </button>` : ''}
        </div>
      </div>
    `;
  }

  function badgeForTier(tier, score) {
    const map = { exact: 'green', partial: 'blue', fuzzy: 'amber' };
    const cls = map[tier] || '';
    const label = tier.charAt(0).toUpperCase() + tier.slice(1);
    return `<span class="sn-badge sn-badge-${cls}">${label}${score ? ' · ' + score : ''}</span>`;
  }

  function fmtRelTime(iso) {
    const t = new Date(iso).getTime(); if (!t) return iso;
    const s = Math.floor((Date.now() - t) / 1000);
    if (s < 60)    return s + 's ago';
    if (s < 3600)  return Math.floor(s/60)  + 'm ago';
    if (s < 86400) return Math.floor(s/3600)+ 'h ago';
    return Math.floor(s/86400) + 'd ago';
  }

  function escHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function escAttr(s) { return escHtml(s).replace(/`/g, '&#96;'); }

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "badgeForTier", { configurable: true, get: () => badgeForTier, set: (v) => { badgeForTier = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "clearAll", { configurable: true, get: () => clearAll, set: (v) => { clearAll = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "doLookup", { configurable: true, get: () => doLookup, set: (v) => { doLookup = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "escAttr", { configurable: true, get: () => escAttr, set: (v) => { escAttr = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "escHtml", { configurable: true, get: () => escHtml, set: (v) => { escHtml = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtRelTime", { configurable: true, get: () => fmtRelTime, set: (v) => { fmtRelTime = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderMatchRow", { configurable: true, get: () => renderMatchRow, set: (v) => { renderMatchRow = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderResults", { configurable: true, get: () => renderResults, set: (v) => { renderResults = v; } }); } catch (e) {}
})();
