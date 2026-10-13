// admin/super-team-permissions — page script, extracted from admin/super-team-permissions.html.
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
if (Auth.getUser()?.role !== 'super_admin') window.location.href = './index.html';
Layout.render('super-team-permissions');
Auth.initUserUI();

// ── Data ──────────────────────────────────────────────────────────────────────
const DEFAULT_FEATURES = ['dashboard','board','team-docs','sabai','schedule','learning'];

// Pages that support access mode control (full vs read-only)
const PAGE_MODES = [
  {id:'ma-services',    label:'MA Services',    icon:'<i data-icon="wrench"></i>', feature:'ma-services'},
  {id:'board',          label:'Web Board',      icon:'<i data-icon="clipboard"></i>', feature:'board'},
  {id:'templates',      label:'Jira Templates', icon:'<i data-icon="ticket"></i>', feature:'jira-templates'},
  {id:'knowledge-base', label:'Knowledge Base', icon:'<i data-icon="folder"></i>', feature:'team-docs'},
  {id:'ops-runbook',    label:'Ops Runbook',    icon:'<i data-icon="book-open"></i>', feature:'team-docs'},
  {id:'schedule',       label:'Shift Schedule', icon:'<i data-icon="calendar"></i>', feature:'schedule'},
  {id:'syncup',         label:'Sync Up',        icon:'<i data-icon="refresh-cw"></i>', feature:'syncup'},
  {id:'batch-monitor',  label:'Batch Monitor',  icon:'<i data-icon="package"></i>', feature:'batch-monitor'},
  {id:'analytics',      label:'Analytics',      icon:'<i data-icon="trending-up"></i>', feature:'analytics'},
  {id:'announcements',  label:'Announcements',  icon:'<i data-icon="megaphone"></i>', feature:'board'},
];

// Page mappings for each requestable feature (sync with REQUESTABLE_FEATURES in PHP)
const FEATURE_CATALOGUE = {
  'jira-templates':   {label:'Jira Templates',  icon:'<i data-icon="ticket"></i>', user_pages:['send-email'],      admin_pages:['templates','jira-config']},
  'jenkins':          {label:'Jenkins',          icon:'<i data-icon="wrench"></i>', user_pages:[],                  admin_pages:['jenkins-servers']},
  'jenkins-build':    {label:'Jenkins Build Launcher', icon:'<i data-icon="zap"></i>', user_pages:['jenkins-build'], admin_pages:['jenkins-servers']},
  'jenkins-portal':   {label:'Jenkins Portal (Unbind)', icon:'<i data-icon="unlock"></i>', user_pages:['jenkins-portal'], admin_pages:['jenkins-portal']},
  'so-jenkins':       {label:'SO Jenkins (CLT RAG)', icon:'<i data-icon="rocket"></i>', user_pages:['so-jenkins'], admin_pages:['so-jenkins']},
  'migrate-user':     {label:'Migrate User (Rundeck)', icon:'<i data-icon="git-merge"></i>', user_pages:['migrate-user'], admin_pages:[]},
  // Batch Monitor is Jenkins-backed: it cannot function without jenkins_servers.json,
  // so 'jenkins-servers' is included here too. Enabling Batch Monitor alone gives a
  // team the full working stack (page + admin config + credentials file via Copy-from-SM).
  'batch-monitor':    {label:'Batch Monitor',    icon:'<i data-icon="package"></i>', user_pages:['batch-monitor'],   admin_pages:['batch-monitor','batch-meta','batch-monitor-noti','jenkins-servers']},
  'alert-monitor':    {label:'Alert Monitor',    icon:'<i data-icon="bell"></i>', user_pages:['alert-monitor'],   admin_pages:['alert-monitor-config']},
  'analytics':        {label:'Analytics',        icon:'<i data-icon="trending-up"></i>', user_pages:['analytics'],       admin_pages:['analytics']},
  'ma-services':      {label:'MA Services',      icon:'<i data-icon="wrench"></i>', user_pages:['ma-services'],     admin_pages:['ma-config']},
  'syncup':           {label:'Sync Up',           icon:'<i data-icon="refresh-cw"></i>', user_pages:['syncup'],          admin_pages:['syncup-config']},
  'weekly-report':    {label:'Weekly Report',    icon:'<i data-icon="edit"></i>', user_pages:['weekly-report'],   admin_pages:['weekly-report']},
  'monitoring':       {label:'Monitoring',       icon:'<i data-icon="satellite"></i>', user_pages:['monitoring'],      admin_pages:['system-monitor']},
  'sms-gateway':      {label:'SMS Gateway',      icon:'<i data-icon="smartphone"></i>', user_pages:['sms-gateway-switches'], admin_pages:['sms-gateway-config']},
  'sheets':           {label:'Sheets Embed',     icon:'<i data-icon="bar-chart"></i>', user_pages:['sheets'],          admin_pages:['sheets']},
  'inbox':            {label:'Team Inbox',       icon:'<i data-icon="inbox"></i>', user_pages:['inbox'],           admin_pages:['fh-config']},
  'notifications':    {label:'Notifications',    icon:'<i data-icon="message-circle"></i>', user_pages:[],                  admin_pages:['scheduled-noti','email-noti']},
  'onboarding':       {label:'Onboarding',       icon:'<i data-icon="hand"></i>', user_pages:['onboarding'],      admin_pages:['onboarding']},
  'uptime':           {label:'Uptime Monitor',   icon:'⏱', user_pages:['uptime'],          admin_pages:[]},
  'links':            {label:'Quick Links',      icon:'<i data-icon="link"></i>', user_pages:[],                  admin_pages:['links']},
  'test-service':     {label:'Service Test',     icon:'<i data-icon="test-tube"></i>', user_pages:['test-service'],    admin_pages:['test-service']},
  'achievements':     {label:'Achievements',     icon:'<i data-icon="trophy"></i>', user_pages:[],                  admin_pages:['achievements']},
  'restart-monitor':  {label:'Restart Monitor',  icon:'<i data-icon="refresh-cw"></i>', user_pages:['restart-monitor'], admin_pages:[]},
  'service-severity': {label:'Service Severity', icon:'<i data-icon="alert-triangle"></i>', user_pages:[],                  admin_pages:['service-severity']},
  // View-only shares of SM-shared JSON — no per-team data file to seed, so
  // Copy-from-SM is a no-op for these keys (data always reads from data/sm/).
  'batch-file-search':{label:'Batch File Lookup', icon:'<i data-icon="search"></i>', user_pages:['batch-file-search'], admin_pages:[]},
  'grafana-alerts':   {label:'Paused Alerts',    icon:'<i data-icon="pause"></i>',  user_pages:['grafana-alerts'],    admin_pages:[]},
  'jira-templates-shared':{label:'Jira Templates (View)', icon:'<i data-icon="ticket"></i>', user_pages:['jira-templates'], admin_pages:[]},
  'pw-schedule':      {label:'PW Schedule (View)',icon:'<i data-icon="calendar"></i>', user_pages:['pw-schedule'],       admin_pages:[]},
};

let _teams   = [];
let _current = null; // { ...team }
let _dirty   = false;

// Basic HTML escape — used in the render templates.
function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
                       .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Load all teams ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', loadData);

async function loadData() {
  const res = await API.teams.list();
  if (!res?.ok) { Toast.error('Failed to load teams'); return; }
  _teams = (res.data?.data || res.data || []).filter(t => t.active !== false);
  renderTeamList();
  if (_teams.length > 0) selectTeam(_teams[0]);
}

function renderTeamList() {
  const list = document.getElementById('team-list');
  const cnt  = document.getElementById('team-sidebar-count');
  if (cnt) cnt.textContent = _teams.length;
  list.innerHTML = _teams.map(t => `
    <div class="team-item ${_current?.id === t.id ? 'active' : ''}" onclick="selectTeam(${JSON.stringify(t).replace(/"/g,'&quot;')})">
      <span class="team-dot" style="background:${t.color||'#6366F1'}"></span>
      <div class="team-item-body">
        <div class="team-item-name">${t.name}</div>
        <div class="team-item-slug">/${t.slug}</div>
      </div>
      <span class="team-item-arrow">▸</span>
    </div>`).join('');
}

function selectTeam(team) {
  _current = JSON.parse(JSON.stringify(team)); // deep clone
  // Normalize maps: PHP encodes empty PHP arrays as JSON `[]`, so we may
  // receive an array where an object is expected. Coerce so we can safely
  // assign string keys and JSON.stringify keeps them.
  if (!_current.feature_pages || Array.isArray(_current.feature_pages)) _current.feature_pages = {};
  if (!_current.page_modes    || Array.isArray(_current.page_modes))    _current.page_modes    = {};
  _dirty   = false;
  renderTeamList();
  renderPanel();
}

// ── Render permission panel ────────────────────────────────────────────────────
function renderPanel() {
  const t = _current;
  if (!t) return;
  const enabledFeatures = t.features || [];
  const featurePages    = t.feature_pages || {};
  const pageModes       = t.page_modes    || {};

  const color = t.color || '#6366F1';
  let html = `
    <div class="pm-panel-head" style="--pm-team-color:${color}">
      <div>
        <div class="pm-team-title">
          <span class="pm-team-dot" style="background:${color}"></span>
          <span class="pm-team-name">${escHtml(t.name)}</span>
          <span class="pm-team-slug">/${escHtml(t.slug)}</span>
        </div>
        ${t.description ? `<div class="pm-team-desc">${escHtml(t.description)}</div>` : ''}
      </div>
    </div>

    <!-- Default features -->
    <div class="feat-section">
      <div class="feat-section-head">
        <span class="feat-section-title">🔒 Default features</span>
        <span class="feat-section-hint">Always enabled — cannot be toggled</span>
      </div>
      <div class="feat-grid">
        ${DEFAULT_FEATURES.map(f => `
          <div class="feat-row enabled always-on">
            <div class="feat-row-header">
              <span class="feat-icon"><i data-icon="check-circle"></i></span>
              <span class="feat-label">${f.charAt(0).toUpperCase()+f.slice(1).replace('-',' ')}</span>
              <span class="feat-always-badge">On</span>
            </div>
          </div>`).join('')}
      </div>
    </div>

    <!-- Requestable features -->
    <div class="feat-section">
      <div class="feat-section-head">
        <span class="feat-section-title">⚡ Requestable features</span>
        <span class="feat-section-hint">Toggle to enable · uncheck a page to revoke access · pick Full / Read per page</span>
      </div>
      <div class="feat-grid" id="feat-grid">
        ${Object.entries(FEATURE_CATALOGUE).map(([key, f]) => {
          const on      = enabledFeatures.includes(key);
          const plan    = featurePages[key] || null;
          const allPgs  = [...(f.user_pages||[]).map(p=>({id:p,type:'user'})),
                           ...(f.admin_pages||[]).map(p=>({id:p,type:'admin'}))];
          const pgHtml  = !on || !allPgs.length ? '' : `
            <div class="page-grants">
              <div class="page-grants-label">Pages granted:</div>
              ${allPgs.map(p => {
                const granted = !plan
                  ? true // no override = all granted
                  : (p.type==='user' ? (plan.user_pages||[]).includes(p.id) : (plan.admin_pages||[]).includes(p.id));
                const mode = pageModes[p.id] || 'full';
                return `<div class="pg-item">
                  <label>
                    <input type="checkbox" class="pg-cb" data-feature="${key}" data-id="${p.id}" data-type="${p.type}" ${granted?'checked':''} onchange="onPageGrant(this)">
                    <span>${p.id}.html</span>
                  </label>
                  <span class="pg-badge ${p.type==='admin'?'admin':''}">${p.type==='admin'?'admin':'page'}</span>
                  <div class="pg-mode${granted?'':' disabled'}" data-page="${p.id}" title="เข้าถึงได้แบบไหน — Full = แก้ไขได้ / Read = ดูอย่างเดียว">
                    <button type="button" class="pg-mode-opt${mode==='full'?' active':''}" data-mode="full" data-page="${p.id}" onclick="onInlineModeChange(this)">Full</button>
                    <button type="button" class="pg-mode-opt${mode==='read'?' active':''}" data-mode="read" data-page="${p.id}" onclick="onInlineModeChange(this)">Read</button>
                  </div>
                </div>`;
              }).join('')}
            </div>`;
          const canCopy = on && t.slug !== 'sm';
          const copyBtn = canCopy
            ? `<button type="button" class="feat-copy-btn" onclick="copyFeatureConfig('${key}', this)" title="Seed this team's config with a snapshot of SM's current data (one-time copy). Existing non-empty files are kept unless you confirm overwrite.">
                 <i data-icon="inbox"></i> <span>Copy from SM</span>
               </button>`
            : '';
          return `
            <div class="feat-row ${on?'enabled':''}" id="feat-row-${key}">
              <div class="feat-row-header">
                <span class="feat-icon">${f.icon}</span>
                <span class="feat-label">${f.label}</span>
                ${copyBtn}
                <label class="feat-toggle">
                  <input type="checkbox" ${on?'checked':''} onchange="onFeatureToggle('${key}',this.checked)">
                  <span class="feat-toggle-slider"></span>
                </label>
              </div>
              ${pgHtml}
            </div>`;
        }).join('')}
      </div>
    </div>

    <!-- Default-page access modes (pages not covered by inline toggles above) -->
    <div class="feat-section">
      <div class="feat-section-head">
        <span class="feat-section-title">🔐 Default page modes</span>
        <span class="feat-section-hint">Full = editable · Read = view-only (default-feature pages only)</span>
      </div>
      <div class="feat-grid">
        ${PAGE_MODES.filter(p => DEFAULT_FEATURES.includes(p.feature)).map(p => {
          const mode = pageModes[p.id] || 'full';
          return `
            <div class="feat-row">
              <div class="feat-row-header">
                <span class="feat-icon">${p.icon}</span>
                <div class="feat-label">
                  ${p.label}
                  <div style="font-family:var(--font);font-size:10px;color:var(--text-muted);font-weight:500;margin-top:2px;">${p.id}.html</div>
                </div>
                <div class="pg-mode" data-page="${p.id}" style="align-self:center;">
                  <button type="button" class="pg-mode-opt${mode==='full'?' active':''}" data-mode="full" data-page="${p.id}" onclick="onInlineModeChange(this)">Full</button>
                  <button type="button" class="pg-mode-opt${mode==='read'?' active':''}" data-mode="read" data-page="${p.id}" onclick="onInlineModeChange(this)">Read</button>
                </div>
              </div>
            </div>`;
        }).join('')}
      </div>
    </div>

    <div class="save-bar">
      <span class="unsaved-badge" id="unsaved-label" style="visibility:${_dirty ? 'visible' : 'hidden'};">Unsaved changes</span>
      <button class="btn btn-primary btn-sm" onclick="savePermissions()" id="save-btn" ${_dirty ? '' : 'disabled'}>💾 Save permissions</button>
    </div>`;

  document.getElementById('pm-panel').innerHTML = html;
}

// ── Toggle feature on/off ─────────────────────────────────────────────────────
function onFeatureToggle(key, enabled) {
  if (!_current) return;
  if (!_current.features) _current.features = [];
  if (enabled) {
    if (!_current.features.includes(key)) _current.features.push(key);
  } else {
    _current.features = _current.features.filter(f => f !== key);
    // Remove page grants when disabling
    if (_current.feature_pages) delete _current.feature_pages[key];
  }
  markDirty();
  renderPanel(); // re-render to show/hide page grants
}

// ── Toggle page grant ─────────────────────────────────────────────────────────
function onPageGrant(cb) {
  if (!_current) return;
  const key  = cb.dataset.feature;
  const id   = cb.dataset.id;
  const type = cb.dataset.type; // 'user' | 'admin'
  const f    = FEATURE_CATALOGUE[key];
  if (!f) return;

  // Build page plan if not exists
  if (!_current.feature_pages) _current.feature_pages = {};
  if (!_current.feature_pages[key]) {
    // Initialise with all pages from catalogue as default
    _current.feature_pages[key] = {
      user_pages:  [...(f.user_pages||[])],
      admin_pages: [...(f.admin_pages||[])],
    };
  }

  const plan = _current.feature_pages[key];
  const arr  = type === 'user' ? 'user_pages' : 'admin_pages';
  if (cb.checked) {
    if (!plan[arr].includes(id)) plan[arr].push(id);
  } else {
    plan[arr] = plan[arr].filter(x => x !== id);
  }
  // Enable / disable the inline mode toggle for this row so it visually
  // reflects whether the page is currently granted.
  const modeEl = cb.closest('.pg-item')?.querySelector('.pg-mode');
  if (modeEl) modeEl.classList.toggle('disabled', !cb.checked);
  markDirty();
}

// ── Save ──────────────────────────────────────────────────────────────────────
async function savePermissions() {
  if (!_current || !_dirty) return;
  const btn = document.getElementById('save-btn');
  btn.disabled = true; btn.textContent = 'Saving...';

  const res = await API.teams.update(_current.id, {
    features:      _current.features,
    feature_pages: _current.feature_pages || {},
    page_modes:    _current.page_modes    || {},
  });

  btn.innerHTML = '<i data-icon="save"></i> Save Permissions';
  if (res?.ok) {
    Toast.success('Permissions saved!');
    _dirty = false;
    const idx = _teams.findIndex(t => t.id === _current.id);
    if (idx !== -1) _teams[idx] = { ..._teams[idx], ..._current };
    // Refresh the shared team cache so Auth.getTeamFeaturePages() reads the
    // new grants on the next page navigation (used by view-as UI gates).
    try { sessionStorage.setItem('_sa_teams_data', JSON.stringify(_teams)); } catch {}
    // Drop the sidebar HTML cache so next page rebuilds under the new grants.
    try { sessionStorage.removeItem('_sm_sb_html'); } catch {}
    syncDirtyUI();
  } else {
    Toast.error(res?.data?.message || 'Failed to save');
    btn.disabled = false;
  }
}

function onPageModeChange(sel) {
  if (!_current) return;
  if (!_current.page_modes) _current.page_modes = {};
  const mode = sel.value;
  if (mode === 'full') delete _current.page_modes[sel.dataset.page];
  else _current.page_modes[sel.dataset.page] = mode;
  sel.style.borderColor = mode==='read'?'rgba(99,102,241,.4)':'rgba(16,185,129,.4)';
  sel.style.background  = mode==='read'?'rgba(99,102,241,.08)':'rgba(16,185,129,.06)';
  sel.style.color       = mode==='read'?'#6366f1':'#10b981';
  // Sync the inline segmented toggle if it exists for the same page.
  document.querySelectorAll(`.pg-mode[data-page="${sel.dataset.page}"] .pg-mode-opt`).forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  markDirty();
}

// ── Copy config from SM (one-time seed) ──────────────────────────────────────
// Instead of always starting with empty files (the default provisioning
// behaviour), super_admin can click "Copy from SM" to snapshot SM's current
// config for that feature into the target team. Files that already have data
// are protected — the user is asked to confirm overwrite explicitly.
async function copyFeatureConfig(featureKey, btn) {
  if (!_current) return;
  if (_current.slug === 'sm') { Toast.error('SM is the source team'); return; }

  const label = btn.querySelector('span');
  const origLabel = label ? label.textContent : '';
  btn.disabled = true;
  btn.classList.add('copying');
  if (label) label.textContent = 'Copying…';

  // First pass — safe (won't overwrite non-empty files)
  let res = await API.post('/teams/copy-config.php', {
    team_slug: _current.slug,
    feature:   featureKey,
    overwrite: false,
  });

  if (!res?.ok) {
    Toast.error(res?.data?.message || 'Copy failed');
    btn.disabled = false; btn.classList.remove('copying');
    if (label) label.textContent = origLabel;
    return;
  }

  const data = res.data?.data || {};
  const copied  = (data.copied  || []).length;
  const skipped = data.skipped  || [];
  const blocked = skipped.filter(s => s.reason === 'dst_not_empty');

  // If some files were kept because they already have data, offer to overwrite
  if (blocked.length) {
    const ok = confirm(
      `Copied ${copied} file(s).\n\n` +
      `${blocked.length} file(s) already have data in ${_current.name} and were kept:\n` +
      blocked.map(s => '  <i data-icon="circle"></i> ' + s.file).join('\n') + '\n\n' +
      `Overwrite them with SM's current data too?`
    );
    if (ok) {
      const res2 = await API.post('/teams/copy-config.php', {
        team_slug: _current.slug,
        feature:   featureKey,
        overwrite: true,
      });
      if (res2?.ok) {
        const c2 = (res2.data?.data?.copied || []).length;
        Toast.success(`Overwrote ${c2} file(s) from SM`);
      } else {
        Toast.error(res2?.data?.message || 'Overwrite failed');
      }
    } else {
      Toast.success(`Copied ${copied} file(s) (existing data kept)`);
    }
  } else {
    Toast.success(copied ? `Copied ${copied} file(s) from SM` : 'Nothing to copy');
  }

  btn.disabled = false;
  btn.classList.remove('copying');
  if (label) label.textContent = origLabel;
}

// ── Inline segmented mode toggle (per granted page) ──────────────────────────
function onInlineModeChange(btn) {
  if (!_current) return;
  const pageId = btn.dataset.page;
  const mode   = btn.dataset.mode; // 'full' | 'read'
  if (!pageId || !mode) return;
  if (!_current.page_modes) _current.page_modes = {};
  if (mode === 'full') delete _current.page_modes[pageId];
  else _current.page_modes[pageId] = mode;
  // Toggle active class on the two buttons within the same group.
  btn.parentElement.querySelectorAll('.pg-mode-opt').forEach(b => {
    b.classList.toggle('active', b === btn);
  });
  // Keep the legacy standalone select in sync too (if the same page is listed).
  const sel = document.querySelector(`.pm-mode-sel[data-page="${pageId}"]`);
  if (sel && sel.value !== mode) {
    sel.value = mode;
    // Fire onPageModeChange to update its inline styles.
    onPageModeChange(sel);
  } else {
    markDirty();
  }
}

function markDirty() {
  _dirty = true;
  syncDirtyUI();
}

// Sync the save-bar UI to the current `_dirty` state without mutating it.
// Called after successful save (with _dirty=false) and by markDirty().
function syncDirtyUI() {
  const lbl = document.getElementById('unsaved-label');
  const btn = document.getElementById('save-btn');
  if (lbl) lbl.style.visibility = _dirty ? '' : 'hidden';
  if (btn) btn.disabled = !_dirty;
}

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "copyFeatureConfig", { configurable: true, get: () => copyFeatureConfig, set: (v) => { copyFeatureConfig = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "markDirty", { configurable: true, get: () => markDirty, set: (v) => { markDirty = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "onFeatureToggle", { configurable: true, get: () => onFeatureToggle, set: (v) => { onFeatureToggle = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "onInlineModeChange", { configurable: true, get: () => onInlineModeChange, set: (v) => { onInlineModeChange = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "onPageGrant", { configurable: true, get: () => onPageGrant, set: (v) => { onPageGrant = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "onPageModeChange", { configurable: true, get: () => onPageModeChange, set: (v) => { onPageModeChange = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "savePermissions", { configurable: true, get: () => savePermissions, set: (v) => { savePermissions = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "syncDirtyUI", { configurable: true, get: () => syncDirtyUI, set: (v) => { syncDirtyUI = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "escHtml", { configurable: true, get: () => escHtml, set: (v) => { escHtml = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadData", { configurable: true, get: () => loadData, set: (v) => { loadData = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderPanel", { configurable: true, get: () => renderPanel, set: (v) => { renderPanel = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderTeamList", { configurable: true, get: () => renderTeamList, set: (v) => { renderTeamList = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "selectTeam", { configurable: true, get: () => selectTeam, set: (v) => { selectTeam = v; } }); } catch (e) {}
})();
