/* ═══════════════════════════════════════════════════════════
   Dev Toolbar  |  Visible only to dev_sm role
   ═══════════════════════════════════════════════════════════ */

const DevToolbar = (() => {

  // ── State ──────────────────────────────────────────────
  let _open       = false;
  let _activeTab  = 'jwt';
  let _apiLog     = [];       // [{method,path,status,ms,ts}]
  let _paused     = false;
  let _sysData    = null;
  let _sysLoading = false;
  let _panel      = null;
  let _toggle     = null;
  let _patchedApi = false;

  const MAX_LOG = 80;

  // ── Helpers ────────────────────────────────────────────
  function fmtBytes(b) {
    if (b < 1024)       return b + ' B';
    if (b < 1048576)    return (b/1024).toFixed(1) + ' KB';
    return (b/1048576).toFixed(2) + ' MB';
  }
  function fmtMs(ms) {
    return ms >= 1000 ? (ms/1000).toFixed(2) + 's' : ms + 'ms';
  }
  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString('th-TH', {hour:'2-digit',minute:'2-digit',second:'2-digit'});
  }
  function fmtDate(ts) {
    const d = new Date(ts * 1000);
    return d.toLocaleDateString('th-TH', {day:'2-digit',month:'short'}) + ' ' +
           d.toLocaleTimeString('th-TH', {hour:'2-digit',minute:'2-digit'});
  }
  function decodeJwt(token) {
    try {
      const parts   = token.split('.');
      const payload = JSON.parse(atob(parts[1].replace(/-/g,'+').replace(/_/g,'/')));
      const header  = JSON.parse(atob(parts[0].replace(/-/g,'+').replace(/_/g,'/')));
      return { header, payload };
    } catch { return null; }
  }
  function escHtml(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function copyText(text) {
    navigator.clipboard?.writeText(text).then(() => {
      showToast?.('Copied to clipboard', 'success');
    }).catch(() => {});
  }

  // ── API Interceptor ────────────────────────────────────
  // Wraps API.request to capture every call + timing
  function _patchApiRequest() {
    if (_patchedApi || typeof API === 'undefined') return;
    const orig = API.request.bind(API);
    API.request = async function(method, path, ...rest) {
      const t0  = Date.now();
      const res = await orig(method, path, ...rest);
      const ms  = Date.now() - t0;
      if (!_paused) {
        _apiLog.unshift({ method, path, status: res?.status ?? 0, ok: res?.ok ?? false, ms, ts: Date.now() });
        if (_apiLog.length > MAX_LOG) _apiLog.length = MAX_LOG;
        if (_open && _activeTab === 'api') _renderApiTab();
      }
      return res;
    };
    _patchedApi = true;
  }

  // ── Build DOM ──────────────────────────────────────────
  function _buildPanel() {
    const el = document.createElement('div');
    el.id = 'dev-toolbar-panel';
    el.innerHTML = `
      <div class="dt-header" id="dt-drag-handle">
        <div class="dt-badge-ping"></div>
        <div class="dt-title"><i data-icon="zap"></i> DEV <span>TOOLBAR</span></div>
        <button class="dt-close" id="dt-close-btn" title="Close">×</button>
      </div>
      <div class="dt-tabs" id="dt-tabs">
        <div class="dt-tab active" data-tab="jwt">JWT</div>
        <div class="dt-tab" data-tab="api">API Monitor</div>
        <div class="dt-tab" data-tab="sys">System</div>
        <div class="dt-tab" data-tab="rate">Rate Limit</div>
      </div>
      <div class="dt-body" id="dt-body">
        <div class="dt-pane active" id="dt-pane-jwt"></div>
        <div class="dt-pane" id="dt-pane-api"></div>
        <div class="dt-pane" id="dt-pane-sys"></div>
        <div class="dt-pane" id="dt-pane-rate"></div>
      </div>
      <div class="dt-footer">
        <span id="dt-footer-ts">–</span>
        <span class="dt-footer-refresh" id="dt-refresh-btn" title="Refresh system data">↻ Refresh</span>
      </div>
    `;
    return el;
  }

  function _buildToggle() {
    const btn = document.createElement('button');
    btn.id    = 'dev-toolbar-toggle';
    btn.title = 'Dev Toolbar (Ctrl+Shift+D)';
    btn.innerHTML = '<i data-icon="zap"></i>';
    return btn;
  }

  // ── Render: JWT Tab ────────────────────────────────────
  function _renderJwtTab() {
    const pane  = document.getElementById('dt-pane-jwt');
    const token = typeof Auth !== 'undefined' ? Auth.getToken?.() : null;
    if (!token) { pane.innerHTML = '<div class="dt-loading" style="color:#555">No token found</div>'; return; }

    const dec  = decodeJwt(token);
    if (!dec) { pane.innerHTML = '<div class="dt-loading" style="color:#f87171">Could not decode token</div>'; return; }

    const { payload, header } = dec;
    const now     = Math.floor(Date.now() / 1000);
    const issuedAgo = now - (payload.iat || now);
    const ttl       = (payload.exp || now) - now;
    const total     = (payload.exp || now) - (payload.iat || now);
    const pct       = Math.max(0, Math.min(100, (ttl / total) * 100));
    const expClass  = pct > 50 ? 'green' : pct > 20 ? 'yellow' : 'red';
    const expColor  = pct > 50 ? '#4ade80' : pct > 20 ? '#facc15' : '#f87171';

    const rememberMe = total > 86400;
    const ttlHuman   = ttl <= 0 ? '<span class="dt-val red">EXPIRED</span>' :
                       ttl < 3600 ? `<span class="dt-val yellow">${Math.floor(ttl/60)}m ${ttl%60}s</span>` :
                       `<span class="dt-val green">${Math.floor(ttl/3600)}h ${Math.floor((ttl%3600)/60)}m</span>`;

    const preview = token.slice(0, 32) + '…' + token.slice(-12);

    pane.innerHTML = `
      <div class="dt-token-preview" id="dt-token-copy" title="Click to copy token">
        ${escHtml(preview)}
      </div>

      <div class="dt-section">
        <div class="dt-section-title">Identity</div>
        <div class="dt-row"><span class="dt-label">User ID</span><span class="dt-val mono">${escHtml(payload.sub ?? '–')}</span></div>
        <div class="dt-row"><span class="dt-label">Name</span><span class="dt-val">${escHtml(payload.name ?? '–')}</span></div>
        <div class="dt-row"><span class="dt-label">Role</span><span class="dt-val cyan">${escHtml(payload.role ?? '–')}</span></div>
        <div class="dt-row"><span class="dt-label">Remember Me</span><span class="dt-val ${rememberMe?'yellow':'green'}">${rememberMe ? 'Yes (30d)' : 'No'}</span></div>
      </div>

      <div class="dt-section">
        <div class="dt-section-title">Session</div>
        <div class="dt-row"><span class="dt-label">Algorithm</span><span class="dt-val mono">${escHtml(header.alg ?? '–')}</span></div>
        <div class="dt-row"><span class="dt-label">Issued</span><span class="dt-val">${payload.iat ? fmtDate(payload.iat) : '–'} (${Math.floor(issuedAgo/60)}m ago)</span></div>
        <div class="dt-row"><span class="dt-label">Expires</span><span class="dt-val">${payload.exp ? fmtDate(payload.exp) : '–'}</span></div>
        <div class="dt-row"><span class="dt-label">TTL</span>${ttlHuman}</div>
        <div style="margin-top:6px">
          <div class="dt-exp-bar-wrap">
            <div class="dt-exp-bar" style="width:${pct}%;background:${expColor}"></div>
          </div>
          <div style="text-align:right;font-size:9px;color:#555;margin-top:2px">${pct.toFixed(1)}% remaining</div>
        </div>
      </div>
    `;

    document.getElementById('dt-token-copy')?.addEventListener('click', () => copyText(token));
  }

  // ── Render: API Monitor Tab ────────────────────────────
  function _renderApiTab() {
    const pane = document.getElementById('dt-pane-api');
    const items = _apiLog.length === 0
      ? `<div class="dt-api-empty">No requests captured yet.<br>Make any action to start recording.</div>`
      : _apiLog.map(r => {
          const msClass = r.ms > 2000 ? 'very-slow' : r.ms > 800 ? 'slow' : '';
          const stClass = r.status === 0 ? 'net' : r.ok ? 'ok' : 'err';
          const stLabel = r.status === 0 ? 'NET' : r.status;
          return `<div class="dt-api-item" title="${escHtml(r.path)} @ ${fmtTime(r.ts)}">
            <span class="dt-api-method ${escHtml(r.method)}">${escHtml(r.method)}</span>
            <span class="dt-api-path" title="${escHtml(r.path)}">${escHtml(r.path)}</span>
            <span class="dt-api-status ${stClass}">${stLabel}</span>
            <span class="dt-api-ms ${msClass}">${fmtMs(r.ms)}</span>
          </div>`;
        }).join('');

    pane.innerHTML = `
      <div class="dt-api-toolbar">
        <button class="dt-btn" id="dt-api-clear">Clear</button>
        <button class="dt-btn pause" id="dt-api-pause">${_paused ? '▶ Resume' : '⏸ Pause'}</button>
        <span class="dt-api-count">${_apiLog.length}/${MAX_LOG} requests</span>
      </div>
      <div class="dt-api-list">${items}</div>
    `;

    document.getElementById('dt-api-clear')?.addEventListener('click', () => {
      _apiLog = [];
      _renderApiTab();
    });
    document.getElementById('dt-api-pause')?.addEventListener('click', (e) => {
      _paused = !_paused;
      e.target.innerHTML = _paused ? '<i data-icon="play"></i> Resume' : '<i data-icon="pause"></i> Pause';
    });
  }

  // ── Render: System Tab ─────────────────────────────────
  function _renderSysTab(data) {
    const pane = document.getElementById('dt-pane-sys');

    if (!data) {
      pane.innerHTML = '<div class="dt-loading">Loading system info</div>';
      return;
    }

    const memUsed  = data.memory_usage;
    const memPeak  = data.memory_peak;
    const memLimit = _parseMemLimit(data.memory_limit);
    const memPct   = memLimit ? Math.min(100, (memUsed / memLimit) * 100) : 0;
    const memColor = memPct > 80 ? '#f87171' : memPct > 50 ? '#facc15' : '#4ade80';

    const dataFilesHtml = (data.data_files || []).map(f => `
      <div class="dt-file-row">
        <span class="dt-file-name" title="${escHtml(f.name)}">${escHtml(f.name)}</span>
        <span class="dt-file-size">${fmtBytes(f.size)}</span>
        <span class="dt-file-time">${fmtDate(f.mtime)}</span>
      </div>`).join('');

    const boardStats = data.board || {};
    const usersStats = data.users || {};
    const byRole     = usersStats.by_role || {};

    pane.innerHTML = `
      <div class="dt-section">
        <div class="dt-section-title">PHP Runtime</div>
        <div class="dt-row"><span class="dt-label">PHP Version</span><span class="dt-val cyan mono">${escHtml(data.php_version)}</span></div>
        <div class="dt-row"><span class="dt-label">SAPI</span><span class="dt-val mono">${escHtml(data.php_sapi)}</span></div>
        <div class="dt-row"><span class="dt-label">Upload Max</span><span class="dt-val">${escHtml(data.upload_max)}</span></div>
        <div class="dt-row"><span class="dt-label">Post Max</span><span class="dt-val">${escHtml(data.post_max)}</span></div>
      </div>

      <div class="dt-section">
        <div class="dt-section-title">Memory (${fmtBytes(memUsed)} / ${data.memory_limit})</div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <div class="dt-mem-bar-wrap">
            <div class="dt-mem-bar" style="width:${memPct.toFixed(1)}%;background:${memColor}"></div>
          </div>
          <span style="color:${memColor};font-size:9px;flex-shrink:0">${memPct.toFixed(1)}%</span>
        </div>
        <div class="dt-row"><span class="dt-label">Current</span><span class="dt-val">${fmtBytes(memUsed)}</span></div>
        <div class="dt-row"><span class="dt-label">Peak</span><span class="dt-val yellow">${fmtBytes(memPeak)}</span></div>
        <div class="dt-row"><span class="dt-label">Limit</span><span class="dt-val">${data.memory_limit}</span></div>
      </div>

      <div class="dt-section">
        <div class="dt-section-title">Board</div>
        <div class="dt-row"><span class="dt-label">Total posts</span><span class="dt-val">${boardStats.total ?? '–'}</span></div>
        <div class="dt-row"><span class="dt-label">Open</span><span class="dt-val red">${boardStats.open ?? '–'}</span></div>
        <div class="dt-row"><span class="dt-label">In Progress</span><span class="dt-val yellow">${boardStats.in_progress ?? '–'}</span></div>
        <div class="dt-row"><span class="dt-label">Resolved</span><span class="dt-val green">${boardStats.resolved ?? '–'}</span></div>
        <div class="dt-row"><span class="dt-label">Trashed</span><span class="dt-val" style="color:#555">${boardStats.trashed ?? '–'}</span></div>
      </div>

      <div class="dt-section">
        <div class="dt-section-title">Users (${usersStats.total ?? 0} total)</div>
        ${Object.entries(byRole).map(([r,c]) =>
          `<div class="dt-row"><span class="dt-label">${escHtml(r)}</span><span class="dt-val">${c}</span></div>`
        ).join('')}
      </div>

      <div class="dt-section">
        <div class="dt-section-title">Data Files (${(data.data_files||[]).length})</div>
        <div style="display:grid;grid-template-columns:1fr 60px 100px;gap:6px;padding:2px 4px 4px;font-size:8.5px;color:#888;letter-spacing:.06em">
          <span>FILE</span><span style="text-align:right">SIZE</span><span style="text-align:right">MODIFIED</span>
        </div>
        <div class="dt-file-list">${dataFilesHtml || '<div style="color:#888;padding:6px">No files found</div>'}</div>
      </div>
    `;
  }

  // ── Render: Rate Limit Tab ─────────────────────────────
  function _renderRateTab(data) {
    const pane = document.getElementById('dt-pane-rate');
    if (!data) { pane.innerHTML = '<div class="dt-loading">Loading</div>'; return; }

    const rl        = data.rate_limit || {};
    const topUsers  = rl.top_users || [];
    const apiMax    = rl.api_max    ?? 120;
    const apiWindow = rl.api_window ?? 60;

    const topHtml = topUsers.length === 0
      ? `<tr><td colspan="3" style="color:#777;text-align:center;padding:10px">No active windows</td></tr>`
      : topUsers.map(u => {
          const pct = Math.round((u.count / apiMax) * 100);
          const col = pct > 80 ? '#f87171' : pct > 50 ? '#facc15' : '#4ade80';
          return `<tr>
            <td style="color:#bbb;font-size:9px">${escHtml(u.key.replace(/^api_rl_/, '').replace(/_[^_]+$/, ''))}</td>
            <td><span style="color:${col}">${u.count}</span> / ${apiMax}</td>
            <td>${pct}%</td>
          </tr>`;
        }).join('');

    pane.innerHTML = `
      <div class="dt-section">
        <div class="dt-section-title">API Rate Limit Config</div>
        <div class="dt-row"><span class="dt-label">Max Requests</span><span class="dt-val cyan">${apiMax}</span></div>
        <div class="dt-row"><span class="dt-label">Window</span><span class="dt-val">${apiWindow}s</span></div>
        <div class="dt-row"><span class="dt-label">Active Windows</span><span class="dt-val ${rl.active_windows>0?'yellow':'green'}">${rl.active_windows ?? 0}</span></div>
      </div>

      <div class="dt-section">
        <div class="dt-section-title">Login Rate Limit</div>
        <div class="dt-row"><span class="dt-label">Currently Locked IPs</span><span class="dt-val ${(rl.login_locked||0)>0?'red':'green'}">${rl.login_locked ?? 0}</span></div>
      </div>

      <div class="dt-section">
        <div class="dt-section-title">Top API Users (current window)</div>
        <table class="dt-rl-table">
          <thead><tr><th>User</th><th>Requests</th><th>Usage</th></tr></thead>
          <tbody>${topHtml}</tbody>
        </table>
      </div>
    `;
  }

  // ── Helpers ────────────────────────────────────────────
  function _parseMemLimit(s) {
    if (!s) return 0;
    const n = parseFloat(s);
    if (s.endsWith('G')) return n * 1073741824;
    if (s.endsWith('M')) return n * 1048576;
    if (s.endsWith('K')) return n * 1024;
    return n;
  }

  function _updateFooterTs() {
    const el = document.getElementById('dt-footer-ts');
    if (el) el.textContent = 'Updated ' + fmtTime(Date.now());
  }

  // ── Tab switching ──────────────────────────────────────
  function _switchTab(tab) {
    _activeTab = tab;
    document.querySelectorAll('.dt-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    document.querySelectorAll('.dt-pane').forEach(p => p.classList.toggle('active', p.id === `dt-pane-${tab}`));

    if (tab === 'jwt') _renderJwtTab();
    if (tab === 'api') _renderApiTab();
    if (tab === 'sys')  _renderSysTab(_sysData);
    if (tab === 'rate') _renderRateTab(_sysData);
  }

  // ── Load system data ───────────────────────────────────
  async function _loadSysData() {
    if (_sysLoading) return;
    _sysLoading = true;

    if (_activeTab === 'sys')  _renderSysTab(null);
    if (_activeTab === 'rate') _renderRateTab(null);

    try {
      const res = await API.get('/dev/');
      if (res?.ok) {
        _sysData = res.data.data;
        if (_activeTab === 'sys')  _renderSysTab(_sysData);
        if (_activeTab === 'rate') _renderRateTab(_sysData);
        _updateFooterTs();
      }
    } catch(e) {
      console.error('[DevToolbar] Failed to load sys data:', e);
    } finally {
      _sysLoading = false;
    }
  }

  // ── Open / Close ───────────────────────────────────────
  function open() {
    _open = true;
    _panel.classList.add('is-visible');
    _toggle.classList.add('is-open');
    _switchTab(_activeTab);
    if (!_sysData) _loadSysData();
  }

  function close() {
    _open = false;
    _panel.classList.remove('is-visible');
    _toggle.classList.remove('is-open');
  }

  function toggle() { _open ? close() : open(); }

  // ── Draggable panel ────────────────────────────────────
  function _initDrag() {
    const handle = document.getElementById('dt-drag-handle');
    if (!handle) return;
    let dragging = false, ox = 0, oy = 0;

    handle.addEventListener('mousedown', e => {
      if (e.target.id === 'dt-close-btn') return;
      dragging = true;
      const rect = _panel.getBoundingClientRect();
      ox = e.clientX - rect.left;
      oy = e.clientY - rect.top;
      _panel.style.transition = 'none';
    });

    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      let x = e.clientX - ox;
      let y = e.clientY - oy;
      x = Math.max(0, Math.min(window.innerWidth  - _panel.offsetWidth,  x));
      y = Math.max(0, Math.min(window.innerHeight - _panel.offsetHeight, y));
      _panel.style.right  = 'auto';
      _panel.style.bottom = 'auto';
      _panel.style.left   = x + 'px';
      _panel.style.top    = y + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (dragging) { dragging = false; _panel.style.transition = ''; }
    });
  }

  // ── Init ───────────────────────────────────────────────
  function init() {
    const user = typeof Auth !== 'undefined' ? Auth.getUser?.() : null;
    if (user?.role !== 'dev_sm') return;

    // Inject CSS
    const s    = document.querySelector('script[src*="dev-toolbar.js"]') ||
                 document.querySelector('script[src*="layout.js"]');
    const base = s ? s.src.replace(/assets\/js\/.*$/, '') : './';
    if (!document.getElementById('dev-toolbar-css')) {
      const link = document.createElement('link');
      link.id    = 'dev-toolbar-css';
      link.rel   = 'stylesheet';
      link.href  = base + 'assets/css/dev-toolbar.css';
      document.head.appendChild(link);
    }

    // Build DOM — reuse sidebar button if already injected by layout.js
    const _existing = document.getElementById('dev-toolbar-toggle');
    if (_existing) {
      _toggle = _existing;
    } else {
      _toggle = _buildToggle();
      document.body.appendChild(_toggle);
    }
    _panel = _buildPanel();
    document.body.appendChild(_panel);

    // Events
    _toggle.addEventListener('click', toggle);
    document.getElementById('dt-close-btn')?.addEventListener('click', close);
    document.getElementById('dt-refresh-btn')?.addEventListener('click', _loadSysData);

    document.getElementById('dt-tabs')?.addEventListener('click', e => {
      const tab = e.target.dataset?.tab;
      if (!tab) return;
      _switchTab(tab);
      if ((tab === 'sys' || tab === 'rate') && !_sysData) _loadSysData();
    });

    // Keyboard shortcut: Ctrl+Shift+D
    document.addEventListener('keydown', e => {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') { e.preventDefault(); toggle(); }
    });

    // Patch API
    _patchApiRequest();
    _initDrag();
  }

  return { init, open, close, toggle };
})();

// Auto-init after DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', DevToolbar.init);
} else {
  DevToolbar.init();
}
