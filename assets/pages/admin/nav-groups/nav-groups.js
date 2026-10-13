// admin/nav-groups — page script, extracted from admin/nav-groups.html.
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

if (!Auth.requireAuth()) {}
Layout.render('nav-groups');

// ── All known nav items (must match layout.js coreNavItems) ──────────────────
const ALL_ITEMS = [
  { id:'dashboard',          label:'Dashboard',          icon:'dashboard' },
  { id:'my-team',            label:'My Team',            icon:'users' },
  { id:'about-som',          label:'About SOM Team',     icon:'users' },
  { id:'board',              label:'Web Board',          icon:'board' },
  { id:'sheets',             label:'Team Docs',          icon:'table' },
  { id:'sabai',              label:'SABai',              icon:'smile' },
  { id:'schedule',           label:'Shift Schedule',     icon:'calendar' },
  { id:'pw-schedule',        label:'PW Schedule',        icon:'clock' },
  { id:'onboarding',         label:'Onboarding',         icon:'compass' },
  { id:'service-performance',label:'Service Performance',icon:'bar-chart' },
  { id:'restart-monitor',    label:'EKS Restart Monitor',icon:'server' },
  { id:'restart-analyzer',   label:'Restart Analyzer',   icon:'refresh-cw' },
  { id:'log-explorer',       label:'Log Explorer',       icon:'file-text' },
  { id:'alert-monitor',      label:'Alert Monitor',      icon:'bell' },
  { id:'monitoring',         label:'Monitoring',         icon:'monitor' },
  { id:'uptime',             label:'Uptime Monitor',     icon:'clock' },
  { id:'grafana-alerts',     label:'Paused Alerts',      icon:'pause' },
  { id:'begin-grafana',      label:'Begin Grafana',      icon:'activity' },
  { id:'syncup',             label:'Sync Up',            icon:'refresh-cw' },
  { id:'ma-services',        label:'MA Services',        icon:'wrench' },
  { id:'ma-test',            label:'Result Test MA',     icon:'clipboard' },
  { id:'send-email',         label:'SMC Ticket',         icon:'send' },
  { id:'jira-templates',     label:'Jira Templates',     icon:'file-text' },
  { id:'inbox',              label:'Team Inbox',         icon:'inbox' },
  { id:'batch-monitor',      label:'Batch Monitor',      icon:'grid' },
  { id:'batch-file-search',  label:'File → Job Lookup',  icon:'search' },
  { id:'jenkins-build',      label:'Jenkins Build',      icon:'zap' },
  { id:'jenkins-portal',     label:'Jenkins Portal',     icon:'zap' },
  { id:'so-jenkins',         label:'SO Jenkins',         icon:'zap' },
  { id:'sms-gateway-switches',label:'SMS Gateway',       icon:'smartphone' },
  { id:'test-service',       label:'Service Test',       icon:'terminal' },
  { id:'analytics',          label:'Analytics',          icon:'bar-chart' },
  { id:'weekly-report',      label:'Weekly Report',      icon:'bar-chart' },
  { id:'report-center',      label:'Report Center',      icon:'presentation' },
  { id:'learn',              label:'Learning',           icon:'book-open' },
  { id:'learn-reports',      label:'Course Reports',     icon:'book-open' },
  { id:'exam-reports',       label:'Exam Reports',       icon:'clipboard' },
  { id:'genz-hub',           label:'GenZ Hub',           icon:'sparkles' },
  { id:'genz-notes',         label:'Case Notes',         icon:'book-open' },
  { id:'incident-launcher',  label:'Incident Launcher',  icon:'zap' },
  { id:'migrate-user',       label:'Migrate User',       icon:'git-merge' },
  { id:'admin',              label:'Admin Panel',        icon:'settings' },
  { id:'genz-team',          label:'GenZ Team',          icon:'badge' },
  { id:'nav-groups',         label:'Navbar Groups',      icon:'layout' },
  { id:'devtools',           label:'Dev Overview',       icon:'terminal' },
  { id:'dev-system',         label:'System Monitor',     icon:'monitor' },
  { id:'dev-api',            label:'API Explorer',       icon:'zap' },
  { id:'dev-logs',           label:'Log Viewer',         icon:'file-log' },
  { id:'dev-email',          label:'Email Tester',       icon:'mail' },
  { id:'dev-data',           label:'Data Inspector',     icon:'archive' },
];

const itemMap = Object.fromEntries(ALL_ITEMS.map(i => [i.id, i]));

let groups   = [];      // current working copy
let original = [];      // last saved (for revert)
let dirty    = false;
let dragItem = null;
let dragFrom = null;    // 'pool' | group id

// ── Load ──────────────────────────────────────────────────────────────────────
async function load() {
  try {
    const res = await API.get('/nav-groups/index.php');
    console.log('[nav-groups] API response:', res);
    const payload = res.data?.data ?? res.data;   // unwrap: {ok,status,data:{ok,data:{...}}}
    if (res.ok && payload?.groups) {
      groups   = payload.groups.map(g => ({ ...g }));
      original = groups.map(g => ({ ...g, items: [...(g.items||[])] }));
      console.log('[nav-groups] loaded groups:', groups.length, groups.map(g => g.label));
      render();
      const hint = payload.is_default ? 'ใช้ค่า Default อยู่ — แก้ไขและบันทึกเพื่อ customize' : 'โหลดข้อมูลสำเร็จ';
      document.getElementById('save-hint').textContent = hint;
    } else {
      console.error('[nav-groups] API error:', res);
      Toast.show('โหลดล้มเหลว: ' + (res.error || 'unknown'), 'error');
      document.getElementById('save-hint').textContent = 'โหลดล้มเหลว';
    }
  } catch (e) {
    console.error('[nav-groups] load exception:', e);
    Toast.show('โหลดล้มเหลว: ' + (e.message || e), 'error');
    document.getElementById('save-hint').textContent = 'เกิดข้อผิดพลาด';
  }
  document.getElementById('save-btn').disabled = false;
}

// ── Render ────────────────────────────────────────────────────────────────────
function render() {
  renderGroups();
  renderPool();
}

function renderGroups() {
  const container = document.getElementById('groups-container');
  container.innerHTML = '';

  groups.forEach((g, gi) => {
    const div = document.createElement('div');
    div.className = 'ng-group';
    div.dataset.gid = g.id;

    div.addEventListener('dragover', e => { e.preventDefault(); div.classList.add('drag-over'); });
    div.addEventListener('dragleave', () => div.classList.remove('drag-over'));
    div.addEventListener('drop', e => { e.preventDefault(); div.classList.remove('drag-over'); dropOnGroup(e, g.id); });

    const itemsHtml = (g.items || []).map(id => {
      const item = itemMap[id];
      if (!item) return '';
      return `<div class="ng-item" draggable="true"
          data-id="${id}" data-from="${g.id}"
          ondragstart="startDrag(event,'${g.id}')"
          ondragend="endDrag(event)">
        <span class="item-icon"><i data-icon="${item.icon}"></i></span>
        ${escH(item.label)}
        <button class="item-rm" onclick="removeItem('${g.id}','${id}')" title="นำออกจากกลุ่ม"><i data-icon="x"></i></button>
      </div>`;
    }).filter(Boolean).join('');

    div.innerHTML = `
      <div class="ng-group-hd">
        <span class="ng-group-icon"><i data-icon="${g.icon || 'grid'}"></i></span>
        <input class="ng-group-label-edit" value="${escH(g.label)}" maxlength="32"
               oninput="renameGroup('${g.id}',this.value)" />
        <span class="ng-group-count">${g.items?.length || 0}</span>
        <button class="ng-group-del" onclick="deleteGroup('${g.id}')" title="ลบกลุ่ม"><i data-icon="trash-2"></i></button>
      </div>
      <div class="ng-group-items${!itemsHtml ? ' empty-hint' : ''}" data-gid="${g.id}">
        ${itemsHtml}
      </div>`;
    container.appendChild(div);
  });

  if (typeof Icons !== 'undefined') Icons.replaceAll(container);
}

function renderPool() {
  const assigned = new Set(groups.flatMap(g => g.items || []));
  const pool     = ALL_ITEMS.filter(i => !assigned.has(i.id));

  const list   = document.getElementById('pool-list');
  const banner = document.getElementById('pool-banner');

  list.innerHTML = pool.map(item => `
    <div class="ng-item" draggable="true"
         data-id="${item.id}" data-from="pool"
         ondragstart="startDrag(event,'pool')"
         ondragend="endDrag(event)">
      <span class="item-icon"><i data-icon="${item.icon}"></i></span>
      ${escH(item.label)}
    </div>`).join('');

  // Show banner only when there are unassigned items
  banner.classList.toggle('has-items', pool.length > 0);
  if (typeof Icons !== 'undefined') Icons.replaceAll(list);
}

// ── Drag & Drop ───────────────────────────────────────────────────────────────
function startDrag(e, from) {
  dragItem = e.currentTarget.dataset.id;
  dragFrom = from;
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragItem);
}
function endDrag(e) {
  e.currentTarget.classList.remove('dragging');
  dragItem = null; dragFrom = null;
}
function dropOnGroup(e, toGid) {
  if (!dragItem) return;
  // Remove from source
  if (dragFrom !== 'pool') {
    const src = groups.find(g => g.id === dragFrom);
    if (src) src.items = src.items.filter(i => i !== dragItem);
  }
  // Add to target (if not already there)
  const tgt = groups.find(g => g.id === toGid);
  if (tgt && !tgt.items.includes(dragItem)) tgt.items.push(dragItem);
  markDirty(); render();
}
function dropOnPool(e) {
  if (!dragItem || dragFrom === 'pool') return;
  const src = groups.find(g => g.id === dragFrom);
  if (src) src.items = src.items.filter(i => i !== dragItem);
  markDirty(); render();
}

// ── Mutations ─────────────────────────────────────────────────────────────────
function removeItem(gid, id) {
  const g = groups.find(x => x.id === gid);
  if (g) g.items = g.items.filter(i => i !== id);
  markDirty(); render();
}
function renameGroup(gid, val) {
  const g = groups.find(x => x.id === gid);
  if (g) g.label = val;
  markDirty();
}
function deleteGroup(gid) {
  if (!confirm('ลบกลุ่มนี้? items จะกลับไปอยู่ใน pool')) return;
  groups = groups.filter(g => g.id !== gid);
  markDirty(); render();
}
function addGroup() {
  const id = 'group_' + Date.now();
  groups.push({ id, label: 'New Group', icon: 'grid', items: [] });
  markDirty(); render();
  // Focus the label input of the new group
  setTimeout(() => {
    const inputs = document.querySelectorAll('.ng-group-label-edit');
    inputs[inputs.length - 1]?.select();
  }, 50);
}

function markDirty() {
  dirty = true;
  document.getElementById('save-bar').classList.add('dirty');
  document.getElementById('save-hint').textContent = 'มีการแก้ไขที่ยังไม่บันทึก';
  document.getElementById('save-btn').disabled = false;
}

function revertChanges() {
  groups = JSON.parse(JSON.stringify(original));
  dirty  = false;
  document.getElementById('save-bar').classList.remove('dirty');
  document.getElementById('save-hint').textContent = 'ยกเลิกการแก้ไขแล้ว';
  render();
}

async function saveGroups() {
  const btn = document.getElementById('save-btn');
  btn.disabled = true;
  btn.innerHTML = '<i data-icon="loader"></i> กำลังบันทึก…';
  if (typeof Icons !== 'undefined') Icons.replaceAll(btn);
  try {
    const res = await API.post('/nav-groups/index.php', { groups });
    if (res.ok) {
      original = groups.map(g => ({ ...g, items: [...(g.items||[])] }));
      dirty    = false;
      document.getElementById('save-bar').classList.remove('dirty');
      document.getElementById('save-hint').textContent = 'บันทึกสำเร็จ — reload หน้าจะเห็น navbar ใหม่';
      Toast.show('บันทึก Navbar Groups สำเร็จ', 'success');
      try { sessionStorage.removeItem('_sm_nav_groups'); } catch {}
    } else {
      const errMsg = res.data?.error || res.data?.data?.error || 'unknown';
      Toast.show('บันทึกล้มเหลว: ' + errMsg, 'error');
    }
  } catch (e) {
    Toast.show('เกิดข้อผิดพลาด: ' + (e.message || e), 'error');
  }
  btn.disabled = false;
  btn.innerHTML = '<i data-icon="save"></i> บันทึก';
  if (typeof Icons !== 'undefined') Icons.replaceAll(btn);
}

async function resetToDefault() {
  if (!confirm('Reset กลับค่า Default ทั้งหมด?')) return;
  const res = await API.delete('/nav-groups/index.php');
  if (res.ok) {
    Toast.show('Reset สำเร็จ', 'success');
    load();
  }
}

function escH(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

load();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "addGroup", { configurable: true, get: () => addGroup, set: (v) => { addGroup = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "deleteGroup", { configurable: true, get: () => deleteGroup, set: (v) => { deleteGroup = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "dropOnGroup", { configurable: true, get: () => dropOnGroup, set: (v) => { dropOnGroup = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "dropOnPool", { configurable: true, get: () => dropOnPool, set: (v) => { dropOnPool = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "endDrag", { configurable: true, get: () => endDrag, set: (v) => { endDrag = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "escH", { configurable: true, get: () => escH, set: (v) => { escH = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "load", { configurable: true, get: () => load, set: (v) => { load = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "markDirty", { configurable: true, get: () => markDirty, set: (v) => { markDirty = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "removeItem", { configurable: true, get: () => removeItem, set: (v) => { removeItem = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renameGroup", { configurable: true, get: () => renameGroup, set: (v) => { renameGroup = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "render", { configurable: true, get: () => render, set: (v) => { render = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderGroups", { configurable: true, get: () => renderGroups, set: (v) => { renderGroups = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderPool", { configurable: true, get: () => renderPool, set: (v) => { renderPool = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "resetToDefault", { configurable: true, get: () => resetToDefault, set: (v) => { resetToDefault = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "revertChanges", { configurable: true, get: () => revertChanges, set: (v) => { revertChanges = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "saveGroups", { configurable: true, get: () => saveGroups, set: (v) => { saveGroups = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "startDrag", { configurable: true, get: () => startDrag, set: (v) => { startDrag = v; } }); } catch (e) {}
})();
