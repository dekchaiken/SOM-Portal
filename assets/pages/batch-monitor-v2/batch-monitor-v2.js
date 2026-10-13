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
const JOB_FIELDS = 'name,color,url,_class,upstreamProjects[name,url],downstreamProjects[name,url],lastBuild[number,result,timestamp,duration,url],builds[number,result,timestamp,duration]{0,12}';
const TREE       = `jobs[${JOB_FIELDS}]`;
// Nested TREE: fetch top-level + one folder level in one call
const FLAT_TREE  = `jobs[${JOB_FIELDS},jobs[${JOB_FIELDS}]]`;
const DETAIL_TREE = 'displayName,description,nextBuildNumber,upstreamProjects[name,url],downstreamProjects[name,url],builds[number,result,timestamp,duration,url,causes[shortDescription]]{0,10},property[parameterDefinitions[name,_class,defaultParameterValue[value],description,choices]]';

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
  loadBatchDeps();  // manual upstream/downstream mapping (V2)
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
  const _bm2UrlServer = new URLSearchParams(location.search).get('server');
  const _bm2InitServer = (_bm2UrlServer && servers.find(s => s.id === _bm2UrlServer))
    ? _bm2UrlServer : (servers[0]?.id);
  if (_bm2InitServer) selectServer(_bm2InitServer);
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

// ── Batch Metadata (from Google Sheets) ───────────────────────────
let batchMetaEntries = [];
function loadBatchMeta() {
  API.batchMeta.get().then(res => {
    if (!res?.ok) return;
    // `?.entries` on a raw array returns Array.prototype.entries (a function),
    // not undefined — so `|| []` doesn't save us. Coerce explicitly.
    const e = res.data?.data?.entries;
    batchMetaEntries = Array.isArray(e) ? e : [];
  });
}

// ── Manual dependency mapping (V2 — user-defined chain data) ──────
// Keyed by exact job name. Complements Jenkins-native upstream/downstream
// which is often empty because pipelines aren't chained in Jenkins config.
let manualDeps = {};
function loadBatchDeps() {
  return API.batchDeps.get().then(res => {
    if (!res?.ok) return;
    const e = res.data?.data?.entries;
    // Backend returns an object map. Guard against arrays / nulls / non-objects.
    manualDeps = (e && typeof e === 'object' && !Array.isArray(e)) ? e : {};
  });
}

// Returns the merged {upstream, downstream} for a job: Jenkins-native
// projects + explicit manual mapping + INFERRED reverse edges (if any other
// job declares this one as its upstream/downstream, the relationship shows
// on both sides — no need to double-enter). De-dupes by name.
function getMergedDeps(job) {
  const seenUp = new Set(), seenDn = new Set();
  const up = [], dn = [];
  (job.upstreamProjects || []).forEach(p => {
    if (p?.name && !seenUp.has(p.name)) { seenUp.add(p.name); up.push({ name: p.name, url: p.url || '', _src: 'jenkins' }); }
  });
  (job.downstreamProjects || []).forEach(p => {
    if (p?.name && !seenDn.has(p.name)) { seenDn.add(p.name); dn.push({ name: p.name, url: p.url || '', _src: 'jenkins' }); }
  });
  // Explicit manual entry for this job
  const md = manualDeps[job.name];
  if (md) {
    (md.upstream || []).forEach(n => {
      if (n && !seenUp.has(n)) { seenUp.add(n); up.push({ name: n, url: '', _src: 'manual' }); }
    });
    (md.downstream || []).forEach(n => {
      if (n && !seenDn.has(n)) { seenDn.add(n); dn.push({ name: n, url: '', _src: 'manual' }); }
    });
  }
  // Inferred reverse edges: if some OTHER job X says "downstream includes me",
  // then X is my upstream (and vice versa). Users only have to define the
  // relationship on one side.
  for (const [otherName, otherMd] of Object.entries(manualDeps || {})) {
    if (otherName === job.name) continue;
    if ((otherMd.downstream || []).includes(job.name) && !seenUp.has(otherName)) {
      seenUp.add(otherName); up.push({ name: otherName, url: '', _src: 'manual' });
    }
    if ((otherMd.upstream || []).includes(job.name) && !seenDn.has(otherName)) {
      seenDn.add(otherName); dn.push({ name: otherName, url: '', _src: 'manual' });
    }
  }
  return { upstream: up, downstream: dn };
}
function getJobMeta(jobName) {
  const n = jobName.toLowerCase();
  const matches = batchMetaEntries.filter(e => {
    const p = (e.pattern || '').toLowerCase();
    if (!p) return false;
    return e.match === 'exact' ? n === p : (n.includes(p) || (p.length >= 6 && p.includes(n)));
  });
  if (!matches.length) return null;
  if (matches.length === 1) return matches[0];
  // Merge multiple matches — prefer action sm_rerun ("sm rerun"/"inform TS") over location badge
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
function smRerunHtml(val) {
  const v = (val || '').toLowerCase().trim();
  if (!v || v === '-') return '';
  if (v === 'sm rerun' || v === 'yes') return `<span class="jc-sm-badge jc-sm-can">🟢 SM Rerun</span>`;
  if (v.includes('inform'))            return `<span class="jc-sm-badge jc-sm-inf">🔴 ${escHtml(val)}</span>`;
  return `<span class="jc-sm-badge jc-sm-other">⚪ ${escHtml(val)}</span>`;
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
        <div class="err-title">⚠ ${escHtml(msg)}</div>
        ${hint ? `<div class="err-hint">${hint}</div>` : ''}
        <button class="btn btn-ghost" style="margin-top:12px;font-size:11px" onclick="loadJobs()">↺ Retry</button>
      </div>`;
    return;
  }

  currentJobs = result.jobs;
  updateSummary(result.jobs);
  document.getElementById('control-row').style.display = '';
  // Detect chain groups from full job list (independent of grid filters)
  _chainGroups = buildChainGroups(currentJobs.filter(j => !isFolder(j)));
  renderChainGroups();
  applyFilter();
  document.getElementById('last-refresh').textContent = 'Updated ' + new Date().toLocaleTimeString('th-TH');
  scheduleAutoRefresh();
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

    const upCount   = (job.upstreamProjects  || []).length;
    const downCount = (job.downstreamProjects || []).length;
    const depBadges = (upCount || downCount) ? `
      <div class="dep-badges">
        ${upCount   ? `<span class="dep-badge dep-up"   title="${upCount} upstream">⬆${upCount}</span>` : ''}
        ${downCount ? `<span class="dep-badge dep-down" title="${downCount} downstream">⬇${downCount}</span>` : ''}
      </div>` : '';

    const folderTag = job._folder
      ? `<div class="jc-folder-tag">📁 ${escHtml(job._folder)}</div>` : '';

    const ticketRow = info.cls === 'failure'
      ? `<div class="jc-ticket-row">
           <button class="jc-ticket-btn" data-ticket-idx="${idx}">🎫 สร้าง Jira Ticket</button>
         </div>` : '';

    const descBlock = job._desc
      ? `<div class="jc-desc desc-${info.cls}" data-desc="${escHtml(job._desc)}"><div class="jc-desc-dot"></div><span class="jc-desc-text">${escHtml(job._desc)}</span></div>`
      : '';

    const meta = getJobMeta(job.name);
    const catBadge   = meta?.category  ? `<span class="jc-category" title="${escHtml(meta.category)}">🏷 ${escHtml(meta.category.split('\n')[0])}</span>` : '';
    const ownerBadge = meta?.dev_owner ? `<span class="jc-owner">👤 ${escHtml(meta.dev_owner)}</span>` : '';
    const smBadge    = meta ? smRerunHtml(meta.sm_rerun) : '';
    const manualBtn  = (meta?.manual_url && meta.manual_url !== '-')
      ? `<a href="${escHtml(meta.manual_url)}" target="_blank" rel="noopener" class="jc-manual-btn" title="เปิดคู่มือ" onclick="event.stopPropagation()">📖</a>` : '';
    const hasDetails = meta && (meta.category || meta.parameter || meta.note || meta.etc);
    const infoBtn    = hasDetails
      ? `<button type="button" class="jc-info-btn${meta.parameter ? ' has-param' : ''}" data-job="${escHtml(job.name)}" title="ดู Category / Parameter / Note">ℹ</button>` : '';

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

// ── Pipeline Chain groups on list view (V2) ─────────────────────────
// State: current filter selection + collapsed toggle
let _chainFilter = 'all';       // 'all' | 'failure' | 'running'
let _chainCollapsed = false;
let _chainGroups   = [];         // computed groups (for re-filter without rebuild)
// View mode — persisted per user across visits. Canvas = SVG node graph,
// Timeline = Gantt-style time axis. Default to Canvas (more visual).
let _chainViewMode = 'canvas';
try { _chainViewMode = localStorage.getItem('pcv:mode') || 'canvas'; } catch(e) {}
if (_chainViewMode !== 'canvas' && _chainViewMode !== 'timeline') _chainViewMode = 'canvas';

// Build connected-component groups of jobs (undirected traversal on
// upstream+downstream edges), keeping only components with ≥2 jobs that
// are actually present in the current job list. Also topo-sorts each
// component so we can lay it out left-to-right.
function buildChainGroups(jobs) {
  if (!jobs || !jobs.length) return [];
  const byName = new Map();
  jobs.forEach(j => byName.set(j.name, j));

  // Adjacency (only jobs actually in the current list — treat externals as edge endpoints we ignore)
  const up = new Map();   // name -> Set of upstream names (in-list)
  const down = new Map(); // name -> Set of downstream names (in-list)
  const ensure = (n) => { if (!up.has(n)) up.set(n, new Set()); if (!down.has(n)) down.set(n, new Set()); };

  jobs.forEach(j => {
    ensure(j.name);
    // Use merged deps so manually declared edges participate in chain detection
    // alongside Jenkins-native ones.
    const merged = getMergedDeps(j);
    merged.upstream.forEach(u => {
      if (byName.has(u.name)) { ensure(u.name); up.get(j.name).add(u.name); down.get(u.name).add(j.name); }
    });
    merged.downstream.forEach(d => {
      if (byName.has(d.name)) { ensure(d.name); down.get(j.name).add(d.name); up.get(d.name).add(j.name); }
    });
  });

  // Find connected components via undirected traversal
  const visited = new Set();
  const components = [];
  for (const name of byName.keys()) {
    if (visited.has(name)) continue;
    const stack = [name];
    const comp = [];
    while (stack.length) {
      const n = stack.pop();
      if (visited.has(n)) continue;
      visited.add(n);
      comp.push(n);
      (up.get(n)   || new Set()).forEach(x => { if (!visited.has(x)) stack.push(x); });
      (down.get(n) || new Set()).forEach(x => { if (!visited.has(x)) stack.push(x); });
    }
    if (comp.length >= 2) components.push(comp);
  }

  // Per component: BFS from roots (no in-comp upstream) to assign column levels
  return components.map(names => {
    const inComp = new Set(names);
    const roots = names.filter(n => {
      const u = up.get(n) || new Set();
      return ![...u].some(p => inComp.has(p));
    });
    const level = new Map();
    // If cycle / no clear root, fall back to first name
    const seeds = roots.length ? roots : [names[0]];
    seeds.forEach(r => level.set(r, 0));
    const queue = [...seeds];
    let guard = 0;
    while (queue.length && guard++ < 5000) {
      const n = queue.shift();
      const lv = level.get(n) ?? 0;
      (down.get(n) || new Set()).forEach(d => {
        if (!inComp.has(d)) return;
        const next = lv + 1;
        if ((level.get(d) ?? -1) < next) { level.set(d, next); queue.push(d); }
      });
    }
    // Group by level; jobs missing a level (cycles/orphans) land in column 0
    const cols = new Map();
    names.forEach(n => {
      const lv = level.get(n) ?? 0;
      if (!cols.has(lv)) cols.set(lv, []);
      cols.get(lv).push(byName.get(n));
    });
    const sortedCols = [...cols.entries()].sort((a, b) => a[0] - b[0]).map(([, arr]) => arr);
    // Sort jobs within a column by name so ordering is stable
    sortedCols.forEach(col => col.sort((a, b) => (a.name || '').localeCompare(b.name || '')));

    // Compute stats
    const stats = { ok: 0, fail: 0, run: 0, other: 0 };
    names.forEach(n => {
      const j = byName.get(n);
      const cls = (COLOR_MAP[j.color] || {}).cls;
      if      (cls === 'success')  stats.ok++;
      else if (cls === 'failure')  stats.fail++;
      else if (cls === 'running')  stats.run++;
      else                         stats.other++;
    });

    // Directed edges (from → to) — only forward within this component.
    // Used by Canvas view to draw bezier curves and by Timeline to color-code
    // downstream ripple. Deduped implicitly because up/down are Sets.
    const edges = [];
    names.forEach(from => {
      (down.get(from) || new Set()).forEach(to => {
        if (inComp.has(to)) edges.push({ from, to });
      });
    });

    return {
      columns: sortedCols,
      total:   names.length,
      stats,
      edges,
      names,
      byName:  Object.fromEntries(names.map(n => [n, byName.get(n)])),
    };
  }).sort((a, b) => {
    // Sort: failures first, then running, then bigger chains
    if (a.stats.fail !== b.stats.fail) return b.stats.fail - a.stats.fail;
    if (a.stats.run  !== b.stats.run)  return b.stats.run  - a.stats.run;
    return b.total - a.total;
  });
}

// Apply active filter to computed groups
function filterChainGroups(groups) {
  if (_chainFilter === 'failure') return groups.filter(g => g.stats.fail > 0);
  if (_chainFilter === 'running') return groups.filter(g => g.stats.run  > 0);
  return groups;
}

// Update the segmented-control active state.
function _syncViewToggleUi() {
  document.querySelectorAll('.cv-mode-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === _chainViewMode);
  });
}

function setChainViewMode(mode) {
  if (mode !== 'canvas' && mode !== 'timeline') return;
  _chainViewMode = mode;
  try { localStorage.setItem('pcv:mode', mode); } catch(e) {}
  _syncViewToggleUi();
  renderChainGroups();
}

// Master render — dispatches per group to Canvas or Timeline body.
function renderChainGroups() {
  const section = document.getElementById('chain-groups-section');
  const body    = document.getElementById('chain-groups');
  const count   = document.getElementById('chain-groups-count');
  if (!section || !body) return;

  if (!_chainGroups.length) {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';
  _syncViewToggleUi();

  const visible = filterChainGroups(_chainGroups);
  count.textContent = `${visible.length} / ${_chainGroups.length}`;

  if (!visible.length) {
    body.innerHTML = '<div class="chain-groups-empty">No chains match the current filter</div>';
    return;
  }

  body.innerHTML = visible.map(renderOneChainGroup).join('');
}

function renderOneChainGroup(g) {
  const modClass = g.stats.fail ? ' has-failure' : g.stats.run ? ' has-running' : '';
  const stats = [];
  if (g.stats.fail)  stats.push(`<span class="chain-stat stat-fail">⚠ ${g.stats.fail} failed</span>`);
  if (g.stats.run)   stats.push(`<span class="chain-stat stat-run">● ${g.stats.run} running</span>`);
  if (g.stats.ok)    stats.push(`<span class="chain-stat stat-ok">✓ ${g.stats.ok} ok</span>`);
  if (g.stats.other) stats.push(`<span class="chain-stat stat-other">${g.stats.other} other</span>`);

  const bodyHtml = _chainViewMode === 'timeline'
    ? renderChainAsTimeline(g)
    : renderChainAsCanvas(g);

  return `<div class="chain-group${modClass}">
    <div class="chain-group-head">
      <div class="chain-group-lbl">
        <span class="chain-group-dot"></span>
        Chain of <strong>${g.total}</strong> jobs · ${g.columns.length} stage${g.columns.length === 1 ? '' : 's'}
      </div>
      <div class="chain-group-stats">${stats.join('')}</div>
    </div>
    ${bodyHtml}
  </div>`;
}

// ═══════════════════════════════════════════════════════════════════
// CANVAS view — SVG bezier connectors + absolutely-positioned nodes
// ═══════════════════════════════════════════════════════════════════

// Layout constants — kept in one place so tweaks are easy.
const CV_NODE_W    = 220;
const CV_NODE_H    = 96;
const CV_NODE_GAPY = 14;
const CV_NODE_GAPX = 20;
const CV_STAGE_GAP = 110;
const CV_MAX_ROWS  = 6;      // wrap a stage into a new sub-column after this many rows
const CV_PAD_X     = 40;
const CV_PAD_Y     = 50;

function renderChainAsCanvas(g) {
  // 1) Compute node positions from stage/index. Wide stages get split into
  //    sub-columns so we don't grow taller than CV_MAX_ROWS rows.
  const positions = {};
  const stageBounds = []; // {left, right, centerX, count}
  let currentX = CV_PAD_X;
  let maxY = 0;

  g.columns.forEach((stageJobs, stageIdx) => {
    const subCols = Math.max(1, Math.ceil(stageJobs.length / CV_MAX_ROWS));
    const stageLeft = currentX;
    stageJobs.forEach((job, jobIdx) => {
      const subCol = Math.floor(jobIdx / CV_MAX_ROWS);
      const rowInSub = jobIdx % CV_MAX_ROWS;
      const x = stageLeft + subCol * (CV_NODE_W + CV_NODE_GAPX);
      const y = CV_PAD_Y + rowInSub * (CV_NODE_H + CV_NODE_GAPY);
      positions[job.name] = { x, y, stage: stageIdx };
      const bottom = y + CV_NODE_H;
      if (bottom > maxY) maxY = bottom;
    });
    const stageWidth = subCols * CV_NODE_W + (subCols - 1) * CV_NODE_GAPX;
    stageBounds.push({
      left:    stageLeft,
      right:   stageLeft + stageWidth,
      centerX: stageLeft + stageWidth / 2,
      count:   stageJobs.length,
    });
    currentX = stageLeft + stageWidth + CV_STAGE_GAP;
  });

  const canvasW = Math.max(currentX - CV_STAGE_GAP + CV_PAD_X, 800);
  const canvasH = Math.max(maxY + CV_PAD_Y, 300);

  // 2) Nodes
  const nodesHtml = g.columns.flat().map(job => {
    const p = positions[job.name];
    return _renderCanvasNode(job, p);
  }).join('');

  // 3) Edges — only forward within component; skip malformed ones. Highlight
  //    edges whose target is failure/running so ripple is obvious.
  const paths = g.edges.filter(e => {
    const p1 = positions[e.from], p2 = positions[e.to];
    return p1 && p2 && p2.stage > p1.stage;
  }).map(e => {
    const p1 = positions[e.from], p2 = positions[e.to];
    const ax = p1.x + CV_NODE_W, ay = p1.y + CV_NODE_H / 2;
    const bx = p2.x,             by = p2.y + CV_NODE_H / 2;
    const midX = (ax + bx) / 2;
    // Cubic bezier — horizontal control points for smooth S-curve
    const targetJob = g.byName[e.to];
    const targetCls = (COLOR_MAP[targetJob?.color] || {}).cls;
    let cls = '';
    if (targetCls === 'failure') cls = 'edge-fail';
    else if (targetCls === 'running') cls = 'edge-run';
    return `<path class="${cls}" d="M ${ax} ${ay} C ${midX} ${ay}, ${midX} ${by}, ${bx} ${by}"/>`;
  }).join('');

  // 4) Stage labels above each stage
  const stageLbls = stageBounds.map((b, i) =>
    `<div class="cv-stage-lbl" style="left:${b.centerX}px">
      Stage ${i + 1}<span class="cv-stage-lbl-count">${b.count}</span>
    </div>`
  ).join('');

  return `<div class="cv-wrap">
    <div class="cv-canvas" style="width:${canvasW}px;height:${canvasH}px">
      <svg class="cv-svg" viewBox="0 0 ${canvasW} ${canvasH}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
        ${paths}
      </svg>
      ${stageLbls}
      ${nodesHtml}
    </div>
  </div>`;
}

function _renderCanvasNode(job, pos) {
  const info = COLOR_MAP[job.color] || { cls: 'notbuilt', label: (job.color || '?').toUpperCase() };
  const lb   = job.lastBuild;
  const bn   = lb ? `#${lb.number}` : '';
  const ago  = lb && lb.timestamp ? DateTime.timeAgo(new Date(lb.timestamp).toISOString()) : '';
  const dur  = lb && lb.duration  ? fmtDuration(lb.duration) : '';
  const tip  = [job.name, info.label, bn, ago, dur ? `ran in ${dur}` : '']
    .filter(Boolean).join(' • ');
  return `<div class="cv-node status-${info.cls}"
    style="left:${pos.x}px;top:${pos.y}px;width:${CV_NODE_W}px"
    data-name="${escHtml(job.name)}"
    title="${escHtml(tip)}"
    onclick="chainOpenJobByName(this.dataset.name)">
    <div class="cv-node-top">
      <span class="cv-node-status"><span class="cv-node-dot"></span>${escHtml(info.label)}</span>
      ${bn ? `<span class="cv-node-build">${escHtml(bn)}</span>` : ''}
    </div>
    <div class="cv-node-name">${escHtml(job.name)}</div>
    <div class="cv-node-foot">
      <span>${escHtml(ago || '—')}</span>
      ${dur ? `<span class="dur">${escHtml(dur)}</span>` : ''}
    </div>
  </div>`;
}

// ═══════════════════════════════════════════════════════════════════
// TIMELINE view — Gantt swim-lane with a real time axis
// ═══════════════════════════════════════════════════════════════════

function renderChainAsTimeline(g) {
  const jobs = g.columns.flat();
  const now  = Date.now();

  // Determine time window from all jobs' last builds; extend by 5% on each
  // side, and extend to `now` if anything is still running.
  let minStart = Infinity, maxEnd = 0;
  const hasBuild = jobs.filter(j => j.lastBuild && j.lastBuild.timestamp);
  hasBuild.forEach(j => {
    const s = j.lastBuild.timestamp;
    const d = j.lastBuild.duration || 60000;
    if (s < minStart) minStart = s;
    if (s + d > maxEnd) maxEnd = s + d;
  });
  const anyRunning = jobs.some(j => (COLOR_MAP[j.color] || {}).cls === 'running');
  if (anyRunning) maxEnd = Math.max(maxEnd, now);

  // Fallback for chain with no build data
  if (minStart === Infinity) { minStart = now - 3600000; maxEnd = now; }

  const rawSpan = Math.max(60000, maxEnd - minStart);
  const pad     = rawSpan * 0.06;
  const winStart = minStart - pad;
  const winEnd   = maxEnd + pad;
  const winSpan  = winEnd - winStart;
  const pctOf   = (t) => ((t - winStart) / winSpan) * 100;

  // Time ticks — 8 divisions
  const NUM_TICKS = 8;
  const ticks = [];
  for (let i = 0; i <= NUM_TICKS; i++) {
    const t = winStart + (i / NUM_TICKS) * winSpan;
    ticks.push(t);
  }

  const ticksHtml = ticks.map(t => `
    <div class="tl-tick" style="left:${pctOf(t)}%">
      <span class="tl-tick-lbl">${_fmtTimeShort(t, winSpan)}</span>
      <span class="tl-tick-mark"></span>
    </div>
  `).join('');

  // Sort jobs by start time for logical top-to-bottom flow (fallback to name)
  const sortedJobs = [...jobs].sort((a, b) => {
    const ta = a.lastBuild?.timestamp || 0;
    const tb = b.lastBuild?.timestamp || 0;
    if (ta !== tb) return ta - tb;
    return (a.name || '').localeCompare(b.name || '');
  });

  // Side rows + lane rows are rendered in the same order so they align.
  const stageOf = {};
  g.columns.forEach((col, i) => col.forEach(j => stageOf[j.name] = i + 1));

  const sideRows = sortedJobs.map(j => {
    const info = COLOR_MAP[j.color] || { cls: 'notbuilt', label: '?' };
    const lb = j.lastBuild;
    const bn = lb ? `#${lb.number}` : '—';
    return `<div class="tl-row status-${info.cls}"
      data-name="${escHtml(j.name)}"
      onclick="chainOpenJobByName(this.dataset.name)"
      title="${escHtml(j.name)}">
      <div class="tl-row-strip"></div>
      <div class="tl-row-info">
        <div class="tl-row-name">${escHtml(j.name)}</div>
        <div class="tl-row-meta">
          <span>${escHtml(bn)}</span>
          <span>·</span>
          <span>Stage ${stageOf[j.name] || '?'}</span>
          <span>·</span>
          <span class="tl-row-status-lbl">${escHtml(info.label)}</span>
        </div>
      </div>
    </div>`;
  }).join('');

  const lanes = sortedJobs.map(j => {
    const info = COLOR_MAP[j.color] || { cls: 'notbuilt', label: '?' };
    const lb   = j.lastBuild;
    if (!lb || !lb.timestamp) {
      return `<div class="tl-lane"><span class="tl-lane-empty">no builds yet</span></div>`;
    }
    const start = lb.timestamp;
    let   dur   = lb.duration;
    if (info.cls === 'running') dur = Math.max(now - start, 30000);
    else if (!dur || dur < 5000) dur = 30000;

    const leftPct  = pctOf(start);
    const widthPct = Math.max(0.5, (dur / winSpan) * 100);
    const durLbl   = fmtDuration(dur);
    const label    = info.cls === 'failure' ? `⚠ ${durLbl}` :
                     info.cls === 'running' ? 'running…' : durLbl;
    return `<div class="tl-lane">
      <div class="tl-bar status-${info.cls}"
        style="left:${leftPct}%;width:${widthPct}%"
        data-name="${escHtml(j.name)}"
        title="${escHtml(j.name)} · ${escHtml(info.label)} · ${escHtml(durLbl)}"
        onclick="chainOpenJobByName(this.dataset.name)">
        <span class="tl-bar-lbl">${escHtml(label)}</span>
      </div>
    </div>`;
  }).join('');

  // NOW marker (only if within visible window)
  const nowLine = (now >= winStart && now <= winEnd)
    ? `<div class="tl-now" style="left:${pctOf(now)}%"></div>`
    : '';

  return `<div class="tl-wrap">
    <div class="tl-side">
      <div class="tl-side-head">Job</div>
      ${sideRows}
    </div>
    <div class="tl-track">
      <div class="tl-scale">${ticksHtml}</div>
      <div class="tl-lanes">${lanes}${nowLine}</div>
    </div>
  </div>`;
}

// Short time-tick formatter — if window spans <24h use HH:MM, else include date.
function _fmtTimeShort(ms, winSpan) {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (winSpan > 86400000) {
    const day = String(d.getDate()).padStart(2, '0');
    const mon = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}/${mon} ${hh}:${mm}`;
  }
  return `${hh}:${mm}`;
}

function setChainFilter(mode) {
  _chainFilter = mode;
  document.querySelectorAll('.chain-flt-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.flt === mode);
  });
  renderChainGroups();
}

function toggleChainCollapse() {
  _chainCollapsed = !_chainCollapsed;
  const body = document.getElementById('chain-groups');
  const btn  = document.getElementById('chain-collapse-btn');
  if (body) body.classList.toggle('collapsed', _chainCollapsed);
  if (btn)  btn.classList.toggle('collapsed', _chainCollapsed);
}

// ── Pipeline Chain (V2) ─────────────────────────────────────────────
// Look up a job by name in the current server's job list. Names in
// upstreamProjects/downstreamProjects come from Jenkins in short form
// (no folder prefix), matching what we store in job.name after flattening.
function findJobByName(name) {
  if (!name) return null;
  return currentJobs.find(j => j.name === name) || null;
}

// Render a single chain node for a related (upstream/downstream) job.
// Falls back to a dashed "external" pill if the job isn't in the current list.
function renderChainRelatedNode(item) {
  const name = (item && item.name) || '';
  const url  = (item && item.url)  || '';
  const job  = findJobByName(name);
  const info = job
    ? (COLOR_MAP[job.color] || { cls:'notbuilt', label:(job.color||'?').toUpperCase() })
    : { cls:'notbuilt', label:'NOT IN LIST' };
  const lb  = job && job.lastBuild;
  const bn  = lb ? `#${lb.number}` : '';
  const ago = lb && lb.timestamp ? DateTime.timeAgo(new Date(lb.timestamp).toISOString()) : '';
  const dur = lb && lb.duration  ? fmtDuration(lb.duration) : '';

  const src = item && item._src;   // 'jenkins' | 'manual' (set by getMergedDeps)
  const tipParts = [name, info.label];
  if (bn)  tipParts.push(bn);
  if (ago) tipParts.push(ago);
  if (dur) tipParts.push(dur);
  if (src === 'manual')  tipParts.push('(manually mapped)');
  if (!job) tipParts.push('(click to open in Jenkins — not in current job list)');
  else      tipParts.push('(click to open details)');
  const tip = tipParts.join(' • ');
  const manualBadge = src === 'manual' ? '<span class="chain-src-badge" title="Manual dep">M</span>' : '';

  const classes = ['chain-node'];
  let openable  = false;
  let clickAttr = '';
  if (job) {
    openable  = true;
    classes.push();
    clickAttr = `onclick="chainOpenJobByName(this.dataset.name)"`;
  } else if (url) {
    clickAttr = `onclick="window.open(this.dataset.url,'_blank','noopener')"`;
    classes.push('chain-external');
  } else {
    classes.push('chain-external');
  }

  return `<div class="${classes.join(' ')}"
    ${openable ? 'data-openable="1"' : ''}
    data-name="${escHtml(name)}"
    data-url="${escHtml(url)}"
    title="${escHtml(tip)}"
    ${clickAttr}>
    <span class="chain-dot dot-${info.cls}"></span>
    <span class="chain-name">${escHtml(name || '(unnamed)')}</span>
    ${bn ? `<span class="chain-meta">${escHtml(bn)}</span>` : ''}
    ${manualBadge}
  </div>`;
}

// Render one side of the chain (upstream or downstream) into the given element.
function renderChainSide(elId, items, side) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!items || !items.length) {
    const msg = side === 'upstream'
      ? 'None — started manually or by schedule'
      : 'None — no jobs depend on this';
    el.innerHTML = `<div class="chain-empty">${msg}</div>`;
    return;
  }
  el.innerHTML = items.map(renderChainRelatedNode).join('');
}

// Render the current job as the centered highlight node.
function renderChainCurrentNode(job) {
  const el = document.getElementById('d-chain-current');
  if (!el) return;
  const info = COLOR_MAP[job.color] || { cls:'notbuilt', label:(job.color||'?').toUpperCase() };
  const lb   = job.lastBuild;
  const bn   = lb ? `#${lb.number}` : '';
  el.innerHTML = `<div class="chain-node chain-current" title="${escHtml(job.name)} • ${escHtml(info.label)}">
    <span class="chain-dot dot-${info.cls}"></span>
    <span class="chain-name">${escHtml(job.name || '(current)')}</span>
    ${bn ? `<span class="chain-meta">${escHtml(bn)}</span>` : ''}
  </div>`;
}

// Click handler for related chain nodes — hops into that job's details.
function chainOpenJobByName(name) {
  const job = findJobByName(name);
  if (!job) { Toast?.warning?.('Job not in current list — cannot open details'); return; }
  openDetail(job, getJobPath(job));
}

// ── Dependency Editor (V2) ─────────────────────────────────────────
// Working state for the currently-open editor. Rebuilt each time
// openDepEditor() runs so leftovers don't leak between sessions.
let _depEditor = { job: '', up: new Set(), down: new Set(), note: '' };

function openDepEditor() {
  const job = (typeof detailJob !== 'undefined' && detailJob && detailJob.name) || '';
  if (!job) { Toast?.warning?.('Open a job first'); return; }

  // Seed editor state from existing manual mapping (if any). Jenkins-native
  // deps aren't editable — they live in Jenkins config — so we don't include
  // them in the picked lists.
  const md = manualDeps[job] || { upstream: [], downstream: [], note: '' };
  _depEditor = {
    job,
    up:   new Set(md.upstream   || []),
    down: new Set(md.downstream || []),
    note: md.note || '',
  };

  document.getElementById('dep-editor-jobname').textContent = job;
  document.getElementById('dep-note-input').value = _depEditor.note;
  document.getElementById('dep-search-up').value = '';
  document.getElementById('dep-search-down').value = '';
  document.getElementById('dep-cands-up').innerHTML   = '';
  document.getElementById('dep-cands-down').innerHTML = '';
  renderDepPicked('up');
  renderDepPicked('down');

  document.getElementById('dep-editor-modal').classList.add('open');
}

function closeDepEditor() {
  document.getElementById('dep-editor-modal').classList.remove('open');
}

function renderDepPicked(side) {
  const set = side === 'up' ? _depEditor.up : _depEditor.down;
  const el  = document.getElementById(side === 'up' ? 'dep-picked-up' : 'dep-picked-down');
  if (!el) return;
  el.innerHTML = [...set].map(name => `<span class="dep-pick-pill">
    <span class="dep-pick-pill-name" title="${escHtml(name)}">${escHtml(name)}</span>
    <button type="button" class="dep-pick-pill-x" data-side="${side}" data-name="${escHtml(name)}" onclick="unpickDep(this.dataset.side, this.dataset.name)" title="Remove">×</button>
  </span>`).join('');
}

function renderDepCandidates(side) {
  const input = document.getElementById(side === 'up' ? 'dep-search-up' : 'dep-search-down');
  const el    = document.getElementById(side === 'up' ? 'dep-cands-up' : 'dep-cands-down');
  if (!input || !el) return;

  const q = (input.value || '').trim().toLowerCase();
  const set = side === 'up' ? _depEditor.up : _depEditor.down;
  const self = _depEditor.job;

  // Candidates come from the current job list. Exclude self + already-picked.
  const all = (currentJobs || []).filter(j => !isFolder(j) && j.name && j.name !== self && !set.has(j.name));
  const matched = q
    ? all.filter(j => j.name.toLowerCase().includes(q)).slice(0, 30)
    : all.slice(0, 15);

  if (!matched.length) {
    el.innerHTML = `<div class="dep-cand-empty">${q ? 'No matching jobs' : 'Start typing to search…'}</div>`;
    return;
  }

  el.innerHTML = matched.map(j => {
    const info = COLOR_MAP[j.color] || { cls:'notbuilt', label:'?' };
    const lb   = j.lastBuild;
    const meta = lb ? `#${lb.number}` : '';
    return `<button type="button" class="dep-cand" data-side="${side}" data-name="${escHtml(j.name)}" onclick="pickDep(this.dataset.side, this.dataset.name)" title="${escHtml(j.name)}">
      <span class="chain-dot dot-${info.cls}"></span>
      <span class="dep-cand-name">${escHtml(j.name)}</span>
      <span class="dep-cand-meta">${escHtml(meta)}</span>
    </button>`;
  }).join('');
}

function pickDep(side, name) {
  const set = side === 'up' ? _depEditor.up : _depEditor.down;
  set.add(name);
  renderDepPicked(side);
  // Clear search + re-render candidates so the just-picked one drops out
  const input = document.getElementById(side === 'up' ? 'dep-search-up' : 'dep-search-down');
  if (input) input.value = '';
  renderDepCandidates(side);
}

function unpickDep(side, name) {
  const set = side === 'up' ? _depEditor.up : _depEditor.down;
  set.delete(name);
  renderDepPicked(side);
  renderDepCandidates(side);
}

async function saveDepEditor() {
  const btn = document.getElementById('dep-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  const note = document.getElementById('dep-note-input').value.trim();
  const res = await API.batchDeps.set(
    _depEditor.job,
    [..._depEditor.up],
    [..._depEditor.down],
    note,
  );
  if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
  if (!res?.ok) {
    Toast?.error?.(res?.data?.message || 'Failed to save dependencies');
    return;
  }
  Toast?.success?.('Dependencies saved');
  await refreshDepsAndChain();
  closeDepEditor();
}

async function clearDepEditor() {
  if (!await SOMDialog.confirm('Remove all manual upstream/downstream for this job?', { title: 'ยืนยัน', okLabel: 'ลบ', icon: 'warning', okColor: 'warning' })) return;
  const btn = document.getElementById('dep-save-btn');
  if (btn) btn.disabled = true;
  const res = await API.batchDeps.remove(_depEditor.job);
  if (btn) btn.disabled = false;
  if (!res?.ok) {
    Toast?.error?.(res?.data?.message || 'Failed to clear');
    return;
  }
  Toast?.success?.('Cleared manual dependencies');
  await refreshDepsAndChain();
  closeDepEditor();
}

// Reload manual deps then repaint the list-view chain groups + (if the
// detail modal is still on the same job) its chain view.
async function refreshDepsAndChain() {
  await loadBatchDeps();
  if (typeof currentJobs !== 'undefined' && currentJobs.length) {
    _chainGroups = buildChainGroups(currentJobs.filter(j => !isFolder(j)));
    renderChainGroups();
  }
  // If detail modal is open, repaint its chain from list data (fresh Jenkins
  // detail fetch would double the work — the modal already re-renders on
  // subsequent openDetail calls).
  const modal = document.getElementById('detail-modal');
  if (modal && modal.classList.contains('open') && typeof detailJob !== 'undefined' && detailJob) {
    renderChainCurrentNode(detailJob);
    const merged = getMergedDeps(detailJob);
    renderChainSide('d-chain-up',   merged.upstream,   'upstream');
    renderChainSide('d-chain-down', merged.downstream, 'downstream');
  }
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
  document.getElementById('d-build-btn').textContent = '▶ Build Now';

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

  // Meta chips + info cards from batch_meta
  const meta = getJobMeta(job.name);
  const chips = [];
  if (meta?.category)  chips.push(`<span class="jc-category" title="${escHtml(meta.category)}">🏷 ${escHtml(meta.category.split('\n')[0])}</span>`);
  if (meta?.dev_owner) chips.push(`<span class="jc-owner">👤 ${escHtml(meta.dev_owner)}</span>`);
  if (meta?.sm_rerun)  chips.push(smRerunHtml(meta.sm_rerun));
  if (meta?.manual_url && meta.manual_url !== '-')
    chips.push(`<a href="${escHtml(meta.manual_url)}" target="_blank" rel="noopener" class="jc-manual-btn" title="เปิดคู่มือ">📖</a>`);
  if (job._folder) chips.push(`<span class="detail-folder">📁 ${escHtml(job._folder)}</span>`);
  document.getElementById('d-meta-strip').innerHTML = chips.join('');

  const infoCards = [];
  if (meta?.category)  infoCards.push(`<div class="info-card"><div class="info-card-label">🏷 Category</div><div class="info-card-body">${escHtml(meta.category)}</div></div>`);
  if (meta?.parameter) infoCards.push(`<div class="info-card mono"><div class="info-card-label">⚙ Parameter (สำหรับซ่อม)</div><div class="info-card-body">${escHtml(meta.parameter)}</div></div>`);
  if (meta?.note)      infoCards.push(`<div class="info-card"><div class="info-card-label">📝 Note</div><div class="info-card-body">${escHtml(meta.note)}</div></div>`);
  if (meta?.etc)       infoCards.push(`<div class="info-card"><div class="info-card-label">Etc</div><div class="info-card-body">${escHtml(meta.etc)}</div></div>`);
  document.getElementById('d-info-cards').innerHTML = infoCards.join('');

  // Reset detail sections — paint chain immediately from list data + manual
  // deps (fresh Jenkins projects come in after the detail fetch resolves).
  renderChainCurrentNode(job);
  const initMerged = getMergedDeps(job);
  renderChainSide('d-chain-up',   initMerged.upstream,   'upstream');
  renderChainSide('d-chain-down', initMerged.downstream, 'downstream');
  document.getElementById('d-builds').innerHTML     = '<div class="builds-loading"><div class="spinner" style="display:inline-block;margin-right:6px"></div>Loading…</div>';
  document.getElementById('d-next-build').textContent = '';

  document.getElementById('detail-modal').classList.add('open');

  // Fetch full detail
  const res = await API.jenkins.jobDetail(activeServer, jobPath, DETAIL_TREE);
  if (!res?.ok) {
    // Chain was already painted from list data — leave it as-is; only surface
    // the error on the builds panel where fresh data actually matters.
    document.getElementById('d-builds').innerHTML     = `<div style="padding:16px;text-align:center;font-size:12px;color:#dc2626">⚠ ${escHtml(res?.data?.message || 'Failed to load detail')}</div>`;
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
  buildBtn.textContent = paramDefs.length ? '▶ Build with Parameters' : '▶ Build Now';
  buildBtn.disabled = false;

  // Next build number
  if (d.nextBuildNumber) {
    document.getElementById('d-next-build').textContent = `next: #${d.nextBuildNumber}`;
  }

  // Refresh chain with authoritative upstream/downstream from detail response,
  // merged with the user's manual mapping. Build a synthetic job object to
  // reuse getMergedDeps so the dedup + tagging logic stays in one place.
  const enriched = {
    ...job,
    upstreamProjects:   d.upstreamProjects   || job.upstreamProjects   || [],
    downstreamProjects: d.downstreamProjects || job.downstreamProjects || [],
  };
  const merged = getMergedDeps(enriched);
  renderChainSide('d-chain-up',   merged.upstream,   'upstream');
  renderChainSide('d-chain-down', merged.downstream, 'downstream');

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
    const causeStr = b.causes?.[0]?.shortDescription || '';
    return `<div class="build-row">
      <div class="build-dot dot-${bCls}"></div>
      <span class="build-num">#${b.number}</span>
      <span class="build-status label-${bCls}">${result}</span>
      <span class="build-time" title="${causeStr}">${timeStr}${causeStr ? ' · ' + escHtml(causeStr.substring(0,40)) : ''}</span>
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
    btn.textContent = '✓ Queued!';
    setTimeout(() => {
      btn.className = 'build-now-btn';
      btn.textContent = '▶ Build Now';
      btn.disabled = false;
    }, 3000);
  } else {
    const msg = res?.data?.message || 'Failed';
    btn.disabled = false;
    btn.textContent = '▶ Build Now';
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
    return `<span class="jc-time-match" title="Started at ${hhmm} — in window">▶ ${hhmm}${num}</span>`;
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
  if (document.getElementById('bwp-modal').classList.contains('open')) {
    closeBwpModal(); // returns to detail modal
  } else if (document.getElementById('detail-modal').classList.contains('open')) {
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
  await brecLoad();
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
// BATCH REPORT PANEL
// ══════════════════════════════════════════════════════════════════
async function openBatchReport() {
  // Set datetime + reporter
  document.getElementById('brp-datetime').textContent =
    new Date().toLocaleDateString('th-TH', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  try {
    const user = Auth.getUser ? Auth.getUser() : JSON.parse(localStorage.getItem('auth_user') || '{}');
    document.getElementById('brp-reporter').textContent = '👤 ' + (user?.email || user?.username || '');
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
    const folderInfo = job._folder ? `<span style="font-size:9px;color:var(--text-muted);margin-left:4px">📁 ${escHtml(job._folder)}</span>` : '';
    const preRemark  = job._remark || '';
    const remarkStyle = preRemark
      ? 'border-color:rgba(37,99,235,.4);background:rgba(37,99,235,.04);'
      : '';
    const remarkBadge = preRemark
      ? `<span title="${escHtml(preRemark)}" style="cursor:help;font-size:10px;margin-left:5px;padding:1px 5px;border-radius:3px;background:rgba(37,99,235,.1);color:#2563eb;white-space:nowrap;flex-shrink:0">ℹ️</span>`
      : '';

    return `<div class="brp-job-row" style="${preRemark ? 'border-left:3px solid rgba(37,99,235,.35);' : ''}">
      <div style="flex:1;min-width:0;display:flex;align-items:center;gap:2px">
        <div class="brp-job-name">${escHtml(job.name)}${folderInfo}</div>
        ${remarkBadge}
      </div>
      <div class="brp-toggle" data-brp-name="${escHtml(brpActiveTab)}__${escHtml(job.name)}__status">
        <button type="button" class="brp-toggle-btn${defaultV==='Success'?' active':''}" data-v="Success" onclick="brpToggle(this)">✅ Success</button>
        <button type="button" class="brp-toggle-btn${defaultV==='Fail'?' active':''}" data-v="Fail" onclick="brpToggle(this)">❌ Fail</button>
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
}

async function submitBatchReport() {
  const btn  = document.getElementById('brp-submit-btn');
  const icon = document.getElementById('brp-submit-icon');
  const text = document.getElementById('brp-submit-text');

  btn.disabled = true;
  icon.textContent = '⏳';
  text.textContent = 'กำลังส่ง…';

  const reporter = document.getElementById('brp-reporter').textContent.replace('👤 ', '').trim();
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
        timestamp: new Date().toISOString(),
        reporter,
        server:    srv?.display || brpActiveTab,
        jobs:      jobData,
      }),
    });
    const json = await resp.json();
    if (!resp.ok || json.error) throw new Error(json.error || json.message || 'Submit failed');

    btn.disabled = false;
    icon.textContent = '✅';
    text.textContent = 'Submit Batch Report';
    Toast.success(`บันทึก Batch Report สำเร็จ — ${srv?.display || brpActiveTab}`);
  } catch(err) {
    btn.disabled = false;
    icon.textContent = '✅';
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
  btn.textContent = '▶ Build';

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
    btn.textContent = '▶ Build';
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
      <button class="ip-close" onclick="closeInfoPopover()">✕</button>
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
