# SOM Portal Inventory

Source of truth: filesystem scan on 2026-10-11. Supersedes `project_som_full_feature_map` memory which was incomplete.

## 1. Scale (actual counts)

- User-facing HTML pages at project root: **88** (incl. ~17 mockups/backups and 2 Apps-Script files)
- Admin HTML pages under `admin/`: **73**
- API top-level directories: **101**
- API top-level `.php` endpoint files: **22** (incl. helpers like `helpers.php`, `config.php`, `jenkins_config.php`, `jenkins_helpers.php` which are libraries, not endpoints)

API dirs: about-page, achievements, ai, alert-monitor, alerts, analytics, announcements, auth, backup, batch-deps, batch-file-index, batch-meta, batch-monitor-noti, begin-grafana, board, board-comments, board-config, cache, collection-lead-flow, courses, csrf, cutoff-services, dashboard, dev, dev-subteams, downstream-health, email-noti, email-templates, exams, feature-requests, fh-email-config, genz-notes, genz-team, grafana-alerts, grafana-sources, health, holiday-plans, inbox, incident-launcher, jenkins-build, jenkins-portal, jenkins-proxy, jenkins-servers, jira, jira-config, jira-requests, knowledge-base, links, log, logging, ma-modules, ma-services, ma-status, ma-test, mail, mail-config, maintenance, menu-permissions, migrate-user, monitoring, my-team, nav-groups, notifications, onboarding, opensearch-config, opensearch-proxy, opensearch-saved-folders, opensearch-saved-searches, opensearch-user-creds, ops-runbook, pipeline-flows, presence, pw-schedule, pw-schedule-config, requests, restart-analyzer, restart-monitor, restart-monitor-webhooks, schedule, scheduled-noti, search, security, service-inventory, service-performance, service-severity, service-types, sheets, sidebar-tools, sms-gateway, so-jenkins, stars, super-viewer, super-viewer-config, syncup, system-settings, team-config, teams, templates, uptime, users, weekly-report.

Top-level php endpoints: `batch-records.php`, `batch-records-admin.php`, `chat-proxy.php`, `debug-nano-ma.php`, `fundout-proxy.php`, `jenkins-proxy.php`, `migrate-monthly.php`, `n8n-oncall.php`, `n8n-oncall-config.php`, `n8n-severity-config.php`, `n8n-severity-sync.php`, `rundeck-proxy.php`, `test-records.php`, `test-records-admin.php`, `test-service-config.php`, `upload.php`, `version.php`, `_debug-auth.php` (dev-only).

Role constants (`api/helpers.php`): `SUPER_ADMIN_ROLE=super_admin`; `ADMIN_ROLES`=sm_admin+dev_sm+super_admin; `LEAD_ROLES`=sm_admin+dev_sm+sm_lead+super_admin; `ALL_STAFF_ROLES` adds sm_user & dev_user. 8 roles total: super_admin, super_viewer, sm_admin, dev_sm, sm_lead, sm_user, dev_user, external.

## 2. User pages

Legend: `role` column – blank means any authenticated user; multiple roles comma-separated. `feature` is the feature-flag id checked against `data/<team>/team-features.json`. Priority tiers: T1 SM-daily, T2 weekly/core, T3 niche, TX dead.

| Page | Nav group | Required role | Team / feature | APIs (primary) | Active? | Tier |
|---|---|---|---|---|---|---|
| index.html | — | public | — | auth/login | Y | T1 |
| forgot-password.html | — | public | — | auth/forgot-password | Y | T1 |
| reset-password.html | — | public | — | auth/reset-password | Y | T1 |
| change-password.html | — | any auth | — | auth/change-password | Y | T1 |
| profile.html | always-visible | any auth | — | auth/profile, auth/my-activity | Y | T1 |
| settings.html | — | any auth | — | system-settings (read), theme | Y | T2 |
| dashboard.html | home | any auth | — | dashboard, board, notifications, presence, stars | Y | T1 |
| my-team.html | home | any auth | — | my-team, presence | Y | T2 |
| about-som.html | home | any auth (all teams) | — | about-page | Y | T2 |
| schedule.html | home | any auth | feature:schedule | schedule, holiday-plans | Y | T2 |
| pw-schedule.html | home | any auth | feature:pw-schedule | pw-schedule, pw-schedule-config | Y | T2 |
| sheets.html | home | any auth | feature:team-docs | sheets | Y | T3 |
| sabai.html | home | any auth | feature:sabai | n/a external iframe | Y | T3 |
| onboarding.html | home | any auth | feature:onboarding | onboarding | Y | T3 |
| board.html | ops | any auth | feature:board | board, board-comments, board-config, stars | Y | T1 |
| send-email.html | ops | any auth | feature:jira-templates | jira/create, templates, mail/send | Y | T1 |
| jira-templates.html | ops | any auth | feature:jira-templates(-shared) | templates, jira-config, jira/fields | Y | T1 |
| case-incidents.html | ops | any auth | team:sm (nav) | jira/incidents, jira/smc-cases, jira/incidents-analytics | Y | T1 |
| inbox.html | ops | any auth (deny super_viewer) | feature:inbox | inbox/* , fh-email-config | Y | T2 |
| batch-monitor.html | ops | any auth (deny super_viewer) | feature:batch-monitor | batch-records, batch-deps, batch-monitor-noti | Y | T2 |
| batch-monitor-v2.html | ops | any auth | feature:batch-monitor | batch-records | Partial (iteration of batch-monitor) | T3 |
| batch-file-search.html | ops | any auth | feature:batch-file-search | batch-file-index/lookup | Y | T2 |
| jenkins-build.html | ops | any auth | feature:jenkins-build | jenkins-build, jenkins-proxy | Y | T2 |
| jenkins-portal.html | ops | any auth | feature:jenkins-portal | jenkins-portal, jenkins-proxy | Y | T2 |
| so-jenkins.html | ops | any auth | feature:so-jenkins | so-jenkins, jenkins-proxy | Y | T3 |
| migrate-user.html | ops | any auth | feature:migrate-user | migrate-user, migrate-monthly | Y | T3 |
| sms-gateway-switches.html | ops | any auth | feature:sms-gateway | sms-gateway | Y | T3 |
| analytics.html | ops | any auth | feature:analytics | analytics/stats, analytics/track | Y | T3 |
| weekly-report.html | ops | any auth | feature:weekly-report | weekly-report/* | Y | T2 |
| weekly-report-form.html | ops | any auth | feature:weekly-report | weekly-report/save | Y | T2 |
| report-center.html | ops | any auth | feature:weekly-report | weekly-report/list, exam reports | Y | T2 |
| incident-launcher.html | automation | any auth | team:sm (deny super_viewer) | incident-launcher, jira/create, board, mail/send, notifications | Y | T1 |
| service-performance.html | monitor | ALL_STAFF_ROLES (API gate) | — (SM-shared data, no team lock) | service-performance/*, service-inventory, grafana-sources, opensearch-proxy | Y | T1 |
| restart-monitor.html | monitor | ALL_STAFF_ROLES | feature:restart-monitor | restart-monitor, restart-monitor-webhooks | Y | T1 |
| restart-analyzer.html | monitor | ALL_STAFF_ROLES | team:sm | restart-analyzer | Y | T1 |
| log-explorer.html | monitor | any auth | team:sm | opensearch-proxy, opensearch-saved-searches, opensearch-saved-folders, opensearch-user-creds | Y | T1 |
| alert-monitor.html | monitor | any auth | feature:alert-monitor | alert-monitor/* , alerts/* | Y | T2 |
| monitoring.html | monitor | any auth (deny super_viewer) | feature:monitoring | monitoring/metrics, downstream-health | Y | T2 |
| uptime.html | monitor | any auth (deny super_viewer) | feature:uptime | uptime | Y | T2 |
| grafana-alerts.html | monitor | any auth | feature:grafana-alerts | grafana-alerts/* | Y | T2 |
| begin-grafana.html | monitor | any auth | team:sm (deny super_viewer) | begin-grafana/* , grafana-sources | Y | T2 |
| syncup.html | monitor | any auth (deny super_viewer) | feature:syncup | syncup | Y | T3 |
| test-service.html | monitor | any auth (deny super_viewer) | feature:test-service | test-records, test-service-config | Y | T2 |
| ma-services.html | ma | any auth | feature:ma-services | ma-services/* , ma-modules, ma-status | Y | T1 |
| ma-test.html | ma | any auth | team:sm (deny super_viewer) | ma-test/* | Y | T2 |
| ma-status.html | — (direct link / topbar) | any auth | feature:ma-services | ma-status | Y | T1 |
| ma-planwork.html | — (ma deep-link) | any auth | feature:ma-services | ma-test/plans | Y | T3 |
| import-ma.html | — | admin | feature:ma-services | ma-services/import | Y | T3 |
| learn.html | learn | any auth | feature:learning | courses/* | Y | T3 |
| learn-course.html | learn | any auth | feature:learning | courses/lessons, courses/phases | Y | T3 |
| learn-phase.html | learn | any auth | feature:learning | courses/phases, courses/complete-phase | Y | T3 |
| learn-reports.html | OVERSIGHT | super_viewer, super_admin | — | courses, exams | Y | T3 |
| exam-reports.html | OVERSIGHT | super_viewer, super_admin | — | exams | Y | T3 |
| exam.html | learn | any auth | feature:learning | exams/attempts | Y | T3 |
| knowledge-base.html | — (direct) | any auth | — | knowledge-base/* | Y | T3 |
| ops-runbook.html | — (direct) | LEAD_ROLES | team:sm | ops-runbook | Y | T3 |
| documentation.html | — | any auth | — | static | Y | T3 |
| setup-guide.html | — | any auth | — | static | Y | T3 |
| genz-hub.html | genz | any auth, is_genz | team:sm | genz-notes, achievements | Y | T3 |
| genz-notes.html | genz | any auth, is_genz | team:sm | genz-notes | Y | T3 |
| dev-hub.html | — | dev_user | team:dev | dev, dev-subteams | Y | T3 |
| holiday-plans.html | — (direct) | any auth | — | holiday-plans | Y | T3 |
| report.html | — (legacy direct link) | any auth | — | weekly-report | Partial — short page (157 lines), looks superseded by report-center | T3 |
| maintenance.html | — | public (shown during MA) | — | maintenance | Y | T1 |
| pipeline-flow.html | — | sm_user listed in menu-perms | — | pipeline-flows | Y | T3 |
| collection-lead-flow.html | — | sm_user listed in menu-perms | — | collection-lead-flow | Y | T3 |
| compare.html | — (deep-link from service-performance) | any auth | — | service-performance | Y | T3 |
| command-center-real.html | — | any auth | — | dashboard aggregated | Partial / experimental | TX |
| cron.html / cron-builder.html | — | any auth | — | n8n-oncall-config | Partial — unlinked | TX |
| debug-nano-ma.html | — | any auth | — | debug-nano-ma.php | Dev tool | TX |
| test-incident-launcher.html | — | — | — | — | Dev scratch | TX |
| office.html, presentation.html, report-center-mockup.html, card-mockups-v2.html, dashboard-back.html, monitoring-back.html, service-performance-back.html, onboarding-backold.html, onboarding-backnew.html, jira-templates-backup.html, mockup-endpoint-designs.html, mockup-genz-1-y2k.html, mockup-genz-2-bento.html, mockup-genz-3-glass.html, mockup-genz-4-zine.html, navbar-ma-indicator-mockups.html, _dcl.html | — | — | — | — | Mockups / backups | TX |

## 3. Admin pages

Default admin requires `ADMIN_ROLES` (sm_admin, dev_sm, super_admin) unless noted. `team: 'sm'` means pulled only when current team is SM. `features:[...]` means hidden if none of those features enabled on the team.

| Page | Admin-nav group | Role / team | API deps | Active? | Tier |
|---|---|---|---|---|---|
| admin/index.html | overview | ADMIN_ROLES | aggregate | Y | T1 |
| admin/users.html | team | ADMIN_ROLES | users, dev-subteams | Y | T1 |
| admin/achievements.html | team | ADMIN_ROLES | achievements | Y | T3 |
| admin/schedule.html | team | ADMIN_ROLES, LEAD_ROLES for writes | schedule | Y | T2 |
| admin/holiday-plans.html | team | ADMIN_ROLES | holiday-plans | Y | T3 |
| admin/leave-approval.html | team | ADMIN_ROLES | schedule (leave) | Y | T3 |
| admin/announcements.html | team | ADMIN_ROLES | announcements | Y | T2 |
| admin/feature-requests.html | team | sm_admin, dev_sm | feature-requests | Y | T3 |
| admin/board.html | content | LEAD_ROLES | board, board-config | Y | T1 |
| admin/templates.html | content | LEAD_ROLES (SM-shared) | templates (requireSmForShared) | Y | T1 |
| admin/knowledge-base.html | content | ADMIN_ROLES, team:sm | knowledge-base | Y | T3 |
| admin/courses.html | content | ADMIN_ROLES | courses | Y | T3 |
| admin/exams.html | content | ADMIN_ROLES | exams | Y | T3 |
| admin/onboarding.html | content | ADMIN_ROLES, feature:onboarding | onboarding/admin | Y | T3 |
| admin/weekly-report.html | content | ADMIN_ROLES, feature:weekly-report | weekly-report | Y | T2 |
| admin/sheets.html | content | ADMIN_ROLES, feature:sheets | sheets | Y | T3 |
| admin/links.html | content | LEAD_ROLES | links (section-scoped SM share) | Y | T2 |
| admin/tools.html | content | ADMIN_ROLES | sidebar-tools | Y | T2 |
| admin/ops-runbook.html | content | LEAD_ROLES, team:sm | ops-runbook | Y | T3 |
| admin/jira-config.html | integrations | LEAD_ROLES (SM-shared) | jira-config | Y | T1 |
| admin/jenkins-servers.html | integrations | ADMIN_ROLES | jenkins-servers | Y | T1 |
| admin/grafana-sources.html | integrations | ADMIN_ROLES + requireSmForShared | grafana-sources | Y | T1 |
| admin/opensearch-config.html | integrations | ADMIN_ROLES, team:sm | opensearch-config | Y | T1 |
| admin/service-inventory.html | integrations | ADMIN_ROLES, team:sm (SM-shared) | service-inventory | Y | T1 |
| admin/mail-config.html | integrations | ADMIN_ROLES | mail-config | Y | T2 |
| admin/mail-logs.html | integrations | ADMIN_ROLES | mail/logs | Y | T3 |
| admin/email-noti.html | integrations | ADMIN_ROLES, feature:notifications | email-noti | Y | T3 |
| admin/n8n-oncall-config.html | integrations | ADMIN_ROLES, feature:jira-templates | n8n-oncall-config.php | Y | T3 |
| admin/ma-config.html | operations | ADMIN_ROLES, feature:ma-services | ma-modules, ma-services | Y | T1 |
| admin/ma-status.html | operations | ADMIN_ROLES, feature:ma-services | ma-status | Y | T1 |
| admin/ma-test-catalog.html | operations | ADMIN_ROLES, team:sm | ma-test/catalog | Y | T2 |
| admin/ma-test-plans.html | operations | ADMIN_ROLES, team:sm | ma-test/plans | Y | T2 |
| admin/ma-test-overview.html | operations | ADMIN_ROLES, team:sm | ma-test/results | Y | T2 |
| admin/test-service.html | operations | ADMIN_ROLES, feature:test-service | test-records-admin, test-service-config | Y | T2 |
| admin/batch-monitor.html | operations | ADMIN_ROLES, feature:batch-monitor | batch-records-admin | Y | T2 |
| admin/batch-meta.html | operations | ADMIN_ROLES, feature:batch-monitor | batch-meta, batch-deps | Y | T2 |
| admin/batch-file-index.html | operations | ADMIN_ROLES, feature:batch-monitor | batch-file-index/crawl, index_logs | Y | T2 |
| admin/batch-monitor-noti.html | operations | ADMIN_ROLES, feature:batch-monitor | batch-monitor-noti | Y | T3 |
| admin/alert-monitor-config.html | operations | ADMIN_ROLES, feature:alert-monitor | alert-monitor, alerts | Y | T2 |
| admin/sms-gateway-config.html | operations | ADMIN_ROLES, feature:sms-gateway | sms-gateway | Y | T3 |
| admin/fh-config.html | operations | ADMIN_ROLES, feature:inbox | fh-email-config | Y | T3 |
| admin/scheduled-noti.html | operations | ADMIN_ROLES, feature:notifications | scheduled-noti | Y | T2 |
| admin/pw-schedule.html | operations | ADMIN_ROLES, team:sm | pw-schedule-config | Y | T2 |
| admin/syncup-config.html | operations | ADMIN_ROLES, feature:syncup | syncup | Y | T3 |
| admin/system-monitor.html | operations | ADMIN_ROLES, feature:monitoring | monitoring | Y | T2 |
| admin/service-severity.html | operations | ADMIN_ROLES, feature:service-severity | service-severity, n8n-severity-config.php, n8n-severity-sync.php | Y | T2 |
| admin/incident-launcher-config.html | operations | sm_admin,dev_sm,sm_lead, team:sm | incident-launcher | Y | T1 |
| admin/system-settings.html | system | ADMIN_ROLES, team:sm | system-settings | Y | T1 |
| admin/menu-permissions.html | system | ADMIN_ROLES | menu-permissions | Y | T1 |
| admin/nav-groups.html | system | sm_admin,dev_sm | nav-groups | Y | T2 |
| admin/backup.html | system | ADMIN_ROLES, team:sm | backup | Y | T2 |
| admin/analytics.html | system | ADMIN_ROLES | analytics | Y | T3 |
| admin/trash.html | system | ADMIN_ROLES, team:sm | board (trash) | Y | T2 |
| admin/about-page.html | — (direct) | ADMIN_ROLES | about-page | Y | T2 |
| admin/maintenance.html | platform | super_admin | maintenance | Y | T1 |
| admin/super-admin.html | platform | super_admin | teams, users (cross-team) | Y | T2 |
| admin/super-team-permissions.html | platform | super_admin | team-config, teams | Y | T1 |
| admin/super-viewer.html | platform | super_admin | super-viewer, super-viewer-config | Y | T2 |
| admin/super-feature-requests.html | platform | super_admin | feature-requests (cross) | Y | T3 |
| admin/super-email-templates.html | platform | super_admin | email-templates | Y | T3 |
| admin/requests.html | platform | super_admin | requests | Y | T3 |
| admin/logs.html | platform | super_admin | log | Y | T2 |
| admin/genz-team.html | admin (user-nav) | sm_admin,dev_sm, team:sm | genz-team | Y | T3 |
| admin/devtools.html | devtools | dev_sm | dev | Y | T3 |
| admin/dev-system.html | devtools | dev_sm | dev | Y | T3 |
| admin/dev-api.html | devtools | dev_sm | dev | Y | T3 |
| admin/dev-logs.html | devtools | dev_sm | dev, log | Y | T3 |
| admin/dev-email.html | devtools | dev_sm | mail/test | Y | T3 |
| admin/dev-data.html | devtools | dev_sm | dev | Y | T3 |
| admin/email-footer-mockups.html | — | n/a | — | Mockup | TX |
| admin/email-logo-mockups.html | — | n/a | — | Mockup | TX |
| admin/email-logo-typewriter.html | — | n/a | — | Mockup | TX |
| admin/email-mockups.html | — | n/a | — | Mockup | TX |

## 4. API modules

Legend: `auth` – `requireAuth` is called in primary file. `role` – role gate on at least one branch (write usually). `team` – `per-team` uses `teamDataPath()` default, `shared` uses `smSharedFiles()`/`requireSmForShared()`, `global` writes to `DATA_DIR` root, `n/a` for stateless proxies.

| Module | Primary file(s) | Auth | Role gate (writes) | Team scope | External deps |
|---|---|---|---|---|---|
| about-page | index.php | Y | ADMIN_ROLES | per-team | — |
| achievements | index.php | Y | — (admin pages gate client-side) | per-team | — |
| ai | index.php | Y (public ok) | — | — | chat-proxy / LLM |
| alert-monitor | sync.php,state.php,stats.php,config.php,compare.php | Y | ADMIN_ROLES on writes | per-team | JSM (Jira ServiceDesk) |
| alerts | list/save/delete/test/tick/preview/notify-config | Y | ADMIN_ROLES on writes | per-team | Email, Slack, Grafana |
| analytics | track/stats/cleanup | Y (track open) | ADMIN_ROLES on cleanup | per-team | — |
| announcements | index.php | Y | ADMIN_ROLES | per-team | — |
| auth | login/logout/me/profile/change-password/forgot-password/reset-password/csrf/my-activity | mixed | — | global (users.json) | SMTP for forgot |
| backup | index.php | Y | ADMIN_ROLES | per-team zip | — |
| batch-deps | index.php | Y | ADMIN_ROLES | per-team | — |
| batch-file-index | crawl/lookup/index_logs | Y | admin for crawl | per-team | SFTP / filesystem |
| batch-meta | index.php | Y | ADMIN_ROLES | per-team | — |
| batch-monitor-noti | index.php | Y | ADMIN_ROLES | per-team | SMTP, chat |
| begin-grafana | endpoints/promql/series/custom-* | Y | — | reads SM-shared grafana-sources | Grafana / Prometheus (Thanos) |
| board | index.php | Y | LEAD_ROLES for delete/trash | per-team | — |
| board-comments | index.php | Y | — | per-team | — |
| board-config | index.php | Y | LEAD_ROLES | per-team | — |
| cache | CacheManager + clear/stats | n/a | — | library | — |
| collection-lead-flow | index.php | Y | — | per-team | — |
| courses | *.php | Y (per file) | LEAD_ROLES for writes | per-team | — |
| csrf | generate.php | Y | — | — | — |
| cutoff-services | list/create/update/delete/import | Y (per file) | ADMIN_ROLES on writes | per-team | DB import |
| dashboard | learning-status.php | Y | — | per-team | — |
| dev | index.php | Y | dev_sm | — | sysinfo |
| dev-subteams | index.php | Y | ADMIN_ROLES | per-team (dev) | — |
| downstream-health | services/breakdown/timeseries | Y | — | SM-shared | Grafana Thanos |
| email-noti | index.php | Y | ADMIN_ROLES | per-team | SMTP |
| email-templates | index.php | Y | super_admin | global | — |
| exams | *.php | Y | LEAD_ROLES on writes | per-team | — |
| feature-requests | index.php | Y | sm_admin/dev_sm + super_admin | SM-shared | — |
| fh-email-config | index.php | Y | ADMIN_ROLES | per-team | IMAP |
| genz-notes | index.php | Y | — | per-team (SM) | — |
| genz-team | index.php | Y | sm_admin,dev_sm | SM users.json | — |
| grafana-alerts | config/paused/resume/_fetch/_notify | Y | ADMIN_ROLES for config | per-team | Grafana API |
| grafana-sources | index.php | Y | ADMIN_ROLES + requireSmForShared | SM-shared | — |
| health | check/index | Y | ALL_STAFF_ROLES | — | Jira, Jenkins |
| holiday-plans | index.php | Y | LEAD_ROLES on writes | per-team | — |
| inbox | list/send/message/move/flag/folders/cid/unread-count | Y | — | per-team | IMAP+SMTP |
| incident-launcher | index.php | Y | — (client-side team:sm) | per-team | Jira, Google Meet, chat, SMTP |
| jenkins-build | index.php | Y | — | per-team | Jenkins |
| jenkins-portal | index.php | Y | — | per-team | Jenkins |
| jenkins-proxy | index.php, api/jenkins-proxy.php | Y | — | per-team server list | Jenkins |
| jenkins-servers | index.php | Y | ADMIN_ROLES | per-team | — |
| jira | create/transition/attach/fields/issue-detail/incidents/smc-cases/users-search/… | Y | — | — | Jira Cloud |
| jira-config | index.php | Y | LEAD_ROLES, requireSmForShared | SM-shared | Jira (field metadata) |
| jira-requests | index.php | Y | — | per-team | Jira |
| knowledge-base | list/save/delete/import/categories/clear-all | Y | ADMIN_ROLES on writes | per-team (SM) | — |
| links | index.php | Y | LEAD_ROLES | per-team + section-scoped SM share | — |
| log | index.php | Y | super_admin | per-team logs | — |
| logging | LogRotator/rotate | n/a (cron) | — | per-team | — |
| ma-modules | config.php | Y | ADMIN_ROLES writes | per-team | — |
| ma-services | create/update/delete/list/import/jenkins-*/backoffice-*/jira-stats/log | Y | LEAD_ROLES writes | per-team | Jenkins, Jira, ACM backoffice OAuth |
| ma-status | index.php | Y | — | SM-shared live-pull | NANO CDN, TMN-OPS Jenkins, ACM OAuth |
| ma-test | catalog/plans/results/notify/config/_hydrate/catalog-import | Y (per file) | LEAD_ROLES writes | per-team (SM) | — |
| mail | send/logs/test/test-connection/_mailer/_templates/_branding | Y | — | per-team logs | SMTP |
| mail-config | index.php | Y | ADMIN_ROLES | per-team | SMTP (test) |
| maintenance | index.php | Y | super_admin | global | — |
| menu-permissions | index.php | Y | ADMIN_ROLES | per-team | — |
| migrate-user | index.php | Y | — | per-team | external DB |
| monitoring | metrics, PerformanceMonitor | Y | — | per-team | Prometheus |
| my-team | index.php | Y | — | per-team | — |
| nav-groups | index.php | Y | sm_admin,dev_sm,super_admin | per-team | — |
| notifications | index.php | Y | — | per-team | — |
| onboarding | admin/config/progress/upload/_lib | Y | admin writes | per-team | — |
| opensearch-config | index.php | Y | ADMIN_ROLES | per-team (SM) | — |
| opensearch-proxy | index.php | Y | — | per-user creds | OpenSearch |
| opensearch-saved-folders | index.php | Y | — | per-team shared (SM) | — |
| opensearch-saved-searches | index.php | Y | — | per-team shared (SM) | — |
| opensearch-user-creds | index.php | Y | — (self only) | per-user (AES encrypted) | — |
| ops-runbook | index.php | Y | LEAD_ROLES | per-team (SM) | — |
| pipeline-flows | index.php | Y | — | per-team | — |
| presence | heartbeat/list | n/a | — | per-team | — |
| pw-schedule | index.php | Y | requireSmForShared on writes | SM-shared | — |
| pw-schedule-config | index.php | Y | requireSmForShared | SM-shared | Teamup XHR |
| requests | index.php | Y | super_admin | global | — |
| restart-analyzer | index.php | Y | ALL_STAFF_ROLES | per-team cache | kube-state-metrics (Prom) |
| restart-monitor | index.php | Y | ALL_STAFF_ROLES | per-team | Grafana Thanos |
| restart-monitor-webhooks | index.php | Y | ADMIN_ROLES | per-team | — |
| schedule | index.php | Y | LEAD_ROLES | per-team | — |
| scheduled-noti | index.php | Y | ADMIN_ROLES | per-team | SMTP/cron |
| search | index.php | Y | — | per-team index | — |
| security | CsrfProtector/FileScanner/InputSanitizer | n/a | — | library | — |
| service-inventory | list/upload/restore | Y | ALL_STAFF_ROLES read; requireSmForShared writes | SM-shared CSV + history | — |
| service-performance | index.php + subsystems/sources/… | Y | ALL_STAFF_ROLES | SM-shared | Grafana Thanos, OpenSearch |
| service-severity | index.php | Y | ALL_STAFF_ROLES read, ADMIN_ROLES writes | per-team | n8n webhook |
| service-types | index.php | Y | LEAD_ROLES writes | per-team | — |
| sheets | index.php | Y | — | per-team | Google Sheets (iframe) |
| sidebar-tools | index.php | Y | LEAD_ROLES | per-team | — |
| sms-gateway | index.php | Y | — | per-team | SMS provider |
| so-jenkins | index.php | Y | — | per-team | Jenkins |
| stars | index.php | Y | — | per-user | — |
| super-viewer | index.php | Y | super_admin | global | — |
| super-viewer-config | index.php | Y | super_admin | global | — |
| syncup | index.php | Y | ADMIN_ROLES writes | per-team | — |
| system-settings | index.php | Y | ADMIN_ROLES | per-team | — |
| team-config | index.php | Y | ALL_STAFF_ROLES read, ADMIN_ROLES writes | per-team | — |
| teams | index.php | Y | super_admin | global | — |
| templates | index.php | Y | requireSmForShared | SM-shared | — |
| uptime | index.php | Y | ADMIN_ROLES writes | per-team | HTTP probes |
| users | index.php | Y | ADMIN_ROLES | per-team | — |
| weekly-report | *.php | Y (per file) | LEAD_ROLES on writes | per-team | Jira |

Top-level API files:

| File | Auth | Role | Purpose |
|---|---|---|---|
| upload.php | Y | — | Generic file upload (uploads/) |
| version.php | public | — | Build info |
| chat-proxy.php | Y | — | Chat/AI proxy |
| fundout-proxy.php | Y | — | Legacy fundout API proxy |
| rundeck-proxy.php | Y | — | Rundeck API proxy |
| jenkins-proxy.php | Y | — | Dup of jenkins-proxy/index.php (legacy flat path) |
| batch-records.php / batch-records-admin.php | Y | admin for -admin | Batch monitor data |
| test-records.php / test-records-admin.php | Y | admin for -admin | Test service data |
| test-service-config.php | Y | admin | Test service config |
| n8n-oncall.php / n8n-oncall-config.php | Y | admin for config | n8n on-call sync |
| n8n-severity-sync.php / n8n-severity-config.php | Y | admin | n8n severity sync |
| migrate-monthly.php | Y | admin | Monthly data migration |
| debug-nano-ma.php | Y | — | Debug tool for NANO MA |
| _debug-auth.php | n/a | — | Dev-only auth probe |
| helpers.php, config.php, jenkins_config.php, jenkins_helpers.php | library | — | Shared code |

## 5. Dead-looking files

Almost certainly dead (mockups, backups, unlinked experiments) → **Tier X**:

- Root HTML: `_dcl.html` (10 lines, debug probe), `dashboard-back.html`, `monitoring-back.html`, `service-performance-back.html` (11k lines backup!), `onboarding-backold.html`, `onboarding-backnew.html`, `jira-templates-backup.html`, `report-center-mockup.html`, `card-mockups-v2.html`, `mockup-endpoint-designs.html`, `mockup-genz-1-y2k.html`, `mockup-genz-2-bento.html`, `mockup-genz-3-glass.html`, `mockup-genz-4-zine.html`, `navbar-ma-indicator-mockups.html`, `test-incident-launcher.html`, `presentation.html`, `office.html`.
- Dev/debug: `debug-nano-ma.html` + `api/debug-nano-ma.php`, `api/_debug-auth.php`.
- Scripts (not pages): `apps-script-external-oncall.js`, `apps-script-external-oncall-v2.js` (Google Apps Script bundles).
- Admin: `email-footer-mockups.html`, `email-logo-mockups.html`, `email-logo-typewriter.html`, `email-mockups.html` — only referenced from each other and `mail-config.html` dropdown as previews.
- `batch-monitor-v2.html` — iteration; `batch-monitor.html` is still the one in nav.
- `cron.html` / `cron-builder.html` — not in nav; no coreNavItems entry. Likely dead or SM-admin private.
- `command-center-real.html` — not in nav, 593-line experimental dashboard.
- `report.html` — short (157 lines), appears superseded by `report-center.html` + `weekly-report.html`.

Not sure (listed in menu-permissions.sm_user but no nav group):

- `pipeline-flow.html`, `collection-lead-flow.html` — menu-permissions allows sm_user but neither is in `nav-groups.json`; may be launched from board or SM-internal workflows. Verify before dropping.
- `compare.html` — deep-linked from `service-performance.html` (Copy link / overlay 2-8 services); keep.

Legacy flat API endpoints that duplicate module subpaths — potential consolidation candidates: `api/jenkins-proxy.php` (dup of `api/jenkins-proxy/index.php`); `api/n8n-oncall*.php` (while `admin/n8n-oncall-config.html` already imports it, could be moved under `api/n8n/` module). Keep for now.

## 6. Gaps vs prior memory `project_som_full_feature_map`

Memory claimed “71 user + 73 admin pages / 8 roles”. Admin count matches, user count under-reports by ~17 (we found 88 incl. mockups; ~69 real active). Specific pages the memory did not call out:

- `alert-monitor.html`, `case-incidents.html`, `collection-lead-flow.html`, `compare.html`, `pipeline-flow.html`, `command-center-real.html`, `batch-file-search.html`, `analytics.html`, `begin-grafana.html`, `change-password.html`, `cron.html`, `cron-builder.html`, `report.html`, `batch-monitor-v2.html`, `holiday-plans.html` (user-side), `maintenance.html`, `migrate-user.html`, `sms-gateway-switches.html`, `grafana-alerts.html`, `syncup.html`, `test-service.html`, `uptime.html`, `monitoring.html`, `jenkins-build.html`, `jenkins-portal.html`, `so-jenkins.html`, `import-ma.html`, `ma-planwork.html`, `weekly-report-form.html`, `knowledge-base.html` (user-side), `ops-runbook.html` (user-side), `exam.html`, `learn-course.html`, `learn-phase.html`, `documentation.html`, `setup-guide.html`, `about-som.html`, `_dcl.html`, all mockup / backup HTML files.
- Admin pages missing from memory: `admin/analytics.html`, `admin/alert-monitor-config.html`, `admin/batch-file-index.html`, `admin/batch-meta.html`, `admin/batch-monitor-noti.html`, `admin/batch-monitor.html`, `admin/dev-*` set (6 pages), `admin/email-*mockups` (4 pages), `admin/fh-config.html`, `admin/leave-approval.html`, `admin/mail-logs.html`, `admin/menu-permissions.html`, `admin/nav-groups.html`, `admin/n8n-oncall-config.html`, `admin/ops-runbook.html`, `admin/scheduled-noti.html`, `admin/service-inventory.html`, `admin/service-severity.html`, `admin/sheets.html`, `admin/sms-gateway-config.html`, `admin/super-admin.html`, `admin/super-email-templates.html`, `admin/super-feature-requests.html`, `admin/super-team-permissions.html`, `admin/super-viewer.html`, `admin/syncup-config.html`, `admin/system-monitor.html`, `admin/test-service.html`, `admin/tools.html`, `admin/trash.html`.
- APIs memory missed: `ai`, `batch-deps`, `cache`, `cutoff-services`, `dashboard`, `dev`, `dev-subteams`, `downstream-health`, `email-templates`, `fh-email-config`, `grafana-alerts`, `grafana-sources`, `jenkins-build`, `jenkins-portal`, `jira-requests`, `logging`, `ma-modules`, `maintenance`, `migrate-user`, `monitoring`, `my-team`, `nav-groups`, `opensearch-saved-folders`, `opensearch-saved-searches`, `opensearch-user-creds`, `pipeline-flows`, `pw-schedule-config`, `restart-monitor-webhooks`, `security`, `service-inventory`, `service-severity`, `service-types`, `so-jenkins`, `super-viewer-config`, `team-config`, `teams`.

## 7. Priority tier definitions

- **T1 (SM daily workflow — must ship for v2 cut-over):** login/forgot/reset/profile, dashboard, board, send-email, jira-templates, case-incidents, incident-launcher, ma-services, ma-status, service-performance, restart-monitor, restart-analyzer, log-explorer, maintenance; admin: users, board, templates, jira-config, jenkins-servers, grafana-sources, opensearch-config, service-inventory, system-settings, menu-permissions, ma-config, ma-status, incident-launcher-config, super-team-permissions, maintenance.
- **T2 (weekly workflow + core admin):** my-team, about-som, schedule, pw-schedule, inbox, batch-monitor, batch-file-search, jenkins-build, jenkins-portal, weekly-report, weekly-report-form, report-center, ma-test, alert-monitor, monitoring, uptime, grafana-alerts, begin-grafana, test-service, settings; admin: schedule, announcements, ma-test-*, batch-*, alert-monitor-config, scheduled-noti, pw-schedule, system-monitor, service-severity, nav-groups, backup, trash, logs, links, tools, super-admin, super-viewer, about-page, mail-config.
- **T3 (niche / per-feature / per-team gated):** sheets, sabai, onboarding, so-jenkins, migrate-user, sms-gateway-switches, analytics, syncup, ma-planwork, import-ma, learn/learn-*/exam, learn-reports, exam-reports, knowledge-base, ops-runbook, documentation, setup-guide, genz-hub, genz-notes, dev-hub, holiday-plans, pipeline-flow, collection-lead-flow, compare, report; admin: achievements, holiday-plans, leave-approval, feature-requests, knowledge-base, courses, exams, onboarding, weekly-report, sheets, ops-runbook, mail-logs, email-noti, n8n-oncall-config, sms-gateway-config, fh-config, syncup-config, batch-monitor-noti, genz-team, super-feature-requests, super-email-templates, requests, analytics, email-mockups (TX actually), dev-* (6 pages — devops only), ma-test-overview.
- **TX (dead / mockup / backup — do NOT port to v2):** `_dcl.html`, `dashboard-back.html`, `monitoring-back.html`, `service-performance-back.html`, `onboarding-backold.html`, `onboarding-backnew.html`, `jira-templates-backup.html`, `report-center-mockup.html`, `card-mockups-v2.html`, `mockup-endpoint-designs.html`, `mockup-genz-{1..4}.html`, `navbar-ma-indicator-mockups.html`, `test-incident-launcher.html`, `presentation.html`, `office.html`, `debug-nano-ma.html`, `command-center-real.html`, `cron.html`, `cron-builder.html`, `batch-monitor-v2.html`, admin/email-{footer,logo,logo-typewriter,}-mockups.html, api/_debug-auth.php, api/debug-nano-ma.php, legacy `api/jenkins-proxy.php` flat file.
