// admin/opensearch-config — page script, extracted from admin/opensearch-config.html.
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
Layout.render('opensearch-config');

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const toast = (m, ok = true) => (window.Toast ? (ok ? Toast.success(m) : Toast.error(m)) : alert(m));

const ICO = {
  plug:    '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
  edit:    '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/>',
  trash:   '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  check:   '<path d="M20 6 9 17l-5-5"/>',
  x:       '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  spinner: '<line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>',
};
const icon = (n, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">${ICO[n] || ''}</svg>`;

let _endpoints = [];
let _defaults  = { size: 200, max_size: 1000, default_time_range_min: 15 };
let _extraIdx  = [];   // chip list in the modal
let _authMode  = 'basic';

$('os-f-enabled').addEventListener('change', e => {
  $('os-enabled-lbl').textContent = e.target.checked ? 'Enabled' : 'Disabled';
});

$('os-modetabs').addEventListener('click', e => {
  const tab = e.target.closest('.os-modetab'); if (!tab) return;
  _setAuthMode(tab.dataset.mode);
});
function _setAuthMode(mode) {
  _authMode = mode;
  document.querySelectorAll('.os-modetab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
  $('os-osd-ver-field').style.display = mode === 'dashboards' ? '' : 'none';
}

// ── Chip input (extra index patterns) ─────────────────────────────────────
function _renderChips() {
  const wrap = $('os-idx-chips');
  wrap.querySelectorAll('.os-chip').forEach(c => c.remove());
  const inp = $('os-idx-in');
  _extraIdx.forEach((p, i) => {
    const el = document.createElement('span');
    el.className = 'os-chip';
    el.innerHTML = `${esc(p)}<button type="button" title="Remove" data-i="${i}">&times;</button>`;
    wrap.insertBefore(el, inp);
  });
}
$('os-idx-chips').addEventListener('click', e => {
  const btn = e.target.closest('button[data-i]');
  if (btn) { _extraIdx.splice(+btn.dataset.i, 1); _renderChips(); }
});
$('os-idx-in').addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    const v = e.target.value.trim();
    if (v && !_extraIdx.includes(v)) { _extraIdx.push(v); _renderChips(); }
    e.target.value = '';
  } else if (e.key === 'Backspace' && !e.target.value && _extraIdx.length) {
    _extraIdx.pop(); _renderChips();
  }
});

function skeletonRows(n = 3) {
  const cell = (w) => `<td><span class="os-skel" style="height:12px;width:${w}"></span></td>`;
  let out = '';
  for (let i = 0; i < n; i++) {
    out += `<tr>
      <td><span class="os-skel" style="height:22px;width:38px;border-radius:22px"></span></td>
      ${cell('180px')}${cell('260px')}${cell('180px')}${cell('80px')}${cell('90px')}
      <td><span class="os-skel" style="height:26px;width:60px"></span></td>
    </tr>`;
  }
  return out;
}

async function loadEndpoints() {
  $('os-tbody').innerHTML = skeletonRows();
  const res = await API.opensearch.config.list();
  if (!res || !res.ok) {
    $('os-tbody').innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--odanger);padding:28px">${esc(res?.data?.message || 'Load failed')}</td></tr>`;
    return;
  }
  const d = res.data?.data || {};
  _endpoints = d.endpoints || [];
  _defaults  = d.defaults  || _defaults;
  $('os-def-size').value  = _defaults.size;
  $('os-def-max').value   = _defaults.max_size;
  $('os-def-range').value = _defaults.default_time_range_min;

  if (!_endpoints.length) {
    $('os-tbody').innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--omut);padding:36px">No endpoints yet — click "+ Add endpoint"</td></tr>`;
    return;
  }

  $('os-tbody').innerHTML = _endpoints.map(e => `<tr data-id="${esc(e.id)}">
    <td>
      <span class="switch"><input type="checkbox" ${e.enabled ? 'checked' : ''}
        onchange="toggleEnabled('${esc(e.id)}', this.checked)"><span class="slider"></span></span>
    </td>
    <td><div class="os-name">${esc(e.name)} ${e.enabled ? '' : '<span class="os-badge off" style="margin-left:6px">off</span>'}<span class="os-badge" style="margin-left:6px" title="${e.auth_mode === 'dashboards' ? 'Login via /auth/login + /internal/search/opensearch' : 'HTTP Basic on REST API'}">${esc(e.auth_mode === 'dashboards' ? 'dashboards' : 'basic')}</span></div></td>
    <td><span class="os-url">${esc(e.base_url)}</span></td>
    <td><span class="os-idx">${esc(e.default_index_pattern)}</span>${(e.index_patterns || []).length > 1 ? ` <span style="font-size:11px;color:var(--omut)">+${e.index_patterns.length - 1}</span>` : ''}</td>
    <td style="font-family:ui-monospace,monospace;font-size:11.5px">${esc(e.username || '—')}</td>
    <td>
      <button class="os-btn" onclick="testRow('${esc(e.id)}', this)">${icon('plug')} test</button>
      <span class="os-test-res" id="tr-${esc(e.id)}"></span>
    </td>
    <td style="text-align:right;white-space:nowrap">
      <button class="os-btn icon" title="Edit" onclick="openModal('${esc(e.id)}')">${icon('edit')}</button>
      <button class="os-btn icon danger" title="Delete" onclick="deleteEndpoint('${esc(e.id)}')">${icon('trash')}</button>
    </td>
  </tr>`).join('');
}

async function toggleEnabled(id, enabled) {
  const res = await API.opensearch.config.update(id, { enabled });
  if (!res || !res.ok) { toast(res?.data?.message || 'Update failed', false); loadEndpoints(); return; }
  const e = _endpoints.find(x => x.id === id); if (e) e.enabled = enabled;
  toast(enabled ? 'Enabled' : 'Disabled');
}

async function testRow(id, btn) {
  const out = $('tr-' + id);
  btn.disabled = true; const orig = btn.innerHTML; btn.innerHTML = icon('spinner', 'spin') + ' …';
  const res = await API.opensearch.config.test({ id });
  btn.disabled = false; btn.innerHTML = orig;
  if (res?.ok) {
    const d = res.data?.data || {};
    out.innerHTML = `<span style="color:var(--ook)">${icon('check')} ${esc(d.status || 'ok')} · ${esc(d.number_of_nodes ?? '')} nodes · ${d.latency_ms || 0}ms</span>`;
  } else {
    out.innerHTML = `<span style="color:var(--odanger)">${icon('x')} ${esc(res?.data?.message || 'fail')}</span>`;
  }
}

function openModal(id) {
  $('os-modal').classList.add('active');
  _extraIdx = [];
  if (id) {
    const e = _endpoints.find(x => x.id === id);
    if (!e) return;
    $('os-modal-title').textContent = 'Edit endpoint';
    $('os-edit-id').value = id;
    $('os-f-name').value = e.name;
    $('os-f-url').value  = e.base_url;
    $('os-f-user').value = e.username || '';
    $('os-f-pass').value = '';
    $('os-f-idx').value  = e.default_index_pattern || '';
    $('os-f-dash').value = e.dashboards_url || '';
    $('os-f-osdver').value = e.osd_version || '2.7.0';
    $('os-f-enabled').checked = !!e.enabled;
    $('os-enabled-lbl').textContent = e.enabled ? 'Enabled' : 'Disabled';
    _extraIdx = (e.index_patterns || []).filter(p => p !== e.default_index_pattern);
    _setAuthMode(e.auth_mode === 'dashboards' ? 'dashboards' : 'basic');
  } else {
    $('os-modal-title').textContent = 'Add endpoint';
    $('os-edit-id').value = '';
    ['os-f-name','os-f-url','os-f-user','os-f-pass','os-f-idx','os-f-dash'].forEach(k => $(k).value = '');
    $('os-f-osdver').value = '2.7.0';
    $('os-f-enabled').checked = true;
    $('os-enabled-lbl').textContent = 'Enabled';
    _setAuthMode('basic');
  }
  _renderChips();
}
function closeModal() { $('os-modal').classList.remove('active'); }

function _formPayload() {
  return {
    name:                  $('os-f-name').value.trim(),
    base_url:              $('os-f-url').value.trim(),
    username:              $('os-f-user').value.trim(),
    password:              $('os-f-pass').value,
    default_index_pattern: $('os-f-idx').value.trim(),
    index_patterns:        _extraIdx.slice(),
    dashboards_url:        $('os-f-dash').value.trim(),
    auth_mode:             _authMode,
    osd_version:           ($('os-f-osdver').value.trim() || '2.7.0'),
    enabled:               $('os-f-enabled').checked,
  };
}

async function saveEndpoint() {
  const p = _formPayload();
  if (!p.name)                  { toast('Name is required', false); return; }
  if (!p.base_url)              { toast('Base URL is required', false); return; }
  if (!p.default_index_pattern) { toast('Default index pattern is required', false); return; }
  const id = $('os-edit-id').value;
  if (!id && !p.password) { toast('Password is required for new endpoints', false); return; }
  const btn = $('os-save-btn'); btn.disabled = true;
  const res = id ? await API.opensearch.config.update(id, p) : await API.opensearch.config.create(p);
  btn.disabled = false;
  if (!res || !res.ok) { toast(res?.data?.message || 'Save failed', false); return; }
  toast('Saved');
  closeModal();
  loadEndpoints();
}

async function testInModal() {
  const p = _formPayload();
  if (!p.base_url) { toast('Base URL required', false); return; }
  const btn = $('os-test-btn'); btn.disabled = true; btn.textContent = '⏳ Testing…';
  // Ad-hoc test uses whatever's currently in the form so admins can validate
  // before saving. When editing without a new password, fall back to the
  // stored entry via id so the existing password/credentials are reused.
  const body = (p.password || !$('os-edit-id').value)
    ? {
        base_url:              p.base_url,
        username:              p.username,
        password:              p.password,
        auth_mode:             p.auth_mode,
        osd_version:           p.osd_version,
        default_index_pattern: p.default_index_pattern,
      }
    : { id: $('os-edit-id').value };
  const res = await API.opensearch.config.test(body);
  btn.disabled = false; btn.innerHTML = '<i data-icon="plug"></i> Test connection';
  if (res?.ok) {
    const d = res.data?.data || {};
    toast(`OK · ${d.status || '?'} · ${d.number_of_nodes ?? '?'} nodes · ${d.latency_ms}ms`);
  } else {
    toast(res?.data?.message || 'Connection failed', false);
  }
}

async function deleteEndpoint(id) {
  const e = _endpoints.find(x => x.id === id);
  const ok = await confirmDialog(
    `Delete endpoint "${e?.name || id}"? Log viewer will lose access to this cluster.`,
    'Delete OpenSearch endpoint',
    { confirmText: 'Delete', cancelText: 'Cancel', variant: 'danger' }
  );
  if (!ok) return;
  const res = await API.opensearch.config.delete(id);
  if (!res || !res.ok) { toast(res?.data?.message || 'Delete failed', false); return; }
  toast('Deleted');
  loadEndpoints();
}

async function saveDefaults() {
  const p = {
    size: +$('os-def-size').value || 200,
    max_size: +$('os-def-max').value || 1000,
    default_time_range_min: +$('os-def-range').value || 15,
  };
  const res = await API.opensearch.config.updateDefaults(p);
  if (!res || !res.ok) { toast(res?.data?.message || 'Save failed', false); return; }
  toast('Defaults saved');
}

$('os-modal').addEventListener('click', e => { if (e.target === $('os-modal')) closeModal(); });
loadEndpoints();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "_formPayload", { configurable: true, get: () => _formPayload, set: (v) => { _formPayload = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_renderChips", { configurable: true, get: () => _renderChips, set: (v) => { _renderChips = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_setAuthMode", { configurable: true, get: () => _setAuthMode, set: (v) => { _setAuthMode = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeModal", { configurable: true, get: () => closeModal, set: (v) => { closeModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "deleteEndpoint", { configurable: true, get: () => deleteEndpoint, set: (v) => { deleteEndpoint = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadEndpoints", { configurable: true, get: () => loadEndpoints, set: (v) => { loadEndpoints = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openModal", { configurable: true, get: () => openModal, set: (v) => { openModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "saveDefaults", { configurable: true, get: () => saveDefaults, set: (v) => { saveDefaults = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "saveEndpoint", { configurable: true, get: () => saveEndpoint, set: (v) => { saveEndpoint = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "skeletonRows", { configurable: true, get: () => skeletonRows, set: (v) => { skeletonRows = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "testInModal", { configurable: true, get: () => testInModal, set: (v) => { testInModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "testRow", { configurable: true, get: () => testRow, set: (v) => { testRow = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toggleEnabled", { configurable: true, get: () => toggleEnabled, set: (v) => { toggleEnabled = v; } }); } catch (e) {}
})();
