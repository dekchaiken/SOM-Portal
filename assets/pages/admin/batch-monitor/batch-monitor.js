// admin/batch-monitor — page script, extracted from admin/batch-monitor.html.
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
const isAdmin = currentUser && ['super_admin', 'sm_admin', 'dev_sm'].includes(currentUser.role);

let recRows     = [];
let recExpanded = {};

// ── Load ──────────────────────────────────────────────────────────
async function load() {
  const token = Auth.getToken ? Auth.getToken()
    : (localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token') || '');
  try {
    const resp = await fetch('../api/batch-records-admin.php?action=list', {
      headers: token ? { 'Authorization': 'Bearer ' + token } : {}
    });
    const json = await resp.json();
    recRows = Array.isArray(json.data) ? json.data : [];
  } catch { recRows = []; }

  recExpanded = {};
  render();
}

// ── Render ────────────────────────────────────────────────────────
function render() {
  document.getElementById('rec-count').textContent = `${recRows.length} รายการ`;
  const tbody = document.getElementById('rec-tbody');

  if (!recRows.length) {
    tbody.innerHTML = `<tr class="empty-state-row"><td colspan="7">ยังไม่มีบันทึก</td></tr>`;
    return;
  }

  let html = '';
  recRows.forEach(rec => {
    const jobs     = rec.jobs || {};
    const names    = Object.keys(jobs);
    const total    = names.length;
    const ok       = names.filter(n => jobs[n].status === 'Success').length;
    const fail     = names.filter(n => jobs[n].status === 'Fail').length;
    const na       = total - ok - fail;
    const isOpen   = !!recExpanded[rec.id];

    const dt = rec.timestamp ? new Date(rec.timestamp).toLocaleString('th-TH', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    }) : '—';

    html += `<tr>
      <td><div class="td-ci">
        <button class="btn-exp${isOpen?' open':''}" onclick="toggleExpand('${rec.id}')">▼</button>
      </div></td>
      <td><div class="td-ci" style="font-size:10px">${dt}</div></td>
      <td><div class="td-ci"><strong>${escHtml(rec.server || '—')}</strong></div></td>
      <td><div class="td-ci" style="color:var(--text-muted)">${escHtml(rec.reporter || '—')}</div></td>
      <td><div class="td-ci">${total} jobs</div></td>
      <td><div class="td-ci">
        <div class="sum-chips">
          ${ok   ? `<span class="sum-chip pill-s">✅ ${ok}</span>`   : ''}
          ${fail ? `<span class="sum-chip pill-f">❌ ${fail}</span>` : ''}
          ${na   ? `<span class="sum-chip pill-n">— ${na}</span>`    : ''}
        </div>
      </div></td>
      <td><div class="td-ci">
        ${isAdmin ? `<button class="btn-del" onclick="deleteRecord('${rec.id}')">ลบ</button>` : ''}
      </div></td>
    </tr>`;

    if (isOpen) {
      names.forEach(name => {
        const j = jobs[name];
        const pillCls = j.status === 'Success' ? 'pill-s' : j.status === 'Fail' ? 'pill-f' : 'pill-n';
        const pillTxt = j.status === 'Success' ? '<i data-icon="check-circle"></i> Success' : j.status === 'Fail' ? '<i data-icon="x-circle"></i> Fail' : '— N/A';
        const folder  = j.folder ? `<span style="font-size:9px;color:var(--text-muted);margin-left:4px"><i data-icon="folder"></i> ${escHtml(j.folder)}</span>` : '';
        html += `<tr class="sub-row">
          <td></td>
          <td colspan="2"><div class="td-ci" style="padding-left:24px">
            ${escHtml(name)}${folder}
          </div></td>
          <td colspan="2"><div class="td-ci">
            <span class="status-pill ${pillCls}">${pillTxt}</span>
          </div></td>
          <td><div class="td-ci" style="color:var(--text-muted);font-size:10px">${escHtml(j.remark || '')}</div></td>
          <td></td>
        </tr>`;
      });
    }
  });

  tbody.innerHTML = html;
}

function toggleExpand(id) {
  recExpanded[id] = !recExpanded[id];
  render();
}

// ── Delete ────────────────────────────────────────────────────────
async function deleteRecord(id) {
  if (!confirm('ลบบันทึกนี้?')) return;
  const token = Auth.getToken ? Auth.getToken()
    : (localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token') || '');
  const resp = await fetch('../api/batch-records-admin.php?action=delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': 'Bearer ' + token } : {}) },
    body: JSON.stringify({ id })
  });
  const json = await resp.json();
  if (json.ok) {
    Toast.success('ลบสำเร็จ');
    recRows = recRows.filter(r => r.id !== id);
    render();
  } else {
    Toast.error(json.message || 'ลบไม่ได้');
  }
}

// ── Clear all ─────────────────────────────────────────────────────
async function confirmClear() {
  if (!confirm(`ล้าง Batch Records ทั้งหมด ${recRows.length} รายการ? ไม่สามารถกู้คืนได้`)) return;
  const token = Auth.getToken ? Auth.getToken()
    : (localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token') || '');
  const resp = await fetch('../api/batch-records-admin.php?action=clear', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': 'Bearer ' + token } : {}) },
  });
  const json = await resp.json();
  if (json.ok) {
    Toast.success(`ล้างแล้ว ${json.data?.deleted_count ?? 0} รายการ`);
    recRows = [];
    render();
  } else {
    Toast.error(json.message || 'ล้างไม่ได้');
  }
}

// ── Export CSV ────────────────────────────────────────────────────
function exportCSV() {
  if (!recRows.length) { Toast.warning('ไม่มีข้อมูล'); return; }
  const rows = [['วันที่', 'Server', 'ผู้รายงาน', 'Job', 'Folder', 'Status', 'Remark']];
  recRows.forEach(rec => {
    Object.entries(rec.jobs || {}).forEach(([name, j]) => {
      rows.push([
        rec.timestamp ? new Date(rec.timestamp).toLocaleString('th-TH') : '',
        rec.server   || '',
        rec.reporter || '',
        name,
        j.folder  || '',
        j.status  || '',
        j.remark  || '',
      ]);
    });
  });
  const csv  = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `batch-records-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

load();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "confirmClear", { configurable: true, get: () => confirmClear, set: (v) => { confirmClear = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "deleteRecord", { configurable: true, get: () => deleteRecord, set: (v) => { deleteRecord = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "exportCSV", { configurable: true, get: () => exportCSV, set: (v) => { exportCSV = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "load", { configurable: true, get: () => load, set: (v) => { load = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "render", { configurable: true, get: () => render, set: (v) => { render = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "toggleExpand", { configurable: true, get: () => toggleExpand, set: (v) => { toggleExpand = v; } }); } catch (e) {}
})();
