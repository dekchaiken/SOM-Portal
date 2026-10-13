/* ══════════════════════════════════════════════════
   knowledge-base.js  |  Knowledge Base Management
   ══════════════════════════════════════════════════ */

const DEFAULT_CATEGORIES = {
  'block-biz-rule': {
    name: 'Block Biz Rule',
    fields: [
      { name: 'Usecase', type: 'text', required: true },
      { name: 'Tool', type: 'dropdown', options: ['Jenkins', 'Admin Portal', 'Rundeck', 'Kims Portal', '3rd Party'], required: true },
      { name: 'Application', type: 'text', required: false },
      { name: 'Key', type: 'text', required: false },
      { name: 'Job', type: 'url', required: false },
      { name: 'Manual', type: 'url', required: false },
      { name: 'Monitor', type: 'url', required: false },
      { name: 'Manual Dev', type: 'url', required: false },
      { name: 'Remark', type: 'text', required: false }
    ]
  },
  'switch-gateway': {
    name: 'Switch Gateway',
    fields: [
      { name: 'Service Name', type: 'text', required: true },
      { name: 'Service', type: 'dropdown', options: ['TMN', 'Nano', 'Wealth', 'VB'], required: true },
      { name: 'Tool', type: 'dropdown', options: ['Jenkins', 'Admin Portal', 'Rundeck', 'Kims Portal', '3rd Party'], required: true },
      { name: 'Link-Manual', type: 'url', required: false },
      { name: 'Remark', type: 'text', required: false }
    ]
  },
  'restart-stop-start': {
    name: 'Restart & Stop-Start Service',
    fields: [
      { name: 'Service Name', type: 'text', required: true },
      { name: 'Service', type: 'dropdown', options: ['TMN', 'Nano', 'Wealth', 'VB'], required: true },
      { name: 'Tool', type: 'dropdown', options: ['Jenkins', 'Admin Portal', 'Rundeck', 'Kims Portal', '3rd Party'], required: true },
      { name: 'Link-Manual', type: 'url', required: false },
      { name: 'Remark', type: 'text', required: false }
    ]
  },
  'network-sg-cf': {
    name: 'Network SG & CF',
    fields: [
      { name: 'Service Name', type: 'text', required: true },
      { name: 'Service', type: 'dropdown', options: ['TMN', 'Nano', 'Wealth', 'VB'], required: true },
      { name: 'Tool', type: 'dropdown', options: ['Jenkins', 'Admin Portal', 'Rundeck', 'Kims Portal', '3rd Party'], required: true },
      { name: 'Link-Manual', type: 'url', required: false },
      { name: 'Job', type: 'url', required: false },
      { name: 'Remark', type: 'text', required: false }
    ]
  },
  'restart-specify-app': {
    name: 'Restart Specify App',
    fields: [
      { name: 'Service Name', type: 'text', required: true },
      { name: 'Service', type: 'dropdown', options: ['TMN', 'Nano', 'Wealth', 'VB'], required: true },
      { name: 'Tool', type: 'dropdown', options: ['Jenkins', 'Admin Portal', 'Rundeck', 'Kims Portal', '3rd Party'], required: true },
      { name: 'Link-Manual', type: 'url', required: false },
      { name: 'Remark', type: 'text', required: false }
    ]
  }
};

let currentCategory = 'block-biz-rule';
let categories = {};
let entries = {};
let editingEntryId = null;
let currentUser = null;

// view mode per category: 'table' | 'cards' | 'compact' | 'matrix'
const viewModes = {};

function isCaseCMCat(catId) {
  const cat = categories[catId];
  return catId === 'case-cm' || (cat && cat.type === 'case-cm');
}

function getViewMode(catId) {
  return viewModes[catId] || (isCaseCMCat(catId) ? 'matrix' : 'table');
}

// ── Init ──────────────────────────────────────────────────
async function _initKnowledgeBase() {
  if (!Auth.requireAuth()) return;
  currentUser = Auth.getUser();
  await Layout.render('knowledge-base');
  await loadData();
  renderTabs();
  renderCategory(currentCategory);
}

// ── Data ──────────────────────────────────────────────────
async function loadData() {
  try {
    const response = await API.knowledgeBase.list();
    if (response && response.ok && response.data) {
      const apiData = response.data.data || response.data;
      categories = apiData.categories || DEFAULT_CATEGORIES;
      entries = apiData.entries || {};
    } else {
      categories = DEFAULT_CATEGORIES;
      entries = {};
    }
  } catch (error) {
    console.error('Failed to load knowledge base:', error);
    categories = DEFAULT_CATEGORIES;
    entries = {};
  }
}

// ── Tabs ──────────────────────────────────────────────────
function renderTabs() {
  const tabsContainer = document.getElementById('kb-tabs');
  tabsContainer.innerHTML = '';

  Object.keys(categories).forEach(catId => {
    const cat = categories[catId];
    const tab = document.createElement('div');
    tab.className = `kb-tab ${catId === currentCategory ? 'active' : ''}`;
    tab.textContent = cat.name;
    tab.onclick = () => switchCategory(catId);
    tabsContainer.appendChild(tab);
  });

  if (canEdit()) {
    const addBtn = document.createElement('button');
    addBtn.className = 'kb-add-cat';
    addBtn.innerHTML = '<i>+</i> Add Category';
    addBtn.onclick = () => openModal('modal-add-category');
    tabsContainer.appendChild(addBtn);
  }
}

function switchCategory(catId) {
  currentCategory = catId;
  renderTabs();
  renderCategory(catId);
}

// ── Category render ───────────────────────────────────────
function renderCategory(catId) {
  const container = document.getElementById('kb-categories');
  const cat = categories[catId];
  const mode = getViewMode(catId);
  const cmCat = isCaseCMCat(catId);

  let catEntries = entries[catId] || [];
  if (catEntries.length > 0 && cat.fields.length > 0) {
    const firstFieldName = cat.fields[0].name;
    catEntries = [...catEntries].sort((a, b) => {
      const aVal = (a.data[firstFieldName] || '').toString().toLowerCase();
      const bVal = (b.data[firstFieldName] || '').toString().toLowerCase();
      return aVal.localeCompare(bVal, 'th');
    });
  }

  const matrixBtn = cmCat
    ? `<button class="kb-view-btn ${mode === 'matrix' ? 'active' : ''}" title="Matrix" onclick="setViewMode('${catId}','matrix')">⊠</button>`
    : '';

  const viewToggleHTML = `
    <div class="kb-view-toggle">
      ${matrixBtn}
      <button class="kb-view-btn ${mode === 'table' ? 'active' : ''}" title="Table" onclick="setViewMode('${catId}','table')">⊞</button>
      <button class="kb-view-btn ${mode === 'cards' ? 'active' : ''}" title="Cards" onclick="setViewMode('${catId}','cards')">▦</button>
      <button class="kb-view-btn ${mode === 'compact' ? 'active' : ''}" title="Compact" onclick="setViewMode('${catId}','compact')">☰</button>
    </div>
  `;

  const toolbarHTML = `
    <div class="kb-toolbar">
      <div class="kb-search">
        <i>⌕</i>
        <input type="text" placeholder="Search..." oninput="filterEntries(this.value)">
      </div>
      ${viewToggleHTML}
      ${canEdit() ? `
        <button class="btn btn-sm btn-outline" onclick="openManageFields()">⚙ Fields</button>
        <button class="btn btn-sm btn-primary" onclick="openAddEntry()">+ Add</button>
      ` : ''}
    </div>
  `;

  let contentHTML = '';
  if (mode === 'matrix' && cmCat) {
    contentHTML = renderCaseCMMatrix(catEntries);
  } else if (mode === 'cards') {
    contentHTML = cmCat ? renderCaseCMCards(catEntries) : renderCardsView(catEntries, cat.fields);
  } else {
    contentHTML = renderTableView(catEntries, cat.fields, mode === 'compact');
  }

  container.innerHTML = `
    <div class="kb-category active" id="kb-content-wrap">
      ${toolbarHTML}
      ${contentHTML}
    </div>
  `;
}

function setViewMode(catId, mode) {
  viewModes[catId] = mode;
  renderCategory(catId);
}

// ── Table view ────────────────────────────────────────────
function renderTableView(catEntries, fields, compact) {
  const cls = compact ? 'kb-table compact' : 'kb-table';
  return `
    <div class="kb-table-wrap">
      <table class="${cls}">
        <thead>
          <tr>
            ${fields.map(f => `<th class="sortable" onclick="sortTable('${f.name}')">${f.name}</th>`).join('')}
            ${canEdit() ? '<th style="width:80px">Actions</th>' : ''}
          </tr>
        </thead>
        <tbody id="kb-table-body">
          ${renderTableRows(catEntries, fields)}
        </tbody>
      </table>
    </div>
  `;
}

function renderTableRows(catEntries, fields) {
  if (catEntries.length === 0) {
    return `<tr><td colspan="${fields.length + (canEdit() ? 1 : 0)}" class="kb-empty">
      <i>◯</i><div>No entries yet. ${canEdit() ? 'Click "+ Add" to create one.' : ''}</div>
    </td></tr>`;
  }
  return catEntries.map(entry => `
    <tr data-search="${escHtml(Object.values(entry.data).join(' ')).toLowerCase()}">
      ${fields.map(field => renderCell(entry, field)).join('')}
      ${canEdit() ? `
        <td class="kb-actions">
          <button class="kb-action-btn edit" onclick="editEntry('${entry.id}')">✎</button>
          <button class="kb-action-btn delete" onclick="deleteEntry('${entry.id}')">×</button>
        </td>` : ''}
    </tr>
  `).join('');
}

function renderCell(entry, field) {
  const value = entry.data[field.name] || '';
  if (field.type === 'url') {
    if (!value) return `<td><span class="kb-link-empty">—</span></td>`;
    return `<td><a href="${escHtml(value)}" target="_blank" class="kb-link">↗ Link</a></td>`;
  }
  if (field.type === 'dropdown') {
    if (field.name === 'Tool') {
      const cls = value.toLowerCase().replace(/\s+/g, '-').replace('3rd-party', 'third-party');
      return `<td><span class="kb-dropdown-badge ${cls}">${escHtml(value)}</span></td>`;
    }
    if (field.name === 'Service') {
      return `<td><span class="kb-service-badge ${value.toLowerCase()}">${escHtml(value)}</span></td>`;
    }
    if (field.name === 'Severity') {
      const sClass = value === 'Severity1' ? 's1' : value === 'Severity2' ? 's2' : 's3';
      return `<td><span class="kb-sev ${sClass}">${escHtml(value)}</span></td>`;
    }
    return `<td>${escHtml(value)}</td>`;
  }
  return `<td>${escHtml(value) || '—'}</td>`;
}

// ── Cards view (generic) ──────────────────────────────────
function renderCardsView(catEntries, fields) {
  if (catEntries.length === 0) {
    return `<div class="kb-empty"><i>◯</i><div>No entries yet.</div></div>`;
  }

  // First field = card title, rest = body rows
  const titleField = fields[0];
  const bodyFields = fields.slice(1).filter(f => f.name !== 'Remark');
  const remarkField = fields.find(f => f.name === 'Remark');

  const cards = catEntries.map(entry => {
    const titleVal = entry.data[titleField.name] || '—';

    const bodyRows = bodyFields.map(f => {
      const v = entry.data[f.name] || '';
      if (!v || v === '—') return '';
      let rendered = '';
      if (f.type === 'url') {
        rendered = `<a href="${escHtml(v)}" target="_blank" class="kb-link">↗ Link</a>`;
      } else if (f.name === 'Tool') {
        const cls = v.toLowerCase().replace(/\s+/g, '-').replace('3rd-party', 'third-party');
        rendered = `<span class="kb-dropdown-badge ${cls}">${escHtml(v)}</span>`;
      } else if (f.name === 'Service') {
        rendered = `<span class="kb-service-badge ${v.toLowerCase()}">${escHtml(v)}</span>`;
      } else {
        rendered = escHtml(v);
      }
      return `<div class="kb-card-row">
        <span class="kb-card-label">${escHtml(f.name)}</span>
        <span class="kb-card-val">${rendered}</span>
      </div>`;
    }).filter(Boolean).join('');

    const remarkHTML = remarkField && entry.data[remarkField.name]
      ? `<div class="cm-remark">${escHtml(entry.data[remarkField.name])}</div>` : '';

    const actionsHTML = canEdit() ? `<div class="kb-card-foot">
      <button class="kb-action-btn edit" onclick="editEntry('${entry.id}')">✎ Edit</button>
      <button class="kb-action-btn delete" onclick="deleteEntry('${entry.id}')">× Delete</button>
    </div>` : '';

    return `<div class="kb-card" data-search="${escHtml(Object.values(entry.data).join(' ')).toLowerCase()}">
      <div class="kb-card-head">${escHtml(titleVal)}</div>
      <div class="kb-card-body">${bodyRows || '<span style="color:var(--text-muted);font-size:11px">No data</span>'}</div>
      ${remarkHTML}
      ${actionsHTML}
    </div>`;
  }).join('');

  return `<div class="kb-cards-grid" id="kb-table-body">${cards}</div>`;
}

// ── Case CM cards ─────────────────────────────────────────
function renderCaseCMCards(catEntries) {
  if (catEntries.length === 0) {
    return `<div class="kb-empty"><i>◯</i><div>No entries yet.</div></div>`;
  }

  function sev(v) {
    const cls = v === 'Severity1' ? 's1' : v === 'Severity2' ? 's2' : 's3';
    return `<span class="kb-sev ${cls}">${escHtml(v)}</span>`;
  }

  function splitCols(labelIn, labelOut, condIn, condOut, timeIn, timeOut) {
    const hasIn = condIn || timeIn;
    const hasOut = condOut || timeOut;
    if (!hasIn && !hasOut) return '';
    return `
      <div class="cm-split">
        <div class="cm-split-col">
          <div class="cm-split-col-head in-h">⏰ ในเวลาทำการ</div>
          ${condIn ? `<div class="cm-cond">${escHtml(condIn)}</div>` : ''}
          ${timeIn ? `<div class="cm-time">⏱ ${escHtml(timeIn)}</div>` : ''}
        </div>
        <div class="cm-split-col">
          <div class="cm-split-col-head out-h">🌙 นอกเวลาทำการ</div>
          ${condOut ? `<div class="cm-cond">${escHtml(condOut)}</div>` : ''}
          ${timeOut ? `<div class="cm-time">⏱ ${escHtml(timeOut)}</div>` : ''}
        </div>
      </div>`;
  }

  function metaChip(icon, label, val) {
    if (!val) return '';
    return `<span class="cm-meta">${icon} <strong>${escHtml(label)}</strong> ${escHtml(val)}</span>`;
  }

  const cards = catEntries.map(entry => {
    const d = entry.data;
    const actionsHTML = canEdit() ? `<div class="cm-actions">
      <button class="kb-action-btn edit" onclick="editEntry('${entry.id}')">✎</button>
      <button class="kb-action-btn delete" onclick="deleteEntry('${entry.id}')">×</button>
    </div>` : '';

    const cmBlock = splitCols(
      'ในเวลาทำการ', 'นอกเวลาทำการ',
      d['CM Condition (In-hours)'], d['CM Condition (After-hours)'],
      d['CM Time In'], d['CM Time Out']
    );
    const ciBlock = splitCols(
      'ในเวลาทำการ', 'นอกเวลาทำการ',
      d['CI Condition (In-hours)'], d['CI Condition (After-hours)'],
      d['CI Time In'], d['CI Time Out']
    );

    const footer = [
      metaChip('📧', 'Mail', d['Send Mail']),
      metaChip('💬', 'Chat', d['Chat Room']),
      metaChip('📞', 'Oncall', d['Oncall']),
      metaChip('🔔', 'Line', d['Line']),
    ].filter(Boolean).join('');

    const remarkHTML = d['Remark']
      ? `<div class="cm-remark">📌 ${escHtml(d['Remark'])}</div>` : '';

    return `
    <div class="cm-card" data-search="${escHtml(Object.values(d).join(' ')).toLowerCase()}">
      <div class="cm-card-head">
        <span class="cm-card-title">${escHtml(d['Case Name'] || '—')}</span>
        <div style="display:flex;gap:6px;align-items:center;flex-shrink:0">
          ${sev(d['Severity'] || 'Severity3')}
          ${actionsHTML}
        </div>
      </div>
      ${cmBlock ? `<div class="cm-section-label">CM — Change Management</div>${cmBlock}` : ''}
      ${ciBlock ? `<div class="cm-section-label">CI — Critical Incident</div>${ciBlock}` : ''}
      ${footer ? `<div class="cm-footer">${footer}</div>` : ''}
      ${remarkHTML}
    </div>`;
  }).join('');

  return `<div class="kb-cards-grid" id="kb-table-body">${cards}</div>`;
}

// ── Case CM Matrix view ───────────────────────────────────
function renderCaseCMMatrix(catEntries) {
  if (!catEntries.length) {
    return `<div class="kb-empty"><i>◯</i><div>No entries yet.</div></div>`;
  }

  // rowKind: 'pair' | 'yn' (Yes/No colored) | 'single' (colspan=2) | 'remark'
  const rowDefs = [
    { sec: 'CM', label: 'Condition',      cls: 'cm', fieldIn: 'CM Condition (In-hours)', fieldOut: 'CM Condition (After-hours)', kind: 'pair' },
    { sec: '',   label: 'Time Threshold', cls: 'cm', fieldIn: 'CM Time In',              fieldOut: 'CM Time Out',                kind: 'pair' },
    { sec: '',   label: 'Yes/No',         cls: 'cm', fieldIn: 'CM Yes/No In',            fieldOut: 'CM Yes/No Out',              kind: 'yn'   },
    { sec: '',   label: 'MA Page',        cls: 'cm', fieldIn: 'CM MA Page In',           fieldOut: 'CM MA Page Out',             kind: 'pair' },
    { sec: 'CI', label: 'Condition',      cls: 'ci', fieldIn: 'CI Condition (In-hours)', fieldOut: 'CI Condition (After-hours)', kind: 'pair' },
    { sec: '',   label: 'Time Threshold', cls: 'ci', fieldIn: 'CI Time In',              fieldOut: 'CI Time Out',                kind: 'pair' },
    { sec: '',   label: 'Yes/No',         cls: 'ci', fieldIn: 'CI Yes/No In',            fieldOut: 'CI Yes/No Out',              kind: 'yn'   },
    { sec: '',   label: 'MA Page',        cls: 'ci', fieldIn: 'CI MA Page In',           fieldOut: 'CI MA Page Out',             kind: 'pair' },
    { sec: '',   label: 'Option Case',    cls: 'other', field: 'Option Case', kind: 'single' },
    { sec: '',   label: 'Send Mail',      cls: 'other', field: 'Send Mail',   kind: 'single' },
    { sec: '',   label: 'Chat Room',      cls: 'other', field: 'Chat Room',   kind: 'single' },
    { sec: '',   label: 'Oncall',         cls: 'other', field: 'Oncall',      kind: 'single' },
    { sec: '',   label: 'Line',           cls: 'other', field: 'Line',        kind: 'single' },
    { sec: '',   label: 'Remark',         cls: 'other', field: 'Remark',      kind: 'remark' },
  ];

  // Build section rowspan map (consecutive same-cls rows with non-empty sec)
  // We'll track where to output the section cell manually
  const secSpans = [];
  let i = 0;
  while (i < rowDefs.length) {
    const r = rowDefs[i];
    if (r.sec) {
      let span = 1;
      while (i + span < rowDefs.length && rowDefs[i + span].cls === r.cls && !rowDefs[i + span].sec) span++;
      secSpans.push({ rowIdx: i, label: r.sec, cls: r.cls, span });
      i += span;
    } else {
      secSpans.push({ rowIdx: i, label: '', cls: r.cls, span: 1 });
      i++;
    }
  }
  const secMap = {};
  secSpans.forEach(s => { secMap[s.rowIdx] = s; });

  // Header rows
  const sevCls = v => v === 'Severity1' ? 's1' : v === 'Severity2' ? 's2' : 's3';
  const caseHeaders = catEntries.map(e => `
    <th colspan="2" class="mat-case-head">
      ${escHtml(e.data['Case Name'] || '—')}
      <br><span class="kb-sev ${sevCls(e.data['Severity'] || 'Severity3')}" style="margin-top:4px;display:inline-flex">${escHtml(e.data['Severity'] || '—')}</span>
    </th>`).join('');

  const subHeaders = catEntries.map(() =>
    `<th class="mat-sub-head in-h">⏰ In-hours</th><th class="mat-sub-head out-h">🌙 After-hours</th>`
  ).join('');

  // Body rows
  const bodyRows = rowDefs.map((row, idx) => {
    const sm = secMap[idx];
    const secCell = sm
      ? `<td class="mat-sticky-1 mat-sec ${row.cls}" rowspan="${sm.span}">${escHtml(sm.label)}</td>`
      : '';

    const lblCls = row.cls !== 'other' ? `mat-label ${row.cls}` : 'mat-label';
    const labelCell = `<td class="mat-sticky-2 ${lblCls}">${escHtml(row.label)}</td>`;

    const disp = v => escHtml(v) || '—';

    let dataCells = '';
    if (row.kind === 'pair') {
      dataCells = catEntries.map(e => {
        const vIn  = e.data[row.fieldIn]  || '';
        const vOut = e.data[row.fieldOut] || '';
        const cls = `mat-cell ${row.cls}`;
        return `<td class="${cls}">${disp(vIn)}</td><td class="${cls}">${disp(vOut)}</td>`;
      }).join('');
    } else if (row.kind === 'yn') {
      dataCells = catEntries.map(e => {
        const vIn  = e.data[row.fieldIn]  || '';
        const vOut = e.data[row.fieldOut] || '';
        const ynCls = v => {
          const lv = v.toLowerCase();
          if (lv === 'yes') return 'yn-yes';
          if (lv === 'no')  return 'yn-no';
          return '';
        };
        const base = `mat-cell ${row.cls}`;
        return `<td class="${base} ${ynCls(vIn)}">${disp(vIn)}</td><td class="${base} ${ynCls(vOut)}">${disp(vOut)}</td>`;
      }).join('');
    } else {
      const extra = row.kind === 'remark' ? ' mat-remark' : ' mat-single';
      dataCells = catEntries.map(e => {
        const v = e.data[row.field] || '';
        return `<td colspan="2" class="mat-cell${extra}">${disp(v)}</td>`;
      }).join('');
    }

    return `<tr>${secCell}${labelCell}${dataCells}</tr>`;
  }).join('');

  return `
    <div class="kb-matrix-wrap">
      <table class="kb-matrix-table">
        <thead>
          <tr>
            <th class="mat-sticky-1" style="background:var(--bg)"></th>
            <th class="mat-sticky-2" style="background:var(--bg)"></th>
            ${caseHeaders}
          </tr>
          <tr>
            <th class="mat-sticky-1 mat-label" style="font-size:9px;color:var(--text-muted)">Section</th>
            <th class="mat-sticky-2 mat-label" style="font-size:9px;color:var(--text-muted)">Detail</th>
            ${subHeaders}
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>`;
}

// ── Filter (works for table + cards; matrix: highlights columns) ─────────────
function filterEntries(query) {
  const mode = getViewMode(currentCategory);
  const lq = query.toLowerCase().trim();

  if (mode === 'matrix') {
    // In matrix view: dim case columns that don't match the search
    const wrap = document.querySelector('.kb-matrix-wrap');
    if (!wrap) return;
    if (!lq) {
      wrap.querySelectorAll('td, th').forEach(el => el.style.opacity = '');
      return;
    }
    const table = wrap.querySelector('table');
    const allRows = table ? table.querySelectorAll('tr') : [];
    // Count left-fixed cols (section + detail = 2)
    const FIXED = 2;
    // Get case count from first header row
    const firstRow = allRows[0];
    if (!firstRow) return;
    const caseCols = firstRow.querySelectorAll('th:not(.mat-sticky-1):not(.mat-sticky-2)');
    const caseCount = caseCols.length; // = catEntries.length

    for (let ci = 0; ci < caseCount; ci++) {
      // Gather all text for this case across all rows
      let text = '';
      allRows.forEach(tr => {
        const cells = tr.querySelectorAll('td:not(.mat-sticky-1):not(.mat-sticky-2), th:not(.mat-sticky-1):not(.mat-sticky-2)');
        // Each case may have 1 or 2 cells depending on colspan
        // We target cells by their visual column position
        // Simpler: grab all non-fixed cells per row and check pairs
        // For pair rows: 2 cells per case; for single rows: 1 colspan=2 cell per case
        if (ci < cells.length) text += ' ' + (cells[ci]?.textContent || '');
      });
      const matches = text.toLowerCase().includes(lq);
      // Highlight matching columns
      caseCols[ci] && (caseCols[ci].style.opacity = matches ? '1' : '0.25');
    }
    return;
  }

  const lqVal = lq;
  const body = document.getElementById('kb-table-body');
  if (!body) return;
  body.querySelectorAll('[data-search]').forEach(el => {
    el.style.display = el.dataset.search.includes(lqVal) ? '' : 'none';
  });
}

// ── Sort ──────────────────────────────────────────────────
let sortDirection = {};
function sortTable(fieldName) {
  const catEntries = entries[currentCategory] || [];
  const dir = sortDirection[fieldName] === 'asc' ? 'desc' : 'asc';
  sortDirection[fieldName] = dir;
  catEntries.sort((a, b) => {
    const aV = (a.data[fieldName] || '').toString().toLowerCase();
    const bV = (b.data[fieldName] || '').toString().toLowerCase();
    return dir === 'asc' ? aV.localeCompare(bV, 'th') : bV.localeCompare(aV, 'th');
  });
  entries[currentCategory] = catEntries;
  renderCategory(currentCategory);
}

// ── Add / Edit entry ──────────────────────────────────────
function openAddEntry() {
  editingEntryId = null;
  const cat = categories[currentCategory];
  document.getElementById('modal-entry-title').textContent = `Add ${cat.name} Entry`;
  renderEntryForm(cat.fields, {});
  openModal('modal-add-entry');
}

function editEntry(entryId) {
  const entry = (entries[currentCategory] || []).find(e => e.id === entryId);
  if (!entry) return;
  editingEntryId = entryId;
  const cat = categories[currentCategory];
  document.getElementById('modal-entry-title').textContent = `Edit ${cat.name} Entry`;
  renderEntryForm(cat.fields, entry.data);
  openModal('modal-add-entry');
}

function renderEntryForm(fields, data) {
  document.getElementById('entry-fields').innerHTML = fields.map(field => {
    const value = data[field.name] || '';
    if (field.type === 'dropdown') {
      return `<div class="form-group">
        <label class="form-label">${escHtml(field.name)}${field.required ? ' *' : ''}</label>
        <select class="form-control" data-field="${escHtml(field.name)}" ${field.required ? 'required' : ''}>
          <option value="">Select...</option>
          ${(field.options || []).map(o => `<option value="${escHtml(o)}" ${o === value ? 'selected' : ''}>${escHtml(o)}</option>`).join('')}
        </select>
      </div>`;
    }
    return `<div class="form-group">
      <label class="form-label">${escHtml(field.name)}${field.required ? ' *' : ''}</label>
      <input type="${field.type === 'url' ? 'url' : 'text'}"
             class="form-control"
             data-field="${escHtml(field.name)}"
             value="${escHtml(value)}"
             placeholder="${field.type === 'url' ? 'https://...' : ''}"
             ${field.required ? 'required' : ''}>
    </div>`;
  }).join('');
}

async function saveEntry() {
  const inputs = document.getElementById('form-entry').querySelectorAll('[data-field]');
  const data = {};
  for (const input of inputs) {
    const v = input.value.trim();
    if (input.required && !v) { showToast('Please fill all required fields', 'error'); return; }
    data[input.dataset.field] = v;
  }
  try {
    const response = await API.knowledgeBase.save({
      category: currentCategory, entry_id: editingEntryId, data
    });
    if (response && response.ok) {
      showToast(editingEntryId ? 'Entry updated' : 'Entry added', 'success');
      await loadData();
      renderCategory(currentCategory);
      closeModal('modal-add-entry');
    } else {
      showToast(response?.data?.message || 'Failed to save entry', 'error');
    }
  } catch { showToast('Failed to save entry', 'error'); }
}

async function deleteEntry(entryId) {
  if (!confirm('Delete this entry?')) return;
  try {
    const response = await API.knowledgeBase.delete({ category: currentCategory, entry_id: entryId });
    if (response && response.ok) {
      showToast('Entry deleted', 'success');
      await loadData();
      renderCategory(currentCategory);
    } else {
      showToast(response?.data?.message || 'Failed to delete entry', 'error');
    }
  } catch { showToast('Failed to delete entry', 'error'); }
}

// ── Field management ──────────────────────────────────────
function openManageFields() {
  const cat = categories[currentCategory];
  document.getElementById('manage-fields-list').innerHTML = cat.fields.map((f, idx) => `
    <div class="field-item" data-index="${idx}">
      <span class="field-item-name">${escHtml(f.name)}</span>
      <span class="field-item-type">${f.type}</span>
      <button class="kb-action-btn delete" onclick="removeField(${idx})">×</button>
    </div>
  `).join('');
  openModal('modal-manage-fields');
}

let isAddingToManageFields = false;
function addFieldToCategory() { isAddingToManageFields = true; openModal('modal-add-field'); }
function addCategoryField()   { isAddingToManageFields = false; openModal('modal-add-field'); }

function toggleFieldOptions() {
  document.getElementById('field-options-group').style.display =
    document.getElementById('field-type').value === 'dropdown' ? 'block' : 'none';
}

function saveField() {
  const fieldName = document.getElementById('field-name').value.trim();
  const fieldType = document.getElementById('field-type').value;
  const fieldRequired = document.getElementById('field-required').checked;
  if (!fieldName) { showToast('Please enter field name', 'error'); return; }
  let options = [];
  if (fieldType === 'dropdown') {
    const optStr = document.getElementById('field-options').value.trim();
    if (!optStr) { showToast('Please enter dropdown options', 'error'); return; }
    options = optStr.split(',').map(o => o.trim()).filter(o => o);
  }
  const newField = { name: fieldName, type: fieldType, options, required: fieldRequired };
  if (isAddingToManageFields) {
    categories[currentCategory].fields.push(newField);
    openManageFields();
  } else {
    tempCategoryFields.push(newField);
    renderCategoryFields();
  }
  closeModal('modal-add-field');
  document.getElementById('field-name').value = '';
  document.getElementById('field-type').value = 'text';
  document.getElementById('field-options').value = '';
  document.getElementById('field-required').checked = false;
  document.getElementById('field-options-group').style.display = 'none';
}

function removeField(idx) {
  if (!confirm('Remove this field? All data in this field will be lost.')) return;
  categories[currentCategory].fields.splice(idx, 1);
  openManageFields();
}

async function saveFieldChanges() {
  try {
    const response = await API.knowledgeBase.updateCategory({
      category_id: currentCategory, fields: categories[currentCategory].fields
    });
    if (response && response.ok) {
      showToast('Fields updated', 'success');
      await loadData(); renderCategory(currentCategory);
      closeModal('modal-manage-fields');
    } else {
      showToast(response?.data?.message || 'Failed to update fields', 'error');
    }
  } catch { showToast('Failed to update fields', 'error'); }
}

// ── Add category ──────────────────────────────────────────
let tempCategoryFields = [];

function renderCategoryFields() {
  document.getElementById('category-fields').innerHTML = tempCategoryFields.map((f, idx) => `
    <div class="field-item">
      <span class="field-item-name">${escHtml(f.name)}</span>
      <span class="field-item-type">${f.type}</span>
      <button class="kb-action-btn delete" onclick="removeCategoryField(${idx})">×</button>
    </div>
  `).join('');
}

function removeCategoryField(idx) {
  tempCategoryFields.splice(idx, 1);
  renderCategoryFields();
}

async function saveCategory() {
  const name = document.getElementById('new-category-name').value.trim();
  if (!name) { showToast('Please enter category name', 'error'); return; }
  if (tempCategoryFields.length === 0) { showToast('Please add at least one field', 'error'); return; }
  const catId = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  try {
    const response = await API.knowledgeBase.addCategory({
      category_id: catId, name, fields: tempCategoryFields
    });
    if (response && response.ok) {
      showToast('Category added', 'success');
      tempCategoryFields = [];
      await loadData();
      currentCategory = catId;
      renderTabs(); renderCategory(catId);
      closeModal('modal-add-category');
    } else {
      showToast(response?.data?.message || 'Failed to add category', 'error');
    }
  } catch { showToast('Failed to add category', 'error'); }
}

// ── Helpers ───────────────────────────────────────────────
function canEdit() {
  return currentUser && ['sm_admin', 'sm_lead', 'dev_sm'].includes(currentUser.role);
}

function openModal(id) { document.getElementById(id).classList.add('active'); }

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
  if (id === 'modal-add-category') {
    tempCategoryFields = [];
    document.getElementById('new-category-name').value = '';
    document.getElementById('category-fields').innerHTML = '';
  }
}

function showToast(message, type = 'info') {
  if (typeof Toast !== 'undefined' && Toast.show) {
    Toast.show(message, type);
  } else {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span class="toast-dot"></span><span class="toast-msg">${escHtml(message)}</span>`;
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.animation = 'toastOut .25s ease both';
      setTimeout(() => toast.remove(), 250);
    }, 3000);
  }
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initKnowledgeBase, { once: true });
} else {
  _initKnowledgeBase();
}
