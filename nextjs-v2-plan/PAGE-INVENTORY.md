# v1 to v2 page inventory

Snapshot 2026-10-13. Read-only. v1 = `/home/user/SOM-Portal` (PHP). v2 = `som-portal-v2` (Next.js, basePath `/v2`).

## Method

- **Scope:** top-level `*.html` (88) and `admin/*.html` (73). Pages under `backups/`, `mockup/`, `schedule-mockups/`, `uploads/`, `reports/` are not top-level and are out of scope.
- **Dead/mockup:** the keyword rule (`mockup`, `-back`, `backup`, `-old`, `test-`, `debug`) plus the dead list in `nextjs-v2-plan/PAGE-COMPARISON.md`. Overrides: live nav pages whose names contain `test-` or `backup` (`test-service`, `ma-test-*`, `admin/backup`, `admin/test-service`) stay live. `command-center-real` is dead as "experimental" per PAGE-COMPARISON.
- **v1 nav group:** from `layout.js` `_navGroupDef` (user) and `admin-nav.js` `GROUPS` (admin). Pages in no group are marked `(none)`.
- **Status:** PRESENT = route exists with real client code and API calls; STUB = route exists but only a shell (none found); MISSING = no v2 route. Placeholder grep found only chart and section placeholders (dashboard service health; service-performance CPU chart and dependency list) and one placeholder API response (`incident-launcher/impact`). Those pages are still PRESENT.
- **Phase:** Phase 2 if the v1 nav group is Monitor, MA Tools or Automation, or the page is an MA, incident, mail or notification page (or configures one); otherwise Phase 3. Phase 1 shipped pages keep the rule value; their PRESENT status shows they are done.

## User pages (top-level *.html)

### User nav: Home (9)

| v1 file | v1 nav group | v2 route | status | phase | notes |
|---|---|---|---|---|---|
| `about-som.html` | Home | — | MISSING | Phase 3 | Static team page |
| `dashboard.html` | Home | `/v2/dashboard` | PRESENT | Phase 3 | Partial: board data only; service-health chart is placeholder |
| `dev-hub.html` | Home | — | MISSING | Phase 3 | Dev team hub; no v2 route |
| `my-team.html` | Home | — | MISSING | Phase 3 | Team roster view; no v2 route |
| `onboarding.html` | Home | — | MISSING | Phase 3 | Onboarding flow; no v2 route |
| `pw-schedule.html` | Home | — | MISSING | Phase 3 | PW schedule; no v2 route |
| `sabai.html` | Home | — | MISSING | Phase 3 | SABai assistant page; no v2 route |
| `schedule.html` | Home | — | MISSING | Phase 3 | Shift schedule; no v2 route |
| `sheets.html` | Home | — | MISSING | Phase 3 | Team docs embed; no v2 route |

### User nav: Monitor (10)

| v1 file | v1 nav group | v2 route | status | phase | notes |
|---|---|---|---|---|---|
| `alert-monitor.html` | Monitor | — | MISSING | Phase 2 | Monitor group; no v2 route |
| `begin-grafana.html` | Monitor | — | MISSING | Phase 2 | Monitor group; Grafana entry |
| `grafana-alerts.html` | Monitor | — | MISSING | Phase 2 | Monitor group; paused alerts |
| `log-explorer.html` | Monitor | `/v2/log-explorer` | PRESENT | Phase 2 | Real OpenSearch-backed client |
| `monitoring.html` | Monitor | — | MISSING | Phase 2 | Monitor group; no v2 route |
| `restart-analyzer.html` | Monitor | `/v2/restart-analyzer` | PRESENT | Phase 2 | Real client plus restart-analyzer API |
| `restart-monitor.html` | Monitor | `/v2/restart-monitor` | PRESENT | Phase 2 | Real client plus restart-monitor API |
| `service-performance.html` | Monitor | `/v2/service-performance` | PRESENT | Phase 2 | Placeholders: CPU chart and dependency list |
| `syncup.html` | Monitor | — | MISSING | Phase 2 | Monitor group; sync-up |
| `uptime.html` | Monitor | — | MISSING | Phase 2 | Monitor group; no v2 route |

### User nav: MA Tools (2)

| v1 file | v1 nav group | v2 route | status | phase | notes |
|---|---|---|---|---|---|
| `ma-services.html` | MA Tools | `/v2/ma-services` | PRESENT | Phase 2 | Real client; ma-services API present |
| `ma-test.html` | MA Tools | — | MISSING | Phase 2 | MA Tools group; no v2 route |

### User nav: Operations (16)

| v1 file | v1 nav group | v2 route | status | phase | notes |
|---|---|---|---|---|---|
| `analytics.html` | Operations | — | MISSING | Phase 3 | Analytics page |
| `batch-file-search.html` | Operations | — | MISSING | Phase 3 | api/v1/batch-file-index/search exists; no page |
| `batch-monitor.html` | Operations | — | MISSING | Phase 3 | Batch monitor UI missing per parity matrix |
| `board.html` | Operations | `/v2/board, /v2/board/[id], /v2/board/trash` | PRESENT | Phase 3 | Partial: no post edit or image upload |
| `case-incidents.html` | Operations | — | MISSING | Phase 2 | Incident page; no v2 route or API found |
| `inbox.html` | Operations | — | MISSING | Phase 2 | Mail-backed team inbox; parity doc says Phase 3 |
| `jenkins-build.html` | Operations | `/v2/jenkins-build` | PRESENT | Phase 3 | Partial: trigger only; no maker-checker or batch UI |
| `jenkins-portal.html` | Operations | — | MISSING | Phase 3 | Trigger, history, logs, admin panels in one page |
| `jira-templates.html` | Operations | `/v2/jira-templates` | PRESENT | Phase 3 | Partial per audit TC-JIRA rows |
| `migrate-user.html` | Operations | — | MISSING | Phase 3 | User migration tool |
| `report-center.html` | Operations | — | MISSING | Phase 3 | Report center; mockup variant is dead |
| `send-email.html` | Operations | — | MISSING | Phase 2 | Mail send page; api/mail/send exists, no UI |
| `sms-gateway-switches.html` | Operations | — | MISSING | Phase 3 | SMS gateway; could count as notification (Phase 2?) |
| `so-jenkins.html` | Operations | — | MISSING | Phase 3 | Single-page Jenkins panel |
| `test-service.html` | Operations | — | MISSING | Phase 3 | Kept live: nav item despite test- name rule |
| `weekly-report.html` | Operations | — | MISSING | Phase 3 | Weekly report |

### User nav: Automation (1)

| v1 file | v1 nav group | v2 route | status | phase | notes |
|---|---|---|---|---|---|
| `incident-launcher.html` | Automation | `/v2/incident-launcher` | PRESENT | Phase 2 | Real client plus Jira and notify APIs; impact API placeholder |

### User nav: Learn (3)

| v1 file | v1 nav group | v2 route | status | phase | notes |
|---|---|---|---|---|---|
| `exam-reports.html` | Learn | — | MISSING | Phase 3 | Exam reports (oversight) |
| `learn-reports.html` | Learn | — | MISSING | Phase 3 | Course reports (oversight) |
| `learn.html` | Learn | — | MISSING | Phase 3 | Learning hub |

### User nav: GenZ (2)

| v1 file | v1 nav group | v2 route | status | phase | notes |
|---|---|---|---|---|---|
| `genz-hub.html` | GenZ | — | MISSING | Phase 3 | GenZ hub |
| `genz-notes.html` | GenZ | — | MISSING | Phase 3 | GenZ case notes |

### User nav: (none) (18)

| v1 file | v1 nav group | v2 route | status | phase | notes |
|---|---|---|---|---|---|
| `batch-monitor-v2.html` | (none) | — | MISSING | Phase 3 | Variant of batch-monitor.html; same title; not in nav |
| `change-password.html` | (none) | `/v2/settings (password tab)` | PRESENT | Phase 3 | Phase 1 shipped; happy path only |
| `collection-lead-flow.html` | (none) | — | MISSING | Phase 3 | Collection lead flow; not in any nav group |
| `compare.html` | (none) | — | MISSING | Phase 3 | Compare page; not in any nav group |
| `documentation.html` | (none) | — | MISSING | Phase 3 | Documentation page; not in any nav group |
| `exam.html` | (none) | — | MISSING | Phase 3 | Exam page |
| `holiday-plans.html` | (none) | — | MISSING | Phase 3 | Holiday plans; not in any nav group |
| `import-ma.html` | (none) | — | MISSING | Phase 2 | MA page by name; no v2 route |
| `knowledge-base.html` | (none) | — | MISSING | Phase 3 | Knowledge base |
| `learn-course.html` | (none) | — | MISSING | Phase 3 | Learning course view |
| `learn-phase.html` | (none) | — | MISSING | Phase 3 | Learning phase view |
| `ma-planwork.html` | (none) | — | MISSING | Phase 2 | MA page by name; no v2 route |
| `ma-status.html` | (none) | `/v2/ma-status` | PRESENT | Phase 2 | Real client; ma-status API present |
| `ops-runbook.html` | (none) | — | MISSING | Phase 3 | Ops runbook |
| `pipeline-flow.html` | (none) | — | MISSING | Phase 3 | Pipeline flow; not in any nav group |
| `report.html` | (none) | — | MISSING | Phase 3 | Not in any nav group |
| `setup-guide.html` | (none) | — | MISSING | Phase 3 | Setup guide; not in any nav group |
| `weekly-report-form.html` | (none) | — | MISSING | Phase 3 | Weekly report form |

### User nav: (none; public) (4)

| v1 file | v1 nav group | v2 route | status | phase | notes |
|---|---|---|---|---|---|
| `forgot-password.html` | (none; public) | `/v2/forgot-password` | PRESENT | Phase 3 | page.tsx exists; parity doc calls it empty (stale) |
| `index.html` | (none; public) | `/v2/login` | PRESENT | Phase 3 | Phase 1 shipped; forced-change flow fixed |
| `maintenance.html` | (none; public) | — | MISSING | Phase 3 | Public screen; decide before cutover |
| `reset-password.html` | (none; public) | `/v2/reset-password` | PRESENT | Phase 3 | page.tsx exists; parity doc calls it empty (stale) |

### User nav: (none; user menu) (2)

| v1 file | v1 nav group | v2 route | status | phase | notes |
|---|---|---|---|---|---|
| `profile.html` | (none; user menu) | `/v2/settings (profile tab)` | PRESENT | Phase 3 | Phase 1 shipped; admin editing other users unverified |
| `settings.html` | (none; user menu) | `/v2/settings` | PRESENT | Phase 3 | Phase 1 shipped; appearance, sessions, notifications tabs |

## Admin pages (admin/*.html)

### Admin nav: Overview (1)

| v1 file | v1 nav group | v2 route | status | phase | notes |
|---|---|---|---|---|---|
| `admin/index.html` | Overview | `/v2/admin` | PRESENT | Phase 3 | KPI tiles from data files; parity |

### Admin nav: Team (7)

| v1 file | v1 nav group | v2 route | status | phase | notes |
|---|---|---|---|---|---|
| `admin/achievements.html` | Team | — | MISSING | Phase 3 | Team achievements |
| `admin/announcements.html` | Team | — | MISSING | Phase 3 | Team announcements |
| `admin/feature-requests.html` | Team | — | MISSING | Phase 3 | Feature requests |
| `admin/holiday-plans.html` | Team | — | MISSING | Phase 3 | Holiday plan admin |
| `admin/leave-approval.html` | Team | — | MISSING | Phase 3 | Leave approvals |
| `admin/schedule.html` | Team | — | MISSING | Phase 3 | Shift schedule admin |
| `admin/users.html` | Team | `/v2/admin/users` | PRESENT | Phase 3 | Partial: admin reset and create differ (TC-USR-05, 06, 17) |

### Admin nav: Content (11)

| v1 file | v1 nav group | v2 route | status | phase | notes |
|---|---|---|---|---|---|
| `admin/board.html` | Content | — | MISSING | Phase 3 | Admin board config; not ported |
| `admin/courses.html` | Content | — | MISSING | Phase 3 | Course admin |
| `admin/exams.html` | Content | — | MISSING | Phase 3 | Exam admin |
| `admin/knowledge-base.html` | Content | — | MISSING | Phase 3 | Knowledge base admin |
| `admin/links.html` | Content | — | MISSING | Phase 3 | Quick links admin |
| `admin/onboarding.html` | Content | — | MISSING | Phase 3 | Onboarding admin |
| `admin/ops-runbook.html` | Content | — | MISSING | Phase 3 | Runbook admin |
| `admin/sheets.html` | Content | — | MISSING | Phase 3 | Docs admin |
| `admin/templates.html` | Content | — | MISSING | Phase 3 | api/v1/templates exists; no admin page |
| `admin/tools.html` | Content | — | MISSING | Phase 3 | Sidebar tools admin |
| `admin/weekly-report.html` | Content | — | MISSING | Phase 3 | Weekly report admin |

### Admin nav: Integrations (9)

| v1 file | v1 nav group | v2 route | status | phase | notes |
|---|---|---|---|---|---|
| `admin/email-noti.html` | Integrations | — | MISSING | Phase 2 | Notification email config |
| `admin/grafana-sources.html` | Integrations | — | MISSING | Phase 2 | Grafana data sources; monitor config |
| `admin/jenkins-servers.html` | Integrations | — | MISSING | Phase 3 | api/v1/jenkins-servers exists; no admin page |
| `admin/jira-config.html` | Integrations | — | MISSING | Phase 3 | api/v1/jira/config exists; no admin page |
| `admin/mail-config.html` | Integrations | `/v2/admin/mail-config` | PRESENT | Phase 2 | Real client plus api/mail/config |
| `admin/mail-logs.html` | Integrations | — | MISSING | Phase 2 | api/mail/logs exists; no page |
| `admin/n8n-oncall-config.html` | Integrations | — | MISSING | Phase 3 | On-call config (n8n) |
| `admin/opensearch-config.html` | Integrations | — | MISSING | Phase 2 | Backs Log Explorer; config write returns 501 |
| `admin/service-inventory.html` | Integrations | — | MISSING | Phase 3 | Service inventory |

### Admin nav: Operations (19)

| v1 file | v1 nav group | v2 route | status | phase | notes |
|---|---|---|---|---|---|
| `admin/alert-monitor-config.html` | Operations | — | MISSING | Phase 2 | Alert monitor config (Monitor family) |
| `admin/batch-file-index.html` | Operations | — | MISSING | Phase 3 | api/v1/batch-file-index exists; no page |
| `admin/batch-meta.html` | Operations | — | MISSING | Phase 3 | Batch metadata |
| `admin/batch-monitor-noti.html` | Operations | — | MISSING | Phase 2 | Batch notification config |
| `admin/batch-monitor.html` | Operations | — | MISSING | Phase 3 | Batch monitor admin; UI missing |
| `admin/fh-config.html` | Operations | — | MISSING | Phase 2 | First-hop email config; mail |
| `admin/incident-launcher-config.html` | Operations | — | MISSING | Phase 2 | Incident launcher config |
| `admin/ma-config.html` | Operations | — | MISSING | Phase 2 | MA config |
| `admin/ma-status.html` | Operations | `/v2/ma-status (shared with user page)` | PRESENT | Phase 2 | Same route as user ma-status.html; admin view unverified |
| `admin/ma-test-catalog.html` | Operations | — | MISSING | Phase 2 | MA test admin; kept live despite test- name rule |
| `admin/ma-test-overview.html` | Operations | — | MISSING | Phase 2 | MA test admin; kept live despite test- name rule |
| `admin/ma-test-plans.html` | Operations | — | MISSING | Phase 2 | MA test admin; kept live despite test- name rule |
| `admin/pw-schedule.html` | Operations | — | MISSING | Phase 3 | PW schedule admin |
| `admin/scheduled-noti.html` | Operations | `/v2/admin/scheduled-noti` | PRESENT | Phase 2 | Real client plus scheduled-noti API |
| `admin/service-severity.html` | Operations | — | MISSING | Phase 3 | Service severity |
| `admin/sms-gateway-config.html` | Operations | — | MISSING | Phase 3 | SMS gateway; could count as notification |
| `admin/syncup-config.html` | Operations | — | MISSING | Phase 2 | Sync-up config (Monitor family) |
| `admin/system-monitor.html` | Operations | — | MISSING | Phase 2 | System monitor (Monitor family) |
| `admin/test-service.html` | Operations | — | MISSING | Phase 3 | Kept live despite test- name rule |

### Admin nav: System (6)

| v1 file | v1 nav group | v2 route | status | phase | notes |
|---|---|---|---|---|---|
| `admin/analytics.html` | System | — | MISSING | Phase 3 | System analytics |
| `admin/backup.html` | System | — | MISSING | Phase 3 | Kept live: name contains backup; System nav |
| `admin/menu-permissions.html` | System | `/v2/admin/menu-permissions` | PRESENT | Phase 3 | Parity on save; Phase 1 shipped |
| `admin/nav-groups.html` | System | `/v2/admin/nav-groups` | PRESENT | Phase 3 | Parity on save; Phase 1 shipped |
| `admin/system-settings.html` | System | `/v2/admin/system-settings` | PRESENT | Phase 3 | Parity on listed fields; Phase 1 shipped |
| `admin/trash.html` | System | — | MISSING | Phase 3 | Only board trash exists at /v2/board/trash |

### Admin nav: Platform (8)

| v1 file | v1 nav group | v2 route | status | phase | notes |
|---|---|---|---|---|---|
| `admin/logs.html` | Platform | — | MISSING | Phase 3 | Audit log viewer; no v2 page |
| `admin/maintenance.html` | Platform | — | MISSING | Phase 3 | Platform maintenance mode |
| `admin/requests.html` | Platform | — | MISSING | Phase 3 | User requests (super admin) |
| `admin/super-admin.html` | Platform | — | MISSING | Phase 3 | All teams overview |
| `admin/super-email-templates.html` | Platform | — | MISSING | Phase 2 | Email templates; mail |
| `admin/super-feature-requests.html` | Platform | — | MISSING | Phase 3 | Feature requests (super admin) |
| `admin/super-team-permissions.html` | Platform | `/v2/admin/super-team-permissions` | PRESENT | Phase 3 | Team create and copy missing; Phase 1 shipped |
| `admin/super-viewer.html` | Platform | — | MISSING | Phase 3 | Super viewer permissions |

### Admin nav: Dev (6)

| v1 file | v1 nav group | v2 route | status | phase | notes |
|---|---|---|---|---|---|
| `admin/dev-api.html` | Dev | — | MISSING | Phase 3 | Dev tool, dev_sm only |
| `admin/dev-data.html` | Dev | — | MISSING | Phase 3 | Dev tool, dev_sm only |
| `admin/dev-email.html` | Dev | — | MISSING | Phase 2 | Email tester; mail |
| `admin/dev-logs.html` | Dev | — | MISSING | Phase 3 | Dev tool, dev_sm only |
| `admin/dev-system.html` | Dev | — | MISSING | Phase 3 | Dev tool, dev_sm only |
| `admin/devtools.html` | Dev | — | MISSING | Phase 3 | Dev overview, dev_sm only |

### Admin nav: (none) (1)

| v1 file | v1 nav group | v2 route | status | phase | notes |
|---|---|---|---|---|---|
| `admin/about-page.html` | (none) | — | MISSING | Phase 3 | Not in admin-nav; no v2 route |

### Admin nav: (none; layout.js Admin) (1)

| v1 file | v1 nav group | v2 route | status | phase | notes |
|---|---|---|---|---|---|
| `admin/genz-team.html` | (none; layout.js Admin) | — | MISSING | Phase 3 | Not in admin-nav; layout.js Admin group |

## Dead / mockup (not ported)

| file | reason |
|---|---|
| `_dcl.html` | no keyword; PAGE-COMPARISON dead list |
| `admin/email-footer-mockups.html` | keyword: mockup |
| `admin/email-logo-mockups.html` | keyword: mockup |
| `admin/email-logo-typewriter.html` | no keyword; PAGE-COMPARISON dead list (typewriter variations) |
| `admin/email-mockups.html` | keyword: mockup |
| `card-mockups-v2.html` | keyword: mockup |
| `command-center-real.html` | no keyword; PAGE-COMPARISON dead list (experimental) |
| `cron-builder.html` | no keyword; PAGE-COMPARISON dead list |
| `dashboard-back.html` | keyword: -back |
| `debug-nano-ma.html` | keyword: debug |
| `jira-templates-backup.html` | keyword: backup |
| `mockup-endpoint-designs.html` | keyword: mockup |
| `mockup-genz-1-y2k.html` | keyword: mockup |
| `mockup-genz-2-bento.html` | keyword: mockup |
| `mockup-genz-3-glass.html` | keyword: mockup |
| `mockup-genz-4-zine.html` | keyword: mockup |
| `monitoring-back.html` | keyword: -back |
| `navbar-ma-indicator-mockups.html` | keyword: mockup |
| `office.html` | no keyword; PAGE-COMPARISON dead list |
| `onboarding-backnew.html` | keyword: -back |
| `onboarding-backold.html` | keyword: -back |
| `presentation.html` | no keyword; PAGE-COMPARISON dead list |
| `report-center-mockup.html` | keyword: mockup |
| `service-performance-back.html` | keyword: -back |
| `test-incident-launcher.html` | keyword: test- |

## Totals

Live pages: user 67, admin 69, total 136. Dead/mockup: 25 (user 21, admin 4).

| scope | PRESENT | STUB | MISSING | Phase 2 | Phase 3 |
|---|---|---|---|---|---|
| User | 17 | 0 | 50 | 19 | 48 |
| Admin | 9 | 0 | 60 | 19 | 50 |
| **Total** | 26 | 0 | 110 | 38 | 98 |

## Discrepancies with existing docs

- `PAGE-COMPARISON.md` says `forgot-password` and `reset-password` are empty dirs. Both now have `page.tsx` (248 and 410 lines).
- `PAGE-COMPARISON.md` says Phase 2 is "Not started". The v2 routes for service-performance, restart-monitor, restart-analyzer, log-explorer, ma-services, ma-status, incident-launcher, mail-config and scheduled-noti exist with real client code and APIs.
- `PAGE-COMPARISON.md` puts alert-monitor, monitoring, uptime, grafana-alerts, begin-grafana and syncup in Phase 3. This inventory puts them in Phase 2 by the monitor rule above.
- `PAGE-COMPARISON.md` puts inbox in Phase 3. It is mail-backed, so this inventory puts it in Phase 2.
- `PAGE-COMPARISON.md` counts `batch-monitor-v2.html` with `batch-monitor.html`. Both are live here; `batch-monitor-v2.html` is not in any nav group.
