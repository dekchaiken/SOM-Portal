// weekly-report-form — page script, extracted from weekly-report-form.html.
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
  // super_viewer cannot add/edit weekly report data — bounce back silently.
  if (Auth.getUser?.()?.role === 'super_viewer') {
    window.location.replace('./weekly-report.html');
    throw new Error('super_viewer blocked from weekly-report-form');
  }
  Layout.render('weekly-report');

})();
