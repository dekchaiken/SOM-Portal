// admin/grafana-sources — page script, extracted from admin/grafana-sources.html.
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
Layout.render('grafana-sources');

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const toast = (m, ok = true) => (window.Toast ? (ok ? Toast.success(m) : Toast.error(m)) : alert(m));

// ── lucide-style inline icons ──
const ICO = {
  plug:     '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
  edit:     '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/>',
  trash:    '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  check:    '<path d="M20 6 9 17l-5-5"/>',
  x:        '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  spinner:  '<line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>',
  plus:     '<path d="M5 12h14"/><path d="M12 5v14"/>',
};
const icon = (n, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">${ICO[n] || ''}</svg>`;

let _sources = [];
let _authMode = 'basic';

// ── Auth-mode tab switch ──
$('gs-authtabs').addEventListener('click', e => {
  const tab = e.target.closest('.gs-authtab'); if (!tab) return;
  _authMode = tab.dataset.auth;
  document.querySelectorAll('.gs-authtab').forEach(t => t.classList.toggle('active', t === tab));
  $('gs-token-field').style.display = _authMode === 'token' ? '' : 'none';
});
$('gs-f-enabled').addEventListener('change', e => {
  $('gs-enabled-lbl').textContent = e.target.checked ? 'เปิดใช้งาน' : 'ปิดใช้งาน';
});

// ── Color presets ──
const GS_PALETTE = ['#3b82f6','#0ea5e9','#a855f7','#10b981','#eab308','#f97316','#14b8a6','#ef4444'];
function renderSwatches() {
  $('gs-swatches').innerHTML = GS_PALETTE.map(c =>
    `<span class="gs-sw" style="background:${c}" data-c="${c}" onclick="pickColor('${c}')" title="${c}"></span>`).join('');
}
function pickColor(c) { $('gs-f-color').value = c; onColorInput(c); }
function onColorInput(v) {
  document.querySelectorAll('.gs-sw').forEach(sw =>
    sw.classList.toggle('sel', (sw.dataset.c || '').toLowerCase() === String(v).toLowerCase()));
}
renderSwatches();

function skeletonRows(n = 4) {
  const cell = (w) => `<td><span class="gs-skel" style="height:12px;width:${w}"></span></td>`;
  let out = '';
  for (let i = 0; i < n; i++) {
    out += `<tr>
      <td><span class="gs-skel" style="height:22px;width:38px;border-radius:22px"></span></td>
      <td><div style="display:flex;align-items:center;gap:9px"><span class="gs-skel" style="height:9px;width:9px;border-radius:50%"></span><span class="gs-skel" style="height:13px;width:110px"></span></div></td>
      ${cell('180px')}${cell('24px')}${cell('64px')}${cell('90px')}
      <td><span class="gs-skel" style="height:26px;width:60px"></span></td>
    </tr>`;
  }
  return out;
}

async function loadSources() {
  $('gs-tbody').innerHTML = skeletonRows();
  const res = await API.grafanaSources.list();
  if (!res || !res.ok) {
    $('gs-tbody').innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--gdanger);padding:28px">${esc(res?.data?.message || 'โหลดไม่สำเร็จ')}</td></tr>`;
    return;
  }
  const d = res.data?.data || {};
  _sources = d.sources || [];

  if (d.basicUser !== 'set') {
    $('gs-hint').innerHTML += '<br><b style="color:var(--gwarn)"><i data-icon=\"alert-triangle\"></i> GRAFANA_BASIC_USER/PASS ยังไม่ได้ตั้งใน .env</b> — source แบบ basic จะดึงไม่ได้';
  }

  if (!_sources.length) {
    $('gs-tbody').innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--gmut);padding:36px">ยังไม่มี source — กด “+ เพิ่ม Source”</td></tr>';
    return;
  }

  $('gs-tbody').innerHTML = _sources.map(s => {
    const authBadge = s.authMode === 'token'
      ? `<span class="gs-badge token">token${s.hasToken ? '' : ' <i data-icon=\"alert-triangle\"></i>'}</span>`
      : `<span class="gs-badge">basic</span>`;
    return `<tr data-slug="${esc(s.slug)}">
      <td>
        <span class="switch"><input type="checkbox" ${s.enabled ? 'checked' : ''}
          onchange="toggleEnabled('${esc(s.slug)}', this.checked)"><span class="slider"></span></span>
      </td>
      <td><div class="gs-name"><span class="gs-dot" style="background:${esc(s.color)}"></span>${esc(s.name)}
        ${s.enabled ? '' : '<span class="gs-badge off" style="margin-left:6px">ปิด</span>'}</div></td>
      <td><span class="gs-url">${esc(s.grafanaUrl)}</span></td>
      <td>${s.orgId}</td>
      <td>${authBadge}${s.authMode === 'token' && s.hasToken ? `<div class="gs-mask">${esc(s.maskedToken)}</div>` : ''}</td>
      <td><button class="gs-btn" onclick="testRow('${esc(s.slug)}', this)">${icon('plug')} test</button><span class="gs-test-res" id="tr-${esc(s.slug)}"></span></td>
      <td style="text-align:right;white-space:nowrap">
        <button class="gs-btn icon" title="แก้ไข" onclick="openModal('${esc(s.slug)}')">${icon('edit')}</button>
        <button class="gs-btn icon danger" title="ลบ" onclick="deleteSource('${esc(s.slug)}')">${icon('trash')}</button>
      </td>
    </tr>`;
  }).join('');
}

async function toggleEnabled(slug, enabled) {
  const res = await API.grafanaSources.update(slug, { enabled });
  if (!res || !res.ok) { toast(res?.data?.message || 'อัปเดตไม่สำเร็จ', false); loadSources(); return; }
  const s = _sources.find(x => x.slug === slug); if (s) s.enabled = enabled;
  toast(enabled ? 'เปิดใช้งานแล้ว' : 'ปิดแล้ว');
}

async function testRow(slug, btn) {
  const s = _sources.find(x => x.slug === slug); if (!s) return;
  const out = $('tr-' + slug);
  btn.disabled = true; const orig = btn.innerHTML; btn.innerHTML = icon('spinner', 'spin') + ' …';
  const res = await API.grafanaSources.test({ grafanaUrl: s.grafanaUrl, orgId: s.orgId, authMode: s.authMode, slug });
  btn.disabled = false; btn.innerHTML = orig;
  if (res?.ok) { out.innerHTML = `<span style="color:var(--gok)">${icon('check')} ${res.data?.data?.count ?? 0} paused</span>`; }
  else { out.innerHTML = `<span style="color:var(--gdanger)">${icon('x')} ${esc(res?.data?.message || 'fail')}</span>`; }
}

function openModal(slug) {
  $('gs-modal').classList.add('active');
  if (slug) {
    const s = _sources.find(x => x.slug === slug);
    if (!s) return;
    $('gs-modal-title').textContent = 'แก้ไข Source';
    $('gs-edit-slug').value = slug;
    $('gs-f-name').value = s.name;
    $('gs-f-url').value = s.grafanaUrl;
    $('gs-f-org').value = s.orgId;
    $('gs-f-color').value = /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : '#3b82f6';
    $('gs-f-enabled').checked = s.enabled;
    $('gs-enabled-lbl').textContent = s.enabled ? 'เปิดใช้งาน' : 'ปิดใช้งาน';
    _setAuth(s.authMode);
    $('gs-f-token').value = '';
    $('gs-token-mask').textContent = (s.authMode === 'token' && s.hasToken)
      ? 'ปัจจุบัน: ' + s.maskedToken + ' — เว้นว่างไว้เพื่อคงค่าเดิม' : '';
  } else {
    $('gs-modal-title').textContent = 'เพิ่ม Source';
    $('gs-edit-slug').value = '';
    $('gs-f-name').value = ''; $('gs-f-url').value = '';
    $('gs-f-org').value = ''; $('gs-f-color').value = '#3b82f6';
    $('gs-f-enabled').checked = true; $('gs-enabled-lbl').textContent = 'เปิดใช้งาน';
    _setAuth('basic');
    $('gs-f-token').value = ''; $('gs-token-mask').textContent = '';
  }
  onColorInput($('gs-f-color').value);
}
function closeModal() { $('gs-modal').classList.remove('active'); }

function _setAuth(mode) {
  _authMode = mode;
  document.querySelectorAll('.gs-authtab').forEach(t => t.classList.toggle('active', t.dataset.auth === mode));
  $('gs-token-field').style.display = mode === 'token' ? '' : 'none';
}

function _formPayload() {
  return {
    name:       $('gs-f-name').value.trim(),
    grafanaUrl: $('gs-f-url').value.trim(),
    orgId:      parseInt($('gs-f-org').value, 10) || 0,
    color:      $('gs-f-color').value,
    authMode:   _authMode,
    token:      $('gs-f-token').value.trim(),
    enabled:    $('gs-f-enabled').checked,
  };
}

async function saveSource() {
  const p = _formPayload();
  if (!p.name)       { toast('ใส่ชื่อ Source', false); return; }
  if (!p.grafanaUrl) { toast('ใส่ Grafana URL', false); return; }
  const slug = $('gs-edit-slug').value;
  const btn = $('gs-save-btn'); btn.disabled = true;
  const res = slug ? await API.grafanaSources.update(slug, p) : await API.grafanaSources.create(p);
  btn.disabled = false;
  if (!res || !res.ok) { toast(res?.data?.message || 'บันทึกไม่สำเร็จ', false); return; }
  toast('บันทึกแล้ว');
  closeModal();
  loadSources();
}

async function testInModal() {
  const p = _formPayload();
  if (!p.grafanaUrl) { toast('ใส่ Grafana URL ก่อน', false); return; }
  const btn = $('gs-test-btn'); btn.disabled = true; btn.textContent = '⏳ กำลังทดสอบ…';
  const body = { grafanaUrl: p.grafanaUrl, orgId: p.orgId, authMode: p.authMode, token: p.token };
  if (!body.token && $('gs-edit-slug').value) body.slug = $('gs-edit-slug').value; // reuse stored token
  const res = await API.grafanaSources.test(body);
  btn.disabled = false; btn.innerHTML = '<i data-icon=\"plug\"></i> ทดสอบการเชื่อมต่อ';
  if (res?.ok) toast(`เชื่อมต่อได้ · ${res.data?.data?.count ?? 0} paused`);
  else toast(res?.data?.message || 'เชื่อมต่อไม่ได้', false);
}

async function deleteSource(slug) {
  const s = _sources.find(x => x.slug === slug);
  const ok = await confirmDialog(
    `ลบ source "${s?.name || slug}" ออกจากการสแกน? (ไม่กระทบ Grafana — แค่เอาออกจากหน้า Paused Alerts)`,
    'ลบ Source',
    { confirmText: 'ลบ', cancelText: 'ยกเลิก', variant: 'danger' }
  );
  if (!ok) return;
  const res = await API.grafanaSources.delete(slug);
  if (!res || !res.ok) { toast(res?.data?.message || 'ลบไม่สำเร็จ', false); return; }
  toast('ลบแล้ว');
  loadSources();
}

$('gs-modal').addEventListener('click', e => { if (e.target === $('gs-modal')) closeModal(); });
loadSources();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "_formPayload", { configurable: true, get: () => _formPayload, set: (v) => { _formPayload = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_setAuth", { configurable: true, get: () => _setAuth, set: (v) => { _setAuth = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeModal", { configurable: true, get: () => closeModal, set: (v) => { closeModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "deleteSource", { configurable: true, get: () => deleteSource, set: (v) => { deleteSource = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadSources", { configurable: true, get: () => loadSources, set: (v) => { loadSources = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "onColorInput", { configurable: true, get: () => onColorInput, set: (v) => { onColorInput = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openModal", { configurable: true, get: () => openModal, set: (v) => { openModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "pickColor", { configurable: true, get: () => pickColor, set: (v) => { pickColor = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderSwatches", { configurable: true, get: () => renderSwatches, set: (v) => { renderSwatches = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "saveSource", { configurable: true, get: () => saveSource, set: (v) => { saveSource = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "skeletonRows", { configurable: true, get: () => skeletonRows, set: (v) => { skeletonRows = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "testInModal", { configurable: true, get: () => testInModal, set: (v) => { testInModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "testRow", { configurable: true, get: () => testRow, set: (v) => { testRow = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toggleEnabled", { configurable: true, get: () => toggleEnabled, set: (v) => { toggleEnabled = v; } }); } catch (e) {}
})();
