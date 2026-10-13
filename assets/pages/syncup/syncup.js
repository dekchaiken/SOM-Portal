// syncup — page script, extracted from syncup.html.
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

Auth.requireAuth();
Layout.render('user');

// ── State ─────────────────────────────────────────────────────────
const TODAY   = new Date().toISOString().slice(0, 10);
let   todayRec = null;                     // { morning: {...}|null, evening: {...}|null }
let   pendingFiles = { morning: null, evening: null }; // compressed Blob

const DAY_TH = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];
const d      = new Date();
document.getElementById('page-date').textContent =
  `วัน${DAY_TH[d.getDay()]}ที่ ${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()+543}`;

// ── Client-side image compression (Canvas) ─────────────────────────
function compressImage(file, maxPx = 1280, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
        const w = Math.round(img.width  * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('Canvas toBlob failed')),
                      'image/jpeg', quality);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Drop zone setup ───────────────────────────────────────────────
['morning','evening'].forEach(shift => {
  const zone = document.getElementById(`drop-${shift}`);
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', ()  => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (f) processFile(shift, f);
  });
});

function triggerPick(shift) {
  document.getElementById(`file-${shift}`).click();
}
function onFileChange(shift, input) {
  if (input.files[0]) processFile(shift, input.files[0]);
}

// ── Paste from clipboard (Cmd+V / Ctrl+V) ────────────────────────
document.addEventListener('paste', e => {
  // Ignore if user is typing in an input/textarea
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;

  const items = Array.from(e.clipboardData?.items ?? []);
  const imgItem = items.find(i => i.type.startsWith('image/'));
  if (!imgItem) return;

  e.preventDefault();
  const file  = imgItem.getAsFile();
  if (!file) return;

  const shift = _shiftByTime();
  // Flash the target card
  const card = document.getElementById(`card-${shift}`);
  card.classList.remove('paste-flash');
  void card.offsetWidth;
  card.classList.add('paste-flash');
  card.addEventListener('animationend', () => card.classList.remove('paste-flash'), { once: true });

  const label = shift === 'morning' ? 'กะเช้า <i data-icon="sunrise"></i>' : 'กะเย็น <i data-icon="moon"></i>';
  Toast.success(`วางรูปลง ${label} แล้ว`);
  processFile(shift, file);
});

async function processFile(shift, file) {
  if (!file.type.startsWith('image/')) { Toast.warning('กรุณาเลือกไฟล์รูปภาพ'); return; }
  if (file.size > 20 * 1024 * 1024) { Toast.warning('ไฟล์ใหญ่เกินไป (max 20MB)'); return; }

  const bar   = document.getElementById(`compress-${shift}`);
  bar.textContent = '⏳ กำลังบีบอัดรูป…';
  bar.classList.add('visible');

  try {
    const origKB = Math.round(file.size / 1024);
    const blob   = await compressImage(file);
    const newKB  = Math.round(blob.size / 1024);
    pendingFiles[shift] = blob;

    bar.innerHTML = `<i data-icon="check-circle"></i> บีบอัดแล้ว: ${origKB} KB → ${newKB} KB`;

    // Preview
    const url  = URL.createObjectURL(blob);
    const wrap = document.getElementById(`preview-wrap-${shift}`);
    document.getElementById(`preview-img-${shift}`).src = url;
    document.getElementById(`preview-meta-${shift}`).textContent =
      `${newKB} KB · JPEG (บีบอัดแล้ว)`;
    wrap.classList.add('visible');
    document.getElementById(`btn-${shift}`).disabled = false;
  } catch (err) {
    bar.innerHTML = '<i data-icon="alert-triangle"></i> บีบอัดไม่สำเร็จ — ลองใหม่';
    console.error(err);
  }
}

function clearFile(shift) {
  pendingFiles[shift] = null;
  document.getElementById(`file-${shift}`).value = '';
  document.getElementById(`preview-wrap-${shift}`).classList.remove('visible');
  document.getElementById(`compress-${shift}`).classList.remove('visible');
  document.getElementById(`btn-${shift}`).disabled = true;
}

// ── Upload ───────────────────────────────────────────────────────
async function uploadFile(shift) {
  const blob = pendingFiles[shift];
  if (!blob) return;

  const btn  = document.getElementById(`btn-${shift}`);
  const prog = document.getElementById(`progress-${shift}`);

  btn.disabled    = true;
  btn.textContent = '⏳ กำลังอัปโหลด…';
  prog.classList.add('visible');
  prog.querySelector('.upload-progress-bar').style.width = '60%';

  const fd = new FormData();
  fd.append('image', blob, `syncup-${shift}.jpg`);
  fd.append('shift', shift);
  fd.append('date',  TODAY);

  try {
    const res = await API.syncup.upload(fd);
    prog.querySelector('.upload-progress-bar').style.width = '100%';

    if (!res?.ok) throw new Error(res?.data?.message || 'เกิดข้อผิดพลาด');

    Toast.success('อัปโหลดสำเร็จ! <i data-icon="sparkles"></i>');
    clearFile(shift);
    await loadToday();

    if (res.data?.data?.chat_errors?.length) {
      Toast.warning('อัปโหลดแล้ว แต่ส่ง Google Chat ไม่สำเร็จ');
    }
  } catch (err) {
    Toast.error(err.message);
    prog.querySelector('.upload-progress-bar').style.width = '0%';
  } finally {
    btn.disabled    = false;
    btn.innerHTML = `<i data-icon="upload"></i> อัปโหลด Sync-up ${shift === 'morning' ? 'เช้า' : 'เย็น'}`;
    setTimeout(() => { prog.classList.remove('visible'); prog.querySelector('.upload-progress-bar').style.width = '0%'; }, 600);
  }
}

// ── Delete record (lead/admin) ────────────────────────────────────
async function deleteRecord(shift) {
  if (!await SOMDialog.confirm(`ลบรูป Sync-up ${shift === 'morning' ? 'เช้า' : 'เย็น'} วันนี้?`, { title: 'ยืนยันการลบ', okLabel: 'ลบ', icon: 'danger', okColor: 'danger' })) return;
  const res = await API.syncup.deleteRecord(TODAY, shift);
  if (res?.ok) { Toast.success('ลบแล้ว'); await loadToday(); }
  else Toast.error(res?.data?.message || 'ลบไม่ได้');
}

// ── Load today record ─────────────────────────────────────────────
async function loadToday() {
  const res = await API.syncup.getRecord(TODAY);
  todayRec = res?.ok ? (res.data?.data ?? null) : null;
  renderShifts(todayRec);
}

function renderShifts(rec) {
  const now  = new Date();
  const hhmm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  const isLead = ['super_admin','sm_lead','sm_admin','dev_sm'].includes(Auth.getUser()?.role);

  ['morning','evening'].forEach(shift => {
    const entry  = rec?.[shift] ?? null;
    const card   = document.getElementById(`card-${shift}`);
    const badge  = document.getElementById(`badge-${shift}`);
    const cur    = document.getElementById(`current-${shift}`);
    const reHint = document.getElementById(`re-hint-${shift}`);
    const delBtn = cur.querySelector('button');

    // Show/hide delete only for lead/admin
    if (delBtn) delBtn.style.display = isLead ? '' : 'none';

    if (entry) {
      // Has image — show it
      document.getElementById(`img-${shift}`).src = entry.image_url;
      const ts   = new Date(entry.uploaded_at);
      const time = `${String(ts.getHours()).padStart(2,'0')}:${String(ts.getMinutes()).padStart(2,'0')}`;
      document.getElementById(`info-${shift}`).textContent =
        `${entry.uploaded_by_name} · ${time} น. · ${entry.file_size_kb || '?'} KB`;
      cur.style.display = '';
      reHint.style.display = '';
      card.className = 'shift-card done-shift';
      badge.className = 'shift-badge badge-done';
      badge.innerHTML = '<i data-icon="check-circle"></i> แล้ว';
    } else {
      cur.style.display = 'none';
      reHint.style.display = 'none';

      // Is this shift's time close? (within ±90 min)
      const shiftHH = shift === 'morning' ? 8 : 20;
      const shiftMM = 45;
      const diffMin = (now.getHours() * 60 + now.getMinutes()) - (shiftHH * 60 + shiftMM);
      const nearShift = diffMin >= -5 && diffMin <= 90;

      if (nearShift) {
        card.className  = 'shift-card active-shift';
        badge.className = 'shift-badge badge-active';
        badge.textContent = '⏰ ถึงเวลา';
      } else {
        card.className  = 'shift-card';
        badge.className = 'shift-badge badge-pending';
        badge.textContent = 'รอ';
      }
    }
  });
}

// ── Load history log ──────────────────────────────────────────────
async function loadLog() {
  const res   = await API.syncup.getRange(14);
  const tbody = document.getElementById('log-tbody');

  if (!res?.ok) {
    tbody.innerHTML = `<tr><td colspan="6" class="log-empty">โหลดไม่สำเร็จ</td></tr>`;
    return;
  }

  const map = res.data?.data ?? {};
  const rows = [];

  // Iterate newest → oldest
  for (let i = 0; i < 14; i++) {
    const date = new Date(); date.setDate(date.getDate() - i);
    const d    = date.toISOString().slice(0, 10);
    const rec  = map[d];

    ['morning','evening'].forEach(shift => {
      const e = rec?.[shift];
      rows.push({ date: d, shift, entry: e || null });
    });
  }

  const hasAny = rows.some(r => r.entry);

  if (!hasAny) {
    tbody.innerHTML = `<tr><td colspan="6" class="log-empty">ยังไม่มีประวัติ</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.filter(r => r.entry).map(r => {
    const { date, shift, entry } = r;
    const d2  = date.slice(5).replace('-', '/'); // MM/DD
    const ts  = new Date(entry.uploaded_at);
    const tim = `${String(ts.getHours()).padStart(2,'0')}:${String(ts.getMinutes()).padStart(2,'0')} น.`;
    const chip = shift === 'morning'
      ? `<span class="shift-chip chip-morning"><i data-icon="sunrise"></i> เช้า</span>`
      : `<span class="shift-chip chip-evening"><i data-icon="moon"></i> เย็น</span>`;

    return `<tr>
      <td class="td-p">${date}</td>
      <td class="td-p">${chip}</td>
      <td class="td-p">
        <div class="thumb-wrap" onclick="openLightbox('${escHtml(entry.image_url)}')">
          <img src="${escHtml(entry.image_url)}" alt="">
        </div>
      </td>
      <td class="td-p" style="color:var(--text)">${escHtml(entry.uploaded_by_name)}</td>
      <td class="td-p">${tim}</td>
      <td class="td-p" style="color:var(--text-muted)">${entry.file_size_kb || '?'} KB</td>
    </tr>`;
  }).join('');
}

// ── Lightbox ──────────────────────────────────────────────────────
function openLightbox(src) {
  document.getElementById('lb-img').src = src;
  document.getElementById('lb-wrap').classList.add('open');
}
function closeLightbox() {
  document.getElementById('lb-wrap').classList.remove('open');
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); });

// ── Utilities ─────────────────────────────────────────────────────
function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Single-shift mode (from ?shift=morning / ?shift=evening) ─────
const urlShift = new URLSearchParams(location.search).get('shift');
if (urlShift === 'morning' || urlShift === 'evening') {
  const other = urlShift === 'morning' ? 'evening' : 'morning';

  // Hide the other shift card
  document.getElementById(`card-${other}`).style.display = 'none';

  // Make grid single column so the visible card goes full-width
  document.getElementById('shifts-grid').style.gridTemplateColumns = '1fr';

  // Update page title & subtitle
  const icon  = urlShift === 'morning' ? '<i data-icon=\"sunrise\"></i>' : '<i data-icon=\"moon\"></i>';
  const label = urlShift === 'morning' ? 'Sync-up เช้า' : 'Sync-up เย็น';
  document.getElementById('page-title').textContent = `${icon} Daily ${label}`;

  // Show "ดูทั้งสองกะ" link
  document.getElementById('topbar-both').style.display = '';
}

// Paste target: use urlShift if available, else auto-detect by time
function _shiftByTime() {
  if (urlShift === 'morning' || urlShift === 'evening') return urlShift;
  return new Date().getHours() < 14 ? 'morning' : 'evening';
}

// ── Init ──────────────────────────────────────────────────────────
Promise.all([loadToday(), loadLog()]);

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "_shiftByTime", { configurable: true, get: () => _shiftByTime, set: (v) => { _shiftByTime = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "clearFile", { configurable: true, get: () => clearFile, set: (v) => { clearFile = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeLightbox", { configurable: true, get: () => closeLightbox, set: (v) => { closeLightbox = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "compressImage", { configurable: true, get: () => compressImage, set: (v) => { compressImage = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "deleteRecord", { configurable: true, get: () => deleteRecord, set: (v) => { deleteRecord = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "escHtml", { configurable: true, get: () => escHtml, set: (v) => { escHtml = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadLog", { configurable: true, get: () => loadLog, set: (v) => { loadLog = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadToday", { configurable: true, get: () => loadToday, set: (v) => { loadToday = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "onFileChange", { configurable: true, get: () => onFileChange, set: (v) => { onFileChange = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openLightbox", { configurable: true, get: () => openLightbox, set: (v) => { openLightbox = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "processFile", { configurable: true, get: () => processFile, set: (v) => { processFile = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderShifts", { configurable: true, get: () => renderShifts, set: (v) => { renderShifts = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "triggerPick", { configurable: true, get: () => triggerPick, set: (v) => { triggerPick = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "uploadFile", { configurable: true, get: () => uploadFile, set: (v) => { uploadFile = v; } }); } catch (e) {}
})();
