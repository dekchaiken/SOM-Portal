// dev-hub — page script, extracted from dev-hub.html.
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

const _u = Auth.getUser();

// ── Subteam badge ─────────────────────────────────────────────────────────────
(function() {
  const sub = _u?.dev_subteam;
  if (!sub) return;
  const wrap = document.getElementById('dh-subteam-wrap');
  if (!wrap) return;
  wrap.innerHTML = `<div class="dh-subteam-badge">
    <i data-icon="layers" style="width:11px;height:11px"></i>
    ${escHtml(sub)}
  </div>`;
})();

Layout.render('dev-hub');
Announcements.init('main-content');

// ── Load About SOM data ───────────────────────────────────────────────────────
(async function() {
  try {
    const res  = await API.aboutPage.get();
    // API wraps data inside res.data.data (respondOk envelope) or res.data
    const d    = res?.data?.data || res?.data || {};
    const teams = Array.isArray(d.org_teams) ? d.org_teams : [];

    // Stats
    const totalMembers = teams.reduce((s, t) => s + (t.count || 0), 0);
    const mEl = document.getElementById('dh-members');
    const tEl = document.getElementById('dh-teams');
    if (mEl) { mEl.textContent = totalMembers; mEl.classList.remove('sk'); }
    if (tEl) { tEl.textContent = teams.length;  tEl.classList.remove('sk'); }

    // Team strips
    const stripsEl = document.getElementById('dh-strips');
    if (!stripsEl) return;

    if (!teams.length) {
      stripsEl.innerHTML = `<div class="dh-strip"><div class="dh-strip-name" style="color:var(--text-muted)">ยังไม่มีข้อมูลทีม</div></div>`;
      return;
    }

    stripsEl.innerHTML = teams.slice(0, 7).map(t => `
      <div class="dh-strip">
        <div class="dh-strip-dot" style="background:${escHtml(t.color || '#6366f1')}"></div>
        <div class="dh-strip-name">${escHtml(t.name || t.slug || '—')}</div>
        <div class="dh-strip-cnt">${t.count || 0} คน</div>
      </div>`).join('');

    if (window.Icons?.renderAll) Icons.renderAll();
  } catch (e) {
    const stripsEl = document.getElementById('dh-strips');
    if (stripsEl) stripsEl.innerHTML = '';
  }
})();

})();
