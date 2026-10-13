// admin/leave-approval — page script, extracted from admin/leave-approval.html.
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

if (!Auth.requireAdmin()) { window.location.href = '../'; }

Layout.render('admin-leave-approval');

const MONTH_TH = ['','ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
function fmtDateInner(ds) {
  if (!ds) return '—';
  const [y, m, d] = ds.split('-');
  return `${parseInt(d)} ${MONTH_TH[parseInt(m)]} ${parseInt(y)+543}`;
}

let leaves = [];
let currentFilter = 'pending';
let colors = [
  '#f26419','#3b82f6','#22c55e','#f59e0b','#8b5cf6',
  '#ec4899','#14b8a6','#ef4444','#06b6d4','#a855f7',
];
let userAvatarMap = {}; // { userId: avatar_url }

// Load avatars from users
async function loadAvatars() {
  try {
    const res = await API.users.avatars();
    if (res?.ok) {
      const users = res.data.data || [];
      users.forEach(u => {
        userAvatarMap[u.id] = u.avatar_url || '';
      });
    }
  } catch (e) {
    console.warn('Failed to load avatars:', e);
  }
}

// Load all
async function loadAll() {
  await loadAvatars(); // Load avatars first
  const res = await API.leave.list({ admin: true });
  leaves = res?.ok ? (res.data.data || []) : [];
  renderLeaves();
  updateStats();
}

function updateStats() {
  const pending = leaves.filter(l => l.status === 'pending').length;
  document.getElementById('pending-count').textContent = pending;
}

function filterLeaves(filter) {
  currentFilter = filter;
  document.querySelectorAll('.la-filter').forEach(btn => btn.classList.remove('active'));
  event.target.classList.add('active');
  renderLeaves();
}

function renderLeaves() {
  const el = document.getElementById('leave-list');
  let filtered = leaves;

  if (currentFilter !== 'all') {
    filtered = leaves.filter(l => l.status === currentFilter);
  }

  if (!filtered.length) {
    el.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">${currentFilter === 'pending' ? '✓' : '📋'}</div>
      <div class="empty-state-title">ไม่มีรายการ</div>
      <div class="empty-state-sub">
        ${currentFilter === 'pending' ? 'ไม่มีคำขอที่รอพิจารณา' : 'ไม่มีรายการในหมวดนี้'}
      </div>
    </div>`;
    return;
  }

  function fmtDate(ds) {
    if (!ds) return '—';
    const [y, m, d] = ds.split('-');
    return `${parseInt(d)} ${MONTH_TH[parseInt(m)]} ${parseInt(y)+543}`;
  }
  function timeAgo(ts) {
    if (!ts) return '';
    const hours = Math.floor((Date.now() - new Date(ts)) / 3600000);
    if (hours < 1) return 'เมื่อสักครู่';
    if (hours < 24) return `${hours} ชั่วโมงที่แล้ว`;
    return `${Math.floor(hours/24)} วันที่แล้ว`;
  }

  el.innerHTML = `<div class="lr-grid">${filtered.map(req => {
    const typeLabel = req.type === 'vacation' ? 'Vacation / พักร้อน' : 'Sick Leave / ลาป่วย';
    const typeIcon  = req.type === 'vacation' ? '🏖' : '🤒';
    const totalDays = leaveDayCount(req);
    const userIdx = (req.user_id || '').charCodeAt(0) % colors.length;
    const bgColor = colors[userIdx];

    const durLabel = req.duration === 'half'
      ? (req.period === 'afternoon' ? 'ครึ่งวันบ่าย' : 'ครึ่งวันเช้า')
      : 'เต็มวัน';
    const durClass = req.duration === 'half' ? 'dur-half' : 'dur-full';

    let statusHtml = '';
    if (req.status === 'pending') {
      statusHtml = `<span class="lr-card-status lr-status-pending">⏳ รอพิจารณา</span>`;
    } else if (req.status === 'approved') {
      statusHtml = `<span class="lr-card-status" style="background:rgba(34,197,94,.13);color:#86efac;border:1px solid rgba(34,197,94,.25)">✓ อนุมัติแล้ว</span>`;
    } else {
      statusHtml = `<span class="lr-card-status" style="background:rgba(239,68,68,.13);color:#f87171;border:1px solid rgba(239,68,68,.25)">✕ ปฏิเสธ</span>`;
    }

    const reviewerHtml = req.status !== 'pending' && req.reviewed_by ? `
      <div class="lr-reviewer">
        <span>พิจารณาโดย</span>
        <strong>${req.reviewed_by}</strong>
        ${req.reviewed_at ? `<span>· ${timeAgo(req.reviewed_at)}</span>` : ''}
      </div>` : '';

    const urgent = req.status === 'pending' ? 'urgent' : '';
    
    // Check if edited
    const hasAuditLog = req.audit_log && req.audit_log.length > 0;
    const editedBadge = hasAuditLog ? `<span class="edited-badge" title="แก้ไขแล้ว ${req.audit_log.length} ครั้ง">✏️ แก้ไขแล้ว</span>` : '';
    
    // Get avatar from map (for old requests) or from request data (for new requests)
    const avatarUrl = req.avatar_url || userAvatarMap[req.user_id] || '';
    
    return `<div class="lr-card ${urgent}">
      <div class="lr-card-head">
        <div class="lr-card-ava" style="background:${bgColor}">
          ${avatarUrl
            ? `<img src="${avatarUrl}" alt="${req.user_name}" style="width:100%;height:100%;object-fit:cover;border-radius:11px" onerror="this.style.display='none';this.parentElement.textContent='${(req.user_name || '?').charAt(0).toUpperCase()}'">`
            : (req.user_name || '?').charAt(0).toUpperCase()
          }
        </div>
        <div class="lr-card-info">
          <div class="lr-card-name">${req.user_name || 'Unknown'} ${editedBadge}</div>
          <div class="lr-card-meta">
            <span>${typeIcon} ${typeLabel}</span>
            <span>•</span>
            <span>${timeAgo(req.requested_at)}</span>
          </div>
        </div>
        ${statusHtml}
      </div>

      <div class="lr-details">
        <div class="lr-detail-row">
          <span class="lr-detail-label">วันที่:</span>
          <span class="lr-detail-val">${fmtLeaveDates(req)}${isNonConsecutive(req) ? ' <span style="font-size:9px;padding:2px 7px;border-radius:4px;background:rgba(99,102,241,.1);color:#6366f1;font-weight:700;vertical-align:middle">สลับวัน</span>' : ''}</span>
        </div>
        <div class="lr-detail-row">
          <span class="lr-detail-label">จำนวน:</span>
          <span class="lr-detail-val" style="display:flex;align-items:center;gap:8px">
            <strong>${totalDays} วัน</strong>
            <span class="dur-badge ${durClass}">${durLabel}</span>
          </span>
        </div>
      </div>

      ${req.reason ? `<div class="lr-reason">"${req.reason}"</div>` : ''}

      ${req.status === 'pending' ? `
        <div class="lr-review">
          <div class="lr-review-label">หมายเหตุประกอบการพิจารณา</div>
          <textarea class="lr-review-note" id="note-${req.id}" placeholder="เหตุผลในการอนุมัติ/ปฏิเสธ..."></textarea>
        </div>
        <div class="lr-actions">
          <button class="btn-approval btn-app-reject" onclick="doReview('${req.id}', 'rejected')">✕ ปฏิเสธ</button>
          <button class="btn-approval btn-app-approve" onclick="doReview('${req.id}', 'approved')">✓ อนุมัติ</button>
        </div>
      ` : req.status === 'approved' ? `
        ${req.review_note ? `
          <div class="lr-review" style="margin-bottom:0">
            <div class="lr-review-label">หมายเหตุ</div>
            <div style="background:var(--bg);border:1px solid var(--border);border-radius:9px;padding:10px 13px;font-size:11px;color:var(--text-muted);line-height:1.6">${req.review_note}</div>
          </div>
        ` : ''}
        ${reviewerHtml}
        <div class="lr-admin-actions">
          <button class="btn-edit" onclick="openEditModal('${req.id}')">✏️ แก้ไข</button>
          <button class="btn-cancel-leave" onclick="openCancelModal('${req.id}')">🗑️ ยกเลิก</button>
        </div>
      ` : `
        ${req.review_note ? `
          <div class="lr-review" style="margin-bottom:0">
            <div class="lr-review-label">หมายเหตุ</div>
            <div style="background:var(--bg);border:1px solid var(--border);border-radius:9px;padding:10px 13px;font-size:11px;color:var(--text-muted);line-height:1.6">${req.review_note}</div>
          </div>
        ` : ''}
        ${reviewerHtml}
      `}
    </div>`;
  }).join('')}</div>`;
}

async function doReview(id, status) {
  const note = document.getElementById(`note-${id}`)?.value || '';
  const btn = event.target;
  btn.disabled = true;
  btn.textContent = status === 'approved' ? '⏳ กำลังอนุมัติ...' : '⏳ กำลังปฏิเสธ...';

  const res = await API.leave.review(id, { status, review_note: note });
  btn.disabled = false;
  btn.innerHTML = status === 'approved' ? '<i data-icon="check"></i> อนุมัติ' : '<i data-icon="x"></i> ปฏิเสธ';

  if (!res?.ok) {
    Toast.error(res?.data?.message || 'เกิดข้อผิดพลาด');
    return;
  }

  Toast.success(status === 'approved' ? 'อนุมัติแล้ว' : 'ปฏิเสธแล้ว');
  loadAll();
}

// ── Force leave ──────────────────────────────────────────────────────────────
let allUsers = [];
let flType   = 'vacation';
let flDur    = 'full';
let flPeriod = 'morning';

async function loadUsers() {
  const res = await API.users.list();
  allUsers = res?.ok ? (res.data.data || []) : [];
  const sel = document.getElementById('fl-user');
  sel.innerHTML = '<option value="">— เลือกสมาชิก —</option>' +
    allUsers.map(u => `<option value="${u.id}">${u.name}${u.nickname ? ' (' + u.nickname + ')' : ''}</option>`).join('');
}

function openForceLeave() {
  document.getElementById('fl-user').value   = '';
  document.getElementById('fl-start').value  = '';
  document.getElementById('fl-end').value    = '';
  document.getElementById('fl-reason').value = '';
  setFlType('vacation');
  setFlDur('full');
  setFlPeriod('morning');
  document.getElementById('fl-modal').classList.add('open');
}
function closeForceLeave() {
  document.getElementById('fl-modal').classList.remove('open');
}
document.getElementById('fl-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('fl-modal')) closeForceLeave();
});

function setFlType(t) {
  flType = t;
  document.getElementById('fl-t-vacation').classList.toggle('active', t === 'vacation');
  document.getElementById('fl-t-sick').classList.toggle('active', t === 'sick');
}
function setFlDur(d) {
  flDur = d;
  document.getElementById('fl-d-full').classList.toggle('active', d === 'full');
  document.getElementById('fl-d-half').classList.toggle('active', d === 'half');
  document.getElementById('fl-period-wrap').style.display = d === 'half' ? '' : 'none';
}
function setFlPeriod(p) {
  flPeriod = p;
  document.getElementById('fl-p-morning').classList.toggle('active', p === 'morning');
  document.getElementById('fl-p-afternoon').classList.toggle('active', p === 'afternoon');
}

async function submitForceLeave() {
  const userId    = document.getElementById('fl-user').value;
  const startDate = document.getElementById('fl-start').value;
  const endDate   = document.getElementById('fl-end').value;
  const reason    = document.getElementById('fl-reason').value.trim();

  if (!userId)              { Toast.warning('กรุณาเลือกสมาชิก'); return; }
  if (!startDate)           { Toast.warning('กรุณาระบุวันที่เริ่ม'); return; }
  if (!endDate)             { Toast.warning('กรุณาระบุวันที่สิ้นสุด'); return; }
  if (startDate > endDate)  { Toast.warning('วันที่เริ่มต้องไม่เกินวันสิ้นสุด'); return; }

  const btn = document.getElementById('fl-submit');
  btn.disabled    = true;
  btn.textContent = '⏳ กำลังสร้าง...';

  const res = await API.leave.submit({
    for_user_id: userId,
    type:        flType,
    start_date:  startDate,
    end_date:    endDate,
    duration:    flDur,
    period:      flDur === 'half' ? flPeriod : null,
    reason,
  });

  btn.disabled    = false;
  btn.innerHTML = '<i data-icon="check"></i> อนุมัติและสร้าง';

  if (!res?.ok) { Toast.error(res?.data?.message || 'เกิดข้อผิดพลาด'); return; }

  Toast.success('สร้างการลาและอนุมัติแล้ว <i data-icon="check"></i>');
  closeForceLeave();
  loadAll();
}

loadAll();
loadUsers();

// ── Edit Leave ───────────────────────────────────────────────────────────────
let editingLeave = null;
let editType = 'vacation';
let editDur = 'full';
let editPeriod = 'morning';

function openEditModal(leaveId) {
  const leave = leaves.find(l => l.id === leaveId);
  if (!leave) return;
  
  editingLeave = leave;
  editType = leave.type;
  editDur = leave.duration || 'full';
  editPeriod = leave.period || 'morning';
  
  document.getElementById('edit-modal-sub').textContent = `แก้ไขการลาของ ${leave.user_name}`;
  document.getElementById('edit-start').value = leave.start_date;
  document.getElementById('edit-end').value = leave.end_date;
  document.getElementById('edit-reason').value = leave.reason || '';
  document.getElementById('edit-edit-reason').value = '';
  
  setEditType(editType);
  setEditDur(editDur);
  setEditPeriod(editPeriod);
  updateEditQuotaImpact();
  
  document.getElementById('edit-modal').classList.add('open');
}

function closeEditModal() {
  document.getElementById('edit-modal').classList.remove('open');
  editingLeave = null;
}

document.getElementById('edit-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('edit-modal')) closeEditModal();
});

function setEditType(t) {
  editType = t;
  document.getElementById('edit-t-vacation').classList.toggle('active', t === 'vacation');
  document.getElementById('edit-t-sick').classList.toggle('active', t === 'sick');
  updateEditQuotaImpact();
}

function setEditDur(d) {
  editDur = d;
  document.getElementById('edit-d-full').classList.toggle('active', d === 'full');
  document.getElementById('edit-d-half').classList.toggle('active', d === 'half');
  document.getElementById('edit-period-wrap').style.display = d === 'half' ? '' : 'none';
  updateEditQuotaImpact();
}

function setEditPeriod(p) {
  editPeriod = p;
  document.getElementById('edit-p-morning').classList.toggle('active', p === 'morning');
  document.getElementById('edit-p-afternoon').classList.toggle('active', p === 'afternoon');
}

function calculateDays(startDate, endDate, duration) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const days = Math.round((end - start) / 86400000) + 1;
  return duration === 'half' ? days * 0.5 : days;
}

// Supports dates[] (new) and legacy start_date/end_date
function leaveDayCount(req, overrideDuration) {
  const dur = overrideDuration ?? (req.duration || 'full');
  const cnt = req.dates?.length || Math.max(1, Math.round((new Date(req.end_date) - new Date(req.start_date)) / 86400000) + 1);
  return dur === 'half' ? cnt * 0.5 : cnt;
}
function fmtLeaveDates(req) {
  if (req.dates && req.dates.length > 0) {
    const sorted = [...req.dates].sort();
    if (sorted.length === 1) return fmtDateInner(sorted[0]);
    const isConsec = sorted.every((d, i) => i === 0 || (new Date(d) - new Date(sorted[i-1])) === 86400000);
    if (isConsec) return `${fmtDateInner(sorted[0])} — ${fmtDateInner(sorted[sorted.length-1])}`;
    return sorted.map(fmtDateInner).join(' · ');
  }
  if (!req.start_date) return '—';
  return req.start_date === req.end_date ? fmtDateInner(req.start_date) : `${fmtDateInner(req.start_date)} — ${fmtDateInner(req.end_date)}`;
}
function isNonConsecutive(req) {
  if (!req.dates || req.dates.length <= 1) return false;
  const s = [...req.dates].sort();
  return !s.every((d, i) => i === 0 || (new Date(d) - new Date(s[i-1])) === 86400000);
}

function updateEditQuotaImpact() {
  if (!editingLeave) return;
  
  const oldDays = leaveDayCount(editingLeave);
  const newStart = document.getElementById('edit-start').value;
  const newEnd = document.getElementById('edit-end').value;
  
  if (!newStart || !newEnd) return;
  
  const newDays = calculateDays(newStart, newEnd, editDur);
  
  const oldType = editingLeave.type;
  const newType = editType;
  
  let quotaChange = 0;
  if (oldType === 'vacation' && newType === 'vacation') {
    quotaChange = oldDays - newDays;
  } else if (oldType === 'vacation' && newType === 'sick') {
    quotaChange = oldDays;
  } else if (oldType === 'sick' && newType === 'vacation') {
    quotaChange = -newDays;
  }
  
  const impactEl = document.getElementById('edit-quota-impact');
  if (oldType === 'vacation' || newType === 'vacation') {
    impactEl.style.display = '';
    document.getElementById('edit-old-days').textContent = oldType === 'vacation' ? `${oldDays} วัน` : '0 วัน';
    document.getElementById('edit-new-days').textContent = newType === 'vacation' ? `${newDays} วัน` : '0 วัน';
    
    const changeEl = document.getElementById('edit-quota-change');
    if (quotaChange > 0) {
      changeEl.textContent = `+${quotaChange} วัน (คืนโควต้า)`;
      changeEl.style.color = '#86efac';
    } else if (quotaChange < 0) {
      changeEl.textContent = `${quotaChange} วัน (ใช้โควต้า)`;
      changeEl.style.color = '#f87171';
    } else {
      changeEl.textContent = 'ไม่เปลี่ยนแปลง';
      changeEl.style.color = '#93c5fd';
    }
  } else {
    impactEl.style.display = 'none';
  }
}

async function submitEditLeave() {
  if (!editingLeave) return;
  
  const startDate = document.getElementById('edit-start').value;
  const endDate = document.getElementById('edit-end').value;
  const reason = document.getElementById('edit-reason').value.trim();
  const editReason = document.getElementById('edit-edit-reason').value.trim();
  
  if (!startDate || !endDate) {
    Toast.warning('กรุณาระบุวันที่เริ่มและวันที่สิ้นสุด');
    return;
  }
  
  if (startDate > endDate) {
    Toast.warning('วันที่เริ่มต้องไม่เกินวันสิ้นสุด');
    return;
  }
  
  if (!editReason) {
    Toast.warning('กรุณาระบุเหตุผลในการแก้ไข');
    return;
  }
  
  const btn = document.getElementById('edit-submit');
  btn.disabled = true;
  btn.textContent = '⏳ กำลังบันทึก...';
  
  const res = await API.leave.edit(editingLeave.id, {
    start_date: startDate,
    end_date: endDate,
    type: editType,
    duration: editDur,
    period: editDur === 'half' ? editPeriod : null,
    reason,
    edit_reason: editReason
  });
  
  btn.disabled = false;
  btn.innerHTML = '<i data-icon="save"></i> บันทึกการแก้ไข';
  
  if (!res?.ok) {
    Toast.error(res?.data?.message || 'เกิดข้อผิดพลาด');
    return;
  }
  
  Toast.success('แก้ไขการลาสำเร็จ <i data-icon="check"></i>');
  closeEditModal();
  loadAll();
}

// ── Cancel Leave ─────────────────────────────────────────────────────────────
let cancellingLeave = null;

function openCancelModal(leaveId) {
  const leave = leaves.find(l => l.id === leaveId);
  if (!leave) return;
  
  cancellingLeave = leave;
  
  const typeLabel = leave.type === 'vacation' ? '<i data-icon="umbrella-beach"></i> Vacation / พักร้อน' : '<i data-icon="thermometer"></i> Sick Leave / ลาป่วย';
  const days = leaveDayCount(leave);
  const durLabel = leave.duration === 'half'
    ? (leave.period === 'afternoon' ? 'ครึ่งวันบ่าย' : 'ครึ่งวันเช้า')
    : 'เต็มวัน';

  document.getElementById('cancel-user-name').textContent = leave.user_name;
  document.getElementById('cancel-type').textContent = typeLabel;
  document.getElementById('cancel-dates').textContent = fmtLeaveDates(leave);
  document.getElementById('cancel-days').textContent = `${days} วัน (${durLabel})`;
  
  const quotaInfo = document.getElementById('cancel-quota-info');
  if (leave.type === 'vacation') {
    quotaInfo.style.display = '';
    document.getElementById('cancel-quota-restore').textContent = `${days} วัน`;
  } else {
    quotaInfo.style.display = 'none';
  }
  
  document.getElementById('cancel-reason').value = '';
  document.getElementById('cancel-modal').classList.add('open');
}

function closeCancelModal() {
  document.getElementById('cancel-modal').classList.remove('open');
  cancellingLeave = null;
}

document.getElementById('cancel-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('cancel-modal')) closeCancelModal();
});

async function submitCancelLeave() {
  if (!cancellingLeave) return;
  
  const cancelReason = document.getElementById('cancel-reason').value.trim();
  
  if (!cancelReason) {
    Toast.warning('กรุณาระบุเหตุผลในการยกเลิก');
    return;
  }
  
  const btn = document.getElementById('cancel-submit');
  btn.disabled = true;
  btn.textContent = '⏳ กำลังยกเลิก...';
  
  const res = await API.leave.cancel(cancellingLeave.id, {
    cancel_reason: cancelReason
  });
  
  btn.disabled = false;
  btn.innerHTML = '<i data-icon="trash"></i> ยืนยันการยกเลิก';
  
  if (!res?.ok) {
    Toast.error(res?.data?.message || 'เกิดข้อผิดพลาด');
    return;
  }
  
  Toast.success('ยกเลิกการลาสำเร็จ <i data-icon="check"></i>');
  closeCancelModal();
  loadAll();
}

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "calculateDays", { configurable: true, get: () => calculateDays, set: (v) => { calculateDays = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeCancelModal", { configurable: true, get: () => closeCancelModal, set: (v) => { closeCancelModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeEditModal", { configurable: true, get: () => closeEditModal, set: (v) => { closeEditModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeForceLeave", { configurable: true, get: () => closeForceLeave, set: (v) => { closeForceLeave = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "doReview", { configurable: true, get: () => doReview, set: (v) => { doReview = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtLeaveDates", { configurable: true, get: () => fmtLeaveDates, set: (v) => { fmtLeaveDates = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "isNonConsecutive", { configurable: true, get: () => isNonConsecutive, set: (v) => { isNonConsecutive = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "leaveDayCount", { configurable: true, get: () => leaveDayCount, set: (v) => { leaveDayCount = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadUsers", { configurable: true, get: () => loadUsers, set: (v) => { loadUsers = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openCancelModal", { configurable: true, get: () => openCancelModal, set: (v) => { openCancelModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openEditModal", { configurable: true, get: () => openEditModal, set: (v) => { openEditModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openForceLeave", { configurable: true, get: () => openForceLeave, set: (v) => { openForceLeave = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setEditDur", { configurable: true, get: () => setEditDur, set: (v) => { setEditDur = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setEditPeriod", { configurable: true, get: () => setEditPeriod, set: (v) => { setEditPeriod = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setEditType", { configurable: true, get: () => setEditType, set: (v) => { setEditType = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setFlDur", { configurable: true, get: () => setFlDur, set: (v) => { setFlDur = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setFlPeriod", { configurable: true, get: () => setFlPeriod, set: (v) => { setFlPeriod = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setFlType", { configurable: true, get: () => setFlType, set: (v) => { setFlType = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "submitCancelLeave", { configurable: true, get: () => submitCancelLeave, set: (v) => { submitCancelLeave = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "submitEditLeave", { configurable: true, get: () => submitEditLeave, set: (v) => { submitEditLeave = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "submitForceLeave", { configurable: true, get: () => submitForceLeave, set: (v) => { submitForceLeave = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updateEditQuotaImpact", { configurable: true, get: () => updateEditQuotaImpact, set: (v) => { updateEditQuotaImpact = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "filterLeaves", { configurable: true, get: () => filterLeaves, set: (v) => { filterLeaves = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtDateInner", { configurable: true, get: () => fmtDateInner, set: (v) => { fmtDateInner = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadAll", { configurable: true, get: () => loadAll, set: (v) => { loadAll = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadAvatars", { configurable: true, get: () => loadAvatars, set: (v) => { loadAvatars = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderLeaves", { configurable: true, get: () => renderLeaves, set: (v) => { renderLeaves = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updateStats", { configurable: true, get: () => updateStats, set: (v) => { updateStats = v; } }); } catch (e) {}
})();
