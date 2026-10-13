// admin/ma-test-plans — page script, extracted from admin/ma-test-plans.html.
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
const _u = Auth.getUser();
if (!_u || !['super_admin','sm_admin','sm_lead','dev_sm'].includes(_u.role)) {
  Toast?.error?.('Admin/Lead only');
  setTimeout(() => location.replace('../dashboard.html'), 800);
}
if (_u && _u.team && _u.team !== 'sm' && !['super_admin','super_viewer'].includes(_u.role)) {
  Toast?.error?.('SM team only');
  setTimeout(() => location.replace('../dashboard.html'), 800);
}
Layout.render('admin');

// ── State ────────────────────────────────────────────────────
let catalog = [];
let plan = [];
let results = [];
let selected = new Set();

document.getElementById('month').value = MaTest.currentMonth();

MaTest.SERVICES.forEach(s => document.getElementById('f-service').insertAdjacentHTML('beforeend', `<option value="${s}">${s}</option>`));
MaTest.TOOLS   .forEach(t => document.getElementById('f-tool')   .insertAdjacentHTML('beforeend', `<option value="${t}">${t}</option>`));

async function loadAll() {
  const month = document.getElementById('month').value;
  const [catRes, planRes, resRes] = await Promise.all([
    MaTest.api.listCatalog({ active: 1 }),
    MaTest.api.listPlan(month),
    MaTest.api.listResults(month),
  ]);
  if (catRes?.success)  catalog = catRes.data.items || [];
  if (planRes?.success) plan    = planRes.data.items || [];
  if (resRes?.success)  results = resRes.data.items || [];
  renderPicker();
  renderPlan();
}

function filterCatalog() {
  const q = document.getElementById('q').value.trim().toLowerCase();
  const s = document.getElementById('f-service').value;
  const t = document.getElementById('f-tool').value;
  return catalog.filter(it => {
    if (s && it.service !== s) return false;
    if (t && it.tool    !== t) return false;
    if (q) {
      const hay = (it.name + ' ' + (it.remark || '') + ' ' + (it.service || '')).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderPicker() {
  const list = filterCatalog();
  const plannedIds = new Set(plan.map(p => p.catalog_id));
  const esc = MaTest.escapeHtml;
  const html = list.map(it => {
    const isPlanned = plannedIds.has(it.id);
    const sel = selected.has(it.id);
    return `
      <div class="mt-picker-item ${isPlanned ? 'disabled' : ''} ${sel ? 'selected' : ''}" data-id="${esc(it.id)}">
        <input type="checkbox" ${sel ? 'checked' : ''} ${isPlanned ? 'disabled' : ''}>
        <div class="info">
          <div class="n">${esc(it.name)} ${isPlanned ? '<span class="badge badge-gray" style="margin-left:6px">In plan</span>' : ''}</div>
          <div class="r">${esc(it.service)} · ${esc(it.tool || '—')}${it.remark ? ' · ' + esc(it.remark) : ''}</div>
        </div>
        ${MaTest.priorityBadge(it.priority)}
      </div>`;
  }).join('');
  document.getElementById('picker').innerHTML = html || `<div class="mt-empty">ไม่พบรายการที่ค้น</div>`;
  document.getElementById('picker').querySelectorAll('.mt-picker-item:not(.disabled)').forEach(el => {
    el.onclick = () => {
      const id = el.dataset.id;
      if (selected.has(id)) selected.delete(id); else selected.add(id);
      renderPicker();
      document.getElementById('btn-add').disabled = selected.size === 0;
    };
  });
}

function renderPlan() {
  const month = document.getElementById('month').value;
  document.getElementById('plan-title').textContent = month;
  document.getElementById('plan-count').textContent = plan.length + ' item' + (plan.length === 1 ? '' : 's');
  const wrap = document.getElementById('plan-list');
  const esc = MaTest.escapeHtml;
  if (!plan.length) {
    wrap.innerHTML = `
      <div class="mt-empty">
        <h4>ยังไม่มีอะไรใน plan</h4>
        <p>เลือกจาก catalog ทางซ้าย แล้วกด <b>+ Add selected</b></p>
      </div>`;
    return;
  }

  // Catalog IDs that already have at least one Successed result this month.
  const doneCatIds = new Set(
    results.filter(r => r.result === 'Successed').map(r => String(r.catalog_id))
  );

  // Newest additions on top (added_at desc; fallback to id compare for stability).
  const sorted = [...plan].sort((a, b) => {
    const t = String(b.added_at || '').localeCompare(String(a.added_at || ''));
    return t !== 0 ? t : String(b.id || '').localeCompare(String(a.id || ''));
  });

  const active = sorted.filter(p => !doneCatIds.has(String(p.catalog_id)));
  const done   = sorted.filter(p =>  doneCatIds.has(String(p.catalog_id)));

  const renderRow = (p) => {
    const c = p.catalog || {};
    return `
      <tr>
        <td>
          <div style="font-weight:700; color:var(--text); font-size:12.5px">${esc(c.name || '(missing)')}</div>
          ${c.remark ? `<div style="font-size:10.5px; color:var(--text-muted); margin-top:2px">${esc(c.remark)}</div>` : ''}
        </td>
        <td>${MaTest.serviceBadge(c.service)}</td>
        <td>${MaTest.toolBadge(c.tool)}</td>
        <td style="font-size:11px; color:var(--text-muted)">${esc(p.added_by || '')}</td>
        <td style="text-align:right; white-space:nowrap">
          <button class="btn btn-danger btn-sm" data-rm="${esc(p.id)}">Remove</button>
        </td>
      </tr>`;
  };

  const activeSection = active.length ? `
    <div style="overflow-x:auto">
      <table class="mt-plan-table">
        <thead><tr><th>Name</th><th>Service</th><th>Tool</th><th>Added by</th><th></th></tr></thead>
        <tbody>${active.map(renderRow).join('')}</tbody>
      </table>
    </div>` : `
    <div class="mt-empty" style="padding:28px">
      <h4>ทุกอันเทสสำเร็จหมดแล้ว <i data-icon="sparkles"></i></h4>
      <p>รายการที่ผ่านแล้วอยู่ด้านล่าง (Completed)</p>
    </div>`;

  const doneSection = done.length ? `
    <details style="border-top:1px solid var(--border)">
      <summary style="padding:10px 14px; cursor:pointer; font-size:11.5px; font-weight:700; color:var(--text-muted); user-select:none; list-style:none; display:flex; align-items:center; gap:8px">
        <span style="display:inline-block; width:16px; text-align:center">▸</span>
        <span><i data-icon="check"></i> Completed (${done.length}) — click to expand</span>
      </summary>
      <div style="overflow-x:auto; opacity:.78">
        <table class="mt-plan-table">
          <thead><tr><th>Name</th><th>Service</th><th>Tool</th><th>Added by</th><th></th></tr></thead>
          <tbody>${done.map(renderRow).join('')}</tbody>
        </table>
      </div>
    </details>
    <style>#plan-list details[open] > summary > span:first-child { transform:rotate(90deg); }</style>` : '';

  wrap.innerHTML = activeSection + doneSection;
  wrap.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => onRemove(b.dataset.rm));
}

async function onAdd() {
  const ids = Array.from(selected);
  if (!ids.length) return;
  const month = document.getElementById('month').value;
  const res = await MaTest.api.addPlan(month, ids);
  if (!res?.success) { Toast?.error?.(res?.message || 'Add failed'); return; }
  Toast?.success?.(res.message || 'Added');
  selected.clear();
  document.getElementById('btn-add').disabled = true;
  await loadAll();
}

async function onRemove(id) {
  if (!confirm('Remove this item from the plan?')) return;
  const res = await MaTest.api.removePlan(document.getElementById('month').value, id);
  if (!res?.success) { Toast?.error?.(res?.message || 'Remove failed'); return; }
  Toast?.success?.('Removed');
  await loadAll();
}

document.getElementById('btn-add').onclick = onAdd;
document.getElementById('month').onchange  = () => { selected.clear(); loadAll(); };
let _sT;
document.getElementById('q').addEventListener('input', () => { clearTimeout(_sT); _sT = setTimeout(renderPicker, 200); });
['f-service','f-tool'].forEach(id => document.getElementById(id).onchange = renderPicker);

// ── Webhook admin ────────────────────────────────────────────
let webhooks = [];

async function loadWebhooks() {
  const r = await MaTest.api.listWebhooks();
  webhooks = r?.success ? (r.data?.webhooks || []) : [];
  renderWebhooks();
}

function renderWebhooks() {
  const wrap = document.getElementById('wh-list');
  const esc = MaTest.escapeHtml;
  if (!webhooks.length) {
    wrap.innerHTML = `<div class="mt-wh-empty">ยังไม่มี webhook — เพิ่มด้านล่างเพื่อเปิดใช้ปุ่ม Send to Google Chat</div>`;
    return;
  }
  wrap.innerHTML = webhooks.map(w => `
    <div class="mt-wh-row" data-id="${esc(w.id)}">
      <input type="text" class="form-control wh-name" value="${esc(w.name)}" placeholder="ชื่อห้อง">
      <input type="url"  class="form-control wh-url"  value="${esc(w.url || '')}" placeholder="https://chat.googleapis.com/…">
      <div style="display:flex; gap:6px">
        <button class="btn btn-primary btn-sm wh-save">Save</button>
        <button class="btn btn-danger  btn-sm wh-rm">Remove</button>
      </div>
    </div>
  `).join('');
  wrap.querySelectorAll('.mt-wh-row').forEach(row => {
    const id = row.dataset.id;
    row.querySelector('.wh-save').onclick = () => onSaveWebhook(id, row);
    row.querySelector('.wh-rm').onclick   = () => onRemoveWebhook(id, row);
  });
}

async function onAddWebhook() {
  const name = document.getElementById('wh-new-name').value.trim();
  const url  = document.getElementById('wh-new-url').value.trim();
  if (!name) { Toast?.error?.('ชื่อห้องห้ามว่าง'); return; }
  if (!/^https:\/\/chat\.googleapis\.com\//.test(url)) {
    Toast?.error?.('URL ต้องขึ้นต้นด้วย https://chat.googleapis.com/');
    return;
  }
  const r = await MaTest.api.addWebhook({ name, url });
  if (!r?.success) { Toast?.error?.(r?.message || 'Add failed'); return; }
  Toast?.success?.('Added');
  document.getElementById('wh-new-name').value = '';
  document.getElementById('wh-new-url').value  = '';
  await loadWebhooks();
}

async function onSaveWebhook(id, row) {
  const name = row.querySelector('.wh-name').value.trim();
  const url  = row.querySelector('.wh-url').value.trim();
  if (!name) { Toast?.error?.('ชื่อห้องห้ามว่าง'); return; }
  if (!/^https:\/\/chat\.googleapis\.com\//.test(url)) {
    Toast?.error?.('URL ต้องขึ้นต้นด้วย https://chat.googleapis.com/');
    return;
  }
  const r = await MaTest.api.updateWebhook(id, { name, url });
  if (!r?.success) { Toast?.error?.(r?.message || 'Save failed'); return; }
  Toast?.success?.('Saved');
  await loadWebhooks();
}

async function onRemoveWebhook(id, row) {
  const name = row.querySelector('.wh-name').value || id;
  const ok = await confirmDialog(
    `Remove webhook "${name}"?`,
    'ลบ webhook',
    { confirmText: 'Remove', cancelText: 'Cancel', variant: 'danger' }
  );
  if (!ok) return;
  const r = await MaTest.api.deleteWebhook(id);
  if (!r?.success) { Toast?.error?.(r?.message || 'Remove failed'); return; }
  Toast?.success?.('Removed');
  await loadWebhooks();
}

document.getElementById('btn-webhooks').onclick = () => {
  document.getElementById('modal-webhooks').classList.add('active');
  loadWebhooks();
};
document.getElementById('wh-add-btn').onclick = onAddWebhook;

// Close modal via [data-close] and overlay click (mirrors the existing pattern)
document.addEventListener('click', e => {
  if (e.target.matches('[data-close]') || e.target.classList.contains('modal-overlay')) {
    document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
});

loadAll();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "filterCatalog", { configurable: true, get: () => filterCatalog, set: (v) => { filterCatalog = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadAll", { configurable: true, get: () => loadAll, set: (v) => { loadAll = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadWebhooks", { configurable: true, get: () => loadWebhooks, set: (v) => { loadWebhooks = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "onAdd", { configurable: true, get: () => onAdd, set: (v) => { onAdd = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "onAddWebhook", { configurable: true, get: () => onAddWebhook, set: (v) => { onAddWebhook = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "onRemove", { configurable: true, get: () => onRemove, set: (v) => { onRemove = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "onRemoveWebhook", { configurable: true, get: () => onRemoveWebhook, set: (v) => { onRemoveWebhook = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "onSaveWebhook", { configurable: true, get: () => onSaveWebhook, set: (v) => { onSaveWebhook = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderPicker", { configurable: true, get: () => renderPicker, set: (v) => { renderPicker = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderPlan", { configurable: true, get: () => renderPlan, set: (v) => { renderPlan = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderWebhooks", { configurable: true, get: () => renderWebhooks, set: (v) => { renderWebhooks = v; } }); } catch (e) {}
})();
