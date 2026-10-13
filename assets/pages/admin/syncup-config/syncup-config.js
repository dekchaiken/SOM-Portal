// admin/syncup-config — page script, extracted from admin/syncup-config.html.
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

// ── Local config state ────────────────────────────────────────────
let cfg = { morning: {}, evening: {} };

const DAY_KEYS = ['all','mon','tue','wed','thu','fri','sat','sun'];
let selDays = { morning: ['mon','tue','wed','thu','fri'], evening: ['mon','tue','wed','thu','fri'] };

// ── Load config ───────────────────────────────────────────────────
async function loadConfig() {
  const res = await API.syncup.getConfig();
  if (!res?.ok) { Toast.error('โหลด config ไม่สำเร็จ'); return; }
  cfg = res.data?.data ?? { morning: {}, evening: {} };
  populateForm('morning', cfg.morning ?? {});
  populateForm('evening', cfg.evening ?? {});
}

function populateForm(shift, s) {
  document.getElementById(`time-${shift}`).value    = s.time    ?? (shift === 'morning' ? '08:45' : '20:45');
  document.getElementById(`msg-${shift}`).value     = s.popup_message ?? '';
  const enabled = !!s.enabled;
  document.getElementById(`enabled-${shift}`).checked = enabled;
  document.getElementById(`tog-lbl-${shift}`).textContent = enabled ? 'เปิดใช้งาน' : 'ปิดใช้งาน';
  document.getElementById(`sub-${shift}`).textContent =
    `${s.time ?? '—'} น. · ${enabled ? 'เปิด' : 'ปิด'}`;

  // Days
  const days = Array.isArray(s.days) ? s.days : ['mon','tue','wed','thu','fri'];
  selDays[shift] = days;
  renderDayPills(shift, days);

  // Webhooks
  renderWebhooks(shift, s.google_chat_webhooks ?? []);
}

// ── Day pills ─────────────────────────────────────────────────────
function renderDayPills(shift, days) {
  const isAll = days.includes('all');
  document.querySelectorAll(`#days-${shift} .day-pill`).forEach(p => {
    const v = p.dataset.v;
    p.classList.toggle('active', v === 'all' ? isAll : (!isAll && days.includes(v)));
  });
}

['morning','evening'].forEach(shift => {
  document.getElementById(`days-${shift}`).addEventListener('click', e => {
    const pill = e.target.closest('.day-pill');
    if (!pill) return;
    const v = pill.dataset.v;
    if (v === 'all') {
      const isNowAll = !pill.classList.contains('active');
      document.querySelectorAll(`#days-${shift} .day-pill`).forEach(p => p.classList.remove('active'));
      if (isNowAll) { pill.classList.add('active'); selDays[shift] = ['all']; }
      else selDays[shift] = [];
    } else {
      document.querySelector(`#days-${shift} .all-pill`).classList.remove('active');
      pill.classList.toggle('active');
      selDays[shift] = Array.from(document.querySelectorAll(`#days-${shift} .day-pill.active`))
        .map(p => p.dataset.v).filter(x => x !== 'all');
    }
  });
});

// ── Toggle ────────────────────────────────────────────────────────
function onToggle(shift, el) {
  document.getElementById(`tog-lbl-${shift}`).textContent = el.checked ? 'เปิดใช้งาน' : 'ปิดใช้งาน';
}

// ── Webhooks ──────────────────────────────────────────────────────
function renderWebhooks(shift, urls) {
  if (!Array.isArray(urls) || !urls.length) urls = [''];
  document.getElementById(`webhooks-${shift}`).innerHTML = urls.map((url, i) => `
    <div class="webhook-row">
      <input type="url" class="f-input wh-input" data-shift="${shift}"
        placeholder="https://chat.googleapis.com/v1/spaces/…"
        value="${escHtml(url)}" style="flex:1">
      ${urls.length > 1
        ? `<button type="button" class="btn-wh-remove" onclick="removeWebhook(this)">✕</button>`
        : ''}
    </div>
  `).join('');
}

function addWebhook(shift) {
  const cur = Array.from(document.querySelectorAll(`#webhooks-${shift} .wh-input`)).map(i => i.value);
  cur.push('');
  renderWebhooks(shift, cur);
}

function removeWebhook(btn) {
  const row   = btn.closest('.webhook-row');
  const wrap  = row.parentElement;
  const shift = row.querySelector('.wh-input').dataset.shift;
  row.remove();
  const remaining = Array.from(wrap.querySelectorAll('.wh-input')).map(i => i.value);
  if (!remaining.length) renderWebhooks(shift, ['']);
  else if (remaining.length === 1) renderWebhooks(shift, remaining);
}

function getWebhooks(shift) {
  return Array.from(document.querySelectorAll(`#webhooks-${shift} .wh-input`))
    .map(i => i.value.trim()).filter(Boolean);
}

// ── Save shift ────────────────────────────────────────────────────
async function saveShift(shift) {
  if (!selDays[shift].length) { Toast.warning('กรุณาเลือกอย่างน้อย 1 วัน'); return; }
  const time = document.getElementById(`time-${shift}`).value;
  if (!time) { Toast.warning('กรุณาระบุเวลา'); return; }

  const payload = {
    [shift]: {
      time,
      days:                 selDays[shift],
      enabled:              document.getElementById(`enabled-${shift}`).checked,
      popup_message:        document.getElementById(`msg-${shift}`).value.trim(),
      google_chat_webhooks: getWebhooks(shift),
    }
  };

  const res = await API.syncup.saveConfig(payload);
  if (res?.ok) {
    cfg[shift] = res.data?.data?.[shift] ?? cfg[shift];
    document.getElementById(`sub-${shift}`).textContent =
      `${time} น. · ${payload[shift].enabled ? 'เปิด' : 'ปิด'}`;
    Toast.success('บันทึกแล้ว <i data-icon="check-circle"></i>');
  } else {
    Toast.error(res?.data?.message || 'บันทึกไม่สำเร็จ');
  }
}

// ── Test notify ───────────────────────────────────────────────────
async function testNotify(shift) {
  const btn = document.getElementById(`test-${shift}`);
  btn.disabled = true; btn.textContent = '⏳';
  try {
    const res = await API.syncup.testNotify(shift);
    if (res?.ok) Toast.success('ส่ง test สำเร็จ <i data-icon="sparkles"></i>');
    else Toast.error(res?.data?.message || 'ส่งไม่สำเร็จ');
  } catch { Toast.error('เกิดข้อผิดพลาด'); }
  finally { btn.disabled = false; btn.innerHTML = '<i data-icon="message-circle"></i> ทดสอบ Chat'; }
}

// ── Load log ──────────────────────────────────────────────────────
async function loadLog() {
  const res   = await API.syncup.getRange(14);
  const tbody = document.getElementById('log-tbody');

  if (!res?.ok) {
    tbody.innerHTML = `<tr><td colspan="7" class="log-empty">โหลดไม่สำเร็จ</td></tr>`;
    return;
  }

  const map  = res.data?.data ?? {};
  const rows = [];

  for (let i = 0; i < 14; i++) {
    const d   = new Date(); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const rec = map[key];
    ['morning','evening'].forEach(shift => {
      const e = rec?.[shift];
      if (e) rows.push({ date: key, shift, entry: e });
    });
  }

  document.getElementById('log-count').textContent =
    rows.length ? `${rows.length} รายการ` : '0 รายการ';

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="log-empty">ยังไม่มีประวัติ</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(r => {
    const { date, shift, entry } = r;
    const ts  = new Date(entry.uploaded_at);
    const tim = `${String(ts.getHours()).padStart(2,'0')}:${String(ts.getMinutes()).padStart(2,'0')} น.`;
    const chip = shift === 'morning'
      ? `<span class="shift-chip chip-m"><i data-icon="sunrise"></i> เช้า</span>`
      : `<span class="shift-chip chip-e"><i data-icon="moon"></i> เย็น</span>`;

    return `<tr>
      <td class="td-p">${date}</td>
      <td class="td-p">${chip}</td>
      <td class="td-p">
        <div class="thumb-sm" onclick="openLb('${escHtml(entry.image_url)}')">
          <img src="${escHtml(entry.image_url)}" alt="">
        </div>
      </td>
      <td class="td-p" style="color:var(--text)">${escHtml(entry.uploaded_by_name)}</td>
      <td class="td-p">${tim}</td>
      <td class="td-p">${entry.file_size_kb ?? '?'} KB</td>
      <td class="td-p">
        <button class="btn btn-ghost" style="font-size:9px;padding:2px 8px;color:#dc2626"
          onclick="delRecord('${date}','${shift}')">ลบ</button>
      </td>
    </tr>`;
  }).join('');
}

async function delRecord(date, shift) {
  if (!confirm(`ลบรูป ${shift} วันที่ ${date}?`)) return;
  const res = await API.syncup.deleteRecord(date, shift);
  if (res?.ok) { Toast.success('ลบแล้ว'); loadLog(); }
  else Toast.error(res?.data?.message || 'ลบไม่ได้');
}

// ── Lightbox ──────────────────────────────────────────────────────
function openLb(src) {
  document.getElementById('lb-img').src = src;
  document.getElementById('lb-wrap').classList.add('open');
}
function closeLb() { document.getElementById('lb-wrap').classList.remove('open'); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLb(); });

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Init ──────────────────────────────────────────────────────────
loadConfig();
loadLog();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "addWebhook", { configurable: true, get: () => addWebhook, set: (v) => { addWebhook = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeLb", { configurable: true, get: () => closeLb, set: (v) => { closeLb = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "delRecord", { configurable: true, get: () => delRecord, set: (v) => { delRecord = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "escHtml", { configurable: true, get: () => escHtml, set: (v) => { escHtml = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "getWebhooks", { configurable: true, get: () => getWebhooks, set: (v) => { getWebhooks = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadConfig", { configurable: true, get: () => loadConfig, set: (v) => { loadConfig = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadLog", { configurable: true, get: () => loadLog, set: (v) => { loadLog = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "onToggle", { configurable: true, get: () => onToggle, set: (v) => { onToggle = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openLb", { configurable: true, get: () => openLb, set: (v) => { openLb = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "populateForm", { configurable: true, get: () => populateForm, set: (v) => { populateForm = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "removeWebhook", { configurable: true, get: () => removeWebhook, set: (v) => { removeWebhook = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderDayPills", { configurable: true, get: () => renderDayPills, set: (v) => { renderDayPills = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderWebhooks", { configurable: true, get: () => renderWebhooks, set: (v) => { renderWebhooks = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "saveShift", { configurable: true, get: () => saveShift, set: (v) => { saveShift = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "testNotify", { configurable: true, get: () => testNotify, set: (v) => { testNotify = v; } }); } catch (e) {}
})();
