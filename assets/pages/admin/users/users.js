// admin/users — page script, extracted from admin/users.html.
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

  const currentUser = Auth.getUser();
  const isSuperAdmin = currentUser?.role === 'super_admin';
  let allUsers = [];
  let filteredUsers = [];
  let selectedIds = new Set();
  let pwExpiryDays = 60;
  let currentView = 'table';
  let userColorsCache = {};
  let _activeTeamSlug = null; // team context for super_admin / dev-team switcher

  // Priority: URL ?team= param → API.getAdminTeam() context → null
  // For sm_admin: also allow ?team=dev to view the shared dev team
  {
    const _urlTeam = new URLSearchParams(window.location.search).get('team');
    if (isSuperAdmin) {
      _activeTeamSlug = _urlTeam || API.getAdminTeam() || null;
    } else if (_urlTeam === 'dev') {
      _activeTeamSlug = 'dev'; // sm_admin can view dev team via URL
    }
  }

  // Show team filter for super_admin and load team list
  if (isSuperAdmin) {
    const sel = document.getElementById('team-filter');
    if (sel) {
      sel.style.display = '';
      API.teams.list().then(res => {
        if (!res?.ok) return;
        const teams = res.data?.data || res.data || [];
        teams.forEach(t => {
          const opt = document.createElement('option');
          opt.value = t.slug;
          opt.textContent = t.name + ' (' + t.slug + ')';
          if (t.slug === _activeTeamSlug) opt.selected = true;
          sel.appendChild(opt);
        });
      });
    }
  }

  function onTeamFilterChange() {
    const sel = document.getElementById('team-filter');
    _activeTeamSlug = sel?.value || null;
    loadUsers();
  }

  // Base label mapping — kept in sync with layout.js coreNavItems.
  // Falls back to raw ID if the menu isn't listed here (so newly-added menus
  // still show up in the picker even before we edit this map).
  const PAGE_LABELS = {
    'dashboard':       'Dashboard',
    'board':           'Web Board',
    'sheets':          'Team Docs',
    'sabai':           'SABai',
    'schedule':        'Shift Schedule',
    'pw-schedule':     'PW Schedule',
    'ma-services':     'MA Services',
    'learn':           'Learning',
    'weekly-report':   'Weekly Report',
    'analytics':       'Analytics',
    'send-email':      'SMC Ticket',
    'inbox':           'Team Inbox',
    'restart-monitor': 'EKS Restart Monitor',
    'alert-monitor':   'Alert Monitor',
    'monitoring':      'Monitoring',
    'test-service':    'Test Service',
    'batch-monitor':   'Batch Monitor',
    'jenkins-build':   'Jenkins Build',
    'jenkins-build-approve': 'Jenkins Build — Approve (Checker)',
    'jenkins-portal':       'Jenkins Portal',
    'so-jenkins':           'SO Jenkins',
  };

  // Populated dynamically from /api/menu-permissions endpoint (known_menus).
  // Prevents this list from going stale when new menus are added elsewhere.
  let PAGE_PERMISSIONS = Object.keys(PAGE_LABELS).map(id => ({ id, label: PAGE_LABELS[id] }));

  async function loadPagePermissionsList() {
    try {
      const r = await API.menuPermissions.get();
      if (!r?.ok) return;
      const menus = r.data.data?.known_menus || [];
      // Only offer menus that make sense for external users — hide admin/dev.
      const filtered = menus.filter(m => !['admin'].includes(m) && !m.startsWith('dev'));
      PAGE_PERMISSIONS = filtered.map(id => ({ id, label: PAGE_LABELS[id] || id }));
    } catch {}
  }

  // Load PW expiry setting + dynamic menu list
  API.systemSettings.get().then(r => {
    if (r?.ok) pwExpiryDays = r.data.data?.password_expiry_days ?? 60;
  });
  loadPagePermissionsList();

  async function loadUsers() {
    // super_admin passes active team filter; sm_admin also passes 'dev' when viewing dev team
    const teamParam = isSuperAdmin
      ? _activeTeamSlug
      : (_activeTeamSlug === 'dev' ? 'dev' : null);
    const [usersRes, colorsRes] = await Promise.all([
      API.users.list(teamParam),
      API.userColors.get(),
    ]);
    if (!usersRes?.ok) { Toast.error('Failed to load users'); return; }
    allUsers = usersRes.data.data || [];
    userColorsCache = colorsRes?.ok ? (colorsRes.data.data || {}) : {};
    selectedIds.clear();
    updateBulkBar();
    updateStats();
    applyFilters();
  }

  function updateStats() {
    const smUsers = allUsers.filter(u => u.role !== 'external');
    document.getElementById('stat-total').textContent = smUsers.length;

    const active = smUsers.filter(u =>
      !u.must_reset_password && !u.first_login && !u.password_expired
    ).length;
    document.getElementById('stat-active').textContent = active;

    const expired = smUsers.filter(u => u.password_expired).length;
    document.getElementById('stat-expired').textContent = expired;

    const reset = smUsers.filter(u => u.must_reset_password).length;
    document.getElementById('stat-reset').textContent = reset;

    const extCount = allUsers.filter(u => u.role === 'external').length;
    document.getElementById('stat-external').textContent = extCount;

    // Team breakdown — show only when super_admin is viewing all teams
    const breakdown = document.getElementById('team-breakdown');
    const breakdownList = document.getElementById('team-breakdown-list');
    if (isSuperAdmin && !_activeTeamSlug && allUsers.length > 0) {
      // Count per team (non-external only)
      const teamMap = {};
      allUsers.forEach(u => {
        if (u.role === 'external') return;
        const t = u.team || '(no team)';
        teamMap[t] = (teamMap[t] || 0) + 1;
      });
      const sorted = Object.entries(teamMap).sort((a, b) => b[1] - a[1]);
      const teamColors = {
        sm:'#f26419', ss:'#0ea5e9', ts:'#8b5cf6', fas:'#10b981',
        im:'#f59e0b', cmt:'#ec4899', smart:'#6366f1', dev:'#64748b',
      };
      breakdownList.innerHTML = sorted.map(([slug, count]) => {
        const col = teamColors[slug] || '#94a3b8';
        return `<div style="
          display:inline-flex;align-items:center;gap:6px;
          background:var(--bg);border:1.5px solid var(--border);
          border-radius:20px;padding:4px 12px;cursor:pointer;transition:.15s;
          font-size:12px;font-weight:700;
        " title="Filter by ${slug}" onclick="document.getElementById('team-filter').value='${slug}';onTeamFilterChange();"
          onmouseover="this.style.borderColor='${col}'" onmouseout="this.style.borderColor='var(--border)'">
          <span style="width:8px;height:8px;border-radius:50%;background:${col};flex-shrink:0"></span>
          <span style="color:var(--text)">${slug}</span>
          <span style="background:${col};color:#fff;border-radius:10px;padding:1px 7px;font-size:10px">${count}</span>
        </div>`;
      }).join('');
      breakdown.style.display = '';
    } else {
      breakdown.style.display = 'none';
    }
  }

  function applyFilters() {
    const search = document.getElementById('user-search').value.toLowerCase();
    const roleFilter = document.getElementById('role-filter').value;
    const statusFilter = document.getElementById('status-filter').value;
    const sortBy = document.getElementById('sort-by').value;

    // Filter
    filteredUsers = allUsers.filter(u => {
      // Search filter
      const matchSearch = !search || 
        u.name.toLowerCase().includes(search) || 
        u.username.toLowerCase().includes(search) || 
        (u.email||'').toLowerCase().includes(search) ||
        (u.nickname||'').toLowerCase().includes(search);
      
      // Role filter
      const matchRole = !roleFilter || u.role === roleFilter;
      
      // Status filter
      let matchStatus = true;
      if (statusFilter === 'active') {
        matchStatus = !u.must_reset_password && !u.first_login && !u.password_expired;
      } else if (statusFilter === 'expired') {
        matchStatus = u.password_expired;
      } else if (statusFilter === 'reset') {
        matchStatus = u.must_reset_password;
      } else if (statusFilter === 'first') {
        matchStatus = u.first_login;
      }
      
      return matchSearch && matchRole && matchStatus;
    });

    // Sort
    filteredUsers.sort((a, b) => {
      switch(sortBy) {
        case 'name-asc':
          return a.name.localeCompare(b.name, 'th');
        case 'name-desc':
          return b.name.localeCompare(a.name, 'th');
        case 'created-desc':
          return new Date(b.created_at) - new Date(a.created_at);
        case 'created-asc':
          return new Date(a.created_at) - new Date(b.created_at);
        case 'role-asc':
          return a.role.localeCompare(b.role);
        default:
          return 0;
      }
    });

    if (currentView === 'table') {
      renderUsersTable(filteredUsers);
    } else {
      renderUsersCards(filteredUsers);
    }
    syncSelectAll();
  }

  function switchView(view) {
    currentView = view;
    document.getElementById('view-table-btn').classList.toggle('active', view === 'table');
    document.getElementById('view-card-btn').classList.toggle('active', view === 'card');
    document.getElementById('table-view').style.display = view === 'table' ? 'block' : 'none';
    document.getElementById('card-view').style.display = view === 'card' ? 'block' : 'none';
    applyFilters();
  }

  function renderUsersTable(list) {
    const container = document.getElementById('users-table');
    if (list.length === 0) {
      container.innerHTML = '<div class="empty-state" style="padding:60px"><div class="empty-icon"><i data-icon="users"></i></div><p>No users found.</p></div>';
      return;
    }

    const allSelectable = list.filter(u => u.id !== currentUser.id);
    const allChecked = allSelectable.length > 0 && allSelectable.every(u => selectedIds.has(u.id));

    container.innerHTML = `<table>
      <thead><tr>
        <th style="width:36px;padding:10px 12px">
          <input class="cb-user" type="checkbox" id="cb-all" ${allChecked ? 'checked' : ''}
            onchange="toggleSelectAll(this.checked)" title="Select all">
        </th>
        <th>Name</th><th>Username</th><th>Email</th><th>Role</th>
        <th>Status</th><th>Schedule / Perms</th><th>Created</th><th>PW Changed</th><th>PW Expires</th>
        <th style="text-align:right">Actions</th>
      </tr></thead>
      <tbody>
        ${list.map(u => {
          const isSelf = u.id === currentUser.id;
          const checked = selectedIds.has(u.id) ? 'checked' : '';
          return `<tr id="row-${u.id}" class="${selectedIds.has(u.id) ? 'row-selected' : ''}">
            <td style="padding:10px 12px">
              ${!isSelf ? `<input class="cb-user" type="checkbox" ${checked} onchange="toggleSelect('${u.id}',this.checked)">` : ''}
            </td>
            <td>
              <div style="display:flex;align-items:center;gap:8px">
                <div class="user-avatar" style="background:var(--orange-bg);color:var(--orange);border-color:var(--orange)">
                  ${u.avatar_url 
                    ? `<img src="${u.avatar_url}" alt="${u.name}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" onerror="this.style.display='none';this.parentElement.textContent='${getInitials(u.name)}'">`
                    : getInitials(u.name)
                  }
                </div>
                <div>
                  <div style="font-weight:600">
                    ${escHtml(u.name)}${u.nickname ? ` <span style="color:var(--text-muted);font-weight:400">(${escHtml(u.nickname)})</span>` : ''}
                  </div>
                  ${isSelf ? '<span style="font-size:9px;color:var(--orange);background:var(--orange-dim);border-radius:4px;padding:1px 5px;font-weight:700">You</span>' : ''}
                </div>
              </div>
            </td>
            <td style="color:var(--text-muted)"><code>${escHtml(u.username)}</code></td>
            <td style="color:var(--text-muted)">${escHtml(u.email || '—')}</td>
            <td>${Roles.badge(u.role)}${u.role === 'dev_user' && u.dev_subteam ? `<br><span style="font-size:9.5px;color:#7c3aed;font-weight:600">${escHtml(u.dev_subteam)}</span>` : ''}</td>
            <td>
              ${u.must_reset_password
                ? '<span class="badge badge-red" title="Admin forced password reset">🔑 Reset Req.</span>'
                : u.first_login
                  ? '<span class="badge badge-yellow">First Login</span>'
                  : u.password_expired
                    ? '<span class="badge badge-red">PW Expired</span>'
                    : '<span class="badge badge-green">Active</span>'}
            </td>
            <td>
              ${u.role === 'external'
                ? `<span style="font-size:11px;color:#6D28D9">${(u.permissions||[]).length} หน้า</span>`
                : `<span style="display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap">
                    <span style="width:12px;height:12px;border-radius:3px;background:${userColorsCache[u.id]||'#f26419'};display:inline-block;border:1px solid rgba(0,0,0,.1)"></span>
                    <span style="font-size:10px;color:${u.schedule_include !== false ? '#166534' : 'var(--text-muted)'}" title="ตารางเวร">${u.schedule_include !== false ? '◉' : '○'} ตาราง</span>
                    <span style="font-size:10px;color:${u.course_include !== false ? '#1e40af' : 'var(--text-muted)'}" title="รวมในคอร์สเรียน">${u.course_include !== false ? '📚' : '○'} คอร์ส</span>
                    <span style="font-size:10px;color:${u.exam_include !== false ? '#b45309' : 'var(--text-muted)'}" title="รวมในข้อสอบ">${u.exam_include !== false ? '📝' : '○'} ข้อสอบ</span>
                  </span>`
              }
            </td>
            <td style="font-size:11px;color:var(--text-muted)">${fmtDate(u.created_at)}</td>
            <td style="font-size:11px;color:var(--text-muted)">${u.first_login ? '—' : fmtDate(u.password_changed_at)}</td>
            <td>${pwExpiryCell(u)}</td>
            <td style="text-align:right">
              <div class="flex gap-2" style="justify-content:flex-end">
                <button class="btn btn-ghost btn-sm" onclick="viewProfile('${u.id}')" title="View Profile">👤</button>
                <button class="btn btn-ghost btn-sm" onclick="editUser('${u.id}')" title="Edit">✎</button>
                <button class="btn btn-ghost btn-sm" onclick="resetLoginBlock('${escHtml(u.username)}','${escHtml(u.name)}')" title="Unlock">🔓</button>
                <button class="btn btn-ghost btn-sm" onclick="resetPw('${u.id}','${escHtml(u.name)}')" title="Reset Password">↺</button>
                ${!isSelf ? `<button class="btn btn-ghost btn-sm" title="Force password reset" onclick="forceReset('${u.id}','${escHtml(u.name)}')">🔑</button>` : ''}
                ${!isSelf ? `<button class="btn btn-danger btn-sm" onclick="deleteUser('${u.id}','${escHtml(u.name)}')" title="Delete">✕</button>` : ''}
              </div>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    <style>
      tr.row-selected td { background:rgba(242,100,25,.04); }
      .pw-exp-ok   { color:#16a34a;font-weight:700;font-size:11px; }
      .pw-exp-warn { color:#d97706;font-weight:700;font-size:11px; }
      .pw-exp-dead { color:#dc2626;font-weight:700;font-size:11px; }
      .pw-exp-na   { color:var(--text-muted);font-size:11px; }
    </style>`;
  }

  function renderUsersCards(list) {
    const container = document.getElementById('users-cards');
    if (list.length === 0) {
      container.innerHTML = '<div class="empty-state" style="padding:60px;grid-column:1/-1"><div class="empty-icon"><i data-icon="users"></i></div><p>No users found.</p></div>';
      return;
    }

    container.innerHTML = list.map(u => {
      const isSelf = u.id === currentUser.id;
      const checked = selectedIds.has(u.id) ? 'checked' : '';
      const roleColors = {
        sm_admin:     { bg: '#fee2e2', text: '#991b1b', border: '#fecaca' },
        dev_sm:       { bg: '#1a0000', text: '#ff2020', border: '#ff2020' },
        sm_lead:      { bg: '#fef3c7', text: '#92400e', border: '#fde68a' },
        sm_user:      { bg: '#dbeafe', text: '#1e40af', border: '#bfdbfe' },
        dev_user:     { bg: '#f3e8ff', text: '#6b21a8', border: '#d8b4fe' },
        external:     { bg: '#f0fdf4', text: '#166534', border: '#bbf7d0' },
        super_viewer: { bg: '#fafafa', text: '#374151', border: '#d1d5db' },
      };
      const rc = roleColors[u.role] || roleColors.sm_user;
      
      return `<div class="user-card" id="card-${u.id}">
        ${!isSelf ? `<input class="cb-user user-card-checkbox" type="checkbox" ${checked} onchange="toggleSelect('${u.id}',this.checked)">` : ''}
        
        <div class="user-card-header">
          <div class="user-card-avatar" style="background:${rc.bg};color:${rc.text};border:2px solid ${rc.border}">
            ${u.avatar_url 
              ? `<img src="${u.avatar_url}" alt="${u.name}" style="width:100%;height:100%;object-fit:cover;border-radius:12px" onerror="this.style.display='none';this.parentElement.textContent='${getInitials(u.name)}'">`
              : getInitials(u.name)
            }
          </div>
          <div class="user-card-info">
            <div class="user-card-name">${escHtml(u.name)}</div>
            <div class="user-card-username">@${escHtml(u.username)}</div>
          </div>
        </div>

        <div class="user-card-details">
          ${u.nickname ? `<div class="user-card-row">
            <span class="user-card-label">Nickname</span>
            <span>${escHtml(u.nickname)}</span>
          </div>` : ''}
          <div class="user-card-row">
            <span class="user-card-label">Email</span>
            <span style="font-size:10px">${escHtml(u.email || '—')}</span>
          </div>
          <div class="user-card-row">
            <span class="user-card-label">Role</span>
            ${Roles.badge(u.role)}
          </div>
          ${u.role === 'dev_user' && u.dev_subteam ? `<div class="user-card-row">
            <span class="user-card-label">Sub-team</span>
            <span style="font-size:10.5px;font-weight:600;color:#7c3aed">${escHtml(u.dev_subteam)}</span>
          </div>` : ''}
          <div class="user-card-row">
            <span class="user-card-label">Status</span>
            ${u.must_reset_password
              ? '<span class="badge badge-red">🔑 Reset</span>'
              : u.first_login
                ? '<span class="badge badge-yellow">First Login</span>'
                : u.password_expired
                  ? '<span class="badge badge-red">Expired</span>'
                  : '<span class="badge badge-green">Active</span>'}
          </div>
          <div class="user-card-row">
            <span class="user-card-label">Created</span>
            <span>${fmtDate(u.created_at)}</span>
          </div>
          <div class="user-card-row">
            <span class="user-card-label">PW Expires</span>
            ${pwExpiryCell(u)}
          </div>
        </div>

        <div class="user-card-actions">
          <button class="btn btn-ghost btn-sm" onclick="viewProfile('${u.id}')" title="View Profile"><i data-icon="user"></i></button>
          <button class="btn btn-ghost btn-sm" onclick="editUser('${u.id}')" style="flex:1"><i data-icon="pencil"></i> Edit</button>
          <button class="btn btn-ghost btn-sm" onclick="resetPw('${u.id}','${escHtml(u.name)}')" style="flex:1">↺ Reset</button>
          ${!isSelf ? `<button class="btn btn-danger btn-sm" onclick="deleteUser('${u.id}','${escHtml(u.name)}')">✕</button>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  // ── Selection helpers ────────────────────────────────────
  function toggleSelect(id, checked) {
    if (checked) selectedIds.add(id); else selectedIds.delete(id);
    const row = document.getElementById('row-' + id);
    const card = document.getElementById('card-' + id);
    if (row) row.classList.toggle('row-selected', checked);
    if (card) card.style.borderColor = checked ? 'var(--orange)' : '';
    updateBulkBar();
    syncSelectAll();
  }

  function toggleSelectAll(checked) {
    filteredUsers.forEach(u => {
      if (u.id === currentUser.id) return;
      if (checked) selectedIds.add(u.id); else selectedIds.delete(u.id);
      const row = document.getElementById('row-' + u.id);
      const card = document.getElementById('card-' + u.id);
      if (row) {
        row.classList.toggle('row-selected', checked);
        const cb = row.querySelector('.cb-user');
        if (cb) cb.checked = checked;
      }
      if (card) {
        card.style.borderColor = checked ? 'var(--orange)' : '';
        const cb = card.querySelector('.cb-user');
        if (cb) cb.checked = checked;
      }
    });
    updateBulkBar();
  }

  function syncSelectAll() {
    const selectable = filteredUsers.filter(u => u.id !== currentUser.id);
    const cbAll = document.getElementById('cb-all');
    if (cbAll) cbAll.checked = selectable.length > 0 && selectable.every(u => selectedIds.has(u.id));
  }

  function clearSelection() {
    selectedIds.clear();
    document.querySelectorAll('.cb-user').forEach(cb => cb.checked = false);
    document.querySelectorAll('tr.row-selected').forEach(r => r.classList.remove('row-selected'));
    document.querySelectorAll('.user-card').forEach(c => c.style.borderColor = '');
    updateBulkBar();
  }

  function updateBulkBar() {
    const bar  = document.getElementById('bulk-bar');
    const lbl  = document.getElementById('bulk-count-label');
    const n    = selectedIds.size;
    if (n > 0) {
      bar.style.display = 'flex';
      lbl.textContent = `${n} user${n > 1 ? 's' : ''} selected`;
    } else {
      bar.style.display = 'none';
    }
  }

  // ── Bulk actions ─────────────────────────────────────────
  async function bulkDelete() {
    const ids  = [...selectedIds];
    const names = ids.map(id => allUsers.find(u => u.id === id)?.name || id).join(', ');
    const ok = await confirmDialog(`Delete ${ids.length} user(s)?\n${names}\n\nThis cannot be undone.`, 'Bulk Delete');
    if (!ok) return;
    let failed = 0;
    for (const id of ids) {
      const res = await API.users.delete(id);
      if (!res?.ok) failed++;
    }
    if (failed) Toast.error(`${failed} deletion(s) failed`);
    else Toast.success(`${ids.length} user(s) deleted`);
    loadUsers();
  }

  async function bulkResetPw() {
    const ids = [...selectedIds];
    const ok  = await confirmDialog(`Reset passwords for ${ids.length} user(s)?`, 'Bulk Reset Password');
    if (!ok) return;
    let success = 0;
    for (const id of ids) {
      const res = await API.users.resetPassword(id);
      if (res?.ok) success++;
    }
    Toast.success(`${success} password(s) reset — inform users to check their temporary passwords`);
    clearSelection();
  }

  // ── Populate role dropdown: super_admin sees all; team admins only User/Admin ─
  function populateRoleOptions(currentRole) {
    const all = [
      { value: 'sm_user',  label: 'User' },
      { value: 'sm_lead',  label: 'Lead' },
      { value: 'dev_sm',   label: 'Dev' },
      { value: 'sm_admin', label: 'Admin' },
      { value: 'dev_user', label: 'Dev User (External Dev Team)' },
      { value: 'external', label: 'External' },
      // Platform-level read-only oversight role — only creatable by super_admin.
      { value: 'super_viewer', label: 'Super Viewer (read-only)' },
    ];
    const allowed = isSuperAdmin
      ? all
      : all.filter(o => ['sm_user', 'sm_admin', 'dev_user'].includes(o.value));
    // If editing a user whose role is outside the allowed set, keep it as a locked option
    // so admins can still see the value (but downgrading it will restrict them to User/Admin).
    if (currentRole && !allowed.some(o => o.value === currentRole)) {
      const extra = all.find(o => o.value === currentRole);
      if (extra) allowed.push({ ...extra, label: extra.label + ' (current)' });
    }
    document.getElementById('u-role').innerHTML =
      allowed.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
  }

  // ── Tabbed modal helpers ────────────────────────────────
  function umSwitchTab(name) {
    document.querySelectorAll('#user-modal .um-tab').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === name);
    });
    document.querySelectorAll('#user-modal .um-panel').forEach(p => {
      p.classList.toggle('active', p.dataset.panel === name);
    });
    // Reset scroll to top when switching so long panels aren't left mid-scroll.
    const body = document.querySelector('#user-modal .modal-body');
    if (body) body.scrollTop = 0;
  }

  function umActiveTab() {
    const btn = document.querySelector('#user-modal .um-tab.active');
    return btn ? btn.dataset.tab : 'identity';
  }

  // ── Role toggle: show/hide schedule vs external tabs ─────
  function onRoleChange() {
    const role = document.getElementById('u-role').value;
    const isExt = role === 'external';
    const isDevUser = role === 'dev_user';
    const isSuperViewer = role === 'super_viewer';
    const smVisible = !(isExt || isSuperViewer || isDevUser);

    const tabSchedule  = document.getElementById('um-tab-schedule');
    const tabContact   = document.getElementById('um-tab-contact');
    const tabPerms     = document.getElementById('um-tab-perms');
    const tabExtraPages = document.getElementById('um-tab-extra-pages');
    const isEditing    = !!document.getElementById('edit-user-id').value;
    if (tabSchedule)   tabSchedule.style.display   = smVisible ? '' : 'none';
    if (tabContact)    tabContact.style.display     = smVisible ? '' : 'none';
    if (tabPerms)      tabPerms.style.display       = isExt ? '' : 'none';
    if (tabExtraPages) tabExtraPages.style.display  = (isSuperAdmin && isEditing) ? '' : 'none';

    // If the currently active tab was hidden, fall back to Identity.
    const activeBtn = document.querySelector('#user-modal .um-tab.active');
    if (activeBtn && activeBtn.style.display === 'none') umSwitchTab('identity');

    // super_viewer has no team — hide team picker when creating one.
    // dev_user always uses the dev team — also hide the team picker.
    const teamRow = document.getElementById('team-field-row');
    if (teamRow && isSuperAdmin) {
      teamRow.style.display = (isSuperViewer || isDevUser) ? 'none' : '';
    }

    // Dev subteam field
    const devSubRow = document.getElementById('dev-subteam-row');
    if (devSubRow) devSubRow.style.display = isDevUser ? 'block' : 'none';
    if (isDevUser) loadDevSubteams();

    // Dev-mode: toggle class on modal to show lock bar + collapse tabs into one form
    const modal = document.getElementById('user-modal');
    if (isDevUser) {
      modal?.classList.add('dev-mode');
      // Remove active state from all panels — CSS will control visibility in dev-mode
      document.querySelectorAll('#user-modal .um-panel').forEach(p => p.classList.remove('active'));
    } else {
      modal?.classList.remove('dev-mode');
      // Restore active panel (default to account if coming back from dev-mode)
      if (!document.querySelector('#user-modal .um-panel.active')) umSwitchTab('account');
    }
  }

  function exitDevMode() {
    const roleSel = document.getElementById('u-role');
    if (roleSel) { roleSel.value = 'sm_user'; }
    onRoleChange();
    umSwitchTab('account');
  }

  // Load dev sub-teams from API and populate the select (cached after first call)
  let _devSubteamsCache = null;
  async function loadDevSubteams(currentValue = '') {
    if (!_devSubteamsCache) {
      const res = await API.devSubteams.list();
      _devSubteamsCache = (res?.ok && Array.isArray(res.data?.data)) ? res.data.data : [];
    }
    const sel = document.getElementById('u-dev-subteam');
    if (!sel) return;
    const prev = currentValue || sel.value;
    sel.innerHTML = '<option value="">— Select Sub-team —</option>' +
      _devSubteamsCache.map(s => `<option${s === prev ? ' selected' : ''}>${escHtml(s)}</option>`).join('');
  }

  function buildPermGrid(checked = []) {
    const grid = document.getElementById('perm-grid');
    grid.innerHTML = PAGE_PERMISSIONS.map(p => `
      <label class="perm-item">
        <input type="checkbox" name="perm" value="${p.id}" ${checked.includes(p.id) ? 'checked' : ''}>
        ${escHtml(p.label)}
      </label>`).join('');
  }

  function getCheckedPerms() {
    return [...document.querySelectorAll('#perm-grid input[name=perm]:checked')].map(el => el.value);
  }

  // ── Extra Pages (cross-team page access) ─────────────────
  let _teamsCache = null;
  async function _loadTeams() {
    if (_teamsCache) return _teamsCache;
    const res = await API.teams.list();
    _teamsCache = (res?.ok ? (res.data?.data || res.data || []) : []);
    return _teamsCache;
  }

  async function buildExtraPagesList(extraPages = []) {
    const container = document.getElementById('extra-pages-list');
    if (!container) return;
    const teams = await _loadTeams();
    const teamOpts = teams.map(t =>
      `<option value="${escHtml(t.slug)}">${escHtml(t.name)} (${escHtml(t.slug)})</option>`
    ).join('');
    const pageOpts = PAGE_PERMISSIONS.map(p =>
      `<option value="${escHtml(p.id)}">${escHtml(p.label)}</option>`
    ).join('');

    if (!extraPages.length) { container.innerHTML = '<div style="font-size:12px;color:var(--text-muted)">ยังไม่มี extra pages</div>'; return; }
    container.innerHTML = extraPages.map((ep, i) => `
      <div class="ep-row" style="display:flex;align-items:center;gap:8px;background:var(--bg);border:1.5px solid var(--border);border-radius:8px;padding:8px 10px">
        <div style="flex:1;min-width:0">
          <div style="font-size:10px;color:var(--text-muted);margin-bottom:3px">Page</div>
          <select class="form-control ep-page" style="font-size:12px;padding:4px 8px">
            ${pageOpts}
          </select>
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:10px;color:var(--text-muted);margin-bottom:3px">Source Team</div>
          <select class="form-control ep-team" style="font-size:12px;padding:4px 8px">
            ${teamOpts}
          </select>
        </div>
        <button type="button" onclick="this.closest('.ep-row').remove();_refreshEmptyEpMsg()"
          style="flex-shrink:0;background:none;border:none;color:var(--danger);cursor:pointer;padding:4px;margin-top:14px" title="Remove">
          <i data-icon="x"></i>
        </button>
      </div>`).join('');

    // Set selected values
    const rows = container.querySelectorAll('.ep-row');
    extraPages.forEach((ep, i) => {
      const r = rows[i];
      if (!r) return;
      const ps = r.querySelector('.ep-page'); if (ps) ps.value = ep.page || '';
      const ts = r.querySelector('.ep-team'); if (ts) ts.value = ep.source_team || '';
    });
    Icons.replaceAll(container);
  }

  async function addExtraPageRow() {
    const container = document.getElementById('extra-pages-list');
    if (!container) return;
    // Remove only the "ยังไม่มี" placeholder (a direct child that is not .ep-row)
    const placeholder = [...container.children].find(el => !el.classList.contains('ep-row'));
    if (placeholder) placeholder.remove();

    const teams = await _loadTeams();
    const teamOpts = teams.map(t =>
      `<option value="${escHtml(t.slug)}">${escHtml(t.name)} (${escHtml(t.slug)})</option>`
    ).join('');
    const pageOpts = PAGE_PERMISSIONS.map(p =>
      `<option value="${escHtml(p.id)}">${escHtml(p.label)}</option>`
    ).join('');

    const row = document.createElement('div');
    row.className = 'ep-row';
    row.style.cssText = 'display:flex;align-items:center;gap:8px;background:var(--bg);border:1.5px solid var(--border);border-radius:8px;padding:8px 10px';
    row.innerHTML = `
      <div style="flex:1;min-width:0">
        <div style="font-size:10px;color:var(--text-muted);margin-bottom:3px">Page</div>
        <select class="form-control ep-page" style="font-size:12px;padding:4px 8px">${pageOpts}</select>
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:10px;color:var(--text-muted);margin-bottom:3px">Source Team</div>
        <select class="form-control ep-team" style="font-size:12px;padding:4px 8px">${teamOpts}</select>
      </div>
      <button type="button" onclick="this.closest('.ep-row').remove();_refreshEmptyEpMsg()"
        style="flex-shrink:0;background:none;border:none;color:var(--danger);cursor:pointer;padding:4px;margin-top:14px" title="Remove">
        <i data-icon="x"></i>
      </button>`;
    container.appendChild(row);
    Icons.replaceAll(row);
  }

  function _refreshEmptyEpMsg() {
    const container = document.getElementById('extra-pages-list');
    if (!container) return;
    if (!container.querySelector('.ep-row')) {
      container.innerHTML = '<div style="font-size:12px;color:var(--text-muted)">ยังไม่มี extra pages</div>';
    }
  }

  function getExtraPages() {
    return [...document.querySelectorAll('#extra-pages-list .ep-row')].map(row => ({
      page:        row.querySelector('.ep-page')?.value || '',
      source_team: row.querySelector('.ep-team')?.value || '',
    })).filter(ep => ep.page && ep.source_team);
  }

  function setColor(hex) {
    const safe = hex || '#f26419';
    document.getElementById('u-schedule-color').value = safe;
    document.getElementById('color-swatch-preview').style.background = safe;
    document.getElementById('color-hex-label').textContent = safe;
  }

  document.getElementById('u-schedule-color').addEventListener('input', function() {
    document.getElementById('color-swatch-preview').style.background = this.value;
    document.getElementById('color-hex-label').textContent = this.value;
  });

  // ── Create user ─────────────────────────────────────────
  async function openCreateUser() {
    document.getElementById('user-modal-title').textContent = 'Create User';
    document.getElementById('user-save-text').textContent = 'Create User';
    document.getElementById('edit-user-id').value = '';
    document.getElementById('u-name').value = '';
    document.getElementById('u-name-th').value  = '';
    document.getElementById('u-nickname').value = '';
    document.getElementById('u-emp-id').value   = '';
    document.getElementById('u-username').value = '';
    document.getElementById('u-email').value = '';
    document.getElementById('u-phone').value      = '';
    document.getElementById('u-tmn-id').value     = '';
    document.getElementById('u-net-home').value   = '';
    document.getElementById('u-net-mobile').value = '';
    populateRoleOptions();
    // Auto-select dev_user when creating from the dev team page
    document.getElementById('u-role').value = (_activeTeamSlug === 'dev') ? 'dev_user' : 'sm_user';
    document.getElementById('u-dev-subteam').value = '';
    document.getElementById('u-schedule-include').checked = true;
    document.getElementById('u-course-include').checked = true;
    document.getElementById('u-exam-include').checked = true;
    setColor('#f26419');
    buildPermGrid([]);
    const epList = document.getElementById('extra-pages-list');
    if (epList) epList.innerHTML = '';
    // Reset dev-mode before calling onRoleChange (so tabs restore cleanly)
    document.getElementById('user-modal')?.classList.remove('dev-mode');
    document.querySelectorAll('#user-modal .um-panel').forEach(p => p.classList.remove('active'));
    umSwitchTab('account'); // default to account tab for normal roles
    onRoleChange();         // may switch to dev-mode if role=dev_user
    document.getElementById('username-row').style.display = '';
    document.getElementById('create-note').style.display = 'block';
    document.getElementById('u-email-req').style.display = '';
    document.getElementById('u-email-hint').style.display = '';

    // Team dropdown: super_admin can pick any team
    const teamRow = document.getElementById('team-field-row');
    if (isSuperAdmin && teamRow) {
      teamRow.style.display = 'block';
      const sel = document.getElementById('u-team');
      if (sel.options.length <= 1) { // populate once
        const res = await API.teams.list();
        if (res?.ok) {
          (res.data?.data || res.data || []).forEach(t => {
            const o = document.createElement('option');
            o.value = t.slug; o.textContent = t.name + ' (' + t.slug + ')';
            sel.appendChild(o);
          });
        }
      }
      // Pre-select active team filter if set
      if (_activeTeamSlug) sel.value = _activeTeamSlug;
    }

    Modal.open('user-modal');
  }

  function viewProfile(id) {
    window.location.href = '../profile.html?user=' + encodeURIComponent(id);
  }

  function editUser(id) {
    const u = allUsers.find(x => x.id === id);
    if (!u) return;
    document.getElementById('user-modal-title').textContent = 'Edit User';
    document.getElementById('user-save-text').textContent = 'Save Changes';
    document.getElementById('edit-user-id').value = u.id;
    document.getElementById('u-name').value = u.name;
    document.getElementById('u-name-th').value  = u.name_th  || '';
    document.getElementById('u-nickname').value = u.nickname || '';
    document.getElementById('u-emp-id').value   = u.emp_id   || '';
    document.getElementById('u-username').value = u.username;
    document.getElementById('u-email').value = u.email || '';
    document.getElementById('u-phone').value      = u.phone      || '';
    document.getElementById('u-tmn-id').value     = u.tmn_id     || '';
    document.getElementById('u-net-home').value   = u.net_home   || '';
    document.getElementById('u-net-mobile').value = u.net_mobile || '';
    populateRoleOptions(u.role);
    document.getElementById('u-role').value = u.role;
    if (u.role === 'dev_user') loadDevSubteams(u.dev_subteam || '');
    document.getElementById('u-schedule-include').checked = u.schedule_include !== false;
    document.getElementById('u-course-include').checked   = u.course_include   !== false;
    document.getElementById('u-exam-include').checked     = u.exam_include     !== false;
    setColor(userColorsCache[u.id] || '#f26419');
    buildPermGrid(u.permissions || []);
    const jbRole = document.getElementById('u-jb-role');
    if (jbRole) jbRole.value = ['maker', 'checker', 'admin'].includes(u.jb_role) ? u.jb_role : 'maker';
    if (isSuperAdmin) buildExtraPagesList(u.extra_pages || []);
    document.getElementById('user-modal')?.classList.remove('dev-mode');
    document.querySelectorAll('#user-modal .um-panel').forEach(p => p.classList.remove('active'));
    onRoleChange(); // applies dev-mode if needed
    if (!document.getElementById('user-modal')?.classList.contains('dev-mode')) umSwitchTab('identity');
    document.getElementById('username-row').style.display = 'none';
    document.getElementById('create-note').style.display = 'none';
    document.getElementById('u-email-req').style.display = 'none';
    document.getElementById('u-email-hint').style.display = 'none';
    Modal.open('user-modal');
  }

  async function saveUser() {
    const spin = document.getElementById('user-save-spin');
    const text = document.getElementById('user-save-text');
    const id    = document.getElementById('edit-user-id').value;
    const name  = document.getElementById('u-name').value.trim();
    const email = document.getElementById('u-email').value.trim();

    const isDevMode = document.getElementById('user-modal')?.classList.contains('dev-mode');
    if (!name) { if (!isDevMode) umSwitchTab('identity'); document.getElementById('u-name').focus(); Toast.warning('Name is required'); return; }
    // For new users, email is required so we can send the temporary password.
    if (!id) {
      if (!email) { if (!isDevMode) umSwitchTab('account'); document.getElementById('u-email').focus(); Toast.warning('Email is required — temp password จะถูกส่งไปที่อีเมลนี้'); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { if (!isDevMode) umSwitchTab('account'); document.getElementById('u-email').focus(); Toast.warning('รูปแบบอีเมลไม่ถูกต้อง'); return; }
    }
    // dev_user requires a sub-team selection
    if ((document.getElementById('u-role').value === 'dev_user') && !document.getElementById('u-dev-subteam').value) {
      Toast.warning('กรุณาเลือก Dev Sub-team'); document.getElementById('u-dev-subteam').focus(); return;
    }

    spin.classList.remove('hidden');
    text.textContent = 'Saving...';

    let res;
    const nickname    = document.getElementById('u-nickname').value.trim();
    const role        = document.getElementById('u-role').value;
    const isExt       = role === 'external';
    const isDevUser   = role === 'dev_user';
    const devSubteam  = isDevUser ? document.getElementById('u-dev-subteam').value.trim() : null;
    const scheduleInclude = document.getElementById('u-schedule-include').checked;
    const courseInclude   = document.getElementById('u-course-include').checked;
    const examInclude     = document.getElementById('u-exam-include').checked;
    const scheduleColor   = document.getElementById('u-schedule-color').value;
    const permissions     = isExt ? getCheckedPerms() : [];
    const jbRoleSelect    = document.getElementById('u-jb-role');
    const jb_role         = (isExt && jbRoleSelect) ? jbRoleSelect.value : null;

    const name_th    = document.getElementById('u-name-th').value.trim();
    const emp_id     = document.getElementById('u-emp-id').value.trim();
    const phone      = document.getElementById('u-phone').value.trim();
    const tmn_id     = document.getElementById('u-tmn-id').value.trim();
    const net_home   = document.getElementById('u-net-home').value.trim();
    const net_mobile = document.getElementById('u-net-mobile').value.trim();

    if (id) {
      const updateBody = {
        name,
        name_th,
        nickname,
        emp_id,
        email: document.getElementById('u-email').value.trim(),
        role,
        dev_subteam: devSubteam,
        permissions,
        jb_role,
        schedule_include: scheduleInclude,
        course_include:   courseInclude,
        exam_include:     examInclude,
        phone, tmn_id, net_home, net_mobile,
      };
      if (isSuperAdmin) updateBody.extra_pages = getExtraPages();
      res = await API.users.update(id, updateBody);
      // Save schedule color for SM users
      if (!isExt && res?.ok) {
        await API.userColors.set({ [id]: scheduleColor });
        userColorsCache[id] = scheduleColor;
      }
    } else {
      const username = document.getElementById('u-username').value.trim();
      if (!username) { umSwitchTab('account'); document.getElementById('u-username').focus(); Toast.warning('Username is required'); spin.classList.add('hidden'); text.textContent = 'Create User'; return; }

      // team: super_admin must pick from dropdown; sm_admin uses own team (backend enforces)
      const payload = {
        name, name_th, nickname, emp_id, username,
        email: document.getElementById('u-email').value.trim(),
        role, dev_subteam: devSubteam, permissions, jb_role,
        schedule_include: scheduleInclude,
        course_include:   courseInclude,
        exam_include:     examInclude,
        phone, tmn_id, net_home, net_mobile,
      };
      // super_viewer/dev_user have no team picker — backend resolves automatically.
      if (isSuperAdmin && role !== 'super_viewer' && role !== 'dev_user') {
        const teamSel = document.getElementById('u-team');
        const teamVal = teamSel?.value || '';
        if (!teamVal) { umSwitchTab('account'); teamSel.focus(); Toast.warning('Team is required'); spin.classList.add('hidden'); text.textContent = 'Create User'; return; }
        payload.team = teamVal;
      }

      res = await API.users.create(payload);
      // Save schedule color for newly created SM users
      if (!isExt && res?.ok && res.data?.data?.id) {
        const newId = res.data.data.id;
        await API.userColors.set({ [newId]: scheduleColor });
        userColorsCache[newId] = scheduleColor;
      }
    }

    spin.classList.add('hidden');
    text.textContent = id ? 'Save Changes' : 'Create User';

    if (res?.ok) {
      Modal.close('user-modal');
      if (!id && res.data.data?.sent_to) {
        Toast.success(`สร้าง user "${name}" สำเร็จ — ส่ง temp password ไปที่ ${res.data.data.sent_to} แล้ว`, 6000);
      } else {
        Toast.success(id ? 'User updated!' : 'User created!');
      }
      loadUsers();
    } else if (res?.data?.code === 'SMTP_NOT_CONFIGURED') {
      const go = await confirmDialog(
        (res.data.message || 'SMTP ยังไม่ได้ตั้งค่า') + '\n\nไปที่หน้า Mail Config เลยไหม?',
        'ต้องตั้งค่า Mail Config ก่อน',
        { confirmText: 'ไปหน้า Mail Config', cancelText: 'ยกเลิก', variant: 'primary' }
      );
      if (go) window.location.href = 'mail-config.html';
    } else {
      Toast.error(res?.data?.message || 'Failed to save user');
    }
  }

  async function resetPw(id, name) {
    const confirmed = await confirmDialog(
      `ส่งลิงก์รีเซ็ตรหัสผ่านไปยังอีเมลของ "${name}"?\n\nลิงก์มีอายุ 24 ชั่วโมง — รหัสผ่านปัจจุบันของ user ยังใช้ได้จนกว่าจะตั้งรหัสใหม่จากลิงก์ในเมล`,
      'Send Reset Link'
    );
    if (!confirmed) return;
    const res = await API.users.resetPassword(id);
    if (res?.ok) {
      const sentTo = res.data.data?.sent_to || 'อีเมลที่ลงทะเบียน';
      Toast.success(`ส่งลิงก์รีเซ็ตรหัสผ่านไปที่ ${sentTo} แล้ว — ลิงก์มีอายุ 24 ชม.`, 6000);
      loadUsers();
    } else if (res?.data?.code === 'SMTP_NOT_CONFIGURED') {
      const go = await confirmDialog(
        (res.data.message || 'SMTP ยังไม่ได้ตั้งค่า') + '\n\nไปที่หน้า Mail Config เลยไหม?',
        'ต้องตั้งค่า Mail Config ก่อน',
        { confirmText: 'ไปหน้า Mail Config', cancelText: 'ยกเลิก', variant: 'primary' }
      );
      if (go) window.location.href = 'mail-config.html';
    } else {
      Toast.error(res?.data?.message || 'Reset failed');
    }
  }

  async function forceReset(id, name) {
    const confirmed = await confirmDialog(
      `บังคับให้ "${name}" เปลี่ยนรหัสผ่านในครั้ง login ถัดไป?\n(user ยังสามารถใช้งานระบบได้จนกว่าจะ logout)`,
      'Force Password Reset'
    );
    if (!confirmed) return;
    const res = await API.users.forceReset(id);
    if (res?.ok) { Toast.success(`บังคับ reset สำหรับ "${name}" แล้ว`); loadUsers(); }
    else Toast.error(res?.data?.message || 'Failed to force reset');
  }

  async function deleteUser(id, name) {
    const confirmed = await confirmDialog(`Delete user "${name}"? This cannot be undone.`, 'Delete User');
    if (!confirmed) return;
    const res = await API.users.delete(id);
    if (res?.ok) {
      Toast.success('User deleted');
      loadUsers();
    } else {
      Toast.error(res?.data?.message || 'Failed to delete');
    }
  }

  async function resetLoginBlock(username, name) {
    const confirmed = await confirmDialog(
      `ปลดล็อคการ login สำหรับ "${name}" (${username})?\n\nจะลบข้อมูลการ login ผิดและให้สามารถ login ได้ทันที`,
      'Unlock Login'
    );
    if (!confirmed) return;
    const res = await API.users.resetLoginBlock(username);
    if (res?.ok) {
      Toast.success(`ปลดล็อคการ login สำหรับ "${name}" แล้ว`);
    } else {
      Toast.error(res?.data?.message || 'Failed to unlock');
    }
  }

  // ── Date helpers ─────────────────────────────────────────
  function fmtDate(iso) {
    if (!iso) return '<span class="pw-exp-na">—</span>';
    const d = new Date(iso);
    if (isNaN(d)) return '<span class="pw-exp-na">—</span>';
    return d.toLocaleDateString('th-TH', { day:'2-digit', month:'short', year:'2-digit' });
  }

  function pwExpiryCell(u) {
    if (u.first_login || !u.password_changed_at) {
      return '<span class="pw-exp-na">—</span>';
    }
    if (u.password_expired) {
      return '<span class="pw-exp-dead">Expired</span>';
    }
    const changed  = new Date(u.password_changed_at);
    const expiresAt = new Date(changed.getTime() + pwExpiryDays * 86400000);
    const daysLeft  = Math.ceil((expiresAt - Date.now()) / 86400000);
    if (daysLeft <= 0) return '<span class="pw-exp-dead">Expired</span>';
    if (daysLeft <= 7) return `<span class="pw-exp-dead"><i data-icon="alert-triangle"></i> ${daysLeft}d left</span>`;
    if (daysLeft <= 14) return `<span class="pw-exp-warn">${daysLeft}d left</span>`;
    return `<span class="pw-exp-ok">${daysLeft}d left</span>`;
  }

  // Search filter
  const doSearch = debounce(() => {
    applyFilters();
  }, 300);
  document.getElementById('user-search').addEventListener('input', doSearch);

  loadUsers();

  // Show Dev Team / My Team toggle for SM admins
  if (!isSuperAdmin) {
    const devBtn  = document.getElementById('dev-team-btn');
    const myBtn   = document.getElementById('my-team-btn');
    if (_activeTeamSlug === 'dev') {
      if (myBtn) myBtn.style.display = '';   // show "back to my team"
    } else {
      if (devBtn) devBtn.style.display = ''; // show "go to dev team"
    }
  }

  // Deep-link: ?create=1&role=xxx → auto-open create modal with role preselected.
  // Used by admin/super-viewer.html "+ Create Super Viewer" button to hand off
  // to this page's proper create form (no need to duplicate that UI).
  (function _handleCreateDeepLink() {
    const qp = new URLSearchParams(window.location.search);
    if (qp.get('create') !== '1') return;
    const roleWanted = qp.get('role') || '';
    // Give populateRoleOptions a tick to be ready
    setTimeout(async () => {
      try {
        await openCreateUser();
        if (roleWanted) {
          const roleSel = document.getElementById('u-role');
          if (roleSel && [...roleSel.options].some(o => o.value === roleWanted)) {
            roleSel.value = roleWanted;
            if (typeof onRoleChange === 'function') onRoleChange();
          }
        }
      } catch (_) {}
    }, 250);
  })();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "applyFilters", { configurable: true, get: () => applyFilters, set: (v) => { applyFilters = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "buildPermGrid", { configurable: true, get: () => buildPermGrid, set: (v) => { buildPermGrid = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "bulkDelete", { configurable: true, get: () => bulkDelete, set: (v) => { bulkDelete = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "bulkResetPw", { configurable: true, get: () => bulkResetPw, set: (v) => { bulkResetPw = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "clearSelection", { configurable: true, get: () => clearSelection, set: (v) => { clearSelection = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "deleteUser", { configurable: true, get: () => deleteUser, set: (v) => { deleteUser = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "editUser", { configurable: true, get: () => editUser, set: (v) => { editUser = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "exitDevMode", { configurable: true, get: () => exitDevMode, set: (v) => { exitDevMode = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtDate", { configurable: true, get: () => fmtDate, set: (v) => { fmtDate = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "forceReset", { configurable: true, get: () => forceReset, set: (v) => { forceReset = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "addExtraPageRow",    { configurable: true, get: () => addExtraPageRow,    set: (v) => { addExtraPageRow = v;    } }); } catch (e) {}
  try { Object.defineProperty(window, "_refreshEmptyEpMsg", { configurable: true, get: () => _refreshEmptyEpMsg, set: (v) => { _refreshEmptyEpMsg = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "getCheckedPerms", { configurable: true, get: () => getCheckedPerms, set: (v) => { getCheckedPerms = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadDevSubteams", { configurable: true, get: () => loadDevSubteams, set: (v) => { loadDevSubteams = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadPagePermissionsList", { configurable: true, get: () => loadPagePermissionsList, set: (v) => { loadPagePermissionsList = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadUsers", { configurable: true, get: () => loadUsers, set: (v) => { loadUsers = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "onRoleChange", { configurable: true, get: () => onRoleChange, set: (v) => { onRoleChange = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "onTeamFilterChange", { configurable: true, get: () => onTeamFilterChange, set: (v) => { onTeamFilterChange = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openCreateUser", { configurable: true, get: () => openCreateUser, set: (v) => { openCreateUser = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "populateRoleOptions", { configurable: true, get: () => populateRoleOptions, set: (v) => { populateRoleOptions = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "pwExpiryCell", { configurable: true, get: () => pwExpiryCell, set: (v) => { pwExpiryCell = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderUsersCards", { configurable: true, get: () => renderUsersCards, set: (v) => { renderUsersCards = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderUsersTable", { configurable: true, get: () => renderUsersTable, set: (v) => { renderUsersTable = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "resetLoginBlock", { configurable: true, get: () => resetLoginBlock, set: (v) => { resetLoginBlock = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "resetPw", { configurable: true, get: () => resetPw, set: (v) => { resetPw = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "saveUser", { configurable: true, get: () => saveUser, set: (v) => { saveUser = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setColor", { configurable: true, get: () => setColor, set: (v) => { setColor = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "switchView", { configurable: true, get: () => switchView, set: (v) => { switchView = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "syncSelectAll", { configurable: true, get: () => syncSelectAll, set: (v) => { syncSelectAll = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toggleSelect", { configurable: true, get: () => toggleSelect, set: (v) => { toggleSelect = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toggleSelectAll", { configurable: true, get: () => toggleSelectAll, set: (v) => { toggleSelectAll = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "umActiveTab", { configurable: true, get: () => umActiveTab, set: (v) => { umActiveTab = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "umSwitchTab", { configurable: true, get: () => umSwitchTab, set: (v) => { umSwitchTab = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updateBulkBar", { configurable: true, get: () => updateBulkBar, set: (v) => { updateBulkBar = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updateStats", { configurable: true, get: () => updateStats, set: (v) => { updateStats = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "viewProfile", { configurable: true, get: () => viewProfile, set: (v) => { viewProfile = v; } }); } catch (e) {}
})();
