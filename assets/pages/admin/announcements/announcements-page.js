// admin/announcements — page script, extracted from admin/announcements.html.
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

// ── Type definitions ──────────────────────────────────────────────────────────
const TYPES = [
  { id:'alert',   label:'ALERT',   color:'#ef4444', bg:'rgba(239,68,68,.14)',  symbol:'<i data-icon="x"></i>' },
  { id:'warn',    label:'WARN',    color:'#f59e0b', bg:'rgba(245,158,11,.14)', symbol:'▲' },
  { id:'info',    label:'INFO',    color:'#38bdf8', bg:'rgba(56,189,248,.14)', symbol:'◆' },
  { id:'notice',  label:'NOTICE',  color:'#f26419', bg:'rgba(242,100,25,.14)', symbol:'●' },
  { id:'success', label:'SUCCESS', color:'#22c55e', bg:'rgba(34,197,94,.14)',  symbol:'<i data-icon="check"></i>' },
];

let _selType     = 'info';
let _editSelType = 'info';
let _selDisplay  = 'both';
let _editDisplay = 'both';

// ── Type row builder ──────────────────────────────────────────────────────────
function buildTypeRow(containerId, selected, onSelect) {
  const el = document.getElementById(containerId);
  el.innerHTML = TYPES.map(t => `
    <button class="type-btn ${t.id === selected ? 'active' : ''}"
      style="--tc:${t.color};--tb:${t.bg}"
      onclick="${onSelect}('${t.id}','${containerId}')">
      <span class="tb-symbol">${t.symbol}</span>
      ${t.label}
    </button>`).join('');
}

function selectType(id, gridId) {
  if (gridId === 'type-row')      _selType     = id;
  if (gridId === 'edit-type-row') _editSelType = id;
  document.querySelectorAll(`#${gridId} .type-btn`).forEach(b => {
    const active = b.textContent.trim().startsWith(TYPES.find(t => t.id === id)?.symbol || '');
    b.classList.toggle('active', b.textContent.includes(TYPES.find(t=>t.id===id)?.label || '~~~'));
  });
  // Re-render for cleanliness
  buildTypeRow(gridId, id, gridId === 'type-row' ? 'selectType' : 'selectEditType');
  if (gridId === 'type-row') updatePreview();
}

function selectEditType(id, gridId) { selectType(id, gridId); }

buildTypeRow('type-row',      'info', 'selectType');
buildTypeRow('edit-type-row', 'info', 'selectEditType');

// ── Display mode ──────────────────────────────────────────────────────────────
const DISPLAY_MODES = ['both','ticker','card','popup','promo','all'];
function selectDisplay(mode, isEdit) {
  if (isEdit) _editDisplay = mode;
  else        _selDisplay  = mode;
  const prefix = isEdit ? 'edit-disp-' : 'disp-';
  DISPLAY_MODES.forEach(m => {
    const btn = document.getElementById(prefix + m);
    if (!btn) return;
    btn.classList.toggle('active', m === mode);
  });
  // CTA fields — shared by popup + promo (+ all)
  const cta = document.getElementById(isEdit ? 'edit-popup-cta-wrap' : 'popup-cta-wrap');
  if (cta) cta.style.display = (mode === 'popup' || mode === 'promo' || mode === 'all') ? 'flex' : 'none';
  // Promo icon/badge fields — promo + all
  const promo = document.getElementById(isEdit ? 'edit-promo-fields' : 'promo-fields');
  if (promo) promo.style.display = (mode === 'promo' || mode === 'all') ? 'flex' : 'none';
  if (!isEdit) updatePreview();
}
selectDisplay('both', false);
selectDisplay('both', true);

// ── Live preview ──────────────────────────────────────────────────────────────
let _prevClockTimer = null;
function _startPrevClock() {
  clearInterval(_prevClockTimer);
  function tick() {
    const el = document.getElementById('prev-clock');
    if (el) el.textContent = new Date().toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false });
  }
  tick();
  _prevClockTimer = setInterval(tick, 1000);
}
_startPrevClock();

function updatePreview() {
  const t      = TYPES.find(x => x.id === _selType) || TYPES[2];
  const title  = document.getElementById('f-title').value.trim() || 'ชื่อประกาศจะปรากฏที่นี่...';
  const msg    = document.getElementById('f-msg').value.trim()   || 'ข้อความจะพิมพ์ออกมาแบบ typewriter...';
  // Ticker type badge (symbol + label + border like real ticker)
  const tag = document.getElementById('prev-type-tag');
  tag.textContent      = t.symbol + ' ' + t.label;
  tag.style.background = t.bg;
  tag.style.color      = t.color;
  tag.style.borderColor = t.color + '33';

  // Ticker text
  const display = title + (msg && msg !== title ? '  —  ' + msg.slice(0, 55) + (msg.length > 55 ? '…' : '') : '');
  document.getElementById('prev-ticker-text').textContent = display;

  // Terminal card badge
  const badge = document.getElementById('prev-term-badge');
  badge.textContent      = t.label;
  badge.style.background = t.bg;
  badge.style.color      = t.color;
  badge.style.borderColor = t.color + '33';

  const rawTitle  = document.getElementById('f-title').value.trim();
  const rawMsg    = document.getElementById('f-msg').value.trim();
  const termText  = rawTitle
    ? rawTitle + (rawMsg ? '  —  ' + rawMsg : '')
    : (rawMsg || 'ข้อความจะพิมพ์ออกมาแบบ typewriter...');
  document.getElementById('prev-term-text').textContent = termText.slice(0, 80) + (termText.length > 80 ? '…' : '');

  // Show/hide based on display mode
  const showTicker = _selDisplay === 'ticker' || _selDisplay === 'both' || _selDisplay === 'all';
  const showCard   = _selDisplay === 'card'   || _selDisplay === 'both' || _selDisplay === 'all';
  const showPopup  = _selDisplay === 'popup'  || _selDisplay === 'all';
  const showPromo  = _selDisplay === 'promo'  || _selDisplay === 'all';
  document.querySelector('.prev-ticker').style.display       = showTicker ? '' : 'none';
  document.getElementById('prev-card-wrap').style.display    = showCard   ? '' : 'none';
  document.getElementById('prev-no-pin').style.display       = (showCard || showTicker || showPopup || showPromo) ? 'none' : '';
  document.getElementById('prev-popup-wrap').style.display   = showPopup  ? '' : 'none';
  document.getElementById('prev-promo-wrap').style.display   = showPromo  ? '' : 'none';

  if (showPromo) {
    const rawTitle = document.getElementById('f-title').value.trim();
    const rawMsg   = document.getElementById('f-msg').value.trim();
    const icon     = document.getElementById('f-icon')?.value.trim() || '<i data-icon="megaphone"></i>';
    const badge    = document.getElementById('f-badge')?.value.trim() || '';
    const ctaLabel = document.getElementById('f-cta-label')?.value.trim() || 'เปิด';
    document.getElementById('prev-promo-icon').textContent  = icon;
    document.getElementById('prev-promo-title').textContent = rawTitle || 'ชื่อ promo';
    document.getElementById('prev-promo-msg').textContent   = rawMsg || 'ข้อความโปรโมท...';
    document.getElementById('prev-promo-cta').innerHTML     = esc(ctaLabel) + ' →';
    const badgeEl = document.getElementById('prev-promo-badge');
    if (badge) { badgeEl.style.display = 'inline-block'; badgeEl.textContent = badge; }
    else badgeEl.style.display = 'none';
  }

  if (showPopup) {
    const mascotEl = document.getElementById('prev-popup-mascot');
    if (mascotEl && !mascotEl.dataset.injected) {
      mascotEl.innerHTML = MASCOT_SVG;
      mascotEl.dataset.injected = '1';
    }

    const popTag = document.getElementById('prev-popup-tag');
    popTag.textContent      = t.symbol + ' ' + t.label;
    popTag.style.background = t.bg;
    popTag.style.color      = t.color;
    popTag.style.borderColor = t.color + '44';

    const rawTitle = document.getElementById('f-title').value.trim();
    const rawMsg   = document.getElementById('f-msg').value.trim();
    document.getElementById('prev-popup-title').textContent = rawTitle || 'ชื่อประกาศจะปรากฏที่นี่';
    document.getElementById('prev-popup-msg').textContent = rawMsg || 'ข้อความ popup จะแสดงที่นี่...';

    const ctaLabel = document.getElementById('f-cta-label')?.value.trim();
    const ctaUrl   = document.getElementById('f-cta-url')?.value.trim();
    const ctaWrap  = document.getElementById('prev-popup-cta-wrap');
    if (ctaLabel && ctaUrl) {
      ctaWrap.style.display = '';
      document.getElementById('prev-popup-cta').innerHTML = esc(ctaLabel) + ' <span style="font-size:13px">→</span>';
    } else {
      ctaWrap.style.display = 'none';
    }
  }
}

// Mini mascot SVG for admin preview (matches runtime)
const MASCOT_SVG = `
<svg viewBox="0 0 100 110" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="pm-body" cx="40%" cy="35%" r="65%">
      <stop offset="0%" stop-color="#ffb066"/>
      <stop offset="55%" stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#d97706"/>
    </radialGradient>
  </defs>
  <g class="pm-leaf">
    <rect x="49" y="14" width="2.5" height="10" fill="#15803d" rx="1.2"/>
    <ellipse cx="55" cy="18" rx="7" ry="3.2" fill="#22c55e" transform="rotate(25 55 18)"/>
  </g>
  <ellipse cx="18" cy="62" rx="6" ry="11" fill="#d97706"/>
  <ellipse cx="82" cy="62" rx="6" ry="11" fill="#d97706"/>
  <ellipse cx="50" cy="60" rx="34" ry="36" fill="url(#pm-body)"/>
  <ellipse cx="36" cy="42" rx="11" ry="7" fill="rgba(255,255,255,.35)"/>
  <ellipse cx="38" cy="40" rx="4" ry="2.5" fill="rgba(255,255,255,.6)"/>
  <ellipse cx="30" cy="68" rx="5" ry="3.5" fill="rgba(255,99,99,.45)"/>
  <ellipse cx="70" cy="68" rx="5" ry="3.5" fill="rgba(255,99,99,.45)"/>
  <g class="pm-eye"><ellipse cx="40" cy="56" rx="4" ry="5" fill="#2a1810"/><circle cx="41.5" cy="54" r="1.4" fill="#fff"/></g>
  <g class="pm-eye"><ellipse cx="60" cy="56" rx="4" ry="5" fill="#2a1810"/><circle cx="61.5" cy="54" r="1.4" fill="#fff"/></g>
  <path d="M 41 72 Q 50 80 59 72" stroke="#2a1810" stroke-width="2.4" fill="none" stroke-linecap="round"/>
  <path d="M 47 76 Q 50 78 53 76" fill="#ff7878"/>
</svg>`;

updatePreview();

// ── Submit ────────────────────────────────────────────────────────────────────
async function submitAnn() {
  const msg = document.getElementById('f-msg').value.trim();
  if (!msg) { Toast.error('กรุณากรอก Message'); return; }

  const btn = document.getElementById('submit-btn');
  btn.disabled = true; btn.textContent = 'Sending...';

  const res = await API.post('/announcements/index.php', {
    type:            _selType,
    title:           document.getElementById('f-title').value.trim(),
    message:         msg,
    display:         _selDisplay,
    icon:            document.getElementById('f-icon').value.trim(),
    badge:           document.getElementById('f-badge').value.trim(),
    popup_cta_label: document.getElementById('f-cta-label').value.trim(),
    popup_cta_url:   document.getElementById('f-cta-url').value.trim(),
    expires_at:      document.getElementById('f-expires').value || null,
  });

  btn.disabled = false; btn.innerHTML = '<i data-icon="megaphone"></i> Broadcast';
  if (!res?.ok) { Toast.error(res?.data?.message || 'ส่งไม่ได้'); return; }

  Toast.success('Broadcast แล้ว <i data-icon="check"></i>');
  document.getElementById('f-title').value     = '';
  document.getElementById('f-msg').value       = '';
  document.getElementById('f-expires').value   = '';
  document.getElementById('f-cta-label').value = '';
  document.getElementById('f-cta-url').value   = '';
  document.getElementById('f-icon').value      = '';
  document.getElementById('f-badge').value     = '';
  _selType = 'info';
  _selDisplay = 'both';
  buildTypeRow('type-row', 'info', 'selectType');
  selectDisplay('both', false);
  updatePreview();
  loadList();
}

// ── List ──────────────────────────────────────────────────────────────────────
async function loadList() {
  const all = document.getElementById('show-all').checked;
  const res = await API.get('/announcements/index.php' + (all ? '?all=1' : ''));
  if (!res?.ok) { Toast.error('โหลดไม่ได้'); return; }
  const items = res.data.data || [];
  document.getElementById('ann-count').textContent = items.length + ' item' + (items.length !== 1 ? 's' : '');
  renderList(items);
}

function renderList(items) {
  const el = document.getElementById('ann-list');
  if (!items.length) {
    el.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--text-muted);font-size:11px">ยังไม่มีประกาศ<br><span style="opacity:.5">กรอกฟอร์มด้านซ้ายเพื่อ Broadcast</span></div>';
    return;
  }
  el.innerHTML = items.map(a => {
    const t = TYPES.find(x => x.id === a.type) || TYPES[2];
    const now = new Date().toISOString();
    const expired = a.expires_at && a.expires_at < now;
    return `
      <div class="ann-row ${a.pinned ? 'is-pinned' : ''}">
        <span class="ann-badge" style="background:${t.bg};color:${t.color}">${t.symbol} ${t.label}</span>
        <div class="ann-body">
          <div class="ann-title">${a.pinned ? '<span style="color:var(--orange)">📌</span> ' : ''}${esc(a.title || '(no title)')}</div>
          <div class="ann-msg">${esc(a.message)}</div>
          <div class="ann-meta">
            ${esc(a.created_by_name || '—')} · ${fmtDt(a.created_at)}
            ${!a.active ? '<span style="opacity:.5"> · inactive</span>' : ''}
            ${a.expires_at ? `<span class="exp-tag" style="margin-left:4px">${expired ? '⌛ Expired' : '⏱ ' + fmtDt(a.expires_at)}</span>` : ''}
          </div>
        </div>
        <div class="ann-actions">
          ${dispBadge(a.display)}
          <button class="btn btn-ghost btn-sm" onclick='openEdit(${JSON.stringify(a)})'
            style="font-size:10px">Edit</button>
          <button class="btn btn-ghost btn-sm" onclick="delAnn('${a.id}')"
            style="font-size:10px;color:#ef4444;border-color:rgba(239,68,68,.25)">Del</button>
        </div>
      </div>`;
  }).join('');
}

// ── Actions ───────────────────────────────────────────────────────────────────
function dispBadge(display) {
  const map = {
    both:   { label:'⊞ ทั้งคู่', c:'#f26419', bg:'rgba(242,100,25,.12)' },
    ticker: { label:'<i data-icon="play"></i> Ticker',  c:'#38bdf8', bg:'rgba(56,189,248,.12)' },
    card:   { label:'▣ Card',    c:'#22c55e', bg:'rgba(34,197,94,.12)'  },
    popup:  { label:'<i data-icon="circle"></i> Popup',   c:'#a855f7', bg:'rgba(168,85,247,.12)' },
    promo:  { label:'◈ Promo',   c:'#f26419', bg:'rgba(242,100,25,.12)' },
    all:    { label:'<i data-icon="sparkles"></i> All',     c:'#ec4899', bg:'rgba(236,72,153,.12)' },
  };
  const d = map[display] || map.both;
  return `<span style="font-size:8.5px;font-weight:800;padding:2px 7px;border-radius:4px;background:${d.bg};color:${d.c};font-family:'JetBrains Mono',monospace;letter-spacing:.05em;white-space:nowrap">${d.label}</span>`;
}

async function delAnn(id) {
  if (!confirm('ลบประกาศนี้?')) return;
  const res = await API.request('DELETE', `/announcements/index.php?id=${id}`);
  if (!res?.ok) { Toast.error('ลบไม่ได้'); return; }
  Toast.success('ลบแล้ว'); loadList();
}

// ── Edit ──────────────────────────────────────────────────────────────────────
function openEdit(a) {
  document.getElementById('edit-id').value        = a.id;
  document.getElementById('edit-title').value     = a.title  || '';
  document.getElementById('edit-msg').value       = a.message || '';
  document.getElementById('edit-expires').value   = a.expires_at ? a.expires_at.slice(0,16) : '';
  document.getElementById('edit-cta-label').value = a.popup_cta_label || '';
  document.getElementById('edit-cta-url').value   = a.popup_cta_url   || '';
  document.getElementById('edit-icon').value      = a.icon  || '';
  document.getElementById('edit-badge').value     = a.badge || '';
  _editSelType = a.type || 'info';
  _editDisplay = a.display || (a.pinned ? 'both' : 'ticker');
  buildTypeRow('edit-type-row', _editSelType, 'selectEditType');
  selectDisplay(_editDisplay, true);
  const m = document.getElementById('edit-modal');
  m.style.display = 'flex';
}

function closeEdit() { document.getElementById('edit-modal').style.display = 'none'; }

async function saveEdit() {
  const id = document.getElementById('edit-id').value;
  const res = await API.request('PUT', `/announcements/index.php?id=${id}`, {
    type:            _editSelType,
    title:           document.getElementById('edit-title').value.trim(),
    message:         document.getElementById('edit-msg').value.trim(),
    display:         _editDisplay,
    icon:            document.getElementById('edit-icon').value.trim(),
    badge:           document.getElementById('edit-badge').value.trim(),
    popup_cta_label: document.getElementById('edit-cta-label').value.trim(),
    popup_cta_url:   document.getElementById('edit-cta-url').value.trim(),
    expires_at:      document.getElementById('edit-expires').value || null,
  });
  if (!res?.ok) { Toast.error('บันทึกไม่ได้'); return; }
  Toast.success('Saved <i data-icon="check"></i>'); closeEdit(); loadList();
}

document.getElementById('edit-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('edit-modal')) closeEdit();
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function fmtDt(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('th-TH', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
}

loadList();

  // ── re-publish what the inline version leaked to global ──
  try { Object.defineProperty(window, "_startPrevClock", { configurable: true, get: () => _startPrevClock, set: (v) => { _startPrevClock = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "buildTypeRow", { configurable: true, get: () => buildTypeRow, set: (v) => { buildTypeRow = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "closeEdit", { configurable: true, get: () => closeEdit, set: (v) => { closeEdit = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "delAnn", { configurable: true, get: () => delAnn, set: (v) => { delAnn = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "dispBadge", { configurable: true, get: () => dispBadge, set: (v) => { dispBadge = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "esc", { configurable: true, get: () => esc, set: (v) => { esc = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "fmtDt", { configurable: true, get: () => fmtDt, set: (v) => { fmtDt = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "loadList", { configurable: true, get: () => loadList, set: (v) => { loadList = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "openEdit", { configurable: true, get: () => openEdit, set: (v) => { openEdit = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "renderList", { configurable: true, get: () => renderList, set: (v) => { renderList = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "saveEdit", { configurable: true, get: () => saveEdit, set: (v) => { saveEdit = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "selectDisplay", { configurable: true, get: () => selectDisplay, set: (v) => { selectDisplay = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "selectEditType", { configurable: true, get: () => selectEditType, set: (v) => { selectEditType = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "selectType", { configurable: true, get: () => selectType, set: (v) => { selectType = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "submitAnn", { configurable: true, get: () => submitAnn, set: (v) => { submitAnn = v; } }); } catch (e) {}
  try { Object.defineProperty(window, "updatePreview", { configurable: true, get: () => updatePreview, set: (v) => { updatePreview = v; } }); } catch (e) {}
})();
