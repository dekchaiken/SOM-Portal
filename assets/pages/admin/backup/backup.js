// admin/backup — page script, extracted from admin/backup.html.
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

// ── State ──────────────────────────────────────────────────────────
let backups = [];

// ── Helpers ────────────────────────────────────────────────────────
function fmtSize(bytes) {
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  if (bytes >= 1024)    return (bytes / 1024).toFixed(0) + ' KB';
  return bytes + ' B';
}

function fmtDate(iso) {
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}  ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m  = Math.floor(diff / 60000);
  const h  = Math.floor(diff / 3600000);
  const d  = Math.floor(diff / 86400000);
  if (m < 2)   return 'เมื่อกี้';
  if (m < 60)  return `${m} นาทีที่แล้ว`;
  if (h < 24)  return `${h} ชั่วโมงที่แล้ว`;
  if (d < 30)  return `${d} วันที่แล้ว`;
  return `${Math.floor(d/30)} เดือนที่แล้ว`;
}

// ── Load & render ──────────────────────────────────────────────────
async function load() {
  try {
    const res = await API.backup.list();
    backups   = res?.ok && Array.isArray(res.data?.data) ? res.data.data : [];
  } catch { backups = []; }
  render();
}

function render() {
  const tbody   = document.getElementById('bk-tbody');
  const empty   = document.getElementById('bk-empty');
  const tblWrap = document.getElementById('bk-table-wrap');

  // Stats
  const total  = backups.length;
  const totSz  = backups.reduce((s, b) => s + (b.size || 0), 0);
  const latest = backups[0];

  document.getElementById('st-count').textContent = total || '0';
  document.getElementById('st-size').textContent  = total ? fmtSize(totSz) : '—';
  document.getElementById('st-size-sub').textContent = total
    ? `${total} ไฟล์ · เฉลี่ย ${fmtSize(Math.round(totSz / total))}`
    : '';

  if (latest) {
    document.getElementById('st-last').textContent    = fmtDate(latest.created_at).split('  ')[0];
    document.getElementById('st-last-ago').textContent = fmtAgo(latest.created_at);
  } else {
    document.getElementById('st-last').textContent    = 'ยังไม่เคย';
    document.getElementById('st-last-ago').textContent = '';
  }

  document.getElementById('bk-sub').textContent = total
    ? `${total} ไฟล์ · รวม ${fmtSize(totSz)}` : '0 ไฟล์';

  if (!total) {
    tblWrap.style.display = 'none';
    empty.style.display   = '';
    return;
  }

  tblWrap.style.display = '';
  empty.style.display   = 'none';

  tbody.innerHTML = backups.map((b, i) => {
    const label = i === 0
      ? `<span style="display:inline-flex;align-items:center;gap:5px">
           ${escHtml(b.file)}
           <span style="font-size:9px;background:rgba(34,197,94,.15);color:#22c55e;padding:1px 6px;border-radius:4px;font-weight:700">LATEST</span>
         </span>`
      : escHtml(b.file);

    return `<tr>
      <td class="col-num"><span class="bk-num">${i + 1}</span></td>
      <td class="col-name"><span class="bk-fname">${label}</span></td>
      <td class="col-size"><span class="bk-size-badge">${fmtSize(b.size)}</span></td>
      <td class="col-date"><span class="bk-date">${fmtDate(b.created_at)}</span></td>
      <td class="col-btns">
        <div class="bk-row-btns">
          <button class="btn-dl"     onclick="download('${escHtml(b.file)}')"><i data-icon="arrow-down"></i> ดาวน์โหลด</button>
          <button class="btn-del-bk" onclick="del('${escHtml(b.file)}')">ลบ</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

// ── Create backup ──────────────────────────────────────────────────
document.getElementById('btn-create').addEventListener('click', async function() {
  this.disabled    = true;
  this.textContent = '⏳ กำลังสร้าง…';
  this.classList.add('btn-creating');
  try {
    const res = await API.backup.create();
    if (res?.ok) {
      Toast.success(`สร้าง Backup สำเร็จ <i data-icon="sparkles"></i> (${fmtSize(res.data?.data?.size || 0)})`);
      // Update auto-backup timestamp so auto-trigger resets
      localStorage.setItem('bk_last_auto', Date.now().toString());
      await load();
    } else {
      Toast.error(res?.data?.message || 'สร้าง Backup ไม่สำเร็จ');
    }
  } catch {
    Toast.error('เกิดข้อผิดพลาด');
  } finally {
    this.disabled    = false;
    this.textContent = '+ สร้าง Backup ตอนนี้';
    this.classList.remove('btn-creating');
  }
});

// ── Download ───────────────────────────────────────────────────────
async function download(file) {
  try {
    const token = Auth.getToken();
    const res   = await fetch(`${API_BASE}/backup/download.php?file=${encodeURIComponent(file)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) { Toast.error('ดาวน์โหลดไม่สำเร็จ'); return; }
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = file;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    Toast.success('กำลังดาวน์โหลด…');
  } catch {
    Toast.error('ดาวน์โหลดไม่สำเร็จ');
  }
}

// ── Confirm dialog ─────────────────────────────────────────────────
let _confirmResolve = null;

function showConfirm({ icon='<i data-icon="trash"></i>', title='ยืนยัน', desc='', okText='ยืนยัน', okColor='#ef4444' } = {}) {
  return new Promise(resolve => {
    _confirmResolve = resolve;
    document.getElementById('confirm-icon').textContent  = icon;
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-desc').textContent  = desc;
    const ok = document.getElementById('confirm-ok-btn');
    ok.textContent      = okText;
    ok.style.background = okColor;
    document.getElementById('confirm-wrap').classList.add('open');
  });
}

document.getElementById('confirm-ok-btn').addEventListener('click', () => {
  document.getElementById('confirm-wrap').classList.remove('open');
  _confirmResolve?.(true);
});
document.getElementById('confirm-cancel-btn').addEventListener('click', () => {
  document.getElementById('confirm-wrap').classList.remove('open');
  _confirmResolve?.(false);
});
document.getElementById('confirm-wrap').addEventListener('click', function(e) {
  if (e.target === this) { this.classList.remove('open'); _confirmResolve?.(false); }
});

// ── Delete ─────────────────────────────────────────────────────────
async function del(file) {
  const ok = await showConfirm({
    icon:   '<i data-icon="trash"></i>',
    title:  'ลบ Backup นี้?',
    desc:   file,
    okText: 'ลบ',
  });
  if (!ok) return;
  const res = await API.backup.delete(file);
  if (res?.ok) {
    backups = backups.filter(b => b.file !== file);
    render();
    Toast.success('ลบแล้ว');
  } else {
    Toast.error(res?.data?.message || 'ลบไม่ได้');
  }
}

load();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "del", { configurable: true, get: () => del, set: (v) => { del = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "download", { configurable: true, get: () => download, set: (v) => { download = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtAgo", { configurable: true, get: () => fmtAgo, set: (v) => { fmtAgo = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtDate", { configurable: true, get: () => fmtDate, set: (v) => { fmtDate = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtSize", { configurable: true, get: () => fmtSize, set: (v) => { fmtSize = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "load", { configurable: true, get: () => load, set: (v) => { load = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "render", { configurable: true, get: () => render, set: (v) => { render = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "showConfirm", { configurable: true, get: () => showConfirm, set: (v) => { showConfirm = v; } }); } catch (e) {}
})();
