# Admin Pages — Data Sources Map

> อ่านจาก HTML source + JS files จริง · Sep 2026

---

## ── USER & ACCESS MANAGEMENT ──────────────────────────────────

### admin/users.html — User Management
**Role:** ADMIN_ROLES (`sm_admin`, `dev_sm`, `super_admin`)  
**API calls:**
- `API.teams.list()` → `data/teams.json` (global)
- `API.menuPermissions.get()` → `data/{team}/menu-permissions.json` (per-team)
- `API.systemSettings.get()` → `data/system-settings.json` (global)
- `API.users.list(?team=)` → `data/users.json` (global)
- `API.userColors.get()` / `API.userColors.set()` → `data/{team}/user-colors.json`
- `API.users.create(payload)` → `data/users.json` + SMTP send welcome email
- `API.users.update(id, body)` → `data/users.json`
- `API.users.delete(id)` → `data/users.json`
- `API.users.resetPassword(id)` → `data/password_reset_tokens.json` + SMTP
- `API.users.forceReset(id)` → `data/users.json` (sets must_reset_password)
- `API.users.resetLoginBlock(username)` → `data/rate_limit.json` (global)
- `API.devSubteams.list()` → `data/{team}/dev-subteams.json`

**Data files:**
- READ: `data/users.json` (global), `data/teams.json` (global), `data/{team}/menu-permissions.json`, `data/system-settings.json`, `data/{team}/user-colors.json`, `data/{team}/dev-subteams.json`
- WRITE: `data/users.json`, `data/password_reset_tokens.json`, `data/rate_limit.json`, `data/{team}/user-colors.json`

**External:** SMTP (welcome email + password reset link)

---

### admin/menu-permissions.html — Menu Permissions
**Role:** ADMIN_ROLES  
**API calls:**
- `API.menuPermissions.get()` → `data/{team}/menu-permissions.json`
- `API.menuPermissions.save(payload)` → `data/{team}/menu-permissions.json`

**Data files (per-team):** `menu-permissions.json`

---

### admin/nav-groups.html — Nav Groups
**Role:** ADMIN_ROLES  
**API calls:**
- `GET /nav-groups/index.php` → `data/{team}/nav-groups.json`
- `POST /nav-groups/index.php` → `data/{team}/nav-groups.json`
- `DELETE /nav-groups/index.php` → reset to default

**Data files (per-team):** `nav-groups.json`

---

### admin/genz-team.html — GenZ Team Toggle
**Role:** ADMIN_ROLES  
**API calls:**
- `API.genzTeam.list()` → `data/users.json` (global, filter SM team)
- `API.genzTeam.toggle(id, bool)` → `data/users.json`

**Data files:** `data/users.json` (global)

---

### admin/leave-approval.html — Leave Approval
**Role:** ADMIN_ROLES  
**API calls:**
- `API.users.avatars()` → `data/users.json`
- `API.users.list()` → `data/users.json`
- `API.leave.list({ admin: true })` → `data/{team}/leave-requests.json`
- `API.leave.review(id, { status, review_note })` → `data/{team}/leave-requests.json`
- `API.leave.submit(...)` → `data/{team}/leave-requests.json`
- `API.leave.edit(id, ...)` → `data/{team}/leave-requests.json`
- `API.leave.cancel(id, ...)` → `data/{team}/leave-requests.json`

**Data files:** `data/users.json` (global), `data/{team}/leave-requests.json` (per-team)

---

## ── SYSTEM CONFIGURATION ──────────────────────────────────────

### admin/system-settings.html — System Settings
**Role:** ADMIN_ROLES  
**API calls:**
- `API.systemSettings.get()` → `data/system-settings.json` (global)
- `API.systemSettings.save(data)` → `data/system-settings.json`

**Data files:** `data/system-settings.json` (global)

---

### admin/maintenance.html — Maintenance Mode
**Role:** ADMIN_ROLES  
**API calls:**
- `API.maintenance.get()` → `data/maintenance.json` (global)
- `API.maintenance.update({ scope:'global', active, message, eta })` → `data/maintenance.json`
- `API.maintenance.update({ scope, id, active, message })` → per-page override in `data/maintenance.json`

**Data files:** `data/maintenance.json` (global)

---

### admin/backup.html — Data Backup
**Role:** ADMIN_ROLES  
**API calls:**
- `API.backup.list()` → lists files in `backups/` directory
- `API.backup.create()` → creates ZIP of `data/` → writes to `backups/`
- `API.backup.delete(file)` → deletes from `backups/`

**Data files:** `data/` (全体読み取り), `backups/` directory

---

### admin/system-monitor.html — System Monitor
**Role:** ADMIN_ROLES  
**API calls:**
- `API.request('GET', '/dev/index.php?action=server')` → PHP system stats (memory, load)
- `API.request('GET', '/dev/index.php?action=server-history&range=')` → `data/server_metrics.json` (global)
- `API.request('GET', '/dev/index.php')` → general dev info

**Data files:** `data/server_metrics.json` (global)

---

## ── BOARD & CONTENT ────────────────────────────────────────────

### admin/board.html — Board Management
**Role:** ADMIN_ROLES  
**API calls:**
- `API.boardConfig.get()` → `data/{team}/board_categories.json`, `board_service_types.json`
- `API.board.list()` → `data/{team}/board.json`
- `API.boardConfig.addCategory/addServiceType/addSubtype/rename/delete` → `data/{team}/board_categories.json`, `board_service_types.json`
- `API.board.pin(id)` → `data/{team}/board.json`
- `API.board.delete(id)` → `data/{team}/board.json` (soft-delete)

**Data files (per-team):** `board.json`, `board_categories.json`, `board_service_types.json`

---

### admin/trash.html — Trash / Soft-deleted Posts
**Role:** ADMIN_ROLES  
**API calls:**
- `API.board.trash()` → `data/{team}/board.json` (deleted_at != null)
- `API.board.restore(id, type)` → `data/{team}/board.json`
- `API.board.hardDelete(id, type)` → `data/{team}/board.json` (permanent removal)
- `API.board.purgeTrash()` → `data/{team}/board.json` (wipe all deleted)

**Data files (per-team):** `board.json`

---

### admin/templates.html — Jira Templates
**Role:** ADMIN_ROLES (writes require `requireSmForShared()`)  
**API calls:**
- `API.templates.list()` → `data/sm/templates.json` (SM-shared)
- `API.templates.delete(id)` → `data/sm/templates.json`
- (Create/Edit inline in jira-templates.html, not here)

**Data files:** `data/sm/templates.json` (SM-shared)

---

### admin/jira-config.html — Jira Custom Field Config
**Role:** ADMIN_ROLES (writes: `requireSmForShared()`)  
**API calls:**
- `API.serviceTypes.list()` → `data/{team}/board_service_types.json`
- `API.jiraConfig.get()` → `data/sm/jira_config.json` (SM-shared)
- `API.serviceTypes.createType/rename/createSubtype/updateService/createService/delete` → `data/{team}/board_service_types.json`
- `API.jiraConfig.add/delete/update` → `data/sm/jira_config.json`

**Data files:**  
- `data/sm/jira_config.json` (SM-shared) — custom field mappings  
- `data/{team}/board_service_types.json` (per-team) — service type tree

---

### admin/knowledge-base.html — Knowledge Base Editor
**Role:** ADMIN_ROLES  
**API calls:**
- `API.knowledgeBase.list()` → `data/{team}/knowledge-base.json`
- `API.post('/knowledge-base/delete-category.php', ...)` → `data/{team}/knowledge-base.json`
- `API.post('/knowledge-base/import.php', data)` → `data/{team}/knowledge-base.json`
- `API.post('/knowledge-base/clear-all.php', {})` → `data/{team}/knowledge-base.json`
- (Save/Add-category/Update-category via LEAD_ROLES — same file)

**Data files (per-team):** `knowledge-base.json`

---

### admin/ops-runbook.html — Ops Runbook Editor
**Role:** ADMIN_ROLES  
**API calls:**
- `API.opsRunbook.list()` → `data/{team}/ops-runbook.json`
- `API.opsRunbook.updateSection / createSection / deleteSection` → `data/{team}/ops-runbook.json`
- `API.opsRunbook.updateColumn / createColumn / deleteColumn` → `data/{team}/ops-runbook.json`

**Data files (per-team):** `ops-runbook.json`

---

### admin/courses.html — Course Content Editor
**Role:** ADMIN_ROLES  
**API calls:**
- `API.courses.listCourses()` → `data/{team}/courses/courses.json`
- `API.courses.createCourse / updateCourse / deleteCourse` → `data/{team}/courses/courses.json`
- `API.courses.listPhases / createPhase / updatePhase / deletePhase` → `data/{team}/courses/<id>/phases.json`
- `API.courses.listLessons / createLesson / updateLesson / deleteLesson` → `data/{team}/courses/<id>/lessons.json`
- `API.courses.getQuiz / saveQuiz` → `data/{team}/courses/<id>/quizzes.json`
- `API.courses.allProgress(cid)` → `data/{team}/courses/progress.json`

**Data files (per-team):** `courses/courses.json`, `courses/<id>/phases.json`, `courses/<id>/lessons.json`, `courses/<id>/quizzes.json`, `courses/progress.json`

---

### admin/exams.html — Exam Editor
**Role:** ADMIN_ROLES  
**API calls:**
- `API.exams.list()` → `data/{team}/exams/exams.json`
- `API.courses.listCourses()` → `data/{team}/courses/courses.json`
- `API.exams.get(id)` → `data/{team}/exams/<id>/questions.json`
- `API.exams.preset(name)` → returns config preset (no file)
- `API.exams.create / update / delete` → `data/{team}/exams/exams.json`, `data/{team}/exams/<id>/`
- `API.upload('/upload.php', fd)` → `uploads/`
- `API.exams.listAttempts / report / attemptEvents` → `data/{team}/exams/attempts.json`, `data/{team}/exams/<id>/events.json`
- `API.exams.resetAttempt / resetExamAttempts` → `data/{team}/exams/attempts.json`

**Data files (per-team):** `exams/exams.json`, `exams/attempts.json`, `exams/<id>/questions.json`, `exams/<id>/events.json`, `courses/courses.json`

---

### admin/achievements.html — Team Leaderboard
**Role:** ADMIN_ROLES  
**API calls:**
- `API.users.list()` → `data/users.json` (global)
- Per user: `API.achievements.user(id)` → reads `courses/`, `exams/`, `onboarding/` (per-team)

**Data files (per-team):** `courses/courses.json`, `courses/progress.json`, `exams/exams.json`, `exams/attempts.json`, `onboarding/progress/<uid>.json`  
**Data files (global):** `data/users.json`

---

## ── MONITORING CONFIGURATION ───────────────────────────────────

### admin/jenkins-servers.html — Jenkins Server CRUD
**Role:** ADMIN_ROLES (`requirePageMode('jenkins-servers')`)  
**API calls:**
- `API.jenkinsServers.list()` → `data/sm/jenkins_servers.json` (SM-shared)
- `API.jenkins.jobs(id, tree)` → proxy to Jenkins API (test connection)
- `API.jenkinsServers.update / create / delete` → `data/sm/jenkins_servers.json`

**Data files:** `data/sm/jenkins_servers.json` (SM-shared)  
**External:** Jenkins instances (test connection probe)

---

### admin/alert-monitor-config.html — Alert Monitor Config
**Role:** ADMIN_ROLES  
**API calls:**
- `API.alertMonitor.getConfig()` → `data/sm/alert-monitor-config.json`
- `API.alertMonitor.state()` → current alert state
- `API.alertMonitor.saveConfig(c)` → `data/sm/alert-monitor-config.json`
- `API.alertMonitor.sync(qs)` → fetches alerts from Grafana, stores in `data/sm/alert-monitor-state.json`
- `API.alertMonitor.testJsm('raw=1&limit=3')` → calls JSM (Jira Service Management) API

**Data files:** `data/sm/alert-monitor-config.json` (SM-shared), `data/sm/alert-monitor-state.json`  
**External:** Grafana alerting API, Jira Service Management (JSM)

---

### admin/grafana-sources.html — Grafana Iframe Sources
**Role:** ADMIN_ROLES  
**API calls:**
- `API.grafanaSources.list()` → `data/sm/grafana-sources.json` (SM-shared)
- `API.grafanaSources.update / create / delete` → `data/sm/grafana-sources.json`
- `API.grafanaSources.test(body)` → probe Grafana URL

**Data files:** `data/sm/grafana-sources.json` (SM-shared)  
**External:** Grafana (test probe)

---

### admin/opensearch-config.html — OpenSearch Endpoint Config
**Role:** ADMIN_ROLES  
**API calls:**
- `API.opensearch.config.list()` → `data/sm/opensearch_config.json` (SM-shared)
- `API.opensearch.config.update / create / delete` → `data/sm/opensearch_config.json`
- `API.opensearch.config.test(body)` → probe `/_cluster/health`
- `API.opensearch.config.updateDefaults(p)` → `data/sm/opensearch_config.json`

**Data files:** `data/sm/opensearch_config.json` (SM-shared)  
**External:** OpenSearch cluster (test probe)

---

### admin/ma-config.html — MA Module Config
**Role:** ADMIN_ROLES  
**API calls:**
- `API.get('/ma-modules/config.php')` → `data/sm/ma-modules.json` (SM-shared)
- `API.post('/ma-modules/config.php', body)` → `data/sm/ma-modules.json` (toggle/CRUD)
- `API.request('PUT', path, ...)` → update MA module types
- `API.post('/ma-modules/config.php', ...)` → create/delete module items
- `fetch('../api/log/create.php', ...)` → `data/{team}/logs/activity.json`

**Data files:** `data/sm/ma-modules.json` (SM-shared), `data/{team}/logs/activity.json`

---

### admin/ma-status.html — MA Status Admin Config
**Role:** ADMIN_ROLES  
**API calls:**
- `API.get('/ma-status/jenkins-jobs.php')` → `data/{team}/ma-status-jenkins.json`
- `API.get('/jenkins-servers/index.php')` → `data/sm/jenkins_servers.json` (SM-shared)
- `API.put('/ma-status/jenkins-jobs.php', { jobs })` → `data/{team}/ma-status-jenkins.json`
- `API.get('/ma-status/')` → `data/{team}/ma-status-cache.json` + external sources
- `API.post('/ma-status/mapping.php', { service_id, use_case_id })` → `data/sm/ma-services.json` (SM-shared)
- `API.get('/ma-status/hidden.php')` → `data/{team}/ma-status-hidden.json`
- `API.put('/ma-status/hidden.php', hideMap)` → `data/{team}/ma-status-hidden.json`

**Data files:**  
- `data/{team}/ma-status-jenkins.json`, `data/{team}/ma-status-hidden.json`, `data/{team}/ma-status-cache.json` (per-team)  
- `data/sm/ma-services.json` (SM-shared)  
- `data/sm/jenkins_servers.json` (SM-shared)  
**External:** NANO CDN, TMN-OPS Jenkins, ACM Backoffice

---

### admin/service-inventory.html — Service Inventory CSV
**Role:** ADMIN_ROLES  
**API calls:**
- `API.servicePerformance.list('all')` → reads `data/sm/service-performance/cache/` (SM-shared)
- `API.serviceInventory.list('', '')` → `data/sm/service-inventory/inventory.csv`
- `API.serviceInventory.history()` → `data/sm/service-inventory/` (backup files)
- `API.serviceInventory.restore(name)` → restores backup CSV
- `API.serviceInventory.upload(file)` → overwrites `data/sm/service-inventory/inventory.csv` + creates backup
- `API.serviceInventory.downloadUrl()` / `downloadBackupUrl(name)` → direct download links

**Data files:** `data/sm/service-inventory/inventory.csv` (SM-shared), `data/sm/service-inventory/<timestamp>-backup.csv`

---

### admin/service-severity.html — Service Severity + Webhooks
**Role:** ADMIN_ROLES  
**API calls:**
- `GET/POST /service-severity/index.php?action=list/stats/upsert/import/delete` → `data/{team}/service-severity.json`
- `API.get('/n8n-severity-config.php')` → `data/n8n_severity_config.json` (global)
- `API.post('/n8n-severity-config.php', { webhook_url })` → `data/n8n_severity_config.json`
- `API.get('/n8n-severity-sync.php')` → `data/n8n_severity_last_sync.json` (global)
- `API.post('/n8n-severity-sync.php', {})` → triggers n8n webhook → updates `data/{team}/service-severity.json`
- `API.get('/restart-monitor-webhooks/index.php')` → `data/sm/grafana-monitoring/restart-webhooks.json`
- `API.put('/restart-monitor-webhooks/index.php?slug=', { url })` → `data/sm/grafana-monitoring/restart-webhooks.json`
- `API.delete('/restart-monitor-webhooks/index.php?slug=')` → same
- `API.post('/restart-monitor-webhooks/index.php?action=test', body)` → sends test Google Chat card

**Data files:**  
- `data/{team}/service-severity.json` (per-team)  
- `data/n8n_severity_config.json`, `data/n8n_severity_last_sync.json` (global)  
- `data/sm/grafana-monitoring/restart-webhooks.json` (SM-shared)  
**External:** n8n webhook, Google Chat

---

## ── LOGS & ANALYTICS ───────────────────────────────────────────

### admin/logs.html — Activity & Security Logs
**Role:** ADMIN_ROLES  
**API calls:**
- `API.teams.list()` → `data/teams.json` (global) — for team filter (super_admin)
- `API.logs.query(params)` → `data/{team}/logs/activity.json` + `data/{team}/logs/security.json`

**Query params:** `type` (activity|security), `limit`, `offset`, `user_id`, `action`, `event`, team override via `X-Admin-Team`  
**Data files (per-team):** `logs/activity.json`, `logs/security.json`

---

### admin/mail-logs.html — Email Send History
**Role:** ADMIN_ROLES  
**API calls:**
- `API.mail.getLogs({ search, status, limit, offset })` → `data/{team}/mail_logs.json`

**Data files (per-team):** `mail_logs.json`

---

### admin/analytics.html — Usage Analytics Dashboard
**Role:** ADMIN_ROLES  
**API calls:**
- `fetch(.../analytics/stats.php?start_date=...&end_date=...)` → `data/analytics-cache/incidents-YYYY-MM.json` (NOT team-scoped — global analytics cache), also reads Jira Cloud for incident data

**Data files:** `data/analytics-cache/incidents-YYYY-MM.json` (global cache)  
**External:** Jira Cloud (incident stats)

---

## ── MA TEST ────────────────────────────────────────────────────

### admin/ma-test-catalog.html — MA Test Catalog
**Role:** ADMIN_ROLES  
**API calls (via assets/js/ma-test.js):**
- `GET /ma-test/catalog.php` → `data/{team}/ma-test/catalog.json`
- `POST/PUT/DELETE /ma-test/catalog.php` → `data/{team}/ma-test/catalog.json`
- `POST /ma-test/catalog-import.php` (CSV import) → `data/{team}/ma-test/catalog.json`
- `GET /ma-services/list.php` → `data/sm/ma-services.json` (SM-shared) — for usecase linking
- `POST /ma-test/catalog.php?action=auto_link` → auto-link catalog ↔ ma-services
- `POST /upload.php` → `uploads/`

**Data files:**  
- `data/{team}/ma-test/catalog.json` (per-team)  
- `data/sm/ma-services.json` (SM-shared)

---

### admin/ma-test-plans.html — MA Test Plans
**Role:** ADMIN_ROLES  
**API calls:**
- `GET /ma-test/plans.php?month=` → `data/{team}/ma-test/plans-YYYY-MM.json`
- `GET /ma-test/plans.php?months=1` → list available months
- `POST/DELETE /ma-test/plans.php?month=` → `data/{team}/ma-test/plans-YYYY-MM.json`
- `GET /ma-test/catalog.php` → `data/{team}/ma-test/catalog.json`

**Data files (per-team):** `ma-test/plans-YYYY-MM.json`, `ma-test/catalog.json`

---

### admin/ma-test-overview.html — MA Test Overview
**Role:** ADMIN_ROLES  
**API calls:**
- `GET /ma-test/results.php?month=` → `data/{team}/ma-test/results-YYYY-MM.json`
- `GET /ma-test/plans.php?month=` → `data/{team}/ma-test/plans-YYYY-MM.json`
- `GET /ma-test/catalog.php` → `data/{team}/ma-test/catalog.json`
- `POST/PUT/DELETE /ma-test/results.php?month=` → `data/{team}/ma-test/results-YYYY-MM.json`

**Data files (per-team):** `ma-test/results-YYYY-MM.json`, `ma-test/plans-YYYY-MM.json`, `ma-test/catalog.json`

---

## ── COMMUNICATIONS ─────────────────────────────────────────────

### admin/mail-config.html — SMTP Settings
**Role:** ADMIN_ROLES  
**API calls:**
- `API.mailConfig.get()` → `data/sm/mail_config.json` (SM-shared)
- `API.mailConfig.save(payload)` → `data/sm/mail_config.json`
- `API.mail.testConnection()` → test SMTP connect
- `API.mail.send({...})` → send test email via SMTP

**Data files:** `data/sm/mail_config.json` (SM-shared)  
**External:** SMTP server (test connection + test send)

---

### admin/email-noti.html — Email Notification Templates
**Role:** ADMIN_ROLES  
**API calls:**
- `API.get('/email-noti/?action=recipients')` → `data/{team}/email-noti-config.json`
- `API.get('/email-noti/?action=courses')` → `data/{team}/courses/courses.json`
- `API.get('/email-noti/?action=exams')` → `data/{team}/exams/exams.json`
- `API.get('/email-noti/?action=chat_webhooks')` → `data/sm/mail_config.json`
- `API.post('/email-noti/?action=preview')` → preview email HTML (no write)
- `API.post('/email-noti/?action=send')` → send via SMTP

**Data files:** `data/{team}/email-noti-config.json` (per-team), `courses/courses.json`, `exams/exams.json`  
**External:** SMTP

---

### admin/scheduled-noti.html — Scheduled Notifications
**Role:** ADMIN_ROLES  
**API calls:**
- `API.scheduledNoti.list(true)` → `data/{team}/scheduled-noti.json`
- `API.scheduledNoti.update(id, { enabled })` → `data/{team}/scheduled-noti.json`
- `API.scheduledNoti.delete(id)` → `data/{team}/scheduled-noti.json`
- `API.scheduledNoti.testShiftSummary / testGrafanaPaused` → sends test Google Chat card
- `API.post('/scheduled-noti/send-chat.php', { id, test, webhook_url })` → sends test
- `API.restartMonitorWebhooks.list()` → `data/sm/grafana-monitoring/restart-webhooks.json`
- `API.restartMonitorWebhooks.setEnabled(slug, enabled)` → same
- `API.batchMonitorNoti.list()` → `data/{team}/batch-monitor-noti-config.json`
- `API.batchMonitorNoti.save(serverId, { enabled })` → same

**Data files:**  
- `data/{team}/scheduled-noti.json`, `data/{team}/batch-monitor-noti-config.json` (per-team)  
- `data/sm/grafana-monitoring/restart-webhooks.json` (SM-shared)  
**External:** Google Chat webhook (test send)

---

### admin/announcements.html — Announcements
**Role:** ADMIN_ROLES  
**API calls:**
- `API.get('/announcements/index.php?all=1')` → `data/{team}/announcements.json`
- `API.post('/announcements/index.php', {...})` → `data/{team}/announcements.json`
- `API.request('PUT', '/announcements/index.php?id=', {...})` → `data/{team}/announcements.json`
- `API.request('DELETE', '/announcements/index.php?id=')` → `data/{team}/announcements.json`

**Data files (per-team):** `announcements.json`

---

### admin/sms-gateway-config.html — SMS Gateway Config
**Role:** ADMIN_ROLES  
**API calls:**
- `API.smsGateway.list(p)` → `data/{team}/sms_gateway_<project>.json`
- `API.smsGateway.sync(p)` → sync from Jenkins (updates `data/{team}/sms_gateway_*.json`)

**Data files (per-team):** `sms_gateway_tmn.json`, `sms_gateway_nano.json`, `sms_gateway_welth.json`  
**External:** Jenkins (sync job state)

---

### admin/n8n-oncall-config.html — n8n OnCall Config
**Role:** ADMIN_ROLES  
**API calls:**
- `API.get('/n8n-oncall-config.php')` → `data/n8n_oncall_config.json` (global)
- `API.post('/n8n-oncall-config.php', { webhook_url })` → `data/n8n_oncall_config.json`
- `API.get('/n8n-oncall.php?date=&refresh=1')` → calls n8n webhook to test

**Data files:** `data/n8n_oncall_config.json` (global)  
**External:** n8n webhook

---

### admin/fh-config.html — FH Team Email Config
**Role:** ADMIN_ROLES  
**API calls:**
- `API.fhEmailConfig.get()` → `data/sm/fh_email_config.json` (SM-shared)
- `API.fhEmailConfig.save(body)` → `data/sm/fh_email_config.json`

**Data files:** `data/sm/fh_email_config.json` (SM-shared)

---

## ── TEAM TOOLS ─────────────────────────────────────────────────

### admin/schedule.html — Team Schedule
**Role:** ADMIN_ROLES  
**API calls:**
- `API.schedule.get(year, month)` → `data/{team}/schedule-YYYY-MM.json`
- `API.users.list()` → `data/users.json` (global)
- `API.leave.list({ admin: true })` → `data/{team}/leave-requests.json`
- `API.userColors.get()` → `data/{team}/user-colors.json`
- `API.vacation.getQuotas()` / `setQuotas(data)` → `data/{team}/vacation-quotas.json`
- `API.userColors.set(data)` → `data/{team}/user-colors.json`

**Data files:**  
- `data/{team}/schedule-YYYY-MM.json`, `data/{team}/leave-requests.json`, `data/{team}/user-colors.json`, `data/{team}/vacation-quotas.json` (per-team)  
- `data/users.json` (global)

---

### admin/syncup-config.html — SyncUp Config
**Role:** ADMIN_ROLES  
**API calls:**
- `API.syncup.getConfig()` → `data/{team}/syncup-config.json`
- `API.syncup.saveConfig(payload)` → `data/{team}/syncup-config.json`
- `API.syncup.testNotify(shift)` → sends test Google Chat card
- `API.syncup.getRange(14)` → `data/{team}/syncup-records.json`
- `API.syncup.deleteRecord(date, shift)` → `data/{team}/syncup-records.json`

**Data files (per-team):** `syncup-config.json`, `syncup-records.json`  
**External:** Google Chat (test notify)

---

### admin/pw-schedule.html — PW Calendar Config
**Role:** ADMIN_ROLES  
**API calls:**
- `API.pwSchedule.getConfig()` → `data/sm/pw_schedule_config.json` (SM-shared)
- `API.pwSchedule.saveConfig({...})` → `data/sm/pw_schedule_config.json`
- `API.pwSchedule.testNotify(round, url)` → sends test Google Chat
- `API.pwSchedule.active()` → `data/sm/pw_schedule.json` (SM-shared)
- `API.pwSchedule.listRounds()` → `data/sm/pw_schedule.json`
- `API.pwSchedule.teamup(start, end, true)` → fetches from Teamup calendar

**Data files:** `data/sm/pw_schedule_config.json`, `data/sm/pw_schedule.json` (SM-shared)  
**External:** Teamup calendar, Google Chat

---

### admin/holiday-plans.html — Holiday Plans
**Role:** ADMIN_ROLES  
**API calls:**
- `API.users.list()` → `data/users.json` (global)
- `API.vacation.getQuotas()` → `data/{team}/vacation-quotas.json`
- `API.leave.list({ admin: true })` → `data/{team}/leave-requests.json`
- `API.holidays.list()` → `data/{team}/holidays.json`
- `API.holidayPlans.get(year, month)` → `data/{team}/holiday-plans-YYYY-MM.json`
- `API.schedule.get(year, month)` (×12) → `data/{team}/schedule-YYYY-MM.json`
- `API.holidayPlans.save({...})` → `data/{team}/holiday-plans-YYYY-MM.json`

**Data files (per-team):** `holidays.json`, `holiday-plans-YYYY-MM.json`, `leave-requests.json`, `vacation-quotas.json`, `schedule-YYYY-MM.json`  
**Data files (global):** `data/users.json`

---

### admin/weekly-report.html — Weekly Report Admin
**Role:** ADMIN_ROLES  
**API calls:**
- `WeeklyReportAPI.listWeeks()` → `data/weekly-report/` (list week files — NOT team-scoped)
- `WeeklyReportAPI.getWeek(week)` → `data/weekly-report/week-YYYY-MM-DD.json` (NOT team-scoped)
- `WeeklyReportAPI.deleteWeek(week)` → `data/weekly-report/week-YYYY-MM-DD.json`
- Direct window.open: `api/weekly-report/export.php?week=...&format=csv`

**Data files:** `data/weekly-report/week-YYYY-MM-DD.json` (**NOT team-scoped** — global weekly-report directory)

---

### admin/onboarding.html — Onboarding Config & Progress
**Role:** ADMIN_ROLES  
**API calls:**
- `API.onboarding.getConfig()` → `data/{team}/onboarding/config.json`
- `API.onboarding.saveConfig(state.config)` → `data/{team}/onboarding/config.json`
- `API.onboarding.adminList()` → all users' `data/{team}/onboarding/progress/<uid>.json`
- `API.onboarding.adminDetail(userId)` → `data/{team}/onboarding/progress/<uid>.json`
- `API.onboarding.adminReset(userId)` → deletes `data/{team}/onboarding/progress/<uid>.json`
- `API.onboarding.listPdfs()` → list `uploads/onboarding-pdfs/`
- `API.onboarding.uploadPdf(fd)` → `uploads/onboarding-pdfs/`
- `API.onboarding.deletePdf(filename)` → `uploads/onboarding-pdfs/`

**Data files (per-team):** `onboarding/config.json`, `onboarding/progress/<uid>.json`  
**Upload storage:** `uploads/onboarding-pdfs/`

---

### admin/links.html — Quick Links
**Role:** LEAD_ROLES  
**API calls:**
- `API.links.list(section)` → `data/{team}/links.json` + `data/sm/links.json` (shared sections)
- `API.links.create / update / delete` → per-team or SM-shared depending on section

**Data files:** `data/{team}/links.json` (per-team), `data/sm/links.json` (SM-shared for `monitoring` section)

---

### admin/tools.html — Sidebar Tools
**Role:** ADMIN_ROLES  
**API calls:**
- `API.sidebarTools.list()` → `data/{team}/sidebar-tools.json`
- `API.sidebarTools.update / create / delete` → `data/{team}/sidebar-tools.json`

**Data files (per-team):** `sidebar-tools.json`

---

### admin/sheets.html — Google Sheets Embed
**Role:** ADMIN_ROLES  
**API calls:**
- `API.sheets.list()` → `data/{team}/sheets.json`
- `API.sheets.getCategories()` → `data/{team}/sheets.json`
- `API.sheets.addCategory / deleteCategory` → `data/{team}/sheets.json`
- `API.sheets.create / update / delete` → `data/{team}/sheets.json`

**Data files (per-team):** `sheets.json`

---

### admin/about-page.html — About SOM Page Editor
**Role:** ADMIN_ROLES  
**API calls:**
- `API.aboutPage.get()` → `data/sm/about-page.json` (SM-shared)
- `API.aboutPage.update(body)` → `data/sm/about-page.json`

**Data files:** `data/sm/about-page.json` (SM-shared)

---

## ── REQUESTS & FEEDBACK ────────────────────────────────────────

### admin/requests.html — Feature Requests & Bug Reports
**Role:** ADMIN_ROLES  
**API calls:**
- `API.get('/requests/index.php')` → `data/requests.json` (global)
- `API.patch('/requests/index.php', { id, comment })` → `data/requests.json`
- `API.put('/requests/index.php', {...})` → `data/requests.json`
- `API.delete('/requests/index.php?id=')` → `data/requests.json`
- `API.get('/jira-requests/?action=list')` → Jira Cloud JQL query

**Data files:** `data/requests.json` (global)  
**External:** Jira Cloud (inbox view)

---

### admin/feature-requests.html — Feature Requests (to Platform)
**Role:** ADMIN_ROLES  
**API calls:**
- `API.featureRequests.list()` → `data/{team}/feature-requests.json`
- `API.featureRequests.submit({...})` → `data/{team}/feature-requests.json`

**Data files (per-team):** `feature-requests.json`

---

## ── DEV TOOLS ──────────────────────────────────────────────────

### admin/devtools.html — Dev Tools Hub
**Role:** ADMIN_ROLES  
**API calls:**
- `API.health.check(fresh)` → `data/health_cache.json` (global) + Jira + Jenkins probes
- `API.mail.testConnection()` → SMTP test
- `API.serviceTypes.list()` → `data/{team}/board_service_types.json`
- `API.mail.send({...})` → SMTP send test
- `API.request(method, path, body)` → arbitrary API explorer
- `API.logs.query({ type, limit: 50 })` → `data/{team}/logs/activity.json` / `security.json`

**External:** Jira, Jenkins, SMTP

---

### admin/dev-api.html — API Explorer
**Role:** ADMIN_ROLES  
**API calls:** `API.request(method, path, body)` — arbitrary call to any `/api/` endpoint

---

### admin/dev-data.html — Data Inspector
**Role:** ADMIN_ROLES  
**API calls:**
- `API.dev.stats()` → `GET /dev/index.php?action=file-stats` — file sizes in `data/`
- `API.dev.readFile(name)` → `GET /dev/index.php?action=read&file=` — reads any `data/` JSON file

**Data files:** any file in `data/` (read-only inspector)

---

### admin/dev-email.html — Email Tester
**Role:** ADMIN_ROLES  
**API calls:**
- `API.get('/mail-config/index.php')` → `data/sm/mail_config.json`
- `API.mail.testConnection()` → SMTP test connect
- `API.serviceTypes.list()` → `data/{team}/board_service_types.json`
- `API.mail.send({...})` → sends test email

**External:** SMTP server

---

### admin/dev-logs.html — Raw Log Viewer
**Role:** ADMIN_ROLES  
**API calls:** `API.logs.query(params)` → `data/{team}/logs/activity.json` / `security.json`

---

### admin/dev-system.html — System Stats
**Role:** ADMIN_ROLES  
**API calls:**
- `GET /dev/index.php?action=server` → live PHP/system stats
- `GET /dev/index.php?action=server-history&range=` → `data/server_metrics.json` (global)
- `GET /dev/index.php` → general overview

---

## ── SUPER-ADMIN ONLY ───────────────────────────────────────────

### admin/super-admin.html — Platform Overview
**Role:** `super_admin` only  
**API calls:**
- `API.devSubteams.list()` → `data/{team}/dev-subteams.json`
- `API.devSubteams.add / remove` → `data/{team}/dev-subteams.json`
- `API.teams.list()` → `data/teams.json` (global)
- `API.users.list()` → `data/users.json` (global — all users)
- `API.teams.create({ slug, name, description, color })` → `data/teams.json` + `initTeamDirectory(slug)`
- `API.teams.update(id, {...})` → `data/teams.json`
- `API.teams.deactivate(id)` → `data/teams.json`
- `API.teams.hardDelete(id)` → `data/teams.json` + removes `data/<slug>/`

**Data files:** `data/teams.json` (global), `data/users.json` (global), `data/{team}/dev-subteams.json`

---

### admin/super-viewer.html — Super Viewer Config
**Role:** `super_admin` only  
**API calls:**
- `API.get('/super-viewer-config/index.php')` → `data/sm/super-viewer-config.json` (SM-shared)
- `API.patch('/super-viewer-config/index.php', { denied_pages: [...] })` → `data/sm/super-viewer-config.json`

**Data files:** `data/sm/super-viewer-config.json` (SM-shared)

---

### admin/super-team-permissions.html — Team Feature Permissions
**Role:** `super_admin` only  
**API calls:**
- `API.teams.list()` → `data/teams.json` (global)
- `API.teams.update(id, { features, page_modes, ... })` → `data/teams.json`
- `API.post('/teams/copy-config.php', { team_slug, feature, overwrite })` → snapshot copy from SM

**Data files:** `data/teams.json` (global)

---

### admin/super-email-templates.html — Global Email Templates
**Role:** `super_admin` only  
**API calls:**
- `API.teams.list()` → `data/teams.json` (global)
- `API.emailTemplates.get()` → `data/sm/email-templates.json` (SM-shared)
- `API.emailTemplates.save(payload)` → `data/sm/email-templates.json`

**Data files:** `data/teams.json` (global), `data/sm/email-templates.json` (SM-shared)

---

### admin/super-feature-requests.html — All Teams' Feature Requests
**Role:** `super_admin` only  
**API calls:**
- `API.featureRequests.list(status)` → reads `data/<team>/feature-requests.json` across all teams
- `API.featureRequests.resolve(id, 'approve'|'deny', note, grantedPages)` → writes to matching team's file

**Data files:** `data/<team>/feature-requests.json` (per-team, cross-team read)
