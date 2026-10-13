/**
 * LoadingOverlay — shared full-blocking loading UI
 * ═════════════════════════════════════════════════════════════════════
 * Overlay covers a target container (default: <main.main-content>) so
 * users cannot click content while async work is in flight. Sidebar +
 * topbar remain usable because the overlay is `position:absolute` inside
 * the host — NOT `fixed` on the whole viewport.
 *
 * Two usage patterns:
 *
 *   1. Simple show/hide with a message:
 *        LoadingOverlay.show('กำลังโหลดกราฟ...');
 *        try { await fetchStuff(); } finally { LoadingOverlay.hide(); }
 *
 *   2. Multi-step tracking (great for parallel loads):
 *        const t = LoadingOverlay.tracker(['api', 'graph', 'stats']);
 *        fetchApi().finally(() => t.done('api'));
 *        loadGraph().finally(() => t.done('graph'));
 *        loadStats().finally(() => t.done('stats'));
 *        // overlay hides automatically when all 3 are done
 *
 * Options passed to show() / tracker():
 *   { target: '<selector or Element>',  // default 'main.main-content'
 *     hint:   '<subtitle text>',        // small grey text under spinner
 *     timeout: <ms> }                   // hard-hide fallback (default 20000)
 */
(function (global) {
  'use strict';

  let _overlayEl   = null;
  let _timeoutId   = null;
  let _currentHost = null;
  let _shownAt     = 0;         // ms epoch when current overlay first appeared
  const MIN_DISPLAY_MS = 350;   // keep card visible ≥350ms so fast fetches don't just flash

  function _ensureStyle() {
    if (document.getElementById('_loading-overlay-style')) return;
    const s = document.createElement('style');
    s.id = '_loading-overlay-style';
    s.textContent = `
      @keyframes _loSpin { to { transform: rotate(360deg); } }
      @keyframes _loFadeIn { from { opacity: 0; } to { opacity: 1; } }
      .loading-overlay {
        position: absolute; inset: 0; z-index: 9998;
        background: rgba(255,255,255,.85);
        backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px);
        display: flex; align-items: center; justify-content: center;
        animation: _loFadeIn .2s ease;
      }
      body.is-dark .loading-overlay,
      body[data-theme="dark"] .loading-overlay,
      html[data-theme="dark"] .loading-overlay {
        background: rgba(15,15,20,.75);
      }
      .loading-overlay .lo-card {
        padding: 24px 32px; background: var(--bg-card, #fff);
        border: 1px solid var(--border); border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0,0,0,.15);
        display: flex; flex-direction: column; align-items: center; gap: 14px;
        min-width: 280px; max-width: 90%;
      }
      .loading-overlay .lo-spinner {
        width: 40px; height: 40px; border: 3px solid var(--border);
        border-top-color: var(--primary, #3b82f6); border-radius: 50%;
        animation: _loSpin 0.7s linear infinite;
      }
      .loading-overlay .lo-msg {
        font-size: 13px; color: var(--text); text-align: center; font-weight: 500;
        line-height: 1.5;
      }
      .loading-overlay .lo-hint {
        font-size: 11px; color: var(--text-muted); text-align: center;
        line-height: 1.5;
      }
      .loading-overlay .lo-steps {
        font-size: 10.5px; color: var(--text-muted); text-align: left;
        display: flex; flex-direction: column; gap: 3px;
        border-top: 1px solid var(--border); padding-top: 10px; margin-top: 4px;
        width: 100%;
      }
      .loading-overlay .lo-steps .step {
        display: flex; align-items: center; gap: 8px;
      }
      .loading-overlay .lo-steps .step .dot {
        width: 6px; height: 6px; border-radius: 50%; background: var(--border);
      }
      .loading-overlay .lo-steps .step.pending .dot {
        background: var(--warning, #f59e0b);
        box-shadow: 0 0 0 2px rgba(245,158,11,.2);
      }
      .loading-overlay .lo-steps .step.done .dot { background: var(--success, #16a34a); }
      .loading-overlay .lo-steps .step.done { text-decoration: line-through; opacity: .7; }
    `;
    document.head.appendChild(s);
  }

  function _resolveHost(target) {
    if (typeof target === 'string') return document.querySelector(target) || document.body;
    if (target instanceof Element) return target;
    // Try each known "main content" selector in order. Different pages use
    // different wrappers — this keeps overlay scoped to content and never
    // ends up on <body> covering the sidebar.
    const selectors = [
      'main.page-content',   // service-performance.html
      'main.main-content',   // ma-services.html + most other pages
      '.page-content',
      '.main-content main',  // service-performance-style wrapper
      '.main-content',
      'main',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return document.body;
  }

  function _escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function _buildOverlay(msg, hint, steps) {
    const el = document.createElement('div');
    el.className = 'loading-overlay';
    let stepsHtml = '';
    if (steps && steps.length) {
      stepsHtml = '<div class="lo-steps">'
        + steps.map(st => `<div class="step ${st.done ? 'done' : 'pending'}" data-key="${_escapeHtml(st.key)}">
             <span class="dot"></span><span>${_escapeHtml(st.label)}</span>
           </div>`).join('')
        + '</div>';
    }
    el.innerHTML = `
      <div class="lo-card">
        <div class="lo-spinner"></div>
        <div class="lo-msg">${_escapeHtml(msg)}</div>
        ${hint ? `<div class="lo-hint">${_escapeHtml(hint)}</div>` : ''}
        ${stepsHtml}
      </div>`;
    return el;
  }

  function show(msg, opts) {
    opts = opts || {};
    _ensureStyle();
    const host = _resolveHost(opts.target);
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

    // Reuse existing overlay if same host — just update message.
    if (_overlayEl && _overlayEl.isConnected && _currentHost === host) {
      const msgEl = _overlayEl.querySelector('.lo-msg');
      if (msgEl) msgEl.textContent = msg;
      if (opts.hint !== undefined) {
        let hintEl = _overlayEl.querySelector('.lo-hint');
        if (!hintEl && opts.hint) {
          hintEl = document.createElement('div');
          hintEl.className = 'lo-hint';
          _overlayEl.querySelector('.lo-card').insertBefore(
            hintEl, _overlayEl.querySelector('.lo-steps') || null
          );
        }
        if (hintEl) hintEl.textContent = opts.hint;
      }
      _resetTimeout(opts.timeout);
      return;
    }
    _immediateHide(); // clean up any previous overlay on a different host
    _overlayEl = _buildOverlay(msg, opts.hint, null);
    host.appendChild(_overlayEl);
    _currentHost = host;
    _shownAt = Date.now();
    _resetTimeout(opts.timeout);
  }

  // Hide with minimum-display guard so users actually see the card even if
  // the underlying fetch resolves in <100ms (cached responses, fast networks).
  function hide() {
    const elapsed = Date.now() - _shownAt;
    if (elapsed < MIN_DISPLAY_MS && _overlayEl) {
      setTimeout(_immediateHide, MIN_DISPLAY_MS - elapsed);
    } else {
      _immediateHide();
    }
  }

  function _immediateHide() {
    if (_timeoutId) { clearTimeout(_timeoutId); _timeoutId = null; }
    if (_overlayEl) {
      _overlayEl.style.transition = 'opacity .25s ease';
      _overlayEl.style.opacity = '0';
      const el = _overlayEl;
      setTimeout(() => { if (el && el.parentNode) el.remove(); }, 250);
      _overlayEl = null;
      _currentHost = null;
    }
  }

  function _resetTimeout(ms) {
    if (_timeoutId) clearTimeout(_timeoutId);
    const timeout = ms || 20000;
    _timeoutId = setTimeout(() => hide(), timeout);
  }

  /**
   * Multi-step tracker. Pass an array of step definitions:
   *   [ 'api', 'graph' ]                 // just keys → labels default to same
   *   [ { key: 'api', label: 'Fetch data' }, ... ]
   *
   * Returns { done(key), fail(key), setMsg(msg), hide() }.
   */
  function tracker(steps, opts) {
    opts = opts || {};
    _ensureStyle();
    const norm = (steps || []).map(s => typeof s === 'string' ? { key: s, label: s } : s);
    const state = norm.map(s => ({ key: s.key, label: s.label || s.key, done: false }));

    const host = _resolveHost(opts.target);
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    _immediateHide();
    _overlayEl = _buildOverlay(opts.message || 'กำลังโหลด...', opts.hint || '', state);
    host.appendChild(_overlayEl);
    _currentHost = host;
    _shownAt = Date.now();
    _resetTimeout(opts.timeout);

    const api = {
      done(key) {
        const s = state.find(x => x.key === key);
        if (s) s.done = true;
        if (_overlayEl) {
          const row = _overlayEl.querySelector(`[data-key="${CSS.escape(key)}"]`);
          if (row) { row.classList.remove('pending'); row.classList.add('done'); }
          const remaining = state.filter(x => !x.done).length;
          const msgEl = _overlayEl.querySelector('.lo-msg');
          if (msgEl && opts.message) {
            msgEl.textContent = remaining === 0
              ? (opts.completeMessage || 'เสร็จแล้ว')
              : (opts.message + (remaining > 0 ? ' (' + remaining + ' รายการ)' : ''));
          }
        }
        if (state.every(x => x.done)) hide();
      },
      fail(key) { this.done(key); },
      setMsg(msg) {
        if (_overlayEl) {
          const el = _overlayEl.querySelector('.lo-msg');
          if (el) el.textContent = msg;
        }
      },
      hide: hide,
    };
    return api;
  }

  global.LoadingOverlay = { show: show, hide: hide, tracker: tracker };
})(window);
