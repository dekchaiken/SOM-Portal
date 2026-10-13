// ops-runbook — page script, extracted from ops-runbook.html.
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

(function () {
  'use strict';

  Auth.requireAuth();
  Layout.render('ops-runbook');
  trackOpsRunbookView('main');

  // ── State ────────────────────────────────────────────────
  var sections   = [];
  var activeIdx  = 0;
  var editingRow = null;   // { sectionId, rowId } | null
  var deletingRow = null;

  var _user   = Auth.getUser();
  var canEdit = !!_user && ['super_admin', 'sm_lead', 'sm_admin', 'dev_sm'].includes(_user.role);

  // ── Bootstrap ────────────────────────────────────────────
  function init() {
    var actions = document.getElementById('topbar-actions');
    if (!canEdit) {
      actions.innerHTML = '<span class="view-only-badge"><i data-icon="eye"></i> View Only</span>';
    }

    API.opsRunbook.list().then(function (res) {
      if (!res || !res.ok) {
        document.getElementById('rb-tabs-wrap').innerHTML = '';
        document.getElementById('rb-panels').innerHTML =
          '<div class="card"><div class="card-body" style="padding:48px;text-align:center;color:var(--text-muted)">โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่</div></div>';
        return;
      }

      sections = res.data.data || [];

      if (canEdit) {
        var addBtn = document.createElement('button');
        addBtn.className = 'btn btn-primary';
        addBtn.id = 'topbar-add-btn';
        addBtn.textContent = '+ เพิ่มข้อมูล';
        actions.innerHTML = '';
        actions.appendChild(addBtn);
      }

      renderAll();
    });
  }

  // ── Render ───────────────────────────────────────────────
  function renderAll() {
    renderTabs();
    renderPanels();
    showPanel(activeIdx);
  }

  function renderTabs() {
    var wrap = document.getElementById('rb-tabs-wrap');
    if (!sections.length) {
      wrap.innerHTML = '<span style="color:var(--text-muted);font-size:12px">ยังไม่มี Section</span>';
      return;
    }
    var html = sections.map(function (s, i) {
      return '<div class="rb-tab' + (i === activeIdx ? ' active' : '') + '" data-tab-idx="' + i + '">' +
        '<span>' + renderIcon(s.icon, '<i data-icon="clipboard"></i>') + '</span>' +
        '<span>' + escHtml(s.name) + '</span>' +
        '<span class="rb-tab-count">' + (s.rows || []).length + '</span>' +
        '</div>';
    }).join('');
    wrap.innerHTML = html;
  }

  function renderPanels() {
    var wrap = document.getElementById('rb-panels');
    var html = sections.map(function (s, i) {
      return '<div class="rb-panel' + (i === activeIdx ? ' active' : '') + '" id="panel-' + i + '">' +
        renderSectionTable(s) + '</div>';
    }).join('');
    wrap.innerHTML = html;
  }

  function showPanel(idx) {
    if (idx < 0 || idx >= sections.length) return;
    activeIdx = idx;
    document.querySelectorAll('.rb-tab').forEach(function (t, i) {
      t.classList.toggle('active', i === idx);
    });
    document.querySelectorAll('.rb-panel').forEach(function (p, i) {
      p.classList.toggle('active', i === idx);
    });
  }

  function renderSectionTable(sec) {
    var cols = sec.columns || [];
    var rows = sec.rows    || [];

    if (!rows.length) {
      var addBtnHtml = canEdit
        ? '<div style="margin-top:12px"><button class="btn btn-primary" data-add-row="1">+ เพิ่มข้อมูลแรก</button></div>'
        : '';
      return '<div class="card" style="margin-bottom:0"><div class="rb-empty-section">' +
        '<div class="rb-empty-icon">' + renderIcon(sec.icon, '<i data-icon="clipboard"></i>') + '</div>' +
        '<div>ยังไม่มีข้อมูลใน <strong>' + escHtml(sec.name) + '</strong></div>' +
        addBtnHtml + '</div></div>';
    }

    var thead = '<tr><th class="rb-row-num">#</th>' +
      cols.map(function (c) { return '<th>' + escHtml(c.label) + '</th>'; }).join('') +
      (canEdit ? '<th style="width:100px">Actions</th>' : '') + '</tr>';

    var tbody = rows.map(function (row, ri) {
      var cells = cols.map(function (col) {
        var val = (row.data || {})[col.key] !== undefined ? String((row.data || {})[col.key]) : '';
        if (col.type === 'url') {
          return val
            ? '<td><a href="' + escHtml(val) + '" target="_blank" rel="noopener" class="rb-url-link">↗ เปิด</a></td>'
            : '<td><span class="rb-url-empty">—</span></td>';
        }
        if (col.type === 'dropdown') {
          return val
            ? '<td><span class="rb-badge">' + escHtml(val) + '</span></td>'
            : '<td><span class="rb-url-empty">—</span></td>';
        }
        return val
          ? '<td><div class="rb-text-cell" title="' + escHtml(val) + '">' + escHtml(val) + '</div></td>'
          : '<td><span class="rb-url-empty">—</span></td>';
      }).join('');

      var actionCell = canEdit
        ? '<td><div style="display:flex;gap:5px">' +
            '<button class="btn btn-ghost" style="padding:4px 9px;font-size:11px"' +
              ' data-action="edit" data-sec="' + escHtml(sec.id) + '" data-row="' + escHtml(row.id) + '">Edit</button>' +
            '<button class="btn" style="padding:4px 9px;font-size:11px;background:#fee2e2;color:#dc2626;border:none"' +
              ' data-action="delete" data-sec="' + escHtml(sec.id) + '" data-row="' + escHtml(row.id) + '">Del</button>' +
          '</div></td>'
        : '';

      return '<tr><td class="rb-row-num">' + (ri + 1) + '</td>' + cells + actionCell + '</tr>';
    }).join('');

    return '<div class="card" style="margin-bottom:0">' +
      '<div class="card-body" style="padding:0">' +
      '<div class="rb-wrap"><table class="rb-table">' +
      '<thead>' + thead + '</thead><tbody>' + tbody + '</tbody>' +
      '</table></div></div></div>';
  }

  // ── Form builder ─────────────────────────────────────────
  function buildRowForm(sec, rowData) {
    rowData = rowData || {};
    return (sec.columns || []).map(function (col) {
      var val = (rowData[col.key] !== undefined && rowData[col.key] !== null)
                 ? String(rowData[col.key]) : '';
      var input = '';

      if (col.type === 'dropdown') {
        var opts = (col.options || []).map(function (o) {
          return '<option value="' + escHtml(o) + '"' + (val === o ? ' selected' : '') + '>' + escHtml(o) + '</option>';
        }).join('');
        input = '<select class="form-select" id="rbf-' + escHtml(col.key) + '">' +
          '<option value="">— เลือก —</option>' + opts + '</select>';
      } else if (col.type === 'url') {
        input = '<input class="form-input" id="rbf-' + escHtml(col.key) + '" type="url"' +
          ' value="' + escHtml(val) + '" placeholder="https://...">' +
          '<div class="form-hint">URL — ใส่หรือเว้นว่างก็ได้</div>';
      } else {
        input = '<input class="form-input" id="rbf-' + escHtml(col.key) + '" type="text"' +
          ' value="' + escHtml(val) + '" placeholder="' + escHtml(col.label) + '">';
      }

      return '<div class="form-row"><label class="form-label">' + escHtml(col.label) + '</label>' + input + '</div>';
    }).join('');
  }

  function collectRowData(sec) {
    var rowData = {};
    (sec.columns || []).forEach(function (col) {
      var el = document.getElementById('rbf-' + col.key);
      rowData[col.key] = el ? el.value.trim() : '';
    });
    return rowData;
  }

  // ── Open modal: add ───────────────────────────────────────
  function openAddRow() {
    if (!canEdit) { Toast.error('คุณไม่มีสิทธิ์เพิ่มข้อมูล'); return; }
    var sec = sections[activeIdx];
    if (!sec) { Toast.error('กรุณารอข้อมูลโหลดเสร็จก่อน'); return; }
    editingRow = null;
    document.getElementById('row-modal-title').textContent = 'เพิ่มข้อมูล — ' + sec.name;
    document.getElementById('row-modal-body').innerHTML = buildRowForm(sec);
    document.getElementById('btn-save-row').textContent  = 'เพิ่มข้อมูล';
    document.getElementById('btn-save-row').disabled     = false;
    openModal('modal-row');
    var first = document.querySelector('#row-modal-body input, #row-modal-body select');
    if (first) setTimeout(function () { first.focus(); }, 60);
  }

  // ── Open modal: edit ──────────────────────────────────────
  function openEditRow(sectionId, rowId) {
    if (!canEdit) { Toast.error('คุณไม่มีสิทธิ์แก้ไข'); return; }
    var sec = null, row = null;
    for (var i = 0; i < sections.length; i++) {
      if (sections[i].id === sectionId) { sec = sections[i]; break; }
    }
    if (!sec) return;
    var rows = sec.rows || [];
    for (var j = 0; j < rows.length; j++) {
      if (rows[j].id === rowId) { row = rows[j]; break; }
    }
    if (!row) return;

    editingRow = { sectionId: sectionId, rowId: rowId };
    document.getElementById('row-modal-title').textContent = 'แก้ไข — ' + sec.name;
    document.getElementById('row-modal-body').innerHTML = buildRowForm(sec, row.data || {});
    document.getElementById('btn-save-row').textContent  = 'บันทึก';
    document.getElementById('btn-save-row').disabled     = false;
    openModal('modal-row');
  }

  // ── Save row ──────────────────────────────────────────────
  function saveRow() {
    if (!canEdit) { Toast.error('คุณไม่มีสิทธิ์'); return; }
    var sec = editingRow
      ? (function () {
          for (var i = 0; i < sections.length; i++) {
            if (sections[i].id === editingRow.sectionId) return sections[i];
          }
          return null;
        })()
      : sections[activeIdx];

    if (!sec) { Toast.error('ไม่พบ Section'); return; }

    var rowData = collectRowData(sec);
    var btn = document.getElementById('btn-save-row');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    var promise = editingRow
      ? API.opsRunbook.updateRow(editingRow.sectionId, editingRow.rowId, rowData)
      : API.opsRunbook.createRow(sec.id, rowData);

    promise.then(function (res) {
      btn.disabled = false;
      btn.textContent = editingRow ? 'บันทึก' : 'เพิ่มข้อมูล';

      if (!res || !res.ok) {
        Toast.error((res && res.data && res.data.message) || 'เกิดข้อผิดพลาด');
        return;
      }
      Toast.success(editingRow ? 'แก้ไขเรียบร้อย' : 'เพิ่มข้อมูลเรียบร้อย');
      closeModal('modal-row');
      editingRow = null;
      reload();
    });
  }

  // ── Delete row ────────────────────────────────────────────
  function openDeleteRow(sectionId, rowId) {
    if (!canEdit) { Toast.error('คุณไม่มีสิทธิ์ลบ'); return; }
    deletingRow = { sectionId: sectionId, rowId: rowId };
    openModal('modal-delete');
  }

  function confirmDeleteRow() {
    if (!deletingRow) return;
    var dr = deletingRow;
    API.opsRunbook.deleteRow(dr.sectionId, dr.rowId).then(function (res) {
      if (!res || !res.ok) { Toast.error((res && res.data && res.data.message) || 'ลบไม่สำเร็จ'); return; }
      Toast.success('ลบเรียบร้อย');
      closeModal('modal-delete');
      deletingRow = null;
      reload();
    });
  }

  // ── Reload ────────────────────────────────────────────────
  function reload() {
    API.opsRunbook.list().then(function (res) {
      if (!res || !res.ok) { Toast.error('โหลดข้อมูลใหม่ไม่สำเร็จ'); return; }
      sections = res.data.data || [];
      renderAll();
    });
  }

  // ── Modal helpers ─────────────────────────────────────────
  function openModal(id)  { document.getElementById(id)?.classList.add('open'); }
  function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }

  // ── Event delegation: tabs + table buttons ────────────────
  document.addEventListener('click', function (e) {
    // Tab clicks
    var tab = e.target.closest('[data-tab-idx]');
    if (tab) {
      showPanel(parseInt(tab.dataset.tabIdx, 10));
      return;
    }

    // Table action buttons
    var btn = e.target.closest('[data-action]');
    if (btn) {
      e.preventDefault();
      if (btn.dataset.action === 'edit')   openEditRow(btn.dataset.sec, btn.dataset.row);
      if (btn.dataset.action === 'delete') openDeleteRow(btn.dataset.sec, btn.dataset.row);
      return;
    }

    // Empty state "เพิ่มข้อมูลแรก"
    var addBtn = e.target.closest('[data-add-row]');
    if (addBtn) {
      e.preventDefault();
      openAddRow();
      return;
    }

    // Topbar "+ เพิ่มข้อมูล" button
    var topbarAddBtn = e.target.closest('#topbar-add-btn');
    if (topbarAddBtn) {
      e.preventDefault();
      openAddRow();
    }
  });

  // ── Modal button wiring ───────────────────────────────────
  document.getElementById('btn-save-row')       .addEventListener('click', saveRow);
  document.getElementById('btn-cancel-row')     .addEventListener('click', function () { closeModal('modal-row'); });
  document.getElementById('btn-close-row-modal').addEventListener('click', function () { closeModal('modal-row'); });
  document.getElementById('btn-confirm-del')    .addEventListener('click', confirmDeleteRow);
  document.getElementById('btn-cancel-del')     .addEventListener('click', function () { closeModal('modal-delete'); });
  document.getElementById('btn-close-del-modal').addEventListener('click', function () { closeModal('modal-delete'); });

  // ── Click outside modal to close ─────────────────────────
  document.querySelectorAll('.modal-overlay').forEach(function (el) {
    el.addEventListener('click', function (e) {
      if (e.target === el) closeModal(el.id);
    });
  });

  // ── Keyboard ──────────────────────────────────────────────
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeModal('modal-row'); closeModal('modal-delete'); }
  });

  init();
})();

})();
