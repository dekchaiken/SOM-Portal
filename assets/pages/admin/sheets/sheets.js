// admin/sheets — page script, extracted from admin/sheets.html.
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
  Layout.render('admin-sheets');

  const TYPE_META = {
    sheet: { icon: '<i data-icon="book"></i>', cls: 'doc-type-sheet' },
    doc:   { icon: '<i data-icon="book"></i>', cls: 'doc-type-doc'   },
    slide: { icon: '<i data-icon="book"></i>', cls: 'doc-type-slide' },
    other: { icon: '<i data-icon="file"></i>', cls: 'doc-type-other' },
  };

  let allDocs = [];
  let categories = [];

  async function init() {
    const [docsRes, catRes] = await Promise.all([
      API.sheets.list(),
      API.sheets.getCategories()
    ]);
    if (catRes?.ok)  { categories = catRes.data.data || []; renderCategories(); populateSelects(); }
    if (docsRes?.ok) { allDocs = docsRes.data.data || [];   renderTable(allDocs); }
  }

  // ── Categories ────────────────────────────────────────────
  function renderCategories() {
    const el = document.getElementById('cat-list');
    if (!categories.length) { el.innerHTML = '<span style="font-size:11px;color:var(--text-muted)">ยังไม่มีหมวดหมู่</span>'; return; }
    el.innerHTML = categories.map(c => `
      <div class="cat-chip">
        ${escHtml(c)}
        <button onclick="deleteCategory('${escHtml(c)}')" title="ลบ"><i data-icon="x"></i></button>
      </div>`).join('');
  }

  function populateSelects() {
    const opts = '<option value="">— ไม่ระบุ —</option>' +
      categories.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');
    document.getElementById('doc-category').innerHTML = opts;

    const filterOpts = '<option value="">ทุกหมวด</option>' +
      categories.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');
    document.getElementById('filter-cat').innerHTML = filterOpts;
  }

  function openAddCategory() {
    document.getElementById('cat-name').value = '';
    Modal.open('cat-modal');
  }

  async function saveCategory() {
    const name = document.getElementById('cat-name').value.trim();
    if (!name) { Toast.warning('ใส่ชื่อหมวดหมู่ด้วย'); return; }
    const res = await API.sheets.addCategory({ name });
    if (res?.ok) {
      categories = res.data.data || [];
      renderCategories(); populateSelects();
      Modal.close('cat-modal');
      Toast.success('เพิ่มหมวดหมู่แล้ว');
    } else {
      Toast.error(res?.data?.message || 'เกิดข้อผิดพลาด');
    }
  }

  async function deleteCategory(name) {
    const confirmed = await confirmDialog(`ลบหมวด "${name}"?`, 'ลบหมวดหมู่');
    if (!confirmed) return;
    const res = await API.sheets.deleteCategory(name);
    if (res?.ok) {
      categories = res.data.data || [];
      renderCategories(); populateSelects();
      Toast.success('ลบหมวดหมู่แล้ว');
    } else {
      Toast.error(res?.data?.message || 'ลบไม่สำเร็จ');
    }
  }

  // ── Table ─────────────────────────────────────────────────
  function applyFilter() {
    const cat = document.getElementById('filter-cat').value;
    const filtered = cat ? allDocs.filter(d => d.category === cat) : allDocs;
    renderTable(filtered);
  }

  function renderTable(docs) {
    document.getElementById('doc-count').textContent = `(${docs.length})`;
    const wrap = document.getElementById('docs-table-wrap');
    if (!docs.length) {
      wrap.innerHTML = `<div class="empty-state" style="padding:40px 0"><div class="empty-icon">⊞</div><p>ยังไม่มีเอกสาร</p></div>`;
      return;
    }
    wrap.innerHTML = `
      <table class="data-table" style="width:100%">
        <thead>
          <tr>
            <th>เอกสาร</th>
            <th>ประเภท</th>
            <th>หมวดหมู่</th>
            <th>โดย</th>
            <th>วันที่</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${docs.map(d => {
          const m = TYPE_META[d.type] || TYPE_META.other;
          return `
            <tr>
              <td>
                <div style="display:flex;align-items:center;gap:10px">
                  <div class="doc-type-icon ${m.cls}" style="width:32px;height:32px;border-radius:8px;font-size:14px">${m.icon}</div>
                  <div>
                    <div style="font-size:12px;font-weight:600;color:var(--text)">${escHtml(d.name)}</div>
                    ${d.description ? `<div style="font-size:10px;color:var(--text-muted);max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(d.description)}</div>` : ''}
                  </div>
                </div>
              </td>
              <td><span class="badge badge-gray" style="font-size:10px">${d.type}</span></td>
              <td style="font-size:11px;color:var(--text-muted)">${escHtml(d.category || '—')}</td>
              <td style="font-size:11px;color:var(--text-muted)">${escHtml(d.author_name)}</td>
              <td style="font-size:11px;color:var(--text-muted)">${DateTime.formatDate(d.created_at)}</td>
              <td style="text-align:right">
                <div style="display:flex;gap:4px;justify-content:flex-end">
                  <a href="${escHtml(d.url)}" target="_blank" rel="noopener noreferrer"
                     class="btn btn-ghost btn-icon btn-sm" data-tip="Open" title="เปิด">↗</a>
                  <button class="btn btn-ghost btn-icon btn-sm" data-tip="Edit" onclick="editDoc('${d.id}')">✎</button>
                  <button class="btn btn-ghost btn-icon btn-sm" data-tip="Delete" style="color:var(--danger)" onclick="deleteDoc('${d.id}')">✕</button>
                </div>
              </td>
            </tr>`;
        }).join('')}</tbody>
      </table>`;
  }

  // ── Doc CRUD ──────────────────────────────────────────────
  function openDocModal(doc = null) {
    document.getElementById('doc-modal-title').textContent = doc ? 'แก้ไขเอกสาร' : 'เพิ่มเอกสาร';
    document.getElementById('doc-save-text').textContent   = doc ? 'บันทึก' : 'เพิ่ม';
    document.getElementById('edit-doc-id').value  = doc?.id || '';
    document.getElementById('doc-name').value     = doc?.name || '';
    document.getElementById('doc-url').value      = doc?.url || '';
    document.getElementById('doc-type').value     = doc?.type || 'sheet';
    document.getElementById('doc-category').value = doc?.category || '';
    document.getElementById('doc-desc').value     = doc?.description || '';
    Modal.open('doc-modal');
  }

  function editDoc(id) {
    const d = allDocs.find(x => x.id === id);
    if (d) openDocModal(d);
  }

  async function saveDoc() {
    const btn  = document.getElementById('doc-save-btn');
    const text = document.getElementById('doc-save-text');
    const spin = document.getElementById('doc-save-spin');
    const id   = document.getElementById('edit-doc-id').value;

    const payload = {
      name:        document.getElementById('doc-name').value.trim(),
      url:         document.getElementById('doc-url').value.trim(),
      type:        document.getElementById('doc-type').value,
      category:    document.getElementById('doc-category').value,
      description: document.getElementById('doc-desc').value.trim(),
    };

    if (!payload.name) { Toast.warning('กรุณาใส่ชื่อเอกสาร'); return; }
    if (!payload.url)  { Toast.warning('กรุณาใส่ URL'); return; }

    btn.disabled = true; spin.classList.remove('hidden');
    const res = id ? await API.sheets.update(id, payload) : await API.sheets.create(payload);
    btn.disabled = false; spin.classList.add('hidden');

    if (res?.ok) {
      Toast.success(id ? 'แก้ไขแล้ว <i data-icon="check"></i>' : 'เพิ่มแล้ว <i data-icon="check"></i>');
      Modal.close('doc-modal');
      const docsRes = await API.sheets.list();
      if (docsRes?.ok) { allDocs = docsRes.data.data || []; applyFilter(); }
    } else {
      Toast.error(res?.data?.message || 'เกิดข้อผิดพลาด');
    }
  }

  async function deleteDoc(id) {
    const confirmed = await confirmDialog('ลบเอกสารนี้?', 'ลบเอกสาร');
    if (!confirmed) return;
    const res = await API.sheets.delete(id);
    if (res?.ok) {
      Toast.success('ลบแล้ว');
      allDocs = allDocs.filter(d => d.id !== id);
      applyFilter();
    } else {
      Toast.error(res?.data?.message || 'ลบไม่สำเร็จ');
    }
  }

  // ── Search ────────────────────────────────────────────────
  document.getElementById('search-input').addEventListener('input', debounce((e) => {
    const q = e.target.value.trim().toLowerCase();
    let filtered = allDocs;
    const cat = document.getElementById('filter-cat').value;
    if (cat) filtered = filtered.filter(d => d.category === cat);
    if (q)   filtered = filtered.filter(d =>
      d.name.toLowerCase().includes(q) || (d.description || '').toLowerCase().includes(q)
    );
    renderTable(filtered);
  }, 250));

  // Enter to add category
  document.getElementById('cat-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') saveCategory();
  });

  init();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "applyFilter", { configurable: true, get: () => applyFilter, set: (v) => { applyFilter = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "deleteCategory", { configurable: true, get: () => deleteCategory, set: (v) => { deleteCategory = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "deleteDoc", { configurable: true, get: () => deleteDoc, set: (v) => { deleteDoc = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "editDoc", { configurable: true, get: () => editDoc, set: (v) => { editDoc = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "init", { configurable: true, get: () => init, set: (v) => { init = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openAddCategory", { configurable: true, get: () => openAddCategory, set: (v) => { openAddCategory = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openDocModal", { configurable: true, get: () => openDocModal, set: (v) => { openDocModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "populateSelects", { configurable: true, get: () => populateSelects, set: (v) => { populateSelects = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderCategories", { configurable: true, get: () => renderCategories, set: (v) => { renderCategories = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderTable", { configurable: true, get: () => renderTable, set: (v) => { renderTable = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "saveCategory", { configurable: true, get: () => saveCategory, set: (v) => { saveCategory = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "saveDoc", { configurable: true, get: () => saveDoc, set: (v) => { saveDoc = v; } }); } catch (e) {}
})();
