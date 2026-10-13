/* ══════════════════════════════════════════════════════════════════
   menu-permissions.js  |  Admin matrix UI for role×menu access
   ══════════════════════════════════════════════════════════════════ */
const MenuPermissions = (() => {
  const el = (id) => document.getElementById(id);

  // Menu id → { label, section }. Kept in sync with layout.js coreNavItems.
  // Labels are shown in the matrix left column. section is a hint chip.
  const MENU_META = {
    'dashboard':       { label: 'Dashboard',           section: 'MAIN' },
    'board':           { label: 'Web Board',           section: 'MAIN' },
    'sheets':          { label: 'Team Docs',           section: 'MAIN' },
    'sabai':           { label: 'SABai',               section: 'MAIN' },
    'schedule':        { label: 'Shift Schedule',      section: 'MAIN' },
    'pw-schedule':     { label: 'PW Schedule',         section: 'MAIN' },
    'ma-services':     { label: 'MA Services',         section: 'MAIN' },
    'ma-test':         { label: 'Result Test MA',      section: 'MAIN' },
    'learn':           { label: 'Learning',            section: 'MAIN' },
    'weekly-report':   { label: 'Weekly Report',       section: 'MAIN' },
    'report-center':   { label: 'Report Center',       section: 'MAIN' },
    'send-email':      { label: 'SMC Ticket',          section: 'MAIN' },
    'inbox':           { label: 'Team Inbox',          section: 'MAIN' },
    'restart-monitor': { label: 'EKS Restart Monitor', section: 'MAIN' },
    'alert-monitor':   { label: 'Alert Monitor',       section: 'MAIN' },
    'analytics':       { label: 'Analytics',           section: 'MAIN' },
    'batch-file-search':      { label: 'File → Job Lookup',  section: 'MAIN' },
    'sms-gateway-switches':   { label: 'SMS Gateway',        section: 'MAIN' },
    'my-team':                { label: 'My Team',            section: 'MAIN' },
    'grafana-alerts':         { label: 'Grafana Alerts',     section: 'MAIN' },
    'service-performance':    { label: 'Service Performance', section: 'MAIN' },
    'restart-analyzer':       { label: 'Restart Analyzer',   section: 'MAIN' },
    'log-explorer':           { label: 'Log Explorer',       section: 'MAIN' },
    'genz-hub':               { label: 'GenZ Hub',           section: 'MAIN' },
    'genz-notes':             { label: 'GenZ Case Notes',    section: 'MAIN' },
    'incident-launcher':      { label: 'Incident Launcher',  section: 'MAIN' },
    'migrate-user':           { label: 'Migrate User',        section: 'MAIN' },
    'genz-team':              { label: 'GenZ Team (admin)',  section: 'ADMIN' },
    'admin':           { label: 'Admin Panel',         section: 'ADMIN' },
    'devtools':        { label: 'Dev Overview',        section: 'DEV' },
    'dev-system':      { label: 'Dev System Monitor',  section: 'DEV' },
    'dev-api':         { label: 'Dev API Explorer',    section: 'DEV' },
    'dev-logs':        { label: 'Dev Log Viewer',      section: 'DEV' },
    'dev-email':       { label: 'Dev Email Tester',    section: 'DEV' },
    'dev-data':        { label: 'Dev Data Inspector',  section: 'DEV' },
    // Sidebar-tools pages (from data/sidebar_tools.json). IDs must match the
    // page slug (filename without .html), which is how the server merges them.
    'monitoring':        { label: 'Monitoring',       section: 'TOOLS' },
    'monitoring-wall':   { label: 'Monitoring Wall',  section: 'TOOLS' },
    'test-service':      { label: 'Test Service',     section: 'TOOLS' },
    'batch-monitor':     { label: 'Batch Monitor',    section: 'TOOLS' },
    'knowledge-base':    { label: 'Knowledge Base',   section: 'TOOLS' },
    'report':            { label: 'Report Weekly',    section: 'TOOLS' },
    'jira-templates':    { label: 'Jira Templates',   section: 'TOOLS' },
    'case-incidents':    { label: 'Case Incidents',   section: 'MAIN' },
  };

  const ROLE_META = {
    'sm_admin': { label: 'Admin',    color: '#dc2626' },
    'dev_sm':   { label: 'Dev',      color: '#8b5cf6' },
    'sm_lead':  { label: 'Lead',     color: '#f97316' },
    'sm_user':  { label: 'User',     color: '#3b82f6' },
    'dev_user': { label: 'Dev User', color: '#7c3aed' },
    'external': { label: 'External', color: '#71717a' },
  };

  const state = {
    original: null,       // { roles: {...}, always_visible: [] }
    working:  null,       // editable copy
    knownMenus: [],
    knownRoles: [],
    dirty: false,
  };

  async function init() {
    const u = Auth.getUser?.() || {};
    if (!['super_admin', 'sm_admin', 'dev_sm'].includes(u.role)) {
      document.querySelector('.mp-wrap').innerHTML =
        `<div style="padding:40px;text-align:center">
           <h2>Admin only</h2>
           <p style="color:var(--text-muted)">หน้านี้เข้าได้เฉพาะ super_admin / sm_admin / dev_sm</p>
         </div>`;
      return;
    }
    // super_admin needs a view-as team selected — menu-permissions are per-team.
    if (u.role === 'super_admin' && !(typeof API !== 'undefined' && API.getAdminTeam?.())) {
      _renderTeamPickerHint();
      return;
    }
    _bind();
    await _load();
  }

  // Shown to super_admin when no team context is selected in the tsw-bar.
  function _renderTeamPickerHint() {
    document.querySelector('.mp-wrap').innerHTML = `
      <div class="mp-card" style="text-align:center;padding:44px 24px;max-width:640px;margin:20px auto">
        <div style="font-size:36px;line-height:1;margin-bottom:14px"><i data-icon="map-pin"></i></div>
        <h2 style="margin:0 0 6px;font-size:16px">เลือกทีมก่อน</h2>
        <p style="margin:6px 0 0;font-size:13px;color:var(--text-muted);line-height:1.6">
          Menu Permissions เก็บแยกตามทีม (ทีมละไฟล์ <code style="font-family:ui-monospace,monospace">data/{team}/menu-permissions.json</code>)<br>
          กรุณาเลือกทีมจาก <b>View as</b> switcher ด้านบน แล้วหน้านี้จะโหลด matrix ของทีมนั้น
        </p>
      </div>`;
  }

  function _bind() {
    el('mp-btn-save').addEventListener('click', _save);
    el('mp-btn-reset').addEventListener('click', _reset);
  }

  async function _load() {
    const res = await API.menuPermissions.get();
    if (!res.ok) { _toast('โหลด config ล้มเหลว', 'err'); return; }
    const d = res.data.data;
    state.original   = _deepCopy(d.config);
    state.working    = _deepCopy(d.config);
    state.knownMenus = _filterMenusByTeam(d.known_menus || []);
    state.knownRoles = d.known_roles || [];
    _renderTeamContextChip();
    _dirty(false);
    _render();
  }

  // Inline chip next to the page title telling the admin whose config they're
  // editing — matters for super_admin who can hot-swap teams from the tsw-bar.
  function _renderTeamContextChip() {
    const head = document.querySelector('.mp-head > div');
    if (!head) return;
    let chip = document.getElementById('mp-team-chip');
    const u = Auth.getUser?.() || {};
    const viewAs = (typeof API !== 'undefined') ? (API.getAdminTeam?.() || null) : null;
    const slug = u.role === 'super_admin' ? viewAs : (u.team || null);
    if (!slug) { if (chip) chip.remove(); return; }
    // Look up team display name + color from super-admin cache (populated by tsw-bar)
    let name = slug.toUpperCase(), color = '#6366F1';
    try {
      const teams = JSON.parse(sessionStorage.getItem('_sa_teams_data') || '[]');
      const t = teams.find(x => x.slug === slug);
      if (t) { name = t.name || name; color = t.color || color; }
    } catch {}
    const html = `<span id="mp-team-chip" style="
        display:inline-flex;align-items:center;gap:6px;margin-top:8px;
        padding:3px 10px;border-radius:999px;
        font-size:11px;font-weight:700;letter-spacing:.03em;
        color:${color};background:color-mix(in srgb, ${color} 10%, transparent);
        border:1px solid color-mix(in srgb, ${color} 22%, var(--border));">
        <span style="width:7px;height:7px;border-radius:50%;background:${color}"></span>
        Editing for team: ${_escape(name)}
      </span>`;
    if (chip) chip.outerHTML = html;
    else head.insertAdjacentHTML('beforeend', html);
  }

  // Filter the menu list to only ids that the current effective team actually
  // has access to. Uses Layout.coreNavItems (feature + team-lock metadata) as
  // the source of truth. Menus not in coreNavItems (e.g. sidebar-tools) are
  // kept — they're team-agnostic tools admin still wants to gate roles on.
  function _filterMenusByTeam(allMenus) {
    const nav = (typeof Layout !== 'undefined' && Array.isArray(Layout.coreNavItems)) ? Layout.coreNavItems : [];
    if (!nav.length) return allMenus;
    const teamFeatures = (typeof Auth !== 'undefined' && Auth.getTeamFeatures) ? Auth.getTeamFeatures() : null;
    const featurePages = (typeof Auth !== 'undefined' && Auth.getTeamFeaturePages) ? (Auth.getTeamFeaturePages() || {}) : {};
    const user = (typeof Auth !== 'undefined') ? (Auth.getUser?.() || {}) : {};
    const viewAs = (typeof Auth !== 'undefined' && Auth._getViewAsTeam) ? Auth._getViewAsTeam() : null;
    const effectiveTeam = (user?.role === 'super_admin') ? (viewAs?.slug || null) : (user?.team || null);

    // super_admin in "All Teams" mode → no filtering
    if (teamFeatures === null) return allMenus;

    // Build a lookup of menuId → coreNavItem metadata
    const byId = Object.fromEntries(nav.map(n => [n.id, n]));

    return allMenus.filter(id => {
      const item = byId[id];
      if (!item) return true; // unknown item — keep it (sidebar-tools etc.)
      // Team lock
      if (item.team && effectiveTeam !== null && effectiveTeam !== item.team) return false;
      // Role lock — items restricted to dev_sm only make sense inside SM,
      // since dev_sm is not provisioned for other teams. Hide them elsewhere.
      if (Array.isArray(item.roles) && item.roles.length) {
        const onlyDevSm = item.roles.every(r => r === 'dev_sm');
        if (onlyDevSm && effectiveTeam !== null && effectiveTeam !== 'sm') return false;
      }
      // Feature gate
      if (item.feature) {
        if (!(teamFeatures || []).includes(item.feature)) return false;
        const plan = featurePages[item.feature];
        if (plan && Array.isArray(plan.user_pages) && !plan.user_pages.includes(id)) return false;
      }
      return true;
    });
  }

  async function _save() {
    const btn = el('mp-btn-save'); btn.disabled = true;
    const orig = btn.innerHTML;
    btn.innerHTML = '<span class="spinner"></span> saving...';
    try {
      const payload = {
        roles: state.working.roles,
        always_visible: state.working.always_visible || ['profile', 'change-password'],
      };
      const res = await API.menuPermissions.save(payload);
      if (!res) throw new Error('server rejected — please re-login');
      if (!res.ok) throw new Error(res.data?.message || 'save failed');
      state.original = _deepCopy(state.working);
      _dirty(false);
      _toast('<i data-icon="check"></i> บันทึกเรียบร้อย · reload หน้าอื่นจะเห็น sidebar ใหม่', 'ok');
      // Clear own sidebar cache so admin sees updated sidebar on next nav
      try {
        sessionStorage.removeItem('sm_menu_perms_v1');
        sessionStorage.removeItem('_sm_sb_html');
      } catch {}
    } catch (e) {
      _toast('<i data-icon="x"></i> บันทึกล้มเหลว: ' + e.message, 'err');
      SOMDialog.alert('Save failed: ' + e.message, { title: 'เกิดข้อผิดพลาด', icon: 'danger' });
    } finally {
      btn.disabled = false; btn.innerHTML = orig;
    }
  }

  async function _reset() {
    if (!state.dirty) return;
    if (!await SOMDialog.confirm('ยกเลิกการเปลี่ยนแปลงทั้งหมด?', { title: 'ยืนยัน', okLabel: 'ยกเลิกการเปลี่ยนแปลง', icon: 'warning', okColor: 'warning' })) return;
    state.working = _deepCopy(state.original);
    _dirty(false);
    _render();
  }

  // ── Matrix render ─────────────────────────────────────────────────
  function _render() {
    _renderHead();
    _renderBody();
    _renderPreview();
  }

  function _renderHead() {
    const cols = state.knownRoles.map(r => {
      const isWc = state.working.roles[r] === '*';
      const count = _countForRole(r);
      return `<th class="mp-role-col ${isWc ? 'wildcard' : ''}" data-role="${r}"
                title="คลิกเพื่อ toggle wildcard (ทุกเมนู) สำหรับ ${r}">
        <span style="color:${ROLE_META[r]?.color || 'inherit'}">●</span> ${ROLE_META[r]?.label || r}
        <span class="cnt">${isWc ? 'wildcard (all)' : count + ' allowed'}</span>
      </th>`;
    }).join('');
    el('mp-matrix-head').innerHTML = `<tr>
      <th class="mp-menu-col" style="text-align:left">Menu</th>
      ${cols}
    </tr>`;

    // Wire wildcard-toggle on role headers
    el('mp-matrix-head').querySelectorAll('th.mp-role-col').forEach(th => {
      th.addEventListener('click', () => _toggleWildcard(th.dataset.role));
    });
  }

  function _renderBody() {
    // "select all / clear" bulk row on top
    const bulk = `<tr class="mp-bulk-row">
      <td class="mp-menu-col">Bulk</td>
      ${state.knownRoles.map(r => {
        const isWc = state.working.roles[r] === '*';
        return `<td>
          <button class="mp-bulk-cell" data-act="all" data-role="${r}" ${isWc?'disabled style="opacity:.4;cursor:not-allowed"':''}>ALL</button>
          <button class="mp-bulk-cell" data-act="none" data-role="${r}" ${isWc?'disabled style="opacity:.4;cursor:not-allowed"':''}>NONE</button>
        </td>`;
      }).join('')}
    </tr>`;

    const rows = state.knownMenus.map(m => {
      const meta = MENU_META[m] || { label: m, section: '' };
      const cells = state.knownRoles.map(r => {
        const val = state.working.roles[r];
        const on  = val === '*' || (Array.isArray(val) && val.includes(m));
        const isWc = val === '*';
        return `<td>
          <span class="mp-cell ${on ? 'on' : ''} ${isWc ? 'wildcard' : ''}"
                data-role="${r}" data-menu="${m}"
                title="${r} · ${m}">
            ${on ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
          </span>
        </td>`;
      }).join('');
      return `<tr data-menu="${m}">
        <td class="mp-menu-col">
          <span class="lbl">${_escape(meta.label)}</span>
          <span class="sec">${meta.section}</span>
          <span class="id">${m}</span>
        </td>
        ${cells}
      </tr>`;
    }).join('');

    el('mp-matrix-body').innerHTML = bulk + rows;

    // Wire cell clicks
    el('mp-matrix-body').querySelectorAll('.mp-cell').forEach(c => {
      c.addEventListener('click', () => {
        if (c.classList.contains('wildcard')) return;
        _toggleCell(c.dataset.role, c.dataset.menu);
      });
    });
    // Bulk row buttons
    el('mp-matrix-body').querySelectorAll('.mp-bulk-cell').forEach(b => {
      b.addEventListener('click', () => _bulkColumn(b.dataset.role, b.dataset.act));
    });
  }

  function _renderPreview() {
    const wrap = el('mp-preview');
    wrap.innerHTML = state.knownRoles.map(r => {
      const val = state.working.roles[r];
      const isWc = val === '*';
      const list = isWc ? state.knownMenus : (Array.isArray(val) ? val : []);
      return `<div class="mp-preview-role ${isWc ? 'wc' : ''}">
        <h4>
          <span><span style="color:${ROLE_META[r]?.color || 'inherit'}">●</span> ${ROLE_META[r]?.label || r}</span>
          <span class="cnt">${isWc ? 'wildcard' : list.length}</span>
        </h4>
        <ul>${
          list.length ? list.map(id => `<li>${_escape(id)}</li>`).join('')
                     : '<li style="color:var(--text-muted);font-style:italic;background:transparent;border:none">(no menus)</li>'
        }</ul>
      </div>`;
    }).join('');
  }

  // ── Toggle helpers ────────────────────────────────────────────────
  function _toggleCell(role, menu) {
    const cur = state.working.roles[role];
    let arr = Array.isArray(cur) ? cur.slice() : (cur === '*' ? state.knownMenus.slice() : []);
    const idx = arr.indexOf(menu);
    if (idx >= 0) arr.splice(idx, 1);
    else          arr.push(menu);
    state.working.roles[role] = arr;
    _dirty(true);
    _render();
  }

  function _toggleWildcard(role) {
    const cur = state.working.roles[role];
    if (cur === '*') {
      // Convert to explicit empty array
      state.working.roles[role] = [];
    } else {
      state.working.roles[role] = '*';
    }
    _dirty(true);
    _render();
  }

  function _bulkColumn(role, act) {
    if (state.working.roles[role] === '*') return;
    if (act === 'all')  state.working.roles[role] = state.knownMenus.slice();
    if (act === 'none') state.working.roles[role] = [];
    _dirty(true);
    _render();
  }

  function _countForRole(role) {
    const v = state.working.roles[role];
    if (v === '*') return state.knownMenus.length;
    return Array.isArray(v) ? v.length : 0;
  }

  function _dirty(v) {
    state.dirty = v;
    el('mp-dirty').classList.toggle('visible', v);
    el('mp-btn-save').disabled = !v;
    el('mp-btn-reset').disabled = !v;
  }

  // ── Utilities ─────────────────────────────────────────────────────
  function _toast(msg, kind = '') {
    const t = el('mp-toast');
    t.textContent = msg;
    t.className = 'mp-toast visible ' + kind;
    setTimeout(() => { t.className = 'mp-toast'; }, 3200);
  }
  function _deepCopy(o) { return JSON.parse(JSON.stringify(o || {})); }
  function _escape(s) {
    return String(s ?? '').replace(/[&<>"']/g, ch => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[ch]));
  }

  return { init };
})();
