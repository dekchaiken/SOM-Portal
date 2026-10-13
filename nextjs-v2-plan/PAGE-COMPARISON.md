# Page Comparison — v1 PHP vs v2 Next.js

Snapshot date: **2026-10-12** (end of Phase 1).
Source of v1 inventory: `nextjs-v2-plan/research/inventory.md`.
Source of v2 inventory: `find som-portal-v2/app -name "page.tsx"`.

## Headline

| | v1 active | v2 shipped | % |
|---|---|---|---|
| User-facing pages | ~65 (88 total − 23 mockup/backup/dead) | 8 | **12%** |
| Admin pages | ~69 (73 total − 4 mockup) | 6 | **9%** |
| **Total** | **~134** | **14** | **10%** |

Phase 1 scope locked in [`tickets/T-08-migration-order.md`](tickets/T-08-migration-order.md) is **shipped**: Login → Dashboard → Board → Jira templates → Jenkins → Admin users/system-settings → Admin menu-perms/nav-groups/super-team-perms. SM team can dog-food on v2 for daily board + jira flows.

Note: v2 user-page count is 8, not 10 as previously reported — `app/(public)/forgot-password/` and `app/(public)/reset-password/` folders exist but have **no `page.tsx`** (A6 shipped the API endpoints but not the UI pages). This is the first bug to close.

---

## USER PAGES

### Auth / Account
| v1 | v2 | Status | Tier |
|---|---|---|---|
| index.html (login) | `/v2/login` | ✅ | T1 |
| forgot-password.html | `app/(public)/forgot-password/` | ❌ **empty dir** (API only) | T1 |
| reset-password.html | `app/(public)/reset-password/` | ❌ **empty dir** (API only) | T1 |
| change-password.html | `/v2/settings` tab | ✅ | T1 |
| profile.html | `/v2/settings` tab | ✅ | T1 |
| settings.html | `/v2/settings` | ✅ | T2 |

### Home group
| v1 | v2 | Status | Tier |
|---|---|---|---|
| dashboard.html | `/v2/dashboard` | ✅ | T1 |
| my-team.html | — | ⏳ Phase 3 | T2 |
| about-som.html | — | ⏳ Phase 3 | T2 |
| schedule.html | — | ⏳ Phase 3 | T2 |
| pw-schedule.html | — | ⏳ Phase 3 | T2 |
| sheets.html | — | ⏳ Phase 3 | T3 |
| sabai.html | — | ⏳ Phase 3 | T3 |
| onboarding.html | — | ⏳ Phase 3 | T3 |

### Ops group
| v1 | v2 | Status | Tier |
|---|---|---|---|
| board.html | `/v2/board` + `/[id]` + `/trash` | ✅ | T1 |
| jira-templates.html | `/v2/jira-templates` | ✅ | T1 |
| jenkins-build.html | `/v2/jenkins-build` | ✅ | T2 |
| send-email.html | — | 🔄 Phase 2 (uses jira+mail) | T1 |
| case-incidents.html | — | 🔄 Phase 2 | T1 |
| incident-launcher.html | — | 🔄 Phase 2 | T1 |
| inbox.html | — | ⏳ Phase 3 | T2 |
| batch-monitor.html + v2 | — | ⏳ Phase 3 | T2 |
| batch-file-search.html | — | ⏳ Phase 3 | T2 |
| jenkins-portal.html | — | ⏳ Phase 3 | T2 |
| so-jenkins.html | — | ⏳ Phase 3 | T3 |
| migrate-user.html | — | ⏳ Phase 3 | T3 |
| sms-gateway-switches.html | — | ⏳ Phase 3 | T3 |
| analytics.html | — | ⏳ Phase 3 | T3 |
| weekly-report.html + form + report-center | — | ⏳ Phase 3 | T2 |

### Monitor group — **Phase 2 target (all T1 for SM)**
| v1 | v2 | Status | Tier |
|---|---|---|---|
| service-performance.html | — | 🔄 Phase 2 (uses `research/promql-tag.md`) | T1 |
| restart-monitor.html | — | 🔄 Phase 2 | T1 |
| restart-analyzer.html | — | 🔄 Phase 2 | T1 |
| log-explorer.html | — | 🔄 Phase 2 (uses `research/opensearch-creds.md`) | T1 |
| alert-monitor.html | — | ⏳ Phase 3 | T2 |
| monitoring.html | — | ⏳ Phase 3 | T2 |
| uptime.html | — | ⏳ Phase 3 | T2 |
| grafana-alerts.html | — | ⏳ Phase 3 | T2 |
| begin-grafana.html | — | ⏳ Phase 3 | T2 |
| syncup.html | — | ⏳ Phase 3 | T3 |
| test-service.html | — | ⏳ Phase 3 | T2 |

### MA group — **Phase 2 target**
| v1 | v2 | Status | Tier |
|---|---|---|---|
| ma-services.html | — | 🔄 Phase 2 | T1 |
| ma-status.html | — | 🔄 Phase 2 | T1 |
| ma-test.html | — | ⏳ Phase 3 | T2 |
| ma-planwork.html | — | ⏳ Phase 3 | T3 |
| import-ma.html | — | ⏳ Phase 3 | T3 |

### Learn / Knowledge
| v1 | v2 | Status | Tier |
|---|---|---|---|
| learn.html | — | ⏳ Phase 3 | T3 |
| learn-course.html | — | ⏳ Phase 3 | T3 |
| learn-phase.html | — | ⏳ Phase 3 | T3 |
| learn-reports.html | — | ⏳ Phase 3 | T3 |
| exam.html | — | ⏳ Phase 3 | T3 |
| exam-reports.html | — | ⏳ Phase 3 | T3 |
| knowledge-base.html | — | ⏳ Phase 3 | T3 |
| ops-runbook.html | — | ⏳ Phase 3 | T3 |
| documentation.html | — | ⏳ Phase 3 | T3 |
| setup-guide.html | — | ⏳ Phase 3 | T3 |

### GenZ / Dev / Reports / Misc
| v1 | v2 | Status | Tier |
|---|---|---|---|
| genz-hub.html | — | ⏳ Phase 3 | T3 |
| genz-notes.html | — | ⏳ Phase 3 | T3 |
| dev-hub.html | — | ⏳ Phase 3 | T3 |
| holiday-plans.html | — | ⏳ Phase 3 | T3 |
| pipeline-flow.html | — | ⏳ Phase 3 | T3 |
| collection-lead-flow.html | — | ⏳ Phase 3 | T3 |
| compare.html | — | ⏳ Phase 3 | T3 |
| maintenance.html | — | ⏳ Phase 3 (special — public) | T1 |

### Dead / mockup v1 — do not port (17)
`office`, `presentation`, `report-center-mockup`, `card-mockups-v2`, `dashboard-back`, `monitoring-back`, `service-performance-back`, `onboarding-backold`, `onboarding-backnew`, `jira-templates-backup`, `mockup-endpoint-designs`, `mockup-genz-1-y2k`, `mockup-genz-2-bento`, `mockup-genz-3-glass`, `mockup-genz-4-zine`, `navbar-ma-indicator-mockups`, `_dcl`, `cron-builder`, `debug-nano-ma`, `test-incident-launcher`, `command-center-real` (experimental).

---

## ADMIN PAGES

### Shipped in v2 (6)
| v1 | v2 |
|---|---|
| admin/index.html | `/v2/admin` ✅ |
| admin/users.html | `/v2/admin/users` ✅ |
| admin/system-settings.html | `/v2/admin/system-settings` ✅ |
| admin/menu-permissions.html | `/v2/admin/menu-permissions` ✅ |
| admin/nav-groups.html | `/v2/admin/nav-groups` ✅ |
| admin/super-team-permissions.html | `/v2/admin/super-team-permissions` ✅ |

### Pending (63 — grouped by admin-nav section)

**team (7):** achievements, schedule, holiday-plans, leave-approval, announcements, feature-requests, genz-team

**content (11):** board, templates, knowledge-base, courses, exams, onboarding, weekly-report, sheets, links, tools, ops-runbook

**integrations (9) — Phase 2 critical:** jira-config, jenkins-servers, grafana-sources, opensearch-config, service-inventory, mail-config, mail-logs, email-noti, n8n-oncall-config

**operations (18):** ma-config, ma-status, ma-test-catalog, ma-test-plans, ma-test-overview, test-service, batch-monitor, batch-meta, batch-file-index, batch-monitor-noti, alert-monitor-config, sms-gateway-config, fh-config, scheduled-noti, pw-schedule, syncup-config, system-monitor, service-severity, incident-launcher-config

**system (5):** backup, analytics, trash, about-page (+ menu-perms & nav-groups done)

**platform (super_admin, 7):** maintenance, super-admin, super-viewer, super-feature-requests, super-email-templates, requests, logs

**devtools (6):** devtools, dev-system, dev-api, dev-logs, dev-email, dev-data

### Dead admin mockups — do not port (4)
`email-footer-mockups`, `email-logo-mockups`, `email-logo-typewriter`, `email-mockups`

---

## API COVERAGE

**v2 ships 31 API routes** (`app/api/*` + `app/api/v1/*`):
- auth: login, logout, bridge, forgot-password, reset-password, change-password, profile, sign-out-everywhere
- domain: board (via server actions), jira (config, create-issue, field-options, fields, issue-types, templates), jenkins (proxy, servers), users (+ reset-password), teams, nav-groups, menu-permissions, user-prefs, system-settings, feature-flags, page-access, nav, health, batch-records, batch-file-index/search

**v1 has ~101 API dirs + 22 top-level endpoints** → v2 covers roughly **~25%** of the API surface, concentrated on Phase 1 scope.

Phase 2 will add: service-performance, restart-monitor, restart-analyzer, opensearch-proxy, opensearch-saved-searches, opensearch-user-creds, ma-services, ma-status, ma-test, incident-launcher, notifications, mail, scheduled-noti, grafana-sources.

---

## Phase planning (confirmed in map.md T-08)

| Phase | Scope | Status |
|---|---|---|
| **Phase 1** | Auth, Dashboard, Board, Jira templates, Jenkins Build, Admin users/settings, Admin perms (6 pages + perms editors) | ✅ Done 2026-10-12 |
| **Cutover gate** | SM team dog-foods v2 for 2 weeks; nginx per-page `302 /v2/<page>` for migrated routes | 🔜 Next decision |
| **Phase 2** | MA Status, Service Performance, Restart Analyzer, Restart Monitor, Log Explorer, Incident Launcher, Mail/notifications, 9 integrations admin pages | Not started |
| **Phase 3** | Everything else: ~110 pages (admin team/content/operations/system/platform/devtools + Learn/KB + GenZ + Dev team views + legacy ops pages + maintenance screen + PHP deprecation) | Not started |
