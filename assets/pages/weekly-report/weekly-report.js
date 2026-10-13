// weekly-report — page script, extracted from weekly-report.html.
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
  Layout.render('weekly-report');
  trackReportView('weekly_report');
  // SPA navigation: dashboard.js is already loaded (step ⑥ runs before inline
  // scripts at step ⑪) but .main-content is now in DOM — safe to init here.
  if (typeof WeeklyReportDashboard !== 'undefined') {
    // Reset old instance so SPA re-navigation always gets a fresh dashboard
    // bound to the new DOM elements injected by Layout.render().
    window.weeklyReportDashboard = null;
    WeeklyReportDashboard.start();
  }

})();
