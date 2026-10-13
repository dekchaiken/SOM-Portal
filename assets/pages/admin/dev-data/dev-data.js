// admin/dev-data — page script, extracted from admin/dev-data.html.
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

if (!Auth.requireAuth()) { /* redirected */ }
const _u = Auth.getUser?.();
if (_u && _u.role !== 'dev_sm') window.location.replace('./index.html');
Layout.render('dev-data');

// ── State ──────────────────────────────────────────────
let _allFiles   = [];
let _activeFile = null;
let _rawData    = null;
let _filteredData = null;
let _view       = 'table';
let _truncated  = false;

// ── Helpers ────────────────────────────────────────────
function fmtBytes(b) {
  if (b < 1024)    return b + ' B';
  if (b < 1048576) return (b/1024).toFixed(1) + ' KB';
  return (b/1048576).toFixed(2) + ' MB';
}
function relTime(ts) {
  const diff = Math.floor((Date.now()/1000) - ts);
  if (diff < 60)   return diff + 's ago';
  if (diff < 3600) return Math.floor(diff/60) + 'm ago';
  if (diff < 86400)return Math.floor(diff/3600) + 'h ago';
  return Math.floor(diff/86400) + 'd ago';
}

// ── File list ──────────────────────────────────────────
async function refreshFileList() {
  document.getElementById('file-list').innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:11px"><span class="loading-spin"></span>Loading…</div>';
  const res = await API.dev.stats();
  if (!res?.ok) {
    document.getElementById('file-list').innerHTML = '<div style="padding:16px;color:#f87171;font-size:11px">Failed to load file list</div>';
    return;
  }
  _allFiles = res.data.data?.data_files || [];
  document.getElementById('file-count').textContent = `${_allFiles.length} files · ${fmtBytes(_allFiles.reduce((s,f)=>s+f.size,0))} total`;
  renderFileList(_allFiles);
}

function renderFileList(files) {
  if (!files.length) {
    document.getElementById('file-list').innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:11px">ไม่พบไฟล์</div>';
    return;
  }
  document.getElementById('file-list').innerHTML = files.map(f =>
    `<div class="file-item${_activeFile===f.name?' active':''}" onclick="openFile('${escHtml(f.name)}')" id="fi-${f.name.replace('.','_')}">
      <div class="file-item-name">${escHtml(f.name)}</div>
      <div class="file-item-meta">
        <span>${fmtBytes(f.size)}</span>
        <span>${relTime(f.mtime)}</span>
      </div>
    </div>`
  ).join('');
}

function filterFiles(q) {
  const q2 = q.toLowerCase();
  renderFileList(_allFiles.filter(f => f.name.toLowerCase().includes(q2)));
}

// ── Open file ──────────────────────────────────────────
async function openFile(name) {
  _activeFile = name;
  // Update active state in list
  document.querySelectorAll('.file-item').forEach(el => el.classList.remove('active'));
  const fi = document.getElementById('fi-' + name.replace('.','_'));
  if (fi) fi.classList.add('active');

  document.getElementById('insp-title').textContent = name;
  document.getElementById('insp-body').innerHTML = '<div style="padding:20px;color:var(--text-muted);font-size:11px"><span class="loading-spin"></span>Loading ' + escHtml(name) + '…</div>';
  document.getElementById('insp-toolbar').style.display = 'none';
  document.getElementById('insp-meta').style.display = 'none';
  document.getElementById('insp-search').value = '';

  const res = await API.dev.readFile(name);
  if (!res?.ok) {
    document.getElementById('insp-body').innerHTML = `<div class="insp-empty"><div class="icon"><i data-icon="alert-triangle"></i></div><div>${escHtml(res?.data?.message || 'Error loading file')}</div></div>`;
    return;
  }

  const d = res.data.data;
  _rawData      = d.data;
  _filteredData = _rawData;
  _truncated    = d.truncated;

  // Meta
  const meta = d.meta;
  document.getElementById('insp-count').textContent = meta.count != null ? meta.count : (d.is_map ? 'map' : '?');
  document.getElementById('insp-size').textContent  = fmtBytes(meta.size);
  document.getElementById('insp-trunc').style.display = _truncated ? 'inline' : 'none';
  document.getElementById('insp-meta').style.display = 'flex';
  document.getElementById('insp-toolbar').style.display = 'flex';

  renderInspector();
}

// ── Render inspector ───────────────────────────────────
function renderInspector() {
  const body = document.getElementById('insp-body');
  if (_rawData == null) return;

  if (_view === 'json') {
    body.innerHTML = `<div class="json-viewer">${syntaxHighlight(JSON.stringify(_filteredData, null, 2))}</div>`;
    return;
  }

  // Table view
  if (Array.isArray(_filteredData) && _filteredData.length > 0 && typeof _filteredData[0] === 'object') {
    const cols = [...new Set(_filteredData.flatMap(r => Object.keys(r || {})))].slice(0, 12);
    const rows = _filteredData.map(r => {
      const cells = cols.map(c => {
        const v = r?.[c];
        const cls = v === null ? 'jl' : typeof v === 'boolean' ? 'jb' : typeof v === 'number' ? 'jn' : typeof v === 'object' ? '' : 'js';
        const display = v === null ? 'null' : typeof v === 'object' ? JSON.stringify(v) : String(v);
        const safe = escHtml(display.slice(0, 120)) + (display.length > 120 ? '…' : '');
        return `<td class="${cls}" title="${escHtml(display)}">${safe}</td>`;
      }).join('');
      return `<tr>${cells}</tr>`;
    }).join('');
    body.innerHTML = `<div style="overflow:auto;max-height:560px"><table class="json-table"><thead><tr>${cols.map(c=>`<th>${escHtml(c)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
    return;
  }

  // For non-array or non-object-array, show JSON
  body.innerHTML = `<div class="json-viewer">${syntaxHighlight(JSON.stringify(_filteredData, null, 2))}</div>`;
}

function setView(v) {
  _view = v;
  document.getElementById('vtab-table').classList.toggle('active', v === 'table');
  document.getElementById('vtab-json').classList.toggle('active',  v === 'json');
  renderInspector();
}

function filterRecords(q) {
  if (!q.trim()) { _filteredData = _rawData; renderInspector(); return; }
  const ql = q.toLowerCase();
  if (Array.isArray(_rawData)) {
    _filteredData = _rawData.filter(r => JSON.stringify(r).toLowerCase().includes(ql));
  } else {
    _filteredData = _rawData;
  }
  renderInspector();
}

// ── JSON syntax highlighting ───────────────────────────
function syntaxHighlight(json) {
  return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+\.?\d*([eE][+-]?\d+)?)/g, match => {
    if (/^"/.test(match)) {
      if (/:$/.test(match)) return `<span class="jk">${escHtml(match)}</span>`;
      return `<span class="js">${escHtml(match)}</span>`;
    }
    if (/true|false/.test(match)) return `<span class="jb">${match}</span>`;
    if (/null/.test(match))       return `<span class="jl">${match}</span>`;
    return `<span class="jn">${match}</span>`;
  });
}

// ── Actions ────────────────────────────────────────────
function copyRawJson() {
  if (_rawData == null) return;
  navigator.clipboard?.writeText(JSON.stringify(_rawData, null, 2))
    .then(() => Toast.success('Copied JSON to clipboard'));
}

function downloadJson() {
  if (_rawData == null || !_activeFile) return;
  const blob = new Blob([JSON.stringify(_rawData, null, 2)], { type: 'application/json' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = _activeFile;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Init ───────────────────────────────────────────────
refreshFileList();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "copyRawJson", { configurable: true, get: () => copyRawJson, set: (v) => { copyRawJson = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "downloadJson", { configurable: true, get: () => downloadJson, set: (v) => { downloadJson = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "filterFiles", { configurable: true, get: () => filterFiles, set: (v) => { filterFiles = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "filterRecords", { configurable: true, get: () => filterRecords, set: (v) => { filterRecords = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtBytes", { configurable: true, get: () => fmtBytes, set: (v) => { fmtBytes = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openFile", { configurable: true, get: () => openFile, set: (v) => { openFile = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "refreshFileList", { configurable: true, get: () => refreshFileList, set: (v) => { refreshFileList = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "relTime", { configurable: true, get: () => relTime, set: (v) => { relTime = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderFileList", { configurable: true, get: () => renderFileList, set: (v) => { renderFileList = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderInspector", { configurable: true, get: () => renderInspector, set: (v) => { renderInspector = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "setView", { configurable: true, get: () => setView, set: (v) => { setView = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "syntaxHighlight", { configurable: true, get: () => syntaxHighlight, set: (v) => { syntaxHighlight = v; } }); } catch (e) {}
})();
