// admin/links — page script, extracted from admin/links.html.
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

  const SECTION_LABELS = {
    'monitoring':   '<i data-icon="circle"></i> Monitoring',
    'test-service': '⊡ Test Service',
    'batch-monitor':'⊞ Batch Monitor',
    'report':       '≡ Report Weekly'
  };

  let currentSection = 'monitoring';
  let currentLinks   = [];
  let editingId      = null;
  let deletingId     = null;

  // ─── Switch section tab ───────────────────────────────
  function switchSection(section, el) {
    currentSection = section;
    document.querySelectorAll('.section-tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    document.getElementById('section-title').textContent = SECTION_LABELS[section] + ' Links';
    loadLinks();
  }

  // ─── Load links for current section ──────────────────
  async function loadLinks() {
    const container = document.getElementById('table-container');
    container.innerHTML = Skeleton.table(5);

    const res = await API.links.list(currentSection);

    if (!res?.ok) {
      container.innerHTML = '<div class="empty-table">โหลดข้อมูลไม่สำเร็จ</div>';
      document.getElementById('link-count').textContent = '—';
      return;
    }

    currentLinks = res.data.data || [];
    document.getElementById('link-count').textContent = `${currentLinks.length} links`;

    if (!currentLinks.length) {
      container.innerHTML = '<div class="empty-table">ยังไม่มีลิงก์ใน section นี้<br>กด "+ Add Link" เพื่อเพิ่ม</div>';
      return;
    }

    container.innerHTML = `
      <table class="links-table">
        <thead>
          <tr>
            <th style="width:48px">Icon</th>
            <th>ชื่อ</th>
            <th>URL / คำอธิบาย</th>
            <th style="width:90px">Sub-group</th>
            <th style="width:70px">เปิดแบบ</th>
            <th style="width:80px">Badge</th>
            <th style="width:60px">Order</th>
            <th style="width:100px">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${currentLinks.map(l => `
            <tr>
              <td><div class="link-icon-preview">${renderIcon(l.icon, '<i data-icon="link"></i>')}</div></td>
              <td style="font-weight:600">${escHtml(l.name)}</td>
              <td>
                <div class="url-cell" title="${escHtml(l.url)}">${escHtml(l.url)}</div>
                ${l.description ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${escHtml(l.description)}</div>` : ''}
              </td>
              <td style="font-size:11px;color:var(--text-muted)">
                ${l.subsection
                  ? `<span class="badge badge-gray" style="font-size:10px">${escHtml(l.subsection)}</span>`
                  : '<span style="color:var(--border)">—</span>'}
              </td>
              <td style="font-size:11px">
                ${l.open_mode === 'iframe'
                  ? '<span class="badge badge-blue" style="font-size:10px">⧉ iframe</span>'
                  : '<span style="color:var(--text-muted)">↗ tab</span>'}
              </td>
              <td>
                ${l.badge_text
                  ? `<span class="badge badge-${escHtml(l.badge_type || 'gray')}">${escHtml(l.badge_text)}</span>`
                  : '<span style="color:var(--text-muted)">—</span>'}
              </td>
              <td class="order-cell">${l.order ?? '—'}</td>
              <td>
                <div class="action-btn-group">
                  <button class="btn btn-ghost" style="padding:5px 10px;font-size:11px"
                    data-action="edit" data-id="${escHtml(l.id)}">Edit</button>
                  <button class="btn" style="padding:5px 10px;font-size:11px;background:#fee2e2;color:#dc2626;border:none"
                    data-action="delete" data-id="${escHtml(l.id)}" data-name="${escHtml(l.name)}">Del</button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>`;

    // Event delegation — ไม่มี inline onclick เพื่อหลีกเลี่ยง escHtml ใน JS string
    container.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      if (btn.dataset.action === 'edit')   openEditModal(btn.dataset.id);
      if (btn.dataset.action === 'delete') openDeleteModal(btn.dataset.id, btn.dataset.name);
    });
  }

  // ─── Modal helpers ────────────────────────────────────
  function openModal(id) { document.getElementById(id).classList.add('open'); }
  function closeModal(id) { document.getElementById(id).classList.remove('open'); }

  function onSectionChange(val) {
    const row = document.getElementById('f-subsection-row');
    row.style.display = val === 'monitoring' ? '' : 'none';
    if (val !== 'monitoring') document.getElementById('f-subsection').value = '';
  }

  function resetForm() {
    ['f-name','f-url','f-desc','f-icon','f-badge-text','f-order'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('f-badge-type').value  = 'gray';
    document.getElementById('f-open-mode').value   = 'newtab';
    document.getElementById('f-section').value      = currentSection;
    document.getElementById('f-subsection').value   = '';
    document.getElementById('icon-preview').innerHTML = '<i data-icon="link"></i>';
    onSectionChange(currentSection);
  }

  // ─── Create modal ─────────────────────────────────────
  function openCreateModal() {
    editingId = null;
    resetForm();
    document.getElementById('modal-title').textContent = 'Add Link';
    document.getElementById('modal-save-btn').textContent = 'Save Link';
    openModal('modal-link');
    setTimeout(() => document.getElementById('f-name').focus(), 100);
  }

  // ─── Edit modal ───────────────────────────────────────
  function openEditModal(id) {
    const link = currentLinks.find(l => l.id === id);
    if (!link) return;
    editingId = id;

    const sec = link.section || currentSection;
    document.getElementById('f-section').value    = sec;
    document.getElementById('f-subsection').value = link.subsection || '';
    document.getElementById('f-name').value       = link.name || '';
    document.getElementById('f-url').value        = link.url || '';
    document.getElementById('f-desc').value       = link.description || '';
    document.getElementById('f-icon').value       = link.icon || '';
    document.getElementById('f-badge-text').value  = link.badge_text || '';
    document.getElementById('f-badge-type').value  = link.badge_type || 'gray';
    document.getElementById('f-open-mode').value   = link.open_mode || 'newtab';
    document.getElementById('f-order').value       = link.order ?? '';
    document.getElementById('icon-preview').innerHTML = link.icon || '<i data-icon="link"></i>';
    onSectionChange(sec);

    document.getElementById('modal-title').textContent = 'Edit Link';
    document.getElementById('modal-save-btn').textContent = 'Save Changes';
    openModal('modal-link');
  }

  // ─── Save (create or update) ──────────────────────────
  async function saveLink() {
    const name       = document.getElementById('f-name').value.trim();
    const url        = document.getElementById('f-url').value.trim();
    const section    = document.getElementById('f-section').value;
    const subsection = document.getElementById('f-subsection').value;
    const icon       = document.getElementById('f-icon').value.trim() || '<i data-icon="link"></i>';
    const desc       = document.getElementById('f-desc').value.trim();
    const badgeTxt   = document.getElementById('f-badge-text').value.trim();
    const badgeTyp   = document.getElementById('f-badge-type').value;
    const orderVal   = document.getElementById('f-order').value;

    if (!name) { Toast.error('กรุณากรอกชื่อ Link'); return; }
    if (!url)  { Toast.error('กรุณากรอก URL'); return; }

    const openMode  = document.getElementById('f-open-mode').value;
    const payload = { name, url, section, subsection, icon, description: desc,
                      badge_text: badgeTxt, badge_type: badgeTyp, open_mode: openMode };
    if (orderVal !== '') payload.order = parseInt(orderVal);

    console.log('[saveLink] payload:', payload, '| editingId:', editingId);
    const btn = document.getElementById('modal-save-btn');
    btn.disabled = true; btn.textContent = 'Saving...';

    let res;
    if (editingId) {
      res = await API.links.update(editingId, payload);
    } else {
      res = await API.links.create(payload);
    }

    btn.disabled = false;
    btn.textContent = editingId ? 'Save Changes' : 'Save Link';

    console.log('[saveLink] response:', res);
    if (!res?.ok) {
      Toast.error(res?.data?.message || 'เกิดข้อผิดพลาด');
      return;
    }

    Toast.success(editingId ? 'แก้ไข Link เรียบร้อย' : 'เพิ่ม Link เรียบร้อย');
    closeModal('modal-link');

    // ถ้า section เปลี่ยน → switch ไปดู section ใหม่
    if (section !== currentSection) {
      const tab = document.querySelector(`.section-tab[data-section="${section}"]`);
      if (tab) switchSection(section, tab);
    } else {
      loadLinks();
    }
  }

  // ─── Delete modal ─────────────────────────────────────
  function openDeleteModal(id, name) {
    deletingId = id;
    document.getElementById('delete-link-name').textContent = name;
    openModal('modal-delete');
  }

  async function confirmDelete() {
    if (!deletingId) return;
    const res = await API.links.delete(deletingId);
    if (!res?.ok) { Toast.error(res?.data?.message || 'ลบไม่สำเร็จ'); return; }
    Toast.success('ลบ Link เรียบร้อย');
    closeModal('modal-delete');
    deletingId = null;
    loadLinks();
  }

  // ─── Close modal on overlay click ────────────────────
  document.querySelectorAll('.modal-overlay').forEach(el => {
    el.addEventListener('click', e => { if (e.target === el) closeModal(el.id); });
  });

  // ─── Keyboard: Enter to save, Esc to close ────────────
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && document.getElementById('modal-link').classList.contains('open')) {
      saveLink();
    }
    if (e.key === 'Escape') {
      ['modal-link','modal-delete'].forEach(id => closeModal(id));
    }
  });

  // ─── Initial load ─────────────────────────────────────
  loadLinks();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "closeModal", { configurable: true, get: () => closeModal, set: (v) => { closeModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "confirmDelete", { configurable: true, get: () => confirmDelete, set: (v) => { confirmDelete = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadLinks", { configurable: true, get: () => loadLinks, set: (v) => { loadLinks = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "onSectionChange", { configurable: true, get: () => onSectionChange, set: (v) => { onSectionChange = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openCreateModal", { configurable: true, get: () => openCreateModal, set: (v) => { openCreateModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openDeleteModal", { configurable: true, get: () => openDeleteModal, set: (v) => { openDeleteModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openEditModal", { configurable: true, get: () => openEditModal, set: (v) => { openEditModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openModal", { configurable: true, get: () => openModal, set: (v) => { openModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "resetForm", { configurable: true, get: () => resetForm, set: (v) => { resetForm = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "saveLink", { configurable: true, get: () => saveLink, set: (v) => { saveLink = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "switchSection", { configurable: true, get: () => switchSection, set: (v) => { switchSection = v; } }); } catch (e) {}
})();
