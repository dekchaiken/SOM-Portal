// admin/board — page script, extracted from admin/board.html.
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

  let boardCfg = { categories: [], service_types: [] };
  let allPosts  = [];

  // ── Load all data ─────────────────────────────────────────
  async function loadAll() {
    const [cfgRes, postsRes] = await Promise.all([
      API.boardConfig.get(),
      API.board.list()
    ]);
    if (cfgRes?.ok)   { boardCfg = cfgRes.data.data || { categories: [], service_types: [] }; }
    if (postsRes?.ok) { allPosts = postsRes.data.data || []; }
    renderCategories();
    renderServiceTypes();
    renderTable(allPosts);
  }

  // ── Board Categories ──────────────────────────────────────
  function renderCategories() {
    const el = document.getElementById('cat-chips');
    if (!boardCfg.categories.length) {
      el.innerHTML = '<span style="color:var(--text-muted);font-size:12px">No categories yet.</span>';
      return;
    }
    el.innerHTML = boardCfg.categories
      .sort((a,b) => (a.order||0)-(b.order||0))
      .map(c => `
        <span class="chip">
          ${escHtml(c.name)}
          <span class="chip-edit" onclick="openEdit('${c.id}','${escHtml(c.name).replace(/'/g,"\\'")}')">✎</span>
          <span class="chip-del" onclick="deleteItem('${c.id}','${escHtml(c.name).replace(/'/g,"\\'")}','category')">✕</span>
        </span>`).join('');
  }

  async function addCategory() {
    const inp  = document.getElementById('cat-new-name');
    const name = inp.value.trim();
    if (!name) { Toast.warning('Enter a name'); return; }
    const res = await API.boardConfig.addCategory({ name });
    if (res?.ok) {
      Toast.success('Category added');
      inp.value = '';
      await loadAll();
    } else {
      Toast.error(res?.data?.message || 'Failed');
    }
  }

  // ── Board Service Types ───────────────────────────────────
  function renderServiceTypes() {
    const el = document.getElementById('bst-list');
    if (!boardCfg.service_types.length) {
      el.innerHTML = '<p style="color:var(--text-muted);font-size:12px;margin:0">No service types yet.</p>';
      return;
    }

    el.innerHTML = boardCfg.service_types
      .sort((a,b) => (a.order||0)-(b.order||0))
      .map(st => {
        const subchips = (st.subtypes || [])
          .sort((a,b) => (a.order||0)-(b.order||0))
          .map(s => `
            <span class="chip" style="background:var(--bg);font-size:11px">
              ${escHtml(s.name)}
              <span class="chip-edit" onclick="openEdit('${s.id}','${escHtml(s.name).replace(/'/g,"\\'")}')"><i data-icon="pencil"></i></span>
              <span class="chip-del" onclick="deleteItem('${s.id}','${escHtml(s.name).replace(/'/g,"\\'")}','subtype')">✕</span>
            </span>`).join('');

        return `
          <div class="st-card">
            <div class="st-card-header">
              <span class="st-card-name">${escHtml(st.name)}</span>
              <div style="display:flex;gap:6px">
                <button class="btn btn-ghost btn-sm" onclick="openEdit('${st.id}','${escHtml(st.name).replace(/'/g,"\\'")}')">✎ Rename</button>
                <button class="btn btn-danger btn-sm" onclick="deleteItem('${st.id}','${escHtml(st.name).replace(/'/g,"\\'")}','service type')">Delete</button>
              </div>
            </div>
            <div class="st-subchips">
              ${subchips || '<span style="color:var(--text-muted);font-size:11px">No subtypes</span>'}
            </div>
            <div class="add-inline">
              <input type="text" class="form-control" id="sub-inp-${st.id}" placeholder="Add subtype..." maxlength="60"
                     onkeydown="if(event.key==='Enter') addSubtype('${st.id}')">
              <button class="btn btn-outline btn-sm" onclick="addSubtype('${st.id}')">+ Add</button>
            </div>
          </div>`;
      }).join('');
  }

  async function addServiceType() {
    const inp  = document.getElementById('bst-new-name');
    const name = inp.value.trim();
    if (!name) { Toast.warning('Enter a name'); return; }
    const res = await API.boardConfig.addServiceType({ name });
    if (res?.ok) {
      Toast.success('Service type added');
      inp.value = '';
      await loadAll();
    } else {
      Toast.error(res?.data?.message || 'Failed');
    }
  }

  async function addSubtype(parentId) {
    const inp  = document.getElementById(`sub-inp-${parentId}`);
    const name = inp?.value?.trim();
    if (!name) { Toast.warning('Enter a name'); return; }
    const res = await API.boardConfig.addSubtype(parentId, { name });
    if (res?.ok) {
      Toast.success('Subtype added');
      if (inp) inp.value = '';
      await loadAll();
    } else {
      Toast.error(res?.data?.message || 'Failed');
    }
  }

  // ── Edit / Rename ─────────────────────────────────────────
  function openEdit(id, currentName) {
    document.getElementById('edit-item-id').value   = id;
    document.getElementById('edit-item-name').value = currentName;
    Modal.open('edit-modal');
    setTimeout(() => document.getElementById('edit-item-name').select(), 100);
  }

  async function saveEdit() {
    const id   = document.getElementById('edit-item-id').value;
    const name = document.getElementById('edit-item-name').value.trim();
    if (!name) { Toast.warning('Name cannot be empty'); return; }
    const res = await API.boardConfig.rename(id, { name });
    if (res?.ok) {
      Toast.success('Renamed');
      Modal.close('edit-modal');
      await loadAll();
    } else {
      Toast.error(res?.data?.message || 'Failed');
    }
  }

  // ── Delete ────────────────────────────────────────────────
  async function deleteItem(id, name, kind) {
    const ok = await confirmDialog(`Delete ${kind} "${name}"?`, 'Confirm Delete');
    if (!ok) return;
    const res = await API.boardConfig.delete(id);
    if (res?.ok) {
      Toast.success('Deleted');
      await loadAll();
    } else {
      Toast.error(res?.data?.message || 'Failed');
    }
  }

  // ── Posts Table ───────────────────────────────────────────
  function renderTable(posts) {
    const container = document.getElementById('board-table');
    if (!posts.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">◫</div><p>No posts</p></div>';
      return;
    }

    container.innerHTML = `<div class="table-wrap"><table>
      <thead><tr>
        <th>Title</th>
        <th>Board</th>
        <th>Service Type</th>
        <th>Author</th>
        <th>Pin</th>
        <th style="white-space:nowrap">Date</th>
        <th style="text-align:right">Actions</th>
      </tr></thead>
      <tbody>
        ${posts.map(p => `<tr>
          <td style="font-weight:600;max-width:260px">
            ${p.pinned ? '📌 ' : ''}${escHtml(p.title)}
            ${p.image_url ? '<span class="badge badge-gray" style="margin-left:6px">IMG</span>' : ''}
          </td>
          <td>
            ${p.board_type_name
              ? `<span class="badge badge-blue" style="font-size:10px">${escHtml(p.board_type_name)}</span>`
              : '<span style="color:var(--text-muted);font-size:11px">—</span>'}
          </td>
          <td style="font-size:11px;color:var(--text-muted)">
            ${p.service_type_name
              ? escHtml(p.service_type_name) + (p.service_subtype_name ? ` · ${escHtml(p.service_subtype_name)}` : '')
              : '—'}
          </td>
          <td style="color:var(--text-muted)">${escHtml(p.author_name)}</td>
          <td>
            ${p.pinned
              ? '<span class="badge badge-orange">Pinned</span>'
              : '<span style="color:var(--text-muted);font-size:11px">—</span>'}
          </td>
          <td style="color:var(--text-muted);font-size:11px;white-space:nowrap">${DateTime.format(p.created_at)}</td>
          <td style="text-align:right">
            <div class="flex gap-2" style="justify-content:flex-end">
              <button class="btn btn-ghost btn-sm" onclick="togglePin('${p.id}')">${p.pinned ? 'Unpin' : '📌 Pin'}</button>
              <button class="btn btn-danger btn-sm" onclick="deletePost('${p.id}','${escHtml(p.title).replace(/'/g,"\\'") }')">Delete</button>
            </div>
          </td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
  }

  async function togglePin(id) {
    const res = await API.board.pin(id);
    if (res?.ok) { Toast.success('Updated'); loadAll(); }
    else Toast.error(res?.data?.message || 'Failed');
  }

  async function deletePost(id, title) {
    const ok = await confirmDialog(`Delete "${title}"?`, 'Delete Post');
    if (!ok) return;
    const res = await API.board.delete(id);
    if (res?.ok) { Toast.success('Deleted'); loadAll(); }
    else Toast.error(res?.data?.message || 'Failed');
  }

  // ── Search ────────────────────────────────────────────────
  const doSearch = debounce(async (v) => {
    const res = await API.board.list(v);
    if (res?.ok) renderTable(res.data.data || []);
  }, 300);
  document.getElementById('board-search').addEventListener('input', e => doSearch(e.target.value));

  // ── Init ──────────────────────────────────────────────────
  loadAll();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "addCategory", { configurable: true, get: () => addCategory, set: (v) => { addCategory = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "addServiceType", { configurable: true, get: () => addServiceType, set: (v) => { addServiceType = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "addSubtype", { configurable: true, get: () => addSubtype, set: (v) => { addSubtype = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "deleteItem", { configurable: true, get: () => deleteItem, set: (v) => { deleteItem = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "deletePost", { configurable: true, get: () => deletePost, set: (v) => { deletePost = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadAll", { configurable: true, get: () => loadAll, set: (v) => { loadAll = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openEdit", { configurable: true, get: () => openEdit, set: (v) => { openEdit = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderCategories", { configurable: true, get: () => renderCategories, set: (v) => { renderCategories = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderServiceTypes", { configurable: true, get: () => renderServiceTypes, set: (v) => { renderServiceTypes = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderTable", { configurable: true, get: () => renderTable, set: (v) => { renderTable = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "saveEdit", { configurable: true, get: () => saveEdit, set: (v) => { saveEdit = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "togglePin", { configurable: true, get: () => togglePin, set: (v) => { togglePin = v; } }); } catch (e) {}
})();
