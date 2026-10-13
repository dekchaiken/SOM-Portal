// admin/ma-test-catalog — page script, extracted from admin/ma-test-catalog.html.
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
const _u = Auth.getUser();
if (!_u || !['super_admin','sm_admin','sm_lead','dev_sm'].includes(_u.role)) {
  Toast?.error?.('Admin/Lead only');
  setTimeout(() => location.replace('../dashboard.html'), 800);
}
if (_u && _u.team && _u.team !== 'sm' && !['super_admin','super_viewer'].includes(_u.role)) {
  Toast?.error?.('SM team only');
  setTimeout(() => location.replace('../dashboard.html'), 800);
}
Layout.render('admin');

// ── Populate selects ─────────────────────────────────────────
(function initSelects() {
  const fs = document.getElementById('f-service');
  const es = document.getElementById('e-service');
  MaTest.SERVICES.forEach(s => {
    fs.insertAdjacentHTML('beforeend', `<option value="${s}">${s}</option>`);
    es.insertAdjacentHTML('beforeend', `<option value="${s}">${s}</option>`);
  });
  const ft = document.getElementById('f-tool');
  const et = document.getElementById('e-tool');
  MaTest.TOOLS.forEach(t => {
    ft.insertAdjacentHTML('beforeend', `<option value="${t}">${t}</option>`);
    et.insertAdjacentHTML('beforeend', `<option value="${t}">${t}</option>`);
  });
  const ep = document.getElementById('e-priority');
  MaTest.PRIORITIES.forEach(p => ep.insertAdjacentHTML('beforeend', `<option value="${p}">${p}</option>`));
})();

// ── Usecases cache (source for linking) ──────────────────────
let usecases = [];        // full list from /ma-services/list.php
let usecaseById = {};     // id → usecase
let usecaseByName = {};   // normName → usecase

async function loadUsecases() {
  const res = await MaTest.api.listUsecases();
  if (!res?.success) {
    Toast?.error?.('โหลด usecases ไม่ได้: ' + (res?.message || ''));
    return;
  }
  usecases = res.data || [];
  usecaseById = {};
  usecaseByName = {};
  usecases.forEach(u => {
    usecaseById[u.id] = u;
    const k = MaTest.normName(u.service_name);
    if (k) usecaseByName[k] = u;
  });
}

// Usecase ids already accounted for in the catalog (explicit link OR name match).
// Used to hide already-covered usecases from the "+ New Service" picker so
// admins don't accidentally create duplicate catalog entries.
// `excludeCatalogId` skips contributions from that catalog row — pass the
// currently-editing row so its own name-match/link doesn't hide itself.
function getCoveredUsecaseIds(excludeCatalogId) {
  const covered = new Set();
  MaTest.state.catalog.forEach(it => {
    if (excludeCatalogId && it.id === excludeCatalogId) return;
    if (it.usecase_id) covered.add(Number(it.usecase_id));
    else {
      const nm = MaTest.normName(it.name);
      if (nm && usecaseByName[nm]) covered.add(usecaseByName[nm].id);
    }
  });
  return covered;
}

// Populate the editor's "Link from usecase" dropdown, hiding usecases that
// already have a catalog entry. `editingCatalogId` scopes the "covered" check
// so the row being edited doesn't hide its own linkable target.
function populateUsecasePicker(editingCatalogId) {
  const covered = getCoveredUsecaseIds(editingCatalogId);
  const opts = usecases
    .slice()
    .filter(u => !covered.has(u.id))
    .sort((a,b) => (a.service_name||'').localeCompare(b.service_name||''))
    .map(u => `<option value="${u.id}">[${u.id}] ${MaTest.escapeHtml(u.service_name)} · ${MaTest.escapeHtml(u.service_type)}</option>`)
    .join('');
  const total = usecases.length;
  const shown = opts.match(/<option /g)?.length || 0;
  const hidden = total - shown;
  const blank = `<option value="">— Blank / Manual entry —</option>`;
  const hint = hidden > 0
    ? `<option value="" disabled>── ${hidden} usecase มี catalog entry แล้ว (ซ่อน) ──</option>`
    : '';
  document.getElementById('e-usecase-picker').innerHTML = blank + hint + opts;
}

// ── Compute mapping status for a catalog row ────────────────
function mappingStatus(item) {
  if (item.usecase_id && usecaseById[item.usecase_id]) return { kind: 'linked', usecase: usecaseById[item.usecase_id] };
  const nm = MaTest.normName(item.name);
  if (nm && usecaseByName[nm]) return { kind: 'namematch', usecase: usecaseByName[nm] };
  return { kind: 'unmapped' };
}
function mappingBadge(item) {
  const s = mappingStatus(item);
  if (s.kind === 'linked') {
    const inh = Array.isArray(item._from_usecase) ? item._from_usecase : [];
    const suffix = inh.length ? ` · ${inh.length} inherited` : '';
    const tip = inh.length
      ? `Linked to usecase #${s.usecase.id}\nInherited fields: ${inh.join(', ')}`
      : `Linked to usecase #${s.usecase.id}`;
    return `<span class="map-badge linked" title="${MaTest.escapeHtml(tip)}"><i data-icon="link"></i> linked${suffix}</span>`;
  }
  if (s.kind === 'namematch') return `<span class="map-badge namematch" title="Name matches usecase #${s.usecase.id} — click to confirm link" data-confirm-link="${item.id}" data-usecase-id="${s.usecase.id}"><i data-icon="alert-triangle"></i> name-match</span>`;
  return `<span class="map-badge unmapped" title="Not linked to any usecase"><i data-icon="help-circle"></i> unmapped</span>`;
}
function updateMissingCount() {
  const covered = getCoveredUsecaseIds();
  const missing = usecases.filter(u => !covered.has(u.id)).length;
  document.getElementById('missing-count').textContent = missing;
}

// ── Load + render ────────────────────────────────────────────
let editingId = null;

async function load() {
  const params = {};
  const q = document.getElementById('q').value.trim();
  const s = document.getElementById('f-service').value;
  const t = document.getElementById('f-tool').value;
  const a = document.getElementById('f-active').value;
  if (q) params.q = q;
  if (s) params.service = s;
  if (t) params.tool = t;
  if (a === '0') params.active = 0;
  const res = await MaTest.api.listCatalog(params);
  if (!res?.success) { Toast?.error?.(res?.message || 'Load failed'); return; }
  MaTest.state.catalog = res.data.items || [];
  document.getElementById('count-chip').textContent = res.data.count + ' shown';
  document.getElementById('total-chip').textContent = res.data.total + ' total';
  renderTable();
  updateMissingCount();
}

function renderTable() {
  const items = MaTest.state.catalog;
  const wrap = document.getElementById('table-wrap');
  if (!items.length) {
    wrap.innerHTML = `
      <div class="mt-empty">
        <h4>No catalog items</h4>
        <p>คลิก "+ New Service" หรือ "Import CSV" เพื่อเริ่มต้น</p>
      </div>`;
    return;
  }
  const esc = MaTest.escapeHtml;
  // Seed data uses "-" as a placeholder for empty — treat it (and other
  // non-URL strings like "Link") as absent so we don't render broken links.
  const isUrl = v => typeof v === 'string' && /^https?:\/\//i.test(v.trim());
  const rows = items.map(it => `
    <tr data-id="${esc(it.id)}">
      <td>
        <div class="mt-name">${esc(it.name)}</div>
        ${it.remark ? `<div class="mt-sub">${esc(it.remark)}</div>` : ''}
      </td>
      <td>${MaTest.serviceBadge(it.service)}</td>
      <td>${MaTest.priorityBadge(it.priority)}</td>
      <td>${MaTest.toolBadge(it.tool)}</td>
      <td>
        ${it.can_change_message === 'YES'
          ? '<span class="badge badge-green">YES</span>'
          : '<span class="badge badge-gray">NO</span>'}
      </td>
      <td class="mt-links">
        ${isUrl(it.graph_url)      ? `<a href="${esc(it.graph_url)}"      target="_blank" rel="noopener" class="badge badge-blue">Graph ↗</a>`     : ''}
        ${isUrl(it.link_manual)    ? `<a href="${esc(it.link_manual)}"    target="_blank" rel="noopener" class="badge badge-gray">Manual ↗</a>`   : ''}
        ${isUrl(it.opensearch_url) ? `<a href="${esc(it.opensearch_url)}" target="_blank" rel="noopener" class="badge badge-purple">OS ↗</a>`     : ''}
      </td>
      <td>${mappingBadge(it)}</td>
      <td>${MaTest.activeBadge(it.active)}</td>
      <td class="mt-actions">
        <button class="btn btn-ghost btn-sm" data-edit="${esc(it.id)}">Edit</button>
        <button class="btn btn-danger btn-sm" data-del="${esc(it.id)}">Delete</button>
      </td>
    </tr>`).join('');

  wrap.innerHTML = `
    <div style="overflow-x:auto">
      <table class="mt-table">
        <thead>
          <tr>
            <th style="min-width:280px">Name / Remark</th>
            <th>Service</th>
            <th>Priority</th>
            <th>Tool</th>
            <th>Can-change</th>
            <th>Links</th>
            <th>Mapping</th>
            <th>Status</th>
            <th style="text-align:right">Actions</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  wrap.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openEditor(b.dataset.edit));
  wrap.querySelectorAll('[data-del]').forEach(b => b.onclick = () => onDelete(b.dataset.del));
  wrap.querySelectorAll('[data-confirm-link]').forEach(b => b.onclick = () => confirmNameLink(b.dataset.confirmLink, b.dataset.usecaseId));
}

// Persist a name-match as an explicit usecase_id link
async function confirmNameLink(catalogId, usecaseId) {
  const item = MaTest.state.catalog.find(x => x.id === catalogId);
  const u = usecaseById[Number(usecaseId)];
  if (!item || !u) return;
  const current = {
    name: item.name, service: item.service, tool: item.tool,
    graph_url: item.graph_url, link_manual: item.link_manual, opensearch_url: item.opensearch_url,
    remark: item.remark, can_change_message: item.can_change_message,
  };
  const plan = planUsecaseFill(current, u);
  const patch = { usecase_id: Number(usecaseId), ...plan.autoFillPatch };
  if (plan.conflicts.length) {
    const picks = await openOverwriteModal(u, plan.filled, plan.conflicts);
    if (picks === null) return;   // cancelled — don't link
    for (const [key, chosen] of Object.entries(picks)) {
      if (!chosen) continue;
      const f = plan.conflicts.find(c => c.key === key);
      if (f) patch[f.key] = f.val;
    }
  }
  const res = await MaTest.api.updateCatalog(catalogId, patch);
  if (!res?.success) { Toast?.error?.(res?.message || 'Link failed'); return; }
  const bits = [];
  if (Object.keys(plan.autoFillPatch).length) bits.push(`filled ${Object.keys(plan.autoFillPatch).length}`);
  if (plan.conflicts.length) bits.push(`${plan.conflicts.length} conflicts resolved`);
  Toast?.success?.(`Linked <i data-icon="check"></i>${bits.length ? ' — ' + bits.join(', ') : ''}`);
  await load();
}

// Shared field map: catalog key ↔ usecase key ↔ label + per-field blank test.
// URL fields treat "-", "Link", etc. as blank (seed placeholders shouldn't
// block inheritance). Used by editor picker + ⚠ name-match badge flow.
const _isBlankStr = v => { const s = String(v ?? '').trim(); return s === '' || s === '-'; };
const _isBlankUrl = v => _isBlankStr(v) || !/^https?:\/\//i.test(String(v).trim());
const FILL_MAP = [
  { key:'name',               label:'Name',               fromUsecase: u => u.service_name || '',                                                    isBlank: _isBlankStr },
  { key:'service',            label:'Service',            fromUsecase: u => String(u.service_type || '').toUpperCase(),                              isBlank: _isBlankStr },
  { key:'tool',               label:'Tool',               fromUsecase: u => u.tool_type || '',                                                       isBlank: _isBlankStr },
  { key:'graph_url',          label:'Graph URL',          fromUsecase: u => u.grafana_link || '',                                                    isBlank: _isBlankUrl },
  { key:'link_manual',        label:'Manual URL',         fromUsecase: u => u.link_manual || '',                                                     isBlank: _isBlankUrl },
  { key:'opensearch_url',     label:'OpenSearch URL',     fromUsecase: u => u.opensearch_url || '',                                                  isBlank: _isBlankUrl },
  { key:'remark',             label:'Remark',             fromUsecase: u => u.remark || '',                                                          isBlank: _isBlankStr },
  { key:'can_change_message', label:'Can change message', fromUsecase: u => { const v = String(u.can_change_text || '').toUpperCase(); return (v === 'YES' || v === 'NO') ? v : ''; },
                                                          isBlank: _isBlankStr },
];

// Plan a fill from `usecase` onto `current` (both are plain objects with catalog keys).
// Returns { filled: [labels], conflicts: [{key,label,cur,val}], autoFillPatch: {key:val} }
function planUsecaseFill(current, usecase) {
  const filled = [];
  const conflicts = [];
  const autoFillPatch = {};
  for (const f of FILL_MAP) {
    const val = f.fromUsecase(usecase);
    if (f.isBlank(val)) continue;
    if (f.isBlank(current[f.key])) { autoFillPatch[f.key] = val; filled.push(f.label); continue; }
    const cur = String(current[f.key] ?? '').trim();
    if (cur === String(val).trim()) continue;
    conflicts.push({ key: f.key, label: f.label, cur, val });
  }
  return { filled, conflicts, autoFillPatch };
}

// ── Editor ───────────────────────────────────────────────────
let currentUsecaseId = null;   // usecase_id currently linked in the open editor

function openEditor(id, preset) {
  editingId = id || null;
  const it = id ? MaTest.state.catalog.find(x => x.id === id) : null;
  document.getElementById('editor-title').textContent = it ? 'Edit Service' : 'New Service';
  document.getElementById('e-name').value    = it?.name || preset?.name || '';
  document.getElementById('e-service').value = it?.service || preset?.service || MaTest.SERVICES[0];
  document.getElementById('e-priority').value= it?.priority || '';
  document.getElementById('e-tool').value    = it?.tool || preset?.tool || MaTest.TOOLS[0];
  document.getElementById('e-graph').value      = it?.graph_url || preset?.graph_url || '';
  document.getElementById('e-manual').value     = it?.link_manual || preset?.link_manual || '';
  document.getElementById('e-opensearch').value = it?.opensearch_url || preset?.opensearch_url || '';
  document.getElementById('e-remark').value     = it?.remark || preset?.remark || '';
  document.getElementById('e-active').checked = it ? (it.active !== false) : true;
  const ccm = (it?.can_change_message || preset?.can_change_message || 'NO').toUpperCase();
  document.getElementById(ccm === 'YES' ? 'e-ccm-yes' : 'e-ccm-no').checked = true;

  // Bind linked-usecase state — repopulate picker each open so options
  // reflect the latest catalog state (already-covered usecases stay hidden;
  // the editing row's own contributions are excluded so it can self-link).
  currentUsecaseId = it?.usecase_id || preset?.usecase_id || null;
  populateUsecasePicker(it?.id);
  document.getElementById('e-usecase-picker').value = currentUsecaseId ? String(currentUsecaseId) : '';
  renderCurrentUsecaseChip();
  document.getElementById('modal-editor').classList.add('active');
}

function renderCurrentUsecaseChip() {
  const box = document.getElementById('e-usecase-current');
  const nameEl = document.getElementById('e-usecase-current-name');
  if (currentUsecaseId && usecaseById[currentUsecaseId]) {
    box.style.display = 'inline-flex';
    nameEl.textContent = `[${currentUsecaseId}] ${usecaseById[currentUsecaseId].service_name}`;
  } else {
    box.style.display = 'none';
    nameEl.textContent = '';
  }
}
function unlinkUsecase() {
  currentUsecaseId = null;
  document.getElementById('e-usecase-picker').value = '';
  renderCurrentUsecaseChip();
}

// ── Pre-fill fields when picking a usecase from the picker ────
// Empty fields are auto-filled silently. Non-empty differing fields open a
// batch overwrite modal with per-field checkboxes.
const CATALOG_KEY_TO_EDITOR = {
  name: 'e-name', service: 'e-service', tool: 'e-tool',
  graph_url: 'e-graph', link_manual: 'e-manual', opensearch_url: 'e-opensearch', remark: 'e-remark',
};

function readEditorValues() {
  const out = {};
  for (const [k, id] of Object.entries(CATALOG_KEY_TO_EDITOR)) {
    out[k] = document.getElementById(id).value;
  }
  out.can_change_message = document.querySelector('input[name="e-ccm"]:checked')?.value || 'NO';
  return out;
}
function writeEditorField(key, val) {
  if (key === 'can_change_message') {
    document.getElementById(val === 'YES' ? 'e-ccm-yes' : 'e-ccm-no').checked = true;
  } else if (CATALOG_KEY_TO_EDITOR[key]) {
    document.getElementById(CATALOG_KEY_TO_EDITOR[key]).value = val;
  }
}

async function applyUsecaseToEditor(u) {
  const plan = planUsecaseFill(readEditorValues(), u);
  for (const [key, val] of Object.entries(plan.autoFillPatch)) writeEditorField(key, val);
  if (!plan.conflicts.length) return;
  const picks = await openOverwriteModal(u, plan.filled, plan.conflicts);
  if (!picks) return;
  for (const [key, chosen] of Object.entries(picks)) {
    if (!chosen) continue;
    const f = plan.conflicts.find(c => c.key === key);
    if (f) writeEditorField(f.key, f.val);
  }
}

// Batch overwrite modal — returns Promise<{id: bool}|null> (null = cancel)
function openOverwriteModal(usecase, filled, conflicts) {
  const esc = MaTest.escapeHtml;
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.className = 'modal-overlay active';
    ov.innerHTML = `
      <div class="modal mt-lg">
        <div class="modal-header">
          <div class="modal-title">Fill from Usecase — <span style="color:var(--text-muted);font-weight:500">[${esc(usecase.id)}] ${esc(usecase.service_name)}</span></div>
          <button class="btn-close" data-ow-cancel>×</button>
        </div>
        <div class="modal-body">
          <div class="ow-summary">
            ${filled.length ? `<b>${filled.length}</b> field ว่างอยู่ — เติมให้อัตโนมัติ (${esc(filled.join(', '))}). ` : ''}
            <b>${conflicts.length}</b> field มีค่าอยู่แล้วและต่างกัน — เลือก (ติ๊ก) field ที่ต้องการดึงมาจาก usecase; uncheck field ที่ต้องการเก็บของเดิม
          </div>
          <div style="display:flex;gap:8px;margin-bottom:10px">
            <button type="button" class="btn btn-ghost btn-sm" data-ow-all>Check all</button>
            <button type="button" class="btn btn-ghost btn-sm" data-ow-none>Uncheck all</button>
          </div>
          <div class="ow-list">
            ${conflicts.map(f => `
              <label class="ow-row">
                <input type="checkbox" data-ow-field="${esc(f.key)}" checked>
                <div class="ow-row-body">
                  <div class="ow-row-label">${esc(f.label)}</div>
                  <div class="ow-row-diff">
                    <span class="k">Current:</span><span class="v-cur">${esc(f.cur)}</span>
                    <span class="k">Usecase:</span><span class="v-new">${esc(f.val)}</span>
                  </div>
                </div>
              </label>
            `).join('')}
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" data-ow-cancel>Cancel</button>
          <button class="btn btn-primary" data-ow-apply>Apply</button>
        </div>
      </div>`;
    document.body.appendChild(ov);

    const cleanup = (result) => { ov.remove(); resolve(result); };
    ov.querySelectorAll('[data-ow-cancel]').forEach(b => b.onclick = () => cleanup(null));
    ov.querySelector('[data-ow-all]').onclick  = () => ov.querySelectorAll('[data-ow-field]').forEach(cb => cb.checked = true);
    ov.querySelector('[data-ow-none]').onclick = () => ov.querySelectorAll('[data-ow-field]').forEach(cb => cb.checked = false);
    ov.querySelector('[data-ow-apply]').onclick = () => {
      const picks = {};
      ov.querySelectorAll('[data-ow-field]').forEach(cb => { picks[cb.dataset.owField] = cb.checked; });
      cleanup(picks);
    };
    ov.addEventListener('click', e => { if (e.target === ov) cleanup(null); });
  });
}

async function saveEdit() {
  const data = {
    name:                document.getElementById('e-name').value.trim(),
    service:             document.getElementById('e-service').value,
    priority:            document.getElementById('e-priority').value,
    tool:                document.getElementById('e-tool').value,
    can_change_message:  document.querySelector('input[name="e-ccm"]:checked')?.value || 'NO',
    graph_url:           document.getElementById('e-graph').value.trim(),
    link_manual:         document.getElementById('e-manual').value.trim(),
    opensearch_url:      document.getElementById('e-opensearch').value.trim(),
    remark:              document.getElementById('e-remark').value.trim(),
    active:              document.getElementById('e-active').checked,
    usecase_id:          currentUsecaseId,
  };
  if (!data.name)    { Toast?.error?.('Name required');    return; }
  if (!data.service) { Toast?.error?.('Service required'); return; }
  if (!data.tool)    { Toast?.error?.('Tool required');    return; }

  const res = editingId
    ? await MaTest.api.updateCatalog(editingId, data)
    : await MaTest.api.createCatalog(data);
  if (!res?.success) { Toast?.error?.(res?.message || 'Save failed'); return; }
  Toast?.success?.(editingId ? 'Updated' : 'Created');
  closeAll();
  await load();
}

async function onDelete(id) {
  const ok = await confirmDialog(
    'Soft-delete — เลือก "Include inactive" ในตัวกรองเพื่อดูภายหลัง',
    'Deactivate this service?',
    { confirmText: 'Deactivate', variant: 'danger' }
  );
  if (!ok) return;
  const res = await MaTest.api.deleteCatalog(id, false);
  if (!res?.success) { Toast?.error?.(res?.message || 'Delete failed'); return; }
  Toast?.success?.('Deactivated');
  await load();
}

// ── Import ───────────────────────────────────────────────────
function openImport() { document.getElementById('modal-import').classList.add('active'); }
async function doUpload() {
  const f = document.getElementById('imp-file').files[0];
  if (!f) return;
  const replace = document.getElementById('imp-replace').checked;
  const url = '/ma-test/catalog-import.php' + (replace ? '?replace=1' : '');
  const fd = new FormData(); fd.append('csv', f);
  const res = await MaTest.api.rawUpload(url, fd);
  showImportResult(res);
}
async function doBootstrap() {
  const ok = await confirmDialog(
    'Import seed CSV จาก data/sm/ ?',
    'Bootstrap import',
    { confirmText: 'Import', variant: 'primary' }
  );
  if (!ok) return;
  const res = await MaTest.api.bootstrapImport();
  showImportResult(res);
}
function showImportResult(res) {
  const box = document.getElementById('imp-result');
  box.style.display = 'block';
  if (!res?.success) {
    box.innerHTML = `<div style="color:var(--danger)">Failed: ${MaTest.escapeHtml(res?.message || 'Unknown')}</div>`;
    return;
  }
  const d = res.data || {};
  box.innerHTML = `
    <div style="color:var(--success); font-weight:700; margin-bottom:4px">${MaTest.escapeHtml(res.message || 'Imported')}</div>
    <div style="color:var(--text-muted)">
      Created: <b style="color:var(--text)">${d.created ?? 0}</b> ·
      Updated: <b style="color:var(--text)">${d.updated ?? 0}</b> ·
      Total: <b style="color:var(--text)">${d.total ?? '—'}</b>
    </div>`;
  load();
}

// ── Modal helpers ────────────────────────────────────────────
function closeAll() {
  document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
}
document.addEventListener('click', e => {
  if (e.target.matches('[data-close]') || e.target.classList.contains('modal-overlay')) closeAll();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAll(); });

// ── Missing modal ────────────────────────────────────────────
function computeMissingUsecases() {
  const covered = getCoveredUsecaseIds();
  return usecases
    .filter(u => !covered.has(u.id))
    .sort((a,b) => (a.service_name||'').localeCompare(b.service_name||''));
}
function openMissing() {
  renderMissing();
  document.getElementById('modal-missing').classList.add('active');
}
function renderMissing() {
  const q = document.getElementById('miss-q').value.trim().toLowerCase();
  const list = computeMissingUsecases().filter(u => {
    if (!q) return true;
    const hay = (u.service_name + ' ' + (u.remark||'') + ' ' + (u.service_type||'') + ' ' + (u.tool_type||'')).toLowerCase();
    return hay.includes(q);
  });
  document.getElementById('miss-count').textContent = list.length;
  document.getElementById('miss-select-all').checked = false;
  const esc = MaTest.escapeHtml;
  document.getElementById('miss-list').innerHTML = list.length
    ? list.map(u => `
        <label class="missing-row">
          <input type="checkbox" data-uid="${u.id}">
          <div class="missing-row-body">
            <div class="missing-row-name">[${u.id}] ${esc(u.service_name)}</div>
            <div class="missing-row-meta">
              ${esc(u.service_type || '')} · ${esc(u.tool_type || '')}
              ${u.remark ? ' · ' + esc(String(u.remark).slice(0, 80)) : ''}
            </div>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" data-open-uid="${u.id}">Open editor</button>
        </label>
      `).join('')
    : '<div class="mt-empty"><p>Usecases ทั้งหมดถูก map แล้ว <i data-icon="sparkles"></i></p></div>';

  // "Open editor" — open the main editor pre-filled from this single usecase
  document.getElementById('miss-list').querySelectorAll('[data-open-uid]').forEach(b => {
    b.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const u = usecaseById[Number(b.dataset.openUid)];
      if (!u) return;
      closeAll();
      openEditor(null, {
        usecase_id: u.id,
        name: u.service_name,
        service: String(u.service_type || '').toUpperCase(),
        tool: u.tool_type || MaTest.TOOLS[0],
        can_change_message: String(u.can_change_text || 'NO').toUpperCase(),
        graph_url: u.grafana_link || '',
        link_manual: u.link_manual || '',
        remark: u.remark || '',
      });
    };
  });
}
async function bulkAddSelected() {
  const ids = Array.from(document.querySelectorAll('#miss-list input[type="checkbox"][data-uid]:checked'))
    .map(cb => Number(cb.dataset.uid));
  if (!ids.length) { Toast?.info?.('เลือกอย่างน้อย 1 usecase'); return; }
  const ok = await confirmDialog(
    `จะสร้าง catalog entry ${ids.length} รายการจาก usecase ที่เลือก`,
    'Bulk add to Catalog',
    { confirmText: `Create ${ids.length}`, variant: 'primary' }
  );
  if (!ok) return;
  const res = await MaTest.api.bulkFromUsecases(ids);
  if (!res?.success) { Toast?.error?.(res?.message || 'Bulk add failed'); return; }
  Toast?.success?.(`สร้างแล้ว ${res.data?.created ?? 0} รายการ`);
  closeAll();
  await load();
}

// ── Auto-link by name ────────────────────────────────────────
async function autoLink() {
  const ok = await confirmDialog(
    'จับคู่ catalog กับ usecase ตาม name (case-insensitive) และบันทึก usecase_id ให้ถาวร',
    'Auto-link by name',
    { confirmText: 'Run auto-link', variant: 'primary' }
  );
  if (!ok) return;
  const res = await MaTest.api.autoLinkCatalog();
  if (!res?.success) { Toast?.error?.(res?.message || 'Auto-link failed'); return; }
  Toast?.success?.(`Linked ${res.data?.linked ?? 0} entries`);
  await load();
}

// ── Wire ─────────────────────────────────────────────────────
document.getElementById('btn-new').onclick       = () => openEditor(null);
document.getElementById('btn-import').onclick    = openImport;
document.getElementById('btn-missing').onclick   = openMissing;
document.getElementById('btn-autolink').onclick  = autoLink;
document.getElementById('e-save').onclick        = saveEdit;
document.getElementById('imp-upload').onclick    = doUpload;
document.getElementById('imp-bootstrap').onclick = doBootstrap;
document.getElementById('imp-file').onchange     = (e) => {
  document.getElementById('imp-upload').disabled = !e.target.files.length;
};
document.getElementById('miss-add').onclick      = bulkAddSelected;
let _sT;
document.getElementById('miss-q').addEventListener('input', () => { clearTimeout(_sT); _sT = setTimeout(renderMissing, 200); });
document.getElementById('miss-select-all').onchange = (e) => {
  document.querySelectorAll('#miss-list input[type="checkbox"][data-uid]').forEach(cb => cb.checked = e.target.checked);
};

// Usecase picker: pre-fill editor when a usecase is chosen
document.getElementById('e-usecase-picker').onchange = async (e) => {
  const uid = Number(e.target.value);
  if (!uid) { currentUsecaseId = null; renderCurrentUsecaseChip(); return; }
  const u = usecaseById[uid];
  if (!u) return;
  currentUsecaseId = uid;
  renderCurrentUsecaseChip();
  await applyUsecaseToEditor(u);
};

document.getElementById('q').addEventListener('input', () => { clearTimeout(_sT); _sT = setTimeout(load, 250); });
['f-service','f-tool','f-active'].forEach(id => document.getElementById(id).onchange = load);

// Load usecases first so mapping badges + missing count are correct on first render
(async () => {
  await loadUsecases();
  await load();
})();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "applyUsecaseToEditor", { configurable: true, get: () => applyUsecaseToEditor, set: (v) => { applyUsecaseToEditor = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "autoLink", { configurable: true, get: () => autoLink, set: (v) => { autoLink = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "bulkAddSelected", { configurable: true, get: () => bulkAddSelected, set: (v) => { bulkAddSelected = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeAll", { configurable: true, get: () => closeAll, set: (v) => { closeAll = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "computeMissingUsecases", { configurable: true, get: () => computeMissingUsecases, set: (v) => { computeMissingUsecases = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "confirmNameLink", { configurable: true, get: () => confirmNameLink, set: (v) => { confirmNameLink = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "doBootstrap", { configurable: true, get: () => doBootstrap, set: (v) => { doBootstrap = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "doUpload", { configurable: true, get: () => doUpload, set: (v) => { doUpload = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "getCoveredUsecaseIds", { configurable: true, get: () => getCoveredUsecaseIds, set: (v) => { getCoveredUsecaseIds = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "load", { configurable: true, get: () => load, set: (v) => { load = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadUsecases", { configurable: true, get: () => loadUsecases, set: (v) => { loadUsecases = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "mappingBadge", { configurable: true, get: () => mappingBadge, set: (v) => { mappingBadge = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "mappingStatus", { configurable: true, get: () => mappingStatus, set: (v) => { mappingStatus = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "onDelete", { configurable: true, get: () => onDelete, set: (v) => { onDelete = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openEditor", { configurable: true, get: () => openEditor, set: (v) => { openEditor = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openImport", { configurable: true, get: () => openImport, set: (v) => { openImport = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openMissing", { configurable: true, get: () => openMissing, set: (v) => { openMissing = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openOverwriteModal", { configurable: true, get: () => openOverwriteModal, set: (v) => { openOverwriteModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "planUsecaseFill", { configurable: true, get: () => planUsecaseFill, set: (v) => { planUsecaseFill = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "populateUsecasePicker", { configurable: true, get: () => populateUsecasePicker, set: (v) => { populateUsecasePicker = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "readEditorValues", { configurable: true, get: () => readEditorValues, set: (v) => { readEditorValues = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderCurrentUsecaseChip", { configurable: true, get: () => renderCurrentUsecaseChip, set: (v) => { renderCurrentUsecaseChip = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderMissing", { configurable: true, get: () => renderMissing, set: (v) => { renderMissing = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderTable", { configurable: true, get: () => renderTable, set: (v) => { renderTable = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "saveEdit", { configurable: true, get: () => saveEdit, set: (v) => { saveEdit = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "showImportResult", { configurable: true, get: () => showImportResult, set: (v) => { showImportResult = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "unlinkUsecase", { configurable: true, get: () => unlinkUsecase, set: (v) => { unlinkUsecase = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updateMissingCount", { configurable: true, get: () => updateMissingCount, set: (v) => { updateMissingCount = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "writeEditorField", { configurable: true, get: () => writeEditorField, set: (v) => { writeEditorField = v; } }); } catch (e) {}
})();
