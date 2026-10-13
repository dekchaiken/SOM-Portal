// schedule — page script, extracted from schedule.html.
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
Layout.render('schedule');
trackScheduleView('main');

// ── Inject skeleton shimmer into tables while data loads ─────────────────────
(function paintSkeletons(){
  const fades = ['skel-fade-1','skel-fade-2','skel-fade-3','skel-fade-4','skel-fade-5','skel-fade-6'];
  const now = new Date();
  const daysThisMonth = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();

  const cal = document.getElementById('cal-body');
  if (cal && !cal.children.length) {
    let h = '';
    for (let r = 0; r < 8; r++) {
      const f = fades[Math.min(r, fades.length-1)];
      h += `<tr class="${f}"><td class="col-label" style="padding:8px 10px"><div class="skel" style="width:78%;height:11px;border-radius:4px"></div></td>`;
      for (let c = 0; c < daysThisMonth; c++) {
        h += `<td style="padding:6px 3px"><div class="skel" style="width:100%;height:22px;border-radius:4px"></div></td>`;
      }
      h += '</tr>';
    }
    cal.innerHTML = h;
  }

  const stats = document.getElementById('stats-body');
  if (stats && !stats.children.length) {
    let h = '';
    for (let r = 0; r < 6; r++) {
      const f = fades[Math.min(r, fades.length-1)];
      h += `<tr class="${f}"><td style="padding:10px 12px"><div class="skel" style="width:60%;height:11px;border-radius:4px"></div></td>`;
      for (let c = 0; c < 8; c++) {
        h += `<td style="padding:10px 12px;text-align:center"><div class="skel" style="width:28px;height:11px;border-radius:4px;display:inline-block"></div></td>`;
      }
      h += '</tr>';
    }
    stats.innerHTML = h;
  }

  const vac = document.getElementById('vac-summary-body');
  if (vac && !vac.children.length) {
    let h = '';
    for (let r = 0; r < 5; r++) {
      const f = fades[Math.min(r, fades.length-1)];
      h += `<tr class="${f}"><td style="padding:10px 12px"><div class="skel" style="width:60%;height:11px;border-radius:4px"></div>`
        + `</td><td style="padding:10px 12px;text-align:center"><div class="skel" style="width:28px;height:11px;border-radius:4px;display:inline-block"></div>`
        + `</td><td style="padding:10px 12px;text-align:center"><div class="skel" style="width:28px;height:11px;border-radius:4px;display:inline-block"></div>`
        + `</td><td style="padding:10px 12px;text-align:center"><div class="skel" style="width:28px;height:11px;border-radius:4px;display:inline-block"></div>`
        + `</td></tr>`;
    }
    vac.innerHTML = h;
  }

  const hp = document.getElementById('hp-tbody');
  if (hp && !hp.children.length) {
    let h = '';
    for (let r = 0; r < 6; r++) {
      const f = fades[Math.min(r, fades.length-1)];
      h += `<tr class="${f}"><td style="padding:8px 10px"><div class="skel" style="width:70%;height:11px;border-radius:4px"></div></td>`;
      for (let c = 0; c < daysThisMonth; c++) {
        h += `<td style="padding:6px 3px"><div class="skel" style="width:100%;height:18px;border-radius:4px"></div></td>`;
      }
      h += '</tr>';
    }
    hp.innerHTML = h;
  }
})();

// ── Config ───────────────────────────────────────────────────────────────────
const CHIP_COLORS = [
  ['#f26419','rgba(242,100,25,.16)'],
  ['#3b82f6','rgba(59,130,246,.16)'],
  ['#22c55e','rgba(34,197,94,.16)'],
  ['#f59e0b','rgba(245,158,11,.16)'],
  ['#8b5cf6','rgba(139,92,246,.16)'],
  ['#ec4899','rgba(236,72,153,.16)'],
  ['#14b8a6','rgba(20,184,166,.16)'],
  ['#ef4444','rgba(239,68,68,.16)'],
  ['#06b6d4','rgba(6,182,212,.16)'],
  ['#a855f7','rgba(168,85,247,.16)'],
  ['#84cc16','rgba(132,204,22,.16)'],
  ['#f97316','rgba(249,115,22,.16)'],
  ['#10b981','rgba(16,185,129,.16)'],
  ['#6366f1','rgba(99,102,241,.16)'],
  ['#64748b','rgba(100,116,139,.16)'],
];

const ROWS = [
  { id:'s1hd',   type:'section', label:'Shift#1', time:'09:00–21:00', color:'#f26419' },
  { id:'s1tdpk', type:'members', label:'TDPK',     slot:'shift1_tdpk', cls:'row-lbl' },
  { id:'s1wah',  type:'members', label:'W@H',      slot:'shift1_wah',  cls:'row-lbl' },
  { id:'s1oc',   type:'oncall',  label:'On Call',  slot:'shift1_oncall',cls:'row-lbl oncall-lbl' },
  { id:'s2hd',   type:'section', label:'Shift#2',  time:'21:00–09:00', color:'#8b5cf6' },
  { id:'s2wah',  type:'members', label:'W@H',      slot:'shift2_wah',  cls:'row-lbl' },
  { id:'s2oc',   type:'oncall',  label:'On Call',  slot:'shift2_oncall',cls:'row-lbl oncall-lbl' },
  { id:'spacer', type:'spacer' }, // Spacer row
  { id:'vac',    type:'members', label:'Vacation',       slot:'vacation',       cls:'row-lbl vac-lbl' },
  { id:'sick',   type:'members', label:'Sick Leave',     slot:'sick',           cls:'row-lbl sick-lbl' },
  { id:'biz',    type:'members', label:'Business Leave', slot:'business_leave', cls:'row-lbl biz-lbl' },
  { id:'evt',    type:'events',  label:'Event',          slot:'events',         cls:'row-lbl event-lbl' },
];

const DAY_TH = ['อา','จ','อ','พ','พฤ','ศ','ส'];
const MONTH_TH = ['','ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const MONTH_FULL = ['','มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
                    'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];

let curYear  = new Date().getFullYear();
let curMonth = new Date().getMonth() + 1;
let scheduleData = {};
let fullYearScheduleData = {}; // all months of curYear, for accurate quota calculation
let _fullYearLoadedFor = null;
let usersData    = [];
let leaveData    = [];
let holidayData  = [];
let quotaData    = {};
let userColorsData = {};
let leaveType    = 'vacation';
let userQuotaData = null;
let myDaysOnly   = false;
let statsExportRows = [];

// ── Leave Calendar State ─────────────────────────────────────────────────────
let selectedDates = [];
let calViewYear   = new Date().getFullYear();
let calViewMonth  = new Date().getMonth() + 1;

// ── Color helpers ────────────────────────────────────────────────────────────
const _colorMap = {};

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function userColor(uid) {
  if (!_colorMap[uid]) {
    const idx = Object.keys(_colorMap).length % CHIP_COLORS.length;
    _colorMap[uid] = CHIP_COLORS[idx];
  }
  // Override with custom color if set
  const custom = userColorsData[uid];
  if (custom) return [custom, hexToRgba(custom, .16)];
  return _colorMap[uid];
}

function chipHtml(uid, name) {
  const [fc, bg] = userColor(uid);
  return `<span class="m-chip" style="color:#1c1c1e;background:${bg};border-color:${fc}44">${esc(name)}</span>`;
}

// Get display name from ID (nickname → first word → full name)
function userName(uid) {
  const u = usersData.find(x => x.id === uid);
  if (!u) return uid;
  return u.nickname || u.name.split(' ')[0] || u.name;
}

// Build color map from users list order (consistent colors)
function buildColorMap(users) {
  users.forEach((u, i) => {
    _colorMap[u.id] = CHIP_COLORS[i % CHIP_COLORS.length];
  });
}

// ── Holidays from API (holidayData) ──────────────────────────────────────────
function getThaiHolidays(year) {
  const h = new Map();
  const prefix = `${year}-`;
  (holidayData || []).forEach(hol => {
    if (hol.date && hol.date.startsWith(prefix)) h.set(hol.date, hol.name);
  });
  return h;
}

// ── Calendar render ──────────────────────────────────────────────────────────
function renderCalendar() {
  const today  = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const daysInMonth = new Date(curYear, curMonth, 0).getDate();

  document.getElementById('month-title').textContent =
    `${MONTH_FULL[curMonth]} ${curYear + 543}`;
  document.getElementById('stats-month-label').textContent =
    `${MONTH_TH[curMonth]} ${curYear + 543}`;

  // ── Header row ──
  const holidays = getThaiHolidays(curYear);
  const head = document.getElementById('cal-head');
  head.innerHTML = '';
  const trHead = document.createElement('tr');

  const thLabel = document.createElement('th');
  thLabel.className = 'th-day th-day-label col-label';
  thLabel.style.cssText = 'padding:10px 12px;font-size:9px;letter-spacing:.08em;color:rgba(255,255,255,.3)';
  thLabel.textContent = 'SECTION / ROW';
  trHead.appendChild(thLabel);

  for (let d = 1; d <= daysInMonth; d++) {
    const date   = new Date(curYear, curMonth - 1, d);
    const dow    = date.getDay();
    const dateStr = `${curYear}-${String(curMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday   = dateStr === todayStr;
    const isWeekend = dow === 0 || dow === 6;

    const dateStr2 = `${curYear}-${String(curMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const holidayName = holidays.get(dateStr2);
    const isHoliday = !!holidayName && !isToday;

    const th = document.createElement('th');
    th.className = 'th-day' + (isToday ? ' today' : '') + (isWeekend ? ' weekend' : '') + (isHoliday ? ' holiday' : '');
    th.dataset.date = dateStr;
    if (holidayName) th.dataset.holiday = holidayName;
    th.innerHTML = `<span style="display:block;font-size:8px;opacity:.5">${DAY_TH[dow]}</span>
      <span class="day-num">${d}</span>
      ${isToday ? `<div class="th-day-underline" style="background:var(--orange)"></div>` : ''}`;
    trHead.appendChild(th);
  }
  head.appendChild(trHead);

  // ── Body rows ──
  const body = document.getElementById('cal-body');
  body.innerHTML = '';

  let currentShiftCls = '';
  ROWS.forEach(row => {
    const tr = document.createElement('tr');

    if (row.type === 'section') {
      currentShiftCls = row.id.startsWith('s1') ? 'row-shift1' : row.id.startsWith('s2') ? 'row-shift2' : '';
      tr.className = `row-section ${currentShiftCls}`;
      const tdLabel = document.createElement('td');
      tdLabel.className = 'col-label';
      tdLabel.innerHTML = `<div class="section-label" style="color:${row.color}">
        <div class="sl-dot" style="background:${row.color}"></div>
        ${row.label} <span class="sl-time">${row.time}</span>
      </div>`;
      tr.appendChild(tdLabel);

      for (let d = 1; d <= daysInMonth; d++) {
        const td = document.createElement('td');
        td.dataset.date = `${curYear}-${String(curMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        td.innerHTML = `<div class="section-fill">—</div>`;
        tr.appendChild(td);
      }
      body.appendChild(tr);
      return;
    }

    // Spacer row (visual separator)
    if (row.type === 'spacer') {
      tr.className = 'row-spacer';
      const tdLabel = document.createElement('td');
      tdLabel.className = 'col-label';
      tr.appendChild(tdLabel);
      for (let d = 1; d <= daysInMonth; d++) {
        const td = document.createElement('td');
        td.dataset.date = `${curYear}-${String(curMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        tr.appendChild(td);
      }
      body.appendChild(tr);
      return;
    }

    // Data row
    if (currentShiftCls) tr.className = currentShiftCls;
    const tdLabel = document.createElement('td');
    tdLabel.className = `col-label ${row.cls || 'row-lbl'}`;
    tdLabel.textContent = row.label;
    tr.appendChild(tdLabel);

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${curYear}-${String(curMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const date    = new Date(curYear, curMonth - 1, d);
      const dow     = date.getDay();
      const isToday   = dateStr === todayStr;
      const isWeekend = dow === 0 || dow === 6;
      const entry   = scheduleData[dateStr] || {};

      const isHolidayCol = holidays.has(dateStr) && !isToday;
      const td = document.createElement('td');
      td.dataset.date = dateStr;
      td.className = 'cal-cell' +
        (isToday      ? ' today-col'   : '') +
        (isWeekend    ? ' weekend-col' : '') +
        (isHolidayCol ? ' holiday-col' : '') +
        (row.type === 'oncall' ? ' oncall-cell' : '') +
        (row.type === 'events' ? ' event-cell'  : '');

      td.innerHTML = cellContent(row, entry);
      tr.appendChild(td);
    }

    body.appendChild(tr);
  });

  applyMyDaysFilter();
  renderStats();
  renderVacationSummary();
  renderSummary();
}

// ── "Only my days" filter ────────────────────────────────────────────────────
function getMyDateSet() {
  const myId = Auth.getUser()?.id;
  const dates = new Set();
  if (!myId) return dates;
  const slots = ['shift1_tdpk','shift1_wah','shift2_wah','vacation','sick','business_leave'];
  Object.entries(scheduleData).forEach(([date, entry]) => {
    if (entry.shift1_oncall === myId) dates.add(date);
    slots.forEach(slot => {
      (entry[slot] || []).forEach(raw => {
        const id = typeof raw === 'object' ? raw.user_id : raw;
        if (id === myId) dates.add(date);
      });
    });
  });
  return dates;
}
function applyMyDaysFilter() {
  const table = document.getElementById('cal-table');
  const btn   = document.getElementById('my-days-btn');
  const countEl = document.getElementById('my-days-count');
  if (!table) return;
  const mine = getMyDateSet();
  // Tag cells with .my-day for current user's dates
  table.querySelectorAll('[data-date]').forEach(el => {
    el.classList.toggle('my-day', mine.has(el.dataset.date));
  });
  table.classList.toggle('only-mine', myDaysOnly);
  if (btn) btn.classList.toggle('active', myDaysOnly);
  if (countEl) countEl.textContent = myDaysOnly ? ` (${mine.size} วัน)` : '';
}
function toggleMyDays() {
  myDaysOnly = !myDaysOnly;
  applyMyDaysFilter();
}

// ── Export "my days" of current month to iCalendar (.ics) ────────────────────
async function exportMyScheduleICS() {
  const me = Auth.getUser();
  const myId = me?.id;
  if (!myId) { await SOMDialog.alert('กรุณาเข้าสู่ระบบก่อน', { title: 'แจ้งเตือน', icon: 'warning' }); return; }

  const monthPrefix = `${curYear}-${String(curMonth).padStart(2,'0')}`;
  const events = [];

  // Slot → event metadata (title, start hour, end hour, +days for end, allDay, location)
  const SHIFT_META = {
    shift1_tdpk:   { title:'Shift#1 @TDPK',    sh:9,  eh:21, endDayOffset:0, location:'TDPK' },
    shift1_wah:    { title:'Shift#1 W@H',      sh:9,  eh:21, endDayOffset:0, location:'W@H'  },
    shift1_oncall: { title:'Shift#1 On Call',  sh:9,  eh:21, endDayOffset:0, location:'On Call' },
    shift2_wah:    { title:'Shift#2 W@H (กลางคืน)', sh:21, eh:9, endDayOffset:1, location:'W@H' },
    shift2_oncall: { title:'Shift#2 On Call (กลางคืน)', sh:21, eh:9, endDayOffset:1, location:'On Call' },
  };
  const LEAVE_META = {
    vacation:       { title:'Vacation' },
    sick:           { title:'Sick Leave' },
    business_leave: { title:'Business Leave' },
  };

  // Helper: entry slot value → array of user IDs (handles scalar, array, {user_id} shape)
  const idsOf = v => {
    if (v == null || v === '') return [];
    const arr = Array.isArray(v) ? v : [v];
    return arr.map(x => (x && typeof x === 'object') ? x.user_id : x).filter(Boolean);
  };

  Object.entries(scheduleData).forEach(([date, entry]) => {
    if (!date.startsWith(monthPrefix)) return;

    // Shifts (timed events)
    Object.entries(SHIFT_META).forEach(([slot, meta]) => {
      if (idsOf(entry[slot]).includes(myId)) {
        events.push({ date, slot, kind:'timed', meta });
      }
    });

    // Leaves (all-day)
    Object.entries(LEAVE_META).forEach(([slot, meta]) => {
      if (idsOf(entry[slot]).includes(myId)) {
        events.push({ date, slot, kind:'allday', meta });
      }
    });
  });

  if (!events.length) {
    await SOMDialog.alert(`ไม่พบตารางเวรของคุณในเดือน ${MONTH_FULL[curMonth]} ${curYear}`, { title: 'แจ้งเตือน', icon: 'info' });
    return;
  }

  // ── ICS builders ──────────────────────────────────────────────────────────
  const pad = n => String(n).padStart(2,'0');
  const escICS = s => String(s).replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\n/g,'\\n');
  // Fold long lines at 74 chars per RFC 5545 (leading space on continuation)
  const fold = line => {
    if (line.length <= 74) return line;
    const parts = [];
    let i = 0;
    parts.push(line.slice(0, 74));
    i = 74;
    while (i < line.length) { parts.push(' ' + line.slice(i, i + 73)); i += 73; }
    return parts.join('\r\n');
  };

  const now = new Date();
  const dtstamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth()+1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;

  const addDays = (yyyyMmDd, n) => {
    const [y,m,d] = yyyyMmDd.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m-1, d));
    dt.setUTCDate(dt.getUTCDate() + n);
    return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth()+1)}${pad(dt.getUTCDate())}`;
  };
  const ymd = yyyyMmDd => yyyyMmDd.replaceAll('-','');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SOM Portal//Schedule Export//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:SOM Schedule — ${MONTH_FULL[curMonth]} ${curYear}`,
    'X-WR-TIMEZONE:Asia/Bangkok',
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Bangkok',
    'X-LIC-LOCATION:Asia/Bangkok',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0700',
    'TZOFFSETTO:+0700',
    'TZNAME:+07',
    'END:STANDARD',
    'END:VTIMEZONE',
  ];

  events.forEach(ev => {
    const uid = `${ev.date}-${ev.slot}-${myId}@som-portal`;
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(fold(`SUMMARY:${escICS(ev.meta.title)}`));

    if (ev.kind === 'allday') {
      lines.push(`DTSTART;VALUE=DATE:${ymd(ev.date)}`);
      lines.push(`DTEND;VALUE=DATE:${addDays(ev.date, 1)}`); // exclusive
      lines.push('TRANSP:TRANSPARENT');
    } else {
      const startStr = `${ymd(ev.date)}T${pad(ev.meta.sh)}0000`;
      const endDate  = ev.meta.endDayOffset ? addDays(ev.date, ev.meta.endDayOffset) : ymd(ev.date);
      const endStr   = `${endDate}T${pad(ev.meta.eh)}0000`;
      lines.push(`DTSTART;TZID=Asia/Bangkok:${startStr}`);
      lines.push(`DTEND;TZID=Asia/Bangkok:${endStr}`);
      lines.push('TRANSP:OPAQUE');
      if (ev.meta.location) lines.push(fold(`LOCATION:${escICS(ev.meta.location)}`));
    }

    lines.push(fold(`DESCRIPTION:${escICS(`SOM Portal • slot=${ev.slot} • ${userName(myId)}`)}`));
    lines.push('END:VEVENT');
  });

  lines.push('END:VCALENDAR');

  const ics = lines.join('\r\n') + '\r\n';
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `som-schedule-${monthPrefix}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function cellContent(row, entry) {
  if (row.type === 'members') {
    const ids = entry[row.slot] || [];
    if (!ids.length) return '';
    return `<div class="m-chips">${ids.map(e => { const uid = typeof e === 'object' ? e.user_id : e; return chipHtml(uid, userName(uid)); }).join('')}</div>`;
  }
  if (row.type === 'oncall') {
    const val = entry[row.slot] || '';
    return val ? `<span class="oncall-val">${esc(userName(val))}</span>` : '';
  }
  if (row.type === 'events') {
    const arr = entry[row.slot] || [];
    return arr.map(e => `<div class="event-txt" data-full="${esc(e)}">${esc(e)}</div>`).join('');
  }
  return '';
}

// ── Stats ────────────────────────────────────────────────────────────────────
function daysBetween(a, b) {
  return Math.max(1, Math.round((new Date(b) - new Date(a)) / 86400000) + 1);
}
function leaveDayCount(l) {
  if (l.dates && Array.isArray(l.dates)) return l.dates.length;
  return daysBetween(l.start_date, l.end_date);
}

function renderStats() {
  // Monthly counts: shifts from scheduleData + approved leave requests within this month
  const counts = {};
  const monthStr = `${curYear}-${String(curMonth).padStart(2,'0')}`;
  const typeKey = { vacation: 'vac', sick: 'sick', business: 'biz' };
  // Dates already counted from leave requests, per user+type — used to dedup schedule entries
  const leaveCovered = {};
  const ensure = id => { if (!counts[id]) counts[id] = { tdpk:0, wah1:0, wah2:0, vac:0, sick:0, biz:0 }; };

  leaveData.forEach(l => {
    if (l.status !== 'approved' || !(l.type in typeKey)) return;
    let dates = [];
    if (l.dates?.length) dates = l.dates.slice();
    else if (l.start_date && l.end_date) {
      for (let d = new Date(l.start_date); d <= new Date(l.end_date); d.setDate(d.getDate()+1))
        dates.push(d.toISOString().slice(0,10));
    }
    const monthDates = dates.filter(d => d.startsWith(monthStr));
    if (!monthDates.length) return;
    ensure(l.user_id);
    if (!leaveCovered[l.user_id]) leaveCovered[l.user_id] = { vacation:new Set(), sick:new Set(), business:new Set() };
    monthDates.forEach(d => leaveCovered[l.user_id][l.type].add(d));
    counts[l.user_id][typeKey[l.type]] += monthDates.length;
  });

  Object.entries(scheduleData).forEach(([date, entry]) => {
    const slots = {
      tdpk: { arr: entry.shift1_tdpk    || [], leaveType: null },
      wah1: { arr: entry.shift1_wah     || [], leaveType: null },
      wah2: { arr: entry.shift2_wah     || [], leaveType: null },
      vac:  { arr: entry.vacation       || [], leaveType: 'vacation' },
      sick: { arr: entry.sick           || [], leaveType: 'sick' },
      biz:  { arr: entry.business_leave || [], leaveType: 'business' },
    };
    Object.entries(slots).forEach(([key, { arr, leaveType }]) => {
      arr.forEach(raw => {
        const id = typeof raw === 'object' ? raw.user_id : raw;
        ensure(id);
        if (leaveType && leaveCovered[id]?.[leaveType]?.has(date)) return;
        counts[id][key]++;
      });
    });
  });

  const tbody = document.getElementById('stats-body');
  if (!usersData.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--text-muted);font-size:12px">ยังไม่มีข้อมูลตารางเวร</td></tr>';
    return;
  }

  // Show ALL users (init zero if no schedule entry yet)
  usersData.forEach(u => {
    if (!counts[u.id]) counts[u.id] = { tdpk:0, wah1:0, wah2:0, vac:0, sick:0, biz:0 };
  });

  // Sort: most shifts first, then by name
  const sorted = [...usersData].sort((a, b) => {
    const ca = counts[a.id], cb = counts[b.id];
    const ta = ca.tdpk + ca.wah1 + ca.wah2;
    const tb = cb.tdpk + cb.wah1 + cb.wah2;
    return tb - ta || a.name.localeCompare(b.name, 'th');
  });

  statsExportRows = [];
  tbody.innerHTML = sorted.map(u => {
    const c     = counts[u.id];
    const total = c.tdpk + c.wah1 + c.wah2;
    const [fc]  = userColor(u.id);

    // Remaining vacation for the year — mirrors renderVacationSummary / getHpRem
    const quota = parseFloat(quotaData[u.id] ?? 0);
    const yearStr = String(curYear);
    const covStat = new Set();
    const usedVac = leaveData
      .filter(l => l.user_id === u.id && l.status === 'approved' && l.type === 'vacation')
      .reduce((sum, l) => {
        let yearDates = [];
        if (l.dates?.length) {
          yearDates = l.dates.filter(d => d.startsWith(yearStr));
        } else if (l.start_date && l.end_date) {
          for (let d = new Date(l.start_date); d <= new Date(l.end_date); d.setDate(d.getDate()+1)) {
            const ds = d.toISOString().slice(0,10);
            if (ds.startsWith(yearStr)) yearDates.push(ds);
          }
        }
        yearDates.forEach(d => covStat.add(d));
        if (!yearDates.length) return sum;
        return sum + (l.duration === 'half' ? yearDates.length * 0.5 : yearDates.length);
      }, 0);
    const extraStat = Object.entries(fullYearScheduleData).reduce((sum, [date, day]) => {
      if (!date.startsWith(yearStr) || covStat.has(date)) return sum;
      return sum + (day.vacation || []).reduce((s, v) =>
        s + (typeof v === 'object' && v.user_id === u.id ? (v.days||1) : v === u.id ? 1 : 0), 0);
    }, 0);
    const remaining  = quota - usedVac - extraStat;
    const remDisplay = remaining % 1 === 0 ? remaining : remaining.toFixed(1);
    const remColor   = remaining < 0 ? '#ef4444' : remaining <= 3 ? '#f97316' : '#22c55e';
    const remBg      = remaining < 0 ? 'rgba(239,68,68,.12)' : remaining <= 3 ? 'rgba(249,115,22,.12)' : 'rgba(34,197,94,.12)';

    statsExportRows.push({
      name: u.name || '',
      nickname: u.nickname || '',
      tdpk: c.tdpk, wah1: c.wah1, wah2: c.wah2, total,
      vac: c.vac, sick: c.sick, biz: c.biz,
      remaining: quota > 0 ? remaining : null,
      quota: quota > 0 ? quota : null,
    });

    return `<tr>
      <td style="padding:12px 16px">
        <div style="display:flex;align-items:center;gap:9px">
          <div style="width:8px;height:8px;border-radius:50%;background:${fc};flex-shrink:0"></div>
          <span style="font-weight:700;color:var(--text)">${esc(u.nickname || u.name.split(' ')[0] || u.name)}</span>
          ${u.nickname ? `<span style="font-size:10px;color:var(--text-muted);font-weight:400">${esc(u.name)}</span>` : ''}
        </div>
      </td>
      <td class="num"><span class="stat-badge" style="background:rgba(242,100,25,.12);color:var(--orange)">${c.tdpk}</span></td>
      <td class="num"><span class="stat-badge" style="background:rgba(59,130,246,.12);color:#3b82f6">${c.wah1}</span></td>
      <td class="num"><span class="stat-badge" style="background:rgba(139,92,246,.12);color:#8b5cf6">${c.wah2}</span></td>
      <td class="num"><span style="font-weight:800;color:var(--text);font-size:12px">${total}</span></td>
      <td class="num"><span class="stat-badge" style="background:rgba(34,197,94,.12);color:#22c55e">${c.vac}</span></td>
      <td class="num"><span class="stat-badge" style="background:rgba(239,68,68,.12);color:#ef4444">${c.sick}</span></td>
      <td class="num"><span class="stat-badge" style="background:rgba(124,58,237,.12);color:#7c3aed">${c.biz}</span></td>
      <td class="num">
        ${quota > 0
          ? `<span class="stat-badge" style="background:${remBg};color:${remColor}">${remDisplay}/${quota}</span>`
          : `<span style="font-size:10px;color:var(--text-muted)">—</span>`}
      </td>
    </tr>`;
  }).join('');
}

function exportStatsCSV() {
  if (!statsExportRows.length) {
    (window.toast || alert)('ยังไม่มีข้อมูลสถิติให้ export');
    return;
  }
  const monthLabel = `${MONTH_FULL[curMonth]} ${curYear + 543}`;
  const headers = [
    'ชื่อ', 'ชื่อเล่น',
    'Shift#1 TDPK', 'Shift#1 W@H', 'Shift#2 W@H', 'รวมเวร',
    'วันลา/หยุด (เดือนนี้)', 'ลาป่วย (เดือนนี้)', 'ลากิจ (เดือนนี้)',
    'วันลาพักร้อนคงเหลือ (ทั้งปี)', 'โควต้าทั้งปี'
  ];
  const csvEsc = v => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const fmtNum = v => {
    if (v === null || v === undefined) return '';
    return v % 1 === 0 ? String(v) : v.toFixed(1);
  };

  const dataRows = statsExportRows.map(r => [
    r.name, r.nickname,
    r.tdpk, r.wah1, r.wah2, r.total,
    r.vac, r.sick, r.biz,
    fmtNum(r.remaining), fmtNum(r.quota),
  ].map(csvEsc).join(','));

  const lines = [
    csvEsc(`สถิติรายบุคคล — ${monthLabel}`),
    '',
    headers.map(csvEsc).join(','),
    ...dataRows,
  ];
  const csv = '﻿' + lines.join('\r\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `สถิติรายบุคคล-${MONTH_FULL[curMonth]}-${curYear + 543}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderSummary() {
  const daysInMonth = new Date(curYear, curMonth, 0).getDate();
  const today = new Date();
  let onLeaveToday = 0;
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const te = scheduleData[todayStr] || {};
  onLeaveToday = (te.vacation||[]).length + (te.sick||[]).length + (te.business_leave||[]).length;

  document.getElementById('sched-summary').innerHTML = `
    <div class="sum-chip">
      <span class="sum-chip-icon"><i data-icon="calendar"></i></span>
      <span><strong>${daysInMonth}</strong> วันในเดือน</span>
    </div>
    ${onLeaveToday > 0 ? `<div class="sum-chip" style="border-color:rgba(34,197,94,.3);background:rgba(34,197,94,.04)">
      <span class="sum-chip-icon"><i data-icon="umbrella-beach"></i></span>
      <span><strong>${onLeaveToday}</strong> คนลาวันนี้</span>
    </div>` : ''}
    <div class="sum-chip">
      <span class="sum-chip-icon"><i data-icon="clock"></i></span> Shift#1: <strong>09:00–21:00</strong>
    </div>
    <div class="sum-chip">
      <span class="sum-chip-icon"><i data-icon="moon"></i></span> Shift#2: <strong>21:00–09:00</strong>
    </div>
  `;
}

// ── Month navigation ─────────────────────────────────────────────────────────
function changeMonth(dir) {
  const prevYear = curYear;
  curMonth += dir;
  if (curMonth > 12) { curMonth = 1; curYear++; }
  if (curMonth < 1)  { curMonth = 12; curYear--; }
  loadSchedule();
  if (curYear !== prevYear) loadFullYearSchedule();
}
function goToday() {
  const prevYear = curYear;
  curYear  = new Date().getFullYear();
  curMonth = new Date().getMonth() + 1;
  loadSchedule();
  if (curYear !== prevYear) loadFullYearSchedule();
}

// ── Data loading ─────────────────────────────────────────────────────────────
async function loadSchedule() {
  const res = await API.schedule.get(curYear, curMonth);
  scheduleData = res?.ok ? (res.data.data || {}) : {};
  // keep fullYearScheduleData in sync for the current month
  Object.assign(fullYearScheduleData, scheduleData);
  renderCalendar();
}

async function loadFullYearSchedule() {
  if (_fullYearLoadedFor === curYear) return;
  _fullYearLoadedFor = curYear;
  fullYearScheduleData = {};
  const results = await Promise.all(
    Array.from({length: 12}, (_, i) => API.schedule.get(curYear, i + 1))
  );
  results.forEach(r => { if (r?.ok) Object.assign(fullYearScheduleData, r.data.data || {}); });
  renderStats();
  renderVacationSummary();
  try { HP.rerender(); } catch {}
}

async function loadUsers() {
  const res = await API.users.list();
  usersData = (res?.ok ? (res.data.data || []) : []).filter(u => u.schedule_include !== false);
  buildColorMap(usersData);
}

async function loadQuotas() {
  const res = await API.vacation.getQuotas();
  quotaData = res?.ok ? (res.data.data || {}) : {};
}

async function loadLeaves() {
  const res = await API.leave.list();
  leaveData = res?.ok ? (res.data.data || []) : [];
}

async function loadUserColors() {
  const res = await API.userColors.get();
  userColorsData = res?.ok ? (res.data.data || {}) : {};
}

async function loadHolidays() {
  const res = await API.holidays.list();
  holidayData = res?.ok ? (res.data.data || []) : [];
}

async function loadAll() {
  await Promise.all([loadUsers(), loadUserColors(), loadHolidays()]);
  await Promise.all([loadSchedule(), loadQuotas(), loadLeaves()]);
  renderStats();
  renderVacationSummary();
  // Load full year in background for accurate yearly quota
  loadFullYearSchedule();
}

// ── Leave Modal ──────────────────────────────────────────────────────────────

async function loadUserQuota() {
  const user = Auth.getUser();
  if (!user?.id) {
    console.log('No user ID found');
    return;
  }
  
  console.log('Loading quota for user:', user.id);
  const res = await API.vacation.getUserQuota(user.id);
  console.log('Quota response:', res);
  
  if (res?.ok && res.data?.data) {
    userQuotaData = res.data.data;
    console.log('User quota data:', userQuotaData);
  } else {
    console.error('Failed to load quota:', res);
  }
}

function calculateLeaveDays() {
  if (selectedDates.length === 0) return 0;
  const duration = document.querySelector('input[name="leave-duration"]:checked')?.value || 'full';
  return duration === 'half' ? selectedDates.length * 0.5 : selectedDates.length;
}

function updateQuotaDisplay() {
  console.log('updateQuotaDisplay called. leaveType:', leaveType, 'userQuotaData:', userQuotaData);
  
  const quotaDisplay = document.getElementById('quota-display');
  if (!quotaDisplay) {
    console.error('quota-display element not found!');
    return;
  }
  
  // Only show for vacation type
  if (leaveType !== 'vacation') {
    quotaDisplay.classList.add('hidden');
    document.getElementById('quota-warning').classList.remove('show');
    // Re-enable submit button for non-vacation leave types
    const submitBtn = document.getElementById('leave-submit-btn');
    submitBtn.disabled = false;
    submitBtn.style.opacity = '1';
    submitBtn.style.cursor = 'pointer';
    return;
  }
  
  if (!userQuotaData) {
    console.log('No quota data yet, hiding display');
    quotaDisplay.classList.add('hidden');
    return;
  }
  
  console.log('Showing quota display');
  quotaDisplay.classList.remove('hidden');
  
  const totalQuota = userQuotaData.total_quota || 0;
  const used = userQuotaData.used || 0;
  const remaining = userQuotaData.remaining || 0;
  const usingNow = calculateLeaveDays();
  const afterLeave = remaining - usingNow;
  
  console.log('Quota values:', { totalQuota, used, remaining, usingNow, afterLeave });
  
  // Update values
  document.getElementById('quota-remaining').textContent = `${remaining} วัน`;
  document.getElementById('quota-using').textContent = usingNow;
  document.getElementById('quota-after').textContent = afterLeave >= 0 ? afterLeave.toFixed(1) : '0';
  document.getElementById('quota-total').textContent = totalQuota;
  
  // Update progress bar
  const percentage = totalQuota > 0 ? (remaining / totalQuota) * 100 : 0;
  const progressBar = document.getElementById('quota-progress');
  progressBar.style.width = `${Math.max(0, percentage)}%`;
  
  // Update color based on remaining percentage
  progressBar.className = 'quota-progress-fill';
  if (percentage > 50) {
    progressBar.classList.add('green');
  } else if (percentage >= 20) {
    progressBar.classList.add('yellow');
  } else if (percentage > 0) {
    progressBar.classList.add('red');
  } else {
    progressBar.classList.add('gray');
  }
  
  // Show warning if insufficient quota
  const warningEl = document.getElementById('quota-warning');
  const submitBtn = document.getElementById('leave-submit-btn');
  
  if (remaining === 0) {
    console.log('No quota remaining');
    warningEl.classList.add('show');
    document.getElementById('quota-warning-text').textContent = 'คุณไม่มีวันลาพักร้อนคงเหลือ';
    submitBtn.disabled = true;
    submitBtn.style.opacity = '0.5';
    submitBtn.style.cursor = 'not-allowed';
  } else if (afterLeave < 0) {
    console.log('Insufficient quota');
    warningEl.classList.add('show');
    document.getElementById('quota-warning-text').textContent = 
      `วันลาพักร้อนคงเหลือไม่เพียงพอ (ต้องการ ${usingNow} วัน แต่เหลือเพียง ${remaining} วัน)`;
    submitBtn.disabled = true;
    submitBtn.style.opacity = '0.5';
    submitBtn.style.cursor = 'not-allowed';
  } else {
    console.log('Quota sufficient');
    warningEl.classList.remove('show');
    submitBtn.disabled = false;
    submitBtn.style.opacity = '1';
    submitBtn.style.cursor = 'pointer';
  }
}

async function openLeaveModal() {
  document.getElementById('leave-modal').classList.add('open');

  // Reset to "ขอลา" tab
  switchLeaveTab('request');

  // Init calendar to current month
  calViewYear  = new Date().getFullYear();
  calViewMonth = new Date().getMonth() + 1;
  selectedDates = [];
  renderLeaveCalendar();
  updateDurationOptions();

  loadMyLeaves();
  await loadUserQuota();
  updateQuotaDisplay();
}
function closeLeaveModal() { document.getElementById('leave-modal').classList.remove('open'); }
document.getElementById('leave-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('leave-modal')) closeLeaveModal();
});

// ── Tab switcher ─────────────────────────────────────────────────────────────
function switchLeaveTab(tab) {
  document.getElementById('lm-pane-request').style.display = tab === 'request' ? '' : 'none';
  document.getElementById('lm-pane-history').style.display = tab === 'history'  ? '' : 'none';
  document.getElementById('tab-request').classList.toggle('active', tab === 'request');
  document.getElementById('tab-history').classList.toggle('active', tab === 'history');
}

// ── Calendar render ──────────────────────────────────────────────────────────
function renderLeaveCalendar() {
  const el = document.getElementById('leave-calendar');
  if (!el) return;

  const daysInMonth  = new Date(calViewYear, calViewMonth, 0).getDate();
  const firstDow     = new Date(calViewYear, calViewMonth - 1, 1).getDay(); // 0=Sun
  const startOffset  = (firstDow + 6) % 7; // Mon-first
  const today        = new Date().toISOString().slice(0, 10);
  const pad          = n => String(n).padStart(2, '0');

  let grid = '';
  ['จ','อ','พ','พฤ','ศ','ส','อา'].forEach(d => { grid += `<div class="lc-dow">${d}</div>`; });

  for (let i = 0; i < startOffset; i++) grid += '<div class="lc-cell lc-empty"></div>';

  for (let d = 1; d <= daysInMonth; d++) {
    const ds  = `${calViewYear}-${pad(calViewMonth)}-${pad(d)}`;
    const sel = selectedDates.includes(ds);
    const cls = ['lc-cell'];
    if (sel)      cls.push('lc-selected');
    if (ds === today) cls.push('lc-today');
    grid += `<div class="${cls.join(' ')}" onclick="toggleDate('${ds}')">${d}</div>`;
  }

  // Selected pills
  let pillsHtml = '';
  if (selectedDates.length > 0) {
    const pills = [...selectedDates].sort().map(ds => {
      const [y, m, day] = ds.split('-');
      return `<span class="lc-pill">${parseInt(day)} ${MONTH_TH[parseInt(m)]}<button class="lc-pill-x" onclick="removeDate('${ds}')"><i data-icon="x"></i></button></span>`;
    }).join('');
    pillsHtml = `
      <div class="lc-summary">
        <span>เลือกแล้ว ${selectedDates.length} วัน</span>
        <button class="lc-summary-clear" onclick="clearDates()">ล้างทั้งหมด</button>
      </div>
      <div class="lc-selected-pills">${pills}</div>`;
  }

  el.innerHTML = `
    <div class="lc-header">
      <span class="lc-month-label">${MONTH_FULL[calViewMonth]} ${calViewYear + 543}</span>
      <div class="lc-nav">
        <button class="lc-nav-btn" onclick="calNav(-1)">‹</button>
        <button class="lc-nav-btn" onclick="calNav(1)">›</button>
      </div>
    </div>
    <div class="lc-grid">${grid}</div>
    ${pillsHtml}`;
}

function calNav(dir) {
  calViewMonth += dir;
  if (calViewMonth > 12) { calViewMonth = 1; calViewYear++; }
  if (calViewMonth < 1)  { calViewMonth = 12; calViewYear--; }
  renderLeaveCalendar();
}

function toggleDate(ds) {
  const idx = selectedDates.indexOf(ds);
  if (idx >= 0) selectedDates.splice(idx, 1);
  else          selectedDates.push(ds);
  selectedDates.sort();
  renderLeaveCalendar();
  updateDurationOptions();
  updateQuotaDisplay();
}

function removeDate(ds) {
  selectedDates = selectedDates.filter(d => d !== ds);
  renderLeaveCalendar();
  updateDurationOptions();
  updateQuotaDisplay();
}

function clearDates() {
  selectedDates = [];
  renderLeaveCalendar();
  updateDurationOptions();
  updateQuotaDisplay();
}

function updateDurationOptions() {
  const count      = selectedDates.length;
  const halfLabel  = document.getElementById('half-day-label');
  const halfRadio  = document.getElementById('half-radio');
  const fullRadio  = document.querySelector('input[name="leave-duration"][value="full"]');

  if (count > 1) {
    // Multi-day: hide half option, force full
    if (halfLabel) halfLabel.style.display = 'none';
    if (halfRadio && halfRadio.checked) {
      halfRadio.checked = false;
      if (fullRadio) fullRadio.checked = true;
      document.getElementById('half-day-opts').style.display = 'none';
    }
  } else {
    if (halfLabel) halfLabel.style.display = '';
  }
}

function setLeaveType(type) {
  leaveType = type;
  document.getElementById('ltype-vacation').classList.toggle('active', type === 'vacation');
  document.getElementById('ltype-sick').classList.toggle('active', type === 'sick');
  document.getElementById('ltype-business').classList.toggle('active', type === 'business');
  updateQuotaDisplay();
}

function updateLeaveDisplay() {
  const isDuration = document.querySelector('input[name="leave-duration"]:checked').value;
  const halfDayOpts = document.getElementById('half-day-opts');
  halfDayOpts.style.display = isDuration === 'half' ? 'block' : 'none';
  updateQuotaDisplay();
}

async function submitLeave() {
  if (selectedDates.length === 0) { Toast.error('กรุณาเลือกวันที่อย่างน้อย 1 วัน'); return; }

  const sorted   = [...selectedDates].sort();
  const reason   = document.getElementById('f-reason').value.trim();
  const duration = document.querySelector('input[name="leave-duration"]:checked').value;
  const period   = duration === 'half' ? document.querySelector('input[name="half-period"]:checked').value : null;

  const btn = document.getElementById('leave-submit-btn');
  btn.disabled = true; btn.textContent = 'กำลังส่ง...';

  const res = await API.leave.submit({
    type:       leaveType,
    dates:      sorted,
    start_date: sorted[0],
    end_date:   sorted[sorted.length - 1],
    reason,
    duration,
    period
  });
  btn.disabled = false; btn.innerHTML = '<i data-icon="upload"></i> ส่งคำขอ';

  if (!res?.ok) { Toast.error(res?.data?.message || 'ส่งไม่ได้'); return; }
  trackLeaveRequest(leaveType);
  Toast.success('ส่งคำขอแล้ว รอ Admin อนุมัติ <i data-icon="check"></i>');
  selectedDates = [];
  document.getElementById('f-reason').value = '';
  renderLeaveCalendar();
  updateDurationOptions();
  loadMyLeaves();
}

function fmtLeaveDates(r) {
  if (r.dates && r.dates.length > 0) {
    const sorted = [...r.dates].sort();
    if (sorted.length === 1) return fmtDate(sorted[0]);
    // Check consecutive
    const isConsec = sorted.every((d, i) => {
      if (i === 0) return true;
      return (new Date(d) - new Date(sorted[i-1])) === 86400000;
    });
    if (isConsec) return `${fmtDate(sorted[0])} — ${fmtDate(sorted[sorted.length-1])}`;
    // Non-consecutive: show as pills summary
    return sorted.map(fmtDate).join(' · ');
  }
  if (!r.start_date) return '—';
  return r.start_date === r.end_date ? fmtDate(r.start_date) : `${fmtDate(r.start_date)} — ${fmtDate(r.end_date)}`;
}

async function loadMyLeaves() {
  const res = await API.leave.list();
  const allItems = res?.ok ? (res.data.data || []) : [];
  const currentUser = Auth.getUser();
  const items = allItems.filter(r => r.user_id === currentUser.id);

  // Update badge on history tab
  const pending = items.filter(r => r.status === 'pending').length;
  const badge = document.getElementById('leave-history-badge');
  if (badge) {
    badge.style.display = pending > 0 ? '' : 'none';
    badge.textContent   = pending;
  }

  const el = document.getElementById('my-leaves');
  if (!items.length) {
    el.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted);font-size:11px">ยังไม่มีคำขอลา</div>';
    return;
  }
  el.innerHTML = items.map(r => {
    const iconMap  = { vacation:'<i data-icon="umbrella-beach"></i>', sick:'<i data-icon="thermometer"></i>', business:'<i data-icon="briefcase"></i>' };
    const labelMap = { vacation:'Vacation', sick:'Sick Leave', business:'Business Leave' };
    const icon      = iconMap[r.type]  || '<i data-icon="clipboard"></i>';
    const typeLabel = labelMap[r.type] || r.type;
    const dayCount  = r.dates?.length || Math.max(1, Math.round((new Date(r.end_date) - new Date(r.start_date)) / 86400000) + 1);
    const days      = r.duration === 'half' ? dayCount * 0.5 : dayCount;
    const durBadge  = r.duration === 'half'
      ? `<span style="font-size:9px;padding:2px 6px;border-radius:4px;background:rgba(245,158,11,.12);color:#f59e0b;font-weight:700;margin-left:4px">${r.period === 'afternoon' ? 'บ่าย' : 'เช้า'}</span>`
      : '';
    const statusCls = { pending:'ls-pending', approved:'ls-approved', rejected:'ls-rejected' }[r.status] || '';
    const statusTh  = { pending:'รอพิจารณา', approved:'อนุมัติแล้ว', rejected:'ไม่อนุมัติ' }[r.status] || r.status;
    const isNonConsec = r.dates?.length > 1 && (() => {
      const s = [...r.dates].sort();
      return !s.every((d,i) => i===0 || (new Date(d)-new Date(s[i-1]))===86400000);
    })();
    return `<div class="leave-item" style="margin-bottom:8px">
      <div class="leave-item-icon">${icon}</div>
      <div class="leave-item-body">
        <div class="leave-item-title">${typeLabel} · ${days} วัน${durBadge}${isNonConsec ? ' <span style="font-size:9px;padding:2px 6px;border-radius:4px;background:rgba(99,102,241,.1);color:#6366f1;font-weight:700">สลับวัน</span>' : ''}</div>
        <div class="leave-item-dates">${fmtLeaveDates(r)}</div>
        ${r.reason ? `<div class="leave-item-reason">"${esc(r.reason)}"</div>` : ''}
        ${r.review_note ? `<div class="leave-item-reason" style="color:#ef4444">หมายเหตุ: ${esc(r.review_note)}</div>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
        <span class="leave-status ${statusCls}">${statusTh}</span>
        ${r.status === 'pending' ? `<button class="btn btn-ghost btn-sm" onclick="cancelLeave('${r.id}')" style="font-size:10px;color:#ef4444;border-color:rgba(239,68,68,.2)">ยกเลิก</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

async function cancelLeave(id) {
  if (!await SOMDialog.confirm('ยกเลิกคำขอนี้?', { title: 'ยืนยัน', okLabel: 'ยกเลิกคำขอ', icon: 'question', okColor: 'danger' })) return;
  const res = await API.leave.cancel(id);
  if (!res?.ok) { Toast.error('ยกเลิกไม่ได้'); return; }
  Toast.success('ยกเลิกแล้ว');
  loadMyLeaves();
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function esc(s) { return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function fmtDate(d) {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${parseInt(day)} ${MONTH_TH[parseInt(m)]} ${parseInt(y)+543}`;
}

// ── Export Calendar as PNG ───────────────────────────────────────────────────
async function exportCalendarImage() {
  const btn = event.target;
  btn.disabled = true;
  btn.textContent = '⏳ กำลังสร้าง...';

  try {
    if (!window.html2canvas) {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      document.head.appendChild(script);
      await new Promise((resolve, reject) => { script.onload = resolve; script.onerror = reject; });
    }

    const calTable = document.getElementById('cal-table');

    // ── Neutralize sticky positioning (root cause of skew in html2canvas) ──
    // sticky elements render at their "stuck" viewport position instead of
    // their natural table position, causing columns to appear shifted.
    const stickyEls = [];
    calTable.querySelectorAll('th, td').forEach(el => {
      const pos = window.getComputedStyle(el).position;
      if (pos === 'sticky') {
        stickyEls.push({ el, saved: el.style.position });
        el.style.position = 'relative';
      }
    });

    // ── Unlock ancestor overflow clipping ─────────────────────────────────
    const ancestorSave = [];
    let node = calTable.parentElement;
    while (node && node !== document.body) {
      const cs = window.getComputedStyle(node);
      if (cs.overflowX !== 'visible') {
        ancestorSave.push({ el: node, ox: node.style.overflowX, sl: node.scrollLeft });
        node.style.overflowX = 'visible';
        node.scrollLeft = 0;
      }
      node = node.parentElement;
    }

    // ── Measure after sticky removal so width is correct ──────────────────
    const fullW = calTable.scrollWidth;
    const fullH = calTable.scrollHeight;
    const savedTableWidth = calTable.style.width;
    calTable.style.width = fullW + 'px';

    const savedWin = { x: window.scrollX, y: window.scrollY };
    window.scrollTo(0, 0);

    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    const canvas = await html2canvas(calTable, {
      scale:           2,
      backgroundColor: '#ffffff',
      logging:         false,
      useCORS:         true,
      allowTaint:      true,
      scrollX:         0,
      scrollY:         0,
      width:           fullW,
      height:          fullH,
    });

    // ── Restore everything ────────────────────────────────────────────────
    stickyEls.forEach(({ el, saved }) => { el.style.position = saved; });
    calTable.style.width = savedTableWidth;
    ancestorSave.forEach(({ el, ox, sl }) => { el.style.overflowX = ox; el.scrollLeft = sl; });
    window.scrollTo(savedWin.x, savedWin.y);

    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href     = url;
      a.download = `schedule-${MONTH_FULL[curMonth]}-${curYear + 543}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      Toast.success('บันทึกรูปภาพเรียบร้อย <i data-icon="check"></i>');
    }, 'image/png', 1.0);

  } catch (err) {
    console.error('Export error:', err);
    Toast.error('ไม่สามารถสร้างรูปภาพได้');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i data-icon="camera"></i> Export PNG';
  }
}

loadAll();

// ── Event tooltip ────────────────────────────────────────────────────────────
(function () {
  const tip = document.createElement('div');
  tip.id = 'ev-tooltip';
  document.body.appendChild(tip);

  let hideTimer;

  function showTip(el, e) {
    clearTimeout(hideTimer);
    tip.textContent = el.dataset.full || el.dataset.holiday || el.textContent;
    tip.classList.add('show');
    moveTip(e);
  }

  function moveTip(e) {
    const pad = 12;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = e.clientX + pad, y = e.clientY + pad;
    if (x + tw > window.innerWidth  - pad) x = e.clientX - tw - pad;
    if (y + th > window.innerHeight - pad) y = e.clientY - th - pad;
    tip.style.left = x + 'px';
    tip.style.top  = y + 'px';
  }

  function hideTip() {
    hideTimer = setTimeout(() => tip.classList.remove('show'), 80);
  }

  const calTbl = document.getElementById('cal-table');
  if (calTbl) {
    calTbl.addEventListener('mouseover', e => {
      const ev = e.target.closest('.event-txt');
      if (ev) { showTip(ev, e); return; }
      const hd = e.target.closest('.th-day.holiday');
      if (hd) { showTip(hd, e); return; }
    });
    calTbl.addEventListener('mousemove', e => {
      if (tip.classList.contains('show')) moveTip(e);
    });
    calTbl.addEventListener('mouseout', e => {
      if (e.target.closest('.event-txt') || e.target.closest('.th-day.holiday')) hideTip();
    });
  }
})();

/* ══════════════════════════════════════════════════════
   Vacation Summary (annual)
══════════════════════════════════════════════════════ */
function renderVacationSummary() {
  document.getElementById('vac-summary-year').textContent = `ปี ${curYear + 543}`;
  const tbody = document.getElementById('vac-summary-body');
  if (!usersData.length) { tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--text-muted);font-size:12px">ยังไม่มีข้อมูลสมาชิก</td></tr>'; return; }

  tbody.innerHTML = usersData.map(u => {
    const quota = parseFloat(quotaData[u.id]) || 0;
    const yearStr = String(curYear);
    // Count from approved leave requests — only dates within curYear
    const coveredDates = new Set();
    const usedFromLeaves = leaveData
      .filter(l => l.user_id === u.id && l.status === 'approved' && l.type === 'vacation')
      .reduce((sum, l) => {
        let yearDates = [];
        if (l.dates?.length) {
          yearDates = l.dates.filter(d => d.startsWith(yearStr));
        } else if (l.start_date && l.end_date) {
          for (let d = new Date(l.start_date); d <= new Date(l.end_date); d.setDate(d.getDate()+1)) {
            const ds = d.toISOString().slice(0,10);
            if (ds.startsWith(yearStr)) yearDates.push(ds);
          }
        }
        yearDates.forEach(d => coveredDates.add(d));
        if (!yearDates.length) return sum;
        return sum + (l.duration === 'half' ? yearDates.length * 0.5 : yearDates.length);
      }, 0);
    // Add direct schedule entries (full year) not covered by leave requests
    const extraFromSchedule = Object.entries(fullYearScheduleData).reduce((sum, [date, day]) => {
      if (!date.startsWith(yearStr) || coveredDates.has(date)) return sum;
      return sum + (day.vacation || []).reduce((s, v) =>
        s + (typeof v === 'object' && v.user_id === u.id ? (v.days||1) : v === u.id ? 1 : 0), 0);
    }, 0);
    const used      = usedFromLeaves + extraFromSchedule;
    const remaining = quota - used;
    const [fc] = userColor(u.id);
    const usedDisp   = used % 1 === 0 ? used : used.toFixed(1);
    const remDisp    = remaining % 1 === 0 ? remaining : remaining.toFixed(1);
    const quotaDisp  = quota % 1 === 0 ? quota : quota.toFixed(1);
    const remColor   = remaining < 0 ? '#ef4444' : remaining <= 3 ? '#f97316' : '#22c55e';
    return `<tr>
      <td style="display:flex;align-items:center;gap:9px">
        <div style="width:8px;height:8px;border-radius:50%;background:${fc};flex-shrink:0"></div>
        <span style="font-weight:700;color:var(--text)">${esc(u.nickname||u.name.split(' ')[0]||u.name)}</span>
        ${u.nickname?`<span style="font-size:10px;color:var(--text-muted);font-weight:400">${esc(u.name)}</span>`:''}
      </td>
      <td class="c">${quota>0?`<span style="font-weight:700;color:var(--text)">${quotaDisp} วัน</span>`:'—'}</td>
      <td class="c">${quota>0?`<span style="font-weight:700;color:#f97316">${usedDisp} วัน</span>`:'—'}</td>
      <td class="c">${quota>0?`<span style="font-weight:800;color:${remColor}">${Math.max(0,parseFloat(remDisp))} วัน</span>`:'—'}</td>
    </tr>`;
  }).join('');
}

/* ══════════════════════════════════════════════════════
   Holiday Plans — embedded view
══════════════════════════════════════════════════════ */
const HP = (() => {
  const MTH = ['','มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
               'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  const DTH = ['อา','จ','อ','พ','พฤ','ศ','ส'];
  let hpY = new Date().getFullYear(), hpM = new Date().getMonth()+1;
  let hpPlans = {}, hpSel = {}, hpModalY, hpModalM;

  const p2 = n => String(n).padStart(2,'0');
  const ds = (y,m,d) => `${y}-${p2(m)}-${p2(d)}`;
  const isHol = date => (holidayData||[]).some(h=>h.date===date);
  const holName = date => (holidayData||[]).find(h=>h.date===date)?.name||'';

  function getHpRem(uid) {
    const q = parseFloat(quotaData[uid])||0; if (!q) return null;
    const yearStr = String(curYear);
    const cov = new Set();
    const usedFromLeaves = leaveData.filter(l=>l.user_id===uid&&l.status==='approved'&&l.type==='vacation')
      .reduce((s,l)=>{
        let yearDates=[];
        if (l.dates?.length) yearDates = l.dates.filter(d=>d.startsWith(yearStr));
        else if (l.start_date&&l.end_date) {
          for (let d=new Date(l.start_date);d<=new Date(l.end_date);d.setDate(d.getDate()+1)) {
            const ds=d.toISOString().slice(0,10);
            if (ds.startsWith(yearStr)) yearDates.push(ds);
          }
        }
        yearDates.forEach(d=>cov.add(d));
        if (!yearDates.length) return s;
        return s+(l.duration==='half'?yearDates.length*0.5:yearDates.length);
      },0);
    const extraFromSchedule = Object.entries(fullYearScheduleData).reduce((s,[date,day])=>{
      if (!date.startsWith(yearStr) || cov.has(date)) return s;
      return s+(day.vacation||[]).reduce((ss,v)=>
        ss+(typeof v==='object'&&v.user_id===uid?(v.days||1):v===uid?1:0),0);
    },0);
    const r=q-usedFromLeaves-extraFromSchedule; return r%1===0?r:parseFloat(r.toFixed(1));
  }

  async function loadRender() {
    const res=await API.holidayPlans.get(hpY,hpM);
    hpPlans=res?.ok?(res.data.data?.plans||{}):{};
    render();
  }

  function render() {
    const myId=Auth.getUser()?.id, dim=new Date(hpY,hpM,0).getDate();
    const todStr=ds(new Date().getFullYear(),new Date().getMonth()+1,new Date().getDate());
    document.getElementById('hp-month-title').textContent=`${MTH[hpM]} ${hpY+543}`;
    const planners=Object.keys(hpPlans).filter(id=>(hpPlans[id]||[]).length>0);
    document.getElementById('hp-stat-chip').textContent=`${planners.length}/${usersData.length} คนกรอกแล้ว`;

    let hd=`<tr><th class="hp-th-name">Name</th>`;
    for (let d=1;d<=dim;d++) {
      const date=ds(hpY,hpM,d), dw=new Date(hpY,hpM-1,d).getDay();
      let c='hp-th-day'; if(date===todStr)c+=' ht'; else if(isHol(date))c+=' hh'; else if(dw===0||dw===6)c+=' hw';
      hd+=`<th class="${c}" ${isHol(date)?`title="${esc(holName(date))}"`:''}><div>${p2(d)}</div><div style="font-size:8px;opacity:.7">${DTH[dw]}</div></th>`;
    }
    hd+=`<th class="hp-th-total">วันแผน</th></tr>`;
    document.getElementById('hp-thead').innerHTML=hd;

    document.getElementById('hp-tbody').innerHTML=usersData.map(u=>{
      const isMe=u.id===myId, rem=getHpRem(u.id);
      const remOvr=rem===null?'color:#aaa':rem<0?`color:#ef4444;border-color:#ef4444;background:#ef444422`:rem<=3?`color:#f97316;border-color:#f97316;background:#f9731622`:'';
      const plan=new Set(hpPlans[u.id]||[]);
      let cells='';
      for (let d=1;d<=dim;d++) {
        const date=ds(hpY,hpM,d), dw=new Date(hpY,hpM-1,d).getDay(), wkd=dw===0||dw===6;
        let c='hp-td-cell';
        if(plan.has(date)) c+=isMe?' mine':' others'; else if(isHol(date)) c+=' hol'; else if(wkd) c+=' wkd';
        if(isMe) c+=' editable';
        cells+=`<td class="${c}" onclick="hpQuickToggle('${date}')"></td>`;
      }
      return `<tr>
        <td class="hp-td-name${isMe?' me':''}">
          <span class="hp-rem-badge" style="${remOvr}">${rem!==null?rem:'—'}</span>
          <div><div style="font-weight:700;font-size:12px;color:var(--text)">${esc(u.nickname||u.name.split(' ')[0]||u.name)}</div>${u.nickname?`<div style="font-size:9px;color:#aaa">${esc(u.name)}</div>`:''}</div>
          ${isMe?`<span style="margin-left:auto;font-size:9px;background:rgba(34,197,94,.15);color:#16a34a;border-radius:4px;padding:1px 5px;font-weight:700">ฉัน</span>`:''}
        </td>${cells}
        <td class="hp-td-total">${plan.size>0?`<span style="font-weight:800;font-size:13px;color:${isMe?'#16a34a':'#b45309'}">${plan.size}</span>`:`<span style="color:#ddd">—</span>`}</td>
      </tr>`;
    }).join('');
  }

  async function quickToggle(date) {
    const myId=Auth.getUser()?.id, [y,m]=date.split('-').map(Number), mk=`${y}-${p2(m)}`;
    if (!hpSel[mk]) hpSel[mk]=new Set(hpPlans[myId]||[]);
    hpSel[mk].has(date)?hpSel[mk].delete(date):hpSel[mk].add(date);
    await saveMonth(y,m);
  }
  async function saveMonth(y,m) {
    const myId=Auth.getUser()?.id, mk=`${y}-${p2(m)}`;
    const dates=[...(hpSel[mk]||new Set())].sort();
    const res=await API.holidayPlans.save({year:y,month:m,dates});
    if (!res?.ok){Toast.error('บันทึกไม่สำเร็จ');return;}
    if (y===hpY&&m===hpM){hpPlans[myId]=dates;render();}
  }

  // Modal
  function openModal() {
    const myId=Auth.getUser()?.id; hpModalY=hpY; hpModalM=hpM;
    const mk=`${hpModalY}-${p2(hpModalM)}`;
    if (!hpSel[mk]) hpSel[mk]=new Set(hpPlans[myId]||[]);
    renderModal(); document.getElementById('hp-modal').classList.add('open');
  }
  function closeModal(){document.getElementById('hp-modal').classList.remove('open');}
  async function modalNav(dm) {
    hpModalM+=dm; if(hpModalM>12){hpModalM=1;hpModalY++;} if(hpModalM<1){hpModalM=12;hpModalY--;}
    const myId=Auth.getUser()?.id, mk=`${hpModalY}-${p2(hpModalM)}`;
    if (!hpSel[mk]){const r=await API.holidayPlans.get(hpModalY,hpModalM);const pl=r?.ok?(r.data.data?.plans||{}):{};hpSel[mk]=new Set(pl[myId]||[]);}
    renderModal();
  }
  function renderModal() {
    const mk=`${hpModalY}-${p2(hpModalM)}`, sel=hpSel[mk]||new Set();
    const tod=ds(new Date().getFullYear(),new Date().getMonth()+1,new Date().getDate());
    const dim=new Date(hpModalY,hpModalM,0).getDate(), first=new Date(hpModalY,hpModalM-1,1).getDay();
    document.getElementById('hpm-sub').textContent=`เลือกวันที่ต้องการหยุด — ${MTH[hpModalM]} ${hpModalY+543}`;
    document.getElementById('hpm-title').textContent=`${MTH[hpModalM]} ${hpModalY+543}`;
    let g=DTH.map(d=>`<div class="hpm-dh">${d}</div>`).join('');
    for(let i=0;i<first;i++) g+=`<div class="hpm-day out"></div>`;
    for(let d=1;d<=dim;d++){
      const date=ds(hpModalY,hpModalM,d), dw=new Date(hpModalY,hpModalM-1,d).getDay();
      let c='hpm-day'; if(dw===0||dw===6)c+=' wkd'; if(isHol(date))c+=' hol'; if(sel.has(date))c+=' sel'; if(date===tod)c+=' tod';
      g+=`<div class="${c}" onclick="hpToggleDay('${date}')" ${isHol(date)?`title="${esc(holName(date))}"`:''}>${d}</div>`;
    }
    document.getElementById('hpm-grid').innerHTML=g;
    const all=Object.values(hpSel).flatMap(s=>[...s]).sort();
    document.getElementById('hpm-count').textContent=all.length;
    document.getElementById('hpm-pills').innerHTML=all.length
      ?all.map(d=>`<span class="hpm-pill">${d}<button class="hpm-pill-x" onclick="hpRemovePill('${d}')">×</button></span>`).join('')
      :'<span class="hpm-empty">ยังไม่ได้เลือก</span>';
  }
  function toggleDay(date){const mk=`${hpModalY}-${p2(hpModalM)}`;if(!hpSel[mk])hpSel[mk]=new Set();hpSel[mk].has(date)?hpSel[mk].delete(date):hpSel[mk].add(date);renderModal();}
  function removePill(date){const [y,m]=date.split('-').map(Number);hpSel[`${y}-${p2(m)}`]?.delete(date);renderModal();}
  async function clearMonth(){const mk=`${hpModalY}-${p2(hpModalM)}`;hpSel[mk]=new Set();renderModal();await API.holidayPlans.clear(hpModalY,hpModalM);if(hpModalY===hpY&&hpModalM===hpM)await loadRender();Toast.success('ล้างแผนเดือนนี้แล้ว');}
  async function modalSave(){
    const btn=document.getElementById('hpm-save-btn');btn.disabled=true;btn.textContent='กำลังบันทึก...';
    for(const mk of Object.keys(hpSel)){const [y,m]=mk.split('-').map(Number);await saveMonth(y,m);}
    btn.disabled=false;btn.innerHTML='<i data-icon="save"></i> บันทึก';closeModal();Toast.success('บันทึกแผนเรียบร้อยแล้ว <i data-icon="check"></i>');
  }

  return {
    open() { hpY=curYear;hpM=curMonth; document.querySelector('.sched-wrap').style.display='none'; document.getElementById('hp-view').classList.add('active'); renderHolidayPopup(hpY); loadRender(); },
    close() { document.getElementById('hp-view').classList.remove('active'); document.querySelector('.sched-wrap').style.display=''; },
    changeMonth(d){hpM+=d;if(hpM>12){hpM=1;hpY++;}if(hpM<1){hpM=12;hpY--;}loadRender();},
    changeYear(d){hpY+=d;renderHolidayPopup(hpY);loadRender();},
    goToday(){hpY=new Date().getFullYear();hpM=new Date().getMonth()+1;renderHolidayPopup(hpY);loadRender();},
    openModal:openModal, closeModal:closeModal,
    modalPrev(){modalNav(-1);}, modalNext(){modalNav(1);},
    clearMonth, save:modalSave,
    quickToggle, toggleDay, removePill,
    rerender: render,
    get _year(){return hpY;},
  };
})();

// Global shims — inline onclick cannot reach `const HP` directly
function openHolidayPlans()  { HP.open(); }
function closeHolidayPlans() { HP.close(); }
function hpChangeMonth(d)    { HP.changeMonth(d); }
function hpChangeYear(d)     { HP.changeYear(d); }
function hpGoToday()         { HP.goToday(); }
function openHpModal()       { HP.openModal(); }
function closeHpModal()      { HP.closeModal(); }
function hpmPrevMonth()      { HP.modalPrev(); }
function hpmNextMonth()      { HP.modalNext(); }
function hpmClearMonth()     { HP.clearMonth(); }
function hpmSave()           { HP.save(); }
function hpQuickToggle(date) { HP.quickToggle(date); }
function hpToggleDay(date)   { HP.toggleDay(date); }
function hpRemovePill(date)  { HP.removePill(date); }

// ── Holiday tooltip ──────────────────────────────────────────────────────────
const _MONTH_SHORT=['','ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
function renderHolidayPopup(year){
  const hols=(holidayData||[]).filter(h=>h.date?.startsWith(String(year))).sort((a,b)=>a.date.localeCompare(b.date));
  const ce=document.getElementById('hp-hol-count'), ye=document.getElementById('hp-hol-year'), le=document.getElementById('hp-hol-list');
  if(!ce||!ye||!le)return;
  ce.textContent=hols.length?`(${hols.length})`:'';
  ye.textContent=`ปี ${year+543}`;
  le.innerHTML=hols.length?hols.map(h=>{const[,m,d]=h.date.split('-').map(Number),dw=new Date(h.date).getDay();return`<div class="hp-hol-item"><span class="hp-hol-date">${d} ${_MONTH_SHORT[m]} (${['อา','จ','อ','พ','พฤ','ศ','ส'][dw]})</span><span class="hp-hol-name">${h.name||''}</span></div>`;}).join(''):'<div class="hp-hol-empty">ไม่มีข้อมูลวันหยุด</div>';
}
function toggleHolidayPopup(e){
  e.stopPropagation();
  const popup=document.getElementById('hp-hol-popup'),btn=document.getElementById('hp-hol-btn');
  const open=popup.classList.toggle('show'); btn.classList.toggle('active',open);
  if(open) try{renderHolidayPopup(HP._year);}catch{renderHolidayPopup(curYear);}
}
document.addEventListener('click',()=>{document.getElementById('hp-hol-popup')?.classList.remove('show');document.getElementById('hp-hol-btn')?.classList.remove('active');});

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "calNav", { configurable: true, get: () => calNav, set: (v) => { calNav = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "calculateLeaveDays", { configurable: true, get: () => calculateLeaveDays, set: (v) => { calculateLeaveDays = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "cancelLeave", { configurable: true, get: () => cancelLeave, set: (v) => { cancelLeave = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "changeMonth", { configurable: true, get: () => changeMonth, set: (v) => { changeMonth = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "clearDates", { configurable: true, get: () => clearDates, set: (v) => { clearDates = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeHolidayPlans", { configurable: true, get: () => closeHolidayPlans, set: (v) => { closeHolidayPlans = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeHpModal", { configurable: true, get: () => closeHpModal, set: (v) => { closeHpModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeLeaveModal", { configurable: true, get: () => closeLeaveModal, set: (v) => { closeLeaveModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "esc", { configurable: true, get: () => esc, set: (v) => { esc = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "exportCalendarImage", { configurable: true, get: () => exportCalendarImage, set: (v) => { exportCalendarImage = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtDate", { configurable: true, get: () => fmtDate, set: (v) => { fmtDate = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtLeaveDates", { configurable: true, get: () => fmtLeaveDates, set: (v) => { fmtLeaveDates = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "goToday", { configurable: true, get: () => goToday, set: (v) => { goToday = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "hpChangeMonth", { configurable: true, get: () => hpChangeMonth, set: (v) => { hpChangeMonth = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "hpChangeYear", { configurable: true, get: () => hpChangeYear, set: (v) => { hpChangeYear = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "hpGoToday", { configurable: true, get: () => hpGoToday, set: (v) => { hpGoToday = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "hpQuickToggle", { configurable: true, get: () => hpQuickToggle, set: (v) => { hpQuickToggle = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "hpRemovePill", { configurable: true, get: () => hpRemovePill, set: (v) => { hpRemovePill = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "hpToggleDay", { configurable: true, get: () => hpToggleDay, set: (v) => { hpToggleDay = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "hpmClearMonth", { configurable: true, get: () => hpmClearMonth, set: (v) => { hpmClearMonth = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "hpmNextMonth", { configurable: true, get: () => hpmNextMonth, set: (v) => { hpmNextMonth = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "hpmPrevMonth", { configurable: true, get: () => hpmPrevMonth, set: (v) => { hpmPrevMonth = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "hpmSave", { configurable: true, get: () => hpmSave, set: (v) => { hpmSave = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadAll", { configurable: true, get: () => loadAll, set: (v) => { loadAll = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadFullYearSchedule", { configurable: true, get: () => loadFullYearSchedule, set: (v) => { loadFullYearSchedule = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadHolidays", { configurable: true, get: () => loadHolidays, set: (v) => { loadHolidays = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadLeaves", { configurable: true, get: () => loadLeaves, set: (v) => { loadLeaves = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadMyLeaves", { configurable: true, get: () => loadMyLeaves, set: (v) => { loadMyLeaves = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadQuotas", { configurable: true, get: () => loadQuotas, set: (v) => { loadQuotas = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadSchedule", { configurable: true, get: () => loadSchedule, set: (v) => { loadSchedule = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadUserColors", { configurable: true, get: () => loadUserColors, set: (v) => { loadUserColors = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadUserQuota", { configurable: true, get: () => loadUserQuota, set: (v) => { loadUserQuota = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadUsers", { configurable: true, get: () => loadUsers, set: (v) => { loadUsers = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openHolidayPlans", { configurable: true, get: () => openHolidayPlans, set: (v) => { openHolidayPlans = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openHpModal", { configurable: true, get: () => openHpModal, set: (v) => { openHpModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openLeaveModal", { configurable: true, get: () => openLeaveModal, set: (v) => { openLeaveModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "removeDate", { configurable: true, get: () => removeDate, set: (v) => { removeDate = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderHolidayPopup", { configurable: true, get: () => renderHolidayPopup, set: (v) => { renderHolidayPopup = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderLeaveCalendar", { configurable: true, get: () => renderLeaveCalendar, set: (v) => { renderLeaveCalendar = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderSummary", { configurable: true, get: () => renderSummary, set: (v) => { renderSummary = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderVacationSummary", { configurable: true, get: () => renderVacationSummary, set: (v) => { renderVacationSummary = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setLeaveType", { configurable: true, get: () => setLeaveType, set: (v) => { setLeaveType = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "submitLeave", { configurable: true, get: () => submitLeave, set: (v) => { submitLeave = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "switchLeaveTab", { configurable: true, get: () => switchLeaveTab, set: (v) => { switchLeaveTab = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toggleDate", { configurable: true, get: () => toggleDate, set: (v) => { toggleDate = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toggleHolidayPopup", { configurable: true, get: () => toggleHolidayPopup, set: (v) => { toggleHolidayPopup = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updateDurationOptions", { configurable: true, get: () => updateDurationOptions, set: (v) => { updateDurationOptions = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updateLeaveDisplay", { configurable: true, get: () => updateLeaveDisplay, set: (v) => { updateLeaveDisplay = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updateQuotaDisplay", { configurable: true, get: () => updateQuotaDisplay, set: (v) => { updateQuotaDisplay = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "applyMyDaysFilter", { configurable: true, get: () => applyMyDaysFilter, set: (v) => { applyMyDaysFilter = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "buildColorMap", { configurable: true, get: () => buildColorMap, set: (v) => { buildColorMap = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "cellContent", { configurable: true, get: () => cellContent, set: (v) => { cellContent = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "chipHtml", { configurable: true, get: () => chipHtml, set: (v) => { chipHtml = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "daysBetween", { configurable: true, get: () => daysBetween, set: (v) => { daysBetween = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "exportMyScheduleICS", { configurable: true, get: () => exportMyScheduleICS, set: (v) => { exportMyScheduleICS = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "exportStatsCSV", { configurable: true, get: () => exportStatsCSV, set: (v) => { exportStatsCSV = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "getMyDateSet", { configurable: true, get: () => getMyDateSet, set: (v) => { getMyDateSet = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "getThaiHolidays", { configurable: true, get: () => getThaiHolidays, set: (v) => { getThaiHolidays = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "hexToRgba", { configurable: true, get: () => hexToRgba, set: (v) => { hexToRgba = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "leaveDayCount", { configurable: true, get: () => leaveDayCount, set: (v) => { leaveDayCount = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderCalendar", { configurable: true, get: () => renderCalendar, set: (v) => { renderCalendar = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderStats", { configurable: true, get: () => renderStats, set: (v) => { renderStats = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toggleMyDays", { configurable: true, get: () => toggleMyDays, set: (v) => { toggleMyDays = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "userColor", { configurable: true, get: () => userColor, set: (v) => { userColor = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "userName", { configurable: true, get: () => userName, set: (v) => { userName = v; } }); } catch (e) {}
})();
