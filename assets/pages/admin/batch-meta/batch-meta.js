// admin/batch-meta — page script, extracted from admin/batch-meta.html.
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
Layout.render('admin-batch-meta');

let allConfigs = [], allEntries = [], editingId = null, deletingId = null;
let previewHeaders = [];

// ── Load ───────────────────────────────────────────────────────────
async function loadAll() {
  const res = await API.batchMeta.get();
  if (!res?.ok) {
    document.getElementById('configs-wrap').innerHTML = '<div class="empty-state"><div class="icon"><i data-icon="alert-triangle"></i></div>โหลดข้อมูลไม่สำเร็จ</div>';
    return;
  }
  allConfigs = res.data.data?.configs || [];
  allEntries = res.data.data?.entries || [];
  renderConfigs();
}

function renderConfigs() {
  const wrap = document.getElementById('configs-wrap');
  if (!allConfigs.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="icon"><i data-icon="folder-open"></i></div><div style="font-weight:700;margin-bottom:6px">ยังไม่มี Sheet Config</div><div>กด "+ Add Sheet Config" เพื่อเริ่มต้น</div></div>`;
    return;
  }
  wrap.innerHTML = allConfigs.map(c => renderCfgCard(c)).join('');
}

function renderCfgCard(c) {
  const cnt     = allEntries.filter(e => e.config_id === c.id).length;
  const synced  = c.last_synced
    ? `<span class="badge-synced"><i data-icon="check"></i> ${new Date(c.last_synced).toLocaleDateString('th-TH')}</span>`
    : `<span class="badge-never">ยังไม่ได้ sync</span>`;
  const countBadge = cnt ? `<span class="badge-count">${cnt} entries</span>` : '';
  const mapping = [
    c.col_batch_name >= 0 ? `Batch[${c.col_batch_name}]` : null,
    c.col_batch_url  >= 0 ? `URL[${c.col_batch_url}]`    : null,
    c.col_dev_owner  >= 0 ? `Owner[${c.col_dev_owner}]`  : null,
    c.col_manual_url >= 0 ? `Manual[${c.col_manual_url}]`: null,
    c.col_sm_rerun   >= 0 ? `SM[${c.col_sm_rerun}]`      : null,
    c.col_etc        >= 0 ? `Etc[${c.col_etc}]`          : null,
    c.col_category   >= 0 ? `Cat[${c.col_category}]`     : null,
    c.col_parameter  >= 0 ? `Param[${c.col_parameter}]`  : null,
    c.col_note       >= 0 ? `Note[${c.col_note}]`        : null,
  ].filter(Boolean).join(' · ');

  const samples = allEntries.filter(e => e.config_id === c.id).slice(0, 3);
  const sampleHtml = samples.length ? `<div class="entry-sample">
    <strong style="color:var(--text)">ตัวอย่าง:</strong><br>
    ${samples.map(e => `${escHtml(e.pattern)}${e.dev_owner ? ` <span style="color:var(--orange)">👤${escHtml(e.dev_owner)}</span>` : ''}${e.sm_rerun ? ` ${e.sm_rerun.toLowerCase().includes('sm rerun') ? '🟢' : '🔴'} ${escHtml(e.sm_rerun)}` : ''}`).join('<br>')}
  </div>` : '';

  return `<div class="cfg-card" id="cfg-${escHtml(c.id)}">
    <div class="cfg-header" onclick="toggleCard('${escHtml(c.id)}')">
      <span class="cfg-chevron"><i data-icon="play"></i></span>
      <span class="cfg-name">${escHtml(c.name)}</span>
      <span class="cfg-meta">${escHtml(c.tab_name || c.sheet_id.substring(0, 20) + '…')}</span>
      <div style="display:flex;gap:6px;align-items:center;flex-shrink:0">${countBadge} ${synced}</div>
    </div>
    <div class="cfg-body">
      <div style="font-size:11px;color:var(--text-muted);line-height:1.8;margin-bottom:8px">
        <strong>Sheet ID:</strong> <code style="font-size:10px">${escHtml(c.sheet_id)}</code>
        ${c.gid ? ` · <strong>GID:</strong> ${escHtml(c.gid)}` : ''}
        ${c.tab_name ? ` · <strong>Tab:</strong> ${escHtml(c.tab_name)}` : ''}<br>
        <strong>Columns:</strong> ${mapping || '—'} &nbsp;·&nbsp; <strong>Header row:</strong> ${c.header_row ?? 0}
      </div>
      ${sampleHtml}
      <div class="cfg-actions">
        <button class="btn btn-ghost" style="font-size:11px" onclick="syncConfig('${escHtml(c.id)}', this)"><i data-icon="refresh-cw"></i> Sync Now</button>
        <button class="btn btn-ghost" style="font-size:11px" onclick="openEditModal('${escHtml(c.id)}')">Edit</button>
        <button class="btn" style="font-size:11px;background:#fee2e2;color:#dc2626;border:none" onclick="openDeleteModal('${escHtml(c.id)}','${escHtml(c.name)}')">Del</button>
        <span class="sync-status" id="ss-${escHtml(c.id)}"></span>
      </div>
    </div>
  </div>`;
}

function toggleCard(id) { document.getElementById(`cfg-${id}`)?.classList.toggle('open'); }

// ── Toggle paste area ──────────────────────────────────────────────
function togglePasteArea() {
  const el = document.getElementById('paste-area');
  el.style.display = el.style.display === 'none' ? '' : 'none';
}

// ── Batch pattern extractor — prefer URL last segment, else strip "Pipeline " ──
function extractBatchPattern(rawName, rawUrl) {
  const url = (rawUrl || '').trim();
  if (url) {
    try {
      const path = url.includes('://') ? new URL(url).pathname : url;
      const parts = path.split('/').filter(Boolean);
      if (parts.length) {
        const seg = decodeURIComponent(parts[parts.length - 1]);
        if (seg) return seg;
      }
    } catch { /* fall through */ }
  }
  return (rawName || '').trim().replace(/^pipeline\s+/i, '').trim();
}

// ── Smart TSV/CSV parser (handles multi-line quoted cells) ─────────
function parseDelimited(text) {
  // Auto-detect delimiter from first 500 chars
  const sample     = text.substring(0, 500);
  const tabCount   = (sample.match(/\t/g)  || []).length;
  const commaCount = (sample.match(/,/g)   || []).length;
  const delim      = tabCount >= commaCount ? '\t' : ',';

  const rows = [];
  let cur = [], cell = '', inQ = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i], nx = text[i + 1];
    if (inQ) {
      if (ch === '"' && nx === '"') { cell += '"'; i++; }        // escaped quote
      else if (ch === '"')          { inQ = false; }             // end quote
      else                          { cell += ch; }              // content (incl. \n)
    } else {
      if (ch === '"')               { inQ = true; }              // start quote
      else if (ch === delim)        { cur.push(cell.trim()); cell = ''; }  // column sep
      else if (ch === '\n') {
        cur.push(cell.trim()); cell = '';
        if (cur.some(c => c !== '')) rows.push(cur);             // skip empty rows
        cur = [];
      } else if (ch !== '\r')       { cell += ch; }
    }
  }
  if (cell || cur.length) { cur.push(cell.trim()); if (cur.some(c => c !== '')) rows.push(cur); }

  return { rows, delim };
}

// ── Parse pasted CSV/TSV ───────────────────────────────────────────
function loadFromPaste() {
  const text = document.getElementById('csv-paste').value.trim();
  if (!text) { Toast.error('กรุณา paste CSV/TSV ก่อน'); return; }
  const hRow   = parseInt(document.getElementById('f-header-row').value) || 0;
  const status = document.getElementById('header-status');

  const { rows, delim } = parseDelimited(text);
  buildPreview(rows, hRow, status);
  document.getElementById('paste-area').style.display = 'none';
  Toast.success(`Parsed ${rows.length} rows · delimiter: ${delim === '\t' ? 'TAB' : 'COMMA'}`);
}

// ── Browser-side Google Sheets CSV fetch (no credentials — public sheets only) ─
async function fetchSheetCSV(sheetId, gid, maxRows = 0) {
  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/gviz/tq?tqx=out:csv&headers=0`
            + (gid ? `&gid=${encodeURIComponent(gid)}` : '');
  try {
    const resp = await fetch(url);   // no credentials — works for public sheets
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    if (text.trim().startsWith('<') || text.includes('google.visualization.Query.setResponse'))
      throw new Error('Sheet ต้อง Share เป็น "Anyone with the link" หรือใช้ <i data-icon="clipboard"></i> Paste CSV แทน');
    const lines = text.split('\n').filter(l => l.trim());
    const rows  = lines.map(l => parseCSVLine(l));
    return { ok: true, rows: maxRows ? rows.slice(0, maxRows + 2) : rows };
  } catch (e) {
    return { ok: false, msg: e.message };
  }
}

// ── Shared: build preview + dropdowns ─────────────────────────────
function buildPreview(rows, hRow, statusEl) {
  const headerRowData = rows[hRow] || rows[0] || [];
  // Find first data row (skip empty rows after header)
  const firstDataRow = rows.slice(hRow + 1).find(r => r.some(c => c.trim())) || [];
  previewHeaders = headerRowData.map((h, i) => ({
    idx:    i,
    label:  h.trim() || `col ${i}`,
    sample: (firstDataRow[i] || '').trim(),
  }));
  if (statusEl) { statusEl.innerHTML = `<i data-icon="check"></i> พบ ${previewHeaders.length} columns`; statusEl.style.color = '#16a34a'; }
  const tblWrap = document.getElementById('preview-tbl-wrap');
  const thead   = '<tr>' + previewHeaders.map(h => `<th>(${h.idx}) ${escHtml(h.label)}</th>`).join('') + '</tr>';
  const tbody   = rows.slice(hRow + 1, hRow + 4).map(r =>
    '<tr>' + previewHeaders.map((_, i) => `<td title="${escHtml(r[i]||'')}">${escHtml((r[i]||'').substring(0,30))}</td>`).join('') + '</tr>'
  ).join('');
  tblWrap.innerHTML = `<table class="preview-tbl"><thead>${thead}</thead><tbody>${tbody}</tbody></table>`;
  document.getElementById('preview-area').style.display = '';
  renderColDropdowns();
}

function parseCSVLine(line) {
  const result = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (inQ && line[i+1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
    else if (ch === ',' && !inQ) { result.push(cur); cur = ''; }
    else cur += ch;
  }
  result.push(cur);
  return result;
}

// ── Sync — open paste modal then parse+save ────────────────────────
let _syncTargetId = null;

function syncConfig(id) {
  _syncTargetId = id;
  const cfg = allConfigs.find(c => c.id === id);
  // Pre-fill sheet info hints
  document.getElementById('sync-modal-hint').textContent =
    `Config: ${cfg?.name || id} · Batch col: ${cfg?.col_batch_name ?? '?'} · Owner col: ${cfg?.col_dev_owner ?? '—'}`;
  document.getElementById('sync-csv-paste').value = '';
  document.getElementById('sync-status').textContent = '';
  openModal('modal-sync');
  setTimeout(() => document.getElementById('sync-csv-paste').focus(), 80);
}

async function doSync() {
  const id   = _syncTargetId;
  const text = document.getElementById('sync-csv-paste').value.trim();
  const st   = document.getElementById('sync-status');
  if (!id)   { Toast.error('ไม่พบ Config'); return; }
  if (!text) { Toast.error('กรุณา paste CSV/TSV ก่อน'); return; }

  const cfg = allConfigs.find(c => c.id === id);
  if (!cfg)  { Toast.error('Config not found'); return; }

  const { rows } = parseDelimited(text);
  const hRow       = cfg.header_row     ?? 0;
  const colBatch   = cfg.col_batch_name  ?? -1;
  const colBatchUrl= cfg.col_batch_url   ?? -1;
  const colOwner   = cfg.col_dev_owner   ?? -1;
  const colManual  = cfg.col_manual_url  ?? -1;
  const colSM      = cfg.col_sm_rerun    ?? -1;
  const colEtc     = cfg.col_etc         ?? -1;
  const colCat     = cfg.col_category    ?? -1;
  const colParam   = cfg.col_parameter   ?? -1;
  const colNote    = cfg.col_note        ?? -1;

  const entries = [];
  rows.slice(hRow + 1).forEach(row => {
    const rawName = colBatch    >= 0 ? (row[colBatch]    || '').trim() : '';
    const rawUrl  = colBatchUrl >= 0 ? (row[colBatchUrl] || '').trim() : '';
    const batchName = extractBatchPattern(rawName, rawUrl);
    if (!batchName || batchName === '-') return;
    entries.push({
      pattern:    batchName,
      dev_owner:  colOwner  >= 0 ? (row[colOwner]  || '').trim() : '',
      manual_url: colManual >= 0 ? (row[colManual] || '').trim() : '',
      sm_rerun:   colSM     >= 0 ? (row[colSM]     || '').trim() : '',
      etc:        colEtc    >= 0 ? (row[colEtc]    || '').trim() : '',
      category:   colCat    >= 0 ? (row[colCat]    || '').trim() : '',
      parameter:  colParam  >= 0 ? (row[colParam]  || '').trim() : '',
      note:       colNote   >= 0 ? (row[colNote]   || '').trim() : '',
    });
  });

  if (!entries.length) { st.innerHTML = '<i data-icon="alert-triangle"></i> ไม่พบ entries — ตรวจสอบ column mapping'; st.style.color = '#d97706'; return; }

  st.textContent = `⏳ Saving ${entries.length} entries…`; st.style.color = 'var(--text-muted)';
  const res = await API.batchMeta.syncEntries(id, entries);

  if (!res?.ok) {
    st.innerHTML = '<i data-icon="x"></i> บันทึกไม่สำเร็จ'; st.style.color = '#dc2626';
    Toast.error(res?.data?.message || 'บันทึกไม่สำเร็จ'); return;
  }
  const synced = res.data.data?.synced ?? 0;
  Toast.success(`Sync เรียบร้อย — ${synced} entries`);
  closeModal('modal-sync');
  _syncTargetId = null;
  await loadAll();
}

// ── Load Headers — browser fetches CSV directly ────────────────────
async function loadHeaders() {
  const sheetId = document.getElementById('f-sheet-id').value.trim();
  const gid     = document.getElementById('f-gid').value.trim();
  const hRow    = parseInt(document.getElementById('f-header-row').value) || 0;
  const status  = document.getElementById('header-status');
  const btn     = document.getElementById('btn-load-headers');
  if (!sheetId) { Toast.error('กรุณากรอก Sheet ID ก่อน'); return; }

  btn.disabled = true; status.textContent = '⏳ กำลังโหลด…'; status.style.color = 'var(--text-muted)';
  const result = await fetchSheetCSV(sheetId, gid, 4);
  btn.disabled = false;

  if (!result.ok) {
    status.innerHTML = '<i data-icon="x"></i> ' + result.msg;
    status.style.color = '#dc2626'; return;
  }

  buildPreview(result.rows, hRow, status);
}

function renderColDropdowns() {
  if (!previewHeaders.length) return;
  document.getElementById('col-map-manual').style.display = 'none';
  document.getElementById('col-map-dropdowns').style.display = '';

  const none = '<option value="-1">— ไม่ใช้ —</option>';
  const opts = previewHeaders.map(h => {
    const sample = h.sample ? ` — ตย: ${h.sample.substring(0, 28)}` : '';
    return `<option value="${h.idx}">(${h.idx}) ${escHtml(h.label)}${escHtml(sample)}</option>`;
  }).join('');
  const fields = [
    { key:'batch',    id:'f-col-batch',     label:'Batch Name *', required:true },
    { key:'batchurl', id:'f-col-batchurl',  label:'Batch URL (job link)' },
    { key:'owner',    id:'f-col-owner',     label:'DEV-OWNER' },
    { key:'manual',   id:'f-col-manual',    label:'Manual URL' },
    { key:'smrerun',  id:'f-col-smrerun',   label:'SM Rerun' },
    { key:'etc',      id:'f-col-etc',       label:'Etc/Comment' },
    { key:'category', id:'f-col-category',  label:'Category' },
    { key:'param',    id:'f-col-parameter', label:'Parameter' },
    { key:'note',     id:'f-col-note',      label:'Note' },
  ];
  document.getElementById('col-map-grid').innerHTML = fields.map(f => {
    const cur = parseInt(document.getElementById(f.id)?.value) ?? -1;
    const sel = `<select id="dd-${f.key}" onchange="syncToInput('${f.key}','${f.id}')">${f.required ? '' : none}${opts}</select>`;
    return `<div class="col-map-item"><label>${f.label}</label>${sel}</div>`;
  }).join('');

  // Set current values
  fields.forEach(f => {
    const cur = parseInt(document.getElementById(f.id)?.value) ?? -1;
    const dd  = document.getElementById(`dd-${f.key}`);
    if (dd && cur >= 0) dd.value = cur;
  });
}

function syncToInput(key, inputId) {
  const dd  = document.getElementById(`dd-${key}`);
  const inp = document.getElementById(inputId);
  if (dd && inp) inp.value = dd.value;
}

// ── Sync all dropdowns → inputs before save ────────────────────────
function syncAllInputs() {
  [['batch','f-col-batch'],['batchurl','f-col-batchurl'],['owner','f-col-owner'],['manual','f-col-manual'],
   ['smrerun','f-col-smrerun'],['etc','f-col-etc'],['category','f-col-category'],
   ['param','f-col-parameter'],['note','f-col-note']]
    .forEach(([key, id]) => syncToInput(key, id));
}

// ── Modal ──────────────────────────────────────────────────────────
function openModal(id)  { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }

function resetForm() {
  ['f-name','f-sheet-id','f-gid','f-tab-name'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('f-header-row').value  = '0';
  document.getElementById('f-col-batch').value     = '1';
  document.getElementById('f-col-batchurl').value  = '-1';
  document.getElementById('f-col-owner').value     = '-1';
  document.getElementById('f-col-manual').value    = '-1';
  document.getElementById('f-col-smrerun').value   = '-1';
  document.getElementById('f-col-etc').value       = '-1';
  document.getElementById('f-col-category').value  = '-1';
  document.getElementById('f-col-parameter').value = '-1';
  document.getElementById('f-col-note').value      = '-1';
  document.getElementById('preview-area').style.display     = 'none';
  document.getElementById('header-status').textContent      = '';
  document.getElementById('col-map-grid').innerHTML         = '';
  document.getElementById('col-map-manual').style.display   = '';
  document.getElementById('col-map-dropdowns').style.display= 'none';
  previewHeaders = [];
}

function openAddModal() {
  editingId = null; resetForm();
  document.getElementById('modal-title').textContent     = 'Add Sheet Config';
  document.getElementById('modal-save-btn').textContent  = 'Save Config';
  openModal('modal-cfg');
  setTimeout(() => document.getElementById('f-name').focus(), 80);
}

function openEditModal(id) {
  const c = allConfigs.find(x => x.id === id); if (!c) return;
  editingId = id; resetForm();
  document.getElementById('f-name').value       = c.name       || '';
  document.getElementById('f-sheet-id').value   = c.sheet_id   || '';
  document.getElementById('f-gid').value         = c.gid        || '';
  document.getElementById('f-tab-name').value    = c.tab_name   || '';
  document.getElementById('f-header-row').value  = c.header_row ?? 1;
  document.getElementById('f-col-batch').value     = c.col_batch_name ?? 1;
  document.getElementById('f-col-batchurl').value  = c.col_batch_url  ?? -1;
  document.getElementById('f-col-owner').value     = c.col_dev_owner  ?? -1;
  document.getElementById('f-col-manual').value    = c.col_manual_url ?? -1;
  document.getElementById('f-col-smrerun').value   = c.col_sm_rerun   ?? -1;
  document.getElementById('f-col-etc').value       = c.col_etc        ?? -1;
  document.getElementById('f-col-category').value  = c.col_category   ?? -1;
  document.getElementById('f-col-parameter').value = c.col_parameter  ?? -1;
  document.getElementById('f-col-note').value      = c.col_note       ?? -1;
  document.getElementById('modal-title').textContent    = `Edit — ${escHtml(c.name)}`;
  document.getElementById('modal-save-btn').textContent = 'Save Changes';
  openModal('modal-cfg');
}

async function saveConfig() {
  syncAllInputs();
  const name    = document.getElementById('f-name').value.trim();
  const sheetId = document.getElementById('f-sheet-id').value.trim();
  if (!name)    { Toast.error('กรุณากรอกชื่อ Config'); return; }
  if (!sheetId) { Toast.error('กรุณากรอก Sheet ID');   return; }

  const payload = {
    name, sheet_id: sheetId,
    gid:            document.getElementById('f-gid').value.trim(),
    tab_name:       document.getElementById('f-tab-name').value.trim(),
    header_row:     parseInt(document.getElementById('f-header-row').value)  || 0,
    col_batch_name: parseInt(document.getElementById('f-col-batch').value)     ?? 1,
    col_batch_url:  parseInt(document.getElementById('f-col-batchurl').value)  ?? -1,
    col_dev_owner:  parseInt(document.getElementById('f-col-owner').value)     ?? -1,
    col_manual_url: parseInt(document.getElementById('f-col-manual').value)    ?? -1,
    col_sm_rerun:   parseInt(document.getElementById('f-col-smrerun').value)   ?? -1,
    col_etc:        parseInt(document.getElementById('f-col-etc').value)       ?? -1,
    col_category:   parseInt(document.getElementById('f-col-category').value)  ?? -1,
    col_parameter:  parseInt(document.getElementById('f-col-parameter').value) ?? -1,
    col_note:       parseInt(document.getElementById('f-col-note').value)      ?? -1,
  };

  const btn = document.getElementById('modal-save-btn');
  btn.disabled = true; btn.textContent = 'Saving…';
  const res = editingId
    ? await API.batchMeta.update(editingId, payload)
    : await API.batchMeta.create(payload);
  btn.disabled = false;
  btn.textContent = editingId ? 'Save Changes' : 'Save Config';

  if (!res?.ok) { Toast.error(res?.data?.message || 'เกิดข้อผิดพลาด'); return; }
  Toast.success(editingId ? 'แก้ไขเรียบร้อย' : 'เพิ่ม Config เรียบร้อย');
  closeModal('modal-cfg');
  await loadAll();
}

function openDeleteModal(id, name) {
  deletingId = id;
  document.getElementById('del-name').textContent = name;
  openModal('modal-delete');
}
async function confirmDelete() {
  if (!deletingId) return;
  const res = await API.batchMeta.delete(deletingId);
  if (!res?.ok) { Toast.error('ลบไม่สำเร็จ'); return; }
  Toast.success('ลบเรียบร้อย');
  closeModal('modal-delete');
  deletingId = null;
  await loadAll();
}

document.querySelectorAll('.modal-overlay').forEach(el => {
  el.addEventListener('click', e => { if (e.target === el) closeModal(el.id); });
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') ['modal-cfg','modal-delete'].forEach(closeModal);
});

loadAll();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "buildPreview", { configurable: true, get: () => buildPreview, set: (v) => { buildPreview = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeModal", { configurable: true, get: () => closeModal, set: (v) => { closeModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "confirmDelete", { configurable: true, get: () => confirmDelete, set: (v) => { confirmDelete = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "doSync", { configurable: true, get: () => doSync, set: (v) => { doSync = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "extractBatchPattern", { configurable: true, get: () => extractBatchPattern, set: (v) => { extractBatchPattern = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fetchSheetCSV", { configurable: true, get: () => fetchSheetCSV, set: (v) => { fetchSheetCSV = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadAll", { configurable: true, get: () => loadAll, set: (v) => { loadAll = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadFromPaste", { configurable: true, get: () => loadFromPaste, set: (v) => { loadFromPaste = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadHeaders", { configurable: true, get: () => loadHeaders, set: (v) => { loadHeaders = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openAddModal", { configurable: true, get: () => openAddModal, set: (v) => { openAddModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openDeleteModal", { configurable: true, get: () => openDeleteModal, set: (v) => { openDeleteModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openEditModal", { configurable: true, get: () => openEditModal, set: (v) => { openEditModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openModal", { configurable: true, get: () => openModal, set: (v) => { openModal = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "parseCSVLine", { configurable: true, get: () => parseCSVLine, set: (v) => { parseCSVLine = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "parseDelimited", { configurable: true, get: () => parseDelimited, set: (v) => { parseDelimited = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderCfgCard", { configurable: true, get: () => renderCfgCard, set: (v) => { renderCfgCard = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderColDropdowns", { configurable: true, get: () => renderColDropdowns, set: (v) => { renderColDropdowns = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderConfigs", { configurable: true, get: () => renderConfigs, set: (v) => { renderConfigs = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "resetForm", { configurable: true, get: () => resetForm, set: (v) => { resetForm = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "saveConfig", { configurable: true, get: () => saveConfig, set: (v) => { saveConfig = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "syncAllInputs", { configurable: true, get: () => syncAllInputs, set: (v) => { syncAllInputs = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "syncConfig", { configurable: true, get: () => syncConfig, set: (v) => { syncConfig = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "syncToInput", { configurable: true, get: () => syncToInput, set: (v) => { syncToInput = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toggleCard", { configurable: true, get: () => toggleCard, set: (v) => { toggleCard = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "togglePasteArea", { configurable: true, get: () => togglePasteArea, set: (v) => { togglePasteArea = v; } }); } catch (e) {}
})();
