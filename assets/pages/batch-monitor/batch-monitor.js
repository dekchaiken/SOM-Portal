// batch-monitor — page script, extracted from batch-monitor.html.
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
Layout.render('batch-monitor');
// Read-only enforcement — hides all [data-action="write|edit|delete|add"]
// buttons (Build, Build Now, Batch Records, Batch Report) when the team's
// page_modes has batch-monitor set to 'read'.
if (typeof Auth !== 'undefined' && Auth.applyPageMode) Auth.applyPageMode('batch-monitor');
trackBatchMonitorCheck('view');

// ── External user restrictions ──────────────────────────────────────
(function applyExternalRestrictions() {
  const user = Auth.getUser();
  if (user?.role !== 'external') return;

  // Hide Batch Records + Batch Report buttons from topbar
  document.querySelectorAll('[onclick="openBatchRecords()"], [onclick="openBatchReport()"]')
    .forEach(btn => btn.remove());

  // Hide Build Now button in job detail panel (always hidden for external)
  const buildBtn = document.getElementById('d-build-btn');
  if (buildBtn) buildBtn.style.display = 'none';

  // Override openBatchRecords / openBatchReport so they can't be called from console either
  window.openBatchRecords = () => Toast.warning('คุณไม่มีสิทธิ์เข้าถึง Batch Records');
  window.openBatchReport  = () => Toast.warning('คุณไม่มีสิทธิ์เข้าถึง Batch Report');
  window.triggerBuild     = () => Toast.warning('คุณไม่มีสิทธิ์ trigger Build');
})();

// ── Constants ──────────────────────────────────────────────────────
const JOB_FIELDS = 'name,color,url,_class,upstreamProjects[name,url],downstreamProjects[name,url],lastBuild[number,result,timestamp,duration,url,causes[shortDescription,userId,userName]],builds[number,result,timestamp,duration]{0,12}';
const TREE       = `jobs[${JOB_FIELDS}]`;
// Nested TREE: fetch top-level + one folder level in one call
const FLAT_TREE  = `jobs[${JOB_FIELDS},jobs[${JOB_FIELDS}]]`;
const DETAIL_TREE = 'displayName,description,nextBuildNumber,upstreamProjects[name,url],downstreamProjects[name,url],builds[number,result,timestamp,duration,url,causes[shortDescription,userId,userName]]{0,10},property[parameterDefinitions[name,_class,defaultParameterValue[value],description,choices]]';

const COLOR_MAP = {
  'blue':           { label:'SUCCESS',   cls:'success' },
  'blue_anime':     { label:'RUNNING',   cls:'running' },
  'red':            { label:'FAILURE',   cls:'failure' },
  'red_anime':      { label:'RUNNING',   cls:'running' },
  'yellow':         { label:'UNSTABLE',  cls:'unstable' },
  'yellow_anime':   { label:'RUNNING',   cls:'running' },
  'grey':           { label:'DISABLED',  cls:'disabled' },
  'grey_anime':     { label:'RUNNING',   cls:'running' },
  'notbuilt':       { label:'NOT BUILT', cls:'notbuilt' },
  'notbuilt_anime': { label:'QUEUED',    cls:'running' },
  'aborted':        { label:'ABORTED',   cls:'aborted' },
  'disabled':       { label:'DISABLED',  cls:'disabled' },
};

// ── State ──────────────────────────────────────────────────────────
let servers      = [];
let jobRulesMap  = {};   // { serverId: [rules] }
let activeServer = null;
let currentJobs  = [];
let autoRefresh  = true;
let autoTimer    = null;
let currentPath  = '';
let breadcrumbs  = [];
let detailJob    = null;  // currently open job in popup
let _renderedJobs = [];  // sorted job array matching data-idx on rows

// Batch ticket modal
let batchFieldOpts  = null;  // loaded once from API
let batchIssueTypes = null;  // issue types from Jira
let batchTicketJob  = null;  // job being ticketed

// Batch report panel
let brpAllJobs   = {};   // { serverId: [flat job list] }
let brpActiveTab = null;

// Time window filter (client-side, filters currentJobs by build start-time)
let timeFilter = { active:false, date:'', startMin:0, endMin:0, includeOverlap:false };

// ── Init ───────────────────────────────────────────────────────────
async function init() {
  loadBatchMeta();  // load in background, non-blocking
  const res = await API.jenkins.servers();
  if (!res?.ok) {
    document.getElementById('srv-tabs').innerHTML =
      '<span style="font-size:12px;color:#dc2626">Failed to load server list</span>';
    return;
  }
  servers = res.data.data || [];
  // Build job rules lookup map
  servers.forEach(s => { jobRulesMap[s.id] = s.job_rules || []; });
  renderTabs();
  const _bmUrlServer = new URLSearchParams(location.search).get('server');
  const _bmInitServer = (_bmUrlServer && servers.find(s => s.id === _bmUrlServer))
    ? _bmUrlServer : (servers[0]?.id);
  if (_bmInitServer) selectServer(_bmInitServer);
}

// ── Tabs ───────────────────────────────────────────────────────────
function renderTabs() {
  document.getElementById('srv-tabs').innerHTML = servers.map(s =>
    `<div class="srv-tab" id="tab-${s.id}" onclick="selectServer('${s.id}')">${escHtml(s.display)}</div>`
  ).join('');
}

function selectServer(id) {
  activeServer = id;
  servers.forEach(s => document.getElementById(`tab-${s.id}`)?.classList.toggle('active', s.id === id));
  history.replaceState(null, '', '?server=' + encodeURIComponent(id));
  loadJobs();
}

// ── Job Rules helpers ──────────────────────────────────────────────
function jobMatchesRule(name, rules, type) {
  return rules.some(r => {
    if (r.type !== type) return false;
    const p = (r.pattern || '').trim();
    if (!p) return false;
    if (r.match === 'contains') return name.toLowerCase().includes(p.toLowerCase());
    return name.toLowerCase() === p.toLowerCase(); // exact
  });
}
function getJobRemark(name, rules) {
  const r = rules.find(r => {
    if (r.type !== 'remark') return false;
    const p = (r.pattern || '').trim();
    if (!p) return false;
    if (r.match === 'contains') return name.toLowerCase().includes(p.toLowerCase());
    return name.toLowerCase() === p.toLowerCase();
  });
  return r?.remark || '';
}
function getJobDesc(name, rules) {
  const r = rules.find(r => {
    if (r.type !== 'description') return false;
    const p = (r.pattern || '').trim();
    if (!p) return false;
    if (r.match === 'contains') return name.toLowerCase().includes(p.toLowerCase());
    return name.toLowerCase() === p.toLowerCase();
  });
  return r?.remark || '';
}

// ── Batch Metadata (from Google Sheets + manual SM edits) ─────────
let batchMetaEntries = [];
async function loadBatchMeta() {
  const res = await API.batchMeta.get();
  if (!res?.ok) return;
  // `?.entries` on a raw array returns Array.prototype.entries (a function),
  // not undefined — so `|| []` doesn't save us. Coerce explicitly.
  const e = res.data?.data?.entries;
  batchMetaEntries = Array.isArray(e) ? e : [];
}
function getJobMeta(jobName) {
  const n = jobName.toLowerCase();
  let matches = batchMetaEntries.filter(e => {
    const p = (e.pattern || '').toLowerCase();
    if (!p) return false;
    return e.match === 'exact' ? n === p : (n.includes(p) || (p.length >= 6 && p.includes(n)));
  });
  if (!matches.length) return null;
  // Manual entries (source='manual') always take priority over sheet-synced entries
  matches.sort((a, b) => (b.source === 'manual' ? 1 : 0) - (a.source === 'manual' ? 1 : 0));
  if (matches.length === 1) return matches[0];
  // Merge multiple matches — manual fields win; fill missing from sheet entries
  const isAction = v => v && (v.toLowerCase().includes('sm rerun') || v.toLowerCase().includes('inform') || v.toLowerCase() === 'yes');
  const merged = { ...matches[0] };
  for (const m of matches.slice(1)) {
    if (!merged.dev_owner  && m.dev_owner)  merged.dev_owner  = m.dev_owner;
    if ((!merged.manual_url || merged.manual_url === '-') && m.manual_url && m.manual_url !== '-')
      merged.manual_url = m.manual_url;
    if (!isAction(merged.sm_rerun) && isAction(m.sm_rerun)) merged.sm_rerun = m.sm_rerun;
    if (!merged.etc       && m.etc)       merged.etc       = m.etc;
    if (!merged.category  && m.category)  merged.category  = m.category;
    if (!merged.parameter && m.parameter) merged.parameter = m.parameter;
    if (!merged.note      && m.note)      merged.note      = m.note;
  }
  return merged;
}

// ── SM Team check ──────────────────────────────────────────────────
function isSmTeam() {
  const user = Auth.getUser();
  return user?.team === 'sm';
}

// ── Render meta strip + info cards in detail modal ─────────────────
function renderDetailMeta(job) {
  const meta = getJobMeta(job.name);
  const chips = [];
  if (meta?.category)  chips.push(`<span class="jc-category" title="${escHtml(meta.category)}"><i data-icon="tag"></i> ${escHtml(meta.category.split('\n')[0])}</span>`);
  if (meta?.dev_owner) chips.push(`<span class="jc-owner"><i data-icon="user"></i> ${escHtml(meta.dev_owner)}</span>`);
  if (meta?.sm_rerun)  chips.push(smRerunHtml(meta.sm_rerun));
  if (meta?.manual_url && meta.manual_url !== '-')
    chips.push(`<a href="${escHtml(meta.manual_url)}" target="_blank" rel="noopener" class="jc-manual-btn" title="เปิดคู่มือ"><i data-icon="book-open"></i></a>`);
  if (job._folder) chips.push(`<span class="detail-folder"><i data-icon="folder"></i> ${escHtml(job._folder)}</span>`);
  if (isSmTeam()) {
    chips.push(`<span style="flex:1"></span>`);
    chips.push(`<button class="btn btn-ghost d-edit-meta-btn" id="d-edit-meta-btn" onclick="enterMetaEditMode()"><i data-icon="edit-2"></i> ${meta ? 'Edit Details' : 'Add Details'}</button>`);
  }
  document.getElementById('d-meta-strip').innerHTML = chips.join('');

  const infoCards = [];
  if (meta?.category)  infoCards.push(`<div class="info-card"><div class="info-card-label"><i data-icon="tag"></i> Category${meta.source === 'manual' || batchMetaEntries.some(e => e.source === 'manual' && e.match === 'exact' && e.pattern.toLowerCase() === job.name.toLowerCase() && e.category) ? ' <span style="font-size:8px;padding:1px 5px;background:rgba(242,100,25,.1);color:var(--orange);border-radius:4px;font-weight:700;letter-spacing:.04em">SM</span>' : ''}</div><div class="info-card-body">${escHtml(meta.category)}</div></div>`);
  if (meta?.parameter) infoCards.push(`<div class="info-card mono"><div class="info-card-label"><i data-icon="settings"></i> Parameter (สำหรับซ่อม)</div><div class="info-card-body">${escHtml(meta.parameter)}</div></div>`);
  if (meta?.note)      infoCards.push(`<div class="info-card"><div class="info-card-label"><i data-icon="edit"></i> Note</div><div class="info-card-body">${escHtml(meta.note)}</div></div>`);
  if (meta?.etc)       infoCards.push(`<div class="info-card"><div class="info-card-label">Etc</div><div class="info-card-body">${escHtml(meta.etc)}</div></div>`);

  // SM audit footer — "Added by X · Edited by Y" (only for manual entries)
  const manualEntry = batchMetaEntries.find(e =>
    e.match === 'exact' && e.source === 'manual' &&
    (e.pattern || '').toLowerCase() === job.name.toLowerCase()
  );
  if (manualEntry && (manualEntry.created_by || manualEntry.updated_by)) {
    infoCards.push(renderMetaAuditFooter(manualEntry));
  }
  document.getElementById('d-info-cards').innerHTML = infoCards.join('');
}

function fmtMetaTs(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Resolve the "latest action" for an entry — prefer history[last], else fall
// back to updated_*/created_* for entries created before history tracking.
function getLatestMetaAction(entry) {
  const hist = Array.isArray(entry?.history) ? entry.history : [];
  if (hist.length) {
    const last = hist[hist.length - 1];
    return { action: last.action || 'edit', by: last.by || '?', at: last.at || '' };
  }
  if (entry?.updated_by || entry?.updated_at) {
    const isSameAsCreate = entry.created_by && entry.updated_by === entry.created_by
                           && (!entry.updated_at || entry.updated_at === entry.created_at);
    return { action: isSameAsCreate ? 'add' : 'edit', by: entry.updated_by || entry.created_by || '?', at: entry.updated_at || entry.created_at || '' };
  }
  if (entry?.created_by || entry?.created_at) {
    return { action: 'add', by: entry.created_by || '?', at: entry.created_at || '' };
  }
  return null;
}

function renderMetaAuditFooter(entry) {
  const latest = getLatestMetaAction(entry);
  if (!latest) return '';
  const icon = latest.action === 'add' ? 'user-plus' : 'edit-2';
  const label = latest.action === 'add' ? 'Added by' : 'Edited by';
  const ts = fmtMetaTs(latest.at);
  const histCount = Array.isArray(entry.history) ? entry.history.length : 0;
  const btn = histCount > 0
    ? `<button class="meta-audit-hist-btn" onclick="openMetaHistory()" title="ดูประวัติการเปลี่ยนแปลง"><i data-icon="clock"></i> History${histCount > 1 ? ` (${histCount})` : ''}</button>`
    : '';
  return `<div class="meta-audit-footer">
    <span><i data-icon="${icon}"></i> ${label} <strong>${escHtml(latest.by)}</strong>${ts ? ` <span style="color:var(--text-muted)">· ${ts}</span>` : ''}</span>
    <span style="flex:1"></span>
    ${btn}
  </div>`;
}

// ── Metadata Change History modal ──────────────────────────────────
const META_FIELD_LABELS = {
  category:   'Category',
  dev_owner:  'DEV Owner',
  sm_rerun:   'SM Rerun',
  manual_url: 'Manual URL',
  parameter:  'Parameter',
  note:       'Note',
  etc:        'Etc',
};

function openMetaHistory() {
  if (!detailJob) return;
  const entry = batchMetaEntries.find(e =>
    e.match === 'exact' && e.source === 'manual' &&
    (e.pattern || '').toLowerCase() === detailJob.name.toLowerCase()
  );
  const hist = Array.isArray(entry?.history) ? entry.history.slice().reverse() : [];

  let body;
  if (!hist.length) {
    body = `<div class="mh-empty"><i data-icon="clock"></i> ยังไม่มีประวัติการเปลี่ยนแปลง (entry นี้อาจถูกสร้างก่อนที่ระบบจะเริ่มบันทึก history)</div>`;
  } else {
    body = hist.map((h, idx) => {
      const isLatest = idx === 0;
      const icon = h.action === 'add' ? 'user-plus' : 'edit-2';
      const label = h.action === 'add' ? 'Added' : 'Edited';
      const ts = fmtMetaTs(h.at);
      const changes = Array.isArray(h.changes) ? h.changes : [];
      const changesHtml = changes.length
        ? `<div class="mh-changes">${changes.map(c => `
            <div class="mh-change">
              <div class="mh-change-field">${escHtml(META_FIELD_LABELS[c.field] || c.field)}</div>
              <div class="mh-change-diff">
                ${c.from ? `<div class="mh-from"><span class="mh-tag">เดิม</span><span class="mh-val">${escHtml(c.from)}</span></div>` : `<div class="mh-from mh-empty-val"><span class="mh-tag">เดิม</span><span class="mh-val">— (ว่าง)</span></div>`}
                ${c.to   ? `<div class="mh-to"><span class="mh-tag">ใหม่</span><span class="mh-val">${escHtml(c.to)}</span></div>`   : `<div class="mh-to mh-empty-val"><span class="mh-tag">ใหม่</span><span class="mh-val">— (ว่าง)</span></div>`}
              </div>
            </div>
          `).join('')}</div>`
        : `<div class="mh-nochange">ไม่มีข้อมูลรายละเอียดการแก้ไข</div>`;
      return `
        <div class="mh-item ${isLatest ? 'is-latest' : ''}">
          <div class="mh-head">
            <span class="mh-badge mh-${h.action}"><i data-icon="${icon}"></i> ${label}</span>
            <span class="mh-by"><strong>${escHtml(h.by || '?')}</strong></span>
            <span class="mh-ts">${ts || ''}</span>
            ${isLatest ? '<span class="mh-latest-tag">ล่าสุด</span>' : ''}
          </div>
          ${changesHtml}
        </div>
      `;
    }).join('');
  }

  document.getElementById('mh-modal-title').textContent = detailJob.name;
  document.getElementById('mh-modal-body').innerHTML = body;
  document.getElementById('mh-modal').classList.add('open');
  if (window.Icons?.render) window.Icons.render();
}

function closeMetaHistory() {
  document.getElementById('mh-modal').classList.remove('open');
}

// ── Inline edit: enter / exit / save ──────────────────────────────
function enterMetaEditMode() {
  if (!detailJob) return;
  const meta = getJobMeta(detailJob.name) || {};
  const manualEntry = batchMetaEntries.find(e =>
    e.match === 'exact' && e.source === 'manual' &&
    e.pattern.toLowerCase() === detailJob.name.toLowerCase()
  );

  const smrVal = (() => {
    const v = (meta.sm_rerun || '').toLowerCase().trim();
    if (v === 'sm rerun' || v === 'yes') return 'SM Rerun';
    if (v.includes('inform')) return 'Inform TS';
    return '';
  })();

  document.getElementById('d-meta-edit').innerHTML = `
    <div class="me-form">
      <div class="me-row">
        <span class="me-label">Category</span>
        <input class="me-input" id="me-category" type="text" value="${escHtml(meta.category || '')}" placeholder="เช่น T24 / EKS Batch">
      </div>
      <div class="me-row">
        <span class="me-label">DEV Owner</span>
        <input class="me-input" id="me-dev-owner" type="text" value="${escHtml(meta.dev_owner || '')}" placeholder="ชื่อทีม / คนรับผิดชอบ">
      </div>
      <div class="me-row">
        <span class="me-label">SM Rerun</span>
        <select class="me-select" id="me-sm-rerun">
          <option value="">— ไม่ระบุ</option>
          <option value="SM Rerun"${smrVal === 'SM Rerun' ? ' selected' : ''}>SM Rerun (ทำได้เอง)</option>
          <option value="Inform TS"${smrVal === 'Inform TS' ? ' selected' : ''}>Inform TS (แจ้งทีม Dev)</option>
        </select>
      </div>
      <div class="me-row">
        <span class="me-label">Manual URL</span>
        <input class="me-input" id="me-manual-url" type="url" value="${escHtml(meta.manual_url && meta.manual_url !== '-' ? meta.manual_url : '')}" placeholder="https://…">
      </div>
      <div class="me-row tall">
        <span class="me-label">Parameter</span>
        <textarea class="me-textarea" id="me-parameter" placeholder="Parameter / ขั้นตอนซ่อม">${escHtml(meta.parameter || '')}</textarea>
      </div>
      <div class="me-row tall">
        <span class="me-label">Note</span>
        <textarea class="me-textarea" id="me-note" style="font-family:var(--font)" placeholder="หมายเหตุ">${escHtml(meta.note || '')}</textarea>
      </div>
      <div class="me-row tall">
        <span class="me-label">Etc</span>
        <textarea class="me-textarea" id="me-etc" style="font-family:var(--font)" placeholder="อื่นๆ">${escHtml(meta.etc || '')}</textarea>
      </div>
      ${manualEntry ? (() => {
        const latest = getLatestMetaAction(manualEntry);
        if (!latest) return '';
        const icon = latest.action === 'add' ? 'user-plus' : 'edit-2';
        const label = latest.action === 'add' ? 'Added by' : 'Edited by';
        const ts = fmtMetaTs(latest.at);
        const histCount = Array.isArray(manualEntry.history) ? manualEntry.history.length : 0;
        const btn = histCount > 0
          ? `<button type="button" class="meta-audit-hist-btn" onclick="openMetaHistory()"><i data-icon="clock"></i> History${histCount > 1 ? ` (${histCount})` : ''}</button>`
          : '';
        return `<div class="me-by"><span><i data-icon="${icon}"></i> ${label} <strong>${escHtml(latest.by)}</strong>${ts ? ` · ${ts}` : ''}</span><span style="flex:1"></span>${btn}</div>`;
      })() : ''}
      <div class="me-actions">
        <button class="btn btn-ghost" style="font-size:11px" onclick="exitMetaEditMode()">Cancel</button>
        <button class="btn btn-primary" style="font-size:11px" id="me-save-btn" onclick="saveMetaEdit()"><i data-icon="check"></i> Save</button>
      </div>
    </div>
  `;

  document.getElementById('d-info-cards').style.display = 'none';
  document.getElementById('d-meta-edit').style.display = '';
  const editBtn = document.getElementById('d-edit-meta-btn');
  if (editBtn) editBtn.disabled = true;
}

function exitMetaEditMode() {
  document.getElementById('d-meta-edit').style.display = 'none';
  document.getElementById('d-info-cards').style.display = '';
  const editBtn = document.getElementById('d-edit-meta-btn');
  if (editBtn) editBtn.disabled = false;
}

async function saveMetaEdit() {
  if (!detailJob) return;
  const btn = document.getElementById('me-save-btn');
  btn.disabled = true; btn.textContent = 'Saving…';

  const res = await API.batchMeta.upsertEntry({
    job_name:   detailJob.name,
    category:   document.getElementById('me-category').value.trim(),
    dev_owner:  document.getElementById('me-dev-owner').value.trim(),
    sm_rerun:   document.getElementById('me-sm-rerun').value.trim(),
    manual_url: document.getElementById('me-manual-url').value.trim(),
    parameter:  document.getElementById('me-parameter').value.trim(),
    note:       document.getElementById('me-note').value.trim(),
    etc:        document.getElementById('me-etc').value.trim(),
  });

  if (!res?.ok) {
    Toast.error(res?.data?.message || 'บันทึกไม่สำเร็จ');
    btn.disabled = false; btn.innerHTML = '<i data-icon="check"></i> Save';
    return;
  }

  await loadBatchMeta();
  Toast.success('บันทึกเรียบร้อย');
  exitMetaEditMode();
  renderDetailMeta(detailJob);
  // Refresh cards in the grid to reflect updated meta badges
  applyFilter();
}
function smRerunHtml(val) {
  const v = (val || '').toLowerCase().trim();
  if (!v || v === '-') return '';
  if (v === 'sm rerun' || v === 'yes') return `<span class="jc-sm-badge jc-sm-can"><i data-icon="circle"></i> SM Rerun</span>`;
  if (v.includes('inform'))            return `<span class="jc-sm-badge jc-sm-inf"><i data-icon="circle"></i> ${escHtml(val)}</span>`;
  return `<span class="jc-sm-badge jc-sm-other"><i data-icon="circle"></i> ${escHtml(val)}</span>`;
}

// ── Flatten helper ─────────────────────────────────────────────────
// Fetches top-level jobs (with nested job data), flattens folders one level deep.
// Returns flat array of job objects with optional _folder property.
async function fetchFlatJobs(serverId) {
  const res = await API.jenkins.jobs(serverId, FLAT_TREE);
  if (!res?.ok) return { ok: false, msg: res?.data?.message || 'Unknown error' };

  const topLevel = res.data.data?.jobs || [];
  const flat = [];

  for (const item of topLevel) {
    if (isFolder(item)) {
      const subJobs = item.jobs || [];
      subJobs.forEach(j => {
        if (!isFolder(j)) flat.push({ ...j, _folder: item.name });
      });
    } else {
      flat.push(item);
    }
  }

  // Apply job rules: filter ignore, attach remark + description
  const rules    = jobRulesMap[serverId] || [];
  const filtered = flat.filter(j => !jobMatchesRule(j.name, rules, 'ignore'));
  filtered.forEach(j => {
    const rm = getJobRemark(j.name, rules);
    if (rm) j._remark = rm;
    const dc = getJobDesc(j.name, rules);
    if (dc) j._desc = dc;
  });

  return { ok: true, jobs: filtered };
}

// ── Load jobs ──────────────────────────────────────────────────────
async function loadJobs() {
  document.getElementById('control-row').style.display = 'none';
  document.getElementById('nav-strip').style.display   = 'none';
  document.getElementById('jobs-container').innerHTML =
    `<div class="server-loading"><div class="spinner" style="display:inline-block;margin-right:8px"></div>Loading…</div>`;

  // Refresh job rules so newly-added rules take effect without hard reload
  const srvRes = await API.jenkins.servers();
  if (srvRes?.ok) {
    (srvRes.data.data || []).forEach(s => { jobRulesMap[s.id] = s.job_rules || []; });
  }

  const result = await fetchFlatJobs(activeServer);

  if (!result.ok) {
    const msg  = result.msg;
    const hint = msg.includes('expired') || msg.includes('cookie') || msg.includes('session')
      ? 'Cookie/session หมดอายุ — อัปเดตใน <a href="./admin/jenkins-servers.html" style="color:var(--orange)">Admin → Jenkins Servers</a>'
      : msg.includes('token') || msg.includes('credentials')
      ? 'Token ไม่ถูกต้อง — ตรวจสอบใน <a href="./admin/jenkins-servers.html" style="color:var(--orange)">Admin → Jenkins Servers</a>'
      : msg.includes('Cannot reach') ? 'ไม่สามารถเชื่อมต่อได้ — server อาจไม่ reachable จาก host นี้'
      : '';
    document.getElementById('jobs-container').innerHTML = `
      <div class="server-error">
        <div class="err-title"><i data-icon="alert-triangle"></i> ${escHtml(msg)}</div>
        ${hint ? `<div class="err-hint">${hint}</div>` : ''}
        <button class="btn btn-ghost" style="margin-top:12px;font-size:11px" onclick="loadJobs()">↺ Retry</button>
      </div>`;
    return;
  }

  // Pre-populate triggers from cache before rendering (instant for repeat loads)
  result.jobs.forEach(j => {
    const c = _triggerCache.get(j.url);
    if (c && Date.now() - c.ts < 300000) j._trigger = c.trigger;
  });

  currentJobs = result.jobs;
  updateSummary(result.jobs);
  document.getElementById('control-row').style.display = '';
  applyFilter();
  document.getElementById('last-refresh').textContent = 'Updated ' + new Date().toLocaleTimeString('th-TH');
  scheduleAutoRefresh();
  prefetchTriggers(result.jobs);  // background — patches cards as each arrives
}

// ── Sparkline + health helpers ─────────────────────────────────────
function buildSparkline(builds) {
  const src = builds || [];
  if (!src.length) {
    let empty = '';
    for (let i = 0; i < 12; i++) empty += '<div class="jc-bar b-abt" style="height:20%"></div>';
    return `<div class="jc-spark">${empty}</div>`;
  }
  const items = src.slice(0, 12).reverse();  // oldest → newest (left → right)
  // Avg of finished builds only — used as height for still-running bars
  const finished = items.filter(b => b.duration && b.result);
  const avgDur = finished.length ? finished.reduce((s,b) => s + b.duration, 0) / finished.length : 0;
  const maxDur = Math.max(...items.map(b => b.duration || avgDur), 1);
  return `<div class="jc-spark">${items.map((b, i) => {
    // Bar height = duration / max. Running (no result) uses avg as placeholder so it looks meaningful.
    const dur = b.duration || (!b.result ? avgDur : 0);
    const h = dur > 0 ? Math.max(30, Math.min(100, dur / maxDur * 100)) : 20;
    let cls;
    if (b.result === 'SUCCESS')       cls = 'b-ok';
    else if (b.result === 'FAILURE')  cls = 'b-err';
    else if (b.result === 'UNSTABLE') cls = 'b-wrn';
    else if (b.result === 'ABORTED' || b.result === 'NOT_BUILT') cls = 'b-abt';
    else cls = 'b-run';  // null result = running
    const cur = i === items.length - 1 ? ' b-current' : '';
    const durStr = b.duration ? fmtDuration(b.duration) : '—';
    return `<div class="jc-bar ${cls}${cur}" style="height:${h}%" title="#${b.number} · ${b.result || 'RUNNING'} · ${durStr}"></div>`;
  }).join('')}</div>`;
}

function computeHealth(builds) {
  const arr = (builds || []).filter(b => b.result);  // exclude running (null result)
  if (!arr.length) return { pct: null, ok: 0, total: 0, avgDur: 0 };
  const ok = arr.filter(b => b.result === 'SUCCESS').length;
  const pct = Math.round(ok / arr.length * 100);
  const avgDur = arr.reduce((s, b) => s + (b.duration || 0), 0) / arr.length;
  return { pct, ok, total: arr.length, avgDur };
}

// ── Render ─────────────────────────────────────────────────────────
function renderJobs(jobs) {
  const container = document.getElementById('jobs-container');
  // All jobs are already flat (no folders in list)
  const regular = jobs.filter(j => !isFolder(j));

  if (!regular.length) {
    document.getElementById('visible-count').textContent = '';
    container.innerHTML = '<div class="empty-jobs">No jobs found</div>';
    return;
  }

  // Sort by most-recent build timestamp desc
  regular.sort((a, b) => (b.lastBuild?.timestamp ?? 0) - (a.lastBuild?.timestamp ?? 0));
  document.getElementById('visible-count').textContent = `${regular.length} jobs`;

  _renderedJobs = regular;

  let html = '<div class="job-grid">';
  regular.forEach((job, idx) => {
    const info = COLOR_MAP[job.color] || { label:(job.color||'?').toUpperCase(), cls:'notbuilt' };
    const lb   = job.lastBuild;
    const buildNum = lb ? `#${lb.number}` : '—';
    const timeAgo  = lb?.timestamp ? DateTime.timeAgo(new Date(lb.timestamp).toISOString()) : '—';
    const duration = lb?.duration  ? fmtDuration(lb.duration) : '—';
    const trigger  = job._trigger || null;  // populated by prefetchTriggers()
    const triggerHtml = trigger
      ? `<div class="jc-trigger"><i data-icon="${trigger.type === 'user' ? 'user' : 'clock'}"></i> ${escHtml(trigger.name)}</div>`
      : '';

    const upCount   = (job.upstreamProjects  || []).length;
    const downCount = (job.downstreamProjects || []).length;
    const depBadges = (upCount || downCount) ? `
      <div class="dep-badges">
        ${upCount   ? `<span class="dep-badge dep-up"   title="${upCount} upstream">⬆${upCount}</span>` : ''}
        ${downCount ? `<span class="dep-badge dep-down" title="${downCount} downstream">⬇${downCount}</span>` : ''}
      </div>` : '';

    const folderTag = job._folder
      ? `<div class="jc-folder-tag"><i data-icon="folder"></i> ${escHtml(job._folder)}</div>` : '';

    const ticketRow = info.cls === 'failure'
      ? `<div class="jc-ticket-row">
           <button class="jc-ticket-btn" data-ticket-idx="${idx}"><i data-icon="ticket"></i> สร้าง Jira Ticket</button>
         </div>` : '';

    const descBlock = job._desc
      ? `<div class="jc-desc desc-${info.cls}" data-desc="${escHtml(job._desc)}"><div class="jc-desc-dot"></div><span class="jc-desc-text">${escHtml(job._desc)}</span></div>`
      : '';

    const meta = getJobMeta(job.name);
    const catBadge   = meta?.category  ? `<span class="jc-category" title="${escHtml(meta.category)}"><i data-icon="tag"></i> ${escHtml(meta.category.split('\n')[0])}</span>` : '';
    const ownerBadge = meta?.dev_owner ? `<span class="jc-owner"><i data-icon="user"></i> ${escHtml(meta.dev_owner)}</span>` : '';
    const smBadge    = meta ? smRerunHtml(meta.sm_rerun) : '';
    const manualBtn  = (meta?.manual_url && meta.manual_url !== '-')
      ? `<a href="${escHtml(meta.manual_url)}" target="_blank" rel="noopener" class="jc-manual-btn" title="เปิดคู่มือ" onclick="event.stopPropagation()"><i data-icon="book-open"></i></a>` : '';
    const hasDetails = meta && (meta.category || meta.parameter || meta.note || meta.etc);
    const infoBtn    = hasDetails
      ? `<button type="button" class="jc-info-btn${meta.parameter ? ' has-param' : ''}" data-job="${escHtml(job.name)}" title="ดู Category / Parameter / Note"><i data-icon="info"></i></button>` : '';

    // Ring: color from current status, % from history health
    const health = computeHealth(job.builds);
    const ringPct   = health.pct == null ? 100 : health.pct;
    const ringLabel = health.pct == null ? '—' : `${health.pct}%`;
    const ringSub   = info.cls === 'running' ? 'RUNNING' : (health.pct == null ? 'NO DATA' : 'HEALTH');

    // Sparkline + stats
    const sparkline = buildSparkline(job.builds);
    const avgStr = health.avgDur ? fmtDuration(health.avgDur) : '—';
    const statsRow = `<div class="jc-stats">
      <span><strong>${duration}</strong></span><span class="sep">·</span>
      <span>avg <strong>${avgStr}</strong></span><span class="sep">·</span>
      <span><strong>${health.ok}/${health.total || '—'}</strong> ok</span>
    </div>`;

    // Actions cluster (right side of meta row): 📖 ℹ deps ↗
    const actions = `<div class="jc-actions">
      ${manualBtn}${infoBtn}${depBadges}
      <a href="${escHtml(job.url)}" target="_blank" rel="noopener" class="jc-link" title="Open in Jenkins" data-external="1">↗</a>
    </div>`;

    const timeMatchBadge = job._timeMatch ? renderTimeMatchBadge(job._timeMatch) : '';
    const metaRow = `<div class="jc-meta-row">${timeMatchBadge}${catBadge}${ownerBadge}${smBadge}${actions}</div>`;

    html += `<div class="job-card" data-idx="${idx}">
      <div class="jc-ring card-${info.cls}" style="--ring-pct:${ringPct}%">
        <div class="jc-ring-inner">
          <div class="jc-ring-pct">${ringLabel}</div>
          <div class="jc-ring-lbl">${ringSub}</div>
        </div>
      </div>
      <div class="jc-body">
        <div class="jc-head">
          <div class="jc-status">
            <div class="job-status-dot dot-${info.cls}"></div>
            <span class="label-${info.cls}">${info.label}${lb ? ' · ' + buildNum : ''}</span>
          </div>
          <span class="jc-time">${timeAgo}</span>
        </div>
        ${triggerHtml}
        <div class="jc-name" title="${escHtml(job.name)}">${escHtml(job.name)}</div>
        ${descBlock}
        <div class="jc-spark-wrap">${sparkline}</div>
        ${statsRow}
        ${folderTag}
        ${metaRow}
        ${ticketRow}
      </div>
    </div>`;
  });
  html += '</div>';
  container.innerHTML = html;
}

// ── Job Detail Popup ───────────────────────────────────────────────
async function openDetail(job, jobPath) {
  try {
  detailJob = { ...job, _path: jobPath };

  // Set header immediately with info we already have
  const info = COLOR_MAP[job.color] || { label:(job.color||'?').toUpperCase(), cls:'notbuilt' };
  const lb   = job.lastBuild;
  document.getElementById('d-name').textContent = job.name;
  document.getElementById('d-meta').innerHTML = `
    <span class="job-status-dot dot-${info.cls}" style="width:7px;height:7px"></span>
    <span class="label-${info.cls}">${info.label}</span>
    ${lb ? `<span class="meta-sep">·</span><span>#${lb.number} · ${DateTime.timeAgo(new Date(lb.timestamp).toISOString())}</span>` : ''}`;
  document.getElementById('d-open-link').href = job.url || '#';
  document.getElementById('d-build-btn').disabled = false;
  document.getElementById('d-build-btn').className = 'build-now-btn';
  document.getElementById('d-build-btn').innerHTML = '<i data-icon="play"></i> Build Now';

  // Ring + sparkline + stats from current job.builds (populated from list fetch)
  const health = computeHealth(job.builds);
  const ringEl = document.getElementById('d-ring');
  ringEl.className = 'detail-hero-ring card-' + info.cls;
  ringEl.style.setProperty('--ring-pct', (health.pct == null ? 100 : health.pct) + '%');
  document.getElementById('d-ring-pct').textContent = health.pct == null ? '—' : (health.pct + '%');
  document.getElementById('d-ring-lbl').textContent = info.cls === 'running' ? 'RUNNING' : (health.pct == null ? 'NO DATA' : 'HEALTH');
  document.getElementById('d-hero-spark').innerHTML = buildSparkline(job.builds);
  const curDur = lb?.duration ? fmtDuration(lb.duration) : '—';
  const avgDurStr = health.avgDur ? fmtDuration(health.avgDur) : '—';
  document.getElementById('d-hero-stats').innerHTML = `
    <span><strong>${curDur}</strong></span><span class="sep">·</span>
    <span>avg <strong>${avgDurStr}</strong></span><span class="sep">·</span>
    <span><strong>${health.ok}/${health.total || '—'}</strong> ok</span>`;

  // Meta chips + info cards from batch_meta (+ SM edit button)
  renderDetailMeta(job);
  // Reset edit form state when opening a new job
  document.getElementById('d-meta-edit').style.display = 'none';
  document.getElementById('d-info-cards').style.display = '';

  // Reset detail sections
  document.getElementById('d-upstream').innerHTML   = '<span class="dep-loading">Loading…</span>';
  document.getElementById('d-downstream').innerHTML = '<span class="dep-loading">Loading…</span>';
  document.getElementById('d-builds').innerHTML     = '<div class="builds-loading"><div class="spinner" style="display:inline-block;margin-right:6px"></div>Loading…</div>';
  document.getElementById('d-next-build').textContent = '';

  document.getElementById('detail-modal').classList.add('open');

  // Fetch full detail
  const res = await API.jenkins.jobDetail(activeServer, jobPath, DETAIL_TREE);
  if (!res?.ok) {
    document.getElementById('d-upstream').innerHTML   = '<span class="dep-empty">Unable to load</span>';
    document.getElementById('d-downstream').innerHTML = '<span class="dep-empty">Unable to load</span>';
    document.getElementById('d-builds').innerHTML     = `<div style="padding:16px;text-align:center;font-size:12px;color:#dc2626"><i data-icon="alert-triangle"></i> ${escHtml(res?.data?.message || 'Failed to load detail')}</div>`;
    return;
  }

  const d = res.data.data;

  // Extract parameter definitions from property array
  const paramDefs = [];
  if (Array.isArray(d.property)) {
    for (const prop of d.property) {
      if (Array.isArray(prop.parameterDefinitions)) {
        paramDefs.push(...prop.parameterDefinitions);
      }
    }
  }
  detailJob._paramDefs = paramDefs;
  const buildBtn = document.getElementById('d-build-btn');
  buildBtn.innerHTML = paramDefs.length ? '<i data-icon="play"></i> Build with Parameters' : '<i data-icon="play"></i> Build Now';
  buildBtn.disabled = false;

  // Next build number
  if (d.nextBuildNumber) {
    document.getElementById('d-next-build').textContent = `next: #${d.nextBuildNumber}`;
  }

  // Upstream
  const upstream = d.upstreamProjects || job.upstreamProjects || [];
  document.getElementById('d-upstream').innerHTML = upstream.length
    ? upstream.map(p => `<a class="dep-job-link" href="${escHtml(p.url)}" target="_blank" title="${escHtml(p.name)}">${escHtml(p.name)}</a>`).join('')
    : '<span class="dep-empty">None — started manually or by schedule</span>';

  // Downstream
  const downstream = d.downstreamProjects || job.downstreamProjects || [];
  document.getElementById('d-downstream').innerHTML = downstream.length
    ? downstream.map(p => `<a class="dep-job-link" href="${escHtml(p.url)}" target="_blank" title="${escHtml(p.name)}">${escHtml(p.name)}</a>`).join('')
    : '<span class="dep-empty">None — no jobs depend on this</span>';

  // Build history
  const builds = d.builds || [];

  // Refresh hero ring + sparkline + stats using detail's build data (more up-to-date)
  if (builds.length) {
    const h2 = computeHealth(builds);
    document.getElementById('d-ring').style.setProperty('--ring-pct', (h2.pct == null ? 100 : h2.pct) + '%');
    document.getElementById('d-ring-pct').textContent = h2.pct == null ? '—' : (h2.pct + '%');
    document.getElementById('d-hero-spark').innerHTML = buildSparkline(builds);
    const cur2 = lb?.duration ? fmtDuration(lb.duration) : '—';
    const avg2 = h2.avgDur ? fmtDuration(h2.avgDur) : '—';
    document.getElementById('d-hero-stats').innerHTML = `
      <span><strong>${cur2}</strong></span><span class="sep">·</span>
      <span>avg <strong>${avg2}</strong></span><span class="sep">·</span>
      <span><strong>${h2.ok}/${h2.total || '—'}</strong> ok</span>`;
  }

  if (!builds.length) {
    document.getElementById('d-builds').innerHTML = '<div style="padding:16px;text-align:center;font-size:12px;color:var(--text-muted)">No builds yet</div>';
    return;
  }

  const buildsHtml = builds.map(b => {
    const result  = b.result || 'RUNNING';
    const bCls    = result === 'SUCCESS' ? 'success' : result === 'FAILURE' ? 'failure' :
                    result === 'UNSTABLE' ? 'unstable' : result === 'ABORTED' ? 'aborted' : 'running';
    const timeStr = b.timestamp ? DateTime.timeAgo(new Date(b.timestamp).toISOString()) : '—';
    const durStr  = b.duration  ? fmtDuration(b.duration) : '—';
    const bTrigger  = extractTrigger(b.causes);
    const causeStr  = b.causes?.[0]?.shortDescription || '';
    const triggerLabel = bTrigger
      ? `<span style="display:inline-flex;align-items:center;gap:2px;opacity:.7"><i data-icon="${bTrigger.type === 'user' ? 'user' : 'clock'}" style="font-size:9px"></i> ${escHtml(bTrigger.name)}</span>`
      : '';
    return `<div class="build-row">
      <div class="build-dot dot-${bCls}"></div>
      <span class="build-num">#${b.number}</span>
      <span class="build-status label-${bCls}">${result}</span>
      <span class="build-time" title="${escHtml(causeStr)}">${timeStr}${triggerLabel ? ' · ' + triggerLabel : ''}</span>
      <span class="build-dur">${durStr}</span>
      <a href="${escHtml(b.url)}" target="_blank" class="build-link">↗</a>
    </div>`;
  }).join('');
  document.getElementById('d-builds').innerHTML = buildsHtml;

  } catch(err) {
    console.error('[openDetail] error:', err);
    await SOMDialog.alert('Error opening detail: ' + err.message, { title: 'เกิดข้อผิดพลาด', icon: 'danger' });
  }
}

function closeDetail() {
  document.getElementById('detail-modal').classList.remove('open');
  detailJob = null;
}

// ── Build Trigger ──────────────────────────────────────────────────
async function triggerBuild() {
  if (!detailJob) return;

  // If job has parameters → open params modal instead
  if (detailJob._paramDefs?.length) {
    openBwpModal();
    return;
  }

  const btn = document.getElementById('d-build-btn');
  if (!await SOMDialog.confirm(`สั่ง build "${detailJob.name}" เลยใช่ไหม?`, { title: 'ยืนยัน', okLabel: 'Build', icon: 'question' })) return;

  btn.disabled = true;
  btn.textContent = '⏳ Queueing…';

  const res = await API.jenkins.build(activeServer, detailJob._path);

  if (res?.ok) {
    trackBatchMonitorCheck('trigger_build');
    btn.className = 'build-now-btn success';
    btn.innerHTML = '<i data-icon="check"></i> Queued!';
    setTimeout(() => {
      btn.className = 'build-now-btn';
      btn.innerHTML = '<i data-icon="play"></i> Build Now';
      btn.disabled = false;
    }, 3000);
  } else {
    const msg = res?.data?.message || 'Failed';
    btn.disabled = false;
    btn.innerHTML = '<i data-icon="play"></i> Build Now';
    await SOMDialog.alert(`Build failed: ${msg}`, { title: 'เกิดข้อผิดพลาด', icon: 'danger' });
  }
}

// ── Folder helpers ─────────────────────────────────────────────────
function isFolder(job) {
  const cls = (job._class || '').toLowerCase();
  return cls.includes('folder') || cls.includes('multibranch') || cls.includes('organizationfolder');
}

function getJobPath(job) {
  try {
    return new URL(job.url).pathname.replace(/\/$/, '');
  } catch {
    const srv = servers.find(s => s.id === activeServer);
    if (srv) return job.url.replace(srv.base_url, '').replace(/\/$/, '') || '/';
    return '/';
  }
}

function drillInto(path, name) {
  breadcrumbs.push({ label: name, path });
  loadJobs(path);
}

function goBack() {
  if (!breadcrumbs.length) return;
  breadcrumbs.pop();
  if (!breadcrumbs.length) { currentPath = ''; loadJobs(''); }
  else { const prev = breadcrumbs[breadcrumbs.length - 1]; loadJobs(prev.path); }
}

function navTo(index) {
  breadcrumbs = breadcrumbs.slice(0, index + 1);
  loadJobs(breadcrumbs[breadcrumbs.length - 1].path);
}

function renderNavStrip() {
  const strip = document.getElementById('nav-strip');
  const trail = document.getElementById('bc-trail');
  if (!breadcrumbs.length) { strip.style.display = 'none'; return; }
  strip.style.display = '';
  const srv = servers.find(s => s.id === activeServer);
  let html = `<span class="bc-item" onclick="selectServer('${activeServer}')">${escHtml(srv?.display || activeServer)}</span>`;
  breadcrumbs.forEach((item, i) => {
    html += `<span class="bc-sep">›</span>`;
    if (i < breadcrumbs.length - 1) html += `<span class="bc-item" onclick="navTo(${i})">${escHtml(item.label)}</span>`;
    else html += `<span class="bc-cur">${escHtml(item.label)}</span>`;
  });
  trail.innerHTML = html;
}

// ── Filter ─────────────────────────────────────────────────────────
function applyFilter() {
  const q      = document.getElementById('search-input').value.toLowerCase().trim();
  const status = document.getElementById('status-filter').value;
  let filtered = currentJobs.filter(j => !isFolder(j));
  if (q)      filtered = filtered.filter(j => j.name.toLowerCase().includes(q) || (j._folder||'').toLowerCase().includes(q));
  if (status) filtered = filtered.filter(j => (COLOR_MAP[j.color]||{}).cls === status);
  if (timeFilter.active) {
    filtered = filtered.filter(j => {
      const m = matchBuildInWindow(j, timeFilter);
      if (!m) { delete j._timeMatch; return false; }
      j._timeMatch = m;
      return true;
    });
  } else {
    filtered.forEach(j => { delete j._timeMatch; });
  }
  renderJobs(filtered);
}

// ── Time window helpers ───────────────────────────────────────────
function parseTimeMin(str) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(str || '');
  if (!m) return null;
  const h = parseInt(m[1], 10), mm = parseInt(m[2], 10);
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}
function computeTimeWindow(f) {
  const [y, mo, d] = f.date.split('-').map(Number);
  const base   = new Date(y, mo - 1, d, 0, 0, 0, 0).getTime();
  const startMs = base + f.startMin * 60000;
  let   endMs   = base + f.endMin   * 60000;
  if (f.endMin <= f.startMin) endMs += 24 * 60 * 60000;  // cross midnight
  return [startMs, endMs];
}
function matchBuildInWindow(job, f) {
  const [ws, we] = computeTimeWindow(f);
  const builds = job.builds || [];
  // Builds that STARTED inside window — pick earliest for badge
  const inWin = builds.filter(b => b.timestamp >= ws && b.timestamp <= we);
  if (inWin.length) {
    const b = inWin.reduce((a, c) => a.timestamp < c.timestamp ? a : c);
    return { build: b, kind: 'in' };
  }
  if (f.includeOverlap) {
    // Started BEFORE window but still running at ws (or ran through ws)
    const ov = builds.find(b => {
      if (b.timestamp >= ws) return false;
      if (b.result == null) return true;                                   // still running
      if (b.duration && (b.timestamp + b.duration) > ws) return true;      // ran into window
      return false;
    });
    if (ov) return { build: ov, kind: 'overlap' };
  }
  return null;
}
function renderTimeMatchBadge(m) {
  const t = new Date(m.build.timestamp);
  const hhmm = String(t.getHours()).padStart(2,'0') + ':' + String(t.getMinutes()).padStart(2,'0');
  const num  = m.build.number ? ` · #${m.build.number}` : '';
  if (m.kind === 'in') {
    return `<span class="jc-time-match" title="Started at ${hhmm} — in window"><i data-icon="play"></i> ${hhmm}${num}</span>`;
  }
  return `<span class="jc-time-match overlap" title="Started at ${hhmm} — running through window">⤵ ${hhmm}${num}</span>`;
}

// ── Time filter panel ─────────────────────────────────────────────
function toggleTimeFilterPanel(ev) {
  const panel = document.getElementById('time-filter-panel');
  const btn   = document.getElementById('time-filter-btn');
  if (panel.classList.contains('open')) { panel.classList.remove('open'); return; }

  // Fill date/time defaults if empty
  const dateEl = document.getElementById('tf-date');
  if (!dateEl.value) {
    const now = new Date();
    dateEl.value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  }
  if (timeFilter.active) {
    document.getElementById('tf-overlap').checked = timeFilter.includeOverlap;
  }
  updateCrossMidnightHint();

  // Position under the button, clamped to viewport
  const r  = btn.getBoundingClientRect();
  const pw = 290;
  let left = r.left;
  if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
  panel.style.top  = (r.bottom + 6) + 'px';
  panel.style.left = Math.max(8, left) + 'px';
  panel.classList.add('open');
  if (ev) ev.stopPropagation();
}
function updateCrossMidnightHint() {
  const s = parseTimeMin(document.getElementById('tf-start').value);
  const e = parseTimeMin(document.getElementById('tf-end').value);
  const h = document.getElementById('tf-cross-hint');
  h.style.display = (s != null && e != null && e <= s) ? 'block' : 'none';
}
function applyTimeFilter() {
  const date  = document.getElementById('tf-date').value;
  const sStr  = document.getElementById('tf-start').value;
  const eStr  = document.getElementById('tf-end').value;
  const ovr   = document.getElementById('tf-overlap').checked;
  const sMin  = parseTimeMin(sStr);
  const eMin  = parseTimeMin(eStr);
  if (!date || sMin == null || eMin == null) {
    (typeof Toast !== 'undefined' ? Toast.warning : alert)('กรุณาระบุวันที่และเวลา start/end');
    return;
  }
  timeFilter = { active:true, date, startMin:sMin, endMin:eMin, includeOverlap:ovr };
  document.getElementById('time-filter-panel').classList.remove('open');
  const btn = document.getElementById('time-filter-btn');
  btn.classList.add('active');
  const cross = eMin <= sMin ? '+' : '';
  const ovrTxt = ovr ? ' ⤵' : '';
  btn.textContent = `⏱ ${sStr}–${eStr}${cross}${ovrTxt}`;
  applyFilter();
}
function clearTimeFilter() {
  timeFilter.active = false;
  document.getElementById('time-filter-panel').classList.remove('open');
  const btn = document.getElementById('time-filter-btn');
  btn.classList.remove('active');
  btn.textContent = '⏱ Time';
  applyFilter();
}
// Close panel when clicking outside
document.addEventListener('mousedown', e => {
  const panel = document.getElementById('time-filter-panel');
  if (!panel || !panel.classList.contains('open')) return;
  if (e.target.closest('#time-filter-panel') || e.target.closest('#time-filter-btn')) return;
  panel.classList.remove('open');
});

// ── Export filtered jobs → CSV ────────────────────────────────────
function exportFilteredJobs() {
  const jobs = _renderedJobs || [];
  if (!jobs.length) {
    (typeof Toast !== 'undefined' ? Toast.warning : alert)('ไม่มี job ให้ export');
    return;
  }
  const srv    = servers.find(s => s.id === activeServer);
  const srvLbl = srv?.display || activeServer || '';
  const hasTime = timeFilter.active;

  const fmtDT = ts => ts ? new Date(ts).toLocaleString('sv-SE') : '';  // "YYYY-MM-DD HH:mm:ss"
  const headers = ['Server','Job Name','Folder','URL','Run Start','Run End'];
  const rows    = [headers];

  jobs.forEach(j => {
    // Prefer the matched build (from time filter) so exported "run time" = the run inside the window.
    // Fallback to lastBuild when time filter isn't active.
    const b = (hasTime && j._timeMatch?.build) || j.lastBuild || {};
    const runEnd = b.timestamp
      ? (b.result ? fmtDT(b.timestamp + (b.duration || 0)) : 'RUNNING')
      : '';
    rows.push([
      srvLbl, j.name, j._folder || '', j.url || '',
      fmtDT(b.timestamp), runEnd,
    ]);
  });

  const csv  = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type:'text/csv;charset=utf-8;' });

  const safeSrv = srvLbl.replace(/[^A-Za-z0-9_-]+/g, '_') || 'server';
  const now     = new Date();
  const stamp   = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
  let fname = `batch-monitor-${safeSrv}-${stamp}`;
  if (hasTime) {
    const fmtHM = m => `${String(Math.floor(m/60)).padStart(2,'0')}${String(m%60).padStart(2,'0')}`;
    const cross = timeFilter.endMin <= timeFilter.startMin ? 'x' : '';
    fname += `-${timeFilter.date}-${fmtHM(timeFilter.startMin)}-${fmtHM(timeFilter.endMin)}${cross}`;
    if (timeFilter.includeOverlap) fname += '-ov';
  }
  fname += '.csv';

  const a = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = fname;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);

  if (typeof Toast !== 'undefined') Toast.success(`Export ${jobs.length} jobs สำเร็จ`);
}

// ── Summary ────────────────────────────────────────────────────────
function updateSummary(jobs) {
  let ok=0, fail=0, run=0, aborted=0, other=0;
  jobs.forEach(j => {
    const cls = (COLOR_MAP[j.color]||{}).cls;
    if      (cls==='success') ok++;
    else if (cls==='failure') fail++;
    else if (cls==='running') run++;
    else if (cls==='aborted') aborted++;
    else if (j.color)         other++;
  });
  document.getElementById('cnt-ok').textContent      = ok;
  document.getElementById('cnt-fail').textContent    = fail;
  document.getElementById('cnt-run').textContent     = run;
  document.getElementById('cnt-aborted').textContent = aborted;
  document.getElementById('cnt-other').textContent   = other;
}

// ── Auto refresh ───────────────────────────────────────────────────
function scheduleAutoRefresh() {
  clearTimeout(autoTimer);
  if (autoRefresh) autoTimer = setTimeout(refreshCurrent, 60000);
}
function refreshCurrent() { if (activeServer) loadJobs(); }
function toggleAuto() {
  autoRefresh = !autoRefresh;
  document.getElementById('auto-toggle').classList.toggle('on', autoRefresh);
  if (autoRefresh) scheduleAutoRefresh(); else clearTimeout(autoTimer);
}

// ── Helpers ────────────────────────────────────────────────────────
function extractTrigger(causes) {
  if (!causes?.length) return null;
  const c = causes[0];
  if (c.userName) return { name: c.userName, type: 'user' };
  if (c.userId)   return { name: c.userId,   type: 'user' };
  const m = /^Started by user (.+)$/i.exec(c.shortDescription || '');
  if (m) return { name: m[1].trim(), type: 'user' };
  if (/timer/i.test(c.shortDescription))    return { name: 'Timer',    type: 'auto' };
  if (/upstream/i.test(c.shortDescription)) return { name: 'Upstream', type: 'auto' };
  if (c.shortDescription) return { name: c.shortDescription.substring(0, 40), type: 'auto' };
  return null;
}

// ── Trigger cache + background prefetch ────────────────────────────
// Jenkins list API doesn't expose causes at top-level, so we fetch
// per-job in the background after rendering and cache for 5 minutes.
const _triggerCache = new Map(); // url → { trigger, ts }

async function prefetchTriggers(jobs) {
  const toFetch = jobs.filter(j => {
    if (!j.lastBuild) return false;
    const c = _triggerCache.get(j.url);
    if (c && Date.now() - c.ts < 300000) { j._trigger = c.trigger; return false; }
    return !j._triggerPending;
  });
  const CONCURRENCY = 6;
  for (let i = 0; i < toFetch.length; i += CONCURRENCY) {
    await Promise.all(toFetch.slice(i, i + CONCURRENCY).map(async job => {
      job._triggerPending = true;
      try {
        const res = await API.jenkins.jobDetail(activeServer, getJobPath(job), 'lastBuild[causes[shortDescription,userId,userName]]');
        const causes = res?.ok ? (res.data?.data?.lastBuild?.causes || []) : [];
        job._trigger = extractTrigger(causes);
        _triggerCache.set(job.url, { trigger: job._trigger, ts: Date.now() });
      } catch(e) {
        job._trigger = null;
      } finally {
        delete job._triggerPending;
      }
      updateCardTrigger(job);
    }));
  }
}

function updateCardTrigger(job) {
  if (!job._trigger) return;
  const idx = _renderedJobs.indexOf(job);
  if (idx < 0) return;
  const card = document.querySelector(`.job-card[data-idx="${idx}"]`);
  if (!card) return;
  card.querySelector('.jc-trigger')?.remove();
  const head = card.querySelector('.jc-head');
  if (!head) return;
  const icon = job._trigger.type === 'user' ? 'user' : 'clock';
  const el = document.createElement('div');
  el.className = 'jc-trigger';
  el.innerHTML = `<i data-icon="${icon}"></i> ${escHtml(job._trigger.name)}`;
  head.insertAdjacentElement('afterend', el);
  if (window.Icons?.renderAll) Icons.renderAll(el);
}

function fmtDuration(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.floor(s/60)}m ${s%60}s`;
  return `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m`;
}

// ── One-time job row click delegation ──────────────────────────────
document.getElementById('jobs-container').addEventListener('click', e => {
  if (e.target.closest('[data-external]')) return;
  // Info button — open Category/Parameter/Note popover, don't open detail modal
  const infoBtn = e.target.closest('.jc-info-btn');
  if (infoBtn) {
    e.stopPropagation();
    const jobName = infoBtn.dataset.job || '';
    const meta = getJobMeta(jobName);
    if (meta) openInfoPopover(infoBtn, jobName, meta);
    return;
  }
  // Ticket button
  const ticketBtn = e.target.closest('[data-ticket-idx]');
  if (ticketBtn) {
    e.stopPropagation();
    const idx = parseInt(ticketBtn.dataset.ticketIdx, 10);
    const job = _renderedJobs[idx];
    if (job) openBatchTicketModal(job);
    return;
  }
  const row = e.target.closest('[data-idx]');
  if (!row) return;
  e.stopPropagation();
  const idx = parseInt(row.dataset.idx, 10);
  const job = _renderedJobs[idx];
  if (job) openDetail(job, getJobPath(job));
});

// Close modal on backdrop — use mousedown to avoid race with job-row click event
document.getElementById('detail-modal').addEventListener('mousedown', e => {
  if (e.target === e.currentTarget) closeDetail();
});
document.getElementById('bwp-modal').addEventListener('mousedown', e => {
  if (e.target === e.currentTarget) closeBwpModal();
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (document.getElementById('bwp-modal')?.classList.contains('open')) {
    closeBwpModal();
  } else if (document.getElementById('detail-modal')?.classList.contains('open')) {
    closeDetail();
  }
});

// ══════════════════════════════════════════════════════════════════
// BATCH TICKET MODAL
// ══════════════════════════════════════════════════════════════════
async function openBatchTicketModal(job) {
  batchTicketJob = job;

  // Pre-fill summary + fault start with current datetime
  const d = new Date();
  const dateStr = `${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()}`;
  document.getElementById('bt-summary').value = `${job.name} Fail — ${dateStr}`;
  // datetime-local value format: YYYY-MM-DDTHH:MM
  const pad = n => String(n).padStart(2, '0');
  const localDt = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  document.getElementById('bt-fault-start').value = localDt;

  // Load field options + issue types if not yet loaded
  if (!batchFieldOpts || !batchIssueTypes) {
    document.getElementById('bt-worktype').innerHTML = '<option value="">กำลังโหลด…</option>';
    document.getElementById('bt-priority').innerHTML = '<option value="">กำลังโหลด…</option>';
    document.getElementById('bt-issue').innerHTML    = '<option value="">กำลังโหลด…</option>';
    document.getElementById('bt-filetype').innerHTML = '<option value="">กำลังโหลด…</option>';
    document.getElementById('bt-modal').classList.add('open');

    const [fieldsRes, typesRes] = await Promise.all([
      batchFieldOpts  ? null : API.jira.batchFields(),
      batchIssueTypes ? null : API.jira.issueTypes(),
    ]);
    if (fieldsRes?.ok) batchFieldOpts  = fieldsRes.data.data;  else batchFieldOpts  = batchFieldOpts  || {};
    if (typesRes?.ok)  batchIssueTypes = typesRes.data.data;   else batchIssueTypes = batchIssueTypes || [];
  } else {
    document.getElementById('bt-modal').classList.add('open');
  }

  // Populate Work Type — default to first name containing "batch" (case-insensitive)
  const defaultWorkType = (batchIssueTypes.find(t => /batch/i.test(t.name)) || batchIssueTypes[0])?.name || '';
  document.getElementById('bt-worktype').innerHTML =
    `<option value="">— เลือก Work Type —</option>` +
    batchIssueTypes.map(t =>
      `<option value="${escHtml(t.name)}" ${t.name === defaultWorkType ? 'selected' : ''}>${escHtml(t.name)}</option>`
    ).join('');

  // Populate SM Priority
  const smOpts = batchFieldOpts?.sm_priority?.options || [];
  document.getElementById('bt-priority').innerHTML =
    `<option value="">— เลือก SM Priority —</option>` +
    smOpts.map(o => `<option value="${escHtml(o)}">${escHtml(o)}</option>`).join('');

  // Populate Batch Issue
  const biOpts = batchFieldOpts?.batch_issue?.options || [];
  document.getElementById('bt-issue').innerHTML =
    `<option value="">— เลือก Batch Issue —</option>` +
    biOpts.map(o => `<option value="${escHtml(o)}">${escHtml(o)}</option>`).join('');

  // Populate Batch File Type
  const ftOpts = batchFieldOpts?.batch_file_type?.options || [];
  document.getElementById('bt-filetype').innerHTML =
    `<option value="">— เลือก Batch File Type —</option>` +
    ftOpts.map(o => `<option value="${escHtml(o.value)}">${escHtml(o.value)}</option>`).join('');

  document.getElementById('bt-subtype-group').classList.remove('show');
  document.getElementById('bt-subtype').innerHTML = '<option value="">— เลือก Sub Type —</option>';
}

function onBatchFileTypeChange() {
  const selected = document.getElementById('bt-filetype').value;
  const ftOpts   = batchFieldOpts?.batch_file_type?.options || [];
  const found    = ftOpts.find(o => o.value === selected);
  const subGroup = document.getElementById('bt-subtype-group');
  const subSel   = document.getElementById('bt-subtype');

  if (found?.children?.length) {
    subSel.innerHTML = `<option value="">— เลือก Sub Type —</option>` +
      found.children.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');
    subGroup.classList.add('show');
  } else {
    subSel.innerHTML = '<option value="">— เลือก Sub Type —</option>';
    subGroup.classList.remove('show');
  }
}

function closeBatchTicketModal() {
  document.getElementById('bt-modal').classList.remove('open');
  batchTicketJob = null;
}

async function createBatchTicket() {
  const summary  = document.getElementById('bt-summary').value.trim();
  const priority = document.getElementById('bt-priority').value;
  const issue    = document.getElementById('bt-issue').value;
  const filetype = document.getElementById('bt-filetype').value;
  const subtype  = document.getElementById('bt-subtype').value;

  if (!summary)  { Toast.warning('กรุณากรอก Summary'); return; }
  if (!priority) { Toast.warning('กรุณาเลือก SM Priority'); return; }
  if (!issue)    { Toast.warning('กรุณาเลือก Batch Issue'); return; }
  if (!filetype) { Toast.warning('กรุณาเลือก Batch File Type'); return; }

  const hasSub = document.getElementById('bt-subtype-group').classList.contains('show');
  if (hasSub && !subtype) { Toast.warning('กรุณาเลือก Sub Type'); return; }

  const btn  = document.getElementById('bt-create-btn');
  const text = document.getElementById('bt-create-text');
  const spin = document.getElementById('bt-create-spin');
  btn.disabled = true;
  text.textContent = 'กำลังสร้าง…';
  spin.classList.remove('hidden');

  const worktype = document.getElementById('bt-worktype').value;
  if (!worktype) { Toast.warning('กรุณาเลือก Work Type'); return; }

  const faultStartVal = document.getElementById('bt-fault-start').value;
  if (!faultStartVal) { Toast.warning('กรุณาระบุ Fault Start'); return; }
  // Convert datetime-local (YYYY-MM-DDTHH:MM) → ISO 8601 with ms for Jira
  const faultStartIso = new Date(faultStartVal).toISOString().replace('Z', '+00:00');

  const fields = {
    issuetype:         worktype,
    customfield_17026: faultStartIso,
    customfield_17019: priority,
    customfield_17030: issue,
    customfield_17058: subtype ? { value: filetype, child: { value: subtype } } : { value: filetype },
  };

  const res = await API.jira.createTicket({ summary, fields });

  btn.disabled = false;
  text.textContent = '⚡ Create Ticket';
  spin.classList.add('hidden');

  if (res?.ok) {
    closeBatchTicketModal();
    const { issue_key, issue_url } = res.data.data;
    document.getElementById('bt-ticket-key').textContent = `Ticket: ${issue_key}`;
    document.getElementById('bt-ticket-link').href = issue_url;
    document.getElementById('bt-success-modal').classList.add('open');
  } else {
    Toast.error('ไม่สามารถสร้าง ticket ได้: ' + (res?.data?.message || 'Unknown error'));
  }
}

// ══════════════════════════════════════════════════════════════════
// BATCH RECORDS PANEL
// ══════════════════════════════════════════════════════════════════
let brecRows         = [];
let brecExpanded     = {};
let brecCancelClick  = null;
let brecCurrentMonth = new Date().toISOString().slice(0, 7);

function brecMonthLabel(ym) {
  const [y, m] = ym.split('-');
  const names = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  return `${names[parseInt(m)-1]} ${y}`;
}

async function brecLoadMonths() {
  try {
    const res = await brecFetch('./api/batch-records-admin.php?action=months');
    const months = Array.isArray(res.data) ? res.data : [];
    const sel = document.getElementById('brec-month-sel');
    if (!months.length) { sel.innerHTML = '<option value="">ไม่มีข้อมูล</option>'; return; }
    if (!months.includes(brecCurrentMonth)) months.unshift(brecCurrentMonth);
    sel.innerHTML = months.map(m =>
      `<option value="${m}" ${m === brecCurrentMonth ? 'selected' : ''}>${brecMonthLabel(m)}</option>`
    ).join('');
  } catch {}
}

function brecMonthChange(m) {
  brecCurrentMonth = m;
  brecLoad();
  const user = Auth.getUser ? Auth.getUser() : null;
  if (isSmCoverageAdminUser(user)) covLoad().catch(() => {});
}

function brecClearCancel() {
  if (brecCancelClick) { document.removeEventListener('click', brecCancelClick); brecCancelClick = null; }
}

function brecAuthHdr() {
  const t = Auth.getToken ? Auth.getToken()
    : (localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token') || '');
  return t ? { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' }
           : { 'Content-Type': 'application/json' };
}
async function brecFetch(url, opts = {}) {
  opts.headers = { ...brecAuthHdr(), ...(opts.headers || {}) };
  const r = await fetch(url, opts);
  return r.json();
}

async function openBatchRecords() {
  document.getElementById('brec-overlay').classList.add('open');
  // Show Clear All only for admins
  const user = Auth.getUser ? Auth.getUser() : null;
  const clearBtn = document.getElementById('brec-clear-btn');
  if (clearBtn) clearBtn.style.display = (['super_admin', 'sm_admin', 'dev_sm'].includes(user?.role)) ? '' : 'none';
  brecApplyLock();
  await brecLoad();
  // Warm up the Coverage badge even if the user stays on the Records tab —
  // but skip the fetch entirely for non-admins (backend would 403 anyway).
  if (isSmCoverageAdminUser(user)) covLoad().catch(() => {});
}
function closeBatchRecords() {
  brecClearCancel();
  document.getElementById('brec-overlay').classList.remove('open');
}
function brecBackdropClose(e) {
  if (e.target === document.getElementById('brec-overlay')) closeBatchRecords();
}

// ── Resize handle ─────────────────────────────────────────────────
(function() {
  let startX, startW;
  const handle = document.getElementById('brec-resize-handle');
  const panel  = document.getElementById('brec-panel');
  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    startX = e.clientX;
    startW = panel.offsetWidth;
    handle.classList.add('dragging');
    document.body.classList.add('brec-resizing');
    function onMove(ev) {
      const delta = startX - ev.clientX;          // dragging left = wider
      const newW  = Math.min(Math.max(startW + delta, 480), window.innerWidth - 60);
      panel.style.width = newW + 'px';
    }
    function onUp() {
      handle.classList.remove('dragging');
      document.body.classList.remove('brec-resizing');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
})();

async function brecLoad() {
  brecLoadMonths();
  document.getElementById('brec-tbody').innerHTML =
    `<tr><td colspan="8" style="padding:32px;text-align:center;color:var(--text-muted)">
       <div class="spinner" style="display:inline-block;margin-right:8px"></div>กำลังโหลด…</td></tr>`;
  document.getElementById('brec-count').textContent = '';

  let records = [];
  try {
    const json = await brecFetch(`./api/batch-records-admin.php?action=list&month=${brecCurrentMonth}`);
    records = Array.isArray(json.data) ? json.data : [];
  } catch { records = []; }

  brecRows     = records;
  brecExpanded = {};
  brecRender();
}

function brecRender() {
  brecClearCancel();
  const tbody = document.getElementById('brec-tbody');
  document.getElementById('brec-count').textContent = `${brecRows.length} รายการ`;

  if (!brecRows.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="padding:40px;text-align:center;color:var(--text-muted);font-size:12px">ยังไม่มีบันทึก</td></tr>`;
    return;
  }

  let html = '';
  brecRows.forEach((rec) => {
    const jobs     = rec.jobs || {};
    const jobNames = Object.keys(jobs);
    const total    = jobNames.length;
    const ok       = jobNames.filter(n => jobs[n].status === 'Success').length;
    const fail     = jobNames.filter(n => jobs[n].status === 'Fail').length;
    const na       = total - ok - fail;
    const isOpen   = !!brecExpanded[rec.id];

    const dt = rec.timestamp ? new Date(rec.timestamp).toLocaleString('th-TH', {
      year:'numeric', month:'short', day:'numeric',
      hour:'2-digit', minute:'2-digit'
    }) : '—';

    const editedBadge = rec.edited_at
      ? `<span class="brec-ed-badge">✏️ ${escHtml(rec.edited_by||'')} ${new Date(rec.edited_at).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})}</span>`
      : '';

    const rid = escHtml(rec.id);
    html += `<tr data-brid="${rid}">
      <td><div class="brec-td"><button class="brec-exp${isOpen?' open':''}" onclick="brecToggle('${rid}')">▼</button></div></td>
      <td class="brec-td-ed" onclick="brecTextClick(this,'${rid}','timestamp')">
        <div class="brec-td" style="font-size:10px"><span class="cv">${dt}</span><span class="brec-ed-hint">✏</span></div>
      </td>
      <td><div class="brec-td"><strong>${escHtml(rec.server || '—')}</strong></div></td>
      <td class="brec-td-ed" onclick="brecTextClick(this,'${rid}','reporter')">
        <div class="brec-td" style="color:var(--text-muted)"><span class="cv">${escHtml(rec.reporter || '—')}</span><span class="brec-ed-hint">✏</span></div>
      </td>
      <td><div class="brec-td">${total} jobs</div></td>
      <td><div class="brec-td">
        <div class="brec-sum">
          ${ok   ? `<span class="s">✅ ${ok}</span>`   : ''}
          ${fail ? `<span class="f">❌ ${fail}</span>` : ''}
          ${na   ? `<span class="n">— ${na}</span>`    : ''}
        </div>
      </div></td>
      <td><div class="brec-td">${editedBadge}</div></td>
      <td><div class="brec-td" style="justify-content:center">
        <button class="btn btn-danger btn-sm" onclick="brecDelete('${rid}','${escHtml(dt)}')" title="ลบ record">🗑️</button>
      </div></td>
    </tr>`;

    if (isOpen) {
      jobNames.forEach(name => {
        const j = jobs[name];
        const pillCls = j.status === 'Success' ? 's' : j.status === 'Fail' ? 'f' : 'n';
        const pillTxt = j.status === 'Success' ? '✅ Success' : j.status === 'Fail' ? '❌ Fail' : '— N/A';
        const folder  = j.folder ? `<span style="font-size:9px;color:var(--text-muted);margin-left:4px">📁 ${escHtml(j.folder)}</span>` : '';
        const jn = escHtml(name).replace(/'/g, '\\x27');
        html += `<tr class="brec-sub">
          <td></td>
          <td colspan="2"><div class="brec-td" style="padding-left:20px">
            ${escHtml(name)}${folder}
          </div></td>
          <td colspan="2"><div class="brec-td">
            <span class="brec-pill ${pillCls}" onclick="brecJobStatusClick(this,'${rid}','${jn}')" style="cursor:pointer" title="คลิกเพื่อเปลี่ยน Status">${pillTxt}</span>
          </div></td>
          <td colspan="2"><div class="brec-td" style="color:var(--text-muted);font-size:10px">${escHtml(j.remark || '')}</div></td>
          <td></td>
        </tr>`;
      });
    }
  });

  tbody.innerHTML = html;
}

function brecToggle(id) {
  brecExpanded[id] = !brecExpanded[id];
  brecRender();
}

// ── Inline text edit (timestamp / reporter) ───────────────────────
function brecTextClick(td, recId, field) {
  if (td.querySelector('input')) return;
  brecClearCancel();
  const inner = td.querySelector('.brec-td');
  const rec   = brecRows.find(r => r.id === recId);
  if (!rec) return;

  const inp = document.createElement('input');
  inp.className = 'brec-ci-input';
  if (field === 'timestamp') {
    inp.type = 'datetime-local';
    const dt = new Date(rec.timestamp);
    inp.value = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}T${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
  } else {
    inp.type  = 'text';
    inp.value = rec.reporter || '';
  }
  inner.innerHTML = '';
  inner.appendChild(inp);
  inp.focus();

  let committed = false;
  const commit = async () => {
    if (committed) return;
    committed = true;
    const v = inp.value.trim();
    if (!v) { brecRender(); return; }
    const payload = { id: recId };
    if (field === 'timestamp') payload.timestamp = new Date(v).toISOString();
    else payload.reporter = v;
    inner.innerHTML = '<span class="brec-saving-dot"></span>';
    try {
      const res = await brecFetch(`./api/batch-records-admin.php?action=edit&month=${brecCurrentMonth}`, { method:'POST', body: JSON.stringify(payload) });
      if (res.success) { Object.assign(rec, res.data); brecRender(); }
      else { inner.innerHTML = `<span style="color:#ef4444;font-size:10px">❌</span>`; setTimeout(brecRender, 1200); }
    } catch { inner.innerHTML = `<span style="color:#ef4444;font-size:10px">❌</span>`; setTimeout(brecRender, 1200); }
  };
  inp.addEventListener('blur', commit);
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { committed = true; brecRender(); }
  });
}

// ── Inline job status toggle ──────────────────────────────────────
function brecJobStatusClick(pill, recId, jobName) {
  const container = pill.parentElement;
  if (container?.querySelector('.brec-isel')) return;
  brecClearCancel();

  const rec  = brecRows.find(r => r.id === recId);
  if (!rec) return;

  const sel = document.createElement('span');
  sel.className = 'brec-isel';
  sel.innerHTML = ['Success','Fail','NA'].map(v =>
    `<button type="button" class="brec-isel-btn" data-v="${v}">${v==='Success'?'✅ Success':v==='Fail'?'❌ Fail':'— N/A'}</button>`
  ).join('');
  pill.replaceWith(sel);

  sel.querySelectorAll('.brec-isel-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      brecClearCancel();
      const newStatus = btn.dataset.v;
      const newJobs   = JSON.parse(JSON.stringify(rec.jobs || {}));
      if (!newJobs[jobName]) newJobs[jobName] = {};
      newJobs[jobName].status = newStatus;
      sel.replaceWith(document.createTextNode('…'));
      try {
        const res = await brecFetch(`./api/batch-records-admin.php?action=edit&month=${brecCurrentMonth}`, {
          method: 'POST', body: JSON.stringify({ id: recId, jobs: newJobs }),
        });
        if (res.success) Object.assign(rec, res.data);
      } catch { }
      brecRender();
    });
  });

  setTimeout(() => {
    brecCancelClick = function(e) {
      if (!sel.contains(e.target)) { brecClearCancel(); brecRender(); }
    };
    document.addEventListener('click', brecCancelClick);
  }, 0);
}

// ── Delete record ─────────────────────────────────────────────────
async function brecDelete(recId, dateTime) {
  if (!await SOMDialog.confirm(`ต้องการลบ record นี้?\n\n${dateTime}\n\nการลบจะถูกบันทึกใน activity log`, { title: 'ยืนยันการลบ', okLabel: 'ลบ', icon: 'danger', okColor: 'danger' })) return;
  try {
    const res = await brecFetch(`./api/batch-records-admin.php?action=delete&month=${brecCurrentMonth}`, {
      method: 'POST', body: JSON.stringify({ id: recId }),
    });
    if (res.success) {
      brecRows = brecRows.filter(r => r.id !== recId);
      delete brecExpanded[recId];
      document.getElementById('brec-count').textContent = `${brecRows.length} รายการ`;
      brecRender();
      Toast.success('ลบ record สำเร็จ');
    } else {
      throw new Error(res.message || 'ลบไม่สำเร็จ');
    }
  } catch(err) { Toast.error('ลบไม่สำเร็จ: ' + err.message); }
}

// ── Clear All (admin) ─────────────────────────────────────────────
async function brecClearAll() {
  if (!await SOMDialog.confirm(`ต้องการลบ record ทั้งหมด ${brecRows.length} รายการ?\n\nการลบจะไม่สามารถย้อนกลับได้`, { title: 'ยืนยันการลบ', okLabel: 'ลบทั้งหมด', icon: 'danger', okColor: 'danger' })) return;
  try {
    const res = await brecFetch(`./api/batch-records-admin.php?action=clear&month=${brecCurrentMonth}`, { method:'POST', body:'{}' });
    if (res.success) {
      brecRows = [];
      brecExpanded = {};
      brecRender();
      Toast.success(`ลบทั้งหมดแล้ว (${res.data?.deleted_count ?? 0} รายการ)`);
    } else {
      throw new Error(res.message || 'ลบไม่สำเร็จ');
    }
  } catch(err) { Toast.error('ลบไม่สำเร็จ: ' + err.message); }
}

function brecExportCSV() {
  if (!brecRows.length) { Toast.warning('ไม่มีข้อมูลสำหรับ export'); return; }

  const rows = [['วันที่', 'Server', 'ผู้รายงาน', 'Job', 'Folder', 'Status', 'Remark']];
  brecRows.forEach(rec => {
    const jobs = rec.jobs || {};
    Object.entries(jobs).forEach(([name, j]) => {
      rows.push([
        rec.timestamp ? new Date(rec.timestamp).toLocaleString('th-TH') : '',
        rec.server  || '',
        rec.reporter || '',
        name,
        j.folder  || '',
        j.status  || '',
        j.remark  || '',
      ]);
    });
  });

  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `batch-records-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

// ══════════════════════════════════════════════════════════════════
// COVERAGE VIEW (Batch Records panel — sub-view)
// ══════════════════════════════════════════════════════════════════
let covData    = null;    // last coverage response
let covView    = 'records';

// SM-team admin only — matches api/helpers.php isSmCoverageAdmin(). Coverage
// (view + backfill) is an SM ops feature; other teams' admins can't see it.
function isSmCoverageAdminUser(u) {
  if (!u) return false;
  if (u.role === 'super_admin') return true;
  if (!['sm_admin', 'dev_sm'].includes(u.role)) return false;
  return u.team === 'sm';
}

function brecApplyLock() {
  const user = Auth.getUser ? Auth.getUser() : null;
  const locked = !isSmCoverageAdminUser(user);
  const tab = document.getElementById('brec-tab-coverage');
  if (!tab) return;
  tab.classList.toggle('locked', locked);
  tab.dataset.locked = locked ? '1' : '';
  tab.title = locked ? 'เฉพาะ admin ของทีม sm เท่านั้น' : '';
  // Replace the leading emoji with a lock so it reads at a glance.
  const badge = document.getElementById('brec-tab-miss-badge');
  const badgeHtml = badge ? badge.outerHTML : '';
  tab.innerHTML = (locked ? '<i data-icon="lock"></i>' : '<i data-icon="calendar"></i>') + ' Coverage ' + badgeHtml;
}

function brecSwitchView(name) {
  // Enforce lock at the click gate too (defense in depth vs. inspector).
  if (name === 'coverage') {
    const tab = document.getElementById('brec-tab-coverage');
    if (tab?.dataset.locked === '1') {
      Toast.warning('เฉพาะ admin ของทีม sm เท่านั้น');
      return;
    }
  }
  covView = name;
  document.getElementById('brec-tab-records').classList.toggle('active',  name === 'records');
  document.getElementById('brec-tab-coverage').classList.toggle('active', name === 'coverage');
  document.getElementById('brec-view-records').classList.toggle('active',  name === 'records');
  document.getElementById('brec-view-coverage').classList.toggle('active', name === 'coverage');
  if (name === 'coverage') covLoad();
}

async function covLoad() {
  const list = document.getElementById('cov-list');
  list.innerHTML = `<div class="cov-empty"><div class="spinner" style="display:inline-block;margin-right:8px"></div>กำลังโหลด…</div>`;
  document.getElementById('cov-summary').innerHTML = '';
  try {
    const json = await brecFetch(`./api/batch-records.php?action=coverage&month=${brecCurrentMonth}`);
    covData = json?.data || null;
  } catch { covData = null; }
  covRender();
  covUpdateBadge();
}

function covUpdateBadge() {
  const badge = document.getElementById('brec-tab-miss-badge');
  if (!badge || !covData) { if (badge) badge.style.display = 'none'; return; }
  const n = (covData.summary?.missing || 0) + (covData.summary?.partial || 0);
  if (n > 0) { badge.textContent = String(n); badge.style.display = ''; }
  else       { badge.style.display = 'none'; }
}

function covRender() {
  const list = document.getElementById('cov-list');
  const sumEl = document.getElementById('cov-summary');
  if (!covData) {
    list.innerHTML = `<div class="cov-empty">โหลดข้อมูลไม่สำเร็จ</div>`;
    sumEl.innerHTML = '';
    return;
  }
  const s = covData.summary || {};
  sumEl.innerHTML =
      `<span class="cov-chip ok"><i data-icon="check-circle"></i> ครบ ${s.ok||0} วัน</span>` +
      `<span class="cov-chip partial"><i data-icon="alert-triangle"></i> ไม่ครบ ${s.partial||0} วัน</span>` +
      `<span class="cov-chip missing"><i data-icon="x-circle"></i> ขาด ${s.missing||0} วัน</span>` +
      (s.future ? `<span class="cov-chip future">⏳ ยังไม่ถึง ${s.future} วัน</span>` : '') +
      `<span class="cov-legend">Expected servers: ${(covData.expected_servers||[]).length ? (covData.expected_servers||[]).map(escHtml).join(' · ') : '—'}</span>`;

  const onlyMiss    = document.getElementById('cov-only-missing').checked;
  const hideWeekend = document.getElementById('cov-hide-weekend').checked;
  const hideHoliday = document.getElementById('cov-hide-holiday').checked;
  const hideFuture  = document.getElementById('cov-hide-future').checked;

  const rows = (covData.days || []).filter(d => {
    if (hideFuture  && d.future)          return false;
    if (hideWeekend && d.is_weekend)      return false;
    if (hideHoliday && d.holiday)         return false;
    if (onlyMiss    && d.status === 'ok') return false;
    if (onlyMiss    && d.status === 'future') return false;
    return true;
  });

  if (!rows.length) {
    list.innerHTML = `<div class="cov-empty">ไม่มีวันที่ตรงเงื่อนไข</div>`;
    return;
  }

  const today = covData.today;
  list.innerHTML = rows.map(d => {
    const cls = [
      'cov-row',
      d.date === today ? 'today' : '',
      d.holiday ? 'holiday' : '',
      (d.is_weekend && !d.holiday) ? 'weekend' : '',
    ].filter(Boolean).join(' ');

    const dateObj = new Date(d.date + 'T00:00:00');
    const thDate  = dateObj.toLocaleDateString('th-TH', { day:'numeric', month:'short' });
    const wknd    = d.is_weekend ? `<span class="cov-tag wknd">${escHtml(d.weekday)}</span>` : '';
    const hol     = d.holiday    ? `<span class="cov-tag hol" title="${escHtml(d.holiday)}">🌸 หยุด</span>` : '';
    const bf      = d.backfilled ? `<span class="cov-tag bf" title="Backfilled"><i data-icon="edit"></i> ย้อนหลัง ${d.backfilled}</span>` : '';

    const statusLbl = { ok:'<i data-icon="check-circle"></i> ครบ', partial:'<i data-icon="alert-triangle"></i> ไม่ครบ', missing:'<i data-icon="x-circle"></i> ขาด', future:'⏳ ยังไม่ถึง' }[d.status] || d.status;

    // Server chips: green (have) + red strikethrough (missing).
    const expected = covData.expected_servers || [];
    let chips;
    if (!expected.length) {
      chips = d.submitted_servers.length
        ? d.submitted_servers.map(s => `<span class="cov-srv have">${escHtml(s)}</span>`).join('')
        : `<span style="color:var(--text-muted);font-size:10px">— ไม่มีบันทึก —</span>`;
    } else {
      const submittedSet = new Set(d.submitted_servers);
      chips = expected.map(srv => submittedSet.has(srv)
        ? `<span class="cov-srv have"><i data-icon="check"></i> ${escHtml(srv)}</span>`
        : `<span class="cov-srv missing">${escHtml(srv)}</span>`
      ).join('');
    }

    const actions = (d.status === 'missing' || d.status === 'partial')
      ? `<button class="cov-btn primary" onclick="covBackfill('${d.date}')"><i data-icon="edit"></i> บันทึกย้อนหลัง</button>`
      : (d.records ? `<button class="cov-btn" onclick="covViewDay('${d.date}')"><i data-icon="eye"></i> ดู</button>` : '');

    return `<div class="${cls}">
      <div class="cov-date">
        <div class="cov-date-main">${escHtml(thDate)}${wknd}${hol}${bf}</div>
        <div class="cov-date-sub">${escHtml(d.date)} · ${escHtml(d.weekday)}</div>
      </div>
      <div><span class="cov-status ${d.status}">${statusLbl}</span></div>
      <div class="cov-servers">${chips}</div>
      <div class="cov-actions">${actions}</div>
    </div>`;
  }).join('');
}

function covBackfill(dateStr) {
  const u = Auth.getUser ? Auth.getUser() : null;
  if (!isSmCoverageAdminUser(u)) { Toast.warning('เฉพาะ admin ของทีม sm เท่านั้น'); return; }
  closeBatchRecords();
  // openBatchReport reads window.__brpBackfillDate to override the timestamp.
  window.__brpBackfillDate = dateStr;
  if (typeof openBatchReport === 'function') openBatchReport();
}

function covViewDay(dateStr) {
  // Switch to Records view and hint the user to look at that date.
  brecSwitchView('records');
  Toast.info?.(`กรองในตาราง Records เพื่อดูรายการของ ${dateStr}`) || Toast.success(`ดูรายการของ ${dateStr}`);
}

// ══════════════════════════════════════════════════════════════════
// BATCH REPORT PANEL
// ══════════════════════════════════════════════════════════════════
async function openBatchReport() {
  // Backfill flow: window.__brpBackfillDate is set by covBackfill() before opening.
  const backfillDate = window.__brpBackfillDate || null;
  window.__brpBackfillDate = null;   // consume, so a re-open defaults to "today"
  window.__brpActiveBackfill = backfillDate;

  const displayDate = backfillDate ? new Date(backfillDate + 'T00:00:00') : new Date();
  const dateLbl = displayDate.toLocaleDateString('th-TH', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  document.getElementById('brp-datetime').innerHTML = backfillDate
    ? `<span style="display:inline-flex;align-items:center;gap:6px;padding:2px 10px;border-radius:99px;background:rgba(37,99,235,.12);color:#1d4ed8;font-weight:700"><i data-icon="edit"></i> บันทึกย้อนหลัง</span> ${escHtml(dateLbl)}`
    : escHtml(dateLbl);

  try {
    const user = Auth.getUser ? Auth.getUser() : JSON.parse(localStorage.getItem('auth_user') || '{}');
    document.getElementById('brp-reporter').innerHTML = '<i data-icon="user"></i> ' + (user?.email || user?.username || '');
  } catch { }

  document.getElementById('brp-overlay').classList.add('open');
  document.getElementById('brp-body').innerHTML =
    `<div class="server-loading"><div class="spinner" style="display:inline-block;margin-right:8px"></div>กำลังโหลด jobs…</div>`;

  // Fetch all servers in parallel
  brpAllJobs = {};
  await Promise.all(servers.map(async s => {
    const r = await fetchFlatJobs(s.id);
    brpAllJobs[s.id] = r.ok ? r.jobs.filter(j => !isFolder(j)) : [];
  }));

  // Render server tabs
  const tabHtml = servers.map((s, i) =>
    `<button class="brp-srv-tab${i===0?' active':''}" onclick="brpSelectTab('${s.id}')">${escHtml(s.display)}</button>`
  ).join('');
  document.getElementById('brp-server-tabs').innerHTML = tabHtml;

  brpActiveTab = servers[0]?.id || null;
  brpRenderTab();
}

function brpSelectTab(serverId) {
  brpActiveTab = serverId;
  document.querySelectorAll('.brp-srv-tab').forEach(btn => {
    btn.classList.toggle('active', btn.textContent === servers.find(s=>s.id===serverId)?.display);
  });
  brpRenderTab();
}

function brpRenderTab() {
  const jobs = brpAllJobs[brpActiveTab] || [];
  const body = document.getElementById('brp-body');
  if (!jobs.length) {
    body.innerHTML = '<div style="padding:32px;text-align:center;font-size:12px;color:var(--text-muted)">ไม่พบ job</div>';
    return;
  }

  // Sort by name
  const sorted = [...jobs].sort((a,b) => a.name.localeCompare(b.name));

  body.innerHTML = sorted.map((job, idx) => {
    const info       = COLOR_MAP[job.color] || { label:'?', cls:'notbuilt' };
    const defaultV   = info.cls === 'success' ? 'Success' : info.cls === 'failure' ? 'Fail' : 'NA';
    const folderInfo = job._folder ? `<span style="font-size:9px;color:var(--text-muted);margin-left:4px"><i data-icon="folder"></i> ${escHtml(job._folder)}</span>` : '';
    const preRemark  = job._remark || '';
    const remarkStyle = preRemark
      ? 'border-color:rgba(37,99,235,.4);background:rgba(37,99,235,.04);'
      : '';
    const remarkBadge = preRemark
      ? `<span title="${escHtml(preRemark)}" style="cursor:help;font-size:10px;margin-left:5px;padding:1px 5px;border-radius:3px;background:rgba(37,99,235,.1);color:#2563eb;white-space:nowrap;flex-shrink:0"><i data-icon="info"></i></span>`
      : '';

    return `<div class="brp-job-row" style="${preRemark ? 'border-left:3px solid rgba(37,99,235,.35);' : ''}">
      <div style="flex:1;min-width:0;display:flex;align-items:center;gap:2px">
        <div class="brp-job-name">${escHtml(job.name)}${folderInfo}</div>
        ${remarkBadge}
      </div>
      <div class="brp-toggle" data-brp-name="${escHtml(brpActiveTab)}__${escHtml(job.name)}__status">
        <button type="button" class="brp-toggle-btn${defaultV==='Success'?' active':''}" data-v="Success" onclick="brpToggle(this)"><i data-icon="check-circle"></i> Success</button>
        <button type="button" class="brp-toggle-btn${defaultV==='Fail'?' active':''}" data-v="Fail" onclick="brpToggle(this)"><i data-icon="x-circle"></i> Fail</button>
        <button type="button" class="brp-toggle-btn${defaultV==='NA'?' active':''}" data-v="NA" onclick="brpToggle(this)">— N/A</button>
      </div>
      <input class="brp-remark" type="text" placeholder="Remark…"
        data-brp-name="${escHtml(brpActiveTab)}__${escHtml(job.name)}__remark"
        value="${escHtml(preRemark)}" style="${remarkStyle}">
    </div>`;
  }).join('');
}

function brpToggle(btn) {
  const group = btn.closest('.brp-toggle');
  group.querySelectorAll('.brp-toggle-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function brpBackdropClose(e) {
  if (e.target === document.getElementById('brp-overlay')) closeBatchReport();
}

function closeBatchReport() {
  document.getElementById('brp-overlay').classList.remove('open');
  window.__brpActiveBackfill = null;
}

async function submitBatchReport() {
  const btn  = document.getElementById('brp-submit-btn');
  const icon = document.getElementById('brp-submit-icon');
  const text = document.getElementById('brp-submit-text');

  btn.disabled = true;
  icon.textContent = '⏳';
  text.textContent = 'กำลังส่ง…';

  const reporter = document.getElementById('brp-reporter').textContent.trim();
  const srv = servers.find(s => s.id === brpActiveTab);
  const jobs = brpAllJobs[brpActiveTab] || [];

  const jobData = {};
  jobs.forEach(job => {
    const activeBtn = document.querySelector(`.brp-toggle[data-brp-name="${brpActiveTab}__${job.name}__status"] .brp-toggle-btn.active`);
    const remarkEl  = document.querySelector(`input[data-brp-name="${brpActiveTab}__${job.name}__remark"]`);
    jobData[job.name] = {
      status: activeBtn?.dataset.v || 'NA',
      remark: remarkEl?.value || '',
      folder: job._folder || '',
    };
  });

  try {
    const token = Auth.getToken ? Auth.getToken()
      : (localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token') || '');
    const resp = await fetch('./api/batch-records.php?action=submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
      },
      body: JSON.stringify({
        // Backfill: submit at 12:00 local of the chosen date so the record
        // lands cleanly inside that day regardless of timezone.
        timestamp: window.__brpActiveBackfill
          ? new Date(window.__brpActiveBackfill + 'T12:00:00').toISOString()
          : new Date().toISOString(),
        backfill:  !!window.__brpActiveBackfill,
        reporter,
        server:    srv?.display || brpActiveTab,
        jobs:      jobData,
      }),
    });
    const json = await resp.json();
    if (!resp.ok || json.error) throw new Error(json.error || json.message || 'Submit failed');

    btn.disabled = false;
    icon.innerHTML = '<i data-icon="check-circle"></i>';
    text.textContent = 'Submit Batch Report';
    const bfNote = window.__brpActiveBackfill ? ` (ย้อนหลัง ${window.__brpActiveBackfill})` : '';
    Toast.success(`บันทึก Batch Report สำเร็จ — ${srv?.display || brpActiveTab}${bfNote}`);
  } catch(err) {
    btn.disabled = false;
    icon.innerHTML = '<i data-icon="check-circle"></i>';
    text.textContent = 'Submit Batch Report';
    Toast.error('ไม่สามารถบันทึกได้: ' + err.message);
  }
}

// ── Description tooltip ────────────────────────────────────────────
const _descTT = document.createElement('div');
_descTT.id = 'desc-tooltip';
document.body.appendChild(_descTT);
document.addEventListener('mouseover', e => {
  const el = e.target.closest('.jc-desc[data-desc]');
  if (!el) return;
  _descTT.textContent = el.dataset.desc;
  _descTT.classList.add('show');
  _positionDescTT(e);
});
document.addEventListener('mousemove', e => {
  if (_descTT.classList.contains('show')) _positionDescTT(e);
});
document.addEventListener('mouseout', e => {
  if (e.target.closest('.jc-desc[data-desc]')) _descTT.classList.remove('show');
});
function _positionDescTT(e) {
  const W = window.innerWidth, ttW = 268, ttH = _descTT.offsetHeight || 56;
  let x = e.clientX - 10, y = e.clientY - ttH - 14;
  if (x + ttW > W - 8) x = W - ttW - 8;
  if (y < 8) y = e.clientY + 18;
  _descTT.style.left = x + 'px';
  _descTT.style.top  = y + 'px';
}

// ══════════════════════════════════════════════════════════════════
// BUILD WITH PARAMETERS MODAL
// ══════════════════════════════════════════════════════════════════
function openBwpModal() {
  const defs = detailJob?._paramDefs;
  if (!defs?.length) return;

  // Close detail first — only one modal at a time
  document.getElementById('detail-modal').classList.remove('open');

  document.getElementById('bwp-job-name').textContent = detailJob.name;

  const body = document.getElementById('bwp-body');
  body.innerHTML = defs.map((p, i) => {
    const cls    = p._class || '';
    const defVal = String(p.defaultParameterValue?.value ?? '');
    const isChoice = cls.includes('Choice');
    const isBool   = cls.includes('Boolean');
    const isText   = cls.includes('TextParameter');
    const isPass   = cls.includes('Password');

    let input;
    if (isChoice && Array.isArray(p.choices) && p.choices.length) {
      input = `<select class="bt-select" id="bwp-p-${i}">
        ${p.choices.map(c => `<option value="${escHtml(c)}" ${c === defVal ? 'selected' : ''}>${escHtml(c)}</option>`).join('')}
      </select>`;
    } else if (isBool) {
      const checked = defVal === 'true' || p.defaultParameterValue?.value === true;
      input = `<div style="display:flex;align-items:center;gap:10px;padding:6px 0">
        <input type="checkbox" id="bwp-p-${i}" ${checked ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer;accent-color:var(--orange)">
        <label for="bwp-p-${i}" style="font-size:12px;cursor:pointer;color:var(--text)">${checked ? 'true (enabled)' : 'false (disabled)'}</label>
      </div>`;
    } else if (isText) {
      input = `<textarea class="bt-input" id="bwp-p-${i}" rows="3" style="resize:vertical;font-family:monospace;font-size:11px">${escHtml(defVal)}</textarea>`;
    } else if (isPass) {
      input = `<input type="password" class="bt-input" id="bwp-p-${i}" value="${escHtml(defVal)}">`;
    } else {
      input = `<input type="text" class="bt-input" id="bwp-p-${i}" value="${escHtml(defVal)}" placeholder="${escHtml(p.name)}">`;
    }

    return `<div class="bt-form-group">
      <label class="bt-label">${escHtml(p.name)}</label>
      ${p.description ? `<div style="font-size:10.5px;color:var(--text-muted);margin-bottom:3px;line-height:1.5">${escHtml(p.description)}</div>` : ''}
      ${input}
    </div>`;
  }).join('');

  const btn = document.getElementById('bwp-submit-btn');
  btn.disabled = false;
  btn.className = 'build-now-btn';
  btn.innerHTML = '<i data-icon="play"></i> Build';

  document.getElementById('bwp-modal').classList.add('open');
}

function closeBwpModal() {
  document.getElementById('bwp-modal').classList.remove('open');
  // Return to detail modal if job is still active
  if (detailJob) document.getElementById('detail-modal').classList.add('open');
}

async function submitBuildWithParams() {
  if (!detailJob) return;
  const defs = detailJob._paramDefs || [];
  const btn  = document.getElementById('bwp-submit-btn');

  const params = {};
  defs.forEach((p, i) => {
    const el = document.getElementById(`bwp-p-${i}`);
    if (!el) return;
    params[p.name] = (p._class || '').includes('Boolean') ? (el.checked ? 'true' : 'false') : el.value;
  });

  btn.disabled = true;
  btn.textContent = '⏳ Queueing…';

  const res = await API.jenkins.build(activeServer, detailJob._path, params);

  if (res?.ok) {
    trackBatchMonitorCheck('trigger_build');
    // Close both modals on success — no need to return to detail
    document.getElementById('bwp-modal').classList.remove('open');
    document.getElementById('detail-modal').classList.remove('open');
    detailJob = null;
    Toast.success('Build queued สำเร็จ!');
  } else {
    const msg = res?.data?.message || 'Failed';
    btn.disabled = false;
    btn.innerHTML = '<i data-icon="play"></i> Build';
    Toast.error(`Build failed: ${msg}`);
  }
}

// ── Info popover (Category / Parameter / Note) ─────────────────────
(function() {
  const pop = document.createElement('div');
  pop.id = 'info-popover';
  pop.innerHTML = `
    <div class="ip-header">
      <span class="ip-title" id="ip-title">Batch Details</span>
      <button class="ip-close" onclick="closeInfoPopover()"><i data-icon="x"></i></button>
    </div>
    <div class="ip-body" id="ip-body"></div>`;
  document.body.appendChild(pop);
  document.addEventListener('click', e => {
    if (!pop.classList.contains('open')) return;
    if (e.target.closest('#info-popover') || e.target.closest('.jc-info-btn')) return;
    closeInfoPopover();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeInfoPopover();
  });
})();

function openInfoPopover(anchorEl, jobName, meta) {
  const pop = document.getElementById('info-popover');
  const body = document.getElementById('ip-body');
  document.getElementById('ip-title').textContent = jobName;

  const sections = [];
  if (meta.category)  sections.push(`<div class="ip-section"><div class="ip-label">Category</div><div class="ip-content">${escHtml(meta.category)}</div></div>`);
  if (meta.parameter) sections.push(`<div class="ip-section"><div class="ip-label">Parameter (สำหรับซ่อม)</div><div class="ip-content mono">${escHtml(meta.parameter)}</div></div>`);
  if (meta.note)      sections.push(`<div class="ip-section"><div class="ip-label">Note</div><div class="ip-content">${escHtml(meta.note)}</div></div>`);
  if (meta.etc)       sections.push(`<div class="ip-section"><div class="ip-label">Etc</div><div class="ip-content">${escHtml(meta.etc)}</div></div>`);
  body.innerHTML = sections.length
    ? sections.join('')
    : `<div style="font-size:11px;color:var(--text-muted);text-align:center;padding:16px">ไม่มีข้อมูลเพิ่มเติม</div>`;

  pop.classList.add('open');
  // position near button; clamp to viewport
  const r = anchorEl.getBoundingClientRect();
  const pw = 360, ph = Math.min(window.innerHeight * 0.7, 500);
  let left = r.left;
  let top  = r.bottom + 6;
  if (left + pw > window.innerWidth - 8)  left = window.innerWidth - pw - 8;
  if (top  + ph > window.innerHeight - 8) top  = Math.max(8, r.top - ph - 6);
  pop.style.left = Math.max(8, left) + 'px';
  pop.style.top  = top + 'px';
}
function closeInfoPopover() {
  document.getElementById('info-popover')?.classList.remove('open');
}

// ── Start ──────────────────────────────────────────────────────────
init();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "_positionDescTT", { configurable: true, get: () => _positionDescTT, set: (v) => { _positionDescTT = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "applyFilter", { configurable: true, get: () => applyFilter, set: (v) => { applyFilter = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "applyTimeFilter", { configurable: true, get: () => applyTimeFilter, set: (v) => { applyTimeFilter = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "brecApplyLock", { configurable: true, get: () => brecApplyLock, set: (v) => { brecApplyLock = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "brecAuthHdr", { configurable: true, get: () => brecAuthHdr, set: (v) => { brecAuthHdr = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "brecBackdropClose", { configurable: true, get: () => brecBackdropClose, set: (v) => { brecBackdropClose = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "brecClearAll", { configurable: true, get: () => brecClearAll, set: (v) => { brecClearAll = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "brecClearCancel", { configurable: true, get: () => brecClearCancel, set: (v) => { brecClearCancel = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "brecDelete", { configurable: true, get: () => brecDelete, set: (v) => { brecDelete = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "brecExportCSV", { configurable: true, get: () => brecExportCSV, set: (v) => { brecExportCSV = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "brecFetch", { configurable: true, get: () => brecFetch, set: (v) => { brecFetch = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "brecJobStatusClick", { configurable: true, get: () => brecJobStatusClick, set: (v) => { brecJobStatusClick = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "brecLoad", { configurable: true, get: () => brecLoad, set: (v) => { brecLoad = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "brecLoadMonths", { configurable: true, get: () => brecLoadMonths, set: (v) => { brecLoadMonths = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "brecMonthChange", { configurable: true, get: () => brecMonthChange, set: (v) => { brecMonthChange = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "brecMonthLabel", { configurable: true, get: () => brecMonthLabel, set: (v) => { brecMonthLabel = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "brecRender", { configurable: true, get: () => brecRender, set: (v) => { brecRender = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "brecSwitchView", { configurable: true, get: () => brecSwitchView, set: (v) => { brecSwitchView = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "brecTextClick", { configurable: true, get: () => brecTextClick, set: (v) => { brecTextClick = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "brecToggle", { configurable: true, get: () => brecToggle, set: (v) => { brecToggle = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "brpBackdropClose", { configurable: true, get: () => brpBackdropClose, set: (v) => { brpBackdropClose = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "brpRenderTab", { configurable: true, get: () => brpRenderTab, set: (v) => { brpRenderTab = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "brpSelectTab", { configurable: true, get: () => brpSelectTab, set: (v) => { brpSelectTab = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "brpToggle", { configurable: true, get: () => brpToggle, set: (v) => { brpToggle = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "buildSparkline", { configurable: true, get: () => buildSparkline, set: (v) => { buildSparkline = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "clearTimeFilter", { configurable: true, get: () => clearTimeFilter, set: (v) => { clearTimeFilter = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeBatchRecords", { configurable: true, get: () => closeBatchRecords, set: (v) => { closeBatchRecords = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeBatchReport", { configurable: true, get: () => closeBatchReport, set: (v) => { closeBatchReport = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeBatchTicketModal", { configurable: true, get: () => closeBatchTicketModal, set: (v) => { closeBatchTicketModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeBwpModal", { configurable: true, get: () => closeBwpModal, set: (v) => { closeBwpModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeDetail", { configurable: true, get: () => closeDetail, set: (v) => { closeDetail = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeInfoPopover", { configurable: true, get: () => closeInfoPopover, set: (v) => { closeInfoPopover = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeMetaHistory", { configurable: true, get: () => closeMetaHistory, set: (v) => { closeMetaHistory = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "computeHealth", { configurable: true, get: () => computeHealth, set: (v) => { computeHealth = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "computeTimeWindow", { configurable: true, get: () => computeTimeWindow, set: (v) => { computeTimeWindow = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "covBackfill", { configurable: true, get: () => covBackfill, set: (v) => { covBackfill = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "covLoad", { configurable: true, get: () => covLoad, set: (v) => { covLoad = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "covRender", { configurable: true, get: () => covRender, set: (v) => { covRender = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "covUpdateBadge", { configurable: true, get: () => covUpdateBadge, set: (v) => { covUpdateBadge = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "covViewDay", { configurable: true, get: () => covViewDay, set: (v) => { covViewDay = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "createBatchTicket", { configurable: true, get: () => createBatchTicket, set: (v) => { createBatchTicket = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "drillInto", { configurable: true, get: () => drillInto, set: (v) => { drillInto = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "enterMetaEditMode", { configurable: true, get: () => enterMetaEditMode, set: (v) => { enterMetaEditMode = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "exitMetaEditMode", { configurable: true, get: () => exitMetaEditMode, set: (v) => { exitMetaEditMode = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "exportFilteredJobs", { configurable: true, get: () => exportFilteredJobs, set: (v) => { exportFilteredJobs = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "extractTrigger", { configurable: true, get: () => extractTrigger, set: (v) => { extractTrigger = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fetchFlatJobs", { configurable: true, get: () => fetchFlatJobs, set: (v) => { fetchFlatJobs = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtDuration", { configurable: true, get: () => fmtDuration, set: (v) => { fmtDuration = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtMetaTs", { configurable: true, get: () => fmtMetaTs, set: (v) => { fmtMetaTs = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "getJobDesc", { configurable: true, get: () => getJobDesc, set: (v) => { getJobDesc = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "getJobMeta", { configurable: true, get: () => getJobMeta, set: (v) => { getJobMeta = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "getJobPath", { configurable: true, get: () => getJobPath, set: (v) => { getJobPath = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "getJobRemark", { configurable: true, get: () => getJobRemark, set: (v) => { getJobRemark = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "getLatestMetaAction", { configurable: true, get: () => getLatestMetaAction, set: (v) => { getLatestMetaAction = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "goBack", { configurable: true, get: () => goBack, set: (v) => { goBack = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "init", { configurable: true, get: () => init, set: (v) => { init = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "isFolder", { configurable: true, get: () => isFolder, set: (v) => { isFolder = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "isSmCoverageAdminUser", { configurable: true, get: () => isSmCoverageAdminUser, set: (v) => { isSmCoverageAdminUser = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "isSmTeam", { configurable: true, get: () => isSmTeam, set: (v) => { isSmTeam = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "jobMatchesRule", { configurable: true, get: () => jobMatchesRule, set: (v) => { jobMatchesRule = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadBatchMeta", { configurable: true, get: () => loadBatchMeta, set: (v) => { loadBatchMeta = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadJobs", { configurable: true, get: () => loadJobs, set: (v) => { loadJobs = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "matchBuildInWindow", { configurable: true, get: () => matchBuildInWindow, set: (v) => { matchBuildInWindow = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "navTo", { configurable: true, get: () => navTo, set: (v) => { navTo = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "onBatchFileTypeChange", { configurable: true, get: () => onBatchFileTypeChange, set: (v) => { onBatchFileTypeChange = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openBatchRecords", { configurable: true, get: () => openBatchRecords, set: (v) => { openBatchRecords = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openBatchReport", { configurable: true, get: () => openBatchReport, set: (v) => { openBatchReport = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openBatchTicketModal", { configurable: true, get: () => openBatchTicketModal, set: (v) => { openBatchTicketModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openBwpModal", { configurable: true, get: () => openBwpModal, set: (v) => { openBwpModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openDetail", { configurable: true, get: () => openDetail, set: (v) => { openDetail = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openInfoPopover", { configurable: true, get: () => openInfoPopover, set: (v) => { openInfoPopover = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openMetaHistory", { configurable: true, get: () => openMetaHistory, set: (v) => { openMetaHistory = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "parseTimeMin", { configurable: true, get: () => parseTimeMin, set: (v) => { parseTimeMin = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "prefetchTriggers", { configurable: true, get: () => prefetchTriggers, set: (v) => { prefetchTriggers = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "refreshCurrent", { configurable: true, get: () => refreshCurrent, set: (v) => { refreshCurrent = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderDetailMeta", { configurable: true, get: () => renderDetailMeta, set: (v) => { renderDetailMeta = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderJobs", { configurable: true, get: () => renderJobs, set: (v) => { renderJobs = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderMetaAuditFooter", { configurable: true, get: () => renderMetaAuditFooter, set: (v) => { renderMetaAuditFooter = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderNavStrip", { configurable: true, get: () => renderNavStrip, set: (v) => { renderNavStrip = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderTabs", { configurable: true, get: () => renderTabs, set: (v) => { renderTabs = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderTimeMatchBadge", { configurable: true, get: () => renderTimeMatchBadge, set: (v) => { renderTimeMatchBadge = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "saveMetaEdit", { configurable: true, get: () => saveMetaEdit, set: (v) => { saveMetaEdit = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "scheduleAutoRefresh", { configurable: true, get: () => scheduleAutoRefresh, set: (v) => { scheduleAutoRefresh = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "selectServer", { configurable: true, get: () => selectServer, set: (v) => { selectServer = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "smRerunHtml", { configurable: true, get: () => smRerunHtml, set: (v) => { smRerunHtml = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "submitBatchReport", { configurable: true, get: () => submitBatchReport, set: (v) => { submitBatchReport = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "submitBuildWithParams", { configurable: true, get: () => submitBuildWithParams, set: (v) => { submitBuildWithParams = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toggleAuto", { configurable: true, get: () => toggleAuto, set: (v) => { toggleAuto = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toggleTimeFilterPanel", { configurable: true, get: () => toggleTimeFilterPanel, set: (v) => { toggleTimeFilterPanel = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "triggerBuild", { configurable: true, get: () => triggerBuild, set: (v) => { triggerBuild = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updateCardTrigger", { configurable: true, get: () => updateCardTrigger, set: (v) => { updateCardTrigger = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updateCrossMidnightHint", { configurable: true, get: () => updateCrossMidnightHint, set: (v) => { updateCrossMidnightHint = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updateSummary", { configurable: true, get: () => updateSummary, set: (v) => { updateSummary = v; } }); } catch (e) {}
})();
