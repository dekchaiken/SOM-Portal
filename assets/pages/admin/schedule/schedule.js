// admin/schedule — page script, extracted from admin/schedule.html.
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
Layout.render('admin-schedule');

/* ═══════════════════════════════════════════════════
   Config
═══════════════════════════════════════════════════ */
const COLORS = [
  ['#f26419','rgba(242,100,25,.15)'],['#3b82f6','rgba(59,130,246,.15)'],
  ['#22c55e','rgba(34,197,94,.15)'], ['#f59e0b','rgba(245,158,11,.15)'],
  ['#8b5cf6','rgba(139,92,246,.15)'],['#ec4899','rgba(236,72,153,.15)'],
  ['#14b8a6','rgba(20,184,166,.15)'],['#ef4444','rgba(239,68,68,.15)'],
  ['#06b6d4','rgba(6,182,212,.15)'], ['#a855f7','rgba(168,85,247,.15)'],
  ['#84cc16','rgba(132,204,22,.15)'],['#f97316','rgba(249,115,22,.15)'],
  ['#10b981','rgba(16,185,129,.15)'],['#6366f1','rgba(99,102,241,.15)'],
  ['#64748b','rgba(100,116,139,.15)'],
];

const ROWS = [
  { id:'s1hd',  type:'section', label:'Shift#1',    time:'09:00–21:00', color:'#f26419' },
  { id:'s1t',   type:'members', label:'TDPK',        slot:'shift1_tdpk', lcolor:'#f26419' },
  { id:'s1w',   type:'members', label:'W@H',         slot:'shift1_wah',  lcolor:'#f26419' },
  { id:'s1oc',  type:'oncall',  label:'On Call',     slot:'shift1_oncall',lcolor:'#f59e0b' },
  { id:'s2hd',  type:'section', label:'Shift#2',    time:'21:00–09:00', color:'#8b5cf6' },
  { id:'s2w',   type:'members', label:'W@H',         slot:'shift2_wah',  lcolor:'#8b5cf6' },
  { id:'s2oc',  type:'oncall',  label:'On Call',     slot:'shift2_oncall',lcolor:'#f59e0b' },
  { id:'vac',   type:'members', label:'Vacation',       slot:'vacation',       lcolor:'#22c55e' },
  { id:'sick',  type:'members', label:'Sick Leave',    slot:'sick',           lcolor:'#ef4444' },
  { id:'biz',   type:'members', label:'Business Leave',slot:'business_leave', lcolor:'#7c3aed' },
  { id:'evt',   type:'events',  label:'Event',         slot:'events',         lcolor:'#38bdf8' },
];

const DAY_TH    = ['อา','จ','อ','พ','พฤ','ศ','ส'];
const MONTH_TH  = ['','ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const MONTH_FULL= ['','มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
                   'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];

let curYear  = new Date().getFullYear();
let curMonth = new Date().getMonth() + 1;
let schedData = {}, usersData = [], leaveData = [], quotaData = {}, userColorsData = {};
let fullYearScheduleData = {}; // all months of curYear, for accurate quota calculation
let _fullYearLoadedFor = null; // track which year was loaded
const _cm = {}; // color map uid → idx

/* ═══════════════════════════════════════════════════
   Helpers
═══════════════════════════════════════════════════ */
const pad    = n => String(n).padStart(2,'0');
const esc    = s => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const today  = () => { const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function buildColorMap(users) {
  users.forEach((u,i) => _cm[u.id] = COLORS[i % COLORS.length]);
}
function ucolor(uid) {
  if (!_cm[uid]) _cm[uid] = COLORS[Object.keys(_cm).length % COLORS.length];
  const custom = userColorsData[uid];
  if (custom) return [custom, hexToRgba(custom, .15)];
  return _cm[uid];
}
function uname(uid) {
  const u = usersData.find(u => u.id === uid);
  if (!u) return uid;
  return u.nickname || u.name.split(' ')[0] || u.name;
}

function chipHtml(uid) {
  const [fc,bg] = ucolor(uid);
  return `<div class="chip" style="color:#1c1c1e;background:${bg};border-color:${fc}40">
    <div class="chip-dot" style="background:${fc}"></div>${esc(uname(uid))}
  </div>`;
}

function fmtDate(d) {
  if (!d) return '—';
  const [y,m,day] = d.split('-');
  return `${parseInt(day)} ${MONTH_TH[parseInt(m)]} ${parseInt(y)+543}`;
}
function fmtDT(s) {
  if (!s) return '—';
  const d = new Date(s);
  return `${d.getDate()} ${MONTH_TH[d.getMonth()+1]} ${d.getFullYear()+543} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function daysBetween(a,b) {
  return Math.max(1, Math.round((new Date(b)-new Date(a))/86400000)+1);
}

// Supports dates[] (new) and legacy start_date/end_date range
function isOnLeaveDate(leave, ds) {
  if (leave.dates && Array.isArray(leave.dates)) return leave.dates.includes(ds);
  return leave.start_date <= ds && leave.end_date >= ds;
}
function leaveDayCount(leave) {
  if (leave.dates && Array.isArray(leave.dates)) return leave.dates.length;
  return daysBetween(leave.start_date, leave.end_date);
}

/* ── Holidays from API (holidayData) ────────────────── */
function getThaiHolidays(year) {
  const h = new Map();
  const prefix = `${year}-`;
  (holidayData || []).forEach(hol => {
    if (hol.date && hol.date.startsWith(prefix)) h.set(hol.date, hol.name);
  });
  return h;
}

/* ═══════════════════════════════════════════════════
   Calendar render
═══════════════════════════════════════════════════ */
function renderCalendar() {
  const tod = today();
  const dim = new Date(curYear, curMonth, 0).getDate();

  document.getElementById('month-title').textContent = `${MONTH_FULL[curMonth]} ${curYear+543}`;
  document.getElementById('stats-label').textContent  = `${MONTH_TH[curMonth]} ${curYear+543}`;

  /* ── Header ── */
  const holidays = getThaiHolidays(curYear);
  const head  = document.getElementById('cal-head');
  head.innerHTML = '';
  const trH = document.createElement('tr');

  const thL = document.createElement('th');
  thL.className = 'th-day c-sticky-head';
  thL.style.cssText = 'padding:10px 12px;text-align:left;font-size:8.5px;font-weight:700;letter-spacing:.09em;color:rgba(255,255,255,.25);white-space:nowrap';
  thL.textContent = 'SECTION / ROW';
  trH.appendChild(thL);

  for (let d = 1; d <= dim; d++) {
    const ds   = `${curYear}-${pad(curMonth)}-${pad(d)}`;
    const date = new Date(curYear, curMonth-1, d);
    const dow  = date.getDay();
    const isT  = ds === tod;
    const isW  = dow===0||dow===6;
    const holidayName = holidays.get(ds);
    const isH  = !!holidayName && !isT;
    const th   = document.createElement('th');
    th.className = 'th-day' + (isT?' is-today':'') + (isW?' is-weekend':'') + (isH?' is-holiday':'');
    if (holidayName) th.dataset.holiday = holidayName;
    th.innerHTML = `
      <span class="d-name">${DAY_TH[dow]}</span>
      <span class="d-num">${d}</span>
      <button class="clear-btn" onclick="clearDay('${ds}',event)">ล้าง</button>`;
    trH.appendChild(th);
  }
  head.appendChild(trH);

  /* ── Body ── */
  const body = document.getElementById('cal-body');
  body.innerHTML = '';

  ROWS.forEach(row => {
    const tr = document.createElement('tr');

    if (row.type === 'section') {
      tr.className = 'row-sec';
      const tdL = document.createElement('td');
      tdL.className = 'c-sticky';
      tdL.style.background = `linear-gradient(to right, ${row.color}12, transparent)`;
      tdL.innerHTML = `<div class="sec-label-cell">
        <div class="sec-dot" style="background:${row.color}"></div>
        <span class="sec-name" style="color:${row.color}">${row.label}</span>
        <span class="sec-time">${row.time}</span>
      </div>`;
      tr.appendChild(tdL);
      for (let d=1;d<=dim;d++) {
        const td = document.createElement('td');
        td.style.background = `${row.color}05`;
        td.innerHTML = `<div class="sec-fill">·</div>`;
        tr.appendChild(td);
      }
      body.appendChild(tr);
      return;
    }

    /* data row */
    const tdL = document.createElement('td');
    tdL.className = 'c-sticky';
    tdL.innerHTML = `<div class="row-lbl-cell">
      <div class="lbl-bar" style="background:${row.lcolor}"></div>
      <span class="lbl-text" style="color:${row.lcolor}">${row.label}</span>
    </div>`;
    tr.appendChild(tdL);

    for (let d=1;d<=dim;d++) {
      const ds    = `${curYear}-${pad(curMonth)}-${pad(d)}`;
      const date  = new Date(curYear, curMonth-1, d);
      const dow   = date.getDay();
      const isT   = ds === tod;
      const isW   = dow===0||dow===6;
      const entry = schedData[ds] || {};
      
      // Check if there are approved leaves for this date (supports dates[] and legacy range)
      const hasApprovedLeaves = leaveData.some(l => l.status === 'approved' && isOnLeaveDate(l, ds));
      
      // Only block editing for vacation/sick rows if there are approved leaves
      // Other rows (TDPK, W@H, On Call, Events) should remain editable
      const shouldBlockEdit = hasApprovedLeaves && (row.slot === 'vacation' || row.slot === 'sick' || row.slot === 'business_leave');

      const isH2 = holidays.has(ds) && !isT;
      const td = document.createElement('td');
      td.className = 'cal-cell' +
        (isT  ? ' col-today'   : '') +
        (isW  ? ' col-weekend' : '') +
        (isH2 ? ' col-holiday' : '') +
        (row.type==='oncall' ? ' cell-oc' : '') +
        (row.type==='events' ? ' cell-ev' : '');
      td.innerHTML = cellHtml(row, entry);
      
      if (!shouldBlockEdit) {
        td.onclick   = () => openCellModal(row, ds);
        td.style.cursor = 'pointer';
      } else {
        td.style.opacity = '0.6';
        td.style.cursor = 'not-allowed';
        td.title = 'มีการลาที่อนุมัติในวันนี้';
      }
      tr.appendChild(td);
    }
    body.appendChild(tr);
  });

  renderStats();
  renderChips();
}

function cellHtml(row, entry) {
  if (row.type === 'members') {
    const raw = entry[row.slot] || [];
    if (!raw.length) return '';
    // entry may be a plain uid string or {user_id, days, period} object (half-day)
    return `<div class="chips">${raw.map(e => {
      const uid = typeof e === 'object' ? e.user_id : e;
      return chipHtml(uid);
    }).join('')}</div>`;
  }
  if (row.type === 'oncall') {
    const v = entry[row.slot] || '';
    return v ? `<span class="oc-val">${esc(uname(v))}</span>` : '';
  }
  if (row.type === 'events') {
    const arr = entry[row.slot] || [];
    return arr.map(e => `<div class="ev-txt">${esc(e)}</div>`).join('');
  }
  return '';
}

/* ── Stats ── */
function renderStats() {
  const c = {};
  // Initialize all users with 0 counts
  usersData.forEach(u => {
    c[u.id] = {tdpk:0, wah1:0, wah2:0, vac:0, sick:0, biz:0};
  });
  // Count from schedule data
  Object.values(schedData).forEach(e => {
    [['tdpk',e.shift1_tdpk],['wah1',e.shift1_wah],['wah2',e.shift2_wah],
     ['vac',e.vacation],['sick',e.sick],['biz',e.business_leave]].forEach(([k,ids]) => {
      (ids||[]).forEach(raw => {
        const id = typeof raw === 'object' ? raw.user_id : raw;
        if (c[id]) c[id][k]++;
      });
    });
  });
  const uids = Object.keys(c).sort((a,b)=>{
    const ta=c[a].tdpk+c[a].wah1+c[a].wah2;
    const tb=c[b].tdpk+c[b].wah1+c[b].wah2;
    return tb-ta;
  });
  const tbody = document.getElementById('stats-body');
  if (!uids.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:28px;color:var(--text-muted);font-size:12px">ไม่มีสมาชิก</td></tr>';
    return;
  }
  tbody.innerHTML = uids.map(uid => {
    const r = c[uid];
    const tot = r.tdpk+r.wah1+r.wah2;
    const [fc] = ucolor(uid);
    return `<tr>
      <td><div style="display:flex;align-items:center;gap:9px">
        <div style="width:9px;height:9px;border-radius:50%;background:${fc};flex-shrink:0"></div>
        <span style="font-weight:700;font-size:12px">${esc(uname(uid))}</span>
      </div></td>
      <td class="c"><span class="sbadge" style="background:rgba(242,100,25,.12);color:var(--orange)">${r.tdpk}</span></td>
      <td class="c"><span class="sbadge" style="background:rgba(59,130,246,.12);color:#3b82f6">${r.wah1}</span></td>
      <td class="c"><span class="sbadge" style="background:rgba(139,92,246,.12);color:#8b5cf6">${r.wah2}</span></td>
      <td class="c"><span style="font-weight:800;font-size:13px;color:var(--text)">${tot}</span></td>
      <td class="c"><span style="font-weight:700;color:var(--orange)">${quotaData[uid] || 0}</span> / <span style="font-weight:700;color:#999">${r.vac}</span></td>
      <td class="c"><span class="sbadge" style="background:rgba(34,197,94,.12);color:#22c55e">${r.vac}</span></td>
      <td class="c"><span class="sbadge" style="background:rgba(239,68,68,.12);color:#ef4444">${r.sick}</span></td>
      <td class="c"><span class="sbadge" style="background:rgba(124,58,237,.12);color:#7c3aed">${r.biz}</span></td>
    </tr>`;
  }).join('');
}

function renderChips() {
  const dim = new Date(curYear, curMonth, 0).getDate();
  const tod = today();
  const te  = schedData[tod] || {};
  const onLeaveToday = (te.vacation||[]).length + (te.sick||[]).length + (te.business_leave||[]).length;
  document.getElementById('mnav-chips').innerHTML = `
    <div class="mnav-chip"><i data-icon="calendar"></i> <strong>${dim}</strong> วัน</div>
    ${onLeaveToday ? `<div class="mnav-chip">🏖 <strong>${onLeaveToday}</strong> คนลาวันนี้</div>` : ''}
    <div class="mnav-chip"><i data-icon="clock"></i> S1 <strong>09:00–21:00</strong></div>
    <div class="mnav-chip"><i data-icon="moon"></i> S2 <strong>21:00–09:00</strong></div>
  `;
}

/* ═══════════════════════════════════════════════════
   Month nav / data loading
═══════════════════════════════════════════════════ */
function changeMonth(d) {
  const prevYear = curYear;
  curMonth += d;
  if (curMonth>12){curMonth=1;curYear++;}
  if (curMonth<1) {curMonth=12;curYear--;}
  // If year changed, reload full year data
  if (curYear !== prevYear) {
    _fullYearLoadedFor = null;
    fullYearScheduleData = {};
    loadSchedule().then(() => loadFullYearSchedule());
  } else {
    loadSchedule();
  }
}
function goToday() {
  const n = new Date();
  curYear=n.getFullYear(); curMonth=n.getMonth()+1;
  loadSchedule();
}

async function loadSchedule() {
  const r = await API.schedule.get(curYear, curMonth);
  schedData = r?.ok ? (r.data.data||{}) : {};
  // Merge into year cache
  Object.assign(fullYearScheduleData, schedData);
  renderCalendar();
}

async function loadFullYearSchedule() {
  if (_fullYearLoadedFor === curYear) return; // already loaded
  _fullYearLoadedFor = curYear;
  fullYearScheduleData = {};
  const results = await Promise.all(
    Array.from({length: 12}, (_, i) => API.schedule.get(curYear, i + 1))
  );
  results.forEach(r => {
    if (r?.ok) Object.assign(fullYearScheduleData, r.data.data || {});
  });
  renderQuotas(); // refresh once full year is loaded
}
async function loadUsers() {
  const r = await API.users.list();
  usersData = (r?.ok ? (r.data.data||[]) : []).filter(u => u.schedule_include !== false);
  buildColorMap(usersData);
}
async function loadLeaves() {
  const r = await API.leave.list({ admin: true });
  leaveData = r?.ok ? (r.data.data||[]) : [];
  const pending = leaveData.filter(l => l.status === 'pending').length;
  const btn = document.getElementById('leave-btn');
  if (btn) btn.innerHTML = pending > 0 ? `<i data-icon="clipboard"></i> คำขอลา (${pending})` : '<i data-icon="clipboard"></i> คำขอลา';
}
async function loadUserColors() {
  const r = await API.userColors.get();
  userColorsData = r?.ok ? (r.data.data || {}) : {};
}
async function loadAll() {
  await Promise.all([loadUsers(), loadUserColors(), loadHolidays()]);
  await Promise.all([loadSchedule(), loadLeaves(), loadQuotas()]);
  renderStats();
  renderQuotas();
  renderColorSettings();
  // Load full year in background for accurate yearly quota
  loadFullYearSchedule();
}

/* ═══════════════════════════════════════════════════
   Vacation Quota Management
═══════════════════════════════════════════════════ */
async function loadQuotas() {
  const r = await API.vacation.getQuotas();
  quotaData = r?.ok ? (r.data.data || {}) : {};
}

function renderQuotas() {
  const tbody = document.getElementById('quota-body');
  const rows = usersData.map(u => {
    const quota = parseFloat(quotaData[u.id]) || 0;
    // Count approved vacation leave requests and track which dates they cover
    const yearStr = String(curYear);
    const covDates = new Set();
    const usedFromLeaves = (leaveData || []).reduce((sum, leave) => {
      if (leave.user_id !== u.id || leave.status !== 'approved' || leave.type !== 'vacation') return sum;
      let yearDates = [];
      if (leave.dates?.length) {
        yearDates = leave.dates.filter(d => d.startsWith(yearStr));
      } else if (leave.start_date && leave.end_date) {
        for (let d = new Date(leave.start_date); d <= new Date(leave.end_date); d.setDate(d.getDate()+1)) {
          const ds = d.toISOString().slice(0,10);
          if (ds.startsWith(yearStr)) yearDates.push(ds);
        }
      }
      yearDates.forEach(d => covDates.add(d));
      if (!yearDates.length) return sum;
      return sum + (leave.duration === 'half' ? yearDates.length * 0.5 : yearDates.length);
    }, 0);
    // Count schedule vacation entries (full year) not already covered by leave requests
    const usedFromSchedule = Object.entries(fullYearScheduleData).reduce((sum, [date, day]) => {
      if (!date.startsWith(yearStr) || covDates.has(date)) return sum;
      return sum + ((day.vacation || []).reduce((s, v) => {
        if (typeof v === 'object' && v.user_id === u.id) return s + (v.days || 1);
        if (v === u.id) return s + 1;
        return s;
      }, 0));
    }, 0);
    const used = usedFromLeaves + usedFromSchedule;
    const remaining = quota - used;
    const [fc] = ucolor(u.id);
    const quotaDisplay = quota % 1 === 0 ? quota : quota.toFixed(1);
    const usedDisplay = used % 1 === 0 ? used : used.toFixed(1);
    const remainingDisplay = remaining % 1 === 0 ? remaining : remaining.toFixed(1);
    return `<tr>
      <td><div class="quota-label">
        <div class="qlb-dot" style="background:${fc}"></div>
        <span>${esc(u.name)}</span>
      </div></td>
      <td class="c"><input class="quota-input" type="number" min="0" max="30" step="0.5" value="${quota}" data-uid="${u.id}" onchange="markQuotaDirty()"></td>
      <td class="c"><span style="font-weight:700;color:var(--text)">${usedDisplay}</span> วัน</td>
      <td class="c"><span style="font-weight:700;color:${remaining < 0 ? '#ef4444' : '#22c55e'}">${Math.max(0, remainingDisplay)}</span> วัน</td>
    </tr>`;
  }).join('');
  
  tbody.innerHTML = rows || '<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--text-muted);font-size:12px">ไม่มีสมาชิก</td></tr>';
}

function markQuotaDirty() {
  document.getElementById('quota-save-btn').style.display = '';
}

async function saveAllQuotas() {
  const inputs = document.querySelectorAll('.quota-input');
  const data = {};
  inputs.forEach(inp => {
    const uid = inp.dataset.uid;
    const val = parseFloat(inp.value) || 0;
    data[uid] = val;
  });
  
  const btn = document.getElementById('quota-save-btn');
  btn.disabled = true;
  btn.textContent = 'กำลังบันทึก...';
  
  const r = await API.vacation.setQuotas(data);
  btn.disabled = false;
  btn.innerHTML = '<i data-icon="save"></i> บันทึก';
  
  if (!r?.ok) { Toast.error(r?.data?.message || 'บันทึกไม่ได้'); return; }
  
  quotaData = data;
  Toast.success('บันทึกแล้ว <i data-icon="check"></i>');
  btn.style.display = 'none';
  renderStats();
  renderQuotas();
}


/* ═══════════════════════════════════════════════════
   User Color Settings
═══════════════════════════════════════════════════ */
function renderColorSettings() {
  const tbody = document.getElementById('color-body');
  if (!usersData.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--text-muted);font-size:12px">ไม่มีสมาชิก</td></tr>';
    return;
  }
  tbody.innerHTML = usersData.map(u => {
    const [fc, bg] = ucolor(u.id);
    const customColor = userColorsData[u.id] || fc;
    return `<tr>
      <td><div class="quota-label">
        <div class="qlb-dot" style="background:${fc}"></div>
        <span>${esc(u.name)}${u.nickname ? ` <span style="color:var(--text-muted);font-size:10px">(${esc(u.nickname)})</span>` : ''}</span>
      </div></td>
      <td class="c">
        <div class="chip" id="color-preview-${u.id}" style="color:#1c1c1e;background:${hexToRgba(customColor,.15)};border-color:${customColor}40;display:inline-flex;align-items:center;gap:3px;padding:3px 8px;border-radius:4px;font-size:11px;font-weight:700;border:1px solid">
          <div style="width:7px;height:7px;border-radius:50%;background:${customColor}"></div>
          ${esc(u.nickname || u.name.split(' ')[0] || u.name)}
        </div>
      </td>
      <td class="c">
        <input type="color" value="${customColor}" data-uid="${u.id}"
          style="width:40px;height:32px;border:1.5px solid #e8e8e8;border-radius:8px;cursor:pointer;padding:2px"
          oninput="previewColor('${u.id}', this.value)" onchange="markColorDirty()">
      </td>
      <td class="c">
        <button class="btn btn-ghost btn-sm" onclick="resetColor('${u.id}')" style="font-size:10px;color:#999">↺ ค่าเริ่ม</button>
      </td>
    </tr>`;
  }).join('');
}

function previewColor(uid, color) {
  const preview = document.getElementById(`color-preview-${uid}`);
  if (!preview) return;
  preview.style.background = hexToRgba(color, .15);
  preview.style.borderColor = color + '40';
  preview.querySelector('div').style.background = color;
}

function markColorDirty() {
  document.getElementById('color-save-btn').style.display = '';
}

function resetColor(uid) {
  // Remove custom color, revert to auto-assigned
  const [fc] = _cm[uid] || COLORS[0];
  const input = document.querySelector(`input[data-uid="${uid}"]`);
  if (input) { input.value = fc; previewColor(uid, fc); }
  markColorDirty();
}

async function saveAllColors() {
  const inputs = document.querySelectorAll('#color-body input[type="color"]');
  const data = {};
  inputs.forEach(inp => {
    const uid = inp.dataset.uid;
    const autoColor = (_cm[uid] || COLORS[0])[0];
    // Only save if different from auto-assigned (or always save custom)
    data[uid] = inp.value;
  });

  const btn = document.getElementById('color-save-btn');
  btn.disabled = true; btn.textContent = 'กำลังบันทึก...';

  const r = await API.userColors.set(data);
  btn.disabled = false; btn.innerHTML = '<i data-icon="save"></i> บันทึกสี';

  if (!r?.ok) { Toast.error(r?.data?.message || 'บันทึกไม่ได้'); return; }

  userColorsData = data;
  Toast.success('บันทึกสีแล้ว <i data-icon="check"></i>');
  btn.style.display = 'none';
  renderCalendar();
  renderColorSettings();
}

async function clearDay(date, evt) {
  evt.stopPropagation();
  if (!confirm(`ล้างข้อมูลทั้งหมดของ ${fmtDate(date)}?`)) return;
  const r = await API.schedule.clearDay(date);
  if (!r?.ok) { Toast.error(r?.data?.message||'ล้างไม่ได้'); return; }
  Toast.success('ล้างเรียบร้อยแล้ว');
  delete schedData[date];
  renderCalendar();
}

/* ═══════════════════════════════════════════════════
   Cell modal
═══════════════════════════════════════════════════ */
let _cRow=null, _cDate='', _evList=[];

const SLOT_LABEL = {
  shift1_tdpk:'Shift#1 · TDPK', shift1_wah:'Shift#1 · W@H', shift1_oncall:'Shift#1 · On Call',
  shift2_wah:'Shift#2 · W@H',   shift2_oncall:'Shift#2 · On Call',
  vacation:'Vacation',           sick:'Sick Leave', business_leave:'Business Leave', events:'Events',
};

function openCellModal(row, ds) {
  _cRow=row; _cDate=ds;
  const entry = schedData[ds]||{};
  const [,dm,dd] = ds.split('-');
  const dow = new Date(ds+'T00:00:00').getDay();

  document.getElementById('cm-title').textContent = SLOT_LABEL[row.slot]||row.label;
  document.getElementById('cm-sub').textContent   = `${DAY_TH[dow]} ที่ ${parseInt(dd)} ${MONTH_TH[parseInt(dm)]} ${parseInt(ds.split('-')[0])+543}`;

  const body = document.getElementById('cm-body');
  body.innerHTML = '';

  if (row.type==='members')     body.appendChild(buildChecklist(row, ds, entry[row.slot]||[]));
  else if (row.type==='oncall') body.appendChild(buildOncall(entry[row.slot]||''));
  else if (row.type==='events') { _evList=[...(entry[row.slot]||[])]; body.appendChild(buildEvents()); }

  document.getElementById('cell-modal').classList.add('open');
}
function closeCellModal() {
  document.getElementById('cell-modal').classList.remove('open');
  _cRow=null; _cDate='';
}

/* Checklist */
function buildChecklist(row, ds, selected) {
  const onLeave = new Set(
    leaveData.filter(l=>l.status==='approved'&&isOnLeaveDate(l,ds)).map(l=>l.user_id)
  );
  // Normalize: selected may contain plain uid strings or {user_id,...} objects
  const selectedIds = selected.map(e => typeof e === 'object' ? e.user_id : e);

  const wrap = document.createElement('div');

  const warn = document.createElement('div');
  warn.className='conflict-box'; warn.id='conflict-warn';
  warn.innerHTML = '<span><i data-icon="alert-triangle"></i></span><span id="conflict-msg"></span>';
  wrap.appendChild(warn);

  const list = document.createElement('div');
  list.className='uclist';
  [...usersData].sort((a,b) => a.name.localeCompare(b.name,'th')).forEach(u => {
    const [fc,bg] = ucolor(u.id);
    const isChk   = selectedIds.includes(u.id);
    const isOL    = onLeave.has(u.id);
    const isLeaveSlot = ['vacation', 'sick', 'business_leave'].includes(row.slot);
    const shouldDisable = isOL && !isLeaveSlot;
    const el      = document.createElement('div');
    el.className  = 'ucrow'+(isChk?' sel':'')+(shouldDisable?' disabled':'');
    el.style.cssText = `--uc:${fc};--ub:${bg}`;
    el.dataset.uid = u.id;
    el.innerHTML = `
      <div class="ucrow-check">${isChk?'✓':''}</div>
      <div class="ucrow-dot" style="background:${fc}"></div>
      <div class="ucrow-name">${esc(u.name)}${u.nickname ? `<span style="color:var(--text-muted);font-size:10px;margin-left:4px">(${esc(u.nickname)})</span>` : ''}</div>
      ${isOL?`<span class="leave-pill">🏖 ลา</span>`:''}
    `;
    if (!shouldDisable) el.onclick = () => {
      el.classList.toggle('sel');
      el.querySelector('.ucrow-check').innerHTML = el.classList.contains('sel')?'<i data-icon="check"></i>':'';
      updateConflict(ds);
    };
    list.appendChild(el);
  });
  if (!usersData.length) list.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-muted);font-size:12px">ไม่มีสมาชิก</div>';
  wrap.appendChild(list);
  setTimeout(()=>updateConflict(ds),0);
  return wrap;
}

function updateConflict(ds) {
  const warn = document.getElementById('conflict-warn');
  const msg  = document.getElementById('conflict-msg');
  if (!warn) return;
  const onLeave = new Set(leaveData.filter(l=>l.status==='approved'&&l.start_date<=ds&&l.end_date>=ds).map(l=>l.user_id));
  const badOnes = [...document.querySelectorAll('#cm-body .ucrow.sel')].map(e=>e.dataset.uid).filter(id=>onLeave.has(id));
  if (badOnes.length) {
    msg.textContent = `${badOnes.map(uname).join(', ')} มีการลาที่อนุมัติในวันนี้`;
    warn.classList.add('show');
  } else warn.classList.remove('show');
}

/* Oncall */
function buildOncall(val) {
  const wrap = document.createElement('div');
  
  const lbl = document.createElement('div');
  lbl.className = 'f-lbl';
  lbl.textContent = 'On-Call';
  wrap.appendChild(lbl);
  
  const list = document.createElement('div');
  list.className = 'uclist';
  list.style.maxHeight = '280px';
  list.style.overflowY = 'auto';
  
  // Add "ไม่มี" option
  const noneEl = document.createElement('div');
  noneEl.className = 'ucrow' + (val === '' ? ' sel' : '');
  noneEl.innerHTML = `
    <div class="ucrow-check" style="position:relative;width:18px;height:18px;border:2px solid #e8e8e8;border-radius:50%">
      ${val === '' ? '<div style="position:absolute;width:8px;height:8px;background:#1c1c1e;border-radius:50%;top:50%;left:50%;transform:translate(-50%,-50%)"></div>' : ''}
    </div>
    <div class="ucrow-name" style="flex:1">ไม่มี On-Call</div>
  `;
  noneEl.style.cursor = 'pointer';
  noneEl.onclick = () => selectOncallPerson('');
  list.appendChild(noneEl);
  
  // Add users
  [...usersData].sort((a,b) => a.name.localeCompare(b.name,'th')).forEach(u => {
    const [fc, bg] = ucolor(u.id);
    const isSelected = val === u.id;
    const el = document.createElement('div');
    el.className = 'ucrow' + (isSelected ? ' sel' : '');
    el.style.cssText = `--uc:${fc};--ub:${bg}`;
    el.dataset.uid = u.id;
    el.innerHTML = `
      <div class="ucrow-check" style="position:relative;width:18px;height:18px;border:2px solid #e8e8e8;border-radius:50%;background:${isSelected ? fc : 'transparent'}">
        ${isSelected ? '<div style="position:absolute;width:6px;height:6px;background:white;border-radius:50%;top:50%;left:50%;transform:translate(-50%,-50%)"></div>' : ''}
      </div>
      <div class="ucrow-dot" style="background:${fc}"></div>
      <div class="ucrow-name" style="flex:1">${esc(u.name)}${u.nickname ? `<span style="color:var(--text-muted);font-size:10px;margin-left:4px">(${esc(u.nickname)})</span>` : ''}</div>
    `;
    el.style.cursor = 'pointer';
    el.onclick = () => selectOncallPerson(u.id);
    list.appendChild(el);
  });
  
  if (!usersData.length) list.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-muted);font-size:12px">ไม่มีสมาชิก</div>';
  wrap.appendChild(list);
  return wrap;
}

function selectOncallPerson(uid) {
  const rows = document.querySelectorAll('#cm-body .ucrow');
  rows.forEach(r => {
    const isMatch = (uid === '' && !r.dataset.uid) || (uid !== '' && r.dataset.uid === uid);
    if (isMatch) {
      r.classList.add('sel');
      const check = r.querySelector('.ucrow-check');
      if (uid === '') {
        check.innerHTML = '<div style="position:absolute;width:8px;height:8px;background:#1c1c1e;border-radius:50%;top:50%;left:50%;transform:translate(-50%,-50%)"></div>';
      } else {
        const [fc] = ucolor(uid);
        check.style.background = fc;
        check.innerHTML = '<div style="position:absolute;width:6px;height:6px;background:white;border-radius:50%;top:50%;left:50%;transform:translate(-50%,-50%)"></div>';
      }
    } else {
      r.classList.remove('sel');
      r.querySelector('.ucrow-check').innerHTML = '';
      r.querySelector('.ucrow-check').style.background = 'transparent';
    }
  });
}

/* Events */
function buildEvents() {
  const d = document.createElement('div');
  d.id = 'ev-editor';
  refreshEvents(d);
  return d;
}
function refreshEvents(container) {
  if (!container) container=document.getElementById('ev-editor');
  if (!container) return;
  container.innerHTML = `
    <div class="f-lbl">Events ประจำวัน</div>
    <div class="etags">
      ${_evList.map((e,i)=>`<div class="etag"><span>${esc(e)}</span><span class="etag-x" onclick="rmEv(${i})">✕</span></div>`).join('')}
      ${!_evList.length?'<span style="font-size:11px;color:var(--text-muted);opacity:.6">ยังไม่มี event</span>':''}
    </div>
    <div class="eadd-row">
      <input class="f-in" id="ev-in" placeholder="พิมพ์ event แล้วกด Enter หรือ +"
        style="flex:1" onkeydown="if(event.key==='Enter'){event.preventDefault();addEv();}">
      <button class="btn btn-ghost btn-sm" onclick="addEv()" style="font-size:11px">+ เพิ่ม</button>
    </div>
  `;
}
function addEv() { const v=document.getElementById('ev-in').value.trim(); if(!v)return; _evList.push(v); document.getElementById('ev-in').value=''; refreshEvents(); }
function rmEv(i) { _evList.splice(i,1); refreshEvents(); }

/* Save */
async function saveCellModal() {
  if (!_cRow||!_cDate) return;
  const btn=document.getElementById('cm-save');
  btn.disabled=true; btn.textContent='กำลังบันทึก...';
  let val;
  if (_cRow.type==='members') val=[...(document.querySelectorAll('#cm-body .ucrow.sel'))].map(e=>e.dataset.uid);
  else if (_cRow.type==='oncall') {
    const selected = document.querySelector('#cm-body .ucrow.sel');
    val = selected?.dataset?.uid || '';
  }
  else val=_evList;

  const r = await API.schedule.setSlot({date:_cDate, slot:_cRow.slot, value:val});
  btn.disabled=false; btn.innerHTML='<i data-icon="save"></i> บันทึก';
  if (!r?.ok) { Toast.error(r?.data?.message||'บันทึกไม่ได้'); return; }

  if (!schedData[_cDate]) schedData[_cDate]={};
  const empty = val===''||(Array.isArray(val)&&!val.length);
  if (empty) {
    delete schedData[_cDate][_cRow.slot];
    if (!Object.keys(schedData[_cDate]).length) delete schedData[_cDate];
  } else schedData[_cDate][_cRow.slot]=val;

  // Keep fullYearScheduleData in sync
  if (empty) {
    if (fullYearScheduleData[_cDate]) {
      delete fullYearScheduleData[_cDate][_cRow.slot];
      if (!Object.keys(fullYearScheduleData[_cDate]).length) delete fullYearScheduleData[_cDate];
    }
  } else {
    if (!fullYearScheduleData[_cDate]) fullYearScheduleData[_cDate] = {};
    fullYearScheduleData[_cDate][_cRow.slot] = val;
  }

  Toast.success('บันทึกแล้ว <i data-icon="check"></i>');
  closeCellModal();
  renderCalendar();
  renderQuotas();
}

document.getElementById('cell-modal').addEventListener('click',e=>{ if(e.target===document.getElementById('cell-modal'))closeCellModal(); });
document.getElementById('hol-modal').addEventListener('click',e=>{ if(e.target===document.getElementById('hol-modal'))closeHolModal(); });

/* ═══════════════════════════════════════════════════
   Holiday Management
═══════════════════════════════════════════════════ */
let holidayData = [];
let _holEditId  = null;

async function loadHolidays() {
  const r = await API.holidays.list();
  holidayData = r?.ok ? (r.data.data || []) : [];
  renderHolidays();
  renderCalendar();
}

function renderHolidays() {
  const year = parseInt(document.getElementById('hol-year-filter')?.value || curYear);
  const filtered = holidayData.filter(h => h.date && h.date.startsWith(`${year}-`));
  const tbody = document.getElementById('holiday-body');
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;padding:24px;color:var(--text-muted);font-size:12px">ไม่มีวันหยุดในปีนี้</td></tr>`;
    return;
  }
  tbody.innerHTML = filtered.map(h => `
    <tr>
      <td style="padding:10px 12px;font-size:12px;font-weight:600;color:#92400e;white-space:nowrap">
        <span style="background:#fef3c7;padding:3px 8px;border-radius:6px;border:1px solid #fcd34d">${fmtDate(h.date)}</span>
      </td>
      <td style="padding:10px 12px;font-size:13px;color:var(--text)">${esc(h.name)}</td>
      <td style="padding:10px 12px;text-align:center;white-space:nowrap">
        <button class="btn btn-ghost btn-sm" data-hid="${esc(h.id)}" data-hdate="${esc(h.date)}" data-hname="${esc(h.name).replace(/"/g,'&quot;')}" onclick="openHolModalFromBtn(this)" style="font-size:10px;margin-right:4px">✎ แก้ไข</button>
        <button class="btn btn-sm" data-hid="${esc(h.id)}" data-hname="${esc(h.name).replace(/"/g,'&quot;')}" onclick="deleteHolFromBtn(this)" style="font-size:10px;background:#fef2f2;color:#ef4444;border-color:#fecaca"><i data-icon="x"></i></button>
      </td>
    </tr>
  `).join('');
}

function openHolModalFromBtn(btn) { openHolModal(btn.dataset.hid, btn.dataset.hdate, btn.dataset.hname); }
function deleteHolFromBtn(btn)   { deleteHoliday(btn.dataset.hid, btn.dataset.hname); }

function openHolModal(id, date, name) {
  _holEditId = id || null;
  document.getElementById('hol-modal-title').textContent = id ? 'แก้ไขวันหยุด' : 'เพิ่มวันหยุด';
  document.getElementById('hol-date').value = date || '';
  document.getElementById('hol-name').value = name || '';
  document.getElementById('hol-modal').classList.add('open');
  setTimeout(() => document.getElementById('hol-name').focus(), 80);
}
function closeHolModal() {
  document.getElementById('hol-modal').classList.remove('open');
  _holEditId = null;
}

async function saveHoliday() {
  const date = document.getElementById('hol-date').value.trim();
  const name = document.getElementById('hol-name').value.trim();
  if (!date || !name) { Toast.error('กรุณากรอกวันที่และชื่อวันหยุด'); return; }

  const btn = document.getElementById('hol-save-btn');
  btn.disabled = true; btn.textContent = 'กำลังบันทึก...';

  let r;
  if (_holEditId) {
    r = await API.holidays.update(_holEditId, { date, name });
  } else {
    r = await API.holidays.add({ date, name });
  }

  btn.disabled = false; btn.innerHTML = '<i data-icon="save"></i> บันทึก';
  if (!r?.ok) { Toast.error(r?.data?.message || 'บันทึกไม่ได้'); return; }
  Toast.success(r.data?.message || 'บันทึกแล้ว <i data-icon="check"></i>');
  closeHolModal();
  await loadHolidays();
}

async function deleteHoliday(id, name) {
  if (!confirm(`ลบวันหยุด "${name}" ?\nการดำเนินการนี้ไม่สามารถย้อนกลับได้`)) return;
  const r = await API.holidays.delete(id);
  if (!r?.ok) { Toast.error(r?.data?.message || 'ลบไม่ได้'); return; }
  Toast.success('ลบวันหยุดแล้ว');
  await loadHolidays();
}

loadAll();

// ── Holiday tooltip ──────────────────────────────────────────────────────────
(function () {
  const tip = document.createElement('div');
  tip.style.cssText = 'position:fixed;z-index:99999;background:#1c1c1e;color:#fff;border-radius:10px;padding:10px 14px;font-size:12px;font-weight:500;line-height:1.5;max-width:260px;pointer-events:none;box-shadow:0 8px 28px rgba(0,0,0,.28);opacity:0;transform:translateY(4px);transition:opacity .15s,transform .15s;white-space:pre-wrap;word-break:break-word;';
  document.body.appendChild(tip);

  let hideTimer;

  function show(text, e) {
    clearTimeout(hideTimer);
    tip.textContent = text;
    tip.style.opacity = '1'; tip.style.transform = 'translateY(0)';
    move(e);
  }
  function move(e) {
    const pad = 12, tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = e.clientX + pad, y = e.clientY + pad;
    if (x + tw > window.innerWidth  - pad) x = e.clientX - tw - pad;
    if (y + th > window.innerHeight - pad) y = e.clientY - th - pad;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }
  function hide() {
    hideTimer = setTimeout(() => { tip.style.opacity = '0'; tip.style.transform = 'translateY(4px)'; }, 80);
  }

  document.getElementById('cal-table').addEventListener('mouseover', e => {
    const hd = e.target.closest('.th-day.is-holiday');
    if (hd?.dataset.holiday) show(hd.dataset.holiday, e);
  });
  document.getElementById('cal-table').addEventListener('mousemove', e => {
    if (parseFloat(tip.style.opacity) > 0) move(e);
  });
  document.getElementById('cal-table').addEventListener('mouseout', e => {
    if (e.target.closest('.th-day.is-holiday')) hide();
  });
})();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "addEv", { configurable: true, get: () => addEv, set: (v) => { addEv = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "buildChecklist", { configurable: true, get: () => buildChecklist, set: (v) => { buildChecklist = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "buildColorMap", { configurable: true, get: () => buildColorMap, set: (v) => { buildColorMap = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "buildEvents", { configurable: true, get: () => buildEvents, set: (v) => { buildEvents = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "buildOncall", { configurable: true, get: () => buildOncall, set: (v) => { buildOncall = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "cellHtml", { configurable: true, get: () => cellHtml, set: (v) => { cellHtml = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "changeMonth", { configurable: true, get: () => changeMonth, set: (v) => { changeMonth = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "chipHtml", { configurable: true, get: () => chipHtml, set: (v) => { chipHtml = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "clearDay", { configurable: true, get: () => clearDay, set: (v) => { clearDay = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeCellModal", { configurable: true, get: () => closeCellModal, set: (v) => { closeCellModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeHolModal", { configurable: true, get: () => closeHolModal, set: (v) => { closeHolModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "daysBetween", { configurable: true, get: () => daysBetween, set: (v) => { daysBetween = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "deleteHolFromBtn", { configurable: true, get: () => deleteHolFromBtn, set: (v) => { deleteHolFromBtn = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "deleteHoliday", { configurable: true, get: () => deleteHoliday, set: (v) => { deleteHoliday = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtDT", { configurable: true, get: () => fmtDT, set: (v) => { fmtDT = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtDate", { configurable: true, get: () => fmtDate, set: (v) => { fmtDate = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "getThaiHolidays", { configurable: true, get: () => getThaiHolidays, set: (v) => { getThaiHolidays = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "goToday", { configurable: true, get: () => goToday, set: (v) => { goToday = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "hexToRgba", { configurable: true, get: () => hexToRgba, set: (v) => { hexToRgba = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "isOnLeaveDate", { configurable: true, get: () => isOnLeaveDate, set: (v) => { isOnLeaveDate = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "leaveDayCount", { configurable: true, get: () => leaveDayCount, set: (v) => { leaveDayCount = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadAll", { configurable: true, get: () => loadAll, set: (v) => { loadAll = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadFullYearSchedule", { configurable: true, get: () => loadFullYearSchedule, set: (v) => { loadFullYearSchedule = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadHolidays", { configurable: true, get: () => loadHolidays, set: (v) => { loadHolidays = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadLeaves", { configurable: true, get: () => loadLeaves, set: (v) => { loadLeaves = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadQuotas", { configurable: true, get: () => loadQuotas, set: (v) => { loadQuotas = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadSchedule", { configurable: true, get: () => loadSchedule, set: (v) => { loadSchedule = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadUserColors", { configurable: true, get: () => loadUserColors, set: (v) => { loadUserColors = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadUsers", { configurable: true, get: () => loadUsers, set: (v) => { loadUsers = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "markColorDirty", { configurable: true, get: () => markColorDirty, set: (v) => { markColorDirty = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "markQuotaDirty", { configurable: true, get: () => markQuotaDirty, set: (v) => { markQuotaDirty = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openCellModal", { configurable: true, get: () => openCellModal, set: (v) => { openCellModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openHolModal", { configurable: true, get: () => openHolModal, set: (v) => { openHolModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openHolModalFromBtn", { configurable: true, get: () => openHolModalFromBtn, set: (v) => { openHolModalFromBtn = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "previewColor", { configurable: true, get: () => previewColor, set: (v) => { previewColor = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "refreshEvents", { configurable: true, get: () => refreshEvents, set: (v) => { refreshEvents = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderCalendar", { configurable: true, get: () => renderCalendar, set: (v) => { renderCalendar = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderChips", { configurable: true, get: () => renderChips, set: (v) => { renderChips = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderColorSettings", { configurable: true, get: () => renderColorSettings, set: (v) => { renderColorSettings = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderHolidays", { configurable: true, get: () => renderHolidays, set: (v) => { renderHolidays = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderQuotas", { configurable: true, get: () => renderQuotas, set: (v) => { renderQuotas = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderStats", { configurable: true, get: () => renderStats, set: (v) => { renderStats = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "resetColor", { configurable: true, get: () => resetColor, set: (v) => { resetColor = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "rmEv", { configurable: true, get: () => rmEv, set: (v) => { rmEv = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "saveAllColors", { configurable: true, get: () => saveAllColors, set: (v) => { saveAllColors = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "saveAllQuotas", { configurable: true, get: () => saveAllQuotas, set: (v) => { saveAllQuotas = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "saveCellModal", { configurable: true, get: () => saveCellModal, set: (v) => { saveCellModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "saveHoliday", { configurable: true, get: () => saveHoliday, set: (v) => { saveHoliday = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "selectOncallPerson", { configurable: true, get: () => selectOncallPerson, set: (v) => { selectOncallPerson = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "ucolor", { configurable: true, get: () => ucolor, set: (v) => { ucolor = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "uname", { configurable: true, get: () => uname, set: (v) => { uname = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updateConflict", { configurable: true, get: () => updateConflict, set: (v) => { updateConflict = v; } }); } catch (e) {}
})();
