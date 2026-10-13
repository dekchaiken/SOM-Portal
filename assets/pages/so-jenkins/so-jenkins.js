// so-jenkins — page script, extracted from so-jenkins.html.
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
  Layout.render('so-jenkins');

  const state = {
    tools: [], servers: {}, canAdmin: false,
    history: [], users: [],
    toolId: null, panel: null,
    histFilter: 'all', histSearch: '',
  };

  const $ = id => document.getElementById(id);

  // ── Panel navigation ───────────────────────────────────────────────────────
  // Default view is the Trigger form (always visible). History/Admin slide in
  // as panels that temporarily replace the form; back button restores it.
  function backToTrigger() {
    $('sj-panels').classList.remove('visible');
    document.querySelectorAll('#sj-panels > div').forEach(p => { p.style.display = 'none'; });
    $('sj-panel-trigger').style.display = '';
    state.panel = null;
  }

  function openPanel(name) {
    const target = $('sj-panel-' + name);
    if (!target) { backToTrigger(); return; }
    $('sj-panel-trigger').style.display = 'none';
    document.querySelectorAll('#sj-panels > div').forEach(p => { p.style.display = 'none'; });
    target.style.display = '';
    target.classList.remove('sj-panel-enter');
    void target.offsetWidth; // restart animation
    target.classList.add('sj-panel-enter');
    $('sj-panels').classList.add('visible');
    state.panel = name;
    if (name === 'history') renderHistory();
    if (name === 'admin')   renderAdmin();
  }

  // ── Loaders ────────────────────────────────────────────────────────────────
  async function loadConfig() {
    const res = await API.get('/so-jenkins/');
    if (!res?.ok) throw new Error(res?.data?.message || 'โหลดไม่สำเร็จ');
    const d = res.data.data;
    state.tools    = d.tools   || [];
    state.servers  = d.servers || {};
    state.canAdmin = !!d.can_admin;

    $('sj-admin-banner').style.display = state.canAdmin ? '' : 'none';
    $('sj-btn-admin').style.display    = state.canAdmin ? '' : 'none';
    $('sj-hist-clear').style.display   = state.canAdmin ? '' : 'none';
    $('sj-hist-export').style.display  = state.canAdmin ? '' : 'none';
    if (state.canAdmin) $('sj-page-sub').textContent = 'Admin — จัดการได้ที่ปุ่ม "Admin" มุมขวาบน';

    if (!state.tools.length) {
      $('sj-loading').textContent = 'ทีมของคุณยังไม่มี Jenkins tool ที่เปิดใช้งาน — ติดต่อ Admin';
      $('sj-loading').style.display = '';
      return;
    }
    if (!state.toolId || !state.tools.find(t => t.id === state.toolId)) {
      state.toolId = state.tools[0].id;
    }
    renderStats(d.stats || {});
    renderServerPill();
    if (state.panel === 'admin') renderAdmin();
  }

  async function loadStatus() {
    const el = $('sj-jenkins-status');
    el.textContent = 'Checking...';
    el.className = 'sj-status-value';
    try {
      const res = await API.get('/so-jenkins/?status=1');
      if (!res?.ok) { el.textContent = 'ไม่สามารถเช็คได้'; el.className = 'sj-status-value bad'; return; }
      const d = res.data.data || {};
      if (d.reachable) {
        el.textContent = 'Connected' + (d.last_build ? ' · #' + d.last_build.number : '');
        el.className = 'sj-status-value ok';
      } else {
        // Show the underlying error so debugging isn't a black box.
        el.textContent = 'Offline';
        el.title = d.message || 'Unreachable';
        el.className = 'sj-status-value bad';
      }
    } catch (e) {
      el.textContent = '—';
    }
  }

  function renderStats(stats) {
    $('sj-last-build').textContent = stats.last_build ? '#' + stats.last_build : '—';
    $('sj-success-rate').textContent = stats.success_rate !== null && stats.success_rate !== undefined
      ? stats.success_rate + '%' : '—';
  }

  async function loadHistory() {
    const res = await API.get('/so-jenkins/?history=1');
    if (!res?.ok) return;
    state.history = res.data.data || [];
    renderHistory();
    const recent = state.history.slice(0, 50);
    const succ = recent.filter(h => String(h.status).toLowerCase() === 'success').length;
    const last = state.history.find(h => h.build_id);
    $('sj-last-build').textContent = last && last.build_id ? '#' + last.build_id : '—';
    $('sj-success-rate').textContent = recent.length ? Math.round(succ / recent.length * 100) + '%' : '—';
  }

  // ── Trigger ────────────────────────────────────────────────────────────────
  function renderServerPill() {
    const tool = state.tools.find(t => t.id === state.toolId);
    const srv  = tool ? state.servers[tool.server_id] : null;
    $('sj-toolbar-server').textContent = srv ? '🔗 ' + (srv.display || srv.base_url) : '🔗 server not configured';
  }

  $('sj-trigger-btn').addEventListener('click', async () => {
    if (!state.toolId) { Toast.error('ไม่พบ tool — ติดต่อ Admin'); return; }
    if (!await confirmDialog(
      'Job: acm-clt-rag-service-run-pipeline (Production)\nBuild จะเริ่มทันที',
      'ยืนยันการ Trigger Build?',
      { variant: 'primary', confirmText: '🚀 Trigger', cancelText: 'ยกเลิก' }
    )) return;
    const btn = $('sj-trigger-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="sj-spinner" style="display:inline-block;animation:sj-pulse 1.1s ease infinite">⏳</span> Triggering...';
    try {
      const res = await API.post('/so-jenkins/', { action: 'trigger', tool_id: state.toolId });
      if (!res?.ok) { Toast.error(res?.data?.message || 'Trigger ล้มเหลว'); return; }
      const d = res.data.data;
      Toast.success('Build ถูก queue แล้ว');
      if (d.queue_id) openProgress(d.queue_id);
      await loadHistory();
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<span>🚀</span> Trigger Build Now';
    }
  });

  // ── History ────────────────────────────────────────────────────────────────
  function fmtDuration(val) {
    if (!val) return '—';
    const ms = Number(val);
    if (isNaN(ms) || ms <= 0) return String(val);
    const s = Math.round(ms / 1000);
    if (s < 60) return s + 's';
    const m = Math.floor(s / 60), rem = s % 60;
    if (m < 60) return m + 'm' + (rem ? ' ' + rem + 's' : '');
    return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
  }

  function buildUrl(h) {
    if (!h.build_id) return null;
    const tool = state.tools.find(t => t.id === h.tool_id);
    if (!tool) return null;
    const srv = state.servers[tool.server_id];
    if (!srv?.base_url) return null;
    return srv.base_url.replace(/\/$/, '') + tool.job_path + '/' + h.build_id + '/';
  }

  function statusBadge(status) {
    const s = String(status || '').toLowerCase();
    const map = {
      success: ['sj-b-success', 'Success'], failure: ['sj-b-failure', 'Failure'],
      aborted: ['sj-b-aborted', 'Aborted'],
      queued: ['sj-b-running', 'Queued'], 'in queue': ['sj-b-running', 'In Queue'],
      building: ['sj-b-running', 'Building'], running: ['sj-b-running', 'Building'],
    };
    const [cls, label] = map[s] || ['sj-b-unknown', status || 'Unknown'];
    return `<span class="sj-badge ${cls}">${escHtml(label)}</span>`;
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
        const hay = [h.user_name, h.username, h.user, h.build_id ? '#' + h.build_id : ''].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    $('sj-history-count').textContent = rows.length;
    const body = $('sj-history-body');
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="5" class="sj-empty">' +
        (state.history.length ? 'ไม่มีรายการตรงเงื่อนไข' : 'ยังไม่มีประวัติ') + '</td></tr>';
      return;
    }
    body.innerHTML = rows.map(h => {
      const url = buildUrl(h);
      const s = String(h.status || '').toLowerCase();
      const isLive = s === 'queued' || s === 'in queue' || s === 'building' || s === 'running';
      const buildCell = h.build_id
        ? (url
            ? `<a href="${url}" target="_blank" rel="noopener" style="color:var(--orange);font-weight:800;text-decoration:none">#${escHtml(String(h.build_id))} <span style="font-size:9px;opacity:.7">↗</span></a>`
            : `<span style="font-weight:800">#${escHtml(String(h.build_id))}</span>`)
        : (isLive
            ? `<span style="color:var(--text-muted);font-size:10px">Queue #${escHtml(String(h.queue_id || '…'))}</span>`
            : `<span style="opacity:.35">—</span>`);
      const resultLabel = h.result && !isLive
        ? `<div style="font-size:9.5px;color:var(--text-muted);margin-top:2px;letter-spacing:.03em">${escHtml(h.result)}</div>`
        : '';
      return `<tr>
        <td class="sj-mono" style="white-space:nowrap">${buildCell}</td>
        <td class="sj-meta-cell sj-mono">${escHtml(fmtTime(h.ts || h.timestamp))}</td>
        <td>${statusBadge(h.status)}${resultLabel}</td>
        <td class="sj-meta-cell">${escHtml(h.user_name || h.username || '')}</td>
        <td class="sj-meta-cell" style="white-space:nowrap">${fmtDuration(h.duration)}</td>
      </tr>`;
    }).join('');
  }

  // ── Admin panel ────────────────────────────────────────────────────────────
  document.querySelectorAll('.sja-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sja-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.sja-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      $('sja-panel-' + btn.dataset.tab).classList.add('active');
    });
  });

  function renderAdmin() {
    renderUsers();
    renderSettings();
  }

  function renderUsers() {
    const body = $('sja-user-body');
    if (!state.users.length) {
      body.innerHTML = '<tr><td colspan="5" class="sj-empty">ยังไม่มีผู้ใช้</td></tr>';
      return;
    }
    body.innerHTML = state.users.map(u => `<tr>
      <td style="font-weight:700">${escHtml(u.username)}</td>
      <td class="sj-meta-cell">${escHtml(u.email || '')}</td>
      <td>${u.soj_role === 'admin'
        ? '<span class="sj-badge" style="background:rgba(242,100,25,.14);color:var(--orange)">Admin</span>'
        : '<span class="sj-badge" style="background:rgba(59,130,246,.13);color:#3b82f6">User</span>'}</td>
      <td>${u.status === 'locked'
        ? '<span class="sj-badge" style="background:rgba(239,68,68,.13);color:#ef4444">Locked</span>'
        : '<span class="sj-badge sj-b-success">Active</span>'}</td>
      <td><div class="sja-actions">
        <button class="sj-btn" onclick="promoteUser('${escHtml(u.id)}')">${u.soj_role === 'admin' ? '→ user' : '→ admin'}</button>
        <button class="sj-btn" onclick="resetPw('${escHtml(u.id)}')">รีเซ็ตรหัส</button>
        ${u.status === 'locked' ? `<button class="sj-btn" onclick="unlockUser('${escHtml(u.id)}')">ปลดล็อค</button>` : ''}
        <button class="sj-btn sj-btn-danger" onclick="deleteUser('${escHtml(u.id)}')">ลบ</button>
      </div></td>
    </tr>`).join('');
  }

  function renderSettings() {
    const me = Auth.getUser();
    $('sja-me-kv').innerHTML = `
      <div class="sja-kv-row"><b>Username</b><span>${escHtml(me?.username || '')}</span></div>
      <div class="sja-kv-row"><b>Name</b><span>${escHtml(me?.name || '')}</span></div>
      <div class="sja-kv-row"><b>Role</b><span>${escHtml(me?.role || '')} (${escHtml(me?.permissions?.join(', ') || '')})</span></div>
      <div class="sja-kv-row"><b>Team</b><span>${escHtml(me?.team || '')}</span></div>`;

    const srvRows = Object.entries(state.servers).map(([id, s]) => `
      <div class="sja-kv-row"><b>${escHtml(id)}</b><span class="sj-mono">${escHtml(s.display || '')} — ${escHtml(s.base_url || '')}</span></div>`).join('');
    const tool = state.tools[0];
    const toolRows = tool ? `
      <div class="sja-kv-row"><b>Job Name</b><span class="sj-mono">${escHtml(tool.name || tool.id)}</span></div>
      <div class="sja-kv-row"><b>Job Path</b><span class="sj-mono">${escHtml(tool.job_path || '')}</span></div>
      <div class="sja-kv-row"><b>Params</b><span>— (ไม่มี parameter)</span></div>` : '';
    $('sja-server-kv').innerHTML = srvRows + toolRows || '<div class="sj-empty">ไม่พบ config</div>';
  }

  // ── Admin actions ──────────────────────────────────────────────────────────
  $('sja-user-add').addEventListener('click', async () => {
    const username = $('sja-user-username').value.trim();
    const email = $('sja-user-email').value.trim();
    if (!username || !email) { Toast.error('กรุณากรอก username และ email'); return; }
    const res = await API.post('/so-jenkins/', {
      action: 'create_user', username, email, soj_role: $('sja-user-role').value,
    });
    if (!res?.ok) { Toast.error(res?.data?.message || 'สร้างไม่สำเร็จ'); return; }
    Toast.success(`สร้างผู้ใช้สำเร็จ — รหัสผ่านชั่วคราว: ${res.data.data.temp_password}`);
    $('sja-user-username').value = '';
    $('sja-user-email').value = '';
    await reloadAll();
  });

  async function promoteUser(id) {
    const u = state.users.find(x => x.id === id);
    if (!u) return;
    const res = await API.post('/so-jenkins/', { action: 'update_user', user_id: id, soj_role: u.soj_role === 'admin' ? 'user' : 'admin' });
    if (!res?.ok) { Toast.error(res?.data?.message || 'อัปเดตไม่สำเร็จ'); return; }
    Toast.success('เปลี่ยน Role เรียบร้อย');
    await reloadAll();
  }

  async function resetPw(id) {
    if (!await confirmDialog('ผู้ใช้จะต้องใช้รหัสผ่านชั่วคราวในการ login ครั้งต่อไป', 'รีเซ็ตรหัสผ่าน?',
      { variant: 'primary', confirmText: 'รีเซ็ต', cancelText: 'ยกเลิก' })) return;
    const res = await API.post('/so-jenkins/', { action: 'reset_password', user_id: id });
    if (!res?.ok) { Toast.error(res?.data?.message || 'รีเซ็ตไม่สำเร็จ'); return; }
    Toast.success(`รหัสผ่านชั่วคราวใหม่: ${res.data.data.temp_password}`);
    await reloadAll();
  }

  async function unlockUser(id) {
    const res = await API.post('/so-jenkins/', { action: 'unlock_user', user_id: id });
    if (!res?.ok) { Toast.error(res?.data?.message || 'ปลดล็อคไม่สำเร็จ'); return; }
    Toast.success('ปลดล็อคเรียบร้อย');
    await reloadAll();
  }

  async function deleteUser(id) {
    if (!await confirmDialog('ผู้ใช้จะถูกลบออกจาก SO Jenkins อย่างถาวร', 'ลบผู้ใช้?',
      { confirmText: 'ลบ', cancelText: 'ยกเลิก' })) return;
    const res = await API.post('/so-jenkins/', { action: 'delete_user', user_id: id });
    if (!res?.ok) { Toast.error(res?.data?.message || 'ลบไม่สำเร็จ'); return; }
    Toast.success('ลบผู้ใช้เรียบร้อย');
    await reloadAll();
  }

  // ── History controls (merged from old Logs panel) ──────────────────────────
  $('sj-hist-filter').addEventListener('change', e => { state.histFilter = e.target.value; renderHistory(); });
  $('sj-hist-search').addEventListener('input',  e => { state.histSearch = e.target.value; renderHistory(); });
  $('sj-hist-clear').addEventListener('click', async () => {
    if (!await confirmDialog('ประวัติทั้งหมดจะถูกลบถาวร ไม่สามารถกู้คืนได้', 'ล้างประวัติทั้งหมด?',
      { confirmText: 'ล้าง', cancelText: 'ยกเลิก' })) return;
    const res = await API.post('/so-jenkins/', { action: 'clear_history' });
    if (!res?.ok) { Toast.error(res?.data?.message || 'ล้างไม่สำเร็จ'); return; }
    Toast.success('ล้างประวัติเรียบร้อย');
    await loadHistory();
  });
  $('sj-hist-export').addEventListener('click', () => {
    const rows = state.history.map(h => [h.build_id || '', h.ts || h.timestamp || '', h.status || '', h.result || '', h.user_name || h.username || '', h.duration ? fmtDuration(h.duration) : '']);
    const csv = '\uFEFF' + ['Build #,Time,Status,Result,Triggered By,Duration', ...rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'so-jenkins-history.csv';
    a.click();
  });

  // ── Header buttons ─────────────────────────────────────────────────────────
  $('sj-btn-history').addEventListener('click', () => openPanel('history'));
  $('sj-btn-admin').addEventListener('click',   () => openPanel('admin'));

  $('sj-refresh-btn').addEventListener('click', async () => {
    await Promise.all([loadHistory(), loadStatus()]);
    Toast.success('อัปเดตแล้ว');
  });

  // ── Progress modal ─────────────────────────────────────────────────────────
  function openProgress(queueId) {
    const tool = state.tools.find(t => t.id === state.toolId);
    if (!tool) return;
    const modal = $('sj-progress-modal');
    $('sj-modal-title').textContent = 'Executing Pipeline';
    $('sj-modal-status').textContent = 'Waiting in Jenkins queue...';
    $('sj-progress-bar').style.width = '0%';
    $('sj-progress-pct').textContent = '0%';
    $('sj-modal-result').style.display = 'none';
    $('sj-modal-close').style.display = 'none';
    modal.style.display = 'flex';

    let tries = 0;
    const poll = async () => {
      tries++;
      const res = await API.get(`/so-jenkins/?action=status&tool_id=${encodeURIComponent(tool.id)}&queue_id=${encodeURIComponent(queueId)}`);
      if (!res?.ok) { $('sj-modal-status').textContent = 'Error polling status'; return; }
      const st = res.data.data || {};
      $('sj-progress-bar').style.width = (st.progress || 0) + '%';
      $('sj-progress-pct').textContent = (st.progress || 0) + '%';
      if (st.status === 'Finished') {
        $('sj-modal-status').textContent = 'Build completed.';
        $('sj-modal-title').textContent = 'Pipeline Finished';
        const result = (st.result || 'UNKNOWN').toUpperCase();
        const el = $('sj-modal-result');
        el.textContent = 'STATUS: ' + result;
        el.className = 'sj-modal-result ' + (result === 'SUCCESS' ? 'ok' : result === 'FAILURE' ? 'bad' : 'mid');
        el.style.display = 'block';
        $('sj-progress-bar').style.width = '100%';
        $('sj-progress-pct').textContent = '100%';
        $('sj-modal-close').style.display = '';
        await loadHistory();
        return;
      }
      if (st.status === 'Building') $('sj-modal-status').textContent = 'Processing pipeline steps...';
      if (st.status === 'In Queue') $('sj-modal-status').textContent = 'Waiting in Jenkins queue...';
      if (st.status === 'Unknown' && tries > 40) {
        $('sj-modal-status').textContent = 'ไม่สามารถติดตามสถานะได้ (Jenkins queue หมดอายุ) — ตรวจใน History';
        $('sj-modal-close').style.display = '';
        return;
      }
      setTimeout(poll, 1500);
    };
    poll();
  }

  $('sj-modal-close').addEventListener('click', () => { $('sj-progress-modal').style.display = 'none'; });

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
      const uRes = await API.get('/so-jenkins/?users=1');
      if (uRes?.ok) state.users = (uRes.data.data || {}).users || [];
      if (state.panel === 'admin') renderUsers();
    }
  }

  (async function init() {
    try {
      await reloadAll();
      $('sj-loading').style.display = 'none';
      $('sj-body').style.display = '';
      // Default view = Trigger form (already visible); panels hidden.
      backToTrigger();
      // Non-blocking Jenkins reachability check (upstream may take ~30s to time out).
      loadStatus();
    } catch (e) {
      $('sj-loading').textContent = e.message;
    }
    setInterval(loadHistory, 30_000);
  })();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "backToTrigger", { configurable: true, get: () => backToTrigger, set: (v) => { backToTrigger = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "buildUrl", { configurable: true, get: () => buildUrl, set: (v) => { buildUrl = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "deleteUser", { configurable: true, get: () => deleteUser, set: (v) => { deleteUser = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtDuration", { configurable: true, get: () => fmtDuration, set: (v) => { fmtDuration = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtTime", { configurable: true, get: () => fmtTime, set: (v) => { fmtTime = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadConfig", { configurable: true, get: () => loadConfig, set: (v) => { loadConfig = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadHistory", { configurable: true, get: () => loadHistory, set: (v) => { loadHistory = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadStatus", { configurable: true, get: () => loadStatus, set: (v) => { loadStatus = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openPanel", { configurable: true, get: () => openPanel, set: (v) => { openPanel = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openProgress", { configurable: true, get: () => openProgress, set: (v) => { openProgress = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "promoteUser", { configurable: true, get: () => promoteUser, set: (v) => { promoteUser = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "reloadAll", { configurable: true, get: () => reloadAll, set: (v) => { reloadAll = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderAdmin", { configurable: true, get: () => renderAdmin, set: (v) => { renderAdmin = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderHistory", { configurable: true, get: () => renderHistory, set: (v) => { renderHistory = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderServerPill", { configurable: true, get: () => renderServerPill, set: (v) => { renderServerPill = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderSettings", { configurable: true, get: () => renderSettings, set: (v) => { renderSettings = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderStats", { configurable: true, get: () => renderStats, set: (v) => { renderStats = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderUsers", { configurable: true, get: () => renderUsers, set: (v) => { renderUsers = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "resetPw", { configurable: true, get: () => resetPw, set: (v) => { resetPw = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "statusBadge", { configurable: true, get: () => statusBadge, set: (v) => { statusBadge = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "unlockUser", { configurable: true, get: () => unlockUser, set: (v) => { unlockUser = v; } }); } catch (e) {}
})();
