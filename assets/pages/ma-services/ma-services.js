/**
 * MA Services Management
 * Handles MA Usecases and Cut-off Services
 */

let usecasesData = [];
let cutoffsData = [];
let modulesConfig = []; // loaded from api/ma-modules/config.php
let currentEditId = null;
let currentType = 'usecases'; // 'usecases' or 'cutoffs'
let currentCategory = 'ALL'; // 'TMN', 'NANO', 'WEALTH', 'Bank', 'Nano', 'ALL'
let currentView = 'landing'; // 'landing', 'category', 'data'
let usecaseImages = []; // Store uploaded images for usecases
let cutoffImages = []; // Store uploaded images for cutoffs

// Initialize
async function _initMaServices() {
  applyReadOnlyMode();

  // Shared LoadingOverlay with a 3-step tracker — blocks main content until
  // all critical loads finish. Sidebar/topbar stay usable.
  const loader = LoadingOverlay.tracker(
    [
      { key: 'usecases', label: 'MA Usecases (local)' },
      { key: 'cutoffs',  label: 'Cut-off Services (local)' },
      { key: 'boCases',  label: 'Admin Portal — MA state' },
    ],
    {
      message: 'กำลังโหลดข้อมูล',
      hint: 'ระบบกำลังเชื่อม Admin Portal + local data',
      timeout: 20000,
    }
  );

  loadUsecases().finally(() => loader.done('usecases'));
  loadCutoffs().finally(() => loader.done('cutoffs'));
  initFilters();
  loadModuleConfig();

  // Delay Admin Portal fetch — it's the slowest (SOM→Keycloak→Admin Portal 3-hop)
  // and most sensitive to auth-init races. Retry once on failure.
  setTimeout(async () => {
    await _loadBoCasesWithRetry();
    loader.done('boCases');
  }, 600);
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initMaServices, { once: true });
} else {
  _initMaServices();
}

async function _loadBoCasesWithRetry() {
  try {
    await loadBoCases();
    if (_boCases && _boCases.length) {
      if (usecasesData && usecasesData.length) renderUsecases(usecasesData);
      return;
    }
    throw new Error('empty _boCases');
  } catch (e) {
    console.warn('[ma-services] loadBoCases first attempt failed, retrying in 1.5s:', e);
    LoadingOverlay.show('Admin Portal โหลดไม่ผ่าน — กำลังลองใหม่...');
    await new Promise(r => setTimeout(r, 1500));
    _boCases = null;
    _boCasesLoading = null;
    try { await loadBoCases(); } catch (e2) {
      console.warn('[ma-services] loadBoCases retry also failed:', e2);
    }
    if (usecasesData && usecasesData.length) renderUsecases(usecasesData);
  }
}

// (Loading overlay moved to assets/js/loading-overlay.js — use LoadingOverlay.*)

// ═══════════════════════════════════════════════════
// READ-ONLY MODE  (non-SM viewers)
// ═══════════════════════════════════════════════════
// MA Usecase & Cut-off data is curated by SM as the single source of truth.
// Other teams (and super_admin viewing-as another team) see it but cannot edit.
// Backend enforces this via requireSmForShared(); this only hides the UI.
function isReadOnlyView() {
  const user = (Auth && Auth.getUser && Auth.getUser()) || {};
  if (user.role === 'super_admin') {
    const ctxTeam = (API && API.getAdminTeam && API.getAdminTeam()) || null;
    return !!ctxTeam && ctxTeam !== 'sm';
  }
  return !!user.team && user.team !== 'sm';
}

function applyReadOnlyMode() {
  if (!isReadOnlyView()) return;
  document.body.classList.add('ma-readonly');
  const style = document.createElement('style');
  style.textContent = `
    body.ma-readonly .ma-add-btn,
    body.ma-readonly .ma-actions,
    body.ma-readonly .ma-import-btn { display: none !important; }
    body.ma-readonly .ma-readonly-banner {
      display: flex; align-items: center; gap: 8px;
      margin: 12px 40px 0;
      padding: 8px 14px; border-radius: 6px;
      background: var(--warning-bg, #fff7e6);
      border: 1px solid var(--warning, #f5a623);
      color: var(--warning, #a5711a);
      font-size: 11px; font-weight: 600;
    }
  `;
  document.head.appendChild(style);

  const banner = document.createElement('div');
  banner.className = 'ma-readonly-banner';
  const who = (Auth?.getUser?.()?.team) || (API?.getAdminTeam?.()) || 'your team';
  banner.textContent = `View-only — MA Usecase & Cut-off Services are managed by the SM team. Team "${who}" cannot edit.`;
  const landing = document.getElementById('landing-view');
  if (landing && landing.firstChild) landing.insertBefore(banner, landing.firstChild);
  else if (landing) landing.appendChild(banner);
}

// ═══════════════════════════════════════════════════
// MODULE CONFIG — Dynamic landing cards
// ═══════════════════════════════════════════════════

async function loadModuleConfig() {
  const defaults = [
    { id: 'usecases', name: 'MA Usecases',     desc: 'Manual Action Services', icon: 'MA', theme: 'amber', enabled: true, status: 'active', builtin: true, types: ['TMN','NANO','WEALTH'] },
    { id: 'cutoffs',  name: 'Cut-off Services', desc: 'Cut-off Time Services',  icon: 'CO', theme: 'blue',  enabled: true, status: 'active', builtin: true, types: ['TMN','Nano','Bank']   },
  ];

  try {
    const result = await API.get('/ma-modules/config.php');
    modulesConfig = result && result.data && result.data.success ? result.data.data : defaults;
  } catch (e) {
    modulesConfig = defaults;
  }

  renderLandingCards();
  populateTypeDropdowns();
  showLanding();

  // Bootstrap view from URL params (?view=data&type=usecases&category=TMN)
  const _masP = new URLSearchParams(location.search);
  const _masView = _masP.get('view');
  const _masType = _masP.get('type');
  const _masCat  = _masP.get('category') || 'ALL';
  const _validTypes = modulesConfig.map(m => m.id);
  if (_masView === 'data' && _masType && _validTypes.includes(_masType)) {
    showDataView(_masType, _masCat);
  } else if (_masView === 'category' && _masType && _validTypes.includes(_masType)) {
    showCategoryView(_masType);
  }
}

function renderLandingCards() {
  // Split chooser HTML is pre-defined in the HTML.
  // Module names/subtypes are hardcoded; updateLandingStats() fills the counts.
  // Nothing to render dynamically here.
}

// masEnterModule is defined as an inline script in ma-services.html (bottom of body)
// to guarantee global scope. This placeholder prevents any legacy call from breaking.
if (typeof window.masEnterModule === 'undefined') {
  window.masEnterModule = function(moduleId) { showCategoryView(moduleId); };
}

// ═══════════════════════════════════════════════════
// VIEW MANAGEMENT (3 Levels)
function populateTypeDropdowns() {
  const ucMod = modulesConfig.find(m => m.id === 'usecases');
  const coMod = modulesConfig.find(m => m.id === 'cutoffs');

  // Service Type dropdown (Add/Edit Usecase form)
  const ucSel = document.getElementById('usecase-service-type');
  if (ucSel && ucMod) {
    const current = ucSel.value;
    ucSel.innerHTML = '<option value="">Select...</option>' +
      (ucMod.types || []).map(t => `<option value="${t}">${t}</option>`).join('');
    if (current) ucSel.value = current;
  }

  // Site Type dropdown (Add/Edit Cutoff form)
  const coSel = document.getElementById('cutoff-site-type');
  if (coSel && coMod) {
    const current = coSel.value;
    coSel.innerHTML = '<option value="">Select...</option>' +
      (coMod.types || []).map(t => `<option value="${t}">${t}</option>`).join('');
    if (current) coSel.value = current;
  }
}

// ═══════════════════════════════════════════════════

// Level 1: Landing Page
function _masUpdateUrl() {
  const _p = new URLSearchParams();
  if (currentView !== 'landing') _p.set('view', currentView);
  if (currentView !== 'landing' && currentType) _p.set('type', currentType);
  if (currentView === 'data' && currentCategory && currentCategory !== 'ALL') _p.set('category', currentCategory);
  history.replaceState(null, '', _p.toString() ? '?' + _p.toString() : location.pathname);
}

function showLanding() {
  currentView = 'landing';
  document.getElementById('landing-view').style.display = 'flex';
  document.getElementById('category-view').style.display = 'none';
  document.getElementById('data-view').style.display = 'none';

  updateLandingStats();

  // Restore split chooser — remove all animation classes cleanly, let CSS transition handle it
  const chooser = document.getElementById('mas-split-chooser');
  if (chooser) {
    chooser.querySelectorAll('.mas-cover').forEach(el => el.remove());
    chooser.classList.remove(
      'mas-choosing-usecases', 'mas-choosing-cutoffs',
      'mas-collapsing', 'mas-entering'
    );
    chooser.style.display = '';
  }
  _masUpdateUrl();
}

// Level 2: Category Selection
function showCategoryView(type) {
  currentView = 'category';
  currentType = type;

  document.getElementById('landing-view').style.display = 'none';
  document.getElementById('category-view').style.display = 'flex';
  document.getElementById('data-view').style.display = 'none';

  // Update nav header from module config
  const mod = modulesConfig.find(m => m.id === type);
  document.getElementById('category-title').textContent    = mod ? mod.name : type;
  document.getElementById('category-subtitle').textContent = 'เลือกประเภทที่ต้องการดู';

  const cv = document.getElementById('category-view');
  cv.classList.toggle('mas-mod-usecases', type === 'usecases');
  cv.classList.toggle('mas-mod-cutoffs',  type !== 'usecases');
  cv.classList.remove('mas-entering');
  requestAnimationFrame(() => {
    cv.classList.add('mas-entering');
    setTimeout(() => cv.classList.remove('mas-entering'), 500);
  });

  renderCategoryCards(type);
  updateCategoryStats();
  _masUpdateUrl();
}

function renderCategoryCards(moduleId) {
  const container = document.getElementById('category-cards-container');
  const mod = modulesConfig.find(m => m.id === moduleId);
  if (!mod) return;

  const typeData = mod.type_data || (mod.types || []).map(n => ({ name: n, color: 'gray' }));
  const unit = moduleId === 'cutoffs' ? 'cut-offs' : 'usecases';

  const cards = typeData.map(td => {
    const tName = td.name;
    const color = td.color || 'gray';
    const idKey = `cat-${moduleId}-${tName.toLowerCase()}-count`;
    return `
      <div class="category-card" data-color="${color}" onclick="showDataView('${moduleId}','${tName}')">
        <h3>${tName} Services</h3>
        <span class="category-card-count" id="${idKey}"></span>
        <span class="category-card-arrow">→</span>
      </div>`;
  });

  // Append "All" card
  cards.push(`
    <div class="category-card" data-color="all" onclick="showDataView('${moduleId}','ALL')">
      <h3>All Services</h3>
      <span class="category-card-count" id="cat-${moduleId}-all-count"></span>
      <span class="category-card-arrow">→</span>
    </div>`);

  container.innerHTML = cards.join('');
  container.style.display = 'grid';

  // Apply grid rows dynamically based on card count
  const total = cards.length;
  const cols = 2;
  const rows = Math.ceil(total / cols);
  container.style.gridTemplateRows = Array(rows).fill('1fr').join(' ');
}

// Level 3: Data View
function showDataView(type, category) {
  currentView = 'data';
  currentType = type;
  currentCategory = category;

  document.getElementById('landing-view').style.display = 'none';
  document.getElementById('category-view').style.display = 'none';
  document.getElementById('data-view').style.display = 'flex';

  const dv = document.getElementById('data-view');
  dv.classList.toggle('mas-data-usecases', type === 'usecases');
  dv.classList.toggle('mas-data-cutoffs',  type !== 'usecases');
  dv.classList.remove('mas-entering');
  requestAnimationFrame(() => {
    dv.classList.add('mas-entering');
    setTimeout(() => dv.classList.remove('mas-entering'), 380);
  });
  
  // Update breadcrumb
  const mod = modulesConfig.find(m => m.id === type);
  document.getElementById('breadcrumb-type').textContent = mod ? mod.name : type;
  document.getElementById('breadcrumb-category').textContent = category === 'ALL' ? 'All Services' : category;
  
  // Show correct tab content and stats panel
  const usecasesTab = document.getElementById('tab-usecases');
  const cutoffsTab = document.getElementById('tab-cutoffs');
  const statsUC = document.getElementById('nav-stats-usecases');
  const statsCO = document.getElementById('nav-stats-cutoffs');

  if (type === 'usecases') {
    usecasesTab.classList.add('active');
    cutoffsTab.classList.remove('active');
    if (statsUC) statsUC.style.display = 'flex';
    if (statsCO) statsCO.style.display = 'none';
    filterAndRenderUsecases();
  } else if (type === 'cutoffs') {
    usecasesTab.classList.remove('active');
    cutoffsTab.classList.add('active');
    if (statsUC) statsUC.style.display = 'none';
    if (statsCO) statsCO.style.display = 'flex';
    filterAndRenderCutoffs();
  } else {
    // Custom module — no data backend yet, show placeholder in data view
    usecasesTab.classList.remove('active');
    cutoffsTab.classList.remove('active');
    if (statsUC) statsUC.style.display = 'none';
    if (statsCO) statsCO.style.display = 'none';
    // Render a "coming soon" inside data-view
    const placeholder = document.getElementById('tab-custom-placeholder') || (() => {
      const d = document.createElement('div');
      d.id = 'tab-custom-placeholder';
      d.className = 'ma-tab-content active';
      document.getElementById('data-view').appendChild(d);
      return d;
    })();
    placeholder.classList.add('active');
    const mod = modulesConfig.find(m => m.id === type);
    placeholder.innerHTML = `
      <div class="ma-empty">
        <i>◻</i>
        <div style="font-weight:700;margin-bottom:6px">${mod ? mod.name : type} — ${category}</div>
        <div>ยังไม่มีระบบข้อมูลสำหรับ Module นี้</div>
      </div>`;
  }
  _masUpdateUrl();
}

// setEl defined below (supports both text and html)

function updateLandingStats() {
  modulesConfig.forEach(m => {
    if (m.id === 'usecases') {
      setEl('landing-total-usecases', usecasesData.length);
      (m.types || []).forEach(t => {
        setEl('landing-' + t.toLowerCase(),
          usecasesData.filter(u => u.service_type === t).length);
      });
    } else if (m.id === 'cutoffs') {
      setEl('landing-total-cutoffs', cutoffsData.length);
      (m.types || []).forEach(t => {
        setEl('landing-cutoff-' + t.toLowerCase(),
          cutoffsData.filter(c => c.site_type === t).length);
      });
    }
    // future modules: no data source yet, total stays 0
  });
}

function updateCategoryStats() {
  const fmt = (n, unit) =>
    `<span style="display:block;font-size:40px;font-weight:800;color:var(--text);line-height:1;letter-spacing:-.02em;margin:12px 0 4px">${n}</span><span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted)">${unit}</span>`;

  const mod = modulesConfig.find(m => m.id === currentType);
  if (!mod) return;

  const typeData = mod.type_data || (mod.types || []).map(n => ({ name: n }));
  const isUC   = currentType === 'usecases';
  const isCO   = currentType === 'cutoffs';
  const unit   = isCO ? 'Cut-offs' : 'Usecases';

  let total = 0;
  typeData.forEach(td => {
    const tName = td.name;
    let count = 0;
    if (isUC)      count = usecasesData.filter(u => u.service_type === tName).length;
    else if (isCO) count = cutoffsData.filter(c => c.site_type === tName).length;
    total += count;
    setEl(`cat-${currentType}-${tName.toLowerCase()}-count`, '', fmt(count, unit));
  });
  setEl(`cat-${currentType}-all-count`, '', fmt(total, unit));
}

function setEl(id, text, html) {
  const el = document.getElementById(id);
  if (!el) return;
  if (html !== undefined) el.innerHTML = html;
  else el.textContent = text;
}

// ═══════════════════════════════════════════════════
// TAB MANAGEMENT (Removed - no longer needed)
// ═══════════════════════════════════════════════════

// ═══════════════════════════════════════════════════
// FILTERS & SEARCH
// ═══════════════════════════════════════════════════

function initFilters() {
  // Usecases filters
  document.getElementById('search-usecases').addEventListener('input', filterAndRenderUsecases);
  document.getElementById('filter-tool-type').addEventListener('change', filterAndRenderUsecases);
  
  // Cutoffs filters
  document.getElementById('search-cutoffs').addEventListener('input', filterAndRenderCutoffs);
  document.getElementById('filter-bank').addEventListener('change', filterAndRenderCutoffs);
}

function filterAndRenderUsecases() {
  const search = document.getElementById('search-usecases').value.toLowerCase();
  const toolType = document.getElementById('filter-tool-type').value;
  
  let filtered = usecasesData;
  
  // Filter by category
  if (currentCategory !== 'ALL') {
    filtered = filtered.filter(item => item.service_type === currentCategory);
  }
  
  // Filter by search
  if (search) {
    filtered = filtered.filter(item => 
      item.service_name.toLowerCase().includes(search) ||
      (item.remark && item.remark.toLowerCase().includes(search)) ||
      item.tool_type.toLowerCase().includes(search)
    );
  }
  
  // Filter by tool type
  if (toolType) {
    filtered = filtered.filter(item => item.tool_type === toolType);
  }
  
  renderUsecases(filtered);
  
  // Update stats
  document.getElementById('stat-filtered-usecases').textContent = filtered.length;
  document.getElementById('stat-total-usecases').textContent = usecasesData.length;
}

function filterAndRenderCutoffs() {
  const search = document.getElementById('search-cutoffs').value.toLowerCase();
  const bank = document.getElementById('filter-bank').value;
  
  let filtered = cutoffsData;
  
  // Filter by category
  if (currentCategory !== 'ALL') {
    filtered = filtered.filter(item => item.site_type === currentCategory);
  }
  
  // Filter by search
  if (search) {
    filtered = filtered.filter(item => 
      item.service_name.toLowerCase().includes(search) ||
      (item.bank_name && item.bank_name.toLowerCase().includes(search)) ||
      (item.comcode && item.comcode.toLowerCase().includes(search))
    );
  }
  
  // Filter by bank
  if (bank) {
    filtered = filtered.filter(item => item.bank_name === bank);
  }
  
  renderCutoffs(filtered);
  
  // Update stats
  document.getElementById('stat-filtered-cutoffs').textContent = filtered.length;
  document.getElementById('stat-total-cutoffs').textContent = cutoffsData.length;
}

// ═══════════════════════════════════════════════════
// LOAD DATA
// ═══════════════════════════════════════════════════

async function loadUsecases() {
  try {
    const response = await API.get('/ma-services/list.php');
    const result = response && response.data;

    if (result && result.success) {
      usecasesData = result.data || [];
      updateLandingStats();
      updateCategoryStats();
      if (currentView === 'data' && currentType === 'usecases') {
        filterAndRenderUsecases();
      }
    } else {
      showError((result && result.message) || 'Failed to load usecases');
    }
  } catch (error) {
    console.error('Error loading usecases:', error);
    showError('Error loading usecases');
  }
}

async function loadCutoffs() {
  try {
    const response = await API.get('/cutoff-services/list.php');
    const result = response && response.data;

    if (result && result.success) {
      cutoffsData = result.data || [];
      updateLandingStats();
      updateCategoryStats();
      if (currentView === 'data' && currentType === 'cutoffs') {
        filterAndRenderCutoffs();
      }
    } else {
      showError((result && result.message) || 'Failed to load cut-offs');
    }
  } catch (error) {
    console.error('Error loading cut-offs:', error);
    showError('Error loading cut-offs');
  }
}

// ═══════════════════════════════════════════════════
// RENDER TABLES
// ═══════════════════════════════════════════════════

function renderUsecases(data) {
  const tbody = document.getElementById('usecases-tbody');
  
  if (!data || data.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" class="ma-empty">
          <i>◻</i>
          <p>No usecases found</p>
        </td>
      </tr>`;
    return;
  }
  
  tbody.innerHTML = data.map(item => {
    const canChange = item.can_change_text
      ? `<span style="font-size:10px;font-weight:700;color:${item.can_change_text === 'YES' ? 'var(--success)' : 'var(--text-muted)'}">${item.can_change_text}</span>`
      : '<span style="color:var(--border)">—</span>';

    const linkChips = [
      item.link_manual   ? `<a href="${item.link_manual}"   target="_blank" rel="noopener" class="ma-link" title="Manual">doc</a>`   : '',
      item.direct_link   ? `<a href="${item.direct_link}"   target="_blank" rel="noopener" class="ma-link" title="Direct">link</a>`  : '',
      item.custom_url    ? `<a href="${item.custom_url}"    target="_blank" rel="noopener" class="ma-link" title="Custom">url</a>`   : '',
      item.grafana_link  ? `<button type="button" class="ma-link graph" title="Open Grafana graph" onclick="openGrafanaPopup('${escapeAttr(item.grafana_link)}','${escapeAttr(item.service_name)}')">graph</button>` : '',
      item.opensearch_url ? `<a href="${item.opensearch_url}" target="_blank" rel="noopener" class="ma-link opensearch" title="OpenSearch">os</a>` : '',
    ].filter(Boolean);
    const links = linkChips.length
      ? `<div class="ma-links-cell">${linkChips.join('')}</div>`
      : '<span style="color:var(--border)">—</span>';

    const imgBtn = item.images && item.images.length > 0
      ? `<button class="ma-images-btn has-images" onclick="viewImages('usecase', ${item.id}, '${escapeHtml(item.service_name)}')">${item.images.length} img</button>`
      : `<button class="ma-images-btn" onclick="viewImages('usecase', ${item.id}, '${escapeHtml(item.service_name)}')">0 img</button>`;

    return `
      <tr>
        <td style="color:var(--text-muted);font-size:10.5px">${item.id}</td>
        <td><strong>${escapeHtml(item.service_name)}</strong></td>
        <td><span class="ma-badge ${item.service_type.toLowerCase()}">${item.service_type}</span></td>
        <td><span class="ma-badge ${getBadgeClass(item.tool_type)}">${item.tool_type}</span></td>
        <td>${canChange}</td>
        <td style="color:var(--text-muted);white-space:pre-wrap;word-break:break-word;max-width:260px">${item.remark ? escapeHtml(item.remark) : '<span style="color:var(--border)">—</span>'}</td>
        <td>${links}</td>
        <td>${imgBtn}</td>
        <td>${renderMaControlCell(item)}</td>
        <td>
          <div class="ma-actions">
            <button class="ma-action-btn edit"   data-action="edit"   onclick="editUsecase(${item.id})"   title="Edit">edit</button>
            <button class="ma-action-btn delete" data-action="delete" onclick="deleteUsecase(${item.id})" title="Delete">del</button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

// ═══════════════════════════════════════════════════
// ADMIN PORTAL MA TOGGLE (Option A: shared SM account)
// Only visible for tool_type='Admin Portal' items that have a
// backoffice_use_case_id linked. Actions restricted to sm_admin/sm_lead.
// ═══════════════════════════════════════════════════
function _canToggleMa() {
  // Backend gates via requireSmForShared() — only team=sm can write.
  // Non-SM teams (or super_admin viewing another team) see chip only.
  return !isReadOnlyView();
}

// Mirror of ma_norm_name() in api/ma-status/index.php — must stay in sync
// so the auto-matched use_case here is the same as ma-status shows.
function _maNormName(s) {
  if (!s) return '';
  return String(s)
    .replace(/^disable\s+/i, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Return the effective Admin Portal use_case_id for a service:
//   1) explicit backoffice_use_case_id field, else
//   2) fuzzy name match against _boCases (same as ma-status)
// Returns { id, autoMatched } or null.
function resolveBoUseCase(item) {
  if (item.backoffice_use_case_id) {
    const hit = _boCases && _boCases.find(x => x.id === Number(item.backoffice_use_case_id));
    return { id: Number(item.backoffice_use_case_id), autoMatched: false, live: hit || null };
  }
  if (!_boCases || !_boCases.length) return null;
  const key = _maNormName(item.service_name);
  if (!key) return null;
  const hit = _boCases.find(x => _maNormName(x.name) === key);
  if (!hit) return null;
  return { id: hit.id, autoMatched: true, live: hit };
}

function renderMaControlCell(item) {
  if (item.tool_type === 'Jenkins') return renderJenkinsControlCell(item);
  if (item.tool_type !== 'Admin Portal') {
    return '<span style="color:var(--border)">—</span>';
  }
  const resolved = resolveBoUseCase(item);
  if (!resolved) {
    // Not in _boCases AND no explicit link — genuinely unlinked.
    if (!_boCases) {
      return `<span style="font-size:10.5px;color:var(--text-muted)">loading…</span>`;
    }
    return `<span style="font-size:10.5px;color:var(--text-muted)" title="ไม่พบชื่อใน Admin Portal (fuzzy match) และไม่ได้ผูก use_case_id ตรงๆ">unlinked</span>`;
  }
  // Source of truth priority: live Admin Portal state (from _boCases) > local last-toggled stamp.
  const live = resolved.live;
  const liveState = live ? (live.status === 'closed' ? 'enable' : live.status === 'open' ? 'disable' : null) : null;
  const state = liveState || item.last_toggled_action || null;
  const src   = live ? 'live from Admin Portal' : (item.last_toggled_action ? 'from last local toggle' : 'unknown');

  // Big prominent state chip — clickable if user can toggle. Opens the
  // full Edit Use Case modal (all fields visible; single source of truth).
  const canToggle = _canToggleMa();
  const clickAttr = canToggle
    ? `onclick="openBoEditModal(${item.id})" style="cursor:pointer" title="คลิกเพื่อ Edit Use Case (${src})"`
    : `title="${src}"`;

  let stateChip;
  if (state === 'enable') {
    stateChip = `<div class="ma-state-chip is-enable" ${clickAttr}>
        <span class="ma-state-dot"></span>MA ENABLE
      </div>`;
  } else if (state === 'disable') {
    stateChip = `<div class="ma-state-chip is-disable" ${clickAttr}>
        <span class="ma-state-dot"></span>MA DISABLE
      </div>`;
  } else {
    stateChip = `<div class="ma-state-chip is-loading" ${clickAttr}>loading…</div>`;
  }

  const lastLine = item.last_toggled_by_name
    ? `<div style="font-size:10px;color:var(--text-muted);margin-top:3px" title="${escapeAttr(item.last_toggled_reason || '')}">
         last: ${escapeHtml(item.last_toggled_by_name)} · ${_maRelTime(item.last_toggled_at)}
       </div>`
    : `<div style="font-size:10px;color:var(--text-muted);margin-top:3px">last: —</div>`;

  if (!canToggle) {
    return `<div>${stateChip}${lastLine}
              <div style="font-size:10px;color:var(--text-muted);margin-top:2px">(view-only — เฉพาะทีม SM)</div>
            </div>`;
  }

  return `<div>${stateChip}${lastLine}</div>`;
}

function _maRelTime(ts) {
  if (!ts) return '';
  const d = new Date(Number(ts) * 1000);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  // Same day → just HH:MM. Different day → DD/MM HH:MM for clarity.
  const sameDay = d.getFullYear() === now.getFullYear()
               && d.getMonth() === now.getMonth()
               && d.getDate() === now.getDate();
  if (sameDay) return `${hh}:${mm}`;
  const dd = String(d.getDate()).padStart(2, '0');
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mo} ${hh}:${mm}`;
}

let _pendingMaToggle = null; // { id, useCaseId, autoMatched }

function openMaTogglePrompt(id) {
  const item = usecasesData.find(u => u.id === id);
  if (!item) return;
  const resolved = resolveBoUseCase(item);
  if (!resolved) {
    Toast.error('ไม่พบ use_case ที่ match กับชื่อนี้ใน Admin Portal — ผูก id ตรงๆ ในฟอร์มก่อน');
    return;
  }
  if (!_canToggleMa()) {
    Toast.error('เฉพาะทีม SM เท่านั้นที่กด MA On/Off ได้');
    return;
  }
  _pendingMaToggle = { id, useCaseId: resolved.id, autoMatched: resolved.autoMatched };

  // Resolve current state
  const live = resolved.live;
  const liveState = live ? (live.status === 'closed' ? 'enable' : live.status === 'open' ? 'disable' : null) : null;
  const state = liveState || item.last_toggled_action || null;

  // Render summary card with all details
  const currentChip = state === 'enable'
    ? `<span style="display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:5px;background:#fee2e2;color:#991b1b;font-size:11px;font-weight:800;border:1.5px solid #dc2626">
         <span style="width:8px;height:8px;border-radius:50%;background:#dc2626"></span>MA ENABLE
       </span>`
    : state === 'disable'
    ? `<span style="display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:5px;background:#dcfce7;color:#14532d;font-size:11px;font-weight:800;border:1.5px solid #16a34a">
         <span style="width:8px;height:8px;border-radius:50%;background:#16a34a"></span>MA DISABLE
       </span>`
    : `<span style="color:var(--text-muted);font-size:11px">(ไม่ทราบสถานะ)</span>`;

  const lastLine = item.last_toggled_by_name
    ? `<div style="font-size:11px;color:var(--text-muted);margin-top:8px">
         Last toggled: <strong>${escapeHtml(item.last_toggled_by_name)}</strong> · ${_maRelTime(item.last_toggled_at)}
         ${item.last_toggled_reason ? '<br>เหตุผลครั้งก่อน: <em>' + escapeHtml(item.last_toggled_reason) + '</em>' : ''}
       </div>`
    : '';

  document.getElementById('ma-toggle-title').textContent = 'จัดการ MA — ' + item.service_name;
  document.getElementById('ma-toggle-summary').innerHTML = `
    <div style="padding:10px 12px;border-radius:8px;background:var(--bg-muted,rgba(0,0,0,.03));border:1px solid var(--border);margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <div>
          <div style="font-weight:700;font-size:13px">${escapeHtml(item.service_name)}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">
            use_case_id=<code>${resolved.id}</code>
            ${live && live.name ? ' · ' + escapeHtml(live.name) : ''}
            ${resolved.autoMatched ? ' · <span style="color:#f59e0b" title="จะบันทึกการเชื่อมนี้ลง record หลัง confirm">auto-matched</span>' : ''}
          </div>
        </div>
        <div>
          <div style="font-size:10px;color:var(--text-muted);text-align:right">ปัจจุบัน</div>
          ${currentChip}
        </div>
      </div>
      ${lastLine}
    </div>

    <div style="margin-bottom:14px">
      <label class="form-label" style="margin-bottom:8px">เลือก action ที่จะทำ</label>
      <div class="ma-action-toggle" role="radiogroup">
        <label class="ma-action-opt is-enable ${state === 'enable' ? 'is-current' : ''}">
          <input type="radio" name="ma-action" value="enable" ${state === 'enable' ? 'checked' : ''} onchange="_updateMaConfirmBtn()">
          <span class="ma-action-opt-body">
            <strong>Enable MA</strong>
            <small>ปิด Service เพื่อทำ maintenance</small>
          </span>
        </label>
        <label class="ma-action-opt is-disable ${state === 'disable' ? 'is-current' : ''}">
          <input type="radio" name="ma-action" value="disable" ${state === 'disable' ? 'checked' : ''} onchange="_updateMaConfirmBtn()">
          <span class="ma-action-opt-body">
            <strong>Disable MA</strong>
            <small>เปิด Service กลับมาใช้งานปกติ</small>
          </span>
        </label>
      </div>
      <div style="font-size:10.5px;color:var(--text-muted);margin-top:4px">
        (option ที่มี ★ = state ปัจจุบันของ Admin Portal)
      </div>
    </div>
  `;

  _updateMaConfirmBtn();
  openModal('modal-ma-toggle');
}

function _getMaSelectedAction() {
  const el = document.querySelector('input[name="ma-action"]:checked');
  return el ? el.value : null;
}

function _updateMaConfirmBtn() {
  const btn = document.getElementById('ma-toggle-confirm-btn');
  const act = _getMaSelectedAction();
  const isEnable = act === 'enable';
  btn.textContent = isEnable ? 'Confirm — Enable MA (ปิด Service)' : 'Confirm — Disable MA (เปิด Service)';
  btn.className = 'btn ' + (isEnable ? 'btn-danger' : 'btn-primary');
  btn.disabled = false;
}

async function confirmMaToggle() {
  if (!_pendingMaToggle) return;
  const { id } = _pendingMaToggle;
  const action = _getMaSelectedAction();
  if (!action) { Toast.error('กรุณาเลือก action'); return; }
  const btn = document.getElementById('ma-toggle-confirm-btn');
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = 'Working...';
  try {
    const response = await API.post('/ma-services/backoffice-toggle.php', {
      id,
      action,
      use_case_id: _pendingMaToggle.useCaseId,  // resolved (explicit or fuzzy)
    });
    const result = response && response.data;
    if (result && result.success) {
      Toast.success(result.message || 'MA toggled successfully');
      // Optimistic update: flip local _boCases cache so chip re-renders
      // immediately with the new state — no need to wait for a full refetch.
      // Admin Portal semantics: action=enable → ma_enable=true → status='closed' (MA ENABLE)
      const useCaseId = _pendingMaToggle.useCaseId;
      if (_boCases && useCaseId) {
        const hit = _boCases.find(x => x.id === Number(useCaseId));
        if (hit) hit.status = (action === 'enable') ? 'closed' : 'open';
      }
      closeModal('modal-ma-toggle');
      _pendingMaToggle = null;
      loadUsecases();  // re-renders row using our optimistically-updated _boCases
    } else {
      Toast.error((result && result.message) || 'Failed to toggle MA');
      btn.disabled = false;
      btn.textContent = originalText;
    }
  } catch (err) {
    console.error('MA toggle error:', err);
    Toast.error('Error calling Admin Portal: ' + (err && err.message ? err.message : 'unknown'));
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function renderCutoffs(data) {
  const tbody = document.getElementById('cutoffs-tbody');
  
  if (!data || data.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="ma-empty">
          <i>◻</i>
          <p>No cut-offs found</p>
        </td>
      </tr>`;
    return;
  }
  
  tbody.innerHTML = data.map(item => {
    const imgBtn = item.images && item.images.length > 0
      ? `<button class="ma-images-btn has-images" onclick="viewImages('cutoff', ${item.id}, '${escapeHtml(item.service_name)}')">${item.images.length} img</button>`
      : `<button class="ma-images-btn" onclick="viewImages('cutoff', ${item.id}, '${escapeHtml(item.service_name)}')">0 img</button>`;

    return `
      <tr>
        <td style="color:var(--text-muted);font-size:10.5px">${item.id}</td>
        <td><span class="ma-badge ${item.site_type.toLowerCase()}">${item.site_type}</span></td>
        <td><strong>${escapeHtml(item.service_name)}</strong></td>
        <td>${item.bank_name || '<span style="color:var(--border)">—</span>'}</td>
        <td style="font-size:10.5px;color:var(--text-muted)">${item.comcode || '<span style="color:var(--border)">—</span>'}</td>
        <td><strong>${item.cutoff_time}</strong></td>
        <td style="color:var(--text-muted)">${item.cutoff_day}</td>
        <td>${imgBtn}</td>
        <td>
          <div class="ma-actions">
            <button class="ma-action-btn edit"   onclick="editCutoff(${item.id})"   title="Edit">edit</button>
            <button class="ma-action-btn delete" onclick="deleteCutoff(${item.id})" title="Delete">del</button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

// ═══════════════════════════════════════════════════
// STATS (Removed old functions)
// ═══════════════════════════════════════════════════

// ═══════════════════════════════════════════════════
// USECASE CRUD
// ═══════════════════════════════════════════════════

function openAddUsecase() {
  currentEditId = null;
  usecaseImages = [];
  document.getElementById('modal-usecase-title').textContent = 'Add MA Usecase';
  document.getElementById('form-usecase').reset();
  document.getElementById('usecase-image-preview').innerHTML = '';
  resetBoPicker();
  toggleBoPickerVisibility('');
  openModal('modal-usecase');
}

function editUsecase(id) {
  const item = usecasesData.find(u => u.id === id);
  if (!item) return;
  
  currentEditId = id;
  usecaseImages = item.images ? [...item.images] : [];
  
  document.getElementById('modal-usecase-title').textContent = 'Edit MA Usecase';
  document.getElementById('usecase-id').value = item.id;
  document.getElementById('usecase-service-name').value = item.service_name;
  document.getElementById('usecase-service-type').value = item.service_type;
  document.getElementById('usecase-tool-type').value = item.tool_type;
  document.getElementById('usecase-can-change').value = item.can_change_text || '';
  document.getElementById('usecase-remark').value = item.remark || '';
  document.getElementById('usecase-link-manual').value = item.link_manual || '';
  document.getElementById('usecase-direct-link').value = item.direct_link || '';
  document.getElementById('usecase-custom-url').value = item.custom_url || '';
  document.getElementById('usecase-grafana-link').value = item.grafana_link || '';
  document.getElementById('usecase-opensearch-link').value = item.opensearch_url || '';
  resetBoPicker();
  toggleBoPickerVisibility(item.tool_type || '');
  if ((item.tool_type || '') === 'Admin Portal') {
    loadBoCases().then(() => {
      if (item.backoffice_use_case_id) setBoPicker(item.backoffice_use_case_id);
    });
  }
  if ((item.tool_type || '') === 'Jenkins') {
    loadJenkinsServers().then(() => {
      document.getElementById('usecase-jenkins-server').value = item.jenkins_server_id || '';
      document.getElementById('usecase-jenkins-job').value    = item.jenkins_job_path  || '';
    });
  }

  renderUsecaseImagePreview();
  openModal('modal-usecase');
}

async function saveUsecase() {
  const form = document.getElementById('form-usecase');
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }
  
  const data = {
    service_name: document.getElementById('usecase-service-name').value,
    service_type: document.getElementById('usecase-service-type').value,
    tool_type: document.getElementById('usecase-tool-type').value,
    can_change_text: document.getElementById('usecase-can-change').value,
    remark: document.getElementById('usecase-remark').value,
    link_manual: document.getElementById('usecase-link-manual').value,
    direct_link: document.getElementById('usecase-direct-link').value,
    custom_url: document.getElementById('usecase-custom-url').value,
    grafana_link: document.getElementById('usecase-grafana-link').value,
    opensearch_url: document.getElementById('usecase-opensearch-link').value,
    backoffice_use_case_id: document.getElementById('usecase-backoffice-id').value,
    jenkins_server_id: document.getElementById('usecase-jenkins-server').value,
    jenkins_job_path:  document.getElementById('usecase-jenkins-job').value,
    images: usecaseImages
  };
  
  try {
    const path = currentEditId
      ? '/ma-services/update.php'
      : '/ma-services/create.php';

    if (currentEditId) {
      data.id = currentEditId;
    }

    const response = await API.post(path, data);
    const result = response && response.data;

    if (result && result.success) {
      const action = currentEditId ? 'update' : 'create';
      const itemName = data.service_name;
      const itemId = result.id || currentEditId;
      await logActivity(action, 'usecase', itemId, itemName,
        `${data.service_type} - ${data.tool_type}`);

      Toast.success(currentEditId ? 'Usecase updated' : 'Usecase created');
      closeModal('modal-usecase');
      usecaseImages = [];
      loadUsecases();
    } else {
      showError((result && result.message) || 'Failed to save usecase');
    }
  } catch (error) {
    console.error('Error saving usecase:', error);
    showError('Error saving usecase');
  }
}

async function deleteUsecase(id) {
  const item = usecasesData.find(u => u.id === id);
  if (!item) return;
  
  const confirmed = await confirmDialog(
    `คุณต้องการลบ "${item.service_name}" ใช่หรือไม่?`,
    'ลบ MA Usecase'
  );
  
  if (!confirmed) return;
  
  try {
    const response = await API.post('/ma-services/delete.php', { id });
    const result = response && response.data;

    if (result && result.success) {
      await logActivity('delete', 'usecase', id, item.service_name,
        `${item.service_type} - ${item.tool_type}`);

      Toast.success('Usecase deleted');
      loadUsecases();
    } else {
      Toast.error((result && result.message) || 'Failed to delete usecase');
    }
  } catch (error) {
    console.error('Error deleting usecase:', error);
    Toast.error('Error deleting usecase');
  }
}

// ═══════════════════════════════════════════════════
// CUTOFF CRUD
// ═══════════════════════════════════════════════════

function openAddCutoff() {
  currentEditId = null;
  cutoffImages = [];
  document.getElementById('modal-cutoff-title').textContent = 'Add Cut-off Service';
  document.getElementById('form-cutoff').reset();
  document.getElementById('cutoff-image-preview').innerHTML = '';
  document.getElementById('cutoff-bank-group').style.display = 'none';
  document.getElementById('cutoff-comcode-group').style.display = 'none';
  document.getElementById('cutoff-bank-fields').style.display = 'none';
  openModal('modal-cutoff');
}

function editCutoff(id) {
  const item = cutoffsData.find(c => c.id === id);
  if (!item) return;
  
  currentEditId = id;
  cutoffImages = item.images ? [...item.images] : [];
  
  document.getElementById('modal-cutoff-title').textContent = 'Edit Cut-off Service';
  document.getElementById('cutoff-id').value = item.id;
  document.getElementById('cutoff-site-type').value = item.site_type;
  document.getElementById('cutoff-service-name').value = item.service_name;
  document.getElementById('cutoff-bank-name').value = item.bank_name || '';
  document.getElementById('cutoff-comcode').value = item.comcode || '';
  document.getElementById('cutoff-time').value = item.cutoff_time;
  document.getElementById('cutoff-day').value = item.cutoff_day;
  document.getElementById('cutoff-service-group').value = item.service_group || '';
  document.getElementById('cutoff-channel').value = item.channel || '';
  document.getElementById('cutoff-ma-page').value = item.ma_page || '';
  document.getElementById('cutoff-tmn-cert').value = item.tmn_certificate || '';
  document.getElementById('cutoff-bank-cert').value = item.bank_certificate || '';
  document.getElementById('cutoff-remark').value = item.remark || '';
  
  renderCutoffImagePreview();
  toggleBankFields();
  openModal('modal-cutoff');
}

function toggleBankFields() {
  const siteType = document.getElementById('cutoff-site-type').value;
  const isBank = siteType === 'Bank';
  
  document.getElementById('cutoff-bank-group').style.display = isBank ? 'block' : 'none';
  document.getElementById('cutoff-comcode-group').style.display = isBank ? 'block' : 'none';
  document.getElementById('cutoff-bank-fields').style.display = isBank ? 'block' : 'none';
}

async function saveCutoff() {
  const form = document.getElementById('form-cutoff');
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }
  
  const data = {
    site_type: document.getElementById('cutoff-site-type').value,
    service_name: document.getElementById('cutoff-service-name').value,
    bank_name: document.getElementById('cutoff-bank-name').value,
    comcode: document.getElementById('cutoff-comcode').value,
    cutoff_time: document.getElementById('cutoff-time').value,
    cutoff_day: document.getElementById('cutoff-day').value,
    service_group: document.getElementById('cutoff-service-group').value,
    channel: document.getElementById('cutoff-channel').value,
    ma_page: document.getElementById('cutoff-ma-page').value,
    tmn_certificate: document.getElementById('cutoff-tmn-cert').value,
    bank_certificate: document.getElementById('cutoff-bank-cert').value,
    remark: document.getElementById('cutoff-remark').value,
    images: cutoffImages
  };
  
  try {
    const path = currentEditId
      ? '/cutoff-services/update.php'
      : '/cutoff-services/create.php';

    if (currentEditId) {
      data.id = currentEditId;
    }

    const response = await API.post(path, data);
    const result = response && response.data;

    if (result && result.success) {
      const action = currentEditId ? 'update' : 'create';
      const itemName = data.service_name;
      const itemId = result.id || currentEditId;
      await logActivity(action, 'cutoff', itemId, itemName,
        `${data.site_type} - ${data.cutoff_time}`);

      Toast.success(currentEditId ? 'Cut-off updated' : 'Cut-off created');
      closeModal('modal-cutoff');
      cutoffImages = [];
      loadCutoffs();
    } else {
      showError((result && result.message) || 'Failed to save cut-off');
    }
  } catch (error) {
    console.error('Error saving cut-off:', error);
    showError('Error saving cut-off');
  }
}

async function deleteCutoff(id) {
  const item = cutoffsData.find(c => c.id === id);
  if (!item) return;
  
  const confirmed = await confirmDialog(
    `คุณต้องการลบ "${item.service_name}" ใช่หรือไม่?`,
    'ลบ Cut-off Service'
  );
  
  if (!confirmed) return;
  
  try {
    const response = await API.post('/cutoff-services/delete.php', { id });
    const result = response && response.data;

    if (result && result.success) {
      await logActivity('delete', 'cutoff', id, item.service_name,
        `${item.site_type} - ${item.cutoff_time}`);

      Toast.success('Cut-off deleted');
      loadCutoffs();
    } else {
      Toast.error((result && result.message) || 'Failed to delete cut-off');
    }
  } catch (error) {
    console.error('Error deleting cut-off:', error);
    Toast.error('Error deleting cut-off');
  }
}

// ═══════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════

function getBadgeClass(toolType) {
  const map = {
    'Jenkins': 'jenkins',
    'Admin Portal': 'admin-portal',
    'Rundeck': 'rundeck',
    'Kims Portal': 'kims-portal',
    '3rd Party': 'third-party'
  };
  return map[toolType] || 'jenkins';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/'/g, '&#39;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Rewrite Grafana URL to same-origin reverse proxy + attach JWT so the
// iframe doesn't hit Grafana's login page (mirrors monitoring.html).
const GRAFANA_PROXY = {
  origin: '',
  prefix: '',
  upstream: 'https://grafana-thanos.truemoney.com',
};

function rewriteGrafanaUrl(url) {
  if (!url || !url.startsWith(GRAFANA_PROXY.upstream)) return url;
  const tail = url.slice(GRAFANA_PROXY.upstream.length);
  const token = (typeof Auth !== 'undefined' && Auth.getToken) ? Auth.getToken() : null;
  const sep = tail.includes('?') ? '&' : '?';
  const auth = token ? `${sep}token=${encodeURIComponent(token)}` : '';
  return GRAFANA_PROXY.origin + GRAFANA_PROXY.prefix + tail + auth;
}

function openGrafanaPopup(url, title) {
  if (!url) return;
  const modal = document.getElementById('grafana-modal');
  const frame = document.getElementById('grafana-frame');
  const titleEl = document.getElementById('grafana-title');
  const openTab = document.getElementById('grafana-open-tab');
  if (!modal || !frame) return;
  titleEl.textContent = title ? `Grafana — ${title}` : 'Grafana';
  openTab.href = url;
  frame.src = rewriteGrafanaUrl(url);
  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeGrafanaPopup() {
  const modal = document.getElementById('grafana-modal');
  const frame = document.getElementById('grafana-frame');
  if (!modal) return;
  modal.classList.remove('active');
  if (frame) frame.src = 'about:blank';
  document.body.style.overflow = '';
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const gm = document.getElementById('grafana-modal');
    if (gm && gm.classList.contains('active')) closeGrafanaPopup();
  }
});

function openModal(modalId) {
  document.getElementById(modalId).classList.add('active');
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('active');
}

function showSuccess(message) {
  if (typeof Toast !== 'undefined' && Toast.success) {
    Toast.success(message);
  } else {
    SOMDialog.alert(message, { title: 'สำเร็จ', icon: 'success' });
  }
}

function showError(message) {
  if (typeof Toast !== 'undefined' && Toast.error) {
    Toast.error(message);
  } else {
    SOMDialog.alert(message, { title: 'เกิดข้อผิดพลาด', icon: 'danger' });
  }
}

function showToast(message, type = 'info') {
  if (typeof Toast !== 'undefined' && Toast[type]) {
    Toast[type](message);
  } else {
    SOMDialog.alert(message, { title: 'แจ้งเตือน', icon: type === 'error' ? 'danger' : type === 'success' ? 'success' : 'info' });
  }
}

// ═══════════════════════════════════════════════════
// IMAGE MANAGEMENT
// ═══════════════════════════════════════════════════

async function logActivity(action, type, itemId, itemName, details = '') {
  try {
    // Map actions to standardized format
    const actionMap = {
      'create': `ma_${type}_create`,
      'update': `ma_${type}_update`,
      'delete': `ma_${type}_delete`
    };
    
    const logAction = actionMap[action] || `ma_${type}_${action}`;

    await API.post('/log/create.php', {
      action: logAction,
      detail: {
        type: type,
        item_id: itemId,
        item_name: itemName,
        details: details
      }
    });
  } catch (error) {
    console.error('Error logging activity:', error);
  }
}

function handleUsecaseImageUpload(event) {
  const files = Array.from(event.target.files);
  const preview = document.getElementById('usecase-image-preview');
  
  files.forEach(file => {
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        usecaseImages.push(e.target.result);
        renderUsecaseImagePreview();
      };
      reader.readAsDataURL(file);
    }
  });
}

function handleCutoffImageUpload(event) {
  const files = Array.from(event.target.files);
  const preview = document.getElementById('cutoff-image-preview');
  
  files.forEach(file => {
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        cutoffImages.push(e.target.result);
        renderCutoffImagePreview();
      };
      reader.readAsDataURL(file);
    }
  });
}

function renderUsecaseImagePreview() {
  const preview = document.getElementById('usecase-image-preview');
  preview.innerHTML = usecaseImages.map((img, index) => `
    <div class="ma-image-preview-item">
      <img src="${img}" alt="Preview ${index + 1}">
      <button class="ma-image-preview-remove" onclick="removeUsecaseImage(${index})">×</button>
    </div>
  `).join('');
}

function renderCutoffImagePreview() {
  const preview = document.getElementById('cutoff-image-preview');
  preview.innerHTML = cutoffImages.map((img, index) => `
    <div class="ma-image-preview-item">
      <img src="${img}" alt="Preview ${index + 1}">
      <button class="ma-image-preview-remove" onclick="removeCutoffImage(${index})">×</button>
    </div>
  `).join('');
}

function removeUsecaseImage(index) {
  usecaseImages.splice(index, 1);
  renderUsecaseImagePreview();
}

function removeCutoffImage(index) {
  cutoffImages.splice(index, 1);
  renderCutoffImagePreview();
}

function viewImages(type, id, serviceName) {
  const data = type === 'usecase' ? usecasesData : cutoffsData;
  const item = data.find(d => d.id === id);
  
  if (!item) return;
  
  const images = item.images || [];
  const modal = document.getElementById('gallery-modal');
  const grid = document.getElementById('gallery-grid');
  const title = document.getElementById('gallery-title');
  
  title.textContent = `Images: ${serviceName}`;
  
  if (images.length === 0) {
    grid.innerHTML = `
      <div class="ma-gallery-empty">
        <i>📷</i>
        <p>No images available</p>
      </div>
    `;
  } else {
    grid.innerHTML = images.map((img, index) => `
      <div class="ma-gallery-item" onclick="openLightbox('${img}')">
        <img src="${img}" alt="Image ${index + 1}">
      </div>
    `).join('');
  }
  
  modal.classList.add('active');
}

function closeGallery() {
  document.getElementById('gallery-modal').classList.remove('active');
}

function openLightbox(imageSrc) {
  const lightbox = document.getElementById('lightbox');
  const img = document.getElementById('lightbox-image');
  img.src = imageSrc;
  lightbox.classList.add('active');
}

function closeLightbox() {
  document.getElementById('lightbox').classList.remove('active');
}

// ═══════════════════════════════════════════════════
// PASTE & DRAG-AND-DROP IMAGE SUPPORT
// ═══════════════════════════════════════════════════

function _activeImageModal() {
  if (document.getElementById('modal-usecase')?.classList.contains('active')) return 'usecase';
  if (document.getElementById('modal-cutoff')?.classList.contains('active'))  return 'cutoff';
  return null;
}

function _addFilesToModal(files, modal) {
  Array.from(files)
    .filter(f => f.type.startsWith('image/'))
    .forEach(file => {
      const reader = new FileReader();
      reader.onload = e => {
        if (modal === 'usecase') { usecaseImages.push(e.target.result); renderUsecaseImagePreview(); }
        else                     { cutoffImages.push(e.target.result);  renderCutoffImagePreview(); }
      };
      reader.readAsDataURL(file);
    });
}

document.addEventListener('paste', ev => {
  const modal = _activeImageModal();
  if (!modal) return;
  const t = ev.target;
  if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
  const files = [];
  for (const it of (ev.clipboardData?.items || [])) {
    if (it.kind === 'file' && it.type?.startsWith('image/')) {
      const f = it.getAsFile();
      if (f) files.push(f);
    }
  }
  if (!files.length) return;
  ev.preventDefault();
  _addFilesToModal(files, modal);
});

function _initMaUploadZones() {
  [
    { id: 'usecase-upload-zone', type: 'usecase' },
    { id: 'cutoff-upload-zone',  type: 'cutoff'  },
  ].forEach(({ id, type }) => {
    const zone = document.getElementById(id);
    if (!zone) return;
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('is-drag'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('is-drag'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('is-drag');
      _addFilesToModal(e.dataTransfer.files, type);
    });
  });
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initMaUploadZones, { once: true });
} else {
  _initMaUploadZones();
}

// ═══════════════════════════════════════════════════
// BACKOFFICE USE-CASE PICKER
// Searchable dropdown that lists all Admin Portal use cases
// (type='use_case' only) from /api/ma-status?source=tmn_backoffice.
// Cached per session; refresh happens next full page load.
// ═══════════════════════════════════════════════════
let _boCases = null;         // cached array: [{id, name, status}]
let _boCasesLoading = null;  // in-flight promise

// Show the Admin Portal Use Case picker only when tool_type is 'Admin Portal'.
// Other tools (Jenkins, Rundeck, etc.) don't have a use_case_id concept.
function toggleBoPickerVisibility(toolType) {
  const bo = document.getElementById('usecase-backoffice-group');
  const jk = document.getElementById('usecase-jenkins-group');
  if (bo) {
    const showBo = toolType === 'Admin Portal';
    bo.style.display = showBo ? '' : 'none';
    if (!showBo) resetBoPicker();
    else if (!_boCases) loadBoCases();
  }
  if (jk) {
    const showJk = toolType === 'Jenkins';
    jk.style.display = showJk ? '' : 'none';
    if (showJk) loadJenkinsServers();
  }
}

function _initMaToolTypeSel() {
  const sel = document.getElementById('usecase-tool-type');
  if (sel) sel.addEventListener('change', (e) => toggleBoPickerVisibility(e.target.value));
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initMaToolTypeSel, { once: true });
} else {
  _initMaToolTypeSel();
}

async function loadBoCases() {
  if (_boCases) return _boCases;
  if (_boCasesLoading) return _boCasesLoading;
  const search = document.getElementById('bo-picker-search');
  if (search) search.placeholder = 'กำลังโหลดรายชื่อ...';
  _boCasesLoading = (async () => {
    try {
      const resp = await API.get('/ma-status/?source=tmn_backoffice');
      const items = (resp && resp.data && resp.data.data && resp.data.data.sources
                   && resp.data.data.sources.tmn_backoffice
                   && resp.data.data.sources.tmn_backoffice.items) || [];
      _boCases = items
        .filter(it => it.category === 'use_case' && it.use_case_id)
        .map(it => ({ id: Number(it.use_case_id), name: it.label || '', status: it.status || '' }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
      console.error('loadBoCases failed:', e);
      _boCases = [];
    } finally {
      if (search) search.placeholder = 'พิมพ์ค้นหาชื่อ use case หรือ id...';
      _boCasesLoading = null;
    }
    return _boCases;
  })();
  return _boCasesLoading;
}

function resetBoPicker() {
  const hid = document.getElementById('usecase-backoffice-id');
  const sea = document.getElementById('bo-picker-search');
  const sel = document.getElementById('bo-picker-selected');
  const dd  = document.getElementById('bo-picker-dropdown');
  if (hid) hid.value = '';
  if (sea) sea.value = '';
  if (sel) sel.innerHTML = '<em>ยังไม่ผูก use case</em>';
  if (dd)  dd.style.display = 'none';
}

function setBoPicker(id) {
  const list = _boCases || [];
  const hit  = list.find(x => x.id === Number(id));
  const hid  = document.getElementById('usecase-backoffice-id');
  const sel  = document.getElementById('bo-picker-selected');
  hid.value = Number(id);
  if (hit) {
    sel.innerHTML = `ผูกกับ: <strong>[${hit.id}] ${escapeHtml(hit.name)}</strong>`;
  } else {
    sel.innerHTML = `ผูกกับ use_case_id=<strong>${Number(id)}</strong> <span style="color:var(--warning)">(ไม่พบใน Admin Portal)</span>`;
  }
}

function clearBoPicker() {
  document.getElementById('usecase-backoffice-id').value = '';
  document.getElementById('bo-picker-search').value = '';
  document.getElementById('bo-picker-selected').innerHTML = '<em>ยังไม่ผูก use case</em>';
  document.getElementById('bo-picker-dropdown').style.display = 'none';
}

async function openBoPicker() {
  await loadBoCases();
  renderBoPickerOptions(document.getElementById('bo-picker-search').value);
}

function renderBoPickerOptions(query) {
  const dd = document.getElementById('bo-picker-dropdown');
  const list = _boCases || [];
  const q = (query || '').trim().toLowerCase();
  const matches = q
    ? list.filter(x => x.name.toLowerCase().includes(q) || String(x.id).includes(q))
    : list;
  if (!matches.length) {
    dd.innerHTML = `<div style="padding:12px;color:var(--text-muted);font-size:12px">ไม่พบ use case ที่ตรงกัน</div>`;
    dd.style.display = 'block';
    return;
  }
  dd.innerHTML = matches.slice(0, 200).map(x => {
    const pill = x.status === 'closed'
      ? `<span style="font-size:9px;font-weight:700;padding:1px 6px;border-radius:999px;background:rgba(220,53,69,.12);color:var(--danger)">MA ON</span>`
      : x.status === 'open'
      ? `<span style="font-size:9px;font-weight:700;padding:1px 6px;border-radius:999px;background:rgba(40,167,69,.12);color:var(--success)">OK</span>`
      : '';
    return `<div class="bo-opt" data-id="${x.id}"
                onclick="pickBoOption(${x.id})"
                style="padding:8px 10px;cursor:pointer;display:flex;justify-content:space-between;
                       align-items:center;gap:8px;border-bottom:1px solid var(--border);font-size:12px"
                onmouseover="this.style.background='var(--bg-muted, rgba(0,0,0,.04))'"
                onmouseout="this.style.background=''">
              <span><span style="color:var(--text-muted);font-family:monospace">[${x.id}]</span> ${escapeHtml(x.name)}</span>
              ${pill}
            </div>`;
  }).join('') + (matches.length > 200
    ? `<div style="padding:8px 10px;font-size:11px;color:var(--text-muted);text-align:center">...แสดง 200 จาก ${matches.length} — พิมพ์ค้นหาเพื่อกรอง</div>`
    : '');
  dd.style.display = 'block';
}

function pickBoOption(id) {
  setBoPicker(id);
  document.getElementById('bo-picker-dropdown').style.display = 'none';
  document.getElementById('bo-picker-search').value = '';
}

// Close dropdown on outside click
document.addEventListener('click', (e) => {
  const picker = e.target.closest('.bo-picker');
  if (!picker) {
    const dd = document.getElementById('bo-picker-dropdown');
    if (dd) dd.style.display = 'none';
  }
});

// ═══════════════════════════════════════════════════
// JENKINS INTEGRATION
// server list cache, form population, build modal w/ live progress
// ═══════════════════════════════════════════════════
let _jenkinsServers = null;
let _jenkinsServersLoading = null;

async function loadJenkinsServers() {
  if (_jenkinsServers) return _jenkinsServers;
  if (_jenkinsServersLoading) return _jenkinsServersLoading;
  _jenkinsServersLoading = (async () => {
    try {
      const resp = await API.get('/jenkins-proxy/index.php?list=1');
      const list = (resp && resp.data && resp.data.data) || [];
      _jenkinsServers = Array.isArray(list) ? list : [];
    } catch (e) {
      console.error('loadJenkinsServers:', e);
      _jenkinsServers = [];
    } finally {
      _jenkinsServersLoading = null;
    }
    const sel = document.getElementById('usecase-jenkins-server');
    if (sel) {
      const current = sel.value;
      sel.innerHTML = '<option value="">Select server...</option>' +
        _jenkinsServers.map(s => `<option value="${escapeAttr(s.id)}">${escapeHtml(s.display || s.id)}</option>`).join('');
      if (current) sel.value = current;
    }
    return _jenkinsServers;
  })();
  return _jenkinsServersLoading;
}

function renderJenkinsControlCell(item) {
  if (!item.jenkins_server_id || !item.jenkins_job_path) {
    return `<span style="font-size:10.5px;color:var(--text-muted)" title="ยังไม่ตั้งค่า Jenkins server หรือ job path">unlinked</span>`;
  }
  const canRun = _canToggleMa();
  const lastLine = item.last_jenkins_by_name
    ? `<div style="font-size:10px;color:var(--text-muted);margin-top:3px">
         last: ${escapeHtml(item.last_jenkins_by_name)} · ${_maRelTime(item.last_jenkins_at)}
       </div>`
    : '';
  if (!canRun) {
    return `<div>
              <span style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:5px;background:#e0e7ff;color:#3730a3;font-size:11px;font-weight:700;border:1.5px solid #6366f1">
                Jenkins Job
              </span>
              ${lastLine}
              <div style="font-size:10px;color:var(--text-muted);margin-top:3px">(view-only — เฉพาะทีม SM)</div>
            </div>`;
  }
  return `<div>
            <button type="button" class="ma-toggle-primary" style="color:#3730a3;border-color:#6366f1"
                    onclick="openJenkinsBuild(${item.id})"
                    onmouseover="this.style.background='#6366f1';this.style.color='#fff'"
                    onmouseout="this.style.background='#fff';this.style.color='#3730a3'"
                    title="Build Jenkins job">
              ▶ Build Job
            </button>
            ${lastLine}
          </div>`;
}

let _jbState = null;   // { serviceId, server, jobPath, buildNumber, queuePath, timer, params }

async function openJenkinsBuild(id) {
  const item = usecasesData.find(u => u.id === id);
  if (!item) return;
  if (!item.jenkins_server_id || !item.jenkins_job_path) {
    Toast.error('ยังไม่ตั้งค่า Jenkins server หรือ job path'); return;
  }
  if (!_canToggleMa()) { Toast.error('เฉพาะทีม SM'); return; }

  _jbState = { serviceId: id, server: item.jenkins_server_id, jobPath: item.jenkins_job_path,
               buildNumber: null, queuePath: null, timer: null, params: {}, item };

  document.getElementById('jb-title').textContent = 'Build — ' + item.service_name;
  document.getElementById('jb-summary').innerHTML = `
    <div style="padding:10px 12px;border-radius:8px;background:var(--bg-muted,rgba(0,0,0,.03));border:1px solid var(--border)">
      <div style="font-weight:700;font-size:13px">${escapeHtml(item.service_name)}</div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:2px;font-family:monospace">
        ${escapeHtml(item.jenkins_server_id)} : ${escapeHtml(item.jenkins_job_path)}
      </div>
    </div>`;
  document.getElementById('jb-params').innerHTML = `<div style="color:var(--text-muted);font-size:12px">Loading job parameters...</div>`;
  document.getElementById('jb-params-view').style.display = '';
  document.getElementById('jb-progress-view').style.display = 'none';
  document.getElementById('jb-run-btn').style.display = '';
  document.getElementById('jb-run-btn').disabled = true;
  document.getElementById('jb-cancel-btn').textContent = 'Cancel';
  openModal('modal-jenkins-build');

  try {
    const resp = await API.get(`/ma-services/jenkins-params.php?service_id=${id}`);
    if (!resp || !resp.data || !resp.data.success) {
      throw new Error((resp && resp.data && resp.data.message) || 'Failed to load params');
    }
    _renderJenkinsParams(resp.data.data.params || [], resp.data.data.description || '');
    document.getElementById('jb-run-btn').disabled = false;
  } catch (err) {
    document.getElementById('jb-params').innerHTML =
      `<div style="color:var(--danger);font-size:12px;padding:12px;background:#fee2e2;border-radius:6px">
         โหลด parameters ล้มเหลว: ${escapeHtml(err.message || String(err))}
         <div style="margin-top:6px;font-size:11px;color:var(--text-muted)">ตรวจว่า server_id/job_path ถูกต้อง และ Jenkins ตอบสนอง</div>
       </div>`;
  }
}

function _renderJenkinsParams(params, description) {
  const wrap = document.getElementById('jb-params');
  if (!params.length) {
    wrap.innerHTML = `<div style="color:var(--text-muted);font-size:12px;padding:10px;background:var(--bg-muted,rgba(0,0,0,.03));border-radius:6px">
      Job นี้ไม่มี parameters — กด "Run Build" เพื่อเริ่ม
      ${description ? '<div style="margin-top:8px;font-size:11px">' + escapeHtml(description) + '</div>' : ''}
    </div>`;
    return;
  }
  wrap.innerHTML =
    (description ? `<div style="font-size:11px;color:var(--text-muted);padding:6px 10px;background:var(--bg-muted,rgba(0,0,0,.03));border-radius:5px;margin-bottom:6px">${escapeHtml(description)}</div>` : '') +
    params.map((p, i) => {
      const id = `jb-p-${i}`;
      const desc = p.description ? `<small>${escapeHtml(p.description)}</small>` : '';
      const type = String(p.type || '').toLowerCase();
      if (type.includes('boolean')) {
        const checked = (p.default === true || p.default === 'true') ? 'checked' : '';
        return `<div class="jb-param-row bool">
                  <label><input type="checkbox" id="${id}" data-pname="${escapeAttr(p.name)}" ${checked}> <strong>${escapeHtml(p.name)}</strong></label>
                  ${desc}
                </div>`;
      }
      if (type.includes('choice') && Array.isArray(p.choices) && p.choices.length) {
        const opts = p.choices.map(c => `<option value="${escapeAttr(String(c))}" ${String(c) === String(p.default) ? 'selected' : ''}>${escapeHtml(String(c))}</option>`).join('');
        return `<div class="jb-param-row">
                  <label for="${id}">${escapeHtml(p.name)}</label>
                  <select id="${id}" data-pname="${escapeAttr(p.name)}">${opts}</select>
                  ${desc}
                </div>`;
      }
      if (type.includes('text')) {
        return `<div class="jb-param-row">
                  <label for="${id}">${escapeHtml(p.name)}</label>
                  <textarea id="${id}" data-pname="${escapeAttr(p.name)}" rows="3">${escapeHtml(String(p.default ?? ''))}</textarea>
                  ${desc}
                </div>`;
      }
      if (type.includes('password')) {
        return `<div class="jb-param-row">
                  <label for="${id}">${escapeHtml(p.name)}</label>
                  <input type="password" id="${id}" data-pname="${escapeAttr(p.name)}" value="${escapeAttr(String(p.default ?? ''))}">
                  ${desc}
                </div>`;
      }
      // Default = string
      return `<div class="jb-param-row">
                <label for="${id}">${escapeHtml(p.name)}</label>
                <input type="text" id="${id}" data-pname="${escapeAttr(p.name)}" value="${escapeAttr(String(p.default ?? ''))}">
                ${desc}
              </div>`;
    }).join('');
}

function _collectJenkinsParams() {
  const out = {};
  document.querySelectorAll('#jb-params [data-pname]').forEach(el => {
    const name = el.getAttribute('data-pname');
    if (el.type === 'checkbox') out[name] = el.checked ? 'true' : 'false';
    else                        out[name] = el.value;
  });
  return out;
}

async function runJenkinsBuild() {
  if (!_jbState) return;
  const params = _collectJenkinsParams();
  _jbState.params = params;

  const runBtn = document.getElementById('jb-run-btn');
  runBtn.disabled = true;
  runBtn.textContent = 'Queueing...';

  try {
    const resp = await API.post('/ma-services/jenkins-trigger.php', {
      service_id: _jbState.serviceId,
      params
    });
    const result = resp && resp.data;
    if (!result || !result.success) throw new Error((result && result.message) || 'Trigger failed');

    _jbState.queuePath = result.data.queue_path || '';
    _jbState.server    = result.data.server;
    _jbState.jobPath   = result.data.job_path;

    // Switch to progress view
    document.getElementById('jb-params-view').style.display = 'none';
    document.getElementById('jb-progress-view').style.display = '';
    document.getElementById('jb-run-btn').style.display = 'none';
    document.getElementById('jb-cancel-btn').textContent = 'Close';
    _jbSetPhase('queued', 'Queued — waiting for executor...');

    // Kick off polling
    _jbState.timer = setInterval(pollJenkinsStatus, 1500);
    pollJenkinsStatus(); // fire immediately
  } catch (err) {
    Toast.error('Trigger failed: ' + (err.message || err));
    runBtn.disabled = false;
    runBtn.textContent = '▶ Run Build';
  }
}

async function pollJenkinsStatus() {
  if (!_jbState) return;
  const qs = new URLSearchParams();
  qs.set('server', _jbState.server);
  if (_jbState.buildNumber) {
    qs.set('job',   _jbState.jobPath);
    qs.set('build', _jbState.buildNumber);
  } else if (_jbState.queuePath) {
    qs.set('queue', _jbState.queuePath);
  } else {
    return;
  }
  let resp;
  try { resp = await API.get('/ma-services/jenkins-status.php?' + qs.toString()); }
  catch (e) { return; }
  const r = resp && resp.data;
  if (!r || !r.success) return;
  const s = r.data;

  if (s.phase === 'queued') {
    const why = s.queue && s.queue.why ? s.queue.why : 'waiting...';
    _jbSetPhase('queued', 'Queued — ' + why);
    _jbSetProgress(0);
    document.getElementById('jb-elapsed').textContent = 'waiting in queue';
    return;
  }
  if (s.phase === 'building') {
    if (s.build && s.build.number) _jbState.buildNumber = s.build.number;
    if (s.build && s.build.job_path) _jbState.jobPath   = s.build.job_path;
    _jbSetPhase('building', `Building #${s.build.number}...`);
    _jbSetProgress(s.build.percent || 0);
    document.getElementById('jb-elapsed').textContent =
      `${_fmtMs(s.build.elapsed)} / est ${_fmtMs(s.build.estimated)}`;
    document.getElementById('jb-percent').textContent = (s.build.percent || 0) + '%';
    return;
  }
  if (s.phase === 'done') {
    _jbStopPolling();
    if (s.queue && s.queue.cancelled) {
      _jbSetPhase('failure', 'Cancelled in queue');
      _jbSetProgress(100, 'is-failure');
      return;
    }
    const result = (s.build && s.build.result) || '';
    const isOk = result === 'SUCCESS';
    _jbSetPhase(isOk ? 'done' : 'failure', isOk ? `✓ SUCCESS — build #${s.build.number}` : `✗ ${result || 'FAILED'} — build #${s.build.number}`);
    _jbSetProgress(100, isOk ? 'is-done' : 'is-failure');
    document.getElementById('jb-elapsed').textContent = `duration ${_fmtMs(s.build.duration)}`;
    document.getElementById('jb-percent').textContent = '100%';
    const buildLink = s.build.url
      ? `<a href="${escapeAttr(s.build.url)}console" target="_blank" rel="noopener" style="color:var(--primary);text-decoration:underline">▶ Open console log</a>`
      : '';
    document.getElementById('jb-detail').innerHTML = buildLink;
    // refresh the row so last_jenkins_at shows
    loadUsecases();
  }
}

function _jbStopPolling() {
  if (_jbState && _jbState.timer) { clearInterval(_jbState.timer); _jbState.timer = null; }
}

function _jbSetPhase(phase, label) {
  document.getElementById('jb-phase-label').textContent = label;
}

function _jbSetProgress(pct, extraClass) {
  const fill = document.getElementById('jb-progress-fill');
  fill.className = 'jb-progress-fill' + (extraClass ? ' ' + extraClass : (pct < 5 ? ' is-queued' : ''));
  fill.style.width = Math.max(3, Math.min(100, pct)) + '%';
}

function _fmtMs(ms) {
  if (!ms) return '0s';
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60), r = s % 60;
  return `${m}m ${r}s`;
}

function closeJenkinsModal() {
  _jbStopPolling();
  _jbState = null;
  closeModal('modal-jenkins-build');
}

// ═══════════════════════════════════════════════════
// BACKOFFICE FULL EDIT MODAL (clone of Admin Portal Edit)
// ═══════════════════════════════════════════════════
let _boEdit = null;   // { serviceId, useCaseId, name, type, maEnable, msgTh, msgEn,
                      //   enable: [{property_id, application, key, value}],
                      //   msgThProps: [...], msgEnProps: [...],
                      //   appList: [{application_name, properties: [...]}] }
let _boPickerTarget = null;   // 'enable' | 'msg_th' | 'msg_en'

async function openBoEditModal(serviceId) {
  const item = usecasesData.find(u => u.id === serviceId);
  if (!item) return;
  // If _boCases hasn't loaded yet, wait briefly so resolveBoUseCase can
  // find the auto-match. Prevents "no use_case_id" errors right after page open.
  if (!_boCases) {
    document.getElementById('bo-edit-title').textContent = 'Loading...';
    openModal('modal-bo-edit');
    document.getElementById('bo-edit-loading').style.display = '';
    document.getElementById('bo-edit-form').style.display = 'none';
    document.getElementById('bo-edit-loading').textContent = 'กำลังรอ Admin Portal (ครั้งแรกอาจนานเล็กน้อย)...';
    try { await loadBoCases(); } catch (e) {}
  }
  const resolved = resolveBoUseCase(item);
  if (!resolved) {
    Toast.error('ไม่พบ use_case_id ที่ผูกและไม่ match ชื่อกับ Admin Portal');
    closeBoEditModal();
    return;
  }

  document.getElementById('bo-edit-title').textContent = 'Edit Use Case — ' + item.service_name;
  document.getElementById('bo-edit-loading').style.display = '';
  document.getElementById('bo-edit-loading').textContent = 'กำลังโหลด...';
  document.getElementById('bo-edit-form').style.display = 'none';
  openModal('modal-bo-edit');

  // Retry once on transient failure (401/network) — same pattern as _loadBoCasesWithRetry
  const _fetchOnce = () => API.get(`/ma-services/backoffice-get.php?use_case_id=${resolved.id}`);
  try {
    let resp = await _fetchOnce();
    if (!resp || !resp.data || !resp.data.success) {
      // Brief wait + one retry (handles cold auth / CSRF race)
      await new Promise(r => setTimeout(r, 800));
      resp = await _fetchOnce();
    }
    if (!resp || !resp.data || !resp.data.success) {
      throw new Error((resp && resp.data && resp.data.message) || 'Fetch failed');
    }
    const d = resp.data.data;
    _boEdit = {
      serviceId,
      useCaseId:  d.use_case_id,
      name:       d.use_case_name || '',
      type:       d.use_case_type || 'use_case',
      maEnable:   !!d.ma_enable,
      msgTh:      d.ma_message_th || '',
      msgEn:      d.ma_message_en || '',
      enable:     d.ma_enable_properties || [],
      msgThProps: d.ma_message_th_properties || [],
      msgEnProps: d.ma_message_en_properties || [],
      appList:    d.application_list || [],
      meta: {
        updated_at: d.updated_at || '',
        updated_by: d.updated_by || '',
      },
    };
    _renderBoEditForm();
    document.getElementById('bo-edit-loading').style.display = 'none';
    document.getElementById('bo-edit-form').style.display = '';
  } catch (err) {
    document.getElementById('bo-edit-loading').innerHTML =
      `<div style="color:var(--danger);padding:20px">โหลด use case ล้มเหลว: ${escapeHtml(err.message || String(err))}</div>`;
  }
}

function _renderBoEditForm() {
  const e = _boEdit;
  document.getElementById('bo-edit-name').value   = e.name;
  document.getElementById('bo-edit-msg-th').value = e.msgTh;
  document.getElementById('bo-edit-msg-en').value = e.msgEn;
  _renderBoToggle();
  _renderBoPropTable('enable',  e.enable,     'bo-enable-tbl');
  _renderBoPropTable('msg_th',  e.msgThProps, 'bo-msg-th-tbl');
  _renderBoPropTable('msg_en',  e.msgEnProps, 'bo-msg-en-tbl');
  document.getElementById('bo-edit-meta').textContent =
    `use_case_id=${e.useCaseId} · type=${e.type} · last updated ${e.meta.updated_at || '—'} by ${e.meta.updated_by || '—'}`;
}

function _renderBoToggle() {
  const av = document.getElementById('bo-status-available');
  const mt = document.getElementById('bo-status-maintenance');
  av.classList.toggle('is-active', !_boEdit.maEnable);
  mt.classList.toggle('is-active',  _boEdit.maEnable);
}

function setBoMaEnable(v) {
  if (!_boEdit) return;
  _boEdit.maEnable = !!v;
  _renderBoToggle();
}

function _renderBoPropTable(kind, props, tblId) {
  const tbody = document.querySelector(`#${tblId} tbody`);
  if (!props.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:10px;font-size:11px">no property</td></tr>`;
    return;
  }
  tbody.innerHTML = props.map((p, i) => `
    <tr>
      <td>${escapeHtml(p.application || '')}</td>
      <td class="mono">${escapeHtml(p.property_key || '')}</td>
      <td class="mono">${escapeHtml(String(p.property_value || ''))}</td>
      <td style="text-align:center"><button type="button" class="del-btn" onclick="removeBoProp('${kind}', ${i})" title="ลบ">×</button></td>
    </tr>`).join('');
}

function removeBoProp(kind, idx) {
  if (!_boEdit) return;
  const key = kind === 'enable' ? 'enable' : (kind === 'msg_th' ? 'msgThProps' : 'msgEnProps');
  _boEdit[key].splice(idx, 1);
  _renderBoPropTable(kind, _boEdit[key], kind === 'enable' ? 'bo-enable-tbl' : (kind === 'msg_th' ? 'bo-msg-th-tbl' : 'bo-msg-en-tbl'));
}

function openBoPropPicker(target) {
  _boPickerTarget = target;
  document.getElementById('bo-prop-search').value = '';
  renderBoPropPickerList();
  openModal('modal-bo-prop-picker');
  setTimeout(() => document.getElementById('bo-prop-search').focus(), 60);
}

function closeBoPropPicker() {
  _boPickerTarget = null;
  closeModal('modal-bo-prop-picker');
}

function renderBoPropPickerList() {
  const q = (document.getElementById('bo-prop-search').value || '').trim().toLowerCase();
  const box = document.getElementById('bo-prop-picker-list');
  const appList = (_boEdit && _boEdit.appList) || [];
  const flat = [];
  for (const app of appList) {
    for (const p of (app.properties || [])) flat.push(p);
  }
  const alreadyIds = new Set(_boCurrentTargetProps().map(x => x.property_id));
  const matches = flat.filter(p => {
    if (alreadyIds.has(p.property_id)) return false;
    if (!q) return true;
    return (p.application || '').toLowerCase().includes(q)
        || (p.property_key || '').toLowerCase().includes(q)
        || String(p.property_id).includes(q);
  });
  if (!matches.length) {
    box.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px">ไม่พบ property</div>`;
    return;
  }
  box.innerHTML = matches.slice(0, 300).map(p =>
    `<div class="bo-prop-picker-row" onclick="pickBoProp(${p.property_id})">
       <span class="app">${escapeHtml(p.application)}</span>
       <span class="key">${escapeHtml(p.property_key)}</span>
       <span class="val">${escapeHtml(String(p.property_value || '').substring(0, 50))}</span>
     </div>`
  ).join('') + (matches.length > 300 ? `<div style="padding:8px;text-align:center;font-size:10.5px;color:var(--text-muted)">...แสดง 300 จาก ${matches.length} — พิมพ์ค้นหาเพื่อกรอง</div>` : '');
}

function _boCurrentTargetProps() {
  if (!_boEdit || !_boPickerTarget) return [];
  if (_boPickerTarget === 'enable') return _boEdit.enable;
  if (_boPickerTarget === 'msg_th') return _boEdit.msgThProps;
  if (_boPickerTarget === 'msg_en') return _boEdit.msgEnProps;
  return [];
}

function pickBoProp(propertyId) {
  if (!_boEdit || !_boPickerTarget) return;
  const flat = [];
  for (const app of _boEdit.appList) for (const p of (app.properties || [])) flat.push(p);
  const hit = flat.find(x => x.property_id === propertyId);
  if (!hit) return;
  const target = _boPickerTarget;
  const key = target === 'enable' ? 'enable' : (target === 'msg_th' ? 'msgThProps' : 'msgEnProps');
  _boEdit[key].push(hit);
  const tblId = target === 'enable' ? 'bo-enable-tbl' : (target === 'msg_th' ? 'bo-msg-th-tbl' : 'bo-msg-en-tbl');
  _renderBoPropTable(target, _boEdit[key], tblId);
  closeBoPropPicker();
}

async function saveBoEdit() {
  if (!_boEdit) return;
  // Sync name/messages from inputs
  _boEdit.name  = document.getElementById('bo-edit-name').value.trim();
  _boEdit.msgTh = document.getElementById('bo-edit-msg-th').value;
  _boEdit.msgEn = document.getElementById('bo-edit-msg-en').value;
  if (!_boEdit.name) { Toast.error('Use Case Name ห้ามว่าง'); return; }

  const btn = document.getElementById('bo-edit-save-btn');
  btn.disabled = true;
  const origText = btn.textContent;
  btn.textContent = 'Saving...';

  try {
    const resp = await API.post('/ma-services/backoffice-save.php', {
      service_id: _boEdit.serviceId,
      use_case_id: _boEdit.useCaseId,
      use_case_name: _boEdit.name,
      use_case_type: _boEdit.type,
      ma_enable: _boEdit.maEnable,
      ma_message_th: _boEdit.msgTh,
      ma_message_en: _boEdit.msgEn,
      ma_enable_property_ids:     _boEdit.enable.map(p => p.property_id),
      ma_message_th_property_ids: _boEdit.msgThProps.map(p => p.property_id),
      ma_message_en_property_ids: _boEdit.msgEnProps.map(p => p.property_id),
    });
    const r = resp && resp.data;
    if (r && r.success) {
      Toast.success('Saved to Admin Portal');
      // Optimistic update to _boCases so chip reflects new state instantly
      if (_boCases) {
        const hit = _boCases.find(x => x.id === Number(_boEdit.useCaseId));
        if (hit) hit.status = _boEdit.maEnable ? 'closed' : 'open';
      }
      closeBoEditModal();
      loadUsecases();
    } else {
      Toast.error((r && r.message) || 'Save failed');
      btn.disabled = false;
      btn.textContent = origText;
    }
  } catch (err) {
    console.error('bo save:', err);
    Toast.error('Save error: ' + (err && err.message ? err.message : 'unknown'));
    btn.disabled = false;
    btn.textContent = origText;
  }
}

function closeBoEditModal() {
  _boEdit = null;
  closeModal('modal-bo-edit');
}

