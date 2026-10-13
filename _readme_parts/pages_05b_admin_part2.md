# Admin Pages (Part 2) — API Calls & Data Files

> Derived from HTML source + page JS files + PHP API source.
> Location prefix: `admin/`  
> All admin pages require `sm_admin` minimum unless noted as `super_admin` only.

---

## MA Management

### admin/ma-test-catalog.html
**Role:** `sm_admin`, `sm_lead`, `dev_sm`, `super_admin` · SM team only

**API calls (via MaTest namespace in `assets/js/ma-test.js`):**
- `GET /api/ma-test/catalog.php` → list catalog entries
- `GET /api/ma-test/catalog.php?id=<id>` → single entry
- `POST /api/ma-test/catalog.php` → create
- `PUT /api/ma-test/catalog.php?id=<id>` → update
- `DELETE /api/ma-test/catalog.php?id=<id>` → soft/hard delete
- `POST /api/ma-test/catalog-import.php` (multipart CSV) → bulk import
- `POST /api/ma-test/catalog-import.php?bootstrap=1` → bootstrap from defaults
- `POST /api/ma-test/catalog.php?action=auto_link` → auto-link catalog to usecase IDs
- `POST /api/ma-test/catalog.php?action=bulk_from_usecases` → bulk create from MA services
- `GET /api/ma-services/list.php` → load usecase list for linking

**Data files read/written:**
- `data/{team}/ma-test/catalog.json` (per-team)
- `data/sm/ma-services.json` (SM-shared, read-only for linking)

**External:** none

---

### admin/ma-test-plans.html
**Role:** `sm_admin`, `sm_lead`, `dev_sm`, `super_admin` · SM team only

**API calls:**
- `GET /api/ma-test/plans.php?month=YYYY-MM` → list plans for month
- `GET /api/ma-test/plans.php?months=1` → list available months
- `POST /api/ma-test/plans.php?month=YYYY-MM` `{catalog_ids, ...extra}` → add to plan
- `DELETE /api/ma-test/plans.php?month=YYYY-MM&id=<id>` → remove from plan

**Data files:** `data/{team}/ma-test/plans-YYYY-MM.json` (per-team, monthly)

---

### admin/ma-test-overview.html
**Role:** `sm_admin`, `dev_sm`, `super_admin` · SM team only

**API calls:**
- `GET /api/ma-test/plans.php?months=1` → available months
- `GET /api/ma-test/plans.php?month=YYYY-MM` → plan for month
- `GET /api/ma-test/results.php?month=YYYY-MM` → results
- `POST /api/ma-test/results.php?month=YYYY-MM` → create result
- `PUT /api/ma-test/results.php?month=YYYY-MM&id=<id>` → update result
- `DELETE /api/ma-test/results.php?month=YYYY-MM&id=<id>` → delete result
- `GET /api/ma-test/config.php` → webhook config list
- `POST /api/ma-test/config.php` → add webhook
- `PUT /api/ma-test/config.php?id=<id>` → update webhook
- `DELETE /api/ma-test/config.php?id=<id>` → delete webhook
- `POST /api/ma-test/notify.php` `{webhook_id, message, kind}` → send notification

**Data files:**
- `data/{team}/ma-test/plans-YYYY-MM.json` (per-team)
- `data/{team}/ma-test/results-YYYY-MM.json` (per-team)
- `data/{team}/ma-test/config.json` (per-team, webhook configs)

**External:** Google Chat webhooks (via ma-test/notify.php)

---

## Communications

### admin/mail-config.html
**Role:** `sm_admin`+

**API calls:**
- `GET /api/mail-config/index.php` → load SMTP config
- `PUT /api/mail-config/index.php` → save SMTP config (multiple saves: full, global_cc, signature, branding)
- `POST /api/mail/test-connection.php` → test SMTP connection
- `POST /api/mail/send.php` `{to, subject, body}` → send test email

**Data files:**
- `data/{team}/mail_config.json` (per-team) — SMTP settings, global CC, signature, branding

---

### admin/email-noti.html
**Role:** `sm_admin`+

**API calls:**
- `GET /api/email-noti/?action=recipients` → recipient list
- `GET /api/email-noti/?action=courses` → course list (for trigger config)
- `GET /api/email-noti/?action=exams` → exam list
- `GET /api/email-noti/?action=chat_webhooks` → chat webhook list
- `POST /api/email-noti/?action=preview` → preview email render
- `POST /api/email-noti/?action=send` → send notification

**Data files:**
- `data/{team}/email-noti.json` (per-team)
- `data/{team}/courses/courses.json` (read for trigger setup)
- `data/{team}/exams/exams.json` (read for trigger setup)
- `data/{team}/users.json` → global `users.json`

---

### admin/scheduled-noti.html
**Role:** `sm_admin`+

**API calls:**
- `GET /api/scheduled-noti/index.php` → list all rules
- `POST /api/scheduled-noti/index.php` → create rule
- `PUT /api/scheduled-noti/index.php?id=<id>` → update rule
- `DELETE /api/scheduled-noti/index.php?id=<id>` → delete rule
- `POST /api/scheduled-noti/send-chat.php` `{id, test:true, webhook_url}` → send test message

**Data files:** `data/{team}/scheduled-noti.json` (per-team)

---

### admin/announcements.html
**Role:** `sm_admin`+

**API calls:**
- `GET /api/announcements/index.php?all=1` → list all announcements
- `POST /api/announcements/index.php` → create
- `PUT /api/announcements/index.php` → update
- `DELETE /api/announcements/index.php?id=<id>` → delete

**Data files:** `data/{team}/announcements.json` (per-team)

---

### admin/sms-gateway-config.html
**Role:** `sm_admin`+

**API calls:**
- `GET /api/sms-gateway/index.php?project=<project>` → list config (projects: tmn, nano, welth)
- `POST /api/sms-gateway/sync-all.php` → sync all projects

**Data files:**
- `data/{team}/sms_gateway_tmn.json` (per-team)
- `data/{team}/sms_gateway_nano.json` (per-team)
- `data/{team}/sms_gateway_welth.json` (per-team)

**External:** Jenkins (sync reads Jenkins job config via jenkins-proxy)

---

### admin/n8n-oncall-config.html
**Role:** `sm_admin`+

**API calls:**
- `GET /api/n8n-oncall-config.php` → get current webhook config
- `POST /api/n8n-oncall-config.php` `{webhook_url}` → save webhook URL
- `GET /api/n8n-oncall.php?date=<today>&refresh=1` → test fetch on-call data

**Data files:**
- `data/n8n_oncall_config.json` (global)

**External:** n8n webhook URL (POST to retrieve on-call schedule from Google Sheets)

---

### admin/fh-config.html
**Role:** `sm_admin`+

**API calls:**
- `GET /api/fh-email-config/index.php` → load FH email config
- `PUT /api/fh-email-config/index.php` → save FH email config

**Data files:** `data/{team}/fh_email_config.json` (per-team) — separate SMTP settings for FH team email relay

---

## Team Tools

### admin/schedule.html
**Role:** `sm_admin`+

**API calls:**
- `GET /api/schedule/index.php?year=<y>&month=<m>` → monthly schedule
- `POST /api/schedule/index.php` → set slot
- `DELETE /api/schedule/index.php` → clear day
- `GET /api/schedule/holidays.php?year=<y>` → list holidays
- `POST /api/schedule/holidays.php` → add holiday
- `PUT /api/schedule/holidays.php` → update holiday
- `DELETE /api/schedule/holidays.php` → delete holiday
- `GET /api/schedule/vacation-quota.php` → get quotas
- `POST /api/schedule/vacation-quota.php` → set quotas
- `GET /api/schedule/user-colors.php` → user color assignments
- `POST /api/schedule/user-colors.php` → set user colors
- `GET /api/users/` → user list
- `GET /api/schedule/leave.php` → leave requests

**Data files:**
- `data/{team}/schedule.json` (per-team)
- `data/{team}/holidays.json` (per-team)
- `data/{team}/vacation-quotas.json` (per-team)
- `data/{team}/schedule-user-colors.json` (per-team)
- `data/users.json` (global)

---

### admin/syncup-config.html
**Role:** `sm_admin`+

**API calls:**
- `GET /api/syncup/index.php?config=1` → get config
- `PUT /api/syncup/index.php?config=1` → save config
- `GET /api/syncup/index.php` → get records
- `DELETE /api/syncup/index.php` → delete record
- `POST /api/syncup/upload.php` → upload file
- `POST /api/syncup/notify.php` `{shift, test:true}` → test notification
- `POST /api/syncup/notify.php` `{shift}` → send notification

**Data files:**
- `data/{team}/syncup-config.json` (per-team)
- `data/{team}/syncup.json` (per-team)

**External:** Google Chat webhook (via syncup/notify.php)

---

### admin/pw-schedule.html
**Role:** `sm_admin`+

**API calls:**
- `GET /api/pw-schedule/index.php?list_rounds=1` → list rounds
- `GET /api/pw-schedule/index.php?active=1` → active round
- `GET /api/pw-schedule-config/index.php` → get calendar config
- `POST /api/pw-schedule-config/index.php` → save calendar config
- `POST /api/pw-schedule/index.php` → create/update round
- `DELETE /api/pw-schedule/index.php?id=<id>` → delete round
- `POST /api/pw-schedule/test-notify.php` → test notification

**Data files:**
- `data/{team}/pw_schedule.json` (per-team, SM-shared)
- `data/{team}/pw_schedule_config.json` (per-team, SM-shared)

**External:** Teamup calendar (3 modes: XHR / ICS / official API); n8n Google Sheet sync; Google Chat webhook

---

### admin/holiday-plans.html
**Role:** `sm_admin`+

**API calls:**
- `GET /api/holiday-plans/index.php` → list holiday plans
- `POST /api/holiday-plans/index.php` → create plan
- `PUT /api/holiday-plans/index.php?id=<id>` → update plan
- `DELETE /api/holiday-plans/index.php?id=<id>` → delete plan
- `GET /api/users/` → user list
- `GET /api/schedule/holidays.php` → official holidays
- `GET /api/schedule/leave.php` → leave records
- `GET /api/schedule/vacation-quota.php` → quotas

**Data files:**
- `data/{team}/holiday-plans.json` (per-team)
- `data/{team}/holidays.json` (per-team, read)
- `data/users.json` (global, read)

---

### admin/weekly-report.html
**Role:** `sm_admin`+

**API calls (via WeeklyReportAPI in `assets/js/weekly-report/api.js`):**
- `GET /api/weekly-report/list.php` → list all weeks
- `GET /api/weekly-report/get.php?week=<id>` → get week data
- `DELETE /api/weekly-report/delete.php` → delete week
- `GET /api/weekly-report/export.php?week=<id>&format=csv` → CSV export
- `GET /api/weekly-report/export.php?type=yearly&year=<y>&format=csv` → yearly CSV

**Data files:** `data/weekly-report/week-YYYY-MM-DD.json` — **NOT team-scoped** (separate directory at root level)

**External:** None (admin view only; syncing from Jira done via user-facing form)

---

### admin/onboarding.html
**Role:** `sm_admin`+

**API calls:**
- `GET /api/onboarding/admin.php` → all users' progress overview
- `GET /api/onboarding/config.php` → chapter/task/block config
- `PUT /api/onboarding/config.php` → save config
- `POST /api/onboarding/admin.php?action=reset&user_id=<id>` → reset user progress
- `GET /api/onboarding/upload.php` → list uploaded PDFs
- `POST /api/onboarding/upload.php` (multipart) → upload PDF
- `DELETE /api/onboarding/upload.php?file=<name>` → delete PDF

**Data files:**
- `data/{team}/onboarding/config.json` (per-team)
- `data/{team}/onboarding/progress/<user_id>.json` (per-user, per-team)
- `data/users.json` (global, read for user list)

---

### admin/links.html
**Role:** `sm_admin`+ (LEAD_ROLES for write)

**API calls:**
- `GET /api/links/index.php` → list all links
- `GET /api/links/index.php?section=<s>` → filter by section
- `POST /api/links/index.php` → create link
- `PUT /api/links/index.php?id=<id>` → update
- `DELETE /api/links/index.php?id=<id>` → delete

**Data files:**
- `data/{team}/links.json` (per-team) for non-shared sections
- `data/sm/links.json` (SM-shared) for shared sections (`monitoring`)

---

### admin/tools.html
**Role:** `sm_admin`+

**API calls:**
- `GET /api/sidebar-tools/index.php` → list tools
- `POST /api/sidebar-tools/index.php` → create
- `PUT /api/sidebar-tools/index.php?id=<id>` → update
- `DELETE /api/sidebar-tools/index.php?id=<id>` → delete

**Data files:** `data/{team}/sidebar_tools.json` (per-team)

---

### admin/sheets.html
**Role:** `sm_admin`+

**API calls:**
- `GET /api/sheets/index.php` → list all sheets
- `GET /api/sheets/index.php?categories=1` → list categories
- `POST /api/sheets/index.php` → create sheet
- `POST /api/sheets/index.php?kind=category` → add category
- `PUT /api/sheets/index.php?id=<id>` → update sheet
- `DELETE /api/sheets/index.php?id=<id>` → delete sheet
- `DELETE /api/sheets/index.php?kind=category&id=<id>` → delete category

**Data files:**
- `data/{team}/sheets.json` (per-team)
- `data/{team}/sheet_stars.json` (per-team, user bookmarks)

**External:** Google Sheets (URLs stored, embedded as iframes on user page)

---

### admin/about-page.html
**Role:** `sm_admin`+

**API calls:**
- `GET /api/about-page/index.php` → load org chart + content
- `PUT /api/about-page/index.php` → save changes

**Data files:**
- `data/{team}/about-page.json` (per-team) — hard-coded to `sm` in practice
- `data/users.json` (global, read for member list)
- `data/teams.json` (global, read for team list)

---

## Requests & Feedback

### admin/requests.html
**Role:** `sm_admin`+

**API calls:**
- `GET /api/requests/index.php` → list requests
- `PUT /api/requests/index.php?id=<id>` → update status
- `PATCH /api/requests/index.php?id=<id>` → partial update
- `DELETE /api/requests/index.php?id=<id>` → delete (super_admin only)

**Data files:** `data/requests.json` (global — auto-increment ticket numbers shared across teams)

---

### admin/feature-requests.html
**Role:** `sm_admin`+ (submit requests to platform team)

**API calls:**
- `GET /api/feature-requests/index.php` → list own team's requests
- `POST /api/feature-requests/index.php` → submit new request

**Data files:**
- `data/feature_requests.json` (global)
- `data/teams.json` (global, read for team name)

---

## Dev Tools

### admin/devtools.html
**Role:** `sm_admin`+

**API calls:**
- `GET /api/health/index.php` → Jira + Jenkins health check
- `GET /api/logs/index.php?...` → query logs
- `POST /api/mail/send.php` → send test email
- `POST /api/mail/test-connection.php` → test SMTP
- `GET /api/service-types/index.php` → service type list (UI test)
- Raw `API.request()` calls to arbitrary endpoints (API Explorer mode)

**Data files:** reads `health_cache.json`, `logs/activity.json`, `logs/security.json`

**External:** Jira, Jenkins (via health check)

---

### admin/dev-api.html
**Role:** `sm_admin`+

API Explorer — allows calling any endpoint directly. Pre-built examples:
- `GET /api/auth/me.php`
- `GET /api/auth/logout.php`
- `GET /api/health/index.php`
- `GET /api/jenkins-servers/index.php`
- `GET /api/notifications/index.php`
- `GET /api/system-settings/index.php`
- `GET /api/templates/index.php`
- `GET /api/users/index.php`
- Raw `API.request(method, path, body)` — arbitrary endpoint call

**Data files:** depends on endpoint called

---

### admin/dev-data.html
**Role:** `sm_admin`+

**API calls:**
- `GET /api/dev/read-file.php?name=<filename>` → read any JSON file in DATA_DIR
- `GET /api/dev/stats.php` → DATA_DIR file listing + sizes

**Data files:** any `.json` in `DATA_DIR` (filtered to simple filenames, no path traversal)

---

### admin/dev-email.html
**Role:** `sm_admin`+

**API calls:**
- `GET /api/mail-config/index.php` → load current SMTP config
- `POST /api/mail/test-connection.php` → test SMTP connection
- `POST /api/mail/send.php` `{to, subject, body}` → send test email
- `GET /api/service-types/index.php` → for template UI

**Data files:** `data/{team}/mail_config.json`

**External:** SMTP server

---

### admin/dev-logs.html
**Role:** `sm_admin`+

**API calls:**
- `GET /api/log/index.php?type=activity&...` → query activity logs
- `GET /api/log/index.php?type=security&...` → query security logs

**Data files:** `data/{team}/logs/activity.json`, `data/{team}/logs/security.json`

---

### admin/dev-system.html
**Role:** `sm_admin`+

**API calls:**
- `GET /api/dev/index.php` → PHP stats, memory, load, server metrics

**Data files:** `data/server_metrics.json` (global), `data/api_rate_limit.json` (global), `data/rate_limit.json` (global), `data/users.json`, `data/{team}/board.json`

---

## Super-Admin Pages

### admin/super-admin.html
**Role:** `super_admin` only

**API calls:**
- `GET /api/teams/index.php` → list all teams
- `GET /api/users/` → all users across all teams
- `POST /api/teams/index.php` `{slug, name, description, color}` → create team (provisions data dir)
- `PUT /api/teams/index.php?id=<id>` → update team
- `POST /api/teams/index.php?action=deactivate&id=<id>` → deactivate team
- `DELETE /api/teams/index.php?id=<id>` (hard delete) → permanent delete
- `GET /api/dev-subteams/index.php` → list dev sub-teams
- `POST /api/dev-subteams/index.php` `{name}` → add sub-team
- `DELETE /api/dev-subteams/index.php?name=<n>` → remove sub-team

**Data files:**
- `data/teams.json` (global)
- `data/users.json` (global)
- `data/dev-subteams.json` (global)

---

### admin/super-viewer.html
**Role:** `super_admin` only

**API calls:**
- `GET /api/super-viewer/` → one-shot payload (team data for selected team)
- `GET /api/teams/index.php` → list teams (for team switcher)
- Uses `X-Admin-Team: <slug>` header to impersonate any team

**Data files:** reads any per-team files based on selected team (board.json, users.json, etc.)

---

### admin/super-team-permissions.html
**Role:** `super_admin` only

**API calls:**
- `GET /api/teams/index.php` → list all teams
- `PUT /api/teams/index.php?id=<id>` `{features, page_modes}` → update team permissions/features
- `POST /api/teams/copy-config.php` `{team_slug, feature, overwrite}` → copy SM config to team

**Data files:**
- `data/teams.json` (global) — reads & writes `features[]` and `page_modes{}` per team

---

### admin/super-email-templates.html
**Role:** `super_admin` only

**API calls:**
- `GET /api/teams/index.php` → list all teams
- `GET /api/email-templates/index.php` → load global email templates
- `PUT /api/email-templates/index.php` → save global email templates
- `API.getAdminTeam()` / `API.setAdminTeam(slug)` → switch active team context

**Data files:** `data/{team}/email_templates.json` (per-team, but super_admin can switch team via X-Admin-Team)

---

### admin/super-feature-requests.html
**Role:** `super_admin` only

**API calls:**
- `GET /api/feature-requests/index.php` → list all feature requests across all teams
- `POST /api/feature-requests/index.php?action=resolve&id=<id>` → resolve request

**Data files:** `data/feature_requests.json` (global)

---

## Incident Launcher Config

### admin/incident-launcher-config.html
**Role:** `sm_admin`+ · SM team only

**API calls:**
- `GET /api/incident-launcher/index.php?action=config` → load full config
- `POST /api/incident-launcher/index.php?action=save_config` → save full config
- `GET /api/jira/issue-types.php` → Jira issue type list
- `GET /api/jira/fields.php` → Jira custom fields
- `GET /api/jira/field-options.php?field_id=<id>` → field options for dropdowns

**Data files:**
- `data/{team}/incident-launcher-config.json` (per-team, SM only)

**External:** Jira Cloud API (`/rest/api/3/issue/createmeta`, `/rest/api/3/field`, `/rest/api/3/field/{id}/context/{ctx}/option`)
