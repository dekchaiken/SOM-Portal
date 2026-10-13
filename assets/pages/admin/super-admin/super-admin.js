// admin/super-admin — page script, extracted from admin/super-admin.html.
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

// ── Guard + Layout (synchronous — same pattern as all other admin pages) ──────
if (!Auth.requireAdmin()) { /* redirected if not admin/super_admin */ }
if (Auth.getUser()?.role !== 'super_admin') {
  window.location.href = './index.html';
}
Layout.render('super-admin');
Auth.initUserUI();

let _teams = [];

// Load on page start
document.addEventListener('DOMContentLoaded', () => loadAll());

async function loadAll() {
  await loadTeams();
}

// ── Dev Sub-teams (inside Edit modal, dev team only) ───────────────────────
let _subteams = [];

async function _fetchSubteams() {
  const res = await API.devSubteams.list();
  _subteams = (res?.ok && Array.isArray(res.data?.data)) ? res.data.data : [];
}

function _renderSubteamChips() {
  const chips = document.getElementById('edit-subteams-chips');
  const cnt   = document.getElementById('edit-subteams-count');
  if (cnt) cnt.textContent = _subteams.length;
  if (!chips) return;
  if (_subteams.length === 0) {
    chips.innerHTML = '<span style="color:var(--text-muted);font-size:12px">ยังไม่มี sub-team</span>';
    return;
  }
  chips.innerHTML = _subteams.map(s => `
    <span style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px 4px 12px;
                 background:color-mix(in srgb,#8b5cf6 8%,transparent);
                 border:1px solid color-mix(in srgb,#8b5cf6 22%,transparent);
                 border-radius:999px;font-size:12px;font-weight:600;color:#7c3aed;white-space:nowrap">
      ${escHtml(s)}
      <button onclick="editRemoveSubteam('${escHtml(s).replace(/'/g,"\\'")}') " title="ลบ"
              style="background:none;border:none;cursor:pointer;color:#a78bfa;font-size:14px;line-height:1;padding:0;margin-left:1px"
              onmouseover="this.style.color='#ef4444'" onmouseout="this.style.color='#a78bfa'">×</button>
    </span>`).join('');
  if (typeof window.Icons !== 'undefined') window.Icons.replace?.();
}

async function editAddSubteam() {
  const inp  = document.getElementById('edit-new-subteam');
  const name = inp.value.trim();
  if (!name) { inp.focus(); return; }
  const res = await API.devSubteams.add(name);
  if (res?.ok) {
    inp.value = '';
    _subteams = res.data?.data || _subteams;
    _renderSubteamChips();
    Toast.success(`เพิ่ม "${name}" แล้ว`);
  } else {
    Toast.error(res?.data?.message || 'ไม่สามารถเพิ่มได้');
  }
}

async function editRemoveSubteam(name) {
  const ok = await SOMDialog.confirm(`ลบ sub-team "${name}" ออก?`, { title: 'ยืนยัน', okLabel: 'ลบ', icon: 'warning', okColor: 'danger' });
  if (!ok) return;
  const res = await API.devSubteams.remove(name);
  if (res?.ok) {
    _subteams = res.data?.data || _subteams;
    _renderSubteamChips();
    Toast.success(`ลบ "${name}" แล้ว`);
  } else {
    Toast.error(res?.data?.message || 'ไม่สามารถลบได้');
  }
}

// ── Load teams from API ────────────────────────────────────────────────────
async function loadTeams() {
  const grid = document.getElementById('teams-grid');
  grid.innerHTML = '<div style="color:var(--text-muted);padding:20px;">Loading...</div>';
  const res = await API.teams.list();
  if (!res?.ok) { Toast.error('Failed to load teams'); return; }
  _teams = res.data?.data || res.data || [];
  renderTeams();
}

// ── Count users per team ───────────────────────────────────────────────────
async function getTeamUserCounts() {
  const res = await API.users.list(); // super_admin gets all users
  if (!res?.ok) return {};
  const users = res.data?.data || [];
  const counts = {};
  users.forEach(u => { counts[u.team] = (counts[u.team] || 0) + 1; });
  return counts;
}

// ── Render teams grid ──────────────────────────────────────────────────────
async function renderTeams() {
  const grid   = document.getElementById('teams-grid');
  const cntEl  = document.getElementById('teams-count');
  const counts = await getTeamUserCounts();

  if (cntEl) cntEl.textContent = _teams.length;

  if (!_teams.length) {
    grid.innerHTML = '<div class="sa-empty">No teams yet — create one above to get started.</div>';
    return;
  }

  grid.innerHTML = _teams.map(t => {
    const userCount = counts[t.slug] || 0;
    const featCount = (t.features || []).length;
    const isActive  = t.active !== false;
    const color     = t.color || '#6366F1';
    const featList  = (t.features || []).slice(0, 8).join(' · ') || 'none';
    return `
      <div class="team-card ${isActive ? '' : 'inactive'}" style="--team-color:${color}">
        <div class="team-card-top">
          <div class="team-ident">
            <span class="team-dot" style="background:${color}"></span>
            <div class="team-ident-body">
              <div class="team-name">${escHtml(t.name)}</div>
              <div class="team-slug">/${escHtml(t.slug)}</div>
            </div>
          </div>
          <span class="team-status ${isActive ? 'on' : 'off'}">${isActive ? 'Active' : 'Paused'}</span>
        </div>

        ${t.description ? `<div class="team-desc">${escHtml(t.description)}</div>` : ''}

        <div class="team-stats-row">
          <div class="team-stat"><span class="team-stat-v">${userCount}</span><span class="team-stat-l">Users</span></div>
          <div class="team-stat"><span class="team-stat-v">${featCount}</span><span class="team-stat-l">Features</span></div>
        </div>

        <div class="team-features" title="${escHtml((t.features||[]).join(', '))}">${escHtml(featList)}</div>

        <div class="team-actions">
          <a href="users.html?team=${escHtml(t.slug)}" class="team-btn primary">Manage users →</a>
          <button class="team-btn" onclick="openEditModal('${t.id}')">Edit</button>
          ${isActive
            ? `<button class="team-btn warn" onclick="deactivateTeam('${t.id}','${escHtml(t.name)}')">Pause</button>`
            : `<button class="team-btn" onclick="reactivateTeam('${t.id}')">Reactivate</button>`
          }
          <button class="team-btn danger" onclick="deleteTeam('${t.id}','${escHtml(t.name)}','${escHtml(t.slug)}')">Delete</button>
        </div>
      </div>`;
  }).join('');
}

// ── Create-team collapsible panel ─────────────────────────────────────────
function toggleCreatePanel() {
  const bar = document.getElementById('create-toggle');
  const pan = document.getElementById('create-panel');
  const open = pan.classList.toggle('open');
  bar.classList.toggle('open', open);
  if (open) setTimeout(() => document.getElementById('new-slug')?.focus(), 200);
}

// ── Create team ────────────────────────────────────────────────────────────
async function createTeam() {
  const slug  = document.getElementById('new-slug').value.trim().toLowerCase();
  const name  = document.getElementById('new-name').value.trim();
  const desc  = document.getElementById('new-desc').value.trim();
  const color = document.getElementById('new-color').value;

  if (!slug) { Toast.error('Slug is required'); return; }
  if (!name) { Toast.error('Name is required'); return; }
  if (!/^[a-z0-9_-]+$/.test(slug)) { Toast.error('Slug must be lowercase alphanumeric, dashes, or underscores only'); return; }

  const btn = document.getElementById('create-btn');
  btn.disabled = true; btn.textContent = 'Creating...';

  const res = await API.teams.create({ slug, name, description: desc, color });
  btn.disabled = false; btn.innerHTML = '<i data-icon="plus"></i> Create Team';

  if (res?.ok) {
    Toast.success(`Team "${name}" created!`);
    document.getElementById('new-slug').value = '';
    document.getElementById('new-name').value = '';
    document.getElementById('new-desc').value = '';
    await loadTeams();
  } else {
    Toast.error(res?.data?.message || 'Failed to create team');
  }
}

// ── Edit modal ─────────────────────────────────────────────────────────────
async function openEditModal(teamId) {
  const t = _teams.find(x => x.id === teamId);
  if (!t) return;
  document.getElementById('edit-team-id').value   = t.id;
  document.getElementById('edit-team-slug').value = t.slug || '';
  document.getElementById('edit-name').value      = t.name;
  document.getElementById('edit-desc').value      = t.description || '';
  document.getElementById('edit-color').value     = t.color || '#6366F1';

  const isDevTeam = t.slug === 'dev';
  const subSection = document.getElementById('edit-subteams-section');
  const modalInner = document.getElementById('edit-modal-inner');
  const modalTitle = document.getElementById('edit-modal-title');

  if (isDevTeam) {
    subSection.style.display = 'block';
    modalInner.style.maxWidth = '560px';
    modalTitle.innerHTML = '<i data-icon="pencil"></i> Edit Team — <span style="color:#7c3aed">Dev</span>';
    // Load sub-teams fresh each time
    _renderSubteamChips(); // show loading state immediately
    await _fetchSubteams();
    _renderSubteamChips();
  } else {
    subSection.style.display = 'none';
    modalInner.style.maxWidth = '480px';
    modalTitle.innerHTML = '<i data-icon="pencil"></i> Edit Team';
  }

  document.getElementById('edit-modal').classList.add('open');
  if (typeof window.Icons !== 'undefined') window.Icons.replace?.();
}
function closeEditModal() {
  document.getElementById('edit-modal').classList.remove('open');
}
// Close modal on overlay click
document.getElementById('edit-modal')?.addEventListener('click', e => {
  if (e.target.id === 'edit-modal') closeEditModal();
});
async function saveEdit() {
  const id    = document.getElementById('edit-team-id').value;
  const name  = document.getElementById('edit-name').value.trim();
  const desc  = document.getElementById('edit-desc').value.trim();
  const color = document.getElementById('edit-color').value;
  if (!name) { Toast.error('Name required'); return; }
  const res = await API.teams.update(id, { name, description: desc, color });
  if (res?.ok) { Toast.success('Team updated'); closeEditModal(); loadTeams(); }
  else Toast.error(res?.data?.message || 'Failed');
}

// ── Deactivate ─────────────────────────────────────────────────────────────
async function deactivateTeam(id, name) {
  if (!await SOMDialog.confirm(`Pause team "${name}"? Users can still log in but team will be marked inactive.`, { title: 'ยืนยัน', okLabel: 'Pause', icon: 'warning', okColor: 'warning' })) return;
  const res = await API.teams.deactivate(id);
  if (res?.ok) { Toast.success('Team paused', 'success'); loadTeams(); }
  else Toast.error(res?.data?.message || 'Failed');
}
async function deleteTeam(id, name, slug) {
  if (slug === 'sm') { Toast.error('Cannot delete the primary SM team'); return; }
  if (!await SOMDialog.confirm(`PERMANENTLY DELETE team "${name}" (${slug})?\n\nThis removes the team from the registry. Data files in data/${slug}/ are NOT deleted.`, { title: 'ลบทีมถาวร', okLabel: 'ลบถาวร', icon: 'danger', okColor: 'danger' })) return;
  const res = await API.teams.hardDelete(id);
  if (res?.ok) { Toast.success(`Team "${name}" deleted`); loadTeams(); }
  else Toast.error(res?.data?.message || 'Failed');
}
async function reactivateTeam(id) {
  const res = await API.teams.update(id, { active: true });
  if (res?.ok) { Toast.success('Team reactivated'); loadTeams(); }
  else Toast.error(res?.data?.message || 'Failed');
}

// ── Helpers ────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "_fetchSubteams", { configurable: true, get: () => _fetchSubteams, set: (v) => { _fetchSubteams = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "_renderSubteamChips", { configurable: true, get: () => _renderSubteamChips, set: (v) => { _renderSubteamChips = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeEditModal", { configurable: true, get: () => closeEditModal, set: (v) => { closeEditModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "createTeam", { configurable: true, get: () => createTeam, set: (v) => { createTeam = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "deactivateTeam", { configurable: true, get: () => deactivateTeam, set: (v) => { deactivateTeam = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "deleteTeam", { configurable: true, get: () => deleteTeam, set: (v) => { deleteTeam = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "editAddSubteam", { configurable: true, get: () => editAddSubteam, set: (v) => { editAddSubteam = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "editRemoveSubteam", { configurable: true, get: () => editRemoveSubteam, set: (v) => { editRemoveSubteam = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "escHtml", { configurable: true, get: () => escHtml, set: (v) => { escHtml = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "getTeamUserCounts", { configurable: true, get: () => getTeamUserCounts, set: (v) => { getTeamUserCounts = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadAll", { configurable: true, get: () => loadAll, set: (v) => { loadAll = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadTeams", { configurable: true, get: () => loadTeams, set: (v) => { loadTeams = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openEditModal", { configurable: true, get: () => openEditModal, set: (v) => { openEditModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "reactivateTeam", { configurable: true, get: () => reactivateTeam, set: (v) => { reactivateTeam = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderTeams", { configurable: true, get: () => renderTeams, set: (v) => { renderTeams = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "saveEdit", { configurable: true, get: () => saveEdit, set: (v) => { saveEdit = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toggleCreatePanel", { configurable: true, get: () => toggleCreatePanel, set: (v) => { toggleCreatePanel = v; } }); } catch (e) {}
})();
