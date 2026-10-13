// jira-templates — page script, extracted from jira-templates.html.
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
Layout.render('jira');

const currentUser = Auth.getUser();
// canManage: role-based check AND either SM team or super_admin (raw super,
// not view-as previewing another team). templates.json is SM-shared, so
// non-SM lead-level users can view but never write — hide their CTAs to
// keep the UI honest (backend also enforces via requireSmForShared()).
const _viewAsTeam = Auth._getViewAsTeam?.() || null;
const _effTeam    = _viewAsTeam?.slug || currentUser?.team;
const _isRawSuper = currentUser?.role === 'super_admin' && !_viewAsTeam;
const canManage   = currentUser
  && ['super_admin', 'sm_lead', 'sm_admin', 'dev_sm'].includes(currentUser.role)
  && (_effTeam === 'sm' || _isRawSuper);

let allTemplates  = [];
let serviceTypes  = [];
let activeTemplate = null;

// Current selection state
let selTypeId    = null;   // selected service type id  (or 'all')
let selSubtypeId = null;   // selected subtype id

// FIELD_LABELS built dynamically from jiraConfig.custom_fields
function getFieldLabels() {
  const map = {};
  (jiraConfig.custom_fields || []).filter(f => f.enabled).forEach(f => {
    map[f.field_id] = f.label;
  });
  return map;
}

// Render form inputs for custom fields inside the template modal
function renderDynamicFields(existingValues = {}) {
  const grid = document.getElementById('dynamic-cf-grid');
  const fields = (jiraConfig.custom_fields || []).filter(f => f.enabled)
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));

  if (!fields.length) {
    grid.innerHTML = `<div style="color:var(--text-muted);font-size:12px;grid-column:1/-1">ไม่มี custom field ที่เปิดใช้งาน — ตั้งค่าได้ใน <a href="../admin/jira-config.html">Admin → Jira Config</a></div>`;
    return;
  }

  grid.innerHTML = fields.map(cf => {
    const inputId = `dyn_cf_${cf.id}`;
    const val     = existingValues[cf.field_id] || '';
    const foMeta  = jiraFieldOptions[cf.field_id] || {};
    const opts    = foMeta.options || [];

    if (cf.field_type === 'fault_start') {
      return `
        <div class="form-group">
          <label class="form-label">${escHtml(cf.label)}</label>
          <select id="${inputId}" class="form-control" data-field-id="${cf.field_id}">
            <option value="auto" ${val !== 'manual' ? 'selected' : ''}>Auto (current time when creating)</option>
            <option value="manual" ${val === 'manual' ? 'selected' : ''}>Manual input</option>
          </select>
          <div class="form-hint">${escHtml(cf.field_id)}</div>
        </div>`;
    }

    if (cf.field_type === 'select' && opts.length > 0) {
      const optionsHtml = opts.map(o =>
        `<option value="${escHtml(o)}" ${val === o ? 'selected' : ''}>${escHtml(o)}</option>`
      ).join('');
      return `
        <div class="form-group">
          <label class="form-label">${escHtml(cf.label)}</label>
          <select id="${inputId}" class="form-control" data-field-id="${cf.field_id}">
            <option value="">— เลือก —</option>
            ${optionsHtml}
          </select>
          <div class="form-hint">เลือกค่าจาก Jira · ${escHtml(cf.field_id)}</div>
        </div>`;
    }

    if (cf.field_type === 'array' && opts.length > 0) {
      // Parse existing comma-separated values
      const selected = val ? val.split(',').map(s => s.trim()).filter(Boolean) : [];
      const tagHtml  = selected.map(s => `
        <span class="tag-chip">
          ${escHtml(s)}
          <button type="button" class="tag-chip-remove" onclick="removeTag(this,'${inputId}-hidden')" data-val="${escHtml(s)}"><i data-icon="x"></i></button>
        </span>`).join('');
      const availOpts = opts.map(o =>
        `<option value="${escHtml(o)}">${escHtml(o)}</option>`
      ).join('');
      return `
        <div class="form-group">
          <label class="form-label">${escHtml(cf.label)}</label>
          <input type="hidden" id="${inputId}-hidden" data-field-id="${cf.field_id}" value="${escHtml(selected.join(','))}">
          <div class="tag-input-wrap" id="${inputId}-wrap">
            ${tagHtml}
            <select class="tag-add-select" onchange="addTag(this,'${inputId}-hidden','${inputId}-wrap')">
              <option value="">+ เพิ่ม...</option>
              ${availOpts}
            </select>
          </div>
          <div class="form-hint">เลือกได้หลายค่า · ${escHtml(cf.field_id)}</div>
        </div>`;
    }

    // text field or select/array with no options fetched → free text
    return `
      <div class="form-group">
        <label class="form-label">${escHtml(cf.label)}</label>
        <input type="text" id="${inputId}" class="form-control"
               placeholder="${escHtml(cf.placeholder || '')}"
               value="${escHtml(val)}"
               data-field-id="${cf.field_id}">
        <div class="form-hint">${escHtml(cf.field_id)}</div>
      </div>`;
  }).join('');
}

// Collect values from dynamic fields
function collectDynamicFields() {
  const result = {};
  document.querySelectorAll('#dynamic-cf-grid [data-field-id]').forEach(el => {
    // skip the tag-add-select (no data-field-id on it), use hidden input for arrays
    if (el.tagName === 'SELECT' && el.classList.contains('tag-add-select')) return;
    result[el.dataset.fieldId] = el.value;
  });
  return result;
}

// ── Close helpers ───────────────────────────────────────
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

document.getElementById('btn-close-tpl-modal').onclick    = () => closeModal('tpl-modal');
document.getElementById('btn-cancel-tpl-modal').onclick   = () => closeModal('tpl-modal');
document.getElementById('btn-close-cat-modal').onclick    = () => closeModal('cat-modal');
document.getElementById('btn-cancel-cat-modal').onclick   = () => closeModal('cat-modal');
document.getElementById('btn-close-ticket-modal').onclick = () => closeModal('ticket-modal');
document.getElementById('btn-cancel-ticket-modal').onclick= () => closeModal('ticket-modal');
document.getElementById('btn-close-success-modal').onclick = () => closeModal('success-modal');
document.getElementById('btn-close-email-draft').onclick   = () => closeModal('email-draft-modal');
document.getElementById('btn-cancel-email-draft').onclick  = () => closeModal('email-draft-modal');

// Close on backdrop click — ยกเว้น email-draft-modal (เพราะต้องการเก็บ draft ไว้)
['tpl-modal','cat-modal','ticket-modal','success-modal'].forEach(id => {
  document.getElementById(id).addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal(id);
  });
});

// For email-draft-modal: prevent accidental close when clicking outside
// ผู้ใช้ต้องกดปุ่มยกเลิกหรือกากบาท X เท่านั้น
document.getElementById('email-draft-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) {
    // อย่าปิด modal เมื่อกดที่ backdrop
    e.stopPropagation();
  }
});

// ── Initial load ────────────────────────────────────────
let jiraConfig       = { categories: [], issue_types: [] };
let jiraFieldOptions = {}; // { customfield_xxxxx: { label, type, options: [] } }
let jiraIssueTypes   = []; // [{ id, name, iconUrl }]

async function init() {
  const [typesRes, tplRes, cfgRes, foRes, itRes] = await Promise.all([
    API.serviceTypes.list(),
    API.templates.list(),
    API.jiraConfig.get(),
    API.jira.fieldOptions(),
    API.jira.issueTypes(),
  ]);
  if (typesRes?.ok)  serviceTypes     = typesRes.data.data || [];
  if (tplRes?.ok)    allTemplates     = tplRes.data.data   || [];
  if (cfgRes?.ok)    jiraConfig       = cfgRes.data.data   || { categories: [], issue_types: [] };
  if (foRes?.ok)     jiraFieldOptions = foRes.data.data    || {};
  if (itRes?.ok)     jiraIssueTypes   = itRes.data.data    || [];

  renderTree();

  // Reveal admin CTAs when the user can actually manage templates. Non-SM
  // teams granted `jira-templates-shared` land here with canManage=false and
  // see the library read-only.
  if (canManage) {
    document.getElementById('btn-add-type').style.display = 'flex';
    document.getElementById('btn-new-tpl').style.display  = '';
  }

  document.getElementById('btn-new-tpl').addEventListener('click', () => openTemplateModal());
}

// ── Tree rendering ──────────────────────────────────────
let _treeClickBound = false;

function countTemplates(typeId, subtypeId = null) {
  return allTemplates.filter(t => {
    if (subtypeId) return t.service_type_id === typeId && t.service_subtype_id === subtypeId;
    return t.service_type_id === typeId;
  }).length;
}

function renderTree() {
  const body = document.getElementById('tree-body');
  let html = '';

  // "All" row
  const allCount = allTemplates.length;
  html += `
    <div class="tree-all-row ${selTypeId === 'all' ? 'active' : ''}" data-action="select-all">
      <span><i data-icon="clipboard"></i></span>
      <span style="flex:1">All Templates</span>
      <span style="font-size:10px;color:inherit;opacity:0.6">${allCount}</span>
    </div>
    <div class="tree-divider"></div>`;

  // Type nodes
  serviceTypes.forEach(type => {
    const isTypeOpen   = type._open !== false; // default open
    const typeCount    = countTemplates(type.id);

    html += `
      <div class="tree-type-row ${isTypeOpen ? 'open' : ''}" data-action="toggle-type" data-id="${type.id}">
        <span class="tree-type-toggle"><i data-icon="play"></i></span>
        <span class="tree-type-name">${escHtml(type.name)}</span>
        <span style="font-size:10px;color:var(--text-muted);margin-right:4px">${typeCount || ''}</span>
        ${canManage ? `
        <span class="tree-type-actions">
          <button class="tree-action-btn" data-action="add-subtype" data-id="${type.id}" data-name="${escHtml(type.name)}" title="Add subtype">＋</button>
          <button class="tree-action-btn danger" data-action="del-type" data-id="${type.id}" data-name="${escHtml(type.name)}" title="Delete category">✕</button>
        </span>` : ''}
      </div>
      <div class="tree-subtypes ${isTypeOpen ? 'open' : ''}" id="subtypes-${type.id}">`;

    // Subtype nodes
    (type.subtypes || []).forEach(sub => {
      const subCount  = countTemplates(type.id, sub.id);
      const isSubOpen = sub._open === true;
      const isSelSub  = selSubtypeId === sub.id;

      html += `
        <div class="tree-subtype-row ${isSelSub ? 'active' : ''} ${isSubOpen ? 'open' : ''}"
             data-action="toggle-subtype" data-type-id="${type.id}" data-id="${sub.id}">
          <span class="tree-subtype-toggle"><i data-icon="play"></i></span>
          <span class="tree-subtype-name">${escHtml(sub.name)}</span>
          <span class="tree-subtype-count">${subCount}</span>
          ${canManage ? `
          <span class="tree-subtype-actions">
            <button class="tree-action-btn danger" data-action="del-subtype" data-id="${sub.id}" data-name="${escHtml(sub.name)}" title="Delete subtype">✕</button>
          </span>` : ''}
        </div>
        <div class="tree-tpls ${isSubOpen ? 'open' : ''}" id="tpls-${sub.id}">
          ${buildTreeTplItems(type.id, sub.id)}
        </div>`;
    });

    // Add subtype row (admin only)
    if (canManage) {
      html += `
        <div class="tree-add-row" data-action="add-subtype" data-id="${type.id}" data-name="${escHtml(type.name)}">
          ＋ Add subtype
        </div>`;
    }

    html += `</div>`; // close tree-subtypes
  });

  body.innerHTML = html;

  // Attach tree click listener once only
  if (!_treeClickBound) {
    body.addEventListener('click', handleTreeClick);
    _treeClickBound = true;
  }
}

function buildTreeTplItems(typeId, subtypeId) {
  const items = allTemplates.filter(t =>
    t.service_type_id === typeId && t.service_subtype_id === subtypeId
  );
  if (items.length === 0) {
    return `<div style="padding:6px 14px 6px 42px;font-size:11px;color:var(--text-muted);font-style:italic">No templates</div>`;
  }
  return items.map(t => `
    <div class="tree-tpl-item ${activeTemplate?.id === t.id ? 'active' : ''}"
         data-action="select-tpl" data-id="${t.id}">
      <span class="tree-tpl-dot"></span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(t.name)}</span>
    </div>`).join('');
}

function handleTreeClick(e) {
  // Ignore clicks on children with their own data-action (stopPropagation-less delegation)
  const target = e.target.closest('[data-action]');
  if (!target) return;

  const action = target.dataset.action;

  if (action === 'select-all') {
    selTypeId    = 'all';
    selSubtypeId = null;
    activeTemplate = null;
    renderTree();
    showTemplateList(null, null, 'all');
    return;
  }

  if (action === 'toggle-type') {
    const id  = target.dataset.id;
    const st  = serviceTypes.find(t => t.id === id);
    if (!st) return;
    st._open = !(st._open !== false); // toggle (default true)
    renderTree();
    return;
  }

  if (action === 'toggle-subtype') {
    const typeId = target.dataset.typeId;
    const subId  = target.dataset.id;
    const st     = serviceTypes.find(t => t.id === typeId);
    if (!st) return;
    const sub = st.subtypes.find(s => s.id === subId);
    if (!sub) return;
    sub._open = !sub._open;
    selTypeId    = typeId;
    selSubtypeId = subId;
    renderTree();
    if (sub._open) showTemplateList(typeId, subId);
    return;
  }

  if (action === 'select-tpl') {
    const id = target.dataset.id;
    const tpl = allTemplates.find(t => t.id === id);
    if (tpl) { activeTemplate = tpl; renderTree(); showTemplateDetail(tpl); }
    return;
  }

  if (action === 'add-subtype') {
    e.stopPropagation();
    openCatModal(target.dataset.id, target.dataset.name);
    return;
  }

  if (action === 'del-type') {
    e.stopPropagation();
    deleteServiceType(target.dataset.id, target.dataset.name);
    return;
  }

  if (action === 'del-subtype') {
    e.stopPropagation();
    deleteSubtype(target.dataset.id, target.dataset.name);
    return;
  }
}

// ── Right panel: template list ──────────────────────────
function showTemplateList(typeId, subtypeId, mode = 'subtype') {
  let list, breadcrumb;
  if (mode === 'all') {
    list = allTemplates;
    breadcrumb = `<strong>All Templates</strong>`;
  } else {
    list = allTemplates.filter(t =>
      t.service_type_id === typeId && t.service_subtype_id === subtypeId
    );
    const typeName = serviceTypes.find(t => t.id === typeId)?.name || '';
    const sub = serviceTypes.find(t => t.id === typeId)?.subtypes?.find(s => s.id === subtypeId);
    breadcrumb = `${escHtml(typeName)} <span class="tpl-breadcrumb-sep">›</span> <strong>${escHtml(sub?.name || '')}</strong>`;
  }

  const panel = document.getElementById('detail-panel');

  if (list.length === 0) {
    panel.innerHTML = `
      <div class="detail-empty" style="display:flex">
        <div class="detail-empty-icon"><i data-icon="inbox"></i></div>
        <div class="detail-empty-text">No templates here yet</div>
        ${canManage ? `<button class="btn btn-primary btn-sm" id="btn-empty-new-tpl" style="margin-top:6px">+ New Template</button>` : ''}
      </div>`;
    document.getElementById('btn-empty-new-tpl')?.addEventListener('click', () => openTemplateModal());
    return;
  }

  let cardsHtml = list.map(t => `
    <div class="tpl-mini-card ${activeTemplate?.id === t.id ? 'active' : ''}"
         data-action="select-tpl-card" data-id="${t.id}">
      <div class="tpl-mini-name">${escHtml(t.name)}</div>
      <div class="tpl-mini-summary">${escHtml(t.summary)}</div>
    </div>`).join('');

  panel.innerHTML = `
    <div class="tpl-list-panel">
      <div class="tpl-list-header">
        <div class="tpl-list-breadcrumb">${breadcrumb} · <span style="color:var(--text-muted)">${list.length} template${list.length !== 1 ? 's' : ''}</span></div>
      </div>
      ${cardsHtml}
    </div>`;

  panel.querySelector('.tpl-list-panel').addEventListener('click', e => {
    const card = e.target.closest('[data-action="select-tpl-card"]');
    if (!card) return;
    const tpl = allTemplates.find(t => t.id === card.dataset.id);
    if (tpl) { activeTemplate = tpl; renderTree(); showTemplateDetail(tpl); }
  });
}

// ── Right panel: template detail ───────────────────────
let _detailClickHandler = null;

function showTemplateDetail(t) {
  // Breadcrumb
  const typeName = serviceTypes.find(st => st.id === t.service_type_id)?.name || '';
  const subName  = serviceTypes
    .find(st => st.id === t.service_type_id)?.subtypes
    ?.find(s => s.id === t.service_subtype_id)?.name || '';

  const breadcrumbHtml = (typeName && subName)
    ? `<span>${escHtml(typeName)}</span><span class="tpl-breadcrumb-sep"> › </span><span>${escHtml(subName)}</span><span class="tpl-breadcrumb-sep"> › </span><span>Template</span>`
    : `<span>Template</span>`;

  const fields = t.fields || {};
  const fieldItems = Object.entries(getFieldLabels())
    .filter(([k]) => fields[k])
    .map(([k, label]) => {
      const val = k === 'customfield_17026' && fields[k] === 'auto'
        ? '<i data-icon="clock"></i> Auto (current time)'
        : escHtml(fields[k]);
      return `<div class="detail-field-item">
        <div class="detail-field-key">${label}</div>
        <div class="detail-field-val">${val}</div>
      </div>`;
    }).join('');

  const canDelete = canManage || t.created_by === currentUser?.id;

  const panel = document.getElementById('detail-panel');
  panel.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%;overflow:hidden">
      <div class="tpl-detail-topbar">
        <div class="tpl-detail-meta">
          <div class="tpl-breadcrumb">${breadcrumbHtml}</div>
          <div class="tpl-detail-name">${escHtml(t.name)}</div>
          <span class="badge badge-gray">${escHtml(t.category || 'Incident')}</span>
        </div>
        <div class="tpl-detail-actions">
          <button class="btn btn-ghost btn-sm" data-action="edit-tpl" data-id="${t.id}"><i data-icon="pencil"></i> Edit</button>
          ${canDelete ? `<button class="btn btn-ghost btn-sm" data-action="del-tpl" data-id="${t.id}" style="color:var(--danger)">✕ Delete</button>` : ''}
        </div>
      </div>
      <div class="tpl-detail-body" style="overflow-y:auto;flex:1">
        <div class="detail-section">
          <div class="detail-section-label">Summary (Ticket Title)</div>
          <div class="detail-section-value" style="color:var(--orange)">${escHtml(t.summary)}</div>
        </div>
        <div class="detail-divider"></div>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);margin-bottom:10px">Jira Fields</div>
        <div class="detail-fields-grid">${fieldItems || '<div style="color:var(--text-muted);font-size:12px">No custom fields set</div>'}</div>
      </div>
      <div class="tpl-detail-footer">
        <div class="tpl-footer-author">
          Created by <strong>${escHtml(t.author_name || '—')}</strong>
          · ${t.created_at ? new Date(t.created_at).toLocaleDateString('th-TH') : ''}
        </div>
        <button class="btn btn-primary" data-action="create-ticket" data-id="${t.id}">
          <i data-icon="zap"></i> Create Ticket
        </button>
      </div>
    </div>`;

  if (_detailClickHandler) panel.removeEventListener('click', _detailClickHandler);
  _detailClickHandler = e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'edit-tpl')      editTemplate(btn.dataset.id);
    if (btn.dataset.action === 'del-tpl')       deleteTemplate(btn.dataset.id);
    if (btn.dataset.action === 'create-ticket') openTicketModal(btn.dataset.id);
  };
  panel.addEventListener('click', _detailClickHandler);
}

// ── Template modal ──────────────────────────────────────
function populateServiceTypeDropdown(selTypeId = '', selSubtypeId = '') {
  const typeSelect = document.getElementById('tpl-service-type');
  const subSelect  = document.getElementById('tpl-service-subtype');

  typeSelect.innerHTML = `<option value="">— Not assigned —</option>` +
    serviceTypes.map(t => `<option value="${t.id}" ${t.id === selTypeId ? 'selected' : ''}>${escHtml(t.name)}</option>`).join('');

  updateSubtypeDropdown(selTypeId, selSubtypeId);

  typeSelect.onchange = () => updateSubtypeDropdown(typeSelect.value, '');
}

function updateSubtypeDropdown(typeId, selSubtypeId = '') {
  const subSelect = document.getElementById('tpl-service-subtype');
  const type = serviceTypes.find(t => t.id === typeId);
  if (!type || !type.subtypes?.length) {
    subSelect.innerHTML = `<option value="">— None —</option>`;
    subSelect.disabled = true;
    return;
  }
  subSelect.disabled = false;
  subSelect.innerHTML = `<option value="">— Select subtype —</option>` +
    type.subtypes.map(s => `<option value="${s.id}" ${s.id === selSubtypeId ? 'selected' : ''}>${escHtml(s.name)}</option>`).join('');
}

function populateCategoryDropdown(selCat = '') {
  const sel = document.getElementById('tpl-cat');
  const cats = jiraConfig.categories || [];
  if (cats.length === 0) {
    // Fallback to hardcoded if config not loaded
    sel.innerHTML = ['Incident','Change','Problem','Request']
      .map(c => `<option value="${c}" ${c === selCat ? 'selected' : ''}>${c}</option>`).join('');
  } else {
    sel.innerHTML = cats.map(c =>
      `<option value="${c.name}" ${c.name === selCat ? 'selected' : ''}>${escHtml(c.name)}</option>`
    ).join('');
  }
}

function populateIssueTypeDropdown(selIt = '') {
  const sel = document.getElementById('tpl-issuetype');
  const its = jiraConfig.issue_types || [];
  // Use datalist for free-text + suggestions
  let datalist = document.getElementById('issuetype-list');
  if (!datalist) {
    datalist = document.createElement('datalist');
    datalist.id = 'issuetype-list';
    document.body.appendChild(datalist);
    sel.setAttribute('list', 'issuetype-list');
  }
  if (its.length > 0) {
    datalist.innerHTML = its.map(it => `<option value="${escHtml(it.name)}">`).join('');
  } else {
    datalist.innerHTML = ['Task','Bug','Story','Epic'].map(v => `<option value="${v}">`).join('');
  }
  sel.value = selIt || 'Task';
}

// ── Tag input helpers ────────────────────────────────────
function addTag(selectEl, hiddenId, wrapId) {
  const val = selectEl.value;
  if (!val) return;
  selectEl.value = ''; // reset dropdown

  const hidden = document.getElementById(hiddenId);
  const wrap   = document.getElementById(wrapId);
  if (!hidden || !wrap) return;

  // Avoid duplicates
  const current = hidden.value ? hidden.value.split(',').map(s => s.trim()) : [];
  if (current.includes(val)) return;
  current.push(val);
  hidden.value = current.join(',');

  // Insert chip before the select
  const chip = document.createElement('span');
  chip.className = 'tag-chip';
  chip.innerHTML = `${escHtml(val)}<button type="button" class="tag-chip-remove" onclick="removeTag(this,'${hiddenId}')" data-val="${escHtml(val)}"><i data-icon="x"></i></button>`;
  wrap.insertBefore(chip, selectEl);
}

function removeTag(btnEl, hiddenId) {
  const val    = btnEl.dataset.val;
  const hidden = document.getElementById(hiddenId);
  if (hidden) {
    const updated = hidden.value.split(',').map(s => s.trim()).filter(s => s !== val);
    hidden.value  = updated.join(',');
  }
  btnEl.closest('.tag-chip').remove();
}

function populateWorkTypeDropdown(selected = '') {
  const sel = document.getElementById('tpl-worktype');
  if (!sel) return;
  const opts = jiraIssueTypes.length > 0
    ? jiraIssueTypes.map(it =>
        `<option value="${escHtml(it.name)}" ${it.name === selected ? 'selected' : ''}>${escHtml(it.name)}</option>`
      ).join('')
    : `<option value="Task" ${selected==='Task'?'selected':''}>Task</option>
       <option value="Monitoring" ${selected==='Monitoring'?'selected':''}>Monitoring</option>
       <option value="Batchfile" ${selected==='Batchfile'?'selected':''}>Batchfile</option>`;
  sel.innerHTML = `<option value="">— เลือก Work Type —</option>${opts}`;
}

function openTemplateModal(tplId = null) {
  const t = tplId ? allTemplates.find(x => x.id === tplId) : null;
  document.getElementById('tpl-modal-title').textContent = t ? 'Edit Template' : 'New Template';
  document.getElementById('tpl-edit-id').value  = t?.id || '';
  document.getElementById('tpl-name').value     = t?.name || '';
  document.getElementById('tpl-summary').value  = t?.summary || '';

  populateCategoryDropdown(t?.category || '');
  populateServiceTypeDropdown(t?.service_type_id || '', t?.service_subtype_id || '');
  populateWorkTypeDropdown(t?.fields?.issuetype || '');
  renderDynamicFields(t?.fields || {});
  openModal('tpl-modal');
}

function editTemplate(id) { openTemplateModal(id); }

document.getElementById('btn-save-tpl').onclick = async () => {
  const id      = document.getElementById('tpl-edit-id').value;
  const name    = document.getElementById('tpl-name').value.trim();
  const summary = document.getElementById('tpl-summary').value.trim();
  const saveText = document.getElementById('tpl-save-text');
  const saveSpin = document.getElementById('tpl-save-spin');

  if (!name)    { Toast.warning('Template name is required'); return; }
  if (!summary) { Toast.warning('Case summary is required'); return; }

  saveText.textContent = 'Saving...';
  saveSpin.classList.remove('hidden');

  const payload = {
    name, summary,
    category:           document.getElementById('tpl-cat').value,
    service_type_id:    document.getElementById('tpl-service-type').value,
    service_subtype_id: document.getElementById('tpl-service-subtype').value,
    fields: {
      issuetype: document.getElementById('tpl-worktype').value,
      ...collectDynamicFields()
    }
  };

  if (!payload.fields.issuetype) { Toast.warning('กรุณาเลือก Work Type'); return; }

  const res = id
    ? await API.templates.update(id, payload)
    : await API.templates.create(payload);

  saveText.textContent = 'Save Template';
  saveSpin.classList.add('hidden');

  if (res?.ok) {
    Toast.success(id ? 'Template updated!' : 'Template created!');
    closeModal('tpl-modal');
    await reload();
    // Re-show active template detail if edited
    if (id && activeTemplate?.id === id) {
      const updated = allTemplates.find(t => t.id === id);
      if (updated) showTemplateDetail(updated);
    }
  } else {
    Toast.error(res?.data?.message || 'Failed to save');
  }
};

async function deleteTemplate(id) {
  const confirmed = await confirmDialog('Delete this template? This cannot be undone.', 'Delete Template');
  if (!confirmed) return;
  const res = await API.templates.delete(id);
  if (res?.ok) {
    Toast.success('Template deleted');
    if (activeTemplate?.id === id) {
      activeTemplate = null;
      document.getElementById('detail-panel').innerHTML = `
        <div class="detail-empty" style="display:flex">
          <div class="detail-empty-icon"><i data-icon="zap"></i></div>
          <div class="detail-empty-text">Select a template from the left</div>
        </div>`;
    }
    await reload();
  } else {
    Toast.error(res?.data?.message || 'Failed to delete');
  }
}

// ── Category / Subtype modals ────────────────────────────
document.getElementById('btn-add-type').onclick = () => {
  document.getElementById('cat-parent-id').value = '';
  document.getElementById('cat-modal-title').textContent = 'Add Category';
  document.getElementById('cat-name-label').textContent  = 'Category Name';
  document.getElementById('cat-name').value = '';
  document.getElementById('cat-name').placeholder = 'e.g. Service Bank';
  openModal('cat-modal');
};

function openCatModal(parentId, parentName) {
  document.getElementById('cat-parent-id').value = parentId;
  document.getElementById('cat-modal-title').textContent = `Add Subtype — ${parentName}`;
  document.getElementById('cat-name-label').textContent  = 'Subtype Name';
  document.getElementById('cat-name').value = '';
  document.getElementById('cat-name').placeholder = 'e.g. KBANK';
  openModal('cat-modal');
}

document.getElementById('btn-save-cat').onclick = async () => {
  const parentId = document.getElementById('cat-parent-id').value;
  const name     = document.getElementById('cat-name').value.trim();
  const saveText = document.getElementById('cat-save-text');
  const saveSpin = document.getElementById('cat-save-spin');

  if (!name) { Toast.warning('Name is required'); return; }

  saveText.textContent = 'Saving...';
  saveSpin.classList.remove('hidden');

  const res = parentId
    ? await API.serviceTypes.createSubtype(parentId, { name })
    : await API.serviceTypes.createType({ name });

  saveText.textContent = 'Add';
  saveSpin.classList.add('hidden');

  if (res?.ok) {
    Toast.success(parentId ? 'Subtype added!' : 'Category created!');
    closeModal('cat-modal');
    await reload();
  } else {
    Toast.error(res?.data?.message || 'Failed to save');
  }
};

async function deleteServiceType(id, name) {
  const confirmed = await confirmDialog(`Delete category "${name}" and all its subtypes? Templates in this category will become unclassified.`, 'Delete Category');
  if (!confirmed) return;
  const res = await API.serviceTypes.delete(id);
  if (res?.ok) { Toast.success('Category deleted'); await reload(); }
  else Toast.error(res?.data?.message || 'Failed');
}

async function deleteSubtype(id, name) {
  const confirmed = await confirmDialog(`Delete subtype "${name}"? Templates in this subtype will become unclassified.`, 'Delete Subtype');
  if (!confirmed) return;
  const res = await API.serviceTypes.delete(id);
  if (res?.ok) { Toast.success('Subtype deleted'); await reload(); }
  else Toast.error(res?.data?.message || 'Failed');
}

// ── Reload data and re-render tree ──────────────────────
async function reload() {
  const [typesRes, tplRes, cfgRes] = await Promise.all([
    API.serviceTypes.list(),
    API.templates.list(),
    API.jiraConfig.get()
  ]);
  if (typesRes?.ok) serviceTypes = typesRes.data.data || [];
  if (tplRes?.ok)   allTemplates = tplRes.data.data   || [];
  if (cfgRes?.ok)   jiraConfig   = cfgRes.data.data   || { categories: [], issue_types: [] };
  renderTree();
}

// ── Create Ticket ───────────────────────────────────────
function openTicketModal(id) {
  const t = allTemplates.find(x => x.id === id);
  if (!t) return;
  activeTemplate = t;
  trackJiraTemplateUse(t.name || t.summary || id);

  const fields = t.fields || {};

  // Find fault_start field id dynamically
  const faultCf = (jiraConfig.custom_fields || []).find(f => f.field_type === 'fault_start');
  const faultFieldId = faultCf?.field_id || 'customfield_17026';
  const faultVal     = fields[faultFieldId];
  const isAutoTime   = !faultVal || faultVal === 'auto';

  const fieldLabels = getFieldLabels();
  const rows = Object.entries(fieldLabels).map(([k, label]) => {
    const cfDef = (jiraConfig.custom_fields || []).find(f => f.field_id === k);
    let val = '';
    if (cfDef?.field_type === 'fault_start') {
      val = isAutoTime ? `<span class="badge badge-blue"><i data-icon="clock"></i> Current time (auto)</span>` : escHtml(fields[k] || '');
    } else {
      val = escHtml(fields[k] || '—');
    }
    return `<tr>
      <td style="font-size:10px;color:var(--text-muted);font-weight:600;text-transform:uppercase;padding:6px 0;width:50%">${label}</td>
      <td style="font-size:12px;padding:6px 0">${val}</td>
    </tr>`;
  }).join('');

  const worktypeRow = fields.issuetype ? `
      <tr>
        <td style="font-size:10px;color:var(--text-muted);font-weight:600;text-transform:uppercase;padding:6px 0;width:50%">Work Type</td>
        <td style="font-size:12px;padding:6px 0">${escHtml(fields.issuetype)}</td>
      </tr>` : '';

  document.getElementById('ticket-preview').innerHTML = `
    <table style="width:100%;border-collapse:collapse">
      <tr>
        <td style="font-size:10px;color:var(--text-muted);font-weight:600;text-transform:uppercase;padding:6px 0;width:50%">Summary (Title)</td>
        <td style="font-size:12px;padding:6px 0;font-weight:600;color:var(--orange)">${escHtml(t.summary)}</td>
      </tr>
      ${worktypeRow}
      ${rows}
    </table>`;

  const faultRow = document.getElementById('ticket-fault-row');
  if (!isAutoTime && faultVal === 'manual') {
    faultRow.style.display = 'block';
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    document.getElementById('ticket-fault-input').value = now.toISOString().slice(0,16);
  } else {
    faultRow.style.display = 'none';
  }
  openModal('ticket-modal');
}

document.getElementById('create-ticket-btn').onclick = async () => {
  if (!activeTemplate) return;
  const btn  = document.getElementById('create-ticket-btn');
  const text = document.getElementById('ticket-btn-text');
  const spin = document.getElementById('ticket-spin');

  btn.disabled = true;
  text.textContent = 'Creating...';
  spin.classList.remove('hidden');

  const fields = { ...activeTemplate.fields };
  // Handle fault_start field dynamically
  const faultCf2     = (jiraConfig.custom_fields || []).find(f => f.field_type === 'fault_start');
  const faultFieldId2 = faultCf2?.field_id || 'customfield_17026';
  if (fields[faultFieldId2] === 'auto' || !fields[faultFieldId2]) {
    fields[faultFieldId2] = 'auto';
  } else if (fields[faultFieldId2] === 'manual') {
    const manualInput = document.getElementById('ticket-fault-input').value;
    fields[faultFieldId2] = manualInput ? new Date(manualInput).toISOString() : 'auto';
  }

  const res = await API.jira.createTicket({ summary: activeTemplate.summary, fields });

  btn.disabled = false;
  text.innerHTML = '<i data-icon="zap"></i> Create Ticket';
  spin.classList.add('hidden');

  if (res?.ok) {
    closeModal('ticket-modal');
    const { issue_key, issue_url } = res.data.data;
    trackTicketCreate(activeTemplate?.name || activeTemplate?.summary || 'unknown');
    document.getElementById('ticket-key-display').textContent = `Ticket: ${issue_key}`;
    document.getElementById('ticket-jira-link').href = issue_url;

    // Always show email button
    const _tplSnap = activeTemplate;
    const emailBtn = document.getElementById('btn-open-email-draft');
    emailBtn.style.display = '';
    emailBtn.onclick = () => {
      closeModal('success-modal');
      openEmailDraft({
        issue_key,
        summary:   _tplSnap?.summary || '',
        subtypeId: _tplSnap?.service_subtype_id || selSubtypeId,
      });
    };

    openModal('success-modal');
    Toast.success(`Ticket ${issue_key} created!`);
  } else {
    Toast.error(res?.data?.message || 'Failed to create ticket');
  }
  activeTemplate = null;
};

// ── Email Draft ─────────────────────────────────────────────
let _mailCfg = null;
let _draftToEmails = [];
let _draftCcEmails = [];

function getSubtypeEmails(subtypeId) {
  if (!subtypeId) return [];
  for (const t of serviceTypes) {
    const sub = (t.subtypes || []).find(s => s.id === subtypeId);
    if (sub) return sub.emails || [];
  }
  return [];
}

async function openEmailDraft({ issue_key, summary, subtypeId = null }) {
  // Load mail config if not yet loaded
  if (!_mailCfg) {
    const r = await API.mailConfig.get();
    _mailCfg = r?.ok ? (r.data.data || {}) : {};
  }

  _draftToEmails = getSubtypeEmails(subtypeId || selSubtypeId);
  _draftCcEmails = Array.isArray(_mailCfg.global_cc) ? [..._mailCfg.global_cc] : [];

  renderDraftChips('draft-to-field', 'draft-to-input', _draftToEmails);
  renderDraftChips('draft-cc-field', 'draft-cc-input', _draftCcEmails);

  document.getElementById('draft-subject').value =
    `[${issue_key}] - ${summary}`;

  // Note: signature/footer is now rendered server-side as a styled banner.
  // Editor starts empty so the user only types the body content.
  const editorBody = document.getElementById('draft-body');
  editorBody.innerHTML = `<p><br></p>`;
  
  // Reset editor state
  document.getElementById('heading-select').value = '';
  editorBody.focus();

  openModal('email-draft-modal');
}

// ── Chip helpers ───────────────────────────────────────────
function renderDraftChips(fieldId, inputId, list) {
  const field = document.getElementById(fieldId);
  const input = document.getElementById(inputId);
  field.querySelectorAll('.em-chip').forEach(c => c.remove());
  list.forEach(email => {
    const chip = document.createElement('span');
    chip.className = 'em-chip';
    chip.innerHTML = `${escHtml(email)}<button class="em-chip-x" data-email="${escHtml(email)}" data-list="${fieldId}" title="ลบ">×</button>`;
    field.insertBefore(chip, input);
  });
}

function addDraftEmail(fieldId, inputId, list) {
  const input  = document.getElementById(inputId);
  const raw    = input.value.trim().replace(/,\s*$/, '');
  if (!raw) return;
  const emails = parseEmailList(raw);
  if (!emails.length && raw.includes('@')) emails.push(raw);
  if (!emails.length) return;
  emails.forEach(em => { if (!list.includes(em)) list.push(em); });
  renderDraftChips(fieldId, inputId, list);
  input.value = '';
}

['draft-to', 'draft-cc'].forEach(prefix => {
  const fieldId = prefix + '-field';
  const inputId = prefix + '-input';
  const arr     = () => prefix === 'draft-to' ? _draftToEmails : _draftCcEmails;

  document.getElementById(fieldId).addEventListener('click', e => {
    const btn = e.target.closest('.em-chip-x');
    if (!btn) return;
    const list = btn.dataset.list === 'draft-to-field' ? _draftToEmails : _draftCcEmails;
    const idx  = list.indexOf(btn.dataset.email);
    if (idx > -1) list.splice(idx, 1);
    renderDraftChips(btn.dataset.list, inputId, list);
  });

  document.getElementById(inputId).addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addDraftEmail(fieldId, inputId, arr()); }
    if (e.key === 'Backspace' && !e.target.value && arr().length) {
      arr().pop(); renderDraftChips(fieldId, inputId, arr());
    }
  });
  document.getElementById(inputId).addEventListener('blur', () => addDraftEmail(fieldId, inputId, arr()));
  document.getElementById(inputId).addEventListener('paste', e => {
    e.preventDefault();
    const pasted = (e.clipboardData || window.clipboardData).getData('text');
    if (!pasted) return;
    const emails = parseEmailList(pasted);
    if (!emails.length) { document.getElementById(inputId).value = pasted; return; }
    let added = 0;
    emails.forEach(em => { if (!arr().includes(em)) { arr().push(em); added++; } });
    if (added) { renderDraftChips(fieldId, inputId, arr()); Toast.success(`เพิ่ม ${added} email แล้ว`); }
  });
});

// ── Rich Text Editor Setup ───────────────────────────────
const editorContent = document.getElementById('draft-body');

// Paste handler — convert clipboard images (Cmd+V / Ctrl+V) to inline base64 img
editorContent.addEventListener('paste', e => {
  const items = e.clipboardData?.items || [];
  for (const item of items) {
    if (item.type?.startsWith('image/')) {
      e.preventDefault();
      const file = item.getAsFile();
      if (!file) continue;
      const r = new FileReader();
      r.onload = ev => {
        document.execCommand('insertHTML', false,
          `<img src="${ev.target.result}" style="max-width:100%;height:auto;border-radius:4px;margin:6px 0">`);
      };
      r.readAsDataURL(file);
      return;
    }
  }
  // Plain text: strip rich formatting from external sources (Word, web pages, etc.)
  const text = e.clipboardData?.getData('text/plain');
  if (text && !e.clipboardData.types.includes('text/html')) {
    e.preventDefault();
    document.execCommand('insertText', false, text);
  }
});

// Make Enter create <p> instead of <div> (cleaner HTML output)
try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch {}

// Click any image to resize/delete (toolbar + corner drag handle)
setupImageResize(editorContent);

// Formatting buttons
document.getElementById('btn-bold').addEventListener('click', () => {
  document.execCommand('bold', false, null);
  editorContent.focus();
});

document.getElementById('btn-italic').addEventListener('click', () => {
  document.execCommand('italic', false, null);
  editorContent.focus();
});

document.getElementById('btn-underline').addEventListener('click', () => {
  document.execCommand('underline', false, null);
  editorContent.focus();
});

document.getElementById('btn-strikethrough').addEventListener('click', () => {
  document.execCommand('strikethrough', false, null);
  editorContent.focus();
});

document.getElementById('btn-unordered-list').addEventListener('click', () => {
  document.execCommand('insertUnorderedList', false, null);
  editorContent.focus();
});

document.getElementById('btn-ordered-list').addEventListener('click', () => {
  document.execCommand('insertOrderedList', false, null);
  editorContent.focus();
});

document.getElementById('btn-clear-format').addEventListener('click', () => {
  document.execCommand('removeFormat', false, null);
  document.execCommand('formatBlock', false, 'p');
  editorContent.focus();
});

// Text color picker
document.getElementById('text-color-picker').addEventListener('change', (e) => {
  document.execCommand('foreColor', false, e.target.value);
  editorContent.focus();
});

// Background color picker
document.getElementById('bg-color-picker').addEventListener('change', (e) => {
  document.execCommand('backColor', false, e.target.value);
  editorContent.focus();
});

// Heading selector
document.getElementById('heading-select').addEventListener('change', (e) => {
  if (e.target.value) {
    document.execCommand('formatBlock', false, `<${e.target.value}>`);
  } else {
    document.execCommand('formatBlock', false, '<p>');
  }
  editorContent.focus();
});

// Link insertion
document.getElementById('btn-link').addEventListener('click', () => {
  const url = prompt('ใส่ URL:');
  if (url) {
    document.execCommand('createLink', false, url);
  }
  editorContent.focus();
});

// Image insertion
document.getElementById('btn-image').addEventListener('click', () => {
  document.getElementById('image-input').click();
});

document.getElementById('image-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (ev) => {
    const imgHtml = `<img src="${ev.target.result}" style="max-width: 100%; height: auto; border-radius: 4px; margin: 8px 0;">`;
    document.execCommand('insertHTML', false, imgHtml);
  };
  reader.readAsDataURL(file);
  e.target.value = ''; // reset input
  editorContent.focus();
});

// Keyboard shortcuts
editorContent.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'b') { e.preventDefault(); document.execCommand('bold', false, null); }
    if (e.key === 'i') { e.preventDefault(); document.execCommand('italic', false, null); }
    if (e.key === 'u') { e.preventDefault(); document.execCommand('underline', false, null); }
  }
});

// ── Send email ─────────────────────────────────────────────
document.getElementById('btn-send-email').addEventListener('click', async () => {
  addDraftEmail('draft-to-field', 'draft-to-input', _draftToEmails);
  addDraftEmail('draft-cc-field', 'draft-cc-input', _draftCcEmails);

  if (!_draftToEmails.length) { Toast.warning('ระบุ email ผู้รับ (To) อย่างน้อย 1 ที่อยู่'); return; }

  const subject = document.getElementById('draft-subject').value.trim();
  const bodyHtml = editorContent.innerHTML.trim();
  if (!subject) { Toast.warning('กรุณาระบุ Subject'); return; }
  if (!bodyHtml) { Toast.warning('กรุณาระบุเนื้อหา'); return; }

  const text = document.getElementById('send-email-text');
  const spin = document.getElementById('send-email-spin');
  text.textContent = 'กำลังส่ง…';
  spin.classList.remove('hidden');
  document.getElementById('btn-send-email').disabled = true;

  const res = await API.mail.send({
    to:      _draftToEmails,
    cc:      _draftCcEmails,
    subject,
    body:    bodyHtml,
    isHtml:  true,  // New flag to indicate HTML email
  });

  text.innerHTML = '<i data-icon="mail"></i> ส่ง Email';
  spin.classList.add('hidden');
  document.getElementById('btn-send-email').disabled = false;

  if (res?.ok) {
    Toast.success(`ส่ง Email สำเร็จ <i data-icon="sparkles"></i> (${_draftToEmails.length} ผู้รับ)`);
    closeModal('email-draft-modal');
  } else {
    Toast.error(res?.data?.message || 'ส่งไม่สำเร็จ');
  }
});

function loadIncidents() {}
function renderIncidents() {}
function showIncidentDetail() {}
function populateFilterDropdowns() {}
function applyFilters() {}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ── Bootstrap ───────────────────────────────────────────
init();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "addDraftEmail", { configurable: true, get: () => addDraftEmail, set: (v) => { addDraftEmail = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "addTag", { configurable: true, get: () => addTag, set: (v) => { addTag = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "applyFilters", { configurable: true, get: () => applyFilters, set: (v) => { applyFilters = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "buildTreeTplItems", { configurable: true, get: () => buildTreeTplItems, set: (v) => { buildTreeTplItems = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeModal", { configurable: true, get: () => closeModal, set: (v) => { closeModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "collectDynamicFields", { configurable: true, get: () => collectDynamicFields, set: (v) => { collectDynamicFields = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "countTemplates", { configurable: true, get: () => countTemplates, set: (v) => { countTemplates = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "deleteServiceType", { configurable: true, get: () => deleteServiceType, set: (v) => { deleteServiceType = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "deleteSubtype", { configurable: true, get: () => deleteSubtype, set: (v) => { deleteSubtype = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "deleteTemplate", { configurable: true, get: () => deleteTemplate, set: (v) => { deleteTemplate = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "editTemplate", { configurable: true, get: () => editTemplate, set: (v) => { editTemplate = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "escapeHtml", { configurable: true, get: () => escapeHtml, set: (v) => { escapeHtml = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "getFieldLabels", { configurable: true, get: () => getFieldLabels, set: (v) => { getFieldLabels = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "getSubtypeEmails", { configurable: true, get: () => getSubtypeEmails, set: (v) => { getSubtypeEmails = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "handleTreeClick", { configurable: true, get: () => handleTreeClick, set: (v) => { handleTreeClick = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "init", { configurable: true, get: () => init, set: (v) => { init = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadIncidents", { configurable: true, get: () => loadIncidents, set: (v) => { loadIncidents = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openCatModal", { configurable: true, get: () => openCatModal, set: (v) => { openCatModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openEmailDraft", { configurable: true, get: () => openEmailDraft, set: (v) => { openEmailDraft = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openModal", { configurable: true, get: () => openModal, set: (v) => { openModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openTemplateModal", { configurable: true, get: () => openTemplateModal, set: (v) => { openTemplateModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openTicketModal", { configurable: true, get: () => openTicketModal, set: (v) => { openTicketModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "populateCategoryDropdown", { configurable: true, get: () => populateCategoryDropdown, set: (v) => { populateCategoryDropdown = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "populateFilterDropdowns", { configurable: true, get: () => populateFilterDropdowns, set: (v) => { populateFilterDropdowns = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "populateIssueTypeDropdown", { configurable: true, get: () => populateIssueTypeDropdown, set: (v) => { populateIssueTypeDropdown = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "populateServiceTypeDropdown", { configurable: true, get: () => populateServiceTypeDropdown, set: (v) => { populateServiceTypeDropdown = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "populateWorkTypeDropdown", { configurable: true, get: () => populateWorkTypeDropdown, set: (v) => { populateWorkTypeDropdown = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "reload", { configurable: true, get: () => reload, set: (v) => { reload = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "removeTag", { configurable: true, get: () => removeTag, set: (v) => { removeTag = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderDraftChips", { configurable: true, get: () => renderDraftChips, set: (v) => { renderDraftChips = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderDynamicFields", { configurable: true, get: () => renderDynamicFields, set: (v) => { renderDynamicFields = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderIncidents", { configurable: true, get: () => renderIncidents, set: (v) => { renderIncidents = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderTree", { configurable: true, get: () => renderTree, set: (v) => { renderTree = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "showIncidentDetail", { configurable: true, get: () => showIncidentDetail, set: (v) => { showIncidentDetail = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "showTemplateDetail", { configurable: true, get: () => showTemplateDetail, set: (v) => { showTemplateDetail = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "showTemplateList", { configurable: true, get: () => showTemplateList, set: (v) => { showTemplateList = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updateSubtypeDropdown", { configurable: true, get: () => updateSubtypeDropdown, set: (v) => { updateSubtypeDropdown = v; } }); } catch (e) {}
})();
