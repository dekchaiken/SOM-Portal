# SOM-Portal — Page × Data Source Map

> อ่านจาก HTML + JS + PHP source โดยตรง · Sep 2026  
> แต่ละหน้าระบุ: API calls → Data files (global / SM-shared / per-team) → External services

**หมายเหตุ scoping:**
- `(global)` → `data/<file>.json` — ทุกทีมแชร์ไฟล์เดียวกัน
- `(SM-shared)` → `data/sm/<file>` — SM เป็นเจ้าของ ทุกทีมอ่านได้
- `(per-team)` → `data/{team}/<file>` — แยกตาม JWT `team` claim
- `(not-team-scoped)` → path พิเศษที่ไม่ผ่าน teamDataPath เช่น `data/weekly-report/`, `data/analytics-cache/`

---

## สารบัญ

- [Auth & Self-Service](#auth--self-service)
- [Dashboard & Core](#dashboard--core)
- [Service Board](#service-board)
- [Jira Integration](#jira-integration)
- [Jenkins Integration](#jenkins-integration)
- [Monitoring & Observability](#monitoring--observability)
- [MA (Mobile App) Suite](#ma-mobile-app-suite)
- [Batch Monitoring](#batch-monitoring)
- [Knowledge & Learning](#knowledge--learning)
- [Communications & Tools](#communications--tools)
- [Team & Schedule](#team--schedule)
- [Admin — User & Access](#admin--user--access)
- [Admin — System Config](#admin--system-config)
- [Admin — Board & Content](#admin--board--content)
- [Admin — Monitoring Config](#admin--monitoring-config)
- [Admin — MA Management](#admin--ma-management)
- [Admin — Communications](#admin--communications)
- [Admin — Team Tools](#admin--team-tools)
- [Admin — Logs & Analytics](#admin--logs--analytics)
- [Admin — Dev Tools](#admin--dev-tools)
- [Admin — Super-Admin Only](#admin--super-admin-only)

---

## Auth & Self-Service

### `index.html` — Login
**Role:** Public (redirect to dashboard if authed)

| API | Data files |
|-----|-----------|
| `POST /api/auth/login.php` | `data/users.json` (global), `data/rate_limit.json` (global) |

**localStorage:** `som_token`, `som_user`, `csrf_token`, `som_remember_user`, `som_saved_accounts`  
**External:** none

---

### `change-password.html`
**Role:** all authenticated (allows expired/first_login tokens)

| API | Data files |
|-----|-----------|
| `POST /api/auth/change-password.php` | `data/users.json` (global) — read hash, check history, write new hash |

---

### `profile.html`
**Role:** all authenticated

| API | Data files |
|-----|-----------|
| `GET /api/auth/profile.php` | `data/users.json` (global) |
| `PATCH /api/auth/profile.php` | `data/users.json` (global) |
| `PUT /api/users/?id=` | `data/users.json` (admin only) |
| `GET /api/auth/my-activity.php` | `data/{team}/logs/activity.json` |
| `GET /api/achievements/index.php` | `data/{team}/courses/courses.json`, `courses/progress.json`, `courses/<id>/phases.json`, `exams/exams.json`, `exams/attempts.json`, `onboarding/config.json`, `onboarding/progress/<uid>.json` |
| `GET /api/board/?author_id=&limit=5` | `data/{team}/board.json` |
| `GET /api/teams/` | `data/teams.json` (global, super_admin only) |

---

### `settings.html`
**Role:** all authenticated  
**API calls:** **NONE** — ทุกอย่างใช้ localStorage เท่านั้น

**localStorage keys:** `som_ui_theme`, `som_dark_mode`, `som_pref_*`  
**Data files:** none

---

## Dashboard & Core

### `dashboard.html`
**Role:** all authenticated (dev_user → redirect to dev-hub.html)

| API | Data files | External |
|-----|-----------|---------|
| `GET /api/board/?limit=500` | `data/{team}/board.json`, `stars.json` | — |
| `GET /api/log/feed.php?limit=30` | `data/{team}/logs/activity.json` | — |
| `GET /api/dashboard/learning-status.php` | `data/{team}/onboarding/config.json`, `onboarding/progress/<uid>.json`, `courses/courses.json`, `courses/progress.json`, `courses/<id>/phases.json` | — |
| `GET /api/announcements/` | `data/{team}/announcements.json` | — |
| `GET /api/n8n-oncall.php?date=<today>` | `data/n8n_oncall_config.json` (global) | **n8n webhook** |
| `GET /api/schedule/?year=&month=` | `data/{team}/schedule.json` | — |
| `GET /api/users/` | `data/users.json` (global) | — |
| `GET /api/schedule/leave.php?status=approved` | `data/{team}/leave-requests.json`, `schedule.json` | — |
| `GET /api/jira/incidents-analytics.php` | `data/analytics-cache/incidents-YYYY-MM.json` (not-team-scoped) | **Jira Cloud** |
| `GET /api/jira/field-options.php` | `data/sm/jira_config.json` (SM-shared) | **Jira Cloud** `/rest/api/3/issue/createmeta`, `/field/{id}/context` |
| `POST /api/jira/create.php` | `data/sm/jira_config.json` (SM-shared) | **Jira Cloud** `POST /rest/api/3/issue` |
| `GET /api/inbox/list.php?folder=INBOX` | `data/{team}/mail_config.json` | **Gmail IMAP** `imap.gmail.com:993` |
| `POST /api/inbox/send.php` | `data/{team}/mail_config.json` | **Gmail SMTP** |
| `GET/POST /api/requests/` | `data/requests.json` (global) | — |

**Data files summary:** `data/{team}/board.json`, `stars.json`, `logs/activity.json`, `announcements.json`, `onboarding/config.json`, `onboarding/progress/<uid>.json`, `courses/courses.json`, `courses/progress.json`, `schedule.json`, `leave-requests.json`, `mail_config.json`, `data/users.json` (global), `requests.json` (global), `n8n_oncall_config.json` (global), `data/sm/jira_config.json` (SM-shared), `data/analytics-cache/incidents-YYYY-MM.json`

---

### `about-som.html`
**Role:** all authenticated (all roles including dev_user, external)

| API | Data files |
|-----|-----------|
| `GET /api/about-page/` | `data/{team}/about-page.json`, `data/users.json` (global), `data/teams.json` (global) |

---

### `my-team.html`
**Role:** all authenticated

| API | Data files |
|-----|-----------|
| `GET /api/my-team/` | `data/users.json` (global) — filter by `team` + `schedule_include=true` |
| `PATCH /api/auth/profile.php` | `data/users.json` (global) |
| `PUT /api/users/?id=` | `data/users.json` (global, admin only) |

---

## Service Board

### `board.html`
**Role:** all authenticated + `requirePagePermission('board')`

| API | Data files |
|-----|-----------|
| `GET /api/board/` | `data/{team}/board.json`, `stars.json` |
| `GET /api/board/?since=<ISO>` | `data/{team}/board.json` (real-time poll) |
| `POST /api/board/` | `data/{team}/board.json`, `notifications.json`, `data/users.json` (global) |
| `PUT /api/board/?id=` | `data/{team}/board.json` |
| `DELETE /api/board/?id=` | `data/{team}/board.json` (soft-delete) |
| `PATCH /api/board/?id=` | `data/{team}/board.json` (pin toggle) |
| `GET /api/board-comments/?post_id=` | `data/{team}/board-comments.json` |
| `GET /api/board-comments/?counts=id1,id2` | `data/{team}/board-comments.json` (batch) |
| `POST /api/board-comments/` | `data/{team}/board-comments.json`, `notifications.json` |
| `PATCH /api/board-comments/?id=` | `data/{team}/board-comments.json` |
| `DELETE /api/board-comments/?id=` | `data/{team}/board-comments.json` |
| `POST/DELETE /api/stars/` | `data/{team}/stars.json` |
| `GET /api/board-config/` | `data/{team}/board_categories.json`, `board_service_types.json` |
| `POST /api/board-config/?kind=service_type` | `data/{team}/board_service_types.json` |
| `POST /api/upload.php` | `uploads/` directory |
| `GET /api/users/` | `data/users.json` (global, limited fields) |

**CDN libs:** marked.js (Markdown), DOMPurify (XSS sanitizer) — จาก cdnjs.cloudflare.com

---

## Jira Integration

### `jira-templates.html`
**Role:** all authenticated; write = sm_lead+ AND SM team

| API | Data files | External |
|-----|-----------|---------|
| `GET /api/templates/` | `data/sm/templates.json` (SM-shared), `data/teams.json` (global) | — |
| `GET /api/jira-config/` | `data/sm/jira_config.json` (SM-shared) | — |
| `GET /api/jira/field-options.php` | `data/sm/jira_config.json` | **Jira Cloud** `/rest/api/3/issue/createmeta`, `/field/{id}/context` |
| `GET /api/jira/issue-types.php` | — | **Jira Cloud** `GET /rest/api/3/issue/createmeta?projectKeys=SMC` |
| `GET /api/service-types/` | `data/{team}/service_types.json` | — |
| `POST /api/templates/` | `data/sm/templates.json` (SM-shared) | — |
| `PUT/DELETE /api/templates/` | `data/sm/templates.json` | — |
| `POST /api/jira/create.php` | — | **Jira Cloud** `POST /rest/api/3/issue` |
| `GET /api/mail-config/` | `data/{team}/mail_config.json` | — |
| `POST /api/mail/send.php` | `data/{team}/mail_config.json`, `mail_logs.json` | **SMTP** |
| `POST/DELETE /api/service-types/` | `data/{team}/service_types.json` | — |

---

### `inbox.html` — Team Email Inbox (Gmail IMAP)
**Role:** ALL_STAFF_ROLES (super_viewer blocked)

| API | Data files | External |
|-----|-----------|---------|
| `GET /api/inbox/folders.php` | `data/{team}/mail_config.json` | **Gmail IMAP** `imap.gmail.com:993` |
| `GET /api/inbox/list.php?folder=INBOX` | `data/{team}/mail_config.json` | **Gmail IMAP** |
| `GET /api/inbox/message.php?folder=&uid=` | `data/{team}/mail_config.json` | **Gmail IMAP** |
| `POST /api/inbox/flag.php` | — | **Gmail IMAP** |
| `POST /api/inbox/move.php` | — | **Gmail IMAP** |
| `POST /api/inbox/send.php` | `data/{team}/mail_config.json` | **Gmail SMTP** |
| `GET /api/service-types/` | `data/{team}/service_types.json` | — |

> inbox.html ไม่ใช่ Jira request inbox — เป็น Gmail IMAP client จริงๆ

---

## Jenkins Integration

### `jenkins-portal.html`
**Role:** all authenticated + `requireTeamFeature('jenkins-portal')`

| API | Data files |
|-----|-----------|
| `GET/POST /api/jenkins-portal/` | `data/{team}/jenkins-portal-tools.json`, `jenkins-portal-apps.json`, `jenkins-portal-history.json`, `jenkins-portal-sessions.json`, `jenkins-portal-logs.json`, `data/users.json` (global), `data/sm/jenkins_servers.json` (SM-shared) |

**External:** Jenkins instances (ผ่าน jenkins-proxy + circuit breaker)

---

### `jenkins-build.html`
**Role:** all authenticated + `requireTeamFeature('jenkins-build')`

| API | Data files |
|-----|-----------|
| `GET/POST /api/jenkins-build/` | `data/{team}/jenkins-build-tools.json`, `jenkins-build-history.json`, `jenkins-build-approvals.json`, `data/users.json` (global, jb_role field), `data/sm/jenkins_servers.json` (SM-shared) |

**Build poll:** `/queue/item/{id}/api/json` → `/job/.../api/json` (ทุก 3–5 วิ)

---

### `so-jenkins.html`
**Role:** all authenticated + `requireTeamFeature('so-jenkins')`

| API | Data files |
|-----|-----------|
| `GET/POST /api/so-jenkins/` | `data/{team}/so-jenkins-tools.json`, `so-jenkins-builds.json`, `so-jenkins-logs.json`, `data/users.json` (global, soj_role field), `data/sm/jenkins_servers.json` (SM-shared) |

---

## Monitoring & Observability

### `service-performance.html`
**Role:** ALL_STAFF_ROLES (dev_user read-only)

| API | Data files | External |
|-----|-----------|---------|
| `GET /api/service-performance/suggestions.php` | `data/sm/service-inventory/inventory.csv` (SM-shared) | — |
| `GET /api/service-performance/detail.php?service=X&window=30` | `data/sm/service-performance-sources.json` (SM-shared), `data/sm/service-performance/cache/detail/<key>.json` | **Grafana Thanos (k8s PromQL)** |
| `GET /api/service-performance/pods.php` | same | **Grafana Thanos** |
| `GET /api/service-performance/subsystems.php?sections=hikari,tomcat,jvm,txn,chips,httppool` | `data/sm/service-performance/cache/subsystems/<key>.json` | **Grafana Thanos (JVM/Micrometer, jvmDsUid)** |
| `GET /api/service-performance/deploys.php` | cached | **Grafana Annotations API** |
| `GET /api/service-performance/dep-drill.php` | cached | **Grafana Thanos (http_client_requests_*)** |
| `POST /api/opensearch-proxy/?action=search` | `data/sm/opensearch_config.json` (SM-shared), `opensearch_user_creds.json`, `opensearch_sessions.json` | **OpenSearch** |
| `POST /api/opensearch-proxy/?action=trace` | same | **OpenSearch** |
| `GET /api/opensearch-user-creds/` | `data/sm/opensearch_user_creds.json` | — |
| `GET /api/alerts/list.php?service=X` | `data/{team}/alerts/` | — |
| `POST /api/alerts/save.php` | `data/{team}/alerts/` | — |
| `GET /api/downstream-health/breakdown.php` | `data/{team}/downstream-health.json` | **Grafana Thanos** |

---

### `restart-analyzer.html`
**Role:** ALL_STAFF_ROLES

| API | Data files | External |
|-----|-----------|---------|
| `GET /api/restart-analyzer/?service=X&range=1h` | `data/sm/service-performance-sources.json` (SM-shared), `data/sm/restart-analyzer/cache/ra3_<service>_<range>.json` | **Grafana Thanos** ~35 kube-state-metrics PromQL queries |
| `GET /api/restart-analyzer/pod-detail.php` | same | **Grafana Thanos + JVM (jvmDsUid)** |

**Bootstrap:** `?service=X&range=1h` ใน URL → auto-run

---

### `restart-monitor.html`
**Role:** ALL_STAFF_ROLES

| API | Data files | External |
|-----|-----------|---------|
| `GET /api/restart-monitor/?action=list` | `data/sm/grafana-runways.json` (SM-shared), `data/sm/grafana-monitoring/daily/<slug>/<date>.json` | — |
| `POST /api/restart-monitor/fetch.php` | `data/sm/grafana-monitoring/raw/<slug>/<date>.json` | **Grafana Thanos** (kube-state PromQL) |
| `GET /api/restart-monitor/monthly.php` | `data/sm/grafana-monitoring/daily/` | — |
| `POST /api/restart-monitor/send-monthly.php` | `data/{team}/mail_config.json` | **SMTP** |

---

### `alert-monitor.html`
**Role:** any authenticated

| API | Data files | External |
|-----|-----------|---------|
| `GET /api/alert-monitor/state.php` | `data/{team}/alert-monitor-state.json` | — |
| `GET /api/alert-monitor/stats.php` | `data/{team}/alerts/<YYYY-MM>.json` | — |
| `POST /api/alert-monitor/sync.php` | `data/{team}/alert-monitor-state.json`, `data/{team}/alert-monitor-config.json` | **JSM (Jira Service Management)** |

---

### `grafana-alerts.html`
**Role:** ALL_STAFF_ROLES + `requireTeamFeature('grafana-alerts')`

| API | Data files | External |
|-----|-----------|---------|
| `GET /api/grafana-alerts/paused.php` | `data/sm/grafana-alert-sources.json` (SM-shared) | **Grafana API** `GET /api/alerts?state=paused` (per org, Bearer/Basic auth) |
| `POST /api/grafana-alerts/resume.php` | — | **Grafana API** `POST /api/alerts/{id}/pause` |

---

### `begin-grafana.html`
**Role:** SM team only (`requireSmTeamOnly`)

| API | Data files | External |
|-----|-----------|---------|
| `GET /api/begin-grafana/endpoints.php?service=X` | `data/sm/service-performance-sources.json` (SM-shared), `data/sm/begin-grafana/cache/<key>.json` | **Grafana Thanos** `http_server_requests_seconds_*` PromQL |
| `GET /api/begin-grafana/series.php` | same cache | **Grafana Thanos** |
| `GET /api/begin-grafana/promql.php` | — | — (generates PromQL string + Grafana Explore URL) |
| `GET /api/begin-grafana/custom-list.php` | — | **Grafana Thanos** |

---

### `monitoring.html`
**Role:** any authenticated

| API | Data files |
|-----|-----------|
| `GET /api/links/?section=monitoring` | `data/{team}/links.json` (non-shared), `data/sm/links.json` (SM-shared, `monitoring` section) |

**External:** Grafana, DataDog — embedded ผ่าน `<iframe>` เท่านั้น

---

### `uptime.html`
**Role:** any authenticated (write = ADMIN_ROLES)

| API | Data files | External |
|-----|-----------|---------|
| `GET /api/uptime/` | `data/{team}/uptime_monitors.json`, `uptime_history.json` | — |
| `GET /api/uptime/check.php` | same | **HTTP probe** ไปยัง monitored URLs |

---

### `compare.html`
**Role:** any authenticated

| API | Data files | External |
|-----|-----------|---------|
| `GET /api/service-performance/suggestions.php` | `data/sm/service-inventory/inventory.csv` | — |
| `GET /api/service-performance/detail.php?service=A` | `data/sm/service-performance/cache/detail/<key>.json` | **Grafana Thanos** |
| `GET /api/service-performance/detail.php?service=B` | same (parallel) | **Grafana Thanos** |

**URL sharing:** `?a=svc1&b=svc2&window=30`

---

### `log-explorer.html`
**Role:** SM team only (API enforces `requireSmTeamOnly`)

| API | Data files | External |
|-----|-----------|---------|
| `POST /api/opensearch-proxy/?action=search` | `data/sm/opensearch_config.json` (SM-shared), `opensearch_user_creds.json` (AES-256 creds), `opensearch_sessions.json` (cookie cache) | **OpenSearch** `POST {index}/_search` |
| `POST /api/opensearch-proxy/?action=trace` | same | **OpenSearch** (cross-service trace) |
| `POST /api/opensearch-proxy/?action=deeplink` | — | — (generates Dashboards URL) |
| `GET/POST/DELETE /api/opensearch-user-creds/` | `data/sm/opensearch_user_creds.json` | — |
| `GET/POST/PUT/DELETE /api/opensearch-saved-searches/` | `data/sm/opensearch_saved_searches.json` | — |
| `GET/POST/PUT/DELETE /api/opensearch-saved-folders/` | `data/sm/opensearch_saved_folders.json` | — |

---

## MA (Mobile App) Suite

### `ma-status.html`
**Role:** all authenticated

| API | Data files | External |
|-----|-----------|---------|
| `GET /api/ma-status/` | `data/{team}/ma-status-cache.json` (15s TTL), `ma-status-hidden.json`, `ma-status-jenkins.json`, `data/sm/ma-services.json` (SM-shared), `data/sm/jenkins_servers.json` (SM-shared), `data/sm/backoffice-token.json` (SM-shared) | **NANO CDN** `cdn-loan-product.ascendnano.com/products.json`, **TMN-OPS Jenkins** (Basic auth), **ACM Backoffice** (Keycloak Bearer → `/use-cases/search`) |

**Auto-refresh:** 30 วิ via Page Visibility API (หยุดเมื่อ tab hidden)

---

### `ma-services.html`
**Role:** all authenticated (SM team only for write)

| API | Data files | External |
|-----|-----------|---------|
| `GET /api/ma-modules/config.php` | `data/sm/ma-modules.json` (SM-shared) | — |
| `GET /api/ma-services/list.php` | `data/sm/ma-services.json` (SM-shared) | — |
| `GET/POST/DELETE /api/cutoff-services/list.php` | `data/{team}/cutoff-services.json` | — |
| `POST /api/ma-services/jenkins-trigger.php` | `data/sm/jenkins_servers.json` | **Jenkins** (trigger build) |
| `GET /api/ma-services/jenkins-status.php` | — | **Jenkins** (poll status) |
| `GET /api/ma-services/backoffice-get.php` | `data/sm/backoffice-token.json` | **ACM Backoffice** (Keycloak) |
| `POST /api/ma-services/backoffice-save.php` | same | **ACM Backoffice** |
| `POST /api/ma-services/backoffice-toggle.php` | same | **ACM Backoffice** |
| `GET /api/jenkins-proxy/?list=1` | `data/sm/jenkins_servers.json` | — |

---

### `ma-test.html`
**Role:** all authenticated (SM team only — client redirect)

| API | Data files |
|-----|-----------|
| `GET/POST/PUT/DELETE /api/ma-test/catalog.php` | `data/{team}/ma-test/catalog.json` |
| `POST /api/ma-test/catalog-import.php` | `data/{team}/ma-test/catalog.json` |
| `GET/POST/DELETE /api/ma-test/plans.php?month=YYYY-MM` | `data/{team}/ma-test/plans-YYYY-MM.json` |
| `GET/POST/PUT/DELETE /api/ma-test/results.php?month=YYYY-MM` | `data/{team}/ma-test/results-YYYY-MM.json` |
| `GET/POST/PUT/DELETE /api/ma-test/config.php` | `data/{team}/ma-test/config.json` (webhook configs) |
| `POST /api/ma-test/notify.php` | — (ส่ง Google Chat webhook) |
| `GET /api/ma-services/list.php` | `data/sm/ma-services.json` (SM-shared) |
| `POST /api/upload.php` | `uploads/` |

---

### `ma-planwork.html`
**Role:** all authenticated

| API | Data files | External |
|-----|-----------|---------|
| `GET /api/ma-services/jira-stats.php` | `data/sm/ma-services.json` (SM-shared), `data/sm/jira_config.json` (SM-shared) | **Jira Cloud** `GET /rest/api/3/search/jql` |

---

## Batch Monitoring

### `batch-monitor.html` / `batch-monitor-v2.html`
**Role:** all authenticated (coverage = SM admin only)

| API | Data files | External |
|-----|-----------|---------|
| `GET /api/batch-meta/` | `data/{team}/batch_meta.json` | — |
| `POST /api/batch-records.php?action=submit` | `data/{team}/batch-records-YYYY-MM.json` | — |
| `GET /api/batch-records.php?action=list&month=` | `data/{team}/batch-records-YYYY-MM.json` | — |
| `GET /api/batch-records.php?action=coverage` | `data/{team}/batch-records-YYYY-MM.json`, `holidays.json` | — |
| `GET/POST /api/batch-records-admin.php` | `data/{team}/batch-records-YYYY-MM.json` | — |
| `GET /api/jenkins-proxy/?list=1` | `data/sm/jenkins_servers.json` (SM-shared) | — |
| `GET /api/jenkins-proxy/?server=X&path=` | — | **Jenkins** (job tree) |
| `POST /api/jenkins-proxy/?action=build` | — | **Jenkins** (trigger build) |
| `GET /api/jira/fields.php` | — | **Jira Cloud** |
| `POST /api/jira/create.php` | — | **Jira Cloud** |
| `GET/POST /api/batch-deps/` | `data/{team}/batch_meta.json` (key `dependencies`) — v2 only | — |

---

### `batch-file-search.html`
**Role:** all authenticated

| API | Data files |
|-----|-----------|
| `POST /api/batch-file-index/lookup.php` | `data/{team}/batch-file-index.json` |

---

## Knowledge & Learning

### `learn.html`
**Role:** all authenticated

| API | Data files |
|-----|-----------|
| `GET /api/courses/page-config.php` | `data/{team}/courses/page-config.json` |
| `GET /api/courses/courses.php` | `data/{team}/courses/courses.json` |
| `GET /api/exams/exams.php` | `data/{team}/exams/exams.json` |
| `GET /api/onboarding/progress.php` | `data/{team}/onboarding/progress/<uid>.json` |

---

### `learn-course.html`
**Role:** all authenticated

| API | Data files |
|-----|-----------|
| `GET /api/courses/courses.php?id=<id>` | `data/{team}/courses/courses.json` |
| `GET /api/courses/phases.php?course_id=<id>` | `data/{team}/courses/<course_id>/phases.json` |

---

### `learn-phase.html` (learn-course detail)
**Role:** all authenticated

| API | Data files |
|-----|-----------|
| `GET /api/courses/phases.php` | `data/{team}/courses/<id>/phases.json` |
| `GET /api/courses/lessons.php?phase_id=<id>` | `data/{team}/courses/<id>/lessons.json` |
| `GET /api/courses/quizzes.php?phase_id=<id>` | `data/{team}/courses/<id>/quizzes.json` |
| `POST /api/courses/complete-phase.php` | `data/{team}/courses/progress.json` **(write)** |
| `POST /api/courses/quizzes.php?action=submit` | `data/{team}/courses/progress.json` **(write)** |

---

### `learn-reports.html`
**Role:** all authenticated (admin sees all)

| API | Data files |
|-----|-----------|
| `GET /api/courses/courses.php` | `data/{team}/courses/courses.json` |
| `GET /api/courses/progress.php?scope=all` | `data/{team}/courses/progress.json` |

---

### `exam.html`
**Role:** all authenticated

| API | Data files |
|-----|-----------|
| `GET /api/exams/exams.php?id=<id>` | `data/{team}/exams/exams.json` |
| `GET /api/onboarding/progress.php` | `data/{team}/onboarding/progress/<uid>.json` (prerequisite check) |
| `POST /api/exams/attempts.php?action=start` | `data/{team}/exams/<id>/questions.json` (read, ไม่มี answers), `exams/attempts.json` **(write)** |
| `POST /api/exams/attempts.php?action=submit` | `data/{team}/exams/attempts.json` **(write)** |
| `POST /api/exams/attempts.php?action=heartbeat` | `data/{team}/exams/attempts.json` |
| `POST /api/exams/attempts.php?action=event` | `data/{team}/exams/<id>/events.json` **(write)** — proctoring audit |

**localStorage:** `exam_answers_{attempt_id}` — partial answers (crash recovery)

---

### `exam-reports.html`
**Role:** all authenticated (admin sees all)

| API | Data files |
|-----|-----------|
| `GET /api/exams/exams.php` | `data/{team}/exams/exams.json` |
| `GET /api/exams/report.php` | `data/{team}/exams/attempts.json` |

---

### `knowledge-base.html`
**Role:** read = all auth · write = LEAD_ROLES · delete = ADMIN_ROLES

| API | Data files |
|-----|-----------|
| `GET /api/knowledge-base/list.php` | `data/{team}/knowledge-base.json` |
| `POST /api/knowledge-base/save.php` | `data/{team}/knowledge-base.json` **(write)** |
| `POST /api/knowledge-base/delete.php` | `data/{team}/knowledge-base.json` **(write)** |
| `POST /api/knowledge-base/add-category.php` | `data/{team}/knowledge-base.json` **(write)** |

---

### `ops-runbook.html`
**Role:** read = all · write = LEAD_ROLES

| API | Data files |
|-----|-----------|
| `GET /api/ops-runbook/` | `data/{team}/ops_runbook.json` |
| `POST/PUT/DELETE /api/ops-runbook/` | `data/{team}/ops_runbook.json` **(write)** |

---

### `genz-notes.html`
**Role:** SM team + `is_genz=true` (อ่านจาก `users.json` live ไม่ใช่ JWT)

| API | Data files |
|-----|-----------|
| `GET/POST/PUT/DELETE /api/genz-notes/` | `data/sm/genz_case_notes.json` — **hard-coded to SM** (ไม่ใช่ per-team) |
| `GET /api/ma-services/list.php` | `data/sm/ma-services.json` (SM-shared, read-only for tagging) |

ตรวจ `is_genz` จาก `data/users.json` (global) แบบ live — ไม่ใช่จาก JWT claim

---

### `genz-hub.html`
**Role:** SM team + `is_genz=true`

| API | Data files |
|-----|-----------|
| `GET /api/genz-notes/` | `data/sm/genz_case_notes.json` |
| `GET /api/genz-team/` | `data/users.json` (global) — filter `is_genz=true` |

---

### `onboarding.html`
**Role:** all authenticated

| API | Data files |
|-----|-----------|
| `GET /api/onboarding/config.php` | `data/{team}/onboarding/config.json` |
| `GET /api/onboarding/progress.php` | `data/{team}/onboarding/progress/<uid>.json` |
| `GET /api/onboarding/list-pdfs.php` | `uploads/onboarding-pdfs/` |
| `POST /api/onboarding/progress.php?action=toggle_task` | `data/{team}/onboarding/progress/<uid>.json` **(write)** |
| `POST /api/onboarding/progress.php?action=notebook` | same **(write)** |
| `POST /api/onboarding/progress.php?action=quiz` | same **(write)** |
| `POST /api/onboarding/progress.php?action=finish` | same **(write)** |

---

### `sabai.html`
**Role:** all authenticated  
**API calls:** **NONE** — redirect ไป Google NotebookLM

`https://notebooklm.google.com/notebook/fb9a0f5f-17a4-4371-97bf-d63c8b066e10`

> `api/ai/index.php` (Ollama) มีในระบบแต่ยังไม่ได้เชื่อมกับหน้านี้

---

### `documentation.html`
**Role:** all authenticated  
**API calls:** ไม่มี — fetch static `.md` files ผ่าน relative path

**Static files:** `docs/user-guide/index.md`, `dashboard.md`, `board.md`, และอื่นๆ ใน `docs/user-guide/`

**External libs:** marked.js 12, DOMPurify 3.1.6, highlight.js 11.9 (จาก CDN)

---

## Communications & Tools

### `send-email.html`
**Role:** ALL_STAFF_ROLES

| API | Data files | External |
|-----|-----------|---------|
| `GET /api/jira/smc-cases.php?date=` | `data/analytics-cache/incidents-YYYY-MM.json` | **Jira Cloud** JQL |
| `GET /api/jira/field-options.php` | `data/sm/jira_config.json` (SM-shared) | **Jira Cloud** |
| `POST /api/jira/create.php` | — | **Jira Cloud** `POST /rest/api/3/issue` |
| `GET /api/jira/issue-detail.php?key=` | — | **Jira Cloud** |
| `POST /api/jira/attach.php` | — | **Jira Cloud** (multipart) |
| `POST /api/jira/add-comment.php` | — | **Jira Cloud** |
| `POST /api/jira/transition.php` | — | **Jira Cloud** |
| `POST /api/jira/assign.php` | — | **Jira Cloud** |
| `POST /api/mail/send.php` | `data/sm/mail_config.json` (SM-shared), `data/sm/mail_logs.json` | **SMTP** |
| `GET /api/service-types/` | `data/{team}/service_types.json` | — |

---

### `sms-gateway-switches.html`
**Role:** ALL_STAFF_ROLES

| API | Data files | External |
|-----|-----------|---------|
| `GET /api/sms-gateway/?project=tmn\|nano\|welth` | `data/{team}/sms_gateway_tmn.json`, `sms_gateway_nano.json`, `sms_gateway_welth.json` | — |
| `POST /api/sms-gateway/sync.php?project=` | same **(write)** | **Jenkins** (sync job state via proxy) |
| `GET /api/fh-email-config/` | `data/sm/fh_email_config.json` (SM-shared) | — |
| `POST /api/mail/send.php` | `data/sm/mail_config.json` | **SMTP** |

---

### `incident-launcher.html`
**Role:** SM team only

| API | Data files | External |
|-----|-----------|---------|
| `GET /api/incident-launcher/?action=config` | `data/sm/incident-launcher-config.json` | — |
| `GET /api/service-performance/?runway=all` | `data/sm/service-performance-sources.json` (SM-shared) | — |
| `GET /api/jira/field-options.php` | `data/sm/jira_config.json` | **Jira Cloud** |
| `POST /api/board/` | `data/{team}/board.json` | — |
| `POST /api/jira/create.php` | — | **Jira Cloud** |
| `POST /api/incident-launcher/?action=notify_channel` | `data/sm/incident-launcher-config.json` | **Google Chat** / **LINE Notify** / **DingTalk** |
| `POST /api/incident-launcher/?action=jira_do_transition` | — | **Jira Cloud** |
| `POST /api/incident-launcher/?action=bo_config_update` | — | **ACM Backoffice** (Keycloak) |
| `POST /api/jenkins-proxy/?action=build` | `data/sm/jenkins_servers.json` | **Jenkins** |
| `POST /api/mail/send.php` | `data/sm/mail_config.json` | **SMTP** |

---

### `analytics.html`
**Role:** ALL_STAFF_ROLES

| API | Data files | External |
|-----|-----------|---------|
| `GET /api/jira/incidents-analytics.php?fromDate=&toDate=` | `data/analytics-cache/incidents-YYYY-MM.json` (not-team-scoped, per-month cache) | **Jira Cloud** JQL |
| `GET /api/jira/smc-analytics.php?fromDate=&toDate=` | `data/analytics-cache/smc-YYYY-MM.json` (not-team-scoped) | **Jira Cloud** |
| `GET /api/jira/smc-cases.php?date=` | `data/analytics-cache/incidents-YYYY-MM.json`, `data/{team}/team-config.json` | **Jira Cloud** |

**External lib:** Chart.js 4.4.1 (CDN)

---

### `report-center.html`
**Role:** ALL_STAFF_ROLES

| API | Data files | External |
|-----|-----------|---------|
| `GET /api/ma-test/plans.php?month=` | `data/{team}/ma-test/plans-YYYY-MM.json` | — |
| `GET /api/ma-test/results.php?month=` | `data/{team}/ma-test/results-YYYY-MM.json` | — |
| `GET /api/weekly-report/list.php` | `data/weekly-report/` (not-team-scoped) | — |
| `GET /api/weekly-report/get.php?week=` | `data/weekly-report/week-YYYY-MM-DD.json` (not-team-scoped) | — |
| `GET /api/alert-monitor/stats.php` | `data/{team}/alerts/<YYYY-MM>.json` | — |
| `GET /api/jira/smc-analytics.php` | `data/analytics-cache/smc-YYYY-MM.json` | **Jira Cloud** |

---

### `pipeline-flow.html`
**Role:** ALL_STAFF_ROLES

| API | Data files | External |
|-----|-----------|---------|
| `GET/POST/DELETE /api/pipeline-flows/` | `data/{team}/pipeline_flows.json` | — |
| `GET /api/jenkins-proxy/?server=&path=` | `data/sm/jenkins_servers.json` | **Jenkins** (live job status) |

---

### `sheets.html` — Team Docs
**Role:** ALL_STAFF_ROLES (edit = author or ADMIN_ROLES)

| API | Data files |
|-----|-----------|
| `GET/POST/PUT/DELETE /api/sheets/` | `data/{team}/sheets.json` |
| `POST/DELETE /api/sheets/star.php` | `data/{team}/sheets.json` (star field) |

**External:** Google Sheets/Docs/Slides — embedded ผ่าน `<iframe>` เท่านั้น

---

### `migrate-user.html`
**Role:** ALL_STAFF_ROLES

| API | Data files | External |
|-----|-----------|---------|
| `GET /api/rundeck-proxy.php?action=run_migrate` | `data/{team}/logs/activity.json` (write) | **Rundeck** `th-ops-rundeck.mgt.ascendmoney.io` (session cookie auth) |
| `GET /api/rundeck-proxy.php?action=status` | — | **Rundeck** (poll ทุก 2.5 วิ) |
| `GET /api/rundeck-proxy.php?action=output` | — | **Rundeck** (live log) |
| `GET /api/migrate-user/?action=history` | `data/{team}/logs/activity.json` | — |

---

### `test-service.html`
**Role:** ALL_STAFF_ROLES (config write = ADMIN_ROLES)

| API | Data files | External |
|-----|-----------|---------|
| `GET /api/test-service-config.php` | `data/{team}/test-service-config.json` | — |
| `POST /api/fundout-proxy.php?action=has-config` | `data/reconcile-config.json` (global) | — |
| `POST /api/fundout-proxy.php?action=save-config` | `data/reconcile-config.json` (global) | — |
| `GET /api/fundout-proxy.php?action=check` | — | **Keycloak** `acm-backoffice-aaa.../realms/finops` + **ACM Financial Portal** |
| `GET /api/jenkins-proxy.php?url=` | — | **Jenkins batch** (`jenkins-batch-eks-cicd.private-a-cloud1p.ascendmoney.io`) |
| `POST /api/test-records.php?action=submit` | `data/{team}/test-records-YYYY-MM.json` | — |
| `GET /api/test-records-admin.php?action=list` | `data/{team}/test-records-YYYY-MM.json` | — |
| `POST /api/jira/create.php` | — | **Jira Cloud** |
| `POST /api/chat-proxy.php` | — | **Google Chat** webhook |

---

### `cron-builder.html`
**Role:** ALL_STAFF_ROLES  
**API calls:** **NONE** — pure client-side cron expression builder

---

### `office.html`
**Role:** ALL_STAFF_ROLES

| API | Data files |
|-----|-----------|
| `GET /api/presence/` | `data/{team}/presence.json` (online users in last 60s) |
| `PATCH /api/presence/` | `data/{team}/presence.json` (heartbeat) |

**External lib:** Three.js (3D rendering) — floor plan geometry hardcoded ใน JS

---

### `dev-hub.html`
**Role:** `dev_user` + ADMIN_ROLES

| API | Data files |
|-----|-----------|
| `GET /api/about-page/` | `data/sm/about-page.json` |

---

## Team & Schedule

### `pw-schedule.html`
**Role:** ALL_STAFF_ROLES

| API | Data files | External |
|-----|-----------|---------|
| `GET/POST/PUT/PATCH/DELETE /api/pw-schedule/` | `data/sm/pw_schedule.json` (SM-shared) | — |
| `GET /api/pw-schedule/teamup.php` | `data/{team}/pw-schedule-cache-*.json` (5min cache) | **Teamup** `teamup.com/{key}/events` (XHR / ICS / official API) |
| `POST /api/pw-schedule/sync.php` | `data/sm/pw_schedule.json` | **n8n webhook** (Google Sheet sync) |
| `POST /api/pw-schedule/notify.php` | — | **Google Chat** webhook |

---

### `schedule.html`
**Role:** ALL_STAFF_ROLES

| API | Data files |
|-----|-----------|
| `GET/POST/DELETE /api/schedule/` | `data/{team}/schedule.json` |
| `GET /api/users/` | `data/users.json` (global) |
| `GET/POST/DELETE /api/schedule/holidays.php` | `data/{team}/holidays.json` |
| `GET/POST /api/schedule/leave.php` | `data/{team}/leave-requests.json` |
| `GET/PUT /api/schedule/vacation-quota.php` | `data/{team}/vacation-quota.json` |
| `GET/POST /api/schedule/user-colors.php` | `data/{team}/user-colors.json` |
| `GET/POST/DELETE /api/holiday-plans/` | `data/{team}/holiday-plans.json` |

---

### `syncup.html`
**Role:** ALL_STAFF_ROLES

| API | Data files |
|-----|-----------|
| `GET/DELETE /api/syncup/` | `data/{team}/syncup.json` |
| `POST /api/syncup/upload.php` | `uploads/syncup/` |

---

### `holiday-plans.html`
**Role:** ALL_STAFF_ROLES

| API | Data files |
|-----|-----------|
| `GET /api/schedule/holidays.php` | `data/{team}/holidays.json` |
| `GET /api/schedule/leave.php` | `data/{team}/leave-requests.json` |
| `GET /api/users/` | `data/users.json` (global) |
| `GET/POST/DELETE /api/holiday-plans/` | `data/{team}/holiday-plans.json` |

---

### `weekly-report.html` / `weekly-report-form.html`
**Role:** ALL_STAFF_ROLES

| API | Data files | External |
|-----|-----------|---------|
| `GET /api/weekly-report/list.php` | `data/weekly-report/` **(not-team-scoped!)** | — |
| `GET /api/weekly-report/get.php?week=` | `data/weekly-report/week-YYYY-MM-DD.json` **(not-team-scoped!)** | — |
| `POST /api/weekly-report/save.php` | `data/weekly-report/week-YYYY-MM-DD.json` **(write, not-team-scoped!)** | — |
| `GET /api/weekly-report/sync-jira-incidents.php` | `data/{team}/weekly-report-jira.json` | **Jira Cloud** JQL |

---

---

## Admin — User & Access

### `admin/users.html`
**Role:** ADMIN_ROLES

| API | Data files | External |
|-----|-----------|---------|
| `GET /api/users/` | `data/users.json` (global) | — |
| `POST /api/users/` | `data/users.json` (global) | **SMTP** (welcome email) |
| `PUT /api/users/?id=` | `data/users.json` (global) | — |
| `DELETE /api/users/?id=` | `data/users.json` (global) | — |
| `PATCH /api/users/?id=` (reset) | `data/password_reset_tokens.json` (global) | **SMTP** (reset link) |
| `POST /api/users/reset-login-block.php` | `data/rate_limit.json` (global) | — |
| `GET /api/teams/` | `data/teams.json` (global) | — |
| `GET /api/menu-permissions/` | `data/{team}/menu-permissions.json` | — |
| `GET /api/system-settings/` | `data/system-settings.json` (global) | — |
| `GET/PUT /api/schedule/user-colors.php` | `data/{team}/user-colors.json` | — |
| `GET /api/dev-subteams/` | `data/{team}/dev-subteams.json` | — |

---

### `admin/menu-permissions.html`
**Role:** ADMIN_ROLES

| API | Data files |
|-----|-----------|
| `GET/PUT /api/menu-permissions/` | `data/{team}/menu-permissions.json` |

---

### `admin/nav-groups.html`
**Role:** ADMIN_ROLES

| API | Data files |
|-----|-----------|
| `GET/POST/DELETE /api/nav-groups/` | `data/{team}/nav-groups.json` |

---

### `admin/genz-team.html`
**Role:** ADMIN_ROLES

| API | Data files |
|-----|-----------|
| `GET /api/genz-team/` | `data/users.json` (global) — filter SM team |
| `POST /api/genz-team/` (toggle) | `data/users.json` (global) |

---

### `admin/leave-approval.html`
**Role:** ADMIN_ROLES

| API | Data files |
|-----|-----------|
| `GET /api/users/` | `data/users.json` (global) |
| `GET /api/schedule/leave.php?admin=true` | `data/{team}/leave-requests.json` |
| `PATCH /api/schedule/leave.php` (review) | `data/{team}/leave-requests.json` |

---

## Admin — System Config

### `admin/system-settings.html`
**Role:** ADMIN_ROLES · Data: `data/system-settings.json` (global)

### `admin/maintenance.html`
**Role:** ADMIN_ROLES · Data: `data/maintenance.json` (global)

### `admin/backup.html`
**Role:** ADMIN_ROLES · reads `data/` เพื่อ ZIP · writes `backups/`

### `admin/system-monitor.html`
**Role:** ADMIN_ROLES · Data: `data/server_metrics.json` (global), PHP live stats via `/dev/index.php`

---

## Admin — Board & Content

### `admin/board.html`
**Role:** ADMIN_ROLES · Data: `data/{team}/board.json`, `board_categories.json`, `board_service_types.json`

### `admin/trash.html`
**Role:** ADMIN_ROLES · Data: `data/{team}/board.json` (deleted items only)  
Actions: restore (undelete) / hard-delete (permanent) / purge all trash

### `admin/templates.html`
**Role:** ADMIN_ROLES (write = `requireSmForShared()`) · Data: `data/sm/templates.json` (SM-shared)

### `admin/jira-config.html`
**Role:** ADMIN_ROLES · Data: `data/sm/jira_config.json` (SM-shared), `data/{team}/board_service_types.json`

### `admin/knowledge-base.html`
**Role:** ADMIN_ROLES · Data: `data/{team}/knowledge-base.json`  
Extra: import bulk, clear-all, delete-category operations

### `admin/ops-runbook.html`
**Role:** ADMIN_ROLES · Data: `data/{team}/ops_runbook.json`

### `admin/courses.html`
**Role:** ADMIN_ROLES · Data: `data/{team}/courses/courses.json`, `courses/<id>/phases.json`, `courses/<id>/lessons.json`, `courses/<id>/quizzes.json`, `courses/progress.json`

### `admin/exams.html`
**Role:** ADMIN_ROLES · Data: `data/{team}/exams/exams.json`, `exams/<id>/questions.json`, `exams/attempts.json`, `exams/<id>/events.json`, `courses/courses.json`

### `admin/achievements.html`
**Role:** ADMIN_ROLES · Data: per-user across `courses/`, `exams/`, `onboarding/` + `data/users.json` (global)

---

## Admin — Monitoring Config

### `admin/jenkins-servers.html`
**Role:** ADMIN_ROLES + `requirePageMode('jenkins-servers')`

| API | Data files | External |
|-----|-----------|---------|
| `GET/POST/PUT/DELETE /api/jenkins-servers/` | `data/sm/jenkins_servers.json` (SM-shared) | **Jenkins** (test connection probe) |

---

### `admin/alert-monitor-config.html`
**Role:** ADMIN_ROLES · Data: `data/sm/alert-monitor-config.json` (SM-shared), `data/sm/alert-monitor-state.json`  
**External:** Grafana alerting API, JSM (Jira Service Management)

### `admin/grafana-sources.html`
**Role:** ADMIN_ROLES · Data: `data/sm/grafana-sources.json` (SM-shared)  
**External:** Grafana (test probe)

### `admin/opensearch-config.html`
**Role:** ADMIN_ROLES · Data: `data/sm/opensearch_config.json` (SM-shared)  
**External:** OpenSearch `/_cluster/health` (test probe)

### `admin/ma-config.html`
**Role:** ADMIN_ROLES · Data: `data/sm/ma-modules.json` (SM-shared)

### `admin/ma-status.html` (admin)
**Role:** ADMIN_ROLES · Data: `data/{team}/ma-status-jenkins.json`, `ma-status-hidden.json`, `ma-status-cache.json`, `data/sm/ma-services.json` (SM-shared), `data/sm/jenkins_servers.json` (SM-shared)  
**External:** NANO CDN, TMN-OPS Jenkins, ACM Backoffice

### `admin/service-inventory.html`
**Role:** ADMIN_ROLES · Data: `data/sm/service-inventory/inventory.csv` (SM-shared), backup CSVs

### `admin/service-severity.html`
**Role:** ADMIN_ROLES

| API | Data files | External |
|-----|-----------|---------|
| `GET/POST /api/service-severity/` | `data/{team}/service-severity.json` | — |
| `GET/POST /api/n8n-severity-config.php` | `data/n8n_severity_config.json` (global) | — |
| `POST /api/n8n-severity-sync.php` | `data/{team}/service-severity.json`, `data/n8n_severity_last_sync.json` (global) | **n8n webhook** → Google Sheet |
| `GET/PUT/DELETE /api/restart-monitor-webhooks/` | `data/sm/grafana-monitoring/restart-webhooks.json` (SM-shared) | **Google Chat** (test send) |

---

## Admin — MA Management

### `admin/ma-test-catalog.html`
**Role:** ADMIN_ROLES · SM team only  
Data: `data/{team}/ma-test/catalog.json`, `data/sm/ma-services.json` (SM-shared, read for linking)

### `admin/ma-test-plans.html`
**Role:** ADMIN_ROLES · SM team only  
Data: `data/{team}/ma-test/plans-YYYY-MM.json`, `data/{team}/ma-test/catalog.json`

### `admin/ma-test-overview.html`
**Role:** ADMIN_ROLES · SM team only  
Data: `data/{team}/ma-test/plans-YYYY-MM.json`, `data/{team}/ma-test/results-YYYY-MM.json`, `data/{team}/ma-test/config.json`  
**External:** Google Chat webhooks

---

## Admin — Communications

### `admin/mail-config.html`
**Role:** ADMIN_ROLES · Data: `data/{team}/mail_config.json`  
**External:** SMTP (test connection + test send)

### `admin/email-noti.html`
**Role:** ADMIN_ROLES · Data: `data/{team}/email-noti.json`, `courses/courses.json`, `exams/exams.json`  
**External:** SMTP

### `admin/scheduled-noti.html`
**Role:** ADMIN_ROLES  
Data: `data/{team}/scheduled-noti.json`, `data/{team}/batch-monitor-noti-config.json`, `data/sm/grafana-monitoring/restart-webhooks.json` (SM-shared)  
**External:** Google Chat (test send)

### `admin/announcements.html`
**Role:** ADMIN_ROLES · Data: `data/{team}/announcements.json`

### `admin/sms-gateway-config.html`
**Role:** ADMIN_ROLES · Data: `data/{team}/sms_gateway_tmn.json`, `sms_gateway_nano.json`, `sms_gateway_welth.json`  
**External:** Jenkins (sync)

### `admin/n8n-oncall-config.html`
**Role:** ADMIN_ROLES · Data: `data/n8n_oncall_config.json` (global)  
**External:** n8n webhook (test fetch)

### `admin/fh-config.html`
**Role:** ADMIN_ROLES · Data: `data/sm/fh_email_config.json` (SM-shared)

### `admin/incident-launcher-config.html`
**Role:** ADMIN_ROLES · SM team only  
Data: `data/{team}/incident-launcher-config.json`  
**External:** Jira Cloud (`/issue/createmeta`, `/field`, `/field/{id}/context/{ctx}/option`)

---

## Admin — Team Tools

### `admin/schedule.html`
**Role:** ADMIN_ROLES  
Data: `data/{team}/schedule.json`, `holidays.json`, `vacation-quotas.json`, `user-colors.json`, `leave-requests.json`, `data/users.json` (global)

### `admin/syncup-config.html`
**Role:** ADMIN_ROLES · Data: `data/{team}/syncup-config.json`, `syncup-records.json`  
**External:** Google Chat (test notify)

### `admin/pw-schedule.html`
**Role:** ADMIN_ROLES · Data: `data/sm/pw_schedule_config.json` (SM-shared), `data/sm/pw_schedule.json` (SM-shared)  
**External:** Teamup calendar, Google Chat, n8n

### `admin/holiday-plans.html`
**Role:** ADMIN_ROLES  
Data: `data/{team}/holiday-plans-YYYY-MM.json`, `holidays.json`, `leave-requests.json`, `vacation-quotas.json`, `schedule-YYYY-MM.json`, `data/users.json` (global)

### `admin/weekly-report.html`
**Role:** ADMIN_ROLES · Data: `data/weekly-report/week-YYYY-MM-DD.json` **(not-team-scoped!)**

### `admin/onboarding.html`
**Role:** ADMIN_ROLES  
Data: `data/{team}/onboarding/config.json`, `data/{team}/onboarding/progress/<uid>.json`, `data/users.json` (global)  
Upload: `uploads/onboarding-pdfs/`

### `admin/links.html`
**Role:** LEAD_ROLES  
Data: `data/{team}/links.json` (per-team), `data/sm/links.json` (SM-shared, `monitoring` section)

### `admin/tools.html`
**Role:** ADMIN_ROLES · Data: `data/{team}/sidebar-tools.json`

### `admin/sheets.html`
**Role:** ADMIN_ROLES · Data: `data/{team}/sheets.json`

### `admin/about-page.html`
**Role:** ADMIN_ROLES · Data: `data/sm/about-page.json` (SM-shared), `data/users.json` (global), `data/teams.json` (global)

---

## Admin — Logs & Analytics

### `admin/logs.html`
**Role:** ADMIN_ROLES  
Data: `data/{team}/logs/activity.json`, `data/{team}/logs/security.json`  
super_admin: `X-Admin-Team` header เพื่อดู team อื่น

### `admin/mail-logs.html`
**Role:** ADMIN_ROLES · Data: `data/{team}/mail_logs.json`

### `admin/analytics.html`
**Role:** ADMIN_ROLES  
Data: `data/analytics-cache/incidents-YYYY-MM.json` (not-team-scoped)  
**External:** Jira Cloud (incident stats)

---

## Admin — Dev Tools

### `admin/devtools.html`
**Role:** ADMIN_ROLES  
Data: `data/health_cache.json` (global), `logs/activity.json`, `logs/security.json`, `board_service_types.json`  
**External:** Jira, Jenkins, SMTP (via health check)

### `admin/dev-api.html`
**Role:** ADMIN_ROLES — API Explorer: เรียก endpoint ใดก็ได้  
Data: depends on endpoint called

### `admin/dev-data.html`
**Role:** ADMIN_ROLES — Data Inspector: อ่าน JSON ไฟล์ใดก็ได้ใน `data/`  
(filtered to simple filenames, ไม่มี path traversal)

### `admin/dev-email.html`
**Role:** ADMIN_ROLES · Data: `data/{team}/mail_config.json`  
**External:** SMTP

### `admin/dev-logs.html`
**Role:** ADMIN_ROLES · Data: `data/{team}/logs/activity.json`, `logs/security.json`

### `admin/dev-system.html`
**Role:** ADMIN_ROLES  
Data: `data/server_metrics.json` (global), `data/api_rate_limit.json` (global), `data/rate_limit.json` (global), `data/users.json`, `data/{team}/board.json`

---

## Admin — Super-Admin Only

### `admin/super-admin.html`
**Role:** `super_admin` only

| API | Data files |
|-----|-----------|
| `GET/POST/PUT/DELETE /api/teams/` | `data/teams.json` (global) |
| `GET /api/users/` | `data/users.json` (global — all users) |
| `GET/POST/DELETE /api/dev-subteams/` | `data/dev-subteams.json` (global) |

Create team → `initTeamDirectory(slug)` → สร้าง `data/<slug>/` + ทุก operational JSON files

---

### `admin/super-viewer.html`
**Role:** `super_admin` only  
Data: reads per-team files ตาม selected team ด้วย `X-Admin-Team` header

---

### `admin/super-team-permissions.html`
**Role:** `super_admin` only

| API | Data files |
|-----|-----------|
| `GET /api/teams/` | `data/teams.json` (global) |
| `PUT /api/teams/?id=` (features, page_modes) | `data/teams.json` (global) |
| `POST /api/teams/copy-config.php` | snapshot copy `data/sm/<files>` → `data/<team>/<files>` |

---

### `admin/super-email-templates.html`
**Role:** `super_admin` only  
Data: `data/{team}/email_templates.json` (switch team via `X-Admin-Team`), `data/teams.json` (global)

---

### `admin/super-feature-requests.html`
**Role:** `super_admin` only  
Data: `data/feature_requests.json` (global) — อ่าน requests จากทุกทีม

---

## Data Files Quick Reference

### Global Files (ทุกทีมแชร์)
| File | Touched by |
|------|-----------|
| `users.json` | login, profile, my-team, all admin, board (notify), genz-team, super-admin |
| `teams.json` | login, jira-templates, super-admin, super-team-permissions, super-email-templates |
| `system-settings.json` | admin/system-settings, admin/users |
| `maintenance.json` | maintenance.js (every page), admin/maintenance |
| `rate_limit.json` | login, admin/users (reset block) |
| `api_rate_limit.json` | every API call (helpers.php) |
| `host-cooldown.json` | Jenkins proxy, OpenSearch proxy, Jira calls |
| `dns-overrides.json` | Jenkins proxy (CURLOPT_RESOLVE) |
| `requests.json` | dashboard (feature requests), admin/requests |
| `n8n_oncall_config.json` | dashboard (on-call widget), admin/n8n-oncall-config |
| `server_metrics.json` | admin/system-monitor, admin/dev-system |
| `password_reset_tokens.json` | change-password, admin/users (reset) |
| `health_cache.json` | health check endpoint, admin/devtools |

### SM-Shared Files (SM เขียน ทุกทีมอ่าน)
| File | Touched by |
|------|-----------|
| `templates.json` | jira-templates, admin/templates |
| `jira_config.json` | jira-templates, send-email, dashboard (quick create), admin/jira-config |
| `jenkins_servers.json` | all Jenkins pages, ma-status, batch-monitor, incident-launcher, admin/jenkins-servers |
| `opensearch_config.json` | log-explorer, service-performance (log viewer), admin/opensearch-config |
| `opensearch_user_creds.json` | log-explorer, service-performance (log viewer) |
| `opensearch_saved_searches.json` | log-explorer |
| `opensearch_saved_folders.json` | log-explorer |
| `service-performance-sources.json` | service-performance, restart-analyzer, begin-grafana, compare, incident-launcher |
| `service-inventory/inventory.csv` | service-performance (suggestions), compare, admin/service-inventory |
| `grafana-alert-sources.json` | grafana-alerts, admin/alert-monitor-config |
| `grafana-sources.json` | monitoring.html, admin/grafana-sources |
| `grafana-monitoring/` (dir) | restart-monitor, admin/service-severity (webhooks) |
| `ma-services.json` | ma-status, ma-services, genz-notes (tag), ma-planwork, admin/ma-status, admin/ma-test-catalog |
| `ma-modules.json` | ma-services, admin/ma-config |
| `mail_config.json` | dashboard (inbox), jira-templates (send), send-email, sms-gateway-switches, incident-launcher, admin/mail-config |
| `fh_email_config.json` | sms-gateway-switches, admin/fh-config |
| `pw_schedule.json` | pw-schedule, admin/pw-schedule |
| `pw_schedule_config.json` | pw-schedule, admin/pw-schedule |
| `about-page.json` | about-som, dev-hub, admin/about-page |
| `genz_case_notes.json` | genz-notes, genz-hub |
| `links.json` (monitoring section) | monitoring, admin/links |
| `incident-launcher-config.json` | incident-launcher, admin/incident-launcher-config |
| `super-viewer-config.json` | admin/super-viewer |

### Not-Team-Scoped (ไม่ผ่าน teamDataPath)
| File/Dir | Touched by |
|---------|-----------|
| `data/weekly-report/week-YYYY-MM-DD.json` | weekly-report, weekly-report-form, admin/weekly-report |
| `data/analytics-cache/incidents-YYYY-MM.json` | dashboard, analytics, report-center, admin/analytics, weekly-report (sync) |
| `data/analytics-cache/smc-YYYY-MM.json` | analytics, report-center |
| `data/reconcile-config.json` | test-service (Keycloak creds) |

---

*Last updated: Sep 2026 · Source: HTML + JS + PHP source code*
