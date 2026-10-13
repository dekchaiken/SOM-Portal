/* ══════════════════════════════════════════════════
   utils.js  |  SOM-Portal shared utilities
   ══════════════════════════════════════════════════ */

// ─── Toast Notifications ─────────────────────────
const Toast = {
  container: null,

  init() {
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = 'toast-container';
      document.body.appendChild(this.container);
    }
  },

  show(message, type = 'info', duration = 3200) {
    // Suppress error/warning toasts fired during SPA navigation — these are
    // almost always stale abort-error callbacks from the previous page and
    // would confuse the user by appearing on top of the new page's content.
    if (window._spaNavigating && (type === 'error' || type === 'warning')) return;
    this.init();

    const el = document.createElement('div');
    el.className = `toast toast-${type}`;

    // Progress bar element
    const progress = document.createElement('div');
    progress.className = 'toast-progress';

    // Close button
    const close = document.createElement('button');
    close.className = 'toast-close';
    close.innerHTML = '<i data-icon="x"></i>';
    close.addEventListener('click', () => dismiss());

    el.innerHTML = `<span class="toast-dot"></span><span class="toast-msg">${message}</span>`;
    el.appendChild(close);
    el.appendChild(progress);

    this.container.appendChild(el);

    // Animate progress bar
    progress.animate(
      [{ width: '100%' }, { width: '0%' }],
      { duration, easing: 'linear', fill: 'forwards' }
    );

    // Auto dismiss
    const timer = setTimeout(() => dismiss(), duration);

    function dismiss() {
      clearTimeout(timer);
      el.style.animation = 'toastOut 0.22s ease forwards';
      setTimeout(() => el.remove(), 220);
    }
  },

  success(msg, dur)  { this.show(msg, 'success', dur || 3200); },
  error(msg, dur)    { this.show(msg, 'error',   dur || 5000); },
  warning(msg, dur)  { this.show(msg, 'warning', dur || 3500); },
  info(msg, dur)     { this.show(msg, 'info',    dur || 3200); }
};

// ─── SOMDialog — custom confirm/alert dialogs ────────────────────────────────
// Replaces browser-native confirm() and alert() with styled, on-brand modals.
// Usage:
//   const ok = await SOMDialog.confirm('ลบข้อมูลนี้?');
//   await SOMDialog.alert('บันทึกสำเร็จ', { icon: 'success' });
//
// Injects its own overlay on first call — no extra HTML needed in any page.
const SOMDialog = (() => {
  let _ovl = null;

  const ICONS = {
    danger:  { color: '#ef4444', bg: 'color-mix(in srgb,#ef4444 12%,transparent)', svg: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>' },
    warning: { color: '#f59e0b', bg: 'color-mix(in srgb,#f59e0b 12%,transparent)', svg: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>' },
    info:    { color: '#3b82f6', bg: 'color-mix(in srgb,#3b82f6 12%,transparent)', svg: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>' },
    success: { color: '#10b981', bg: 'color-mix(in srgb,#10b981 12%,transparent)', svg: '<circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 15 10"/>' },
    question:{ color: '#8b5cf6', bg: 'color-mix(in srgb,#8b5cf6 12%,transparent)', svg: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>' },
  };

  function _setup() {
    if (_ovl) return;
    const style = document.createElement('style');
    style.textContent = `
      #_sd-ovl{position:fixed;inset:0;z-index:99999;background:rgba(9,9,11,.55);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:16px}
      #_sd-card{background:var(--bg-card,#fff);border:1px solid var(--border,#e5e7eb);border-radius:14px;width:100%;max-width:400px;box-shadow:0 24px 64px rgba(0,0,0,.22);color:var(--text,#111);overflow:hidden;animation:_sda .16s cubic-bezier(.22,.68,0,1.15)}
      @keyframes _sda{from{opacity:0;transform:scale(.93) translateY(8px)}to{opacity:1;transform:none}}
      [data-theme="dark"] #_sd-card{background:#111317}
      #_sd-icon{display:flex;align-items:center;justify-content:center;width:46px;height:46px;border-radius:12px;margin:24px auto 0;flex:none}
      #_sd-body{padding:14px 26px 6px;text-align:center}
      #_sd-title{font-size:15px;font-weight:700;margin-bottom:6px;color:var(--text,#111)}
      #_sd-msg{font-size:13px;color:var(--text-muted,#6b7280);line-height:1.6;white-space:pre-line}
      #_sd-actions{display:flex;gap:8px;padding:18px 24px 22px;justify-content:center}
      ._sd-btn{flex:1;min-width:90px;height:36px;border-radius:8px;border:1.5px solid;font:inherit;font-size:13px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:opacity .1s,transform .08s}
      ._sd-btn:hover{opacity:.88}._sd-btn:active{transform:scale(.97)}
      ._sd-ok{background:#f26419;color:#fff;border-color:#f26419}
      ._sd-ok.danger{background:#ef4444;border-color:#ef4444}
      ._sd-ok.warning{background:#f59e0b;border-color:#f59e0b}
      ._sd-ok.info{background:#3b82f6;border-color:#3b82f6}
      ._sd-ok.success{background:#10b981;border-color:#10b981}
      ._sd-cancel{background:transparent;color:var(--text,#111);border-color:var(--border,#e5e7eb)}
    `;
    document.head.appendChild(style);

    _ovl = document.createElement('div');
    _ovl.id = '_sd-ovl';
    _ovl.style.display = 'none';
    _ovl.innerHTML = `
      <div id="_sd-card">
        <div id="_sd-icon"></div>
        <div id="_sd-body">
          <div id="_sd-title"></div>
          <div id="_sd-msg"></div>
        </div>
        <div id="_sd-actions"></div>
      </div>`;
    document.body.appendChild(_ovl);
  }

  function _show({ title, msg, icon = 'question', actions }) {
    _setup();
    const ic = ICONS[icon] || ICONS.info;
    document.getElementById('_sd-icon').style.background = ic.bg;
    document.getElementById('_sd-icon').innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${ic.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ic.svg}</svg>`;
    document.getElementById('_sd-title').textContent = title;
    document.getElementById('_sd-msg').innerHTML = msg;
    const acts = document.getElementById('_sd-actions');
    acts.innerHTML = '';
    const _close = () => { _ovl.style.display = 'none'; document.removeEventListener('keydown', _esc); };
    actions.forEach(a => {
      const b = document.createElement('button');
      b.className = `_sd-btn ${a.primary ? '_sd-ok ' + (a.colorClass || '') : '_sd-cancel'}`;
      b.textContent = a.label;
      b.addEventListener('click', () => { _close(); a.resolve(a.value); });
      acts.appendChild(b);
    });
    const cancelAction = actions.find(a => !a.primary);
    const _esc = (e) => { if (e.key === 'Escape') { _close(); cancelAction?.resolve(cancelAction?.value ?? false); } };
    document.addEventListener('keydown', _esc);
    _ovl.style.display = 'flex';
    setTimeout(() => acts.querySelector('button')?.focus(), 60);
  }

  return {
    // Confirm dialog — returns Promise<boolean>
    // opts: { title, okLabel, cancelLabel, icon, okColor }
    confirm(msg, {
      title = 'ยืนยัน', okLabel = 'ยืนยัน', cancelLabel = 'ยกเลิก',
      icon = 'question', okColor = 'danger'
    } = {}) {
      return new Promise(resolve => _show({
        title, msg, icon,
        actions: [
          { label: cancelLabel, primary: false, resolve, value: false },
          { label: okLabel,     primary: true,  resolve, value: true, colorClass: okColor },
        ],
      }));
    },

    // Alert dialog — returns Promise<void>
    // opts: { title, okLabel, icon }
    alert(msg, { title = 'แจ้งเตือน', okLabel = 'ตกลง', icon = 'info' } = {}) {
      return new Promise(resolve => _show({
        title, msg, icon,
        actions: [{ label: okLabel, primary: true, resolve, value: undefined, colorClass: icon }],
      }));
    },
  };
})();
window.SOMDialog = SOMDialog;

// ─── Date/Time formatting ─────────────────────────
const DateTime = {
  format(iso, opts = {}) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    const defaults = {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    };
    return d.toLocaleString('th-TH', { ...defaults, ...opts });
  },

  formatDate(iso) {
    return this.format(iso, { day: '2-digit', month: 'short', year: 'numeric' });
  },

  timeAgo(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const diff = Math.floor((Date.now() - d) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff/86400)}d ago`;
    return this.formatDate(iso);
  },

  nowIso() {
    return new Date().toISOString();
  },

  nowJira() {
    // Jira format: 2024-01-15T10:30:00.000+0700
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    const tzOffset = -d.getTimezoneOffset();
    const sign = tzOffset >= 0 ? '+' : '-';
    const absOff = Math.abs(tzOffset);
    const tzStr = `${sign}${pad(Math.floor(absOff/60))}${pad(absOff%60)}`;
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T` +
           `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.000${tzStr}`;
  }
};

// ─── Modal helper ─────────────────────────────────
const Modal = {
  open(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
  },
  close(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  },
  closeAll() {
    document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
  }
};

// Close modal on overlay click
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    Modal.closeAll();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') Modal.closeAll();
});

// ─── Role utilities ───────────────────────────────
const Roles = {
  LABELS: {
    sm_admin:     'Admin',
    sm_lead:      'Lead',
    sm_user:      'User',
    dev_sm:       'Dev',
    dev_user:     'Dev User',
    external:     'External',
    super_admin:  'Super Admin',
    super_viewer: 'Super Viewer',
  },

  label(role) {
    return this.LABELS[role] || role;
  },

  badgeClass(role) {
    return 'role-badge ' + (
      role === 'dev_sm'       ? 'role-dev_sm'       :
      role === 'sm_admin'     ? 'role-sm_admin'     :
      role === 'sm_lead'      ? 'role-sm_lead'      :
      role === 'dev_user'     ? 'role-dev_user'     :
      role === 'external'     ? 'role-external'     :
      role === 'super_admin'  ? 'role-super_admin'  :
      role === 'super_viewer' ? 'role-super_viewer' :
                                'role-sm_user'
    );
  },

  badge(role) {
    return `<span class="badge ${this.badgeClass(role)}">${this.label(role)}</span>`;
  },

  canManage(role) {
    return ['sm_lead', 'sm_admin', 'dev_sm'].includes(role);
  },

  isAdmin(role) {
    return ['sm_admin', 'dev_sm'].includes(role);
  }
};

// ─── Escape HTML ──────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Icon rendering helper ────────────────────────
// Use for admin-configurable icon fields (course/exam/phase `icon` stored in
// data files) where the value may be either a legacy emoji (📘) OR the new
// `<i data-icon="NAME"></i>` tag. Pass-through the tag so `window.Icons` can
// swap it for SVG; escape everything else so raw emojis still render safely.
function renderIcon(val, fallback = '<i data-icon="book"></i>') {
  if (val == null || val === '') return fallback;
  const s = String(val).trim();
  if (s.startsWith('<i data-icon=') && s.endsWith('</i>')) return s;
  return escHtml(s);
}

// ─── Email list parser ────────────────────────────
// Handles: "Name <email>", plain "email", comma/newline-separated multiples
function parseEmailList(text) {
  const results = [];
  for (const part of text.split(/[,\n]+/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/<([^>]+@[^>]+)>/);
    if (m) { results.push(m[1].trim()); continue; }
    if (trimmed.includes('@')) results.push(trimmed.replace(/['"]/g, ''));
  }
  return results;
}

// ─── Debounce ─────────────────────────────────────
function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// ─── Confirm dialog (minimal) ─────────────────────
// options: { confirmText, cancelText, variant: 'danger' | 'primary' }
// Defaults are inferred from the title: destructive-sounding titles
// (Delete/Remove/Trash/ลบ) get red "Delete"; everything else gets neutral "Confirm".
function confirmDialog(message, title = 'Confirm', options = {}) {
  const isDestructive = /\b(delete|remove|trash|clear|wipe)\b|ลบ|ล้าง/i.test(title);
  const variant     = options.variant     || (isDestructive ? 'danger' : 'primary');
  const confirmText = options.confirmText || (variant === 'danger' ? 'Delete' : 'Confirm');
  const cancelText  = options.cancelText  || 'Cancel';
  const btnClass    = variant === 'primary' ? 'btn-primary' : 'btn-danger';

  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.innerHTML = `
      <div class="modal confirm-dialog" style="max-width:360px;border-radius:16px;padding:0;overflow:hidden">
        <div style="padding:24px 24px 16px">
          <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:8px">${escHtml(title)}</div>
          <div style="font-size:12.5px;color:var(--text-muted);line-height:1.6;white-space:pre-line">${escHtml(message)}</div>
        </div>
        <div style="display:flex;gap:8px;padding:12px 16px;border-top:1px solid var(--border);background:var(--bg);justify-content:flex-end">
          <button class="btn btn-ghost btn-sm" id="_cd-cancel">${escHtml(cancelText)}</button>
          <button class="btn ${btnClass} btn-sm" id="_cd-confirm">${escHtml(confirmText)}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    function done(val) { overlay.remove(); resolve(val); }

    overlay.querySelector('#_cd-cancel').addEventListener('click', () => done(false));
    overlay.querySelector('#_cd-confirm').addEventListener('click', () => done(true));
    overlay.addEventListener('click', e => { if (e.target === overlay) done(false); });
  });
}

// ─── Dropdown menus ───────────────────────────────
document.addEventListener('click', (e) => {
  if (!e.target.closest('.action-menu')) {
    document.querySelectorAll('.action-dropdown.open').forEach(d => d.classList.remove('open'));
  }
});

function toggleDropdown(el) {
  const dropdown = el.nextElementSibling;
  if (!dropdown) return;
  document.querySelectorAll('.action-dropdown.open').forEach(d => {
    if (d !== dropdown) d.classList.remove('open');
  });
  dropdown.classList.toggle('open');
}

// ─── getInitials ──────────────────────────────────
function getInitials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

// ─── User Profile Link ────────────────────────────
// Convert user names to clickable profile links.
// Anyone signed in can view another user's profile (read-only).
function makeUserClickable(userId, userName, options = {}) {
  const {className = '', style = ''} = options;
  if (!userId) return escHtml(userName || '—');

  return `<a href="./profile.html?user=${escHtml(userId)}" class="user-link ${className}" style="cursor:pointer;color:var(--orange);text-decoration:none;${style}" title="View ${escHtml(userName)}'s profile">${escHtml(userName || '—')}</a>`;
}

// ─── Image Resize for contenteditable editors ─────
// Click an image inside `editorEl` → floating toolbar (slider + px + Auto + ✕)
// + draggable corner handle. Maintains aspect ratio. Idempotent per editor.
function setupImageResize(editorEl) {
  if (!editorEl || editorEl.dataset.imgResizeReady) return;
  editorEl.dataset.imgResizeReady = '1';

  if (!document.getElementById('_img-resize-css')) {
    const css = document.createElement('style');
    css.id = '_img-resize-css';
    css.textContent = `
      .imgrz-selected {
        outline: 2px dashed var(--orange, #f26419) !important;
        outline-offset: 2px;
      }
      .imgrz-toolbar {
        position: absolute; z-index: 9999;
        display: flex; align-items: center; gap: 8px; padding: 5px 8px;
        background: #1c1f26; border: 1px solid #2d3748;
        border-radius: 7px; box-shadow: 0 4px 14px rgba(0,0,0,.35);
        font-family: 'Segoe UI', Tahoma, sans-serif;
      }
      .imgrz-slider {
        -webkit-appearance: none; appearance: none;
        width: 160px; height: 4px; margin: 0;
        background: #3a414f; border-radius: 3px; outline: none;
        cursor: pointer;
      }
      .imgrz-slider::-webkit-slider-thumb {
        -webkit-appearance: none; appearance: none;
        width: 14px; height: 14px; border-radius: 50%;
        background: #f26419; border: 2px solid #fff;
        box-shadow: 0 1px 3px rgba(0,0,0,.4);
        cursor: grab;
      }
      .imgrz-slider::-webkit-slider-thumb:active { cursor: grabbing; }
      .imgrz-slider::-moz-range-thumb {
        width: 14px; height: 14px; border-radius: 50%;
        background: #f26419; border: 2px solid #fff;
        box-shadow: 0 1px 3px rgba(0,0,0,.4);
        cursor: grab;
      }
      .imgrz-val {
        min-width: 52px; text-align: right;
        font-size: 11px; font-weight: 600;
        color: #f26419; font-variant-numeric: tabular-nums;
        font-family: inherit;
      }
      .imgrz-btn {
        padding: 4px 9px; font-size: 11px; font-weight: 600;
        background: transparent; color: #cbd5e1;
        border: none; border-radius: 5px; cursor: pointer;
        font-family: inherit;
      }
      .imgrz-btn:hover { background: rgba(242,100,25,.2); color: #f26419; }
      .imgrz-btn.del:hover { background: rgba(239,68,68,.2); color: #ef4444; }
      .imgrz-handle {
        position: absolute; z-index: 9998;
        width: 14px; height: 14px;
        background: #f26419; border: 2px solid #fff;
        border-radius: 50%; cursor: nwse-resize;
        box-shadow: 0 2px 6px rgba(0,0,0,.4);
      }
    `;
    document.head.appendChild(css);
  }

  let selectedImg = null, toolbar = null, handle = null;
  let sliderEl = null, valEl = null, sliderMax = 800;

  function clearSelection() {
    if (selectedImg) selectedImg.classList.remove('imgrz-selected');
    selectedImg = null;
    if (toolbar) { toolbar.remove(); toolbar = null; }
    if (handle)  { handle.remove();  handle  = null; }
    sliderEl = valEl = null;
  }

  function positionOverlays() {
    if (!selectedImg) return;
    const r = selectedImg.getBoundingClientRect();
    const sx = window.scrollX, sy = window.scrollY;
    if (toolbar) {
      const top = r.top + sy - 40;
      toolbar.style.top  = (top < sy + 4 ? r.bottom + sy + 6 : top) + 'px';
      toolbar.style.left = (r.left + sx) + 'px';
    }
    if (handle) {
      handle.style.top  = (r.bottom + sy - 7) + 'px';
      handle.style.left = (r.right  + sx - 7) + 'px';
    }
  }

  function syncSliderFromImage() {
    if (!selectedImg || !sliderEl) return;
    const w = Math.round(selectedImg.getBoundingClientRect().width);
    sliderEl.value = Math.min(Math.max(w, +sliderEl.min), +sliderEl.max);
    valEl.textContent = w + ' px';
  }

  function setWidthPx(px) {
    if (!selectedImg) return;
    selectedImg.style.width    = px + 'px';
    selectedImg.style.height   = 'auto';
    // Editors ship with `img { max-width: 100% }` (and pasted images carry inline
    // `max-width:100%`) — without overriding, the browser silently clamps to the
    // editor's width. `!important` beats stylesheet + inline attribute.
    selectedImg.style.setProperty('max-width', 'none', 'important');
    if (valEl) valEl.textContent = px + ' px';
    positionOverlays();
  }

  function setAuto() {
    if (!selectedImg) return;
    selectedImg.style.width    = '';
    selectedImg.style.height   = 'auto';
    selectedImg.style.maxWidth = '100%';
    // Reflect actual rendered width back into slider
    requestAnimationFrame(() => { syncSliderFromImage(); positionOverlays(); });
  }

  function selectImage(img) {
    clearSelection();
    selectedImg = img;
    img.classList.add('imgrz-selected');

    // Compute slider range from natural size when available
    const natural = img.naturalWidth || 0;
    sliderMax = natural > 40 ? natural : 800;
    const currentW = Math.round(img.getBoundingClientRect().width) || Math.min(sliderMax, 400);

    toolbar = document.createElement('div');
    toolbar.className = 'imgrz-toolbar';
    toolbar.contentEditable = 'false';
    toolbar.innerHTML = `
      <input type="range" class="imgrz-slider" min="40" max="${sliderMax}" value="${Math.min(currentW, sliderMax)}" title="ลากเพื่อปรับขนาด (px)">
      <span class="imgrz-val">${currentW} px</span>
      <button type="button" class="imgrz-btn" data-act="auto" title="ขนาดเต็มตามธรรมชาติของรูป">Auto</button>
      <button type="button" class="imgrz-btn del" data-act="del" title="ลบรูป"><i data-icon="x"></i></button>
    `;
    toolbar.addEventListener('mousedown', e => {
      // Only prevent focus loss; still allow the range input to receive drag events
      if (e.target.tagName !== 'INPUT') e.preventDefault();
    });
    toolbar.addEventListener('click', e => {
      const btn = e.target.closest('.imgrz-btn');
      if (!btn) return;
      e.preventDefault();
      if (btn.dataset.act === 'del') {
        const img = selectedImg; clearSelection(); img.remove(); return;
      }
      if (btn.dataset.act === 'auto') setAuto();
    });
    document.body.appendChild(toolbar);

    sliderEl = toolbar.querySelector('.imgrz-slider');
    valEl    = toolbar.querySelector('.imgrz-val');
    sliderEl.addEventListener('input', () => setWidthPx(+sliderEl.value));

    handle = document.createElement('div');
    handle.className = 'imgrz-handle';
    handle.title = 'ลากเพื่อปรับขนาด';
    handle.addEventListener('mousedown', startDrag);
    document.body.appendChild(handle);

    positionOverlays();
  }

  let dragState = null;
  function startDrag(e) {
    e.preventDefault();
    if (!selectedImg) return;
    const r = selectedImg.getBoundingClientRect();
    dragState = { startX: e.clientX, startW: r.width };
    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup',   stopDrag);
  }
  function onDrag(e) {
    if (!dragState || !selectedImg) return;
    const newW = Math.max(40, Math.round(dragState.startW + (e.clientX - dragState.startX)));
    selectedImg.style.width    = newW + 'px';
    selectedImg.style.height   = 'auto';
    selectedImg.style.setProperty('max-width', 'none', 'important');
    if (sliderEl) {
      if (newW > +sliderEl.max) sliderEl.max = newW;
      sliderEl.value = newW;
    }
    if (valEl) valEl.textContent = newW + ' px';
    positionOverlays();
  }
  function stopDrag() {
    dragState = null;
    document.removeEventListener('mousemove', onDrag);
    document.removeEventListener('mouseup',   stopDrag);
  }

  editorEl.addEventListener('click', e => {
    const img = e.target.closest('img');
    if (img && editorEl.contains(img)) {
      e.preventDefault();
      selectImage(img);
    }
  });

  document.addEventListener('mousedown', e => {
    if (!selectedImg) return;
    if (toolbar && toolbar.contains(e.target)) return;
    if (handle  && handle.contains(e.target))  return;
    if (e.target === selectedImg) return;
    clearSelection();
  });

  window.addEventListener('scroll', positionOverlays, true);
  window.addEventListener('resize', positionOverlays);

  new MutationObserver(() => {
    if (selectedImg && !document.body.contains(selectedImg)) clearSelection();
  }).observe(editorEl, { childList: true, subtree: true });
}
