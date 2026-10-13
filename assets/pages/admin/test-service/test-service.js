// admin/test-service — page script
(function () {
'use strict';

if (!Auth.requireAdmin()) {}
  Layout.render('admin');

  if (Auth.getUser()?.role === 'super_admin') {
    const _lnk = document.getElementById('test-svc-logs-link');
    if (_lnk) _lnk.style.display = '';
  }

  const API_CFG = '../api/test-service-config.php';
  const API_REC = '../api/test-records-admin.php';

  function authHeader() {
    const token = Auth.getToken ? Auth.getToken()
      : (localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token') || '');
    return token ? { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
                 : { 'Content-Type': 'application/json' };
  }
  async function apiFetch(url, opts = {}) {
    opts.headers = { ...authHeader(), ...(opts.headers || {}) };
    const r = await fetch(url, opts);
    return r.json();
  }

  // ════════════════════════════════════════════════
  // SERVICE GROUPS
  // ════════════════════════════════════════════════
  let groups = [];

  async function loadGroups() {
    const res = await apiFetch(`${API_CFG}?action=get-groups`);
    if (!res.success) {
      ['tmn','vb'].forEach(b => {
        const el = document.getElementById(b + '-group-list');
        if (el) el.innerHTML = `<div class="group-list-empty" style="color:#ef4444">โหลดไม่ได้: ${escHtml(res.message||'')}</div>`;
      });
      return;
    }
    groups = res.data || [];
    renderGroups();
  }

  function renderGroups() {
    ['tmn', 'vb'].forEach(brand => {
      const list = document.getElementById(brand + '-group-list');
      if (!list) return;
      const brandIdxs   = groups.reduce((acc, g, i) => { if ((g.brand || 'tmn') === brand) acc.push(i); return acc; }, []);
      const brandGroups = brandIdxs.map(i => groups[i]);

      if (!brandGroups.length) {
        list.innerHTML = `<div class="group-list-empty">ยังไม่มี group — กด "+ เพิ่มกลุ่ม"</div>`;
        return;
      }
      list.innerHTML = brandGroups.map((g, si) => {
        const gi = brandIdxs[si];
        return `
        <div class="group-item" data-gi="${gi}">
          <div class="group-item-top">
            <span class="group-drag">⠿</span>
            <input class="group-name-input" value="${escHtml(g.name)}" placeholder="ชื่อกลุ่ม"
              onchange="groups[${gi}].name=this.value">
            <div class="group-item-actions">
              <button class="btn-icon danger" title="ลบกลุ่ม" onclick="deleteGroup(${gi})">
                <i data-icon="trash"></i>
              </button>
            </div>
          </div>
          <div class="group-children" id="children-${gi}">
            ${g.children.map((c, ci) => `
              <span class="child-chip">${escHtml(c)}<button class="child-chip-del" onclick="deleteChild(${gi},${ci})" title="ลบ">×</button></span>
            `).join('')}
            <div class="child-add-form">
              <input class="child-add-input" id="child-input-${gi}" placeholder="+ Service" type="text"
                onkeydown="if(event.key==='Enter')addChild(${gi})">
              <button class="btn-chip-add" onclick="addChild(${gi})">+ เพิ่ม</button>
            </div>
          </div>
        </div>`;
      }).join('');
    });
  }

  function deleteGroup(gi) {
    if (!confirm(`ลบกลุ่ม "${groups[gi].name}" ใช่มั้ย?`)) return;
    groups.splice(gi, 1); renderGroups();
  }
  function deleteChild(gi, ci) { groups[gi].children.splice(ci, 1); renderGroups(); }
  function addChild(gi) {
    const inp = document.getElementById(`child-input-${gi}`);
    const val = inp.value.trim(); if (!val) return;
    groups[gi].children.push(val); renderGroups();
  }

  function toggleAddForm(brand) {
    const f = document.getElementById(brand + '-add-group-form');
    if (!f) return;
    // Close the other brand's form
    const other = brand === 'tmn' ? 'vb' : 'tmn';
    const otherF = document.getElementById(other + '-add-group-form');
    if (otherF && otherF.classList.contains('show')) otherF.classList.remove('show');
    f.classList.toggle('show');
    if (f.classList.contains('show')) {
      const inp = document.getElementById(brand + '-new-group-name');
      if (inp) inp.focus();
    }
  }

  function addGroupConfirm(brand) {
    const nameEl = document.getElementById(brand + '-new-group-name');
    const idEl   = document.getElementById(brand + '-new-group-id');
    const name   = nameEl ? nameEl.value.trim() : '';
    const id     = (idEl ? idEl.value.trim() : '') || name.toLowerCase().replace(/[^a-z0-9]+/g,'_');
    if (!name) { alert('กรุณากรอกชื่อกลุ่ม'); return; }
    groups.push({ id, name, children: [], brand });
    if (nameEl) nameEl.value = '';
    if (idEl)   idEl.value   = '';
    toggleAddForm(brand);
    renderGroups();
  }

  async function saveGroups() {
    // Update both status indicators
    ['tmn','vb'].forEach(b => {
      const st = document.getElementById(b + '-groups-status');
      if (st) { st.textContent = 'กำลังบันทึก…'; st.style.color = 'var(--text-muted)'; }
    });
    const res = await apiFetch(`${API_CFG}?action=save-groups`, { method:'POST', body: JSON.stringify({ groups }) });
    ['tmn','vb'].forEach(b => {
      const st = document.getElementById(b + '-groups-status');
      if (!st) return;
      if (res.success) { st.innerHTML = `<i data-icon="check-circle"></i> บันทึกแล้ว`; st.style.color = '#22c55e'; }
      else             { st.innerHTML = '<i data-icon="x-circle"></i> ' + (res.message||'Error'); st.style.color = '#ef4444'; }
      setTimeout(() => { st.textContent = ''; }, 3000);
    });
  }

  // ════════════════════════════════════════════════
  // SETTINGS — Step 1, 2, 3
  // ════════════════════════════════════════════════
  async function loadAllSettings() {
    try {
      const res = await apiFetch(`${API_CFG}?action=get-all-settings`);
      if (res.success && res.data) {
        const s = res.data;
        if (s.step1) {
          document.getElementById('cfg-s1-threshold').value    = s.step1.threshold || 50;
          document.getElementById('cfg-s1-offset').value       = s.step1.offset || 2;
          document.getElementById('cfg-s1-jira-summary').value = s.step1.jira_summary || '';
          document.getElementById('cfg-s1-jira-bu').value      = s.step1.jira_bu || '';
          document.getElementById('cfg-s1-jira-service').value = s.step1.jira_service || '';
          document.getElementById('cfg-s1-jira-channel').value = s.step1.jira_channel || '';
          document.getElementById('cfg-s1-jira-detected').value= s.step1.jira_detected || '';
          document.getElementById('cfg-s1-jira-worktype').value= s.step1.jira_worktype || '';
          document.getElementById('cfg-s1-jira-action').value  = s.step1.jira_action || '';
          document.getElementById('cfg-s1-chat-webhook').value = s.step1.chat_webhook || '';
          document.getElementById('cfg-s1-chat-msg').value     = s.step1.chat_msg || '';
          document.getElementById('cfg-s1-email-to').value     = s.step1.email_to || '';
          document.getElementById('cfg-s1-email-cc').value     = s.step1.email_cc || '';
          document.getElementById('cfg-s1-email-subject').value= s.step1.email_subject || '';
          document.getElementById('cfg-s1-email-body').value   = s.step1.email_body || '';
        }
        if (s.step2) {
          document.getElementById('cfg-s2-user').value   = s.step2.user || '';
          document.getElementById('cfg-s2-token').value  = s.step2.token || '';
          document.getElementById('cfg-s2-url').value    = s.step2.url || '';
          document.getElementById('cfg-s2-builds').value = s.step2.builds || 5;
          document.getElementById('cfg-s2-console').value= s.step2.console || '';
        }
        if (s.step3) {
          document.getElementById('cfg-s3-url').value     = s.step3.url || '';
          document.getElementById('cfg-s3-partner').value = s.step3.partner || '';
          document.getElementById('cfg-s3-step1').value   = s.step3.guide_step1 || '';
          document.getElementById('cfg-s3-step2').value   = s.step3.guide_step2 || '';
          document.getElementById('cfg-s3-selector').value= s.step3.selector || '';
        }
      }
    } catch (err) { console.error('Failed to load settings:', err); }
  }

  async function saveStep1Settings() {
    const msg = document.getElementById('step1-status');
    msg.textContent = 'กำลังบันทึก…'; msg.style.color = 'var(--text-muted)';
    const data = {
      threshold:    parseInt(document.getElementById('cfg-s1-threshold').value) || 50,
      offset:       parseInt(document.getElementById('cfg-s1-offset').value) || 2,
      jira_summary: document.getElementById('cfg-s1-jira-summary').value.trim(),
      jira_bu:      document.getElementById('cfg-s1-jira-bu').value.trim(),
      jira_service: document.getElementById('cfg-s1-jira-service').value.trim(),
      jira_channel: document.getElementById('cfg-s1-jira-channel').value.trim(),
      jira_detected:document.getElementById('cfg-s1-jira-detected').value.trim(),
      jira_worktype:document.getElementById('cfg-s1-jira-worktype').value.trim(),
      jira_action:  document.getElementById('cfg-s1-jira-action').value.trim(),
      chat_webhook: document.getElementById('cfg-s1-chat-webhook').value.trim(),
      chat_msg:     document.getElementById('cfg-s1-chat-msg').value.trim(),
      email_to:     document.getElementById('cfg-s1-email-to').value.trim(),
      email_cc:     document.getElementById('cfg-s1-email-cc').value.trim(),
      email_subject:document.getElementById('cfg-s1-email-subject').value.trim(),
      email_body:   document.getElementById('cfg-s1-email-body').value.trim(),
    };
    const res = await apiFetch(`${API_CFG}?action=save-step1-settings`, { method:'POST', body: JSON.stringify(data) });
    if (res.success) { msg.innerHTML = '<i data-icon="check-circle"></i> บันทึกแล้ว'; msg.style.color = '#22c55e'; }
    else             { msg.innerHTML = '<i data-icon="x-circle"></i> ' + (res.message||'Error'); msg.style.color = '#ef4444'; }
    setTimeout(() => { msg.textContent=''; }, 3000);
  }

  async function saveStep2Settings() {
    const msg = document.getElementById('step2-status');
    msg.textContent = 'กำลังบันทึก…'; msg.style.color = 'var(--text-muted)';
    const data = {
      user:    document.getElementById('cfg-s2-user').value.trim(),
      token:   document.getElementById('cfg-s2-token').value.trim(),
      url:     document.getElementById('cfg-s2-url').value.trim(),
      builds:  parseInt(document.getElementById('cfg-s2-builds').value) || 5,
      console: document.getElementById('cfg-s2-console').value.trim(),
    };
    const res = await apiFetch(`${API_CFG}?action=save-step2-settings`, { method:'POST', body: JSON.stringify(data) });
    if (res.success) { msg.innerHTML = '<i data-icon="check-circle"></i> บันทึกแล้ว'; msg.style.color = '#22c55e'; }
    else             { msg.innerHTML = '<i data-icon="x-circle"></i> ' + (res.message||'Error'); msg.style.color = '#ef4444'; }
    setTimeout(() => { msg.textContent=''; }, 3000);
  }

  async function saveStep3Settings() {
    const msg = document.getElementById('step3-status');
    msg.textContent = 'กำลังบันทึก…'; msg.style.color = 'var(--text-muted)';
    const data = {
      url:         document.getElementById('cfg-s3-url').value.trim(),
      partner:     document.getElementById('cfg-s3-partner').value.trim(),
      guide_step1: document.getElementById('cfg-s3-step1').value.trim(),
      guide_step2: document.getElementById('cfg-s3-step2').value.trim(),
      selector:    document.getElementById('cfg-s3-selector').value.trim(),
    };
    const res = await apiFetch(`${API_CFG}?action=save-step3-settings`, { method:'POST', body: JSON.stringify(data) });
    if (res.success) { msg.innerHTML = '<i data-icon="check-circle"></i> บันทึกแล้ว'; msg.style.color = '#22c55e'; }
    else             { msg.innerHTML = '<i data-icon="x-circle"></i> ' + (res.message||'Error'); msg.style.color = '#ef4444'; }
    setTimeout(() => { msg.textContent=''; }, 3000);
  }

  // ════════════════════════════════════════════════
  // RECONCILE
  // ════════════════════════════════════════════════
  async function loadReconcileStatus() {
    const res = await apiFetch(`${API_CFG}?action=get-reconcile-status`);
    const row = document.getElementById('recon-status-row');
    if (res.success && res.data.configured) {
      row.className = 'recon-status-row ok';
      document.getElementById('recon-status-icon').innerHTML = '<i data-icon="check-circle"></i>';
      document.getElementById('recon-status-text').textContent = `Configured — ${escHtml(res.data.username)}`;
      document.getElementById('recon-user').value = res.data.username;
    } else {
      row.className = 'recon-status-row none';
      document.getElementById('recon-status-icon').innerHTML = '<i data-icon="alert-triangle"></i>';
      document.getElementById('recon-status-text').textContent = 'ยังไม่ได้ตั้งค่า Credentials';
    }
  }

  async function saveReconcile() {
    const user = document.getElementById('recon-user').value.trim();
    const pass = document.getElementById('recon-pass').value;
    const msg  = document.getElementById('recon-status-msg');
    if (!user || !pass) { msg.innerHTML = '<i data-icon="alert-triangle"></i> กรุณากรอกให้ครบ'; msg.style.color = '#ef4444'; return; }
    msg.textContent = 'กำลังทดสอบ login…'; msg.style.color = 'var(--text-muted)';
    try {
      const KC_TOKEN_URL = 'https://acm-backoffice-aaa.backoffice-a-cloud1p.ascendmoney.io/realms/finops/protocol/openid-connect/token';
      const body = new URLSearchParams({ grant_type:'password', client_id:'financial-portal-ui', username:user, password:pass, scope:'openid profile api_scope email' });
      const testResp = await fetch(KC_TOKEN_URL, { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body: body.toString() });
      if (!testResp.ok) {
        const json = await testResp.json().catch(() => ({}));
        msg.innerHTML = '<i data-icon="x-circle"></i> ทดสอบ login ไม่สำเร็จ: ' + (json.error_description || json.error || 'Login failed');
        msg.style.color = '#ef4444'; return;
      }
      const testJson = await testResp.json();
      if (!testJson.access_token) { msg.innerHTML = '<i data-icon="x-circle"></i> ไม่ได้รับ token'; msg.style.color = '#ef4444'; return; }
      msg.textContent = 'กำลังบันทึก…'; msg.style.color = 'var(--text-muted)';
      const res = await apiFetch(`${API_CFG}?action=save-reconcile`, { method:'POST', body: JSON.stringify({ username:user, password:pass }) });
      if (res.success) {
        msg.innerHTML = '<i data-icon="check-circle"></i> บันทึกแล้ว (ทดสอบ login สำเร็จ)';
        msg.style.color = '#22c55e';
        document.getElementById('recon-pass').value = '';
        loadReconcileStatus();
      } else {
        msg.innerHTML = '<i data-icon="x-circle"></i> ' + (res.message||'Error'); msg.style.color = '#ef4444';
      }
    } catch (err) {
      msg.innerHTML = '<i data-icon="x-circle"></i> เกิดข้อผิดพลาด: ' + err.message; msg.style.color = '#ef4444';
    }
    setTimeout(() => { msg.textContent=''; }, 5000);
  }

  // ════════════════════════════════════════════════
  // RECORDS — Inline Edit Table  (with brand filter)
  // ════════════════════════════════════════════════
  let records             = [];
  let expandedRows        = new Set();
  let activeAdminRecordsBrand = 'tmn';

  function setAdminRecordsBrand(brand) {
    activeAdminRecordsBrand = brand;
    document.querySelectorAll('#rec-brand-tabs .rec-brand-tab').forEach(b => {
      b.classList.toggle('active', b.dataset.brand === brand);
    });
    renderTable();
  }

  async function loadRecords() {
    const sub = document.getElementById('records-sub');
    if (sub) sub.textContent = 'กำลังโหลด…';
    const res = await apiFetch(`${API_REC}?action=list`);
    if (!res.success) { if (sub) sub.innerHTML = '<i data-icon="x-circle"></i> โหลดไม่ได้'; return; }
    records = (res.data || []).slice().reverse();
    if (sub) {
      const tmnCount = records.filter(r => (r.brand || 'tmn') === 'tmn').length;
      const vbCount  = records.filter(r => (r.brand || 'tmn') === 'vb').length;
      sub.textContent = `TMN: ${tmnCount} · VB: ${vbCount} records`;
    }
    renderTable();
  }

  function pillHtml(val) {
    const map = {
      Success: ['spill-success','<i data-icon="check-circle"></i> Success'],
      Fail:    ['spill-fail',   '<i data-icon="x-circle"></i> Fail'],
      NA:      ['spill-na',     '— N/A'],
      OK:      ['spill-ok',     '<i data-icon="check-circle"></i> OK'],
    };
    const [cls, label] = map[val] || ['spill-na', escHtml(val||'—')];
    return `<span class="spill ${cls}">${label}</span>`;
  }

  function inlineSelHtml(opts) {
    const labels = { Success:'<i data-icon="check-circle"></i> Success', Fail:'<i data-icon="x-circle"></i> Fail', NA:'— N/A', OK:'<i data-icon="check-circle"></i> OK' };
    return `<span class="inline-sel">` +
      opts.map(v => `<button type="button" class="inline-sel-btn" data-v="${v}">${labels[v]||v}</button>`).join('') +
    `</span>`;
  }

  function renderTable() {
    const empty = document.getElementById('rec-empty');
    const table = document.getElementById('rec-table');

    const visRecords = records.filter(r => (r.brand || 'tmn') === activeAdminRecordsBrand);
    const visGroups  = groups.filter(g => (g.brand || 'tmn') === activeAdminRecordsBrand);

    if (!visRecords.length) {
      table.style.display = 'none';
      const brandLabel = activeAdminRecordsBrand.toUpperCase();
      empty.innerHTML = `<div class="rec-empty-icon"><i data-icon="inbox"></i></div><div>ยังไม่มีข้อมูลของ ${brandLabel}</div>`;
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';
    table.style.display = '';

    const groupCols = visGroups.map(g =>
      `<th title="${escHtml(g.name)}">${escHtml(g.name.split('(')[0].split('|')[0].trim())}</th>`
    ).join('');
    document.getElementById('rec-thead').innerHTML = `
      <tr>
        <th class="th-sticky" style="width:28px"></th>
        <th>Date / Time</th>
        <th>Reporter</th>
        ${groupCols}
        <th>Edited</th>
        <th></th>
      </tr>`;

    document.getElementById('rec-tbody').innerHTML = visRecords.map(rec => {
      const dt = new Date(rec.timestamp);
      const dtStr = dt.toLocaleString('th-TH',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
      const isOpen = expandedRows.has(rec.id);

      const groupCells = visGroups.map(g => {
        const svc    = rec.services?.[g.id] || {};
        const status = svc.status || 'NA';
        return `<td class="td-edit" onclick="statusCellClick(this,'${escHtml(rec.id)}','${escHtml(g.id)}','parent')">
          <div class="cell-inner">${pillHtml(status)}<span class="edit-hint"><i data-icon="pencil"></i></span></div>
        </td>`;
      }).join('');

      const editedBadge = rec.edited_at
        ? `<span class="edited-badge"><i data-icon="pencil"></i> ${escHtml(rec.edited_by||'')} ${new Date(rec.edited_at).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})}</span>`
        : '';

      const mainRow = `<tr data-id="${escHtml(rec.id)}">
        <td class="td-expand">
          <div class="cell-inner" style="justify-content:center;padding:0">
            <button class="btn-expand ${isOpen?'open':''}" onclick="toggleExpand('${escHtml(rec.id)}')" title="ดู children">⌄</button>
          </div>
        </td>
        <td class="td-edit" onclick="textCellClick(this,'${escHtml(rec.id)}','timestamp')">
          <div class="cell-inner"><span class="cell-val">${escHtml(dtStr)}</span><span class="edit-hint"><i data-icon="pencil"></i></span></div>
        </td>
        <td class="td-edit" onclick="textCellClick(this,'${escHtml(rec.id)}','reporter')">
          <div class="cell-inner"><span class="cell-val">${escHtml(rec.reporter)}</span><span class="edit-hint"><i data-icon="pencil"></i></span></div>
        </td>
        ${groupCells}
        <td><div class="cell-inner">${editedBadge}</div></td>
        <td class="td-del">
          <div class="cell-inner" style="justify-content:center;padding:0">
            <button class="btn-icon danger" onclick="deleteRecord('${escHtml(rec.id)}')" title="ลบ"><i data-icon="trash"></i></button>
          </div>
        </td>
      </tr>`;

      const subRow = isOpen ? buildSubRow(rec, visGroups) : '';
      return mainRow + subRow;
    }).join('');
  }

  function buildSubRow(rec, visGroups) {
    const cells = visGroups.map(g => {
      const svc = rec.services?.[g.id] || {};
      if (!g.children?.length) return `<td colspan="1"></td>`;
      const items = g.children.map(c => {
        const cv = svc.children?.[c] || 'NA';
        return `<span class="sub-child-item">
          <span class="sub-child-name">${escHtml(c)}:</span>
          <span onclick="statusCellClick(this,'${escHtml(rec.id)}','${escHtml(g.id)}','child','${escHtml(c)}')">${pillHtml(cv)}</span>
        </span>`;
      }).join('');
      return `<td title="${escHtml(g.name)}" style="padding:0">
        <div class="cell-inner" style="flex-wrap:wrap;gap:4px 10px;padding:6px 10px;">${items}</div>
      </td>`;
    }).join('');
    return `<tr class="rec-sub-row" data-sub="${escHtml(rec.id)}">
      <td colspan="3" style="padding:0">
        <div class="cell-inner" style="padding:6px 10px;font-size:9px;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em">children</div>
      </td>
      ${cells}
      <td colspan="2"></td>
    </tr>`;
  }

  function toggleExpand(id) {
    if (expandedRows.has(id)) expandedRows.delete(id); else expandedRows.add(id);
    renderTable();
  }

  function textCellClick(td, recId, field) {
    if (td.querySelector('input')) return;
    const inner = td.querySelector('.cell-inner');
    const rec   = records.find(r => r.id === recId);
    let inputEl;
    if (field === 'timestamp') {
      const iso = new Date(rec.timestamp).toISOString().slice(0,16);
      inputEl = document.createElement('input');
      inputEl.type = 'datetime-local'; inputEl.value = iso; inputEl.className = 'cell-input';
    } else {
      inputEl = document.createElement('input');
      inputEl.type = 'text'; inputEl.value = rec.reporter; inputEl.className = 'cell-input';
    }
    inner.innerHTML = '';
    inner.appendChild(inputEl);
    inputEl.focus();
    const commit = async () => {
      const newVal = inputEl.value.trim();
      if (!newVal) { renderTable(); return; }
      const payload = { id: recId };
      if (field === 'timestamp') payload.timestamp = new Date(newVal).toISOString();
      else payload.reporter = newVal;
      if (field === 'timestamp') rec.timestamp = payload.timestamp;
      else rec.reporter = newVal;
      inner.innerHTML = '<span class="saving-dot"></span>';
      const res = await apiFetch(`${API_REC}?action=edit`, { method:'POST', body: JSON.stringify(payload) });
      if (res.success) { Object.assign(rec, res.data); renderTable(); }
      else {
        inner.innerHTML = `<span style="color:#ef4444;font-size:10px"><i data-icon="x-circle"></i> ${escHtml(res.message||'')}</span>`;
        setTimeout(renderTable, 1500);
      }
    };
    inputEl.addEventListener('blur', commit);
    inputEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); inputEl.blur(); } if (e.key === 'Escape') renderTable(); });
  }

  function statusCellClick(el, recId, gId, type, childName) {
    const container = type === 'parent' ? el.querySelector('.cell-inner') : el.parentElement;
    if (container?.querySelector('.inline-sel')) return;
    const rec     = records.find(r => r.id === recId);
    const svc     = rec?.services?.[gId] || {};
    const opts    = type === 'parent' ? ['Success','Fail','NA'] : ['OK','Fail','NA'];
    const selEl   = document.createElement('span');
    selEl.innerHTML = inlineSelHtml(opts);
    const selSpan = selEl.firstChild;
    const pill    = type === 'parent' ? el.querySelector('.spill') : el;
    pill.replaceWith(selSpan);
    selSpan.querySelectorAll('.inline-sel-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const newVal = btn.dataset.v;
        const newSvc = JSON.parse(JSON.stringify(svc));
        if (type === 'parent') newSvc.status = newVal;
        else newSvc.children = { ...(newSvc.children||{}), [childName]: newVal };
        const services = { ...rec.services, [gId]: newSvc };
        selSpan.replaceWith(document.createTextNode('…'));
        const res = await apiFetch(`${API_REC}?action=edit`, { method:'POST', body: JSON.stringify({ id:recId, services }) });
        if (res.success) { Object.assign(rec, res.data); renderTable(); }
        else renderTable();
      });
    });
    setTimeout(() => {
      document.addEventListener('click', function cancel(e) {
        if (!selSpan.contains(e.target)) { renderTable(); document.removeEventListener('click', cancel); }
      });
    }, 0);
  }

  async function deleteRecord(id) {
    if (!confirm('ลบ record นี้ใช่มั้ย?')) return;
    const res = await apiFetch(`${API_REC}?action=delete`, { method:'POST', body: JSON.stringify({ id }) });
    if (res.success) loadRecords();
    else alert('ลบไม่ได้: ' + (res.message||''));
  }

  async function clearBrandRecords() {
    const brand = activeAdminRecordsBrand.toUpperCase();
    const visCount = records.filter(r => (r.brand || 'tmn') === activeAdminRecordsBrand).length;
    if (!confirm(`ลบ records ของ ${brand} ทั้งหมด ${visCount} รายการใช่มั้ย?\n\nไม่สามารถกู้คืนได้`)) return;

    const brandRecords = records.filter(r => (r.brand || 'tmn') === activeAdminRecordsBrand);
    let deleted = 0;
    for (const rec of brandRecords) {
      const res = await apiFetch(`${API_REC}?action=delete`, { method:'POST', body: JSON.stringify({ id: rec.id }) });
      if (res.success) deleted++;
    }
    alert(`ลบแล้ว ${deleted} records ของ ${brand}`);
    loadRecords();
  }

  // ── Init ─────────────────────────────────────────────────────
  Promise.all([loadGroups(), loadReconcileStatus(), loadAllSettings()]).then(() => loadRecords());

  // ── re-publish to global ──
  try { Object.defineProperty(window, "addChild",           { configurable:true, get:()=>addChild,           set:(v)=>{addChild=v;} }); } catch(e){}
  try { Object.defineProperty(window, "addGroupConfirm",    { configurable:true, get:()=>addGroupConfirm,    set:(v)=>{addGroupConfirm=v;} }); } catch(e){}
  try { Object.defineProperty(window, "apiFetch",           { configurable:true, get:()=>apiFetch,           set:(v)=>{apiFetch=v;} }); } catch(e){}
  try { Object.defineProperty(window, "buildSubRow",        { configurable:true, get:()=>buildSubRow,        set:(v)=>{buildSubRow=v;} }); } catch(e){}
  try { Object.defineProperty(window, "clearBrandRecords",  { configurable:true, get:()=>clearBrandRecords,  set:(v)=>{clearBrandRecords=v;} }); } catch(e){}
  try { Object.defineProperty(window, "deleteChild",        { configurable:true, get:()=>deleteChild,        set:(v)=>{deleteChild=v;} }); } catch(e){}
  try { Object.defineProperty(window, "deleteGroup",        { configurable:true, get:()=>deleteGroup,        set:(v)=>{deleteGroup=v;} }); } catch(e){}
  try { Object.defineProperty(window, "deleteRecord",       { configurable:true, get:()=>deleteRecord,       set:(v)=>{deleteRecord=v;} }); } catch(e){}
  try { Object.defineProperty(window, "inlineSelHtml",      { configurable:true, get:()=>inlineSelHtml,      set:(v)=>{inlineSelHtml=v;} }); } catch(e){}
  try { Object.defineProperty(window, "loadAllSettings",    { configurable:true, get:()=>loadAllSettings,    set:(v)=>{loadAllSettings=v;} }); } catch(e){}
  try { Object.defineProperty(window, "loadGroups",         { configurable:true, get:()=>loadGroups,         set:(v)=>{loadGroups=v;} }); } catch(e){}
  try { Object.defineProperty(window, "loadReconcileStatus",{ configurable:true, get:()=>loadReconcileStatus,set:(v)=>{loadReconcileStatus=v;} }); } catch(e){}
  try { Object.defineProperty(window, "loadRecords",        { configurable:true, get:()=>loadRecords,        set:(v)=>{loadRecords=v;} }); } catch(e){}
  try { Object.defineProperty(window, "pillHtml",           { configurable:true, get:()=>pillHtml,           set:(v)=>{pillHtml=v;} }); } catch(e){}
  try { Object.defineProperty(window, "renderGroups",       { configurable:true, get:()=>renderGroups,       set:(v)=>{renderGroups=v;} }); } catch(e){}
  try { Object.defineProperty(window, "renderTable",        { configurable:true, get:()=>renderTable,        set:(v)=>{renderTable=v;} }); } catch(e){}
  try { Object.defineProperty(window, "saveGroups",         { configurable:true, get:()=>saveGroups,         set:(v)=>{saveGroups=v;} }); } catch(e){}
  try { Object.defineProperty(window, "saveReconcile",      { configurable:true, get:()=>saveReconcile,      set:(v)=>{saveReconcile=v;} }); } catch(e){}
  try { Object.defineProperty(window, "saveStep1Settings",  { configurable:true, get:()=>saveStep1Settings,  set:(v)=>{saveStep1Settings=v;} }); } catch(e){}
  try { Object.defineProperty(window, "saveStep2Settings",  { configurable:true, get:()=>saveStep2Settings,  set:(v)=>{saveStep2Settings=v;} }); } catch(e){}
  try { Object.defineProperty(window, "saveStep3Settings",  { configurable:true, get:()=>saveStep3Settings,  set:(v)=>{saveStep3Settings=v;} }); } catch(e){}
  try { Object.defineProperty(window, "setAdminRecordsBrand",{ configurable:true, get:()=>setAdminRecordsBrand,set:(v)=>{setAdminRecordsBrand=v;} }); } catch(e){}
  try { Object.defineProperty(window, "statusCellClick",    { configurable:true, get:()=>statusCellClick,    set:(v)=>{statusCellClick=v;} }); } catch(e){}
  try { Object.defineProperty(window, "textCellClick",      { configurable:true, get:()=>textCellClick,      set:(v)=>{textCellClick=v;} }); } catch(e){}
  try { Object.defineProperty(window, "toggleAddForm",      { configurable:true, get:()=>toggleAddForm,      set:(v)=>{toggleAddForm=v;} }); } catch(e){}
  try { Object.defineProperty(window, "toggleExpand",       { configurable:true, get:()=>toggleExpand,       set:(v)=>{toggleExpand=v;} }); } catch(e){}
})();
