// admin/index — page script, extracted from admin/index.html.
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

  // Clock
  function tick() {
    document.getElementById('sysinfo-time').textContent =
      new Date().toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
  }
  tick(); setInterval(tick, 30000);

  // ── Stats ──
  async function loadStats() {
    const [usersRes, boardRes, tplRes, linksRes] = await Promise.all([
      API.users.list(), API.board.list(), API.templates.list(), API.links.list()
    ]);
    const set = (id, res) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.remove('loading');
      el.textContent = res?.ok ? (res.data.data || []).length : '—';
    };
    set('stat-users', usersRes);
    set('stat-posts', boardRes);
    set('stat-tpls',  tplRes);
    set('stat-links', linksRes);
    try {
      const weeksRes  = await fetch('../api/weekly-report/list.php');
      const weeksData = await weeksRes.json();
      const weeksEl   = document.getElementById('stat-weeks');
      if (weeksEl) {
        weeksEl.classList.remove('loading');
        weeksEl.textContent = weeksData?.ok ? (weeksData.weeks || []).length : '—';
      }
    } catch (e) { /* ignore */ }
  }
  loadStats();

  // ── Team Feature + Role Gate ──────────────────────────────────────────────
  // Hides cards / groups that either (a) require a feature the current scope
  // doesn't have, or (b) are restricted to a role the current user isn't
  // acting as. When super_admin has selected "view as TEAM", role gates for
  // super_admin are enforced too — so the preview matches what a team admin
  // would actually see.
  function applyFeatureGate() {
    const user         = Auth.getUser?.();
    const teamFeatures = Auth.getTeamFeatures?.();
    const isSuper      = user?.role === 'super_admin';
    // When super_admin picks a team in the View-as switcher, treat them as
    // that team's admin — so [data-team="sm"] cards should hide.
    const hasTeamCtx   = !!(function() {
      try { return sessionStorage.getItem('_admin_team_ctx'); } catch { return null; }
    })();
    const canSeeSuperOnly = isSuper && !hasTeamCtx;
    // Effective team for team-lock gating:
    //   super_admin, no view-as   → null  (All Teams, sees everything)
    //   super_admin, view-as X    → X
    //   any other user            → their own team
    const effectiveTeam = isSuper ? (hasTeamCtx ? sessionStorage.getItem('_admin_team_ctx') : null) : (user?.team || null);

    // Team-lock gate: cards with data-team="sm" show only when effective team
    // matches. Applies to SM-management pages (settings, maintenance, backup,
    // logs, trash, ops-runbook, knowledge-base, pw-schedule) so other teams'
    // admin view doesn't leak SM-only tools.
    document.querySelectorAll('.section-card[data-team]').forEach(card => {
      const req = card.dataset.team;
      if (effectiveTeam !== null && effectiveTeam !== req) {
        card.classList.add('feature-gated', 'card-hidden');
      }
    });

    // Legacy role gate for cards still using data-role="super_admin"
    // (kept for any card that means "platform-only, never per-team").
    document.querySelectorAll('.section-card[data-role]').forEach(card => {
      const req = card.dataset.role;
      if (req === 'super_admin' && !canSeeSuperOnly) {
        card.classList.add('feature-gated', 'card-hidden');
      }
    });

    // Feature gate — skip when scope has no feature list (super_admin, no ctx).
    if (teamFeatures !== null) {
      const features     = teamFeatures || [];
      const featurePages = Auth.getTeamFeaturePages?.() || {};

      // Helper: extract admin page id from a card's href
      // e.g. "./batch-monitor.html" → "batch-monitor"
      const pageIdFromHref = (href) => {
        if (!href) return '';
        const last = href.split(/[\/\\]/).pop() || '';
        return last.replace(/\.html.*$/i, '');
      };

      document.querySelectorAll('.section-group[data-features]').forEach(group => {
        const needed = (group.dataset.features || '').split(' ').filter(Boolean);
        const hasAny = needed.some(f => features.includes(f));
        if (!hasAny) group.classList.add('feature-gated', 'hidden');
      });

      document.querySelectorAll('.section-card[data-feature]').forEach(card => {
        const needed = (card.dataset.feature || '').split(' ').filter(Boolean);
        const hasAny = needed.some(f => features.includes(f));
        if (!hasAny) {
          card.classList.add('feature-gated', 'card-hidden');
          return;
        }
        // Per-admin-page grant check: if the team has an explicit page plan
        // for any of this card's features, verify the card's own admin page
        // is in that plan's admin_pages list. Skip when no plan is set
        // (no plan = all pages granted by default).
        const cardPage = pageIdFromHref(card.getAttribute('href'));
        if (!cardPage) return;
        for (const f of needed) {
          const plan = featurePages[f];
          if (!plan || !Array.isArray(plan.admin_pages)) continue; // no restriction
          if (!plan.admin_pages.includes(cardPage)) {
            card.classList.add('feature-gated', 'card-hidden');
            return;
          }
        }
      });
    }

    // Hide any group whose visible cards are all gated (keeps the layout clean
    // instead of showing an empty section header).
    document.querySelectorAll('.section-group').forEach(group => {
      if (group.classList.contains('feature-gated')) return;
      const cards = group.querySelectorAll('.section-card');
      if (!cards.length) return;
      const anyVisible = Array.from(cards).some(c => !c.classList.contains('feature-gated'));
      if (!anyVisible) group.classList.add('feature-gated', 'hidden');
    });

    // Rewrite hardcoded tab / module counts to reflect what's actually visible.
    updateTabCounts();
  }

  function updateTabCounts() {
    // Per-tab counts
    document.querySelectorAll('.admin-tab').forEach(tab => {
      const cat = tab.dataset.cat;
      const countEl = tab.querySelector('.tab-count');
      if (!countEl) return;
      let n;
      if (cat === 'all') {
        n = document.querySelectorAll('.section-card:not(.feature-gated)').length;
      } else {
        n = document.querySelectorAll(
          `.section-group[data-cat="${cat}"]:not(.feature-gated) .section-card:not(.feature-gated)`
        ).length;
      }
      countEl.textContent = n;
      // Also hide the tab if the whole group is gone (keeps the tab bar tidy).
      if (cat !== 'all' && n === 0) tab.style.display = 'none';
    });
    // Per-group "N modules" count in each section header
    document.querySelectorAll('.section-group:not(.feature-gated)').forEach(g => {
      const countEl = g.querySelector('.section-group-count');
      if (!countEl) return;
      const n = g.querySelectorAll('.section-card:not(.feature-gated)').length;
      countEl.textContent = `${n} module${n === 1 ? '' : 's'}`;
    });
  }
  applyFeatureGate();

  // ── Filter: tabs + search ──
  const allGroups = Array.from(document.querySelectorAll('.section-group[data-cat]'));
  const allCards  = Array.from(document.querySelectorAll('.section-card'));

  function applyFilter(cat, query) {
    const q = (query || '').toLowerCase().trim();
    let visibleCards = 0;

    allGroups.forEach(group => {
      if (group.classList.contains('feature-gated')) return; // locked by team feature
      const matchCat = (cat === 'all' || group.dataset.cat === cat);
      let groupHasVisible = false;

      group.querySelectorAll('.section-card').forEach(card => {
        if (card.classList.contains('feature-gated')) return; // skip feature-gated cards
        const inCat    = matchCat;
        const inSearch = !q || card.textContent.toLowerCase().includes(q);
        const show     = inCat && inSearch;
        card.classList.toggle('card-hidden', !show);
        if (show) { groupHasVisible = true; visibleCards++; }
      });

      group.classList.toggle('hidden', !groupHasVisible);
    });

    // Empty state
    const empty = document.getElementById('search-empty');
    empty.classList.toggle('show', visibleCards === 0 && q.length > 0);
    if (q) document.getElementById('search-query-label').textContent = query;

    // Results label
    const resultsEl = document.getElementById('filter-results');
    if (q) {
      resultsEl.style.display = '';
      resultsEl.textContent = `${visibleCards} result${visibleCards !== 1 ? 's' : ''}`;
    } else {
      resultsEl.style.display = 'none';
    }
  }

  // Tab clicks
  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      // Reset search when switching tabs
      const searchEl = document.getElementById('admin-search');
      searchEl.value = '';
      document.getElementById('search-clear').style.display = 'none';
      applyFilter(tab.dataset.cat, '');
    });
  });

  // Search input
  document.getElementById('admin-search').addEventListener('input', function() {
    const q = this.value;
    document.getElementById('search-clear').style.display = q ? '' : 'none';
    // Switch to "All" tab when searching
    if (q) {
      document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
      document.querySelector('[data-cat="all"]').classList.add('active');
    }
    const activeCat = q ? 'all' : (document.querySelector('.admin-tab.active')?.dataset.cat || 'all');
    applyFilter(activeCat, q);
  });

  document.getElementById('search-clear').addEventListener('click', () => {
    const searchEl = document.getElementById('admin-search');
    searchEl.value = '';
    searchEl.focus();
    document.getElementById('search-clear').style.display = 'none';
    applyFilter(document.querySelector('.admin-tab.active')?.dataset.cat || 'all', '');
  });

  // ── Integration Health ──
  async function loadHealth(fresh = false) {
    const grid    = document.getElementById('health-grid');
    const overall = document.getElementById('health-overall');
    const note    = document.getElementById('health-cache-note');
    grid.innerHTML = '<div class="health-empty">กำลังตรวจสอบ...</div>';
    overall.textContent = 'Checking...';
    overall.style.color = 'var(--text-muted)';

    const res = await API.health.check(fresh);
    if (!res?.ok) {
      grid.innerHTML = `<div class="health-empty">ตรวจสอบไม่ได้ — ${escHtml(res?.data?.message || 'Error')}</div>`;
      overall.textContent = 'Error';
      return;
    }

    const d       = res.data.data || {};
    const svcObj  = d.services || {};
    const services = [];
    if (svcObj.jira) services.push(svcObj.jira);
    if (Array.isArray(svcObj.jenkins)) {
      svcObj.jenkins.forEach(j => services.push({ name: j.display || j.id || 'Jenkins', ...j }));
    }

    if (services.length === 0) {
      grid.innerHTML = '<div class="health-empty">ยังไม่ได้ตั้งค่า Integration</div>';
      overall.textContent = 'No integrations';
      return;
    }

    const BAD     = ['error', 'timeout', 'not_configured', 'fail'];
    const anyFail = services.some(s => BAD.includes(s.status));
    overall.innerHTML = anyFail ? '<i data-icon="alert-triangle"></i> Degraded' : '<i data-icon="check"></i> All OK';
    overall.style.color = anyFail ? '#ef4444' : '#22c55e';

    grid.innerHTML = services.map(svc => {
      const ok   = svc.status === 'ok';
      const skip = svc.status === 'not_configured';
      const icon = ok ? '<i data-icon="check-circle"></i>' : skip ? '⏭' : '<i data-icon="x-circle"></i>';
      const bg   = ok ? 'rgba(34,197,94,.1)' : skip ? 'rgba(107,114,128,.1)' : 'rgba(239,68,68,.1)';
      const cls  = ok ? 'h-ok' : skip ? 'h-skip' : 'h-fail';
      const statusLabel = ok ? 'Online' : skip ? 'Not configured' : (svc.detail || svc.error || svc.status || 'Offline');
      const latency = svc.latency_ms != null ? `${svc.latency_ms}ms` : '';
      return `
        <div class="health-item">
          <div class="health-indicator" style="background:${bg}">${icon}</div>
          <div class="health-info">
            <div class="health-name">${escHtml(svc.name || '—')}</div>
            <div class="health-status ${cls}">${escHtml(statusLabel)}</div>
            ${latency ? `<div class="health-latency">${latency}</div>` : ''}
          </div>
        </div>`;
    }).join('');

    const ts = d.checked_at || res.data.data?.checked_at;
    if (ts) {
      note.textContent = `Checked at ${new Date(ts).toLocaleTimeString('th-TH')} — click Refresh for live check`;
    }
  }
  loadHealth();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "applyFeatureGate", { configurable: true, get: () => applyFeatureGate, set: (v) => { applyFeatureGate = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "applyFilter", { configurable: true, get: () => applyFilter, set: (v) => { applyFilter = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadHealth", { configurable: true, get: () => loadHealth, set: (v) => { loadHealth = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadStats", { configurable: true, get: () => loadStats, set: (v) => { loadStats = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "tick", { configurable: true, get: () => tick, set: (v) => { tick = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updateTabCounts", { configurable: true, get: () => updateTabCounts, set: (v) => { updateTabCounts = v; } }); } catch (e) {}
})();
