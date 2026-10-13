// admin/scheduled-noti — page script, extracted from admin/scheduled-noti.html.
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

if (!Auth.requireAdmin()) {}
Layout.render('admin');

// ── State ─────────────────────────────────────────────────────────
let rows     = [];
let selDays  = ['mon','tue','wed','thu','fri']; // current selection in modal
let selDates = [];                              // monthly mode: array of int 1-31
let selExcludeDates = [];                       // weekly + "all" mode: dates to skip
let dayMode  = 'weekly';                        // 'weekly' | 'monthly'

// ── Build month-day grid (1-31) ────────────────────────────────────
(function buildDateGrid() {
  const grid = document.getElementById('date-grid');
  if (grid) {
    grid.innerHTML = Array.from({length: 31}, (_, i) =>
      `<button type="button" class="date-cell" data-d="${i+1}">${i+1}</button>`
    ).join('');
  }
  const excl = document.getElementById('exclude-grid');
  if (excl) {
    excl.innerHTML = Array.from({length: 31}, (_, i) =>
      `<button type="button" class="date-cell exclude" data-d="${i+1}">${i+1}</button>`
    ).join('');
  }
})();

document.getElementById('exclude-grid').addEventListener('click', function(e) {
  const cell = e.target.closest('.date-cell');
  if (!cell) return;
  cell.classList.toggle('active');
  selExcludeDates = Array.from(this.querySelectorAll('.date-cell.active'))
    .map(c => parseInt(c.dataset.d, 10))
    .sort((a, b) => a - b);
});

function setExcludeCells(dates) {
  selExcludeDates = Array.isArray(dates) ? dates.slice().sort((a, b) => a - b) : [];
  document.querySelectorAll('#exclude-grid .date-cell').forEach(c => {
    c.classList.toggle('active', selExcludeDates.includes(parseInt(c.dataset.d, 10)));
  });
}

function _updateExcludeVisibility() {
  const showExcl = dayMode === 'weekly' && selDays.includes('all');
  document.getElementById('exclude-sel').style.display = showExcl ? '' : 'none';
}

// ── Day-mode tab switching ─────────────────────────────────────────
document.getElementById('daymode-tabs').addEventListener('click', function(e) {
  const tab = e.target.closest('.daymode-tab');
  if (!tab) return;
  _setDayMode(tab.dataset.mode);
});

function _setDayMode(mode) {
  dayMode = mode;
  document.getElementById('f-day-mode').value = mode;
  document.querySelectorAll('.daymode-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.mode === mode));
  document.getElementById('day-sel').style.display  = mode === 'weekly'  ? '' : 'none';
  document.getElementById('date-sel').style.display = mode === 'monthly' ? '' : 'none';
  _updateExcludeVisibility();
}

// ── Month-day grid click ───────────────────────────────────────────
document.getElementById('date-grid').addEventListener('click', function(e) {
  const cell = e.target.closest('.date-cell');
  if (!cell) return;
  cell.classList.toggle('active');
  selDates = Array.from(this.querySelectorAll('.date-cell.active'))
    .map(c => parseInt(c.dataset.d, 10))
    .sort((a, b) => a - b);
});

function setDateCells(dates) {
  selDates = Array.isArray(dates) ? dates.slice().sort((a, b) => a - b) : [];
  document.querySelectorAll('#date-grid .date-cell').forEach(c => {
    c.classList.toggle('active', selDates.includes(parseInt(c.dataset.d, 10)));
  });
}

// ── Type tab switching ─────────────────────────────────────────────
document.getElementById('type-tabs').addEventListener('click', function(e) {
  const tab = e.target.closest('.type-tab');
  if (!tab) return;
  const type = tab.dataset.type;
  document.querySelectorAll('.type-tab').forEach(t => t.classList.toggle('active', t === tab));
  document.getElementById('f-type').value = type;
  _applyTypeUI(type);
});

function _applyTypeUI(type) {
  const isShift   = type === 'shift_summary';
  const isGrafana = type === 'grafana_paused';
  const isGeneral = !isShift && !isGrafana;
  document.getElementById('section-general').style.display = isGeneral ? '' : 'none';
  document.getElementById('section-shift').style.display   = isShift   ? '' : 'none';
  const gSec = document.getElementById('section-grafana');
  if (gSec) gSec.style.display = isGrafana ? '' : 'none';

  const webhookRequired = isShift || isGrafana;
  document.getElementById('webhook-label').textContent =
    webhookRequired ? 'Google Chat Webhook URLs *' : 'Google Chat Webhook URL (ไม่บังคับ)';
  document.getElementById('webhook-hint').textContent =
    isGrafana
      ? 'การ์ดสรุป Grafana paused alerts (ดึงสดตอนยิง) จะถูกส่งไปทุก room ตามเวลาที่กำหนด (dedup: วันละครั้ง)'
      : isShift
      ? 'SM Shift Handover card จะถูกส่งไปทุก webhook room ตามเวลาที่กำหนด (dedup: ส่งครั้งเดียวต่อวัน)'
      : 'เพิ่มได้หลาย room — ระบบจะยิงไปทุก webhook พร้อมกัน (dedup: ส่งครั้งเดียวต่อวันต่อ schedule)';
  // type tabs locked when editing (can't change type of existing schedule)
  const editId = document.getElementById('edit-id').value;
  document.getElementById('type-tabs').style.pointerEvents = editId ? 'none' : '';
  document.getElementById('type-tabs').style.opacity = editId ? '0.5' : '';
}

// ── Day pill click handler ─────────────────────────────────────────
document.getElementById('day-sel').addEventListener('click', function(e) {
  const pill = e.target.closest('.day-pill');
  if (!pill) return;
  const v = pill.dataset.v;

  if (v === 'all') {
    // Toggle "ทุกวัน"
    const isNowAll = !pill.classList.contains('active');
    document.querySelectorAll('#day-sel .day-pill').forEach(p => p.classList.remove('active'));
    if (isNowAll) {
      pill.classList.add('active');
      selDays = ['all'];
    } else {
      selDays = [];
    }
  } else {
    // Deselect "ทุกวัน" if individual day picked
    document.querySelector('#day-sel .day-pill[data-v="all"]').classList.remove('active');
    pill.classList.toggle('active');
    selDays = Array.from(document.querySelectorAll('#day-sel .day-pill.active')).map(p => p.dataset.v).filter(x => x !== 'all');
  }
  _updateExcludeVisibility();
});

// ── Enable toggle label ────────────────────────────────────────────
document.getElementById('f-enabled').addEventListener('change', function() {
  document.getElementById('f-enabled-lbl').textContent = this.checked ? 'เปิดใช้งาน' : 'ปิดใช้งาน';
});

// ── Multi-webhook helpers ──────────────────────────────────────────
function renderWebhookRows(urls) {
  if (!Array.isArray(urls) || !urls.length) urls = [''];
  const editId = document.getElementById('edit-id').value;
  document.getElementById('webhooks-list').innerHTML = urls.map((url, i) => `
    <div class="webhook-row">
      <input type="url" class="f-input webhook-url-input"
        placeholder="https://chat.googleapis.com/v1/spaces/…/messages?key=…"
        value="${escHtml(url)}" style="flex:1">
      ${editId ? `<button type="button" class="btn-chat-test" onclick="testWebhookRow(this)">💬 ทดสอบ</button>` : ''}
      ${urls.length > 1 ? `<button type="button" class="btn-webhook-remove" onclick="removeWebhookRow(this)" title="ลบ">✕</button>` : ''}
    </div>
  `).join('');
}

function addWebhookRow() {
  const current = Array.from(document.querySelectorAll('.webhook-url-input')).map(i => i.value);
  current.push('');
  renderWebhookRows(current);
}

function removeWebhookRow(btn) {
  btn.closest('.webhook-row').remove();
  const remaining = document.querySelectorAll('.webhook-url-input');
  if (remaining.length === 1) {
    renderWebhookRows([remaining[0].value]);
  }
}

async function testWebhookRow(btn) {
  const url    = btn.closest('.webhook-row').querySelector('.webhook-url-input').value.trim();
  const editId = document.getElementById('edit-id').value;
  const type   = document.getElementById('f-type').value;
  if (!url)    { Toast.warning('กรอก Webhook URL ก่อน'); return; }
  if (!editId) { Toast.warning('บันทึก schedule ก่อนนะ แล้วค่อยทดสอบ'); return; }
  btn.disabled = true; btn.textContent = '⏳';
  try {
    const res = type === 'shift_summary'
      ? await API.scheduledNoti.testShiftSummary(editId, url)
      : type === 'grafana_paused'
      ? await API.scheduledNoti.testGrafanaPaused(editId, url)
      : await API.post('/scheduled-noti/send-chat.php', { id: editId, test: true, webhook_url: url });
    if (res?.ok) Toast.success('ส่ง Google Chat test สำเร็จ <i data-icon="sparkles"></i>');
    else Toast.error(res?.data?.message || 'ส่งไม่สำเร็จ');
  } catch { Toast.error('เกิดข้อผิดพลาด'); }
  finally { btn.disabled = false; btn.innerHTML = '<i data-icon="message-circle"></i> ทดสอบ'; }
}

function getWebhookUrls() {
  return Array.from(document.querySelectorAll('.webhook-url-input'))
    .map(i => i.value.trim()).filter(Boolean);
}

// ── Message preview ────────────────────────────────────────────────
document.getElementById('f-message').addEventListener('input', function() {
  const box = document.getElementById('preview-box');
  const msg = this.value.trim();
  if (msg) {
    box.classList.add('visible');
    document.getElementById('preview-msg').textContent = msg;
  } else {
    box.classList.remove('visible');
  }
});

// ── Load schedules ─────────────────────────────────────────────────
async function load() {
  try {
    const res = await API.scheduledNoti.list(true);
    rows = (res?.ok && Array.isArray(res.data?.data)) ? res.data.data : [];
  } catch { rows = []; }
  render();
  // Fire the auto-noti panel load in parallel — its errors are independent.
  loadAutoNoti();
}

// ── Auto-noti panel (Pod Restart · Batch Monitor) ─────────────────
function _esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function loadAutoNoti() {
  await Promise.all([loadRestartToggles(), loadBatchToggles()]);
}

async function loadRestartToggles() {
  const wrap = document.getElementById('auto-restart-list');
  if (!wrap) return;
  try {
    const res = await API.restartMonitorWebhooks.list();
    const runways = res?.data?.data?.runways || [];
    if (!runways.length) {
      wrap.innerHTML = '<div class="auto-empty">ยังไม่มี runway (data/grafana-runways.json)</div>';
      return;
    }
    wrap.innerHTML = runways.map(renderRestartRow).join('');
  } catch (err) {
    wrap.innerHTML = `<div class="auto-loading" style="color:#dc2626">โหลดไม่สำเร็จ: ${_esc(err.message || err)}</div>`;
  }
}

function renderRestartRow(r) {
  const slug   = _esc(r.slug);
  const name   = _esc(r.name);
  const clust  = _esc(r.cluster || '');
  const url    = r.maskedUrl ? _esc(r.maskedUrl) : '<span style="color:#dc2626">(ยังไม่ได้ตั้ง webhook URL)</span>';
  const hasWh  = r.hasEnv || r.hasOverride;
  const badge  = !hasWh
    ? '<span class="auto-item-badge warn">no webhook</span>'
    : (r.enabled ? '<span class="auto-item-badge">on</span>'
                 : '<span class="auto-item-badge warn">off</span>');
  const togAttrs = hasWh
    ? `${r.enabled ? 'checked' : ''} onchange="toggleRestartRunway('${slug}', this.checked)"`
    : `disabled title="ตั้ง webhook URL ก่อน"`;
  const togOpacity = hasWh ? '' : 'style="opacity:.35"';
  return `<div class="auto-item">
    <div class="auto-item-main">
      <div class="auto-item-name">${name} <small>${clust}</small></div>
      <div class="auto-item-sub">${url}</div>
    </div>
    ${badge}
    <label class="tog" ${togOpacity}>
      <input type="checkbox" data-action="edit" ${togAttrs}>
      <span class="tog-slider"></span>
    </label>
  </div>`;
}

async function toggleRestartRunway(slug, enabled) {
  try {
    await API.restartMonitorWebhooks.setEnabled(slug, enabled);
    Toast.success(`${slug} · ${enabled ? 'เปิด noti' : 'ปิด noti'}`);
  } catch (err) {
    Toast.error(`อัปเดตไม่สำเร็จ: ${err.message || err}`);
    loadRestartToggles(); // rollback UI to server state
  }
}

async function loadBatchToggles() {
  const wrap = document.getElementById('auto-batch-list');
  if (!wrap) return;
  try {
    const res = await API.batchMonitorNoti.list();
    const servers = res?.data?.data?.servers || [];
    if (!servers.length) {
      wrap.innerHTML = '<div class="auto-empty">ยังไม่มี Jenkins server</div>';
      return;
    }
    wrap.innerHTML = servers.map(renderBatchRow).join('');
  } catch (err) {
    wrap.innerHTML = `<div class="auto-loading" style="color:#dc2626">โหลดไม่สำเร็จ: ${_esc(err.message || err)}</div>`;
  }
}

function renderBatchRow(s) {
  const id      = _esc(s.id);
  const label   = _esc(s.display || s.id);
  const url     = s.webhookMasked ? _esc(s.webhookMasked) : '<span style="color:#dc2626">(ยังไม่ได้ตั้ง webhook)</span>';
  const canTog  = s.srvEnabled && s.hasWebhook;
  const badge   = !s.srvEnabled ? '<span class="auto-item-badge muted">server ปิด</span>'
                : !s.hasWebhook ? '<span class="auto-item-badge warn">no webhook</span>'
                : s.enabled     ? '<span class="auto-item-badge">on</span>'
                                : '<span class="auto-item-badge warn">off</span>';
  const togAttrs = canTog
    ? `${s.enabled ? 'checked' : ''} onchange="toggleBatchServer('${id}', this.checked)"`
    : `disabled title="ตั้ง webhook URL ก่อน (จากหน้า batch-monitor-noti)"`;
  const togOpacity = canTog ? '' : 'style="opacity:.35"';
  return `<div class="auto-item">
    <div class="auto-item-main">
      <div class="auto-item-name">${label} <small>${id}</small></div>
      <div class="auto-item-sub">${url}</div>
    </div>
    ${badge}
    <label class="tog" ${togOpacity}>
      <input type="checkbox" data-action="edit" ${togAttrs}>
      <span class="tog-slider"></span>
    </label>
  </div>`;
}

async function toggleBatchServer(serverId, enabled) {
  try {
    await API.batchMonitorNoti.save(serverId, { enabled });
    Toast.success(`${serverId} · ${enabled ? 'เปิด noti' : 'ปิด noti'}`);
  } catch (err) {
    Toast.error(`อัปเดตไม่สำเร็จ: ${err.message || err}`);
    loadBatchToggles();
  }
}

// ── Render table ────────────────────────────────────────────────────
const DAY_TH = { all:'ทุกวัน', mon:'จ', tue:'อ', wed:'พ', thu:'พฤ', fri:'ศ', sat:'ส', sun:'อา' };

function render() {
  const tbody   = document.getElementById('sch-tbody');
  const emptyEl = document.getElementById('sch-empty');
  const tableWrap = document.getElementById('sch-table-wrap');
  const total   = rows.length;
  const enabled = rows.filter(r => r.enabled).length;

  document.getElementById('sch-count').textContent =
    total ? `${total} schedule · ${enabled} เปิดใช้งาน` : '0 schedule';

  if (!total) {
    tbody.innerHTML = '';
    tableWrap.style.display = 'none';
    emptyEl.style.display   = '';
    return;
  }

  tableWrap.style.display = '';
  emptyEl.style.display   = 'none';

  const SLOT_LABEL = {
    shift1_tdpk:'SHIFT#1 TDPK', shift1_wah:'SHIFT#1 W@H', shift1_oncall:'SHIFT#1 Oncall',
    shift2_wah:'SHIFT#2 W@H',   shift2_oncall:'SHIFT#2 Oncall',
    vacation:'Vacation', sick:'Sick Leave',
  };

  tbody.innerHTML = rows.map(r => {
    const isMonthly = r.day_mode === 'monthly';
    let dayHtml;
    if (isMonthly) {
      const dates = Array.isArray(r.dates) ? r.dates : [];
      dayHtml = dates.length
        ? dates.map(d => `<span class="day-chip" title="วันที่ ${d} ของเดือน">${d}</span>`).join('')
        : `<span style="font-size:10px;color:var(--text-muted)">—</span>`;
    } else {
      const days  = Array.isArray(r.days) ? r.days : [];
      const isAll = days.includes('all');
      dayHtml = isAll
        ? `<span class="day-chip all">ทุกวัน</span>`
        : days.map(d => `<span class="day-chip">${DAY_TH[d] || d}</span>`).join('');
      const excl = Array.isArray(r.exclude_dates) ? r.exclude_dates : [];
      if (isAll && excl.length) {
        dayHtml += excl.map(d => `<span class="day-chip exclude" title="ยกเว้นวันที่ ${d}">−${d}</span>`).join('');
      }
    }

    const isShift   = r.type === 'shift_summary';
    const isGrafana = r.type === 'grafana_paused';

    let msgHtml, actionHtml;
    if (isGrafana) {
      msgHtml    = `<span class="shift-badge"><i data-icon=\"pause\"></i> Paused Alerts</span>
        <span style="font-size:10px;color:var(--text-muted);margin-left:6px">Grafana paused-alerts digest (ดึงสด)</span>`;
      actionHtml = `<span class="chat-badge" title="ส่ง Grafana paused-alerts digest"><i data-icon=\"pause\"></i></span>`;
    } else if (isShift) {
      const todaySlots    = (r.shifts_today    || []).map(s => SLOT_LABEL[s] || s).join(', ');
      const tomorrowSlots = (r.shifts_tomorrow || []).map(s => SLOT_LABEL[s] || s).join(', ');
      msgHtml    = `<span class="shift-badge"><i data-icon=\"calendar\"></i> Shift Summary</span>
        <span style="font-size:10px;color:var(--text-muted);margin-left:6px">
          <i data-icon=\"moon\"></i> ${escHtml(todaySlots || '—')} &nbsp;/&nbsp; <i data-icon=\"sunrise\"></i> ${escHtml(tomorrowSlots || '—')}
        </span>`;
      actionHtml = `<span class="chat-badge" title="ส่ง Google Chat SM Shift Handover card"><i data-icon=\"calendar\"></i></span>`;
    } else {
      msgHtml    = `<span class="msg-preview" title="${escHtml(r.message)}">${escHtml(r.message)}</span>`;
      actionHtml = r.action_label
        ? `<span style="font-size:10px;color:var(--orange)"><i data-icon=\"play\"></i> ${escHtml(r.action_label)}</span>`
        : `<span style="font-size:10px;color:var(--text-muted)">—</span>`;
    }

    const chatBadge = r.has_chat_webhook
      ? `<span class="chat-badge" title="มี Google Chat Webhook"><i data-icon=\"message-circle\"></i></span>`
      : '';

    const previewBtn = (isShift || isGrafana) ? '' : `<button class="btn-preview" onclick="previewNoti('${r.id}')"><i data-icon=\"play\"></i></button>`;

    return `<tr>
      <td class="col-time"><div class="td-c"><span class="time-badge">⏰ ${escHtml(r.time)}</span></div></td>
      <td class="col-days"><div class="td-c"><div class="day-chips">${dayHtml}</div></div></td>
      <td class="col-msg"><div class="td-c" style="gap:4px;flex-wrap:wrap">${msgHtml}</div></td>
      <td class="col-action"><div class="td-c">${(isShift || isGrafana) ? '' : actionHtml} ${chatBadge}</div></td>
      <td class="col-status"><div class="td-c">
        <label class="tog" title="${r.enabled ? 'เปิด' : 'ปิด'}">
          <input type="checkbox" ${r.enabled ? 'checked' : ''} onchange="toggleEnabled('${r.id}', this.checked)">
          <span class="tog-slider"></span>
        </label>
      </div></td>
      <td class="col-btns"><div class="td-c">
        <div class="row-actions">
          ${previewBtn}
          <button class="btn-edit" onclick="openModal('${r.id}')">แก้ไข</button>
          <button class="btn-del"  onclick="del('${r.id}')">ลบ</button>
        </div>
      </div></td>
    </tr>`;
  }).join('');
}

// ── Toggle enabled ─────────────────────────────────────────────────
async function toggleEnabled(id, enabled) {
  const res = await API.scheduledNoti.update(id, { enabled });
  if (res?.ok) {
    const r = rows.find(r => r.id === id);
    if (r) r.enabled = enabled;
    render();
    Toast[enabled ? 'success' : 'warning'](enabled ? 'เปิดใช้งานแล้ว' : 'ปิดใช้งานแล้ว');
  } else {
    Toast.error(res?.data?.message || 'เกิดข้อผิดพลาด');
    render();
  }
}

// ── Custom confirm dialog ───────────────────────────────────────────
let _confirmResolve = null;

function showConfirm({ icon = '<i data-icon=\"trash\"></i>', title = 'ยืนยัน', desc = '', okText = 'ยืนยัน', okColor = '#ef4444' } = {}) {
  return new Promise(resolve => {
    _confirmResolve = resolve;
    document.getElementById('confirm-icon').textContent  = icon;
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-desc').textContent  = desc;
    const okBtn = document.getElementById('confirm-ok-btn');
    okBtn.textContent       = okText;
    okBtn.style.background  = okColor;
    document.getElementById('confirm-wrap').classList.add('open');
  });
}

document.getElementById('confirm-ok-btn').addEventListener('click', () => {
  document.getElementById('confirm-wrap').classList.remove('open');
  _confirmResolve?.(true);
});
document.getElementById('confirm-cancel-btn').addEventListener('click', () => {
  document.getElementById('confirm-wrap').classList.remove('open');
  _confirmResolve?.(false);
});
document.getElementById('confirm-wrap').addEventListener('click', function(e) {
  if (e.target === this) {
    this.classList.remove('open');
    _confirmResolve?.(false);
  }
});

// ── Delete ─────────────────────────────────────────────────────────
async function del(id) {
  const r   = rows.find(r => r.id === id);
  const ok  = await showConfirm({
    icon:  '<i data-icon=\"trash\"></i>',
    title: 'ลบ Schedule นี้?',
    desc:  `เวลา ${r?.time || id} — ${r?.message?.slice(0, 60) || ''}`,
    okText: 'ลบ',
  });
  if (!ok) return;
  const res = await API.scheduledNoti.delete(id);
  if (res?.ok) {
    rows = rows.filter(r => r.id !== id);
    render();
    Toast.success('ลบแล้ว');
  } else {
    Toast.error(res?.data?.message || 'ลบไม่ได้');
  }
}

// ── Preview popup ───────────────────────────────────────────────────
function previewNoti(id) {
  const r = rows.find(r => r.id === id);
  if (!r) return;
  if (typeof NotiScheduler === 'undefined') {
    if (!document.getElementById('snoti-script')) {
      const s   = document.createElement('script');
      s.id      = 'snoti-script';
      s.src     = '../assets/js/noti-scheduler.js?v=20260902';
      s.onload  = () => _doPreviewDirect(r);
      document.head.appendChild(s);
    } else {
      setTimeout(() => _doPreviewDirect(r), 200);
    }
    return;
  }
  _doPreviewDirect(r);
}

function _doPreviewDirect(r) {
  if (typeof NotiScheduler?.ensureOverlay === 'function') NotiScheduler.ensureOverlay();
  // Manually populate the snoti overlay (mirrors _showModal logic)
  const overlay = document.getElementById('snoti-overlay');
  if (!overlay) { Toast.warning('โหลด preview ไม่สำเร็จ ลองรีเฟรช'); return; }

  document.getElementById('snoti-msg').textContent  = r.message;
  document.getElementById('snoti-foot').textContent = `⏰ ${r.time} น. (Preview)`;

  const btnGo = document.getElementById('snoti-btn-go');
  if (r.action_label && r.action_url) {
    btnGo.textContent   = r.action_label;
    btnGo.style.display = '';
    btnGo.onclick       = () => overlay.classList.remove('open');
  } else {
    btnGo.style.display = 'none';
  }

  overlay.classList.add('open');
  const bell = document.getElementById('snoti-bell');
  if (bell) { bell.classList.remove('ring'); void bell.offsetWidth; bell.classList.add('ring'); }
}

// ── Modal helpers ──────────────────────────────────────────────────
function setDayPills(days) {
  const isAll = days.includes('all');
  selDays = days;
  document.querySelectorAll('#day-sel .day-pill').forEach(p => {
    const v = p.dataset.v;
    p.classList.toggle('active',
      v === 'all' ? isAll : (!isAll && days.includes(v))
    );
  });
}

function _setTypeTabs(type) {
  document.querySelectorAll('.type-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.type === type)
  );
  document.getElementById('f-type').value = type;
  _applyTypeUI(type);
}

function _setShiftChecks(name, values) {
  document.querySelectorAll(`input[name="${name}"]`).forEach(cb => {
    cb.checked = Array.isArray(values) && values.includes(cb.value);
  });
}

function _getShiftChecks(name) {
  return Array.from(document.querySelectorAll(`input[name="${name}"]:checked`)).map(cb => cb.value);
}

function openModal(id) {
  document.getElementById('modal-wrap').classList.add('open');
  document.getElementById('preview-box').classList.remove('visible');

  if (id) {
    const r = rows.find(r => r.id === id);
    if (!r) return;
    const type = r.type || 'general';
    document.getElementById('md-icon').innerHTML       = type === 'shift_summary' ? '<i data-icon=\"calendar\"></i>' : (type === 'grafana_paused' ? '<i data-icon=\"pause\"></i>' : '<i data-icon=\"pencil\"></i>');
    document.getElementById('md-title').textContent      = 'แก้ไข Schedule';
    document.getElementById('edit-id').value             = id;
    document.getElementById('f-time').value              = r.time;
    document.getElementById('f-message').value           = r.message || '';
    document.getElementById('f-action-label').value      = r.action_label || '';
    document.getElementById('f-action-url').value        = r.action_url   || '';
    const existingWebhooks = r.google_chat_webhooks || (r.google_chat_webhook ? [r.google_chat_webhook] : ['']);
    renderWebhookRows(existingWebhooks);
    document.getElementById('f-enabled').checked         = !!r.enabled;
    document.getElementById('f-enabled-lbl').textContent = r.enabled ? 'เปิดใช้งาน' : 'ปิดใช้งาน';
    const mode = r.day_mode === 'monthly' ? 'monthly' : 'weekly';
    _setDayMode(mode);
    setDayPills(Array.isArray(r.days) ? r.days : ['mon','tue','wed','thu','fri']);
    setDateCells(Array.isArray(r.dates) ? r.dates : []);
    setExcludeCells(Array.isArray(r.exclude_dates) ? r.exclude_dates : []);
    _updateExcludeVisibility();
    _setTypeTabs(type);
    if (type === 'shift_summary') {
      _setShiftChecks('shifts_today',    r.shifts_today    || []);
      _setShiftChecks('shifts_tomorrow', r.shifts_tomorrow || []);
    } else if (r.message) {
      document.getElementById('preview-box').classList.add('visible');
      document.getElementById('preview-msg').textContent = r.message;
    }
  } else {
    document.getElementById('md-icon').innerHTML       = '<i data-icon=\"bell\"></i>';
    document.getElementById('md-title').textContent      = 'เพิ่ม Schedule ใหม่';
    document.getElementById('edit-id').value             = '';
    document.getElementById('f-time').value              = '';
    document.getElementById('f-message').value           = '';
    document.getElementById('f-action-label').value      = '';
    document.getElementById('f-action-url').value        = '';
    renderWebhookRows(['']);
    document.getElementById('f-enabled').checked         = true;
    document.getElementById('f-enabled-lbl').textContent = 'เปิดใช้งาน';
    _setDayMode('weekly');
    setDayPills(['mon','tue','wed','thu','fri']);
    setDateCells([]);
    setExcludeCells([]);
    _updateExcludeVisibility();
    _setTypeTabs('general');
    _setShiftChecks('shifts_today',    []);
    _setShiftChecks('shifts_tomorrow', []);
  }
}

function closeModal() {
  document.getElementById('modal-wrap').classList.remove('open');
}

// ── Save ───────────────────────────────────────────────────────────
async function save() {
  const time   = document.getElementById('f-time').value.trim();
  const type   = document.getElementById('f-type').value;

  if (!time) { Toast.warning('กรุณาระบุเวลา'); return; }
  if (dayMode === 'weekly'  && !selDays.length)  { Toast.warning('กรุณาเลือกอย่างน้อย 1 วัน'); return; }
  if (dayMode === 'monthly' && !selDates.length) { Toast.warning('กรุณาเลือกอย่างน้อย 1 วันที่ของเดือน'); return; }

  if (type === 'general') {
    const message = document.getElementById('f-message').value.trim();
    if (!message) { Toast.warning('กรุณาระบุข้อความ'); return; }
  }

  const savePayload = {
    type,
    time,
    day_mode:            dayMode,
    days:                dayMode === 'weekly'  ? selDays  : [],
    dates:               dayMode === 'monthly' ? selDates : [],
    exclude_dates:       (dayMode === 'weekly' && selDays.includes('all')) ? selExcludeDates : [],
    message:             type === 'general' ? document.getElementById('f-message').value.trim() : '',
    action_label:        type === 'general' ? document.getElementById('f-action-label').value.trim() : '',
    action_url:          type === 'general' ? document.getElementById('f-action-url').value.trim()   : '',
    google_chat_webhooks: getWebhookUrls(),
    enabled:             document.getElementById('f-enabled').checked,
  };

  if (type === 'shift_summary') {
    savePayload.shifts_today    = _getShiftChecks('shifts_today');
    savePayload.shifts_tomorrow = _getShiftChecks('shifts_tomorrow');
  }

  const editId = document.getElementById('edit-id').value;
  const btn    = document.getElementById('btn-save');
  btn.disabled    = true;
  btn.textContent = '⏳ กำลังบันทึก…';

  try {
    const res = editId
      ? await API.scheduledNoti.update(editId, savePayload)
      : await API.scheduledNoti.create(savePayload);

    if (!res?.ok) throw new Error(res?.data?.message || 'เกิดข้อผิดพลาด');

    Toast.success(editId ? 'บันทึกการแก้ไขแล้ว' : 'เพิ่ม Schedule สำเร็จ');
    closeModal();
    await load();
  } catch(err) {
    Toast.error(err.message);
  } finally {
    btn.disabled    = false;
    btn.innerHTML = '<i data-icon=\"save\"></i> บันทึก';
  }
}


// ── Event listeners ────────────────────────────────────────────────
document.getElementById('btn-add').addEventListener('click', () => openModal());
document.getElementById('btn-save').addEventListener('click', save);
document.getElementById('btn-cancel').addEventListener('click', closeModal);
document.getElementById('modal-wrap').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});

load();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "_applyTypeUI", { configurable: true, get: () => _applyTypeUI, set: (v) => { _applyTypeUI = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_doPreviewDirect", { configurable: true, get: () => _doPreviewDirect, set: (v) => { _doPreviewDirect = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_esc", { configurable: true, get: () => _esc, set: (v) => { _esc = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_getShiftChecks", { configurable: true, get: () => _getShiftChecks, set: (v) => { _getShiftChecks = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_setDayMode", { configurable: true, get: () => _setDayMode, set: (v) => { _setDayMode = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_setShiftChecks", { configurable: true, get: () => _setShiftChecks, set: (v) => { _setShiftChecks = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_setTypeTabs", { configurable: true, get: () => _setTypeTabs, set: (v) => { _setTypeTabs = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_updateExcludeVisibility", { configurable: true, get: () => _updateExcludeVisibility, set: (v) => { _updateExcludeVisibility = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "addWebhookRow", { configurable: true, get: () => addWebhookRow, set: (v) => { addWebhookRow = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeModal", { configurable: true, get: () => closeModal, set: (v) => { closeModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "del", { configurable: true, get: () => del, set: (v) => { del = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "getWebhookUrls", { configurable: true, get: () => getWebhookUrls, set: (v) => { getWebhookUrls = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "load", { configurable: true, get: () => load, set: (v) => { load = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadAutoNoti", { configurable: true, get: () => loadAutoNoti, set: (v) => { loadAutoNoti = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadBatchToggles", { configurable: true, get: () => loadBatchToggles, set: (v) => { loadBatchToggles = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadRestartToggles", { configurable: true, get: () => loadRestartToggles, set: (v) => { loadRestartToggles = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openModal", { configurable: true, get: () => openModal, set: (v) => { openModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "previewNoti", { configurable: true, get: () => previewNoti, set: (v) => { previewNoti = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "removeWebhookRow", { configurable: true, get: () => removeWebhookRow, set: (v) => { removeWebhookRow = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "render", { configurable: true, get: () => render, set: (v) => { render = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderBatchRow", { configurable: true, get: () => renderBatchRow, set: (v) => { renderBatchRow = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderRestartRow", { configurable: true, get: () => renderRestartRow, set: (v) => { renderRestartRow = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderWebhookRows", { configurable: true, get: () => renderWebhookRows, set: (v) => { renderWebhookRows = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "save", { configurable: true, get: () => save, set: (v) => { save = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setDateCells", { configurable: true, get: () => setDateCells, set: (v) => { setDateCells = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setDayPills", { configurable: true, get: () => setDayPills, set: (v) => { setDayPills = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setExcludeCells", { configurable: true, get: () => setExcludeCells, set: (v) => { setExcludeCells = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "showConfirm", { configurable: true, get: () => showConfirm, set: (v) => { showConfirm = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "testWebhookRow", { configurable: true, get: () => testWebhookRow, set: (v) => { testWebhookRow = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toggleBatchServer", { configurable: true, get: () => toggleBatchServer, set: (v) => { toggleBatchServer = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toggleEnabled", { configurable: true, get: () => toggleEnabled, set: (v) => { toggleEnabled = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toggleRestartRunway", { configurable: true, get: () => toggleRestartRunway, set: (v) => { toggleRestartRunway = v; } }); } catch (e) {}
})();
