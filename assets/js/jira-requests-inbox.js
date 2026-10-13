/**
 * Jira Requests Inbox — visible only to warapon.lea
 * Slide-in drawer on the right showing TJCR "Requests SOM Portal" tickets.
 */
(function () {
  'use strict';

  const INBOX_OWNER = 'warapon.lea';
  const POLL_MS = 5 * 60 * 1000; // 5 min badge refresh

  // ── Status helpers ──────────────────────────────────────────────
  const STATUS_COLOR = {
    'new'       : { bg: 'rgba(100,116,139,.12)', color: '#64748b' },
    'indeterminate': { bg: 'rgba(59,130,246,.12)', color: '#3b82f6' },
    'done'      : { bg: 'rgba(34,197,94,.12)',  color: '#22c55e' },
  };

  function statusStyle(catKey) {
    const s = STATUS_COLOR[catKey] || STATUS_COLOR['new'];
    return `background:${s.bg};color:${s.color};`;
  }

  function _ic(name, w, h) {
    w = w || 16; h = h || 16;
    if (typeof window._ic === 'function') return window._ic(name, w, h);
    // Fallback inline SVGs (used only if layout.js hasn't initialised yet)
    const icons = {
      'inbox'  : '<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
      'x'      : '<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
      'arrow-left': '<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
      'external-link': '<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
      'user-check': '<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/></svg>',
      'refresh-cw': '<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
    };
    const tmpl = icons[name] || icons['inbox'];
    return tmpl.replace(/\{w\}/g, w || 16).replace(/\{h\}/g, h || 16);
  }

  // ── API calls ─────────────────────────────────────────────────────────────
  // API.get/post return { ok, status, data } where data = parsed JSON body.
  // Our PHP wraps body as { success, message, data: payload }.
  // So the actual payload is at res.data.data.
  async function _apiCall(method, path, body) {
    const res = method === 'GET'
      ? await API.get(path)
      : await API.post(path, body);
    if (!res || !res.ok) {
      const msg = res?.data?.message || `HTTP ${res?.status || '?'}`;
      throw new Error(msg);
    }
    return res.data; // { success, message, data: payload }
  }

  async function inboxList() {
    return _apiCall('GET', '/jira-requests/?action=list');
  }

  async function inboxDetail(key) {
    return _apiCall('GET', '/jira-requests/?action=detail&key=' + encodeURIComponent(key));
  }

  async function inboxAssign(key) {
    return _apiCall('POST', '/jira-requests/?action=assign', { key });
  }

  async function inboxTransition(key, transitionId) {
    return _apiCall('POST', '/jira-requests/?action=transition', { key, transitionId });
  }

  // ── Toast helper ────────────────────────────────────────────────
  function toast(msg, type) {
    if (typeof showToast === 'function') { showToast(msg, type); return; }
    const d = document.createElement('div');
    d.textContent = msg;
    d.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:99999;padding:10px 18px;
      border-radius:10px;font-size:13px;font-weight:600;color:#fff;
      background:${type === 'error' ? '#ef4444' : '#22c55e'};
      box-shadow:0 4px 20px rgba(0,0,0,.18);animation:jriFadeIn .2s ease;`;
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 3000);
  }

  // ── Date formatting ─────────────────────────────────────────────
  function relativeTime(iso) {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 2)  return 'just now';
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    const d = Math.floor(h / 24);
    if (d < 7)  return d + 'd ago';
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  }

  // ── HTML escape helper ──────────────────────────────────────────
  function _esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  // ── Inject CSS ──────────────────────────────────────────────────
  function injectCSS() {
    if (document.getElementById('_jri-css')) return;
    const s = document.createElement('style');
    s.id = '_jri-css';
    s.textContent = `
      @keyframes jriSlideIn { from { transform:translateX(100%); opacity:0; } to { transform:translateX(0); opacity:1; } }
      @keyframes jriSlideOut{ from { transform:translateX(0);    opacity:1; } to { transform:translateX(100%); opacity:0; } }
      @keyframes jriFadeIn  { from { opacity:0; } to { opacity:1; } }

      #_jri-overlay {
        position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.35);
        display:none;align-items:stretch;justify-content:flex-end;
      }
      #_jri-overlay.open { display:flex; }

      #_jri-drawer {
        width:520px;max-width:95vw;height:100%;
        background:var(--bg-card,#fff);border-left:1.5px solid var(--border,#e5e7eb);
        display:flex;flex-direction:column;overflow:hidden;
        animation:jriSlideIn .22s cubic-bezier(.22,.68,0,1.05) both;
        box-shadow:-12px 0 40px rgba(0,0,0,.12);
      }

      /* header */
      #_jri-header {
        display:flex;align-items:center;gap:10px;padding:16px 18px 14px;
        border-bottom:1.5px solid var(--border,#e5e7eb);flex-shrink:0;
      }
      #_jri-header-title {
        flex:1;font-size:13px;font-weight:800;color:var(--text,#111);letter-spacing:.02em;
      }
      ._jri-hbtn {
        width:30px;height:30px;border-radius:8px;border:1.5px solid var(--border,#e5e7eb);
        background:transparent;color:var(--text-muted,#6b7280);cursor:pointer;
        display:flex;align-items:center;justify-content:center;
        transition:background .12s,color .12s,border-color .12s;font-family:var(--font,inherit);
      }
      ._jri-hbtn:hover { background:var(--orange-dim,rgba(242,100,25,.08));color:var(--orange,#f26419);border-color:rgba(242,100,25,.35); }

      /* list panel */
      #_jri-list-panel { flex:1;overflow-y:auto;overscroll-behavior:contain; }
      ._jri-item {
        display:flex;flex-direction:column;gap:5px;padding:13px 18px;
        border-bottom:1px solid var(--border,#f0f0f0);cursor:pointer;
        transition:background .12s;position:relative;
      }
      ._jri-item:hover { background:var(--bg,#fafafa); }
      ._jri-section-lbl {
        padding:6px 18px 4px;font-size:9px;font-weight:800;text-transform:uppercase;
        letter-spacing:.08em;color:var(--text-muted,#888);background:var(--bg-card,#fff);
        border-bottom:1px solid var(--border,#f0f0f0);position:sticky;top:0;z-index:1;
      }
      ._jri-item-row1 { display:flex;align-items:center;gap:8px; }
      ._jri-key {
        font-size:10px;font-weight:800;font-family:monospace;
        color:var(--orange,#f26419);flex-shrink:0;letter-spacing:.02em;
      }
      ._jri-status-chip {
        font-size:9px;font-weight:700;padding:2px 7px;border-radius:10px;
        flex-shrink:0;letter-spacing:.03em;text-transform:uppercase;
      }
      ._jri-summary {
        font-size:12px;font-weight:600;color:var(--text,#111);
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
        flex:1;min-width:0;
      }
      ._jri-meta {
        font-size:10.5px;color:var(--text-muted,#6b7280);
        display:flex;align-items:center;gap:8px;flex-wrap:wrap;
      }
      ._jri-reporter-avatar {
        width:18px;height:18px;border-radius:50%;object-fit:cover;flex-shrink:0;
      }

      ._jri-empty {
        padding:48px 24px;text-align:center;
        font-size:12px;color:var(--text-muted,#6b7280);
        display:flex;flex-direction:column;align-items:center;gap:10px;
      }
      ._jri-empty-icon { opacity:.3; }

      /* detail panel */
      #_jri-detail-panel {
        position:absolute;inset:0;background:var(--bg-card,#fff);
        display:flex;flex-direction:column;overflow:hidden;
      }
      #_jri-detail-header {
        display:flex;align-items:center;gap:10px;padding:14px 18px 12px;
        border-bottom:1.5px solid var(--border,#e5e7eb);flex-shrink:0;
      }
      #_jri-detail-body {
        flex:1;overflow-y:auto;padding:18px;overscroll-behavior:contain;
      }
      ._jri-detail-key {
        font-size:11px;font-weight:800;font-family:monospace;
        color:var(--orange,#f26419);letter-spacing:.03em;
      }
      ._jri-detail-title {
        font-size:15px;font-weight:700;color:var(--text,#111);
        line-height:1.4;margin:8px 0 14px;
      }
      ._jri-reporter-row {
        display:flex;align-items:center;gap:10px;padding:10px 14px;
        background:var(--bg,#f8f9fa);border-radius:10px;margin-bottom:14px;
      }
      ._jri-reporter-av48 {
        width:40px;height:40px;border-radius:50%;object-fit:cover;flex-shrink:0;
      }
      ._jri-reporter-info { display:flex;flex-direction:column;gap:2px; }
      ._jri-reporter-name { font-size:12px;font-weight:700;color:var(--text,#111); }
      ._jri-reporter-email { font-size:11px;color:var(--text-muted,#6b7280); }
      ._jri-desc-label { font-size:10px;font-weight:700;color:var(--text-muted,#6b7280);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px; }
      ._jri-desc-html {
        font-size:13px;color:var(--text,#111);line-height:1.6;
        border:1.5px solid var(--border,#e5e7eb);border-radius:10px;padding:14px;
        background:var(--bg,#fafafa);min-height:60px;
      }
      ._jri-desc-html p { margin:0 0 8px; }
      ._jri-desc-html p:last-child { margin-bottom:0; }
      ._jri-desc-html ul,._jri-desc-html ol { padding-left:20px;margin:4px 0; }

      /* action bar */
      #_jri-action-bar {
        padding:14px 18px;border-top:1.5px solid var(--border,#e5e7eb);
        display:flex;gap:8px;flex-wrap:wrap;flex-shrink:0;
        background:var(--bg-card,#fff);
      }
      ._jri-action-btn {
        flex:1;min-width:110px;padding:9px 14px;border-radius:10px;
        font-size:12px;font-weight:700;cursor:pointer;border:1.5px solid transparent;
        transition:filter .12s,opacity .12s;font-family:var(--font,inherit);
        display:flex;align-items:center;justify-content:center;gap:6px;
      }
      ._jri-action-btn:disabled { opacity:.45;cursor:not-allowed; }
      ._jri-action-btn:not(:disabled):hover { filter:brightness(1.08); }
      ._jri-btn-assign      { background:rgba(59,130,246,.12);color:#3b82f6;border-color:rgba(59,130,246,.35); }
      ._jri-btn-progress    { background:rgba(251,191,36,.12);color:#b45309;border-color:rgba(251,191,36,.4); }
      ._jri-btn-done        { background:rgba(34,197,94,.12);color:#16a34a;border-color:rgba(34,197,94,.35); }
      ._jri-btn-create-user { background:rgba(139,92,246,.12);color:#7c3aed;border-color:rgba(139,92,246,.35); }
      ._jri-btn-trans       { background:var(--bg);color:var(--text-muted);border-color:var(--border,#e5e7eb); font-size:11px; }
      ._jri-btn-trans.is-done { background:rgba(34,197,94,.10);color:#15803d;border-color:rgba(34,197,94,.3); }

      /* create-user form */
      ._jri-cu-wrap { display:flex;flex-direction:column;gap:12px; }
      ._jri-cu-heading { font-size:13px;font-weight:800;color:var(--text,#111); }
      ._jri-cu-sub { font-size:11px;color:var(--text-muted,#6b7280);margin-top:-6px; }
      ._jri-cu-field { display:flex;flex-direction:column;gap:4px; }
      ._jri-cu-label { font-size:9.5px;font-weight:700;color:var(--text-muted,#6b7280);text-transform:uppercase;letter-spacing:.07em; }
      ._jri-cu-input {
        padding:8px 12px;border-radius:8px;border:1.5px solid var(--border,#e5e7eb);
        background:var(--bg,#fafafa);color:var(--text,#111);font-size:12.5px;font-family:inherit;
        outline:none;transition:border-color .12s;
      }
      ._jri-cu-input:focus { border-color:var(--orange,#f26419); }
      ._jri-cu-hint { font-size:10px;color:var(--text-muted,#6b7280); }
      ._jri-cu-info {
        padding:10px 12px;border-radius:8px;font-size:11px;line-height:1.5;
        background:rgba(139,92,246,.08);border:1px solid rgba(139,92,246,.2);color:#6d28d9;
      }
      ._jri-cu-actions { display:flex;gap:8px;margin-top:4px; }
      ._jri-cu-cancel { background:var(--bg);color:var(--text-muted);border-color:var(--border); }

      ._jri-spin {
        width:12px;height:12px;border:2px solid currentColor;border-top-color:transparent;
        border-radius:50%;animation:jriSpin .6s linear infinite;display:inline-block;
      }
      @keyframes jriSpin { to { transform:rotate(360deg); } }

    `;
    document.head.appendChild(s);
  }

  // ── Build DOM ───────────────────────────────────────────────────
  function buildOverlay() {
    if (document.getElementById('_jri-overlay')) return;
    const ov = document.createElement('div');
    ov.id = '_jri-overlay';
    ov.innerHTML = `
      <div id="_jri-drawer">
        <!-- List panel -->
        <div id="_jri-list-pane" style="display:flex;flex-direction:column;height:100%;position:relative;">
          <div id="_jri-header">
            <span style="color:var(--orange,#f26419);">${_ic('inbox', 16, 16)}</span>
            <span id="_jri-header-title">Requests SOM Portal</span>
            <button class="_jri-hbtn" id="_jri-refresh-btn" title="Refresh">${_ic('refresh-cw', 14, 14)}</button>
            <button class="_jri-hbtn" id="_jri-close-btn" title="Close">${_ic('x', 14, 14)}</button>
          </div>
          <div id="_jri-list-panel">
            <div class="_jri-empty">
              <div class="_jri-empty-icon">${_ic('inbox', 40, 40)}</div>
              <div>Loading…</div>
            </div>
          </div>
        </div>

        <!-- Detail panel (overlaps list) -->
        <div id="_jri-detail-panel" style="display:none;">
          <div id="_jri-detail-header">
            <button class="_jri-hbtn" id="_jri-back-btn" title="Back to list">${_ic('arrow-left', 14, 14)}</button>
            <span class="_jri-detail-key" id="_jri-d-key"></span>
            <span style="flex:1;"></span>
            <a id="_jri-jira-link" href="#" target="_blank" rel="noopener" class="_jri-hbtn" title="Open in Jira">${_ic('external-link', 13, 13)}</a>
            <button class="_jri-hbtn" id="_jri-d-close-btn" title="Close">${_ic('x', 14, 14)}</button>
          </div>
          <div id="_jri-detail-body">
            <div class="_jri-empty"><div class="jri-empty-icon">${_ic('inbox', 32, 32)}</div><div>Loading…</div></div>
          </div>
          <div id="_jri-action-bar" style="display:none;"></div>
        </div>
      </div>`;
    document.body.appendChild(ov);

    // Close on backdrop click
    ov.addEventListener('click', e => { if (e.target === ov) JiraInbox.close(); });
    document.getElementById('_jri-close-btn').onclick   = () => JiraInbox.close();
    document.getElementById('_jri-d-close-btn').onclick = () => JiraInbox.close();
    document.getElementById('_jri-back-btn').onclick    = () => JiraInbox._showList();
    document.getElementById('_jri-refresh-btn').onclick = () => JiraInbox._loadList();
  }

  function _isSM() {
    const u = (typeof Auth !== 'undefined') ? Auth.getUser?.() : null;
    return u && (u.team === 'sm' || ['sm_admin','sm_lead','sm_user','dev_sm','super_admin'].includes(u.role));
  }
  function _isOwner() {
    const u = (typeof Auth !== 'undefined') ? Auth.getUser?.() : null;
    return u?.username === INBOX_OWNER;
  }

  // ── Main object ─────────────────────────────────────────────────
  const JiraInbox = {
    _issues        : [],
    _pollTimer     : null,
    _currentDetail : null,

    init() {
      if (!_isSM()) return;
      injectCSS();
      buildOverlay();
      this._startPoll();
    },

    open() {
      buildOverlay();
      document.getElementById('_jri-overlay').classList.add('open');
      document.getElementById('_jri-detail-panel').style.display = 'none';
      document.getElementById('_jri-action-bar').style.display   = 'none';
      this._loadList();
    },

    // Open drawer and jump straight to a specific ticket detail
    openDirect(key) {
      buildOverlay();
      document.getElementById('_jri-overlay').classList.add('open');
      document.getElementById('_jri-detail-panel').style.display = 'none';
      document.getElementById('_jri-action-bar').style.display   = 'none';
      this._openDetail(key);
      // Load list in background so Back button works
      inboxList().then(r => { if (r.success) { this._issues = r.data?.issues || []; this._renderList(); this._updateBadge(); } }).catch(() => {});
    },

    close() {
      const ov = document.getElementById('_jri-overlay');
      if (ov) ov.classList.remove('open');
    },

    // ── List ──────────────────────────────────────────────────────
    async _loadList() {
      const panel = document.getElementById('_jri-list-panel');
      if (!panel) return;
      panel.innerHTML = `<div class="_jri-empty"><div class="_jri-empty-icon" style="animation:jriSpin .8s linear infinite;">${_ic('refresh-cw', 32, 32)}</div><div>Loading…</div></div>`;

      try {
        const r = await inboxList();
        if (!r.success) throw new Error(r.message || 'Failed');
        this._issues = r.data?.issues || [];
        this._renderList();
        this._updateBadge();
      } catch (e) {
        panel.innerHTML = `<div class="_jri-empty"><div>Error: ${e.message}</div></div>`;
      }
    },

    _renderList() {
      const panel = document.getElementById('_jri-list-panel');
      if (!panel) return;
      const issues = this._issues;

      if (!issues.length) {
        panel.innerHTML = `<div class="_jri-empty">
          <div class="_jri-empty-icon">${_ic('inbox', 40, 40)}</div>
          <div style="font-weight:700;">All clear</div>
          <div>No open requests</div>
        </div>`;
        return;
      }

      const openIssues   = issues.filter(i => i.status_cat !== 'done');
      const closedIssues = issues.filter(i => i.status_cat === 'done');

      const renderItem = iss => {
        const ss = statusStyle(iss.status_cat);
        const avatar = iss.reporter_avatar
          ? `<img class="_jri-reporter-avatar" src="${iss.reporter_avatar}" alt="" onerror="this.style.display='none'">`
          : '';
        const assigned = iss.is_assigned
          ? `<span style="color:var(--orange,#f26419);font-size:10px;">● assigned</span>`
          : '';
        return `<div class="_jri-item" data-key="${iss.key}" onclick="JiraInbox._openDetail('${iss.key}')">
          <div class="_jri-item-row1">
            <span class="_jri-key">${iss.key}</span>
            <span class="_jri-status-chip" style="${ss}">${iss.status}</span>
            <span class="_jri-summary" title="${iss.summary}">${iss.summary}</span>
          </div>
          <div class="_jri-meta">
            ${avatar}
            <span>${iss.reporter_name || 'Unknown'}</span>
            ${iss.reporter_email ? `<span style="opacity:.65;">${iss.reporter_email}</span>` : ''}
            <span style="margin-left:auto;">${relativeTime(iss.created)}</span>
            ${assigned}
          </div>
        </div>`;
      };

      let html = '';
      if (openIssues.length) {
        html += `<div class="_jri-section-lbl">Open (${openIssues.length})</div>`;
        html += openIssues.map(renderItem).join('');
      } else {
        html += `<div class="_jri-empty" style="padding:20px 16px;"><div style="font-size:12px;color:var(--text-muted,#888);">No open requests</div></div>`;
      }
      if (closedIssues.length) {
        html += `<div class="_jri-section-lbl" style="margin-top:8px;">Closed / Canceled (${closedIssues.length})</div>`;
        html += closedIssues.map(renderItem).join('');
      }
      panel.innerHTML = html;
    },

    _updateBadge() {
      const pending = this._issues.filter(i => i.status_cat !== 'done').length;
      const txt = pending > 99 ? '99+' : String(pending);
      // Topbar button badge
      const tbBadge = document.getElementById('_jri-tb-badge');
      if (tbBadge) { tbBadge.textContent = txt; tbBadge.style.display = pending > 0 ? 'block' : 'none'; }
      // Avatar dropdown badge
      const ddBadge = document.getElementById('_jri-dd-badge');
      if (ddBadge) { ddBadge.textContent = txt; ddBadge.style.display = pending > 0 ? 'inline-block' : 'none'; }
    },

    _showList() {
      document.getElementById('_jri-detail-panel').style.display = 'none';
      document.getElementById('_jri-action-bar').style.display   = 'none';
    },

    // ── Detail ────────────────────────────────────────────────────
    async _openDetail(key) {
      const dp   = document.getElementById('_jri-detail-panel');
      const body = document.getElementById('_jri-detail-body');
      const bar  = document.getElementById('_jri-action-bar');

      document.getElementById('_jri-d-key').textContent = key;
      dp.style.display  = 'flex';
      dp.style.flexDirection = 'column';
      bar.style.display = 'none';
      body.innerHTML    = `<div class="_jri-empty"><div style="animation:jriSpin .8s linear infinite;">${_ic('refresh-cw', 28, 28)}</div><div>Loading…</div></div>`;

      try {
        const r = await inboxDetail(key);
        if (!r.success) throw new Error(r.message || 'Failed');
        const d = r.data;
        this._currentDetail = d; // store for create-user flow
        document.getElementById('_jri-jira-link').href = d.url;
        this._renderDetailBody(d);
        this._buildActionBar(key, d);
      } catch (e) {
        body.innerHTML = `<div class="_jri-empty"><div>Error: ${e.message}</div></div>`;
      }
    },

    _renderDetailBody(d) {
      const body = document.getElementById('_jri-detail-body');
      if (!body) return;
      const ss = statusStyle(d.status_cat);
      const initials = (d.reporter_name || '?')[0].toUpperCase();
      const avatar = d.reporter_avatar
        ? `<img class="_jri-reporter-av48" src="${_esc(d.reporter_avatar)}" alt="" onerror="this.style.display='none'">`
        : `<div class="_jri-reporter-av48" style="background:var(--orange-dim,rgba(242,100,25,.1));display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;color:var(--orange,#f26419);">${initials}</div>`;

      body.innerHTML = `
        <div class="_jri-detail-title">${_esc(d.summary)}</div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap;">
          <span class="_jri-status-chip" style="${ss}">${_esc(d.status)}</span>
          ${d.priority ? `<span style="font-size:10px;color:var(--text-muted,#6b7280);">Priority: ${_esc(d.priority)}</span>` : ''}
          <span style="font-size:10px;color:var(--text-muted,#6b7280);margin-left:auto;">${relativeTime(d.created)}</span>
        </div>

        <div class="_jri-reporter-row">
          ${avatar}
          <div class="_jri-reporter-info">
            <div class="_jri-reporter-name">${_esc(d.reporter_name || 'Unknown')}</div>
            ${d.reporter_email ? `<div class="_jri-reporter-email">${_esc(d.reporter_email)}</div>` : ''}
            <div style="font-size:10px;color:var(--text-muted,#6b7280);margin-top:1px;">Reporter</div>
          </div>
          ${d.assignee_name ? `<div style="margin-left:auto;font-size:10.5px;color:var(--text-muted,#6b7280);">Assigned: <strong>${_esc(d.assignee_name)}</strong></div>` : ''}
        </div>

        <div class="_jri-desc-label">Description</div>
        <div class="_jri-desc-html" id="_jri-desc-content">
          ${d.description_html || '<span style="opacity:.5;font-style:italic;">No description provided.</span>'}
        </div>`;
    },

    _buildActionBar(key, d) {
      const bar         = document.getElementById('_jri-action-bar');
      const transitions = d.transitions || [];
      const isDone      = d.status_cat === 'done';
      const isAssigned  = !!d.assignee_name;
      const canAct      = _isOwner(); // only warapon.lea may take actions

      const btns = [];

      // Assign to Me
      if (canAct && !isAssigned) {
        btns.push(`<button class="_jri-action-btn _jri-btn-assign" id="_jri-btn-assign" onclick="JiraInbox._doAssign('${_esc(key)}')">
          ${_ic('user-check', 13, 13)} Assign to Me
        </button>`);
      }

      // Show ALL available transitions (not just regex-matched ones)
      if (canAct && transitions.length > 0) {
        transitions.forEach(t => {
          const gosDone = t.cat_key === 'done' || /done|close|cancel|complete|resolve/i.test(t.name) || /done|close|cancel|complete|resolve/i.test(t.to_name);
          const cls = gosDone ? '_jri-btn-trans is-done' : '_jri-btn-trans';
          const disAttr = (gosDone && isDone) ? 'disabled' : '';
          const safeName = _esc(t.name);
          const safeId   = _esc(t.id);
          btns.push(`<button class="_jri-action-btn ${cls}" data-tid="${safeId}" onclick="JiraInbox._doTransition('${_esc(key)}','${safeId}','${safeName}')" ${disAttr}>
            ${safeName}
          </button>`);
        });
      }

      // Create Dev User (INBOX_OWNER only, needs reporter email)
      if (canAct && d.reporter_email) {
        btns.push(`<button class="_jri-action-btn _jri-btn-create-user" id="_jri-btn-create-user" onclick="JiraInbox._openCreateUserPanel()">
          ${_ic('user-check', 13, 13)} Create Dev User
        </button>`);
      }

      if (!btns.length) { bar.style.display = 'none'; return; }
      bar.innerHTML    = btns.join('');
      bar.style.display = 'flex';
      bar.style.flexWrap = 'wrap';
    },

    async _doAssign(key) {
      const btn = document.getElementById('_jri-btn-assign');
      if (btn) { btn.disabled = true; btn.innerHTML = `<span class="_jri-spin"></span> Assigning…`; }

      try {
        const r = await inboxAssign(key);
        if (!r.success) throw new Error(r.message);
        toast('Assigned to you — ' + key, 'success');
        await this._openDetail(key);
        inboxList().then(lr => { if (lr.success) { this._issues = lr.data?.issues || []; this._updateBadge(); } }).catch(() => {});
      } catch (e) {
        toast('Assign failed: ' + e.message, 'error');
        if (btn) { btn.disabled = false; btn.innerHTML = `${_ic('user-check', 13, 13)} Assign to Me`; }
      }
    },

    async _doTransition(key, transitionId, label) {
      // Find the clicked button by its data-tid attribute (works for any transition)
      const btn = document.querySelector(`[data-tid="${transitionId}"]`);
      if (btn) { btn.disabled = true; btn.innerHTML = `<span class="_jri-spin"></span> ${_esc(label)}…`; }

      try {
        const r = await inboxTransition(key, transitionId);
        if (!r.success) throw new Error(r.message);
        toast(`Moved to "${label}" — ${key}`, 'success');
        await this._openDetail(key);
        inboxList().then(lr => { if (lr.success) { this._issues = lr.data?.issues || []; this._renderList(); this._updateBadge(); } }).catch(() => {});
      } catch (e) {
        toast('Transition failed: ' + e.message, 'error');
        if (btn) { btn.disabled = false; btn.innerHTML = label; }
      }
    },

    // ── Create Dev User ───────────────────────────────────────────
    _openCreateUserPanel() {
      const d = this._currentDetail;
      if (!d || !d.reporter_email) return;

      const body = document.getElementById('_jri-detail-body');
      const bar  = document.getElementById('_jri-action-bar');
      if (!body) return;

      const emailPrefix = d.reporter_email.split('@')[0].toLowerCase();

      bar.style.display = 'none';
      body.innerHTML = `
        <div class="_jri-cu-wrap">
          <div class="_jri-cu-heading">Create Dev User</div>
          <div class="_jri-cu-sub">จาก ticket <strong>${_esc(d.key)}</strong> · ${_esc(d.reporter_name || '')}</div>

          <div class="_jri-cu-field">
            <label class="_jri-cu-label">Full Name *</label>
            <input type="text" id="_jri-cu-name" class="_jri-cu-input" value="${_esc(d.reporter_name || '')}" placeholder="Full name (English)">
          </div>

          <div class="_jri-cu-field">
            <label class="_jri-cu-label">Email *</label>
            <input type="email" id="_jri-cu-email" class="_jri-cu-input" value="${_esc(d.reporter_email)}" placeholder="email@company.com">
          </div>

          <div class="_jri-cu-field">
            <label class="_jri-cu-label">Username *</label>
            <input type="text" id="_jri-cu-username" class="_jri-cu-input" value="${_esc(emailPrefix)}" placeholder="username">
            <span class="_jri-cu-hint">Cannot be changed after creation</span>
          </div>

          <div class="_jri-cu-field">
            <label class="_jri-cu-label">Dev Sub-team *</label>
            <select id="_jri-cu-subteam" class="_jri-cu-input">
              <option value="">Loading…</option>
            </select>
          </div>

          <div class="_jri-cu-info">
            A temporary password will be sent to the email address. The user must change it on first login.
          </div>

          <div class="_jri-cu-actions">
            <button class="_jri-action-btn _jri-cu-cancel" onclick="JiraInbox._cancelCreateUser()">Cancel</button>
            <button class="_jri-action-btn _jri-btn-create-user" id="_jri-cu-submit" onclick="JiraInbox._submitCreateUser()">
              ${_ic('user-check', 13, 13)} Create User
            </button>
          </div>
        </div>`;

      this._loadSubteams();
    },

    async _loadSubteams() {
      try {
        const res = await API.get('/dev-subteams/');
        const list = (res?.data?.data) || [];
        const sel = document.getElementById('_jri-cu-subteam');
        if (!sel) return;
        const opts = list.map(s => `<option value="${_esc(s)}">${_esc(s)}</option>`).join('');
        const hasOther = list.some(s => s.toLowerCase() === 'other');
        sel.innerHTML = opts + (!hasOther ? `<option value="Other">Other</option>` : '');
        sel.value = 'Other';
        if (sel.value !== 'Other') sel.selectedIndex = 0; // fallback
      } catch (_) {
        const sel = document.getElementById('_jri-cu-subteam');
        if (sel) { sel.innerHTML = '<option value="Other">Other</option>'; sel.value = 'Other'; }
      }
    },

    _cancelCreateUser() {
      const d = this._currentDetail;
      if (d) {
        this._renderDetailBody(d);
        const key = d.key;
        this._buildActionBar(key, d);
      }
    },

    async _submitCreateUser() {
      const name      = document.getElementById('_jri-cu-name')?.value.trim();
      const email     = document.getElementById('_jri-cu-email')?.value.trim();
      const username  = document.getElementById('_jri-cu-username')?.value.trim();
      const devSubteam = document.getElementById('_jri-cu-subteam')?.value;

      if (!name)       { toast('กรุณากรอก Full Name', 'error'); return; }
      if (!email)      { toast('กรุณากรอก Email', 'error'); return; }
      if (!username)   { toast('กรุณากรอก Username', 'error'); return; }
      if (!devSubteam) { toast('กรุณาเลือก Dev Sub-team', 'error'); return; }

      const btn = document.getElementById('_jri-cu-submit');
      if (btn) { btn.disabled = true; btn.innerHTML = `<span class="_jri-spin"></span> Creating…`; }

      try {
        const res = await API.post('/users/', {
          name,
          username,
          email,
          role       : 'dev_user',
          dev_subteam: devSubteam,
        });

        if (res?.ok) {
          toast(`สร้าง user "${username}" สำเร็จ — ส่ง temp password ทาง email แล้ว`, 'success');
          this._cancelCreateUser();
        } else {
          const msg = res?.data?.message || 'Create user failed';
          toast(msg, 'error');
          if (btn) { btn.disabled = false; btn.innerHTML = `${_ic('user-check', 13, 13)} Create User`; }
        }
      } catch (e) {
        toast('Error: ' + e.message, 'error');
        if (btn) { btn.disabled = false; btn.innerHTML = `${_ic('user-check', 13, 13)} Create User`; }
      }
    },

    // ── Badge polling ─────────────────────────────────────────────
    _startPoll() {
      // Initial fetch after 2s (let page settle)
      setTimeout(() => this._pollBadge(), 2000);
      this._pollTimer = setInterval(() => this._pollBadge(), POLL_MS);
    },

    async _pollBadge() {
      try {
        const r = await inboxList();
        if (r.success) {
          this._issues = r.data?.issues || [];
          this._updateBadge();
          // If drawer is open + list panel is visible, re-render
          const ov = document.getElementById('_jri-overlay');
          const dp = document.getElementById('_jri-detail-panel');
          if (ov?.classList.contains('open') && dp?.style.display === 'none') {
            this._renderList();
          }
        }
      } catch (_) { /* silent */ }
    },
  };

  // ── Expose globally ─────────────────────────────────────────────
  window.JiraInbox = JiraInbox;

  // Auto-init after DOM ready (layout.js will have Auth by then)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(() => JiraInbox.init(), 300));
  } else {
    setTimeout(() => JiraInbox.init(), 300);
  }
})();
