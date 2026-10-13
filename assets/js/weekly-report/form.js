/* ══════════════════════════════════════════════════
   form.js  |  Weekly Report Form Handler
   ══════════════════════════════════════════════════ */

// Initialize variables — bootstrap week/section from URL params if present
const _formUrlParams = new URLSearchParams(location.search);
const _urlWeekParam  = _formUrlParams.get('week');
let currentWeek = (_urlWeekParam && /^\d{4}-\d{2}-\d{2}$/.test(_urlWeekParam))
  ? _urlWeekParam
  : WeeklyDateUtils.formatDate(WeeklyDateUtils.getWeekStart());
let currentData = {};
let editMode = {};

// ── Skeleton helpers ──────────────────────────────
const SK_WIDTHS = ['55%', '70%', '45%', '65%', '50%'];

function showListSkeleton(el, count = 3) {
  el.innerHTML = Array.from({ length: count }, (_, i) => `
    <li class="sk-li">
      <div class="sk-bar" style="width:34px;border-radius:4px"></div>
      <div class="sk-bar" style="width:${SK_WIDTHS[i % SK_WIDTHS.length]};flex:1"></div>
    </li>`).join('');
}

const ALL_LIST_IDS = [
  'incidentItems',
  'batchEventItems', 'batchPendingItems',
  'supportMAItems', 'supportDevItems',
  'updateAlertItems', 'handoverItems', 'otherItems',
  'improvementItems', 'projectUpdateItems',
];

function showAllSkeletons() {
  ALL_LIST_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) showListSkeleton(el);
  });
}

// The weekly-report sync endpoints now require an authenticated user
// (they used to be open). Every fetch below must send the Bearer token.
function wrAuthHeaders() {
  const t = (typeof Auth !== 'undefined' && Auth.getToken) ? Auth.getToken() : '';
  return t ? { 'Authorization': 'Bearer ' + t } : {};
}

// ── Silent Jira auto-sync (no toast if 0 added) ──
async function silentSyncJiraIncidents() {
  try {
    const response = await fetch(`./api/weekly-report/sync-jira-incidents.php?week=week-${currentWeek}`, { headers: wrAuthHeaders() });
    const result = await response.json();
    if (!result.ok) return;
    const jiraIncidents = result.data.incidents || [];
    if (!jiraIncidents.length) return;
    const existingIds = new Set(currentData.incidents.map(i => i.ticketId));
    const newItems = jiraIncidents.filter(i => !existingIds.has(i.ticketId));
    if (!newItems.length) return;
    currentData.incidents.push(...newItems);
    await WeeklyReportAPI.saveEntry({ week: 'week-' + currentWeek, section: 'incidents', data: currentData.incidents });
    Toast.success(`Auto-synced ${newItems.length} incident(s) from Jira`);
    renderAllLists();
  } catch (_) { /* silent */ }
}

async function silentSyncJiraMA() {
  try {
    const response = await fetch(`./api/weekly-report/sync-jira-ma.php?week=week-${currentWeek}`, { headers: wrAuthHeaders() });
    const result = await response.json();
    if (!result.ok) return;
    const jiraItems = result.data.items || [];
    if (!jiraItems.length) return;
    if (!currentData.support) currentData.support = { ma: [], dev: [] };
    const existingIds = new Set([
      ...currentData.support.ma.map(i => i.ticketId),
      ...currentData.support.dev.map(i => i.ticketId),
    ]);
    const newItems = jiraItems.filter(i => !existingIds.has(i.ticketId));
    if (!newItems.length) return;
    currentData.support.ma.push(...newItems);
    await WeeklyReportAPI.saveEntry({ week: 'week-' + currentWeek, section: 'support', data: currentData.support });
    Toast.success(`Auto-synced ${newItems.length} MA ticket(s) from Jira`);
    renderAllLists();
  } catch (_) { /* silent */ }
}

async function silentSyncJiraDev() {
  try {
    const response = await fetch(`./api/weekly-report/sync-jira-dev.php?week=week-${currentWeek}`, { headers: wrAuthHeaders() });
    const result = await response.json();
    if (!result.ok) return;
    const jiraItems = result.data.items || [];
    if (!jiraItems.length) return;
    if (!currentData.support) currentData.support = { ma: [], dev: [] };
    const existingIds = new Set([
      ...currentData.support.ma.map(i => i.ticketId),
      ...currentData.support.dev.map(i => i.ticketId),
    ]);
    const newItems = jiraItems.filter(i => !existingIds.has(i.ticketId));
    if (!newItems.length) return;
    currentData.support.dev.push(...newItems);
    await WeeklyReportAPI.saveEntry({ week: 'week-' + currentWeek, section: 'support', data: currentData.support });
    Toast.success(`Auto-synced ${newItems.length} Dev ticket(s) from Jira`);
    renderAllLists();
  } catch (_) { /* silent */ }
}

// DOM Elements
const weekLabel = document.getElementById('currentWeekLabel');
const weekStatus = document.getElementById('weekStatus');
const weekSelectForm = document.getElementById('weekSelectForm');

// Form elements
const incidentForm = document.querySelector('form[data-panel="incidents"]');
const batchForm = document.querySelector('form[data-panel="batch"]');
const supportForm = document.querySelector('form[data-panel="support"]');
const updatesForm = document.querySelector('form[data-panel="updates"]');
const improvForm = document.querySelector('form[data-panel="improvements"]');

// Initialize week selector
async function initFormWeeks() {
  try {
    const response = await WeeklyReportAPI.listWeeks();
    // Remove .json extension from week names
    let weeks = (response.weeks || []).map(w => w.replace('.json', '').replace('week-', ''));
    
    // Add recent weeks
    const recent = WeeklyDateUtils.getLastNWeeks(12);
    const todayKey = currentWeek;
    weeks = Array.from(new Set([...weeks, ...recent, todayKey]));
    
    // Filter valid dates and sort
    weeks = weeks.filter(w => /^\d{4}-\d{2}-\d{2}$/.test(w));
    weeks.sort((a, b) => new Date(b) - new Date(a));

    if (weekSelectForm) {
      weekSelectForm.innerHTML = weeks.map(w => 
        `<option value="${w}" ${w === currentWeek ? 'selected' : ''}>${WeeklyDateUtils.formatWeekRange('week-' + w)}</option>`
      ).join('');
    }

    updateWeekDisplay();
    await loadWeekData();
    // Auto-sync all Jira sources silently after initial load (run in parallel)
    Promise.all([silentSyncJiraIncidents(), silentSyncJiraMA(), silentSyncJiraDev()]);
  } catch (error) {
    console.error('Failed to initialize weeks:', error);
    Toast.error('Failed to load weeks');
  }
}

function updateWeekDisplay() {
  if (weekLabel) {
    weekLabel.textContent = WeeklyDateUtils.formatWeekRange('week-' + currentWeek);
  }

  if (weekStatus) {
    const today = WeeklyDateUtils.formatDate(WeeklyDateUtils.getWeekStart());
    
    if (currentWeek === today) {
      weekStatus.className = 'status-indicator current';
      weekStatus.innerHTML = '<i data-icon="edit"></i> Current Week';
    } else if (new Date(currentWeek) < new Date(today)) {
      weekStatus.className = 'status-indicator past';
      weekStatus.innerHTML = '<i data-icon="book-open"></i> Past Week';
    } else {
      weekStatus.className = 'status-indicator future';
      weekStatus.innerHTML = '🔮 Future Week';
    }
  }
}

// Load week data
async function loadWeekData() {
  showAllSkeletons();
  try {
    const response = await WeeklyReportAPI.getWeek('week-' + currentWeek);
    currentData = response.data || {};
    
    // Initialize data structure
    currentData.announcement = currentData.announcement || [];
    currentData.incidents = currentData.incidents || [];
    currentData.batch = currentData.batch || { event: [], pending: [] };
    currentData.support = currentData.support || { ma: [], dev: [] };
    currentData.updates = currentData.updates || { alert: [], handover: [], other: [] };
    currentData.improvements = currentData.improvements || { improve: [], project: [] };
    
    renderAllLists();
    renderAnnouncementList();
  } catch (error) {
    console.error('Failed to load week data:', error);
    Toast.error('Failed to load data');
  }
}

// Save and refresh
async function saveAndRefresh(section, action = 'add', details = {}) {
  try {
    await WeeklyReportAPI.saveEntry({
      week: 'week-' + currentWeek,
      section,
      data: currentData[section]
    });

    // Log activity to main system logs
    try {
      const response = await fetch('./api/weekly-report/log-activity.php', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (Auth.getToken() || '')
        },
        body: JSON.stringify({
          action,
          category: section,
          details: { week: currentWeek, ...details }
        })
      });
      
      const result = await response.json();
      console.log('✅ Activity logged to main system:', result);
    } catch (logError) {
      console.error('Failed to log activity:', logError);
    }

    Toast.success(action === 'add' ? 'Added successfully' : action === 'UPDATE' ? 'Updated successfully' : 'Deleted successfully');
    await loadWeekData();
  } catch (error) {
    console.error('Save failed:', error);
    Toast.error('Failed to save: ' + error.message);
  }
}


// Reflect current week + active section in URL (shareable / refresh-safe)
function _updateFormUrl() {
  const section = document.querySelector('.side-nav button[data-section].active')?.dataset.section || '';
  const params = new URLSearchParams({ week: currentWeek });
  if (section) params.set('section', section);
  history.replaceState(null, '', '?' + params.toString());
}

// Week selector change
if (weekSelectForm) {
  weekSelectForm.addEventListener('change', () => {
    currentWeek = weekSelectForm.value;
    updateWeekDisplay();
    _updateFormUrl();
    loadWeekData();
  });
}

// Week navigation buttons
const prevWeekBtn = document.getElementById('prevWeekForm');
const nextWeekBtn = document.getElementById('nextWeekForm');

if (prevWeekBtn) {
  prevWeekBtn.addEventListener('click', () => shiftWeek(-1));
}

if (nextWeekBtn) {
  nextWeekBtn.addEventListener('click', () => shiftWeek(1));
}

function shiftWeek(delta) {
  const cur = new Date(currentWeek);
  cur.setDate(cur.getDate() + (7 * delta));
  const newKey = WeeklyDateUtils.formatDate(WeeklyDateUtils.getWeekStart(cur));

  // Add to selector if not exists
  if (weekSelectForm && ![...weekSelectForm.options].some(o => o.value === newKey)) {
    const opt = document.createElement('option');
    opt.value = newKey;
    opt.textContent = WeeklyDateUtils.formatWeekRange('week-' + newKey);
    weekSelectForm.appendChild(opt);

    // Re-sort
    const opts = [...weekSelectForm.options].map(o => o.value).sort((a, b) => new Date(b) - new Date(a));
    weekSelectForm.innerHTML = opts.map(v => 
      `<option value="${v}" ${v === newKey ? 'selected' : ''}>${WeeklyDateUtils.formatWeekRange('week-' + v)}</option>`
    ).join('');
  } else if (weekSelectForm) {
    weekSelectForm.value = newKey;
  }

  currentWeek = newKey;
  updateWeekDisplay();
  _updateFormUrl();
  loadWeekData();
}

// Side navigation switching
const sideButtons = document.querySelectorAll('.side-nav button[data-section]');
sideButtons.forEach(btn => btn.addEventListener('click', () => {
  sideButtons.forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelector(`.panel[data-panel="${btn.dataset.section}"]`).classList.add('active');

  _updateFormUrl();
  cancelEditMode();
}));

// Bootstrap section from URL ?section= on first load
const _urlSection = _formUrlParams.get('section');
if (_urlSection) {
  const _targetBtn = document.querySelector(`.side-nav button[data-section="${_urlSection}"]`);
  if (_targetBtn) _targetBtn.click();
}

// Tabs inside forms
function bindTabs(panel) {
  const tabs = panel.querySelectorAll('.tabs-mini button');
  const hiddenInput = panel.querySelector('input[name="subType"]');
  if (!tabs.length || !hiddenInput) return;
  
  tabs.forEach(t => t.addEventListener('click', () => {
    tabs.forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    hiddenInput.value = t.dataset.sub;
  }));
}

document.querySelectorAll('.panel').forEach(bindTabs);

// Sync a form's sub-tab segmented control (active button + hidden subType input)
// to a given sub value. Needed after form.reset(): reset() reverts the hidden
// subType input to its HTML default but leaves the highlighted button wherever
// the user last clicked — so the button and the actual data can silently disagree.
// Passing the just-submitted subType keeps the section the user was adding to
// selected, so they can add several items in a row without re-clicking.
function syncSubTabs(form, sub) {
  if (!form || !sub) return;
  const hidden = form.querySelector('input[name="subType"]');
  if (hidden) hidden.value = sub;
  form.querySelectorAll('.tabs-mini button').forEach(t =>
    t.classList.toggle('active', t.dataset.sub === sub));
}


// ═══════════════════════════════════════════════════
// FORM SUBMISSIONS
// ═══════════════════════════════════════════════════

// Incidents Form
if (incidentForm) {
  incidentForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(incidentForm);
    const obj = {
      ticketId: f.get('ticketId'),
      ticketUrl: f.get('ticketUrl'),
      title: f.get('title'),
      severity: f.get('severity'),
      detected: f.get('detected'),
      date: new Date().toISOString().slice(0, 10)
    };

    if (editMode.incidents !== undefined) {
      const oldData = { ...currentData.incidents[editMode.incidents] };
      currentData.incidents[editMode.incidents] = obj;
      editMode.incidents = undefined;
      
      const submitBtn = incidentForm.querySelector('button[type="submit"]');
      submitBtn.textContent = 'Add Incident';
      
      const cancelBtn = incidentForm.querySelector('.cancel-edit');
      if (cancelBtn) cancelBtn.style.display = 'none';
      
      await saveAndRefresh('incidents', 'UPDATE', { ticketId: obj.ticketId, oldData, newData: obj });
    } else {
      currentData.incidents.push(obj);
      await saveAndRefresh('incidents', 'add', { ticketId: obj.ticketId });
    }
    
    incidentForm.reset();
  });
}

// Sync from Jira button
const syncJiraBtn = document.getElementById('syncJiraIncidents');
if (syncJiraBtn) {
  syncJiraBtn.addEventListener('click', async () => {
    try {
      syncJiraBtn.disabled = true;
      syncJiraBtn.innerHTML = '<span>⏳</span><span>Syncing...</span>';
      
      const response = await fetch(`./api/weekly-report/sync-jira-incidents.php?week=week-${currentWeek}`, { headers: wrAuthHeaders() });
      const result = await response.json();
      
      if (!result.ok) {
        throw new Error(result.error || 'Failed to sync from Jira');
      }
      
      const jiraIncidents = result.data.incidents || [];
      
      if (jiraIncidents.length === 0) {
        Toast.info('No incidents found in Jira for this week');
        return;
      }
      
      // Merge with existing incidents (avoid duplicates)
      const existingTicketIds = new Set(currentData.incidents.map(i => i.ticketId));
      const newIncidents = jiraIncidents.filter(i => !existingTicketIds.has(i.ticketId));
      
      if (newIncidents.length === 0) {
        Toast.info('All Jira incidents already exist');
        return;
      }
      
      // Add new incidents
      currentData.incidents.push(...newIncidents);
      
      // Save
      await saveAndRefresh('incidents', 'add', { 
        source: 'jira_sync',
        count: newIncidents.length 
      });
      
      Toast.success(`Synced ${newIncidents.length} incidents from Jira`);
      
    } catch (error) {
      console.error('Jira sync failed:', error);
      Toast.error('Failed to sync from Jira: ' + error.message);
    } finally {
      syncJiraBtn.disabled = false;
      syncJiraBtn.innerHTML = '<span><i data-icon="refresh-cw"></i></span><span>Sync from Jira</span>';
    }
  });
}

// Sync MA from Jira button (Support → MA tab)
const syncJiraMABtn = document.getElementById('syncJiraMA');
if (syncJiraMABtn) {
  syncJiraMABtn.addEventListener('click', async () => {
    try {
      syncJiraMABtn.disabled = true;
      syncJiraMABtn.innerHTML = '<span>⏳</span><span>Syncing...</span>';

      const response = await fetch(`./api/weekly-report/sync-jira-ma.php?week=week-${currentWeek}`, { headers: wrAuthHeaders() });
      const result = await response.json();

      if (!result.ok) {
        throw new Error(result.error || 'Failed to sync MA from Jira');
      }

      const jiraItems = result.data.items || [];

      if (jiraItems.length === 0) {
        Toast.info('No closed MA tickets found in Jira for this week');
        return;
      }

      if (!currentData.support) currentData.support = { ma: [], dev: [] };
      if (!Array.isArray(currentData.support.ma)) currentData.support.ma = [];
      if (!Array.isArray(currentData.support.dev)) currentData.support.dev = [];

      // Dedupe across BOTH ma and dev — a ticketId already present in either list is skipped
      const existingTicketIds = new Set([
        ...currentData.support.ma.map(i => i.ticketId),
        ...currentData.support.dev.map(i => i.ticketId)
      ]);
      const newItems = jiraItems.filter(i => !existingTicketIds.has(i.ticketId));

      if (newItems.length === 0) {
        Toast.info('All Jira MA tickets already exist');
        return;
      }

      currentData.support.ma.push(...newItems);

      await saveAndRefresh('support', 'add', {
        source: 'jira_sync',
        subType: 'ma',
        count: newItems.length
      });

      Toast.success(`Synced ${newItems.length} MA tickets from Jira`);

    } catch (error) {
      console.error('Jira MA sync failed:', error);
      Toast.error('Failed to sync MA from Jira: ' + error.message);
    } finally {
      syncJiraMABtn.disabled = false;
      syncJiraMABtn.innerHTML = '<span><i data-icon="refresh-cw"></i></span><span>Sync MA from Jira</span>';
    }
  });
}

// Sync Support Dev from Jira button
const syncJiraDevBtn = document.getElementById('syncJiraDev');
if (syncJiraDevBtn) {
  syncJiraDevBtn.addEventListener('click', async () => {
    try {
      syncJiraDevBtn.disabled = true;
      syncJiraDevBtn.innerHTML = '<span>⏳</span><span>Syncing...</span>';

      const response = await fetch(`./api/weekly-report/sync-jira-dev.php?week=week-${currentWeek}`, { headers: wrAuthHeaders() });
      const result = await response.json();

      if (!result.ok) {
        throw new Error(result.error || 'Failed to sync Dev from Jira');
      }

      const jiraItems = result.data.items || [];

      if (jiraItems.length === 0) {
        Toast.info('No closed Support Dev tickets found in Jira for this week');
        return;
      }

      if (!currentData.support) currentData.support = { ma: [], dev: [] };
      if (!Array.isArray(currentData.support.ma)) currentData.support.ma = [];
      if (!Array.isArray(currentData.support.dev)) currentData.support.dev = [];

      // Dedupe across BOTH ma and dev — a ticketId already present in either list is skipped
      const existingTicketIds = new Set([
        ...currentData.support.ma.map(i => i.ticketId),
        ...currentData.support.dev.map(i => i.ticketId)
      ]);
      const newItems = jiraItems.filter(i => !existingTicketIds.has(i.ticketId));

      if (newItems.length === 0) {
        Toast.info('All Jira Dev tickets already exist');
        return;
      }

      currentData.support.dev.push(...newItems);

      await saveAndRefresh('support', 'add', {
        source: 'jira_sync',
        subType: 'dev',
        count: newItems.length
      });

      Toast.success(`Synced ${newItems.length} Support Dev tickets from Jira`);

    } catch (error) {
      console.error('Jira Dev sync failed:', error);
      Toast.error('Failed to sync Dev from Jira: ' + error.message);
    } finally {
      syncJiraDevBtn.disabled = false;
      syncJiraDevBtn.innerHTML = '<span><i data-icon="refresh-cw"></i></span><span>Sync Dev from Jira</span>';
    }
  });
}

// Test Jira Connection button
const testJiraBtn = document.getElementById('testJiraConnection');
if (testJiraBtn) {
  testJiraBtn.addEventListener('click', async () => {
    try {
      testJiraBtn.disabled = true;
      testJiraBtn.innerHTML = '<span>⏳</span><span>Testing...</span>';
      
      const response = await fetch('./api/weekly-report/test-jira-connection.php');
      const result = await response.json();
      
      if (!result.ok) {
        throw new Error(result.error || 'Test failed');
      }
      
      const diag = result.diagnostics;
      
      // Show detailed results in console
      console.log('🔍 Jira Connection Test Results:', result);
      
      // Show user-friendly message
      if (diag.curl_test && diag.curl_test.success) {
        Toast.success('<i data-icon="check-circle"></i> Connection successful! Jira API is working.');
        console.log('✅ Authenticated as:', diag.jira_user);
      } else {
        Toast.error('<i data-icon="x-circle"></i> Connection failed: ' + result.recommendation);
        console.error('Diagnostics:', diag);
      }
      
    } catch (error) {
      console.error('Test failed:', error);
      Toast.error('Test failed: ' + error.message);
    } finally {
      testJiraBtn.disabled = false;
      testJiraBtn.innerHTML = '<span><i data-icon="search"></i></span><span>Test Connection</span>';
    }
  });
}

// Batch Form
if (batchForm) {
  batchForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(batchForm);
    const subType = f.get('subType');
    const obj = {
      name: f.get('name'),
      date: f.get('date'),
      desc: f.get('desc'),
      url: f.get('url') || '',
      status: f.get('status')
    };

    if (editMode.batch !== undefined && editMode.batchSubType !== undefined) {
      const oldData = { ...currentData.batch[editMode.batchSubType][editMode.batch] };
      currentData.batch[editMode.batchSubType][editMode.batch] = obj;
      editMode.batch = undefined;
      editMode.batchSubType = undefined;
      
      const submitBtn = batchForm.querySelector('button[type="submit"]');
      submitBtn.textContent = 'Add Batch Item';
      
      const cancelBtn = batchForm.querySelector('.cancel-edit');
      if (cancelBtn) cancelBtn.style.display = 'none';
      
      await saveAndRefresh('batch', 'UPDATE', { name: obj.name, subType, oldData, newData: obj });
    } else {
      currentData.batch[subType].push(obj);
      await saveAndRefresh('batch', 'add', { name: obj.name, subType });
    }
    
    batchForm.reset();
    syncSubTabs(batchForm, subType);   // keep the sub-section the user was adding to
  });
}

// Support Form
if (supportForm) {
  supportForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(supportForm);
    const subType = f.get('subType');
    const obj = {
      summary: f.get('summary'),
      ticketId: f.get('ticketId'),
      ticketUrl: f.get('ticketUrl'),
      owner: f.get('owner'),
      status: f.get('status')
    };

    if (editMode.support !== undefined && editMode.supportSubType !== undefined) {
      const oldData = { ...currentData.support[editMode.supportSubType][editMode.support] };
      currentData.support[editMode.supportSubType][editMode.support] = obj;
      editMode.support = undefined;
      editMode.supportSubType = undefined;
      
      const submitBtn = supportForm.querySelector('button[type="submit"]');
      submitBtn.textContent = 'Add Support Item';
      
      const cancelBtn = supportForm.querySelector('.cancel-edit');
      if (cancelBtn) cancelBtn.style.display = 'none';
      
      await saveAndRefresh('support', 'UPDATE', { ticketId: obj.ticketId, subType, oldData, newData: obj });
    } else {
      currentData.support[subType].push(obj);
      await saveAndRefresh('support', 'add', { ticketId: obj.ticketId, subType });
    }
    
    supportForm.reset();
    syncSubTabs(supportForm, subType);   // keep the sub-section the user was adding to
  });
}

// Updates Form
if (updatesForm) {
  updatesForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(updatesForm);
    const subType = f.get('subType');
    const obj = {
      name: f.get('name'),
      date: f.get('date'),
      desc: f.get('desc'),
      ticketId: f.get('ticketId') || '',
      url: f.get('url') || '',
      status: f.get('status')
    };

    if (editMode.updates !== undefined && editMode.updatesSubType !== undefined) {
      const oldData = { ...currentData.updates[editMode.updatesSubType][editMode.updates] };
      currentData.updates[editMode.updatesSubType][editMode.updates] = obj;
      editMode.updates = undefined;
      editMode.updatesSubType = undefined;
      
      const submitBtn = updatesForm.querySelector('button[type="submit"]');
      submitBtn.textContent = 'Add Update Item';
      
      const cancelBtn = updatesForm.querySelector('.cancel-edit');
      if (cancelBtn) cancelBtn.style.display = 'none';
      
      await saveAndRefresh('updates', 'UPDATE', { name: obj.name, subType, oldData, newData: obj });
    } else {
      currentData.updates[subType].push(obj);
      await saveAndRefresh('updates', 'add', { name: obj.name, subType });
    }
    
    updatesForm.reset();
    syncSubTabs(updatesForm, subType);   // keep the sub-section the user was adding to
  });
}

// Improvements Form
if (improvForm) {
  improvForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(improvForm);
    const subType = f.get('subType');
    const obj = {
      name: f.get('name'),
      desc: f.get('desc'),
      ticketId: f.get('ticketId') || '',
      url: f.get('url') || '',
      status: f.get('status')
    };

    if (editMode.improvements !== undefined && editMode.improvementsSubType !== undefined) {
      const oldData = { ...currentData.improvements[editMode.improvementsSubType][editMode.improvements] };
      currentData.improvements[editMode.improvementsSubType][editMode.improvements] = obj;
      editMode.improvements = undefined;
      editMode.improvementsSubType = undefined;
      
      const submitBtn = improvForm.querySelector('button[type="submit"]');
      submitBtn.textContent = 'Add Item';
      
      const cancelBtn = improvForm.querySelector('.cancel-edit');
      if (cancelBtn) cancelBtn.style.display = 'none';
      
      await saveAndRefresh('improvements', 'UPDATE', { name: obj.name, subType, oldData, newData: obj });
    } else {
      currentData.improvements[subType].push(obj);
      await saveAndRefresh('improvements', 'add', { name: obj.name, subType });
    }
    
    improvForm.reset();
    syncSubTabs(improvForm, subType);   // keep the sub-section the user was adding to
  });
}


// ═══════════════════════════════════════════════════
// RENDER LISTS
// ═══════════════════════════════════════════════════

function renderAllLists() {
  // Incidents
  const il = document.getElementById('incidentItems');
  if (il) {
    const incidents = currentData.incidents || [];
    il.innerHTML = incidents.length > 0 ?
      incidents.map((i, idx) => {
        const sevClass = i.severity === '1' ? 'sev1' : i.severity === '2' ? 'sev2' : 'sev3';
        const detectedText = i.detected === 'Y' ? '<i data-icon="check"></i> SM' : '<i data-icon="x"></i> SM';
        return `<li>
          <div class="item-content">
            <span class="tag ${sevClass}">S${i.severity}</span>
            <div class="item-text">
              <a href="${i.ticketUrl}" target="_blank" class="ticket-link">[${i.ticketId}]</a> ${i.title}
            </div>
            <span class="tag ${i.detected === 'Y' ? 'detected-yes' : 'detected-no'}">${detectedText}</span>
          </div>
          <div class="item-actions">
            <button type="button" class="edit" data-section="incidents" data-index="${idx}"><i data-icon="pencil"></i></button>
            <button type="button" class="remove" data-section="incidents" data-index="${idx}">×</button>
          </div>
        </li>`;
      }).join('') :
      '<li class="empty-state">No incidents yet</li>';
  }
  const cInc = document.getElementById('countIncidents');
  if (cInc) cInc.textContent = (currentData.incidents || []).length;

  // Batch
  const be = document.getElementById('batchEventItems');
  if (be) {
    const events = currentData.batch?.event || [];
    be.innerHTML = events.length > 0 ?
      events.map((b, idx) => {
        const linkText = b.url ? ` <a href="${b.url}" target="_blank" class="ticket-link"><i data-icon="link"></i></a>` : '';
        return `<li>
          <div class="item-content">
            <div class="item-text">${b.name}, ${b.date}: ${b.desc}${linkText}</div>
            <span class="tag status-${b.status.toLowerCase()}">${b.status}</span>
          </div>
          <div class="item-actions">
            <button type="button" class="edit" data-section="batch.event" data-index="${idx}"><i data-icon="pencil"></i></button>
            <button type="button" class="remove" data-section="batch.event" data-index="${idx}">×</button>
          </div>
        </li>`;
      }).join('') : '<li class="empty-state">No items yet</li>';
  }
  
  const bp = document.getElementById('batchPendingItems');
  if (bp) {
    const pending = currentData.batch?.pending || [];
    bp.innerHTML = pending.length > 0 ?
      pending.map((b, idx) => {
        const linkText = b.url ? ` <a href="${b.url}" target="_blank" class="ticket-link"><i data-icon="link"></i></a>` : '';
        return `<li>
          <div class="item-content">
            <div class="item-text">${b.name}, ${b.date}: ${b.desc}${linkText}</div>
            <span class="tag status-${b.status.toLowerCase()}">${b.status}</span>
          </div>
          <div class="item-actions">
            <button type="button" class="edit" data-section="batch.pending" data-index="${idx}"><i data-icon="pencil"></i></button>
            <button type="button" class="remove" data-section="batch.pending" data-index="${idx}">×</button>
          </div>
        </li>`;
      }).join('') : '<li class="empty-state">No items yet</li>';
  }
  
  const cBE = document.getElementById('countBatchEvent');
  if (cBE) cBE.textContent = (currentData.batch?.event || []).length;
  const cBP = document.getElementById('countBatchPending');
  if (cBP) cBP.textContent = (currentData.batch?.pending || []).length;

  // Support
  const sm = document.getElementById('supportMAItems');
  if (sm) {
    const maItems = currentData.support?.ma || [];
    sm.innerHTML = maItems.length > 0 ?
      maItems.map((x, idx) => {
        const ticketDisplay = x.ticketUrl ?
          `<a href="${x.ticketUrl}" target="_blank" class="ticket-link">${x.ticketId}</a>` :
          x.ticketId;
        return `<li>
          <div class="item-content">
            <div class="item-text">${x.summary}, [Ticket: ${ticketDisplay}], [${x.owner}]</div>
            <span class="tag status-${x.status.toLowerCase()}">${x.status}</span>
          </div>
          <div class="item-actions">
            <button type="button" class="edit" data-section="support.ma" data-index="${idx}"><i data-icon="pencil"></i></button>
            <button type="button" class="remove" data-section="support.ma" data-index="${idx}">×</button>
          </div>
        </li>`;
      }).join('') : '<li class="empty-state">No items yet</li>';
  }
  
  const sd = document.getElementById('supportDevItems');
  if (sd) {
    const devItems = currentData.support?.dev || [];
    sd.innerHTML = devItems.length > 0 ?
      devItems.map((x, idx) => {
        const ticketDisplay = x.ticketUrl ?
          `<a href="${x.ticketUrl}" target="_blank" class="ticket-link">${x.ticketId}</a>` :
          x.ticketId;
        return `<li>
          <div class="item-content">
            <div class="item-text">${x.summary}, [Ticket: ${ticketDisplay}], [${x.owner}]</div>
            <span class="tag status-${x.status.toLowerCase()}">${x.status}</span>
          </div>
          <div class="item-actions">
            <button type="button" class="edit" data-section="support.dev" data-index="${idx}"><i data-icon="pencil"></i></button>
            <button type="button" class="remove" data-section="support.dev" data-index="${idx}">×</button>
          </div>
        </li>`;
      }).join('') : '<li class="empty-state">No items yet</li>';
  }
  
  const cSMA = document.getElementById('countSupportMA');
  if (cSMA) cSMA.textContent = (currentData.support?.ma || []).length;
  const cSD = document.getElementById('countSupportDev');
  if (cSD) cSD.textContent = (currentData.support?.dev || []).length;

  // Updates
  const ua = document.getElementById('updateAlertItems');
  if (ua) {
    const alertItems = currentData.updates?.alert || [];
    ua.innerHTML = alertItems.length > 0 ?
      alertItems.map((x, idx) => {
        const linkText = x.url ? ` <a href="${x.url}" target="_blank" class="ticket-link"><i data-icon="link"></i></a>` : '';
        return `<li>
          <div class="item-content">
            <div class="item-text">${x.name} ${x.desc} ${x.ticketId ? `[${x.ticketId}]` : ''}${linkText}</div>
            <span class="tag status-${x.status.toLowerCase()}">${x.status}</span>
          </div>
          <div class="item-actions">
            <button type="button" class="edit" data-section="updates.alert" data-index="${idx}"><i data-icon="pencil"></i></button>
            <button type="button" class="remove" data-section="updates.alert" data-index="${idx}">×</button>
          </div>
        </li>`;
      }).join('') : '<li class="empty-state">No items yet</li>';
  }
  
  const ho = document.getElementById('handoverItems');
  if (ho) {
    const handoverItems = currentData.updates?.handover || [];
    ho.innerHTML = handoverItems.length > 0 ?
      handoverItems.map((x, idx) => {
        const linkText = x.url ? ` <a href="${x.url}" target="_blank" class="ticket-link"><i data-icon="link"></i></a>` : '';
        return `<li>
          <div class="item-content">
            <div class="item-text">${x.name} ${x.date}: ${x.desc}${linkText}</div>
            <span class="tag status-${x.status.toLowerCase()}">${x.status}</span>
          </div>
          <div class="item-actions">
            <button type="button" class="edit" data-section="updates.handover" data-index="${idx}"><i data-icon="pencil"></i></button>
            <button type="button" class="remove" data-section="updates.handover" data-index="${idx}">×</button>
          </div>
        </li>`;
      }).join('') : '<li class="empty-state">No items yet</li>';
  }
  
  const ot = document.getElementById('otherItems');
  if (ot) {
    const otherItems = currentData.updates?.other || [];
    ot.innerHTML = otherItems.length > 0 ?
      otherItems.map((x, idx) => {
        const linkText = x.url ? ` <a href="${x.url}" target="_blank" class="ticket-link"><i data-icon="link"></i></a>` : '';
        return `<li>
          <div class="item-content">
            <div class="item-text">${x.name} ${x.date}: ${x.desc}${linkText}</div>
            <span class="tag status-${x.status.toLowerCase()}">${x.status}</span>
          </div>
          <div class="item-actions">
            <button type="button" class="edit" data-section="updates.other" data-index="${idx}"><i data-icon="pencil"></i></button>
            <button type="button" class="remove" data-section="updates.other" data-index="${idx}">×</button>
          </div>
        </li>`;
      }).join('') : '<li class="empty-state">No items yet</li>';
  }
  
  const cUA = document.getElementById('countUpdateAlert');
  if (cUA) cUA.textContent = (currentData.updates?.alert || []).length;
  const cUH = document.getElementById('countUpdateHandover');
  if (cUH) cUH.textContent = (currentData.updates?.handover || []).length;
  const cUO = document.getElementById('countUpdateOther');
  if (cUO) cUO.textContent = (currentData.updates?.other || []).length;

  // Improvements
  const im = document.getElementById('improvementItems');
  if (im) {
    const improveItems = currentData.improvements?.improve || [];
    im.innerHTML = improveItems.length > 0 ?
      improveItems.map((x, idx) => {
        const linkText = x.url ? ` <a href="${x.url}" target="_blank" class="ticket-link"><i data-icon="link"></i></a>` : '';
        return `<li>
          <div class="item-content">
            <div class="item-text">${x.name} ${x.desc} ${x.ticketId ? `[${x.ticketId}]` : ''}${linkText}</div>
            <span class="tag status-${x.status.toLowerCase()}">${x.status}</span>
          </div>
          <div class="item-actions">
            <button type="button" class="edit" data-section="improvements.improve" data-index="${idx}"><i data-icon="pencil"></i></button>
            <button type="button" class="remove" data-section="improvements.improve" data-index="${idx}">×</button>
          </div>
        </li>`;
      }).join('') : '<li class="empty-state">No items yet</li>';
  }
  
  const pr = document.getElementById('projectUpdateItems');
  if (pr) {
    const projectItems = currentData.improvements?.project || [];
    pr.innerHTML = projectItems.length > 0 ?
      projectItems.map((x, idx) => {
        const linkText = x.url ? ` <a href="${x.url}" target="_blank" class="ticket-link"><i data-icon="link"></i></a>` : '';
        return `<li>
          <div class="item-content">
            <div class="item-text">${x.name} ${x.desc} ${x.ticketId ? `[${x.ticketId}]` : ''}${linkText}</div>
            <span class="tag status-${x.status.toLowerCase()}">${x.status}</span>
          </div>
          <div class="item-actions">
            <button type="button" class="edit" data-section="improvements.project" data-index="${idx}"><i data-icon="pencil"></i></button>
            <button type="button" class="remove" data-section="improvements.project" data-index="${idx}">×</button>
          </div>
        </li>`;
      }).join('') : '<li class="empty-state">No items yet</li>';
  }
  
  const cIM = document.getElementById('countImprove');
  if (cIM) cIM.textContent = (currentData.improvements?.improve || []).length;
  const cPR = document.getElementById('countProject');
  if (cPR) cPR.textContent = (currentData.improvements?.project || []).length;
}


// ═══════════════════════════════════════════════════
// EDIT & DELETE HANDLERS
// ═══════════════════════════════════════════════════

document.addEventListener('click', async (e) => {
  // Edit button handler
  if (e.target.matches('button.edit')) {
    e.preventDefault();
    e.stopPropagation();
    
    const section = e.target.dataset.section;
    const idx = +e.target.dataset.index;
    const path = section.split('.');

    // Handle incidents
    if (section === 'incidents') {
      const item = currentData.incidents[idx];
      incidentForm.querySelector('input[name="ticketId"]').value = item.ticketId;
      incidentForm.querySelector('input[name="ticketUrl"]').value = item.ticketUrl;
      incidentForm.querySelector('input[name="title"]').value = item.title;
      incidentForm.querySelector('select[name="severity"]').value = item.severity;
      incidentForm.querySelector('select[name="detected"]').value = item.detected;
      editMode.incidents = idx;
      
      const submitBtn = incidentForm.querySelector('button[type="submit"]');
      submitBtn.textContent = 'Update Incident';
      
      const cancelBtn = incidentForm.querySelector('.cancel-edit');
      if (cancelBtn) cancelBtn.style.display = 'inline-block';
      
      Toast.info('Editing mode: Modify and click Update');
      setTimeout(() => incidentForm.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    }

    // Handle batch
    else if (path[0] === 'batch') {
      const subType = path[1];
      const item = currentData.batch[subType][idx];
      batchForm.querySelector('input[name="name"]').value = item.name;
      batchForm.querySelector('input[name="date"]').value = item.date;
      batchForm.querySelector('input[name="desc"]').value = item.desc;
      batchForm.querySelector('input[name="url"]').value = item.url || '';
      batchForm.querySelector('select[name="status"]').value = item.status;
      batchForm.querySelector('input[name="subType"]').value = subType;
      
      const tabs = batchForm.querySelectorAll('.tabs-mini button');
      tabs.forEach(t => t.classList.remove('active'));
      batchForm.querySelector(`.tabs-mini button[data-sub="${subType}"]`).classList.add('active');
      
      editMode.batch = idx;
      editMode.batchSubType = subType;
      
      const submitBtn = batchForm.querySelector('button[type="submit"]');
      submitBtn.textContent = 'Update Batch Item';
      
      const cancelBtn = batchForm.querySelector('.cancel-edit');
      if (cancelBtn) cancelBtn.style.display = 'inline-block';
      
      Toast.info('Editing mode: Modify and click Update');
      setTimeout(() => batchForm.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    }

    // Handle support
    else if (path[0] === 'support') {
      const subType = path[1];
      const item = currentData.support[subType][idx];
      supportForm.querySelector('input[name="summary"]').value = item.summary;
      supportForm.querySelector('input[name="ticketId"]').value = item.ticketId;
      supportForm.querySelector('input[name="ticketUrl"]').value = item.ticketUrl;
      supportForm.querySelector('input[name="owner"]').value = item.owner;
      supportForm.querySelector('select[name="status"]').value = item.status;
      supportForm.querySelector('input[name="subType"]').value = subType;
      
      const tabs = supportForm.querySelectorAll('.tabs-mini button');
      tabs.forEach(t => t.classList.remove('active'));
      supportForm.querySelector(`.tabs-mini button[data-sub="${subType}"]`).classList.add('active');
      
      editMode.support = idx;
      editMode.supportSubType = subType;
      
      const submitBtn = supportForm.querySelector('button[type="submit"]');
      submitBtn.textContent = 'Update Support Item';
      
      const cancelBtn = supportForm.querySelector('.cancel-edit');
      if (cancelBtn) cancelBtn.style.display = 'inline-block';
      
      Toast.info('Editing mode: Modify and click Update');
      setTimeout(() => supportForm.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    }

    // Handle updates
    else if (path[0] === 'updates') {
      const subType = path[1];
      const item = currentData.updates[subType][idx];
      updatesForm.querySelector('input[name="name"]').value = item.name;
      updatesForm.querySelector('input[name="date"]').value = item.date;
      updatesForm.querySelector('input[name="desc"]').value = item.desc;
      updatesForm.querySelector('input[name="ticketId"]').value = item.ticketId || '';
      updatesForm.querySelector('input[name="url"]').value = item.url || '';
      updatesForm.querySelector('select[name="status"]').value = item.status;
      updatesForm.querySelector('input[name="subType"]').value = subType;
      
      const tabs = updatesForm.querySelectorAll('.tabs-mini button');
      tabs.forEach(t => t.classList.remove('active'));
      updatesForm.querySelector(`.tabs-mini button[data-sub="${subType}"]`).classList.add('active');
      
      editMode.updates = idx;
      editMode.updatesSubType = subType;
      
      const submitBtn = updatesForm.querySelector('button[type="submit"]');
      submitBtn.textContent = 'Update Item';
      
      const cancelBtn = updatesForm.querySelector('.cancel-edit');
      if (cancelBtn) cancelBtn.style.display = 'inline-block';
      
      Toast.info('Editing mode: Modify and click Update');
      setTimeout(() => updatesForm.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    }

    // Handle improvements
    else if (path[0] === 'improvements') {
      const subType = path[1];
      const item = currentData.improvements[subType][idx];
      improvForm.querySelector('input[name="name"]').value = item.name;
      improvForm.querySelector('input[name="desc"]').value = item.desc;
      improvForm.querySelector('input[name="ticketId"]').value = item.ticketId || '';
      improvForm.querySelector('input[name="url"]').value = item.url || '';
      improvForm.querySelector('select[name="status"]').value = item.status;
      improvForm.querySelector('input[name="subType"]').value = subType;
      
      const tabs = improvForm.querySelectorAll('.tabs-mini button');
      tabs.forEach(t => t.classList.remove('active'));
      improvForm.querySelector(`.tabs-mini button[data-sub="${subType}"]`).classList.add('active');
      
      editMode.improvements = idx;
      editMode.improvementsSubType = subType;
      
      const submitBtn = improvForm.querySelector('button[type="submit"]');
      submitBtn.textContent = 'Update Item';
      
      const cancelBtn = improvForm.querySelector('.cancel-edit');
      if (cancelBtn) cancelBtn.style.display = 'inline-block';
      
      Toast.info('Editing mode: Modify and click Update');
      setTimeout(() => improvForm.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    }
  }

  // Remove button handler
  if (e.target.matches('button.remove')) {
    const section = e.target.dataset.section;
    const idx = +e.target.dataset.index;
    const path = section.split('.');

    const confirmed = await confirmDialog('Are you sure you want to delete this item?', 'Confirm Delete');
    if (!confirmed) return;

    if (path[0] === 'batch') {
      const item = currentData.batch[path[1]][idx];
      currentData.batch[path[1]].splice(idx, 1);
      await saveAndRefresh('batch', 'delete', { name: item?.name, subType: path[1] });
    }
    else if (path[0] === 'support') {
      const item = currentData.support[path[1]][idx];
      currentData.support[path[1]].splice(idx, 1);
      await saveAndRefresh('support', 'delete', { ticketId: item?.ticketId, subType: path[1] });
    }
    else if (path[0] === 'updates') {
      const item = currentData.updates[path[1]][idx];
      currentData.updates[path[1]].splice(idx, 1);
      await saveAndRefresh('updates', 'delete', { name: item?.name, subType: path[1] });
    }
    else if (path[0] === 'improvements') {
      const item = currentData.improvements[path[1]][idx];
      currentData.improvements[path[1]].splice(idx, 1);
      await saveAndRefresh('improvements', 'delete', { name: item?.name, subType: path[1] });
    }
    else if (section === 'incidents') {
      const item = currentData.incidents[idx];
      currentData.incidents.splice(idx, 1);
      await saveAndRefresh('incidents', 'delete', { ticketId: item?.ticketId });
    }
  }
});


// ═══════════════════════════════════════════════════
// CANCEL EDIT MODE
// ═══════════════════════════════════════════════════

function cancelEditMode() {
  // Reset incidents
  if (editMode.incidents !== undefined) {
    incidentForm.reset();
    const submitBtn = incidentForm.querySelector('button[type="submit"]');
    submitBtn.textContent = 'Add Incident';
    const cancelBtn = incidentForm.querySelector('.cancel-edit');
    if (cancelBtn) cancelBtn.style.display = 'none';
    editMode.incidents = undefined;
  }
  
  // Reset batch
  if (editMode.batch !== undefined) {
    batchForm.reset();
    const submitBtn = batchForm.querySelector('button[type="submit"]');
    submitBtn.textContent = 'Add Batch Item';
    const cancelBtn = batchForm.querySelector('.cancel-edit');
    if (cancelBtn) cancelBtn.style.display = 'none';
    syncSubTabs(batchForm, 'event');   // back to default + keep button in sync
    editMode.batch = undefined;
    editMode.batchSubType = undefined;
  }
  
  // Reset support
  if (editMode.support !== undefined) {
    supportForm.reset();
    const submitBtn = supportForm.querySelector('button[type="submit"]');
    submitBtn.textContent = 'Add Support Item';
    const cancelBtn = supportForm.querySelector('.cancel-edit');
    if (cancelBtn) cancelBtn.style.display = 'none';
    syncSubTabs(supportForm, 'ma');   // back to default + keep button in sync
    editMode.support = undefined;
    editMode.supportSubType = undefined;
  }
  
  // Reset updates
  if (editMode.updates !== undefined) {
    updatesForm.reset();
    const submitBtn = updatesForm.querySelector('button[type="submit"]');
    submitBtn.textContent = 'Add Update Item';
    const cancelBtn = updatesForm.querySelector('.cancel-edit');
    if (cancelBtn) cancelBtn.style.display = 'none';
    syncSubTabs(updatesForm, 'alert');   // back to default + keep button in sync
    editMode.updates = undefined;
    editMode.updatesSubType = undefined;
  }
  
  // Reset improvements
  if (editMode.improvements !== undefined) {
    improvForm.reset();
    const submitBtn = improvForm.querySelector('button[type="submit"]');
    submitBtn.textContent = 'Add Item';
    const cancelBtn = improvForm.querySelector('.cancel-edit');
    if (cancelBtn) cancelBtn.style.display = 'none';
    syncSubTabs(improvForm, 'improve');   // back to default + keep button in sync
    editMode.improvements = undefined;
    editMode.improvementsSubType = undefined;
  }
}

// Cancel button handlers
if (incidentForm) {
  const cancelBtn = incidentForm.querySelector('.cancel-edit');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      cancelEditMode();
      Toast.info('Edit cancelled');
    });
  }
}

if (batchForm) {
  const cancelBtn = batchForm.querySelector('.cancel-edit');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      cancelEditMode();
      Toast.info('Edit cancelled');
    });
  }
}

if (supportForm) {
  const cancelBtn = supportForm.querySelector('.cancel-edit');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      cancelEditMode();
      Toast.info('Edit cancelled');
    });
  }
}

if (updatesForm) {
  const cancelBtn = updatesForm.querySelector('.cancel-edit');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      cancelEditMode();
      Toast.info('Edit cancelled');
    });
  }
}

if (improvForm) {
  const cancelBtn = improvForm.querySelector('.cancel-edit');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      cancelEditMode();
      Toast.info('Edit cancelled');
    });
  }
}

// ═══════════════════════════════════════════════════
// ANNOUNCEMENT EDITOR
// ═══════════════════════════════════════════════════

const annInput = document.getElementById('announcementText');
const annExpiry = document.getElementById('announcementExpiry');
const addAnnBtn = document.getElementById('addAnnouncement');
const clearAnnFormBtn = document.getElementById('clearAnnouncementForm');
const saveAllAnnBtn = document.getElementById('saveAllAnnouncements');
const annListEl = document.getElementById('announcementList');

let annEditIndex = -1;

function renderAnnouncementList() {
  if (!annListEl) return;

  let announcements = currentData.announcement || [];

  // Handle legacy string data
  if (typeof announcements === 'string') {
    announcements = announcements.trim() ? [{ message: announcements, expiryDate: '' }] : [];
    currentData.announcement = announcements;
  }

  if (announcements.length === 0) {
    annListEl.innerHTML = '<li class="empty-state">ไม่มีประกาศในสัปดาห์นี้</li>';
    return;
  }

  annListEl.innerHTML = announcements.map((ann, idx) => `
    <li>
      <div class="item-content">
        <div class="item-text">
          <strong>${ann.message}</strong>
          ${ann.expiryDate ? `<br><small style="color: var(--text-muted)">📅 หมดอายุ: ${ann.expiryDate}</small>` : ''}
        </div>
      </div>
      <div class="item-actions">
        <button type="button" class="edit-ann" data-index="${idx}"><i data-icon="pencil"></i></button>
        <button type="button" class="remove-ann" data-index="${idx}">×</button>
      </div>
    </li>
  `).join('');

  // Bind events
  annListEl.querySelectorAll('.edit-ann').forEach(btn => {
    btn.onclick = () => {
      const idx = btn.dataset.index;
      const ann = currentData.announcement[idx];
      annInput.value = ann.message;
      annExpiry.value = ann.expiryDate || '';
      annEditIndex = idx;
      addAnnBtn.innerHTML = '<i data-icon="save"></i> แก้ไขประกาศ';
      annInput.focus();
    };
  });

  annListEl.querySelectorAll('.remove-ann').forEach(btn => {
    btn.onclick = () => {
      const idx = btn.dataset.index;
      currentData.announcement.splice(idx, 1);
      renderAnnouncementList();
    };
  });
}

// Add/Update Announcement
if (addAnnBtn) {
  addAnnBtn.addEventListener('click', () => {
    const message = annInput.value.trim();
    if (!message) {
      Toast.warning('กรุณากรอกข้อความประกาศ');
      return;
    }

    const expiryDate = annExpiry.value;
    const annObj = { message, expiryDate };

    if (typeof currentData.announcement === 'string') {
      currentData.announcement = currentData.announcement.trim() ? 
        [{ message: currentData.announcement, expiryDate: '' }] : [];
    }

    if (annEditIndex > -1) {
      currentData.announcement[annEditIndex] = annObj;
      annEditIndex = -1;
      addAnnBtn.innerHTML = '<i data-icon="plus"></i> เพิ่มประกาศ';
      Toast.success('แก้ไขข้อมูลประกาศชั่วคราวแล้ว (อย่าลืมกดบันทึก)');
    } else {
      currentData.announcement = currentData.announcement || [];
      currentData.announcement.push(annObj);
      Toast.success('เพิ่มประกาศลงในรายการแล้ว (อย่าลืมกดบันทึก)');
    }

    annInput.value = '';
    annExpiry.value = '';
    renderAnnouncementList();
  });
}

// Clear Form
if (clearAnnFormBtn) {
  clearAnnFormBtn.addEventListener('click', () => {
    annInput.value = '';
    annExpiry.value = '';
    annEditIndex = -1;
    addAnnBtn.innerHTML = '<i data-icon="plus"></i> เพิ่มประกาศ';
  });
}

// Save All Announcements
if (saveAllAnnBtn) {
  saveAllAnnBtn.addEventListener('click', async () => {
    try {
      await WeeklyReportAPI.saveEntry({
        week: 'week-' + currentWeek,
        section: 'announcement',
        data: currentData.announcement
      });

      // Log activity to main system
      try {
        await fetch('./api/weekly-report/log-activity.php', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + (Auth.getToken() || '')
          },
          body: JSON.stringify({
            action: 'UPDATE',
            category: 'announcement',
            details: {
              week: currentWeek,
              itemsCount: (currentData.announcement || []).length
            }
          })
        });
      } catch (logError) {
        console.error('Failed to log activity:', logError);
      }

      Toast.success('บันทึกรายการประกาศทั้งหมดเรียบร้อยแล้ว');
    } catch (error) {
      console.error('Failed to save announcements:', error);
      Toast.error('บันทึกไม่สำเร็จ: ' + error.message);
    }
  });
}

// Initialize
initFormWeeks();
