// admin/ma-test-overview — page script, extracted from admin/ma-test-overview.html.
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
const _u = Auth.getUser();
if (!_u || !['super_admin','sm_admin','sm_lead','dev_sm'].includes(_u.role)) {
  Toast?.error?.('Admin/Lead only');
  setTimeout(() => location.replace('../dashboard.html'), 800);
}
if (_u && _u.team && _u.team !== 'sm' && !['super_admin','super_viewer'].includes(_u.role)) {
  Toast?.error?.('SM team only');
  setTimeout(() => location.replace('../dashboard.html'), 800);
}
Layout.render('admin');

const esc = MaTest.escapeHtml;

// ── Populate filter selects ──────────────────────────────────
MaTest.SERVICES  .forEach(s => document.getElementById('f-service') .insertAdjacentHTML('beforeend', `<option value="${s}">${s}</option>`));
MaTest.TOOLS     .forEach(t => document.getElementById('f-tool')    .insertAdjacentHTML('beforeend', `<option value="${t}">${t}</option>`));
MaTest.PRIORITIES.forEach(p => document.getElementById('f-priority').insertAdjacentHTML('beforeend', `<option value="${p}">${p}</option>`));
document.getElementById('month').value = MaTest.currentMonth();

// ── State ────────────────────────────────────────────────────
let plan = [];
let results = [];
let rows = []; // enriched per-plan-item rows

async function load() {
  const month = document.getElementById('month').value;
  document.getElementById('detail-title').textContent = month;
  const [planRes, resRes] = await Promise.all([
    MaTest.api.listPlan(month),
    MaTest.api.listResults(month),
  ]);
  plan    = planRes?.success ? (planRes.data.items || []) : [];
  results = resRes?.success  ? (resRes.data.items  || []) : [];
  buildRows();
  renderStats();
  renderBreakdown();
  render();
}

// ── Enrich each plan item with result summary ────────────────
function buildRows() {
  // group results by catalog_id (results reference plan_id + catalog_id)
  const byCat = {};
  for (const r of results) {
    const cid = String(r.catalog_id || '');
    if (!byCat[cid]) byCat[cid] = [];
    byCat[cid].push(r);
  }
  // sort each bucket by created_at desc so [0] is latest
  Object.values(byCat).forEach(list =>
    list.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
  );

  rows = plan.map(p => {
    const cat = p.catalog || {};
    const rs = byCat[String(p.catalog_id)] || [];
    const latest = rs[0] || null;

    const succ = rs.filter(r => r.result === 'Successed').length;
    const fail = rs.filter(r => r.result === 'Failed').length;
    const pend = rs.filter(r => r.result === 'Pending').length;

    // Overall status prefers a latest-tested outcome; falls back to Not tested.
    let status = 'not_tested';
    if (latest) {
      if      (latest.result === 'Successed') status = 'successed';
      else if (latest.result === 'Failed')    status = 'failed';
      else if (latest.result === 'Pending')   status = 'pending';
      else                                    status = 'pending';
    }
    return {
      plan_id: p.id, catalog_id: p.catalog_id, cat,
      count: rs.length, succ, fail, pend, latest, status,
    };
  });
}

// ── Stats ────────────────────────────────────────────────────
function renderStats() {
  const total = rows.length;
  const untested = rows.filter(r => r.count === 0).length;
  const tested   = total - untested;
  const succ     = rows.filter(r => r.status === 'successed').length;
  const fail     = rows.filter(r => r.status === 'failed').length;
  const pend     = rows.filter(r => r.status === 'pending').length;
  const recorded = results.length;
  const cov      = total ? Math.round((tested / total) * 100) : 0;

  document.getElementById('stats').innerHTML = `
    <div class="ov-stat info">
      <div class="l">Planned</div>
      <div class="n">${total}</div>
      <div class="p">services in plan</div>
    </div>
    <div class="ov-stat">
      <div class="l">Coverage</div>
      <div class="n">${cov}%</div>
      <div class="p">${tested} tested · ${untested} untested</div>
    </div>
    <div class="ov-stat success">
      <div class="l">Successed</div>
      <div class="n">${succ}</div>
      <div class="p">latest = success</div>
    </div>
    <div class="ov-stat danger">
      <div class="l">Failed</div>
      <div class="n">${fail}</div>
      <div class="p">latest = failed</div>
    </div>
    <div class="ov-stat warning">
      <div class="l">Pending</div>
      <div class="n">${pend}</div>
      <div class="p">latest = pending</div>
    </div>
    <div class="ov-stat muted">
      <div class="l">Not tested</div>
      <div class="n">${untested}</div>
      <div class="p">no record yet</div>
    </div>
    <div class="ov-stat">
      <div class="l">Total records</div>
      <div class="n">${recorded}</div>
      <div class="p">across all items</div>
    </div>`;
}

// ── By-Service / By-Tool breakdown ───────────────────────────
function renderBreakdown() {
  document.getElementById('brk-service').innerHTML = renderGroup(r => r.cat.service || '—');
  document.getElementById('brk-tool')   .innerHTML = renderGroup(r => r.cat.tool    || '—');
  const uniqSvc = new Set(rows.map(r => r.cat.service || '—')).size;
  const uniqTool = new Set(rows.map(r => r.cat.tool || '—')).size;
  document.getElementById('brk-svc-count').textContent  = uniqSvc + ' service' + (uniqSvc === 1 ? '' : 's');
  document.getElementById('brk-tool-count').textContent = uniqTool + ' tool'   + (uniqTool === 1 ? '' : 's');
}
function renderGroup(keyFn) {
  const groups = {};
  for (const r of rows) {
    const k = keyFn(r);
    if (!groups[k]) groups[k] = { planned:0, tested:0, succ:0, fail:0, pend:0, untested:0 };
    const g = groups[k];
    g.planned++;
    if (r.count === 0) g.untested++;
    else g.tested++;
    if (r.status === 'successed') g.succ++;
    if (r.status === 'failed')    g.fail++;
    if (r.status === 'pending')   g.pend++;
  }
  const keys = Object.keys(groups).sort();
  if (!keys.length) return `<div class="ov-empty" style="border:none">No data</div>`;
  const body = keys.map(k => {
    const g = groups[k];
    const pct = g.planned ? Math.round((g.tested / g.planned) * 100) : 0;
    const bar = g.planned ? `
      <div class="ov-bar">
        ${g.succ ? `<div class="s" style="flex:${g.succ}"></div>` : ''}
        ${g.fail ? `<div class="f" style="flex:${g.fail}"></div>` : ''}
        ${g.pend ? `<div class="p" style="flex:${g.pend}"></div>` : ''}
      </div>` : '';
    return `
      <tr>
        <td><b style="color:var(--text)">${esc(k)}</b>${bar}</td>
        <td class="num">${g.planned}</td>
        <td class="num" style="color:var(--success)">${g.succ}</td>
        <td class="num" style="color:var(--danger)">${g.fail}</td>
        <td class="num" style="color:var(--warning)">${g.pend}</td>
        <td class="num" style="color:var(--text-muted)">${g.untested}</td>
        <td class="pct">${pct}%</td>
      </tr>`;
  }).join('');
  return `
    <div style="overflow-x:auto">
      <table class="ov-brk-table">
        <thead>
          <tr>
            <th style="min-width:140px">Name</th>
            <th style="text-align:right">Plan</th>
            <th style="text-align:right"><i data-icon="check"></i> Succ</th>
            <th style="text-align:right"><i data-icon="x"></i> Fail</th>
            <th style="text-align:right">⧗ Pend</th>
            <th style="text-align:right">— Untested</th>
            <th style="text-align:right">Coverage</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

// ── Detailed table ───────────────────────────────────────────
function statusBadge(status) {
  switch (status) {
    case 'successed': return '<span class="badge badge-green">Successed</span>';
    case 'failed':    return '<span class="badge badge-red">Failed</span>';
    case 'pending':   return '<span class="badge badge-yellow">Pending</span>';
    default:          return '<span class="badge badge-gray">Not tested</span>';
  }
}
function filteredRows() {
  const q  = document.getElementById('q').value.trim().toLowerCase();
  const fs = document.getElementById('f-service').value;
  const ft = document.getElementById('f-tool').value;
  const fp = document.getElementById('f-priority').value;
  const fst = document.getElementById('f-status').value;
  return rows.filter(r => {
    const c = r.cat || {};
    if (fs  && c.service  !== fs) return false;
    if (ft  && c.tool     !== ft) return false;
    if (fp  && c.priority !== fp) return false;
    if (fst && r.status   !== fst) return false;
    if (q) {
      const hay = ((c.name || '') + ' ' + (c.remark || '') + ' ' + (c.service || '')).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
function render() {
  const list = filteredRows();
  document.getElementById('row-count').textContent = list.length + ' shown';
  document.getElementById('detail-count').textContent = rows.length + ' planned';
  const wrap = document.getElementById('table-wrap');
  if (!list.length) {
    wrap.innerHTML = `
      <div class="ov-empty">
        <h4>ไม่มีข้อมูลตรงกับ filter</h4>
        <p>ลอง clear filter หรือเปลี่ยนเดือน · ยัง add plan ของเดือนนี้หรือยัง?</p>
      </div>`;
    return;
  }
  const body = list.map(r => {
    const c = r.cat || {};
    const l = r.latest;
    const rc = r.count
      ? `<span class="ov-rcount has">${r.count}</span>`
      : `<span class="ov-rcount">0</span>`;
    const bar = r.count ? `
      <div class="ov-bar" title="Success ${r.succ} · Fail ${r.fail} · Pending ${r.pend}">
        ${r.succ ? `<div class="s" style="flex:${r.succ}"></div>` : ''}
        ${r.fail ? `<div class="f" style="flex:${r.fail}"></div>` : ''}
        ${r.pend ? `<div class="p" style="flex:${r.pend}"></div>` : ''}
      </div>` : '';
    const latestCell = l ? `
      <div class="ov-tester">${
        (l.contributors?.length ? l.contributors : [{name: l.tested_by_name || l.tested_by}])
          .map(c => esc(c.name || c.id || 'unknown')).join(', ')
      }</div>
      <div class="ov-meta">
        ${esc(l.type || '—')}${l.test_date ? ' · ' + esc(l.test_date) : ''}
        ${l.refer_ticket ? ' · ' + esc(l.refer_ticket) : ''}
      </div>` : `<div class="ov-meta">—</div>`;

    return `
      <tr class="ov-row-click" data-cid="${esc(r.catalog_id)}">
        <td>
          <div class="ov-name">${esc(c.name || '(missing catalog)')}</div>
          ${c.remark ? `<div class="ov-sub">${esc(c.remark)}</div>` : ''}
        </td>
        <td>${MaTest.serviceBadge(c.service)}</td>
        <td>${MaTest.priorityBadge(c.priority)}</td>
        <td>${MaTest.toolBadge(c.tool)}</td>
        <td>${statusBadge(r.status)}${bar}</td>
        <td style="text-align:center">${rc}</td>
        <td>${latestCell}</td>
      </tr>`;
  }).join('');
  wrap.innerHTML = `
    <div style="overflow-x:auto">
      <table class="ov-table">
        <thead>
          <tr>
            <th style="min-width:260px">Service (Catalog)</th>
            <th>Service</th>
            <th>Priority</th>
            <th>Tool</th>
            <th style="min-width:150px">Status</th>
            <th style="text-align:center"># Records</th>
            <th style="min-width:200px">Latest test</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;

  wrap.querySelectorAll('.ov-row-click').forEach(tr => {
    tr.onclick = () => openDetail(tr.dataset.cid);
  });
}

// ── Detail popup ─────────────────────────────────────────────
function resultsForCatalog(catId) {
  return results
    .filter(r => String(r.catalog_id) === String(catId))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}
function openDetail(catId) {
  const row = rows.find(r => String(r.catalog_id) === String(catId));
  if (!row) return;
  const c = row.cat || {};
  const rs = resultsForCatalog(catId);
  const month = document.getElementById('month').value;

  document.getElementById('detail-modal-title').textContent = c.name || 'Test detail';
  const link = document.getElementById('detail-record-link');
  link.href = `../ma-test.html?month=${encodeURIComponent(month)}`;

  const linksHtml = [
    c.graph_url   ? `<a href="${esc(c.graph_url)}"   target="_blank" rel="noopener" class="badge badge-blue">Graph ↗</a>` : '',
    c.link_manual ? `<a href="${esc(c.link_manual)}" target="_blank" rel="noopener" class="badge badge-gray">Manual ↗</a>` : '',
  ].filter(Boolean).join('');

  const header = `
    <div class="ov-dtl-head">
      <div class="n">${esc(c.name || '(missing)')}</div>
      <div class="badges">
        ${MaTest.serviceBadge(c.service)}
        ${MaTest.priorityBadge(c.priority)}
        ${MaTest.toolBadge(c.tool)}
        ${statusBadge(row.status)}
      </div>
      ${c.remark ? `<div class="r">${esc(c.remark)}</div>` : ''}
      ${linksHtml ? `<div class="links">${linksHtml}</div>` : ''}
    </div>`;

  const mini = `
    <div class="ov-dtl-mini">
      <div class="m"><div class="l">Records</div><div class="n">${row.count}</div></div>
      <div class="m success"><div class="l"><i data-icon="check"></i> Success</div><div class="n">${row.succ}</div></div>
      <div class="m danger"><div class="l"><i data-icon="x"></i> Failed</div><div class="n">${row.fail}</div></div>
      <div class="m warning"><div class="l">⧗ Pending</div><div class="n">${row.pend}</div></div>
    </div>`;

  const listTitle = `<div class="ov-dtl-list-title">All results (newest first)</div>`;

  const listHtml = rs.length ? rs.map(r => {
    const shots = (r.screenshots || []).map(url => `
      <div class="ov-thumb" data-lb="${esc(url)}"><img src="${esc(url)}" alt=""></div>
    `).join('');
    const jenkinsRows = ((r.jenkins_build_up_url || r.jenkins_build_down_url) ? `
      ${r.jenkins_build_up_url ? `
        <div><div class="k">Jenkins Build — MA Up</div>
          <div class="v"><a href="${esc(r.jenkins_build_up_url)}" target="_blank" rel="noopener">${esc(r.jenkins_build_up_url)}</a></div></div>` : ''}
      ${r.jenkins_build_down_url ? `
        <div><div class="k">Jenkins Build — MA Down</div>
          <div class="v"><a href="${esc(r.jenkins_build_down_url)}" target="_blank" rel="noopener">${esc(r.jenkins_build_down_url)}</a></div></div>` : ''}
    ` : '');
    const timeRange = (r.start_time || r.end_time)
      ? esc(r.start_time || '') + '–' + esc(r.end_time || '')
      : '—';
    return `
      <div class="ov-res">
        <div class="ov-res-head">
          <div>
            <div class="who">${
              (r.contributors?.length ? r.contributors : [{name: r.tested_by_name || r.tested_by}])
                .map(c => esc(c.name || c.id || 'unknown')).join(', ')
            }</div>
            <div class="meta">${esc(r.created_at || '')}${r.updated_at && r.updated_at !== r.created_at ? ' · updated ' + esc(r.updated_at) : ''}</div>
          </div>
          <div>${MaTest.resultBadge(r.result)}</div>
        </div>
        <div class="ov-res-grid">
          <div><div class="k">Type</div><div class="v">${esc(r.type || '—')}</div></div>
          <div><div class="k">Test Date</div><div class="v">${esc(r.test_date || '—')}</div></div>
          <div><div class="k">Time</div><div class="v">${timeRange}</div></div>
          <div><div class="k">Before Test</div><div class="v">${esc(r.before_test || '—')}</div></div>
          <div><div class="k">During Test</div><div class="v">${esc(r.during_test || '—')}</div></div>
          <div><div class="k">Refer Ticket</div><div class="v">${r.refer_ticket ? esc(r.refer_ticket) : '—'}</div></div>
          ${jenkinsRows}
        </div>
        ${shots ? `<div class="ov-thumbs">${shots}</div>` : ''}
      </div>`;
  }).join('') : `<div class="ov-res-empty">ยังไม่มีการบันทึกผลเทสสำหรับ service นี้ในเดือน ${esc(month)}</div>`;

  document.getElementById('detail-modal-body').innerHTML = header + mini + listTitle + listHtml;

  // Wire lightbox on thumbnails
  document.querySelectorAll('#detail-modal-body [data-lb]').forEach(el => {
    el.onclick = () => openLightbox(el.dataset.lb);
  });

  document.getElementById('modal-detail').classList.add('active');
}

function openLightbox(url) {
  document.getElementById('lb-img').src = url;
  document.getElementById('modal-lightbox').classList.add('active');
}

function closeAll() {
  document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
}
document.addEventListener('click', e => {
  if (e.target.matches('[data-close]') || e.target.classList.contains('modal-overlay')) closeAll();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAll(); });

// ── CSV export ───────────────────────────────────────────────
function exportCsv() {
  const list = filteredRows();
  const month = document.getElementById('month').value;
  const header = ['Name','Service','Priority','Tool','Status','Records','Success','Failed','Pending','Latest_By','Latest_Date','Latest_Type','Latest_Ticket','Remark'];
  const q = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rowsCsv = list.map(r => {
    const c = r.cat || {}; const l = r.latest || {};
    return [
      c.name || '', c.service || '', c.priority || '', c.tool || '',
      r.status, r.count, r.succ, r.fail, r.pend,
      (l.contributors?.length ? l.contributors : [{name: l.tested_by_name || l.tested_by}]).map(c => c.name || c.id || '').filter(Boolean).join('; '),
      l.test_date || '', l.type || '', l.refer_ticket || '',
      c.remark || '',
    ].map(q).join(',');
  });
  const csv = [header.join(','), ...rowsCsv].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ma-test-overview-${month}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ── Monthly Report ───────────────────────────────────────────
function renderReportBreakdown(keyFn, label) {
  const groups = {};
  for (const r of rows) {
    const k = keyFn(r) || '—';
    if (!groups[k]) groups[k] = { planned:0, succ:0, fail:0, pend:0, untested:0 };
    const g = groups[k];
    g.planned++;
    if (r.count === 0)            g.untested++;
    if (r.status === 'successed') g.succ++;
    if (r.status === 'failed')    g.fail++;
    if (r.status === 'pending')   g.pend++;
  }
  const keys = Object.keys(groups).sort();
  if (!keys.length) return '';
  const body = keys.map(k => {
    const g = groups[k];
    const cov = g.planned ? Math.round(((g.planned - g.untested) / g.planned) * 100) : 0;
    return `
      <tr>
        <td><b style="color:var(--text)">${esc(k)}</b></td>
        <td class="num">${g.planned}</td>
        <td class="num" style="color:var(--success)">${g.succ}</td>
        <td class="num" style="color:var(--danger)">${g.fail}</td>
        <td class="num" style="color:var(--warning)">${g.pend}</td>
        <td class="num" style="color:var(--text-muted)">${g.untested}</td>
        <td class="num">${cov}%</td>
      </tr>`;
  }).join('');
  return `
    <table class="rp-brk-table">
      <thead>
        <tr>
          <th>${esc(label)}</th>
          <th style="text-align:right">Plan</th>
          <th style="text-align:right">✓ Succ</th>
          <th style="text-align:right">✗ Fail</th>
          <th style="text-align:right">⧗ Pend</th>
          <th style="text-align:right">Untested</th>
          <th style="text-align:right">Coverage</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>`;
}

function renderReportItem(row, includeShots) {
  const c = row.cat || {};
  const rs = resultsForCatalog(row.catalog_id);

  const linksHtml = [
    c.graph_url   ? `<a href="${esc(c.graph_url)}"   target="_blank" rel="noopener">Graph ↗</a>` : '',
    c.link_manual ? `<a href="${esc(c.link_manual)}" target="_blank" rel="noopener">Manual ↗</a>` : '',
  ].filter(Boolean).join(' · ');

  const resultsHtml = rs.length ? rs.map(r => {
    const time = (r.start_time || r.end_time)
      ? `${esc(r.start_time || '')}–${esc(r.end_time || '')}` : '';
    const cls = r.result === 'Successed' ? 'ok'
              : r.result === 'Failed'    ? 'bad'
              : r.result === 'Pending'   ? 'pend' : '';
    const shots = includeShots && (r.screenshots || []).length
      ? `<div class="rp-shots">${r.screenshots.map(u =>
          `<img src="${esc(u)}" alt="screenshot" loading="lazy">`).join('')}</div>`
      : '';
    return `
      <div class="rp-result ${cls}">
        <div class="rp-result-head">
          <div>
            <div class="who">${
              (r.contributors?.length ? r.contributors : [{name: r.tested_by_name || r.tested_by}])
                .map(c => esc(c.name || c.id || 'unknown')).join(', ')
            }</div>
            <div class="meta">${esc(r.test_date || (r.created_at || '').slice(0,10) || '—')}${time ? ' · ' + time : ''} · ${esc(r.type || '—')}</div>
          </div>
          <div>${MaTest.resultBadge(r.result)}</div>
        </div>
        ${r.before_test    ? `<div class="rp-field"><span class="k">Before:</span>${esc(r.before_test)}</div>` : ''}
        ${r.during_test    ? `<div class="rp-field"><span class="k">During:</span>${esc(r.during_test)}</div>` : ''}
        ${r.refer_ticket   ? `<div class="rp-field"><span class="k">Ticket:</span>${esc(r.refer_ticket)}</div>` : ''}
        ${r.jenkins_build_up_url   ? `<div class="rp-field"><span class="k">Jenkins Up:</span><a href="${esc(r.jenkins_build_up_url)}"   target="_blank" rel="noopener">${esc(r.jenkins_build_up_url)}</a></div>` : ''}
        ${r.jenkins_build_down_url ? `<div class="rp-field"><span class="k">Jenkins Down:</span><a href="${esc(r.jenkins_build_down_url)}" target="_blank" rel="noopener">${esc(r.jenkins_build_down_url)}</a></div>` : ''}
        ${shots}
      </div>`;
  }).join('') : `<div class="rp-empty">ยังไม่มีการบันทึกผลเทสสำหรับ item นี้</div>`;

  return `
    <div class="rp-item">
      <div class="rp-item-head">
        <div>
          <div class="rp-item-name">${esc(c.name || '(missing)')}</div>
          ${c.remark ? `<div class="rp-item-sub">${esc(c.remark)}</div>` : ''}
        </div>
        <div class="rp-item-badges">
          ${MaTest.priorityBadge(c.priority)}
          ${MaTest.toolBadge(c.tool)}
          ${statusBadge(row.status)}
        </div>
      </div>
      ${linksHtml ? `<div class="rp-item-links">${linksHtml}</div>` : ''}
      ${resultsHtml}
    </div>`;
}

function buildReport() {
  const month = document.getElementById('month').value;
  const includeShots     = document.getElementById('rp-inc-shots').checked;
  const includeUntested  = document.getElementById('rp-inc-untested').checked;
  const includeBreakdown = document.getElementById('rp-inc-breakdown').checked;
  const user = Auth.getUser();

  document.getElementById('rp-month-title').textContent = month;

  // KPIs from full plan
  const total    = rows.length;
  const untested = rows.filter(r => r.count === 0).length;
  const succ     = rows.filter(r => r.status === 'successed').length;
  const fail     = rows.filter(r => r.status === 'failed').length;
  const pend     = rows.filter(r => r.status === 'pending').length;
  const cov      = total ? Math.round(((total - untested) / total) * 100) : 0;

  const kpi = `
    <section class="rp-kpi">
      <div class="rp-k"><div class="l">Planned</div><div class="v">${total}</div></div>
      <div class="rp-k"><div class="l">Coverage</div><div class="v">${cov}%</div></div>
      <div class="rp-k success"><div class="l">Successed</div><div class="v">${succ}</div></div>
      <div class="rp-k danger"><div class="l">Failed</div><div class="v">${fail}</div></div>
      <div class="rp-k warning"><div class="l">Pending</div><div class="v">${pend}</div></div>
      <div class="rp-k muted"><div class="l">Not tested</div><div class="v">${untested}</div></div>
    </section>`;

  const breakdownHtml = includeBreakdown ? `
    <div class="rp-h2">📊 Breakdown by Service</div>
    ${renderReportBreakdown(r => r.cat.service, 'Service')}
    <div class="rp-h2">🛠 Breakdown by Tool</div>
    ${renderReportBreakdown(r => r.cat.tool, 'Tool')}
  ` : '';

  // Group items by service for detail sections
  const bySvc = {};
  for (const r of rows) {
    if (!includeUntested && r.count === 0) continue;
    const svc = r.cat.service || '—';
    if (!bySvc[svc]) bySvc[svc] = [];
    bySvc[svc].push(r);
  }
  const services = Object.keys(bySvc).sort();

  const detailHtml = services.length ? services.map(svc => {
    const items = bySvc[svc].sort((a, b) => (a.cat.name || '').localeCompare(b.cat.name || ''));
    return `
      <section class="rp-section">
        <div class="rp-section-head">
          <div class="rp-section-title">${MaTest.serviceBadge(svc)}</div>
          <div class="rp-section-count">${items.length} item${items.length === 1 ? '' : 's'}</div>
        </div>
        ${items.map(r => renderReportItem(r, includeShots)).join('')}
      </section>`;
  }).join('') : `
    <div class="rp-empty" style="text-align:center;padding:32px">
      ไม่มี item ที่มีการเทสในเดือนนี้ · เปิด "Include untested" เพื่อดูรายการทั้งหมด
    </div>`;

  const now = new Date();
  const genAt = now.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const teamLabel = (user?.team || '').toUpperCase() || 'SM';

  document.getElementById('rp-body').innerHTML = `
    <div class="rp-header">
      <div class="rp-logo">🧪</div>
      <div style="flex:1">
        <div class="rp-title">MA Test — Monthly Report</div>
        <div class="rp-sub">
          Month <b style="color:var(--text)">${esc(month)}</b>
          · Team <b style="color:var(--text)">${esc(teamLabel)}</b>
          · Generated by <b style="color:var(--text)">${esc(user?.name || user?.username || '—')}</b>
          · ${esc(genAt)}
        </div>
      </div>
    </div>
    <div class="rp-h2">📈 Summary</div>
    ${kpi}
    ${breakdownHtml}
    <div class="rp-h2">🗂 Test Results Detail</div>
    ${detailHtml}
  `;
}

function openReport() {
  if (!rows.length) {
    Toast?.info?.('ยังไม่มีข้อมูลของเดือนนี้ — เพิ่ม plan/บันทึกผลก่อน');
    return;
  }
  buildReport();
  document.getElementById('modal-report').classList.add('active');
}

// ── Wire ─────────────────────────────────────────────────────
document.getElementById('month').onchange  = load;
document.getElementById('btn-export').onclick = exportCsv;
document.getElementById('btn-report').onclick = openReport;
document.getElementById('btn-print').onclick  = () => window.print();
['rp-inc-shots', 'rp-inc-untested', 'rp-inc-breakdown'].forEach(id =>
  document.getElementById(id).addEventListener('change', buildReport)
);
let _sT;
document.getElementById('q').addEventListener('input', () => { clearTimeout(_sT); _sT = setTimeout(render, 200); });
['f-service','f-tool','f-priority','f-status'].forEach(id => document.getElementById(id).onchange = render);

load();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "buildReport", { configurable: true, get: () => buildReport, set: (v) => { buildReport = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openReport", { configurable: true, get: () => openReport, set: (v) => { openReport = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderReportBreakdown", { configurable: true, get: () => renderReportBreakdown, set: (v) => { renderReportBreakdown = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderReportItem", { configurable: true, get: () => renderReportItem, set: (v) => { renderReportItem = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "buildRows", { configurable: true, get: () => buildRows, set: (v) => { buildRows = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeAll", { configurable: true, get: () => closeAll, set: (v) => { closeAll = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "exportCsv", { configurable: true, get: () => exportCsv, set: (v) => { exportCsv = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "filteredRows", { configurable: true, get: () => filteredRows, set: (v) => { filteredRows = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "load", { configurable: true, get: () => load, set: (v) => { load = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openDetail", { configurable: true, get: () => openDetail, set: (v) => { openDetail = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openLightbox", { configurable: true, get: () => openLightbox, set: (v) => { openLightbox = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "render", { configurable: true, get: () => render, set: (v) => { render = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderBreakdown", { configurable: true, get: () => renderBreakdown, set: (v) => { renderBreakdown = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderGroup", { configurable: true, get: () => renderGroup, set: (v) => { renderGroup = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderStats", { configurable: true, get: () => renderStats, set: (v) => { renderStats = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "resultsForCatalog", { configurable: true, get: () => resultsForCatalog, set: (v) => { resultsForCatalog = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "statusBadge", { configurable: true, get: () => statusBadge, set: (v) => { statusBadge = v; } }); } catch (e) {}
})();
