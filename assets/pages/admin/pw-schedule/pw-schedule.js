// admin/pw-schedule — page script, extracted from admin/pw-schedule.html.
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
const me = Auth.getUser();
if (!me || !['super_admin','sm_admin','dev_sm'].includes(me.role)) {
  alert('Admin only');
  location.href = '../dashboard.html';
}
Layout.render('pw-schedule');
if (window.AdminNav?.render) AdminNav.render('admin-nav-mount', 'pw-schedule');

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const toast = (msg, type='info') => {
  if (window.Toast?.show)  return window.Toast.show(msg, type);
  if (window.showToast)    return window.showToast(msg, type);
  alert(msg);
};

let leadList = [10, 5];

const fmtRoundRange = (roundKey) => {
  if (!roundKey) return '—';
  const [y, mo, da] = roundKey.split('-').map(Number);
  const d0 = new Date(y, mo - 1, da);
  const d1 = new Date(d0.getTime() + 86400000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d0.getDate())} ${d0.toLocaleString('en',{month:'short'})} → ${pad(d1.getDate())} ${d1.toLocaleString('en',{month:'short'})} ${d1.getFullYear()}`;
};

const renderLeads = () => {
  $('lead-chips').innerHTML = leadList.length
    ? leadList.map(n => `
        <div class="lead-chip">
          <span>${n} นาที</span>
          <button data-rm="${n}" title="Remove">×</button>
        </div>
      `).join('')
    : '<div class="cfg-hint" style="margin:0">ยังไม่มี lead time — ระบบจะใช้ค่าพื้นฐาน 10 และ 5 นาที</div>';
};

$('lead-chips').addEventListener('click', (e) => {
  const rm = e.target.dataset?.rm;
  if (rm == null) return;
  leadList = leadList.filter(v => v !== Number(rm));
  renderLeads();
});

$('lead-add-btn').addEventListener('click', () => {
  const v = Number($('lead-input').value);
  if (!v || v <= 0 || v > 120) return toast('ใส่ค่าเป็นตัวเลข 1–120', 'error');
  if (leadList.includes(v)) return toast('มีค่านี้แล้ว', 'error');
  leadList.push(v);
  leadList.sort((a,b) => b - a);
  $('lead-input').value = '';
  renderLeads();
});

$('f-sound').addEventListener('change', (e) => {
  $('f-sound-label').textContent = e.target.checked ? 'เปิด' : 'ปิด';
});

const applyTeamupMode = (mode) => {
  $('f-teamup-token-row').style.display = mode === 'api' ? '' : 'none';
};

const loadConfig = async () => {
  const r = await API.pwSchedule.getConfig();
  const cfg = r?.data?.data || {};
  $('f-webhook').value     = cfg.google_chat_webhook || '';
  $('f-n8n-webhook').value = cfg.n8n_sync_webhook    || '';
  $('f-n8n-secret').value  = cfg.n8n_sync_secret     || '';
  $('f-teamup-key').value   = cfg.teamup_calendar_key || '';
  $('f-teamup-token').value = cfg.teamup_api_token    || '';
  const savedMode = cfg.teamup_mode;
  const mode = ['share', 'ics', 'api'].includes(savedMode) ? savedMode : 'share';
  $('f-teamup-mode-share').checked = mode === 'share';
  $('f-teamup-mode-ics').checked   = mode === 'ics';
  $('f-teamup-mode-api').checked   = mode === 'api';
  applyTeamupMode(mode);
  leadList = Array.isArray(cfg.lead_minutes) && cfg.lead_minutes.length ? [...cfg.lead_minutes] : [10, 5];
  renderLeads();
  $('f-sound').checked = cfg.sound_enabled !== false;
  $('f-sound-label').textContent = $('f-sound').checked ? 'เปิด' : 'ปิด';
};

document.querySelectorAll('input[name="teamup-mode"]').forEach(r => {
  r.addEventListener('change', (e) => applyTeamupMode(e.target.value));
});

$('btn-save').addEventListener('click', async () => {
  $('btn-save').disabled = true;
  try {
    const teamupMode = document.querySelector('input[name="teamup-mode"]:checked')?.value || 'ics';
    const res = await API.pwSchedule.saveConfig({
      google_chat_webhook: $('f-webhook').value.trim(),
      n8n_sync_webhook:    $('f-n8n-webhook').value.trim(),
      n8n_sync_secret:     $('f-n8n-secret').value.trim(),
      teamup_calendar_key: $('f-teamup-key').value.trim(),
      teamup_mode:         teamupMode,
      teamup_api_token:    $('f-teamup-token').value.trim(),
      lead_minutes: leadList,
      sound_enabled: $('f-sound').checked,
    });
    if (!res?.ok) throw new Error(res?.data?.message || 'Save failed');
    toast('บันทึกแล้ว', 'success');
  } catch (e) {
    toast(e.message || 'บันทึกไม่สำเร็จ', 'error');
  } finally {
    $('btn-save').disabled = false;
  }
});

$('btn-reload').addEventListener('click', loadConfig);

$('btn-test').addEventListener('click', async () => {
  const url = $('f-webhook').value.trim();
  if (!url) return toast('กรอก Webhook URL ก่อน', 'error');
  // pick any round (prefer active)
  const r = await API.pwSchedule.active();
  const round = r?.data?.data?.round;
  if (!round) return toast('ยังไม่มีรอบ PW ให้ส่งทดสอบ', 'error');
  $('btn-test').disabled = true;
  try {
    const res = await API.pwSchedule.testNotify(round, url);
    if (!res?.ok) throw new Error(res?.data?.message || 'ส่งทดสอบไม่สำเร็จ');
    toast('ส่งทดสอบเรียบร้อย — ลองเช็คใน Google Chat', 'success');
  } catch (e) {
    toast(e.message || 'ส่งทดสอบไม่สำเร็จ', 'error');
  } finally {
    $('btn-test').disabled = false;
  }
});

$('btn-teamup-test').addEventListener('click', async () => {
  const key = $('f-teamup-key').value.trim();
  if (!key) return toast('ใส่ Calendar Key ก่อน', 'error');
  const mode  = document.querySelector('input[name="teamup-mode"]:checked')?.value || 'ics';
  const token = $('f-teamup-token').value.trim();
  if (mode === 'api' && !token) return toast('Mode = API ต้องใส่ token ด้วย', 'error');

  $('btn-teamup-test').disabled = true;
  $('teamup-test-hint').textContent = 'กำลังบันทึกและทดสอบ…';
  try {
    const save = await API.pwSchedule.saveConfig({
      teamup_calendar_key: key,
      teamup_mode:         mode,
      teamup_api_token:    token,
    });
    if (!save?.ok) throw new Error(save?.data?.message || 'Save failed');

    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    const pad = (n) => String(n).padStart(2, '0');
    const start = `${y}-${pad(m + 1)}-01`;
    const end   = `${y}-${pad(m + 1)}-${pad(new Date(y, m + 1, 0).getDate())}`;

    const res = await API.pwSchedule.teamup(start, end, true);
    if (!res?.ok) throw new Error(res?.data?.message || 'Fetch failed');
    const evs = res.data?.data?.events || [];
    $('teamup-test-hint').textContent =
      `ดึงได้ ${evs.length} events (${start} → ${end}) · mode: ${res.data?.data?.mode}`;
    toast(`ดึงได้ ${evs.length} events`, 'success');
  } catch (e) {
    $('teamup-test-hint').textContent = 'ล้มเหลว: ' + (e.message || e);
    toast(e.message || 'ทดสอบไม่สำเร็จ', 'error');
  } finally {
    $('btn-teamup-test').disabled = false;
  }
});

const loadHistory = async () => {
  const r = await API.pwSchedule.listRounds();
  const rounds = r?.data?.data || [];
  const mount = $('hist-mount');
  if (!rounds.length) {
    mount.innerHTML = '<div class="hist-empty">ยังไม่มีข้อมูล</div>';
    return;
  }
  mount.innerHTML = `
    <table class="hist-tbl">
      <thead>
        <tr>
          <th>Round</th><th>Tasks</th><th>Completed</th><th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${rounds.map(r => `
          <tr>
            <td>${esc(fmtRoundRange(r.round))}</td>
            <td>${r.total}</td>
            <td>${r.completed} / ${r.total}</td>
            <td>
              <span class="hist-badge ${r.all_done ? 'done' : 'open'}">
                ${r.all_done ? 'Done' : 'Open'}
              </span>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
};

(async () => {
  await loadConfig();
  await loadHistory();
})();

})();
