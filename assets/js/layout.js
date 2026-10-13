/* ══════════════════════════════════════════════════
   layout.js  |  Shared sidebar + topbar renderer
   ══════════════════════════════════════════════════ */

// Fix-up: the inline "sb-restore" snippet at the top of each page pastes a
// sidebar HTML that was cached on the previous page, where relative hrefs
// (./X.html or ../X.html) were anchored to that page's depth. When restored
// on a page at a different depth those relatives resolve incorrectly (e.g.
// ../ma-services.html on /centralize-som/dashboard.html becomes
// /ma-services.html and 404s). Rewrite to project-root-absolute paths so
// they work regardless of depth — runs once, before any click.
(function () {
  const sb = document.getElementById('sidebar');
  if (!sb) return;

  // Derive project root from this script's own URL so the fix is
  // deployment-path agnostic (works at /centralize-som/, /somthing-else/, /).
  const me = Array.from(document.scripts)
    .find(s => /\/assets\/js\/layout\.js(\?|$)/.test(s.src));
  if (!me) return;
  const root = new URL(me.src).pathname.replace(/\/assets\/js\/layout\.js.*$/, '');

  // Match any leading "noise" prefix: ./, ../, /, or the root segment itself
  // (with or without its leading slash, so chained root duplicates collapse
  // in one pass). E.g. a previously-corrupted cached href like
  //   /centralize-som/centralize-som/centralize-som/dashboard.html
  // collapses cleanly back to dashboard.html before we re-anchor it.
  const rootName     = root.replace(/^\/+/, ''); // "centralize-som"
  const rootNameEsc  = rootName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const stripPattern = new RegExp(`^((${rootNameEsc}\\/)|(\\.\\.?\\/)|\\/)+`);

  sb.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href');
    if (!href || href.startsWith('http') || href.startsWith('#') || href.startsWith('mailto:')) return;
    const cleaned = href.replace(stripPattern, '');
    if (!cleaned) return;
    a.setAttribute('href', root + '/' + cleaned);
  });
})();

// ══════════════════════════════════════════════════
//   Icons  |  Shared Lucide-style SVG icon library
//   ------------------------------------------------
//   Exposes:
//     window.Icons.svg(name, opts?)  → <svg> string
//     window.Icons.replaceAll(root?) → swap <i data-icon="x"> or [data-icon]
//     window.Icons.paths             → raw path dict (extensible)
//     window.Icons.emojiMap          → seed emoji→icon-name map
//     window._ic(name, w?, h?)       → back-compat wrapper
//
//   Declarative usage in HTML:
//     <i data-icon="phone"></i>              (default 16×16)
//     <i data-icon="mail" data-size="20"></i>
//     <i data-icon="mail" data-w="20" data-h="20"></i>
//
//   Auto-runs Icons.replaceAll() on DOMContentLoaded and whenever
//   Icons.replaceAll(node) is called after inserting new content.
// ══════════════════════════════════════════════════
const _IC_PATHS = {
  // ── Navigation / sidebar (original set) ──
  'dashboard':      '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  'board':          '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  'table':          '<path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/>',
  'smile':          '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" x2="9.01" y1="9" y2="9"/><line x1="15" x2="15.01" y1="9" y2="9"/>',
  'calendar':       '<rect width="18" height="18" x="3" y="4" rx="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/>',
  'clock':          '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  'wrench':         '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  'book-open':      '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  'bar-chart':      '<line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/>',
  'send':           '<line x1="22" x2="11" y1="2" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  'inbox':          '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  'settings':       '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  'server':         '<rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/>',
  'terminal':       '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
  'bell':           '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  'pause':          '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  'smartphone':     '<rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/>',
  'search':         '<circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/>',
  'log-out':        '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
  'moon':           '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  'sun':            '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  'at-sign':        '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"/>',
  'message-sq':     '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  'clipboard':      '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect width="8" height="4" x="8" y="2" rx="1"/>',
  'file-text':      '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/>',
  'refresh-cw':     '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  'arrow-up-right': '<line x1="7" x2="17" y1="17" y2="7"/><polyline points="7 7 17 7 17 17"/>',
  'users':          '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',

  // ── Previously missing sidebar icons (were falling back to settings) ──
  'archive':        '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  'compass':        '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
  'file-log':       '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" x2="15" y1="13" y2="13"/><line x1="9" x2="15" y1="17" y2="17"/>',
  'grid':           '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  'mail':           '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-10 5L2 7"/>',
  'monitor':        '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
  'zap':            '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',

  // ── Users / access ──
  'user':           '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  'user-plus':      '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/>',
  'user-check':     '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/>',
  'user-x':         '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="17" x2="22" y1="8" y2="13"/><line x1="22" x2="17" y1="8" y2="13"/>',
  'lock':           '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  'unlock':         '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  'key':            '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>',
  'shield':         '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  'shield-check':   '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  'log-in':         '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" x2="3" y1="12" y2="12"/>',

  // ── Status / feedback ──
  'check':          '<polyline points="20 6 9 17 4 12"/>',
  'check-circle':   '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  'x':              '<line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/>',
  'x-circle':       '<circle cx="12" cy="12" r="10"/><line x1="15" x2="9" y1="9" y2="15"/><line x1="9" x2="15" y1="9" y2="15"/>',
  'alert-triangle': '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/>',
  'alert-circle':   '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  'info':           '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="16" y2="12"/><line x1="12" x2="12.01" y1="8" y2="8"/>',
  'help-circle':    '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" x2="12.01" y1="17" y2="17"/>',
  'ban':            '<circle cx="12" cy="12" r="10"/><line x1="4.93" x2="19.07" y1="4.93" y2="19.07"/>',

  // ── Emphasis / delight ──
  'star':           '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  'heart':          '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
  'flame':          '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  'sparkles':       '<path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/><path d="M19 15l.75 2.25L22 18l-2.25.75L19 21l-.75-2.25L16 18l2.25-.75L19 15z"/><path d="M5 15l.75 2.25L8 18l-2.25.75L5 21l-.75-2.25L2 18l2.25-.75L5 15z"/>',
  'trophy':         '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  'award':          '<circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 22 12 19 17 22 15.79 13.88"/>',
  'target':         '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  'thumbs-up':      '<path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z"/>',

  // ── Files / folders / docs ──
  'folder':         '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  'folder-open':    '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
  'file':           '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
  'file-plus':      '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" x2="12" y1="18" y2="12"/><line x1="9" x2="15" y1="15" y2="15"/>',
  'clipboard-list': '<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
  'clipboard-check':'<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
  'save':           '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
  'book':           '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
  'graduation-cap': '<path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>',

  // ── Edit / mutate ──
  'edit':           '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
  'pencil':         '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
  'trash':          '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  'plus':           '<line x1="12" x2="12" y1="5" y2="19"/><line x1="5" x2="19" y1="12" y2="12"/>',
  'minus':          '<line x1="5" x2="19" y1="12" y2="12"/>',
  'plus-circle':    '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="16"/><line x1="8" x2="16" y1="12" y2="12"/>',
  'copy':           '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',

  // ── Links & external ──
  'link':           '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  'external-link':  '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/>',

  // ── Ideas / launch ──
  'lightbulb':      '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
  'rocket':         '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',

  // ── Transfer / share ──
  'upload':         '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
  'download':       '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  'share-2':        '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/>',

  // ── Navigation arrows / chevrons ──
  'chevron-up':     '<polyline points="18 15 12 9 6 15"/>',
  'chevron-down':   '<polyline points="6 9 12 15 18 9"/>',
  'chevron-left':   '<polyline points="15 18 9 12 15 6"/>',
  'chevron-right':  '<polyline points="9 18 15 12 9 6"/>',
  'arrow-left':     '<line x1="19" x2="5" y1="12" y2="12"/><polyline points="12 19 5 12 12 5"/>',
  'arrow-right':    '<line x1="5" x2="19" y1="12" y2="12"/><polyline points="12 5 19 12 12 19"/>',
  'arrow-up':       '<line x1="12" x2="12" y1="19" y2="5"/><polyline points="5 12 12 5 19 12"/>',
  'arrow-down':     '<line x1="12" x2="12" y1="5" y2="19"/><polyline points="19 12 12 19 5 12"/>',

  // ── Media / playback ──
  'play':           '<polygon points="5 3 19 12 5 21 5 3"/>',
  'stop-circle':    '<circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6"/>',

  // ── Visibility / privacy ──
  'eye':            '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off':        '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" x2="23" y1="1" y2="23"/>',

  // ── Metadata / structure ──
  'tag':            '<path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" x2="7.01" y1="7" y2="7"/>',
  'ticket':         '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z"/><path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/>',
  'package':        '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',

  // ── Media capture ──
  'image':          '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  'camera':         '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="4"/>',
  'printer':        '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/>',

  // ── Location / geo ──
  'home':           '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  'globe':          '<circle cx="12" cy="12" r="10"/><line x1="2" x2="22" y1="12" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  'map-pin':        '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
  'phone':          '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  'wifi':           '<path d="M5 13a10 10 0 0 1 14 0"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M2 8.82a15 15 0 0 1 20 0"/><line x1="12" x2="12.01" y1="20" y2="20"/>',

  // ── Money / commerce ──
  'wallet':         '<path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"/><path d="M4 6v12c0 1.1.9 2 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>',
  'dollar-sign':    '<line x1="12" x2="12" y1="1" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  'credit-card':    '<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>',

  // ── Overflow / structure ──
  'more-horizontal':'<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  'more-vertical':  '<circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>',
  'menu':           '<line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/>',
  'filter':         '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
  'circle':         '<circle cx="12" cy="12" r="10"/>',

  // ── System / infra ──
  'database':       '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
  'activity':       '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  'git-branch':     '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  'history':        '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  'power':          '<path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" x2="12" y1="2" y2="12"/>',
  'chip':           '<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/>',

  // ── Extra icons for Phase 2 sweep (megaphone, tools, badges, etc.) ──
  'megaphone':      '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  'test-tube':      '<path d="M14.5 2v17.5c0 1.4-1.1 2.5-2.5 2.5c-1.4 0-2.5-1.1-2.5-2.5V2"/><path d="M8.5 2h7"/><path d="M14.5 16h-5"/>',
  'palette':        '<circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>',
  'paperclip':      '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 17.93 8.8L9.41 17.32a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  'plug':           '<path d="M22 22 2 2"/><path d="M12 12 2 22"/><path d="M12 2v4"/><path d="M18 8v4"/><path d="M12 8h6l4 4v6"/>',
  'bug':            '<rect width="8" height="14" x="8" y="6" rx="4"/><path d="m19 7-3 2"/><path d="m5 7 3 2"/><path d="m19 19-3-2"/><path d="m5 19 3-2"/><path d="M20 13h-4"/><path d="M4 13h4"/><path d="m10 4 1 2"/><path d="m14 4-1 2"/>',
  'thermometer':    '<path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"/>',
  'briefcase':      '<rect width="20" height="14" x="2" y="7" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  'building':       '<rect width="16" height="20" x="4" y="2" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/>',
  'flag':           '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>',
  'hand':           '<path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/><path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
  'id-card':        '<path d="M16 10h2"/><path d="M16 14h2"/><path d="M6.17 15a3 3 0 0 1 5.66 0"/><circle cx="9" cy="11" r="2"/><rect width="20" height="14" x="2" y="5" rx="2"/>',
  'maximize':       '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  'satellite':      '<path d="M13 7 9 3 5 7l4 4"/><path d="m17 11 4 4-4 4-4-4"/><path d="m8 12 4 4 6-6-4-4Z"/><path d="m16 8 3-3"/><path d="M9 21a6 6 0 0 0-6-6"/>',
  'sunrise':        '<path d="M12 2v8"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m8 6 4-4 4 4"/><path d="M16 18a4 4 0 0 0-8 0"/>',
  'umbrella-beach': '<path d="M17.5 22h.5a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v1a2 2 0 0 0 2 2h.5"/><path d="M12 4v18"/><path d="M20 8h-1"/><path d="M2 8h2c1.9 0 3.5 1.6 3.5 3.5V13h13V11.5a3.5 3.5 0 0 0-3.5-3.5H12"/>',
  'siren':          '<path d="M7 12a5 5 0 0 1 10 0v6H7v-6z"/><path d="M15 12a3 3 0 0 0-6 0"/><line x1="12" x2="12" y1="4" y2="2"/><line x1="17" x2="19" y1="6" y2="4"/><line x1="7" x2="5" y1="6" y2="4"/><path d="M4 22h16"/>',
  'recycle':        '<path d="M7 19H4.815a1.83 1.83 0 0 1-1.57-.881 1.785 1.785 0 0 1-.004-1.784L7.196 9.5"/><path d="M11 19h8.203a1.83 1.83 0 0 0 1.556-.89 1.784 1.784 0 0 0 0-1.775l-1.226-2.12"/><path d="m14 16-3 3 3 3"/><path d="M8.293 13.596 7.196 9.5 3.1 10.598"/><path d="m9.344 5.811 1.093-1.892A1.83 1.83 0 0 1 12.008 3a1.83 1.83 0 0 1 1.572.92l3.913 6.775"/><path d="M13.378 9.633 17.5 10.598 18.5 6.5"/>',
  'trending-up':    '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  'trending-down':  '<polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/>',
  'moon-star':      '<path d="M12 3a6.364 6.364 0 0 0 9 9 9 9 0 1 1-9-9Z"/><path d="M19 3v4"/><path d="M17 5h4"/>',
  'coffee':         '<path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><line x1="6" x2="6" y1="2" y2="4"/><line x1="10" x2="10" y1="2" y2="4"/><line x1="14" x2="14" y1="2" y2="4"/>',
  'badge':          '<path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/>',
  'sticker':        '<path d="M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z"/><path d="M15 3v6h6"/><path d="M10 16s.8 1 2 1c1.3 0 2-1 2-1"/><path d="M8 13h0"/><path d="M16 13h0"/>',
  'pin':            '<line x1="12" x2="12" y1="17" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24z"/>',
  'bookmark':       '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
  'command':        '<path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/>',
};

// Emoji → canonical icon name. Extend as needed. Not exhaustive by design —
// covers the high-frequency emoji actually used across the codebase.
const _EMOJI_MAP = {
  '📱': 'smartphone', '📞': 'phone',
  '🏠': 'home',        '🌐': 'globe',       '📍': 'map-pin',
  '📧': 'mail', '✉️': 'mail', '📮': 'inbox', '📥': 'inbox', '📤': 'upload',
  '🔒': 'lock', '🔓': 'unlock', '🔑': 'key',
  '👤': 'user', '👥': 'users', '➕': 'plus', '➖': 'minus',
  '💬': 'message-circle', '🗨️': 'message-circle', '💭': 'message-sq',
  '⚠️': 'alert-triangle', '⚠': 'alert-triangle',
  'ℹ️': 'info', 'ℹ': 'info', '❓': 'help-circle', '❔': 'help-circle',
  '✅': 'check-circle', '☑️': 'check', '✔️': 'check', '✔': 'check',
  '❌': 'x-circle', '✖️': 'x', '✖': 'x', '🚫': 'ban',
  '⭐': 'star', '🌟': 'star', '❤️': 'heart', '❤': 'heart', '♥': 'heart',
  '🔥': 'flame', '✨': 'sparkles', '🎉': 'sparkles', '🎊': 'sparkles',
  '🏆': 'trophy', '🎖️': 'award', '🏅': 'award', '🎯': 'target', '👍': 'thumbs-up',
  '📁': 'folder', '📂': 'folder-open', '📄': 'file', '📃': 'file', '📑': 'file-text',
  '📋': 'clipboard', '📝': 'edit', '🗑️': 'trash', '🗑': 'trash',
  '✏️': 'pencil', '✏': 'pencil', '📌': 'pin', '🔗': 'link', '🌍': 'globe', '🌎': 'globe',
  '💡': 'lightbulb', '🚀': 'rocket', '⚡': 'zap', '⚡️': 'zap',
  '⬆️': 'arrow-up', '⬇️': 'arrow-down', '⬅️': 'arrow-left', '➡️': 'arrow-right',
  '👁️': 'eye', '👁': 'eye', '🛡️': 'shield', '🛡': 'shield',
  '🏷️': 'tag', '🏷': 'tag', '🎫': 'ticket',
  '🖼️': 'image', '🖼': 'image', '📸': 'camera', '📷': 'camera', '🖨️': 'printer', '🖨': 'printer',
  '💰': 'wallet', '💵': 'dollar-sign', '💳': 'credit-card',
  '📊': 'bar-chart', '📈': 'bar-chart', '📉': 'bar-chart',
  '📅': 'calendar', '📆': 'calendar', '🕐': 'clock', '🕒': 'clock', '⏰': 'clock', '⏱️': 'clock', '⏱': 'clock',
  '⚙️': 'settings', '⚙': 'settings', '🔧': 'wrench', '🛠️': 'wrench',
  '🔔': 'bell', '🔕': 'bell', '📚': 'book-open', '📖': 'book-open', '🎓': 'graduation-cap',
  '🔍': 'search', '🔎': 'search', '🔄': 'refresh-cw', '📶': 'wifi', '💾': 'save',
  '📦': 'package', '🎁': 'package', '🖥️': 'monitor', '💻': 'monitor',
  '⏸️': 'pause', '⏸': 'pause', '▶️': 'play', '▶': 'play', '⏹️': 'stop-circle', '⏹': 'stop-circle',
  '☰': 'menu', '⋯': 'more-horizontal', '⋮': 'more-vertical', '⊕': 'plus-circle',
  // ── Ballot / cross variants (bare, no VS16) ──
  '✓': 'check', '☑': 'check', '✗': 'x', '✕': 'x', '✎': 'pencil',
  '✉': 'mail', '★': 'star', '☆': 'star', '✦': 'sparkles', '❁': 'sparkles',
  '⬆': 'arrow-up', '⬇': 'arrow-down', '⬅': 'arrow-left',
  '👁': 'eye', '🗑': 'trash', '✏': 'pencil', '🗓': 'calendar', '🗂': 'folder-open',
  '🖥': 'monitor', '🛠': 'wrench',
  // ── Communication ──
  '📢': 'megaphone', '📣': 'megaphone', '📯': 'megaphone', '🔊': 'megaphone',
  '📨': 'mail', '📩': 'mail', '📭': 'inbox', '📬': 'inbox', '📫': 'inbox',
  '📎': 'paperclip', '📡': 'satellite',
  // ── Status / dots (fall back to circle — colored variants keep the emoji-in-color unless later re-styled) ──
  '🟢': 'circle', '🔴': 'circle', '🟡': 'circle', '🟠': 'circle', '🟣': 'circle', '🟤': 'circle', '🔵': 'circle', '⚪': 'circle', '⚫': 'circle', '◉': 'circle', '•': 'circle',
  '🚨': 'siren', '🔥': 'flame',
  // ── People / gestures ──
  '👋': 'hand', '🤝': 'users', '👍': 'thumbs-up', '👎': 'thumbs-up',
  // ── Time / weather ──
  '🌙': 'moon', '🌛': 'moon', '🌜': 'moon', '🌚': 'moon-star', '🌝': 'sun',
  '🌅': 'sunrise', '🌄': 'sunrise', '🌆': 'sunrise', '🌇': 'sunrise',
  '🏖': 'umbrella-beach', '🏖️': 'umbrella-beach', '🏝': 'umbrella-beach', '🏝️': 'umbrella-beach',
  // ── Nature (best-effort) ──
  '🐛': 'bug', '🐞': 'bug', '🍊': 'circle', '🐢': 'circle',
  // ── Refresh / recycle ──
  '🔁': 'refresh-cw', '🔃': 'refresh-cw', '♻': 'recycle', '♻️': 'recycle', '⛔': 'ban',
  // ── Book variants ──
  '📘': 'book', '📗': 'book', '📙': 'book', '📕': 'book', '📓': 'book', '📔': 'book',
  // ── Awards / medals ──
  '🥇': 'award', '🥈': 'award', '🥉': 'award', '🎖': 'award', '🎖️': 'award',
  // ── Buildings / places ──
  '🏢': 'building', '🏬': 'building', '🏣': 'building', '🏤': 'building', '🏥': 'building', '🏦': 'building',
  // ── Work / gear ──
  '💼': 'briefcase', '💥': 'zap', '🎨': 'palette', '🖌': 'palette', '🖌️': 'palette', '🎭': 'sticker',
  // ── Lock variants ──
  '🔐': 'lock',
  // ── Science / lab ──
  '🧪': 'test-tube', '🧬': 'test-tube', '🔬': 'test-tube',
  // ── Traffic ──
  '🚦': 'circle', '🚥': 'circle',
  // ── Arrows (heavy) ──
  '➜': 'arrow-right', '➔': 'arrow-right', '⇒': 'arrow-right', '↗': 'arrow-up-right', '↗️': 'arrow-up-right',
  // ── Tech / connectivity ──
  '🔌': 'plug', '📶': 'wifi',
  // ── ID / badges ──
  '🪪': 'id-card', '🆕': 'badge', '🎌': 'flag', '🚩': 'flag',
  // ── Health ──
  '🤒': 'thermometer', '🌡': 'thermometer', '🌡️': 'thermometer',
  // ── Coffee / break ──
  '☕': 'coffee', '☕️': 'coffee', '🍵': 'coffee',
  // ── Trending ──
  '📈': 'trending-up', '📉': 'trending-down',
  // ── Full-screen / expand ──
  '⛶': 'maximize',
  // ── Compass / navigation ──
  '🧭': 'compass',
  // ── Low-frequency additions (from full inventory sweep) ──
  '🧹': 'trash', '🖍': 'pencil', '✍': 'pencil', '✍️': 'pencil',
  '🤖': 'chip', '🗄': 'archive', '🗄️': 'archive',
  '☀': 'sun', '☀️': 'sun', '🌓': 'moon',
  '◀': 'chevron-left', '▷': 'play',
  '☎': 'phone', '☎️': 'phone', '📟': 'smartphone',
  '📜': 'file-text', '📃': 'file-text',
  '➡': 'arrow-right',
  '📏': 'activity', '📐': 'activity', '⚖': 'activity', '⚖️': 'activity',
  '⚒': 'wrench', '⚒️': 'wrench',
  '⛰': 'map-pin', '⛰️': 'map-pin', '🗺': 'map-pin', '🗺️': 'map-pin',
  '🖇': 'paperclip', '🖇️': 'paperclip',
  '🚪': 'log-out',
};

function _icSvg(name, opts) {
  const o = (typeof opts === 'object' && opts) ? opts : {};
  const w = o.w || o.size || 16;
  const h = o.h || o.size || 16;
  const stroke = o.stroke != null ? o.stroke : 1.75;
  // Default class is `icon-svg` (not `.ico`) so we don't inherit unrelated
  // container styles like `.ex-card .ico { 46px red box }` from other pages.
  const cls = o.class || o.className || 'icon-svg';
  const paths = _IC_PATHS[name] || _IC_PATHS['help-circle'];
  return `<svg xmlns="http://www.w3.org/2000/svg" class="${cls}" width="${w}" height="${h}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

// Back-compat: existing sidebar/topbar code uses _ic(name, w, h) positional args.
function _ic(name, w = 16, h = 16) {
  return _icSvg(name, { w, h });
}

// Declarative: swap <i data-icon="x"> and any [data-icon] element for SVG.
// Called automatically on DOMContentLoaded; call again after inserting new HTML.
function _icReplaceAll(root) {
  const scope = root || document;
  scope.querySelectorAll('[data-icon]:not([data-icon-done])').forEach(el => {
    const name = el.getAttribute('data-icon');
    if (!name) return;
    const size = parseInt(el.getAttribute('data-size') || '', 10);
    const w = parseInt(el.getAttribute('data-w') || '', 10) || size || 16;
    const h = parseInt(el.getAttribute('data-h') || '', 10) || size || 16;
    const stroke = parseFloat(el.getAttribute('data-stroke') || '') || 1.75;
    el.innerHTML = _icSvg(name, { w, h, stroke, class: 'icon-svg' });
    el.setAttribute('data-icon-done', '1');
    // Elements marked <i data-icon> get a neutral wrapper style so they align
    // with adjacent text without inheriting italic from <i>.
    if (el.tagName === 'I') el.style.fontStyle = 'normal';
    el.style.display = el.style.display || 'inline-flex';
    el.style.alignItems = el.style.alignItems || 'center';
    el.style.verticalAlign = el.style.verticalAlign || '-0.125em';
  });
}

// Inject a shared stylesheet for .icon-svg so inline SVGs align consistently with text.
(function _icInjectCss() {
  if (document.getElementById('ico-shared-css')) return;
  const st = document.createElement('style');
  st.id = 'ico-shared-css';
  st.textContent = `
    .icon-svg { display:inline-block; vertical-align:-0.125em; flex-shrink:0; }
    .icon-svg-sm { width:12px; height:12px; }
    .icon-svg-md { width:16px; height:16px; }
    .icon-svg-lg { width:20px; height:20px; }
    .icon-svg-xl { width:24px; height:24px; }
    i[data-icon] { font-style:normal; display:inline-flex; align-items:center; vertical-align:-0.125em; }
    /* If an <i data-icon> is inside a big-styled container (e.g. .ico), keep
       the SVG at inline text size instead of stretching to fill. */
    i[data-icon] > svg.icon-svg { width:1em; height:1em; }
  `;
  (document.head || document.documentElement).appendChild(st);
})();

// Public API
window.Icons = {
  svg: _icSvg,
  replaceAll: _icReplaceAll,
  paths: _IC_PATHS,
  emojiMap: _EMOJI_MAP,
  has: (name) => Object.prototype.hasOwnProperty.call(_IC_PATHS, name),
  register: (name, pathHtml) => { _IC_PATHS[name] = pathHtml; },
};
window._ic = _ic;

// Auto-replace declarative icons once DOM is parsed, then keep watching for
// dynamic insertions (e.g. innerHTML from JS/PHP-generated HTML strings).
// The MutationObserver batches new nodes into one microtask so we don't
// re-scan the whole document on every DOM mutation.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => _icReplaceAll());
} else {
  _icReplaceAll();
}
(function _icWatchDom() {
  if (typeof MutationObserver === 'undefined') return;
  let queued = false;
  const pending = new Set();
  const flush = () => {
    queued = false;
    for (const node of pending) _icReplaceAll(node);
    pending.clear();
  };
  const obs = new MutationObserver(mutations => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue; // element only
        // If the node itself or any descendant carries data-icon, queue it.
        if (node.hasAttribute && node.hasAttribute('data-icon')) pending.add(node);
        else if (node.querySelector && node.querySelector('[data-icon]:not([data-icon-done])')) pending.add(node);
      }
    }
    if (pending.size && !queued) {
      queued = true;
      queueMicrotask(flush);
    }
  });
  const start = () => obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();

// Pristine timer reference, captured before any page-tracking patch can replace
// window.setTimeout. Shell-owned callbacks scheduled DURING a navigation must use
// this: the patched setTimeout records ids under the incoming page, and the next
// navigation cancels them — which silently kills shell state (e.g. the navbar pill
// FLIP cleanup, leaving the pill frozen at a stale width).
const _NATIVE_setTimeout      = window.setTimeout.bind(window);
const _NATIVE_setInterval     = window.setInterval.bind(window);
const _NATIVE_addDocListener  = document.addEventListener.bind(document);
const _NATIVE_addWinListener  = window.addEventListener.bind(window);

const Layout = {
  currentPage: '',

  // ── Top-nav style ──────────────────────────────────────
  _NAV_STYLE_KEY: 'som_nav_style',

  // Groups define how coreNavItems are organised in the top navbar
  _navGroupDef: [
    { id: 'home',       label: 'Home',       ids: ['dashboard','dev-hub','my-team','about-som','schedule','pw-schedule','sheets','sabai','onboarding'] },
    { id: 'monitor',   label: 'Monitor',    ids: ['service-performance','restart-monitor','restart-analyzer','log-explorer','alert-monitor','monitoring','uptime','grafana-alerts','begin-grafana','syncup'] },
    { id: 'ma',        label: 'MA Tools',   ids: ['ma-services','ma-test'] },
    { id: 'ops',       label: 'Operations', ids: ['board','send-email','jira-templates','case-incidents','inbox','batch-monitor','batch-file-search','jenkins-build','jenkins-portal','so-jenkins','migrate-user','sms-gateway-switches','test-service','analytics','weekly-report','report-center'] },
    { id: 'automation', label: 'Automation', ids: ['incident-launcher'] },
    { id: 'learn',     label: 'Learn',      ids: ['learn','learn-reports','exam-reports'] },
    { id: 'genz',      label: 'GenZ',       ids: ['genz-hub','genz-notes'] },
    { id: 'admin',     label: 'Admin',      ids: ['admin','genz-team','nav-groups','devtools','dev-system','dev-api','dev-logs','dev-email','dev-data'] },
  ],

  _NAV_GROUPS_SS_KEY: '_sm_nav_groups',
  _SV_CONFIG_SS_KEY:  '_sm_sv_config',

  // Load custom nav groups from sessionStorage (cache) or API.
  // Normalises API shape { items:[...] } → layout shape { ids:[...] }.
  async _loadNavGroupsCache() {
    try {
      const raw = sessionStorage.getItem(this._NAV_GROUPS_SS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) {
          this._navGroupDef = parsed;
          // Background-refresh so next page picks up any admin changes
          this._refreshNavGroupsInBackground();
          return;
        }
      }
    } catch {}
    // No cache — fetch synchronously before first render
    await this._fetchNavGroups();
  },

  async _fetchNavGroups() {
    try {
      if (typeof API === 'undefined' || !Auth?.getToken?.()) return;
      const res = await API.get('/nav-groups/index.php');
      const payload = res?.data?.data ?? res?.data;   // unwrap api.js wrapper
      if (res?.ok && Array.isArray(payload?.groups) && payload.groups.length) {
        const def = payload.groups.map(g => ({
          id:    g.id,
          label: g.label,
          icon:  g.icon,
          ids:   Array.isArray(g.items) ? g.items : [],
        }));
        this._navGroupDef = def;
        try { sessionStorage.setItem(this._NAV_GROUPS_SS_KEY, JSON.stringify(def)); } catch {}
      }
    } catch {}
  },

  _refreshNavGroupsInBackground() {
    setTimeout(() => this._fetchNavGroups(), 500);
  },

  // Collapse page-specific topbar items into a "+N" dropdown when the pill overflows.
  // Core items (search, bell, alerts) are never collapsed.
  _initNavOverflow() {
    if (this._flipInProgress) return;
    const actionsEl = document.querySelector('.tn-pill-actions');
    if (!actionsEl) return;

    // ── 1. Clean up previous run ──────────────────────────────────────────────
    document.getElementById('_tn-more-wrap')?.remove();
    // Only reset items that were hidden by the PREVIOUS overflow pass.
    // Items hidden by page permission scripts (display:none) must be left alone —
    // clearing them would reveal buttons to users who shouldn't see them.
    const prevOverflow = this._overflowHidden || new Set();
    Array.from(actionsEl.children).forEach(el => {
      if (prevOverflow.has(el) || el.style.display !== 'none') el.style.display = '';
    });
    this._overflowHidden = new Set();

    // ── 2. Identify core vs page items ────────────────────────────────────────
    const CORE_IDS = new Set(['_tb-search-btn', '_tb-notif-wrap', '_tb-alerts-btn', '_jri-tb-btn', '_tb-settings-btn']);
    // Exclude permission-hidden items (still display:none after selective reset above).
    // Also exclude wrapper divs whose inner child has a CORE_IDS id (e.g. JRI button wrapper).
    const pageItems = Array.from(actionsEl.children).filter(el => {
      if (el.style.display === 'none') return false;
      if (el.dataset.core === '1') return false;
      if (CORE_IDS.has(el.id)) return false;
      // Check if this wrapper contains a core element (e.g. <div><button id="_jri-tb-btn">)
      if (el.querySelector && [...CORE_IDS].some(id => el.querySelector('#' + id))) return false;
      return true;
    });
    if (!pageItems.length) return;

    // ── 3. Measure overflow ───────────────────────────────────────────────────
    const pill = actionsEl.closest('.tn-2row-pill');
    const nav  = actionsEl.closest('.tn-2row-nav');
    if (!pill || !nav) return;
    void pill.offsetWidth;

    const pillVisible = pill.clientWidth;
    let   navContent  = nav.scrollWidth;
    if (navContent <= pillVisible) return;

    // ── 4. Hide page items right-to-left until content fits ──────────────────
    const toHide = [];
    for (let i = pageItems.length - 1; i >= 0 && navContent > pillVisible; i--) {
      const item = pageItems[i];
      const w = item.getBoundingClientRect().width + 4;
      item.style.display = 'none';
      navContent -= w;
      toHide.unshift(item);
      this._overflowHidden.add(item);
    }
    if (!toHide.length) return;

    // ── 5. Build "+N more" dropdown ───────────────────────────────────────────
    const wrap = document.createElement('div');
    wrap.id = '_tn-more-wrap';
    const btn = document.createElement('button');
    btn.id = '_tn-more-btn';
    btn.innerHTML = `${_ic('more-horizontal', 13, 13)} <span>+${toHide.length}</span>`;
    const dd = document.createElement('div');
    dd.id = '_tn-more-dd';
    toHide.forEach(el => {
      const clone = el.cloneNode(true);
      clone.style.display = '';
      // cloneNode does not copy JS event listeners — proxy-click the original instead.
      clone.addEventListener('click', e => {
        e.stopPropagation();
        dd.classList.remove('open');
        el.click();
      });
      // Remove any onclick attr that would fire on the stale clone context
      clone.querySelectorAll('[onclick]').forEach(c => c.removeAttribute('onclick'));
      clone.removeAttribute('onclick');
      dd.appendChild(clone);
    });
    btn.addEventListener('click', e => { e.stopPropagation(); dd.classList.toggle('open'); });
    dd.addEventListener('click', e => e.stopPropagation());
    document.addEventListener('click', () => dd.classList.remove('open'));
    wrap.appendChild(btn);
    wrap.appendChild(dd);
    actionsEl.parentElement.insertBefore(wrap, actionsEl.nextSibling);
  },

  _getNavStyle() {
    try {
      const v = localStorage.getItem(this._NAV_STYLE_KEY) || 'capsule';
      // 'command' was removed — fall back to capsule
      return v === 'command' ? 'capsule' : v;
    } catch { return 'capsule'; }
  },

  _getFilteredNavItems(showLocked = false) {
    const user          = Auth.getUser();
    const isAdmin       = ['super_admin','sm_admin','dev_sm'].includes(user?.role);
    const isExternal    = user?.role === 'external';
    const extPerms      = isExternal ? (user.permissions || []) : null;
    const menuPerms     = this._getMenuPerms();
    const allowedSet    = menuPerms ? new Set(menuPerms.allowed) : null;
    const teamFeatures  = Auth.getTeamFeatures?.();
    const tfPages       = Auth.getTeamFeaturePages?.() || {};
    const _viewAs       = (typeof Auth !== 'undefined' && Auth._getViewAsTeam) ? Auth._getViewAsTeam() : null;
    const _isGR         = ['super_admin','super_viewer'].includes(user?.role);
    const effectiveTeam = _isGR ? (_viewAs?.slug || null) : (user?.team || null);

    const result = [];
    this.coreNavItems.forEach(item => {
      // Hard-hide gates: role/admin/team/genz — never shown regardless of showLocked
      if (item.adminOnly && !isAdmin) return;
      if (item.roles && !item.roles.includes(user?.role)) return;
      if (isExternal && item.denyRoles && item.denyRoles.includes('external')) return;
      if (user?.role === 'super_viewer') {
        const svDenied = this._getSvDenied();
        if (svDenied ? svDenied.has(item.id) : (item.denyRoles && item.denyRoles.includes('super_viewer'))) return;
      } else if (item.denyRoles && item.denyRoles.includes(user?.role)) return;
      if (item.genzOnly && !user?.is_genz) return;
      if (isExternal && (item.section === 'ADMIN' || item.section === 'DEV')) return;
      if (item.team && effectiveTeam !== null && effectiveTeam !== item.team) return;

      // Soft-hide gates: feature & menu-perms → show as locked when showLocked = true
      let locked = false;
      // Extra-page override: user has been granted cross-team access to this page.
      const _extraPages = user?.extra_pages || [];
      const _hasExtraPage = _extraPages.some(ep => ep.page === item.id);
      if (!_hasExtraPage) {
        if (item.feature && teamFeatures !== null) {
          if (!(teamFeatures || []).includes(item.feature)) {
            if (!showLocked) return;
            locked = true;
          } else {
            const pp = tfPages[item.feature];
            if (pp && Array.isArray(pp.user_pages) && !pp.user_pages.includes(item.id)) {
              if (!showLocked) return;
              locked = true;
            }
          }
        }
        if (!locked && allowedSet && !allowedSet.has(item.id)) {
          if (!showLocked) return;
          locked = true;
        }
      }

      result.push(showLocked ? { ...item, locked } : item);
    });
    return result;
  },

  _buildTopNav(style) {
    const user    = Auth.getUser();
    const prefix  = this._getPrefix();
    const items   = this._getFilteredNavItems(true);
    const cur     = this.currentPage;

    const avatarUrl = user?.avatar_url || '';
    const initials  = getInitials(user?.name || '?');
    const avatarHtml = avatarUrl
      ? `<img src="${escHtml(avatarUrl)}" alt="" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentElement.innerHTML='${initials}'">`
      : escHtml(initials);
    const roleLabel   = Roles.label(user?.role || '');
    const _isGenz     = !!(user?.is_genz);

    // Dynamic logo label — shared across all nav styles
    const _teamSlug2  = user?.team || 'sm';
    const _logoLabel  = user?.role === 'super_admin' ? 'PLATFORM'
                      : user?.role === 'super_viewer' ? 'OVERSIGHT'
                      : (_teamSlug2.toUpperCase() + '-HUB');

    // GenZ inline chip — shown next to logo in Horizon/Vision
    const _genzChip   = _isGenz
      ? `<span class="tn-genz-chip">✦ GenZ</span>` : '';

    // Resolve groups — keep only groups with at least one visible item
    const visGroups = this._navGroupDef.map(g => ({
      ...g,
      items: items.filter(it => g.ids.includes(it.id)),
    })).filter(g => g.items.length > 0);

    const activeGrp = visGroups.find(g => g.items.some(it => it.id === cur)) || visGroups[0];

    const _ddMenu = (grp) => `<div class="tn-dd-menu-inner">${grp.items.map(it => {
      if (it.locked) {
        return `<a class="tn-dd-item tn-dd-item-locked" href="${prefix}${it.path}" data-page-id="${it.id}" title="ไม่มีสิทธิ์เข้าถึง — ติดต่อผู้ดูแลระบบ">${_ic(it.iconName||'dashboard',14,14)} ${escHtml(it.label)}<span class="tn-no-access-badge">No Access</span></a>`;
      }
      const ac = it.id === cur ? ' tn-active' : '';
      const bdg = it.badge ? `<span class="nav-badge tn-dd-badge" id="${it.badge}-dd" style="display:none">0</span>` : '';
      return `<a class="tn-dd-item${ac}" href="${prefix}${it.path}" data-page-id="${it.id}">${_ic(it.iconName||'dashboard',14,14)} ${escHtml(it.label)}${bdg}</a>`;
    }).join('')}</div>`;

    const _isSMUser = user && (user.team === 'sm' || ['sm_admin','sm_lead','sm_user','dev_sm','super_admin'].includes(user.role));
    const _inboxDdItem = _isSMUser
      ? `<button class="tn-dd-item" onclick="JiraInbox?.open()" style="width:100%;text-align:left;display:flex;align-items:center;gap:8px;">
           ${_ic('inbox',13,13)} Requests SOM Portal
           <span id="_jri-dd-badge" style="display:none;margin-left:auto;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:#ef4444;color:#fff;font-size:9px;font-weight:800;line-height:16px;text-align:center;"></span>
         </button>`
      : '';
    const _userDd = () => `<div class="tn-user-dd-inner">
      <div class="tn-user-name">${escHtml(user?.name || '')}</div>
      <div class="tn-user-role">${escHtml(roleLabel)}</div>
      <div class="tn-dd-sep"></div>
      ${_inboxDdItem}
      <a class="tn-dd-item" href="${prefix}profile.html">${_ic('user',13,13)} Profile</a>
      <a class="tn-dd-item" href="${prefix}settings.html">${_ic('settings',13,13)} Settings</a>
      <div class="tn-dd-sep"></div>
      <button class="tn-dd-item tn-signout" onclick="Auth.logout()">${_ic('log-out',13,13)} Sign out</button>
    </div>`;

    const _iconBtn = (icon, id='', title='', extra='') =>
      `<button class="tn-icon-btn"${id?` id="${id}"`:''}${title?` title="${title}"`:''}${extra}>${_ic(icon,15,15)}</button>`;

    let inner = '';

    if (style === 'horizon') {
      const groups = visGroups.map(g => {
        const ac = g === activeGrp ? ' tn-link-active' : '';
        return `<div class="tn-dd">
          <button class="tn-link${ac}" data-tn-grp="${g.id}">${escHtml(g.label)}<span class="nav-badge tn-grp-badge" id="tn-grp-badge-${g.id}" style="display:none">0</span><span class="tn-chev">▾</span></button>
          <div class="tn-dd-menu">${_ddMenu(g)}</div>
        </div>`;
      }).join('');
      inner = `<header class="topnav topnav-horizon${_isGenz ? ' topnav-genz' : ''}">
        <a class="tn-logo" href="${prefix}dashboard.html">
          <div class="tn-logo-mark"></div>${_logoLabel}
        </a>${_genzChip}
        <div class="tn-items">${groups}</div>
        <div class="tn-right">
          ${_iconBtn('search','tn-search-btn','Search (⌘K)',' onclick="Layout._openGlobalSearch?.()"')}
          <div class="tn-bell-wrap">${_iconBtn('bell','tn-bell-btn','Alerts')}<div class="tn-bell-badge" id="tn-bell-badge"></div></div>
          ${_iconBtn('moon','tn-dark-btn','Toggle dark mode',' onclick="Theme.toggle()"')}
          <div class="tn-avatar-wrap"><div class="tn-avatar">${avatarHtml}</div><div class="tn-user-dd">${_userDd()}</div></div>
        </div>
      </header>`;

    } else if (style === 'capsule') {
      const groups = visGroups.map(g => {
        const ac = g === activeGrp ? ' tn-link-active' : '';
        return `<div class="tn-dd">
          <button class="tn-link${ac}" data-tn-grp="${g.id}">${escHtml(g.label)}<span class="nav-badge tn-grp-badge" id="tn-grp-badge-${g.id}" style="display:none">0</span><span class="tn-chev">▾</span></button>
          <div class="tn-dd-menu">${_ddMenu(g)}</div>
        </div>`;
      }).join('');

      // _logoLabel and _isGenz already declared in shared block above
      const _firstName = escHtml((user?.name || '').split(' ')[0] || 'Me');
      const _teamName  = _logoLabel.replace('-HUB', ' TEAM')
                           .replace('PLATFORM', 'PLATFORM TEAM')
                           .replace('OVERSIGHT', 'OVERSIGHT TEAM');

      // Page label for row-2 breadcrumb
      const _pageItem  = this.coreNavItems.find(it => it.id === cur);
      const _pageLabel = _pageItem?.label || cur;
      const _bcTeam    = (_teamSlug2 || 'sm').toLowerCase();

      // Row-2 badge (right side)
      const _row2Badge = _isGenz
        ? `<div class="tn-team-badge tn-team-badge-genz" style="flex-shrink:0;">
             <div class="tn-badge-dot tn-badge-dot-genz"></div>
             <span class="tn-badge-txt-genz">${escHtml(_teamName)} · ✦ GenZ</span>
           </div>`
        : `<div class="tn-team-badge" style="flex-shrink:0;">
             <div class="tn-badge-dot"></div>
             <span>${escHtml(_teamName)}</span>
           </div>`;

      // GenZ: pill gets gradient logo, purple active links, purple CTA
      const _capGenzClass = _isGenz ? ' topnav-capsule-genz' : '';
      const _logoClass    = _isGenz ? 'tn-logo tn-logo-genz' : 'tn-logo';
      const _ctaClass     = _isGenz ? 'tn-cta tn-cta-genz' : 'tn-cta';

      // B design: 2-row floating rounded pill
      // .topbar-actions is placed inside row 1 so _injectTopbarExtras() fills it here
      // The actual .topbar below is hidden via CSS (display:none in capsule mode)
      inner = `<div class="topnav-capsule-wrap">
        <div class="topnav-capsule-scene">
          <div class="tn-2row-pill${_capGenzClass}">
            <!-- Row 1: logo + nav groups + topbar-actions slot + darkmode + avatar -->
            <div class="tn-2row-nav">
              <a class="${_logoClass}" href="${prefix}dashboard.html">${_logoLabel}</a>
              ${groups}
              <div class="tn-2row-sep"></div>
              <!-- _injectTopbarExtras() will fill this div (My Alerts, bell, Open Ticket, etc.) -->
              <div class="topbar-actions tn-pill-actions" style="display:contents;"></div>
              <div class="tn-2row-sep"></div>
              ${_iconBtn('moon','tn-dark-btn','Toggle dark mode',' onclick="Theme.toggle()"')}
              <div class="tn-avatar-wrap" style="position:relative;margin-left:2px;">
                <button class="${_ctaClass}">
                  <div class="tn-avatar" style="width:18px;height:18px;font-size:9px;box-shadow:none;flex-shrink:0;">${avatarHtml}</div>
                  ${_firstName} ▾
                </button>
                <div class="tn-user-dd">${_userDd()}</div>
              </div>
            </div>
            <!-- Inner divider -->
            <div class="tn-2row-div"></div>
            <!-- Row 2: breadcrumb + live clock + badge -->
            <div class="tn-2row-ctx">
              <div class="tn-2row-bc">
                <span class="tn-bc-team">~/${escHtml(_bcTeam)}</span>
                <span class="tn-bc-sep">•</span>
                <span class="tn-bc-page">${escHtml(_pageLabel)}</span>
                <span class="tn-bc-sep">·</span>
                <span class="tn-bc-time" id="tn-clock"></span>
              </div>
              ${_row2Badge}
            </div>
          </div>
          <!-- น้องส้ม — absolute inside scene, z:1 so pill (z:2) overlaps left half -->
          <a class="nong-som-peek" href="${prefix}about-som.html" aria-label="About SOM Team">
            <svg viewBox="0 0 64 80" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:58px;height:78px;overflow:visible;filter:drop-shadow(2px 3px 8px rgba(242,100,25,.45));animation:nongBob 2.2s ease-in-out infinite">
              <!-- Stem -->
              <line x1="32" y1="4" x2="32" y2="14" stroke="#92400e" stroke-width="2.5" stroke-linecap="round"/>
              <!-- Leaf right -->
              <path d="M32 6 Q42 0 46 8 Q38 12 32 8" fill="#22c55e"/>
              <!-- Leaf left -->
              <path d="M32 6 Q22 1 18 9 Q26 12 32 8" fill="#16a34a"/>
              <!-- Orange body -->
              <circle cx="32" cy="46" r="26" fill="#fb923c"/>
              <!-- Segments / texture -->
              <path d="M32 20 Q42 28 46 46" stroke="rgba(255,220,80,.35)" stroke-width="1.5" stroke-linecap="round"/>
              <path d="M32 20 Q22 28 18 46" stroke="rgba(255,220,80,.35)" stroke-width="1.5" stroke-linecap="round"/>
              <path d="M8 42 Q14 34 32 32 Q50 34 56 42" stroke="rgba(255,220,80,.3)" stroke-width="1.5" stroke-linecap="round"/>
              <!-- Shine -->
              <ellipse cx="23" cy="38" rx="6" ry="9" fill="white" opacity="0.13" transform="rotate(-20 23 38)"/>
              <!-- Eyes white -->
              <ellipse cx="25" cy="43" rx="6" ry="6.5" fill="white" style="animation:nongBlink 3.8s 0.2s ease-in-out infinite;transform-origin:25px 43px"/>
              <ellipse cx="39" cy="43" rx="6" ry="6.5" fill="white" style="animation:nongBlink 3.8s 0.6s ease-in-out infinite;transform-origin:39px 43px"/>
              <!-- Pupils -->
              <circle cx="27" cy="45" r="3.2" fill="#1c1c1e"/>
              <circle cx="41" cy="45" r="3.2" fill="#1c1c1e"/>
              <!-- Shine dots -->
              <circle cx="28.5" cy="43" r="1.3" fill="white"/>
              <circle cx="42.5" cy="43" r="1.3" fill="white"/>
              <!-- Smile -->
              <path d="M23 53 Q32 60 41 53" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
              <!-- Cheeks -->
              <ellipse cx="17" cy="50" rx="4.5" ry="2.8" fill="#f26419" opacity="0.5"/>
              <ellipse cx="47" cy="50" rx="4.5" ry="2.8" fill="#f26419" opacity="0.5"/>
              <!-- Waving right arm — sticks out visibly to the right -->
              <g style="transform-origin:56px 42px;animation:nongWave 1.4s ease-in-out infinite">
                <path d="M56 42 Q66 34 63 22" stroke="#fb923c" stroke-width="6" stroke-linecap="round" fill="none"/>
                <circle cx="63" cy="21" r="7" fill="#fb923c"/>
                <path d="M58 13 Q63 8 68 13" stroke="#f26419" stroke-width="2.2" stroke-linecap="round" fill="none" opacity="0.8"/>
              </g>
              <!-- Left arm (hidden behind pill, barely visible) -->
              <path d="M8 48 Q3 56 6 64" stroke="#fb923c" stroke-width="5" stroke-linecap="round" fill="none"/>
              <!-- Feet -->
              <ellipse cx="24" cy="71" rx="7" ry="4" fill="#ea6d10"/>
              <ellipse cx="40" cy="71" rx="7" ry="4" fill="#ea6d10"/>
            </svg>
            <span class="nong-som-label">About SOM Team</span>
          </a>
        </div>
      </div>`;

    } else if (style === 'command') {
      const grpLabel  = activeGrp?.label || 'Home';
      const pageLabel = items.find(it => it.id === cur)?.label || cur;
      // Center = GROUP tabs (all visible groups), not sub-page tabs
      const ctxTabs = visGroups.map(g => {
        const ac = g === activeGrp ? ' tn-ctx-active' : '';
        // Navigate to first item in the group
        const firstItem = g.items[0];
        return `<a class="tn-ctx-tab${ac}" href="${firstItem ? prefix + firstItem.path : '#'}" data-tn-grp="${g.id}">${escHtml(g.label)}</a>`;
      }).join('');
      inner = `<header class="topnav topnav-command">
        <div class="tn-cmd-left">
          <a class="tn-cmd-mark" href="${prefix}dashboard.html">S</a>
          <div class="tn-cmd-sep"></div>
          <div class="tn-crumbs">
            <a href="${prefix}dashboard.html">SOM</a>
            <span class="tn-slash">/</span>
            <a href="#">${escHtml(grpLabel)}</a>
            <span class="tn-slash">/</span>
            <span class="tn-cur">${escHtml(pageLabel)}</span>
          </div>
        </div>
        <div class="tn-cmd-center">${ctxTabs}</div>
        <div class="tn-cmd-right">
          <div class="tn-cmd-search" onclick="Layout._openGlobalSearch?.()">
            ${_ic('search',11,11)} <kbd style="background:var(--border);border-radius:3px;padding:1px 4px;font-size:10px;font-family:inherit;">⌘K</kbd>
          </div>
          <div class="tn-live-dot" title="Live"></div>
          <div class="tn-avatar-wrap" style="margin-left:4px;position:relative;">
            <div class="tn-avatar">${avatarHtml}</div>
            <div class="tn-user-dd">${_userDd()}</div>
          </div>
        </div>
      </header>`;

    } else if (style === 'vision') {
      const groups = visGroups.map(g => {
        const ac = g === activeGrp ? ' tn-link-active' : '';
        return `<div class="tn-dd">
          <button class="tn-link${ac}" data-tn-grp="${g.id}">${escHtml(g.label)}<span class="nav-badge tn-grp-badge" id="tn-grp-badge-${g.id}" style="display:none">0</span><span class="tn-chev">▾</span></button>
          <div class="tn-dd-menu">${_ddMenu(g)}</div>
        </div>`;
      }).join('');
      inner = `<div class="topnav-vision-wrap topnav${_isGenz ? ' topnav-genz' : ''}">
        <div class="tn-vision-main">
          <a class="tn-logo" href="${prefix}dashboard.html">
            <div class="tn-logo-mark"></div>${_logoLabel}
          </a>${_genzChip}
          ${groups}
        </div>
        <div class="tn-vision-actions">
          ${_iconBtn('search','tn-search-btn','Search',' onclick="Layout._openGlobalSearch?.()"')}
          <div class="tn-bell-wrap">${_iconBtn('bell','tn-bell-btn','Alerts')}<div class="tn-bell-badge" id="tn-bell-badge"></div></div>
          ${_iconBtn('moon','tn-dark-btn','Toggle dark mode',' onclick="Theme.toggle()"')}
          <div class="tn-avatar-wrap"><div class="tn-avatar">${avatarHtml}</div><div class="tn-user-dd">${_userDd()}</div></div>
        </div>
      </div>`;
    }

    const wrap = document.createElement('div');
    wrap.id = 'topnav-wrap';
    wrap.innerHTML = inner;
    return wrap;
  },

  _initTopNavDropdowns() {
    // Live clock for capsule row-2
    const _clockEl = document.getElementById('tn-clock');
    if (_clockEl) {
      const _thDays = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัส','ศุกร์','เสาร์'];
      const _thMonths = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
      const _tick = () => {
        const now = new Date();
        const be  = now.getFullYear() + 543;
        const d   = _thDays[now.getDay()];
        const dt  = now.getDate();
        const mo  = _thMonths[now.getMonth()];
        const hh  = String(now.getHours()).padStart(2,'0');
        const mm  = String(now.getMinutes()).padStart(2,'0');
        const ss  = String(now.getSeconds()).padStart(2,'0');
        _clockEl.textContent = `${d} ${dt} ${mo} ${be}  ${hh}:${mm}:${ss}`;
      };
      _tick();
      _NATIVE_setInterval(_tick, 1000);
    }

    // In capsule mode: move page-specific .topbar-actions content into the pill slot
    // Uses FLIP animation so pill smoothly expands/contracts as buttons appear/disappear.
    if (this._getNavStyle() === 'capsule') {
      const _pillTA  = document.querySelector('.tn-pill-actions');
      const _origTA  = document.querySelector('.main-content .topbar-actions');
      const _pillEl  = _pillTA?.closest('.tn-2row-pill');

      // ① Measure BEFORE changing content (FLIP: First)
      const _oldW = _pillEl ? _pillEl.getBoundingClientRect().width : 0;

      // ② Clear old buttons and fill with new page's buttons
      if (_pillTA) _pillTA.innerHTML = '';
      if (_pillTA && _origTA) {
        while (_origTA.firstChild) _pillTA.appendChild(_origTA.firstChild);
      }

      // ③ Measure AFTER (FLIP: Last) and animate from old→new (FLIP: Play)
      if (_pillEl && _oldW) {
        const _newW = _pillEl.getBoundingClientRect().width;
        if (Math.abs(_newW - _oldW) > 3) {
          _pillEl.style.transition = 'none';
          _pillEl.style.width = _oldW + 'px';          // snap back to old width
          void _pillEl.offsetWidth;                     // force reflow
          _pillEl.style.transition = 'width .3s cubic-bezier(.34,1.12,.64,1)';
          _pillEl.style.width = _newW + 'px';          // animate to new width
          setTimeout(() => {
            _pillEl.style.width = '';                   // restore auto after animation
            _pillEl.style.transition = '';
          }, 330);
        }
      }
    }

    // Close all dropdowns when clicking outside (guard for SPA re-calls)
    if (!this._topNavOutsideClickBound) {
      this._topNavOutsideClickBound = true;
      document.addEventListener('click', e => {
        if (!e.target.closest('#topnav-wrap')) {
          document.querySelectorAll('#topnav-wrap .tn-avatar-wrap').forEach(w => w.classList.remove('open'));
          // Group dropdowns need nothing here: they are hover-driven (.tn-dd:hover),
          // so moving the pointer away already closes them. (This line used to
          // target '.tn-dd-wrap', a class that does not exist in this markup.)
        }
      }, true);
    }
    // Avatar wrap click toggle (always re-wire for new topnav after SPA swap)
    document.querySelectorAll('#topnav-wrap .tn-avatar-wrap').forEach(w => {
      w.addEventListener('click', e => { e.stopPropagation(); w.classList.toggle('open'); });
    });
    // Note: tn-dd-item navigation is now handled by _initNavTransition — no separate handler needed

    // ── Inject sliding group-active pill ────────────────────────────────
    const _tnNav = document.querySelector('#topnav-wrap .tn-2row-nav');
    if (_tnNav && !document.getElementById('tn-grp-pill')) {
      _tnNav.style.position = 'relative';
      const _pill = document.createElement('div');
      _pill.id = 'tn-grp-pill';
      _tnNav.appendChild(_pill);
    }
    // For horizon / vision styles use .tn-items as the pill container
    const _tnItems = document.querySelector('#topnav-wrap .tn-items');
    if (_tnItems && !_tnItems.querySelector('#tn-grp-pill') && !document.getElementById('tn-grp-pill')) {
      _tnItems.style.position = 'relative';
      const _pill2 = document.createElement('div');
      _pill2.id = 'tn-grp-pill';
      _tnItems.appendChild(_pill2);
    }
    // Initial placement, no animation — then re-measure once the navbar has
    // actually settled (fonts/icons/badges can still change button widths).
    this._positionTopNavPill(false);
    this._settleTopNavPill();
  },

  // ── Position the sliding topnav group-active pill ──────────────
  // ── Force a hover-opened topnav dropdown shut ──────────────────
  // The group dropdowns have no JS open/close state: CSS `.tn-dd:hover >
  // .tn-dd-menu` does all the work. That breaks down after an SPA navigation
  // started from inside a menu — the pointer has not moved, so :hover is still
  // true and the panel stays over the new page. `.tn-dd-suppress` overrides the
  // hover rule and is removed as soon as the pointer really leaves the group, so
  // normal hovering keeps working afterwards.
  _suppressDdHover(dd) {
    if (!dd) return;
    dd.classList.add('tn-dd-suppress');
    const release = () => {
      dd.classList.remove('tn-dd-suppress');
      dd.removeEventListener('mouseleave', release);
    };
    dd.addEventListener('mouseleave', release);
    // Safety net: if the pointer never leaves (it ends up outside the window, so
    // no mouseleave fires) drop the class anyway.
    setTimeout(release, 1200);
  },

  // ── Re-measure the pill once the navbar has stopped moving ─────────────
  // The first measurement can land before the navbar settles (web fonts still
  // loading, icons swapping in, async badges arriving) and nothing re-measured
  // afterwards, leaving the pill a few px off its button — which reads as a
  // stray orange sliver beside the selected group. Cheap and idempotent: each
  // pass just writes the same numbers back unless something actually moved.
  _settleTopNavPill() {
    (this._pillSettleTimers || []).forEach(id => clearTimeout(id));
    this._pillSettleTimers = [80, 300, 900].map(
      ms => setTimeout(() => this._positionTopNavPill(false), ms)
    );
    // Web fonts change text metrics, and therefore button widths, after paint.
    if (document.fonts?.ready) {
      document.fonts.ready.then(() => this._positionTopNavPill(false)).catch(() => {});
    }
  },

  _positionTopNavPill(animate = true) {
    const pill = document.getElementById('tn-grp-pill');
    if (!pill) return;
    const nav = pill.parentElement;
    if (!nav) return;

    const activeBtn = nav.querySelector('.tn-link.tn-link-active');
    if (!activeBtn) { pill.style.opacity = '0'; return; }

    if (!animate) pill.classList.add('no-anim');

    const navRect = nav.getBoundingClientRect();
    const btnRect = activeBtn.getBoundingClientRect();
    pill.style.left    = (btnRect.left - navRect.left) + 'px';
    pill.style.top     = (btnRect.top  - navRect.top)  + 'px';
    pill.style.width   = btnRect.width  + 'px';
    pill.style.height  = btnRect.height + 'px';
    pill.style.opacity = '1';

    if (!animate) {
      void pill.offsetHeight; // force reflow
      pill.classList.remove('no-anim');
    }
  },

  // ── Update topnav active group/item after navigation ──
  _updateTopNavActive(pageId) {
    if (!document.getElementById('topnav-wrap')) return;

    const grp   = this._navGroupDef.find(g => g.ids.includes(pageId));
    const grpId = grp?.id || '';

    // Update group buttons (.tn-link) active state
    document.querySelectorAll('#topnav-wrap .tn-link[data-tn-grp]').forEach(btn => {
      btn.classList.toggle('tn-link-active', btn.dataset.tnGrp === grpId);
    });

    // Update context-tabs (.tn-ctx-tab) active state
    document.querySelectorAll('#topnav-wrap .tn-ctx-tab[data-tn-grp]').forEach(tab => {
      tab.classList.toggle('tn-ctx-active', tab.dataset.tnGrp === grpId);
    });

    // Update individual dropdown items active state (skip locked items)
    document.querySelectorAll('#topnav-wrap .tn-dd-item:not(.tn-dd-item-locked)[data-page-id]').forEach(a => {
      a.classList.toggle('tn-active', a.dataset.pageId === pageId);
    });

    // Update capsule row-2 breadcrumb page label
    const _pageItem  = this.coreNavItems.find(it => it.id === pageId);
    const _pageLabel = _pageItem?.label || pageId;
    const _bcPageEl  = document.querySelector('#topnav-wrap .tn-bc-page');
    if (_bcPageEl) _bcPageEl.textContent = _pageLabel;

    // Breadcrumb label (command/vision styles)
    const grpLabelEl = document.querySelector('#topnav-wrap .tn-breadcrumb-grp');
    if (grpLabelEl && grp) grpLabelEl.textContent = grp.label;

    // Animate sliding pill to new active group
    this._positionTopNavPill(true);
    this._settleTopNavPill();
  },

  // MAIN + ADMIN are always hardcoded (core, security-sensitive)
  // TOOLS + EXT TOOLS are loaded dynamically from API
  coreNavItems: [
    { id: 'dashboard',       path: 'dashboard.html',       icon: _ic('dashboard'),  label: 'Dashboard',           section: 'MAIN' },
    { id: 'my-team',         path: 'my-team.html',         icon: _ic('users'),      label: 'My Team',             section: 'MAIN' },
    { id: 'board',           path: 'board.html',           icon: _ic('board'),      label: 'Web Board',           section: 'MAIN', feature: 'board' },
    { id: 'sheets',          path: 'sheets.html',          icon: _ic('table'),      label: 'Team Docs',           section: 'MAIN', feature: 'team-docs' },
    { id: 'sabai',           path: 'sabai.html',           icon: _ic('smile'),      label: 'SABai',               section: 'MAIN', feature: 'sabai' },
    { id: 'schedule',        path: 'schedule.html',        icon: _ic('calendar'),   label: 'Shift Schedule',      section: 'MAIN', feature: 'schedule' },
    { id: 'pw-schedule',     path: 'pw-schedule.html',     icon: _ic('clock'),      label: 'PW Schedule',         section: 'MAIN', feature: 'pw-schedule' },
    { id: 'ma-services',     path: 'ma-services.html',     icon: _ic('wrench'),     label: 'MA Services',         section: 'MAIN', feature: 'ma-services' },
    { id: 'ma-test',         path: 'ma-test.html',         icon: _ic('clipboard'),  label: 'Result Test MA',      section: 'MAIN', team: 'sm', denyRoles: ['super_viewer'] },
    { id: 'learn',           path: 'learn.html',           icon: _ic('book-open'),  label: 'Learning',            section: 'MAIN', feature: 'learning' },
    { id: 'weekly-report',   path: 'weekly-report.html',   icon: _ic('bar-chart'),      label: 'Weekly Report',   section: 'MAIN', feature: 'weekly-report' },
    { id: 'report-center',   path: 'report-center.html',   icon: _ic('presentation'),   label: 'Report Center',   section: 'MAIN', feature: 'weekly-report' },
    { id: 'analytics',       path: 'analytics.html',       icon: _ic('bar-chart'),      label: 'Analytics',       section: 'MAIN', feature: 'analytics' },
    { id: 'send-email',      path: 'send-email.html',      icon: _ic('send'),       label: 'SMC Ticket',          section: 'MAIN', feature: 'jira-templates' },
    // jira-templates.html is the read-only template library. Full 'jira-templates'
    // teams also see it (write actions inside are role/team-gated at page level).
    // Non-SM teams grant 'jira-templates-shared' to view SM's data with no admin CTAs.
    { id: 'jira-templates',  path: 'jira-templates.html',  icon: _ic('file-text'),  label: 'Jira Templates',      section: 'MAIN', feature: 'jira-templates-shared' },
    { id: 'case-incidents',  path: 'case-incidents.html',  icon: _ic('alert-triangle'), label: 'Case Incidents',  section: 'MAIN', team: 'sm' },
    { id: 'inbox',           path: 'inbox.html',           icon: _ic('inbox'),      label: 'Team Inbox',          section: 'MAIN', feature: 'inbox',    badge: 'inbox-unread', denyRoles: ['super_viewer'] },
    { id: 'batch-monitor',   path: 'batch-monitor.html',   icon: _ic('grid'),       label: 'Batch Monitor',       section: 'MAIN', feature: 'batch-monitor', denyRoles: ['super_viewer'] },
    { id: 'batch-file-search', path: 'batch-file-search.html', icon: _ic('search'), label: 'File → Job Lookup',   section: 'MAIN', feature: 'batch-file-search', denyRoles: ['super_viewer'] },
    // Jenkins Build Launcher — config-driven build forms (maker/checker approval).
    // Grantable per team + per external user; external users get a trimmed sidebar.
    { id: 'jenkins-build', path: 'jenkins-build.html', icon: _ic('zap'), label: 'Jenkins Build', section: 'MAIN', feature: 'jenkins-build' },
    // Jenkins Portal (Unbind Trigger) — migrated from the standalone jenkins-portal
    // app. Single wealth-style page: Trigger / Build History / Build Logs / Admin
    // panels. Scoped per team; external users see it via menu-permissions.
    { id: 'jenkins-portal', path: 'jenkins-portal.html', icon: _ic('zap'), label: 'Jenkins Portal', section: 'MAIN', feature: 'jenkins-portal' },
    // SO Jenkins (CLT RAG pipeline) — migrated from the standalone so-jenkins app.
    // Single wealth-style page: Trigger / Build History / Build Logs / Admin panels.
    { id: 'so-jenkins', path: 'so-jenkins.html', icon: _ic('rocket'), label: 'SO Jenkins', section: 'MAIN', feature: 'so-jenkins' },
    { id: 'monitoring',      path: 'monitoring.html',      icon: _ic('monitor'),    label: 'Monitoring',          section: 'MAIN', feature: 'monitoring', denyRoles: ['super_viewer'] },
    { id: 'syncup',          path: 'syncup.html',          icon: _ic('refresh-cw'), label: 'Sync Up',             section: 'MAIN', feature: 'syncup', denyRoles: ['super_viewer'] },
    { id: 'alert-monitor',   path: 'alert-monitor.html',   icon: _ic('bell'),       label: 'Alert Monitor',       section: 'MAIN', feature: 'alert-monitor' },
    { id: 'uptime',          path: 'uptime.html',          icon: _ic('clock'),      label: 'Uptime Monitor',      section: 'MAIN', feature: 'uptime', denyRoles: ['super_viewer'] },
    { id: 'sms-gateway-switches', path: 'sms-gateway-switches.html', icon: _ic('smartphone'), label: 'SMS Gateway',   section: 'MAIN', feature: 'sms-gateway' },
    { id: 'test-service',    path: 'test-service.html',    icon: _ic('terminal'),   label: 'Service Test',        section: 'MAIN', feature: 'test-service', denyRoles: ['super_viewer'] },
    { id: 'onboarding',      path: 'onboarding.html',      icon: _ic('compass'),    label: 'Onboarding',          section: 'MAIN', feature: 'onboarding' },
    // OVERSIGHT — cross-team read-only reports for super_viewer / super_admin.
    // Not under /admin/ (super_viewer is blocked from /admin/*), so we surface
    // these pages at the root and gate them via the `roles` allow-list below.
    { id: 'learn-reports',   path: 'learn-reports.html',   icon: _ic('book-open'),  label: 'Course Reports',      section: 'OVERSIGHT', roles: ['super_viewer', 'super_admin'] },
    { id: 'exam-reports',    path: 'exam-reports.html',    icon: _ic('clipboard'),  label: 'Exam Reports',        section: 'OVERSIGHT', roles: ['super_viewer', 'super_admin'] },
    { id: 'admin',           path: 'admin/index.html',     icon: _ic('settings'),   label: 'Admin Panel',         section: 'ADMIN', adminOnly: true },
    { id: 'super-viewer',   path: 'admin/super-viewer.html', icon: _ic('eye'),     label: 'Super Viewer Perms',  section: 'ADMIN', roles: ['super_admin'] },
    { id: 'dev-hub',         path: 'dev-hub.html',         icon: _ic('home'),       label: 'Dev Hub',             section: 'MAIN', team: 'dev' },
    { id: 'restart-monitor', path: 'restart-monitor.html', icon: _ic('server'),     label: 'EKS Restart Monitor', section: 'MAIN', feature: 'restart-monitor' },
    // Service Performance is intentionally always-on for every team, not requestable.
    // Rationale: all data is SM-shared (see smSharedFiles() — service-performance-sources.json,
    // service-inventory.csv, service-performance/*), so every team already reads SM's dataset.
    // Do NOT add a `feature:` gate here without also adding an entry to FEATURE_CATALOGUE
    // + REQUESTABLE_FEATURES + featureDataFiles() and migrating every existing team.
    { id: 'service-performance', path: 'service-performance.html', icon: _ic('bar-chart'), label: 'Service Performance', section: 'MAIN' },
    // About SOM — visible to all roles, no feature gate, no team lock
    { id: 'about-som', path: 'about-som.html', icon: _ic('users'), label: 'About SOM Team', section: 'MAIN' },
    // Restart Analyzer — SM-only. Even though the tool itself queries public
    // Grafana metrics (no per-team state), it targets an ops workflow that
    // belongs to SM. `team: 'sm'` mirrors the `ma-test` pattern above.
    { id: 'restart-analyzer',    path: 'restart-analyzer.html',    icon: _ic('refresh-cw'), label: 'Restart Analyzer',   section: 'MAIN', team: 'sm', denyRoles: ['super_viewer'] },
    { id: 'log-explorer',        path: 'log-explorer.html',        icon: _ic('file-text'),  label: 'Log Explorer',        section: 'MAIN', team: 'sm', denyRoles: ['super_viewer'] },
    // Incident Launcher — SM team only. 1-click incident response: Jira + Board + Meet + Chat + Email.
    { id: 'incident-launcher',   path: 'incident-launcher.html',   icon: _ic('zap'),        label: 'Incident Launcher',   section: 'MAIN', team: 'sm', denyRoles: ['super_viewer'] },
    { id: 'migrate-user',        path: 'migrate-user.html',        icon: _ic('git-merge'),  label: 'Migrate User',        section: 'MAIN', feature: 'migrate-user' },
    // Begin Grafana — SM-only endpoint discovery + PromQL generator.
    // Piggy-backs on service-performance-sources.json (jvmDsUid) to query
    // `http_server_requests_seconds_*` per (method, uri, status).
    { id: 'begin-grafana',       path: 'begin-grafana.html',       icon: _ic('activity'),   label: 'Begin Grafana',       section: 'MAIN', team: 'sm', denyRoles: ['super_viewer'] },
    // GenZ Hub — SM-only perk page, shown only to users with the `is_genz` flag.
    { id: 'genz-hub',             path: 'genz-hub.html',            icon: _ic('sparkles') || _ic('badge'), label: 'GenZ Hub',            section: 'GENZ', team: 'sm', genzOnly: true, denyRoles: ['super_viewer'] },
    { id: 'genz-notes',           path: 'genz-notes.html',          icon: _ic('book-open'),                label: 'Case Notes',          section: 'GENZ', team: 'sm', genzOnly: true, denyRoles: ['super_viewer'] },
    // GenZ Team admin — flag toggling. sm_admin only, SM team only.
    { id: 'genz-team',            path: 'admin/genz-team.html',     icon: _ic('badge'),      label: 'GenZ Team',            section: 'ADMIN', team: 'sm', roles: ['sm_admin', 'dev_sm'] },
    { id: 'nav-groups',           path: 'admin/nav-groups.html',    icon: _ic('layout'),     label: 'Navbar Groups',        section: 'ADMIN', team: 'sm', roles: ['sm_admin', 'dev_sm'] },
    { id: 'grafana-alerts',  path: 'grafana-alerts.html',  icon: _ic('pause'),      label: 'Paused Alerts',       section: 'MAIN', feature: 'grafana-alerts' },
    { id: 'devtools',        path: 'admin/devtools.html',    icon: _ic('terminal'),   label: 'Overview',          section: 'DEV',  roles: ['dev_sm'] },
    { id: 'dev-system',      path: 'admin/dev-system.html',  icon: _ic('monitor'),    label: 'System Monitor',    section: 'DEV',  roles: ['dev_sm'] },
    { id: 'dev-api',         path: 'admin/dev-api.html',     icon: _ic('zap'),        label: 'API Explorer',      section: 'DEV',  roles: ['dev_sm'] },
    { id: 'dev-logs',        path: 'admin/dev-logs.html',    icon: _ic('file-log'),   label: 'Log Viewer',        section: 'DEV',  roles: ['dev_sm'] },
    { id: 'dev-email',       path: 'admin/dev-email.html',   icon: _ic('mail'),       label: 'Email Tester',      section: 'DEV',  roles: ['dev_sm'] },
    { id: 'dev-data',        path: 'admin/dev-data.html',    icon: _ic('archive'),    label: 'Data Inspector',    section: 'DEV',  roles: ['dev_sm'] },
  ],

  // Cache key for sessionStorage. Bumping the version invalidates every
  // browser session's cached tool list — do this whenever the client-side
  // filter shape changes (e.g. adding super_viewer denyRoles filter).
  _CACHE_KEY: 'sm_sidebar_tools_v11',

  // Sidebar collapse + group-state keys
  _SB_COL_KEY: 'sm_sb_col_v1',
  _SB_GRP_KEY: 'sm_sb_grp_v1',

  // Quick Access Bar
  _SB_QUICK_KEY: 'som_sb_quick',
  _SB_QUICK_MAX: 6,

  // Menu-permissions cache (resolved per-user allowed menu IDs)
  _MENU_PERMS_KEY: 'sm_menu_perms_v5',

  // ── Menu-permissions (role-based sidebar filter) ─────────
  _getSvDenied() {
    try {
      const raw = sessionStorage.getItem(this._SV_CONFIG_SS_KEY);
      if (!raw) return null;
      const cfg = JSON.parse(raw);
      return Array.isArray(cfg?.denied_pages) ? new Set(cfg.denied_pages) : null;
    } catch { return null; }
  },
  async _loadSvConfig() {
    try {
      if (typeof API === 'undefined' || !Auth?.getToken?.()) return;
      const res = await API.get('/super-viewer-config/index.php');
      if (res?.ok && Array.isArray(res.data?.data?.denied_pages)) {
        try { sessionStorage.setItem(this._SV_CONFIG_SS_KEY, JSON.stringify(res.data.data)); } catch {}
      }
    } catch {}
  },

  _getMenuPerms() {
    try {
      const raw = sessionStorage.getItem(this._MENU_PERMS_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw);
      // Sanity: mode + allowed[] required
      if (!p || typeof p !== 'object' || !Array.isArray(p.allowed)) return null;
      return p;
    } catch { return null; }
  },
  _saveMenuPerms(p) {
    try { sessionStorage.setItem(this._MENU_PERMS_KEY, JSON.stringify(p)); } catch {}
  },
  clearMenuPermsCache() {
    try { sessionStorage.removeItem(this._MENU_PERMS_KEY); } catch {}
  },

  // ── Quick Access Bar helpers ─────────────────────────────
  _getQuick() {
    try { return JSON.parse(localStorage.getItem(this._SB_QUICK_KEY) || '[]'); }
    catch { return []; }
  },
  _saveQuick(arr) {
    try {
      localStorage.setItem(this._SB_QUICK_KEY, JSON.stringify(arr));
      sessionStorage.removeItem('_sm_sb_html'); // invalidate sidebar HTML cache
    } catch {}
  },
  _isQuick(id) { return this._getQuick().includes(id); },

  _buildQuickBar() {
    const quick  = this._getQuick();
    const prefix = this._getPrefix();
    const starSvg = '<svg viewBox="0 0 24 24" width="8" height="8" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
    let itemsHtml = '';
    quick.forEach(id => {
      const item = this.coreNavItems.find(it => it.id === id);
      if (!item) return;
      const isActive = id === this.currentPage;
      itemsHtml += `<a class="sb-quick-item${isActive ? ' active' : ''}" href="${escHtml(prefix + item.path)}" data-label="${escHtml(item.label)}" data-qid="${escHtml(id)}" title="${escHtml(item.label)}">${item.icon}</a>`;
    });
    const isFull = quick.length >= this._SB_QUICK_MAX;
    const addTitle = isFull
      ? `Quick Access เต็มแล้ว (สูงสุด ${this._SB_QUICK_MAX} รายการ)`
      : `กด ★ บน item ด้านล่างเพื่อเพิ่ม shortcut`;
    return `<div class="sb-quick-bar" id="sb-quick-bar">
      <div class="sb-quick-label" title="Quick Access">${starSvg}</div>
      <div class="sb-quick-items" id="sb-quick-items">${itemsHtml}</div>
      <div class="sb-quick-add${isFull ? ' full' : ''}" title="${escHtml(addTitle)}">+</div>
    </div>`;
  },

  _renderQuickItems() {
    const itemsEl = document.getElementById('sb-quick-items');
    const addEl   = document.getElementById('sb-quick-add');
    if (!itemsEl) return;
    const quick  = this._getQuick();
    const prefix = this._getPrefix();
    let html = '';
    quick.forEach(id => {
      const item = this.coreNavItems.find(it => it.id === id);
      if (!item) return;
      const isActive = id === this.currentPage;
      html += `<a class="sb-quick-item${isActive ? ' active' : ''}" href="${escHtml(prefix + item.path)}" data-label="${escHtml(item.label)}" data-qid="${escHtml(id)}" title="${escHtml(item.label)}">${item.icon}</a>`;
    });
    itemsEl.innerHTML = html;
    if (addEl) {
      const isFull = quick.length >= this._SB_QUICK_MAX;
      addEl.classList.toggle('full', isFull);
      addEl.title = isFull
        ? `Quick Access เต็ม (สูงสุด ${this._SB_QUICK_MAX} รายการ)`
        : `กด ★ บน item ด้านล่างเพื่อเพิ่ม shortcut`;
    }
  },

  _toggleQuick(id) {
    let quick = this._getQuick();
    const idx     = quick.indexOf(id);
    const isAdding = idx < 0;
    if (isAdding) {
      if (quick.length >= this._SB_QUICK_MAX) {
        if (typeof showToast === 'function') showToast(`Quick Access เต็มแล้ว (สูงสุด ${this._SB_QUICK_MAX} รายการ)`, 'warn', 2200);
        return;
      }
      quick.push(id);
    } else {
      quick.splice(idx, 1);
    }
    this._saveQuick(quick);
    // Update all star buttons for this item
    document.querySelectorAll(`.nav-fav-star[data-item-id="${id}"]`).forEach(btn => {
      btn.classList.toggle('starred', isAdding);
      btn.title = isAdding ? 'ลบออกจาก Quick Access' : 'เพิ่มใน Quick Access';
    });
    this._renderQuickItems();
    if (typeof showToast === 'function') {
      showToast(isAdding ? 'เพิ่มใน Quick Access แล้ว' : 'นำออกจาก Quick Access แล้ว', 'success', 1800);
    }
  },

  _initQuickBar() {
    if (this._quickBarInited) return;
    this._quickBarInited = true;

    // ── Star toggle ───────────────────────────────────────
    document.addEventListener('click', e => {
      const star = e.target.closest('.nav-fav-star');
      if (!star) return;
      e.preventDefault(); e.stopPropagation();
      const id = star.dataset.itemId;
      if (id) this._toggleQuick(id);
    }, true);

    // ── Enterprise: inject real ⌘K search button ─────────
    // Replaces the old unclickable ::before pseudo-element
    if (!document.getElementById('_sb-ent-search') && document.getElementById('sidebar-nav')) {
      const btn = document.createElement('button');
      btn.id        = '_sb-ent-search';
      btn.className = 'sb-ent-search';
      btn.innerHTML = '<span>⌘&nbsp; Search…</span><span style="font-size:9px;opacity:.7">⌘K</span>';
      btn.onclick   = () => { if (typeof GlobalSearch !== 'undefined') GlobalSearch.open(); };
      const nav = document.getElementById('sidebar-nav');
      const pill = document.getElementById('nav-active-pill');
      // Insert after the pill div, before first nav-section
      const firstSection = nav.querySelector('.nav-section');
      if (firstSection) nav.insertBefore(btn, firstSection);
      else nav.appendChild(btn);
    }

    // ── Floating JS tooltip for quick items ──────────────
    // CSS ::after is clipped by overflow:auto; JS tooltip escapes to body
    let _tip = document.getElementById('_sb-qtip');
    if (!_tip) {
      _tip = document.createElement('div');
      _tip.id = '_sb-qtip';
      _tip.style.cssText = [
        'position:fixed;z-index:9999;pointer-events:none',
        'background:var(--bg-card,#fff);border:1px solid var(--border,#e5e5e5)',
        'color:var(--text,#111);font-size:9px;font-weight:600',
        'padding:4px 9px;border-radius:6px;white-space:nowrap',
        'box-shadow:0 4px 12px rgba(0,0,0,.15)',
        "font-family:'JetBrains Mono',monospace",
        'opacity:0;transition:opacity .1s;transform:translateX(-50%)',
        'top:0;left:0'
      ].join(';');
      document.body.appendChild(_tip);
    }
    document.addEventListener('mouseenter', e => {
      const t = e.target;
      if (!t || typeof t.closest !== 'function') return;
      const qi = t.closest('.sb-quick-item');
      if (!qi) return;
      const label = qi.dataset.label;
      if (!label) return;
      const r = qi.getBoundingClientRect();
      _tip.textContent   = label;
      _tip.style.left    = (r.left + r.width / 2) + 'px';
      _tip.style.top     = (r.bottom + 6) + 'px';
      _tip.style.opacity = '1';
    }, true);
    document.addEventListener('mouseleave', e => {
      const t = e.target;
      if (t && typeof t.closest === 'function' && t.closest('.sb-quick-item')) {
        _tip.style.opacity = '0';
      }
    }, true);
    document.addEventListener('click', e => {
      const t = e.target;
      if (t && typeof t.closest === 'function' && t.closest('.sb-quick-item')) {
        _tip.style.opacity = '0';
      }
    }, true);
  },
  // Guard: verify the current page is in the user's allowed-menus list.
  // Rules (in order):
  //   1. Static allow-list (login/profile/etc.) → allow
  //   2. Anything under /admin/ → allow (server-side requireAdmin handles it)
  //   3. Map sub-pages via perms.sub_pages (e.g. learn-course → learn)
  //   4. If effective slug isn't in perms.known_menus → allow (unmanaged page;
  //      matrix has no way to gate it, so fail-open to avoid false lockouts)
  //   5. Else require the slug in perms.allowed
  _checkPageAccess() {
    try {
      const slug = (typeof Auth !== 'undefined' && Auth._getPageSlug)
        ? Auth._getPageSlug()
        : ((window.location.pathname.split('/').pop() || 'index').replace('.html',''));
      const always = ['profile', 'change-password', 'index', 'login', 'reset-password', 'forgot-password', 'settings', 'about-som', 'dev-hub', ''];
      if (always.includes(slug)) return true;

      const inAdmin = /\/admin\//.test(window.location.pathname);
      if (inAdmin) return true;

      const perms = this._getMenuPerms();
      if (!perms) return true;

      const subMap = perms.sub_pages || {};
      const effective = subMap[slug] || slug;

      const known = perms.known_menus;
      if (Array.isArray(known) && !known.includes(effective)) return true;

      if (perms.allowed.includes(effective)) return true;

      if (typeof Auth !== 'undefined' && Auth._showNoAccessOverlay) {
        Auth._showNoAccessOverlay();
      }
      return false;
    } catch { return true; }
  },

  // Fire-and-forget refresh; on change vs cache, drop sidebar cache so next
  // page-load rebuilds. We don't re-render mid-session to avoid a flash.
  async _refreshMenuPerms() {
    try {
      if (!Auth.getToken()) return;
      const res = await API.menuPermissions.resolve();
      if (!res || !res.ok) return;
      const p = res.data?.data;
      if (!p || !Array.isArray(p.allowed)) return;
      const cached = this._getMenuPerms();
      const changed = !cached
        || cached.mode !== p.mode
        || cached.allowed.length !== p.allowed.length
        || cached.allowed.some((v, i) => v !== p.allowed[i]);
      this._saveMenuPerms(p);
      if (changed) {
        // Drop the sidebar HTML cache so next page-load rebuilds from scratch
        try { sessionStorage.removeItem('_sm_sb_html'); } catch {}
      }
    } catch {}
  },

  // ── Detect depth from project root ──────────────────────
  _getPrefix() {
    // Use absolute path derived from this script's own URL so that SPA navigation
    // across the admin/ boundary doesn't break links (e.g. navigating from
    // dashboard.html → admin/index.html via SPA leaves the old topnav in DOM;
    // relative ./dashboard.html then resolves against admin/ giving admin/dashboard.html).
    try {
      const me = Array.from(document.scripts)
        .find(s => /\/assets\/js\/layout\.js(\?|$)/.test(s.src));
      if (me) {
        const root = new URL(me.src).pathname.replace(/\/assets\/js\/layout\.js.*$/, '');
        return root + '/';
      }
    } catch {}
    // Fallback for eval'd context (e.g. if script tag isn't detectable)
    const inAdmin = /\/admin\//.test(window.location.pathname);
    return inAdmin ? '../' : './';
  },

  // ── Inbox unread badge polling ───────────────────────────
  _lastUnread: null,   // null = first fetch (seed baseline only, don't notify)

  _startInboxPoll() {
    const update = async () => {
      const badge   = document.getElementById('inbox-unread');
      const ddBadge = document.getElementById('inbox-unread-dd');
      if (!badge && !ddBadge) return;
      try {
        const res = await API.inbox.unreadCount();
        const n = res?.data?.data?.unread ?? 0;
        if (n > 0) {
          const txt = n > 99 ? '99+' : String(n);
          if (badge)   { badge.textContent   = txt; badge.style.display   = ''; }
          if (ddBadge) { ddBadge.textContent = txt; ddBadge.style.display = ''; }
        } else {
          if (badge)   { badge.style.display = 'none'; badge.classList.remove('pulse'); }
          if (ddBadge) { ddBadge.style.display = 'none'; }
        }
        // Notify only when count RISES between polls — first fetch just seeds baseline
        if (this._lastUnread !== null && n > this._lastUnread) {
          this._notifyNewMail(n - this._lastUnread, n);
          if (badge) {
            badge.classList.add('pulse');
            setTimeout(() => badge.classList.remove('pulse'), 6000);
          }
        }
        this._lastUnread = n;
        this._refreshGroupBadges();
      } catch {}
    };
    update();                                          // immediate first fetch (seeds baseline, no notify)
    _NATIVE_setInterval(() => { if (!document.hidden) update(); }, 60_000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) update(); });
  },

  // Aggregate per-item dropdown badges up to group-level buttons (dynamic — follows item moves)
  _refreshGroupBadges() {
    document.querySelectorAll('#topnav-wrap .tn-dd').forEach(dd => {
      const grpBadge = dd.querySelector('.tn-grp-badge');
      if (!grpBadge) return;
      let total = 0;
      dd.querySelectorAll('.tn-dd-badge').forEach(b => {
        if (b.style.display !== 'none') total += parseInt(b.textContent) || 0;
      });
      if (total > 0) {
        grpBadge.textContent = total > 99 ? '99+' : String(total);
        grpBadge.style.display = '';
      } else {
        grpBadge.style.display = 'none';
      }
    });
    // Showing or hiding a badge changes the group button's width, and the pill
    // behind the active button was measured before that — re-measure so it does
    // not sit narrower than its button and show as an orange sliver.
    this._positionTopNavPill(false);
  },

  // ── Inbox new-mail notification (desktop + sound) ────────
  // Prefs live per-device in localStorage; team isolation is inherited from the
  // backend endpoint (mail_config.json is team-scoped), so SM users only ever
  // hear the SM inbox — no client-side filtering needed.
  _inboxPref(key) {
    try { return localStorage.getItem('som_inbox_notify_' + key) === '1'; } catch { return false; }
  },

  _notifyNewMail(delta, total) {
    const wantDesktop = this._inboxPref('desktop');
    const wantSound   = this._inboxPref('sound');
    if (wantSound) this._playChime();
    if (wantDesktop && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        const title = delta === 1 ? 'มีอีเมลใหม่ 1 ฉบับ' : `มีอีเมลใหม่ ${delta} ฉบับ`;
        const n = new Notification(title, {
          body:   `Team Inbox: ยังไม่ได้อ่านทั้งหมด ${total} ฉบับ`,
          tag:    'som-inbox',                         // replace prior noti instead of stacking
          icon:   this._getPrefix() + 'assets/img/logo.png',
          silent: wantSound                            // avoid double-beep — we already chimed
        });
        n.onclick = () => {
          try { window.focus(); } catch {}
          window.location.href = this._getPrefix() + 'inbox.html';
          n.close();
        };
      } catch {}
    }
  },

  _playChime() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = this._audioCtx || (this._audioCtx = new Ctx());
      if (ctx.state === 'suspended') { try { ctx.resume(); } catch {} }
      const now = ctx.currentTime;
      // Two-tone chime: A5 → E6 (perfect fifth), soft envelope
      [[880, 0], [1318.5, 0.14]].forEach(([freq, offset]) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = freq;
        o.connect(g); g.connect(ctx.destination);
        const t0 = now + offset;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
        o.start(t0); o.stop(t0 + 0.38);
      });
    } catch {}
  },

  // ── Build one nav-item string ────────────────────────────
  _navItemHtml(href, icon, label, active = false, isExternal = false, tooltip = '', badgeId = '', locked = false, itemId = '') {
    const activeClass = active ? ' active' : '';
    const extAttrs    = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';
    const extDot      = isExternal
      ? '<span style="font-size:8px;color:var(--text-muted);opacity:.55;flex-shrink:0;margin-left:auto">↗</span>'
      : '';
    const badgeHtml   = badgeId
      ? `<span class="nav-badge" id="${badgeId}" style="display:none">0</span>`
      : '';
    const titleAttr   = tooltip ? ` title="${escHtml(tooltip)}"` : '';
    const starSvg     = '<svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
    const isStarred   = itemId ? this._isQuick(itemId) : false;
    const starHtml    = (itemId && !isExternal && !locked)
      ? `<button class="nav-fav-star${isStarred ? ' starred' : ''}" data-item-id="${escHtml(itemId)}" title="${isStarred ? 'ลบออกจาก Quick Access' : 'เพิ่มใน Quick Access'}">${starSvg}</button>`
      : '';
    if (locked) {
      return `<a class="nav-item nav-item-locked${activeClass}" href="${escHtml(href)}"${titleAttr} data-label="${escHtml(label)}">
        <span class="nav-icon" style="opacity:.5">${icon}</span>
        <span class="nav-label" style="opacity:.5">${escHtml(label)}</span>
        <span class="nav-lock-icon" title="ไม่มีสิทธิ์เข้าถึง">${typeof _ic === 'function' ? _ic('lock',10,10) : ''}</span>
      </a>`;
    }
    return `<a class="nav-item${activeClass}" href="${escHtml(href)}"${extAttrs}${titleAttr} data-label="${escHtml(label)}">
      <span class="nav-icon">${icon}</span>
      <span class="nav-label">${escHtml(label)}</span>
      ${badgeHtml}${extDot}${starHtml}
    </a>`;
  },

  _rendered: false,

  // Track what the FIRST (hard-loaded) page registers.
  // _spaNavigate() does its own cleanup+tracking for every later page, but the page
  // loaded normally never went through it — so its intervals/listeners were invisible
  // and survived the first navigation forever (dashboard.js kept polling loadStats()
  // and wrote to #feed-refreshed after that node was replaced).
  _trackFirstPage() {
    if (this._firstPageTracked) return;
    this._firstPageTracked = true;
    const _origSI = window.setInterval.bind(window);
    const _origST = window.setTimeout.bind(window);
    const _origDocAdd = document.addEventListener.bind(document);
    const _origWinAdd = window.addEventListener.bind(window);
    const L = [], WL = [], I = [];
    document.addEventListener = (type, fn, opts) => { L.push({ type, fn, opts });  _origDocAdd(type, fn, opts); };
    window.addEventListener   = (type, fn, opts) => { WL.push({ type, fn, opts }); _origWinAdd(type, fn, opts); };
    window.setInterval = (fn, ms, ...a) => { const id = _origSI(fn, ms, ...a); I.push(id); return id; };
    window.setTimeout  = (fn, ms, ...a) => { const id = _origST(fn, ms, ...a); I.push(id); return id; };
    this._pageListeners = L; this._pageWinListeners = WL; this._pageIntervals = I;
    // Restore the real functions once the page has finished initialising. Timers stay
    // patched a little longer so async inits that await before setInterval are caught.
    _origST(() => { document.addEventListener = _origDocAdd; window.addEventListener = _origWinAdd; }, 0);
    _origST(() => { window.setInterval = _origSI; window.setTimeout = _origST; }, 3000);
  },

  // ── Initial render (runs ONCE per page load) ─────────────
  async render(currentPage) {
    this.currentPage = currentPage;

    // Start recording this page's timers/listeners. Pages call Layout.render() at the
    // top of their own script, so anything they register afterwards is captured and
    // can be cancelled on the first SPA navigation away.
    this._trackFirstPage();

    // Apply page access mode (sets body[data-page-mode="read|full"] which drives
    // the [data-action="add|edit|delete|write"] CSS hide rules). super_viewer is
    // always 'read'; regular users get their team's per-page mode. Individual
    // pages don't need to call Auth.applyPageMode() themselves anymore.
    if (typeof Auth !== 'undefined' && Auth.applyPageMode) Auth.applyPageMode(currentPage);

    // super_viewer sidebar filter changed after v4 — force full rebuild so any
    // stale "warm restore" HTML (captured before the filter existed) is dropped.
    if (Auth?.getUser?.()?.role === 'super_viewer') {
      try { sessionStorage.removeItem('_sm_sb_html'); } catch {}
    }

    // Start presence heartbeat (fire-and-forget). Powers the Office 3D room-per-page view.
    this._startPresenceHeartbeat(currentPage);

    // Start deploy-detection watcher (silently polls /api/version.php
    // and shows a "reload for updates" toast when we ship new code).
    this._startVersionWatcher();

    if (this._rendered) {
      this.updateUserInfo();
      return;
    }
    this._rendered = true;

    // ── Apply nav-style attribute (redundant safety if theme.js missed it) ──
    const _navStyle = this._getNavStyle();
    if (_navStyle) {
      document.documentElement.setAttribute('data-nav-style', _navStyle);
    } else {
      document.documentElement.removeAttribute('data-nav-style');
    }

    // Inject page loader overlay (visible while content loads)
    this._injectPageLoader();

    // ── Menu-perm gate — Option A+B ──────────────────────────
    // A: Block sidebar build on first visit so the filter is applied to the
    //    very first paint (no "flash of all menus").
    // B: Once perms are known, verify the current page is allowed — if not,
    //    show the No Access overlay before rendering anything else.
    // Both are cache-first: if we already have perms, no network round-trip.
    if (typeof Auth !== 'undefined' && Auth.getToken() && !this._getMenuPerms()) {
      try { await this._refreshMenuPerms(); } catch {}
    }
    if (!this._checkPageAccess()) {
      // No Access overlay is up; do not build sidebar / topbar.
      return;
    }

    // Load custom nav-group config (sessionStorage-cached; API-fetched on miss)
    if (typeof Auth !== 'undefined' && Auth.getToken()) {
      try { await this._loadNavGroupsCache(); } catch {}
    }

    // Trigger enter animation: CSS hid .main-content via html[data-entering].
    // Set transition then remove attribute → browser animates opacity+translateY to natural state.
    const _mc = document.querySelector('.main-content');
    if (_mc && document.documentElement.hasAttribute('data-entering')) {
      _mc.style.transition = 'opacity 0.3s ease, transform 0.32s cubic-bezier(.22,.68,0,1.08)';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        // Loader is a quick flash: hide as soon as shell is rendered.
        // Data-waiting is handled by skeletons (skeletons.js) placed in the
        // page's own markup. Pages that must keep the loader visible longer
        // can call Layout.holdLoader() before render() and Layout.ready() when done.
        this._hidePageLoader();
        setTimeout(() => { if (_mc) _mc.style.transition = ''; }, 400);
      }));
    } else {
      this._hidePageLoader();
    }

    // Inject dev-badge.css globally (once per page)
    if (!document.getElementById('dev-badge-css')) {
      const s    = document.querySelector('script[src*="layout.js"]');
      const base = s ? s.src.replace(/assets\/js\/layout\.js.*$/, '') : '/';
      const link = document.createElement('link');
      link.id   = 'dev-badge-css';
      link.rel  = 'stylesheet';
      link.href = base + 'assets/css/dev-badge.css';
      document.head.appendChild(link);
    }

    // 1. If sidebar was pre-restored from sessionStorage cache (by inline script),
    //    skip full rebuild — just wire interactivity and fix active state.
    // ── TOP NAV MODE: inject navbar and skip/hide sidebar ──────────────────
    if (_navStyle) {
      // Inject topnav if not already present
      if (!document.getElementById('topnav-wrap')) {
        const tnEl = this._buildTopNav(_navStyle);
        const appShell = document.querySelector('.app-shell') || document.body;
        const mainContent = appShell.querySelector('.main-content');
        if (mainContent) {
          appShell.insertBefore(tnEl, mainContent);
        } else {
          appShell.prepend(tnEl);
        }
      }
      this._initTopNavDropdowns();
      // Update topnav bell badge if inbox watcher is running
      this._syncTopNavBell?.();
      // Proceed with standard post-render init (auth, tools, etc.) but skip sidebar
      // If warm restore exists, it's already hidden by CSS data-nav-style
      this._injectTopbarExtras();
      this._renderTeamSwitcher();
      if (typeof Auth !== 'undefined' && Auth.getToken()) Auth.startExpiryWatcher();
      this._refreshMenuPerms();
      this._loadSvConfig();
      if (typeof Auth !== 'undefined' && Auth.refreshTeamFeatures) {
        Auth.refreshTeamFeatures().then(changed => { if (changed) window.location.reload(); });
        _NATIVE_setInterval(async () => { if (await Auth.refreshTeamFeatures()) window.location.reload(); }, 15000);
      }
      const _cachedTN = this._readCache();
      if (_cachedTN) this._injectDynamicSections(_cachedTN);
      try {
        const _resTN = await API.sidebarTools.list();
        const _toolsTN = _resTN?.ok ? (_resTN.data.data || []) : null;
        if (_toolsTN) { this._writeCache(_toolsTN); this._injectDynamicSections(_toolsTN); }
      } catch {}
      this._startPostRestoreInit?.();
      // ── Wire SPA navigation for topnav clicks (must run in topnav mode too) ──
      this._initNavTransition();
      return;
    }

    if (document.getElementById('sidebar')) {
      // Inject quick bar if not in cached HTML (first load after feature added)
      if (!document.getElementById('sb-quick-bar')) {
        const logoEl = document.querySelector('#sidebar .sidebar-logo');
        if (logoEl) logoEl.insertAdjacentHTML('afterend', this._buildQuickBar());
      }
      this._fixActiveItem(currentPage);
      this.updateUserInfo();
      this._initSidebarState();
      this._positionActivePill(false);
      this._initCollapsedTooltip();
      const _tb2 = document.getElementById('theme-toggle-btn');
      if (_tb2 && typeof Theme !== 'undefined' && Theme.current() === 'dark') _tb2.classList.add('dark-active');
      this._initNavTransition();
      this._initQuickBar();
      this._injectTopbarExtras();
      // Team switcher must render independently of .topbar-actions presence.
      this._renderTeamSwitcher();
      if (typeof Auth !== 'undefined' && Auth.getToken()) Auth.startExpiryWatcher();
      // Background refresh of menu permissions — will invalidate sidebar cache
      // if the resolved list changed, so next page-load re-renders correctly.
      this._refreshMenuPerms();
      // Background check: team features may have changed (e.g. feature approved)
      if (typeof Auth !== 'undefined' && Auth.refreshTeamFeatures) {
        Auth.refreshTeamFeatures().then(changed => { if (changed) window.location.reload(); });
      }
      const cached2 = this._readCache();
      if (cached2) { this._injectDynamicSections(cached2); this._positionActivePill(false); }
      try {
        const res2 = await API.sidebarTools.list();
        const t2   = res2?.ok ? (res2.data.data || []) : null;
        if (t2) { this._writeCache(t2); this._injectDynamicSections(t2); this._positionActivePill(false); }
      } catch {}
      this._startPostRestoreInit();
      // Inject Tummeng AI on restored-sidebar path too
      if (!document.getElementById('tm-ai-script')) {
        const _sr    = document.querySelector('script[src*="layout.js"]');
        const _baser = _sr ? _sr.src.replace(/assets\/js\/layout\.js.*$/, '') : './';
        const _air   = document.createElement('script');
        _air.id  = 'tm-ai-script';
        _air.src = _baser + 'assets/js/ai-chat.js?v=20260724';
        document.head.appendChild(_air);
      }
      return;
    }

    // 1. Build sidebar skeleton once (cold start — no sessionStorage cache yet)
    const sidebar = this._buildCoreSidebar();
    document.getElementById('sidebar-mount')?.replaceWith(sidebar);
    this._initSidebarState();
    this._positionActivePill(false);
    this._initCollapsedTooltip();

    // Sync pill toggle state after sidebar renders
    const _tb = document.getElementById('theme-toggle-btn');
    if (_tb && typeof Theme !== 'undefined' && Theme.current() === 'dark') _tb.classList.add('dark-active');

    // 1a. Intercept nav-item clicks: fade out content, then navigate
    //     (makes sidebar/topbar feel persistent across pages)
    this._initNavTransition();
    this._initQuickBar();

    // 1b. Inject topbar extras (notification bell + global search)
    this._injectTopbarExtras();
    // 1b'. Team switcher — independent of .topbar-actions (some pages omit it,
    //      e.g. learn.html — but super_admin/super_viewer still need to switch).
    this._renderTeamSwitcher();

    // 1c. Start session expiry watcher
    if (typeof Auth !== 'undefined' && Auth.getToken()) Auth.startExpiryWatcher();

    // 1d. Background refresh of role-based menu permissions
    this._refreshMenuPerms();

    // 1e. Background check: did team features change since last login?
    //     If yes, update localStorage + reload so sidebar reflects new features.
    if (typeof Auth !== 'undefined' && Auth.refreshTeamFeatures) {
      Auth.refreshTeamFeatures().then(changed => {
        if (changed) window.location.reload();
      });
      // Periodic poll every 15s — catches feature changes while user stays on same page
      _NATIVE_setInterval(async () => {
        const changed = await Auth.refreshTeamFeatures();
        if (changed) window.location.reload();
      }, 15000);
      // Also fire when user returns to the tab
      document.addEventListener('visibilitychange', async () => {
        if (document.hidden) return;
        if (await Auth.refreshTeamFeatures()) window.location.reload();
      });
    }

    // 2. Inject dynamic tools — from cache first (instant), then refresh
    const cached = this._readCache();
    if (cached) { this._injectDynamicSections(cached); this._positionActivePill(false); }

    try {
      const res   = await API.sidebarTools.list();
      const tools = res?.ok ? (res.data.data || []) : null;
      if (tools) {
        this._writeCache(tools);
        this._injectDynamicSections(tools);
        this._positionActivePill(false); // reposition after dynamic sections rendered
      }
    } catch (e) {
      console.warn('[layout] Failed to load sidebar tools:', e);
    }

    // 4. Start scheduled notification watcher (loaded dynamically — no per-page script tag needed)
    const _notiPrefix = /\/admin\//.test(window.location.pathname) ? '../' : './';
    if (!document.getElementById('snoti-script')) {
      const _ns = document.createElement('script');
      _ns.id  = 'snoti-script';
      _ns.src = _notiPrefix + 'assets/js/noti-scheduler.js?v=20260820-alerts';
      _ns.onload = () => {
        if (typeof NotiScheduler          !== 'undefined') NotiScheduler.init();
        if (typeof PWAlert                !== 'undefined') PWAlert.init();
        if (typeof SyncupScheduler        !== 'undefined') SyncupScheduler.init();
        if (typeof RestartFetchScheduler  !== 'undefined') RestartFetchScheduler.init();
        if (typeof BatchMonitorWatcher    !== 'undefined') BatchMonitorWatcher.init();
        if (typeof AlertsWatcher          !== 'undefined') AlertsWatcher.init();
      };
      document.head.appendChild(_ns);
    } else if (typeof NotiScheduler !== 'undefined') {
      NotiScheduler.init();
      if (typeof PWAlert                !== 'undefined') PWAlert.init();
      if (typeof SyncupScheduler        !== 'undefined') SyncupScheduler.init();
      if (typeof RestartFetchScheduler  !== 'undefined') RestartFetchScheduler.init();
      if (typeof BatchMonitorWatcher    !== 'undefined') BatchMonitorWatcher.init();
      if (typeof AlertsWatcher          !== 'undefined') AlertsWatcher.init();
    }

    // 4b. Start unread inbox poll (badge in sidebar)
    this._startInboxPoll();

    // 5. Inject Dev Toolbar for dev_sm (loaded once, patches API.request automatically)
    if (Auth.getUser()?.role === 'dev_sm' && !document.getElementById('dev-toolbar-script')) {
      const _s    = document.querySelector('script[src*="layout.js"]');
      const _base = _s ? _s.src.replace(/assets\/js\/layout\.js.*$/, '') : './';
      const _dt   = document.createElement('script');
      _dt.id  = 'dev-toolbar-script';
      _dt.src = _base + 'assets/js/dev-toolbar.js';
      document.head.appendChild(_dt);
    }

    // 6. Inject Tummeng AI chat bubble (all authenticated users)
    if (!document.getElementById('tm-ai-script')) {
      const _s2    = document.querySelector('script[src*="layout.js"]');
      const _base2 = _s2 ? _s2.src.replace(/assets\/js\/layout\.js.*$/, '') : './';
      const _ai    = document.createElement('script');
      _ai.id  = 'tm-ai-script';
      _ai.src = _base2 + 'assets/js/ai-chat.js?v=20260724';
      document.head.appendChild(_ai);
    }

    // 7. Auto-backup every 7 days for admins (fire-and-forget, server stores zip)
    const _bkUser = Auth.getUser();
    if (['sm_admin', 'dev_sm'].includes(_bkUser?.role)) {
      const BK_KEY   = 'bk_last_auto';
      const _bkLast  = parseInt(localStorage.getItem(BK_KEY) || '0');
      const _bkDiff  = Date.now() - _bkLast;
      if (_bkDiff > 7 * 24 * 60 * 60 * 1000) {
        API.backup.create().then(res => {
          if (res?.ok) {
            localStorage.setItem(BK_KEY, Date.now().toString());
            console.log('[backup] Auto-backup created:', res.data?.data?.file);
          }
        }).catch(() => {});
      }

    }
  },

  // ── Admin Status Bar ─────────────────────────────────────
  _injectAdminStatusBar() {
    const main = document.querySelector('.page-content');
    if (!main) return;

    const bar = document.createElement('div');
    bar.id        = 'admin-status-bar';
    bar.className = 'status-bar';
    bar.style.cssText = 'margin-bottom:12px;flex-shrink:0';
    bar.innerHTML = `
      <div class="sb-item" id="asb-jira">
        <span class="sb-dot loading"></span><span class="sb-lbl">JIRA</span><span class="sb-val">...</span>
      </div>
      <div class="sb-item" id="asb-smtp">
        <span class="sb-dot loading"></span><span class="sb-lbl">SMTP</span><span class="sb-val">...</span>
      </div>
      <span id="asb-jenkins-group" style="display:contents">
        <div class="sb-item"><span class="sb-dot loading"></span><span class="sb-lbl">JENKINS</span><span class="sb-val">...</span></div>
      </span>
      <div class="sb-item">
        <span class="sb-dot ok"></span><span class="sb-lbl">SYSTEM</span><span class="sb-val">OK</span>
      </div>
      <span class="sb-clock" id="asb-clock"></span>`;

    main.insertBefore(bar, main.firstChild);

    // Live clock
    const _tick = () => {
      const el = document.getElementById('asb-clock');
      if (el) el.textContent = new Date().toLocaleTimeString('th-TH', {hour:'2-digit', minute:'2-digit', second:'2-digit'});
    };
    _tick();
    _NATIVE_setInterval(_tick, 1000);

    // Fetch health
    this._loadAdminStatusBar();
  },

  async _loadAdminStatusBar() {
    const res = await API.health.check().catch(() => null);
    if (!res?.ok) return;
    const svcs = res.data.data?.services || {};

    const _setItem = (id, dotCls, val) => {
      const el = document.getElementById(id);
      if (!el) return;
      const d = el.querySelector('.sb-dot');
      const v = el.querySelector('.sb-val');
      if (d) d.className = 'sb-dot ' + dotCls;
      if (v) v.textContent = val;
    };
    const _dc = s => s === 'ok' ? 'ok' : s === 'timeout' ? 'warn' : s === 'not_configured' ? 'nc' : 'error';

    // Jira
    const j = svcs.jira || {};
    _setItem('asb-jira', _dc(j.status),
      j.status === 'ok' ? `${j.latency_ms}ms` : j.status === 'not_configured' ? 'N/A' : 'Error');

    // SMTP
    const s = svcs.smtp || {};
    _setItem('asb-smtp', _dc(s.status),
      s.status === 'ok' ? 'Configured' : 'N/A');

    // Jenkins — one pill per server
    const jkGroup = document.getElementById('asb-jenkins-group');
    if (jkGroup) {
      const jk = Array.isArray(svcs.jenkins) ? svcs.jenkins : [];
      if (!jk.length) {
        jkGroup.innerHTML = `<div class="sb-item"><span class="sb-dot nc"></span><span class="sb-lbl">JENKINS</span><span class="sb-val">N/A</span></div>`;
      } else {
        jkGroup.innerHTML = jk.map(srv => {
          const dc  = _dc(srv.status);
          const val = srv.status === 'ok' ? `${srv.latency_ms}ms` : srv.status === 'timeout' ? 'timeout' : 'err';
          const lbl = (srv.display || srv.id || 'Jenkins').toUpperCase().slice(0, 16);
          const nm  = typeof escHtml === 'function' ? escHtml(lbl) : lbl.replace(/</g,'&lt;');
          return `<div class="sb-item"><span class="sb-dot ${dc}"></span><span class="sb-lbl">${nm}</span><span class="sb-val">${val}</span></div>`;
        }).join('');
      }
    }
  },

  // ── Fix active nav item to match current page (after pre-restore) ──
  _fixActiveItem(currentPage) {
    document.querySelectorAll('#sidebar .nav-item').forEach(a => {
      const href     = a.getAttribute('href') || '';
      const pageFile = href.split('/').pop().replace(/\.html.*$/, '');
      a.classList.toggle('active', pageFile === currentPage);
    });
    // Fix quick bar active state (qid matches page id directly)
    document.querySelectorAll('.sb-quick-item').forEach(a => {
      a.classList.toggle('active', (a.dataset.qid || '') === currentPage);
    });
    // Clear the stored next-page hint
    try { sessionStorage.removeItem('_sm_sb_next'); } catch {}
  },

  // ── Post-restore: wire up the non-sidebar page-level features ──
  _startPostRestoreInit() {
    this._startInboxPoll();
    const _notiPrefix = /\/admin\//.test(window.location.pathname) ? '../' : './';
    if (!document.getElementById('snoti-script')) {
      const _ns = document.createElement('script');
      _ns.id  = 'snoti-script';
      _ns.src = _notiPrefix + 'assets/js/noti-scheduler.js?v=20260820-alerts';
      _ns.onload = () => {
        if (typeof NotiScheduler         !== 'undefined') NotiScheduler.init();
        if (typeof PWAlert               !== 'undefined') PWAlert.init();
        if (typeof SyncupScheduler       !== 'undefined') SyncupScheduler.init();
        if (typeof RestartFetchScheduler !== 'undefined') RestartFetchScheduler.init();
        if (typeof BatchMonitorWatcher   !== 'undefined') BatchMonitorWatcher.init();
        if (typeof AlertsWatcher         !== 'undefined') AlertsWatcher.init();
      };
      document.head.appendChild(_ns);
    } else if (typeof NotiScheduler !== 'undefined') {
      NotiScheduler.init();
      if (typeof PWAlert               !== 'undefined') PWAlert.init();
      if (typeof SyncupScheduler       !== 'undefined') SyncupScheduler.init();
      if (typeof RestartFetchScheduler !== 'undefined') RestartFetchScheduler.init();
      if (typeof BatchMonitorWatcher   !== 'undefined') BatchMonitorWatcher.init();
      if (typeof AlertsWatcher         !== 'undefined') AlertsWatcher.init();
    }
    const _bkUser = Auth.getUser();
    if (['sm_admin', 'dev_sm'].includes(_bkUser?.role)) {
      const BK_KEY  = 'bk_last_auto';
      const _bkLast = parseInt(localStorage.getItem(BK_KEY) || '0');
      if (Date.now() - _bkLast > 7 * 24 * 60 * 60 * 1000) {
        API.backup.create().then(res => {
          if (res?.ok) { localStorage.setItem(BK_KEY, Date.now().toString()); }
        }).catch(() => {});
      }
    }
  },

  // ── Update only the user name/avatar in sidebar footer ───
  updateUserInfo() {
    const user = Auth.getUser();
    if (!user) return;
    const avatarEl = document.getElementById('user-avatar');
    const nameEl   = document.querySelector('.sidebar-footer .user-name');
    const roleEl   = document.querySelector('.sidebar-footer .user-role');
    if (nameEl) nameEl.textContent = user.name || '';
    if (roleEl) {
      roleEl.className = 'user-role ' + Roles.badgeClass(user.role || '');
      roleEl.textContent = Roles.label(user.role || '');
    }
    if (avatarEl) {
      const url = user.avatar_url || '';
      if (url) {
        avatarEl.innerHTML = `<img src="${escHtml(url)}" alt="avatar" onerror="this.parentElement.textContent='${getInitials(user.name || '?')}'">`;
      } else {
        avatarEl.innerHTML = '';
        avatarEl.textContent = getInitials(user.name || '?');
      }
    }
  },

  // ── Nav click: SPA swap (navbar stays in DOM — never reloads) ──
  _initNavTransition() {
    if (this._navTransitionBound) return;
    this._navTransitionBound = true;

    // Back/forward support
    history.replaceState({ spaPath: window.location.href, pageId: this.currentPage }, document.title, window.location.href);
    window.addEventListener('popstate', e => {
      if (e.state?.spaPath) this._spaNavigate(e.state.spaPath, true);
    });

    document.addEventListener('click', e => {
      // Intercept sidebar nav items AND topnav dropdown/ctx-tab items
      const link = e.target.closest('a.nav-item, a.sb-quick-item, a.tn-dd-item, a.tn-ctx-tab');
      if (!link || !link.href || link.target === '_blank') return;

      // Locked items: show toast, never navigate
      if (link.classList.contains('nav-item-locked') || link.classList.contains('tn-dd-item-locked')) {
        e.preventDefault();
        if (typeof showToast === 'function') showToast('ไม่มีสิทธิ์เข้าถึงเมนูนี้ — ติดต่อผู้ดูแลระบบ', 'error', 2500);
        return;
      }

      const dest = link.href;
      const destUrl = new URL(dest, window.location.href);
      const curUrl  = new URL(window.location.href);
      if (destUrl.pathname === curUrl.pathname) { e.preventDefault(); return; }
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      e.preventDefault();

      const destId = destUrl.pathname.split('/').pop().replace(/\.html$/, '');
      const isSidebarLink = link.matches('a.nav-item, a.sb-quick-item');

      if (isSidebarLink) {
        // Slide sidebar pill and toggle active immediately
        this._slidePillTo(link);
        document.querySelectorAll('#sidebar .nav-item.active').forEach(a => a.classList.remove('active'));
        link.classList.add('active');
        document.querySelectorAll('.sb-quick-item').forEach(a => {
          a.classList.toggle('active', (a.dataset.qid || '') === destId);
        });
        // Keep sessionStorage in sync (fallback for hard reload / external links)
        try {
          const sb = document.getElementById('sidebar');
          if (sb) sessionStorage.setItem('_sm_sb_html', sb.outerHTML);
          sessionStorage.setItem('_sm_sb_next', destId);
          const _label = link.dataset.label || link.querySelector('.nav-label')?.textContent?.trim() || '';
          sessionStorage.setItem('_sm_sb_next_label', _label);
        } catch {}
      } else {
        // Topnav: close the dropdown the user just picked from.
        // The menu is opened purely by CSS (.tn-dd:hover > .tn-dd-menu) with no JS
        // state, and after an SPA swap the pointer still sits where the menu was —
        // :hover stays true, so the panel hangs over the new page until the mouse
        // moves. Force it shut with a class instead.
        // (This used to target '.tn-dd-wrap', a class that does not exist in this
        // markup, so it silently closed nothing.)
        this._suppressDdHover(link.closest('.tn-dd'));
      }

      // SPA fetch+swap — nav stays in DOM
      this._spaNavigate(dest);
    }, { capture: true });
  },

  // ── SPA navigation: fetch new page, swap .main-content, no sidebar flash ──
  _spaNavigating: false,
  _spaNextDest: null,   // queued destination when a nav arrives mid-flight

  async _spaNavigate(dest, isPopState = false) {
    if (this._spaNavigating) {
      // Don't drop the click — remember the latest destination and navigate
      // to it once the current navigation finishes.
      this._spaNextDest = { dest, isPopState };
      return;
    }

    // Revisit detection: if this page has been SPA-visited before in this session,
    // do a full reload so page init functions (load(), init()) always run fresh.
    // First visit: SPA (fast). Revisit: full reload (correct data, no async conflicts).
    if (!isPopState) {
      if (!this._spaVisited) {
        this._spaVisited = new Set();
        // Seed with the initial full-load page so navigating back to it also
        // triggers a full reload (prevents double-running its init script via eval).
        try { this._spaVisited.add(new URL(window.location.href).pathname); } catch {}
      }
      const _destPath = (() => { try { return new URL(dest, location.origin).pathname; } catch { return dest; } })();
      if (this._spaVisited.has(_destPath)) {
        window.location.href = dest;
        return;
      }
      this._spaVisited.add(_destPath);
    }

    this._spaNavigating = true;

    const mc = document.querySelector('.main-content');

    try {
      // ① Fetch new page immediately (parallel with exit animation)
      const fetchPromise = fetch(dest, { credentials: 'same-origin' });

      // ② Animate content out (navbar is untouched)
      if (mc) {
        mc.style.transition    = 'opacity .18s ease, transform .18s ease';
        mc.style.opacity       = '0';
        mc.style.transform     = 'translateY(-8px)';
        mc.style.pointerEvents = 'none';
      }

      // ③ Await page HTML + animation
      const resp = await fetchPromise;
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const html = await resp.text();
      await new Promise(r => setTimeout(r, 190));

      // ④ Parse
      const parser = new DOMParser();
      const doc    = parser.parseFromString(html, 'text/html');
      const newMC  = doc.querySelector('.main-content');
      if (!newMC) throw new Error('no .main-content');

      // ⑤ Replace page-specific <style> blocks
      document.querySelectorAll('style[data-spa-page]').forEach(s => s.remove());
      doc.head.querySelectorAll('style').forEach((style, i) => {
        const s = document.createElement('style');
        s.setAttribute('data-spa-page', String(i));
        s.textContent = style.textContent;
        document.head.appendChild(s);
      });

      // ⑥ Swap .main-content FIRST so that page-specific external scripts
      //    loaded in step ⑦ find the correct DOM when they auto-init.
      //    (Previously scripts loaded before swap, causing external page-init
      //    functions like WeeklyReportDashboard to run against the old DOM.)
      if (mc) {
        // Replace inline styles from the new page (e.g. sheets.html sets height:100vh
        // so its iframe children can fill the remaining viewport via flex:1).
        // Using setAttribute replaces the whole style string so previous-page
        // page-specific rules (like height:100vh) don't bleed into the next page.
        mc.setAttribute('style', newMC.getAttribute('style') || '');
        // Overlay the enter-animation state on top of the new page's base styles.
        mc.style.transition = '';
        mc.style.opacity    = '0';
        mc.style.transform  = 'translateY(14px)';
        mc.style.pointerEvents = '';
        mc.innerHTML = newMC.innerHTML;
      }

      // ⑦ Inject page extras outside .main-content (modals, overlays, drawers).
      //    MUST run BEFORE the page's external scripts load: a page script binds to
      //    its modals on first execution (e.g. jira-templates.js reads
      //    #btn-close-tpl-modal), and those live outside .main-content so the swap in
      //    step ⑥ does not bring them in. Loading scripts first left them null and
      //    threw, aborting the rest of that page's init.
      document.querySelectorAll('[data-spa-extra]').forEach(el => el.remove());
      const _keepIds = new Set(['topnav-wrap','gs-overlay','page-loader','_tsw-pill','_sb-qtip']);
      for (const child of Array.from(doc.body.children)) {
        if (child.matches?.('.app-shell')) continue;
        if (child.tagName === 'SCRIPT') continue;
        if (_keepIds.has(child.id)) continue;
        if (child.id?.startsWith('_tm-') || child.id?.startsWith('_tb-')) continue;
        const imp = document.importNode(child, true);
        imp.setAttribute('data-spa-extra', '1');
        document.body.appendChild(imp);
      }

      // ⑦b Clean up the previous page, then start tracking this one.
      //     MUST run before the external page scripts in step ⑧: a page whose code
      //     was extracted to assets/pages/<page>/ registers its intervals, listeners
      //     and fetches while THAT script runs. Starting tracking afterwards (as this
      //     used to, from step ⑪) recorded nothing for those pages, so their timers
      //     survived every navigation, kept polling APIs and eventually wrote to DOM
      //     nodes the next page had already replaced.
      if (!this._execHashes)      this._execHashes      = new Set();
      if (!this._pageListeners)   this._pageListeners   = [];
      if (!this._pageWinListeners) this._pageWinListeners = [];
      if (!this._pageIntervals)   this._pageIntervals   = [];

      // ── Cleanup previous page's registered handlers ──────────────
      // Force-close any pending deferred restore from the prior navigation window
      // so its overrides don't linger while we set up new ones.
      if (this._spaRestoreTimer) { clearTimeout(this._spaRestoreTimer); this._spaRestoreTimer = null; }
      if (this._spaRestoreFn)   { this._spaRestoreFn(); this._spaRestoreFn = null; }

      this._pageListeners.forEach(({ type, fn, opts }) => {
        try { document.removeEventListener(type, fn, opts); } catch {}
      });
      this._pageListeners = [];
      // Also remove window-level listeners registered by the previous page's scripts.
      // Without this, handlers like window.resize in monitoring.html survive
      // navigation and crash when they access page-specific DOM elements (now null).
      this._pageWinListeners.forEach(({ type, fn, opts }) => {
        try { window.removeEventListener(type, fn, opts); } catch {}
      });
      this._pageWinListeners = [];
      this._pageIntervals.forEach(id => { try { clearInterval(id); clearTimeout(id); } catch {} });
      this._pageIntervals = [];
      // Reset body inline styles that page scripts may have set (e.g. overflow:hidden to
      // lock scroll while a modal is open). If the user navigates while a modal is open,
      // the close-handler never runs and these styles persist into the next page, causing
      // the scrollbar to disappear and content to appear stretched edge-to-edge.
      document.body.style.overflow = '';
      // Suppress toasts during the navigation transition so that aborted API
      // calls from the previous page don't show stale error messages on the
      // new page. The flag is cleared after the new page's scripts have run
      // (restored below together with window.fetch/document.addEventListener).
      window._spaNavigating = true;
      // Abort any in-flight fetch requests from the previous page
      if (this._pageAbortCtrl) { try { this._pageAbortCtrl.abort(); } catch {} }
      this._pageAbortCtrl = new AbortController();

      // ── Temporarily intercept to track what page scripts register ──
      // document.addEventListener + window.addEventListener: restored immediately.
      // setInterval / setTimeout / fetch stay overridden for 3 s so that async
      // page inits (e.g. pw-schedule init() awaiting refresh() before setInterval)
      // are still captured and will be cancelled on the NEXT navigation.
      const _origDocAdd = document.addEventListener.bind(document);
      const _origWinAdd = window.addEventListener.bind(window);
      const _origSI     = window.setInterval.bind(window);
      const _origST     = window.setTimeout.bind(window);
      const _origFetch  = window.fetch.bind(window);
      const _newL = [], _newWL = [], _newI = [];
      const _ctrl = this._pageAbortCtrl;
      // SPA navigation happens long after DOMContentLoaded has fired, so a page
      // script that defers its init with addEventListener('DOMContentLoaded', ...)
      // would never run at all (its buttons stay hidden, its data never loads).
      // Replay such a registration immediately instead — the same contract as the
      // `readyState === 'loading' ? addEventListener(...) : init()` guard that
      // page scripts already use. Nothing is recorded for cleanup because no real
      // listener was registered.
      const _replayIfLoaded = (type, fn) => {
        if (type !== 'DOMContentLoaded' || document.readyState === 'loading') return false;
        const cb = typeof fn === 'function'
          ? fn
          : (fn && typeof fn.handleEvent === 'function' ? () => fn.handleEvent(new Event(type)) : null);
        if (!cb) return false;
        _origST(() => {
          try { cb(new Event(type)); }
          catch (err) { console.error('[spa] deferred init failed:', err); }
        }, 0);
        return true;
      };
      document.addEventListener = (type, fn, opts) => {
        if (_replayIfLoaded(type, fn)) return;
        _newL.push({ type, fn, opts }); _origDocAdd(type, fn, opts);
      };
      window.addEventListener   = (type, fn, opts) => {
        if (_replayIfLoaded(type, fn)) return;
        _newWL.push({ type, fn, opts }); _origWinAdd(type, fn, opts);
      };
      window.setInterval = (fn, ms, ...a) => { const id = _origSI(fn, ms, ...a); _newI.push(id); return id; };
      window.setTimeout  = (fn, ms, ...a) => { const id = _origST(fn, ms, ...a); _newI.push(id); return id; };
      window.fetch = (url, opts = {}) => {
        if (!opts.signal) opts = { ...opts, signal: _ctrl.signal };
        return _origFetch(url, opts);
      };


      // ⑧ Load new external scripts (normalize URL to ignore ?v= cache-busters)
      //    Content (step ⑥) and page extras (step ⑦) are both in place, so any
      //    auto-init in these scripts can safely query the DOM.
      const _normSrc = (src) => { try { return new URL(src).pathname; } catch { return src; } };
      // Persistent set seeded once from document.scripts, then accumulated across navs.
      // Rebuilding from document.scripts each time has edge-case timing gaps where
      // previously-loaded core scripts are missed, causing SyntaxError re-declarations.
      if (!this._loadedScripts) {
        this._loadedScripts = new Set(
          Array.from(document.scripts).map(s => s.src ? _normSrc(s.src) : null).filter(Boolean)
        );
      }
      const loadedPaths = this._loadedScripts;

      // NOTE: no DOMContentLoaded shim is needed here. Step ⑦b already replaced
      //       document/window.addEventListener with the tracking version, which both
      //       records what this page registers AND replays a DOMContentLoaded
      //       registration immediately (the event fired long ago). Installing a second
      //       shim here used to overwrite that one and restore a non-tracking version
      //       afterwards, so an extracted page's listeners were never cancelled.
      // An importmap must exist BEFORE any module that resolves bare specifiers
      // through it ("three" -> the CDN URL). Browsers only honour an importmap added
      // before the first module load, so inject it here, ahead of the script loop.
      for (const im of doc.querySelectorAll('script[type="importmap"]')) {
        if (document.querySelector('script[type="importmap"][data-spa-importmap]')) break;
        const el = document.createElement('script');
        el.type = 'importmap';
        el.textContent = im.textContent || '';
        el.setAttribute('data-spa-importmap', '');
        document.head.appendChild(el);
      }

      for (const script of doc.querySelectorAll('script[src]')) {
        // Use getAttribute (raw value) not .src (property) — DOMParser resolves .src
        // relative to about:blank which strips the deployment base path (/SOM-Portal/)
        const srcAttr = script.getAttribute('src') || '';
        if (!srcAttr) continue;
        const abs  = new URL(srcAttr, dest).href;
        const path = _normSrc(abs);
        if (!loadedPaths.has(path)) {
          await new Promise((res, rej) => {
            const el = document.createElement('script');
            // Preserve type: a module must stay a module, otherwise its import
            // statements are a syntax error and the page silently fails to init.
            const _t = script.getAttribute('type');
            if (_t) el.type = _t;
            el.src = abs; el.onload = res; el.onerror = rej;
            document.head.appendChild(el);
          }).catch(() => {});
          loadedPaths.add(path);
        }
      }

      // ⑧a Load page-specific external CSS sheets (additive — each page's CSS uses unique
      //    class prefixes so sheets from different pages don't conflict; browser caches them).
      //    <link rel="stylesheet" data-page-css href="..."> marks page-specific sheets.
      const _loadedHrefs = new Set(
        Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(l => _normSrc(l.href)).filter(Boolean)
      );
      for (const link of doc.querySelectorAll('link[rel="stylesheet"][data-page-css]')) {
        const hrefAttr = link.getAttribute('href') || '';
        if (!hrefAttr) continue;
        const abs  = new URL(hrefAttr, dest).href;
        const path = _normSrc(abs);
        if (!_loadedHrefs.has(path)) {
          const el = document.createElement('link');
          el.rel = 'stylesheet'; el.href = abs; el.setAttribute('data-page-css', '');
          document.head.appendChild(el);
          _loadedHrefs.add(path);
        }
      }

      // ⑨ Update URL + title
      const pageId = new URL(dest, window.location.href).pathname.split('/').pop().replace(/\.html$/, '');
      if (!isPopState) history.pushState({ spaPath: dest, pageId }, doc.title, dest);
      document.title = doc.title;

      // ⑨b Breadcrumb — update immediately from coreNavItems so label is correct before
      //    _updateTopNavActive runs (handles dynamic nav items that may not be in coreNavItems yet)
      const _bcEl = document.querySelector('#topnav-wrap .tn-bc-page');
      if (_bcEl) {
        const _bcItem = this.coreNavItems.find(it => it.id === pageId);
        _bcEl.textContent = _bcItem?.label || pageId;
      }

      // ⑨c Update sidebar + topnav active state (navbar stays, just update highlights)
      this.currentPage = pageId; this._presencePage = pageId;
      this._fixActiveItem(pageId);
      this._positionActivePill(true);
      document.querySelectorAll('.sb-quick-item').forEach(a => {
        a.classList.toggle('active', (a.dataset.qid || '') === pageId);
      });
      this._updateTopNavActive(pageId);

      // ⑩ Move new page's action buttons into capsule pill (FLIP width animation)
      //    Order matters: inject extras FIRST so overflow check uses correct final size
      if (this._getNavStyle() === 'capsule') {
        const _pillTA = document.querySelector('.tn-pill-actions');
        const _origTA = mc?.querySelector('.topbar-actions');
        const _pillEl = _pillTA?.closest('.tn-2row-pill');

        // ① Measure OLD width before any changes
        const _oldW = _pillEl ? _pillEl.getBoundingClientRect().width : 0;

        // ② Clear pill + move new page's buttons in
        if (_pillTA) _pillTA.innerHTML = '';
        if (_pillTA && _origTA) {
          while (_origTA.firstChild) _pillTA.appendChild(_origTA.firstChild);
        }

        // ③ Add bell/search BEFORE measuring new width
        //    Block _initNavOverflow during FLIP so it doesn't see wrong dimensions
        this._flipInProgress = true;
        this._injectTopbarExtras();
        this._renderTeamSwitcher();

        // ④ Measure NEW width (all final buttons in place)
        const _newW = _pillEl ? _pillEl.getBoundingClientRect().width : 0;

        // ⑤ FLIP animate pill width old → new
        if (_pillEl && _oldW && _newW && Math.abs(_newW - _oldW) > 3) {
          _pillEl.style.transition = 'none';
          _pillEl.style.width      = _oldW + 'px';
          void _pillEl.offsetWidth;
          _pillEl.style.transition = 'width .3s cubic-bezier(.34,1.12,.64,1)';
          _pillEl.style.width      = _newW + 'px';
          // Pristine setTimeout on purpose: this cleanup belongs to the SHELL, but we
          // are inside the page-tracking window (step ⑦b), so the patched setTimeout
          // would file it under the incoming page and the next navigation would cancel
          // it — leaving the pill stuck at a stale width with _flipInProgress true.
          _NATIVE_setTimeout(() => {
            _pillEl.style.width      = '';
            _pillEl.style.transition = '';
            this._flipInProgress = false;
            this._initNavOverflow?.(); // re-check overflow with correct natural dimensions
          }, 340);
        } else {
          this._flipInProgress = false;
          requestAnimationFrame(() => this._initNavOverflow?.());
        }
      } else {
        // Non-capsule styles: just inject extras normally
        this._injectTopbarExtras();
        this._renderTeamSwitcher();
      }

      if (typeof Icons !== 'undefined' && mc) Icons.replaceAll(mc);

      // ⑪ Execute inline page scripts using indirect eval
      //    KEY: indirect eval scopes const/let LOCALLY (no global conflicts)
      //    but function declarations still leak to global (onclick handlers work)
      //
      //    Cleanup of the previous page and tracking of this one already happened
      //    in step ⑦b, before the external page scripts loaded.
      const _hf    = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0; return h; };
      const _ieval = (0, eval);

      for (const s of doc.body.querySelectorAll('script:not([src])')) {
        const code = (s.textContent || '').trim();
        if (!code || code.includes('sb-restore') || code.length < 8) continue;
        const type = (s.getAttribute('type') || '').toLowerCase();
        if (type === 'importmap' || type === 'application/json') continue;  // data, not code
        const hash = _hf(code);
        // For popstate (back/forward) navigation: always re-run page init scripts.
        // _execHashes guards against duplicate evals on forward SPA nav only — for
        // popstate the page must re-initialise (e.g. RC.init()) or it stays Loading.
        if (!isPopState && this._execHashes.has(hash)) continue;
        this._execHashes.add(hash);
        if (type === 'module') {
          // eval() cannot run a module — `import` is a syntax error outside one. Inject a
          // real <script type="module"> instead so office.html's 3D view initialises on
          // SPA navigation the same way it does on a hard load.
          const el = document.createElement('script');
          el.type = 'module';
          el.textContent = code;
          el.setAttribute('data-spa-module', '');
          document.body.appendChild(el);
          continue;
        }
        try { _ieval(code); } catch (err) {
          // SyntaxError on popstate re-run usually means a `const X = ...` declaration
          // that already exists in scope (duplicate). Safe to ignore — the declaration
          // is already live; we only needed to re-run the init call at the bottom.
          if (!(err instanceof SyntaxError)) console.warn('[spa] script:', err);
        }
      }

      // ── Restore overrides + save for next cleanup ─────────────────
      // document.addEventListener + window.addEventListener + fetch: restored immediately.
      // setInterval / setTimeout: deferred 3 s so async page inits that create
      //   intervals after an await are still tracked and cancelled on next nav.
      document.addEventListener = _origDocAdd;
      window.addEventListener   = _origWinAdd;  // ← restore now so layout.js/noti-scheduler can re-register normally
      window.fetch              = _origFetch;   // ← restore now, not after 3 s
      this._pageListeners    = _newL;
      this._pageWinListeners = _newWL;
      this._pageIntervals    = _newI;

      this._spaRestoreFn = () => {
        window.setInterval = _origSI;
        window.setTimeout  = _origST;
        this._spaRestoreFn = null;
      };
      this._spaRestoreTimer = _origST(() => {
        if (this._spaRestoreFn) { this._spaRestoreFn(); }
        this._spaRestoreTimer = null;
      }, 3000);

      // ⑫ Animate content in
      if (mc) {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          mc.style.transition = 'opacity .28s ease, transform .32s cubic-bezier(.22,.68,0,1.08)';
          mc.style.opacity = ''; mc.style.transform = '';
          // Use native setTimeout so this cleanup timer is never cancelled by the next
          // navigation's page-interval cleanup (which only tracks the patched version).
          _NATIVE_setTimeout(() => { if (mc) mc.style.transition = ''; }, 380);
        }));
      }

    } catch (err) {
      console.warn('[spa] failed, fallback:', err);
      window.location.href = dest;
    } finally {
      window._spaNavigating = false; // always re-enable toasts
      this._spaNavigating = false;
      // If another nav arrived while we were busy, execute it now.
      const _next = this._spaNextDest;
      if (_next) {
        this._spaNextDest = null;
        this._spaNavigate(_next.dest, _next.isPopState);
      }
    }
  },

  // ── Page Loader Overlay ──────────────────────────────────
  // Loader HTML is built in theme.js (window.PageLoader) so the same
  // element is used for cold-load splash and nav-transitions.

  _injectPageLoader(label) {
    if (window.PageLoader && window.PageLoader.inject) {
      return window.PageLoader.inject(label);
    }
    return null;
  },

  _hidePageLoader() {
    if (this._loaderHold && !this._loaderReady) return;
    document.documentElement.removeAttribute('data-entering');
    if (window.PageLoader && window.PageLoader.hide) window.PageLoader.hide();
  },

  // ── Page-loader hold controls (opt-in) ───────────────────
  // Loader is a quick flash by default (hides when Layout.render()
  // completes). Pages that need to keep it visible longer can call:
  //   Layout.holdLoader()   → defer hide, auto-fallback at maxMs
  //   Layout.ready()        → hide immediately
  // Most pages should use skeletons (skeletons.js) instead of holding
  // the loader — the loader is for the shell-render window only.
  _loaderHold: false,
  _loaderHoldTimer: null,
  _loaderReady: false,

  holdLoader(maxMs) {
    this._loaderHold = true;
    this._loaderReady = false;
    clearTimeout(this._loaderHoldTimer);
    const ms = Math.max(500, Math.min(maxMs || 2500, 10000));
    this._loaderHoldTimer = setTimeout(() => {
      this._loaderHold = false;
      this._hidePageLoader();
    }, ms);
  },

  ready() {
    this._loaderReady = true;
    this._loaderHold = false;
    clearTimeout(this._loaderHoldTimer);
    this._hidePageLoader();
  },

  // ── Position the active pill without animation (initial render) ──
  _positionActivePill(animate = true) {
    const nav  = document.getElementById('sidebar-nav');
    const pill = document.getElementById('nav-active-pill');
    if (!pill || !nav) return;

    if (document.getElementById('sidebar')?.classList.contains('collapsed')) {
      pill.style.opacity = '0';
      return;
    }

    const active = nav.querySelector('.nav-item.active:not(.nav-item-locked)');
    if (!active) { pill.style.opacity = '0'; return; }

    if (!animate) pill.classList.add('no-anim');

    const navRect  = nav.getBoundingClientRect();
    const itemRect = active.getBoundingClientRect();
    pill.style.left   = (itemRect.left  - navRect.left)  + 'px';
    pill.style.right  = (navRect.right  - itemRect.right) + 'px';
    pill.style.top    = (itemRect.top   - navRect.top + nav.scrollTop) + 'px';
    pill.style.height = itemRect.height + 'px';
    pill.style.opacity = '1';

    if (!animate) {
      void pill.offsetHeight; // force reflow
      pill.classList.remove('no-anim');
    }
  },

  // ── Slide pill to any nav item (on click, before navigation) ──
  _slidePillTo(navItem) {
    const nav  = document.getElementById('sidebar-nav');
    const pill = document.getElementById('nav-active-pill');
    if (!pill || !nav || !navItem) return;

    const navRect  = nav.getBoundingClientRect();
    const itemRect = navItem.getBoundingClientRect();
    pill.style.left   = (itemRect.left  - navRect.left)  + 'px';
    pill.style.right  = (navRect.right  - itemRect.right) + 'px';
    pill.style.top    = (itemRect.top   - navRect.top + nav.scrollTop) + 'px';
    pill.style.height = itemRect.height + 'px';
    pill.style.opacity = '1';
  },

  // ── Core sidebar (MAIN + ADMIN, no TOOLS yet) ───────────
  _buildCoreSidebar() {
    const user    = Auth.getUser();
    const isAdmin = ['super_admin', 'sm_admin', 'dev_sm'].includes(user?.role);
    const prefix  = this._getPrefix();

    const isExternal = user?.role === 'external';
    const extPerms   = isExternal ? (user.permissions || []) : null;

    // Role-based menu permissions (Phase 2). If cache is missing (first ever
    // visit) we fall through to the legacy filters so nothing disappears —
    // the background refresh will populate the cache for the next load.
    const menuPerms = this._getMenuPerms();
    const allowedSet = menuPerms ? new Set(menuPerms.allowed) : null;

    const sections = {};
    const teamFeatures     = Auth.getTeamFeatures?.();
    const teamFeaturePages = Auth.getTeamFeaturePages?.() || {};
    // Effective team the sidebar is being rendered for. For global-read roles
    // (super_admin / super_viewer) this is the view-as team (from
    // _sa_teams_data cache) — or null when "All Teams" is active, in which
    // case team-lock gates don't apply.
    const _viewAs = (typeof Auth !== 'undefined' && Auth._getViewAsTeam) ? Auth._getViewAsTeam() : null;
    const _isGlobalReader = ['super_admin', 'super_viewer'].includes(user?.role);
    const effectiveTeam = _isGlobalReader ? (_viewAs?.slug || null) : (user?.team || null);

    this.coreNavItems.forEach(item => {
      // Hard-hide gates: role/admin/team/genz
      if (item.adminOnly && !isAdmin) return;
      if (item.roles && !item.roles.includes(user?.role)) return;
      // denyRoles is exclusion: hide this item for the listed roles (e.g. inbox
      // is hidden from super_viewer since team mail is out-of-scope for oversight).
      if (item.denyRoles && item.denyRoles.includes(user?.role)) return;
      // genzOnly: hide unless the user carries the is_genz flag.
      if (item.genzOnly && !user?.is_genz) return;
      if (isExternal && (item.section === 'ADMIN' || item.section === 'DEV')) return;
      // ── Team lock: item is exclusive to one team (e.g. PW Schedule = SM only).
      // Global-read roles with no view-as (null) still see it — they see everything.
      if (item.team && effectiveTeam !== null && effectiveTeam !== item.team) return;

      // Soft-gate: feature / menu-perms → show as locked (user can see but not access)
      let locked = isExternal && extPerms !== null && !extPerms.includes(item.id);
      if (!locked && item.feature && teamFeatures !== null) {
        if (!(teamFeatures || []).includes(item.feature)) {
          locked = true;
        } else {
          const pagePlan = teamFeaturePages[item.feature];
          if (pagePlan && Array.isArray(pagePlan.user_pages) && !pagePlan.user_pages.includes(item.id)) {
            locked = true;
          }
        }
      }
      if (!locked && allowedSet && !allowedSet.has(item.id)) locked = true;

      if (!sections[item.section]) sections[item.section] = [];
      sections[item.section].push({ ...item, locked });
    });

    // Render MAIN first, then dynamic placeholders, then DEV (if any), then ADMIN at the bottom
    const sectionOrder = ['MAIN'];
    const sectionKeys  = Object.keys(sections);
    const others       = sectionKeys.filter(s => s !== 'MAIN' && s !== 'ADMIN' && s !== 'DEV');
    others.forEach(s => sectionOrder.push(s));

    let navHtml = '';
    sectionOrder.forEach(sec => {
      if (!sections[sec]) return;
      let labelAttrs = '';
      let labelText  = sec;
      if (sec === 'OVERSIGHT') labelAttrs = ' style="color:#6366F1"';
      else if (sec === 'GENZ') { labelAttrs = ' data-section-genz="1"'; labelText = '✦ GenZ'; }
      navHtml += `<div class="nav-section"${sec==='GENZ'?' data-section-genz="1"':''}><div class="nav-section-label"${labelAttrs}>${labelText}</div>`;
      sections[sec].forEach(item => {
        const active = item.id === this.currentPage;
        navHtml += this._navItemHtml(prefix + item.path, item.icon, item.label, active, false, "", item.badge, item.locked, item.id);
      });
      navHtml += '</div>';
    });

    // Placeholder slots filled by _injectDynamicSections
    navHtml += `
      <div class="nav-section" id="nav-section-TOOLS" style="display:none">
        <div class="nav-section-label">TOOLS</div>
      </div>
      <div class="nav-section" id="nav-section-EXT" style="display:none">
        <div class="nav-section-label">EXT TOOLS</div>
      </div>
    `;

    // ADMIN section always last
    if (sections['ADMIN']) {
      navHtml += `<div class="nav-section"><div class="nav-section-label">ADMIN</div>`;
      sections['ADMIN'].forEach(item => {
        const active = item.id === this.currentPage;
        navHtml += this._navItemHtml(prefix + item.path, item.icon, item.label, active, false, "", item.badge, false, item.id);
      });
      navHtml += '</div>';
    }

    // DEV section — appears below ADMIN, only for dev_sm
    if (sections['DEV']) {
      navHtml += `<div class="nav-section"><div class="nav-section-label" style="color:var(--orange)">DEV</div>`;
      sections['DEV'].forEach(item => {
        const active = item.id === this.currentPage;
        navHtml += this._navItemHtml(prefix + item.path, item.icon, item.label, active, false, "", item.badge, false, item.id);
      });
      navHtml += '</div>';
    }

    const avatarUrl = user?.avatar_url || '';
    const avatarContent = avatarUrl
      ? `<img src="${escHtml(avatarUrl)}" alt="avatar" onerror="this.parentElement.textContent='${getInitials(user?.name || '?')}'"/>`
      : escHtml(getInitials(user?.name || '?'));

    const el = document.createElement('aside');
    el.className = 'sidebar';
    const _sidebarUser   = (typeof Auth !== 'undefined') ? Auth.getUser() : null;
    const _teamSlug  = _sidebarUser?.team || 'sm';
    const _teamLabel = (_sidebarUser?.role === 'super_admin')
      ? 'PLATFORM'
      : (_sidebarUser?.role === 'super_viewer')
      ? 'OVERSIGHT'
      : _teamSlug.toUpperCase() + '-HUB';
    const _subLabel  = (_sidebarUser?.role === 'super_admin')
      ? 'Super Admin'
      : (_sidebarUser?.role === 'super_viewer')
      ? 'View Only · All Teams'
      : 'SOM-Portal · ' + _teamSlug.toUpperCase();

    el.id = 'sidebar';
    el.innerHTML = `
      <div class="sidebar-logo">
        <div class="logo-row">
          <div class="logo-brand">
            <div class="logo-icon" title="${_teamLabel}"></div>
            <div class="logo-text-wrap">
              <div class="logo-text">${_teamLabel.split('-')[0]}<span class="logo-dot">${_teamLabel.includes('-') ? '-' + _teamLabel.split('-').slice(1).join('-') : ''}</span>${user?.is_genz ? ' <span class="genz-badge" title="GenZ Team">GenZ</span>' : ''}</div>
              <div class="logo-sub">${_subLabel}</div>
            </div>
          </div>
          <button class="sb-collapse-btn" id="sb-collapse-btn" onclick="Layout._toggleSidebar()" title="Toggle sidebar">‹</button>
        </div>
      </div>
      ${this._buildQuickBar()}
      <nav class="sidebar-nav" id="sidebar-nav"><div id="nav-active-pill" style="opacity:0"></div>${navHtml}</nav>
      <div class="sidebar-footer">
        <div class="theme-toggle-row">
          <span class="theme-toggle-label"><span class="tl-icon">${_ic('moon',13,13)}</span>Dark mode</span>
          <div style="display:flex;align-items:center;gap:6px">
            ${user?.role === 'dev_sm' ? `<button id="dev-toolbar-toggle" class="sb-icon-btn" title="Dev Toolbar (Ctrl+Shift+D)" style="font-size:14px;width:28px;height:28px">⚡</button>` : ''}
            <button class="theme-pill" id="theme-toggle-btn" onclick="Theme.toggle();this.classList.toggle('dark-active')" title="Toggle dark mode"></button>
          </div>
        </div>
        <div class="about-som-btn-wrap">
          <a href="${prefix}about-som.html" class="about-som-float-btn" aria-label="About SOM Team">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
            <span class="about-som-tooltip">About SOM Team</span>
          </a>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <div class="sidebar-user" style="cursor:pointer;flex:1;min-width:0" onclick="window.location.href='${prefix}profile.html'" title="Profile settings">
            <div class="user-avatar" id="user-avatar">${avatarContent}</div>
            <div class="user-info">
              <div class="user-name">${escHtml(user?.name || '')}${user?.is_genz ? ' <span class="genz-badge" title="GenZ Team member">GenZ</span>' : ''}</div>
              <div class="user-role ${Roles.badgeClass(user?.role || '')}">${Roles.label(user?.role || '')}</div>
            </div>
          </div>
          <button class="sb-icon-btn" onclick="Auth.logout()" title="Sign out">${_ic('log-out',14,14)}</button>
        </div>
      </div>`;
    return el;
  },

  // ── Inject/replace dynamic sections ─────────────────────
  _injectDynamicSections(tools) {
    const prefix     = this._getPrefix();
    const _user      = Auth.getUser();
    const _isExt     = _user?.role === 'external';
    const _extPerms  = _isExt ? (_user.permissions || []) : null;
    let enabled = tools.filter(t => t.enabled !== false);

    // super_viewer: strip sidebar tools that point to a page hidden from them
    // (batch-monitor, monitoring, test-service, etc.) — otherwise per-team custom
    // shortcuts re-expose those pages under a different section.
    if (_user?.role === 'super_viewer') {
      const denied = new Set(
        this.coreNavItems
          .filter(n => n.denyRoles && n.denyRoles.includes('super_viewer'))
          .map(n => (n.path || '').replace(/^\.\//, ''))
      );
      enabled = enabled.filter(t => {
        const p = (t.path || '').replace(/^\.\//, '');
        return !denied.has(p) && !denied.has(t.page_id + '.html');
      });
    }

    // If any enabled tool has a group, use grouped rendering
    if (enabled.some(t => t.group)) {
      this._renderGroupedTools(enabled, prefix, _isExt, _extPerms);
      return;
    }

    // Fallback: flat list (backward-compat for tools with no group)
    const internal = enabled.filter(t => t.link_type === 'internal');
    const embedded = enabled.filter(t => t.link_type === 'embedded');
    const external = enabled.filter(t => t.link_type !== 'internal' && t.link_type !== 'embedded');

    this._fillSection('nav-section-TOOLS', [...internal, ...embedded], (t) => {
      const active  = t.page_id === this.currentPage;
      const locked  = _isExt && t.page_id && !_extPerms.includes(t.page_id);
      let href;
      if (t.link_type === 'embedded') {
        href = prefix + 'viewer.html?src=' + encodeURIComponent(t.url || '') + '&title=' + encodeURIComponent(t.name || '');
      } else {
        href = prefix + (t.path || '#');
      }
      return this._navItemHtml(href, t.icon || '⊕', t.name, active, false, t.description || '', '', locked);
    });

    this._fillSection('nav-section-EXT', external, (t) => {
      const href = t.url || '#';
      return this._navItemHtml(href, t.icon || '⊕', t.name, false, true, t.description || '');
    });
  },

  _fillSection(sectionId, items, renderFn) {
    const el = document.getElementById(sectionId);
    if (!el) return;

    // Remove previously injected items (keep only the label div)
    el.querySelectorAll('.nav-item').forEach(n => n.remove());

    if (!items.length) { el.style.display = 'none'; return; }

    el.style.display = '';
    el.insertAdjacentHTML('beforeend', items.map(renderFn).join(''));
  },

  // ── Grouped rendering (Feature A) ───────────────────────
  _renderGroupedTools(tools, prefix, _isExt = false, _extPerms = null) {
    const toolsSection = document.getElementById('nav-section-TOOLS');
    const extSection   = document.getElementById('nav-section-EXT');
    if (!toolsSection) return;

    // Build ordered group map
    const groupOrder = [];
    const groupMeta  = {}; // gid → { label, tools[] }
    const ungrouped  = [];

    tools.forEach(t => {
      const gid = t.group || '';
      if (!gid) { ungrouped.push(t); return; }
      if (!groupMeta[gid]) {
        groupMeta[gid] = { label: t.group_label || gid.toUpperCase(), tools: [] };
        groupOrder.push(gid);
      }
      groupMeta[gid].tools.push(t);
    });

    const groupState = this._readGroupState();

    // Build HTML for each group
    let html = '';
    groupOrder.forEach(gid => {
      const { label, tools: gTools } = groupMeta[gid];
      const isCollapsed = !!groupState[gid];

      const itemsHtml = gTools.map(t => {
        const active  = t.page_id === this.currentPage;
        const isExt   = t.link_type === 'external';
        const locked  = _isExt && t.page_id && !_extPerms.includes(t.page_id);
        let href;
        if (t.link_type === 'embedded') {
          href = prefix + 'viewer.html?src=' + encodeURIComponent(t.url || '') + '&title=' + encodeURIComponent(t.name || '');
        } else if (isExt) {
          href = t.url || '#';
        } else {
          href = prefix + (t.path || '#');
        }
        return this._navItemHtml(href, t.icon || '⊕', t.name, active, isExt, t.description || '', '', locked);
      }).join('');

      html += `<div class="nav-group${isCollapsed ? ' collapsed' : ''}" data-group="${escHtml(gid)}">
        <div class="nav-group-header" onclick="Layout._toggleGroup('${escHtml(gid)}')" data-label="${escHtml(label)}">
          <span class="nav-group-label-text">${escHtml(label)}</span>
          <span class="nav-group-chevron"></span>
        </div>
        <div class="nav-group-items">${itemsHtml}</div>
      </div>`;
    });

    // Ungrouped tools — flat, no header
    if (ungrouped.length) {
      html += ungrouped.map(t => {
        const active = t.page_id === this.currentPage;
        const isExt  = t.link_type === 'external';
        let href;
        if (t.link_type === 'embedded') {
          href = prefix + 'viewer.html?src=' + encodeURIComponent(t.url || '') + '&title=' + encodeURIComponent(t.name || '');
        } else if (isExt) {
          href = t.url || '#';
        } else {
          href = prefix + (t.path || '#');
        }
        return this._navItemHtml(href, t.icon || '⊕', t.name, active, isExt, t.description || '');
      }).join('');
    }

    // Replace section content (removes old groups + label on re-inject)
    toolsSection.innerHTML = html;
    toolsSection.style.display = html ? '' : 'none';
    if (extSection) extSection.style.display = 'none';
  },

  // ── Sidebar collapse (Feature C) ─────────────────────────
  _toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    const isCollapsed = sidebar.classList.toggle('collapsed');
    document.body.classList.toggle('sidebar-collapsed', isCollapsed);
    const btn = document.getElementById('sb-collapse-btn');
    if (btn) btn.innerHTML = isCollapsed ? '›' : '‹';
    try { localStorage.setItem(this._SB_COL_KEY, isCollapsed ? '1' : ''); } catch {}
    // JS fallback: force main-content margin in case CSS rule fails to apply
    this._applySidebarMargin(isCollapsed);
    // Restore pill after expand (CSS hides it when collapsed)
    if (!isCollapsed) this._positionActivePill(false);
  },

  // ── Force margin via inline style (defensive — CSS rule should suffice) ──
  _applySidebarMargin(isCollapsed) {
    const mc = document.querySelector('.main-content');
    if (!mc) return;
    const cs = getComputedStyle(document.documentElement);
    const w  = isCollapsed
      ? (cs.getPropertyValue('--sidebar-collapsed-w').trim() || '56px')
      : (cs.getPropertyValue('--sidebar-w').trim() || '230px');
    mc.style.setProperty('margin-left', w, 'important');
  },

  _initSidebarState() {
    try {
      const sb = document.getElementById('sidebar');
      // Source of truth: sidebar may already have .collapsed from sb-restore
      // (inline script that runs before Layout.render), OR localStorage flag.
      const fromDom     = !!sb?.classList.contains('collapsed');
      const fromStorage = localStorage.getItem(this._SB_COL_KEY) === '1';
      const collapsed   = fromDom || fromStorage;

      if (collapsed) {
        if (sb && !sb.classList.contains('collapsed')) sb.classList.add('collapsed');
        document.body.classList.add('sidebar-collapsed');
        const btn = document.getElementById('sb-collapse-btn');
        if (btn) btn.innerHTML = '›';
        // Re-sync localStorage if it was out of date with the DOM
        if (!fromStorage) {
          try { localStorage.setItem(this._SB_COL_KEY, '1'); } catch {}
        }
      } else {
        // Ensure body class is cleared if neither says collapsed
        document.body.classList.remove('sidebar-collapsed');
      }
      // JS fallback: force main-content margin (defensive)
      this._applySidebarMargin(collapsed);
    } catch {}
  },

  // ── Group collapse state ──────────────────────────────────
  _toggleGroup(groupId) {
    const el = document.querySelector(`.nav-group[data-group="${groupId}"]`);
    if (!el) return;
    const isNowCollapsed = el.classList.toggle('collapsed');
    const state = this._readGroupState();
    state[groupId] = isNowCollapsed;
    this._writeGroupState(state);
  },

  _readGroupState() {
    try { return JSON.parse(localStorage.getItem(this._SB_GRP_KEY) || '{}'); } catch { return {}; }
  },

  _writeGroupState(state) {
    try { localStorage.setItem(this._SB_GRP_KEY, JSON.stringify(state)); } catch {}
  },

  // ── JS tooltip for icon-only collapsed mode ───────────────
  _initCollapsedTooltip() {
    const tip = document.createElement('div');
    tip.id = 'sb-tip';
    tip.style.cssText = [
      'position:fixed', 'left:0', 'top:0',
      'background:rgba(22,22,22,0.97)',
      'backdrop-filter:blur(6px)',
      '-webkit-backdrop-filter:blur(6px)',
      'color:#fff',
      'font-size:11.5px',
      'font-family:var(--font,monospace)',
      'padding:5px 12px 6px',
      'border-radius:7px',
      'pointer-events:none',
      'z-index:99999',
      'box-shadow:0 4px 18px rgba(0,0,0,.38),0 1px 4px rgba(0,0,0,.2)',
      'border:1px solid rgba(255,255,255,.1)',
      'display:none',
      'white-space:nowrap',
      'letter-spacing:.025em',
      'font-weight:500',
      'opacity:0',
      'transition:opacity .12s ease',
    ].join(';');
    document.body.appendChild(tip);

    const getSidebar = () => document.getElementById('sidebar');

    document.addEventListener('mouseover', e => {
      if (!getSidebar()?.classList.contains('collapsed')) return;
      const item = e.target.closest('#sidebar .nav-item, #sidebar .nav-group-header');
      if (!item) return;
      const label = item.dataset.label || '';
      if (!label) return;
      const rect = item.getBoundingClientRect();
      tip.textContent = label;
      tip.style.display = 'block';
      tip.style.left = (rect.right + 10) + 'px';
      tip.style.top  = Math.round(rect.top + rect.height / 2 - 14) + 'px';
      requestAnimationFrame(() => { tip.style.opacity = '1'; });
    });

    document.addEventListener('mouseout', e => {
      if (!getSidebar()?.classList.contains('collapsed')) return;
      const item = e.target.closest('#sidebar .nav-item, #sidebar .nav-group-header');
      if (!item) return;
      tip.style.opacity = '0';
      setTimeout(() => { if (tip.style.opacity === '0') tip.style.display = 'none'; }, 130);
    });
  },

  // ── Presence heartbeat (powers Office 3D) ────────────────
  _presenceTimer: null,
  _startPresenceHeartbeat(currentPage) {
    // Update the page label on every render (SPA-style navigation via cache)
    this._presencePage = currentPage || 'unknown';
    if (this._presenceTimer) return; // already running
    if (typeof Auth === 'undefined' || !Auth.getToken?.()) return;

    const PING_MS = 30000;
    const send = () => {
      if (document.hidden) return;
      if (!Auth.getToken?.()) return;
      API.presence?.heartbeat?.(this._presencePage).catch(() => {});
    };
    // first ping shortly after load
    setTimeout(send, 3000);
    // Pristine: the presence heartbeat belongs to the shell and is guarded by
    // `if (this._presenceTimer) return`, so if page cleanup cancels the id the guard
    // still reads truthy and it never restarts — presence silently dies after the
    // first navigation.
    this._presenceTimer = _NATIVE_setInterval(send, PING_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) send(); });
  },

  // ── Deploy-detection: poll /api/version.php ──────────────
  // For users whose tab is open through a deploy — they never
  // reload naturally, so their JS/CSS stays stale forever. This
  // catches that: baseline the version on page load, poll every
  // ~90s (only when visible), and if the version flips → show a
  // toast prompting reload. One prompt per session; user can
  // dismiss "Later" or click "Reload".
  _versionTimer: null,
  _versionCurrent: null,
  _versionPrompted: false,
  _startVersionWatcher() {
    if (this._versionTimer) return;                  // already running
    const url = this._getPrefix() + 'api/version.php';
    const POLL_MS = 90000;

    const check = async () => {
      if (document.hidden) return;                    // don't burn requests on hidden tabs
      if (this._versionPrompted) return;              // already asked user to reload
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (!data?.version) return;
        if (this._versionCurrent === null) {
          // First response: record the baseline. Everything after
          // this is compared against it.
          this._versionCurrent = data.version;
          return;
        }
        if (data.version !== this._versionCurrent) {
          this._versionPrompted = true;
          this._showUpdatePrompt();
          if (this._versionTimer) { clearInterval(this._versionTimer); this._versionTimer = null; }
        }
      } catch (_) { /* network hiccup — quiet */ }
    };

    // Record baseline shortly after load (give the app 3s to settle),
    // then poll on a slow cadence. Also re-check when the tab regains
    // focus so a user coming back from lunch sees the update fast.
    _NATIVE_setTimeout(check, 3000);
    // Pristine: shell-owned version poller (guarded), same reasoning as _presenceTimer.
    this._versionTimer = _NATIVE_setInterval(check, POLL_MS);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) check();
    });
  },

  _showUpdatePrompt() {
    if (document.getElementById('_upd-prompt')) return;
    // Inline styles so this works even if some future CSS bug
    // takes out the theme — the "please reload" toast should
    // always be legible.
    const wrap = document.createElement('div');
    wrap.id = '_upd-prompt';
    wrap.innerHTML = `
      <style>
        @keyframes updSlide {
          from { opacity:0; transform:translate(-50%,-16px); }
          to   { opacity:1; transform:translate(-50%,0); }
        }
        #_upd-prompt-bar {
          position:fixed; top:20px; left:50%; transform:translateX(-50%);
          z-index:100000; padding:12px 18px;
          background:linear-gradient(135deg,#f26419,#e05510); color:#fff;
          border-radius:12px; box-shadow:0 12px 32px rgba(242,100,25,.45);
          font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
          font-size:13px; font-weight:600;
          display:inline-flex; align-items:center; gap:12px;
          animation:updSlide .4s cubic-bezier(.16,1,.3,1);
          max-width:calc(100vw - 32px);
        }
        #_upd-prompt-bar .upd-icon {
          display:inline-flex; align-items:center; justify-content:center;
          width:28px; height:28px; border-radius:50%;
          background:rgba(255,255,255,.22); flex-shrink:0;
        }
        #_upd-prompt-bar .upd-msg { line-height:1.3; }
        #_upd-prompt-bar .upd-msg b { font-weight:800; letter-spacing:.01em; }
        #_upd-prompt-bar .upd-btn {
          padding:7px 14px; border-radius:8px; border:0;
          background:rgba(255,255,255,.22); color:#fff;
          font-family:inherit; font-size:12.5px; font-weight:800;
          cursor:pointer; letter-spacing:.02em; white-space:nowrap;
          transition:background .15s;
        }
        #_upd-prompt-bar .upd-btn:hover { background:rgba(255,255,255,.32); }
        #_upd-prompt-bar .upd-later {
          padding:5px 10px; border-radius:6px; border:0;
          background:transparent; color:rgba(255,255,255,.85);
          font-family:inherit; font-size:11.5px; font-weight:600; cursor:pointer;
        }
        #_upd-prompt-bar .upd-later:hover { color:#fff; }
      </style>
      <div id="_upd-prompt-bar">
        <span class="upd-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        </span>
        <span class="upd-msg"><b>มีอัปเดตใหม่</b> · โหลดหน้าใหม่เพื่อเห็นการเปลี่ยนแปลง</span>
        <button class="upd-btn" onclick="location.reload()">Reload</button>
        <button class="upd-later" onclick="document.getElementById('_upd-prompt').remove()" title="Later">✕</button>
      </div>
    `;
    document.body.appendChild(wrap);
  },


  // ── SessionStorage cache ─────────────────────────────────
  _readCache() {
    try {
      const raw = sessionStorage.getItem(this._CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },
  _writeCache(data) {
    try { sessionStorage.setItem(this._CACHE_KEY, JSON.stringify(data)); } catch {}
  },

  // Call this from admin/tools.html after any save/delete to bust cache
  bustCache() {
    try { sessionStorage.removeItem(this._CACHE_KEY); } catch {}
  },

  // ── Inject notification bell + global search into topbar ───
  _injectTopbarExtras() {
    // Inject CSS once
    if (!document.getElementById('_layout-extras-css')) {
      const s = document.createElement('style');
      s.id = '_layout-extras-css';
      s.textContent = `
        /* ── Topbar extra buttons ─── */
        .tb-icon-btn {
          width:32px;height:32px;border-radius:8px;border:1.5px solid var(--border);
          background:transparent;color:var(--text-muted);font-size:15px;cursor:pointer;
          display:flex;align-items:center;justify-content:center;
          font-family:var(--font);transition:background .15s,color .15s,border-color .15s;
          flex-shrink:0;position:relative;
        }
        .tb-icon-btn:hover { background:var(--orange-dim);color:var(--orange);border-color:rgba(242,100,25,.3); }

        /* ── Notification badge ─── */
        .notif-badge {
          position:absolute;top:-4px;right:-4px;min-width:16px;height:16px;
          background:var(--orange);color:#fff;font-size:9px;font-weight:800;
          border-radius:8px;padding:0 3px;display:flex;align-items:center;justify-content:center;
          border:2px solid var(--bg-card, #fff);line-height:1;pointer-events:none;
        }
        .notif-badge.hidden { display:none; }

        /* ── Notification panel ─── */
        .notif-wrap { position:relative; }
        .notif-panel {
          position:absolute;top:calc(100% + 10px);right:0;width:360px;
          background:#fff;border:1.5px solid var(--border);border-radius:14px;
          box-shadow:0 12px 40px rgba(0,0,0,.14),0 2px 8px rgba(0,0,0,.06);
          z-index:9000;overflow:hidden;
          animation:notifIn .18s cubic-bezier(.22,.68,0,1.2) both;
        }
        .notif-panel.hidden { display:none; }
        @keyframes notifIn {
          from { opacity:0;transform:translateY(-8px) scale(.97); }
          to   { opacity:1;transform:translateY(0) scale(1); }
        }
        .notif-panel-head {
          display:flex;align-items:center;justify-content:space-between;
          padding:12px 16px 10px;border-bottom:1px solid var(--border);
        }
        .notif-panel-title { font-size:12px;font-weight:800;color:var(--text);letter-spacing:.02em; }
        .notif-head-btns { display:flex;gap:6px; }
        .notif-head-btn {
          font-size:10px;font-weight:700;color:var(--text-muted);background:none;
          border:none;cursor:pointer;padding:2px 6px;border-radius:4px;
          font-family:var(--font);transition:color .12s,background .12s;
        }
        .notif-head-btn:hover { color:var(--orange);background:var(--orange-dim); }
        .notif-list { max-height:380px;overflow-y:auto;overscroll-behavior:contain; }
        .notif-empty {
          padding:32px 16px;text-align:center;font-size:11px;color:var(--text-muted);
          display:flex;flex-direction:column;align-items:center;gap:8px;
        }
        .notif-empty-icon { font-size:28px;opacity:.35; }
        .notif-item {
          display:flex;gap:10px;padding:11px 16px;border-bottom:1px solid #f5f5f5;
          cursor:pointer;transition:background .12s;position:relative;
        }
        .notif-item:last-child { border-bottom:none; }
        .notif-item:hover { background:#fafafa; }
        .notif-item.unread { background:#FFF8F5; }
        .notif-item.unread::before {
          content:'';position:absolute;left:0;top:0;bottom:0;width:3px;
          background:var(--orange);border-radius:0 3px 3px 0;
        }
        .notif-icon {
          width:34px;height:34px;border-radius:10px;flex-shrink:0;
          display:flex;align-items:center;justify-content:center;font-size:16px;
        }
        .notif-icon.type-mention  { background:rgba(59,130,246,.1);  }
        .notif-icon.type-comment  { background:rgba(34,197,94,.1);   }
        .notif-icon.type-leave    { background:rgba(251,191,36,.1);  }
        .notif-icon.type-request  { background:rgba(139,92,246,.1);  }
        .notif-icon.type-default  { background:rgba(242,100,25,.1);  }
        .notif-body { flex:1;min-width:0; }
        .notif-title-row { display:flex;align-items:baseline;justify-content:space-between;gap:4px; }
        .notif-title { font-size:11.5px;font-weight:700;color:var(--text);line-height:1.3; }
        .notif-time  { font-size:10px;color:var(--text-muted);flex-shrink:0; }
        .notif-body-text { font-size:10.5px;color:var(--text-muted);margin-top:2px;line-height:1.45;
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
        .notif-post { font-size:10px;color:var(--orange);margin-top:2px;
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }

        /* ── Global Search overlay ─── */
        #gs-overlay {
          position:fixed;inset:0;z-index:9500;
          background:rgba(0,0,0,.5);
          display:flex;align-items:flex-start;justify-content:center;padding-top:80px;
          opacity:0;pointer-events:none;
          transition:opacity .14s ease;
        }
        #gs-overlay.active { opacity:1;pointer-events:all; }
        .gs-box {
          width:100%;max-width:660px;background:#fff;border-radius:16px;
          box-shadow:0 20px 60px rgba(0,0,0,.22),0 4px 12px rgba(0,0,0,.1);
          overflow:hidden;display:flex;flex-direction:column;
          max-height:calc(100vh - 140px);
          transform:translateY(-10px);opacity:0;
          transition:transform .18s cubic-bezier(.22,.68,0,1.1),opacity .14s ease;
          will-change:transform,opacity;
        }
        #gs-overlay.active .gs-box { transform:translateY(0);opacity:1; }
        .gs-input-row {
          display:flex;align-items:center;gap:0;border-bottom:1.5px solid var(--border);
          padding:0 16px;flex-shrink:0;
        }
        .gs-input-icon { font-size:18px;color:var(--text-muted);flex-shrink:0;margin-right:2px; }
        .gs-input {
          flex:1;border:none;outline:none;padding:18px 12px;font-size:15px;
          font-family:var(--font);color:var(--text);background:transparent;
        }
        .gs-input::placeholder { color:#ccc; }
        .gs-shortcut {
          font-size:10px;color:var(--text-muted);background:var(--bg);
          border:1px solid var(--border);border-radius:5px;padding:2px 7px;
          flex-shrink:0;letter-spacing:.04em;font-weight:600;
        }
        .gs-results { overflow-y:auto;flex:1;padding-bottom:6px; }
        .gs-idle {
          padding:32px 20px;text-align:center;font-size:11.5px;color:var(--text-muted);
          display:flex;flex-direction:column;align-items:center;gap:8px;
        }
        .gs-idle-icon { font-size:36px;opacity:.2; }
        .gs-idle-hint { font-size:10.5px;color:#ccc; }
        .gs-group-label {
          font-size:9.5px;font-weight:800;color:var(--text-muted);letter-spacing:.1em;
          text-transform:uppercase;padding:14px 18px 6px;
        }
        .gs-item {
          display:flex;align-items:center;gap:12px;padding:10px 18px;
          cursor:pointer;transition:background .1s;border-radius:0;
        }
        .gs-item:hover, .gs-item.focused { background:var(--orange-dim); }
        .gs-item-icon {
          width:36px;height:36px;border-radius:10px;flex-shrink:0;background:var(--bg);
          border:1px solid var(--border);display:flex;align-items:center;justify-content:center;
          font-size:17px;transition:background .1s;
        }
        .gs-item:hover .gs-item-icon, .gs-item.focused .gs-item-icon { background:rgba(242,100,25,.12); border-color:rgba(242,100,25,.25); }
        .gs-item-body { flex:1;min-width:0; }
        .gs-item-title { font-size:12.5px;font-weight:700;color:var(--text);
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
        .gs-item-excerpt { font-size:10.5px;color:var(--text-muted);margin-top:1px;
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
        .gs-item-right { display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex-shrink:0; }
        .gs-badge {
          font-size:9.5px;font-weight:700;padding:2px 7px;border-radius:4px;
          background:var(--orange-dim);color:var(--orange);letter-spacing:.04em;
        }
        .gs-meta { font-size:10px;color:var(--text-muted); }
        .gs-no-results { padding:28px 20px;text-align:center;font-size:11.5px;color:var(--text-muted); }
        .gs-footer {
          border-top:1px solid var(--border);padding:8px 18px;display:flex;gap:12px;
          align-items:center;background:var(--bg);flex-shrink:0;
        }
        .gs-footer-hint { font-size:10px;color:var(--text-muted);display:flex;align-items:center;gap:4px; }
        .gs-footer-key {
          display:inline-flex;align-items:center;justify-content:center;
          background:#fff;border:1px solid var(--border);border-radius:4px;
          padding:1px 5px;font-size:10px;min-width:20px;
        }
      `;
      document.head.appendChild(s);
    }

    // Inject into topbar-actions
    const actions = document.querySelector('.topbar-actions');
    if (!actions || document.getElementById('_tb-notif-wrap')) return;

    const prefix = this._getPrefix();

    // Global search button
    const searchBtn = document.createElement('button');
    searchBtn.className = 'tb-icon-btn';
    searchBtn.id = '_tb-search-btn';
    searchBtn.title = 'Global Search  (Ctrl+K)';
    searchBtn.innerHTML = _ic('search');
    searchBtn.onclick = () => GlobalSearch.open();

    // Notification bell wrapper
    const notifWrap = document.createElement('div');
    notifWrap.className = 'notif-wrap';
    notifWrap.id = '_tb-notif-wrap';
    notifWrap.innerHTML = `
      <button class="tb-icon-btn" id="_tb-notif-btn" title="Notifications" onclick="Notifications.toggle()">
        ${_ic('bell')}
        <span class="notif-badge hidden" id="_notif-badge">0</span>
      </button>
      <div class="notif-panel hidden" id="_notif-panel">
        <div class="notif-panel-head">
          <span class="notif-panel-title">Notifications</span>
          <div class="notif-head-btns">
            <button class="notif-head-btn" onclick="Notifications.markAllRead()">Mark all read</button>
            <button class="notif-head-btn" onclick="Notifications.clearRead()">Clear read</button>
          </div>
        </div>
        <div class="notif-list" id="_notif-list">
          <div class="notif-empty"><div class="notif-empty-icon">${_ic('bell',32,32)}</div>No notifications yet</div>
        </div>
      </div>`;

    // Global search overlay (append once to body)
    if (!document.getElementById('gs-overlay')) {
      const gsEl = document.createElement('div');
      gsEl.id = 'gs-overlay';
      gsEl.innerHTML = `
        <div class="gs-box" id="gs-box">
          <div class="gs-input-row">
            <span class="gs-input-icon">${_ic('search',16,16)}</span>
            <input class="gs-input" id="gs-input" placeholder="Search posts, docs, people..." autocomplete="off" spellcheck="false">
            <span class="gs-shortcut">ESC</span>
          </div>
          <div class="gs-results" id="gs-results">
            <div class="gs-idle">
              <div class="gs-idle-icon">${_ic('search',36,36)}</div>
              <div>Type to search across the workspace</div>
              <div class="gs-idle-hint">Posts · Docs · People</div>
            </div>
          </div>
          <div class="gs-footer">
            <span class="gs-footer-hint"><span class="gs-footer-key">↑↓</span> Navigate</span>
            <span class="gs-footer-hint"><span class="gs-footer-key">↵</span> Open</span>
            <span class="gs-footer-hint"><span class="gs-footer-key">Esc</span> Close</span>
          </div>
        </div>`;
      document.body.appendChild(gsEl);
      gsEl.addEventListener('click', e => { if (e.target === gsEl) GlobalSearch.close(); });
    }

    // My Alerts button — pill-style with label so the "what does this do"
    // question is answered without hovering. SM-only (writes are gated by
    // requireSmForShared on the backend anyway). Opens the drawer inline
    // on service-performance; deep-links to it from other pages.
    const _user = Auth.getUser?.();
    const _isSm = _user && (_user.team === 'sm' || _user.role === 'super_admin');
    let alertsBtn = null;
    if (_isSm) {
      alertsBtn = document.createElement('button');
      alertsBtn.className = 'tb-alerts-btn';
      alertsBtn.id = '_tb-alerts-btn';
      alertsBtn.title = 'My Alerts — create / manage threshold alerts (Google Chat notify)';
      alertsBtn.innerHTML = _ic('bell', 14, 14) + '<span style="vertical-align:middle">My Alerts</span>';
      alertsBtn.style.cssText = `
        display:inline-flex; align-items:center; gap:6px;
        padding:6px 12px; margin-right:6px;
        background:color-mix(in srgb, var(--orange, #f26419) 12%, transparent);
        color:var(--orange, #f26419);
        border:1px solid color-mix(in srgb, var(--orange, #f26419) 30%, transparent);
        border-radius:8px; font-size:12px; font-weight:600; cursor:pointer;
        transition:background .12s, filter .12s;
      `;
      alertsBtn.onmouseenter = () => { alertsBtn.style.filter = 'brightness(1.08)'; alertsBtn.style.background = 'color-mix(in srgb, var(--orange, #f26419) 20%, transparent)'; };
      alertsBtn.onmouseleave = () => { alertsBtn.style.filter = ''; alertsBtn.style.background = 'color-mix(in srgb, var(--orange, #f26419) 12%, transparent)'; };
      alertsBtn.onclick = () => {
        if (window.SP?.Alerts?.open) {
          window.SP.Alerts.open('');   // empty service → show all rules
        } else {
          const path = /\/admin\//.test(location.pathname) ? '../' : './';
          location.href = path + 'service-performance.html?openAlerts=1';
        }
      };
    }

    // Insert search btn + notif bell before the first child of topbar-actions
    actions.insertBefore(notifWrap, actions.firstChild);
    if (alertsBtn) actions.insertBefore(alertsBtn, actions.firstChild);
    actions.insertBefore(searchBtn, actions.firstChild);

    // Overflow menu: runs after paint so widths are known
    requestAnimationFrame(() => requestAnimationFrame(() => this._initNavOverflow()));
    // Also re-check on resize
    if (!this._navOverflowListenerAdded) {
      this._navOverflowListenerAdded = true;
      window.addEventListener('resize', () => {
        clearTimeout(this._navOverflowDebounce);
        this._navOverflowDebounce = setTimeout(() => this._initNavOverflow(), 120);
      });
    }

    // Note: _renderTeamSwitcher() is now called from render() directly so it
    // still shows on pages that omit .topbar-actions (e.g. learn.html).

    // Inject terminal prompt prefix  ~/team ▶  before page title (team-aware)
    const tbTitle = document.querySelector('.topbar-title');
    if (tbTitle && !tbTitle.querySelector('.tb-prompt')) {
      const _tbUser = (typeof Auth !== 'undefined') ? Auth.getUser() : null;
      const _tbSlug = (_tbUser?.role === 'super_admin') ? 'platform'
                    : (_tbUser?.role === 'super_viewer') ? 'oversight'
                    : (_tbUser?.team || 'sm');
      const p = document.createElement('div');
      p.className = 'tb-prompt';
      p.innerHTML = `<span class="tb-path">~/${_tbSlug}</span><span class="tb-arrow">▶</span>`;
      tbTitle.insertBefore(p, tbTitle.firstChild);
    }

    // Close notif panel when clicking outside (register once; guard for SPA re-calls)
    if (!this._notifOutsideClickBound) {
      this._notifOutsideClickBound = true;
      document.addEventListener('click', (e) => {
        const wrap = document.getElementById('_tb-notif-wrap');
        if (wrap && !wrap.contains(e.target)) {
          document.getElementById('_notif-panel')?.classList.add('hidden');
        }
      });
    }

    // Keyboard shortcut Ctrl+K / Cmd+K → open search (register once)
    if (!this._searchShortcutBound) {
      this._searchShortcutBound = true;
      document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
          e.preventDefault();
          GlobalSearch.open();
        }
      });
    }

    // Start notification polling
    Notifications._init();

    // Jira Requests Inbox button — SM team only, inject once into topbar-actions
    (function _loadJiraInbox() {
      const _jriu = Auth.getUser?.();
      const _jriSm = _jriu && (_jriu.team === 'sm' || ['sm_admin','sm_lead','sm_user','dev_sm','super_admin'].includes(_jriu.role));
      if (!_jriSm) return;

      // Inject icon button into topbar if not already there
      if (!document.getElementById('_jri-tb-btn')) {
        const _wrap = document.createElement('div');
        _wrap.style.cssText = 'position:relative;flex-shrink:0;';
        _wrap.dataset.core = '1'; // prevents overflow collapse
        _wrap.innerHTML = `<button id="_jri-tb-btn" class="tb-icon-btn" title="Requests SOM Portal">
          <i data-icon="inbox"></i>
          <span id="_jri-tb-badge" style="display:none;position:absolute;top:-3px;right:-3px;min-width:15px;height:15px;padding:0 3px;border-radius:8px;background:#ef4444;color:#fff;font-size:9px;font-weight:800;line-height:15px;text-align:center;border:2px solid var(--bg-card,#fff);"></span>
        </button>`;
        const _settingsBtn = document.getElementById('_tb-settings-btn');
        if (_settingsBtn && _settingsBtn.parentNode === actions) {
          actions.insertBefore(_wrap, _settingsBtn);
        } else {
          actions.appendChild(_wrap);
        }
        document.getElementById('_jri-tb-btn').onclick = () => { JiraInbox?.open?.(); };
      }

      // Load script once
      if (document.getElementById('_jri-script')) { JiraInbox?.init?.(); return; }
      const _jriBase = (document.querySelector('script[src*="layout.js"]')?.src || '')
        .replace(/assets\/js\/layout\.js.*$/, '');
      const _s = document.createElement('script');
      _s.id  = '_jri-script';
      _s.src = _jriBase + 'assets/js/jira-requests-inbox.js';
      document.head.appendChild(_s);
    })();

    // Settings gear icon → navigates to settings.html (UI theme picker with previews)
    this._injectSettingsButton(actions);

    // Team switcher is now rendered from render() directly (not tied to .topbar-actions).
  },

  // ── Settings gear icon in topbar ──────────────────────────────
  _injectSettingsButton(actions) {
    if (!actions || document.getElementById('_tb-settings-btn')) return;
    const prefix = this._getPrefix();
    const btn = document.createElement('button');
    btn.className = 'tb-icon-btn';
    btn.id = '_tb-settings-btn';
    btn.dataset.core = '1'; // prevents overflow collapse
    btn.title = 'Settings (UI theme, color mode)';
    btn.innerHTML = _ic('settings');
    btn.onclick = () => { window.location.href = prefix + 'settings.html'; };
    actions.appendChild(btn);
  },

  // ── Team Switcher (global-read roles: super_admin + super_viewer) ─────────
  // Segmented switch under the topbar for view-as-team. Shows on every page
  // except the platform-management ones (super-admin.html, super-team-permissions.html)
  // — because those pages ARE the switcher's admin surface. super_viewer never
  // lands on those pages anyway (Auth.requireAdmin blocks them).
  _renderTeamSwitcher() {
    const user = (typeof Auth !== 'undefined') ? Auth.getUser?.() : null;
    if (!user || !['super_admin', 'super_viewer'].includes(user.role)) return;

    const cur = (window.location.pathname.split('/').pop() || '').replace('.html','') || 'index';
    if (cur === 'super-admin' || cur === 'super-team-permissions') return;

    if (document.getElementById('_tsw-pill')) return;

    // Inject CSS once
    if (!document.getElementById('_tsw-css')) {
      const s = document.createElement('style');
      s.id = '_tsw-css';
      s.textContent = `
        /* ── Floating pill (bottom-right) ──────────────────── */
        .tsw-pill {
          position: fixed; bottom: 22px; right: 22px;
          display: inline-flex; align-items: center; gap: 8px;
          padding: 8px 14px 8px 10px;
          background: var(--bg-card, #fff);
          border: 1.5px solid var(--border);
          border-radius: 999px;
          box-shadow: 0 8px 24px rgba(0,0,0,.12);
          font-family: var(--font, 'JetBrains Mono', ui-monospace, monospace);
          font-size: 12px; font-weight: 700;
          color: var(--text);
          cursor: pointer;
          z-index: 9989;
          transition: box-shadow .15s, transform .15s, border-color .15s, right .25s;
          user-select: none;
        }
        .tsw-pill:hover {
          border-color: color-mix(in srgb, var(--tsw-team-color, var(--orange, #F26419)) 60%, var(--border));
          box-shadow: 0 12px 32px rgba(0,0,0,.16);
          transform: translateY(-2px);
        }
        .tsw-pill-dot {
          width: 12px; height: 12px; border-radius: 50%;
          background: var(--tsw-team-color, var(--orange, #F26419));
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--tsw-team-color, var(--orange, #F26419)) 22%, transparent);
          flex-shrink: 0;
        }
        .tsw-pill-icon {
          width: 14px; height: 14px; display: inline-flex;
          align-items: center; justify-content: center;
          color: var(--text-muted); font-size: 13px;
        }
        .tsw-pill-caret { font-size: 9px; color: var(--text-muted); margin-left: 2px; }

        /* ── Popover (opens above the pill) ────────────────── */
        .tsw-popover {
          position: fixed; bottom: 78px; right: 22px;
          min-width: 240px; max-width: 320px;
          background: var(--bg-card, #fff);
          border: 1px solid var(--border);
          border-radius: 12px; overflow: hidden;
          box-shadow: 0 16px 40px rgba(0,0,0,.14), 0 0 0 1px rgba(0,0,0,.02);
          font-family: var(--font, 'JetBrains Mono', ui-monospace, monospace);
          z-index: 9990;
          display: none;
          transform-origin: bottom right;
          transition: right .25s;
        }
        .tsw-popover.open {
          display: block;
          animation: tswPop .18s cubic-bezier(.34,1.56,.64,1);
        }
        @keyframes tswPop {
          from { opacity: 0; transform: scale(.94) translateY(6px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        .tsw-popover-hd {
          padding: 12px 14px 6px;
          font-size: 9.5px; font-weight: 800; color: var(--text-muted);
          letter-spacing: .1em; text-transform: uppercase;
          display: flex; align-items: center; gap: 5px;
        }
        .tsw-popover-hd::before { content: '📍'; font-size: 11px; }
        .tsw-item {
          display: flex; align-items: center; gap: 10px;
          padding: 8px 14px; font-size: 12px;
          color: var(--text); cursor: pointer;
          transition: background .1s;
          text-decoration: none;
        }
        .tsw-item:hover { background: color-mix(in srgb, var(--orange, #F26419) 8%, transparent); }
        .tsw-item.active {
          color: var(--orange, #F26419);
          background: color-mix(in srgb, var(--orange, #F26419) 10%, transparent);
          font-weight: 700;
        }
        .tsw-item-dot {
          width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0;
        }
        .tsw-item-check { margin-left: auto; color: var(--orange, #F26419); font-size: 12px; }
        .tsw-sep { height: 1px; background: var(--border); margin: 4px 0; }
        .tsw-item.muted { color: var(--text-muted); font-size: 11px; }

        /* Slide pill + popover left when Tummeng drawer is open so they don't overlap */
        body.tm-drawer-open .tsw-pill,
        body.tm-drawer-open .tsw-popover { right: 402px; }

        @media (max-width: 640px) {
          .tsw-pill { padding: 7px 12px 7px 8px; font-size: 11.5px; }
          .tsw-popover { right: 12px; bottom: 70px; min-width: 200px; }
          body.tm-drawer-open .tsw-pill,
          body.tm-drawer-open .tsw-popover { right: 12px; bottom: 74px; }
        }
      `;
      document.head.appendChild(s);
    }

    // Optimistically paint from cache; then refresh from network in background.
    let cachedTeams = [];
    try {
      const raw = sessionStorage.getItem('_sa_teams_data');
      if (raw) cachedTeams = JSON.parse(raw) || [];
    } catch {}

    const curSlug = (typeof API !== 'undefined') ? (API.getAdminTeam?.() || null) : null;
    const inAdmin = /\/admin\//.test(window.location.pathname);
    const manageHref = inAdmin ? 'super-admin.html' : 'admin/super-admin.html';

    // Build pill + popover as body-appended siblings so they stay fixed
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.id = '_tsw-pill';
    pill.className = 'tsw-pill';
    pill.setAttribute('aria-haspopup', 'true');
    pill.setAttribute('aria-expanded', 'false');
    pill.title = 'View as team';
    document.body.appendChild(pill);

    const popover = document.createElement('div');
    popover.id = '_tsw-popover';
    popover.className = 'tsw-popover';
    popover.setAttribute('role', 'menu');
    document.body.appendChild(popover);

    // Toggle behavior
    const openPop  = () => { popover.classList.add('open'); pill.setAttribute('aria-expanded', 'true'); };
    const closePop = () => { popover.classList.remove('open'); pill.setAttribute('aria-expanded', 'false'); };
    pill.addEventListener('click', e => {
      e.stopPropagation();
      popover.classList.contains('open') ? closePop() : openPop();
    });
    document.addEventListener('click', e => {
      if (popover.classList.contains('open') &&
          !popover.contains(e.target) && !pill.contains(e.target)) closePop();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && popover.classList.contains('open')) closePop();
    });

    const esc = (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
                      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');

    const paint = (teams) => {
      const active = teams.filter(t => t.active !== false);

      // Persist cache so Auth.getTeamFeatures() can look up features per view-as team
      try { sessionStorage.setItem('_sa_teams_data', JSON.stringify(teams)); } catch {}

      const activeTeam = curSlug ? active.find(x => x.slug === curSlug) : null;
      const teamColor  = activeTeam?.color || '#F26419';
      const pillLabel  = activeTeam ? (activeTeam.name || activeTeam.slug) : 'All Teams';

      pill.style.setProperty('--tsw-team-color', teamColor);
      pill.innerHTML =
        (activeTeam
          ? `<span class="tsw-pill-dot"></span>`
          : `<span class="tsw-pill-icon">⚡</span>`) +
        `<span>${esc(pillLabel)}</span>` +
        `<span class="tsw-pill-caret">▾</span>`;

      // Popover contents
      const items = [
        `<div class="tsw-item${!curSlug ? ' active' : ''}" data-slug="" role="menuitem">` +
          `<span class="tsw-pill-icon">⚡</span>` +
          `<span>All Teams</span>` +
          (!curSlug ? '<span class="tsw-item-check">✓</span>' : '') +
        `</div>`
      ];
      active.forEach(t => {
        const isActive = curSlug === t.slug;
        items.push(
          `<div class="tsw-item${isActive ? ' active' : ''}" data-slug="${esc(t.slug)}" role="menuitem">` +
            `<span class="tsw-item-dot" style="background:${esc(t.color || '#6366F1')}"></span>` +
            `<span>${esc(t.name || t.slug)}</span>` +
            (isActive ? '<span class="tsw-item-check">✓</span>' : '') +
          `</div>`
        );
      });

      const manageLinkHtml = (user.role === 'super_admin')
        ? `<div class="tsw-sep"></div>` +
          `<a class="tsw-item muted" href="${manageHref}">` +
            `<span class="tsw-pill-icon">⚙</span>` +
            `<span>Manage teams</span>` +
          `</a>`
        : '';

      popover.innerHTML =
        `<div class="tsw-popover-hd">View as</div>` +
        items.join('') +
        manageLinkHtml;

      popover.querySelectorAll('.tsw-item[data-slug]').forEach(el => {
        el.addEventListener('click', () => {
          const slug = el.dataset.slug || null;
          if (typeof API !== 'undefined' && API.setAdminTeam) API.setAdminTeam(slug);
          try { sessionStorage.removeItem('_sm_sb_html'); } catch {}
          window.location.reload();
        });
      });
    };

    // Paint with cache (may be empty on first visit; that's fine — we show a
    // placeholder All-Teams button while the network call fills in the rest).
    paint(cachedTeams);

    // Background refresh
    if (typeof API !== 'undefined' && API.teams?.list) {
      API.teams.list().then(res => {
        if (!res?.ok) return;
        const fresh = res.data?.data || res.data || [];
        // Only repaint if the list actually changed (avoid needless reflow)
        const prev = JSON.stringify(cachedTeams.map(t => [t.slug, t.name, t.color, t.active, (t.features||[]).slice().sort().join(',')]));
        const next = JSON.stringify(fresh.map(t => [t.slug, t.name, t.color, t.active, (t.features||[]).slice().sort().join(',')]));
        if (prev !== next) { paint(fresh); window.location.reload(); }
        else { try { sessionStorage.setItem('_sa_teams_data', JSON.stringify(fresh)); } catch {} }
      }).catch(() => {});
    }
  },

};

/* ══════════════════════════════════════════════════
   Notifications  |  Bell panel, polling, mark-read
   ══════════════════════════════════════════════════ */
const Notifications = {
  _pollTimer: null,
  _unread: 0,

  _init() {
    if (this._pollTimer) return; // already running (SPA: called on each navigate)
    this.fetch();
    // Pristine, for the same reason as _presenceTimer: guarded by `if (this._pollTimer)
    // return`, so a cancelled id would leave notifications permanently stopped.
    this._pollTimer = _NATIVE_setInterval(() => {
      if (!document.hidden) this.fetch();
    }, 60000);
    // Resume fetch immediately when tab becomes visible again
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.fetch();
    }, { once: false });
  },

  async fetch() {
    try {
      const res = await API.notifications.list();
      if (!res?.ok) return;
      const { notifications, unread } = res.data.data;
      this._unread = unread || 0;
      this._updateBadge(this._unread);
      this._renderList(notifications || []);
    } catch (e) {}
  },

  _updateBadge(count) {
    const badge = document.getElementById('_notif-badge');
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  },

  _iconForType(type) {
    if (type === 'mention') return { icon: _ic('at-sign'), cls: 'type-mention' };
    if (type === 'comment') return { icon: _ic('message-sq'), cls: 'type-comment' };
    if (type === 'leave_request') return { icon: _ic('clipboard'), cls: 'type-leave' };
    if (type === 'request_submitted') return { icon: _ic('file-text'), cls: 'type-request' };
    if (type === 'request_status_updated') return { icon: _ic('refresh-cw'), cls: 'type-request' };
    return { icon: '🔔', cls: 'type-default' };
  },

  _renderList(items) {
    const list = document.getElementById('_notif-list');
    if (!list) return;
    if (!items.length) {
      list.innerHTML = `<div class="notif-empty"><div class="notif-empty-icon">🔔</div>No notifications yet</div>`;
      return;
    }
    list.innerHTML = items.map(n => {
      const { icon, cls } = this._iconForType(n.type);
      const unreadCls = n.read ? '' : ' unread';
      const postId = n.post_id || '';
      const notifType = n.type || '';
      return `
        <div class="notif-item${unreadCls}" data-notif-id="${escHtml(n.id)}" data-notif-type="${escHtml(notifType)}" data-post-id="${escHtml(postId)}">
          <div class="notif-icon ${cls}">${icon}</div>
          <div class="notif-body">
            <div class="notif-title-row">
              <span class="notif-title">${escHtml(n.title || '')}</span>
              <span class="notif-time">${DateTime.timeAgo(n.created_at)}</span>
            </div>
            ${n.body ? `<div class="notif-body-text">${escHtml(n.body)}</div>` : ''}
            ${n.post_title ? `<div class="notif-post">◫ ${escHtml(n.post_title)}</div>` : ''}
          </div>
        </div>`;
    }).join('');
    
    // Add click handlers
    list.querySelectorAll('.notif-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = item.dataset.notifId;
        const type = item.dataset.notifType;
        const postId = item.dataset.postId;
        this._onItemClick(id, type, postId);
      });
    });
  },

  toggle() {
    const panel = document.getElementById('_notif-panel');
    if (!panel) return;
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) {
      this.fetch(); // refresh when opening
    }
  },

  async _onItemClick(id, type, postId) {
    // Mark as read
    if (id) await API.notifications.markRead(id);
    document.getElementById('_notif-panel')?.classList.add('hidden');
    
    const prefix = Layout._getPrefix();
    
    // Navigate based on notification type
    if (type === 'leave_request') {
      window.location.href = prefix + 'admin/leave-approval.html';
    } else if (type === 'request_submitted') {
      // Admin: go to requests management page
      window.location.href = prefix + 'admin/requests.html';
    } else if (type === 'request_status_updated') {
      // User: go to requests management page (will show their own requests)
      window.location.href = prefix + 'admin/requests.html';
    } else if (postId) {
      window.location.href = prefix + 'board.html#' + postId;
    }
    
    this.fetch();
  },

  async markAllRead() {
    await API.notifications.markAllRead();
    this.fetch();
  },

  async clearRead() {
    await API.notifications.clear();
    this.fetch();
  }
};

/* ══════════════════════════════════════════════════
   GlobalSearch  |  Ctrl+K overlay, cross-section
   ══════════════════════════════════════════════════ */
const GlobalSearch = {
  _focused: -1,
  _items: [],
  _searchTimer: null,
  _currentQuery: '',
  _currentOffset: 0,
  _total: 0,

  open() {
    const overlay = document.getElementById('gs-overlay');
    if (!overlay) return;
    // rAF ensures transition fires (overlay is always display:flex now)
    requestAnimationFrame(() => {
      overlay.classList.add('active');
      document.getElementById('gs-input')?.focus();
    });
    this._focused = -1;

    const input = document.getElementById('gs-input');
    if (!input._gsInit) {
      input._gsInit = true;
      input.addEventListener('input', () => {
        clearTimeout(this._searchTimer);
        const q = input.value.trim();
        if (!q) {
          this._showIdle();
          return;
        }
        this._searchTimer = setTimeout(() => this._doSearch(q), 280);
      });
      input.addEventListener('keydown', (e) => this._onKey(e));
    }
  },

  close() {
    document.getElementById('gs-overlay')?.classList.remove('active');
    const input = document.getElementById('gs-input');
    if (input) { input.value = ''; }
    this._showIdle();
    this._focused = -1;
    this._items = [];
    this._currentQuery = '';
    this._currentOffset = 0;
    this._total = 0;
  },

  _showIdle() {
    const r = document.getElementById('gs-results');
    if (r) r.innerHTML = `
      <div class="gs-idle">
        <div class="gs-idle-icon">⌕</div>
        <div>Type to search across the workspace</div>
        <div class="gs-idle-hint">Posts · Docs · People</div>
      </div>`;
  },

  async _doSearch(q, append = false) {
    const r = document.getElementById('gs-results');
    if (!append) {
      this._currentQuery = q;
      this._currentOffset = 0;
      this._items = [];
      if (r) r.innerHTML = `<div class="gs-idle"><div style="font-size:11px;color:var(--text-muted)">Searching...</div></div>`;
    }
    try {
      const res = await API.search.query(q, this._currentOffset);
      if (!res?.ok) { this._showNoResults(); return; }
      const { results, total } = res.data.data;
      this._total = total || 0;
      const newItems = results || [];
      this._items = append ? [...this._items, ...newItems] : newItems;
      this._currentOffset = this._items.length;
      this._renderResults(this._items, q, append);
    } catch (e) { this._showNoResults(); }
  },

  async _loadMore() {
    await this._doSearch(this._currentQuery, true);
  },

  _typeConfig(type) {
    if (type === 'post')  return { icon: '◫', label: 'Posts',  color: '#3b82f6' };
    if (type === 'sheet') return { icon: '⊞', label: 'Docs',   color: '#059669' };
    if (type === 'user')  return { icon: '👤', label: 'People', color: '#7c3aed' };
    return { icon: '⊕', label: 'Other', color: '#6b7280' };
  },

  _prefix() {
    try { return Layout._getPrefix(); } catch { return './'; }
  },

  _hrefFor(item) {
    const p = this._prefix();
    if (item.type === 'post')  return p + 'board.html#' + item.id;
    if (item.type === 'sheet') return item.url || p + 'sheets.html';
    if (item.type === 'user')  return p + 'profile.html?user=' + encodeURIComponent(item.id);
    return '#';
  },

  _renderResults(results, q, append = false) {
    const r = document.getElementById('gs-results');
    if (!r) return;
    if (!results.length) { this._showNoResults(); return; }

    // Group by type
    const groups = {};
    results.forEach((item, idx) => {
      const { label } = this._typeConfig(item.type);
      if (!groups[label]) groups[label] = [];
      groups[label].push({ ...item, _idx: idx });
    });

    this._focused = -1;

    let html = '';
    for (const [label, items] of Object.entries(groups)) {
      html += `<div class="gs-group-label">${label}</div>`;
      items.forEach(item => {
        const { icon } = this._typeConfig(item.type);
        const href = this._hrefFor(item);
        html += `
          <div class="gs-item" data-idx="${item._idx}" data-href="${escHtml(href)}" onclick="GlobalSearch._navigate('${escHtml(href)}')">
            <div class="gs-item-icon">${icon}</div>
            <div class="gs-item-body">
              <div class="gs-item-title">${escHtml(item.title || '')}</div>
              ${item.excerpt ? `<div class="gs-item-excerpt">${escHtml(item.excerpt)}</div>` : ''}
            </div>
            <div class="gs-item-right">
              <span class="gs-badge">${escHtml(item.badge || '')}</span>
              ${item.meta ? `<span class="gs-meta">${escHtml(item.meta)}</span>` : ''}
            </div>
          </div>`;
      });
    }

    const hasMore = this._currentOffset < this._total;
    if (hasMore) {
      const remaining = this._total - this._currentOffset;
      html += `<div style="text-align:center;padding:12px 0 4px">
        <button class="btn btn-ghost" style="font-size:12px" onclick="GlobalSearch._loadMore()">
          Load more · ${remaining} more
        </button>
      </div>`;
    } else if (this._total > 40) {
      html += `<div style="text-align:center;padding:8px 0;font-size:11px;color:var(--text-muted)">
        Showing all ${this._total} results
      </div>`;
    }

    r.innerHTML = html;
  },

  _showNoResults() {
    const r = document.getElementById('gs-results');
    if (r) r.innerHTML = `<div class="gs-no-results">No results found</div>`;
    this._items = [];
  },

  _navigate(href) {
    this.close();
    if (!href || href === '#') return;
    if (typeof Layout !== 'undefined' && Layout._spaNavigate) {
      Layout._spaNavigate(href);
    } else {
      window.location.href = href;
    }
  },

  _onKey(e) {
    if (e.key === 'Escape') { this.close(); return; }
    const items = document.querySelectorAll('.gs-item');
    if (!items.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[this._focused]?.classList.remove('focused');
      this._focused = (this._focused + 1) % items.length;
      items[this._focused]?.classList.add('focused');
      items[this._focused]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[this._focused]?.classList.remove('focused');
      this._focused = (this._focused - 1 + items.length) % items.length;
      items[this._focused]?.classList.add('focused');
      items[this._focused]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      const sel = items[this._focused];
      if (sel) {
        e.preventDefault();
        this._navigate(sel.dataset.href);
      }
    }
  }
};

/* ══════════════════════════════════════════════════
   Server-metrics heartbeat
   Every page contributes one ping per minute so the
   dev-system history accumulates as long as anyone is
   using the app — no cron required. Server throttles
   to 60s, so duplicate pings from concurrent users
   are O(1) no-ops.
   ══════════════════════════════════════════════════ */
(function () {
  if (typeof Auth === 'undefined' || typeof API === 'undefined') return;
  if (!Auth.getToken?.()) return; // unauth pages (login etc.) skip
  if (document.body?.dataset.skipMetricsHeartbeat === '1') return;

  const PING_MS  = 60000;  // 60s — matches server throttle
  const FIRST_MS = 15000;  // stagger first ping so cold loads aren't all at t=0

  let timer = null;
  let lastTriedAt = 0;

  function ping() {
    if (document.hidden) return;        // pause when tab hidden
    if (!Auth.getToken?.()) return;     // logged out
    const now = Date.now();
    if (now - lastTriedAt < PING_MS - 1000) return; // double-fire guard
    lastTriedAt = now;
    // Fire-and-forget; silent on error
    API.request('GET', '/dev/index.php?action=server-sample-ping').catch(() => {});
  }

  function start() {
    if (timer) return;
    // Pristine: shell-owned keepalive ping, guarded by `if (timer) return`.
    _NATIVE_setTimeout(() => {
      ping();
      timer = _NATIVE_setInterval(ping, PING_MS);
    }, FIRST_MS);
  }

  // Resume promptly when tab becomes visible again (catch the missed window)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) ping();
  });

  start();
})();

// ── GenZ theme injection ─────────────────────────────────────────
// Users flagged is_genz get a body class + a stylesheet override so their
// UI carries a distinct accent. Runs early to avoid a paint flash.
// Resolve absolute URL of genz-theme.css using the browser's own URL
// resolution on <script src="assets/js/layout.js"> — works from root
// pages, /admin/ pages, and sub-directory hosting alike.
function _genzThemeHref() {
  const scripts = document.getElementsByTagName('script');
  for (const s of scripts) {
    const abs = s.src || '';               // property = fully resolved URL
    const idx = abs.indexOf('/assets/js/layout.js');
    if (idx >= 0) return abs.substring(0, idx) + '/assets/css/genz-theme.css';
  }
  return 'assets/css/genz-theme.css';       // relative fallback
}
function _ensureGenzThemeLink() {
  if (document.querySelector('link[data-genz-theme]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = _genzThemeHref();
  link.setAttribute('data-genz-theme', '1');
  document.head.appendChild(link);
}

(function injectGenzTheme() {
  try {
    const u = (typeof Auth !== 'undefined' && Auth.getUser) ? Auth.getUser() : null;
    if (!u || !u.is_genz) return;
    const apply = () => { document.body && document.body.classList.add('is-genz'); };
    if (document.body) apply();
    else document.addEventListener('DOMContentLoaded', apply);
    _ensureGenzThemeLink();
  } catch { /* noop */ }
})();

// ── GenZ flag sync ──────────────────────────────────────────────
// The is_genz flag can be flipped by admins at any time; the local
// user cache (localStorage.som_user) only reflects the value from
// the last login. Refresh it silently on page load so a toggle
// takes effect on the next navigation without a re-login.
// DOM patch: ensure the "GenZ" pill exists inside the sidebar brand
// and the user-name chip whenever is_genz is true — even if the initial
// render happened while localStorage still held the pre-toggle user
// (login before is_genz was added, or admin flipped the flag mid-session).
function _ensureGenzBadges(present) {
  try {
    const logo = document.querySelector('.sidebar-logo .logo-text');
    if (logo) {
      const has = logo.querySelector('.genz-badge');
      if (present && !has) {
        const b = document.createElement('span');
        b.className = 'genz-badge';
        b.title = 'GenZ Team';
        b.textContent = 'GenZ';
        logo.appendChild(document.createTextNode(' '));
        logo.appendChild(b);
      } else if (!present && has) { has.remove(); }
    }
    const uname = document.querySelector('.sidebar-user .user-name');
    if (uname) {
      const has = uname.querySelector('.genz-badge');
      if (present && !has) {
        const b = document.createElement('span');
        b.className = 'genz-badge';
        b.title = 'GenZ Team member';
        b.textContent = 'GenZ';
        uname.appendChild(document.createTextNode(' '));
        uname.appendChild(b);
      } else if (!present && has) { has.remove(); }
    }
  } catch { /* noop */ }
}

// Belt-and-suspenders: run on every page load. If the current user is
// already flagged, the initial render should have inserted the badges —
// but if the sidebar came from the sb-restore cache (captured before
// the flag existed), patch it in-place.
(function initGenzBadges() {
  try {
    const u = (typeof Auth !== 'undefined' && Auth.getUser) ? Auth.getUser() : null;
    if (!u || !u.is_genz) return;
    const run = () => _ensureGenzBadges(true);
    if (document.readyState !== 'loading') run();
    else document.addEventListener('DOMContentLoaded', run);
    // Sidebar renders slightly after DOMContentLoaded on some pages — retry once.
    setTimeout(run, 300);
  } catch { /* noop */ }
})();

(function syncGenzFlag() {
  try {
    if (typeof Auth === 'undefined' || typeof API === 'undefined') return;
    const u = Auth.getUser();
    if (!u) return;
    setTimeout(() => {
      API.get('/auth/me.php').then(r => {
        if (!r?.ok) return;
        const fresh = r.data.data || r.data;
        const nowGenz = !!fresh.is_genz;
        const curU = Auth.getUser();
        if (!curU) return;
        if (!!curU.is_genz !== nowGenz) {
          curU.is_genz = nowGenz;
          localStorage.setItem(Auth.USER_KEY, JSON.stringify(curU));
          // Reflect immediately without a full reload: apply/remove class + inject/remove theme link.
          if (nowGenz) {
            document.body?.classList.add('is-genz');
            _ensureGenzThemeLink();
            // One-time welcome toast the first time we detect the flag flipped ON.
            try {
              if (!sessionStorage.getItem('_genz_welcomed') && window.Utils?.toast) {
                Utils.toast('✦ ยินดีต้อนรับสู่ GenZ Team — เปิดเมนู GenZ Hub ดูได้เลย', 'success', 5000);
                sessionStorage.setItem('_genz_welcomed', '1');
              }
            } catch { /* noop */ }
          } else {
            document.body?.classList.remove('is-genz');
            document.querySelector('link[data-genz-theme]')?.remove();
          }
          // Patch existing sidebar DOM in place so the pill appears/disappears
          // without waiting for a navigation.
          try { _ensureGenzBadges(nowGenz); } catch {}
          // Bump sidebar cache so GenZ Hub appears/disappears on next render.
          try { sessionStorage.removeItem('_sm_sb_html'); } catch {}
        }
      }).catch(() => {});
    }, 400);
  } catch { /* noop */ }
})();
