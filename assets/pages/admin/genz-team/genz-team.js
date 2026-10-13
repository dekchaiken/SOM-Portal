// admin/genz-team — page script, extracted from admin/genz-team.html.
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
Layout.render('admin-genz-team');

// SM-only + sm_admin-only guard (defense-in-depth; API also enforces).
(function guard() {
  const u = Auth.getUser();
  if (!u) return;
  if (u.team !== 'sm' || !['sm_admin', 'dev_sm'].includes(u.role)) {
    document.querySelector('.page-content').innerHTML =
      '<div style="padding:40px;text-align:center;color:#ef4444;font-weight:700">Forbidden — GenZ Team ใช้ได้เฉพาะ sm_admin / dev_sm ในทีม SM</div>';
    throw new Error('forbidden');
  }
})();

let _users = [];
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const initials = n => (n || '?').split(/\s+/).filter(Boolean).slice(0,2).map(w => w[0].toUpperCase()).join('');

async function loadAll() {
  const r = await API.genzTeam.list();
  _users = r?.ok ? (r.data.data || []) : [];
  document.getElementById('stat-total').textContent = _users.length;
  document.getElementById('stat-genz').textContent  = _users.filter(u => u.is_genz).length;
  renderList();
}

function renderList() {
  const q = (document.getElementById('gz-q').value || '').trim().toLowerCase();
  const list = _users.filter(u => !q
    || (u.name || '').toLowerCase().includes(q)
    || (u.username || '').toLowerCase().includes(q)
    || (u.nickname || '').toLowerCase().includes(q));
  const el = document.getElementById('gz-list');
  if (!list.length) { el.innerHTML = '<div class="gz-empty">ไม่พบสมาชิก</div>'; return; }
  el.innerHTML = list.map(u => `
    <div class="gz-row" data-id="${esc(u.id)}">
      <div class="gz-avatar">${u.avatar_url ? `<img src="${esc(u.avatar_url)}" alt="">` : esc(initials(u.name))}</div>
      <div class="gz-info">
        <div class="gz-name">${esc(u.name)}${u.is_genz ? ' <span class="gz-badge">GenZ</span>' : ''}</div>
        <div class="gz-sub">@${esc(u.username)} · ${esc(u.role)}${u.nickname ? ' · ' + esc(u.nickname) : ''}</div>
      </div>
      <label class="gz-switch" title="${u.is_genz ? 'อยู่ใน GenZ Team' : 'ยังไม่ได้เป็น GenZ'}">
        <input type="checkbox" ${u.is_genz ? 'checked' : ''} onchange="toggleUser('${esc(u.id)}', this)">
        <span class="gz-slider"></span>
      </label>
    </div>`).join('');
}

async function toggleUser(id, cb) {
  cb.disabled = true;
  const next = cb.checked;
  const r = await API.genzTeam.toggle(id, next);
  cb.disabled = false;
  if (!r?.ok) {
    cb.checked = !next;
    Utils.toast?.(r?.data?.message || 'อัปเดตไม่สำเร็จ', 'error');
    return;
  }
  const u = _users.find(x => x.id === id);
  if (u) u.is_genz = next;
  document.getElementById('stat-genz').textContent = _users.filter(x => x.is_genz).length;
  Utils.toast?.(next ? 'เพิ่มเข้า GenZ Team แล้ว' : 'ถอดออกจาก GenZ Team แล้ว', 'success');
  // Update the row's badge without a full re-render.
  const row = document.querySelector(`.gz-row[data-id="${CSS.escape(id)}"] .gz-name`);
  if (row && u) row.innerHTML = esc(u.name) + (next ? ' <span class="gz-badge">GenZ</span>' : '');
}

loadAll();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "loadAll", { configurable: true, get: () => loadAll, set: (v) => { loadAll = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderList", { configurable: true, get: () => renderList, set: (v) => { renderList = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toggleUser", { configurable: true, get: () => toggleUser, set: (v) => { toggleUser = v; } }); } catch (e) {}
})();
