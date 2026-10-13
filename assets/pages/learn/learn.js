// learn — page script, extracted from learn.html.
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

if (!Auth.requireAuth()) { /* requireAuth redirects internally; stop init */ }
  Layout.render('learn');
  trackLearningView('main');

  // ── Full-Split Immersive chooser → mode transition ──
  const panes = document.querySelectorAll('.lp-pane');
  const chooser = document.getElementById('split-chooser');
  const modeBar = document.getElementById('mode-bar');
  let _currentMode = 'choosing'; // 'choosing' | 'learns' | 'exams'

  function enterMode(pane, immediate = false) {
    if (_currentMode === pane) return;
    _currentMode = pane;

    const isCourse = pane === 'learns';

    if (immediate) {
      // Direct URL hash navigation — skip animation
      chooser.style.display = 'none';
      _showModeBar(pane);
      panes.forEach(p => p.classList.toggle('active', p.dataset.pane === pane));
      if (location.hash !== '#' + pane) history.replaceState(null, '', '#' + pane);
      return;
    }

    // Step 1: inject cover overlay on the chosen panel, then sweep it across
    const panels = chooser.querySelectorAll('.sc-panel');
    const chosen = [...panels].find(p => p.classList.contains(isCourse ? 'sc-course' : 'sc-exam'));
    const cover = document.createElement('div');
    cover.className = 'sc-cover' + (isCourse ? '' : ' from-right');
    cover.style.background = isCourse
      ? 'linear-gradient(135deg,rgba(242,100,25,.22),rgba(242,100,25,.12))'
      : 'linear-gradient(135deg,rgba(99,102,241,.22),rgba(99,102,241,.12))';
    chosen.appendChild(cover);
    // force reflow, then trigger sweep
    cover.getBoundingClientRect();
    cover.classList.add('sweep');

    // Step 2: at 260ms, start collapsing the whole chooser
    chooser.classList.add(isCourse ? 'choosing-c' : 'choosing-e');
    setTimeout(() => {
      chooser.classList.add('collapsing');
    }, 260);

    // Step 3: at 600ms, hide chooser, show mode-bar + pane
    setTimeout(() => {
      chooser.style.display = 'none';
      _showModeBar(pane);
      panes.forEach(p => p.classList.toggle('active', p.dataset.pane === pane));
      if (window.Icons?.replaceAll) window.Icons.replaceAll(document.body);
      if (location.hash !== '#' + pane) history.replaceState(null, '', '#' + pane);
    }, 600);
  }

  function _showModeBar(pane) {
    modeBar.classList.remove('mode-c', 'mode-e', 'visible');
    modeBar.classList.add(pane === 'learns' ? 'mode-c' : 'mode-e', 'visible');
    const txt = document.getElementById('mbar-text');
    const cnt = document.getElementById('mbar-cnt');
    if (txt) txt.textContent = pane === 'learns' ? 'คอร์สเรียน' : 'ทำข้อสอบ';
    const cntEl = document.getElementById(pane === 'learns' ? 'head-learns-cnt' : 'head-exams-cnt');
    if (cnt && cntEl) cnt.textContent = cntEl.textContent;
  }

  function backToChooser() {
    _currentMode = 'choosing';

    // Step 1: fade out pane + mode-bar immediately
    panes.forEach(p => p.classList.remove('active'));
    modeBar.classList.remove('visible', 'mode-c', 'mode-e');
    history.replaceState(null, '', location.pathname);

    // Step 2: after mode-bar fades, expand chooser back in
    setTimeout(() => {
      // Clean up enter-mode residue
      chooser.querySelectorAll('.sc-cover').forEach(el => el.remove());
      chooser.classList.remove('choosing-c', 'choosing-e', 'entering');

      // Bring chooser back to view, still collapsed (collapsing class intact)
      chooser.style.display = '';
      chooser.scrollIntoView({ block: 'start' });

      // Force reflow so browser registers the max-height:0 state first,
      // then removing 'collapsing' triggers the expand transition
      chooser.getBoundingClientRect();
      chooser.classList.remove('collapsing');

      // Step 3: after expand finishes, trigger panel slide-up animation
      setTimeout(() => {
        chooser.classList.add('entering');
        setTimeout(() => chooser.classList.remove('entering'), 550);
      }, 420);
    }, 140);
  }

  // Honor direct hash links (from sidebar, back button, etc.)
  const _initHash = location.hash.slice(1);
  if (['learns','exams'].includes(_initHash)) {
    enterMode(_initHash, true);
  }
  window.addEventListener('hashchange', () => {
    const h = location.hash.slice(1);
    if (['learns','exams'].includes(h) && _currentMode !== h) enterMode(h, true);
    if (!h && _currentMode !== 'choosing') backToChooser();
  });

  // Expose for analytics and back-btn keyboard
  window.backToChooser = backToChooser;

  // ── Apply admin-configurable page config (hero/accent/density/badge) ──
  function applyPageConfig(cfg) {
    if (!cfg) return;
    const root = document.documentElement;

    if (cfg.accent_color && /^#[0-9a-fA-F]{6}$/.test(cfg.accent_color)) {
      const c = cfg.accent_color;
      root.style.setProperty('--accent', c);
      root.style.setProperty('--accent-soft', hexAlpha(c, .10));
      root.style.setProperty('--accent-line', hexAlpha(c, .35));
    }

    document.body.classList.remove('density-compact', 'density-spacious');
    if (cfg.layout_density === 'compact')  document.body.classList.add('density-compact');
    if (cfg.layout_density === 'spacious') document.body.classList.add('density-spacious');

    /* hero-subtitle removed (split-chooser has static copy) */
  }

  function hexAlpha(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return `rgba(${r},${g},${b},${a})`;
  }

  // Re-render skeletons (replaces error/retry state) before refetching
  function showLoading() {
    const grid = document.getElementById('grid');
    const exg  = document.getElementById('ex-grid');
    grid.innerHTML = '<div data-skel="list" data-rows="3"></div>';
    exg.innerHTML  = '<div data-skel="list" data-rows="3"></div>';
    if (window.Skeletons?.mount) Skeletons.mount(grid);
    if (window.Skeletons?.mount) Skeletons.mount(exg);
  }

  // Replace empty/skel content with a clickable retry block
  function showRetry(elId, label) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.innerHTML = `
      <div class="empty" style="grid-column:1/-1; cursor:pointer" onclick="loadAll()">
        <div class="icon">⚠️</div>
        <div style="margin-bottom:10px">${label}</div>
        <button class="bl-go" type="button" onclick="event.stopPropagation(); loadAll()">↻ ลองใหม่</button>
      </div>`;
  }

  let _loading = false;
  async function loadAll() {
    if (_loading) return;            // guard concurrent loads
    _loading = true;
    showLoading();
    try {
      const user = Auth.getUser();

      // Page config (non-blocking — render with defaults if it fails)
      const cfgRes = await API.courses.getPageConfig().catch(() => null);
      const cfg = cfgRes?.ok ? (cfgRes.data?.data || {}) : {};
      applyPageConfig(cfg);

      /* hero-title removed — greeting now lives in split-chooser eyebrow */

      // Gate: must finish Team Onboarding — SM regular members only.
      //   • super_admin / sm_admin / dev_sm bypass (they run the system,
      //     they're not new hires being onboarded).
      //   • Non-SM teams have no onboarding programme.
      //   • super_admin using "view as TEAM" previews as that team → gate off
      //     unless view-as = sm.
      //   • ?skip_ob=1 in the URL is an emergency escape hatch.
      const skipOb    = /[?&]skip_ob=1/.test(location.search);
      const role      = String(user?.role || '').toLowerCase();
      const isAdmin   = role === 'super_admin' || role === 'sm_admin' || role === 'dev_sm';
      const viewAs    = (typeof Auth !== 'undefined' && Auth._getViewAsTeam) ? Auth._getViewAsTeam() : null;
      const scopeTeam = role === 'super_admin' ? (viewAs?.slug || null) : (user?.team || null);
      const gateOn    = !skipOb && !isAdmin && scopeTeam === 'sm';

      // "SM scope" for admin — the team whose UI is being viewed:
      //   • If any admin sets view-as → honor that pick (preview mode).
      //   • Otherwise use user.team (super_admin without view-as has no team).
      // Never infer team from the role name — 'sm_admin' is a historical
      // label reused as any team's per-team admin role (e.g. user 'testim'
      // has role=sm_admin, team=im).
      const adminEffectiveTeam = viewAs?.slug
        || (role === 'super_admin' ? null : (user?.team || null));
      const isSmScopedAdmin = isAdmin && adminEffectiveTeam === 'sm';

      // Small breadcrumb so it's obvious in DevTools whether the gate fires.
      console.log('[learn] onboarding gate', {
        role, team: user?.team, scopeTeam, isAdmin, gateOn,
        viewAs: viewAs?.slug, adminEffectiveTeam, isSmScopedAdmin,
      });

      // Fetch onboarding progress for regular SM (gating) and SM-scoped
      // admins (reference-tile). Admins won't be redirected — the gate
      // only fires when gateOn is true. Non-SM users skip both.
      const wantOb  = gateOn || isSmScopedAdmin;
      const obRes   = wantOb ? await API.onboarding.myProgress().catch(() => null) : null;
      if (gateOn && obRes?.ok && !obRes.data?.data?.finished_at) {
        window.location.replace('onboarding.html');
        return;
      }
      // Show the "Team Onboarding" tile for:
      //   • Regular SM members — with their real progress
      //   • SM-scoped admins (sm_admin/dev_sm, or super_admin viewing SM)
      //     — as a Reference tile linking to review view
      const isSmTeam = !isAdmin && scopeTeam === 'sm';

      const [coursesRes, examsRes] = await Promise.all([
        API.courses.listCourses().catch(() => null),
        API.exams.list().catch(() => null),
      ]);

      if (!coursesRes?.ok) { showRetry('grid', 'โหลด courses ไม่สำเร็จ'); }
      else {
      const courses = coursesRes.data?.data || [];
      const gridItems = courses;
      if ((isSmTeam || isSmScopedAdmin) && obRes?.ok) {
        const obData    = obRes.data?.data || {};
        const chapState = obData.chapter_state || [];
        const finished  = !!obData.finished_at;
        // SM-scoped admins get a Reference tile regardless of personal
        // progress — they're not being onboarded, they just want the material.
        const asRef = isSmScopedAdmin && !finished;
        const obCourse  = {
          id: '__onboarding__',
          title: asRef ? 'Team Onboarding (Reference)' : 'Team Onboarding',
          subtitle: asRef ? 'เนื้อหา onboarding ทีม SM — สำหรับอ่านย้อนหลัง' : 'ปฐมนิเทศสมาชิกใหม่ทีม SM',
          icon: '🚀',
          cover_color: '#10b981',
          my_percent: asRef ? null : (finished ? 100 : (obData.percent || 0)),
          my_status:  asRef ? 'reference' : (finished ? 'completed' : (obData.percent > 0 ? 'in_progress' : 'not_started')),
          my_locked: false,
          phases_count: chapState.length,
          my_passed:    chapState.filter(c => c.completed).length,
          _href: (finished || asRef) ? 'onboarding.html?review=1' : 'onboarding.html',
          _unit: 'บท',
          is_sm_featured: true,
          sm_ribbon_label: 'SM Team',
        };
        gridItems.unshift(obCourse);
      }
      renderCourseGrid(gridItems);
    }

    if (!examsRes?.ok) { showRetry('ex-grid', 'โหลด exams ไม่สำเร็จ'); }
    else renderExamGrid(examsRes.data?.data || []);
    } catch (err) {
      console.error('learn page load failed:', err);
      showRetry('grid', 'เกิดข้อผิดพลาด');
      showRetry('ex-grid', 'เกิดข้อผิดพลาด');
    } finally {
      _loading = false;
      _lastFetchAt = Date.now();
    }
  }

  let _lastFetchAt = Date.now();
  // Run on first paint
  loadAll();

  // ── Re-load on bfcache restore (back/forward navigation) ──
  // When the user clicks ← back from learn-course / exam, browsers may
  // restore the page from memory without re-running scripts. Force a
  // fresh fetch so stats (best score, my_attempts, etc.) stay accurate.
  window.addEventListener('pageshow', (ev) => {
    if (ev.persisted) loadAll();
  });

  // ── Re-load when tab becomes visible again (e.g. user switched away
  //    to take an exam in another tab and came back). 60s grace period
  //    so we don't refetch immediately if the user just briefly tabbed away.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - _lastFetchAt > 60 * 1000) {
      loadAll();
    }
  });

  // Days between now and an ISO timestamp (returns -1 if invalid)
  function daysSince(iso) {
    if (!iso) return -1;
    const t = new Date(iso).getTime();
    if (!t) return -1;
    return Math.floor((Date.now() - t) / (86400 * 1000));
  }
  // Build badge chips (integrated into card's .rn-stats row) + optional
  // popular decorations. Returns { chips, cls, flagHtml }.
  //   cls      → modifier class ('popular' → warm bg/border/glow, 'done' → green accents)
  //   flagHtml → corner ribbon + flame emblem + rising sparks (empty if not popular)
  function buildBadges({ isPopular, isNew, isDone, isSmFeatured, smLabel }) {
    const chips = [];
    if (isDone)    chips.push('<span class="rn-chip done"><i data-icon="check"></i> Done</span>');
    if (isNew)     chips.push('<span class="rn-chip new"><i data-icon="sparkles"></i> New</span>');
    // Popular / SM-featured are signalled by the corner ribbon + styling —
    // a chip would be redundant with all that.
    const popHtml = isPopular
      ? '<div class="rn-popular-ribbon"><i data-icon="flame"></i> Popular</div>'
      + '<div class="rn-popular-flame" aria-hidden="true"><i data-icon="flame"></i></div>'
      + '<div class="rn-popular-sparks" aria-hidden="true"><span></span><span></span><span></span></div>'
      : '';
    const smHtml = isSmFeatured
      ? `<div class="rn-sm-ribbon"><i data-icon="users"></i> ${escHtml(smLabel || 'SM Team')}</div>`
      : '';
    return {
      chips,
      cls: (isPopular ? ' popular' : '')
         + (isSmFeatured ? ' sm-featured' : '')
         + (isDone ? ' done' : ''),
      flagHtml: popHtml + smHtml,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  //  RING + PHASE-DOTS BUILDERS
  //  ─────────────────────────────────────────────────────────────
  //  buildRing({ pct, iconHtml, done, locked, pctLabel, pctTone })
  //    Renders conic-gradient ring + centered icon + floating pct badge.
  //  buildPhaseDots({ items, headLabel, headValue })
  //    items[]: array of { state, label }
  //      state: 'done' | 'current' | 'pending' | 'locked' | 'pass' | 'fail' | 'more'
  //      label: text rendered inside the dot (fits ~2-3 chars)
  //    Auto-truncates when items.length > MAX_DOTS with a "+N" bubble.
  // ═══════════════════════════════════════════════════════════════
  const MAX_DOTS = 6;

  function buildRing({ pct = 0, iconHtml = '', done = false, locked = false, pctLabel = '', pctTone = '' }) {
    const p = Math.max(0, Math.min(100, pct));
    const showPct = pctLabel !== '' ? pctLabel : (p + '%');
    const toneCls = pctTone
      ? pctTone
      : done ? 'done'
      : locked ? 'locked'
      : (p >= 100 ? 'done' : '');
    return `
      <div class="rn-ring-wrap">
        <div class="rn-ring" style="--pct:${p}">
          <div class="rn-ring-inner">${iconHtml}</div>
        </div>
        <div class="rn-pct ${toneCls}">${showPct}</div>
      </div>`;
  }

  function buildPhaseDots({ items, headLabel = 'Phases', headValue = '' }) {
    if (!items || !items.length) return '';
    let shown = items;
    if (items.length > MAX_DOTS) {
      shown = items.slice(0, MAX_DOTS - 1).concat([{
        state: 'more',
        label: `+${items.length - (MAX_DOTS - 1)}`,
      }]);
    }
    let dotsHtml = '';
    shown.forEach((it, i) => {
      if (i > 0) {
        const prev = shown[i - 1];
        const both = (a, b, k) =>
          (a.state === k || a.state === 'pass') && (b.state === k || b.state === 'pass');
        let lineCls = '';
        if (both(prev, it, 'done')) lineCls = 'done';
        else if (both(prev, it, 'pass')) lineCls = 'pass';
        else if (prev.state === 'fail' && it.state === 'fail') lineCls = 'fail';
        dotsHtml += `<span class="rn-line ${lineCls}"></span>`;
      }
      dotsHtml += `<div class="rn-dot ${it.state}">${escHtml(it.label || '')}</div>`;
    });
    return `
      <div class="rn-phases">
        <div class="rn-phases-head">
          <span>${escHtml(headLabel)}</span>
          ${headValue ? `<b>${escHtml(headValue)}</b>` : ''}
        </div>
        <div class="rn-dots">${dotsHtml}</div>
      </div>`;
  }

  // Update split-chooser course stats + section header
  function setLearnStats(courses) {
    const total  = courses.length;
    const done   = courses.filter(c => (c.my_status || '') === 'completed').length;
    const todo   = total - done;
    const pct    = total > 0 ? Math.round(done / total * 100) : 0;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('head-learns-cnt', `${total} คอร์ส`);
    set('sc-done-courses-txt', `${done} จบแล้ว`);
    set('sc-todo-courses-txt', `${todo} รอเรียน`);
    set('sc-courses-pct', total > 0 ? `${pct}%` : '—');
    const fill = document.getElementById('sc-courses-fill');
    if (fill) fill.style.width = pct + '%';
  }

  function renderCourseGrid(courses) {
    const grid = document.getElementById('grid');
    setLearnStats(courses);
    if (!courses.length) {
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1">
        <div class="icon"><i data-icon="book-open"></i></div>
        <div>ยังไม่มีคอร์สให้เรียนตอนนี้</div>
      </div>`;
      if (window.Icons?.replaceAll) window.Icons.replaceAll(grid);
      return;
    }
    grid.innerHTML = courses.map(c => {
      const color   = c.cover_color || '#f26419';
      const total   = Math.max(0, c.phases_count || 0);
      const passed  = Math.max(0, Math.min(total, c.my_passed || 0));
      const pct     = c.my_percent || 0;
      const status  = c.my_status || 'not_started';
      const locked  = !!c.my_locked;
      const unit    = c._unit || 'phases';

      const days = daysSince(c.created_at);
      const b = locked ? { chips:[], cls:'' } : buildBadges({
        isPopular: !!c.is_popular,
        isNew:     days >= 0 && days <= 30,
        isDone:    status === 'completed',
        isSmFeatured: !!c.is_sm_featured,
        smLabel:   c.sm_ribbon_label,
      });

      const ringPct = locked ? 0 : pct;
      const iconHtml = locked
        ? '<i data-icon="lock"></i>'
        : (typeof renderIcon === 'function' ? renderIcon(c.icon) : escHtml(c.icon || '📘'));
      const isRef = status === 'reference';
      const ringHtml = buildRing({
        pct: isRef ? 100 : ringPct,
        iconHtml,
        done: status === 'completed' || isRef,
        locked,
        pctLabel: locked ? '<i data-icon="lock"></i>' : (status === 'completed' ? '✓' : (isRef ? '<i data-icon="book-open"></i>' : (pct + '%'))),
      });

      let phaseItems;
      if (locked) {
        const N = Math.max(1, total || 4);
        phaseItems = Array.from({ length: N }, () => ({ state: 'locked', label: '' }));
      } else if (total === 0) {
        phaseItems = [{ state: 'pending', label: '?' }];
      } else {
        phaseItems = Array.from({ length: total }, (_, i) => {
          if (i < passed) return { state: 'done', label: (i + 1).toString() };
          if (i === passed && status === 'in_progress') return { state: 'current', label: (i + 1).toString() };
          return { state: 'pending', label: (i + 1).toString() };
        });
      }
      const phasesHtml = buildPhaseDots({
        items: phaseItems,
        headLabel: unit === 'บท' ? 'บท' : 'Phases',
        headValue: locked ? '—' : `${passed} / ${total}`,
      });

      const noteHtml = locked
        ? `<div class="rn-note locked"><i data-icon="lock"></i> ต้องเรียนให้จบก่อน: <strong>${(c.unmet_prereqs||[]).map(u => escHtml(u.title)).join(', ')}</strong></div>`
        : '';

      const extraChips = [];
      if (!locked && status === 'in_progress') {
        extraChips.push(`<span class="rn-chip progress"><i data-icon="activity"></i> Phase ${passed + 1}</span>`);
      }
      if (!locked && status === 'not_started' && !b.chips.length) {
        extraChips.push(`<span class="rn-chip"><i data-icon="circle"></i> ยังไม่เริ่ม</span>`);
      }
      if (!locked && status === 'reference') {
        extraChips.push(`<span class="rn-chip"><i data-icon="book-open"></i> Reference</span>`);
      }
      if (locked) {
        extraChips.push(`<span class="rn-chip warn"><i data-icon="lock"></i> Locked</span>`);
      }
      const allChips = [...b.chips, ...extraChips];
      const chipsHtml = allChips.length
        ? `<div class="rn-stats">${allChips.join('')}</div>` : '';

      const doneCls = status === 'completed' ? ' done' : '';

      return `
        <a href="${locked ? '#' : (c._href || `learn-course.html?id=${encodeURIComponent(c.id)}`)}"
           class="rn-card${locked ? ' locked' : ''}${doneCls}${b.cls}"
           style="--bar-color:${color}"
           ${locked ? 'onclick="event.preventDefault(); Toast.warning(\'ต้องเรียนคอร์สก่อนหน้าให้จบก่อน\')"' : ''}>
          ${b.flagHtml || ''}
          ${ringHtml}
          <div class="rn-title-wrap">
            <div class="rn-title">${escHtml(c.title)}</div>
            <p class="rn-sub">${escHtml(c.subtitle || c.description || '')}</p>
          </div>
          ${phasesHtml}
          ${noteHtml}
          ${chipsHtml}
        </a>
      `;
    }).join('');
    if (window.Icons?.replaceAll) window.Icons.replaceAll(grid);
  }

  // Update split-chooser exam stats + section header
  function setExamStats(exams) {
    const total  = exams.length;
    const passed = exams.filter(e => !!e.my_passed).length;
    const pct    = total > 0 ? Math.round(passed / total * 100) : 0;
    const now    = Date.now();
    const urgent = exams.filter(e => {
      if (e.my_passed || !e.exam_window?.enabled || !e.exam_window?.end) return false;
      const end = new Date(e.exam_window.end).getTime();
      return end > now && (end - now) < 7 * 24 * 3600 * 1000; // within 7 days
    }).length;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('head-exams-cnt', `${total} ชุด`);
    set('sc-done-exams-txt', `${passed} ผ่านแล้ว`);
    set('sc-exams-pct', total > 0 ? `${pct}%` : '—');
    const fill = document.getElementById('sc-exams-fill');
    if (fill) fill.style.width = pct + '%';
    const urgentPill = document.getElementById('sc-urgent-exams');
    if (urgentPill) urgentPill.style.display = urgent > 0 ? 'inline-flex' : 'none';
  }

  function renderExamGrid(exams) {
    const grid = document.getElementById('ex-grid');
    setExamStats(exams);
    if (!exams.length) {
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1">
        <div class="icon"><i data-icon="edit"></i></div>
        <div>ยังไม่มีข้อสอบให้ทำตอนนี้</div>
      </div>`;
      if (window.Icons?.replaceAll) window.Icons.replaceAll(grid);
      return;
    }
    const now = Date.now();
    grid.innerHTML = exams.map(e => {
      const color        = e.cover_color || '#f26419';
      const myA          = e.my_attempts || 0;
      const maxA         = e.max_attempts || 0;
      const remain       = maxA > 0 ? Math.max(0, maxA - myA) : null;
      const passed       = !!e.my_passed;
      const best         = e.my_best_score || 0;
      const courseLocked = !!e.my_course_locked;

      // Determine "can start" + reason
      let canStart = !courseLocked;
      let winState = null;                  // 'upcoming' | 'open' | 'closed' | null
      if (!courseLocked && e.exam_window?.enabled) {
        const s = e.exam_window.start ? new Date(e.exam_window.start).getTime() : 0;
        const en = e.exam_window.end ? new Date(e.exam_window.end).getTime() : 0;
        if (s && now < s) { winState = 'upcoming'; canStart = false; }
        else if (en && now > en) { winState = 'closed'; canStart = false; }
        else { winState = 'open'; }
      }
      const attemptsExhausted = canStart && maxA > 0 && remain === 0 && !passed;
      if (attemptsExhausted) canStart = false;

      // Badges
      const days = daysSince(e.created_at);
      const b = courseLocked ? { chips:[], cls:'' } : buildBadges({
        isPopular: !!e.is_popular,
        isNew:     days >= 0 && days <= 30,
        isDone:    passed,
      });

      // Ring — score-oriented (best score %, not phases)
      const ringPct = courseLocked ? 0 : (passed ? Math.max(best, e.pass_score || 0) : best);
      const iconHtml = courseLocked
        ? '<i data-icon="lock"></i>'
        : (typeof renderIcon === 'function' ? renderIcon(e.icon, '<i data-icon="edit"></i>') : escHtml(e.icon || '📝'));
      const ringHtml = buildRing({
        pct: ringPct,
        iconHtml,
        done: passed,
        locked: courseLocked,
        pctLabel: courseLocked ? '<i data-icon="lock"></i>'
                : passed ? `${best}<span class="u">%</span>`
                : myA > 0 ? `${best}<span class="u">%</span>`
                : (winState === 'upcoming' ? '<i data-icon="clock"></i>' : '—'),
        pctTone: courseLocked ? 'locked'
               : passed ? 'done'
               : (myA > 0 && !passed && attemptsExhausted) ? 'warn'
               : (winState === 'upcoming' ? 'new' : ''),
      });

      // Attempt dots
      let attemptItems;
      if (courseLocked) {
        const N = maxA > 0 ? maxA : 3;
        attemptItems = Array.from({ length: N }, () => ({ state: 'locked', label: '' }));
      } else {
        const total = maxA > 0 ? maxA : Math.max(myA + 1, 3);
        attemptItems = Array.from({ length: total }, (_, i) => {
          const num = (i + 1).toString();
          if (i < myA) {
            // Used attempt: last-used = pass if passed=true, otherwise fail
            const isPassSlot = passed && i === myA - 1;
            return isPassSlot
              ? { state: 'pass', label: `${best}` }
              : { state: 'fail', label: 'x' };
          }
          if (i === myA && canStart) return { state: 'current', label: num };
          return { state: 'pending', label: num };
        });
      }
      const attemptsHtml = buildPhaseDots({
        items: attemptItems,
        headLabel: 'Attempts',
        headValue: courseLocked ? '—' : (maxA > 0 ? `${myA} / ${maxA}` : `${myA} · ∞`),
      });

      // Note (prereq or window)
      let noteHtml = '';
      if (courseLocked) {
        const titles = (e.unmet_course_prereqs || []).map(u => escHtml(u.title)).join(', ');
        noteHtml = `<div class="rn-note locked"><i data-icon="lock"></i> ต้องเรียนให้จบก่อน: <strong>${titles}</strong></div>`;
      } else if (winState === 'upcoming') {
        noteHtml = `<div class="rn-note upcoming"><i data-icon="clock"></i> จะเปิด ${fmtDate(e.exam_window.start)}</div>`;
      } else if (winState === 'closed') {
        noteHtml = `<div class="rn-note closed"><i data-icon="clock"></i> ปิดสอบแล้ว · สิ้นสุด ${fmtDate(e.exam_window.end)}</div>`;
      } else if (winState === 'open') {
        noteHtml = `<div class="rn-note open"><i data-icon="circle"></i> เปิดสอบ — ปิด ${fmtDate(e.exam_window.end)}</div>`;
      }

      // Status chips
      const qCount = (e.pool_enabled && e.pool_total_show > 0 && e.pool_total_show < e.questions_count)
        ? `${e.pool_total_show} ข้อ (สุ่ม)`
        : `${e.questions_count} ข้อ`;
      const passChip = e.pass_score > 0 ? `pass ${e.pass_score}%` : 'ไม่มีเกณฑ์';
      const extraChips = [
        `<span class="rn-chip"><i data-icon="edit"></i> ${escHtml(qCount)}</span>`,
        `<span class="rn-chip"><i data-icon="target"></i> ${escHtml(passChip)}</span>`,
      ];
      if (courseLocked) {
        extraChips.push('<span class="rn-chip warn"><i data-icon="lock"></i> Locked</span>');
      } else if (attemptsExhausted) {
        extraChips.push('<span class="rn-chip warn"><i data-icon="alert-triangle"></i> หมดสิทธิ์</span>');
      } else if (winState === 'upcoming') {
        extraChips.push('<span class="rn-chip new"><i data-icon="clock"></i> ยังไม่ถึงเวลา</span>');
      } else if (myA > 0 && !passed && maxA > 0 && remain === 1) {
        extraChips.push('<span class="rn-chip warn"><i data-icon="alert-triangle"></i> เหลือครั้งสุดท้าย</span>');
      } else if (myA > 0 && !passed) {
        extraChips.push('<span class="rn-chip progress"><i data-icon="activity"></i> เคยทำ ' + myA + ' ครั้ง</span>');
      } else if (myA === 0 && canStart && !b.chips.length) {
        extraChips.push('<span class="rn-chip"><i data-icon="circle"></i> ยังไม่ได้ทำ</span>');
      }
      const allChips = [...b.chips, ...extraChips];
      const chipsHtml = `<div class="rn-stats">${allChips.join('')}</div>`;

      const doneCls = passed ? ' done' : '';

      // Wrap in <a> when clickable, <div> when not (attempts exhausted etc.).
      const startsWith = canStart
        ? `<a href="exam.html?id=${encodeURIComponent(e.id)}" onclick="return openExamWindow(event, this.href);"`
        : `<div ${courseLocked ? 'onclick="Toast.warning(\'ต้องเรียนคอร์สก่อนหน้าให้จบก่อน\')"' : ''}`;
      const endsWith = canStart ? '</a>' : '</div>';

      return `
        ${startsWith}
           class="rn-card${canStart ? '' : ' locked'}${doneCls}${b.cls}"
           style="--bar-color:${color}">
          ${b.flagHtml || ''}
          ${ringHtml}
          <div class="rn-title-wrap">
            <div class="rn-title">${escHtml(e.title)}</div>
            <p class="rn-sub">${escHtml(e.subtitle || e.description || '')}</p>
          </div>
          ${attemptsHtml}
          ${noteHtml}
          ${chipsHtml}
        ${endsWith}
      `;
    }).join('');
    if (window.Icons?.replaceAll) window.Icons.replaceAll(grid);
  }

  function fmtDate(s) {
    try { return new Date(s).toLocaleString('th-TH', { dateStyle:'medium', timeStyle:'short' }); }
    catch { return s; }
  }

  // Open exam in a separate browser WINDOW (popup) so fullscreen + anti-cheat
  // run isolated from the original tab. Same profile, separate window.
  function openExamWindow(ev, href) {
    ev.preventDefault();
    const w = Math.min(screen.availWidth, 1400);
    const h = Math.min(screen.availHeight, 900);
    const left = Math.max(0, Math.floor((screen.availWidth  - w) / 2));
    const top  = Math.max(0, Math.floor((screen.availHeight - h) / 2));
    const features = `popup=yes,width=${w},height=${h},left=${left},top=${top}` +
                     `,toolbar=no,location=no,menubar=no,status=no,scrollbars=yes,resizable=yes`;
    const win = window.open(href, 'som_exam_' + Date.now(), features);
    if (!win) { Toast?.error?.('โปรดอนุญาต popup สำหรับเว็บนี้'); location.href = href; }
    else { try { win.focus(); } catch(_) {} }
    return false;
  }
  window.openExamWindow = openExamWindow;

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "_showModeBar", { configurable: true, get: () => _showModeBar, set: (v) => { _showModeBar = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "applyPageConfig", { configurable: true, get: () => applyPageConfig, set: (v) => { applyPageConfig = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "backToChooser", { configurable: true, get: () => backToChooser, set: (v) => { backToChooser = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "buildBadges", { configurable: true, get: () => buildBadges, set: (v) => { buildBadges = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "buildPhaseDots", { configurable: true, get: () => buildPhaseDots, set: (v) => { buildPhaseDots = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "buildRing", { configurable: true, get: () => buildRing, set: (v) => { buildRing = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "daysSince", { configurable: true, get: () => daysSince, set: (v) => { daysSince = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "enterMode", { configurable: true, get: () => enterMode, set: (v) => { enterMode = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtDate", { configurable: true, get: () => fmtDate, set: (v) => { fmtDate = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "hexAlpha", { configurable: true, get: () => hexAlpha, set: (v) => { hexAlpha = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadAll", { configurable: true, get: () => loadAll, set: (v) => { loadAll = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openExamWindow", { configurable: true, get: () => openExamWindow, set: (v) => { openExamWindow = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderCourseGrid", { configurable: true, get: () => renderCourseGrid, set: (v) => { renderCourseGrid = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderExamGrid", { configurable: true, get: () => renderExamGrid, set: (v) => { renderExamGrid = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setExamStats", { configurable: true, get: () => setExamStats, set: (v) => { setExamStats = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setLearnStats", { configurable: true, get: () => setLearnStats, set: (v) => { setLearnStats = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "showLoading", { configurable: true, get: () => showLoading, set: (v) => { showLoading = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "showRetry", { configurable: true, get: () => showRetry, set: (v) => { showRetry = v; } }); } catch (e) {}
})();
