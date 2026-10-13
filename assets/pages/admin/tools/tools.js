// admin/tools — page script, extracted from admin/tools.html.
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
  Layout.render('admin-tools');

  let currentTools = [];
  let editingId    = null;
  let deletingId   = null;

  // ─── Load ───────────────────────────────────────────────
  async function loadTools() {
    const container = document.getElementById('table-container');
    container.innerHTML = Skeleton.table(5);

    const res = await API.sidebarTools.list();
    if (!res?.ok) { container.innerHTML = '<div class="empty-table">โหลดข้อมูลไม่สำเร็จ</div>'; return; }

    currentTools = res.data.data || [];
    document.getElementById('tool-count').textContent = `${currentTools.length} tools`;

    if (!currentTools.length) {
      container.innerHTML = '<div class="empty-table">ยังไม่มี Tool — กด "+ Add Tool"</div>'; return;
    }

    container.innerHTML = `
      <table class="tools-table">
        <thead>
          <tr>
            <th style="width:32px"></th>
            <th style="width:44px">Icon</th>
            <th>ชื่อ</th>
            <th style="width:80px">Type</th>
            <th>Path / URL</th>
            <th style="width:80px">Status</th>
            <th style="width:110px">Actions</th>
          </tr>
        </thead>
        <tbody id="tools-tbody">
          ${currentTools.map(t => renderRow(t)).join('')}
        </tbody>
      </table>`;

    initDragSort();

    container.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      if (btn.dataset.action === 'edit')   openEditModal(btn.dataset.id);
      if (btn.dataset.action === 'delete') openDeleteModal(btn.dataset.id, btn.dataset.name);
      if (btn.dataset.action === 'toggle') quickToggle(btn.dataset.id);
    });
  }

  function renderRow(t) {
    const isExt      = t.link_type === 'external';
    const isEmbedded = t.link_type === 'embedded';
    const typeHtml   = isExt      ? '<span class="type-badge type-external">↗ External</span>'
                     : isEmbedded ? '<span class="type-badge" style="background:rgba(8,145,178,.1);color:#0891b2;border:1px solid rgba(8,145,178,.2)">⧉ Embedded</span>'
                     :              '<span class="type-badge type-internal">⬡ Internal</span>';
    const target     = (isExt || isEmbedded) ? (t.url || '—') : (t.path || '—');

    return `<tr data-id="${escHtml(t.id)}" draggable="true">
      <td><span class="drag-handle" title="ลากเรียงลำดับ">⠿</span></td>
      <td style="font-size:18px;text-align:center">${renderIcon(t.icon, '<i data-icon="plus-circle"></i>')}</td>
      <td>
        <div style="font-weight:600">${escHtml(t.name)}</div>
        ${t.description ? `<div style="font-size:10px;color:var(--text-muted);margin-top:1px">${escHtml(t.description)}</div>` : ''}
      </td>
      <td>${typeHtml}</td>
      <td>
        <div class="url-cell" title="${escHtml(target)}">${escHtml(target)}</div>
        ${!isExt && t.page_id ? `<div style="font-size:10px;color:var(--text-muted);margin-top:1px">page_id: ${escHtml(t.page_id)}</div>` : ''}
        ${isExt && t.badge_text ? `<span class="badge badge-${escHtml(t.badge_type||'gray')}" style="margin-top:3px;display:inline-block">${escHtml(t.badge_text)}</span>` : ''}
      </td>
      <td>
        <div class="toggle-wrap">
          <div class="toggle ${t.enabled !== false ? 'on' : ''}" data-action="toggle" data-id="${escHtml(t.id)}"></div>
          <span style="font-size:10px;color:var(--text-muted)">${t.enabled !== false ? 'On' : 'Off'}</span>
        </div>
      </td>
      <td>
        <div class="action-btn-group">
          <button class="btn btn-ghost" style="padding:5px 10px;font-size:11px" data-action="edit" data-id="${escHtml(t.id)}">Edit</button>
          <button class="btn" style="padding:5px 10px;font-size:11px;background:#fee2e2;color:#dc2626;border:none" data-action="delete" data-id="${escHtml(t.id)}" data-name="${escHtml(t.name)}">Del</button>
        </div>
      </td>
    </tr>`;
  }

  // ─── Quick toggle ───────────────────────────────────────
  async function quickToggle(id) {
    const t = currentTools.find(x => x.id === id);
    if (!t) return;
    const next = t.enabled === false;
    const res  = await API.sidebarTools.update(id, { enabled: next });
    if (!res?.ok) { Toast.error('อัพเดทไม่สำเร็จ'); return; }
    t.enabled = next;
    const row = document.querySelector(`tr[data-id="${CSS.escape(id)}"]`);
    if (row) row.outerHTML = renderRow(t);
    Toast.success(next ? 'เปิดใช้งานแล้ว' : 'ปิดใช้งานแล้ว');
    Layout.bustCache();
    initDragSort();
  }

  // ─── Drag-sort ──────────────────────────────────────────
  function initDragSort() {
    const tbody = document.getElementById('tools-tbody');
    if (!tbody) return;
    let dragging = null;

    tbody.querySelectorAll('tr[draggable]').forEach(row => {
      row.addEventListener('dragstart', () => { dragging = row; setTimeout(() => row.classList.add('dragging'), 0); });
      row.addEventListener('dragend', async () => {
        row.classList.remove('dragging');
        const rows = [...tbody.querySelectorAll('tr[data-id]')];
        const ups  = rows.map((r, i) => {
          const t = currentTools.find(x => x.id === r.dataset.id);
          if (t) t.order = i + 1;
          return API.sidebarTools.update(r.dataset.id, { order: i + 1 });
        });
        await Promise.all(ups);
        Layout.bustCache();
        dragging = null;
      });
      row.addEventListener('dragover', e => { e.preventDefault(); if (dragging && dragging !== row) { tbody.querySelectorAll('tr').forEach(r => r.classList.remove('drag-over')); row.classList.add('drag-over'); } });
      row.addEventListener('drop', e => { e.preventDefault(); row.classList.remove('drag-over'); if (dragging && dragging !== row) { const rows = [...tbody.querySelectorAll('tr')]; rows.indexOf(dragging) < rows.indexOf(row) ? row.after(dragging) : row.before(dragging); } });
    });
  }

  // ─── Link type toggle ───────────────────────────────────
  function setLinkType(type) {
    document.getElementById('f-link-type').value = type;
    document.getElementById('type-opt-internal').classList.toggle('selected', type === 'internal');
    document.getElementById('type-opt-external').classList.toggle('selected', type === 'external');
    document.getElementById('type-opt-embedded').classList.toggle('selected', type === 'embedded');
    document.getElementById('fields-internal').style.display = type === 'internal' ? '' : 'none';
    document.getElementById('fields-external').style.display = type === 'external' ? '' : 'none';
    document.getElementById('fields-embedded').style.display = type === 'embedded' ? '' : 'none';
  }

  // ─── Modal helpers ──────────────────────────────────────
  function openModal(id)  { document.getElementById(id).classList.add('open'); }
  function closeModal(id) { document.getElementById(id).classList.remove('open'); }

  function toggleEnabled() {
    const cur  = document.getElementById('f-enabled').value === 'true';
    const next = !cur;
    document.getElementById('f-enabled').value = String(next);
    document.getElementById('f-enabled-toggle').classList.toggle('on', next);
    document.getElementById('f-enabled-label').textContent = next ? 'เปิดใช้งาน' : 'ปิดใช้งาน';
  }

  function resetForm() {
    ['f-name','f-icon','f-desc','f-path','f-page-id','f-url','f-embed-url','f-badge-text','f-order'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    document.getElementById('f-badge-type').value = 'gray';
    document.getElementById('f-enabled').value = 'true';
    document.getElementById('f-enabled-toggle').classList.add('on');
    document.getElementById('f-enabled-label').textContent = 'เปิดใช้งาน';
    document.getElementById('icon-preview').innerHTML = '<i data-icon="plus-circle"></i>';
    setLinkType('internal');
  }

  function openCreateModal() {
    editingId = null;
    resetForm();
    document.getElementById('modal-title').textContent = 'Add Tool';
    document.getElementById('modal-save-btn').textContent = 'Save Tool';
    openModal('modal-tool');
    setTimeout(() => document.getElementById('f-name').focus(), 100);
  }

  function openEditModal(id) {
    const t = currentTools.find(x => x.id === id);
    if (!t) return;
    editingId = id;

    setLinkType(t.link_type || 'internal');
    document.getElementById('f-name').value       = t.name        || '';
    document.getElementById('f-icon').value       = t.icon        || '';
    document.getElementById('f-desc').value       = t.description || '';
    document.getElementById('f-path').value       = t.path        || '';
    document.getElementById('f-page-id').value    = t.page_id     || '';
    document.getElementById('f-url').value        = t.link_type !== 'embedded' ? (t.url || '') : '';
    document.getElementById('f-embed-url').value  = t.link_type === 'embedded' ? (t.url || '') : '';
    document.getElementById('f-badge-text').value = t.badge_text  || '';
    document.getElementById('f-badge-type').value = t.badge_type  || 'gray';
    document.getElementById('f-order').value      = t.order       ?? '';
    document.getElementById('icon-preview').innerHTML = t.icon || '<i data-icon="plus-circle"></i>';

    const en = t.enabled !== false;
    document.getElementById('f-enabled').value = String(en);
    document.getElementById('f-enabled-toggle').classList.toggle('on', en);
    document.getElementById('f-enabled-label').textContent = en ? 'เปิดใช้งาน' : 'ปิดใช้งาน';

    document.getElementById('modal-title').textContent = 'Edit Tool';
    document.getElementById('modal-save-btn').textContent = 'Save Changes';
    openModal('modal-tool');
  }

  // ─── Save ───────────────────────────────────────────────
  async function saveTool() {
    const linkType = document.getElementById('f-link-type').value;
    const name     = document.getElementById('f-name').value.trim();
    const icon     = document.getElementById('f-icon').value.trim()  || '<i data-icon="plus-circle"></i>';
    const desc     = document.getElementById('f-desc').value.trim();
    const path     = document.getElementById('f-path').value.trim();
    const pageId   = document.getElementById('f-page-id').value.trim();
    const url      = linkType === 'embedded'
                     ? document.getElementById('f-embed-url').value.trim()
                     : document.getElementById('f-url').value.trim();
    const badgeTxt = document.getElementById('f-badge-text').value.trim();
    const badgeTyp = document.getElementById('f-badge-type').value;
    const orderVal = document.getElementById('f-order').value;
    const enabled  = document.getElementById('f-enabled').value === 'true';

    if (!name) { Toast.error('กรุณากรอกชื่อ'); return; }
    if (linkType === 'internal' && !path) { Toast.error('กรุณากรอก Path'); return; }
    if (linkType === 'external' && !url)  { Toast.error('กรุณากรอก URL'); return; }
    if (linkType === 'embedded' && !url)  { Toast.error('กรุณากรอก URL สำหรับ Embed'); return; }

    const payload = { link_type: linkType, name, icon, description: desc,
                      path, page_id: pageId, url,
                      badge_text: badgeTxt, badge_type: badgeTyp, enabled };
    if (orderVal !== '') payload.order = parseInt(orderVal);

    const btn = document.getElementById('modal-save-btn');
    btn.disabled = true; btn.textContent = 'Saving...';

    const res = editingId
      ? await API.sidebarTools.update(editingId, payload)
      : await API.sidebarTools.create(payload);

    btn.disabled = false;
    btn.textContent = editingId ? 'Save Changes' : 'Save Tool';

    if (!res?.ok) { Toast.error(res?.data?.message || 'เกิดข้อผิดพลาด'); return; }

    Toast.success(editingId ? 'แก้ไขเรียบร้อย' : 'เพิ่ม Tool เรียบร้อย');
    Layout.bustCache();
    closeModal('modal-tool');
    loadTools();
  }

  // ─── Delete ─────────────────────────────────────────────
  function openDeleteModal(id, name) {
    deletingId = id;
    document.getElementById('delete-tool-name').textContent = name;
    openModal('modal-delete');
  }

  async function confirmDelete() {
    if (!deletingId) return;
    const res = await API.sidebarTools.delete(deletingId);
    if (!res?.ok) { Toast.error(res?.data?.message || 'ลบไม่สำเร็จ'); return; }
    Toast.success('ลบ Tool เรียบร้อย');
    Layout.bustCache();
    closeModal('modal-delete');
    deletingId = null;
    loadTools();
  }

  // ─── Keyboard & overlay ─────────────────────────────────
  document.querySelectorAll('.modal-overlay').forEach(el => {
    el.addEventListener('click', e => { if (e.target === el) closeModal(el.id); });
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && document.getElementById('modal-tool').classList.contains('open')) saveTool();
    if (e.key === 'Escape') ['modal-tool','modal-delete'].forEach(id => closeModal(id));
  });

  loadTools();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "closeModal", { configurable: true, get: () => closeModal, set: (v) => { closeModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "confirmDelete", { configurable: true, get: () => confirmDelete, set: (v) => { confirmDelete = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "initDragSort", { configurable: true, get: () => initDragSort, set: (v) => { initDragSort = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadTools", { configurable: true, get: () => loadTools, set: (v) => { loadTools = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openCreateModal", { configurable: true, get: () => openCreateModal, set: (v) => { openCreateModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openDeleteModal", { configurable: true, get: () => openDeleteModal, set: (v) => { openDeleteModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openEditModal", { configurable: true, get: () => openEditModal, set: (v) => { openEditModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openModal", { configurable: true, get: () => openModal, set: (v) => { openModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "quickToggle", { configurable: true, get: () => quickToggle, set: (v) => { quickToggle = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderRow", { configurable: true, get: () => renderRow, set: (v) => { renderRow = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "resetForm", { configurable: true, get: () => resetForm, set: (v) => { resetForm = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "saveTool", { configurable: true, get: () => saveTool, set: (v) => { saveTool = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setLinkType", { configurable: true, get: () => setLinkType, set: (v) => { setLinkType = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toggleEnabled", { configurable: true, get: () => toggleEnabled, set: (v) => { toggleEnabled = v; } }); } catch (e) {}
})();
