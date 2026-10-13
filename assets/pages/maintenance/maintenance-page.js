// maintenance — page script, extracted from maintenance.html.
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

(function () {
    // Derive API base from current URL — works with any deploy folder name.
    const API_BASE = (() => {
      const u = new URL(window.location.href);
      const root = u.pathname
        .replace(/\/(?:admin|assets)\/.*$/i, '')
        .replace(/\/[^\/]*\.html?$/i, '')
        .replace(/\/+$/, '');
      return u.origin + root + '/api';
    })();

    async function check() {
      try {
        const res = await fetch(API_BASE + '/maintenance/index.php', { cache: 'no-store' });
        const json = await res.json();
        const ma = json?.data;
        if (!ma) return;

        // Update message
        if (ma.global?.message) {
          document.getElementById('ma-message').textContent = ma.global.message;
        }

        // ETA
        const eta = ma.global?.eta;
        const etaRow = document.getElementById('eta-row');
        if (eta) {
          const d = new Date(eta);
          document.getElementById('eta-val').textContent =
            d.toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
          etaRow.classList.add('show');
        } else {
          etaRow.classList.remove('show');
        }

        // If MA lifted → redirect back
        if (!ma.global?.active) {
          window.location.replace('./index.html');
        }
      } catch (e) {}
    }

    // Retry countdown
    let secs = 15;
    const bar = document.getElementById('retry-bar');
    const tick = setInterval(() => {
      secs--;
      bar.textContent = `ตรวจสอบใหม่ใน ${secs}s...`;
      if (secs <= 0) {
        secs = 15;
        check();
      }
    }, 1000);

    check();
  })();

})();
