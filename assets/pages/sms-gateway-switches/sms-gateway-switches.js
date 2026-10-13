// sms-gateway-switches — page script, extracted from sms-gateway-switches.html.
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
  Layout.render('sms-gateway-switches');

  /* ══════════════════════════════════════════
     Switch Log
  ══════════════════════════════════════════ */
  let currentProject = 'tmn';
  let editingId = null;

  const GATEWAY_STYLE = {
    'Firt-hop':   'gw-fh',
    'Infobip HK': 'gw-ifb-hk',
    'Infobip SG': 'gw-ifb-sg',
  };

  // Per-project cached records (also drives the stats cards)
  const projectCache = { tmn: null, nano: null, welth: null };

  function gwBadge(name) {
    const cls = GATEWAY_STYLE[name] || 'gw-unknown';
    return `<span class="gw-badge ${cls}">${escHtml(name || '—')}</span>`;
  }

  const PROJ_LABEL = { tmn: 'TMN', nano: 'Nano', welth: 'Welth' };

  function updateCardHeader(proj, count) {
    const title = document.getElementById('card-title');
    const badge = document.getElementById('card-count');
    const sub   = document.getElementById('card-sub');
    if (title) title.textContent = `${PROJ_LABEL[proj]} · Switch Log`;
    if (badge) badge.textContent = count != null ? `${count} builds` : '—';
    if (sub) {
      if (count === 0) sub.textContent = 'ยังไม่มี build ให้บันทึก';
      else if (count > 0) sub.textContent = 'บันทึกล่าสุดจาก Jenkins';
      else sub.textContent = 'บันทึกล่าสุดจาก Jenkins';
    }
  }

  function fmtRelative(iso) {
    if (!iso) return '';
    const then = new Date(iso).getTime();
    const diff = Date.now() - then;
    if (isNaN(diff)) return '';
    const mins = Math.floor(diff / 60000);
    if (mins < 1)   return 'เมื่อสักครู่';
    if (mins < 60)  return `${mins} นาทีก่อน`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)   return `${hrs} ชม.ก่อน`;
    const days = Math.floor(hrs / 24);
    if (days < 30)  return `${days} วันก่อน`;
    const mons = Math.floor(days / 30);
    return `${mons} เดือนก่อน`;
  }

  function renderStatCard(proj) {
    const records = projectCache[proj];
    const valEl = document.getElementById(`stat-val-${proj}`);
    const subEl = document.getElementById(`stat-sub-${proj}`);
    if (!valEl || !subEl) return;
    if (records === null) {
      valEl.textContent = '—';
      subEl.innerHTML = '<span class="sk-cell"></span>';
      return;
    }
    valEl.textContent = records.length.toLocaleString();
    if (!records.length) {
      subEl.textContent = 'ยังไม่มีข้อมูล';
      return;
    }
    // Most recent switch
    const latest = records[0]; // records are pre-sorted desc by switch_start
    subEl.innerHTML = `Latest: <strong style="color:var(--text)">${escHtml(latest.to_gateway || '—')}</strong> · ${escHtml(fmtRelative(latest.switch_start))}`;
  }

  function setActiveTab(proj) {
    ['tmn', 'nano', 'welth'].forEach(p => {
      document.getElementById(`tab-${p}`)?.classList.toggle('active', p === proj);
      document.getElementById(`stat-${p}`)?.classList.toggle('active', p === proj);
    });
  }

  function formatDt(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
    const pad = n => String(n).padStart(2, '0');
    return `${d.getDate()}/${mon}/${d.getFullYear()} ${d.getHours()}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function switchProject(proj) {
    currentProject = proj;
    setActiveTab(proj);
    loadTable();
  }

  function showSkeleton() {
    const tbody = document.getElementById('table-body');
    const row = () => `<tr class="sk-row">
      <td><div class="sk-cell" style="width:28px;height:13px"></div></td>
      <td><div class="sk-cell" style="width:138px;height:13px"></div></td>
      <td><div class="sk-cell" style="width:138px;height:13px"></div></td>
      <td><div class="sk-cell" style="width:96px;height:22px;border-radius:5px"></div></td>
      <td><div class="sk-cell" style="width:96px;height:22px;border-radius:5px"></div></td>
      <td><div class="sk-cell" style="width:180px;height:13px"></div></td>
    </tr>`;
    tbody.innerHTML = Array.from({ length: 6 }, row).join('');
  }

  async function loadTable() {
    const tbody = document.getElementById('table-body');
    showSkeleton();
    updateCardHeader(currentProject, null);
    const res = await API.smsGateway.list(currentProject);
    if (!res?.ok) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-table">
        <div class="empty-icon"><i data-icon="alert-triangle"></i></div>
        <p class="empty-title">โหลดข้อมูลไม่สำเร็จ</p>
        <p>${escHtml(res?.data?.message || 'ลองกด Refresh อีกครั้ง')}</p>
      </td></tr>`;
      updateCardHeader(currentProject, 0);
      return;
    }
    const records = res.data.data || [];
    projectCache[currentProject] = records;
    renderStatCard(currentProject);
    updateCardHeader(currentProject, records.length);
    if (!records.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-table">
        <div class="empty-icon">◫</div>
        <p class="empty-title">ยังไม่มีข้อมูล</p>
        <p>รอ Jenkins build ครั้งถัดไป หรือกด <strong>⇄ Sync Jenkins</strong></p>
      </td></tr>`;
      return;
    }
    tbody.innerHTML = records.map(r => rowHtml(r)).join('');
  }

  // Populate all 3 stat cards in one go (fires after auto-sync completes
  // and on cold init so cards aren't stuck on skeleton for inactive tabs)
  async function refreshAllStats() {
    const projs = ['tmn', 'nano', 'welth'];
    const results = await Promise.allSettled(projs.map(p => API.smsGateway.list(p)));
    projs.forEach((p, i) => {
      const r = results[i];
      if (r.status === 'fulfilled' && r.value?.ok) {
        projectCache[p] = r.value.data?.data || [];
      } else {
        projectCache[p] = [];
      }
      renderStatCard(p);
    });
  }

  function rowHtml(r) {
    const remarkHtml = r.remark
      ? `<span class="remark-text" onclick="startEdit('${escHtml(r.id)}')">${escHtml(r.remark)}</span>`
      : `<span class="remark-text empty" onclick="startEdit('${escHtml(r.id)}')">— คลิกเพื่อเพิ่ม remark</span>`;
    return `<tr id="row-${escHtml(r.id)}">
      <td class="col-build">#${r.build_number}</td>
      <td class="col-time">${formatDt(r.switch_start)}</td>
      <td class="col-time">${formatDt(r.switch_end)}</td>
      <td class="col-gateway">${gwBadge(r.from_gateway)}</td>
      <td class="col-gateway">${gwBadge(r.to_gateway)}</td>
      <td class="col-remark">
        <div class="remark-cell" id="remark-cell-${escHtml(r.id)}">${remarkHtml}</div>
        ${r.triggered_by ? `<div class="triggered-by">by ${escHtml(r.triggered_by)}</div>` : ''}
      </td>
    </tr>`;
  }

  function startEdit(id) {
    if (editingId && editingId !== id) cancelEdit(editingId);
    editingId = id;
    const cell = document.getElementById(`remark-cell-${id}`);
    const currentText = cell.querySelector('.remark-text')?.textContent?.replace('— คลิกเพื่อเพิ่ม remark', '') || '';
    cell.innerHTML = `
      <input class="remark-input" id="remark-input-${id}" value="${escHtml(currentText)}" placeholder="ใส่เลข ticket หรือ remark..." maxlength="200">
      <button class="remark-save"   onclick="saveRemark('${id}')">บันทึก</button>
      <button class="remark-cancel" onclick="cancelEdit('${id}')">ยกเลิก</button>
    `;
    const input = document.getElementById(`remark-input-${id}`);
    input.focus();
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter')  saveRemark(id);
      if (e.key === 'Escape') cancelEdit(id);
    });
  }

  async function saveRemark(id) {
    const input = document.getElementById(`remark-input-${id}`);
    if (!input) return;
    const remark = input.value.trim();
    const res = await API.smsGateway.updateRemark(id, currentProject, remark);
    if (!res?.ok) { Toast.show(res?.data?.message || 'บันทึกไม่สำเร็จ', 'error'); return; }
    editingId = null;
    Toast.show('บันทึก remark แล้ว', 'success');
    loadTable();
  }

  function cancelEdit(id) { editingId = null; loadTable(); }

  async function syncBuilds(silent = false) {
    const btn   = document.getElementById('sync-btn');
    const label = document.getElementById('sync-label');
    const spin  = document.getElementById('sync-spin');
    if (!silent) { btn.disabled = true; label.textContent = 'Syncing...'; spin.classList.remove('hidden'); }
    const res = await API.smsGateway.sync(currentProject);
    if (!silent) { btn.disabled = false; label.textContent = '⇄ Sync Jenkins'; spin.classList.add('hidden'); }
    if (!res?.ok) {
      if (!silent) Toast.show(res?.data?.message || 'Sync ไม่สำเร็จ', 'error');
      loadTable();
      return;
    }
    const added = res.data.data?.added ?? 0;
    if (!silent) Toast.show(res.data.message, added > 0 ? 'success' : 'info');
    loadTable();
  }

  function exportCsv() {
    const tbody = document.getElementById('table-body');
    const rows  = tbody.querySelectorAll('tr[id^="row-"]');
    if (!rows.length) { Toast.show('ไม่มีข้อมูลให้ export', 'info'); return; }
    const csvEscape = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const lines = [['Switch Start Date/Time','Switch End Date/Time','Form Gateway','To Gateway','Remark'].map(csvEscape).join(',')];
    rows.forEach(row => {
      const tds = row.querySelectorAll('td');
      lines.push([
        tds[1]?.textContent?.trim() ?? '',
        tds[2]?.textContent?.trim() ?? '',
        tds[3]?.querySelector('.gw-badge')?.textContent?.trim() ?? '',
        tds[4]?.querySelector('.gw-badge')?.textContent?.trim() ?? '',
        tds[5]?.querySelector('.remark-text')?.textContent?.trim().replace('— คลิกเพื่อเพิ่ม remark','') ?? '',
      ].map(csvEscape).join(','));
    });
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type:'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href:url, download:`sms_gateway_${currentProject}_${new Date().toISOString().slice(0,10)}.csv` });
    a.click(); URL.revokeObjectURL(url);
    Toast.show('Export สำเร็จ', 'success');
  }

  /* ══════════════════════════════════════════
     Firt-hop Drawer
  ══════════════════════════════════════════ */
  const MON_NAME = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  let fhProject  = 'tmn';
  let fhMonth    = '';
  let fhCache    = { tmn: null, nano: null, welth: null };
  let fhLoaded   = false;

  function openFhDrawer() {
    document.getElementById('fh-drawer')?.classList.add('open');
    document.getElementById('fh-backdrop')?.classList.add('open');
    document.body.style.overflow = 'hidden';
    if (!fhLoaded) loadFhReport();
  }

  function closeFhDrawer() {
    document.getElementById('fh-drawer')?.classList.remove('open');
    document.getElementById('fh-backdrop')?.classList.remove('open');
    document.body.style.overflow = '';
  }

  // Close on Escape key
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (document.getElementById('email-modal')?.classList.contains('active')) closeEmailModal();
      else closeFhDrawer();
    }
  });

  async function loadFhReport() {
    fhLoaded = true;
    const [resTmn, resNano, resWelth] = await Promise.all([
      API.smsGateway.list('tmn'),
      API.smsGateway.list('nano'),
      API.smsGateway.list('welth'),
    ]);
    fhCache.tmn   = resTmn?.ok   ? (resTmn.data.data   || []) : [];
    fhCache.nano  = resNano?.ok  ? (resNano.data.data  || []) : [];
    fhCache.welth = resWelth?.ok ? (resWelth.data.data || []) : [];
    populateFhMonths();
    renderFhReport();
  }

  function populateFhMonths() {
    // Collect months only from actual Firt-hop session starts (switch_end of "to Firt-hop"
    // records). Using all switch_start times causes months with no Firt-hop sessions to
    // appear in the dropdown, which makes the auto-selected month show empty tables for
    // projects whose last Firt-hop session was in an earlier month.
    const fhSessionMonths = (records) => records
      .filter(r => r.to_gateway === 'Firt-hop' && r.switch_end)
      .map(r => r.switch_end.slice(0, 7));

    const all = [
      ...fhSessionMonths(fhCache.tmn   || []),
      ...fhSessionMonths(fhCache.nano  || []),
      ...fhSessionMonths(fhCache.welth || []),
    ];
    const months = [...new Set(all)].sort().reverse();
    const sel = document.getElementById('fh-month');
    sel.innerHTML = '<option value="">ทุกเดือน</option>';
    months.forEach(m => {
      const [y, mo] = m.split('-');
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = `${MON_NAME[+mo - 1]} ${y}`;
      sel.appendChild(opt);
    });
    // Default to "ทุกเดือน" so all projects show sessions immediately on open.
    // (Different projects may have Firt-hop sessions in different months, so
    // auto-selecting the latest month would hide TMN/Welth sessions if Nano
    // had a more recent one.)
    fhMonth = '';
    sel.value = '';
  }

  function buildSessions(records, projectLabel) {
    const sorted = [...records].sort((a, b) => new Date(a.switch_start) - new Date(b.switch_start));
    const sessions = [];
    let open = null;
    for (const r of sorted) {
      if (r.to_gateway === 'Firt-hop') {
        if (open) sessions.push({ ...open, ongoing: true });
        open = {
          project: projectLabel, buildIn: r.build_number, buildOut: null,
          startTime: new Date(r.switch_end), endTime: null, duration: null,
          triggeredIn: r.triggered_by, triggeredOut: null, ongoing: false,
        };
      } else if (r.from_gateway === 'Firt-hop' && open) {
        open.buildOut     = r.build_number;
        open.endTime      = new Date(r.switch_start);
        open.duration     = open.endTime - open.startTime;
        open.triggeredOut = r.triggered_by;
        sessions.push({ ...open, ongoing: false });
        open = null;
      }
    }
    if (open) sessions.push({ ...open, ongoing: true });
    return sessions;
  }

  function getFhSessions() {
    let sessions = [];
    if (fhProject === 'tmn'   || fhProject === 'all') sessions.push(...buildSessions(fhCache.tmn   || [], 'tmn'));
    if (fhProject === 'nano'  || fhProject === 'all') sessions.push(...buildSessions(fhCache.nano  || [], 'nano'));
    if (fhProject === 'welth' || fhProject === 'all') sessions.push(...buildSessions(fhCache.welth || [], 'welth'));
    sessions.sort((a, b) => b.startTime - a.startTime);
    if (fhMonth) {
      sessions = sessions.filter(s => {
        const ym = `${s.startTime.getFullYear()}-${String(s.startTime.getMonth()+1).padStart(2,'0')}`;
        return ym === fhMonth;
      });
    }
    return sessions;
  }

  function fmtDuration(ms) {
    if (ms == null || ms < 0) return null;
    const ts = Math.floor(ms / 1000);
    const h = Math.floor(ts / 3600), m = Math.floor((ts % 3600) / 60), s = ts % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  function fmtDt(date) {
    if (!date) return '—';
    const pad = n => String(n).padStart(2, '0');
    return `${date.getDate()}/${MON_NAME[date.getMonth()]}/${date.getFullYear()} ${date.getHours()}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  function monthLabel(ym) {
    if (!ym) return 'ทุกเดือน';
    const [y, m] = ym.split('-');
    return `${MON_NAME[+m - 1]} ${y}`;
  }

  function setFhProject(proj) {
    fhProject = proj;
    ['tmn', 'nano', 'welth', 'all'].forEach(p =>
      document.getElementById(`fh-tab-${p}`).classList.toggle('active', p === proj)
    );
    renderFhReport();
  }

  function setFhMonth(val) {
    fhMonth = val;
    renderFhReport();
  }

  function renderFhReport() {
    if (!fhCache.tmn && !fhCache.nano && !fhCache.welth) return;

    const sessions   = getFhSessions();
    const completed  = sessions.filter(s => !s.ongoing);
    const ongoingArr = sessions.filter(s =>  s.ongoing);
    const totalMs    = completed.reduce((sum, s) => sum + (s.duration || 0), 0);
    const avgMs      = completed.length ? Math.round(totalMs / completed.length) : 0;
    const showProj   = fhProject === 'all';

    /* Cards */
    document.getElementById('fh-cards').innerHTML = `
      <div class="fh-card accent">
        <div class="fh-card-label">Sessions</div>
        <div class="fh-card-value">${sessions.length}</div>
        <div class="fh-card-sub">${monthLabel(fhMonth)}</div>
      </div>
      <div class="fh-card">
        <div class="fh-card-label">Total Time</div>
        <div class="fh-card-value" style="font-size:${totalMs>0?'17px':'22px'}">${fmtDuration(totalMs) || '—'}</div>
        <div class="fh-card-sub">${completed.length} session วัดได้</div>
      </div>
      <div class="fh-card">
        <div class="fh-card-label">Avg / Session</div>
        <div class="fh-card-value" style="font-size:${avgMs>0?'17px':'22px'}">${fmtDuration(avgMs) || '—'}</div>
        <div class="fh-card-sub">เฉลี่ยต่อครั้ง</div>
      </div>
      ${ongoingArr.length ? `
      <div class="fh-card green-card">
        <div class="fh-card-label">On Firt-hop</div>
        <div class="fh-card-value">${ongoingArr.length}</div>
        <div class="fh-card-sub">ยังไม่ switch ออก</div>
      </div>` : ''}
    `;

    const projFooterLabel = { tmn: 'TMN', nano: 'Nano', welth: 'Welth', all: 'TMN + Nano + Welth' };
    /* Footer meta */
    document.getElementById('fh-footer-meta').textContent =
      `${sessions.length} session · ${projFooterLabel[fhProject] || fhProject.toUpperCase()} · ${monthLabel(fhMonth)}`;

    /* Table */
    const wrap = document.getElementById('fh-table-wrap');
    if (!sessions.length) {
      wrap.innerHTML = `<div class="fh-table-wrap"><div class="empty-table"><div class="empty-icon">◫</div><p>ไม่มี Firt-hop session ใน${fhMonth ? ` ${monthLabel(fhMonth)}` : 'ช่วงนี้'}</p></div></div>`;
      return;
    }

    const rows = sessions.map((s, i) => `
      <tr>
        <td style="color:var(--text-muted);font-size:11px;width:40px">#${sessions.length - i}</td>
        ${showProj ? `<td style="width:64px"><span class="fh-proj-tag ${s.project}">${s.project.toUpperCase()}</span></td>` : ''}
        <td style="white-space:nowrap;font-size:11px;color:var(--text-muted)">${fmtDt(s.startTime)}</td>
        <td style="white-space:nowrap;font-size:11px;color:var(--text-muted)">${s.endTime ? fmtDt(s.endTime) : '—'}</td>
        <td style="width:110px">${s.ongoing
          ? `<span class="fh-ongoing"><span class="fh-ongoing-dot"></span>On Firt-hop</span>`
          : `<span class="fh-dur">${fmtDuration(s.duration)}</span>`}</td>
        <td style="font-size:11px;color:var(--text-muted);max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(s.triggeredIn || '—')}</td>
        <td style="font-size:11px;color:var(--text-muted);max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${s.triggeredOut ? escHtml(s.triggeredOut) : '<span style="font-style:italic">—</span>'}</td>
      </tr>
    `).join('');

    wrap.innerHTML = `
      <div class="fh-table-wrap">
        <table class="fh-table">
          <thead><tr>
            <th>#</th>
            ${showProj ? '<th>Proj</th>' : ''}
            <th>เริ่ม</th><th>สิ้นสุด</th><th>Duration</th>
            <th>Switch In by</th><th>Switch Out by</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  /* ══════════════════════════════════════════
     Email Modal
  ══════════════════════════════════════════ */
  let emailToTags  = [];
  let emailCcTags  = [];
  let fhEmailCfg   = null;

  async function openEmailModal() {
    const sessions = getFhSessions();
    if (!sessions.length) { Toast.show('ไม่มีข้อมูลสำหรับส่ง report', 'info'); return; }

    if (!fhEmailCfg) {
      const cfgRes = await API.fhEmailConfig.get();
      fhEmailCfg = cfgRes?.ok ? (cfgRes.data.data || {}) : {};
    }

    const projLabelMap = { tmn: 'TMN', nano: 'Nano', welth: 'Welth', all: 'TMN + Nano + Welth' };
    const fallbackDear = { tmn: 'TMN-CBO', nano: 'Nano-CBO', welth: 'Welth-CBO', all: 'All' };
    const projLabel = projLabelMap[fhProject] || fhProject.toUpperCase();
    const monthStr  = monthLabel(fhMonth);

    const cfg = fhEmailCfg[fhProject] || {};
    const subjectTpl = cfg.subject || `Firt-hop Usage Report — {month} (${projLabel})`;

    document.getElementById('email-subject').value = subjectTpl.replace('{month}', monthStr);
    document.getElementById('email-dear').value    = cfg.dear || fallbackDear[fhProject] || 'All';
    document.getElementById('modal-proj-label').textContent  = projLabel;
    document.getElementById('modal-month-label').textContent = monthStr;

    // Populate summary card
    const completed = sessions.filter(s => !s.ongoing);
    const totalMs   = completed.reduce((sum, s) => sum + (s.duration || 0), 0);
    document.getElementById('modal-session-count').textContent = sessions.length;
    document.getElementById('modal-total-time').textContent    = fmtDuration(totalMs) || '—';

    // Project badge in header
    const badge = document.getElementById('modal-proj-badge');
    if (badge) badge.textContent = projLabel;

    emailToTags = [...(cfg.to || [])];
    emailCcTags = [...(cfg.cc || [])];
    renderEmailTags('to'); renderEmailTags('cc');
    document.getElementById('email-modal').classList.add('active');
    updateEmailPreview();
  }

  function closeEmailModal() {
    document.getElementById('email-modal').classList.remove('active');
  }

  function updateEmailPreview() {
    const dear    = document.getElementById('email-dear').value.trim() || 'All';
    const subject = document.getElementById('email-subject').value.trim();
    const html    = buildEmailHtml(getFhSessions(), dear);

    // Update iframe
    const frame = document.getElementById('email-preview-frame');
    frame.onload = scalePreviewFrame;
    frame.srcdoc = html;

    // Update chrome title
    const subjEl = document.getElementById('preview-subject');
    if (subjEl) subjEl.textContent = subject || '(ไม่มี subject)';

    // Update To
    const toEl    = document.getElementById('preview-to-val');
    const toCntEl = document.getElementById('preview-to-count');
    if (toEl) {
      const first = emailToTags[0] || '—';
      toEl.textContent = first;
      if (emailToTags.length > 1) {
        toCntEl.textContent = `+${emailToTags.length - 1}`;
        toCntEl.style.display = '';
      } else { toCntEl.style.display = 'none'; }
    }

    // Update CC
    const ccRow   = document.getElementById('preview-cc-row');
    const ccEl    = document.getElementById('preview-cc-val');
    const ccCntEl = document.getElementById('preview-cc-count');
    if (ccRow) {
      if (emailCcTags.length) {
        ccRow.style.display = '';
        ccEl.textContent = emailCcTags[0];
        if (emailCcTags.length > 1) {
          ccCntEl.textContent = `+${emailCcTags.length - 1}`;
          ccCntEl.style.display = '';
        } else { ccCntEl.style.display = 'none'; }
      } else { ccRow.style.display = 'none'; }
    }
  }

  function scalePreviewFrame() {
    const scroll  = document.getElementById('email-preview-scroll');
    const scaler  = document.getElementById('email-preview-scaler');
    const frame   = document.getElementById('email-preview-frame');
    if (!scroll || !scaler || !frame) return;

    const availW  = scroll.clientWidth || 400;
    const scale   = Math.min(1, availW / 700);

    // Measure real content height from iframe document
    let contentH = 620;
    try { contentH = frame.contentDocument?.documentElement?.scrollHeight || 620; } catch(_) {}

    frame.style.width  = '700px';
    frame.style.height = contentH + 'px';

    scaler.style.transform       = `scale(${scale})`;
    scaler.style.transformOrigin = 'top left';
    scaler.style.width           = '700px';
    scaler.style.height          = contentH + 'px';

    // Make the scroll wrapper just tall enough for the scaled content
    scroll.style.minHeight = Math.ceil(contentH * scale) + 'px';
  }

  function renderEmailTags(field) {
    const tags   = field === 'to' ? emailToTags : emailCcTags;
    const wrap   = document.getElementById(`${field}-wrap`);
    wrap.innerHTML = '';
    tags.forEach((email, idx) => {
      const tag = document.createElement('span');
      tag.className = 'email-tag';
      tag.innerHTML = `${escHtml(email)}<button onclick="removeEmailTag('${field}',${idx})">×</button>`;
      wrap.appendChild(tag);
    });
    const input = document.createElement('input');
    input.className   = 'email-tag-input';
    input.id          = `${field}-input`;
    input.placeholder = tags.length ? '' : 'email@example.com แล้วกด Enter';
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ',' || e.key === ' ') { e.preventDefault(); addEmailTag(field, input.value.trim()); }
      if (e.key === 'Backspace' && !input.value && tags.length) removeEmailTag(field, tags.length - 1);
    });
    input.addEventListener('blur', () => { if (input.value.trim()) addEmailTag(field, input.value.trim()); });
    wrap.appendChild(input);
  }

  function addEmailTag(field, email) {
    const clean = email.replace(/,$/, '').trim();
    if (!clean) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) { Toast.show(`"${clean}" ไม่ใช่ email ที่ถูกต้อง`, 'error'); return; }
    const arr = field === 'to' ? emailToTags : emailCcTags;
    if (!arr.includes(clean)) arr.push(clean);
    renderEmailTags(field);
  }

  function removeEmailTag(field, idx) {
    const arr = field === 'to' ? emailToTags : emailCcTags;
    arr.splice(idx, 1);
    renderEmailTags(field);
    document.getElementById(`${field}-input`)?.focus();
  }

  async function sendEmailReport() {
    const toInput = document.getElementById('to-input');
    if (toInput?.value.trim()) addEmailTag('to', toInput.value.trim());
    if (!emailToTags.length) { Toast.show('กรุณาระบุ To อย่างน้อย 1 ที่อยู่', 'error'); return; }
    const subject = document.getElementById('email-subject').value.trim();
    if (!subject) { Toast.show('กรุณาระบุ Subject', 'error'); return; }

    const btn = document.getElementById('email-send-btn');
    btn.disabled = true; btn.textContent = 'กำลังส่ง...';

    const dear = document.getElementById('email-dear').value.trim() || 'All';
    const res = await API.mail.send({
      to: emailToTags, cc: emailCcTags,
      subject, body: buildEmailHtml(getFhSessions(), dear), isHtml: true,
    });

    btn.disabled = false; btn.textContent = 'ส่ง Report';
    if (!res?.ok) { Toast.show(res?.data?.message || 'ส่งไม่สำเร็จ', 'error'); return; }
    Toast.show('ส่ง Report สำเร็จ', 'success');
    closeEmailModal();
  }

  function fmtDateShort(date) {
    if (!date) return '—';
    const pad = n => String(n).padStart(2, '0');
    return `${pad(date.getDate())}/${pad(date.getMonth()+1)}/${date.getFullYear()}`;
  }
  function fmtTimeShort(date) {
    if (!date) return '—';
    const pad = n => String(n).padStart(2, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }
  function fmtMonthTh(ym) {
    if (!ym) return '';
    const TH_MON = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
                    'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
    const [y, m] = ym.split('-');
    return `${TH_MON[+m-1]} ${+y + 543}`;
  }

  function buildEmailHtml(sessions, dear = 'All') {
    const projLabelMapEmail = { tmn: 'TMN', nano: 'Nano', welth: 'Welth', all: 'TMN + Nano + Welth' };
    const projLabel = projLabelMapEmail[fhProject] || fhProject.toUpperCase();
    const monthTh   = fhMonth ? fmtMonthTh(fhMonth) : monthLabel(fhMonth);
    const monthEn   = monthLabel(fhMonth);
    const completed = sessions.filter(s => !s.ongoing);
    const totalMs   = completed.reduce((sum, s) => sum + (s.duration || 0), 0);
    const avgMs     = completed.length ? Math.round(totalMs / completed.length) : 0;
    const showProj  = fhProject === 'all';

    const TH = (txt, extra='') =>
      `<th style="padding:11px 16px;font-size:11px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:#999999;text-align:left;border-bottom:2px solid #e8e8e8;background:#f7f7f7;white-space:nowrap;${extra}">${txt}</th>`;
    const TD = (txt, extra='') =>
      `<td style="padding:12px 16px;font-size:13px;color:#1c1c1e;border-bottom:1px solid #f0f0f0;vertical-align:middle;${extra}">${txt}</td>`;

    const rows = sessions.map((s, i) => {
      const bg = i % 2 === 0 ? '#ffffff' : '#fafafa';
      return `<tr style="background:${bg}">
        ${TD(sessions.length - i, 'color:#aaaaaa;font-size:12px;text-align:center;width:36px')}
        ${showProj ? TD(`<span style="font-weight:700;color:${s.project==='tmn'?'#F26419':'#6366f1'}">${s.project.toUpperCase()}</span>`, 'width:60px') : ''}
        ${TD(fmtDt(s.startTime), 'white-space:nowrap')}
        ${TD(s.endTime ? fmtDt(s.endTime) : '—', 'white-space:nowrap')}
        ${TD(s.ongoing
          ? `<span style="color:#16a34a;font-weight:700">On Firt-hop</span>`
          : `<span style="display:inline-block;background:#fff4ee;color:#F26419;font-weight:700;padding:3px 10px;border-radius:4px;font-size:12px">${fmtDuration(s.duration)}</span>`,
          'text-align:center;width:100px'
        )}
      </tr>`;
    }).join('');

    return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#efefef;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#efefef;padding:28px 0">
<tr><td align="center">
<table width="700" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.09)">

  <!-- Intro letter section -->
  <tr>
    <td style="padding:32px 36px 28px;border-bottom:1px solid #ebebeb">
      <p style="margin:0 0 16px;font-size:15px;color:#1c1c1e;font-weight:700">Dear ${escHtml(dear)}</p>
      <p style="margin:0;font-size:14px;color:#444444;line-height:1.75">
        จากการตรวจสอบ มีการ switch sms gateway ของเดือน <strong style="color:#1c1c1e">${monthTh}</strong>
        เพื่อไปใช้ระบบ FH จำนวน <strong style="color:#F26419">${sessions.length} ครั้ง</strong>
        ในช่วงวันและเวลาดังกล่าว ตามรายละเอียด log ประกอบครับ
      </p>
    </td>
  </tr>

  <!-- Dark report header -->
  <tr>
    <td style="background:#111111;padding:20px 36px">
      <table cellpadding="0" cellspacing="0">
        <tr>
          <td style="vertical-align:middle;padding-right:10px">
            <div style="width:9px;height:9px;background:#1d7a6b;border-radius:50%">&nbsp;</div>
          </td>
          <td style="vertical-align:middle">
            <span style="font-size:16px;font-weight:700;color:#ffffff">Firt-hop Usage Report</span>
            <span style="font-size:12px;color:#888888;margin-left:14px">${projLabel} &nbsp;·&nbsp; ${monthEn}</span>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Summary bar -->
  <tr>
    <td style="border-bottom:1px solid #ebebeb">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td width="33%" style="padding:18px 24px;text-align:center;border-right:1px solid #ebebeb">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:.6px;color:#aaaaaa;margin-bottom:6px">Sessions</div>
            <div style="font-size:30px;font-weight:700;color:#F26419;line-height:1">${sessions.length}</div>
          </td>
          <td width="33%" style="padding:18px 24px;text-align:center;border-right:1px solid #ebebeb">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:.6px;color:#aaaaaa;margin-bottom:6px">Total Time</div>
            <div style="font-size:22px;font-weight:700;color:#1c1c1e;line-height:1">${fmtDuration(totalMs) || '—'}</div>
          </td>
          <td width="33%" style="padding:18px 24px;text-align:center">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:.6px;color:#aaaaaa;margin-bottom:6px">Avg / Session</div>
            <div style="font-size:22px;font-weight:700;color:#1c1c1e;line-height:1">${fmtDuration(avgMs) || '—'}</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Data table -->
  <tr>
    <td style="padding:0">
      <table width="100%" cellpadding="0" cellspacing="0">
        <thead>
          <tr>
            ${TH('#', 'text-align:center;width:36px')}
            ${showProj ? TH('Project', 'width:60px') : ''}
            ${TH('Firt-hop เริ่ม')}
            ${TH('Firt-hop สิ้นสุด')}
            ${TH('Duration', 'text-align:center;width:100px')}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="padding:14px 36px;background:#f7f7f7;border-top:1px solid #ebebeb;text-align:center">
      <span style="font-size:11px;color:#cccccc;letter-spacing:.2px">SOM-Portal &nbsp;·&nbsp; SMS Gateway Switches &nbsp;·&nbsp; Firt-hop Report</span>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;
  }

  async function autoSyncAll() {
    const btn   = document.getElementById('sync-btn');
    const label = document.getElementById('sync-label');
    const spin  = document.getElementById('sync-spin');
    if (btn) btn.disabled = true;
    if (label) label.textContent = 'Auto Syncing...';
    if (spin) spin.classList.remove('hidden');

    Toast.show('กำลัง Auto Sync Jenkins (TMN · Nano · Welth)...', 'info');

    // ONE HTTP request — server loops through all 3 projects sequentially.
    // Avoids race conditions with PHP's built-in dev server (previous
    // Promise.allSettled approach caused intermittent env-var lookup failures).
    const res = await API.smsGateway.syncAll();

    if (btn) btn.disabled = false;
    if (label) label.textContent = '⇄ Sync Jenkins';
    if (spin) spin.classList.add('hidden');

    if (!res?.ok) {
      Toast.show(res?.data?.message || 'Auto-sync ล้มเหลว', 'error');
    } else {
      const results    = res.data?.data?.results || {};
      const totalAdded = Number(res.data?.data?.total_added ?? 0);
      const failures   = res.data?.data?.failures || [];

      // Build per-project breakdown: "TMN +2 · Nano +0 · Welth +1"
      const parts = [];
      for (const p of ['tmn', 'nano', 'welth']) {
        const r = results[p];
        if (!r) continue;
        const lbl = p === 'tmn' ? 'TMN' : p === 'nano' ? 'Nano' : 'Welth';
        if (r.ok) parts.push(`${lbl} +${r.added}`);
        else      parts.push(`${lbl} <i data-icon="x"></i>`);
      }
      const breakdown = parts.join(' · ');

      if (failures.length) {
        Toast.show(`Auto-sync บางส่วนล้มเหลว: ${breakdown}`, 'error');
      } else if (totalAdded > 0) {
        Toast.show(`Auto-sync สำเร็จ: ${breakdown} (รวม +${totalAdded} build)`, 'success');
      } else {
        Toast.show(`Auto-sync สำเร็จ: ${breakdown} · ไม่มี build ใหม่`, 'info');
      }
    }
    loadTable();
    refreshAllStats();
  }

  /* ── Init ── */
  window.addEventListener('resize', scalePreviewFrame);
  showSkeleton();
  // Show cached data immediately so user isn't staring at skeleton while Jenkins responds
  loadTable();
  refreshAllStats();
  // Fire auto-sync in background — robust to page already being loaded (BFCache / fast nav)
  if (document.readyState === 'complete') {
    autoSyncAll();
  } else {
    window.addEventListener('load', autoSyncAll, { once: true });
  }

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "addEmailTag", { configurable: true, get: () => addEmailTag, set: (v) => { addEmailTag = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "autoSyncAll", { configurable: true, get: () => autoSyncAll, set: (v) => { autoSyncAll = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "buildEmailHtml", { configurable: true, get: () => buildEmailHtml, set: (v) => { buildEmailHtml = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "buildSessions", { configurable: true, get: () => buildSessions, set: (v) => { buildSessions = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "cancelEdit", { configurable: true, get: () => cancelEdit, set: (v) => { cancelEdit = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeEmailModal", { configurable: true, get: () => closeEmailModal, set: (v) => { closeEmailModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeFhDrawer", { configurable: true, get: () => closeFhDrawer, set: (v) => { closeFhDrawer = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "exportCsv", { configurable: true, get: () => exportCsv, set: (v) => { exportCsv = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtDateShort", { configurable: true, get: () => fmtDateShort, set: (v) => { fmtDateShort = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtDt", { configurable: true, get: () => fmtDt, set: (v) => { fmtDt = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtDuration", { configurable: true, get: () => fmtDuration, set: (v) => { fmtDuration = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtMonthTh", { configurable: true, get: () => fmtMonthTh, set: (v) => { fmtMonthTh = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtRelative", { configurable: true, get: () => fmtRelative, set: (v) => { fmtRelative = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtTimeShort", { configurable: true, get: () => fmtTimeShort, set: (v) => { fmtTimeShort = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "formatDt", { configurable: true, get: () => formatDt, set: (v) => { formatDt = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "getFhSessions", { configurable: true, get: () => getFhSessions, set: (v) => { getFhSessions = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "gwBadge", { configurable: true, get: () => gwBadge, set: (v) => { gwBadge = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadFhReport", { configurable: true, get: () => loadFhReport, set: (v) => { loadFhReport = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadTable", { configurable: true, get: () => loadTable, set: (v) => { loadTable = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "monthLabel", { configurable: true, get: () => monthLabel, set: (v) => { monthLabel = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openEmailModal", { configurable: true, get: () => openEmailModal, set: (v) => { openEmailModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openFhDrawer", { configurable: true, get: () => openFhDrawer, set: (v) => { openFhDrawer = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "populateFhMonths", { configurable: true, get: () => populateFhMonths, set: (v) => { populateFhMonths = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "refreshAllStats", { configurable: true, get: () => refreshAllStats, set: (v) => { refreshAllStats = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "removeEmailTag", { configurable: true, get: () => removeEmailTag, set: (v) => { removeEmailTag = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderEmailTags", { configurable: true, get: () => renderEmailTags, set: (v) => { renderEmailTags = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderFhReport", { configurable: true, get: () => renderFhReport, set: (v) => { renderFhReport = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderStatCard", { configurable: true, get: () => renderStatCard, set: (v) => { renderStatCard = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "rowHtml", { configurable: true, get: () => rowHtml, set: (v) => { rowHtml = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "saveRemark", { configurable: true, get: () => saveRemark, set: (v) => { saveRemark = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "scalePreviewFrame", { configurable: true, get: () => scalePreviewFrame, set: (v) => { scalePreviewFrame = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "sendEmailReport", { configurable: true, get: () => sendEmailReport, set: (v) => { sendEmailReport = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setActiveTab", { configurable: true, get: () => setActiveTab, set: (v) => { setActiveTab = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setFhProject", { configurable: true, get: () => setFhProject, set: (v) => { setFhProject = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setFhMonth",   { configurable: true, get: () => setFhMonth,   set: (v) => { setFhMonth = v;   } }); } catch (e) {}
  try { Object.defineProperty(window, "showSkeleton", { configurable: true, get: () => showSkeleton, set: (v) => { showSkeleton = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "startEdit", { configurable: true, get: () => startEdit, set: (v) => { startEdit = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "switchProject", { configurable: true, get: () => switchProject, set: (v) => { switchProject = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "syncBuilds", { configurable: true, get: () => syncBuilds, set: (v) => { syncBuilds = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updateCardHeader", { configurable: true, get: () => updateCardHeader, set: (v) => { updateCardHeader = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updateEmailPreview", { configurable: true, get: () => updateEmailPreview, set: (v) => { updateEmailPreview = v; } }); } catch (e) {}
})();
