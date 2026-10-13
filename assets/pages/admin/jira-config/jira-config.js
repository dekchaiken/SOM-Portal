// admin/jira-config — page script, extracted from admin/jira-config.html.
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

let serviceTypes = [];
let jiraConfig   = { categories: [], issue_types: [], custom_fields: [] };

// ── Modal ────────────────────────────────────────────────
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
['btn-close-edit','btn-cancel-edit'].forEach(id => {
  document.getElementById(id).onclick = () => closeModal('edit-modal');
});
document.getElementById('edit-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeModal('edit-modal');
});

// ── Load all ─────────────────────────────────────────────
async function loadAll() {
  const [typesRes, cfgRes] = await Promise.all([
    API.serviceTypes.list(),
    API.jiraConfig.get()
  ]);
  if (typesRes?.ok) serviceTypes = typesRes.data.data || [];
  if (cfgRes?.ok)   jiraConfig   = cfgRes.data.data   || { categories: [], issue_types: [], custom_fields: [] };
  if (!jiraConfig.custom_fields) jiraConfig.custom_fields = [];

  renderServiceTypes();
  renderChips('categories', 'cat-list');
  renderChips('issue_types', 'it-list');
  renderCustomFields();
}

// ══ Section 1: Service Types ══════════════════════════════
function renderServiceTypes() {
  const container = document.getElementById('st-list');
  if (!serviceTypes.length) {
    container.innerHTML = `<div class="st-empty">ยังไม่มี Service Type</div>`;
    return;
  }
  container.innerHTML = serviceTypes.map(type => {
    const subChips = (type.subtypes || []).map(s => {
      const svcCount = (s.services || []).length;
      const svcBadge = svcCount
        ? `<span class="svc-badge" data-action="manage-services" data-id="${s.id}" data-name="${escHtml(s.name)}" title="จัดการ Services"><i data-icon="clipboard"></i> ${svcCount}</span>`
        : `<span class="svc-badge" data-action="manage-services" data-id="${s.id}" data-name="${escHtml(s.name)}" style="background:rgba(239,68,68,.1);color:#ef4444" title="ยังไม่มี service"><i data-icon="clipboard"></i> 0</span>`;
      return `
      <div class="st-sub-chip">
        <span>${escHtml(s.name)}</span>
        ${svcBadge}
        <button class="sub-btn edit" data-action="rename-sub" data-id="${s.id}" data-name="${escHtml(s.name)}" title="Rename"><i data-icon="pencil"></i></button>
        <button class="sub-btn del"  data-action="del-sub"    data-id="${s.id}" data-name="${escHtml(s.name)}" title="Delete"><i data-icon="x"></i></button>
      </div>`;
    }).join('');
    return `
      <div class="st-card">
        <div class="st-card-header">
          <span class="st-name">${escHtml(type.name)}</span>
          <button class="btn btn-ghost btn-sm btn-icon" data-action="rename-type" data-id="${type.id}" data-name="${escHtml(type.name)}" title="Rename" style="font-size:13px"><i data-icon="pencil"></i></button>
          <button class="btn btn-ghost btn-sm btn-icon" data-action="del-type"    data-id="${type.id}" data-name="${escHtml(type.name)}" title="Delete" style="color:var(--danger);font-size:13px"><i data-icon="x"></i></button>
        </div>
        <div class="st-card-body">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);margin-bottom:8px">
            Sub Types <span style="font-weight:400;font-style:italic">(คลิก <i data-icon="clipboard"></i> เพื่อจัดการ Email Services)</span>
          </div>
          <div class="st-subtype-list">
            ${subChips || '<span class="st-empty">ยังไม่มี subtype</span>'}
          </div>
          <div class="st-add-sub">
            <button class="btn btn-ghost btn-sm" data-action="add-sub" data-parent="${type.id}">＋ Add Sub Type</button>
          </div>
        </div>
      </div>`;
  }).join('');
  container.onclick = null;
  container.addEventListener('click', handleStClick);
}

function handleStClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return; e.stopPropagation();
  const { action, id, name } = btn.dataset;
  if (action === 'rename-type')     openEditSimple(id, name, 'service_type', 'แก้ชื่อ Service Type');
  if (action === 'del-type')        deleteServiceType(id, name);
  if (action === 'rename-sub')      openSubtypeModal({ mode: 'edit', id, name });
  if (action === 'del-sub')         deleteSubtype(id, name);
  if (action === 'add-sub')         openSubtypeModal({ mode: 'add', parentId: btn.dataset.parent });
  if (action === 'manage-services') openServiceModal(id, name);
}

document.getElementById('btn-add-type').onclick = async () => {
  const input = document.getElementById('new-type-name');
  const name = input.value.trim();
  if (!name) { Toast.warning('กรอกชื่อก่อน'); return; }
  const res = await API.serviceTypes.createType({ name });
  if (res?.ok) { Toast.success('เพิ่มแล้ว'); input.value = ''; await reloadST(); }
  else Toast.error(res?.data?.message || 'Failed');
};
document.getElementById('new-type-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-add-type').click();
});

// ── Subtype Modal ─────────────────────────────────────────
function openSubtypeModal({ mode, id = '', parentId = '', name = '' }) {
  document.getElementById('sub-edit-id').value    = id;
  document.getElementById('sub-edit-parent').value = parentId;
  document.getElementById('sub-name').value        = name;
  document.getElementById('sub-modal-title').textContent = mode === 'edit' ? 'แก้ไข Sub Type' : 'เพิ่ม Sub Type';
  openModal('subtype-modal');
  setTimeout(() => document.getElementById('sub-name').focus(), 50);
}

['btn-close-subtype','btn-cancel-subtype'].forEach(id => {
  document.getElementById(id).onclick = () => closeModal('subtype-modal');
});
document.getElementById('subtype-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeModal('subtype-modal');
});

document.getElementById('btn-save-subtype').addEventListener('click', async () => {
  const id       = document.getElementById('sub-edit-id').value;
  const parentId = document.getElementById('sub-edit-parent').value;
  const name     = document.getElementById('sub-name').value.trim();
  const text     = document.getElementById('sub-save-text');
  const spin     = document.getElementById('sub-save-spin');

  if (!name) { Toast.warning('กรอกชื่อก่อน'); return; }
  text.textContent = 'Saving...'; spin.classList.remove('hidden');

  const res = id
    ? await API.serviceTypes.rename(id, { name })
    : await API.serviceTypes.createSubtype(parentId, { name });

  text.textContent = 'Save'; spin.classList.add('hidden');

  if (res?.ok) {
    Toast.success(id ? 'แก้ไขแล้ว' : 'เพิ่มแล้ว');
    closeModal('subtype-modal');
    await reloadST();
  } else {
    Toast.error(res?.data?.message || 'Failed');
  }
});

// ── Service Modal ─────────────────────────────────────────
let _svcToEmails = [];
let _svcCcEmails = [];
let _currentSubtypeId = '';

function makeChipField(fieldId, inputId, list) {
  const field = document.getElementById(fieldId);
  const input = document.getElementById(inputId);
  field.querySelectorAll('.em-chip').forEach(c => c.remove());
  list.forEach(email => {
    const chip = document.createElement('span');
    chip.className = 'em-chip';
    chip.innerHTML = `${escHtml(email)}<button class="em-chip-x" data-email="${escHtml(email)}" title="ลบ">×</button>`;
    field.insertBefore(chip, input);
  });
}

function addEmailToList(inputId, list, fieldId) {
  const input  = document.getElementById(inputId);
  const raw    = input.value.trim().replace(/,\s*$/, '');
  if (!raw) return;
  const emails = parseEmailList(raw);
  if (!emails.length && raw.includes('@')) emails.push(raw);
  if (!emails.length) { Toast.warning('รูปแบบ email ไม่ถูกต้อง'); return; }
  emails.forEach(em => { if (!list.includes(em)) list.push(em); });
  makeChipField(fieldId, inputId, list);
  input.value = '';
}

function setupChipInput(fieldId, inputId, listRef) {
  document.getElementById(fieldId).addEventListener('click', e => {
    const btn = e.target.closest('.em-chip-x');
    if (!btn) return;
    const i = listRef().indexOf(btn.dataset.email);
    if (i > -1) { listRef().splice(i, 1); makeChipField(fieldId, inputId, listRef()); }
  });
  document.getElementById(inputId).addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addEmailToList(inputId, listRef(), fieldId); }
    if (e.key === 'Backspace' && !e.target.value && listRef().length) {
      listRef().pop(); makeChipField(fieldId, inputId, listRef());
    }
  });
  document.getElementById(inputId).addEventListener('blur', () => addEmailToList(inputId, listRef(), fieldId));
  document.getElementById(inputId).addEventListener('paste', e => {
    e.preventDefault();
    const pasted = (e.clipboardData || window.clipboardData).getData('text');
    if (!pasted) return;
    const emails = parseEmailList(pasted);
    if (!emails.length) { document.getElementById(inputId).value = pasted; return; }
    let added = 0;
    emails.forEach(em => { if (!listRef().includes(em)) { listRef().push(em); added++; } });
    if (added) { makeChipField(fieldId, inputId, listRef()); Toast.success(`เพิ่ม ${added} email แล้ว`); }
  });
}

setupChipInput('svc-to-field', 'svc-to-input', () => _svcToEmails);
setupChipInput('svc-cc-field', 'svc-cc-input', () => _svcCcEmails);

function openServiceModal(subtypeId, subtypeName) {
  _currentSubtypeId = subtypeId;
  document.getElementById('svc-parent-id').value = subtypeId;
  document.getElementById('svc-modal-subtype-name').textContent = subtypeName;
  hideSvcForm();
  renderServiceList(subtypeId);
  openModal('service-modal');
}

function findSubtype(subtypeId) {
  for (const t of serviceTypes) {
    const s = (t.subtypes || []).find(s => s.id === subtypeId);
    if (s) return s;
  }
  return null;
}

function renderServiceList(subtypeId) {
  const sub  = findSubtype(subtypeId);
  const list = document.getElementById('svc-list');
  if (!sub) { list.innerHTML = ''; return; }
  const svcs = sub.services || [];
  if (!svcs.length) {
    list.innerHTML = `<div class="st-empty" style="margin-bottom:8px">ยังไม่มี Service — กด "＋ เพิ่ม Service" ด้านล่าง</div>`;
    return;
  }
  list.innerHTML = svcs.map(svc => `
    <div class="svc-row">
      <div class="svc-row-name">${escHtml(svc.name)}</div>
      <div class="svc-row-meta">
        <span title="${escHtml((svc.email_to||[]).join(', '))}"><i data-icon="upload"></i> To: ${(svc.email_to||[]).length}</span>
        <span title="${escHtml((svc.email_cc||[]).join(', '))}"><i data-icon="clipboard"></i> CC: ${(svc.email_cc||[]).length}</span>
      </div>
      <button class="btn btn-ghost btn-sm btn-icon" data-svc-action="edit-svc" data-svc-id="${svc.id}"
              data-svc-name="${escHtml(svc.name)}"
              data-svc-to="${escHtml(JSON.stringify(svc.email_to||[]))}"
              data-svc-cc="${escHtml(JSON.stringify(svc.email_cc||[]))}"
              title="แก้ไข" style="font-size:12px"><i data-icon="pencil"></i></button>
      <button class="btn btn-ghost btn-sm btn-icon" data-svc-action="del-svc" data-svc-id="${svc.id}"
              data-svc-name="${escHtml(svc.name)}"
              title="ลบ" style="color:var(--danger);font-size:12px"><i data-icon="x"></i></button>
    </div>`).join('');

  list.onclick = null;
  list.addEventListener('click', handleSvcListClick);
}

function handleSvcListClick(e) {
  const btn = e.target.closest('[data-svc-action]');
  if (!btn) return;
  const { svcAction, svcId, svcName } = btn.dataset;
  if (svcAction === 'edit-svc') {
    let to = [], cc = [];
    try { to = JSON.parse(btn.dataset.svcTo || '[]'); } catch {}
    try { cc = JSON.parse(btn.dataset.svcCc || '[]'); } catch {}
    showSvcForm({ mode: 'edit', id: svcId, name: svcName, emailTo: to, emailCc: cc });
  }
  if (svcAction === 'del-svc') deleteSvc(svcId, svcName);
}

function showSvcForm({ mode = 'add', id = '', name = '', emailTo = [], emailCc = [] } = {}) {
  _svcToEmails = [...emailTo];
  _svcCcEmails = [...emailCc];
  document.getElementById('svc-edit-id').value = id;
  document.getElementById('svc-name').value    = name;
  document.getElementById('svc-form-title').textContent = mode === 'edit' ? 'แก้ไข Service' : 'เพิ่ม Service';
  makeChipField('svc-to-field', 'svc-to-input', _svcToEmails);
  makeChipField('svc-cc-field', 'svc-cc-input', _svcCcEmails);
  document.getElementById('svc-form').style.display = '';
  setTimeout(() => document.getElementById('svc-name').focus(), 50);
}

function hideSvcForm() {
  document.getElementById('svc-form').style.display = 'none';
  document.getElementById('svc-edit-id').value = '';
  document.getElementById('svc-name').value    = '';
  _svcToEmails = []; _svcCcEmails = [];
}

document.getElementById('btn-add-service').onclick = () => showSvcForm({ mode: 'add' });
document.getElementById('btn-cancel-svc-form').onclick = hideSvcForm;

document.getElementById('btn-save-svc').addEventListener('click', async () => {
  addEmailToList('svc-to-input', _svcToEmails, 'svc-to-field');
  addEmailToList('svc-cc-input', _svcCcEmails, 'svc-cc-field');

  const id       = document.getElementById('svc-edit-id').value;
  const name     = document.getElementById('svc-name').value.trim();
  const parentId = document.getElementById('svc-parent-id').value;
  const text     = document.getElementById('svc-save-text');
  const spin     = document.getElementById('svc-save-spin');

  if (!name) { Toast.warning('กรอกชื่อ Service ก่อน'); return; }
  if (!_svcToEmails.length) { Toast.warning('ต้องมี Email To อย่างน้อย 1 ที่อยู่'); return; }

  text.textContent = 'Saving...'; spin.classList.remove('hidden');

  const payload = { name, email_to: _svcToEmails, email_cc: _svcCcEmails };
  const res = id
    ? await API.serviceTypes.updateService(id, payload)
    : await API.serviceTypes.createService(parentId, payload);

  text.textContent = 'Save'; spin.classList.add('hidden');

  if (res?.ok) {
    Toast.success(id ? 'แก้ไขแล้ว' : 'เพิ่ม Service แล้ว');
    hideSvcForm();
    await reloadST();
    renderServiceList(_currentSubtypeId);
  } else {
    Toast.error(res?.data?.message || 'Failed');
  }
});

async function deleteSvc(id, name) {
  if (!await confirmDialog(`ลบ Service "${name}"?`, 'ลบ Service')) return;
  const res = await API.serviceTypes.delete(id);
  if (res?.ok) {
    Toast.success('ลบแล้ว');
    await reloadST();
    renderServiceList(_currentSubtypeId);
  } else {
    Toast.error(res?.data?.message || 'Failed');
  }
}

['btn-close-service','btn-close-service-footer'].forEach(btnId => {
  document.getElementById(btnId).onclick = () => closeModal('service-modal');
});
document.getElementById('service-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeModal('service-modal');
});

async function deleteServiceType(id, name) {
  if (!await confirmDialog(`ลบ Service Type "${name}"?\nTemplate ที่อยู่ใน category นี้จะยังอยู่ แต่ไม่แสดงในต้นไม้`, 'ลบ Service Type')) return;
  const res = await API.serviceTypes.delete(id);
  if (res?.ok) { Toast.success('ลบแล้ว'); await reloadST(); }
  else Toast.error(res?.data?.message || 'Failed');
}
async function deleteSubtype(id, name) {
  if (!await confirmDialog(`ลบ Sub Type "${name}"?`, 'ลบ Sub Type')) return;
  const res = await API.serviceTypes.delete(id);
  if (res?.ok) { Toast.success('ลบแล้ว'); await reloadST(); }
  else Toast.error(res?.data?.message || 'Failed');
}
async function reloadST() {
  const res = await API.serviceTypes.list();
  if (res?.ok) serviceTypes = res.data.data || [];
  renderServiceTypes();
}

// ══ Section 2+3: Config chips ════════════════════════════
function renderChips(key, containerId) {
  const container = document.getElementById(containerId);
  const items = jiraConfig[key] || [];
  if (!items.length) {
    container.innerHTML = `<span style="font-size:12px;color:var(--text-muted);font-style:italic">ยังไม่มี</span>`;
    return;
  }
  container.innerHTML = items.map(item => `
    <div class="config-chip">
      <span>${escHtml(item.name)}</span>
      <button class="chip-btn edit" data-action="edit-chip" data-id="${item.id}" data-name="${escHtml(item.name)}" data-kind="config" title="Rename"><i data-icon="pencil"></i></button>
      <button class="chip-btn del"  data-action="del-chip"  data-id="${item.id}" data-name="${escHtml(item.name)}" data-key="${key}" title="Delete"><i data-icon="x"></i></button>
    </div>`).join('');
  container.onclick = null;
  container.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'edit-chip') {
      const label = key === 'categories' ? 'แก้ชื่อ Category' : 'แก้ชื่อ Issue Type';
      openEditSimple(btn.dataset.id, btn.dataset.name, 'config', label);
    }
    if (btn.dataset.action === 'del-chip') deleteChip(btn.dataset.id, btn.dataset.name, btn.dataset.key);
  });
}

document.querySelectorAll('[data-add-kind]').forEach(btn => {
  btn.addEventListener('click', () => addChip(btn.dataset.addKind));
});
['new-cat-name','new-it-name'].forEach((id, i) => {
  document.getElementById(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') addChip(i === 0 ? 'category' : 'issue_type');
  });
});

async function addChip(kind) {
  const inputId = kind === 'category' ? 'new-cat-name' : 'new-it-name';
  const input = document.getElementById(inputId);
  const name  = input.value.trim();
  if (!name) { Toast.warning('กรอกชื่อก่อน'); return; }
  const res = await API.jiraConfig.add({ kind, name });
  if (res?.ok) { Toast.success('เพิ่มแล้ว'); input.value = ''; await reloadConfig(); }
  else Toast.error(res?.data?.message || 'Failed');
}

async function deleteChip(id, name, key) {
  const label = key === 'categories' ? 'Category' : 'Issue Type';
  if (!await confirmDialog(`ลบ ${label} "${name}"?`, `ลบ ${label}`)) return;
  const res = await API.jiraConfig.delete(id);
  if (res?.ok) { Toast.success('ลบแล้ว'); await reloadConfig(); }
  else Toast.error(res?.data?.message || 'Failed');
}

// ══ Section 4: Custom Fields ══════════════════════════════
function renderCustomFields() {
  const tbody = document.getElementById('cf-tbody');
  const fields = [...(jiraConfig.custom_fields || [])].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));

  if (!fields.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--text-muted);font-style:italic">ยังไม่มี custom field</td></tr>`;
    return;
  }

  const typeLabel = { text: 'Text', fault_start: 'Fault Start' };
  const typeCls   = { text: 'cf-type-text', fault_start: 'cf-type-fault_start' };

  tbody.innerHTML = fields.map(cf => `
    <tr class="${cf.enabled ? '' : 'disabled-row'}" data-cf-id="${cf.id}">
      <td class="drag-handle" title="ลากเพื่อเรียงลำดับ">⠿</td>
      <td><code class="field-id-code">${escHtml(cf.field_id)}</code></td>
      <td style="font-weight:600">${escHtml(cf.label)}</td>
      <td style="color:var(--text-muted)">${escHtml(cf.placeholder || '—')}</td>
      <td><span class="cf-type-badge ${typeCls[cf.field_type] || 'cf-type-text'}">${typeLabel[cf.field_type] || cf.field_type}</span></td>
      <td>
        <label class="toggle">
          <input type="checkbox" ${cf.enabled ? 'checked' : ''}
                 data-action="toggle-cf" data-id="${cf.id}">
          <span class="toggle-slider"></span>
        </label>
      </td>
      <td>
        <div style="display:flex;gap:4px">
          <button class="btn btn-ghost btn-sm btn-icon" data-action="edit-cf" data-id="${cf.id}" title="Edit" style="font-size:12px"><i data-icon="pencil"></i></button>
          <button class="btn btn-ghost btn-sm btn-icon" data-action="del-cf"  data-id="${cf.id}" data-name="${escHtml(cf.label)}" title="Delete" style="color:var(--danger);font-size:12px"><i data-icon="x"></i></button>
        </div>
      </td>
    </tr>`).join('');

  tbody.onclick = null;
  tbody.onchange = null;

  tbody.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'edit-cf') openEditCf(btn.dataset.id);
    if (btn.dataset.action === 'del-cf')  deleteCf(btn.dataset.id, btn.dataset.name);
  });

  tbody.addEventListener('change', async e => {
    const chk = e.target.closest('[data-action="toggle-cf"]');
    if (!chk) return;
    const id  = chk.dataset.id;
    const res = await API.jiraConfig.update(id, { enabled: chk.checked });
    if (res?.ok) {
      Toast.success(chk.checked ? 'เปิดแล้ว' : 'ปิดแล้ว');
      await reloadConfig();
    } else {
      Toast.error(res?.data?.message || 'Failed');
      chk.checked = !chk.checked; // revert
    }
  });
}

// Add custom field
document.getElementById('btn-add-cf').onclick = async () => {
  const fieldId     = document.getElementById('cf-new-fieldid').value.trim();
  const label       = document.getElementById('cf-new-label').value.trim();
  const placeholder = document.getElementById('cf-new-placeholder').value.trim();
  const fieldType   = document.getElementById('cf-new-type').value;

  if (!fieldId) { Toast.warning('กรอก Field ID ก่อน เช่น customfield_12345'); return; }
  if (!label)   { Toast.warning('กรอก Label ก่อน'); return; }

  const res = await API.jiraConfig.add({ kind: 'custom_field', field_id: fieldId, label, placeholder, field_type: fieldType });
  if (res?.ok) {
    Toast.success('เพิ่ม Custom Field แล้ว');
    document.getElementById('cf-new-fieldid').value = '';
    document.getElementById('cf-new-label').value   = '';
    document.getElementById('cf-new-placeholder').value = '';
    await reloadConfig();
  } else {
    Toast.error(res?.data?.message || 'Failed');
  }
};

async function deleteCf(id, name) {
  if (!await confirmDialog(`ลบ Custom Field "${name}"?\nTemplate ที่มีค่า field นี้จะยังเก็บข้อมูลไว้ แต่ไม่แสดงใน form อีกต่อไป`, 'ลบ Custom Field')) return;
  const res = await API.jiraConfig.delete(id);
  if (res?.ok) { Toast.success('ลบแล้ว'); await reloadConfig(); }
  else Toast.error(res?.data?.message || 'Failed');
}

// ══ Edit modal ════════════════════════════════════════════
function openEditSimple(id, currentName, kind, title) {
  document.getElementById('edit-modal-title').textContent = title || 'Edit';
  document.getElementById('edit-id').value    = id;
  document.getElementById('edit-kind').value  = kind;
  document.getElementById('edit-name').value  = currentName;
  document.getElementById('edit-simple-group').style.display = '';
  document.getElementById('edit-cf-group').style.display = 'none';
  openModal('edit-modal');
  setTimeout(() => document.getElementById('edit-name').focus(), 50);
}

function openEditCf(id) {
  const cf = (jiraConfig.custom_fields || []).find(f => f.id === id);
  if (!cf) return;
  document.getElementById('edit-modal-title').textContent = 'Edit Custom Field';
  document.getElementById('edit-id').value    = id;
  document.getElementById('edit-kind').value  = 'custom_field';
  document.getElementById('edit-simple-group').style.display = 'none';
  document.getElementById('edit-cf-group').style.display = '';
  document.getElementById('edit-cf-fieldid').value     = cf.field_id;
  document.getElementById('edit-cf-label').value       = cf.label;
  document.getElementById('edit-cf-placeholder').value = cf.placeholder || '';
  document.getElementById('edit-cf-type').value        = cf.field_type || 'text';
  openModal('edit-modal');
  setTimeout(() => document.getElementById('edit-cf-label').focus(), 50);
}

document.getElementById('btn-save-edit').onclick = async () => {
  const id   = document.getElementById('edit-id').value;
  const kind = document.getElementById('edit-kind').value;
  const text = document.getElementById('edit-save-text');
  const spin = document.getElementById('edit-save-spin');
  text.textContent = 'Saving...';
  spin.classList.remove('hidden');

  let res, payload;

  if (kind === 'custom_field') {
    const label = document.getElementById('edit-cf-label').value.trim();
    if (!label) { Toast.warning('กรอก Label ก่อน'); text.textContent = 'Save'; spin.classList.add('hidden'); return; }
    payload = {
      label,
      placeholder: document.getElementById('edit-cf-placeholder').value.trim(),
      field_type:  document.getElementById('edit-cf-type').value
    };
    res = await API.jiraConfig.update(id, payload);
  } else if (kind === 'config') {
    const name = document.getElementById('edit-name').value.trim();
    if (!name) { Toast.warning('กรอกชื่อก่อน'); text.textContent = 'Save'; spin.classList.add('hidden'); return; }
    res = await API.jiraConfig.update(id, { name });
  } else {
    const name = document.getElementById('edit-name').value.trim();
    if (!name) { Toast.warning('กรอกชื่อก่อน'); text.textContent = 'Save'; spin.classList.add('hidden'); return; }
    res = await API.serviceTypes.rename(id, { name });
  }

  text.textContent = 'Save';
  spin.classList.add('hidden');

  if (res?.ok) {
    Toast.success('แก้ไขแล้ว');
    closeModal('edit-modal');
    if (kind === 'config' || kind === 'custom_field') await reloadConfig();
    else await reloadST();
  } else {
    Toast.error(res?.data?.message || 'Failed');
  }
};
document.getElementById('edit-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-save-edit').click();
});

// ══ Reload helpers ════════════════════════════════════════
async function reloadConfig() {
  const res = await API.jiraConfig.get();
  if (res?.ok) {
    jiraConfig = res.data.data || { categories: [], issue_types: [], custom_fields: [] };
    if (!jiraConfig.custom_fields) jiraConfig.custom_fields = [];
  }
  renderChips('categories', 'cat-list');
  renderChips('issue_types', 'it-list');
  renderCustomFields();
}

// ── Boot ──────────────────────────────────────────────────
loadAll();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "addChip", { configurable: true, get: () => addChip, set: (v) => { addChip = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "addEmailToList", { configurable: true, get: () => addEmailToList, set: (v) => { addEmailToList = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeModal", { configurable: true, get: () => closeModal, set: (v) => { closeModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "deleteCf", { configurable: true, get: () => deleteCf, set: (v) => { deleteCf = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "deleteChip", { configurable: true, get: () => deleteChip, set: (v) => { deleteChip = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "deleteServiceType", { configurable: true, get: () => deleteServiceType, set: (v) => { deleteServiceType = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "deleteSubtype", { configurable: true, get: () => deleteSubtype, set: (v) => { deleteSubtype = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "deleteSvc", { configurable: true, get: () => deleteSvc, set: (v) => { deleteSvc = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "findSubtype", { configurable: true, get: () => findSubtype, set: (v) => { findSubtype = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "handleStClick", { configurable: true, get: () => handleStClick, set: (v) => { handleStClick = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "handleSvcListClick", { configurable: true, get: () => handleSvcListClick, set: (v) => { handleSvcListClick = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "hideSvcForm", { configurable: true, get: () => hideSvcForm, set: (v) => { hideSvcForm = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadAll", { configurable: true, get: () => loadAll, set: (v) => { loadAll = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "makeChipField", { configurable: true, get: () => makeChipField, set: (v) => { makeChipField = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openEditCf", { configurable: true, get: () => openEditCf, set: (v) => { openEditCf = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openEditSimple", { configurable: true, get: () => openEditSimple, set: (v) => { openEditSimple = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openModal", { configurable: true, get: () => openModal, set: (v) => { openModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openServiceModal", { configurable: true, get: () => openServiceModal, set: (v) => { openServiceModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openSubtypeModal", { configurable: true, get: () => openSubtypeModal, set: (v) => { openSubtypeModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "reloadConfig", { configurable: true, get: () => reloadConfig, set: (v) => { reloadConfig = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "reloadST", { configurable: true, get: () => reloadST, set: (v) => { reloadST = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderChips", { configurable: true, get: () => renderChips, set: (v) => { renderChips = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderCustomFields", { configurable: true, get: () => renderCustomFields, set: (v) => { renderCustomFields = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderServiceList", { configurable: true, get: () => renderServiceList, set: (v) => { renderServiceList = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderServiceTypes", { configurable: true, get: () => renderServiceTypes, set: (v) => { renderServiceTypes = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setupChipInput", { configurable: true, get: () => setupChipInput, set: (v) => { setupChipInput = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "showSvcForm", { configurable: true, get: () => showSvcForm, set: (v) => { showSvcForm = v; } }); } catch (e) {}
})();
