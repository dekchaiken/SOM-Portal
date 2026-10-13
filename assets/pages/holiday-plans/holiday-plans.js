// holiday-plans — page script, extracted from holiday-plans.html.
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
Layout.render('holiday-plans');

/* ══════════════════════════════════════
   State
══════════════════════════════════════ */
const today   = new Date();
let curYear   = today.getFullYear();
let curMonth  = today.getMonth() + 1;
let plansData = {};   // {user_id: [dates]}
let usersData = [];
let quotaData = {};
let leaveData = [];
let holidayData = [];
let currentUser = null;

// modal state
let modalYear  = curYear;
let modalMonth = curMonth;
let modalSel   = {};  // {YYYY-MM: Set<date>}

const MONTH_TH = ['','มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
                  'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
const DAY_TH   = ['อา','จ','อ','พ','พฤ','ศ','ส'];

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function pad(n) { return String(n).padStart(2,'0'); }
function dateStr(y,m,d) { return `${y}-${pad(m)}-${pad(d)}`; }
function isWeekend(y,m,d) { const dw = new Date(y,m-1,d).getDay(); return dw===0||dw===6; }
function isHoliday(ds) { return holidayMap.has(ds); }

let holidayMap = new Map();

/* ══════════════════════════════════════
   Navigation
══════════════════════════════════════ */
function changeMonth(d) {
  curMonth += d;
  if (curMonth > 12) { curMonth = 1; curYear++; }
  if (curMonth < 1)  { curMonth = 12; curYear--; }
  loadMonthData();
}
function changeYear(d) {
  curYear += d;
  loadAll();
}
function goToday() {
  curYear  = today.getFullYear();
  curMonth = today.getMonth() + 1;
  loadMonthData();
}

/* ══════════════════════════════════════
   Data loading
══════════════════════════════════════ */
async function loadAll() {
  currentUser = Auth.getUser();
  const [uRes, qRes, lRes, hRes] = await Promise.all([
    API.users.list(),
    API.vacation.getQuotas(),
    API.leave.list(),
    API.holidays.list(),
  ]);
  usersData   = uRes?.ok  ? (uRes.data.data   || []) : [];
  quotaData   = qRes?.ok  ? (qRes.data.data   || {}) : {};
  leaveData   = lRes?.ok  ? (lRes.data.data   || []) : [];
  holidayData = hRes?.ok  ? (hRes.data.data   || []) : [];
  holidayMap  = new Map(holidayData.map(h => [h.date, h.name]));
  await loadMonthData();
}

async function loadMonthData() {
  const res = await API.holidayPlans.get(curYear, curMonth);
  plansData  = res?.ok ? (res.data.plans || {}) : {};
  renderAll();
}

/* ══════════════════════════════════════
   Remaining vacation helper (same logic as schedule.html)
══════════════════════════════════════ */
function getRemaining(userId) {
  const quota = parseFloat(quotaData[userId]) || 0;
  if (!quota) return null;

  const coveredDates = new Set();
  const usedFromLeaves = leaveData
    .filter(l => l.user_id === userId && l.status === 'approved' && l.type === 'vacation')
    .reduce((sum, l) => {
      const dates = l.dates && Array.isArray(l.dates) ? l.dates : [];
      dates.forEach(d => coveredDates.add(d));
      if (!dates.length && l.start_date && l.end_date) {
        for (let d = new Date(l.start_date); d <= new Date(l.end_date); d.setDate(d.getDate()+1)) {
          coveredDates.add(d.toISOString().slice(0,10));
        }
      }
      const cnt = dates.length || (l.start_date && l.end_date
        ? Math.max(1, Math.round((new Date(l.end_date)-new Date(l.start_date))/86400000)+1)
        : 0);
      return sum + (l.duration === 'half' ? cnt * 0.5 : cnt);
    }, 0);
  const remaining = quota - usedFromLeaves;
  return remaining % 1 === 0 ? remaining : parseFloat(remaining.toFixed(1));
}

/* ══════════════════════════════════════
   Render calendar
══════════════════════════════════════ */
function renderAll() {
  const daysInMonth = new Date(curYear, curMonth, 0).getDate();
  const todayStr    = dateStr(today.getFullYear(), today.getMonth()+1, today.getDate());
  const myId        = currentUser?.id;

  // Update nav label
  document.getElementById('hp-nav-title').textContent = `${MONTH_TH[curMonth]} ${curYear + 543}`;

  // Stat chip
  const planners = Object.keys(plansData).filter(uid => (plansData[uid] || []).length > 0);
  document.getElementById('hp-stat-chip').textContent = `${planners.length}/${usersData.length} คนกรอกแล้ว`;

  // ── Build header ──────────────────────────────────────
  const thead = document.getElementById('hp-thead');
  let hdHtml = '<tr>';
  hdHtml += `<th class="hp-th-name">Name</th>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const ds  = dateStr(curYear, curMonth, d);
    const dw  = new Date(curYear, curMonth-1, d).getDay();
    const wkd = dw===0||dw===6;
    const hol = holidayMap.has(ds);
    const tod = ds === todayStr;
    let cls = 'hp-th-day';
    if (tod) cls += ' is-today';
    else if (hol) cls += ' is-holiday';
    else if (wkd) cls += ' is-weekend';
    const dowLabel = DAY_TH[dw];
    hdHtml += `<th class="${cls}"><div>${pad(d)}</div><div style="font-size:8px;opacity:.7">${dowLabel}</div></th>`;
  }
  hdHtml += `<th class="hp-th-vac">วันแผน</th></tr>`;
  thead.innerHTML = hdHtml;

  // ── Build body ────────────────────────────────────────
  const tbody = document.getElementById('hp-tbody');

  if (!usersData.length) {
    tbody.innerHTML = '<tr><td colspan="40" style="text-align:center;padding:32px;color:#aaa;font-size:12px">ยังไม่มีสมาชิก</td></tr>';
    return;
  }

  tbody.innerHTML = usersData.map(u => {
    const isMe   = u.id === myId;
    const rem    = getRemaining(u.id);
    const remDisp = rem !== null ? rem : '—';
    const remColor = rem === null ? '#aaa' : rem < 0 ? '#ef4444' : rem <= 3 ? '#f97316' : 'white';
    const myPlans = new Set(plansData[u.id] || []);
    const planCount = myPlans.size;

    let cells = '';
    for (let d = 1; d <= daysInMonth; d++) {
      const ds  = dateStr(curYear, curMonth, d);
      const dw  = new Date(curYear, curMonth-1, d).getDay();
      const wkd = dw===0||dw===6;
      const hol = holidayMap.has(ds);
      let cls = 'hp-td-day';
      if (myPlans.has(ds)) cls += isMe ? ' is-planned is-me' : ' is-planned';
      else if (hol) cls += ' is-holiday';
      else if (wkd) cls += ' is-weekend';
      if (isMe && !wkd) cls += ' is-me-editable';
      const onclick = isMe && !wkd ? `onclick="quickToggle('${ds}')"` : '';
      cells += `<td class="${cls}" data-date="${ds}" ${onclick}></td>`;
    }

    return `<tr>
      <td class="hp-td-name${isMe?' is-me':''}">
        <span class="hp-quota-badge" style="color:${remColor}">${remDisp}</span>
        <div>
          <div style="font-weight:700;font-size:12px;color:var(--text)">${esc(u.nickname||u.name.split(' ')[0]||u.name)}</div>
          ${u.nickname ? `<div style="font-size:9px;color:#aaa">${esc(u.name)}</div>` : ''}
        </div>
        ${isMe ? `<span style="margin-left:auto;font-size:9px;background:rgba(34,197,94,.15);color:#16a34a;border-radius:4px;padding:1px 5px;font-weight:700">ฉัน</span>` : ''}
      </td>
      ${cells}
      <td class="hp-td-vac">
        ${planCount > 0
          ? `<span style="font-weight:800;font-size:13px;color:${isMe?'#16a34a':'#b45309'}">${planCount}</span>`
          : `<span style="color:#ddd">—</span>`}
      </td>
    </tr>`;
  }).join('');
}

/* ══════════════════════════════════════
   Quick toggle (click cell in own row)
══════════════════════════════════════ */
async function quickToggle(ds) {
  const myId = currentUser?.id;
  const [y, m] = ds.split('-').map(Number);
  const monthKey = `${y}-${pad(m)}`;

  // Sync current plansData into modalSel for this month
  if (!modalSel[monthKey]) {
    modalSel[monthKey] = new Set(plansData[myId] || []);
  }
  const sel = modalSel[monthKey];

  if (sel.has(ds)) sel.delete(ds);
  else             sel.add(ds);

  // Save immediately
  await saveMonthPlan(y, m);
}

/* ══════════════════════════════════════
   Plan Modal
══════════════════════════════════════ */
function openPlanModal() {
  const myId = currentUser?.id;
  modalYear  = curYear;
  modalMonth = curMonth;

  // Load current month's plan into modalSel
  const mk = `${modalYear}-${pad(modalMonth)}`;
  if (!modalSel[mk]) {
    modalSel[mk] = new Set(plansData[myId] || []);
  }

  renderModalCal();
  document.getElementById('plan-modal').classList.add('open');
}

function closePlanModal() {
  document.getElementById('plan-modal').classList.remove('open');
}

function modalPrevMonth() {
  modalMonth--;
  if (modalMonth < 1) { modalMonth = 12; modalYear--; }
  loadModalMonthData();
}
function modalNextMonth() {
  modalMonth++;
  if (modalMonth > 12) { modalMonth = 1; modalYear++; }
  loadModalMonthData();
}

async function loadModalMonthData() {
  const myId  = currentUser?.id;
  const mk    = `${modalYear}-${pad(modalMonth)}`;
  if (!modalSel[mk]) {
    // Load from server for this month
    const res = await API.holidayPlans.get(modalYear, modalMonth);
    const plans = res?.ok ? (res.data.plans || {}) : {};
    modalSel[mk] = new Set(plans[myId] || []);
  }
  renderModalCal();
}

function renderModalCal() {
  document.getElementById('pm-hd-sub').textContent =
    `เลือกวันที่ต้องการหยุด — ${MONTH_TH[modalMonth]} ${modalYear + 543}`;
  document.getElementById('pm-cal-title').textContent =
    `${MONTH_TH[modalMonth]} ${modalYear + 543}`;

  const mk  = `${modalYear}-${pad(modalMonth)}`;
  const sel = modalSel[mk] || new Set();
  const todayStr = dateStr(today.getFullYear(), today.getMonth()+1, today.getDate());
  const daysInMonth = new Date(modalYear, modalMonth, 0).getDate();
  const firstDow    = new Date(modalYear, modalMonth-1, 1).getDay();

  let html = DAY_TH.map(d => `<div class="pm-cal-day-hd">${d}</div>`).join('');
  // blank cells before first day
  for (let i = 0; i < firstDow; i++) html += `<div class="pm-cal-day out"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const ds  = dateStr(modalYear, modalMonth, d);
    const dw  = new Date(modalYear, modalMonth-1, d).getDay();
    const wkd = dw===0||dw===6;
    const hol = holidayMap.has(ds);
    const tod = ds === todayStr;
    let cls = 'pm-cal-day';
    if (wkd) cls += ' weekend';
    else {
      if (hol) cls += ' holiday';
      if (sel.has(ds)) cls += ' selected';
      if (tod) cls += ' today';
    }
    const onclick = !wkd ? `onclick="toggleModalDay('${ds}')"` : '';
    const title = hol ? `title="${esc(holidayMap.get(ds))}"` : '';
    html += `<div class="${cls}" ${onclick} ${title}>${d}</div>`;
  }
  document.getElementById('pm-cal-grid').innerHTML = html;
  renderModalPills();
}

function toggleModalDay(ds) {
  const mk  = `${modalYear}-${pad(modalMonth)}`;
  if (!modalSel[mk]) modalSel[mk] = new Set();
  const sel = modalSel[mk];
  if (sel.has(ds)) sel.delete(ds);
  else             sel.add(ds);
  renderModalCal();
}

function renderModalPills() {
  // Collect all selected across all modal months
  const allDates = [];
  Object.entries(modalSel).forEach(([mk, sel]) => {
    sel.forEach(d => allDates.push(d));
  });
  allDates.sort();
  document.getElementById('pm-count').textContent = allDates.length;

  if (!allDates.length) {
    document.getElementById('pm-pills').innerHTML = '<span class="pm-empty">ยังไม่ได้เลือกวัน</span>';
    return;
  }
  document.getElementById('pm-pills').innerHTML = allDates.map(d =>
    `<span class="pm-pill">${d}<button class="pm-pill-x" onclick="removePill('${d}')">×</button></span>`
  ).join('');
}

function removePill(ds) {
  const [y, m] = ds.split('-').map(Number);
  const mk = `${y}-${pad(m)}`;
  modalSel[mk]?.delete(ds);
  renderModalCal();
}

async function clearModalMonth() {
  const mk = `${modalYear}-${pad(modalMonth)}`;
  modalSel[mk] = new Set();
  renderModalCal();
  // Also persist to server
  await API.holidayPlans.clear(modalYear, modalMonth);
  if (modalYear === curYear && modalMonth === curMonth) await loadMonthData();
  Toast.success('ล้างแผนเดือนนี้แล้ว');
}

async function savePlan() {
  const btn = document.getElementById('pm-save-btn');
  btn.disabled = true;
  btn.textContent = 'กำลังบันทึก...';

  // Save each modified month
  const months = Object.keys(modalSel);
  for (const mk of months) {
    const [y, m] = mk.split('-').map(Number);
    await saveMonthPlan(y, m);
  }

  btn.disabled = false;
  btn.innerHTML = '<i data-icon=\"save\"></i> บันทึก';
  closePlanModal();
  if (Object.keys(modalSel).some(mk => {
    const [y,m] = mk.split('-').map(Number);
    return y === curYear && m === curMonth;
  })) await loadMonthData();
  Toast.success('บันทึกแผนเรียบร้อยแล้ว <i data-icon=\"check\"></i>');
}

async function saveMonthPlan(year, month) {
  const mk   = `${year}-${pad(month)}`;
  const sel  = modalSel[mk] || new Set();
  const dates = [...sel].sort();
  const res  = await API.holidayPlans.save({ year, month, dates });
  if (!res?.ok) { Toast.error('บันทึกไม่สำเร็จ'); return; }
  // Update local plansData
  const myId = currentUser?.id;
  if (year === curYear && month === curMonth) {
    plansData[myId] = dates;
    renderAll();
  }
}

/* ══════════════════════════════════════
   Init
══════════════════════════════════════ */
loadAll();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "changeMonth", { configurable: true, get: () => changeMonth, set: (v) => { changeMonth = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "changeYear", { configurable: true, get: () => changeYear, set: (v) => { changeYear = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "clearModalMonth", { configurable: true, get: () => clearModalMonth, set: (v) => { clearModalMonth = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closePlanModal", { configurable: true, get: () => closePlanModal, set: (v) => { closePlanModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "dateStr", { configurable: true, get: () => dateStr, set: (v) => { dateStr = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "esc", { configurable: true, get: () => esc, set: (v) => { esc = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "getRemaining", { configurable: true, get: () => getRemaining, set: (v) => { getRemaining = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "goToday", { configurable: true, get: () => goToday, set: (v) => { goToday = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "isHoliday", { configurable: true, get: () => isHoliday, set: (v) => { isHoliday = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "isWeekend", { configurable: true, get: () => isWeekend, set: (v) => { isWeekend = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadAll", { configurable: true, get: () => loadAll, set: (v) => { loadAll = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadModalMonthData", { configurable: true, get: () => loadModalMonthData, set: (v) => { loadModalMonthData = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadMonthData", { configurable: true, get: () => loadMonthData, set: (v) => { loadMonthData = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "modalNextMonth", { configurable: true, get: () => modalNextMonth, set: (v) => { modalNextMonth = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "modalPrevMonth", { configurable: true, get: () => modalPrevMonth, set: (v) => { modalPrevMonth = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openPlanModal", { configurable: true, get: () => openPlanModal, set: (v) => { openPlanModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "pad", { configurable: true, get: () => pad, set: (v) => { pad = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "quickToggle", { configurable: true, get: () => quickToggle, set: (v) => { quickToggle = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "removePill", { configurable: true, get: () => removePill, set: (v) => { removePill = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderAll", { configurable: true, get: () => renderAll, set: (v) => { renderAll = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderModalCal", { configurable: true, get: () => renderModalCal, set: (v) => { renderModalCal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderModalPills", { configurable: true, get: () => renderModalPills, set: (v) => { renderModalPills = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "saveMonthPlan", { configurable: true, get: () => saveMonthPlan, set: (v) => { saveMonthPlan = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "savePlan", { configurable: true, get: () => savePlan, set: (v) => { savePlan = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toggleModalDay", { configurable: true, get: () => toggleModalDay, set: (v) => { toggleModalDay = v; } }); } catch (e) {}
})();
