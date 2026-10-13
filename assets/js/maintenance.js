/* ══════════════════════════════════════════════════
   maintenance.js  |  Real-time MA checker
   Auto-runs on every non-admin page.
   Polls /api/maintenance/ every 10s.
   - Page overlay covers only .page-content (sidebar stays usable)
   - Sidebar nav badges show which pages are in MA
   Exposes: window.Maintenance = { tools, pages, global }
   ══════════════════════════════════════════════════ */

(function () {
  // On admin pages: don't apply overlays/redirects (admin handles its own UI),
  // but still update sidebar badges so admins see which pages are in MA.
  const _isAdminPage = window.location.pathname.includes('/admin/');

  const POLL_MS = 10_000;

  // Derive app root from current URL — works with any deploy folder name.
  function _basePath() {
    return window.location.pathname
      .replace(/\/(?:admin|assets)\/.*$/i, '')
      .replace(/\/[^\/]*\.html?$/i, '')
      .replace(/\/+$/, '');
  }

  // Derive page ID from URL (board.html → "board")
  const _pageId = window.location.pathname.split('/').pop().replace('.html', '') || 'index';

  // Some logical "pages" map to multiple HTML files — resolve to canonical MA id
  const PAGE_ALIAS = {
    'learn-course':       'learn',
    'learn-phase':        'learn',
    'weekly-report-form': 'weekly-report',
  };
  const _maPageId = PAGE_ALIAS[_pageId] || _pageId;

  // Public state accessible by pages
  window.Maintenance = { tools: {}, pages: {}, global: { active: false } };

  // Page-ID → filename mapping for sidebar badge matching.
  // Keep in sync with the PAGES array in admin/maintenance.html.
  const PAGE_FILES = {
    // Operations
    'board':                 'board.html',
    'jira-templates':        'jira-templates.html',
    'case-incidents':        'case-incidents.html',
    'send-email':            'send-email.html',
    'inbox':                 'inbox.html',
    'monitoring':            'monitoring.html',
    'batch-monitor':         'batch-monitor.html',
    'batch-file-search':     'batch-file-search.html',
    'test-service':          'test-service.html',
    'ops-runbook':           'ops-runbook.html',
    'ma-services':           'ma-services.html',
    'pw-schedule':           'pw-schedule.html',
    'restart-monitor':       'restart-monitor.html',
    'restart-analyzer':      'restart-analyzer.html',
    'service-performance':   'service-performance.html',
    'log-explorer':          'log-explorer.html',
    'alert-monitor':         'alert-monitor.html',
    'grafana-alerts':        'grafana-alerts.html',
    'uptime':                'uptime.html',
    'sms-gateway-switches':  'sms-gateway-switches.html',
    'syncup':                'syncup.html',
    'begin-grafana':         'begin-grafana.html',
    'ma-test':               'ma-test.html',
    // Analytics & Reports
    'dashboard':             'dashboard.html',
    'analytics':             'analytics.html',
    'report':                'report.html',
    'weekly-report':         'weekly-report.html',
    'report-center':         'report-center.html',
    // Knowledge & Collaboration
    'knowledge-base':        'knowledge-base.html',
    'learn':                 'learn.html',
    'exam':                  'exam.html',
    'onboarding':            'onboarding.html',
    'schedule':              'schedule.html',
    'sheets':                'sheets.html',
    'office':                'office.html',
    'sabai':                 'sabai.html',
    // Automation
    'incident-launcher':     'incident-launcher.html',
    'migrate-user':          'migrate-user.html',
    // GenZ
    'genz-hub':              'genz-hub.html',
    'genz-notes':            'genz-notes.html',
    // Info
    'about-som':             'about-som.html',
    'my-team':               'my-team.html',
    // Others
    'presentation':          'presentation.html',
    'viewer':                'viewer.html',
    'profile':               'profile.html',
    'fundout-callback':      'fundout-callback.html',
    'setup-guide':           'setup-guide.html',
  };

  // ── Build API URL ─────────────────────────────────────────────────────────────
  function _apiUrl() {
    return _basePath() + '/api/maintenance/index.php';
  }

  // ── Fetch MA state ────────────────────────────────────────────────────────────
  async function fetchMA() {
    try {
      const res = await fetch(_apiUrl(), { cache: 'no-store' });
      if (!res.ok) return null;
      const json = await res.json();
      return json?.data ?? null;
    } catch { return null; }
  }

  // ── Apply MA state ────────────────────────────────────────────────────────────
  function applyMA(ma) {
    if (!ma) return;

    window.Maintenance.global = ma.global || { active: false };
    window.Maintenance.pages  = ma.pages  || {};
    window.Maintenance.tools  = ma.tools  || {};

    const user    = _getUser();
    const isAdmin = ['sm_admin', 'dev_sm', 'super_admin'].includes(user?.role);

    // 1. Global MA → redirect non-admins (skip on admin pages — admin handles its own)
    if (!_isAdminPage && ma.global?.active && !isAdmin) {
      if (!window.location.pathname.endsWith('maintenance.html'))
        window.location.replace(_basePath() + '/maintenance.html');
      return;
    }

    // 2. Page MA → overlay (skip on admin pages)
    if (!_isAdminPage) {
      const pageState = ma.pages?.[_maPageId];
      if (pageState?.active && !isAdmin) {
        showPageOverlay(pageState.message || 'หน้านี้ปิดปรับปรุงชั่วคราว');
      } else {
        hidePageOverlay();
      }
    }

    // 3. Sidebar + topnav badges — ALWAYS run (admin pages too)
    const _activeFiles = _buildActiveFiles(ma.pages || {});
    updateSidebarBadges(ma.pages || {});
    // Topnav is called directly here (not via sidebar) so it works in topnav mode
    // where .sidebar-nav doesn't exist and updateSidebarBadges never completes.
    updateTopnavBadges(_activeFiles);

    // 4. Expose tool state via event
    document.dispatchEvent(new CustomEvent('ma:update', { detail: ma }));
  }

  // ── Get user ──────────────────────────────────────────────────────────────────
  function _getUser() {
    try { return JSON.parse(localStorage.getItem('som_user')); } catch { return null; }
  }

  // ── Styles (injected once) ────────────────────────────────────────────────────
  function ensureStyles() {
    if (document.getElementById('_ma-styles')) return;
    const s = document.createElement('style');
    s.id = '_ma-styles';
    s.textContent = `
      /* ── Page-content overlay (does NOT cover sidebar) ── */
      #ma-overlay {
        position: absolute; inset: 0; z-index: 200;
        background: rgba(10,10,12,.75);
        backdrop-filter: blur(5px);
        -webkit-backdrop-filter: blur(5px);
        display: flex; align-items: center; justify-content: center;
        opacity: 0; transition: opacity .28s;
        pointer-events: none;
        border-radius: inherit;
      }
      #ma-overlay.visible {
        opacity: 1; pointer-events: all;
      }
      #ma-card {
        background: var(--bg-card, #1a1a1f);
        border: 1px solid rgba(242,100,25,.22);
        border-radius: 18px;
        padding: 36px 40px;
        max-width: 380px; width: 88%;
        text-align: center;
        box-shadow: 0 20px 56px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.04);
      }
      .ma-icon-wrap {
        width: 62px; height: 62px; border-radius: 18px;
        background: rgba(242,100,25,.09);
        border: 1.5px solid rgba(242,100,25,.18);
        display: flex; align-items: center; justify-content: center;
        margin: 0 auto 18px; font-size: 28px;
        will-change: transform;
        animation: ma-float 2.4s ease-in-out infinite;
      }
      @keyframes ma-float {
        0%,100% { transform: translateY(0)    scale(1);    }
        50%      { transform: translateY(-6px) scale(1.04); }
      }
      .ma-title {
        font-size: 15px; font-weight: 800; letter-spacing: -.01em;
        color: var(--text, #f0f0f0); margin-bottom: 8px;
      }
      .ma-msg {
        font-size: 12px; color: var(--text-muted, #888);
        line-height: 1.65; margin-bottom: 16px;
      }
      .ma-pill {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 5px 12px; border-radius: 20px;
        background: rgba(242,100,25,.08);
        border: 1px solid rgba(242,100,25,.18);
        font-size: 10px; font-weight: 700; color: #f26419;
      }
      .ma-pill::before {
        content: ''; width: 6px; height: 6px; border-radius: 50%;
        background: #f26419; animation: ma-blink 1.2s ease-in-out infinite;
      }
      @keyframes ma-blink { 0%,100%{opacity:1} 50%{opacity:.25} }

      /* ── Sidebar MA indicator (minimal) ── */

      /* Subtle warm tint on row + dim label */
      .nav-item.nav-ma-active {
        background: rgba(245,158,11,.04) !important;
      }
      .nav-item.nav-ma-active > span:not(.nav-icon-wrap):not(.nav-ma-tag) {
        opacity: .6;
      }

      /* Wrap .nav-icon to position the dot on its corner */
      .nav-icon-wrap {
        position: relative;
        display: inline-flex;
        flex-shrink: 0;
      }

      /* Amber pulsing dot — primary MA indicator */
      .nav-ma-dot {
        position: absolute;
        top: -2px; right: -3px;
        width: 7px; height: 7px;
        border-radius: 50%;
        background: #f59e0b;
        border: 1.5px solid var(--bg-sidebar, #1A1A1A);
        animation: ma-dot-pulse 2s ease-in-out infinite;
      }
      @keyframes ma-dot-pulse {
        0%, 100% { box-shadow: 0 0 0 0   rgba(245,158,11,.7); }
        55%       { box-shadow: 0 0 0 5px rgba(245,158,11,0);  }
      }

      /* Minimal end-tag: just a small wrench icon, no text — full text in tooltip */
      .nav-ma-tag {
        display: inline-flex; align-items: center; justify-content: center;
        margin-left: auto;
        width: 18px; height: 18px;
        border-radius: 5px;
        font-size: 10px;
        color: #f59e0b;
        background: rgba(245,158,11,.10);
        flex-shrink: 0;
        cursor: help;
        transition: background .18s, transform .18s;
      }
      .nav-ma-tag::before { content: '<i data-icon="settings"></i>'; display: inline-block; }
      .nav-item:hover .nav-ma-tag {
        background: rgba(245,158,11,.18);
        transform: rotate(45deg);
      }
    `;
    document.head.appendChild(s);
  }

  // ── Page-content overlay ──────────────────────────────────────────────────────
  function showPageOverlay(msg) {
    ensureStyles();

    // .main-content must form a stacking context below the sidebar (z-index:100)
    // so the overlay cannot bleed over the sidebar even at high z-index values
    const mainContent = document.querySelector('.main-content');
    if (mainContent && !mainContent.dataset.maCtx) {
      mainContent.style.position = 'relative';
      mainContent.style.zIndex   = '1';
      mainContent.dataset.maCtx  = '1';
    }

    // Overlay lives inside .page-content so sidebar remains clickable
    const container = document.querySelector('.page-content') || document.body;
    if (getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }

    let el = document.getElementById('ma-overlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ma-overlay';
      el.innerHTML = `
        <div id="ma-card">
          <div class="ma-icon-wrap"><i data-icon="wrench"></i></div>
          <div class="ma-title">Maintenance Mode</div>
          <div class="ma-msg" id="ma-msg-text"></div>
          <div class="ma-pill">Maintenance in progress</div>
        </div>`;
      container.appendChild(el);
    }

    document.getElementById('ma-msg-text').textContent = msg;
    requestAnimationFrame(() => el.classList.add('visible'));
  }

  function hidePageOverlay() {
    const el = document.getElementById('ma-overlay');
    if (el) {
      el.classList.remove('visible');
      // Remove from DOM after transition so it doesn't block clicks when inactive
      setTimeout(() => { if (!el.classList.contains('visible')) el.remove(); }, 300);
    }
  }

  // ── Build set of active MA filenames ─────────────────────────────────────────
  function _buildActiveFiles(pages) {
    const s = new Set();
    Object.entries(pages).forEach(([id, state]) => {
      if (state?.active && PAGE_FILES[id]) s.add(PAGE_FILES[id]);
    });
    return s;
  }

  // ── Sidebar badges ────────────────────────────────────────────────────────────
  function updateSidebarBadges(pages, retry = 0) {
    ensureStyles();

    // Wait for sidebar to be rendered (layout.js may still be running)
    const nav = document.querySelector('.sidebar-nav');
    if (!nav) {
      if (retry < 10) setTimeout(() => updateSidebarBadges(pages, retry + 1), 300);
      return;
    }

    const activeFiles = _buildActiveFiles(pages);

    // Walk all nav-items and add/remove MA indicators
    nav.querySelectorAll('a.nav-item').forEach(link => {
      const href     = link.getAttribute('href') || '';
      const filename = href.split('/').pop().split('?')[0];
      const inMA     = activeFiles.has(filename);

      link.classList.toggle('nav-ma-active', inMA);

      const iconEl = link.querySelector('.nav-icon');
      if (!iconEl) return;

      if (inMA) {
        // 1. Wrap .nav-icon for dot positioning (only once)
        if (!iconEl.parentElement.classList.contains('nav-icon-wrap')) {
          const wrap = document.createElement('span');
          wrap.className = 'nav-icon-wrap';
          iconEl.parentNode.insertBefore(wrap, iconEl);
          wrap.appendChild(iconEl);
        }
        // 2. Amber pulsing dot on icon corner (only once)
        if (!iconEl.parentElement.querySelector('.nav-ma-dot')) {
          const dot = document.createElement('span');
          dot.className = 'nav-ma-dot';
          iconEl.parentElement.appendChild(dot);
        }
        // 3. Minimal wrench icon end-tag — text moved to tooltip
        if (!link.querySelector('.nav-ma-tag')) {
          const tag = document.createElement('span');
          tag.className = 'nav-ma-tag';
          tag.title = 'หน้านี้กำลัง Maintenance อยู่';
          link.appendChild(tag);
        }
      } else {
        // Unwrap icon and remove all MA indicators
        const wrap = iconEl.closest('.nav-icon-wrap');
        if (wrap) {
          wrap.parentNode.insertBefore(iconEl, wrap);
          wrap.remove();
        }
        link.querySelector('.nav-ma-dot')?.remove();
        link.querySelector('.nav-ma-tag')?.remove();
      }
    });

  }

  // ── Topnav MA indicators — style: Banner + amber tint + MA badge chip ────────
  // Works across all 4 nav styles: Horizon, Capsule, Command, Vision.
  function updateTopnavBadges(activeFiles, retry = 0) {
    const topnav = document.querySelector('#topnav-wrap');
    if (!topnav) {
      if (retry < 12) setTimeout(() => updateTopnavBadges(activeFiles, retry + 1), 300);
      return;
    }

    _injectTnMaCSS();

    // ── 1. Dropdown items (Horizon / Capsule / Vision share same .tn-dd structure) ──
    topnav.querySelectorAll('a.tn-dd-item[href]').forEach(link => {
      const filename = link.getAttribute('href').split('/').pop().split('?')[0];
      const inMA     = activeFiles.has(filename);

      link.classList.toggle('tn-dd-item-ma', inMA);
      link.querySelector('.tn-ma-badge')?.remove();

      if (inMA) {
        const badge = document.createElement('span');
        badge.className = 'tn-ma-badge';
        badge.textContent = 'MA';
        badge.title = 'หน้านี้กำลัง Maintenance อยู่';
        link.appendChild(badge);
      }
    });

    // ── 2. Group dropdowns (.tn-dd) — banner inside the menu only ──────────────
    //     The group BUTTON deliberately carries no MA indicator. It used to get an
    //     amber tint (.tn-link-ma) and a count chip (.tn-grp-ma-count), which broke
    //     the navbar in two ways:
    //       • the tint was declared with !important, so it overrode both the
    //         :hover feedback and the .tn-link-active orange — a group holding an
    //         MA page looked identical hovered, idle and selected;
    //       • the count chip widened the button *after* Layout._positionTopNavPill()
    //         had already measured it (MA state arrives from an async fetch), so the
    //         sliding active pill stayed ~22px short of the button it tracks.
    //     MA is still fully visible: each affected item keeps its dimmed style and
    //     "MA" chip, and the dropdown shows a summary banner at the top.
    topnav.querySelectorAll('.tn-dd').forEach(ddWrap => {
      const count     = ddWrap.querySelectorAll('a.tn-dd-item-ma').length;
      const btn       = ddWrap.querySelector('button.tn-link');
      const menuInner = ddWrap.querySelector('.tn-dd-menu-inner');
      if (!btn) return;

      // Clean up indicators from a previous run — including the two the button no
      // longer gets, so a cached older version leaves nothing behind.
      btn.querySelector('.tn-grp-ma-count')?.remove();
      btn.classList.remove('tn-link-ma');
      menuInner?.querySelector('.tn-ma-banner')?.remove();

      if (count > 0 && menuInner) {
        const banner = document.createElement('div');
        banner.className = 'tn-ma-banner';
        banner.innerHTML = `<span class="tn-ma-banner-dot"></span>${count} หน้ากำลังปิดปรับปรุง`;
        menuInner.insertBefore(banner, menuInner.firstChild);
      }
    });

    // ── 3. Command style — center tabs (.tn-ctx-tab) ──────────────────────────
    // Command uses tabs linking directly to pages, no dropdown —
    // check each tab's href against active MA pages, tint the tab.
    topnav.querySelectorAll('.tn-ctx-tab[href]').forEach(tab => {
      const filename = tab.getAttribute('href').split('/').pop().split('?')[0];
      const inMA     = activeFiles.has(filename);
      tab.classList.toggle('tn-ctx-tab-ma', inMA);
      tab.querySelector('.tn-ma-badge')?.remove();
      if (inMA) {
        const badge = document.createElement('span');
        badge.className = 'tn-ma-badge';
        badge.textContent = 'MA';
        tab.appendChild(badge);
      }
    });
    // For Command: also tint the group tab if ANY page in that group is in MA.
    // The group tabs navigate to the first page in their group — check via
    // data-tn-grp, cross-reference with dropdown items elsewhere.
    topnav.querySelectorAll('.tn-cmd-center .tn-ctx-tab[data-tn-grp]').forEach(tab => {
      const grpId = tab.dataset.tnGrp;
      // Find matching .tn-dd items from another nav style if present — or
      // check if any visible dropdown item with this group is in MA.
      const ddWrap = topnav.querySelector(`.tn-dd [data-tn-grp="${grpId}"]`)
                  || topnav.querySelector(`.tn-dd`);
      // Simpler: count MA items in the corresponding dropdown (built by layout.js)
      const grpDD = topnav.querySelector(`.tn-dd button[data-tn-grp="${grpId}"]`)?.closest('.tn-dd');
      if (!grpDD) return;
      const maCount = grpDD.querySelectorAll('a.tn-dd-item-ma').length;
      tab.classList.toggle('tn-ctx-tab-ma', maCount > 0);
      tab.querySelector('.tn-grp-ma-count')?.remove();
      if (maCount > 0) {
        const c = document.createElement('span');
        c.className = 'tn-grp-ma-count';
        c.textContent = maCount;
        tab.appendChild(c);
      }
    });

    // MA state arrives from an async fetch, i.e. after Layout has already measured
    // and placed the sliding active pill. Anything above that changes a nav item's
    // width would leave the pill sized for the old layout, so re-measure now.
    // (Harmless when nothing changed — it just writes the same numbers back.)
    if (typeof Layout !== 'undefined' && typeof Layout._positionTopNavPill === 'function') {
      requestAnimationFrame(() => Layout._positionTopNavPill(false));
    }
  }

  // ── Inject CSS once ───────────────────────────────────────────────────────────
  function _injectTnMaCSS() {
    if (document.getElementById('_tn-ma-css')) return;
    const s = document.createElement('style');
    s.id = '_tn-ma-css';
    s.textContent = `
      /* ── MA item: dim + no-click ── */
      .tn-dd-item-ma {
        opacity: .5;
        cursor: default;
        pointer-events: none;
      }
      .tn-dd-item-ma:hover { background: transparent !important; }

      /* ── MA badge chip on item ── */
      .tn-ma-badge {
        display: inline-flex; align-items: center;
        font-size: 8.5px; font-weight: 800;
        padding: 1px 5px; border-radius: 4px;
        background: #fef3c7; color: #92400e;
        border: 1px solid #fde68a;
        letter-spacing: .04em;
        margin-left: auto; flex-shrink: 0;
      }
      html[data-theme="dark"] .tn-ma-badge {
        background: #292524; color: #fbbf24; border-color: #44403c;
      }

      /* Group buttons intentionally have NO MA styling — see the note in
         updateTopnavBadges(). The amber tint that used to live here was declared
         !important and swallowed both :hover and .tn-link-active. */

      /* ── Count badge (command-style context tabs only) ── */
      .tn-grp-ma-count {
        display: inline-flex; align-items: center;
        font-size: 8px; font-weight: 800;
        padding: 0 5px; height: 15px; border-radius: 99px;
        background: #f59e0b; color: #fff;
        margin-left: 4px; flex-shrink: 0;
      }

      /* ── Banner at top of dropdown ── */
      .tn-ma-banner {
        display: flex; align-items: center; gap: 6px;
        padding: 6px 10px; border-radius: 8px;
        margin-bottom: 4px;
        font-size: 11px; font-weight: 600;
        background: #fffbeb; color: #92400e;
        border: 1px solid #fde68a;
      }
      html[data-theme="dark"] .tn-ma-banner {
        background: #1c1710; color: #fbbf24; border-color: #44403c;
      }
      .tn-ma-banner-dot {
        width: 7px; height: 7px; border-radius: 50%;
        background: #f59e0b; flex-shrink: 0;
        animation: _tn-ma-pulse 2s ease-in-out infinite;
      }
      @keyframes _tn-ma-pulse {
        0%,100%{ box-shadow:0 0 0 0 rgba(245,158,11,.7); }
        55%    { box-shadow:0 0 0 4px rgba(245,158,11,0); }
      }

      /* ── Command style: tinted tab ── */
      .tn-ctx-tab.tn-ctx-tab-ma {
        background: rgba(245,158,11,.1) !important;
        color: #b45309 !important;
      }
      html[data-theme="dark"] .tn-ctx-tab.tn-ctx-tab-ma {
        background: rgba(245,158,11,.18) !important;
        color: #fbbf24 !important;
      }
    `;
    document.head.appendChild(s);
  }

  // ── Poll loop ─────────────────────────────────────────────────────────────────
  async function poll() {
    const ma = await fetchMA();
    applyMA(ma);
    setTimeout(poll, POLL_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', poll);
  } else {
    poll();
  }
})();
