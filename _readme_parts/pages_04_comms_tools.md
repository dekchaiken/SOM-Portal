# Pages: Communications, Tools & Team — Data Source Map

> Source-derived from HTML + JS files. Every API call, data file, and external service extracted from actual source code.

---

## 1. send-email.html — SMC Ticket / Send Email

**Path:** `send-email.html`  
**Role:** ALL_STAFF_ROLES (any authenticated user)  
**Page JS:** `assets/pages/send-email/send-email.js`

### API Calls

| Call | Purpose |
|------|---------|
| `GET /api/jira/smc-cases.php?date=YYYY-MM-DD` | Load Jira cases for the selected date |
| `GET /api/mail-config/index.php` | Load SMTP config (checks configured state) |
| `GET /api/service-types/index.php` | Load service type dropdown |
| `POST /api/mail/send.php` | Send email (via SMTP) |
| `GET /api/jira/field-options.php` | Load Jira field option lists |
| `POST /api/jira/create.php` | Create Jira ticket |
| `GET /api/jira/issue-detail.php?key=SMC-xxx` | Load issue detail for pre-fill |
| `POST /api/jira/attach.php` (raw fetch, multipart) | Attach file to Jira issue |
| `POST /api/jira/add-comment.php` | Add ADF comment to issue |
| `GET /api/jira/users-search.php?q=...` | Search Jira users (assignee picker) |
| `GET /api/jira/transition-fields.php?key=...&transitionId=...` | Get required fields for transition |
| `POST /api/jira/transition.php` | Transition issue status |
| `POST /api/jira/assign.php` | Assign issue to user |

### Data Files

| File | Access |
|------|--------|
| `data/sm/jira_config.json` | Read (SM-shared custom field config) |
| `data/{team}/service-types.json` | Read (board service taxonomy) |
| `data/sm/mail_config.json` | Read (SMTP settings) |
| `data/sm/mail_logs.json` | Write (email send log) |

### External Services

- **Jira Cloud** (`https://truemoney.atlassian.net`) — REST API with Basic Auth (`JIRA_EMAIL:JIRA_TOKEN`)
- **SMTP** — via `api/mail/send.php` (raw cURL SMTP)

---

## 2. sms-gateway-switches.html — SMS Gateway Switch Log

**Path:** `sms-gateway-switches.html`  
**Role:** ALL_STAFF_ROLES  
**Page JS:** `assets/pages/sms-gateway-switches/sms-gateway-switches.js`

### API Calls

| Call | Purpose |
|------|---------|
| `GET /api/sms-gateway/index.php?project=tmn|nano|welth` | Load switch log for project |
| `PATCH /api/sms-gateway/index.php?id=...&project=...` `{remark}` | Update remark on a switch record |
| `POST /api/sms-gateway/sync.php?project=tmn|nano|welth` | Sync one project from Jenkins |
| `POST /api/sms-gateway/sync-all.php` | Sync all 3 projects at once |
| `GET /api/fh-email-config/index.php` | Load FH email config (for notification email) |
| `POST /api/mail/send.php` | Send notification email after switch |

### Data Files

| File | Access |
|------|--------|
| `data/{team}/sms_gateway_tmn.json` | Read/Write |
| `data/{team}/sms_gateway_nano.json` | Read/Write |
| `data/{team}/sms_gateway_welth.json` | Read/Write |
| `data/sm/fh_email_config.json` (SM-shared) | Read |
| `data/sm/mail_config.json` (SM-shared) | Read |

### External Services

- **Jenkins** — sync pulls SMS gateway job results via Jenkins proxy

---

## 3. incident-launcher.html — Incident Launcher

**Path:** `incident-launcher.html`  
**Role:** SM team only (`team === 'sm'`), ALL_STAFF_ROLES for config read  
**Page JS:** `assets/pages/incident-launcher/incident-launcher.js`, `wizard.js`

### API Calls

| Call | Purpose |
|------|---------|
| `GET /api/incident-launcher/index.php?action=config` | Load full incident launcher config |
| `GET /api/incident-launcher/index.php?action=impact_summary&from=...&to=...` | Load impact KPIs |
| `GET /api/incident-launcher/index.php?action=jira_issue&key=SMC-xxx` | Fetch Jira issue summary/status |
| `GET /api/incident-launcher/index.php?action=jira_transitions&key=SMC-xxx` | Fetch Jira transitions |
| `GET /api/incident-launcher/index.php?action=bo_config_peek&application=X&key=Y` | Read backoffice config value |
| `GET /api/service-performance/index.php?runway=all` | Load service list for picker |
| `GET /api/jira/field-options.php` | Load Jira custom field options |
| `POST /api/incident-launcher/index.php` `{action:'notify_channel', channel_id, message}` | Notify a configured channel |
| `POST /api/incident-launcher/index.php` `{action:'jira_do_transition', key, transition_id, fields}` | Transition Jira issue |
| `POST /api/incident-launcher/index.php` `{action:'bo_config_update', application, key, value, environment, profile}` | Update backoffice config |
| `POST /api/incident-launcher/index.php` `{action:'save_config', ...}` | Save config (admin/lead) |
| `POST /api/board/` (via `API.board.create`) | Create board post |
| `POST /api/jira/create.php` (via `API.jira.createTicket`) | Create Jira ticket |
| `POST /api/jenkins-proxy/index.php?action=build` | Trigger Jenkins MA job |
| `GET /api/jenkins-proxy/index.php?server=...&path=.../api/json` | Poll Jenkins job/build status |
| `POST /api/mail/send.php` | Send notification email |

### Data Files

| File | Access |
|------|--------|
| `data/sm/incident-launcher-config.json` | Read/Write |
| `data/{team}/board.json` | Write (create post) |
| `data/sm/jenkins_servers.json` | Read |
| `data/sm/service-performance-sources.json` | Read |

### External Services

- **Jira Cloud** — create ticket, transition, field metadata
- **Jenkins** — trigger MA jobs via jenkins-proxy
- **Google Chat** — webhook POST (platform: `googlechat`)
- **LINE Notify** — `https://notify-api.line.me/api/notify` (platform: `line`)
- **DingTalk** — webhook POST (platform: `dingtalk`)
- **ACM Backoffice** — `GET/PUT /acm-backoffice-api-gateway/ops-service-maintenance-server/...` via Keycloak Bearer token
- **Google Meet** — link generated (no API call, format: `meet.google.com/xxx-xxx-xxx`)
- **SMTP** — `api/mail/send.php`

---

## 4. analytics.html — Analytics Dashboard

**Path:** `analytics.html`  
**Role:** ALL_STAFF_ROLES  
**Page JS:** `assets/pages/analytics/analytics-dashboard.js`, `analytics-page.js`  
**External lib:** Chart.js 4.4.1 (CDN)

### API Calls

| Call | Purpose |
|------|---------|
| `GET /api/jira/incidents-analytics.php?fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD[&refresh=1]` | Aggregated incident stats from Jira (per-month cache, Jira JQL) |
| `GET /api/jira/smc-analytics.php?fromDate=...&toDate=...[&refresh=1]` | Aggregated Monitoring+Batchfile stats from Jira (per-month cache) |
| `GET /api/jira/smc-cases.php?date=...` | Recent SMC cases for activity list |

### Data Files

| File | Access |
|------|--------|
| `data/analytics-cache/incidents-YYYY-MM.json` | Read/Write (per-month cache, TTL: past months = forever, current = 10min) |
| `data/analytics-cache/smc-YYYY-MM.json` | Read/Write (same TTL strategy) |
| `data/{team}/team-config.json` | Read (to classify SM/TS assignee in smc-analytics) |

### External Services

- **Jira Cloud** — JQL search (`/rest/api/3/search/jql`) for incidents and SMC issues

---

## 5. report-center.html — Report Center

**Path:** `report-center.html`  
**Role:** ALL_STAFF_ROLES  
**Page JS:** `assets/pages/report-center/report-center.js`

### API Calls

| Call | Purpose |
|------|---------|
| `GET /api/ma-test/plans.php?month=YYYY-MM` | Load MA test plans for month |
| `GET /api/ma-test/results.php?month=YYYY-MM` | Load MA test results for month |
| `GET /api/users/index.php` | Load user list (for report filters) |
| `GET /api/weekly-report/list.php` | List available weekly report weeks |
| `GET /api/weekly-report/get.php?week=week-YYYY-MM-DD` | Load one week's report |
| `GET /api/alert-monitor/compare.php?a=...&b=...` | Compare two alert monitor snapshots |
| `GET /api/alert-monitor/stats.php?from=...&to=...` | Alert monitor stats for date range |
| `GET /api/jira/smc-analytics.php?...` | SMC Jira analytics summary |

### Data Files

| File | Access |
|------|--------|
| `data/{team}/ma-test/plans.json` | Read |
| `data/{team}/ma-test/results-YYYY-MM.json` | Read |
| `data/users.json` (global) | Read |
| `data/weekly-report/week-YYYY-MM-DD.json` | Read |
| `data/analytics-cache/smc-YYYY-MM.json` | Read (via smc-analytics) |

---

## 6. pipeline-flow.html — Pipeline Flow

**Path:** `pipeline-flow.html`  
**Role:** ALL_STAFF_ROLES (read) · Write available to all (no explicit role restriction in API)  
**Page JS:** `assets/pages/pipeline-flow/pipeline-flow.js`

### API Calls

| Call | Purpose |
|------|---------|
| `GET /api/pipeline-flows/index.php` | List all flows |
| `GET /api/pipeline-flows/index.php?flow=<id>` | Load one flow |
| `POST /api/pipeline-flows/index.php?action=create` `{org, name}` | Create flow |
| `POST /api/pipeline-flows/index.php?flow=<id>&action=add-job` `{...}` | Add job node |
| `POST /api/pipeline-flows/index.php?flow=<id>&action=delete-job` `{pattern}` | Delete job node |
| `POST /api/pipeline-flows/index.php?flow=<id>&action=add-edge` `{from, to, note}` | Add edge |
| `POST /api/pipeline-flows/index.php?flow=<id>&action=delete-edge` `{from, to}` | Delete edge |
| `DELETE /api/pipeline-flows/index.php?flow=<id>` | Delete flow |
| `GET /api/jenkins-proxy/index.php?server=...&path=.../api/json` (via `API.jenkins.jobs`) | Fetch live Jenkins job status |
| `GET /api/jenkins-proxy/?list=1` (via `API.jenkins.servers`) | List Jenkins servers |

### Data Files

| File | Access |
|------|--------|
| `data/{team}/pipeline_flows.json` | Read/Write |
| `data/sm/jenkins_servers.json` (SM-shared) | Read |

### External Services

- **Jenkins** — live job status via jenkins-proxy

---

## 7. sheets.html — Team Docs (Google Sheets / Docs / Slides)

**Path:** `sheets.html`  
**Role:** ALL_STAFF_ROLES (read/add) · Edit/Delete = author OR ADMIN_ROLES  
**Page JS:** `assets/pages/sheets/sheets.js`

### API Calls

| Call | Purpose |
|------|---------|
| `GET /api/sheets/index.php` (via `API.sheets.list()`) | List all docs |
| `GET /api/sheets/categories.php` (via `API.sheets.getCategories()`) | Load category list |
| `POST /api/sheets/index.php` (via `API.sheets.create(payload)`) | Add doc |
| `PUT /api/sheets/index.php?id=...` (via `API.sheets.update(id, payload)`) | Update doc |
| `DELETE /api/sheets/index.php?id=...` (via `API.sheets.delete(id)`) | Delete doc |
| `POST /api/sheets/star.php?id=...` (via `API.sheets.star(id)`) | Star doc |
| `DELETE /api/sheets/star.php?id=...` (via `API.sheets.unstar(id)`) | Unstar doc |

### Data Files

| File | Access |
|------|--------|
| `data/{team}/sheets.json` | Read/Write |

### External Services

- **Google Sheets / Docs / Slides** — embedded as `<iframe>` only (no API calls, just URL rendering)  
  URLs converted server-side: `spreadsheets/edit → embed`, `document/edit → preview`, `presentation/edit → embed`

---

## 8. pw-schedule.html — PW Schedule (Planwork)

**Path:** `pw-schedule.html`  
**Role:** ALL_STAFF_ROLES (read/write items) · Config = ADMIN_ROLES  
**Note:** Described as SM-only in docs, but API uses `ALL_STAFF_ROLES`  
**Page JS:** `assets/pages/pw-schedule/pw-schedule.js`, `pw-schedule-page.js`

### API Calls

| Call | Purpose |
|------|---------|
| `GET /api/pw-schedule/index.php?list_rounds=1` | List rounds (date groups) |
| `GET /api/pw-schedule/index.php?active=1` | Get current active round |
| `GET /api/pw-schedule/index.php?round=YYYY-MM-DD` | Load one round's items |
| `POST /api/pw-schedule/index.php` `{round, type, pw_name, start, end, mop, meet, task, ...}` | Create item |
| `PUT /api/pw-schedule/index.php?id=...` | Update item |
| `PATCH /api/pw-schedule/index.php?id=...&action=toggle` | Toggle item completed |
| `DELETE /api/pw-schedule/index.php?id=...` | Delete item |
| `POST /api/pw-schedule/notify.php` `{round}` | Send notification for round |
| `POST /api/pw-schedule/notify.php` `{round, test:true, webhook_url}` | Test notification |
| `GET /api/pw-schedule/teamup.php?start=YYYY-MM-DD&end=...` | Fetch Teamup calendar events |
| `POST /api/pw-schedule/sync.php` `{round, dry_run?}` | Sync items from Google Sheet via n8n |
| `GET /api/pw-schedule/template.php?id=...` (via `API.pwSchedule.buildTemplate`) | Build notification text template |
| `POST /api/pw-schedule/notify-text.php` (via `API.pwSchedule.notifyText`) | Send custom text notification |
| `POST /api/upload.php` (multipart) | Upload image attachment |

### Data Files

| File | Access |
|------|--------|
| `data/sm/pw_schedule.json` (SM-shared) | Read/Write |
| `data/sm/pw_schedule_config.json` (SM-shared) | Read/Write |
| `data/{team}/pw-schedule-cache-*.json` | Read/Write (Teamup 5min cache) |

### External Services

- **Teamup Calendar** — `GET https://teamup.com/{key}/events?...` (ICS or undocumented XHR endpoint)  
  or `GET https://api.teamup.com/{key}/events?api_key=...` (official API mode)  
  Config in `pw_schedule_config.json` (mode, key)
- **n8n** — sync PW items from Google Sheet via webhook (`pw-schedule/sync.php`)
- **Google Chat** — notify webhook after schedule changes

---

## 9. schedule.html — Shift Schedule

**Path:** `schedule.html`  
**Role:** ALL_STAFF_ROLES  
**Page JS:** `assets/pages/schedule/schedule.js`

### API Calls

| Call | Purpose |
|------|---------|
| `GET /api/schedule/index.php?year=Y&month=M` (via `API.schedule.get`) | Load schedule for month |
| `POST/PUT/DELETE /api/schedule/index.php` | Create/update/delete shift entries |
| `GET /api/users/index.php` | Load team member list |
| `GET /api/schedule/user-colors.php` (via `API.userColors.get`) | Load per-user color assignments |
| `GET /api/schedule/holidays.php?year=Y` (via `API.holidays.list`) | Load public holidays |
| `GET /api/schedule/leave.php` (via `API.leave.list`) | Load leave requests |
| `POST /api/schedule/leave.php` (via `API.leave.submit`) | Submit leave request |
| `DELETE /api/schedule/leave.php?id=...&cancel=true` (via `API.leave.cancel`) | Cancel leave |
| `GET /api/schedule/vacation-quota.php` (via `API.vacation.getQuotas`) | Load vacation quotas |
| `GET /api/schedule/vacation-quota.php?user_id=...` (via `API.vacation.getUserQuota`) | Load one user's quota |
| `GET /api/holiday-plans/index.php?year=Y&month=M` (via `API.holidayPlans.get`) | Load holiday plans for modal |
| `POST /api/holiday-plans/index.php` (via `API.holidayPlans.save`) | Save holiday date selections |
| `DELETE /api/holiday-plans/index.php?year=Y&month=M` (via `API.holidayPlans.clear`) | Clear holiday plan |
| Batch: all 12 months `API.schedule.get(Y, i+1)` | Pre-load full year for export |

### Data Files

| File | Access |
|------|--------|
| `data/{team}/schedule.json` | Read/Write |
| `data/users.json` (global) | Read |
| `data/{team}/user-colors.json` | Read/Write |
| `data/{team}/holidays.json` | Read/Write |
| `data/{team}/leave.json` | Read/Write |
| `data/{team}/vacation-quota.json` | Read/Write |
| `data/{team}/holiday-plans.json` | Read/Write |

---

## 10. syncup.html — Sync Up

**Path:** `syncup.html`  
**Role:** ALL_STAFF_ROLES  
**Page JS:** `assets/pages/syncup/syncup.js`

### API Calls

| Call | Purpose |
|------|---------|
| `GET /api/syncup/index.php?date=TODAY` (via `API.syncup.getRecord`) | Load today's sync-up record |
| `GET /api/syncup/index.php?range=14` (via `API.syncup.getRange`) | Load last 14 days |
| `DELETE /api/syncup/index.php?date=...&shift=morning|evening` (via `API.syncup.deleteRecord`) | Delete a shift record |
| `POST /api/syncup/upload.php` (via `API.syncup.upload`) | Upload sync-up image |

### Data Files

| File | Access |
|------|--------|
| `data/{team}/syncup.json` (`SYNCUP_FILE`) | Read/Write |
| `data/{team}/syncup-config.json` (`SYNCUP_CONFIG`) | Read (config only, write via admin) |
| `uploads/syncup/` | Write (image uploads) |

---

## 11. holiday-plans.html — Holiday Plans

**Path:** `holiday-plans.html`  
**Role:** ALL_STAFF_ROLES  
**Page JS:** `assets/pages/holiday-plans/holiday-plans.js`

### API Calls

| Call | Purpose |
|------|---------|
| `GET /api/schedule/holidays.php` (via `API.holidays.list`) | Load public holidays |
| `GET /api/schedule/leave.php` (via `API.leave.list`) | Load leave requests |
| `GET /api/users/index.php` (via `API.users.list`) | Load user list |
| `GET /api/schedule/vacation-quota.php` (via `API.vacation.getQuotas`) | Load all quotas |
| `GET /api/holiday-plans/index.php?year=Y&month=M` (via `API.holidayPlans.get`) | Load plans for year/month |
| `POST /api/holiday-plans/index.php` (via `API.holidayPlans.save`) | Save plan `{year, month, dates}` |
| `DELETE /api/holiday-plans/index.php?year=Y&month=M` (via `API.holidayPlans.clear`) | Clear month plan |

### Data Files

| File | Access |
|------|--------|
| `data/{team}/holiday-plans.json` | Read/Write |
| `data/{team}/holidays.json` | Read |
| `data/{team}/leave.json` | Read |
| `data/users.json` (global) | Read |
| `data/{team}/vacation-quota.json` | Read |

---

## 12. weekly-report.html — Weekly Report (View)

**Path:** `weekly-report.html`  
**Role:** ALL_STAFF_ROLES  
**Page JS:** `assets/js/weekly-report/api.js`, `dashboard.js`, `presentation.js`, `analytics.js`, `assets/pages/weekly-report/weekly-report.js`  
**External lib:** Chart.js 4.4.0 (CDN)

### API Calls

| Call | Purpose |
|------|---------|
| `GET /api/weekly-report/list.php` | List all available week IDs |
| `GET /api/weekly-report/get.php?week=week-YYYY-MM-DD` | Load one week's full report |
| `GET /api/weekly-report/sync-jira-incidents.php?week=...` | Sync incidents from Jira (JQL-based) |
| `GET /api/weekly-report/sync-jira-ma.php?week=...` | Sync MA data from Jira |
| `POST /api/weekly-report/log-activity.php` | Log page view activity |
| `GET /api/weekly-report/test-jira-connection.php` | Test Jira connectivity |

### Data Files

| File | Access |
|------|--------|
| `data/weekly-report/week-YYYY-MM-DD.json` | Read (NOT team-scoped — uses `../../data/weekly-report/` directly) |
| `data/{team}/weekly-report-jira.json` | Read (JQL config for sync) |
| `data/analytics-cache/incidents-YYYY-MM.json` | Read/Write (via sync) |

### External Services

- **Jira Cloud** — `sync-jira-incidents.php` pulls via JQL configured in `weekly-report-jira.json`

---

## 13. weekly-report-form.html — Weekly Report Form

**Path:** `weekly-report-form.html`  
**Role:** ALL_STAFF_ROLES  
**Page JS:** `assets/js/weekly-report/form.js`, `api.js`, `assets/pages/weekly-report-form/weekly-report-form.js`

### API Calls

| Call | Purpose |
|------|---------|
| `GET /api/weekly-report/list.php` | List weeks |
| `GET /api/weekly-report/get.php?week=...` | Load existing week data |
| `POST /api/weekly-report/save.php` `{week, section, subType?, data}` | Save/update entry |
| `POST /api/weekly-report/log-activity.php` | Log activity |

### Data Files

| File | Access |
|------|--------|
| `data/weekly-report/week-YYYY-MM-DD.json` | Read/Write (NOT team-scoped — direct `../../data/weekly-report/`) |

---

## 14. migrate-user.html — Migrate User (Rundeck)

**Path:** `migrate-user.html`  
**Role:** ALL_STAFF_ROLES (inline auth check only)  
**Note:** Inline JS in HTML (no separate page JS file)

### API Calls

| Call | Purpose |
|------|---------|
| `GET /api/rundeck-proxy.php?action=run_migrate&tmnID=...&contact=...` | Trigger Rundeck migrate job |
| `GET /api/rundeck-proxy.php?action=status&executionId=...&src=migrate` | Poll Rundeck execution status |
| `GET /api/rundeck-proxy.php?action=output&executionId=...&src=migrate` | Poll Rundeck live log output |
| `GET /api/migrate-user/index.php?action=history&limit=5` | Load recent run history |

### Data Files

| File | Access |
|------|--------|
| `data/{team}/logs/activity.json` | Write (`migrate_user_run` activity logged in rundeck-proxy) |

### External Services

- **Rundeck** (`https://th-ops-rundeck.mgt.ascendmoney.io`) — job trigger via `api/rundeck-proxy.php`  
  Rundeck URL: `https://th-ops-rundeck.mgt.ascendmoney.io/execution/show/{executionId}`  
  Auth: session cookie (J_SECURITY_CHECK login in proxy)  
  Poll interval: every 2.5 seconds

---

## 15. test-service.html — Service Test / Fund-Out Reconcile

**Path:** `test-service.html`  
**Role:** ALL_STAFF_ROLES (read/test) · Config write = ADMIN_ROLES  
**Note:** Has 3 tabs: Reconcile, Portal (Jenkins), Records  
**Page JS:** `assets/pages/test-service/test-service.js`

### API Calls

| Call | Purpose |
|------|---------|
| `GET /api/test-service-config.php?action=get-groups` | Load test service groups config |
| `GET /api/test-service-config.php?action=get-reconcile-credentials` | Check if reconcile creds saved |
| `POST /api/fundout-proxy.php?action=has-config` | Check if fund-out creds configured |
| `POST /api/fundout-proxy.php?action=save-config` `{username, password}` | Save fund-out Keycloak creds |
| `GET /api/fundout-proxy.php?action=check&...` | Query fund-out reconcile API |
| `GET /api/jenkins-proxy.php?url=<jenkins-url>` | Proxy Jenkins job API |
| `POST /api/test-records.php?action=submit` | Submit test record |
| `GET /api/test-records-admin.php?action=months` | List months with records |
| `GET /api/test-records-admin.php?action=list&month=YYYY-MM` | List records for month |
| `POST /api/test-records-admin.php?action=edit&month=...` `{id, ...}` | Edit a record |
| `DELETE /api/test-records-admin.php?action=delete&month=...` | Delete records for month |
| `POST /api/jira/create.php` (via `API.jira.createTicket`) | Create Jira ticket for anomaly |
| `POST /api/chat-proxy.php` `{webhook, message}` | Send Google Chat notification |

### Data Files

| File | Access |
|------|--------|
| `data/{team}/test-service-config.json` | Read/Write (group config) |
| `data/reconcile-config.json` (global `../data/`) | Read/Write (Keycloak creds, encrypted) |
| `data/{team}/test-records-YYYY-MM.json` | Read/Write (monthly) |
| `data/{team}/holidays.json` | Read (for coverage calc) |

### External Services

- **Keycloak** (`https://acm-backoffice-aaa.backoffice-a-cloud1p.ascendmoney.io/realms/finops/...`) — ROPC token for fund-out
- **ACM Financial Portal** (`https://acm-financial-portal.backoffice-a-cloud1p.ascendmoney.io/acm-financial-portal/api/fund-out/report`) — fund-out reconcile API
- **Jenkins** (`https://jenkins-batch-eks-cicd.private-a-cloud1p.ascendmoney.io`) — Portal tab job status
- **Jira Cloud** — create ticket for anomaly
- **Google Chat** — webhook notification

---

## 16. dev-hub.html — Dev Team Hub

**Path:** `dev-hub.html`  
**Role:** `dev_user` + ADMIN_ROLES (super_admin, dev_sm)  
**Page JS:** `assets/pages/dev-hub/dev-hub.js`

### API Calls

| Call | Purpose |
|------|---------|
| `GET /api/about-page/index.php` (via `API.aboutPage.get()`) | Load About SOM team page content |

### Data Files

| File | Access |
|------|--------|
| `data/sm/about-page.json` | Read |

### Notes

- Primarily displays static content + links to `service-performance.html` and `restart-monitor.html`
- Uses `announcements.js` for announcement banner

---

## 17. cron-builder.html — Cron Builder

**Path:** `cron-builder.html`  
**Role:** ALL_STAFF_ROLES  
**Page JS:** `assets/pages/cron-builder/cron-builder.js`

### API Calls

None — purely client-side cron expression builder. No API calls, no data files.

### Notes

- Visual UI to construct cron expressions (minute/hour/day/month/weekday selectors)
- Generates human-readable description client-side
- Used as embedded `<iframe>` in `pw-schedule.html` for cron notification scheduling

---

## 18. office.html — Office 3D Floor Plan

**Path:** `office.html`  
**Role:** ALL_STAFF_ROLES  
**Page JS:** `assets/pages/office/office.js`

### API Calls

| Call | Purpose |
|------|---------|
| `GET /api/presence/` (via `API.presence.list()`) | Load online users list (refreshed every 20s) |
| `PATCH /api/presence/` (via `API.presence.heartbeat('office')`) | Send heartbeat |

### Data Files

| File | Access |
|------|--------|
| `data/{team}/presence.json` | Read (online users within last 60s) |

### External Services / Libraries

- **Three.js** — 3D rendering with OrbitControls (loaded from assets)
- No external data services — floor plan is hardcoded 3D geometry in JS

---

## 19. documentation.html — Documentation Viewer

**Path:** `documentation.html`  
**Role:** ALL_STAFF_ROLES  
**Page JS:** `assets/pages/documentation/docs-viewer.js`  
**External libs:** marked.js 12.0.0, DOMPurify 3.1.6, highlight.js 11.9.0 (all CDN)

### API Calls

| Call | Purpose |
|------|---------|
| `fetch(path)` — relative Markdown files | Load `.md` files from `docs/user-guide/` |

### Data Files (Static, not JSON API)

All content loaded as static Markdown files via relative `fetch()`:

| Section | Files |
|---------|-------|
| Home | `docs/user-guide/index.md`, `dashboard.md`, `profile.md`, `change-password.md`, `settings.md` |
| Team | `board.md`, `sheets.md`, `sabai.md`, `schedule.md`, `pw-schedule.md`, `inbox.md`, `syncup.md` |
| Ticket | `send-email.md`, `weekly-report.md`, `analytics.md` |
| MA/Service | `ma-services.md`, `test-service.md`, `onboarding.md` |
| Monitoring | `monitoring.md`, `batch-monitor.md`, `alert-monitor.md`, `uptime.md`, `restart-monitor.md` |
| Learning | `learn.md`, `knowledge-base.md`, `ops-runbook.md` |

### Notes

- No API calls — purely serves and renders Markdown from the `docs/` directory
- Bookmarks stored in `localStorage` only (no server persistence)
- URL uses `?doc=<id>` for deep-linking
