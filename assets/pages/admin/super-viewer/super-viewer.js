// admin/super-viewer — page script, extracted from admin/super-viewer.html.
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

// ── Guard: super_admin only ────────────────────────────────────────────────
if (!Auth.requireAdmin()) { /* redirected */ }
if (Auth.getUser()?.role !== 'super_admin') {
  window.location.href = './index.html';
}
Layout.render('super-viewer');
Auth.initUserUI();

let _data = { stats: {}, users: [], audit: [], rules: {} };

document.addEventListener('DOMContentLoaded', loadAll);

async function loadAll() {
  try {
    const res = await API.get('/super-viewer/');
    if (!res?.ok) throw new Error(res?.data?.message || 'Failed to load');
    _data = res.data?.data || res.data || {};
    renderStats();
    renderUsers();
    renderRules();
    populateAuditUserFilter();
    renderAudit();
  } catch (e) {
    Toast?.error?.('Failed to load: ' + (e.message || e));
  }
}

// ── Stats ─────────────────────────────────────────────────────────────────
function renderStats() {
  const s = _data.stats || {};
  document.getElementById('stat-users').textContent   = s.total_users ?? 0;
  document.getElementById('stat-blocked').textContent = s.blocked_events_24h ?? 0;
  document.getElementById('stat-denied').textContent  = s.denied_events_24h ?? 0;
  document.getElementById('stat-last').textContent    = s.last_created_at
    ? new Date(s.last_created_at).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })
    : '—';
}

// ── Users ─────────────────────────────────────────────────────────────────
function renderUsers() {
  const users = _data.users || [];
  document.getElementById('users-cnt').textContent = users.length;
  const body = document.getElementById('users-body');
  if (!users.length) {
    body.innerHTML = `
      <div class="sv-empty">
        <div class="sv-empty-mark"><i data-icon="eye"></i></div>
        <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:4px">ยังไม่มี Super Viewer</div>
        <div style="font-size:11.5px">กด "+ Create Super Viewer" ด้านบนเพื่อสร้าง account ให้หัวหน้า</div>
      </div>`;
    return;
  }
  body.innerHTML = `
    <table class="sv-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Email</th>
          <th>Created</th>
          <th>Status</th>
          <th style="text-align:right">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${users.map(u => {
          const created = u.created_at ? new Date(u.created_at).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }) : '—';
          const status = u.must_reset_password ? '<span style="color:#dc2626;font-weight:600;font-size:10.5px">Reset required</span>'
                       : u.first_login          ? '<span style="color:#f97316;font-weight:600;font-size:10.5px">First login pending</span>'
                       : '<span style="color:#16a34a;font-weight:600;font-size:10.5px">Active</span>';
          return `
          <tr>
            <td>
              <div class="sv-user-name">${escHtml(u.name || u.username)}</div>
              <div class="sv-user-username">@${escHtml(u.username)}</div>
            </td>
            <td style="font-size:11px;color:var(--text-muted)">${escHtml(u.email || '—')}</td>
            <td style="font-family:monospace;font-size:10.5px;color:var(--text-muted)">${created}</td>
            <td>${status}</td>
            <td>
              <div class="sv-actions" style="justify-content:flex-end">
                <button class="btn btn-outline btn-sm" onclick="resetPw('${escHtml(u.id)}','${escHtml(u.name || u.username)}')">Reset PW</button>
                <button class="btn btn-outline btn-sm" style="color:#dc2626" onclick="deleteUser('${escHtml(u.id)}','${escHtml(u.name || u.username)}')">Delete</button>
              </div>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

// ── Rules ─────────────────────────────────────────────────────────────────
function renderRules() {
  const r = _data.rules || {};
  const el = document.getElementById('rules-grid');

  const card = (title, badge, badgeCls, items, renderItem) => `
    <div class="sv-rule-card">
      <div class="sv-rule-head">
        ${title}
        <span class="sv-rule-badge ${badgeCls}">${badge}</span>
      </div>
      ${items.length
        ? `<ul class="sv-rule-list">${items.map(renderItem).join('')}</ul>`
        : `<div style="font-size:11px;color:var(--text-muted);padding:4px">— none —</div>`}
    </div>`;

  el.innerHTML = [
    card('<i data-icon="ban"></i> Sidebar items hidden', 'HIDE', 'block',
      r.sidebar_hidden || [],
      i => `<li class="sv-rule-item"><span class="sv-rule-key">${escHtml(i.label)}</span><span class="sv-rule-reason">${escHtml(i.reason || '')}</span></li>`
    ),
    card('<i data-icon="lock"></i> Pages bounced (direct URL)', 'REDIRECT', 'block',
      r.pages_bounced || [],
      i => `<li class="sv-rule-item"><span class="sv-rule-key">${escHtml(i.path)} → ${escHtml(i.redirect_to)}</span><span class="sv-rule-reason">${escHtml(i.reason || '')}</span></li>`
    ),
    card('<i data-icon="ban"></i> API endpoints denied', 'DENY', 'block',
      r.api_denied || [],
      i => `<li class="sv-rule-item"><span class="sv-rule-key">${escHtml(i.prefix || i.path)}</span><span class="sv-rule-reason">${escHtml(i.reason || '')}</span></li>`
    ),
    card('<i data-icon="check-circle"></i> Writes whitelisted (own state only)', 'ALLOW', 'allow',
      r.writes_whitelisted || [],
      i => `<li class="sv-rule-item"><span class="sv-rule-key">${escHtml(i.path)}</span><span class="sv-rule-reason">${escHtml(i.reason || '')}</span></li>`
    ),
    card('<i data-icon="sparkles"></i> Special behavior', 'INFO', 'info',
      r.special_behavior || [],
      i => `<li class="sv-rule-item" style="flex-direction:column;align-items:flex-start;gap:2px"><span class="sv-rule-key">${escHtml(i.name)}</span><span class="sv-rule-reason" style="text-align:left">${escHtml(i.desc || '')} <em style="color:var(--text-muted);font-size:10px">— ${escHtml(i.where || '')}</em></span></li>`
    ),
    card('<i data-icon="bar-chart"></i> Read-only reports (OVERSIGHT sidebar)', 'READ', 'info',
      r.read_only_reports || [],
      i => `<li class="sv-rule-item" style="flex-direction:column;align-items:flex-start;gap:2px"><span class="sv-rule-key">${escHtml(i.path)}</span><span class="sv-rule-reason" style="text-align:left">${escHtml(i.reason || '')} <em style="color:var(--text-muted);font-size:10px">— ${escHtml(i.apis || '')}</em></span></li>`
    ),
  ].join('');
}

// ── Audit ─────────────────────────────────────────────────────────────────
function populateAuditUserFilter() {
  const audit = _data.audit || [];
  const users = [...new Set(audit.map(a => a.user_name).filter(Boolean))].sort();
  const sel = document.getElementById('audit-filter-user');
  sel.innerHTML = '<option value="">All users</option>'
    + users.map(u => `<option value="${escHtml(u)}">${escHtml(u)}</option>`).join('');
}

function renderAudit() {
  let items = _data.audit || [];
  const eFilter = document.getElementById('audit-filter-event').value;
  const uFilter = document.getElementById('audit-filter-user').value;
  if (eFilter) items = items.filter(a => a.event === eFilter);
  if (uFilter) items = items.filter(a => a.user_name === uFilter);

  document.getElementById('audit-cnt').textContent = items.length;
  const body = document.getElementById('audit-body');

  if (!items.length) {
    body.innerHTML = `<div class="sv-empty-tbl">
      <div style="font-size:22px;opacity:.5;margin-bottom:6px"><i data-icon="check"></i></div>
      <div>ยังไม่มี event ที่ตรงกับ filter — super_viewer(s) ยังไม่ได้พยายามทำอะไรที่ถูก block</div>
    </div>`;
    return;
  }

  body.innerHTML = `
    <table class="sv-table">
      <thead>
        <tr>
          <th>When</th>
          <th>Event</th>
          <th>User</th>
          <th>Path</th>
          <th>Detail</th>
        </tr>
      </thead>
      <tbody>
        ${items.map(a => {
          const ts = a.ts ? new Date(a.ts).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '—';
          const pill = a.event === 'super_viewer_write_blocked'
            ? '<span class="sv-event-pill write">WRITE BLOCKED</span>'
            : '<span class="sv-event-pill access">ACCESS DENIED</span>';
          const method = a.detail?.method ? `<span style="font-family:monospace;font-size:10px;color:var(--text-muted);margin-right:6px">${escHtml(a.detail.method)}</span>` : '';
          const resource = a.detail?.resource ? `<span style="font-size:10.5px;color:var(--text-muted)">${escHtml(a.detail.resource)}</span>` : '';
          return `
          <tr>
            <td class="sv-ts">${ts}</td>
            <td>${pill}</td>
            <td>
              <div style="font-weight:600;font-size:11.5px">${escHtml(a.user_name || '—')}</div>
              <div style="font-size:10px;color:var(--text-muted);font-family:monospace">${escHtml(a.ip || '')}</div>
            </td>
            <td>${method}<span class="sv-path">${escHtml(a.path || '')}</span></td>
            <td>${resource}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

// ── Actions ───────────────────────────────────────────────────────────────
function openCreate() {
  // Delegate to admin/users.html — its Create form already handles super_viewer role
  window.location.href = './users.html?create=1&role=super_viewer';
}

async function resetPw(id, name) {
  if (!confirm(`Reset password for "${name}"? A new temp password will be emailed.`)) return;
  const res = await API.patch(`/users/?id=${encodeURIComponent(id)}`, {});
  if (res?.ok) {
    Toast?.success?.(`Reset link sent to ${name}`);
    loadAll();
  } else {
    Toast?.error?.(res?.data?.message || 'Reset failed');
  }
}

async function deleteUser(id, name) {
  if (!confirm(`Delete super_viewer "${name}"? This cannot be undone.`)) return;
  const res = await API.delete(`/users/?id=${encodeURIComponent(id)}`);
  if (res?.ok) {
    Toast?.success?.(`Deleted ${name}`);
    loadAll();
  } else {
    Toast?.error?.(res?.data?.message || 'Delete failed');
  }
}

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "deleteUser", { configurable: true, get: () => deleteUser, set: (v) => { deleteUser = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openCreate", { configurable: true, get: () => openCreate, set: (v) => { openCreate = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "populateAuditUserFilter", { configurable: true, get: () => populateAuditUserFilter, set: (v) => { populateAuditUserFilter = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderAudit", { configurable: true, get: () => renderAudit, set: (v) => { renderAudit = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderRules", { configurable: true, get: () => renderRules, set: (v) => { renderRules = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "resetPw", { configurable: true, get: () => resetPw, set: (v) => { resetPw = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadAll", { configurable: true, get: () => loadAll, set: (v) => { loadAll = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderStats", { configurable: true, get: () => renderStats, set: (v) => { renderStats = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderUsers", { configurable: true, get: () => renderUsers, set: (v) => { renderUsers = v; } }); } catch (e) {}
})();
