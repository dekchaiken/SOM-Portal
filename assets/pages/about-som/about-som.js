// about-som — page script, extracted from about-som.html.
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

Auth.requireAuth();
Layout.render('about-som');

const _u = Auth.getUser();
// Only sm_admin/dev_sm on SM team, or super_admin may edit the about page
const _canEditAbout =
  _u?.role === 'super_admin' ||
  (['sm_admin','dev_sm'].includes(_u?.role) && _u?.team === 'sm');
const _editBtn = document.getElementById('admin-edit-btn');
if (_canEditAbout) {
  _editBtn.style.display = '';
} else {
  _editBtn.remove();   // remove from DOM entirely — no CSS override possible
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function initials(name) {
  if (!name) return '?';
  return name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
}
function avatarImg(m, size) {
  if (m.avatar_url) {
    return `<img src="${escHtml(m.avatar_url)}" alt=""
      style="width:${size}px;height:${size}px;object-fit:cover;border-radius:50%;display:block"
      onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'${initials(m.name)}'}))">`;
  }
  return `<span>${initials(m.name)}</span>`;
}
const ROLE_LABELS = { sm_admin:'Admin', sm_lead:'Lead', sm_user:'Member', dev_sm:'Dev' };

// ── Work Process data (from PDF) ─────────────────────────────────────────────
const PROCESS = {
  sm: {
    inputs: [
      { label: 'CLT (Internal Clients)', sub: 'Request Check Service' },
      { label: 'Partner (External)', sub: 'Request Check Service' },
    ],
    core: { label: 'Service Monitoring 24/7', sub: 'Central Monitoring & Alert Management', icon: 'monitor' },
    outputs: [
      { label: 'CMT / ITPM', sub: 'PW Support & Incident Support' },
      { label: 'IM', sub: 'Incident Action & Management execution' },
      { label: 'Infra Teams', sub: 'Infrastructure & Platform status check' },
      { label: 'Dev Request', sub: 'Import Crash / Clear Cache / Infra ticket' },
    ],
    steps: [
      { n: '1', label: 'Request Received', desc: 'CLT/Partner ส่ง request เข้า SM' },
      { n: '2', label: 'Validate & Monitor', desc: '1st Tier: Initial validation, Basic investigation' },
      { n: '3', label: 'Alert Triggered', desc: 'Batch File หรือ Alert system ตรวจพบ anomaly' },
      { n: '4', label: 'Deep Investigate', desc: '2nd Tier: Check Error Log, Root cause analysis' },
      { n: '5', label: 'Escalate / Resolve', desc: 'ส่งต่อ IM/Infra/Dev ตาม severity' },
    ],
    outcomes: ['24/7 Monitoring', 'Fast Detection', 'Effective Collaboration', 'Service Reliability'],
  },
  ss: {
    inputs: [
      { label: 'CLT / Internal Teams', sub: 'Raise incidents or requests' },
      { label: 'Partner', sub: 'Raise complaints or tickets' },
    ],
    core: { label: '1st Tier Service Support', sub: 'Receive · Investigate · Escalate · Communicate', icon: 'headphones' },
    outputs: [
      { label: '2nd Tier TrueMoney', sub: 'High LV Investigate — Root cause identification' },
    ],
    steps: [
      { n: 'Open', label: 'Open Ticket', desc: 'รับ incident หรือ complaint เข้าระบบ' },
      { n: 'T+24', label: 'Day 1 Checkpoint', desc: 'Status update & initial investigation', color: 'green' },
      { n: 'T+48', label: 'Day 2 Checkpoint', desc: 'Progress update & escalation check', color: 'orange' },
      { n: 'T+72', label: 'SLA Deadline', desc: 'Day 3 — Must be resolved', color: 'red' },
    ],
    sla: 'SLA Ticket Within 72 Hours (Shared SLA with 2nd Tier TMN Tickets)',
    outcomes: ['Resolve Customer Complaints', 'Mitigate Customer Impact', 'Drive Service Improvements'],
  },
  ts: {
    inputs: [
      { label: 'SM', sub: 'Alert & Batch Detected — Monitoring alerts' },
      { label: 'SS', sub: 'Complain Case — Customer complaint, Service issue' },
    ],
    core: { label: '2nd Tier TrueMoney Support', sub: 'Investigate the Issue · Perform RCA · Find Root Cause', icon: 'search' },
    outputs: [
      { label: 'IMPB', sub: 'Incident Action — Execute incident action and closure' },
      { label: 'Engineering Teams', sub: 'Root cause analysis & fix and deployment support' },
    ],
    steps: [
      { n: '1', label: 'Detect & Escalate', desc: 'SM/SS ตรวจพบและส่งต่อมา 2nd Tier' },
      { n: '2', label: 'Investigate', desc: 'Analyze logs, perform RCA, identify root cause' },
      { n: '3', label: 'Collaborate', desc: 'ประสานงาน Engineering teams สำหรับ High-level investigation' },
      { n: '4', label: 'Resolve & Close', desc: 'Execute incident action และ confirm resolution' },
    ],
    sla: 'SLA Ticket Within 72 Hours (Shared SLA with 1st Tier Support Tickets)',
    outcomes: ['Detect & Escalate', 'Investigate', 'Collaborate', 'Resolve & Close'],
  },
  fas: {
    inputs: [
      { label: 'SM', sub: 'Alert & Batch Detected — Monitoring alerts, Batch issues' },
      { label: 'CLT / FinOps', sub: 'Complain Case — Customer/User complaint, Service issue' },
    ],
    core: { label: '2nd Tier Nano Support', sub: 'Investigate the Issue · RCA · Collaborate · Resolve', icon: 'bar-chart-2' },
    outputs: [
      { label: 'IMPB', sub: 'Incident Action & closure' },
      { label: 'Engineering Teams', sub: 'Root cause, Fix & deployment' },
      { label: 'External (MAMBU)', sub: 'Ticket investigation & RCA' },
    ],
    steps: [
      { n: '1', label: 'Collect & Analyze', desc: 'Review logs, alerts และ information จาก sources' },
      { n: '2', label: 'Investigate', desc: 'Analyze the issue and perform RCA' },
      { n: '3', label: 'Collaborate', desc: 'Work with teams & partners to identify root cause' },
      { n: '4', label: 'Resolve', desc: 'Provide solution and ensure issue is resolved' },
    ],
    sla: 'SLA Ticket Within 72 Hours',
    outcomes: ['Collect & Analyze', 'Investigate', 'Collaborate', 'Resolve'],
  },
  im: {
    inputs: [
      { label: 'SM', sub: 'Alert Detected — Monitoring system detects alert' },
      { label: '2nd Tier TMN / Nano', sub: 'Investigate the case and identify root cause' },
    ],
    core: { label: 'IMPB — Incident Management & Command', sub: 'Raise & Track · Coordinate War Room · Communicate · Mitigate & Recovery', icon: 'alert-triangle' },
    outputs: [
      { label: 'Engineering Teams', sub: 'Infra/Dev — Engage incident response & join war room' },
      { label: '3rd Party (External)', sub: 'Communicate and coordinate as required' },
      { label: 'Post Incident', sub: 'Prepare report & implement preventive actions' },
    ],
    steps: [
      { n: '1', label: 'Fast Detection', desc: 'SM ตรวจพบ alert และส่งต่อ 2nd Tier' },
      { n: '2', label: 'Effective Collaboration', desc: 'Coordinate teams และ stakeholders อย่างรวดเร็ว' },
      { n: '3', label: 'Minimize Impact', desc: 'Mitigate issues และ restore service' },
      { n: '4', label: 'Continuous Improvement', desc: 'Learn from incidents and prevent recurrence' },
    ],
    outcomes: ['Fast Detection', 'Effective Collaboration', 'Minimize Impact', 'Continuous Improvement'],
  },
  cmt: {
    inputs: [
      { label: 'Requester', sub: 'Submit change request' },
    ],
    core: { label: 'Change Management (CMT)', sub: 'Plan & Assess · Review & Approve · Coordinate CAB · Manage Closure', icon: 'git-branch' },
    outputs: [
      { label: 'PM Team (Infra/Dev)', sub: 'Implement the change · Sanity / QA validation' },
      { label: 'Monitoring Teams', sub: 'Validate system stability after implementation' },
    ],
    steps: [
      { n: '1', label: 'Submit Request', desc: 'Requester submits change request' },
      { n: '2', label: 'Plan & Assess', desc: 'CMT plans, schedules and determines impact' },
      { n: '3', label: 'Review & Approve', desc: 'Change reviewed by approvers / CAB' },
      { n: '4', label: 'Implement', desc: 'Execute the change by PM Team (Infra/Dev)' },
      { n: '5', label: 'Validate & Monitor', desc: 'Sanity/QA validation — Verify success' },
      { n: '6', label: 'Close & Review', desc: 'Review lessons, update records, close change' },
    ],
    outcomes: ['Review Change Requests', 'Maintain Change Success Rate', 'Coordinate CAB Reviews'],
  },
  smart: {
    inputs: [
      { label: 'SM', sub: 'Alert & Batch Detected — Monitoring alerts' },
      { label: 'CLT / FinOps', sub: 'Complain Case — Customer complaints & Operational issues' },
    ],
    core: { label: 'Ascend Bank Support', sub: 'Analyze & Investigate · Identify Root Cause · Implement Solution · Validate & Document', icon: 'landmark' },
    outputs: [
      { label: 'IMPB', sub: 'Incident Action' },
      { label: 'Engineering Teams', sub: 'Root cause analysis & deployment' },
      { label: 'External (10x, MAMBU)', sub: 'Ticket investigation & RCA' },
    ],
    steps: [
      { n: '1', label: 'Monitor & Alert', desc: 'Collect issues proactively from SM alerts' },
      { n: '2', label: 'Log & Analyze', desc: 'Collect and analyze data from all sources' },
      { n: '3', label: 'Collaborate', desc: 'Work with teams for fast resolution' },
      { n: '4', label: 'Share Knowledge', desc: 'Capture learnings and share with teams' },
      { n: '5', label: 'Improve', desc: 'Improve process and reduce recurring issues' },
    ],
    outcomes: ['Fast Issue Detection', 'Effective Resolution', 'Minimized Customer Impact', 'Operational Excellence'],
  },
};

function renderProcess(slug, color) {
  const p = PROCESS[slug];
  if (!p) return '';

  const arrowSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;

  const inputsHtml = p.inputs.map(n => `
    <div class="proc-node">
      <div class="proc-node-label">${escHtml(n.label)}</div>
      <div class="proc-node-sub">${escHtml(n.sub)}</div>
    </div>`).join('');

  const outputsHtml = p.outputs.map(n => `
    <div class="proc-node">
      <div class="proc-node-label">${escHtml(n.label)}</div>
      <div class="proc-node-sub">${escHtml(n.sub)}</div>
    </div>`).join('');

  const stepsHtml = p.steps.map(s => `
    <div class="proc-step">
      <div class="proc-step-num${s.color ? ' ' + s.color : ''}">${escHtml(s.n)}</div>
      <div class="proc-step-label">${escHtml(s.label)}</div>
    </div>`).join('');

  const outcomesHtml = p.outcomes.map(o =>
    `<div class="proc-outcome"><i data-icon="check" style="width:10px;height:10px"></i>${escHtml(o)}</div>`
  ).join('');

  const slaHtml = p.sla
    ? `<div class="proc-sla"><i data-icon="check-circle" style="width:14px;height:14px"></i>${escHtml(p.sla)}</div>`
    : '';

  return `
    <div class="proc-wrap" style="--tc:${color}">
      <!-- 3-column flow -->
      <div class="proc-flow">
        <div class="proc-col">${inputsHtml}</div>
        <div class="proc-arrow">${arrowSvg}</div>
        <div class="proc-center">
          <div class="proc-center-icon"><i data-icon="${p.core.icon || 'layers'}"></i></div>
          <div class="proc-center-label">${escHtml(p.core.label)}</div>
          <div class="proc-center-sub">${escHtml(p.core.sub)}</div>
        </div>
        <div class="proc-arrow">${arrowSvg}</div>
        <div class="proc-col">${outputsHtml}</div>
      </div>
      <!-- Step timeline -->
      <div class="proc-steps">${stepsHtml}</div>
      ${slaHtml}
      <!-- Outcomes -->
      <div class="proc-outcomes">${outcomesHtml}</div>
    </div>`;
}

// ── State ─────────────────────────────────────────────────────────────────────
let _teams     = [];       // full API org_teams array
let _teamInfo  = {};       // team_info from API (admin-editable content)
let _memberMap = {};       // id → {m, slug} for modal
let _d         = null;    // full API response (for org chart)
let _active    = null;

function storeMember(m, slug) { _memberMap[m.id] = { m, slug }; }

// ── Leadership section ────────────────────────────────────────────────────────
function renderLeadership(headOfOps, heads, managers) {
  const section = document.getElementById('ldr-section');
  const body    = document.getElementById('ldr-body');
  if (!section || !body) return;

  // Synthetic ID for the manual head_of_ops entry (no system account)
  const HOP_ID = '__hop__';
  const hopValid = headOfOps && (headOfOps.name || '').trim();
  if (hopValid) {
    const synth = {
      id: HOP_ID, name: headOfOps.name, nickname: headOfOps.nickname || '',
      position: headOfOps.position || 'Head of Tech Operations',
      email: headOfOps.email || '', phone: '', avatar_url: headOfOps.avatar_url || '',
      role: 'leadership',
    };
    _memberMap[HOP_ID] = { m: synth, slug: '__ldr' };
  }

  const allLdr = [...(heads || []), ...(managers || [])];
  if (!allLdr.length && !hopValid) return;

  // Store all leadership in _memberMap under slug '__ldr' so modal works
  allLdr.forEach(m => { _memberMap[m.id] = { m, slug: '__ldr' }; });

  function cardHtml(m, type) {
    const av = m.avatar_url
      ? `<img src="${escHtml(m.avatar_url)}" alt=""
          style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block"
          onerror="this.outerHTML='<span>${initials(m.name)}</span>'">`
      : `<span>${initials(m.name)}</span>`;
    const badge = type === 'head'
      ? `<div class="ldr-type-badge"><i data-icon="star" style="width:9px;height:9px"></i> Head of Operations</div>`
      : `<div class="ldr-type-badge"><i data-icon="users" style="width:9px;height:9px"></i> SOM Manager</div>`;
    return `
      <div class="ldr-card ${type === 'head' ? 'head-of' : 'manager'}"
           style="cursor:pointer" onclick="openModal('${escHtml(m.id)}')">
        <div class="ldr-av">${av}</div>
        <div class="ldr-meta">
          ${badge}
          <div class="ldr-name">${escHtml(m.name)}</div>
          ${m.nickname ? `<div class="ldr-nick">(${escHtml(m.nickname)})</div>` : ''}
          ${m.position ? `<div class="ldr-pos">${escHtml(m.position)}</div>` : ''}
        </div>
      </div>`;
  }

  let html = '';

  // Head of Operations (manual entry first, then system-account heads)
  const headCards = [
    ...(hopValid ? [{ id: '__hop__', name: headOfOps.name, nickname: headOfOps.nickname || '',
                       position: headOfOps.position || 'Head of Tech Operations',
                       email: headOfOps.email || '', avatar_url: headOfOps.avatar_url || '' }] : []),
    ...(heads || []),
  ];
  if (headCards.length) {
    html += `<div class="ldr-grid" style="margin-bottom:10px">
      ${headCards.map(m => cardHtml(m, 'head')).join('')}
    </div>`;
  }
  if (headCards.length && (managers || []).length) {
    html += `<div class="ldr-divider">
      <div class="ldr-divider-line"></div>
      <div class="ldr-divider-label">SOM Managers</div>
      <div class="ldr-divider-line"></div>
    </div>`;
  }
  if ((managers || []).length) {
    html += `<div class="ldr-grid">${managers.map(m => cardHtml(m, 'mgr')).join('')}</div>`;
  }

  body.innerHTML = html;
  section.style.display = '';
  if (window.Icons) Icons.renderAll?.() || Icons.replace?.();
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function renderSidebar() {
  document.getElementById('te-list').innerHTML = _teams.map(t => {
    const ti = _teamInfo[t.slug] || {};
    return `<div class="te-row" id="tr-${t.slug}" style="--tc:${t.color}"
                 onclick="selectTeam('${t.slug}')">
      <div class="te-row-dot"></div>
      <div class="te-row-info">
        <div class="te-row-abbr">${escHtml(ti.abbr || t.slug.toUpperCase())}</div>
        <div class="te-row-name">${escHtml(ti.full_name || t.name)}</div>
      </div>
      <div class="te-row-cnt">${t.count}</div>
    </div>`;
  }).join('');
  if (window.Icons) Icons.renderAll?.() || Icons.replace?.();
}

// ── Detail panel ──────────────────────────────────────────────────────────────
function renderDetail(t) {
  const ti = _teamInfo[t.slug] || {};
  const color = t.color || '#6366f1';

  // Store members
  const leaderIds = new Set((t.leaders || []).map(l => l.id));
  const sorted    = [
    ...(t.leaders || []),
    ...(t.members || []).filter(m => !leaderIds.has(m.id)),
  ];
  sorted.forEach(m => storeMember(m, t.slug));

  // Team abbr for watermark
  const abbr = ti.abbr || t.slug.toUpperCase();

  // Leader cards
  const leaderHtml = (t.leaders || []).length
    ? (t.leaders).map(m => `
      <div class="te-leader-card" style="--tc:${color}" data-abbr="${escHtml(abbr)}">
        <div class="te-leader-av">${avatarImg(m, 58)}</div>
        <div class="te-leader-meta">
          <div class="te-leader-badge"><i data-icon="award" style="width:10px;height:10px"></i> Team Lead</div>
          <div class="te-leader-name">${escHtml(m.name)}</div>
          ${m.nickname ? `<div class="te-leader-nick">(${escHtml(m.nickname)})</div>` : ''}
          ${m.position ? `<div class="te-leader-pos">${escHtml(m.position)}</div>` : ''}
        </div>
      </div>`).join('')
    : `<div class="te-no-leader">ยังไม่ได้กำหนด Team Lead — แก้ไขได้ที่ Edit Content</div>`;

  // KPI
  const kpiHtml = (ti.kpis || []).map(k => `
    <div class="te-kpi-item" style="--tc:${color}">
      <div class="te-kpi-icon"><i data-icon="target" style="width:14px;height:14px"></i></div>
      <div class="te-kpi-text">${escHtml(k)}</div>
    </div>`).join('') || `<div class="te-resp-item" style="color:var(--text-muted);font-style:italic">ยังไม่ได้ตั้งค่า</div>`;

  // Responsibilities
  const respHtml = (ti.responsibilities || []).map(r => `
    <div class="te-resp-item">
      <div class="te-resp-dot" style="background:${color}"></div>
      <span>${escHtml(r)}</span>
    </div>`).join('') || `<div style="color:var(--text-muted);font-size:11.5px;font-style:italic">ยังไม่ได้ตั้งค่า</div>`;

  const slaHtml = ti.sla
    ? `<div class="te-sla" style="display:inline-flex"><i data-icon="check-circle" style="width:14px;height:14px"></i>${escHtml(ti.sla)}</div>`
    : '';

  // Members (non-leaders)
  const nonLeaders = sorted.filter(m => !leaderIds.has(m.id));
  const memberHtml = sorted.length
    ? sorted.map(m => {
        const isLead = leaderIds.has(m.id);
        return `
      <div class="te-member-card" style="--tc:${color}${isLead ? ';border-color:color-mix(in srgb,#f59e0b 50%,var(--border))' : ''}"
           data-abbr="${escHtml(abbr)}"
           onclick="openModal('${escHtml(m.id)}')">
        <div class="te-member-av" style="${isLead ? 'border-color:#f59e0b;box-shadow:0 0 0 3px rgba(245,158,11,.14)' : ''}">${avatarImg(m, 52)}</div>
        ${isLead ? `<div style="display:inline-flex;align-items:center;gap:3px;font-size:8px;font-weight:800;letter-spacing:.07em;background:#f59e0b;color:#fff;padding:2px 7px;border-radius:4px">★ Lead</div>` : ''}
        <div class="te-member-name">${escHtml(m.name)}</div>
        ${m.nickname ? `<div class="te-member-nick">(${escHtml(m.nickname)})</div>` : ''}
      </div>`;
      }).join('')
    : `<div class="te-no-members">ยังไม่มีสมาชิก</div>`;

  // Contact
  const contacts = [];
  if (ti.contact_email) contacts.push({ icon: 'mail',  lbl: 'Email',      val: `<a href="mailto:${escHtml(ti.contact_email)}">${escHtml(ti.contact_email)}</a>` });
  if (ti.contact_tel)   contacts.push({ icon: 'phone', lbl: 'Tel',        val: ti.contact_tel });
  if (ti.hours)         contacts.push({ icon: 'clock', lbl: 'Working hours', val: ti.hours });
  const contactHtml = contacts.map(c => `
    <div class="te-contact-row">
      <div class="te-contact-ic" style="--tc:${color}"><i data-icon="${c.icon}"></i></div>
      <div>
        <div class="te-contact-lbl">${c.lbl}</div>
        <div class="te-contact-val">${c.val}</div>
      </div>
    </div>`).join('') || `<div style="color:var(--text-muted);font-size:11px;font-style:italic">ยังไม่ได้ตั้งค่า</div>`;

  // Tools
  const toolsHtml = (ti.tools || []).length
    ? (ti.tools).map(tool => `<div class="te-tool"><i data-icon="tool" style="width:11px;height:11px"></i>${escHtml(tool)}</div>`).join('')
    : `<div class="te-tools-none">—</div>`;

  const hasTools = (ti.tools || []).length > 0;

  document.getElementById('te-detail').innerHTML = `
    <div class="te-inner" style="--tc:${color}">

      <!-- Header -->
      <div class="te-header">
        <div class="te-header-left">
          <div class="te-team-badge"><i data-icon="${ti.icon || 'users'}"></i></div>
          <div>
            <div class="te-team-name">${escHtml(ti.full_name || t.name)}</div>
            <div class="te-header-chips">
              <span class="te-chip-abbr">${escHtml(ti.abbr || t.slug.toUpperCase())}</span>
              ${ti.hours ? `<span class="te-chip-hours"><i data-icon="clock" style="width:10px;height:10px"></i>${escHtml(ti.hours)}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="te-header-cnt">
          <div class="te-cnt-num">${t.count}</div>
          <div class="te-cnt-lbl">Members</div>
        </div>
      </div>

      <div class="te-body">

        <!-- Leaders -->
        <div class="te-block">
          <div class="te-sec-label"><i data-icon="award" style="width:11px;height:11px;color:#f59e0b"></i> Team Lead</div>
          <div class="te-leaders">${leaderHtml}</div>
        </div>

        <!-- KPI + Responsibilities -->
        <div class="te-block-2col">
          <div class="te-block">
            <div class="te-sec-label"><i data-icon="target" style="width:11px;height:11px"></i> KPI</div>
            <div class="te-kpi-list">${kpiHtml}</div>
            ${slaHtml}
          </div>
          <div class="te-block">
            <div class="te-sec-label"><i data-icon="list" style="width:11px;height:11px"></i> What We Do</div>
            <div class="te-resp-list">${respHtml}</div>
          </div>
        </div>

        <!-- Work Process -->
        <div class="te-block">
          <div class="te-sec-label"><i data-icon="git-merge" style="width:11px;height:11px"></i> Work Process</div>
          ${renderProcess(t.slug, color)}
        </div>

        <!-- Members -->
        <div class="te-block">
          <div class="te-sec-label"><i data-icon="users" style="width:11px;height:11px"></i> Members (${t.count} คน)</div>
          <div class="te-member-grid">${memberHtml}</div>
        </div>

        <!-- Contact + Tools -->
        <div class="te-block-2col">
          <div class="te-block" style="${!hasTools ? 'border-right:none;grid-column:1/-1' : ''}">
            <div class="te-sec-label"><i data-icon="phone" style="width:11px;height:11px"></i> Contact</div>
            <div class="te-contact-list">${contactHtml}</div>
          </div>
          ${hasTools ? `
          <div class="te-block">
            <div class="te-sec-label"><i data-icon="tool" style="width:11px;height:11px"></i> Tools</div>
            <div class="te-tools">${toolsHtml}</div>
          </div>` : ''}
        </div>

      </div>
    </div>`;

  if (window.Icons) Icons.renderAll?.() || Icons.replace?.();
}

// ── Select team ───────────────────────────────────────────────────────────────
function selectTeam(slug) {
  if (_active === slug) return;
  _active = slug;

  document.querySelectorAll('.te-row').forEach(r =>
    r.classList.toggle('active', r.id === `tr-${slug}`)
  );

  const detail = document.getElementById('te-detail');
  detail.style.cssText = 'opacity:0;transition:opacity .12s';
  setTimeout(() => {
    const t = _teams.find(x => x.slug === slug);
    if (t) renderDetail(t);
    detail.style.opacity = '1';
  }, 110);
}

// ── Member modal ──────────────────────────────────────────────────────────────
function openModal(id) {
  const entry = _memberMap[id]; if (!entry) return;
  const m  = entry.m;
  const isLdr = entry.slug === '__ldr';
  const t  = isLdr ? {} : (_teams.find(x => x.slug === entry.slug) || {});
  const ti = isLdr ? {} : (_teamInfo[entry.slug] || {});
  // Leaders use orange accent; team members use team color
  const color = isLdr ? 'var(--ab-orange, #F26419)' : (t.color || '#6366f1');
  const roleLabel = isLdr ? 'Leadership' : (ROLE_LABELS[m.role] || m.role);

  const rows = [
    m.name_th  ? { ic:'user',      lbl:'ชื่อภาษาไทย', val: m.name_th  } : null,
    m.emp_id   ? { ic:'badge',     lbl:'Employee ID',  val: m.emp_id   } : null,
    m.position ? { ic:'briefcase', lbl:'ตำแหน่ง',      val: m.position } : null,
    !isLdr ? { ic:'users', lbl:'Team', val: ti.full_name || t.name || entry.slug } : null,
    { ic:'shield', lbl:'Role', val: roleLabel },
    m.email    ? { ic:'mail',  lbl:'Email', val: m.email } : null,
    m.phone    ? { ic:'phone', lbl:'Phone', val: m.phone } : null,
  ].filter(Boolean);

  const rowHtml = rows.map(r => {
    let v = escHtml(r.val);
    if (r.ic === 'mail')  v = `<a href="mailto:${escHtml(r.val)}" style="color:inherit;text-decoration:none">${escHtml(r.val)}</a>`;
    if (r.ic === 'phone') v = `<a href="tel:${escHtml(r.val)}" style="color:inherit;text-decoration:none">${escHtml(r.val)}</a>`;
    return `<div class="m-row">
      <div class="m-row-ic" style="--tc:${color}"><i data-icon="${r.ic}"></i></div>
      <div><div class="m-row-lbl">${r.lbl}</div><div class="m-row-val">${v}</div></div>
    </div>`;
  }).join('');

  // abbr for banner watermark
  const modalAbbr = isLdr ? 'SOM' : (ti.abbr || (t.slug || '').toUpperCase() || '?');

  const ov = document.createElement('div');
  ov.className = 'm-overlay';
  ov.style.setProperty('--tc', color);
  ov.innerHTML = `
    <div class="m-modal" style="--tc:${color}">
      <!-- A+G banner -->
      <div class="m-modal-banner" style="--tc:${color}" data-abbr="${escHtml(modalAbbr)}">
        <div class="m-modal-close-wrap">
          <button class="m-modal-close" onclick="this.closest('.m-overlay').remove()">✕ ปิด</button>
        </div>
      </div>
      <div class="m-modal-body">
        <div class="m-av-wrap" style="--tc:${color}">
          <div class="m-av">${avatarImg(m, 80)}</div>
          <div class="m-name">${escHtml(m.name)}</div>
          ${m.nickname ? `<div class="m-nick">(${escHtml(m.nickname)})</div>` : ''}
          <div class="m-badges"><span class="m-badge" style="--tc:${color}">${escHtml(roleLabel)}</span></div>
        </div>
        ${rows.length ? `<div class="m-rows" style="--tc:${color}">${rowHtml}</div>` : ''}
      </div>
    </div>`;
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  document.body.appendChild(ov);
  if (window.Icons) Icons.renderAll?.() || Icons.replace?.();
}

// ── Load ──────────────────────────────────────────────────────────────────────
async function loadPage() {
  try {
    const res = await API.aboutPage.get();
    const d = res?.data?.data || res?.data || {};

    _teams    = d.org_teams || [];
    _teamInfo = d.team_info || {};
    _d        = d; // store for org chart

    renderLeadership(d.head_of_ops || {}, d.heads || [], d.managers || []);

    const total = _teams.reduce((s, t) => s + (t.count || 0), 0);
    const elM = document.getElementById('hs-members');
    if (elM) { elM.textContent = total; elM.classList.remove('loading'); }
    const elT = document.getElementById('hs-teams');
    if (elT) elT.textContent = _teams.length;

    renderSidebar();
    if (_teams.length) selectTeam(_teams[0].slug);

  } catch {
    document.getElementById('te-list').innerHTML =
      `<div style="padding:20px;color:var(--text-muted);font-size:12px;text-align:center">โหลดข้อมูลไม่ได้</div>`;
  }
}

loadPage();

// ══════════════════════════════════════════════════════════════
//  ORG CHART — floating 3D overlay
// ══════════════════════════════════════════════════════════════
const TEAM_COLORS = {
  sm:    { c:'#a78bfa', dots:'rgba(167,139,250,.14)', wm:'rgba(167,139,250,.08)' },
  ss:    { c:'#22d3ee', dots:'rgba(34,211,238,.14)',  wm:'rgba(34,211,238,.08)' },
  ts:    { c:'#f472b6', dots:'rgba(244,114,182,.14)', wm:'rgba(244,114,182,.08)' },
  fas:   { c:'#fbbf24', dots:'rgba(251,191,36,.14)',  wm:'rgba(251,191,36,.08)' },
  im:    { c:'#ef4444', dots:'rgba(239,68,68,.14)',   wm:'rgba(239,68,68,.08)' },
  cmt:   { c:'#22c55e', dots:'rgba(34,197,94,.14)',   wm:'rgba(34,197,94,.08)' },
  smart: { c:'#8b5cf6', dots:'rgba(139,92,246,.14)',  wm:'rgba(139,92,246,.08)' },
};

// ── In-chart member expansion ──────────────────────────────────
const ROLE_LABELS_OC = { sm_admin:'Admin', sm_lead:'Lead', sm_user:'Member', dev_sm:'Dev', super_viewer:'Viewer' };
const _ocInits = name => (name||'?').trim().split(/\s+/).map(w=>w[0]).join('').toUpperCase().slice(0,2);
const _ocEsc   = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

let _mbrNodes = [];   // currently shown member DOM nodes
let _mbrSvgIds = [];  // IDs of SVG elements added for members
let _origSceneH = 0;  // scene height before expansion

function showTeamMembers(team, color, teamPos, teamIdx) {
  const scene = document.getElementById('oc-scene');
  const svg   = document.getElementById('oc-svg');
  if (!scene || !svg) return;

  const members = team.members || [];
  if (!members.length) return;

  const leaderIds = new Set((team.leaders||[]).map(l=>l.id));
  const sorted = [...members].sort((a,b) => {
    if (leaderIds.has(a.id) && !leaderIds.has(b.id)) return -1;
    if (!leaderIds.has(a.id) && leaderIds.has(b.id)) return 1;
    return (a.name||'').localeCompare(b.name||'');
  });

  // ── Layout constants ──────────────────────────────────────
  const MAX_PER_ROW = members.length <= 6 ? 3 : 4;
  const MBR_W = 175, MBR_H = 132, MBR_GAP = 20, ROW_GAP = 22;
  const TRUNK_H = 52, NODE_H_TEAM = 140;
  const sceneW = parseFloat(scene.style.width);

  // Team card actual top
  const existingCard = scene.querySelectorAll('.oc-node-team')[teamIdx];
  const teamTop  = existingCard ? parseFloat(existingCard.style.top) : 0;
  const teamBotY = teamTop + NODE_H_TEAM;
  const teamCX   = teamPos.cx;

  // Chunk members into rows
  const rows = [];
  for (let i = 0; i < sorted.length; i += MAX_PER_ROW) {
    rows.push(sorted.slice(i, i + MAX_PER_ROW));
  }

  const totalRowsH = rows.length * MBR_H + (rows.length - 1) * ROW_GAP;
  const firstRowY  = teamBotY + TRUNK_H;

  // Expand scene height
  _origSceneH = parseFloat(scene.style.height);
  const newH = Math.max(_origSceneH, firstRowY + totalRowsH + 28);
  scene.style.height = newH + 'px';
  svg.setAttribute('height', newH);
  svg.setAttribute('viewBox', `0 0 ${sceneW} ${newH}`);

  // ── SVG: trunk ↓ → bridge → each row ─────────────────────
  const uid = 'mbr' + Date.now();
  let svgAdd = `<g id="${uid}">`;

  // Trunk: team bottom → first bridge
  const trunkBotY = teamBotY + TRUNK_H / 2;
  svgAdd += `<line stroke="${color}" stroke-width="1.8" stroke-dasharray="5 4" opacity=".9"
    x1="${teamCX}" y1="${teamBotY}" x2="${teamCX}" y2="${trunkBotY}">
    <animate attributeName="stroke-dashoffset" from="0" to="-18" dur=".9s" repeatCount="indefinite"/>
  </line>`;

  rows.forEach((row, ri) => {
    const rowY   = firstRowY + ri * (MBR_H + ROW_GAP);
    const rowW   = row.length * MBR_W + (row.length - 1) * MBR_GAP;
    // Center row on teamCX, but clamp within scene
    let rowStartX = teamCX - rowW / 2;
    rowStartX = Math.max(8, Math.min(sceneW - rowW - 8, rowStartX));
    const firstMbrCX = rowStartX + MBR_W / 2;
    const lastMbrCX  = rowStartX + (row.length - 1) * (MBR_W + MBR_GAP) + MBR_W / 2;
    const bridgeY = rowY - ROW_GAP / 2 - 4;

    // Vertical from trunk/prev bridge → this row's bridge
    const srcX = teamCX;
    const srcY = ri === 0 ? trunkBotY : firstRowY + (ri - 1) * (MBR_H + ROW_GAP) + MBR_H + ROW_GAP / 2;
    svgAdd += `<line stroke="${color}" stroke-width="1.5" stroke-dasharray="4 4" opacity=".8"
      x1="${srcX}" y1="${srcY}" x2="${srcX}" y2="${bridgeY}">
      <animate attributeName="stroke-dashoffset" from="0" to="-16" dur="1s" repeatCount="indefinite"/>
    </line>`;

    // Horizontal bridge across this row
    svgAdd += `<line stroke="${color}" stroke-width="1.5" stroke-dasharray="4 4" opacity=".7"
      x1="${firstMbrCX}" y1="${bridgeY}" x2="${lastMbrCX}" y2="${bridgeY}">
      <animate attributeName="stroke-dashoffset" from="0" to="-16" dur=".85s" repeatCount="indefinite"/>
    </line>`;

    // Drop per member in this row
    row.forEach((m, ci) => {
      const mCX = rowStartX + ci * (MBR_W + MBR_GAP) + MBR_W / 2;
      svgAdd += `<line stroke="${color}" stroke-width="1.2" stroke-dasharray="3 4" opacity=".6"
        x1="${mCX}" y1="${bridgeY}" x2="${mCX}" y2="${rowY}">
        <animate attributeName="stroke-dashoffset" from="0" to="-14" dur="${(0.75 + ci * 0.06).toFixed(2)}s" repeatCount="indefinite"/>
      </line>`;
    });

    // ── Member cards for this row ─────────────────────────
    row.forEach((m, ci) => {
      const isLdr = leaderIds.has(m.id);
      const mX    = rowStartX + ci * (MBR_W + MBR_GAP);
      const delay = ((ri * MAX_PER_ROW + ci) * 0.035).toFixed(2);

      const avHtml = m.avatar_url
        ? `<img src="${_ocEsc(m.avatar_url)}" alt=""
            style="width:40px;height:40px;object-fit:cover;border-radius:50%;display:block"
            onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
           <span style="display:none;width:40px;height:40px;border-radius:50%;align-items:center;
             justify-content:center;font-weight:900;font-size:13px;color:#fff">
             ${_ocEsc(_ocInits(m.name))}</span>`
        : `<span>${_ocEsc(_ocInits(m.name))}</span>`;

      const node = document.createElement('div');
      node.className = 'oc-node oc-mbr-node';
      node.style.cssText = `left:${mX}px;top:${rowY}px;width:${MBR_W}px;animation:ocMbrIn .22s ${delay}s cubic-bezier(.22,.9,.28,1) both`;
      node.innerHTML = `
        <div class="oc-mbr-card" style="--mc:${color}">
          <div class="oc-mbr-av" style="border-color:${color}${isLdr?'':' opacity:.6'};${isLdr?`box-shadow:0 0 10px ${color}55`:''}">${avHtml}</div>
          <div class="oc-mbr-name">${_ocEsc((m.name||'–').split(' ').slice(0,2).join(' '))}</div>
          ${m.nickname?`<div class="oc-mbr-nick">(${_ocEsc(m.nickname)})</div>`:''}
          <div class="oc-mbr-role" style="background:${color}22;color:${color}">
            ${isLdr?'★ Lead':_ocEsc(ROLE_LABELS_OC[m.role]||m.role||'Member')}
          </div>
        </div>`;
      scene.appendChild(node);
      _mbrNodes.push(node);
    });
  });

  svgAdd += `</g>`;
  svg.innerHTML += svgAdd;
  _mbrSvgIds.push(uid);

  window.Icons?.render?.(scene);
}

function clearTeamMembers(restoreH) {
  _mbrNodes.forEach(n => n.remove());
  _mbrNodes = [];
  _mbrSvgIds.forEach(id => document.getElementById(id)?.remove());
  _mbrSvgIds = [];
  const h = restoreH || _origSceneH;
  if (h > 0) {
    const scene = document.getElementById('oc-scene');
    const svg   = document.getElementById('oc-svg');
    if (scene) scene.style.height = h + 'px';
    if (svg) {
      const sw = parseFloat(scene?.style.width||'0');
      svg.setAttribute('height', h);
      svg.setAttribute('viewBox', `0 0 ${sw} ${h}`);
    }
  }
  _origSceneH = 0;
}

function initOrgChart() {
  const btn  = document.getElementById('org-chart-btn');
  const ov   = document.getElementById('oc-overlay');
  const close = document.getElementById('oc-close');
  if (!btn || !ov) return;

  btn.addEventListener('click', () => { ov.style.display = 'flex'; renderOrgChart(); window.Icons?.render?.(ov); });
  close.addEventListener('click', () => { ov.style.display = 'none'; });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && ov.style.display !== 'none') ov.style.display = 'none'; });

  // Mouse parallax
  const wrap = document.getElementById('oc-scene-wrap');
  wrap?.addEventListener('mousemove', e => {
    const scene = document.getElementById('oc-scene');
    if (!scene) return;
    const rect = wrap.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width  - 0.5;
    const my = (e.clientY - rect.top)  / rect.height - 0.5;
    scene.style.transform = `rotateX(${-my*10}deg) rotateY(${mx*12}deg)`;
  });
  wrap?.addEventListener('mouseleave', () => {
    const scene = document.getElementById('oc-scene');
    if (scene) scene.style.transform = '';
  });
}

function renderOrgChart() {
  const scene = document.getElementById('oc-scene');
  const svg   = document.getElementById('oc-svg');
  if (!scene || !svg) return;

  const esc2 = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const hop  = _d?.head_of_ops || {};

  // org_teams from API are already objects: { slug, name, color, members, count, leaders }
  const managers = _d?.managers || [];
  const teams    = _d?.org_teams || [];  // already full objects!

  // Layout sizes
  const NODE_W_HEAD = 220, NODE_H_HEAD = 130;
  const NODE_W_MGR  = 190, NODE_H_MGR  = 120;
  const NODE_W_TEAM = 160, NODE_H_TEAM = 140;

  const GAP_H = 60;  // vertical gap between rows
  const GAP_T = 18;  // horizontal gap between team cards

  // Row Y positions (center-based)
  const ROW_HEAD = 0;
  const ROW_MGR  = ROW_HEAD + NODE_H_HEAD + GAP_H;
  const ROW_TEAM = ROW_MGR  + NODE_H_MGR  + GAP_H;

  // Total width for teams row
  const teamsTotalW = teams.length * NODE_W_TEAM + (teams.length - 1) * GAP_T;
  const mgrsTotalW  = managers.length * NODE_W_MGR + (managers.length > 1 ? GAP_T : 0);
  const sceneW = Math.max(teamsTotalW, mgrsTotalW, NODE_W_HEAD) + 60;
  const sceneH = ROW_TEAM + NODE_H_TEAM + 20;

  scene.style.width  = sceneW + 'px';
  scene.style.height = sceneH + 'px';
  svg.setAttribute('viewBox', `0 0 ${sceneW} ${sceneH}`);
  svg.setAttribute('width',  sceneW);
  svg.setAttribute('height', sceneH);

  // Positions (top-left of each node)
  const headX = (sceneW - NODE_W_HEAD) / 2;
  const headCX = headX + NODE_W_HEAD / 2, headCY = ROW_HEAD + NODE_H_HEAD;

  const mgrsStartX = (sceneW - mgrsTotalW) / 2;
  const mgrCenters = managers.map((_, i) => ({
    x: mgrsStartX + i * (NODE_W_MGR + GAP_T),
    cx: mgrsStartX + i * (NODE_W_MGR + GAP_T) + NODE_W_MGR / 2,
    cy: ROW_MGR + NODE_H_MGR / 2,
  }));

  const teamsStartX = (sceneW - teamsTotalW) / 2;
  const teamCenters = teams.map((_, i) => ({
    x: teamsStartX + i * (NODE_W_TEAM + GAP_T),
    cx: teamsStartX + i * (NODE_W_TEAM + GAP_T) + NODE_W_TEAM / 2,
    cy: ROW_TEAM + NODE_H_TEAM / 2,
  }));

  // ── Avatar helper ──────────────────────────────────────────
  function av(m, size, cls='') {
    if (m?.avatar_url) {
      return `<img src="${esc2(m.avatar_url)}" alt=""
        style="width:${size}px;height:${size}px;object-fit:cover;border-radius:50%;display:block"
        onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <span style="display:none;width:${size}px;height:${size}px;border-radius:50%;
          align-items:center;justify-content:center;font-weight:900;font-size:${Math.round(size*.4)}px">
          ${(m?.name||'?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)}
        </span>`;
    }
    return `<span>${(m?.name||'?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)}</span>`;
  }

  // ── Build HTML ─────────────────────────────────────────────
  // Clear
  scene.innerHTML = '';
  scene.appendChild(svg);

  // Head of Ops card
  const headCard = document.createElement('div');
  headCard.className = 'oc-node oc-node-head';
  headCard.style.cssText = `left:${headX}px;top:${ROW_HEAD}px;width:${NODE_W_HEAD}px`;
  headCard.innerHTML = `
    <div class="oc-card" data-abbr="HQ"
      style="--nc:rgba(242,100,25,.8);--ndots:radial-gradient(rgba(242,100,25,.14) 1.5px,transparent 1.5px);--nwm:rgba(242,100,25,.07)">
      <div class="oc-card-inner">
        <div class="oc-type-badge" style="--nc:#F26419;filter:none;background:rgba(242,100,25,.15);color:#fb923c;border-color:rgba(242,100,25,.3)">
          <i data-icon="star" style="width:9px;height:9px"></i> Head of Operations
        </div>
        <div class="oc-row">
          <div class="oc-avatar" style="border-color:#F26419">${av(hop, 40)}</div>
          <div>
            <div class="oc-name">${esc2(hop.name||'–')}</div>
            ${hop.nickname?`<div class="oc-nick">(${esc2(hop.nickname)})</div>`:''}
            <div class="oc-pos" style="--nc:#F26419;filter:none;color:#fb923c">${esc2(hop.position||'Head of Tech Operations')}</div>
          </div>
        </div>
        <div class="oc-hover-details">
          ${hop.email?`<div class="oc-kpi" style="--nc:#F26419">${esc2(hop.email)}</div>`:''}
        </div>
      </div>
    </div>`;
  scene.appendChild(headCard);

  // Manager cards
  managers.forEach((m, i) => {
    const pos = mgrCenters[i];
    const card = document.createElement('div');
    card.className = 'oc-node oc-node-mgr';
    card.style.cssText = `left:${pos.x}px;top:${ROW_MGR}px;width:${NODE_W_MGR}px`;
    card.innerHTML = `
      <div class="oc-card" data-abbr="MGR"
        style="--nc:rgba(167,139,250,.7);--ndots:radial-gradient(rgba(167,139,250,.14) 1.5px,transparent 1.5px);--nwm:rgba(167,139,250,.07)">
        <div class="oc-card-inner">
          <div class="oc-type-badge" style="--nc:#a78bfa;filter:none;background:rgba(167,139,250,.15);color:#c4b5fd;border-color:rgba(167,139,250,.3)">
            <i data-icon="users" style="width:9px;height:9px"></i> SOM Manager
          </div>
          <div class="oc-row">
            <div class="oc-avatar oc-avatar-sm" style="border-color:#a78bfa">${av(m, 30)}</div>
            <div>
              <div class="oc-name" style="font-size:12px">${esc2(m.name||'–')}</div>
              ${m.nickname?`<div class="oc-nick">(${esc2(m.nickname)})</div>`:''}
              <div class="oc-pos" style="color:#c4b5fd">${esc2(m.position||m.role||'Manager')}</div>
            </div>
          </div>
        </div>
      </div>`;
    scene.appendChild(card);
  });

  // Team cards — t is a full object from API: {slug, name, color, count, members, leaders}
  teams.forEach((t, i) => {
    // t.color (from API) is the source of truth — matches sidebar dots; TEAM_COLORS only fills dots/wm
    const _tcBase = TEAM_COLORS[t.slug] || {};
    const tc = {
      c:    t.color || _tcBase.c || '#64748b',
      dots: _tcBase.dots || `rgba(100,116,139,.14)`,
      wm:   _tcBase.wm   || `rgba(100,116,139,.07)`,
    };
    const info = _teamInfo?.[t.slug] || {};  // admin-editable fields: abbr, full_name, icon, hours, sla, kpis
    const pos  = teamCenters[i];
    const abbr = info.abbr || t.slug.toUpperCase();
    const fullName = info.full_name || t.name || t.slug;
    const icon = info.icon || 'layers';
    const kpis = (info.kpis || []).slice(0, 2);
    const card = document.createElement('div');
    card.className = 'oc-node oc-node-team';
    card.style.cssText = `left:${pos.x}px;top:${ROW_TEAM}px;width:${NODE_W_TEAM}px`;
    card.innerHTML = `
      <div class="oc-card" data-abbr="${esc2(abbr)}"
        style="--nc:${tc.c};--ndots:radial-gradient(${tc.dots} 1.5px,transparent 1.5px);--nwm:${tc.wm}">
        <div class="oc-card-inner">
          <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:8px">
            <div class="oc-team-icon" style="color:${tc.c}"><i data-icon="${esc2(icon)}"></i></div>
            <div style="min-width:0">
              <div class="oc-team-abbr" style="color:${tc.c}">${esc2(abbr)}</div>
              <div class="oc-team-name">${esc2(fullName)}</div>
            </div>
          </div>
          <div style="font-size:9.5px;color:rgba(255,255,255,.4);margin-bottom:4px">
            <i data-icon="users" style="width:9px;height:9px;margin-right:3px;vertical-align:-.1em"></i>
            ${t.count||0} members${t.leaders?.length?` · Lead: ${esc2(t.leaders[0]?.nickname||t.leaders[0]?.name||'')}` :''}
          </div>
          ${info.hours?`<div class="oc-hours"><i data-icon="clock" style="width:9px;height:9px;margin-right:3px;vertical-align:-.1em"></i>${esc2(info.hours)}</div>`:''}
          ${info.sla?`<div class="oc-hours" style="margin-top:2px"><i data-icon="shield" style="width:9px;height:9px;margin-right:3px;vertical-align:-.1em"></i>${esc2(info.sla)}</div>`:''}
          ${kpis.length?`<div class="oc-hover-details">${kpis.map(k=>`<div class="oc-kpi" style="--nc:${tc.c}">${esc2(k)}</div>`).join('')}</div>`:''}
        </div>
      </div>`;
    // ── Click → expand/collapse members below this team card ──
    card.addEventListener('click', () => {
      const isOpen = card.dataset.open === '1';
      // Close any open team first
      scene.querySelectorAll('.oc-node-team[data-open="1"]').forEach(c => {
        c.dataset.open = '0';
        c.querySelector('.oc-card')?.classList.remove('oc-card-active');
      });
      clearTeamMembers(_origSceneH || sceneH);
      if (!isOpen) {
        card.dataset.open = '1';
        card.querySelector('.oc-card')?.classList.add('oc-card-active');
        showTeamMembers(t, tc.c, pos, i);
      }
    });

    scene.appendChild(card);
  });

  // ── SVG Connector lines ────────────────────────────────────
  // Draw AFTER appending all nodes so coordinates are correct

  // Vertical trunk from head bottom to horizontal bridge for managers
  const headBotY = ROW_HEAD + NODE_H_HEAD;
  const mgrTopY  = ROW_MGR;
  const mgrBotY  = ROW_MGR + NODE_H_MGR;
  const teamTopY = ROW_TEAM;
  const midHM    = (headBotY + mgrTopY) / 2;
  const midMT    = (mgrBotY + teamTopY) / 2;

  // Colors
  const OC  = 'rgba(242,100,25,.7)';   // orange (head→mgr)
  const PC  = 'rgba(167,139,250,.65)'; // purple (mgr→team)
  const LW  = '1.5';                   // line width
  const LW2 = '1.2';

  let svgHtml = '';

  if (managers.length && mgrCenters.length) {
    // 1. Head → vertical trunk → split to each manager
    const trunkX = headCX;
    svgHtml += `<line stroke="${OC}" stroke-width="${LW}" stroke-dasharray="5 4"
      x1="${trunkX}" y1="${headBotY}" x2="${trunkX}" y2="${midHM}">
      <animate attributeName="stroke-dashoffset" from="0" to="-18" dur="1.2s" repeatCount="indefinite"/>
    </line>`;
    // Horizontal bridge between managers at midHM
    if (mgrCenters.length > 1) {
      svgHtml += `<line stroke="${OC}" stroke-width="${LW}" stroke-dasharray="5 4"
        x1="${mgrCenters[0].cx}" y1="${midHM}"
        x2="${mgrCenters[mgrCenters.length-1].cx}" y2="${midHM}">
        <animate attributeName="stroke-dashoffset" from="0" to="-18" dur="1s" repeatCount="indefinite"/>
      </line>`;
    }
    // Each manager: horizontal to its cx + vertical down
    mgrCenters.forEach(pos => {
      svgHtml += `<line stroke="${OC}" stroke-width="${LW}" stroke-dasharray="5 4"
        x1="${pos.cx}" y1="${midHM}" x2="${pos.cx}" y2="${mgrTopY}">
        <animate attributeName="stroke-dashoffset" from="0" to="-18" dur="1.4s" repeatCount="indefinite"/>
      </line>`;
    });
  } else {
    // No managers: direct head → teams
    svgHtml += `<line stroke="${OC}" stroke-width="${LW}" stroke-dasharray="5 4"
      x1="${headCX}" y1="${headBotY}" x2="${headCX}" y2="${midMT}"/>`;
  }

  if (teams.length && teamCenters.length) {
    const mgrMidX = mgrCenters.length
      ? (mgrCenters[0].cx + mgrCenters[mgrCenters.length-1].cx) / 2
      : headCX;
    const srcX = mgrCenters.length ? mgrMidX : headCX;
    const srcY = mgrCenters.length ? mgrBotY : headBotY;
    const bridgeY2 = (srcY + teamTopY) / 2;

    // Vertical trunk from mgr mid bottom
    svgHtml += `<line stroke="${PC}" stroke-width="${LW}" stroke-dasharray="5 4"
      x1="${srcX}" y1="${srcY}" x2="${srcX}" y2="${bridgeY2}">
      <animate attributeName="stroke-dashoffset" from="0" to="-18" dur="1.1s" repeatCount="indefinite"/>
    </line>`;
    // Horizontal bridge at bridgeY2 across all teams
    svgHtml += `<line stroke="${PC}" stroke-width="${LW}" stroke-dasharray="5 4"
      x1="${teamCenters[0].cx}" y1="${bridgeY2}"
      x2="${teamCenters[teamCenters.length-1].cx}" y2="${bridgeY2}">
      <animate attributeName="stroke-dashoffset" from="0" to="-18" dur="0.9s" repeatCount="indefinite"/>
    </line>`;
    // Each team: vertical from bridge to card top
    teamCenters.forEach((pos, i) => {
      const dur = (0.8 + i * 0.05).toFixed(2);
      const tc  = TEAM_COLORS[teams[i]?.slug] || {};
      const clr = tc.c ? tc.c.replace(')', ',0.6)').replace('rgb(','rgba(').replace('#', '') : PC;
      const strokeClr = tc.c ? tc.c + 'aa' : PC;
      svgHtml += `<line stroke="${strokeClr}" stroke-width="${LW2}" stroke-dasharray="4 5"
        x1="${pos.cx}" y1="${bridgeY2}" x2="${pos.cx}" y2="${teamTopY}">
        <animate attributeName="stroke-dashoffset" from="0" to="-18" dur="${dur}s" repeatCount="indefinite"/>
      </line>`;
    });
  }

  svg.innerHTML = svgHtml;

  // Legend
  const legend = document.createElement('div');
  legend.className = 'oc-legend';
  legend.innerHTML = `
    <div class="oc-leg"><div class="oc-leg-dot" style="background:#F26419"></div>Head of Ops</div>
    <div class="oc-leg"><div class="oc-leg-dot" style="background:#a78bfa"></div>Managers</div>
    <div class="oc-leg"><div class="oc-leg-dot" style="background:rgba(255,255,255,.3)"></div>Teams</div>
  `;
  document.getElementById('oc-scene-wrap')?.appendChild(legend);

  window.Icons?.render?.(scene);
}

// Init org chart button (runs once DOM ready)
initOrgChart();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "avatarImg", { configurable: true, get: () => avatarImg, set: (v) => { avatarImg = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "initials", { configurable: true, get: () => initials, set: (v) => { initials = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadPage", { configurable: true, get: () => loadPage, set: (v) => { loadPage = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openModal", { configurable: true, get: () => openModal, set: (v) => { openModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderDetail", { configurable: true, get: () => renderDetail, set: (v) => { renderDetail = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderLeadership", { configurable: true, get: () => renderLeadership, set: (v) => { renderLeadership = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderProcess", { configurable: true, get: () => renderProcess, set: (v) => { renderProcess = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderSidebar", { configurable: true, get: () => renderSidebar, set: (v) => { renderSidebar = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "selectTeam", { configurable: true, get: () => selectTeam, set: (v) => { selectTeam = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "storeMember", { configurable: true, get: () => storeMember, set: (v) => { storeMember = v; } }); } catch (e) {}
})();
