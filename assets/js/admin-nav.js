/* ══════════════════════════════════════════════════
   admin-nav.js  |  Admin panel — two-row nav
   Row 1: click group tab → preview sub-items (no nav)
   Row 2: click page item → navigate
   ══════════════════════════════════════════════════ */

(function () {

// ── Lucide-style SVG icon helper (shared path registry) ──
const _AN_PATHS = {
  'layout-grid': '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  'users':       '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  'award':       '<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>',
  'calendar':    '<rect width="18" height="18" x="3" y="4" rx="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/>',
  'map':         '<polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" x2="9" y1="3" y2="18"/><line x1="15" x2="15" y1="6" y2="21"/>',
  'umbrella':    '<path d="M23 12a11.05 11.05 0 0 0-22 0zm-5 7a3 3 0 0 1-6 0v-7"/>',
  'megaphone':   '<path d="m3 11 19-9-9 19-2-8-8-2z"/>',
  'file-text':   '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/>',
  'layers':      '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  'board':       '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  'zap':         '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  'book':        '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  'book-open':   '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  'clipboard':   '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect width="8" height="4" x="8" y="2" rx="1"/>',
  'compass':     '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
  'bar-chart':   '<line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/>',
  'table':       '<path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/>',
  'link':        '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  'tool':        '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  'book-reader': '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  'plug':        '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8H6a2 2 0 0 0-2 2v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1a2 2 0 0 0-2-2z"/>',
  'settings':    '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  'server':      '<rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/>',
  'mail':        '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
  'phone':       '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.56 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  'sliders':     '<line x1="4" x2="4" y1="21" y2="14"/><line x1="4" x2="4" y1="6" y2="3"/><line x1="12" x2="12" y1="21" y2="12"/><line x1="12" x2="12" y1="6" y2="3"/><line x1="20" x2="20" y1="21" y2="16"/><line x1="20" x2="20" y1="10" y2="3"/><line x1="1" x2="7" y1="14" y2="14"/><line x1="9" x2="15" y1="12" y2="12"/><line x1="17" x2="23" y1="16" y2="16"/>',
  'flask':       '<path d="M9 3h6l1 9H8L9 3z"/><path d="M6.7 14.4C5 16 4 18 4 20a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2c0-2-1-4-2.7-5.6"/>',
  'grid':        '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  'smartphone':  '<rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/>',
  'bell':        '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  'clock':       '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  'refresh-cw':  '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  'monitor':     '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
  'shield':      '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  'wrench':      '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  'archive':     '<polyline points="21 8 21 21 3 21 3 8"/><rect width="22" height="5" x="1" y="3"/><line x1="10" x2="14" y1="12" y2="12"/>',
  'trending-up': '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
  'file-log':    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" x2="15" y1="13" y2="13"/><line x1="9" x2="12" y1="17" y2="17"/>',
  'trash':       '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  'terminal':    '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
  'search':      '<circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/>',
  'database':    '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
};
function _an(name, w = 14, h = 14) {
  const paths = _AN_PATHS[name] || _AN_PATHS['settings'];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

  const GROUPS = [
    {
      id: 'overview', icon: _an('layout-grid'), label: 'Overview',
      href: 'index.html',
      pages: []
    },
    {
      id: 'team', icon: _an('users'), label: 'Team',
      href: 'users.html',
      pages: [
        { id: 'users',              path: 'users.html',             icon: _an('users'),     label: 'Users'              },
        { id: 'achievements',       path: 'achievements.html',      icon: _an('award'),     label: 'Achievements'       },
        { id: 'schedule',           path: 'schedule.html',          icon: _an('calendar'),  label: 'Schedule'           },
        { id: 'holiday-plans',      path: 'holiday-plans.html',     icon: _an('map'),       label: 'Holiday Plans'      },
        { id: 'leave-approval',     path: 'leave-approval.html',    icon: _an('umbrella'),  label: 'Leave'              },
        { id: 'announcements',      path: 'announcements.html',     icon: _an('megaphone'), label: 'Announcements'      },
        { id: 'feature-requests',   path: 'feature-requests.html',  icon: _an('zap'),       label: 'Feature Requests',
          roles: ['sm_admin', 'dev_sm'] },
      ]
    },
    {
      id: 'content', icon: _an('layers'), label: 'Content',
      href: 'board.html',
      pages: [
        { id: 'board',          path: 'board.html',          icon: _an('board'),     label: 'Board'          },
        { id: 'templates',      path: 'templates.html',      icon: _an('zap'),       label: 'Jira Templates', features: ['jira-templates'] },
        { id: 'knowledge-base', path: 'knowledge-base.html', icon: _an('book'),      label: 'Knowledge Base', team: 'sm' },
        { id: 'courses',        path: 'courses.html',        icon: _an('book-open'), label: 'Courses'        },
        { id: 'exams',          path: 'exams.html',          icon: _an('clipboard'), label: 'Exams'          },
        { id: 'onboarding',     path: 'onboarding.html',     icon: _an('compass'),   label: 'Onboarding',     features: ['onboarding'] },
        { id: 'weekly-report',  path: 'weekly-report.html',  icon: _an('bar-chart'), label: 'Weekly Report',  features: ['weekly-report'] },
        { id: 'sheets',         path: 'sheets.html',         icon: _an('table'),     label: 'Docs',           features: ['sheets'] },
        { id: 'links',          path: 'links.html',          icon: _an('link'),      label: 'Links',          features: ['links'] },
        { id: 'tools',          path: 'tools.html',          icon: _an('tool'),      label: 'Sidebar Tools'  },
        { id: 'ops-runbook',    path: 'ops-runbook.html',    icon: _an('book-reader'), label: 'Ops Runbook', team: 'sm' },
      ]
    },
    {
      id: 'integrations', icon: _an('plug'), label: 'Integrations',
      href: 'mail-config.html',
      pages: [
        { id: 'jira-config',       path: 'jira-config.html',       icon: _an('settings'), label: 'Jira Config',  features: ['jira-templates'] },
        { id: 'jenkins-servers',   path: 'jenkins-servers.html',   icon: _an('server'),   label: 'Jenkins',      features: ['jenkins', 'batch-monitor'] },
        { id: 'grafana-sources',   path: 'grafana-sources.html',   icon: _an('server'),   label: 'Grafana Sources', team: 'sm' },
        { id: 'opensearch-config', path: 'opensearch-config.html', icon: _an('database'), label: 'OpenSearch',      team: 'sm' },
        { id: 'service-inventory', path: 'service-inventory.html', icon: _an('database'), label: 'Service Inventory', team: 'sm' },
        { id: 'mail-config',       path: 'mail-config.html',       icon: _an('mail'),     label: 'Mail Config'                         },
        { id: 'email-noti',        path: 'email-noti.html',        icon: _an('megaphone'), label: 'Email Noti',  features: ['notifications'] },
        { id: 'mail-logs',         path: 'mail-logs.html',         icon: _an('mail'),     label: 'Mail Logs'                           },
        { id: 'n8n-oncall-config', path: 'n8n-oncall-config.html', icon: _an('phone'),    label: 'On-Call',     features: ['jira-templates'] },
      ]
    },
    {
      id: 'operations', icon: _an('sliders'), label: 'Operations',
      href: 'ma-config.html',
      features: ['batch-monitor', 'ma-services', 'syncup', 'test-service', 'sms-gateway', 'alert-monitor', 'monitoring'],
      pages: [
        { id: 'ma-config',          path: 'ma-config.html',          icon: _an('wrench'),     label: 'MA Config',       features: ['ma-services'] },
        { id: 'ma-status',          path: 'ma-status.html',          icon: _an('monitor'),    label: 'MA Status',       features: ['ma-services'] },
        { id: 'ma-test-catalog',    path: 'ma-test-catalog.html',    icon: _an('clipboard'),  label: 'MA Test Catalog', team: 'sm' },
        { id: 'ma-test-plans',      path: 'ma-test-plans.html',      icon: _an('calendar'),   label: 'MA Test Plan',    team: 'sm' },
        { id: 'ma-test-overview',   path: 'ma-test-overview.html',   icon: _an('bar-chart'),  label: 'MA Test Overview',team: 'sm' },
        { id: 'test-service',       path: 'test-service.html',       icon: _an('flask'),      label: 'Test Service',    features: ['test-service'] },
        { id: 'batch-monitor',      path: 'batch-monitor.html',      icon: _an('grid'),       label: 'Batch Monitor',   features: ['batch-monitor'] },
        { id: 'batch-meta',         path: 'batch-meta.html',         icon: _an('settings'),   label: 'Batch Meta',      features: ['batch-monitor'] },
        { id: 'batch-file-index',   path: 'batch-file-index.html',   icon: _an('search'),     label: 'Batch File Index',features: ['batch-monitor'] },
        { id: 'alert-monitor-config', path: 'alert-monitor-config.html', icon: _an('bell'),   label: 'Alert Monitor',   features: ['alert-monitor'] },
        { id: 'sms-gateway-config', path: 'sms-gateway-config.html', icon: _an('smartphone'), label: 'SMS Gateway',     features: ['sms-gateway'] },
        { id: 'fh-config',          path: 'fh-config.html',          icon: _an('mail'),       label: 'FH Email',        features: ['inbox'] },
        { id: 'scheduled-noti',     path: 'scheduled-noti.html',     icon: _an('bell'),       label: 'Notifications',   features: ['notifications'] },
        { id: 'batch-monitor-noti', path: 'batch-monitor-noti.html', icon: _an('bell'),       label: 'Batch Noti',      features: ['batch-monitor'] },
        // Admin PW Schedule config stays SM-only regardless of the pw-schedule
        // view-feature grant — non-SM teams get the read sidebar entry, not
        // the ability to edit rounds. Backend writes enforce this via
        // requireSmForShared() at the pw-schedule/*.php endpoints.
        { id: 'pw-schedule',        path: 'pw-schedule.html',        icon: _an('clock'),      label: 'PW Schedule',     team: 'sm' },
        { id: 'syncup-config',      path: 'syncup-config.html',      icon: _an('refresh-cw'), label: 'Sync-up',         features: ['syncup'] },
        { id: 'system-monitor',     path: 'system-monitor.html',     icon: _an('monitor'),    label: 'System Monitor',  features: ['monitoring'] },
        { id: 'service-severity',         path: 'service-severity.html',         icon: _an('shield'), label: 'Service Severity',    features: ['service-severity'] },
        { id: 'incident-launcher-config', path: 'incident-launcher-config.html', icon: _an('zap'),    label: 'Incident Launcher',   team: 'sm', roles: ['sm_admin', 'dev_sm', 'sm_lead'] },
      ]
    },
    {
      id: 'system', icon: _an('shield'), label: 'System',
      href: 'system-settings.html',
      pages: [
        { id: 'system-settings', path: 'system-settings.html', icon: _an('settings'),    label: 'Settings',    team: 'sm' },
        { id: 'menu-permissions', path: 'menu-permissions.html', icon: _an('shield'),     label: 'Menu Access'},
        { id: 'nav-groups',      path: 'nav-groups.html',      icon: _an('layout'),      label: 'Navbar Groups', roles: ['sm_admin', 'dev_sm'] },
        { id: 'backup',          path: 'backup.html',          icon: _an('archive'),      label: 'Backup',      team: 'sm' },
        { id: 'analytics',       path: 'analytics.html',       icon: _an('trending-up'),  label: 'Analytics'   },
        { id: 'trash',           path: 'trash.html',           icon: _an('trash'),        label: 'Trash',       team: 'sm' },
      ]
    },
    {
      id: 'platform', icon: _an('layout-grid'), label: '<i data-icon="zap"></i> Platform',
      href: 'super-admin.html',
      roles: ['super_admin'],
      pages: [
        { id: 'super-admin',             path: 'super-admin.html',             icon: _an('layout-grid'), label: 'All Teams'         },
        { id: 'super-team-permissions',  path: 'super-team-permissions.html',  icon: _an('shield'),      label: 'Team Permissions'  },
        { id: 'super-viewer',            path: 'super-viewer.html',            icon: _an('shield'),      label: 'Super Viewer'      },
        { id: 'super-feature-requests',  path: 'super-feature-requests.html',  icon: _an('bell'),        label: 'Feature Requests'  },
        { id: 'requests',                path: 'requests.html',                icon: _an('file-text'),   label: 'User Requests'     },
        { id: 'super-email-templates',   path: 'super-email-templates.html',   icon: _an('mail'),        label: 'Email Templates'   },
        { id: 'maintenance',             path: 'maintenance.html',             icon: _an('wrench'),      label: 'Maintenance'       },
        { id: 'logs',                    path: 'logs.html',                    icon: _an('file-log'),    label: 'Audit Log'         },
      ]
    },
    {
      id: 'devtools', icon: _an('terminal'), label: '<i data-icon="zap"></i> Dev',
      href: 'devtools.html',
      roles: ['dev_sm'],
      pages: [
        { id: 'devtools',   path: 'devtools.html',   icon: _an('layout-grid'), label: 'Overview'       },
        { id: 'dev-system', path: 'dev-system.html', icon: _an('monitor'),     label: 'System Monitor' },
        { id: 'dev-api',    path: 'dev-api.html',    icon: _an('zap'),         label: 'API Explorer'   },
        { id: 'dev-logs',   path: 'dev-logs.html',   icon: _an('file-log'),    label: 'Log Viewer'     },
        { id: 'dev-email',  path: 'dev-email.html',  icon: _an('mail'),        label: 'Email Tester'   },
        { id: 'dev-data',   path: 'dev-data.html',   icon: _an('archive'),     label: 'Data Inspector' },
      ]
    },
  ];

  /* ── CSS ─────────────────────────────────────────── */
  const CSS = `
    .admin-subnav-wrap {
      flex-shrink: 0;
      background: var(--bg-card, #fff);
    }

    /* ── Row 1: group tabs ── */
    .admin-nav-groups {
      display: flex;
      align-items: stretch;
      height: 42px;
      padding: 0 20px;
      gap: 0;
      overflow-x: auto;
      scrollbar-width: none;
      border-bottom: 1px solid var(--border);
    }
    .admin-nav-groups::-webkit-scrollbar { display: none; }

    .admin-nav-group-tab {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 0 14px;
      font-size: 11.5px;
      font-weight: 600;
      color: var(--text-muted);
      text-decoration: none;
      white-space: nowrap;
      border: none;
      border-bottom: 2px solid transparent;
      border-top: 2px solid transparent;
      flex-shrink: 0;
      font-family: var(--font);
      cursor: pointer;
      background: transparent;
      transition: color .13s, border-color .15s, background .13s;
      letter-spacing: .005em;
      position: relative;
    }
    .admin-nav-group-tab .g-icon {
      font-size: 13px;
      line-height: 1;
      opacity: .6;
      transition: opacity .13s;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .admin-nav-group-tab .g-icon svg { width: 14px; height: 14px; display: block; }
    .admin-nav-group-tab:hover {
      color: var(--text);
      background: rgba(242,100,25,.04);
    }
    .admin-nav-group-tab:hover .g-icon { opacity: 1; }

    /* selected (previewing sub-items) */
    .admin-nav-group-tab.selected {
      color: var(--orange);
      border-bottom-color: var(--orange);
      font-weight: 700;
    }
    .admin-nav-group-tab.selected .g-icon { opacity: 1; }

    /* dot = this group contains the current page (even when not selected) */
    .admin-nav-group-tab.has-current-page::after {
      content: '';
      position: absolute;
      bottom: 6px;
      left: 50%;
      transform: translateX(-50%);
      width: 3px;
      height: 3px;
      border-radius: 50%;
      background: var(--orange);
      opacity: .55;
    }
    .admin-nav-group-tab.selected.has-current-page::after { display: none; }

    /* ── Row 2: page items ── */
    .admin-nav-pages {
      align-items: stretch;
      height: 34px;
      padding: 0 20px;
      gap: 0;
      overflow-x: auto;
      scrollbar-width: none;
      border-bottom: 1px solid var(--border);
      background: rgba(0,0,0,.018);
      position: relative;
      display: none;
    }
    html[data-theme="dark"] .admin-nav-pages { background: rgba(255,255,255,.025); }
    .admin-nav-pages::-webkit-scrollbar { display: none; }
    .admin-nav-pages.visible { display: flex; }

    /* slide-in animation when switching groups */
    @keyframes _row2In {
      from { opacity: 0; transform: translateY(-4px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .admin-nav-pages.visible { animation: _row2In .14s ease both; }

    /* scroll fade masks */
    .admin-nav-pages::before,
    .admin-nav-pages::after {
      content: '';
      position: absolute;
      top: 0; bottom: 0; width: 24px;
      pointer-events: none; z-index: 1;
      opacity: 0; transition: opacity .18s;
    }
    .admin-nav-pages::before { left: 0;  background: linear-gradient(to right, var(--bg-card, #fff), transparent); }
    .admin-nav-pages::after  { right: 0; background: linear-gradient(to left,  var(--bg-card, #fff), transparent); }
    html[data-theme="dark"] .admin-nav-pages::before { background: linear-gradient(to right, #1c1f26, transparent); }
    html[data-theme="dark"] .admin-nav-pages::after  { background: linear-gradient(to left,  #1c1f26, transparent); }
    .admin-nav-pages.can-scroll-left::before  { opacity: 1; }
    .admin-nav-pages.can-scroll-right::after  { opacity: 1; }

    .admin-nav-page-link {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 0 10px;
      font-size: 10.5px;
      font-weight: 500;
      color: var(--text-muted);
      text-decoration: none;
      white-space: nowrap;
      border-bottom: 2px solid transparent;
      border-top: 2px solid transparent;
      flex-shrink: 0;
      font-family: var(--font);
      transition: color .12s, border-color .13s, background .12s;
      letter-spacing: .01em;
    }
    .admin-nav-page-link .p-icon {
      font-size: 11px;
      line-height: 1;
      opacity: .55;
      transition: opacity .12s;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .admin-nav-page-link .p-icon svg { width: 13px; height: 13px; display: block; }
    .admin-nav-page-link:hover {
      color: var(--text);
      background: rgba(242,100,25,.04);
    }
    .admin-nav-page-link:hover .p-icon { opacity: 1; }
    .admin-nav-page-link.active {
      color: var(--orange);
      border-bottom-color: var(--orange);
      font-weight: 700;
    }
    .admin-nav-page-link.active .p-icon { opacity: 1; }

    /* ── Dev group tab — special red/terminal look ── */
    .dev-group-tab {
      color: #cc2222 !important;
      letter-spacing: .02em;
    }
    .dev-group-tab .g-icon { opacity: .8 !important; }
    .dev-group-tab:hover {
      color: #ff3333 !important;
      background: rgba(255,32,32,.06) !important;
    }
    .dev-group-tab.selected {
      color: #ff2020 !important;
      border-bottom-color: #ff2020 !important;
    }
    .dev-group-tab.has-current-page::after { background: #ff2020 !important; }
    html[data-theme="dark"] .dev-group-tab { color: #ff4040 !important; }

    /* ── Responsive ── */
    @media (max-width: 1600px) {
      .admin-nav-groups  { height: 34px !important; padding: 0 12px !important; }
      .admin-nav-pages   { height: 28px !important; padding: 0 12px !important; }
      .admin-nav-group-tab { padding: 0 10px !important; font-size: 10px !important; }
      .admin-nav-group-tab .g-icon { font-size: 11px !important; }
      .admin-nav-page-link { padding: 0 8px !important; font-size: 9.5px !important; }
      .admin-nav-page-link .p-icon { font-size: 10px !important; }
    }
  `;

  /* ── Inject maintenance.js ───────────────────────── */
  if (!document.querySelector('script[data-ma-loader]')) {
    // Derive app root from THIS script's src so it works with any deploy folder.
    const cur = document.querySelector('script[src*="assets/js/admin-nav.js"]');
    const base = cur ? cur.src.replace(/\/assets\/js\/admin-nav\.js.*$/i, '') : '';
    const s = document.createElement('script');
    s.src = base + '/assets/js/maintenance.js?v=20260724';
    s.dataset.maLoader = '1';
    document.head.appendChild(s);
  }

  /* ── Render ──────────────────────────────────────── */
  function render() {
    const currentId = window.location.pathname.split('/').pop().replace('.html', '') || 'index';
    const userRole  = (typeof Auth !== 'undefined' && Auth.getUser?.()?.role) || '';

    /* inject CSS once */
    if (!document.getElementById('_admin-nav-css')) {
      const s = document.createElement('style');
      s.id = '_admin-nav-css';
      s.textContent = CSS;
      document.head.appendChild(s);
    }

    /* find which group the current page belongs to */
    let currentGroupId = 'overview';
    for (const g of GROUPS) {
      if (g.roles && !g.roles.includes(userRole)) continue; // skip role-gated groups
      if (g.id === 'overview' && currentId === 'index') break;
      const hit = g.pages?.find(p => p.id === currentId && (!p.roles || p.roles.includes(userRole)));
      if (hit) { currentGroupId = g.id; break; }
    }

    const wrap = document.createElement('div');
    wrap.className = 'admin-subnav-wrap';

    /* ── Row 1: group tabs ── */
    const groupRow = document.createElement('div');
    groupRow.className = 'admin-nav-groups';

    const tabEls = {}; // id → element

    GROUPS.forEach(g => {
      /* skip groups restricted to roles the current user doesn't have */
      if (g.roles && !g.roles.includes(userRole)) return;

      /* skip groups that require features the current team doesn't have
         — null team_features means super_admin (sees everything) */
      const teamFeatures = Auth.getTeamFeatures?.();
      if (g.features && teamFeatures !== null) {
        const hasAny = g.features.some(f => (teamFeatures || []).includes(f));
        if (!hasAny) return;
      }

      const tab = document.createElement(g.pages.length === 0 ? 'a' : 'button');
      tab.className = 'admin-nav-group-tab';
      if (g.pages.length === 0) tab.href = g.href; // Overview = normal link
      tab.dataset.group = g.id;
      tab.innerHTML = `<span class="g-icon">${g.icon}</span>${g.label}`;

      /* special styling for the dev group */
      if (g.id === 'devtools') tab.classList.add('dev-group-tab');

      /* dot: this group contains the current page */
      if (g.id === currentGroupId && g.id !== 'overview') {
        tab.classList.add('has-current-page');
      }

      tabEls[g.id] = tab;
      groupRow.appendChild(tab);
    });

    wrap.appendChild(groupRow);

    /* ── Row 2: single shared container, content swaps on click ── */
    const pageRow = document.createElement('div');
    pageRow.className = 'admin-nav-pages';
    wrap.appendChild(pageRow);

    /* helper: fill Row 2 with a group's pages */
    function showGroup(groupId) {
      const g = GROUPS.find(x => x.id === groupId);
      const teamFeatures     = Auth.getTeamFeatures?.();
      const teamFeaturePages = Auth.getTeamFeaturePages?.() || {};
      // Effective team: for super_admin it's the view-as team (null = All Teams
      // = show everything). For team admins it's their own team. Team-locked
      // pages (team: 'sm') are hidden when the effective team doesn't match.
      const _viewAs = (typeof Auth !== 'undefined' && Auth._getViewAsTeam) ? Auth._getViewAsTeam() : null;
      const _me = (typeof Auth !== 'undefined') ? Auth.getUser?.() : null;
      const effectiveTeam = (_me?.role === 'super_admin') ? (_viewAs?.slug || null) : (_me?.team || null);
      const visiblePages = (g?.pages || []).filter(p => {
        if (p.roles && !p.roles.includes(userRole)) return false;
        // Team lock: page is exclusive to one team (e.g. SM-only management tools)
        if (p.team && effectiveTeam !== null && effectiveTeam !== p.team) return false;
        if (p.features && teamFeatures !== null) {
          const ownedByTeam = p.features.filter(f => (teamFeatures || []).includes(f));
          if (!ownedByTeam.length) return false;
          // Page-level grant check — OR-semantics: page is visible if ANY owning
          // feature grants it. A missing plan for a feature counts as "all granted".
          // Prevents shared pages (e.g. jenkins-servers, which belongs to both
          // 'jenkins' and 'batch-monitor') from being hidden when only one feature's
          // plan is customized.
          const grantedByAny = ownedByTeam.some(f => {
            const pagePlan = teamFeaturePages[f];
            if (!pagePlan || !Array.isArray(pagePlan.admin_pages)) return true;
            return pagePlan.admin_pages.includes(p.id);
          });
          if (!grantedByAny) return false;
        }
        return true;
      });

      /* update Row 1 selected state */
      Object.values(tabEls).forEach(t => t.classList.remove('selected'));
      tabEls[groupId]?.classList.add('selected');

      /* hide Row 2 if no pages (Overview) */
      if (!visiblePages.length) {
        pageRow.classList.remove('visible');
        return;
      }

      /* rebuild Row 2 content */
      pageRow.innerHTML = visiblePages.map(p => {
        const isActive = p.id === currentId;
        return `<a class="admin-nav-page-link${isActive ? ' active' : ''}" href="${p.path}">` +
               `<span class="p-icon">${p.icon}</span>${p.label}</a>`;
      }).join('');

      pageRow.classList.remove('visible'); // remove to retrigger animation
      requestAnimationFrame(() => {
        pageRow.classList.add('visible');
        updateFades(pageRow);
        pageRow.addEventListener('scroll', () => updateFades(pageRow), { passive: true, once: false });

        /* scroll current page into view */
        const activeLink = pageRow.querySelector('.active');
        if (activeLink) activeLink.scrollIntoView({ inline: 'nearest', block: 'nearest' });
      });
    }

    /* bind click on group tabs with sub-items */
    GROUPS.forEach(g => {
      if (!g.pages.length) return; // Overview: default <a> link behaviour
      if (!tabEls[g.id]) return;  // hidden (role-gated)
      tabEls[g.id].addEventListener('click', e => {
        e.preventDefault();
        showGroup(g.id);
      });
    });

    /* insert into DOM — anchor to team switcher (if super_admin has it) so
       the admin sub-nav lands under the switcher, not between it and topbar. */
    const topbar = document.querySelector('.topbar');
    if (topbar?.parentElement) {
      const anchor = document.getElementById('_tsw-bar') || topbar;
      anchor.insertAdjacentElement('afterend', wrap);
    }

    /* initialise: show current group's sub-items */
    showGroup(currentGroupId);
  }

  function updateFades(row) {
    const sl    = row.scrollLeft;
    const maxSl = row.scrollWidth - row.clientWidth;
    row.classList.toggle('can-scroll-left',  sl > 4);
    row.classList.toggle('can-scroll-right', sl < maxSl - 4);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    // Topbar may not exist yet if Layout.render is still async (e.g. first visit
    // with no sessionStorage cache). Use MutationObserver as fallback.
    const topbar = document.querySelector('.topbar');
    if (topbar?.parentElement) {
      render();
    } else {
      const obs = new MutationObserver(() => {
        const tb = document.querySelector('.topbar');
        if (tb?.parentElement) { obs.disconnect(); render(); }
      });
      obs.observe(document.body || document.documentElement, {
        childList: true, subtree: true,
      });
    }
  }

})();
