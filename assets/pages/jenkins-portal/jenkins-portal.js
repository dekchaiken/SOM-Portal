// jenkins-portal — page script, extracted from jenkins-portal.html.
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
  Layout.render('jenkins-portal');

  const state = {
    tools: [], servers: {}, apps: [], canAdmin: false,
    history: [], sessions: [], users: [],
    toolId: null, panel: null,
    histFilter: 'all', histSearch: '',
  };

  const $ = id => document.getElementById(id);

  // ── Panel navigation ───────────────────────────────────────────────────────
  // Default view is the Trigger form (always visible). History/Admin slide in
  // as panels that temporarily replace the form; back button restores it.
  function backToTrigger() {
    $('jp-panels').classList.remove('visible');
    document.querySelectorAll('#jp-panels > div').forEach(p => { p.style.display = 'none'; });
    $('jp-panel-trigger').style.display = '';
    state.panel = null;
  }

  function openPanel(name) {
    const target = $('jp-panel-' + name);
    if (!target) { backToTrigger(); return; }
    $('jp-panel-trigger').style.display = 'none';
    document.querySelectorAll('#jp-panels > div').forEach(p => { p.style.display = 'none'; });
    target.style.display = '';
    target.classList.remove('jp-panel-enter');
    void target.offsetWidth; // restart animation
    target.classList.add('jp-panel-enter');
    $('jp-panels').classList.add('visible');
    state.panel = name;
    if (name === 'history') renderHistory();
    if (name === 'admin')   renderAdmin();
  }

  // ── Loaders ────────────────────────────────────────────────────────────────
  async function loadConfig() {
    const res = await API.get('/jenkins-portal/');
    if (!res?.ok) throw new Error(res?.data?.message || 'โหลดไม่สำเร็จ');
    const d = res.data.data;
    state.tools    = d.tools   || [];
    state.servers  = d.servers || {};
    state.apps     = d.apps    || [];
    state.canAdmin = !!d.can_admin;

    $('jp-admin-banner').style.display = state.canAdmin ? '' : 'none';
    $('jp-btn-admin').style.display    = state.canAdmin ? '' : 'none';
    $('jp-hist-clear').style.display   = state.canAdmin ? '' : 'none';
    $('jp-hist-export').style.display  = state.canAdmin ? '' : 'none';
    if (state.canAdmin) $('jp-page-sub').textContent = 'Admin — จัดการได้ที่ปุ่ม "Admin" มุมขวาบน';

    if (!state.tools.length) {
      $('jp-loading').textContent = 'ทีมของคุณยังไม่มี Jenkins tool ที่เปิดใช้งาน — ติดต่อ Admin';
      $('jp-loading').style.display = '';
      return;
    }
    const _jpUrlTool = new URLSearchParams(location.search).get('tool');
    if (_jpUrlTool && state.tools.find(t => String(t.id) === _jpUrlTool)) {
      state.toolId = Number(_jpUrlTool) || _jpUrlTool;
    }
    if (!state.toolId || !state.tools.find(t => t.id === state.toolId)) {
      state.toolId = state.tools[0].id;
    }
    const _jp = new URLSearchParams({ tool: String(state.toolId) });
    history.replaceState(null, '', '?' + _jp.toString());
    renderStats(d.stats || {});
    renderForm();
    renderServerPill();
    if (state.panel === 'admin') renderAdmin();
  }

  async function loadStatus() {
    try {
      const res = await API.get('/jenkins-portal/?status=1');
      const el = $('jp-jenkins-status');
      if (!res?.ok) { el.textContent = 'ไม่สามารถเช็คได้'; el.className = 'jp-status-value bad'; return; }
      const d = res.data.data || {};
      if (d.reachable) {
        el.textContent = 'Connected' + (d.last_build ? ' · #' + d.last_build.number : '');
        el.className = 'jp-status-value ok';
      } else {
        el.textContent = 'Offline / Unreachable';
        el.className = 'jp-status-value bad';
      }
    } catch (e) {
      $('jp-jenkins-status').textContent = '—';
    }
  }

  function renderStats(stats) {
    $('jp-last-build').textContent = stats.last_build ? '#' + stats.last_build : '—';
    $('jp-success-rate').textContent = stats.success_rate !== null && stats.success_rate !== undefined
      ? stats.success_rate + '%' : '—';
  }

  async function loadHistory() {
    const res = await API.get('/jenkins-portal/?history=1');
    if (!res?.ok) return;
    state.history = res.data.data || [];
    renderHistory();
    // Refresh stats locally after history syncs
    const recent = state.history.slice(0, 50);
    const succ = recent.filter(h => String(h.status).toLowerCase() === 'success').length;
    const last = state.history.find(h => h.build_id);
    $('jp-last-build').textContent = last && last.build_id ? '#' + last.build_id : '—';
    $('jp-success-rate').textContent = recent.length ? Math.round(succ / recent.length * 100) + '%' : '—';
  }

  // ── Trigger form ────────────────────────────────────────────────────────────
  function renderServerPill() {
    const tool = state.tools.find(t => t.id === state.toolId);
    const srv  = tool ? state.servers[tool.server_id] : null;
    $('jp-toolbar-server').textContent = srv ? '🔗 ' + (srv.display || srv.base_url) : '🔗 server not configured';
  }

  function renderForm() {
    const tool = state.tools.find(t => t.id === state.toolId);
    const form = $('jp-form');
    if (!tool) { form.innerHTML = '<div class="jp-empty">ไม่พบ tool</div>'; return; }

    $('jp-form-desc').textContent = tool.description || '';
    renderServerPill();

    form.innerHTML = (tool.params || []).map(p => {
      const label = escHtml(p.label || p.key) + (p.required ? ' <span style="color:#ef4444">*</span>' : '');
      const hint = p.hint ? `<div class="jp-hint">${escHtml(p.hint)}</div>` : '';
      const err  = '<div class="jp-err">รูปแบบไม่ถูกต้อง</div>';
      if (p.type === 'options' && p.source === 'apps') {
        const opts = '<option value="">— เลือก Application —</option>' + state.apps
          .filter(a => !('enabled' in a) || a.enabled)
          .map(a => `<option value="${escHtml(a.name)}">${escHtml(a.name)}</option>`).join('');
        return `<div class="jp-field" data-key="${escHtml(p.key)}">
          <label>${label}</label>
          <select data-key="${escHtml(p.key)}" data-required="${p.required ? 1 : 0}">${opts}</select>
          ${hint}${err}</div>`;
      }
      const readonly = (tool.auto_params || {})[p.key] ? ' readonly class="jp-readonly"' : '';
      return `<div class="jp-field" data-key="${escHtml(p.key)}">
        <label>${label}</label>
        <input type="text" data-key="${escHtml(p.key)}" placeholder="${escHtml(p.placeholder || '')}"
               data-pattern="${escHtml(p.pattern || '')}" data-required="${p.required ? 1 : 0}"
               ${p.required ? 'required' : ''}${readonly}>
        ${hint}${err}</div>`;
    }).join('') + `
      <button type="submit" class="jp-submit" id="jp-submit-btn">
        <span>⚡</span> Trigger Build
      </button>`;

    const me = Auth.getUser();
    form.querySelectorAll('input[readonly]').forEach(inp => {
      const key = inp.dataset.key;
      const tool2 = state.tools.find(t => t.id === state.toolId);
      if ((tool2.auto_params || {})[key] === 'username') inp.value = me?.username || '';
    });

    form.querySelectorAll('input, select').forEach(el => {
      el.addEventListener('input', () => validateField(el));
      el.addEventListener('change', () => { validateField(el); updateSubmitState(); });
      el.addEventListener('input', updateSubmitState);
    });
    updateSubmitState();
  }

  function validateField(el) {
    const field = el.closest('.jp-field');
    const pattern = el.dataset.pattern;
    const val = el.value.trim();
    let ok = true;
    if (el.dataset.required === '1' && val === '') ok = false;
    else if (val && pattern) { try { ok = new RegExp('^(?:' + pattern + ')$').test(val); } catch { ok = true; } }
    el.classList.toggle('jp-invalid', !ok);
    field.classList.toggle('jp-has-err', !ok && val !== '');
    return ok;
  }

  function updateSubmitState() {
    const btn = $('jp-submit-btn');
    if (!btn) return;
    const els = [...$('jp-form').querySelectorAll('input, select')];
    btn.disabled = !els.every(validateField) || els.some(i => i.dataset.required === '1' && !i.value.trim());
  }

  const _jpForm = document.getElementById('jp-form');
  if (_jpForm) {
    _jpForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const tool = state.tools.find(t => t.id === state.toolId);
      if (!tool) return;

      const params = {};
      $('jp-form').querySelectorAll('input, select').forEach(el => { params[el.dataset.key] = el.value.trim(); });

      const res = await API.post('/jenkins-portal/', { action: 'trigger', tool_id: state.toolId, params });
      if (!res?.ok) { Toast.error(res?.data?.message || 'Trigger ล้มเหลว'); return; }

      const d = res.data.data;
      Toast.success('Build ถูก queue แล้ว');
      $('jp-form').reset();
      const me = Auth.getUser();
      $('jp-form').querySelectorAll('input[readonly]').forEach(inp => { inp.value = me?.username || ''; });
      updateSubmitState();
      if (d.queue_id) openProgress(d.queue_id);
      await loadHistory();
    });
  }

  // ── History ────────────────────────────────────────────────────────────────
  function statusBadge(status) {
    const s = String(status || '').toLowerCase();
    const map = {
      success: ['jp-b-success', 'Success'], failure: ['jp-b-failure', 'Failure'],
      aborted: ['jp-b-aborted', 'Aborted'],
      queued: ['jp-b-running', 'Queued'], 'in queue': ['jp-b-running', 'In Queue'],
      building: ['jp-b-running', 'Building'],
    };
    const [cls, label] = map[s] || ['jp-b-unknown', status || 'Unknown'];
    return `<span class="jp-badge ${cls}">${escHtml(label)}</span>`;
  }

  function renderHistory() {
    const failedSet = new Set(['failed', 'failure', 'error', 'aborted']);
    const rows = state.history.filter(h => {
      const s = String(h.status || '').toLowerCase();
      if (state.histFilter === 'success' && s !== 'success') return false;
      if (state.histFilter === 'failed'  && !failedSet.has(s)) return false;
      if (state.histFilter === 'today') {
        const d = new Date(h.ts || h.timestamp);
        if (!isNaN(d) && d.toDateString() !== new Date().toDateString()) return false;
      }
      if (state.histSearch) {
        const q = state.histSearch.toLowerCase();
        const p = h.params || {};
        const hay = [p.tmnId, p.ticket, p.app, h.user_name, h.user, h.user_id].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    $('jp-history-count').textContent = rows.length;
    const body = $('jp-history-body');
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="7" class="jp-empty">' +
        (state.history.length ? 'ไม่มีรายการตรงเงื่อนไข' : 'ยังไม่มีประวัติ') + '</td></tr>';
      return;
    }
    body.innerHTML = rows.map(h => {
      const p = h.params || {};
      return `<tr>
        <td class="jp-meta-cell jp-mono">${escHtml(fmtTime(h.ts || h.timestamp))}</td>
        <td>${statusBadge(h.status)}</td>
        <td class="jp-meta-cell">${escHtml(h.user_name || h.user || '')}</td>
        <td class="jp-mono">${escHtml(p.tmnId || '')}</td>
        <td>${escHtml(p.ticket || '')}</td>
        <td>${escHtml(p.app || '')}</td>
        <td class="jp-mono">${h.build_id ? '#' + escHtml(String(h.build_id)) : ''}</td>
      </tr>`;
    }).join('');
  }

  // ── Admin panel ────────────────────────────────────────────────────────────
  document.querySelectorAll('.jpa-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.jpa-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.jpa-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      $('jpa-panel-' + btn.dataset.tab).classList.add('active');
    });
  });

  function renderAdmin() {
    renderApps();
    renderUsers();
    renderSettings();
  }

  function renderApps() {
    const body = $('jpa-app-body');
    if (!state.apps.length) {
      body.innerHTML = '<tr><td colspan="5" class="jp-empty">ยังไม่มี Application</td></tr>';
      return;
    }
    body.innerHTML = state.apps.map(a => `<tr>
      <td style="font-weight:700">${escHtml(a.name)}</td>
      <td>${a.enabled === false
        ? '<span class="jp-badge jp-b-aborted">ปิด</span>'
        : '<span class="jp-badge jp-b-success">เปิด</span>'}</td>
      <td class="jp-meta-cell">${escHtml(a.created_at || '')}</td>
      <td class="jp-meta-cell">${escHtml(a.created_by || '')}</td>
      <td><div class="jpa-actions">
        <button class="jp-btn" onclick="toggleApp('${escHtml(String(a.id))}')">${a.enabled === false ? 'เปิด' : 'ปิด'}</button>
        <button class="jp-btn jp-btn-danger" onclick="deleteApp('${escHtml(String(a.id))}')">ลบ</button>
      </div></td>
    </tr>`).join('');
  }

  function renderUsers() {
    const body = $('jpa-user-body');
    if (!state.users.length) {
      body.innerHTML = '<tr><td colspan="5" class="jp-empty">ยังไม่มีผู้ใช้</td></tr>';
      return;
    }
    body.innerHTML = state.users.map(u => `<tr>
      <td style="font-weight:700">${escHtml(u.username)}</td>
      <td class="jp-meta-cell">${escHtml(u.email || '')}</td>
      <td>${u.jp_role === 'admin'
        ? '<span class="jp-badge" style="background:rgba(242,100,25,.14);color:var(--orange)">Admin</span>'
        : '<span class="jp-badge" style="background:rgba(59,130,246,.13);color:#3b82f6">User</span>'}</td>
      <td>${u.status === 'locked'
        ? '<span class="jp-badge" style="background:rgba(239,68,68,.13);color:#ef4444">Locked</span>'
        : '<span class="jp-badge jp-b-success">Active</span>'}</td>
      <td><div class="jpa-actions">
        <button class="jp-btn" onclick="promoteUser('${escHtml(u.id)}')">${u.jp_role === 'admin' ? '→ user' : '→ admin'}</button>
        <button class="jp-btn" onclick="resetPw('${escHtml(u.id)}')">รีเซ็ตรหัส</button>
        ${u.status === 'locked' ? `<button class="jp-btn" onclick="unlockUser('${escHtml(u.id)}')">ปลดล็อค</button>` : ''}
        <button class="jp-btn jp-btn-danger" onclick="deleteUser('${escHtml(u.id)}')">ลบ</button>
      </div></td>
    </tr>`).join('');
  }

  function renderSettings() {
    const me = Auth.getUser();
    $('jpa-me-kv').innerHTML = `
      <div class="jpa-kv-row"><b>Username</b><span>${escHtml(me?.username || '')}</span></div>
      <div class="jpa-kv-row"><b>Name</b><span>${escHtml(me?.name || '')}</span></div>
      <div class="jpa-kv-row"><b>Role</b><span>${escHtml(me?.role || '')} (${escHtml(me?.permissions?.join(', ') || '')})</span></div>
      <div class="jpa-kv-row"><b>Team</b><span>${escHtml(me?.team || '')}</span></div>`;

    const srvRows = Object.entries(state.servers).map(([id, s]) => `
      <div class="jpa-kv-row"><b>${escHtml(id)}</b><span class="jp-mono">${escHtml(s.display || '')} — ${escHtml(s.base_url || '')}</span></div>`).join('');
    const tool = state.tools[0];
    const toolRows = tool ? `
      <div class="jpa-kv-row"><b>Job Name</b><span class="jp-mono">${escHtml(tool.name || tool.id)}</span></div>
      <div class="jpa-kv-row"><b>Job Path</b><span class="jp-mono">${escHtml(tool.job_path || '')}</span></div>
      <div class="jpa-kv-row"><b>Params</b><span>${escHtml((tool.params || []).map(p => p.label || p.key).join(' · '))}</span></div>` : '';
    $('jpa-server-kv').innerHTML = srvRows + toolRows || '<div class="jp-empty">ไม่พบ config</div>';
  }

  // ── Admin actions ──────────────────────────────────────────────────────────
  $('jpa-app-add').addEventListener('click', async () => {
    const name = $('jpa-app-name').value.trim();
    if (!name) { Toast.error('กรุณากรอกชื่อ Application'); return; }
    const res = await API.post('/jenkins-portal/', {
      action: 'add_app', name, enabled: $('jpa-app-enabled').value === '1',
    });
    if (!res?.ok) { Toast.error(res?.data?.message || 'เพิ่มไม่สำเร็จ'); return; }
    Toast.success('เพิ่ม Application เรียบร้อย');
    $('jpa-app-name').value = '';
    await reloadAll();
  });

  async function toggleApp(id) {
    const app = state.apps.find(a => String(a.id) === id);
    if (!app) return;
    const res = await API.post('/jenkins-portal/', { action: 'update_app', id: Number(id), enabled: !(app.enabled === false) ? false : true });
    if (!res?.ok) { Toast.error(res?.data?.message || 'อัปเดตไม่สำเร็จ'); return; }
    Toast.success('อัปเดตเรียบร้อย');
    await reloadAll();
  }

  async function deleteApp(id) {
    const app = state.apps.find(a => String(a.id) === id);
    if (!await confirmDialog('Application: ' + (app?.name || id), 'ลบ Application?',
      { confirmText: 'ลบ', cancelText: 'ยกเลิก' })) return;
    const res = await API.post('/jenkins-portal/', { action: 'delete_app', id: Number(id) });
    if (!res?.ok) { Toast.error(res?.data?.message || 'ลบไม่สำเร็จ'); return; }
    Toast.success('ลบเรียบร้อย');
    await reloadAll();
  }

  $('jpa-user-add').addEventListener('click', async () => {
    const username = $('jpa-user-username').value.trim();
    const email = $('jpa-user-email').value.trim();
    if (!username || !email) { Toast.error('กรุณากรอก username และ email'); return; }
    const res = await API.post('/jenkins-portal/', {
      action: 'create_user', username, email, jp_role: $('jpa-user-role').value,
    });
    if (!res?.ok) { Toast.error(res?.data?.message || 'สร้างไม่สำเร็จ'); return; }
    Toast.success(`สร้างผู้ใช้สำเร็จ — รหัสผ่านชั่วคราว: ${res.data.data.temp_password}`);
    $('jpa-user-username').value = '';
    $('jpa-user-email').value = '';
    await reloadAll();
  });

  async function promoteUser(id) {
    const u = state.users.find(x => x.id === id);
    if (!u) return;
    const res = await API.post('/jenkins-portal/', { action: 'update_user', user_id: id, jp_role: u.jp_role === 'admin' ? 'user' : 'admin' });
    if (!res?.ok) { Toast.error(res?.data?.message || 'อัปเดตไม่สำเร็จ'); return; }
    Toast.success('เปลี่ยน Role เรียบร้อย');
    await reloadAll();
  }

  async function resetPw(id) {
    if (!await confirmDialog('ผู้ใช้จะต้องใช้รหัสผ่านชั่วคราวในการ login ครั้งต่อไป', 'รีเซ็ตรหัสผ่าน?',
      { variant: 'primary', confirmText: 'รีเซ็ต', cancelText: 'ยกเลิก' })) return;
    const res = await API.post('/jenkins-portal/', { action: 'reset_password', user_id: id });
    if (!res?.ok) { Toast.error(res?.data?.message || 'รีเซ็ตไม่สำเร็จ'); return; }
    Toast.success(`รหัสผ่านชั่วคราวใหม่: ${res.data.data.temp_password}`);
    await reloadAll();
  }

  async function unlockUser(id) {
    const res = await API.post('/jenkins-portal/', { action: 'unlock_user', user_id: id });
    if (!res?.ok) { Toast.error(res?.data?.message || 'ปลดล็อคไม่สำเร็จ'); return; }
    Toast.success('ปลดล็อคเรียบร้อย');
    await reloadAll();
  }

  async function deleteUser(id) {
    if (!await confirmDialog('ผู้ใช้จะถูกลบออกจาก Jenkins Portal อย่างถาวร', 'ลบผู้ใช้?',
      { confirmText: 'ลบ', cancelText: 'ยกเลิก' })) return;
    const res = await API.post('/jenkins-portal/', { action: 'delete_user', user_id: id });
    if (!res?.ok) { Toast.error(res?.data?.message || 'ลบไม่สำเร็จ'); return; }
    Toast.success('ลบผู้ใช้เรียบร้อย');
    await reloadAll();
  }

  // ── History controls (merged from old Logs panel) ──────────────────────────
  $('jp-hist-filter').addEventListener('change', e => { state.histFilter = e.target.value; renderHistory(); });
  $('jp-hist-search').addEventListener('input',  e => { state.histSearch = e.target.value; renderHistory(); });
  $('jp-hist-clear').addEventListener('click', async () => {
    if (!await confirmDialog('ประวัติทั้งหมดจะถูกลบถาวร ไม่สามารถกู้คืนได้', 'ล้างประวัติทั้งหมด?',
      { confirmText: 'ล้าง', cancelText: 'ยกเลิก' })) return;
    const res = await API.post('/jenkins-portal/', { action: 'clear_history' });
    if (!res?.ok) { Toast.error(res?.data?.message || 'ล้างไม่สำเร็จ'); return; }
    Toast.success('ล้างประวัติเรียบร้อย');
    await loadHistory();
  });
  $('jp-hist-export').addEventListener('click', () => {
    const rows = state.history.map(h => {
      const p = h.params || {};
      return [h.ts || h.timestamp || '', h.status || '', h.user_name || h.user || '',
              p.tmnId || '', p.ticket || '', p.app || '', h.build_id || ''];
    });
    const csv = '\uFEFF' + ['Time,Status,User,TMN ID,Ticket,App,Build', ...rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'jenkins-build-history.csv';
    a.click();
  });

  // ── Header buttons ─────────────────────────────────────────────────────────
  $('jp-btn-history').addEventListener('click', () => openPanel('history'));
  $('jp-btn-admin').addEventListener('click',   () => openPanel('admin'));

  $('jp-refresh-btn').addEventListener('click', async () => {
    await Promise.all([loadHistory(), loadStatus()]);
    Toast.success('อัปเดตแล้ว');
  });

  // ── Progress modal ─────────────────────────────────────────────────────────
  function openProgress(queueId) {
    const tool = state.tools.find(t => t.id === state.toolId);
    if (!tool) return;
    const modal = $('jp-progress-modal');
    $('jp-modal-title').textContent = 'Executing Pipeline';
    $('jp-modal-status').textContent = 'Waiting in Jenkins queue...';
    $('jp-progress-bar').style.width = '0%';
    $('jp-progress-pct').textContent = '0%';
    $('jp-modal-result').style.display = 'none';
    $('jp-modal-close').style.display = 'none';
    modal.style.display = 'flex';

    let tries = 0;
    const poll = async () => {
      tries++;
      const res = await API.get(`/jenkins-portal/?action=status&tool_id=${encodeURIComponent(tool.id)}&queue_id=${encodeURIComponent(queueId)}`);
      if (!res?.ok) { $('jp-modal-status').textContent = 'Error polling status'; return; }
      const st = res.data.data || {};
      $('jp-progress-bar').style.width = (st.progress || 0) + '%';
      $('jp-progress-pct').textContent = (st.progress || 0) + '%';
      if (st.status === 'Finished') {
        $('jp-modal-status').textContent = 'Build completed.';
        $('jp-modal-title').textContent = 'Pipeline Finished';
        const result = (st.result || 'UNKNOWN').toUpperCase();
        const el = $('jp-modal-result');
        el.textContent = 'STATUS: ' + result;
        el.className = 'jp-modal-result ' + (result === 'SUCCESS' ? 'ok' : result === 'FAILURE' ? 'bad' : 'mid');
        el.style.display = 'block';
        $('jp-progress-bar').style.width = '100%';
        $('jp-progress-pct').textContent = '100%';
        $('jp-modal-close').style.display = '';
        await loadHistory();
        return;
      }
      if (st.status === 'Building') $('jp-modal-status').textContent = 'Processing pipeline steps...';
      if (st.status === 'In Queue') $('jp-modal-status').textContent = 'Waiting in Jenkins queue...';
      if (st.status === 'Unknown' && tries > 40) {
        $('jp-modal-status').textContent = 'ไม่สามารถติดตามสถานะได้ (Jenkins queue หมดอายุ) — ตรวจใน History';
        $('jp-modal-close').style.display = '';
        return;
      }
      setTimeout(poll, 1500);
    };
    poll();
  }

  $('jp-modal-close').addEventListener('click', () => { $('jp-progress-modal').style.display = 'none'; });

  // ── Misc ───────────────────────────────────────────────────────────────────
  function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // ── Boot ───────────────────────────────────────────────────────────────────
  async function reloadAll() {
    await Promise.all([loadConfig(), loadHistory()]);
    if (state.canAdmin) {
      const uRes = await API.get('/jenkins-portal/?users=1');
      if (uRes?.ok) state.users = (uRes.data.data || {}).users || [];
      if (state.panel === 'admin') renderUsers();
    }
  }

  (async function init() {
    try {
      await reloadAll();
      $('jp-loading').style.display = 'none';
      $('jp-body').style.display = '';
      // Default view = Trigger form (already visible); panels hidden.
      backToTrigger();
      // Non-blocking Jenkins reachability check (upstream may take ~30s to time out).
      loadStatus();
    } catch (e) {
      $('jp-loading').textContent = e.message;
    }
    setInterval(loadHistory, 30_000);
  })();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "backToTrigger", { configurable: true, get: () => backToTrigger, set: (v) => { backToTrigger = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "deleteApp", { configurable: true, get: () => deleteApp, set: (v) => { deleteApp = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "deleteUser", { configurable: true, get: () => deleteUser, set: (v) => { deleteUser = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtTime", { configurable: true, get: () => fmtTime, set: (v) => { fmtTime = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadConfig", { configurable: true, get: () => loadConfig, set: (v) => { loadConfig = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadHistory", { configurable: true, get: () => loadHistory, set: (v) => { loadHistory = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadStatus", { configurable: true, get: () => loadStatus, set: (v) => { loadStatus = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openPanel", { configurable: true, get: () => openPanel, set: (v) => { openPanel = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openProgress", { configurable: true, get: () => openProgress, set: (v) => { openProgress = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "promoteUser", { configurable: true, get: () => promoteUser, set: (v) => { promoteUser = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "reloadAll", { configurable: true, get: () => reloadAll, set: (v) => { reloadAll = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderAdmin", { configurable: true, get: () => renderAdmin, set: (v) => { renderAdmin = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderApps", { configurable: true, get: () => renderApps, set: (v) => { renderApps = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderForm", { configurable: true, get: () => renderForm, set: (v) => { renderForm = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderHistory", { configurable: true, get: () => renderHistory, set: (v) => { renderHistory = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderServerPill", { configurable: true, get: () => renderServerPill, set: (v) => { renderServerPill = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderSettings", { configurable: true, get: () => renderSettings, set: (v) => { renderSettings = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderStats", { configurable: true, get: () => renderStats, set: (v) => { renderStats = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderUsers", { configurable: true, get: () => renderUsers, set: (v) => { renderUsers = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "resetPw", { configurable: true, get: () => resetPw, set: (v) => { resetPw = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "statusBadge", { configurable: true, get: () => statusBadge, set: (v) => { statusBadge = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toggleApp", { configurable: true, get: () => toggleApp, set: (v) => { toggleApp = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "unlockUser", { configurable: true, get: () => unlockUser, set: (v) => { unlockUser = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updateSubmitState", { configurable: true, get: () => updateSubmitState, set: (v) => { updateSubmitState = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "validateField", { configurable: true, get: () => validateField, set: (v) => { validateField = v; } }); } catch (e) {}
})();
