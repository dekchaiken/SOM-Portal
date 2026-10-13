// admin/trash — page script, extracted from admin/trash.html.
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

  let _trashData = { posts: [], comments: [], retention_days: 30 };
  let _activeTab = 'posts';

  // ── Load ───────────────────────────────────────────────
  async function loadTrash() {
    document.getElementById('trash-loading').style.display = 'block';
    document.getElementById('trash-content').style.display = 'none';

    const res = await API.board.trash();
    if (!res?.ok) { Toast.error(res?.data?.message || 'โหลดไม่ได้'); return; }

    _trashData = res.data.data || { posts: [], comments: [], retention_days: 30 };
    renderTrash();

    document.getElementById('trash-loading').style.display = 'none';
    document.getElementById('trash-content').style.display = 'block';
  }

  function renderTrash() {
    const posts    = _trashData.posts    || [];
    const comments = _trashData.comments || [];
    const retention = _trashData.retention_days || 30;

    // Summary
    const expired = [...posts, ...comments].filter(i => (i.days_left ?? 999) <= 0).length;
    document.getElementById('stat-posts').textContent    = posts.length;
    document.getElementById('stat-comments').textContent = comments.length;
    document.getElementById('stat-expired').textContent  = expired;
    document.getElementById('retention-days').textContent = retention;

    // Tab counts
    document.getElementById('tab-count-posts').textContent    = posts.length;
    document.getElementById('tab-count-comments').textContent = comments.length;

    // Purge button visibility
    const showPurge = expired > 0;
    document.getElementById('purge-btn').style.display  = showPurge ? '' : 'none';
    document.getElementById('purge-btn2').style.display = showPurge ? '' : 'none';

    renderPostsTable(posts);
    renderCommentsTable(comments);
  }

  function daysLeftBadge(days) {
    if (days == null) return '—';
    const cls = days <= 3 ? 'urgent' : days <= 7 ? 'warn' : 'ok';
    const label = days <= 0 ? 'Expired' : `${days}d`;
    return `<span class="days-left-badge ${cls}">${label}</span>`;
  }

  function fmtDate(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString('th-TH', { day:'numeric', month:'short', year:'2-digit', hour:'2-digit', minute:'2-digit' });
  }

  function renderPostsTable(posts) {
    const tbody = document.getElementById('posts-tbody');
    const empty = document.getElementById('posts-empty');
    const wrap  = document.getElementById('posts-table-wrap');

    if (posts.length === 0) {
      empty.style.display = '';
      wrap.style.display  = 'none';
      return;
    }
    empty.style.display = 'none';
    wrap.style.display  = '';

    tbody.innerHTML = posts.map(p => `
      <tr>
        <td>
          <div class="trash-title">${escHtml(p.title || '(No title)')}</div>
          <div class="trash-excerpt">${escHtml((p.content || '').slice(0, 120))}</div>
          <div class="trash-meta">by ${escHtml(p.author_name || p.author || '—')} · ${p.id}</div>
        </td>
        <td><div style="font-size:11px">${escHtml(p.deleted_by_name || p.deleted_by || '—')}</div></td>
        <td><div style="font-size:10.5px;white-space:nowrap">${fmtDate(p.deleted_at)}</div></td>
        <td>${daysLeftBadge(p.days_left)}</td>
        <td>
          <div class="trash-actions">
            <button class="btn btn-ghost btn-sm" onclick="restoreItem('${escHtml(p.id)}','post')" style="font-size:10.5px;color:#22c55e;border-color:rgba(34,197,94,.3)">
              <i data-icon="recycle"></i> Restore
            </button>
            <button class="btn btn-ghost btn-sm" onclick="hardDeleteItem('${escHtml(p.id)}','post','${escHtml((p.title||'this post').replace(/'/g,'&#39;'))}')" style="font-size:10.5px;color:#ef4444;border-color:rgba(239,68,68,.3)">
              ✕ Delete
            </button>
          </div>
        </td>
      </tr>`).join('');
  }

  function renderCommentsTable(comments) {
    const tbody = document.getElementById('comments-tbody');
    const empty = document.getElementById('comments-empty');
    const wrap  = document.getElementById('comments-table-wrap');

    if (comments.length === 0) {
      empty.style.display = '';
      wrap.style.display  = 'none';
      return;
    }
    empty.style.display = 'none';
    wrap.style.display  = '';

    tbody.innerHTML = comments.map(c => `
      <tr>
        <td>
          <div class="trash-excerpt" style="max-width:280px;white-space:normal">${escHtml((c.content || '').slice(0, 160))}</div>
          <div class="trash-meta">${c.id}</div>
        </td>
        <td><div style="font-size:11px">${escHtml(c.author_name || c.author || '—')}</div></td>
        <td><div style="font-size:11px">${escHtml(c.deleted_by_name || c.deleted_by || '—')}</div></td>
        <td><div style="font-size:10.5px;white-space:nowrap">${fmtDate(c.deleted_at)}</div></td>
        <td>${daysLeftBadge(c.days_left)}</td>
        <td>
          <div class="trash-actions">
            <button class="btn btn-ghost btn-sm" onclick="restoreItem('${escHtml(c.id)}','comment')" style="font-size:10.5px;color:#22c55e;border-color:rgba(34,197,94,.3)">
              ♻ Restore
            </button>
            <button class="btn btn-ghost btn-sm" onclick="hardDeleteItem('${escHtml(c.id)}','comment','this comment')" style="font-size:10.5px;color:#ef4444;border-color:rgba(239,68,68,.3)">
              ✕ Delete
            </button>
          </div>
        </td>
      </tr>`).join('');
  }

  // ── Tab switch ─────────────────────────────────────────
  function switchTab(tab) {
    _activeTab = tab;
    ['posts','comments'].forEach(t => {
      document.getElementById(`tab-${t}`).classList.toggle('active', t === tab);
      document.getElementById(`pane-${t}`).style.display = t === tab ? '' : 'none';
    });
  }

  // ── Restore ────────────────────────────────────────────
  async function restoreItem(id, type) {
    const res = await API.board.restore(id, type);
    if (!res?.ok) { Toast.error(res?.data?.message || 'กู้คืนไม่ได้'); return; }
    Toast.success('กู้คืนแล้ว ✓');
    loadTrash();
  }

  // ── Hard delete ────────────────────────────────────────
  async function hardDeleteItem(id, type, label) {
    const ok = await confirmDialog(`ลบถาวร "${label}" ใช่มั้ย?\nการลบนี้ไม่สามารถย้อนกลับได้`);
    if (!ok) return;
    const res = await API.board.hardDelete(id, type);
    if (!res?.ok) { Toast.error(res?.data?.message || 'ลบไม่ได้'); return; }
    Toast.success('ลบถาวรแล้ว');
    loadTrash();
  }

  // ── Purge expired ──────────────────────────────────────
  async function confirmPurge() {
    const expired = [...(_trashData.posts||[]), ...(_trashData.comments||[])].filter(i => (i.days_left ?? 999) <= 0).length;
    if (expired === 0) { Toast.info('ไม่มีรายการที่หมดอายุ'); return; }
    const ok = await confirmDialog(`ลบถาวร ${expired} รายการที่หมดอายุใช่มั้ย?\nการลบนี้ไม่สามารถย้อนกลับได้`);
    if (!ok) return;
    const res = await API.board.purgeTrash();
    if (!res?.ok) { Toast.error(res?.data?.message || 'Purge ไม่ได้'); return; }
    Toast.success(`Purge แล้ว ${res.data.data?.purged || 0} รายการ`);
    loadTrash();
  }

  // ── Simple confirm dialog using native confirm (can be replaced with custom) ──
  function confirmDialog(msg) {
    return Promise.resolve(window.confirm(msg));
  }

  loadTrash();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "confirmDialog", { configurable: true, get: () => confirmDialog, set: (v) => { confirmDialog = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "confirmPurge", { configurable: true, get: () => confirmPurge, set: (v) => { confirmPurge = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "daysLeftBadge", { configurable: true, get: () => daysLeftBadge, set: (v) => { daysLeftBadge = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtDate", { configurable: true, get: () => fmtDate, set: (v) => { fmtDate = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "hardDeleteItem", { configurable: true, get: () => hardDeleteItem, set: (v) => { hardDeleteItem = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadTrash", { configurable: true, get: () => loadTrash, set: (v) => { loadTrash = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderCommentsTable", { configurable: true, get: () => renderCommentsTable, set: (v) => { renderCommentsTable = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderPostsTable", { configurable: true, get: () => renderPostsTable, set: (v) => { renderPostsTable = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderTrash", { configurable: true, get: () => renderTrash, set: (v) => { renderTrash = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "restoreItem", { configurable: true, get: () => restoreItem, set: (v) => { restoreItem = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "switchTab", { configurable: true, get: () => switchTab, set: (v) => { switchTab = v; } }); } catch (e) {}
})();
