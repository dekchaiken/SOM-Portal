/* ══════════════════════════════════════════════════
   announcements.js  |  Dashboard announcement system
   - Scrolling ticker bar (terminal/devops style)
   - Typewriter card for pinned items
   - Full-list modal
   ══════════════════════════════════════════════════ */

const Announcements = (() => {

  const TYPE = {
    alert:   { label: 'ALERT',   color: '#ef4444', bg: 'rgba(239,68,68,.12)',   symbol: '<i data-icon="x"></i>' },
    warn:    { label: 'WARN',    color: '#f59e0b', bg: 'rgba(245,158,11,.12)',  symbol: '▲' },
    info:    { label: 'INFO',    color: '#38bdf8', bg: 'rgba(56,189,248,.12)',  symbol: '◆' },
    notice:  { label: 'NOTICE',  color: '#f26419', bg: 'rgba(242,100,25,.12)',  symbol: '●' },
    success: { label: 'OK',      color: '#22c55e', bg: 'rgba(34,197,94,.12)',   symbol: '<i data-icon="check"></i>' },
  };

  function _t(type) { return TYPE[type] || TYPE.info; }

  // ── Inject styles once ───────────────────────────────────────────────────────
  function _injectStyles() {
    if (document.getElementById('_ann-styles')) return;
    const s = document.createElement('style');
    s.id = '_ann-styles';
    s.textContent = `
      /* ── Ticker bar (theme-aware via CSS variables) ─────── */
      #ann-ticker {
        display: flex; align-items: stretch;
        height: 34px; overflow: hidden;
        background: var(--ann-bg);
        border-top: 1px solid var(--ann-bd-t);
        border-bottom: 1px solid var(--ann-bd-b);
        font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', ui-monospace, monospace;
        font-size: 11px;
        flex-shrink: 0;
        position: relative;
        box-shadow: var(--ann-shadow);
      }
      #ann-ticker.hidden { display: none; }

      /* left accent stripe */
      #ann-ticker::before {
        content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 2px;
        background: linear-gradient(to bottom, #f26419, rgba(242,100,25,.2));
      }

      .ann-ticker-label {
        display: flex; align-items: center; gap: 8px;
        padding: 0 16px 0 18px;
        background: linear-gradient(90deg, rgba(242,100,25,.18) 0%, rgba(242,100,25,.06) 100%);
        border-right: 1px solid rgba(242,100,25,.18);
        color: #f26419; font-weight: 900;
        font-size: 9px; letter-spacing: .14em;
        white-space: nowrap; flex-shrink: 0;
        cursor: pointer; user-select: none;
        transition: background .15s;
        text-shadow: 0 0 12px rgba(242,100,25,.5);
      }
      .ann-ticker-label:hover { background: linear-gradient(90deg, rgba(242,100,25,.26) 0%, rgba(242,100,25,.1) 100%); }

      .ann-ticker-blink {
        width: 7px; height: 7px; border-radius: 50%;
        background: #f26419;
        box-shadow: 0 0 6px #f26419, 0 0 12px rgba(242,100,25,.4);
        animation: ann-blink 1.2s ease-in-out infinite;
        flex-shrink: 0;
      }
      @keyframes ann-blink {
        0%,100% { opacity: 1; box-shadow: 0 0 6px #f26419, 0 0 14px rgba(242,100,25,.5); }
        50%      { opacity: .3; box-shadow: none; }
      }

      .ann-ticker-count {
        background: rgba(242,100,25,.2);
        border: 1px solid rgba(242,100,25,.3);
        color: #f26419; border-radius: 10px;
        font-size: 8.5px; font-weight: 900;
        padding: 0 5px; line-height: 16px;
        min-width: 16px; text-align: center;
        flex-shrink: 0;
      }

      .ann-ticker-track {
        flex: 1; overflow: hidden; position: relative;
      }
      .ann-ticker-track::before,
      .ann-ticker-track::after {
        content: ''; position: absolute; top: 0; bottom: 0; width: 48px; z-index: 2;
        pointer-events: none;
      }
      .ann-ticker-track::before {
        left: 0;
        background: linear-gradient(to right, var(--ann-fade) 20%, transparent);
      }
      .ann-ticker-track::after {
        right: 0;
        background: linear-gradient(to left, var(--ann-fade) 20%, transparent);
      }
      .ann-ticker-scroll {
        display: flex; align-items: center;
        height: 100%; white-space: nowrap;
        padding-left: 16px;
        animation: ann-scroll var(--ann-dur, 40s) linear infinite;
        will-change: transform;
      }
      .ann-ticker-scroll:hover { animation-play-state: paused; }
      @keyframes ann-scroll {
        0%   { transform: translateX(0); }
        100% { transform: translateX(-50%); }
      }
      .ann-ticker-item {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 0 28px 0 0; cursor: pointer;
        transition: opacity .15s;
        color: var(--ann-text);
      }
      .ann-ticker-item:hover { color: var(--ann-title); }
      .ann-ticker-type {
        font-size: 8.5px; font-weight: 900; letter-spacing: .1em;
        padding: 2px 6px; border-radius: 3px;
        line-height: 1.5; flex-shrink: 0;
        border: 1px solid transparent;
      }
      .ann-ticker-title {
        font-weight: 700; letter-spacing: .01em;
        color: var(--ann-title);
      }
      .ann-ticker-sep {
        color: var(--ann-sep);
        padding: 0 4px;
        font-size: 10px;
        user-select: none;
      }


      /* ── Pinned announcement card ────────────────────────── */
      #ann-card {
        margin: 14px 0 6px;
        border-radius: 12px;
        overflow: hidden;
        font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', ui-monospace, monospace;
        background: var(--ann-card-bg);
        border: 1px solid var(--ann-card-bd);
        box-shadow: var(--ann-card-sh);
      }
      #ann-card.hidden { display: none; }

      /* window chrome */
      .ann-card-chrome {
        display: flex; align-items: center; justify-content: space-between;
        padding: 9px 14px;
        background: var(--ann-chrome-bg);
        border-bottom: 1px solid var(--ann-chrome-bd);
      }
      .ann-card-chrome-dots {
        display: flex; gap: 6px; align-items: center;
      }
      .ann-card-chrome-dot {
        width: 10px; height: 10px; border-radius: 50%;
      }
      .ann-card-chrome-dot.red    { background: #ff5f57; }
      .ann-card-chrome-dot.yellow { background: #febc2e; }
      .ann-card-chrome-dot.green  { background: #28c840; }
      .ann-card-chrome-title {
        display: flex; align-items: center; gap: 7px;
        font-size: 9px; font-weight: 700; letter-spacing: .1em;
        color: var(--ann-chrome-txt);
        position: absolute; left: 50%; transform: translateX(-50%);
      }
      .ann-card-chrome-wrap { position: relative; }
      .ann-card-live {
        display: flex; align-items: center; gap: 5px;
        font-size: 8.5px; color: var(--ann-live-col);
        letter-spacing: .06em;
      }
      .ann-card-live-dot {
        width: 6px; height: 6px; border-radius: 50%;
        background: #22c55e;
        box-shadow: 0 0 5px #22c55e;
        animation: ann-live-pulse 2s ease-in-out infinite;
      }
      @keyframes ann-live-pulse {
        0%,100% { opacity:1; box-shadow: 0 0 5px #22c55e; }
        50%      { opacity:.4; box-shadow: none; }
      }

      /* terminal body */
      .ann-card-body {
        padding: 14px 16px;
        background: var(--ann-body-bg);
        position: relative;
      }
      /* subtle scanline overlay */
      .ann-card-body::after {
        content: '';
        position: absolute; inset: 0;
        background: repeating-linear-gradient(
          0deg,
          transparent,
          transparent 2px,
          var(--ann-body-scan) 2px,
          var(--ann-body-scan) 4px
        );
        pointer-events: none;
      }

      .ann-card-line {
        display: flex; align-items: baseline; gap: 10px;
        font-size: 11.5px; line-height: 1.75;
        color: var(--ann-line);
        margin-bottom: 2px; position: relative; z-index: 1;
      }
      .ann-card-line:last-child { margin-bottom: 0; }
      .ann-card-prompt {
        color: rgba(242,100,25,.5); flex-shrink: 0; user-select: none;
        font-size: 10px;
      }
      .ann-card-badge {
        font-size: 8.5px; font-weight: 900; letter-spacing: .1em;
        padding: 2px 6px; border-radius: 3px; flex-shrink: 0;
        border: 1px solid transparent;
      }
      .ann-card-text { flex: 1; }
      .ann-card-ts {
        font-size: 9px; color: var(--ann-ts2);
        flex-shrink: 0; white-space: nowrap;
      }

      /* typewriter cursor */
      .ann-cursor {
        display: inline-block; width: 8px; height: 13px;
        background: #f26419;
        margin-left: 2px; vertical-align: text-bottom;
        animation: ann-cursor-blink .8s step-end infinite;
        border-radius: 1px;
      }
      @keyframes ann-cursor-blink { 0%,100%{opacity:1} 50%{opacity:0} }

      .ann-card-footer {
        padding: 7px 16px;
        border-top: 1px solid var(--ann-footer-bd);
        font-size: 9px; color: var(--ann-footer-txt);
        letter-spacing: .04em; background: var(--ann-footer-bg);
        display: flex; align-items: center; gap: 6px;
      }
      .ann-card-footer-path { color: rgba(242,100,25,.4); }
      .ann-card-footer-cmd  { color: var(--ann-footer-cmd); }
      .ann-view-all {
        margin-left: auto; cursor: pointer;
        color: var(--ann-viewall); font-size: 9px; letter-spacing: .06em;
        transition: color .15s; background: none; border: none;
        font-family: inherit; padding: 0;
      }
      .ann-view-all:hover { color: var(--ann-viewall-h); }

      /* ── Modal ───────────────────────────────────────────── */
      #ann-modal {
        position: fixed; inset: 0; z-index: 9000;
        background: rgba(0,0,0,.7); backdrop-filter: blur(6px);
        display: flex; align-items: center; justify-content: center;
        opacity: 0; pointer-events: none; transition: opacity .2s;
      }
      #ann-modal.open { opacity: 1; pointer-events: all; }
      #ann-modal-box {
        background: var(--bg-card, #16161b);
        border: 1px solid rgba(255,255,255,.08);
        border-radius: 16px; width: 580px; max-width: 94vw;
        max-height: 80vh; display: flex; flex-direction: column;
        box-shadow: 0 24px 64px rgba(0,0,0,.6);
        font-family: 'JetBrains Mono', 'Fira Code', monospace;
        overflow: hidden;
      }
      .ann-modal-hd {
        display: flex; align-items: center; justify-content: space-between;
        padding: 16px 20px; border-bottom: 1px solid rgba(255,255,255,.07);
        font-size: 11px; font-weight: 700; letter-spacing: .1em;
        color: rgba(255,255,255,.5);
      }
      .ann-modal-close {
        cursor: pointer; font-size: 16px; color: rgba(255,255,255,.3);
        transition: color .15s; background: none; border: none;
        font-family: inherit; line-height: 1;
      }
      .ann-modal-close:hover { color: rgba(255,255,255,.8); }
      .ann-modal-body { overflow-y: auto; padding: 12px 0; flex: 1; }
      .ann-modal-item {
        display: flex; align-items: flex-start; gap: 12px;
        padding: 12px 20px; border-bottom: 1px solid rgba(255,255,255,.04);
        transition: background .12s;
      }
      .ann-modal-item:last-child { border-bottom: none; }
      .ann-modal-item:hover { background: rgba(255,255,255,.02); }
      .ann-modal-badge {
        font-size: 9px; font-weight: 800; letter-spacing: .08em;
        padding: 3px 7px; border-radius: 4px; flex-shrink: 0;
        margin-top: 2px;
      }
      .ann-modal-content { flex: 1; min-width: 0; }
      .ann-modal-title { font-size: 12px; font-weight: 700; color: rgba(255,255,255,.85); margin-bottom: 3px; }
      .ann-modal-msg { font-size: 11px; color: rgba(255,255,255,.5); line-height: 1.6; }
      .ann-modal-meta { font-size: 9.5px; color: rgba(255,255,255,.25); margin-top: 5px; }
      .ann-pin-icon { color: #f26419; font-size: 10px; }
    `;
    document.head.appendChild(s);
  }

  // ── Time helpers ─────────────────────────────────────────────────────────────
  function _relTime(iso) {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1)  return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  function _timestamp(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('th-TH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }


  // ── Render ticker ────────────────────────────────────────────────────────────
  function _renderTicker(items) {
    let el = document.getElementById('ann-ticker');
    if (!el) return;

    // Filter: show in ticker when display==='ticker' or 'both' or 'all' (legacy: always show)
    const tickerItems = items.filter(a => {
      const d = a.display ?? 'both';
      return d === 'ticker' || d === 'both' || d === 'all';
    });

    if (!tickerItems.length) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');

    // Update count badge
    const countEl = el.querySelector('.ann-ticker-count');
    if (countEl) countEl.textContent = tickerItems.length;

    // Build items HTML (duplicated for seamless loop)
    const itemsHtml = tickerItems.map(a => {
      const t = _t(a.type);
      const label = escHtml(a.title || a.message);
      return `<span class="ann-ticker-item" onclick="Announcements.openModal()" title="${escHtml(a.message)}">` +
        `<span class="ann-ticker-type" style="background:${t.bg};color:${t.color};border-color:${t.color}33">${t.symbol} ${t.label}</span>` +
        `<span class="ann-ticker-title">${label}</span>` +
        `</span><span class="ann-ticker-sep">◆</span>`;
    }).join('');

    // Calculate scroll duration based on content length
    const totalChars = tickerItems.reduce((n, a) => n + (a.title || a.message).length, 0);
    const dur = Math.max(25, Math.min(90, totalChars * 0.35)) + 's';

    const track = el.querySelector('.ann-ticker-track');
    track.innerHTML = `<div class="ann-ticker-scroll" style="--ann-dur:${dur}">` +
      `<span style="display:contents">${itemsHtml}</span>` +
      `<span style="display:contents">${itemsHtml}</span>` +
      `</div>`;

  }

  // ── Render pinned card with typewriter ───────────────────────────────────────
  let _twTimer = null;

  function _renderCard(items) {
    const card = document.getElementById('ann-card');
    if (!card) return;

    // Show card items: display==='card' or 'both' or 'all' (or legacy pinned===true)
    const cardItems = items.filter(a => {
      const d = a.display ?? (a.pinned ? 'both' : 'ticker');
      return d === 'card' || d === 'both' || d === 'all';
    });
    if (!cardItems.length) { card.classList.add('hidden'); return; }
    card.classList.remove('hidden');

    const body = card.querySelector('.ann-card-body');
    body.innerHTML = cardItems.map((a, i) => {
      const t = _t(a.type);
      return `<div class="ann-card-line" id="ann-line-${i}">` +
        `<span class="ann-card-prompt">~/ann $</span>` +
        `<span class="ann-card-badge" style="background:${t.bg};color:${t.color};border-color:${t.color}33">${t.symbol} ${t.label}</span>` +
        `<span class="ann-card-text" id="ann-text-${i}"></span>` +
        `<span class="ann-card-ts">${_relTime(a.created_at)}</span>` +
        `</div>`;
    }).join('');

    // cursor after last line's text
    const lastText = document.getElementById(`ann-text-${cardItems.length - 1}`);
    if (lastText) lastText.insertAdjacentHTML('afterend', '<span class="ann-cursor" id="ann-cursor"></span>');

    clearTimeout(_twTimer);
    _typeLines(cardItems, 0);
  }

  function _typeLines(items, idx) {
    if (idx >= items.length) return;
    const el = document.getElementById(`ann-text-${idx}`);
    if (!el) return;
    const text = (items[idx].title ? `${items[idx].title}  —  ` : '') + items[idx].message;
    _typeText(el, text, 0, () => {
      // Move cursor to next line
      const cur = document.getElementById('ann-cursor');
      const nextText = document.getElementById(`ann-text-${idx + 1}`);
      if (cur && nextText) nextText.insertAdjacentElement('afterend', cur);
      _twTimer = setTimeout(() => _typeLines(items, idx + 1), 200);
    });
  }

  function _typeText(el, text, i, done) {
    if (i > text.length) { done?.(); return; }
    el.textContent = text.slice(0, i);
    _twTimer = setTimeout(() => _typeText(el, text, i + 1, done), 18);
  }

  // ── Modal ────────────────────────────────────────────────────────────────────
  let _allItems = [];

  function _renderModal(items) {
    const body = document.getElementById('ann-modal-body');
    if (!body) return;
    if (!items.length) {
      body.innerHTML = '<div style="text-align:center;padding:32px;color:rgba(255,255,255,.3);font-size:11px">ไม่มีประกาศ</div>';
      return;
    }
    body.innerHTML = items.map(a => {
      const t = _t(a.type);
      return `
        <div class="ann-modal-item">
          <span class="ann-modal-badge" style="background:${t.bg};color:${t.color}">${t.symbol} ${t.label}</span>
          <div class="ann-modal-content">
            <div class="ann-modal-title">${a.pinned ? '<span class="ann-pin-icon">📌 </span>' : ''}${escHtml(a.title || '—')}</div>
            <div class="ann-modal-msg">${escHtml(a.message)}</div>
            <div class="ann-modal-meta">by ${escHtml(a.created_by_name || '—')} · ${_timestamp(a.created_at)}${a.expires_at ? ' · expires ' + _timestamp(a.expires_at) : ''}</div>
          </div>
        </div>`;
    }).join('');
  }

  function openModal() {
    _renderModal(_allItems);
    const m = document.getElementById('ann-modal');
    if (m) requestAnimationFrame(() => m.classList.add('open'));
  }

  function closeModal() {
    const m = document.getElementById('ann-modal');
    if (m) m.classList.remove('open');
  }

  // ── Mount HTML into page ─────────────────────────────────────────────────────
  function _mount(container) {
    // Ticker — insert before the first child of container
    const ticker = document.createElement('div');
    ticker.id = 'ann-ticker';
    ticker.className = 'hidden';
    ticker.innerHTML = `
      <div class="ann-ticker-label" onclick="Announcements.openModal()">
        <div class="ann-ticker-blink"></div>
        BROADCAST
        <span class="ann-ticker-count">0</span>
      </div>
      <div class="ann-ticker-track"></div>`;
    container.prepend(ticker);

    // Card — inserted after status-bar if present, else after ticker
    const card = document.createElement('div');
    card.id = 'ann-card';
    card.className = 'hidden';
    card.innerHTML = `
      <div class="ann-card-chrome ann-card-chrome-wrap">
        <div class="ann-card-chrome-dots">
          <div class="ann-card-chrome-dot red"></div>
          <div class="ann-card-chrome-dot yellow"></div>
          <div class="ann-card-chrome-dot green"></div>
        </div>
        <div class="ann-card-chrome-title">SYSTEM BROADCAST</div>
        <div class="ann-card-live">
          <div class="ann-card-live-dot"></div>LIVE
        </div>
      </div>
      <div class="ann-card-body"></div>
      <div class="ann-card-footer">
        <span class="ann-card-footer-path">~/centralize-sm</span>
        <span class="ann-card-footer-cmd">tail -f announcements.log</span>
        <span class="ann-cursor"></span>
        <button class="ann-view-all" onclick="Announcements.openModal()">VIEW ALL ›</button>
      </div>`;

    const statusBar = container.querySelector('.status-bar');
    if (statusBar) statusBar.insertAdjacentElement('afterend', card);
    else ticker.insertAdjacentElement('afterend', card);

    // Modal
    const modal = document.createElement('div');
    modal.id = 'ann-modal';
    modal.innerHTML = `
      <div id="ann-modal-box">
        <div class="ann-modal-hd">
          <span>// SYSTEM BROADCAST LOG</span>
          <button class="ann-modal-close" onclick="Announcements.closeModal()"><i data-icon="x"></i></button>
        </div>
        <div class="ann-modal-body" id="ann-modal-body"></div>
      </div>`;
    modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
    document.body.appendChild(modal);
  }

  // ── Popup: dismiss store (localStorage, per-day, per-user) ───────────────────
  function _dismissKey() {
    let uid = '';
    try { uid = (window.Auth && Auth.getUser && Auth.getUser()?.id) || ''; } catch {}
    return uid ? `som_popup_dismissed:${uid}` : 'som_popup_dismissed';
  }
  function _today() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function _getDismissedToday() {
    try {
      const key  = _dismissKey();
      const raw  = localStorage.getItem(key);
      const data = raw ? JSON.parse(raw) : {};
      const today = _today();
      // Lazy-cleanup: keep only today's entries
      if (Object.keys(data).some(k => k !== today)) {
        const fresh = data[today] ? { [today]: data[today] } : {};
        localStorage.setItem(key, JSON.stringify(fresh));
        return Array.isArray(fresh[today]) ? fresh[today] : [];
      }
      return Array.isArray(data[today]) ? data[today] : [];
    } catch { return []; }
  }
  function _markDismissedToday(id) {
    try {
      const today = _today();
      const list  = _getDismissedToday();
      if (!list.includes(id)) list.push(id);
      localStorage.setItem(_dismissKey(), JSON.stringify({ [today]: list }));
    } catch {}
  }

  // ── Popup: styles (white/orange minimal, mascot, animations) ─────────────────
  function _injectPopupStyles() {
    if (document.getElementById('_ann-popup-styles')) return;
    const s = document.createElement('style');
    s.id = '_ann-popup-styles';
    s.textContent = `
      #ann-popup-backdrop {
        position: fixed; inset: 0; z-index: 9500;
        background: rgba(255, 255, 255, .04);
        backdrop-filter: blur(3px) saturate(110%);
        -webkit-backdrop-filter: blur(3px) saturate(110%);
        display: flex; align-items: center; justify-content: center;
        padding: 20px;
        animation: ann-pop-fade .25s ease-out;
      }
      @keyframes ann-pop-fade { from { opacity: 0 } to { opacity: 1 } }
      @keyframes ann-pop-rise {
        0%   { opacity: 0; transform: translateY(30px) scale(.85); }
        60%  { opacity: 1; transform: translateY(-4px) scale(1.02); }
        100% { opacity: 1; transform: translateY(0) scale(1); }
      }

      #ann-popup-box {
        position: relative;
        width: 100%; max-width: 460px;
        background: var(--bg-card);
        border: 1px solid var(--border);
        border-radius: 20px;
        overflow: hidden;
        box-shadow:
          0 32px 80px rgba(0, 0, 0, .45),
          0 8px 24px rgba(242, 100, 25, .18),
          0 0 0 1px rgba(242, 100, 25, .08);
        animation: ann-pop-rise .45s cubic-bezier(.34, 1.56, .64, 1);
      }
      #ann-popup-box::before {
        content: ''; position: absolute; top: 0; left: 0; right: 0; height: 4px;
        background: linear-gradient(90deg, #f26419 0%, #f59e0b 50%, #f26419 100%);
        background-size: 200% 100%;
        animation: ann-pop-shimmer 3s ease-in-out infinite;
      }
      @keyframes ann-pop-shimmer {
        0%, 100% { background-position: 0% 0%; }
        50%      { background-position: 100% 0%; }
      }
      /* Decorative gradient orbs */
      #ann-popup-box::after {
        content: ''; position: absolute;
        top: -60px; right: -60px; width: 180px; height: 180px;
        background: radial-gradient(circle, rgba(242,100,25,.18) 0%, transparent 70%);
        pointer-events: none;
        animation: ann-pop-orb 8s ease-in-out infinite;
      }
      @keyframes ann-pop-orb {
        0%, 100% { transform: translate(0, 0) scale(1); opacity: .6; }
        50%      { transform: translate(-20px, 20px) scale(1.15); opacity: 1; }
      }
      .ann-pop-orb2 {
        position: absolute; bottom: -50px; left: -40px;
        width: 140px; height: 140px;
        background: radial-gradient(circle, rgba(245,158,11,.14) 0%, transparent 70%);
        pointer-events: none;
        animation: ann-pop-orb 10s ease-in-out infinite reverse;
      }

      .ann-pop-close {
        position: absolute; top: 14px; right: 14px;
        width: 30px; height: 30px; border-radius: 10px;
        background: transparent; border: none; cursor: pointer;
        color: var(--text-muted); font-size: 16px; line-height: 1;
        display: flex; align-items: center; justify-content: center;
        transition: background .2s, color .2s, transform .2s;
        z-index: 5;
      }
      .ann-pop-close:hover { background: rgba(242,100,25,.12); color: #f26419; transform: rotate(90deg); }

      .ann-pop-body {
        position: relative; z-index: 2;
        padding: 32px 28px 22px;
        display: flex; flex-direction: column; align-items: center; text-align: center;
      }

      /* ── Mascot "Nong Som" ─────────────────────────────────── */
      .ann-mascot-wrap {
        position: relative;
        width: 110px; height: 110px;
        margin-bottom: 18px;
        animation: ann-mascot-pop .6s cubic-bezier(.34, 1.56, .64, 1) both;
      }
      @keyframes ann-mascot-pop {
        0%   { transform: scale(0) rotate(-30deg); opacity: 0; }
        70%  { transform: scale(1.15) rotate(8deg); opacity: 1; }
        100% { transform: scale(1) rotate(0); opacity: 1; }
      }
      .ann-mascot {
        position: relative;
        width: 100%; height: 100%;
        animation: ann-mascot-bob 3s ease-in-out infinite;
      }
      @keyframes ann-mascot-bob {
        0%, 100% { transform: translateY(0); }
        50%      { transform: translateY(-6px); }
      }
      .ann-mascot svg { width: 100%; height: 100%; display: block; overflow: visible; }
      .ann-mascot .m-eye {
        transform-origin: center;
        animation: ann-mascot-blink 4s ease-in-out infinite;
      }
      @keyframes ann-mascot-blink {
        0%, 92%, 100% { transform: scaleY(1); }
        94%, 98%      { transform: scaleY(.1); }
      }
      .ann-mascot .m-arm-l {
        transform-origin: 30px 55px;
        animation: ann-mascot-wave-l 1.8s ease-in-out infinite;
      }
      .ann-mascot .m-arm-r {
        transform-origin: 70px 55px;
        animation: ann-mascot-wave-r 1.8s ease-in-out infinite;
      }
      @keyframes ann-mascot-wave-l {
        0%, 100% { transform: rotate(0); }
        50%      { transform: rotate(-15deg); }
      }
      @keyframes ann-mascot-wave-r {
        0%, 100% { transform: rotate(0); }
        50%      { transform: rotate(15deg); }
      }
      .ann-mascot .m-leaf {
        transform-origin: 50px 22px;
        animation: ann-mascot-leaf 2.4s ease-in-out infinite;
      }
      @keyframes ann-mascot-leaf {
        0%, 100% { transform: rotate(-3deg); }
        50%      { transform: rotate(8deg); }
      }
      /* Sparkles around mascot */
      .ann-sparkle {
        position: absolute;
        width: 8px; height: 8px;
        background: #f59e0b;
        clip-path: polygon(50% 0, 60% 40%, 100% 50%, 60% 60%, 50% 100%, 40% 60%, 0 50%, 40% 40%);
        opacity: 0;
        animation: ann-sparkle-pop 2.4s ease-in-out infinite;
        filter: drop-shadow(0 0 4px rgba(242,100,25,.6));
      }
      .ann-sparkle.s1 { top: 4px;   left: -4px;  animation-delay: 0s;   }
      .ann-sparkle.s2 { top: -2px;  right: 6px;  animation-delay: .4s;  width: 6px; height: 6px; }
      .ann-sparkle.s3 { bottom: 18px; left: -8px; animation-delay: .8s; width: 5px; height: 5px; }
      .ann-sparkle.s4 { bottom: 6px; right: -2px; animation-delay: 1.2s; }
      .ann-sparkle.s5 { top: 38px; right: -10px; animation-delay: 1.6s; width: 6px; height: 6px; }
      @keyframes ann-sparkle-pop {
        0%, 100% { opacity: 0; transform: scale(0) rotate(0); }
        50%      { opacity: 1; transform: scale(1) rotate(180deg); }
      }

      .ann-pop-tag {
        font-size: 9.5px; font-weight: 900; letter-spacing: .12em;
        padding: 4px 10px; border-radius: 5px;
        margin-bottom: 12px;
        font-family: 'JetBrains Mono', 'Fira Code', monospace;
        border: 1px solid;
        animation: ann-pop-fadein .5s .25s ease-out both;
      }
      .ann-pop-title {
        font-size: 19px; font-weight: 800; color: var(--text);
        margin-bottom: 10px; line-height: 1.35;
        word-break: break-word;
        animation: ann-pop-fadein .5s .35s ease-out both;
      }
      .ann-pop-msg {
        font-size: 13.5px; color: var(--text-muted); line-height: 1.65;
        white-space: pre-wrap; word-break: break-word;
        max-height: 240px; overflow-y: auto;
        animation: ann-pop-fadein .5s .45s ease-out both;
      }
      @keyframes ann-pop-fadein {
        from { opacity: 0; transform: translateY(8px); }
        to   { opacity: 1; transform: translateY(0); }
      }

      .ann-pop-actions {
        position: relative; z-index: 2;
        display: flex; flex-direction: column; gap: 10px;
        padding: 4px 28px 22px;
        animation: ann-pop-fadein .5s .55s ease-out both;
      }
      .ann-pop-cta {
        position: relative; overflow: hidden;
        display: inline-flex; align-items: center; justify-content: center; gap: 8px;
        width: 100%; padding: 13px 20px;
        background: linear-gradient(135deg, #f26419 0%, #f59e0b 100%);
        color: #fff;
        border: none; border-radius: 12px;
        font-size: 13.5px; font-weight: 800; font-family: var(--font);
        cursor: pointer; text-decoration: none;
        transition: filter .2s, transform .15s, box-shadow .2s;
        box-shadow: 0 4px 14px rgba(242, 100, 25, .35), inset 0 1px 0 rgba(255,255,255,.2);
      }
      .ann-pop-cta::before {
        content: ''; position: absolute; top: 0; left: -100%;
        width: 50%; height: 100%;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,.4), transparent);
        animation: ann-cta-shine 2.5s ease-in-out infinite;
      }
      @keyframes ann-cta-shine {
        0%, 100% { left: -100%; }
        50%      { left: 150%; }
      }
      .ann-pop-cta:hover { filter: brightness(1.08); transform: translateY(-1px); box-shadow: 0 6px 18px rgba(242,100,25,.45); }
      .ann-pop-cta:active { transform: translateY(0); }
      .ann-pop-cta .ann-cta-arrow {
        font-size: 16px; transition: transform .25s;
      }
      .ann-pop-cta:hover .ann-cta-arrow { transform: translateX(4px); }

      .ann-pop-foot {
        position: relative; z-index: 2;
        display: flex; align-items: center; justify-content: space-between;
        padding: 13px 22px 16px;
        border-top: 1px solid var(--border);
        background: var(--bg);
        font-size: 11.5px; color: var(--text-muted);
      }
      .ann-pop-skip {
        display: inline-flex; align-items: center; gap: 7px;
        cursor: pointer; user-select: none;
        transition: color .2s;
      }
      .ann-pop-skip:hover { color: var(--text); }
      .ann-pop-skip input {
        accent-color: var(--orange, #f26419);
        cursor: pointer;
      }
      .ann-pop-dismiss {
        background: transparent; border: none; cursor: pointer;
        color: var(--text-muted); font-size: 11.5px; font-weight: 600;
        padding: 5px 10px; border-radius: 7px;
        transition: background .2s, color .2s;
      }
      .ann-pop-dismiss:hover { background: rgba(242,100,25,.08); color: #f26419; }

      .ann-pop-counter {
        position: absolute; bottom: 18px; left: 22px;
        font-size: 10px; color: var(--text-muted); opacity: .7;
        font-family: 'JetBrains Mono', 'Fira Code', monospace;
        letter-spacing: .08em;
      }

      @media (prefers-reduced-motion: reduce) {
        #ann-popup-box, .ann-mascot-wrap, .ann-mascot, .ann-mascot *,
        .ann-sparkle, .ann-pop-cta::before, #ann-popup-box::before, #ann-popup-box::after, .ann-pop-orb2 {
          animation: none !important;
        }
      }
    `;
    document.head.appendChild(s);
  }

  // ── Mascot SVG (น้องส้ม — cute orange) ───────────────────────────────────────
  function _mascotSvg() {
    return `
      <svg viewBox="0 0 100 110" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="m-body" cx="40%" cy="35%" r="65%">
            <stop offset="0%"  stop-color="#ffb066"/>
            <stop offset="55%" stop-color="#f59e0b"/>
            <stop offset="100%" stop-color="#d97706"/>
          </radialGradient>
          <filter id="m-shadow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="2"/>
            <feOffset dx="0" dy="2"/>
            <feComponentTransfer><feFuncA type="linear" slope="0.3"/></feComponentTransfer>
            <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>

        <!-- Leaf + stem on top -->
        <g class="m-leaf">
          <rect x="49" y="14" width="2.5" height="10" fill="#15803d" rx="1.2"/>
          <ellipse cx="55" cy="18" rx="7" ry="3.2" fill="#22c55e" transform="rotate(25 55 18)"/>
          <ellipse cx="55" cy="18" rx="4" ry="1.5" fill="#16a34a" transform="rotate(25 55 18)"/>
        </g>

        <!-- Arms (behind body) -->
        <ellipse class="m-arm-l" cx="18" cy="62" rx="6" ry="11" fill="#d97706"/>
        <ellipse class="m-arm-r" cx="82" cy="62" rx="6" ry="11" fill="#d97706"/>

        <!-- Body -->
        <ellipse cx="50" cy="60" rx="34" ry="36" fill="url(#m-body)" filter="url(#m-shadow)"/>

        <!-- Highlight gloss -->
        <ellipse cx="36" cy="42" rx="11" ry="7" fill="rgba(255,255,255,.35)"/>
        <ellipse cx="38" cy="40" rx="4" ry="2.5" fill="rgba(255,255,255,.6)"/>

        <!-- Cheeks (blush) -->
        <ellipse cx="30" cy="68" rx="5" ry="3.5" fill="rgba(255,99,99,.45)"/>
        <ellipse cx="70" cy="68" rx="5" ry="3.5" fill="rgba(255,99,99,.45)"/>

        <!-- Eyes (with glint) -->
        <g class="m-eye">
          <ellipse cx="40" cy="56" rx="4" ry="5" fill="#2a1810"/>
          <circle cx="41.5" cy="54" r="1.4" fill="#fff"/>
        </g>
        <g class="m-eye">
          <ellipse cx="60" cy="56" rx="4" ry="5" fill="#2a1810"/>
          <circle cx="61.5" cy="54" r="1.4" fill="#fff"/>
        </g>

        <!-- Smile -->
        <path d="M 41 72 Q 50 80 59 72" stroke="#2a1810" stroke-width="2.4" fill="none" stroke-linecap="round"/>
        <!-- Tongue tip -->
        <path d="M 47 76 Q 50 78 53 76" fill="#ff7878"/>
      </svg>
    `;
  }

  // ── Popup: render a single item ──────────────────────────────────────────────
  let _popupQueue   = [];
  let _popupCurrent = null;
  let _popupKeyHandler = null;

  function _renderPopup(item, position) {
    _injectPopupStyles();
    _closePopup(); // ensure only one DOM node

    _popupCurrent = item;

    const t        = _t(item.type);
    const hasCta   = item.popup_cta_label && item.popup_cta_url;
    const title    = item.title || '';
    const msg      = item.message || '';
    const showCounter = position && position.total > 1;

    const backdrop = document.createElement('div');
    backdrop.id = 'ann-popup-backdrop';
    backdrop.innerHTML = `
      <div id="ann-popup-box" role="dialog" aria-modal="true" aria-labelledby="ann-pop-title">
        <div class="ann-pop-orb2"></div>
        <button class="ann-pop-close" type="button" aria-label="Close" data-act="close"><i data-icon="x"></i></button>
        <div class="ann-pop-body">
          <div class="ann-mascot-wrap">
            <div class="ann-sparkle s1"></div>
            <div class="ann-sparkle s2"></div>
            <div class="ann-sparkle s3"></div>
            <div class="ann-sparkle s4"></div>
            <div class="ann-sparkle s5"></div>
            <div class="ann-mascot">${_mascotSvg()}</div>
          </div>
          <div class="ann-pop-tag" style="background:${t.bg};color:${t.color};border-color:${t.color}44">${t.symbol} ${t.label}</div>
          ${title ? `<div class="ann-pop-title" id="ann-pop-title">${escHtml(title)}</div>` : ''}
          <div class="ann-pop-msg">${escHtml(msg)}</div>
        </div>
        ${hasCta ? `
          <div class="ann-pop-actions">
            <a class="ann-pop-cta" href="${escHtml(item.popup_cta_url)}" target="_blank" rel="noopener noreferrer" data-act="cta">
              ${escHtml(item.popup_cta_label)} <span class="ann-cta-arrow">→</span>
            </a>
          </div>` : ''}
        <div class="ann-pop-foot">
          <label class="ann-pop-skip">
            <input type="checkbox" data-role="skip-today">
            ไม่ต้องแสดงอีกในวันนี้
          </label>
          <button class="ann-pop-dismiss" type="button" data-act="close">ปิด</button>
        </div>
        ${showCounter ? `<div class="ann-pop-counter">${position.index + 1} / ${position.total}</div>` : ''}
      </div>
    `;

    backdrop.addEventListener('click', e => {
      const act = e.target.closest('[data-act]')?.dataset?.act;
      if (act === 'close' || e.target === backdrop) {
        _handlePopupClose(item, backdrop);
      } else if (act === 'cta') {
        // Let the link navigate; close after click
        _handlePopupClose(item, backdrop);
      }
    });

    _popupKeyHandler = ev => { if (ev.key === 'Escape') _handlePopupClose(item, backdrop); };
    document.addEventListener('keydown', _popupKeyHandler);

    document.body.appendChild(backdrop);
  }

  function _handlePopupClose(item, backdrop) {
    const skip = backdrop.querySelector('[data-role="skip-today"]');
    if (skip && skip.checked) _markDismissedToday(item.id);
    _closePopup();
    _showNextPopup();
  }

  function _closePopup() {
    const el = document.getElementById('ann-popup-backdrop');
    if (el) el.remove();
    if (_popupKeyHandler) {
      document.removeEventListener('keydown', _popupKeyHandler);
      _popupKeyHandler = null;
    }
    _popupCurrent = null;
  }

  function _showNextPopup() {
    if (!_popupQueue.length) return;
    const next = _popupQueue.shift();
    _renderPopup(next.item, { index: next.index, total: next.total });
  }

  function _queuePopups(items) {
    const dismissed = _getDismissedToday();
    const pool = items.filter(a => {
      const d = a.display;
      return (d === 'popup' || d === 'all') && !dismissed.includes(a.id);
    });
    if (!pool.length) return;

    const total = pool.length;
    _popupQueue = pool.map((item, index) => ({ item, index, total }));
    _showNextPopup();
  }

  // ── Load & refresh ───────────────────────────────────────────────────────────
  async function load() {
    const res = await API.get('/announcements/index.php');
    if (!res?.ok) return;
    const items = res.data.data || [];
    _allItems = items;
    _renderTicker(items);
    _renderCard(items);
    return items;
  }

  // ── Init ─────────────────────────────────────────────────────────────────────
  function init(containerId = 'view-dash') {
    _injectStyles();
    const container = document.getElementById(containerId) || document.querySelector('.page-content');
    if (!container) return;
    _mount(container);

    // Popup only on dashboard, only on first load (not on the 60s refresh)
    const isDashboard = containerId === 'view-dash'
      || /(^|\/)dashboard\.html$/.test(location.pathname);

    load().then(items => {
      if (isDashboard && Array.isArray(items)) _queuePopups(items);
    });
    // Refresh every 60s (no popup re-trigger)
    setInterval(load, 60_000);
  }

  // Expose escHtml locally if not available
  function escHtml(s) {
    return String(s ?? '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return { init, load, openModal, closeModal };
})();
