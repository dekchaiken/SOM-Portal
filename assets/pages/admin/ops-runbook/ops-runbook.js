// admin/ops-runbook — page script, extracted from admin/ops-runbook.html.
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
  Layout.render('admin-ops-runbook');

  let sections    = [];
  let activeSecId = null;
  let editingSecId  = null;
  let editingColKey = null;
  let deletingSecId = null;
  let deletingColKey = null;

  // ─── Load ────────────────────────────────────────────────────────────────────
  async function load() {
    const res = await API.opsRunbook.list();
    if (!res?.ok) {
      document.getElementById('sec-list-wrap').innerHTML = '<div class="empty-box">โหลดไม่สำเร็จ</div>';
      return;
    }
    sections = res.data.data || [];
    renderSecList();
    if (activeSecId) renderColPanel(activeSecId);
  }

  // ─── Section list ────────────────────────────────────────────────────────────
  function renderSecList() {
    document.getElementById('sec-count').textContent = sections.length;
    const wrap = document.getElementById('sec-list-wrap');
    if (!sections.length) {
      wrap.innerHTML = '<div class="empty-box">ยังไม่มี Section<br>กด "+ เพิ่ม Section"</div>';
      return;
    }
    wrap.innerHTML = `<div class="sec-list" id="sec-drag-list">
      ${sections.map(s => `
        <div class="sec-item ${s.id === activeSecId ? 'active' : ''}"
             data-select-sec="${escHtml(s.id)}" draggable="true" data-id="${escHtml(s.id)}">
          <span class="sec-drag-handle" title="ลากเรียงลำดับ">⠿</span>
          <span class="sec-item-icon">${renderIcon(s.icon, '<i data-icon="clipboard"></i>')}</span>
          <span class="sec-item-name">${escHtml(s.name)}</span>
          <span class="sec-item-count">${(s.rows || []).length}r · ${(s.columns || []).length}c</span>
        </div>
      `).join('')}
    </div>`;
    initSectionDrag();
  }

  function selectSection(id) {
    activeSecId = id;
    renderSecList();
    renderColPanel(id);
    document.getElementById('add-col-btn').disabled = false;
    document.getElementById('sec-action-bar').style.display = '';
  }

  // ─── Column panel ────────────────────────────────────────────────────────────
  function renderColPanel(secId) {
    const sec = sections.find(s => s.id === secId);
    if (!sec) return;
    document.getElementById('col-panel-title').textContent = `${sec.icon || '📋'} ${sec.name}`;

    const cols = sec.columns || [];
    const wrap = document.getElementById('col-table-wrap');

    if (!cols.length) {
      wrap.innerHTML = '<div class="empty-box">ยังไม่มี Column — กด "+ เพิ่ม Column"</div>';
      return;
    }

    const rows = cols.map(col => {
      const typePill = col.type === 'dropdown'
        ? '<span class="type-pill type-dropdown">dropdown</span>'
        : col.type === 'url'
          ? '<span class="type-pill type-url">url</span>'
          : '<span class="type-pill type-text">text</span>';

      const opts = col.type === 'dropdown' && col.options?.length
        ? `<div class="options-list">${col.options.map(o => `<span class="opt-chip">${escHtml(o)}</span>`).join('')}</div>`
        : `<span style="color:var(--text-muted);font-size:11px">—</span>`;

      return `<tr>
        <td><strong>${escHtml(col.label)}</strong><br><span style="font-size:10px;color:var(--text-muted)">${escHtml(col.key)}</span></td>
        <td>${typePill}</td>
        <td>${opts}</td>
        <td>
          <div style="display:flex;gap:5px">
            <button class="btn btn-ghost" style="padding:4px 9px;font-size:11px"
              data-col-action="edit" data-col-sec="${escHtml(secId)}" data-col-key="${escHtml(col.key)}">Edit</button>
            <button class="btn danger-btn" style="padding:4px 9px;font-size:11px"
              data-col-action="delete" data-col-sec="${escHtml(secId)}" data-col-key="${escHtml(col.key)}" data-col-label="${escHtml(col.label)}">Del</button>
          </div>
        </td>
      </tr>`;
    }).join('');

    wrap.innerHTML = `<table class="col-table">
      <thead><tr>
        <th>Column</th><th style="width:100px">Type</th><th>Options</th><th style="width:110px">Actions</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  // ─── Section CRUD ─────────────────────────────────────────────────────────────
  function openCreateSection() {
    editingSecId = null;
    document.getElementById('f-sec-name').value = '';
    document.getElementById('f-sec-icon').value = '';
    document.getElementById('sec-modal-title').textContent = 'เพิ่ม Section';
    document.getElementById('sec-save-btn').textContent = 'เพิ่ม Section';
    openModal('modal-section');
    setTimeout(() => document.getElementById('f-sec-name').focus(), 80);
  }

  function openEditSection() {
    const sec = sections.find(s => s.id === activeSecId);
    if (!sec) return;
    editingSecId = activeSecId;
    document.getElementById('f-sec-name').value = sec.name;
    document.getElementById('f-sec-icon').value = sec.icon || '';
    document.getElementById('sec-modal-title').textContent = 'แก้ไข Section';
    document.getElementById('sec-save-btn').textContent = 'บันทึก';
    openModal('modal-section');
  }

  async function saveSection() {
    const name = document.getElementById('f-sec-name').value.trim();
    const icon = document.getElementById('f-sec-icon').value.trim() || '<i data-icon="clipboard"></i>';
    if (!name) { Toast.error('กรุณากรอกชื่อ Section'); return; }

    const btn = document.getElementById('sec-save-btn');
    btn.disabled = true; btn.textContent = 'Saving...';

    let res;
    if (editingSecId) {
      res = await API.opsRunbook.updateSection(editingSecId, { name, icon });
    } else {
      res = await API.opsRunbook.createSection({ name, icon });
    }

    btn.disabled = false;
    btn.textContent = editingSecId ? 'บันทึก' : 'เพิ่ม Section';

    if (!res?.ok) { Toast.error(res?.data?.message || 'เกิดข้อผิดพลาด'); return; }
    Toast.success(editingSecId ? 'แก้ไขเรียบร้อย' : 'เพิ่ม Section เรียบร้อย');
    if (!editingSecId) activeSecId = res.data.data?.id ?? null;
    closeModal('modal-section');
    await load();
  }

  function openDeleteSection() {
    const sec = sections.find(s => s.id === activeSecId);
    if (!sec) return;
    deletingSecId = activeSecId;
    document.getElementById('del-sec-name').textContent = sec.name;
    openModal('modal-del-section');
  }

  async function confirmDeleteSection() {
    if (!deletingSecId) return;
    const res = await API.opsRunbook.deleteSection(deletingSecId);
    if (!res?.ok) { Toast.error(res?.data?.message || 'ลบไม่สำเร็จ'); return; }
    Toast.success('ลบ Section เรียบร้อย');
    closeModal('modal-del-section');
    activeSecId = null;
    deletingSecId = null;
    document.getElementById('add-col-btn').disabled = true;
    document.getElementById('sec-action-bar').style.display = 'none';
    document.getElementById('col-panel-title').textContent = '— เลือก Section —';
    document.getElementById('col-table-wrap').innerHTML = '<div class="empty-box">เลือก Section ด้านซ้ายเพื่อจัดการ Columns</div>';
    await load();
  }

  // ─── Column CRUD ──────────────────────────────────────────────────────────────
  function onColTypeChange() {
    const t = document.getElementById('f-col-type').value;
    document.getElementById('col-options-wrap').style.display = t === 'dropdown' ? '' : 'none';
  }

  function addOptRow(val = '') {
    const editor = document.getElementById('opt-editor');
    const div = document.createElement('div');
    div.className = 'opt-row';
    div.innerHTML = `<input class="form-input opt-input" type="text" value="${escHtml(val)}" placeholder="Option value">
      <button class="opt-del" title="ลบ"><i data-icon="x"></i></button>`;
    editor.appendChild(div);
  }

  function getOptValues() {
    return [...document.querySelectorAll('#opt-editor .opt-input')]
      .map(i => i.value.trim()).filter(Boolean);
  }

  function openAddColumn() {
    if (!activeSecId) return;
    editingColKey = null;
    document.getElementById('f-col-label').value = '';
    document.getElementById('f-col-type').value  = 'text';
    document.getElementById('opt-editor').innerHTML = '';
    document.getElementById('col-options-wrap').style.display = 'none';
    document.getElementById('col-modal-title').textContent = 'เพิ่ม Column';
    document.getElementById('col-save-btn').textContent = 'เพิ่ม Column';
    openModal('modal-column');
    setTimeout(() => document.getElementById('f-col-label').focus(), 80);
  }

  function openEditColumn(secId, colKey) {
    const sec = sections.find(s => s.id === secId);
    const col = sec?.columns.find(c => c.key === colKey);
    if (!col) return;
    editingColKey = colKey;
    activeSecId = secId;
    document.getElementById('f-col-label').value = col.label;
    document.getElementById('f-col-type').value  = col.type;
    const editor = document.getElementById('opt-editor');
    editor.innerHTML = '';
    (col.options || []).forEach(o => addOptRow(o));
    document.getElementById('col-options-wrap').style.display = col.type === 'dropdown' ? '' : 'none';
    document.getElementById('col-modal-title').textContent = 'แก้ไข Column';
    document.getElementById('col-save-btn').textContent = 'บันทึก';
    openModal('modal-column');
  }

  async function saveColumn() {
    const label   = document.getElementById('f-col-label').value.trim();
    const type    = document.getElementById('f-col-type').value;
    const options = getOptValues();
    if (!label) { Toast.error('กรุณากรอกชื่อ Column'); return; }

    const btn = document.getElementById('col-save-btn');
    btn.disabled = true; btn.textContent = 'Saving...';

    let res;
    if (editingColKey) {
      res = await API.opsRunbook.updateColumn(activeSecId, editingColKey, { label, type, options });
    } else {
      res = await API.opsRunbook.createColumn(activeSecId, { label, type, options });
    }

    btn.disabled = false;
    btn.textContent = editingColKey ? 'บันทึก' : 'เพิ่ม Column';

    if (!res?.ok) { Toast.error(res?.data?.message || 'เกิดข้อผิดพลาด'); return; }
    Toast.success(editingColKey ? 'แก้ไขเรียบร้อย' : 'เพิ่ม Column เรียบร้อย');
    closeModal('modal-column');
    await load();
  }

  function openDeleteColumn(secId, colKey, colLabel) {
    deletingColKey = { secId, colKey };
    document.getElementById('del-col-label').textContent = colLabel;
    openModal('modal-del-col');
  }

  async function confirmDeleteColumn() {
    if (!deletingColKey) return;
    const res = await API.opsRunbook.deleteColumn(deletingColKey.secId, deletingColKey.colKey);
    if (!res?.ok) { Toast.error(res?.data?.message || 'ลบไม่สำเร็จ'); return; }
    Toast.success('ลบ Column เรียบร้อย');
    closeModal('modal-del-col');
    deletingColKey = null;
    await load();
  }

  // ─── Drag-sort sections ───────────────────────────────────────────────────────
  function initSectionDrag() {
    const list = document.getElementById('sec-drag-list');
    if (!list) return;
    let dragging = null;
    list.querySelectorAll('.sec-item[draggable]').forEach(item => {
      item.addEventListener('dragstart', () => { dragging = item; setTimeout(() => item.classList.add('dragging'), 0); });
      item.addEventListener('dragend', async () => {
        item.classList.remove('dragging');
        const items = [...list.querySelectorAll('.sec-item[data-id]')];
        const updates = items.map((el, i) => API.opsRunbook.updateSection(el.dataset.id, { order: i + 1 }));
        await Promise.all(updates);
        await load();
        dragging = null;
      });
      item.addEventListener('dragover', e => {
        e.preventDefault();
        if (dragging && dragging !== item) {
          list.querySelectorAll('.sec-item').forEach(i => i.classList.remove('drag-over'));
          item.classList.add('drag-over');
        }
      });
      item.addEventListener('drop', e => {
        e.preventDefault(); item.classList.remove('drag-over');
        if (dragging && dragging !== item) {
          const items = [...list.querySelectorAll('.sec-item')];
          items.indexOf(dragging) < items.indexOf(item) ? item.after(dragging) : item.before(dragging);
        }
      });
    });
  }

  // ─── Modal helpers ────────────────────────────────────────────────────────────
  function openModal(id)  { document.getElementById(id).classList.add('open'); }
  function closeModal(id) { document.getElementById(id).classList.remove('open'); }
  document.querySelectorAll('.modal-overlay').forEach(el => {
    el.addEventListener('click', e => { if (e.target === el) closeModal(el.id); });
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') ['modal-section','modal-column','modal-del-section','modal-del-col'].forEach(closeModal);
  });

  // ─── Event Listeners ──────────────────────────────────────────────────────────
  document.addEventListener('click', e => {
    // Section list item click
    const secItem = e.target.closest('[data-select-sec]');
    if (secItem) {
      selectSection(secItem.dataset.selectSec);
      return;
    }

    // Column action buttons
    const colBtn = e.target.closest('[data-col-action]');
    if (colBtn) {
      e.preventDefault();
      if (colBtn.dataset.colAction === 'edit') {
        openEditColumn(colBtn.dataset.colSec, colBtn.dataset.colKey);
      } else if (colBtn.dataset.colAction === 'delete') {
        openDeleteColumn(colBtn.dataset.colSec, colBtn.dataset.colKey, colBtn.dataset.colLabel);
      }
      return;
    }

    // Option delete button
    const optDel = e.target.closest('.opt-del');
    if (optDel) {
      e.preventDefault();
      optDel.closest('.opt-row')?.remove();
      return;
    }
  });

  // Top buttons
  document.getElementById('btn-create-section')?.addEventListener('click', openCreateSection);
  document.getElementById('add-col-btn')?.addEventListener('click', openAddColumn);
  document.getElementById('btn-edit-section')?.addEventListener('click', openEditSection);
  document.getElementById('btn-delete-section')?.addEventListener('click', openDeleteSection);

  // Section modal
  document.getElementById('btn-close-sec-modal')?.addEventListener('click', () => closeModal('modal-section'));
  document.getElementById('btn-cancel-sec')?.addEventListener('click', () => closeModal('modal-section'));
  document.getElementById('sec-save-btn')?.addEventListener('click', saveSection);

  // Column modal
  document.getElementById('btn-close-col-modal')?.addEventListener('click', () => closeModal('modal-column'));
  document.getElementById('btn-cancel-col')?.addEventListener('click', () => closeModal('modal-column'));
  document.getElementById('col-save-btn')?.addEventListener('click', saveColumn);
  document.getElementById('f-col-type')?.addEventListener('change', onColTypeChange);
  document.getElementById('btn-add-opt')?.addEventListener('click', () => addOptRow());

  // Delete section modal
  document.getElementById('btn-close-del-sec-modal')?.addEventListener('click', () => closeModal('modal-del-section'));
  document.getElementById('btn-cancel-del-sec')?.addEventListener('click', () => closeModal('modal-del-section'));
  document.getElementById('btn-confirm-del-sec')?.addEventListener('click', confirmDeleteSection);

  // Delete column modal
  document.getElementById('btn-close-del-col-modal')?.addEventListener('click', () => closeModal('modal-del-col'));
  document.getElementById('btn-cancel-del-col')?.addEventListener('click', () => closeModal('modal-del-col'));
  document.getElementById('btn-confirm-del-col')?.addEventListener('click', confirmDeleteColumn);

  load();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "addOptRow", { configurable: true, get: () => addOptRow, set: (v) => { addOptRow = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeModal", { configurable: true, get: () => closeModal, set: (v) => { closeModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "confirmDeleteColumn", { configurable: true, get: () => confirmDeleteColumn, set: (v) => { confirmDeleteColumn = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "confirmDeleteSection", { configurable: true, get: () => confirmDeleteSection, set: (v) => { confirmDeleteSection = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "getOptValues", { configurable: true, get: () => getOptValues, set: (v) => { getOptValues = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "initSectionDrag", { configurable: true, get: () => initSectionDrag, set: (v) => { initSectionDrag = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "load", { configurable: true, get: () => load, set: (v) => { load = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "onColTypeChange", { configurable: true, get: () => onColTypeChange, set: (v) => { onColTypeChange = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openAddColumn", { configurable: true, get: () => openAddColumn, set: (v) => { openAddColumn = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openCreateSection", { configurable: true, get: () => openCreateSection, set: (v) => { openCreateSection = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openDeleteColumn", { configurable: true, get: () => openDeleteColumn, set: (v) => { openDeleteColumn = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openDeleteSection", { configurable: true, get: () => openDeleteSection, set: (v) => { openDeleteSection = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openEditColumn", { configurable: true, get: () => openEditColumn, set: (v) => { openEditColumn = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openEditSection", { configurable: true, get: () => openEditSection, set: (v) => { openEditSection = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openModal", { configurable: true, get: () => openModal, set: (v) => { openModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderColPanel", { configurable: true, get: () => renderColPanel, set: (v) => { renderColPanel = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderSecList", { configurable: true, get: () => renderSecList, set: (v) => { renderSecList = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "saveColumn", { configurable: true, get: () => saveColumn, set: (v) => { saveColumn = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "saveSection", { configurable: true, get: () => saveSection, set: (v) => { saveSection = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "selectSection", { configurable: true, get: () => selectSection, set: (v) => { selectSection = v; } }); } catch (e) {}
})();
