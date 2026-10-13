// sheets — page script, extracted from sheets.html.
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
  Layout.render('sheets');

  const currentUser = Auth.getUser();
  let allDocs = [];
  let categories = [];
  let activeType = '';                 // '', 'sheet', 'doc', 'slide'
  let searchQuery = '';
  let selectedDocId = null;
  const COLLAPSED_KEY = 'sheets_collapsed_groups';
  const SIDEBAR_COLLAPSED_KEY = 'sheets_sidebar_collapsed';

  const TYPE_META = {
    sheet: { icon: '<i data-icon="book"></i>', label: 'Sheet', cls: 'sh-doc-icon-sheet' },
    doc:   { icon: '<i data-icon="book"></i>', label: 'Doc',   cls: 'sh-doc-icon-doc'   },
    slide: { icon: '<i data-icon="book"></i>', label: 'Slide', cls: 'sh-doc-icon-slide' },
    other: { icon: '<i data-icon="file"></i>', label: 'Other', cls: 'sh-doc-icon-other' },
  };

  // ── Persisted UI state ──────────────────────────────────
  function loadCollapsed() {
    try { return JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '{}'); }
    catch { return {}; }
  }
  function saveCollapsed(state) {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(state));
  }
  let collapsedGroups = loadCollapsed();

  // ── Convert Google URLs to embed-friendly versions ──────
  function toEmbedUrl(url) {
    try {
      const u = new URL(url);
      if (u.hostname === 'docs.google.com') {
        if (u.pathname.includes('/spreadsheets/')) {
          const gid = u.searchParams.get('gid') || u.hash.replace('#gid=', '');
          const base = url.replace(/\/edit.*$/, '/edit');
          return gid ? base + '#gid=' + gid : base;
        }
        if (u.pathname.includes('/document/')) {
          return url.replace(/\/edit.*$/, '/preview');
        }
        if (u.pathname.includes('/presentation/')) {
          return url.replace(/\/edit.*$/, '/embed');
        }
      }
    } catch (_) {}
    return url;
  }

  // ── Sidebar collapse ────────────────────────────────────
  // Only allow collapsing when a doc is currently viewed — otherwise the
  // user would hide the picker with no way to pick anything.
  function toggleSidebar() {
    const el = document.getElementById('sheets-split');
    const willCollapse = !el.classList.contains('sidebar-collapsed');
    if (willCollapse && !selectedDocId) {
      Toast.warning('เลือกเอกสารก่อน แล้วค่อยย่อ sidebar');
      return;
    }
    el.classList.toggle('sidebar-collapsed');
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, el.classList.contains('sidebar-collapsed') ? '1' : '0');
    document.querySelector('.sh-collapse-btn').textContent = el.classList.contains('sidebar-collapsed') ? '▸' : '◂';
  }

  // Restore collapsed state — but ONLY if there's a doc URL param.
  // A blank page in collapsed mode is a dead-end for users.
  (function restoreSidebarState() {
    const wantsCollapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
    const hasDocParam    = !!new URLSearchParams(location.search).get('doc');
    if (wantsCollapsed && hasDocParam) {
      document.getElementById('sheets-split').classList.add('sidebar-collapsed');
      document.querySelector('.sh-collapse-btn').textContent = '▸';
    } else if (wantsCollapsed && !hasDocParam) {
      // Stale collapsed state with no doc — clear it so a fresh load shows the list
      localStorage.removeItem(SIDEBAR_COLLAPSED_KEY);
    }
  })();

  // ── Type filter tabs ────────────────────────────────────
  function setType(el, type) {
    document.querySelectorAll('.sh-type-tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    activeType = type;
    renderSidebar();
  }

  // ── Init ────────────────────────────────────────────────
  async function init() {
    const [docsRes, catRes] = await Promise.all([
      API.sheets.list(),
      API.sheets.getCategories()
    ]);
    if (catRes?.ok) {
      categories = catRes.data.data || [];
      populateCategorySelect();
    }
    if (docsRes?.ok) {
      allDocs = docsRes.data.data || [];
      renderSidebar();
      // Deep-link: open ?doc=id if present and matches a doc
      const wanted = new URLSearchParams(location.search).get('doc');
      if (wanted && allDocs.find(d => d.id === wanted)) {
        selectDoc(wanted);
      }
    } else {
      Toast.error('โหลดเอกสารไม่สำเร็จ');
    }
  }

  // ── Render sidebar list (grouped by category) ───────────
  function renderSidebar() {
    const body = document.getElementById('sidebar-body');
    let docs = allDocs.slice();
    if (activeType) docs = docs.filter(d => (d.type || 'other') === activeType);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      docs = docs.filter(d =>
        (d.name || '').toLowerCase().includes(q) ||
        (d.description || '').toLowerCase().includes(q)
      );
    }

    if (!docs.length) {
      body.innerHTML = `
        <div style="padding:36px 12px;text-align:center;font-size:11px;color:var(--text-muted);line-height:1.6">
          <div style="font-size:28px;opacity:.4;margin-bottom:6px">⊞</div>
          ${searchQuery || activeType ? 'ไม่พบเอกสารที่ตรงกัน' : 'ยังไม่มีเอกสาร<br>คลิก + เพิ่มเอกสาร ด้านล่าง'}
        </div>`;
      return;
    }

    // Group: starred (per-user) + by category (uncategorized last)
    const starred = docs.filter(d => d.starred);
    const groups = {};
    docs.forEach(d => {
      const cat = d.category || '(ไม่ระบุหมวด)';
      (groups[cat] = groups[cat] || []).push(d);
    });

    // Sort category names — user's defined categories first (in their order), then '(ไม่ระบุหมวด)'
    const catOrder = categories.slice();
    catOrder.push('(ไม่ระบุหมวด)');
    const orderedCats = catOrder.filter(c => groups[c]);
    // Any categories present in data but not in the categories list — append
    Object.keys(groups).forEach(c => { if (!orderedCats.includes(c)) orderedCats.push(c); });

    let html = '';
    if (starred.length) {
      html += buildGroup('__starred__', '<i data-icon="star"></i> Starred', starred, /*forceOpen*/ true);
    }
    orderedCats.forEach(cat => {
      html += buildGroup(cat, cat, groups[cat]);
    });
    body.innerHTML = html;

    // Restore active highlight
    if (selectedDocId) {
      document.querySelector(`.sh-item[data-id="${selectedDocId}"]`)?.classList.add('active');
    }
  }

  function buildGroup(key, label, docs, forceOpen = false) {
    const isCollapsed = !forceOpen && collapsedGroups[key];
    const items = docs.map(buildItem).join('');
    return `
      <div class="sh-group${isCollapsed ? ' collapsed' : ''}${key === '__starred__' ? ' starred-group' : ''}" data-group="${escHtml(key)}">
        <div class="sh-group-head" onclick="toggleGroup(this)">
          <span class="sh-group-caret">▼</span>
          <span>${escHtml(label)}</span>
          <span class="sh-group-count">${docs.length}</span>
        </div>
        <div class="sh-group-body">${items}</div>
      </div>`;
  }

  function buildItem(d) {
    const meta = TYPE_META[d.type] || TYPE_META.other;
    const isActive = d.id === selectedDocId;
    return `
      <div class="sh-item${isActive ? ' active' : ''}" data-id="${escHtml(d.id)}" onclick="selectDoc('${escHtml(d.id)}')">
        <span class="sh-item-icon ${meta.cls}">${meta.icon}</span>
        <span class="sh-item-name" title="${escHtml(d.name)}">${escHtml(d.name)}</span>
        <span class="sh-item-star${d.starred ? ' starred' : ''}" onclick="event.stopPropagation();toggleStar('${escHtml(d.id)}')" title="${d.starred ? 'Unstar' : 'Star'}">${d.starred ? '★' : '☆'}</span>
      </div>`;
  }

  function toggleGroup(headEl) {
    const grp = headEl.parentElement;
    grp.classList.toggle('collapsed');
    const key = grp.dataset.group;
    if (grp.classList.contains('collapsed')) collapsedGroups[key] = true;
    else delete collapsedGroups[key];
    saveCollapsed(collapsedGroups);
  }

  // ── Select doc → render iframe ──────────────────────────
  function selectDoc(id) {
    const d = allDocs.find(x => x.id === id);
    if (!d) return;

    selectedDocId = id;

    // Update active class in sidebar
    document.querySelectorAll('.sh-item.active').forEach(el => el.classList.remove('active'));
    document.querySelector(`.sh-item[data-id="${id}"]`)?.classList.add('active');

    // Update URL (deep link)
    const url = new URL(location.href);
    url.searchParams.set('doc', id);
    history.replaceState(null, '', url.toString());

    renderMainPane(d);
  }

  function renderMainPane(d) {
    const canEdit = d.author_id === currentUser.id ||
      ['super_admin', 'sm_admin', 'dev_sm'].includes(currentUser.role);

    // Internal path? open in same window (no iframe)
    const isInternal = /^(\.\.?\/|\/(?!\/))/.test(d.url) ||
      (() => { try { return new URL(d.url).origin === location.origin; } catch(_) { return false; } })();

    if (isInternal) {
      // Bail out — internal navigation, no iframe
      window.location.href = d.url;
      return;
    }

    const embedUrl = toEmbedUrl(d.url);
    const meta = TYPE_META[d.type] || TYPE_META.other;

    document.getElementById('main-pane').innerHTML = `
      <div class="sh-main-head">
        <span class="sh-item-icon ${meta.cls}" style="font-size:20px">${meta.icon}</span>
        <div class="sh-main-title-wrap">
          <div class="sh-main-title" title="${escHtml(d.name)}">${escHtml(d.name)}</div>
          <div class="sh-main-meta">
            ${d.category ? `<span class="badge badge-gray" style="font-size:9.5px;padding:1px 6px">${escHtml(d.category)}</span>` : ''}
            <span>${escHtml(d.author_name || '—')}</span>
            <span>·</span>
            <span>${DateTime.timeAgo(d.updated_at || d.created_at)}</span>
          </div>
        </div>
        <div class="sh-main-actions">
          <button class="btn btn-ghost btn-icon" data-tip="${d.starred ? 'Unstar' : 'Star'}" onclick="toggleStar('${escHtml(d.id)}')" id="main-star-btn" style="${d.starred ? 'color:#f59e0b' : ''}">${d.starred ? '★' : '☆'}</button>
          <button class="btn btn-ghost btn-icon" data-tip="Copy link" onclick="copyDocLink('${escHtml(d.id)}')"><i data-icon="link"></i></button>
          <a class="btn btn-ghost btn-icon" data-tip="Open in new tab" href="${escHtml(d.url)}" target="_blank" rel="noopener">↗</a>
          ${canEdit ? `<button class="btn btn-ghost btn-icon" data-tip="Edit" onclick="editDoc('${escHtml(d.id)}')">✎</button>` : ''}
          ${canEdit ? `<button class="btn btn-ghost btn-icon" data-tip="Delete" style="color:var(--danger)" onclick="deleteDoc('${escHtml(d.id)}')">✕</button>` : ''}
        </div>
      </div>
      <div class="sh-iframe-wrap">
        <div class="sh-loading" id="iframe-loading"><div class="spinner"></div><span>กำลังโหลด...</span></div>
        <iframe class="sh-iframe loading" id="doc-iframe" src="${escHtml(embedUrl)}"
                onload="onIframeLoad()" allow="clipboard-write; encrypted-media"></iframe>
      </div>`;

    document.title = d.name + ' — Team Docs';
  }

  function onIframeLoad() {
    document.getElementById('iframe-loading')?.classList.add('hidden');
    document.getElementById('doc-iframe')?.classList.remove('loading');
  }

  function copyDocLink(id) {
    const url = new URL(location.href);
    url.searchParams.set('doc', id);
    navigator.clipboard.writeText(url.toString())
      .then(() => Toast.success('คัดลอกลิงก์แล้ว'))
      .catch(() => Toast.error('คัดลอกไม่สำเร็จ'));
  }

  // ── Star / Unstar ───────────────────────────────────────
  async function toggleStar(id) {
    const d = allDocs.find(x => x.id === id);
    if (!d) return;
    const wasStarred = !!d.starred;
    // Optimistic
    d.starred = !wasStarred;
    renderSidebar();
    // Update main-pane star button if that's the visible doc
    if (selectedDocId === id) {
      const btn = document.getElementById('main-star-btn');
      if (btn) {
        btn.innerHTML = d.starred ? '<i data-icon="star"></i>' : '<i data-icon="star"></i>';
        btn.style.color = d.starred ? '#f59e0b' : '';
        btn.setAttribute('data-tip', d.starred ? 'Unstar' : 'Star');
      }
    }
    const res = wasStarred ? await API.sheets.unstar(id) : await API.sheets.star(id);
    if (!res?.ok) {
      // Rollback
      d.starred = wasStarred;
      renderSidebar();
      Toast.error(res?.data?.message || 'อัปเดตไม่สำเร็จ');
    }
  }

  // ── Modal ───────────────────────────────────────────────
  function openDocModal(doc = null) {
    document.getElementById('doc-modal-title').textContent = doc ? 'แก้ไขเอกสาร' : 'เพิ่มเอกสาร';
    document.getElementById('doc-save-text').textContent   = doc ? 'บันทึก' : 'เพิ่ม';
    document.getElementById('edit-doc-id').value           = doc?.id || '';
    document.getElementById('doc-name').value              = doc?.name || '';
    document.getElementById('doc-url').value               = doc?.url || '';
    document.getElementById('doc-type').value              = doc?.type || 'sheet';
    document.getElementById('doc-category').value          = doc?.category || '';
    document.getElementById('doc-desc').value              = doc?.description || '';
    Modal.open('doc-modal');
  }

  function editDoc(id) {
    const d = allDocs.find(x => x.id === id);
    if (d) openDocModal(d);
  }

  function populateCategorySelect() {
    const sel = document.getElementById('doc-category');
    sel.innerHTML = '<option value="">— ไม่ระบุ —</option>' +
      categories.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');
  }

  async function saveDoc() {
    const btn  = document.getElementById('doc-save-btn');
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

    const res = id
      ? await API.sheets.update(id, payload)
      : await API.sheets.create(payload);

    btn.disabled = false; spin.classList.add('hidden');

    if (res?.ok) {
      Toast.success(id ? 'แก้ไขแล้ว <i data-icon="check"></i>' : 'เพิ่มเอกสารแล้ว <i data-icon="check"></i>');
      Modal.close('doc-modal');
      await refreshDocs();
      // If we just created a doc, auto-select it
      if (!id && res.data.data?.id) selectDoc(res.data.data.id);
    } else {
      Toast.error(res?.data?.message || 'เกิดข้อผิดพลาด');
    }
  }

  async function deleteDoc(id) {
    const confirmed = await confirmDialog('ลบเอกสารนี้? ไม่สามารถกู้คืนได้', 'ลบเอกสาร');
    if (!confirmed) return;
    const res = await API.sheets.delete(id);
    if (res?.ok) {
      Toast.success('ลบแล้ว');
      // Reset main pane if we deleted the currently-viewed doc
      if (selectedDocId === id) {
        selectedDocId = null;
        const url = new URL(location.href);
        url.searchParams.delete('doc');
        history.replaceState(null, '', url.toString());
        // Force-expand sidebar so the user can pick another doc
        const split = document.getElementById('sheets-split');
        if (split.classList.contains('sidebar-collapsed')) {
          split.classList.remove('sidebar-collapsed');
          localStorage.removeItem(SIDEBAR_COLLAPSED_KEY);
          document.querySelector('.sh-collapse-btn').textContent = '◂';
        }
        document.getElementById('main-pane').innerHTML = `
          <div class="sh-empty">
            <div class="sh-empty-icon">⊞</div>
            <div class="sh-empty-title">เลือกเอกสารจากรายการทางซ้าย</div>
            <div class="sh-empty-sub">คลิกเอกสารเพื่อดู preview ที่นี่</div>
          </div>`;
      }
      await refreshDocs();
    } else {
      Toast.error(res?.data?.message || 'ลบไม่สำเร็จ');
    }
  }

  async function refreshDocs() {
    const res = await API.sheets.list();
    if (res?.ok) {
      allDocs = res.data.data || [];
      renderSidebar();
    }
  }

  // ── Search ──────────────────────────────────────────────
  document.getElementById('search-input').addEventListener('input', debounce(e => {
    searchQuery = e.target.value.trim();
    renderSidebar();
  }, 200));

  init();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "buildGroup", { configurable: true, get: () => buildGroup, set: (v) => { buildGroup = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "buildItem", { configurable: true, get: () => buildItem, set: (v) => { buildItem = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "copyDocLink", { configurable: true, get: () => copyDocLink, set: (v) => { copyDocLink = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "deleteDoc", { configurable: true, get: () => deleteDoc, set: (v) => { deleteDoc = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "editDoc", { configurable: true, get: () => editDoc, set: (v) => { editDoc = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "init", { configurable: true, get: () => init, set: (v) => { init = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadCollapsed", { configurable: true, get: () => loadCollapsed, set: (v) => { loadCollapsed = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "onIframeLoad", { configurable: true, get: () => onIframeLoad, set: (v) => { onIframeLoad = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openDocModal", { configurable: true, get: () => openDocModal, set: (v) => { openDocModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "populateCategorySelect", { configurable: true, get: () => populateCategorySelect, set: (v) => { populateCategorySelect = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "refreshDocs", { configurable: true, get: () => refreshDocs, set: (v) => { refreshDocs = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderMainPane", { configurable: true, get: () => renderMainPane, set: (v) => { renderMainPane = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderSidebar", { configurable: true, get: () => renderSidebar, set: (v) => { renderSidebar = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "saveCollapsed", { configurable: true, get: () => saveCollapsed, set: (v) => { saveCollapsed = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "saveDoc", { configurable: true, get: () => saveDoc, set: (v) => { saveDoc = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "selectDoc", { configurable: true, get: () => selectDoc, set: (v) => { selectDoc = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setType", { configurable: true, get: () => setType, set: (v) => { setType = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toEmbedUrl", { configurable: true, get: () => toEmbedUrl, set: (v) => { toEmbedUrl = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toggleGroup", { configurable: true, get: () => toggleGroup, set: (v) => { toggleGroup = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toggleSidebar", { configurable: true, get: () => toggleSidebar, set: (v) => { toggleSidebar = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toggleStar", { configurable: true, get: () => toggleStar, set: (v) => { toggleStar = v; } }); } catch (e) {}
})();
