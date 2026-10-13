// admin/service-severity — page script, extracted from admin/service-severity.html.
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

(() => {
  'use strict';

  if (!Auth.requireAdmin()) return;
  Layout.render('admin-service-severity');

  // ── State ────────────────────────────────────────────────────────
  const state = {
    all: [],
    filter: 'all',
    runway: 'all',
    search: '',
    editing: null,
    editPriority: 'P3',
    deleting: null,
    importRows: [],
    importMode: 'replace',
  };

  // ── DOM helpers ──────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  // ── Modal: uses global .modal-overlay + .active pattern ───────────
  function openModal(id) {
    const el = $(id);
    if (!el) return;
    el.classList.add('active');
  }
  function closeModal(id) {
    const el = $(id);
    if (!el) return;
    el.classList.remove('active');
  }

  // ── API ──────────────────────────────────────────────────────────
  async function apiGet(action, extra = '') {
    return await API.get('/service-severity/index.php?action=' + action + extra);
  }
  async function apiPost(body) {
    return await API.post('/service-severity/index.php', body);
  }

  // ── Load ─────────────────────────────────────────────────────────
  async function loadStats() {
    const res = await apiGet('stats');
    if (!res?.ok) return;
    const d = res.data?.data || {};
    $('stat-total').textContent = d.total ?? 0;
    $('stat-p1').textContent    = d.byPriority?.P1 ?? 0;
    $('stat-p2').textContent    = d.byPriority?.P2 ?? 0;
    $('stat-p3').textContent    = d.byPriority?.P3 ?? 0;
    if (d.lastUpdated) {
      $('stat-updated').textContent = new Date(d.lastUpdated).toLocaleString('th-TH', { dateStyle:'short', timeStyle:'short' });
    } else {
      $('stat-updated').textContent = '—';
    }
  }

  async function loadList() {
    const qp = state.search ? '&search=' + encodeURIComponent(state.search) : '';
    const res = await apiGet('list', qp);
    if (!res?.ok) {
      $('table-wrap').innerHTML = '<div class="ss-table-empty" style="color:#dc2626">โหลดไม่สำเร็จ: ' + esc(res?.data?.message || 'unknown error') + '</div>';
      return;
    }
    state.all = res.data?.data?.services || [];
    renderTable();
  }

  async function loadAll() {
    await Promise.all([loadStats(), loadList()]);
  }

  // ── Render table ─────────────────────────────────────────────────
  function pbadge(p) {
    if (p === 'P1') return '<span class="pbadge p1"><span class="dot"></span>P1 · Critical</span>';
    if (p === 'P2') return '<span class="pbadge p2"><span class="dot"></span>P2 · Warning</span>';
    return '<span class="pbadge p3"><span class="dot"></span>P3 · Info</span>';
  }

  const ICON_EDIT = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
  const ICON_DEL  = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>';

  function rwbadge(rw) {
    if (!rw) return '<span class="ss-svcgrp" style="color:var(--text-muted)">—</span>';
    const cls = rw === 'OCP' ? 'ocp' : (rw === 'EKS NANO' ? 'nano' : 'tmn');
    return `<span class="rw-badge rw-${cls}">${esc(rw)}</span>`;
  }

  function renderTable() {
    const rows = state.all.filter(s =>
      (state.filter === 'all' || s.priority === state.filter) &&
      (state.runway === 'all' || (s.runway || '') === state.runway)
    );

    if (!rows.length) {
      $('table-wrap').innerHTML = '<div class="ss-table-empty">ไม่พบ service ที่ตรงกัน</div>';
      $('table-foot').style.display = 'none';
      return;
    }

    const html = `
      <table class="ss-table">
        <thead><tr>
          <th style="width:34%">Service Name</th>
          <th>Group</th>
          <th>BU</th>
          <th style="width:110px">Runway</th>
          <th style="width:170px">Priority</th>
          <th style="width:90px;text-align:right">Actions</th>
        </tr></thead>
        <tbody>${rows.map(s => `
          <tr data-name="${esc(s.name)}">
            <td class="ss-svcname">${esc(s.name)}</td>
            <td class="ss-svcgrp">${esc(s.serviceGroup || '—')}</td>
            <td class="ss-svcgrp">${esc(s.bu || '—')}</td>
            <td>${rwbadge(s.runway || '')}</td>
            <td>${pbadge(s.priority)}</td>
            <td>
              <div class="row-actions" style="justify-content:flex-end">
                <button class="icon-btn"        data-action="edit"   title="Edit">${ICON_EDIT}</button>
                <button class="icon-btn danger" data-action="delete" title="Delete">${ICON_DEL}</button>
              </div>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>`;

    $('table-wrap').innerHTML = html;
    $('table-foot').style.display = 'flex';
    $('table-count').textContent = `${rows.length} services`;
    const parts = [];
    if (state.filter !== 'all') parts.push(state.filter);
    if (state.runway !== 'all') parts.push(state.runway);
    if (state.search)           parts.push(`"${state.search}"`);
    $('table-filter').textContent = parts.length ? 'Filter: ' + parts.join(' · ') : 'All services';
  }

  // ── Edit modal ───────────────────────────────────────────────────
  function selectPriority(p) {
    state.editPriority = p;
    document.querySelectorAll('#psel .popt').forEach(el => {
      el.classList.remove('sel','p1','p2','p3');
      if (el.dataset.p === p) {
        el.classList.add('sel', p.toLowerCase());
      }
    });
  }

  function openAdd() {
    state.editing = null;
    $('edit-title').textContent = 'Add Service';
    $('f-name').value   = '';
    $('f-name').disabled = false;
    $('f-group').value  = '';
    $('f-bu').value     = 'Truemoney';
    $('f-runway').value = state.runway === 'all' ? '' : state.runway;
    selectPriority('P3');
    openModal('modal-edit');
    setTimeout(() => $('f-name').focus(), 60);
  }

  function openEdit(svc) {
    state.editing = svc.name;
    $('edit-title').textContent = 'Edit Service';
    $('f-name').value   = svc.name;
    $('f-name').disabled = true;
    $('f-group').value  = svc.serviceGroup || '';
    $('f-bu').value     = svc.bu || 'Truemoney';
    $('f-runway').value = svc.runway || '';
    selectPriority(svc.priority || 'P3');
    openModal('modal-edit');
  }

  async function saveEdit() {
    const name   = $('f-name').value.trim();
    const prio   = state.editPriority;
    const group  = $('f-group').value.trim();
    const bu     = $('f-bu').value.trim() || 'Truemoney';
    const runway = $('f-runway').value;

    if (!name) { showToast?.('กรุณากรอก Service Name', 'error'); return; }

    const btn = $('btn-save');
    btn.disabled = true; btn.textContent = 'Saving…';

    const res = await apiPost({ action: 'upsert', name, priority: prio, serviceGroup: group, bu, runway });

    btn.disabled = false; btn.textContent = 'Save';
    if (res?.ok) {
      showToast?.(`Saved: ${name} → ${prio}`, 'success');
      closeModal('modal-edit');
      loadAll();
    } else {
      showToast?.(res?.data?.message || 'บันทึกไม่สำเร็จ', 'error');
    }
  }

  // ── Delete modal ─────────────────────────────────────────────────
  function openDelete(name) {
    state.deleting = name;
    $('del-name').textContent = name;
    openModal('modal-delete');
  }

  async function confirmDelete() {
    if (!state.deleting) return;
    const btn = $('btn-del-confirm');
    btn.disabled = true; btn.textContent = 'Deleting…';

    const res = await apiPost({ action: 'delete', name: state.deleting });

    btn.disabled = false; btn.textContent = 'Delete';
    if (res?.ok) {
      showToast?.('Deleted: ' + state.deleting, 'success');
      closeModal('modal-delete');
      loadAll();
    } else {
      showToast?.(res?.data?.message || 'ลบไม่สำเร็จ', 'error');
    }
    state.deleting = null;
  }

  // ── Import modal ─────────────────────────────────────────────────
  function openImport() {
    state.importRows = [];
    state.importMode = 'replace';
    $('preview-wrap').classList.remove('show');
    $('btn-import-do').disabled = true;
    $('csv-input').value = '';
    setImportMode('replace');
    openModal('modal-import');
  }

  function setImportMode(m) {
    state.importMode = m;
    $('mode-merge').classList.toggle('on', m === 'merge');
    $('mode-replace').classList.toggle('on', m === 'replace');
  }

  function parseCsv(file) {
    const reader = new FileReader();
    reader.onload = e => {
      const lines = e.target.result.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (!lines.length) return;

      const header = lines[0].split(',').map(h => h.replace(/^"+|"+$/g,'').trim());
      const nameIdx  = header.findIndex(h => /service.?name/i.test(h));
      const prioIdx  = header.findIndex(h => /priority/i.test(h));
      const groupIdx = header.findIndex(h => /service.?group/i.test(h));
      const buIdx    = header.findIndex(h => /^bu$/i.test(h));

      if (nameIdx < 0 || prioIdx < 0) {
        showToast?.('CSV ต้องมีคอลัมน์ "Service name" และ "Priority"', 'error');
        return;
      }

      state.importRows = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map(c => c.replace(/^"+|"+$/g,'').trim());
        const name = cols[nameIdx];
        const prio = (cols[prioIdx] || '').toUpperCase();
        if (!name || !['P1','P2','P3'].includes(prio)) continue;
        state.importRows.push({
          name,
          priority: prio,
          serviceGroup: groupIdx >= 0 ? cols[groupIdx] : '',
          bu: buIdx >= 0 ? cols[buIdx] : 'Truemoney',
        });
      }

      const preview = state.importRows.slice(0, 10);
      const more = state.importRows.length > 10
        ? `<tr><td colspan="3" style="color:var(--text-muted);font-style:italic;text-align:center">…และอีก ${state.importRows.length - 10} services</td></tr>` : '';

      $('preview-label').textContent = `พบ ${state.importRows.length} services valid`;
      $('preview-table').innerHTML = `
        <table>
          <thead><tr><th>Service</th><th>Priority</th><th>Group</th></tr></thead>
          <tbody>
            ${preview.map(r => `<tr>
              <td style="font-family:ui-monospace,monospace;font-size:11px">${esc(r.name)}</td>
              <td>${pbadge(r.priority)}</td>
              <td style="color:var(--text-muted)">${esc(r.serviceGroup)}</td>
            </tr>`).join('')}
            ${more}
          </tbody>
        </table>`;
      $('preview-wrap').classList.add('show');
      $('btn-import-do').disabled = state.importRows.length === 0;
    };
    reader.readAsText(file);
  }

  async function doImport() {
    if (!state.importRows.length) return;
    const btn = $('btn-import-do');
    btn.disabled = true; btn.textContent = 'Importing…';

    const res = await apiPost({ action: 'import', mode: state.importMode, data: state.importRows });

    btn.disabled = false; btn.textContent = 'Import';
    if (res?.ok) {
      const d = res.data?.data;
      showToast?.(`Imported ${d?.imported} services (skipped: ${d?.skipped})`, 'success');
      closeModal('modal-import');
      loadAll();
    } else {
      showToast?.(res?.data?.message || 'Import ไม่สำเร็จ', 'error');
    }
  }

  // ── Wire up event listeners ──────────────────────────────────────
  function wire() {
    // Top buttons
    $('btn-add').addEventListener('click', openAdd);
    $('btn-import').addEventListener('click', openImport);
    $('btn-sync').addEventListener('click', openSync);
    $('btn-sync-save').addEventListener('click', saveSyncUrl);
    $('btn-sync-run').addEventListener('click', runSync);
    $('btn-sync-confirm').addEventListener('click', performSync);
    $('btn-webhooks').addEventListener('click', openWebhooks);
    $('webhooks-list').addEventListener('click', onWebhooksAction);

    // Modal close buttons (all elements with data-close)
    document.querySelectorAll('[data-close]').forEach(b => {
      b.addEventListener('click', () => closeModal(b.dataset.close));
    });

    // Close modal by clicking overlay
    document.querySelectorAll('.modal-overlay').forEach(ov => {
      ov.addEventListener('click', e => {
        if (e.target === ov) closeModal(ov.id);
      });
    });

    // Priority selector
    document.querySelectorAll('#psel .popt').forEach(el => {
      el.addEventListener('click', () => selectPriority(el.dataset.p));
    });

    // Save / Delete
    $('btn-save').addEventListener('click', saveEdit);
    $('btn-del-confirm').addEventListener('click', confirmDelete);

    // Priority tabs
    document.querySelectorAll('#prio-tabs .ss-tab').forEach(t => {
      t.addEventListener('click', () => {
        state.filter = t.dataset.p;
        document.querySelectorAll('#prio-tabs .ss-tab').forEach(x => x.classList.toggle('active', x === t));
        renderTable();
      });
    });

    // Runway tabs
    document.querySelectorAll('#runway-tabs .ss-tab').forEach(t => {
      t.addEventListener('click', () => {
        state.runway = t.dataset.rw;
        document.querySelectorAll('#runway-tabs .ss-tab').forEach(x => x.classList.toggle('active', x === t));
        renderTable();
      });
    });

    // Search (debounced)
    let searchTimer;
    $('search').addEventListener('input', e => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.search = e.target.value.trim();
        loadList();
      }, 200);
    });

    // Table action delegation
    $('table-wrap').addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const tr = btn.closest('tr[data-name]');
      if (!tr) return;
      const name = tr.dataset.name;
      const svc = state.all.find(s => s.name === name);
      if (!svc) return;
      if (btn.dataset.action === 'edit')   openEdit(svc);
      if (btn.dataset.action === 'delete') openDelete(name);
    });

    // Import: drop zone
    const dz = $('drop-zone');
    const ci = $('csv-input');
    dz.addEventListener('click', () => ci.click());
    ci.addEventListener('change', e => { if (e.target.files[0]) parseCsv(e.target.files[0]); });
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', e => {
      e.preventDefault();
      dz.classList.remove('over');
      if (e.dataTransfer.files[0]) parseCsv(e.dataTransfer.files[0]);
    });

    // Import mode toggle
    $('mode-merge').addEventListener('click', () => setImportMode('merge'));
    $('mode-replace').addEventListener('click', () => setImportMode('replace'));
    $('btn-import-do').addEventListener('click', doImport);

    // Keyboard: ESC close, Ctrl+Enter save
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        ['modal-edit','modal-delete','modal-import'].forEach(closeModal);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        if ($('modal-edit').classList.contains('active')) saveEdit();
      }
    });
  }

  // ── Sync from Sheet (via n8n) ───────────────────────────────────
  // API wrapper shape: res = { ok, status, data: { success, message, data: <payload> } }
  // So actual payload lives at res.data.data
  async function openSync() {
    openModal('modal-sync');
    $('sync-result').innerHTML = '';
    $('sync-last').textContent  = 'Loading…';

    const [cfg, last] = await Promise.all([
      API.get('/n8n-severity-config.php'),
      API.get('/n8n-severity-sync.php'),
    ]);
    $('sync-url').value = cfg?.data?.data?.webhook_url || '';
    renderLastSync(last?.data?.data?.lastSync);
  }

  function renderLastSync(s) {
    if (!s) { $('sync-last').textContent = 'ยังไม่เคย sync'; return; }
    $('sync-last').innerHTML =
      `<b>ครั้งล่าสุด:</b> ${new Date(s.syncedAt).toLocaleString('th-TH')} โดย ${esc(s.syncedBy || '')} · ` +
      `<b>+${s.added}</b> / <b>~${s.updated}</b> / <b>−${s.deleted}</b> · ` +
      `total ${s.sheetTotal}` +
      (s.skippedInvalid ? ` · skipped ${s.skippedInvalid}` : '');
  }

  async function saveSyncUrl() {
    const url = $('sync-url').value.trim();
    if (!url) { Toast.warning('กรอก webhook URL ก่อน'); return; }
    const res = await API.post('/n8n-severity-config.php', { webhook_url: url });
    if (res?.ok && res?.data?.success) {
      Toast.success('บันทึก URL แล้ว');
    } else {
      Toast.error(res?.data?.message || 'บันทึกไม่สำเร็จ');
    }
  }

  function runSync() {
    const url = $('sync-url').value.trim();
    if (!url) { Toast.warning('กรอก webhook URL + กด Save URL ก่อน'); return; }
    openModal('modal-sync-confirm');
  }

  async function performSync() {
    closeModal('modal-sync-confirm');
    const btn = $('btn-sync-run');

    btn.disabled = true;
    const oldLbl = btn.textContent;
    btn.textContent = 'Syncing…';
    $('sync-result').innerHTML = '<div style="padding:10px 12px;background:rgba(59,130,246,.06);border:1px solid rgba(59,130,246,.25);border-radius:8px;font-size:12px;color:var(--text-muted)">⏳ กำลังดึงข้อมูลจาก Sheet ผ่าน n8n…</div>';

    const res = await API.post('/n8n-severity-sync.php', {});

    btn.disabled = false;
    btn.textContent = oldLbl;

    // Failure path — surface the server message (e.g. "n8n webhook returned HTTP 404 | …")
    if (!res?.ok || !res?.data?.success) {
      const msg = res?.data?.message || `HTTP ${res?.status || 'error'}`;
      $('sync-result').innerHTML =
        `<div style="padding:10px 12px;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.3);border-radius:8px;font-size:12px">` +
        `<b>Sync ไม่สำเร็จ:</b> ${esc(msg)}</div>`;
      Toast.error(msg);
      return;
    }

    const s = res.data.data || {};
    renderLastSync(s);

    const rwParts = Object.entries(s.byRunway || {}).map(([k,v]) => `${esc(k)}: <b>${v}</b>`).join(' · ');
    const addedSample   = s.addedSample   || [];
    const deletedSample = s.deletedSample || [];
    const collisions    = s.collisions    || [];
    const defaultedByRw = s.defaultedByRunway || {};
    const defaultedSamples = s.defaultedSamples || {};
    const lines = [
      `<div style="padding:10px 12px;background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.3);border-radius:8px;font-size:12px;line-height:1.6">`,
      `<b>Sync สำเร็จ</b> · total ${s.sheetTotal || 0} services`,
      rwParts ? `<br><i data-icon=\"circle\"></i> by runway: ${rwParts}` : '',
      `<br><i data-icon=\"circle\"></i> เพิ่ม <b>${s.added || 0}</b> · อัพเดต <b>${s.updated || 0}</b> · ลบ <b>${s.deleted || 0}</b> · ไม่เปลี่ยน ${s.unchanged || 0}`,
      s.skippedInvalid ? `<br><i data-icon=\"circle\"></i> <i data-icon=\"alert-triangle\"></i> skipped invalid: ${s.skippedInvalid}` : '',
      collisions.length    ? `<br><i data-icon=\"circle\"></i> <i data-icon=\"alert-triangle\"></i> cross-tab collisions: <code style="font-size:11px">${collisions.map(esc).join(', ')}</code>` : '',
      addedSample.length   ? `<br><i data-icon=\"circle\"></i> added: <code style="font-size:11px">${addedSample.map(esc).join(', ')}${s.added > addedSample.length ? ', …' : ''}</code>` : '',
      deletedSample.length ? `<br><i data-icon=\"circle\"></i> deleted: <code style="font-size:11px">${deletedSample.map(esc).join(', ')}${s.deleted > deletedSample.length ? ', …' : ''}</code>` : '',
      `</div>`,
    ];

    // Defaulted-priority warning (separate yellow box)
    if (s.defaulted && s.defaulted > 0) {
      const rwBreakdown = Object.entries(defaultedByRw).map(([k,v]) => `${esc(k)}: <b>${v}</b>`).join(' · ');
      const sampleBlocks = Object.entries(defaultedSamples).map(([rw, names]) =>
        `<div style="margin-top:4px"><b>${esc(rw)}:</b> <code style="font-size:11px">${names.map(esc).join(', ')}${(defaultedByRw[rw]||0) > names.length ? ', …' : ''}</code></div>`
      ).join('');
      lines.push(
        `<div style="margin-top:8px;padding:10px 12px;background:rgba(217,119,6,.08);border:1px solid rgba(217,119,6,.32);border-radius:8px;font-size:12px;line-height:1.6">`,
        `<b><i data-icon=\"alert-triangle\"></i> Priority ว่างใน Sheet — default เป็น P3 (info)</b> · รวม <b>${s.defaulted}</b> รายการ`,
        rwBreakdown ? `<br><i data-icon=\"circle\"></i> ${rwBreakdown}` : '',
        sampleBlocks ? `<div style="margin-top:6px;font-size:11px;color:var(--text-muted)">โปรดเติม Priority ใน Sheet ให้รายการเหล่านี้:</div>${sampleBlocks}` : '',
        `</div>`
      );
    }

    $('sync-result').innerHTML = lines.join('');
    Toast.success('Sync สำเร็จ');
    await loadAll();
  }

  // ── Webhooks (Restart Monitor → Google Chat) ─────────────────────
  const webhooksState = { rows: [], dirty: {} };

  async function openWebhooks() {
    openModal('modal-webhooks');
    $('webhooks-list').innerHTML = '<div class="ss-table-empty">กำลังโหลด…</div>';
    $('webhooks-meta').textContent = '';
    await loadWebhooks();
  }

  async function loadWebhooks() {
    const res = await API.get('/restart-monitor-webhooks/index.php');
    if (!res?.ok || !res?.data?.success) {
      $('webhooks-list').innerHTML =
        `<div class="ss-table-empty" style="color:#dc2626">โหลดไม่สำเร็จ: ${esc(res?.data?.message || 'unknown error')}</div>`;
      return;
    }
    const payload = res.data.data || {};
    webhooksState.rows  = payload.runways || [];
    webhooksState.dirty = {};
    renderWebhooks(payload);
  }

  function srcLabel(src) {
    if (src === 'override') return '<span style="display:inline-block;padding:2px 7px;font-size:10px;font-weight:700;background:rgba(34,197,94,.12);color:#16a34a;border-radius:5px">OVERRIDE</span>';
    if (src === 'env')      return '<span style="display:inline-block;padding:2px 7px;font-size:10px;font-weight:700;background:rgba(59,130,246,.12);color:#3b82f6;border-radius:5px">FROM .ENV</span>';
    return '<span style="display:inline-block;padding:2px 7px;font-size:10px;font-weight:700;background:rgba(239,68,68,.12);color:#dc2626;border-radius:5px">NOT SET</span>';
  }

  function renderWebhooks(payload) {
    const rows = webhooksState.rows;
    if (!rows.length) {
      $('webhooks-list').innerHTML = '<div class="ss-table-empty">ยังไม่ได้กำหนด runway ใน <code>data/grafana-runways.json</code></div>';
      return;
    }

    const html = rows.map(r => {
      const accent  = r.color || '#71717a';
      const envHint = r.envName ? `env: <code>${esc(r.envName)}</code>` : 'no env binding';
      const placeholder = r.hasEnv
        ? 'ใช้ค่าจาก .env (ปล่อยว่างเพื่อใช้ค่า .env)'
        : 'วาง Google Chat webhook URL ที่นี่';
      return `
        <div class="webhook-card" data-slug="${esc(r.slug)}" style="margin-bottom:12px;padding:14px 16px;background:var(--card-bg,#fff);border:1px solid var(--border);border-radius:8px;border-left:3px solid ${esc(accent)}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
            <div>
              <div style="font-weight:700;font-size:14px;color:var(--text)">${esc(r.name)}</div>
              <div style="font-size:11px;color:var(--text-muted);margin-top:2px">
                cluster: <code>${esc(r.cluster)}</code> · ${envHint}
              </div>
            </div>
            <div>${srcLabel(r.source)}</div>
          </div>

          <div style="margin-top:10px">
            <input type="url" class="form-control wh-url"
              placeholder="${esc(placeholder)}"
              value="${esc(r.overrideUrl || '')}"
              style="font-family:ui-monospace,SF Mono,monospace;font-size:11.5px">
            <div style="font-size:11px;color:var(--text-muted);margin-top:4px">
              effective: <code>${esc(r.maskedUrl || '— (ยังไม่ได้ตั้งค่า)')}</code>
            </div>
          </div>

          <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
            <button class="btn btn-primary wh-save" data-act="save"><i data-icon=\"save\"></i> Save</button>
            <button class="btn btn-ghost wh-test"   data-act="test"><i data-icon=\"mail\"></i> Test send</button>
            ${r.hasOverride ? '<button class="btn btn-ghost wh-clear" data-act="clear" style="color:#dc2626">↺ Revert to .env</button>' : ''}
          </div>
          <div class="wh-result" style="margin-top:8px;font-size:11.5px"></div>
        </div>`;
    }).join('');

    $('webhooks-list').innerHTML = html;

    const meta = [];
    if (payload?.legacyFallback) meta.push('legacy <code>RESTART_MONITOR_CHAT_WEBHOOK</code> set in .env (used when no per-runway match)');
    if (payload?.updatedAt) meta.push(`last edit: ${new Date(payload.updatedAt).toLocaleString('th-TH')} by ${esc(payload.updatedBy || '')}`);
    $('webhooks-meta').innerHTML = meta.join(' · ');
  }

  function onWebhooksAction(e) {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const card = btn.closest('.webhook-card');
    if (!card) return;
    const slug   = card.dataset.slug;
    const urlEl  = card.querySelector('.wh-url');
    const result = card.querySelector('.wh-result');
    if (btn.dataset.act === 'save')  saveWebhook(slug, urlEl, result, btn);
    if (btn.dataset.act === 'test')  testWebhook(slug, urlEl, result, btn);
    if (btn.dataset.act === 'clear') clearWebhook(slug, result, btn);
  }

  function setResult(el, kind, text) {
    const colors = {
      ok:   ['rgba(34,197,94,.08)',  'rgba(34,197,94,.3)',  '#166534'],
      warn: ['rgba(217,119,6,.08)',  'rgba(217,119,6,.32)', '#92400e'],
      err:  ['rgba(239,68,68,.08)',  'rgba(239,68,68,.3)',  '#991b1b'],
    };
    const [bg, br, fg] = colors[kind] || colors.warn;
    el.innerHTML = `<div style="padding:8px 10px;background:${bg};border:1px solid ${br};color:${fg};border-radius:6px">${text}</div>`;
  }

  async function saveWebhook(slug, urlEl, result, btn) {
    const url = urlEl.value.trim();
    if (!url) { Toast.warning('กรอก webhook URL ก่อน (หรือกด Revert to .env)'); return; }
    btn.disabled = true;
    const oldLbl = btn.textContent; btn.textContent = 'Saving…';
    const res = await API.put('/restart-monitor-webhooks/index.php?slug=' + encodeURIComponent(slug), { url });
    btn.disabled = false; btn.textContent = oldLbl;
    if (res?.ok && res?.data?.success) {
      Toast.success('Saved');
      setResult(result, 'ok', '<i data-icon=\"check\"></i> บันทึก URL แล้ว · จะใช้ตอนรอบ 9 โมงรอบถัดไป');
      await loadWebhooks();
    } else {
      const msg = res?.data?.message || 'บันทึกไม่สำเร็จ';
      Toast.error(msg);
      setResult(result, 'err', '<i data-icon=\"x\"></i> ' + esc(msg));
    }
  }

  async function clearWebhook(slug, result, btn) {
    btn.disabled = true;
    const oldLbl = btn.textContent; btn.textContent = 'Clearing…';
    const res = await API.delete('/restart-monitor-webhooks/index.php?slug=' + encodeURIComponent(slug));
    btn.disabled = false; btn.textContent = oldLbl;
    if (res?.ok && res?.data?.success) {
      Toast.success('Reverted to .env');
      await loadWebhooks();
    } else {
      const msg = res?.data?.message || 'ลบ override ไม่สำเร็จ';
      Toast.error(msg);
      setResult(result, 'err', '<i data-icon=\"x\"></i> ' + esc(msg));
    }
  }

  async function testWebhook(slug, urlEl, result, btn) {
    btn.disabled = true;
    const oldLbl = btn.textContent; btn.textContent = 'Sending…';
    setResult(result, 'warn', '⏳ กำลังส่ง test card…');
    // If user typed a URL, test that one (so they can verify before saving).
    // Otherwise test the resolved effective URL on the server.
    const body = { slug };
    const typed = urlEl.value.trim();
    if (typed) body.url = typed;
    const res = await API.post('/restart-monitor-webhooks/index.php?action=test', body);
    btn.disabled = false; btn.textContent = oldLbl;
    if (res?.ok && res?.data?.success) {
      const code = res.data.data?.httpCode || 200;
      setResult(result, 'ok', `<i data-icon=\"check\"></i> ส่งสำเร็จ (HTTP ${code}) — ตรวจสอบ Google Chat space`);
      Toast.success('Test sent');
    } else {
      const msg = res?.data?.message || 'ส่งไม่สำเร็จ';
      setResult(result, 'err', '<i data-icon=\"x\"></i> ' + esc(msg));
      Toast.error(msg);
    }
  }

  // ── Init ─────────────────────────────────────────────────────────
  wire();
  loadAll();

})();

})();
