// admin/jenkins-servers — page script, extracted from admin/jenkins-servers.html.
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
  Layout.render('admin-jenkins');
  // Toggle body[data-page-mode="read"] so add/edit/delete write buttons hide
  // for teams that super_admin marked jenkins-servers as read-only.
  if (typeof Auth !== 'undefined' && Auth.applyPageMode) Auth.applyPageMode('jenkins-servers');

  let allServers = [];
  let editingId  = null;
  let deletingId = null;

  // ─── Load ───────────────────────────────────────────────────────
  async function loadServers() {
    const container = document.getElementById('table-container');
    container.innerHTML = Skeleton.table(5);

    const res = await API.jenkinsServers.list();
    if (!res?.ok) { container.innerHTML = '<div class="empty-table">โหลดข้อมูลไม่สำเร็จ</div>'; return; }

    allServers = res.data.data || [];
    document.getElementById('srv-count').textContent = `${allServers.length} servers`;

    if (!allServers.length) {
      container.innerHTML = '<div class="empty-table">ยังไม่มี Server — กด "+ Add Server"</div>';
      return;
    }

    container.innerHTML = `
      <table class="srv-table">
        <thead><tr>
          <th style="width:32px"></th>
          <th>ชื่อ</th>
          <th>Base URL</th>
          <th style="width:90px">Auth Mode</th>
          <th style="width:100px">Username</th>
          <th style="width:70px">Status</th>
          <th style="width:140px">Actions</th>
        </tr></thead>
        <tbody id="srv-tbody">
          ${allServers.map(renderRow).join('')}
        </tbody>
      </table>`;

    initDragSort();

    // Event delegation
    container.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      if (btn.dataset.action === 'edit')   openEditModal(btn.dataset.id);
      if (btn.dataset.action === 'delete') openDeleteModal(btn.dataset.id, btn.dataset.name);
      if (btn.dataset.action === 'toggle') quickToggle(btn.dataset.id);
      if (btn.dataset.action === 'test')   testConnection(btn.dataset.id, btn);
      if (btn.dataset.action === 'rules')  openRulesModal(btn.dataset.id);
    });
  }

  function renderRow(s) {
    const modeHtml = s.auth_mode === 'cookie'
      ? '<span class="mode-badge mode-cookie">🍪 Cookie</span>'
      : '<span class="mode-badge mode-token"><i data-icon="key"></i> Token</span>';
    const rulesCnt    = (s.job_rules || []).length;
    const ignoreCnt   = (s.job_rules || []).filter(r => r.type === 'ignore').length;
    const remarkCnt   = (s.job_rules || []).filter(r => r.type === 'remark').length;
    const descCnt     = (s.job_rules || []).filter(r => r.type === 'description').length;
    const rulesBadge  = rulesCnt > 0
      ? `<span style="margin-left:4px;font-size:9px;padding:1px 5px;border-radius:3px;background:rgba(37,99,235,.1);color:#2563eb">${ignoreCnt}<i data-icon="ban"></i> ${remarkCnt}<i data-icon="edit"></i>${descCnt ? ` ${descCnt}💬` : ''}</span>`
      : '';
    return `<tr data-id="${escHtml(s.id)}" draggable="true">
      <td><span class="drag-handle" title="ลากเรียงลำดับ">⠿</span></td>
      <td>
        <div style="font-weight:600">${escHtml(s.display)}</div>
        ${s.auth_mode === 'cookie' ? '<div style="font-size:10px;color:#d97706;margin-top:1px">⚠ Cookie expires periodically</div>' : ''}
      </td>
      <td>
        <div class="url-cell" title="${escHtml(s.base_url)}">${escHtml(s.base_url)}</div>
        ${s.ip_override ? `<div style="font-size:10px;color:#0891b2;margin-top:2px" title="Bypassing DNS via CURLOPT_RESOLVE">→ ${escHtml(s.ip_override)}</div>` : ''}
      </td>
      <td>${modeHtml}</td>
      <td style="font-size:11px;color:var(--text-muted)">${escHtml(s.auth_user || '—')}</td>
      <td>
        <div style="display:flex;align-items:center;gap:6px">
          <div class="toggle ${s.enabled !== false ? 'on' : ''}" data-action="toggle" data-read-hide data-id="${escHtml(s.id)}"></div>
          <span style="font-size:10px;color:var(--text-muted)">${s.enabled !== false ? 'On' : 'Off'}</span>
        </div>
      </td>
      <td>
        <div class="action-btn-group">
          <button class="btn btn-ghost" style="padding:4px 9px;font-size:10px" data-action="rules" data-id="${escHtml(s.id)}" title="จัดการ Job Rules"><i data-icon="clipboard"></i>${rulesBadge}</button>
          <button class="btn btn-ghost" style="padding:4px 9px;font-size:10px" data-action="test"  data-id="${escHtml(s.id)}" title="Test Connection"><i data-icon="zap"></i> Test</button>
          <button class="btn btn-ghost" style="padding:4px 9px;font-size:11px" data-action="edit"  data-id="${escHtml(s.id)}">Edit</button>
          <button class="btn" style="padding:4px 9px;font-size:11px;background:#fee2e2;color:#dc2626;border:none" data-action="delete" data-id="${escHtml(s.id)}" data-name="${escHtml(s.display)}">Del</button>
        </div>
        <span class="test-status" id="test-${escHtml(s.id)}"></span>
      </td>
    </tr>`;
  }

  // ─── Test connection ─────────────────────────────────────────────
  async function testConnection(id, btn) {
    const statusEl = document.getElementById(`test-${id}`);
    btn.disabled = true;
    if (statusEl) { statusEl.className = 'test-status test-spin'; statusEl.textContent = ' Testing...'; }

    const res = await API.jenkins.jobs(id, 'jobs[name]');

    btn.disabled = false;
    if (!statusEl) return;

    if (res?.ok) {
      const count = res.data.data?.jobs?.length ?? 0;
      statusEl.className = 'test-status test-ok';
      statusEl.innerHTML = ` <i data-icon="check"></i> OK (${count} jobs)`;
    } else {
      const msg = res?.data?.message || 'Failed';
      statusEl.className = 'test-status test-fail';
      statusEl.innerHTML = ` <i data-icon="x"></i> ${msg}`;
    }
    setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 8000);
  }

  // ─── Quick toggle ────────────────────────────────────────────────
  async function quickToggle(id) {
    const s = allServers.find(x => x.id === id);
    if (!s) return;
    const next = s.enabled === false;
    const res  = await API.jenkinsServers.update(id, { enabled: next });
    if (!res?.ok) { Toast.error('อัปเดทไม่สำเร็จ'); return; }
    s.enabled = next;
    const row = document.querySelector(`tr[data-id="${CSS.escape(id)}"]`);
    if (row) row.outerHTML = renderRow(s);
    initDragSort();
    Toast.success(next ? 'เปิดใช้งานแล้ว' : 'ปิดใช้งานแล้ว');
  }

  // ─── Drag sort ───────────────────────────────────────────────────
  function initDragSort() {
    const tbody = document.getElementById('srv-tbody');
    if (!tbody) return;
    let dragging = null;
    tbody.querySelectorAll('tr[draggable]').forEach(row => {
      row.addEventListener('dragstart', () => { dragging = row; setTimeout(() => row.classList.add('dragging'), 0); });
      row.addEventListener('dragend', async () => {
        row.classList.remove('dragging');
        const rows = [...tbody.querySelectorAll('tr[data-id]')];
        const ups  = rows.map((r, i) => {
          const s = allServers.find(x => x.id === r.dataset.id);
          if (s) s.order = i + 1;
          return API.jenkinsServers.update(r.dataset.id, { order: i + 1 });
        });
        await Promise.all(ups);
        dragging = null;
        
        // Re-render table to preserve data and event handlers
        allServers.sort((a, b) => (a.order || 0) - (b.order || 0));
        tbody.innerHTML = allServers.map(renderRow).join('');
        initDragSort();
      });
      row.addEventListener('dragover', e => { e.preventDefault(); if (dragging && dragging !== row) { tbody.querySelectorAll('tr').forEach(r => r.classList.remove('drag-over')); row.classList.add('drag-over'); } });
      row.addEventListener('drop', e => { e.preventDefault(); row.classList.remove('drag-over'); if (dragging && dragging !== row) { [...tbody.querySelectorAll('tr')].indexOf(dragging) < [...tbody.querySelectorAll('tr')].indexOf(row) ? row.after(dragging) : row.before(dragging); } });
    });
  }

  // ─── Auth mode UI ────────────────────────────────────────────────
  function setAuthMode(mode) {
    document.getElementById('f-auth-mode').value = mode;
    document.getElementById('mode-opt-token').classList.toggle('selected',  mode === 'token');
    document.getElementById('mode-opt-cookie').classList.toggle('selected', mode === 'cookie');
    document.getElementById('cookie-row').style.display = mode === 'cookie' ? '' : 'none';
    document.getElementById('token-label').textContent  = mode === 'cookie' ? 'API Token (optional)' : 'API Token';
  }

  // ─── Modal helpers ───────────────────────────────────────────────
  function openModal(id)  { document.getElementById(id).classList.add('open'); }
  function closeModal(id) { document.getElementById(id).classList.remove('open'); }

  function toggleEnabled() {
    const cur  = document.getElementById('f-enabled').value === 'true';
    const next = !cur;
    document.getElementById('f-enabled').value = String(next);
    document.getElementById('f-enabled-toggle').classList.toggle('on', next);
    document.getElementById('f-enabled-label').textContent = next ? 'เปิดใช้งาน' : 'ปิดใช้งาน';
  }

  function resetForm() {
    ['f-display','f-base-url','f-auth-user','f-auth-token','f-ip-override','f-order'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    document.getElementById('f-auth-cookie').value = '';
    document.getElementById('f-enabled').value = 'true';
    document.getElementById('f-enabled-toggle').classList.add('on');
    document.getElementById('f-enabled-label').textContent = 'เปิดใช้งาน';
    setAuthMode('token');
  }

  function openCreateModal() {
    editingId = null;
    resetForm();
    document.getElementById('modal-title').textContent = 'Add Jenkins Server';
    document.getElementById('modal-save-btn').textContent = 'Save Server';
    openModal('modal-srv');
    setTimeout(() => document.getElementById('f-display').focus(), 80);
  }

  function openEditModal(id) {
    const s = allServers.find(x => x.id === id);
    if (!s) return;
    editingId = id;

    setAuthMode(s.auth_mode || 'token');
    document.getElementById('f-display').value    = s.display   || '';
    document.getElementById('f-base-url').value   = s.base_url  || '';
    document.getElementById('f-auth-user').value  = s.auth_user || '';
    document.getElementById('f-auth-token').value = s.auth_token|| '';
    document.getElementById('f-auth-cookie').value= s.auth_cookie|| '';
    document.getElementById('f-ip-override').value= s.ip_override|| '';
    document.getElementById('f-order').value      = s.order ?? '';

    const en = s.enabled !== false;
    document.getElementById('f-enabled').value = String(en);
    document.getElementById('f-enabled-toggle').classList.toggle('on', en);
    document.getElementById('f-enabled-label').textContent = en ? 'เปิดใช้งาน' : 'ปิดใช้งาน';

    document.getElementById('modal-title').textContent = `Edit — ${escHtml(s.display)}`;
    document.getElementById('modal-save-btn').textContent = 'Save Changes';
    openModal('modal-srv');
  }

  // ─── Save ────────────────────────────────────────────────────────
  async function saveServer() {
    const display   = document.getElementById('f-display').value.trim();
    const base_url  = document.getElementById('f-base-url').value.trim();
    const auth_mode = document.getElementById('f-auth-mode').value;
    const auth_user = document.getElementById('f-auth-user').value.trim();
    const auth_token= document.getElementById('f-auth-token').value.trim();
    const auth_cookie=document.getElementById('f-auth-cookie').value.trim();
    const ip_override=document.getElementById('f-ip-override').value.trim();
    const orderVal  = document.getElementById('f-order').value;
    const enabled   = document.getElementById('f-enabled').value === 'true';

    if (!display)  { Toast.error('กรุณากรอกชื่อ'); return; }
    if (!base_url) { Toast.error('กรุณากรอก Base URL'); return; }
    if (auth_mode === 'token' && !auth_token) { Toast.error('กรุณากรอก API Token'); return; }
    if (auth_mode === 'cookie' && !auth_cookie) { Toast.error('กรุณากรอก Cookie String'); return; }
    if (ip_override && !/^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-fA-F:]+$/.test(ip_override)) {
      Toast.error('IP Override ต้องเป็น IPv4 หรือ IPv6 ที่ถูกต้อง'); return;
    }

    const payload = { display, base_url, auth_mode, auth_user, auth_token, auth_cookie, enabled, ip_override };
    if (orderVal !== '') payload.order = parseInt(orderVal);

    const btn = document.getElementById('modal-save-btn');
    btn.disabled = true; btn.textContent = 'Saving...';

    const res = editingId
      ? await API.jenkinsServers.update(editingId, payload)
      : await API.jenkinsServers.create(payload);

    btn.disabled = false;
    btn.textContent = editingId ? 'Save Changes' : 'Save Server';

    if (!res?.ok) { Toast.error(res?.data?.message || 'เกิดข้อผิดพลาด'); return; }

    Toast.success(editingId ? 'แก้ไขเรียบร้อย' : 'เพิ่ม Server เรียบร้อย');
    closeModal('modal-srv');
    loadServers();
  }

  // ─── Delete ──────────────────────────────────────────────────────
  function openDeleteModal(id, name) {
    deletingId = id;
    document.getElementById('delete-srv-name').textContent = name;
    openModal('modal-delete');
  }

  async function confirmDelete() {
    if (!deletingId) return;
    const res = await API.jenkinsServers.delete(deletingId);
    if (!res?.ok) { Toast.error(res?.data?.message || 'ลบไม่สำเร็จ'); return; }
    Toast.success('ลบ Server เรียบร้อย');
    closeModal('modal-delete');
    deletingId = null;
    loadServers();
  }

  // ─── Keyboard / overlay close ────────────────────────────────────
  document.querySelectorAll('.modal-overlay').forEach(el => {
    el.addEventListener('click', e => { if (e.target === el) closeModal(el.id); });
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') ['modal-srv','modal-delete','modal-rules'].forEach(id => closeModal(id));
    if (e.key === 'Enter' && document.getElementById('modal-srv').classList.contains('open')) saveServer();
  });

  // ═══════════════════════════════════════════════════════════
  // JOB RULES MODAL
  // ═══════════════════════════════════════════════════════════
  let rulesServerId = null;
  let rulesBuffer   = [];

  // ── Autocomplete state ────────────────────────────────────
  const rulesJobCache  = {};   // { serverId: [] | 'loading' }
  let   acFocusedIndex = -1;

  function isFolderItem(job) {
    return job.jobs !== undefined || (job._class || '').toLowerCase().includes('folder');
  }

  async function loadJobCache(serverId) {
    if (rulesJobCache[serverId]) return;
    rulesJobCache[serverId] = 'loading';
    document.getElementById('rules-cache-status').textContent = '⏳ กำลังโหลด job list จาก Jenkins…';

    // Re-use API.jenkins.jobs which calls the proxy
    const res = await API.jenkins.jobs(serverId, 'jobs[name,_class,jobs[name,_class]]');
    if (!res?.ok) {
      rulesJobCache[serverId] = [];
      document.getElementById('rules-cache-status').innerHTML = '<i data-icon="alert-triangle"></i> โหลด job list ไม่สำเร็จ';
      return;
    }
    const topLevel = res.data.data?.jobs || [];
    const flat = [];
    for (const item of topLevel) {
      if (isFolderItem(item) && item.jobs) {
        item.jobs.forEach(j => { if (!isFolderItem(j)) flat.push({ name: j.name, folder: item.name }); });
      } else if (!isFolderItem(item)) {
        flat.push({ name: item.name, folder: '' });
      }
    }
    rulesJobCache[serverId] = flat;
    const cnt = flat.length;
    document.getElementById('rules-cache-status').innerHTML = `<i data-icon="check"></i> โหลด ${cnt} jobs จาก Jenkins แล้ว — พิมเพื่อค้นหา`;
  }

  function onPatternInput() {
    const q   = document.getElementById('r-pattern').value.trim();
    const dd  = document.getElementById('ac-dropdown');
    acFocusedIndex = -1;

    const cache = rulesJobCache[rulesServerId];
    if (!cache || cache === 'loading') {
      dd.innerHTML = `<div class="ac-status">⏳ กำลังโหลด job list…</div>`;
      dd.classList.add('open');
      return;
    }
    if (!q) { dd.classList.remove('open'); return; }

    const ql = q.toLowerCase();
    const matches = cache.filter(j => j.name.toLowerCase().includes(ql)).slice(0, 12);

    if (!matches.length) {
      dd.innerHTML = `<div class="ac-status" style="color:#dc2626"><i data-icon="x-circle"></i> ไม่พบ job ที่ชื่อมี "${escHtml(q)}"</div>`;
      dd.classList.add('open');
      return;
    }

    dd.innerHTML = matches.map((j, i) => {
      const lo  = j.name.toLowerCase();
      const idx = lo.indexOf(ql);
      const hl  = escHtml(j.name.substring(0, idx))
                + `<mark>${escHtml(j.name.substring(idx, idx + q.length))}</mark>`
                + escHtml(j.name.substring(idx + q.length));
      const folder = j.folder ? `<span class="ac-item-folder"><i data-icon="folder"></i> ${escHtml(j.folder)}</span>` : '';
      return `<div class="ac-item" data-name="${escHtml(j.name)}" data-idx="${i}" onmousedown="selectSuggestion('${escHtml(j.name).replace(/'/g,"\\'")}')">
        <span class="ac-item-name">${hl}</span>${folder}
      </div>`;
    }).join('');
    dd.classList.add('open');
  }

  function onPatternKeydown(e) {
    const dd    = document.getElementById('ac-dropdown');
    const items = dd.querySelectorAll('.ac-item');
    if (!dd.classList.contains('open') || !items.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      acFocusedIndex = Math.min(acFocusedIndex + 1, items.length - 1);
      items.forEach((el, i) => el.classList.toggle('focused', i === acFocusedIndex));
      items[acFocusedIndex]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      acFocusedIndex = Math.max(acFocusedIndex - 1, 0);
      items.forEach((el, i) => el.classList.toggle('focused', i === acFocusedIndex));
      items[acFocusedIndex]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && acFocusedIndex >= 0) {
      e.preventDefault();
      const name = items[acFocusedIndex]?.dataset.name;
      if (name) selectSuggestion(name);
    } else if (e.key === 'Escape') {
      closeDropdown();
    }
  }

  function selectSuggestion(name) {
    document.getElementById('r-pattern').value = name;
    closeDropdown();
    // Auto-set match to 'exact' since we picked from the real list
    document.getElementById('r-match').value = 'exact';
    document.getElementById('r-pattern').focus();
  }

  function closeDropdown() {
    document.getElementById('ac-dropdown').classList.remove('open');
    acFocusedIndex = -1;
  }

  // Close dropdown when clicking outside
  document.addEventListener('click', e => {
    if (!e.target.closest('.ac-wrap')) closeDropdown();
  });

  function openRulesModal(id) {
    const s = allServers.find(x => x.id === id);
    if (!s) return;
    rulesServerId = id;
    rulesBuffer   = JSON.parse(JSON.stringify(s.job_rules || []));
    document.getElementById('rules-modal-title').textContent = `📋 Job Rules — ${s.display}`;
    // Reset form
    document.getElementById('r-pattern').value   = '';
    document.getElementById('r-type').value       = 'ignore';
    document.getElementById('r-match').value      = 'exact';
    document.getElementById('r-remark').value     = '';
    document.getElementById('r-remark-row').style.display = 'none';
    document.getElementById('bulk-area').style.display    = 'none';
    closeDropdown();
    // Cache status
    const cached = rulesJobCache[id];
    document.getElementById('rules-cache-status').textContent = cached && cached !== 'loading'
      ? `✓ โหลด ${cached.length} jobs จาก Jenkins แล้ว — พิมเพื่อค้นหา`
      : '';
    renderRulesList();
    openModal('modal-rules');
    // Load job list in background (for autocomplete)
    loadJobCache(id);
    setTimeout(() => document.getElementById('r-pattern').focus(), 100);
  }

  function renderRulesList() {
    const list      = document.getElementById('rules-list');
    const ignoreCnt = rulesBuffer.filter(r => r.type === 'ignore').length;
    const remarkCnt = rulesBuffer.filter(r => r.type === 'remark').length;
    const descCnt   = rulesBuffer.filter(r => r.type === 'description').length;
    document.getElementById('rules-count-label').textContent =
      `${rulesBuffer.length} rules (${ignoreCnt} ignore · ${remarkCnt} remark · ${descCnt} description)`;

    if (!rulesBuffer.length) {
      list.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted);font-size:12px">ยังไม่มี rule — เพิ่มด้านล่าง</div>';
      return;
    }

    list.innerHTML = rulesBuffer.map((r, i) => {
      const typeBadge = r.type === 'ignore'
        ? '<span class="rule-type-badge rule-type-ignore">ignore</span>'
        : r.type === 'description'
        ? '<span class="rule-type-badge" style="background:rgba(22,163,74,.1);color:#15803d">description</span>'
        : '<span class="rule-type-badge rule-type-remark">remark</span>';
      const matchBadge = r.match === 'contains'
        ? ' <span class="rule-match-contains">contains</span>' : '';
      const subLine = ((r.type === 'remark' || r.type === 'description') && r.remark)
        ? `<div style="font-size:10px;color:var(--text-muted);margin-top:2px">└─ "${escHtml(r.remark)}"</div>` : '';
      return `<div class="rule-row">
        <div style="flex-shrink:0;margin-top:1px">${typeBadge}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:11px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
               title="${escHtml(r.pattern)}">${escHtml(r.pattern)}${matchBadge}</div>
          ${subLine}
        </div>
        <button class="btn" style="padding:3px 8px;font-size:10px;background:#fee2e2;color:#dc2626;border:none;flex-shrink:0"
                data-action="delete" onclick="rulesDeleteRule(${i})">Del</button>
      </div>`;
    }).join('');
  }

  function onRuleTypeChange() {
    const type = document.getElementById('r-type').value;
    const row  = document.getElementById('r-remark-row');
    const inp  = document.getElementById('r-remark');
    row.style.display = (type === 'remark' || type === 'description') ? '' : 'none';
    if (type === 'remark')      inp.placeholder = 'Remark text (จะแสดงใน Batch Report)';
    if (type === 'description') inp.placeholder = 'Description (จะแสดงบนการ์ดใน Batch Monitor)';
  }

  async function rulesAddRule() {
    const pattern = document.getElementById('r-pattern').value.trim();
    const match   = document.getElementById('r-match').value;
    const type    = document.getElementById('r-type').value;
    const remark  = document.getElementById('r-remark').value.trim();
    if (!pattern) { Toast.error('กรุณากรอก Pattern'); return; }
    if ((type === 'remark' || type === 'description') && !remark) {
      Toast.error(type === 'description' ? 'กรุณากรอก Description' : 'กรุณากรอก Remark text'); return;
    }

    const rule = { pattern, match, type };
    if (type === 'remark' || type === 'description') rule.remark = remark;

    rulesBuffer.push(rule);
    if (await rulesSave()) {
      document.getElementById('r-pattern').value = '';
      document.getElementById('r-remark').value  = '';
      renderRulesList();
      document.getElementById('r-pattern').focus();
    } else {
      rulesBuffer.pop();
    }
  }

  async function rulesDeleteRule(idx) {
    const removed = rulesBuffer.splice(idx, 1);
    if (!(await rulesSave())) {
      rulesBuffer.splice(idx, 0, ...removed);
      renderRulesList();
    } else {
      renderRulesList();
    }
  }

  function toggleBulkImport() {
    const area = document.getElementById('bulk-area');
    const show = area.style.display === 'none';
    area.style.display = show ? '' : 'none';
    if (show) setTimeout(() => document.getElementById('bulk-patterns').focus(), 50);
  }

  async function rulesBulkImport() {
    const text   = document.getElementById('bulk-patterns').value.trim();
    const type   = document.getElementById('bulk-type').value;
    const remark = document.getElementById('bulk-remark').value.trim();
    if (!text) { Toast.error('กรุณาวาง Job names'); return; }
    if ((type === 'remark' || type === 'description') && !remark) { Toast.error('กรุณากรอก Text'); return; }

    const lines = text.split('\n')
      .map(l => l.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean);
    if (!lines.length) { Toast.error('ไม่พบ Job name ที่ valid'); return; }

    const newRules = lines.map(p => {
      const r = { pattern: p, match: 'exact', type };
      if (type === 'remark' || type === 'description') r.remark = remark;
      return r;
    });

    rulesBuffer.push(...newRules);
    if (await rulesSave()) {
      document.getElementById('bulk-patterns').value = '';
      document.getElementById('bulk-remark').value   = '';
      document.getElementById('bulk-area').style.display = 'none';
      renderRulesList();
      Toast.success(`เพิ่ม ${newRules.length} rules เรียบร้อย`);
    } else {
      rulesBuffer.splice(-newRules.length);
    }
  }

  async function rulesSave() {
    if (!rulesServerId) return false;
    const res = await API.jenkinsServers.update(rulesServerId, { job_rules: rulesBuffer });
    if (!res?.ok) { Toast.error('บันทึกไม่สำเร็จ: ' + (res?.data?.message || '')); return false; }
    const s = allServers.find(x => x.id === rulesServerId);
    if (s) s.job_rules = JSON.parse(JSON.stringify(rulesBuffer));
    // Re-render the row to update badge
    const row = document.querySelector(`tr[data-id="${CSS.escape(rulesServerId)}"]`);
    if (row) { row.outerHTML = renderRow(s); initDragSort(); }
    return true;
  }

  loadServers();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "closeDropdown", { configurable: true, get: () => closeDropdown, set: (v) => { closeDropdown = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeModal", { configurable: true, get: () => closeModal, set: (v) => { closeModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "confirmDelete", { configurable: true, get: () => confirmDelete, set: (v) => { confirmDelete = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "initDragSort", { configurable: true, get: () => initDragSort, set: (v) => { initDragSort = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "isFolderItem", { configurable: true, get: () => isFolderItem, set: (v) => { isFolderItem = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadJobCache", { configurable: true, get: () => loadJobCache, set: (v) => { loadJobCache = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadServers", { configurable: true, get: () => loadServers, set: (v) => { loadServers = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "onPatternInput", { configurable: true, get: () => onPatternInput, set: (v) => { onPatternInput = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "onPatternKeydown", { configurable: true, get: () => onPatternKeydown, set: (v) => { onPatternKeydown = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "onRuleTypeChange", { configurable: true, get: () => onRuleTypeChange, set: (v) => { onRuleTypeChange = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openCreateModal", { configurable: true, get: () => openCreateModal, set: (v) => { openCreateModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openDeleteModal", { configurable: true, get: () => openDeleteModal, set: (v) => { openDeleteModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openEditModal", { configurable: true, get: () => openEditModal, set: (v) => { openEditModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openModal", { configurable: true, get: () => openModal, set: (v) => { openModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openRulesModal", { configurable: true, get: () => openRulesModal, set: (v) => { openRulesModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "quickToggle", { configurable: true, get: () => quickToggle, set: (v) => { quickToggle = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderRow", { configurable: true, get: () => renderRow, set: (v) => { renderRow = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderRulesList", { configurable: true, get: () => renderRulesList, set: (v) => { renderRulesList = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "resetForm", { configurable: true, get: () => resetForm, set: (v) => { resetForm = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "rulesAddRule", { configurable: true, get: () => rulesAddRule, set: (v) => { rulesAddRule = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "rulesBulkImport", { configurable: true, get: () => rulesBulkImport, set: (v) => { rulesBulkImport = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "rulesDeleteRule", { configurable: true, get: () => rulesDeleteRule, set: (v) => { rulesDeleteRule = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "rulesSave", { configurable: true, get: () => rulesSave, set: (v) => { rulesSave = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "saveServer", { configurable: true, get: () => saveServer, set: (v) => { saveServer = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "selectSuggestion", { configurable: true, get: () => selectSuggestion, set: (v) => { selectSuggestion = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setAuthMode", { configurable: true, get: () => setAuthMode, set: (v) => { setAuthMode = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "testConnection", { configurable: true, get: () => testConnection, set: (v) => { testConnection = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toggleBulkImport", { configurable: true, get: () => toggleBulkImport, set: (v) => { toggleBulkImport = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toggleEnabled", { configurable: true, get: () => toggleEnabled, set: (v) => { toggleEnabled = v; } }); } catch (e) {}
})();
