/* ══════════════════════════════════════════════════════════════
   mobile-nav.js  |  SOM Portal
   ──────────────────────────────────────────────────────────────
   style.css defines the off-canvas drawer at ≤768px
   (.sidebar{translateX(-100%)} / .sidebar.open{translateX(0)}),
   but nothing ever applied `.open` — so on a phone the sidebar
   was unreachable. This adds the trigger and dismissal only.

   Self-contained on purpose: no edits to layout.js, no globals,
   idempotent, and inert above 768px.
   ══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var MQ = '(max-width: 768px)';
  var BTN_ID = 'sm-mobile-nav-toggle';

  function sidebar() { return document.querySelector('.sidebar'); }

  function icon(open) {
    return open
      ? '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
      : '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';
  }

  function isOpen() {
    var sb = sidebar();
    return !!sb && sb.classList.contains('open');
  }

  function setOpen(open) {
    var sb = sidebar();
    if (!sb) return;
    sb.classList.toggle('open', open);
    document.body.style.overflow = open ? 'hidden' : '';
    var btn = document.getElementById(BTN_ID);
    if (btn) {
      btn.innerHTML = icon(open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    }
  }

  function build() {
    if (document.getElementById(BTN_ID)) return;

    // Sit inside the topbar when there is one, so it inherits page chrome.
    var host = document.querySelector('.topbar');
    var btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.innerHTML = icon(false);
    btn.setAttribute('aria-label', 'Open navigation');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', 'sidebar');

    var css = 'display:none;align-items:center;justify-content:center;' +
      'width:40px;height:40px;flex:0 0 auto;padding:0;margin-right:4px;' +
      'border:1px solid var(--border);border-radius:var(--radius,7px);' +
      'background:var(--bg-card);color:var(--text);cursor:pointer;';
    if (host) {
      btn.style.cssText = css;
      host.insertBefore(btn, host.firstChild);
    } else {
      // No topbar on this page — float it, respecting notches.
      btn.style.cssText = css +
        'position:fixed;top:max(10px,env(safe-area-inset-top));' +
        'left:max(10px,env(safe-area-inset-left));z-index:150;' +
        'box-shadow:var(--shadow,0 1px 3px rgba(0,0,0,.12));';
      document.body.appendChild(btn);
    }

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      setOpen(!isOpen());
    });

    sync();
  }

  // Show the trigger only while the drawer layout is active AND there is a
  // sidebar for it to open — a button that opens nothing is worse than none.
  function sync() {
    var btn = document.getElementById(BTN_ID);
    if (!btn) return;
    var mobile = window.matchMedia(MQ).matches;
    btn.style.display = (mobile && sidebar()) ? 'inline-flex' : 'none';
    if (!mobile) setOpen(false);
  }

  // Tap the scrim / outside the drawer to dismiss.
  document.addEventListener('click', function (e) {
    if (!isOpen()) return;
    if (!window.matchMedia(MQ).matches) return;
    var sb = sidebar();
    if (sb && !sb.contains(e.target) && e.target.id !== BTN_ID) setOpen(false);
  }, true);

  // Escape closes it.
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isOpen()) setOpen(false);
  });

  // Following a nav link should not leave the drawer hanging open.
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('.sidebar a[href]') : null;
    if (a && isOpen()) setOpen(false);
  });

  window.addEventListener('resize', sync);

  // layout.js injects the sidebar after this script runs, so wait for it —
  // but build the trigger regardless once the wait is over. Some deployments
  // and role/permission combinations never render a sidebar; the button must
  // still exist (and stay hidden) rather than the boot silently aborting.
  function boot() {
    if (sidebar()) { build(); watchForSidebar(); return; }
    var tries = 0;
    var iv = setInterval(function () {
      if (sidebar()) { clearInterval(iv); build(); watchForSidebar(); }
      else if (++tries > 60) { clearInterval(iv); build(); watchForSidebar(); }
    }, 100);
  }

  // The sidebar can be replaced later (warm-cache restore, re-render).
  // Keep the trigger's visibility in step with whatever is in the DOM now.
  function watchForSidebar() {
    if (!window.MutationObserver || !document.body) return;
    var mo = new MutationObserver(function () { sync(); });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
