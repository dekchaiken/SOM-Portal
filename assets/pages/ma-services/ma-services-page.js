// ma-services — page script, extracted from ma-services.html.
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

// ── MA Overview: Active Pipeline strip ────────────────────────────────
  // Rendered from the `pipeline` field returned by /api/ma-services/jira-stats.php.
  window.MAPipeline = (function () {
    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const JIRA_BASE = 'https://truemoney.atlassian.net/browse/';

    function render(pipeline) {
      const card = $('ma-pipeline-card');
      if (!card) return;
      if (!pipeline || !pipeline.total) { card.style.display = 'none'; return; }
      card.style.display = '';
      $('ma-pl-todo').textContent   = pipeline.todo ?? 0;
      $('ma-pl-inprog').textContent = pipeline.inProgress ?? 0;
      $('ma-pl-total').textContent  = pipeline.total ?? 0;

      const items = pipeline.items || [];
      $('ma-pipeline-body').innerHTML = items.length
        ? items.map(it => {
            const isInProg = /in\s*progress/i.test(it.status || '');
            const dateShown = it.due || it.created || '—';
            return `
              <div class="ma-pl-row ${isInProg ? 'inprogress' : 'backlog'}">
                <a class="key" href="${JIRA_BASE}${esc(it.key)}" target="_blank" rel="noopener">${esc(it.key)}</a>
                <span class="status-pill">${esc(it.status || '—')}</span>
                <span class="summary" title="${esc(it.summary)}">${esc(it.summary)}</span>
                <span class="owner" title="due ${dateShown} · ${esc(it.owner)}">${esc(dateShown)} · ${esc(it.owner)}</span>
              </div>`;
          }).join('')
        : '<div style="padding:14px;text-align:center;color:var(--text-muted);font-size:11.5px">no active MAs</div>';
    }

    function toggle() {
      const card = $('ma-pipeline-card');
      if (card) card.classList.toggle('open');
    }

    return { render, toggle };
  })();
  

/* ── next inline block ── */


    if (!Auth.requireAuth()) { /* redirect */ }
    Auth.applyPageMode('ma-services'); // apply read/full mode from team config

    document.addEventListener('DOMContentLoaded', () => {
      Layout.render('ma-services');
      trackMaintenanceAction('view_ma_services');
    });

    // Permission check runs immediately so it works on both hard load and SPA nav.
    // On hard load: buttons are in .topbar-actions; Layout.render() moves them to pill with display intact.
    // On SPA nav: buttons are already in .tn-pill-actions when page scripts execute.
    (function _maApplyTopnavPerms() {
      const _u = Auth.getUser();
      const _viewAs = (typeof Auth !== 'undefined' && Auth._getViewAsTeam)
        ? Auth._getViewAsTeam()
        : null;
      const _effectiveTeam = ['super_admin', 'super_viewer'].includes(_u?.role)
        ? (_viewAs?.slug || null)
        : (_u?.team || null);
      const _isSM = _effectiveTeam === 'sm';
      if (_isSM) {
        const _btn = document.getElementById('btn-ma-test');
        if (_btn) _btn.style.display = 'inline-flex';
        // Monthly Overview: admin roles only (matches admin/ma-test-overview.html gate)
        if (['super_admin', 'sm_admin', 'sm_lead', 'dev_sm'].includes(_u?.role)) {
          const _btnOv = document.getElementById('btn-ma-test-overview');
          if (_btnOv) _btnOv.style.display = 'inline-flex';
        }
        // MA Planwork Kanban: admin-only (mirror the page's own gate)
        if (['super_admin', 'sm_admin', 'dev_sm'].includes(_u?.role)) {
          const _btnPw = document.getElementById('btn-ma-planwork');
          if (_btnPw) _btnPw.style.display = 'inline-flex';
        }
      }
    })();
  

/* ── next inline block ── */


  function masEnterModule(moduleId) {
    const chooser = document.getElementById('mas-split-chooser');
    if (!chooser || typeof showCategoryView !== 'function') {
      if (typeof showCategoryView === 'function') showCategoryView(moduleId);
      return;
    }
    const isUse = moduleId === 'usecases';
    const panel = chooser.querySelector(isUse ? '.mas-use' : '.mas-cut');
    if (!panel) { showCategoryView(moduleId); return; }

    const cover = document.createElement('div');
    cover.className = 'mas-cover' + (isUse ? '' : ' mas-from-right');
    cover.style.background = isUse
      ? 'linear-gradient(135deg,rgba(245,158,11,.2),rgba(245,158,11,.1))'
      : 'linear-gradient(135deg,rgba(59,130,246,.2),rgba(59,130,246,.1))';
    panel.appendChild(cover);
    cover.getBoundingClientRect();
    cover.classList.add('mas-sweep');

    chooser.classList.add(isUse ? 'mas-choosing-usecases' : 'mas-choosing-cutoffs');
    setTimeout(() => chooser.classList.add('mas-collapsing'), 260);
    setTimeout(() => {
      chooser.style.display = 'none';
      showCategoryView(moduleId);
    }, 600);
  }

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "masEnterModule", { configurable: true, get: () => masEnterModule, set: (v) => { masEnterModule = v; } }); } catch (e) {}
})();
