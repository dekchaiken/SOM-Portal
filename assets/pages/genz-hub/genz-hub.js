// genz-hub — page script, extracted from genz-hub.html.
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

if (!Auth.requireAuth()) {}
Layout.render('genz-hub');

(function guard() {
  const u = Auth.getUser();
  if (!u) return;
  if (u.team !== 'sm' || !u.is_genz) {
    document.querySelector('.page-content').innerHTML =
      '<div style="padding:40px;text-align:center;color:#ef4444;font-weight:700;font-family:\'Space Grotesk\',sans-serif">— members only —</div>';
    throw new Error('forbidden');
  }
})();

const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const initials = n => (n || '?').split(/\s+/).filter(Boolean).slice(0,2).map(w => w[0].toUpperCase()).join('');

(function greet() {
  const u = Auth.getUser();
  const first = (u?.name || u?.username || 'friend').split(/\s+/)[0].toLowerCase();
  document.getElementById('gzh-hello').textContent = first;
})();

// Case Notes count on hub
(async function notesCount() {
  try {
    const r = await API.genzNotes.list();
    const n = r?.ok ? (r.data.data || []).length : 0;
    if (n > 0) {
      const el = document.getElementById('gzh-notes-count');
      el.textContent = n;
      el.style.display = 'inline-block';
    }
  } catch { /* noop */ }
})();

(async function roster() {
  const r = await API.genzTeam.list();
  const rows = (r?.ok ? (r.data.data || []) : []).filter(u => u.is_genz);
  const avs  = document.getElementById('gzh-avs');
  const more = document.getElementById('gzh-more');
  if (!rows.length) {
    avs.innerHTML = '';
    more.innerHTML = '<span class="gzh-empty">no members yet — invite your crew ✦</span>';
    return;
  }
  const MAX = 8;
  const shown = rows.slice(0, MAX);
  avs.innerHTML = shown.map(u => `
    <div class="gzh-av" title="${esc(u.name)} · @${esc(u.username)}">
      ${u.avatar_url ? `<img src="${esc(u.avatar_url)}" alt="">` : esc(initials(u.name))}
    </div>`).join('');
  const extra = rows.length - shown.length;
  more.textContent = extra > 0 ? `+ ${extra} more` : `${rows.length} member${rows.length > 1 ? 's' : ''}`;
})();

})();
