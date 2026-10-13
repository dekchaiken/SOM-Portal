# Part 3 — MA Suite, Batch Monitoring, Knowledge & Learning

> อ่านจาก HTML + JS source จริง · Sep 2026

---

## ma-status.html — MA Maintenance Status Dashboard

**Role:** all authenticated (admin features for `super_admin`, `sm_admin`, `dev_sm`)  
**Team gate:** none (all teams can view)

**API calls:**
- `GET /api/ma-status/` → reads `data/{team}/ma-status-cache.json` (15s TTL), `ma-services.json` (SM-shared), `jenkins_servers.json` (SM-shared), `ma-status-jenkins.json`, `ma-status-hidden.json`
- `GET /api/ma-status/?refresh=1` → same but bypasses cache (user-initiated)

**Data files read:**
- `data/{team}/ma-status-cache.json` (cache TTL 15s)
- `data/sm/ma-services.json` (SM-shared)
- `data/sm/jenkins_servers.json` (SM-shared)
- `data/{team}/ma-status-jenkins.json` (job list override)
- `data/{team}/ma-status-hidden.json` (ignore list)

**External services:**
- NANO CDN: `https://cdn-loan-product.ascendnano.com/products.json` (public CloudFront)
- TMN-OPS Jenkins: per-job paths via `jenkins_servers.json` (Basic Auth)
- ACM Backoffice: `BACKOFFICE_GATEWAY_URL/…/use-cases/search` (Keycloak Bearer token)

**UI:** Auto-refresh every 30s via Page Visibility API (stops when tab is hidden).

---

## ma-services.html — MA Service Catalog

**Role:** all authenticated (SM team only for write)

**API calls:**
- `GET /api/ma-modules/config.php` → `data/sm/ma-modules.json`
- `GET /api/ma-services/list.php` → `data/sm/ma-services.json`
- `GET /api/cutoff-services/list.php` → `data/{team}/cutoff-services.json`
- `POST /api/ma-services/backoffice-toggle.php` → toggles backoffice maintenance (Keycloak + ACM)
- `DELETE /api/ma-services/delete.php` → `data/sm/ma-services.json`
- `GET /api/ma-status/?source=tmn_backoffice` → live backoffice status
- `GET /api/jenkins-proxy/index.php?list=1` → `data/sm/jenkins_servers.json`
- `GET /api/ma-services/jenkins-params.php?service_id=...` → Jenkins job params
- `POST /api/ma-services/jenkins-trigger.php` → trigger Jenkins maintenance job
- `GET /api/ma-services/jenkins-status.php?...` → poll build status
- `GET /api/ma-services/backoffice-get.php?use_case_id=...` → read backoffice config
- `POST /api/ma-services/backoffice-save.php` → save backoffice config

**Data files read/written:**
- `data/sm/ma-services.json` (SM-shared)
- `data/sm/ma-modules.json` (SM-shared)
- `data/sm/jenkins_servers.json` (SM-shared, read-only)
- `data/{team}/cutoff-services.json`

**External:** ACM Backoffice (Keycloak OAuth), Jenkins (via proxy)

---

## ma-test.html — MA Test Plans & Results

**Role:** all authenticated  
**Client guard:** SM team only (`u.team !== 'sm'` → redirect to dashboard, except `super_admin`/`super_viewer`)

**API calls** (via `MaTest.api.*` from `assets/js/ma-test.js`):
- `GET /api/ma-test/plans.php?month=YYYY-MM` → `data/{team}/ma-test-plans-YYYY-MM.json`
- `GET /api/ma-test/plans.php?months=1` → list available months
- `GET /api/ma-test/results.php?month=...` → `data/{team}/ma-test-results-YYYY-MM.json`
- `POST /api/ma-test/results.php?month=...` → create test result
- `PUT /api/ma-test/results.php?month=...&id=...` → update result
- `DELETE /api/ma-test/results.php?month=...&id=...` → delete result
- `POST /api/upload.php` → upload screenshots → `uploads/`

**Data files read/written:**
- `data/{team}/ma-test-plans-YYYY-MM.json`
- `data/{team}/ma-test-results-YYYY-MM.json`
- `uploads/` (screenshots)

---

## ma-planwork.html — MA Work Planning

**Role:** all authenticated

**API calls:**
- `GET /api/ma-services/jira-stats.php?...` → Jira issue stats for MA services  
  (calls Jira Cloud: `GET {JIRA_BASE_URL}/rest/api/3/search/jql`)

**Data files read:** `data/sm/ma-services.json` (SM-shared)  
**External:** Jira Cloud (`truemoney.atlassian.net`)

---

## batch-monitor.html — Batch Monitor (Classic View)

**Role:** all authenticated · SM-only: coverage view (`isSmCoverageAdmin()`)

**API calls:**
- `GET /api/batch-records-admin.php?action=months` → list months with data
- `GET /api/batch-records-admin.php?action=list&month=YYYY-MM` → `data/{team}/batch-records-YYYY-MM.json`
- `POST /api/batch-records-admin.php?action=edit&month=...` → edit record (admin)
- `POST /api/batch-records-admin.php?action=delete&month=...` → delete record
- `POST /api/batch-records-admin.php?action=clear&month=...` → clear month records
- `POST /api/batch-records.php?action=submit` → submit new batch report
- `GET /api/batch-records.php?action=coverage&month=...` → per-day submission coverage (SM admin only)
- `GET /api/batch-meta/index.php` → `data/{team}/batch_meta.json`
- `POST /api/batch-meta/index.php?action=upsert-entry` → upsert metadata entry
- `GET /api/jenkins-proxy/?list=1` → Jenkins server list
- `GET /api/jenkins-proxy/?server=X&path=...` → Jenkins job tree
- `POST /api/jenkins-proxy/?action=build` → trigger Jenkins build
- `GET /api/jira/fields.php` + `GET /api/jira/issue-types.php` → Jira field options (lazy)
- `POST /api/jira/create.php` → create Jira ticket from batch result

**Data files read/written:**
- `data/{team}/batch-records-YYYY-MM.json`
- `data/{team}/batch_meta.json`
- `data/{team}/holidays.json` (coverage holiday check)
- `data/sm/jenkins_servers.json` (SM-shared, read)

**External:** Jenkins (via proxy), Jira Cloud

---

## batch-monitor-v2.html — Batch Monitor v2

**Role:** all authenticated (same gates as v1)

**API calls** (same as v1 + additions):
- Everything in `batch-monitor.html`
- `GET /api/batch-deps/` → `data/{team}/batch_meta.json` (key: `dependencies`)
- `POST /api/batch-deps/?action=set` → set job dependencies
- `POST /api/batch-deps/?action=delete` → remove job dependencies

**No coverage tab** (v2 removed it).

**Data files read/written:**
- `data/{team}/batch-records-YYYY-MM.json`
- `data/{team}/batch_meta.json` (includes `dependencies` key)
- `data/sm/jenkins_servers.json`

**External:** Jenkins (via proxy), Jira Cloud

---

## batch-file-search.html — Batch File Search

**Role:** all authenticated

**API calls:**
- `GET /api/batch-file-index/crawl.php` → `data/{team}/batch-file-index.json`
- `GET /api/batch-file-index/lookup.php?name=...` → lookup file in index

**Data files read:** `data/{team}/batch-file-index.json`

---

## learn.html — Learning Hub

**Role:** all authenticated

**API calls:**
- `GET /api/courses/page-config.php` → `data/{team}/courses/page-config.json`
- `GET /api/onboarding/progress.php` → `data/{team}/onboarding/progress/<user_id>.json`
- `GET /api/courses/courses.php` → `data/{team}/courses/courses.json`
- `GET /api/exams/exams.php` → `data/{team}/exams/exams.json`

**Data files read:**
- `data/{team}/courses/courses.json`
- `data/{team}/courses/page-config.json`
- `data/{team}/exams/exams.json`
- `data/{team}/onboarding/progress/<user_id>.json`

---

## learn-course.html — Course Detail

**Role:** all authenticated · Query: `?id=<course_id>`

**API calls:**
- `GET /api/courses/courses.php?id=<id>` → `data/{team}/courses/courses.json`
- `GET /api/courses/phases.php?course_id=<id>` → `data/{team}/courses/<course_id>/phases.json`

**Data files read:**
- `data/{team}/courses/courses.json`
- `data/{team}/courses/<course_id>/phases.json`

---

## learn-phase.html — Course Phase / Lesson

**Role:** all authenticated · Query: `?course_id=<id>&phase_id=<id>`

**API calls:**
- `GET /api/courses/phases.php` → `data/{team}/courses/<course_id>/phases.json`
- `GET /api/courses/lessons.php?phase_id=<id>` → `data/{team}/courses/<course_id>/lessons.json`
- `GET /api/courses/courses.php?id=<id>` → course metadata
- `GET /api/courses/quizzes.php?phase_id=<id>` → `data/{team}/courses/<course_id>/quizzes.json`
- `POST /api/courses/complete-phase.php` → marks phase complete → `data/{team}/courses/progress.json`
- `POST /api/courses/quizzes.php?action=submit` → submit quiz → `data/{team}/courses/progress.json`

**Data files read/written:**
- `data/{team}/courses/<course_id>/phases.json` (read)
- `data/{team}/courses/<course_id>/lessons.json` (read)
- `data/{team}/courses/<course_id>/quizzes.json` (read)
- `data/{team}/courses/progress.json` (**written** on complete/quiz submit)

---

## exam.html — Exam Taking

**Role:** all authenticated · Query: `?id=<exam_id>`

**API calls:**
- `GET /api/exams/exams.php?id=<id>` → exam metadata (no questions)
- `GET /api/onboarding/progress.php` → prerequisite check
- `POST /api/exams/attempts.php?action=start` → start/resume attempt → `data/{team}/exams/attempts.json`
- `POST /api/exams/attempts.php?action=heartbeat` → keepalive (auto-submit on timeout)
- `POST /api/exams/attempts.php?action=event` → proctoring events → `data/{team}/exams/<id>/events.json`
- `POST /api/exams/attempts.php?action=submit` → submit answers + score

**Data files read/written:**
- `data/{team}/exams/exams.json` (read)
- `data/{team}/exams/<exam_id>/questions.json` (read at start, correct answers stripped)
- `data/{team}/exams/attempts.json` (**written**)
- `data/{team}/exams/<exam_id>/events.json` (**written** — proctoring audit log)
- `data/{team}/onboarding/progress/<user_id>.json` (read — prerequisite)

**Client-side:** Answers cached in `localStorage` for crash recovery. Timer countdown in browser.

---

## knowledge-base.html — Knowledge Base

**Role:** read = all auth · write = `LEAD_ROLES` · delete/category = `ADMIN_ROLES`

**API calls:**
- `GET /api/knowledge-base/list.php` → `data/{team}/knowledge-base.json`
- `POST /api/knowledge-base/save.php` → create/update entry
- `POST /api/knowledge-base/delete.php` → delete entry
- `POST /api/knowledge-base/update-category.php` → rename category
- `POST /api/knowledge-base/add-category.php` → add category

**Data files read/written:** `data/{team}/knowledge-base.json`

---

## ops-runbook.html — Ops Runbook

**Role:** read = all auth · write/delete = `LEAD_ROLES` (server enforced)

**API calls** (all hit `/api/ops-runbook/index.php`):
- `GET /api/ops-runbook/` → `data/{team}/ops_runbook.json`
- `POST /api/ops-runbook/?action=rows&section=<id>` → create row
- `PUT /api/ops-runbook/?id=<id>&section=<id>` → update row
- `DELETE /api/ops-runbook/?id=<id>&section=<id>` → delete row

**Data files read/written:** `data/{team}/ops_runbook.json`

---

## genz-notes.html — GenZ Obsidian-style KB

**Role:** SM team + `is_genz` flag (or `sm_admin`/`dev_sm`)  
**Client guard:** `u.team !== 'sm' || (!u.is_genz && !isAdmin)` → redirect  
**Note:** `is_genz` read live from `users.json`, NOT from JWT

**API calls:**
- `GET /api/genz-notes/` → `data/sm/genz_case_notes.json`
- `GET /api/ma-services/list.php` → `data/sm/ma-services.json` (for MA service picker in notes)
- `POST /api/genz-notes/` → create note
- `PUT /api/genz-notes/?id=...` → update note
- `DELETE /api/genz-notes/?id=...` → delete (author OR `sm_admin`/`dev_sm`)

**Data files read/written:**
- `data/sm/genz_case_notes.json` (**always SM** — hard-coded, not per-team)
- `data/sm/ma-services.json` (SM-shared, read-only)

---

## genz-hub.html — GenZ Hub

**Role:** SM team + `is_genz` flag  
**Client guard:** `u.team !== 'sm' || !u.is_genz` → redirect

**API calls:**
- `GET /api/genz-notes/` → `data/sm/genz_case_notes.json`
- `GET /api/genz-team/index.php` → `data/users.json` filtered to `is_genz=true`

**Data files read:**
- `data/sm/genz_case_notes.json`
- `data/users.json` (global)

---

## onboarding.html — New User Onboarding

**Role:** all authenticated

**API calls:**
- `GET /api/onboarding/config.php` → `data/{team}/onboarding/config.json`
- `GET /api/onboarding/progress.php` → `data/{team}/onboarding/progress/<user_id>.json`
- `GET /api/onboarding/list-pdfs.php` → uploaded PDF attachments
- `POST /api/onboarding/progress.php?action=toggle_task` → toggle task complete
- `POST /api/onboarding/progress.php?action=notebook` → save chapter notes
- `POST /api/onboarding/progress.php?action=quiz` → save quiz answer
- `POST /api/onboarding/progress.php?action=exam_submit` → submit scored quiz
- `POST /api/onboarding/progress.php?action=finish` → mark onboarding complete

**Data files read/written:**
- `data/{team}/onboarding/config.json` (read)
- `data/{team}/onboarding/progress/<user_id>.json` (read + **written** per action)

---

## sabai.html — SABai AI Assistant

**Role:** all authenticated

**API calls:** **NONE** — this is a landing/info page only

All "Open SABai" buttons link to **Google NotebookLM** externally:  
`https://notebooklm.google.com/notebook/fb9a0f5f-17a4-4371-97bf-d63c8b066e10`

**External:** Google NotebookLM (no SOM API involved)

> The internal Ollama-backed `POST /api/ai/index.php` exists in the codebase but is **not wired to sabai.html**. The `api.ai.chat()` namespace in `api.js` is available for future use.

---

## Data File Summary

| Page | Per-team files | SM-shared files | Global | External |
|------|---------------|-----------------|--------|---------|
| ma-status.html | ma-status-cache.json, ma-status-jenkins.json, ma-status-hidden.json | ma-services.json, jenkins_servers.json | — | NANO CDN, Jenkins, ACM Backoffice |
| ma-services.html | cutoff-services.json | ma-services.json, ma-modules.json, jenkins_servers.json | — | ACM Backoffice, Jenkins |
| ma-test.html | ma-test-plans-YYYY-MM.json, ma-test-results-YYYY-MM.json | — | — | — |
| ma-planwork.html | — | ma-services.json | — | Jira Cloud |
| batch-monitor.html | batch-records-YYYY-MM.json, batch_meta.json, holidays.json | jenkins_servers.json | — | Jenkins, Jira |
| batch-monitor-v2.html | batch-records-YYYY-MM.json, batch_meta.json (+ dependencies) | jenkins_servers.json | — | Jenkins, Jira |
| batch-file-search.html | batch-file-index.json | — | — | — |
| learn.html | courses/courses.json, courses/page-config.json, exams/exams.json, onboarding/progress/\<uid\>.json | — | — | — |
| learn-course.html | courses/courses.json, courses/\<id\>/phases.json | — | — | — |
| learn-phase.html | courses/\<id\>/phases.json, lessons.json, quizzes.json, courses/progress.json | — | — | — |
| exam.html | exams/exams.json, exams/\<id\>/questions.json, exams/attempts.json, exams/\<id\>/events.json | — | — | — |
| knowledge-base.html | knowledge-base.json | — | — | — |
| ops-runbook.html | ops_runbook.json | — | — | — |
| genz-notes.html | — | genz_case_notes.json, ma-services.json | — | — |
| genz-hub.html | — | genz_case_notes.json | users.json | — |
| onboarding.html | onboarding/config.json, onboarding/progress/\<uid\>.json | — | — | — |
| sabai.html | — | — | — | Google NotebookLM |


## ma-status.html

**Role:** All authenticated users (admin sees additional controls)

**API endpoints:**
| Method | Path | หน้าที่ |
|--------|------|---------|
| GET | `/api/ma-status/?[source=all\|nano\|tmn_jenkins\|tmn_backoffice][&refresh=1]` | ดึง live MA status ทุก source |
| GET | `/api/ma-status/hidden.php` | ดึง ignore list (admin) |
| PUT | `/api/ma-status/hidden.php` | อัปเดต ignore list (admin) |
| GET | `/api/ma-status/jenkins-jobs.php` | ดึง Jenkins job list (admin) |
| PUT | `/api/ma-status/jenkins-jobs.php` | อัปเดต Jenkins job list (admin) |
| POST | `/api/ma-status/mapping.php` | Link/unlink backoffice use_case_id (SM admin) |

**Data files:**
- `data/{team}/ma-status-cache.json` — cache TTL 15s
- `data/{team}/ma-status-hidden.json` — ignore list
- `data/{team}/ma-status-jenkins.json` — Jenkins job override list
- `data/shared/ma-services.json` — service catalog (SM-shared, read)
- `data/shared/jenkins_servers.json` — Jenkins server configs (read)
- `data/shared/backoffice-token.json` — Keycloak token cache (60s safety margin)

**External services:**
- NANO CDN: `https://cdn-loan-product.ascendnano.com/products.json` (public, no auth)
- TMN-OPS Jenkins: Basic auth (`auth_user:auth_token` from jenkins_servers.json, server display=`TMN-OPS`)
- ACM Backoffice: Keycloak password grant → Bearer token → `GET {BACKOFFICE_GATEWAY_URL}/acm-backoffice-api-gateway/ops-service-maintenance-server/config/use-cases/search?pageSize=500`
- Auto-refresh every 30s (pauses when tab hidden via Page Visibility API)

---

## ma-services.html

**Role:** All authenticated users (lead/admin สำหรับ write)

**API endpoints:**
| Method | Path | หน้าที่ |
|--------|------|---------|
| GET | `/api/ma-modules/config.php` | ดึง module config |
| GET | `/api/ma-services/list.php` | ดึง service catalog ทั้งหมด |
| POST | `/api/ma-services/create.php` | สร้าง service ใหม่ |
| POST | `/api/ma-services/update.php` | อัปเดต service |
| POST | `/api/ma-services/delete.php` | ลบ service |
| GET | `/api/cutoff-services/list.php` | ดึง cutoff services |
| POST | `/api/cutoff-services/delete.php` | ลบ cutoff service |
| GET | `/api/ma-services/jenkins-params.php?service_id={id}` | ดึง Jenkins job params สำหรับ service |
| POST | `/api/ma-services/jenkins-trigger.php` | Trigger Jenkins job |
| GET | `/api/ma-services/jenkins-status.php?...` | Poll Jenkins build status |
| GET | `/api/ma-services/backoffice-get.php?use_case_id={id}` | ดึง backoffice config |
| POST | `/api/ma-services/backoffice-save.php` | บันทึก backoffice config |
| POST | `/api/ma-services/backoffice-toggle.php` | Toggle maintenance ผ่าน backoffice |
| GET | `/api/ma-status/?source=tmn_backoffice` | ดึง live backoffice status |
| GET | `/api/jenkins-proxy/index.php?list=1` | ดึง Jenkins server list |
| POST | `/api/log/create.php` | บันทึก activity log |

**Data files:**
- `data/{team}/ma-services.json` — service catalog (read/write)
- `data/{team}/cutoff-services.json` — cutoff times (read/write)
- `data/shared/jenkins_servers.json` — Jenkins configs (read)
- `data/shared/backoffice-token.json` — Keycloak token cache (read)

**External services:**
- Jenkins (trigger + status poll) via `/api/jenkins-proxy/`
- ACM Backoffice API via Keycloak token (backoffice-get/save/toggle)

---

## ma-test.html

**Role:** All authenticated users; admin สำหรับ catalog/plan management

**API endpoints:**
| Method | Path | หน้าที่ |
|--------|------|---------|
| GET | `/api/ma-test/catalog.php[?id=...]` | ดึง test catalog |
| POST | `/api/ma-test/catalog.php` | สร้าง catalog entry |
| PUT | `/api/ma-test/catalog.php?id={id}` | อัปเดต catalog entry |
| DELETE | `/api/ma-test/catalog.php?id={id}[&hard=1]` | ลบ catalog entry |
| POST | `/api/ma-test/catalog-import.php` | Import CSV |
| POST | `/api/ma-test/catalog-import.php?bootstrap=1` | Bootstrap import จาก ma-services |
| GET | `/api/ma-test/plans.php?months=1` | ดึง month list |
| GET | `/api/ma-test/plans.php?month={YYYY-MM}` | ดึง plan สำหรับเดือน |
| POST | `/api/ma-test/plans.php?month={YYYY-MM}` | เพิ่ม items เข้า plan |
| DELETE | `/api/ma-test/plans.php?month={YYYY-MM}&id={id}` | ลบ item จาก plan |
| GET | `/api/ma-test/results.php?month={YYYY-MM}[&plan_id=...]` | ดึง test results |
| POST | `/api/ma-test/results.php?month={YYYY-MM}` | สร้าง result |
| PUT | `/api/ma-test/results.php?month={YYYY-MM}&id={id}` | อัปเดต result |
| DELETE | `/api/ma-test/results.php?month={YYYY-MM}&id={id}` | ลบ result |
| GET | `/api/ma-test/config.php` | ดึง webhook config |
| POST | `/api/ma-test/config.php` | เพิ่ม webhook |
| PUT | `/api/ma-test/config.php?id={id}` | อัปเดต webhook |
| DELETE | `/api/ma-test/config.php?id={id}` | ลบ webhook |
| POST | `/api/ma-test/notify.php` | ส่ง notification |
| GET | `/api/ma-services/list.php` | ดึง use-case list (for linking) |
| POST | `/api/ma-test/catalog.php?action=auto_link` | Auto-link catalog ↔ use-cases |
| POST | `/api/ma-test/catalog.php?action=bulk_from_usecases` | Bulk create จาก use-cases |
| POST | `/api/upload.php` | Upload screenshot |

**Data files:**
- `data/{team}/ma-test-catalog.json` — catalog entries
- `data/{team}/ma-test-plans-{YYYY-MM}.json` — monthly plans
- `data/{team}/ma-test-results-{YYYY-MM}.json` — monthly results
- `data/{team}/ma-test-config.json` — webhook configs
- `data/{team}/ma-services.json` — read for use-case linking

---

## ma-planwork.html

**Role:** All authenticated users

**API endpoints:**
| Method | Path | หน้าที่ |
|--------|------|---------|
| GET | `/api/ma-services/jira-stats.php?...` | ดึง Jira stats สำหรับ MA planning |

**Data files:**
- `data/{team}/ma-services.json` — read via jira-stats.php
- `data/shared/jira_config.json` — Jira field config (read)

**External services:**
- Jira Cloud API (ผ่าน `api/ma-services/jira-stats.php`)

---

## import-ma.html

**Role:** All authenticated users

**API endpoints:**
| Method | Path | หน้าที่ |
|--------|------|---------|
| POST | `./api/ma-services/import.php` (raw fetch, not via API namespace) | Import MA service data |

**Data files:**
- `data/{team}/ma-services.json` — write

---

## batch-monitor.html

**Role:** All authenticated users (admin สำหรับ batch records management)

**API endpoints:**
| Method | Path | หน้าที่ |
|--------|------|---------|
| GET | `/api/jenkins-proxy/?list=1` | ดึง Jenkins server list |
| GET | `/api/jenkins-proxy/?server={id}&path=...` | Proxy Jenkins job list |
| GET | `/api/jenkins-proxy/?server={id}&path=.../api/json` | Job detail |
| POST | `/api/jenkins-proxy/?action=build` | Trigger Jenkins build |
| GET | `/api/batch-meta/index.php` | ดึง batch metadata |
| POST | `/api/batch-meta/index.php?action=upsert-entry` | บันทึก metadata entry |
| GET | `./api/batch-records-admin.php?action=months` | ดึง month list (raw fetch) |
| GET | `./api/batch-records-admin.php?action=list&month={YYYY-MM}` | ดึง records |
| POST | `./api/batch-records-admin.php?action=edit&month={YYYY-MM}` | แก้ไข record |
| POST | `./api/batch-records-admin.php?action=delete&month={YYYY-MM}` | ลบ record |
| POST | `./api/batch-records-admin.php?action=clear&month={YYYY-MM}` | ล้าง records |
| POST | `./api/batch-records.php?action=submit` | Submit batch daily report |
| GET | `./api/batch-records.php?action=coverage&month={YYYY-MM}` | Coverage calendar |
| GET | `/api/jira/fields.php` (ถ้า batch fields ยังไม่ได้ load) | ดึง Jira custom fields |
| GET | `/api/jira/issue-types.php` (lazy) | ดึง Jira issue types |
| POST | `/api/jira/create.php` | สร้าง Jira ticket จาก batch job |

**Data files:**
- `data/shared/jenkins_servers.json` — read
- `data/{team}/batch_meta.json` — read/write
- `data/{team}/batch-records-{YYYY-MM}.json` — read/write (via batch-records.php)
- `data/{team}/host-cooldown.json` — circuit breaker (read, via Jenkins proxy)

**External services:**
- Jenkins (proxy + build trigger)
- Jira Cloud (create ticket)

---

## batch-monitor-v2.html

**Role:** All authenticated users; admin สำหรับ management

**API endpoints:** (เหมือน batch-monitor.html เกือบทั้งหมด + เพิ่ม)
| Method | Path | หน้าที่ |
|--------|------|---------|
| GET | `/api/batch-deps/index.php` | ดึง batch job dependencies |
| POST | `/api/batch-deps/index.php?action=set` | บันทึก dependency |
| POST | `/api/batch-deps/index.php?action=delete` | ลบ dependency |
| (+ ทุก endpoint จาก batch-monitor.html) | | |

**Data files:**
- เหมือน batch-monitor.html +
- `data/{team}/batch_meta.json` → key `dependencies` (batch-deps ใช้ไฟล์เดียวกัน)

---

## batch-file-search.html

**Role:** All authenticated users

**API endpoints:**
| Method | Path | หน้าที่ |
|--------|------|---------|
| POST | `/api/batch-file-index/lookup.php` | ค้นหาไฟล์จาก index |

**Data files:**
- `data/{team}/batch-file-index.json` — read (ผ่าน lookup.php)

---

## learn.html

**Role:** All authenticated users

**API endpoints:**
| Method | Path | หน้าที่ |
|--------|------|---------|
| GET | `/api/courses/page-config.php` | ดึง page display config |
| GET | `/api/onboarding/progress.php` | ดึง onboarding progress (ถ้าเปิดใช้) |
| GET | `/api/courses/courses.php` | ดึง course list |
| GET | `/api/exams/exams.php` | ดึง exam list |

**Data files:**
- `data/{team}/courses/courses.json` — read
- `data/{team}/courses/progress.json` — read (my progress)
- `data/{team}/exams/exams.json` — read
- `data/{team}/exams/attempts.json` — read (my attempts)
- `data/{team}/onboarding/config.json` — read
- `data/{team}/onboarding/progress.json` — read

---

## learn-course.html

**Role:** All authenticated users

**API endpoints:**
| Method | Path | หน้าที่ |
|--------|------|---------|
| GET | `/api/courses/courses.php?id={id}` | ดึง course detail |
| GET | `/api/courses/phases.php?course_id={id}` | ดึง phases ของ course |

**Data files:**
- `data/{team}/courses/courses.json` — read
- `data/{team}/courses/{course_id}/phases.json` — read
- `data/{team}/courses/progress.json` — read (my progress)

---

## learn-phase.html

**Role:** All authenticated users

**API endpoints:**
| Method | Path | หน้าที่ |
|--------|------|---------|
| GET | `/api/courses/phases.php` | ดึง all phases (สำหรับ navigation) |
| GET | `/api/courses/phases.php?course_id={id}` | ดึง phases ของ course |
| GET | `/api/courses/lessons.php?phase_id={id}` | ดึง lessons ของ phase |
| GET | `/api/courses/courses.php?id={id}` | ดึง course detail |
| GET | `/api/courses/quizzes.php?phase_id={id}` | ดึง quiz ของ phase |
| POST | `/api/courses/complete-phase.php` | Mark phase complete |
| POST | `/api/courses/quizzes.php?action=submit` | Submit quiz answers |

**Data files:**
- `data/{team}/courses/courses.json` — read
- `data/{team}/courses/{course_id}/phases.json` — read
- `data/{team}/courses/{course_id}/lessons.json` — read
- `data/{team}/courses/{course_id}/quizzes.json` — read
- `data/{team}/courses/progress.json` — read/write (complete-phase)

---

## learn-reports.html

**Role:** All authenticated users (admin สำหรับ all-user progress)

**API endpoints:**
| Method | Path | หน้าที่ |
|--------|------|---------|
| GET | `/api/courses/courses.php` | ดึง course list |
| GET | `/api/courses/progress.php?scope=all[&course_id=...]` | ดึง progress ทุก user (admin) |
| GET | `/api/courses/progress.php?user_id={id}` | ดึง progress รายคน |

**Data files:**
- `data/{team}/courses/courses.json` — read
- `data/{team}/courses/progress.json` — read

---

## exam.html

**Role:** All authenticated users

**API endpoints:**
| Method | Path | หน้าที่ |
|--------|------|---------|
| GET | `/api/exams/exams.php?id={id}` | ดึง exam detail (no answers) |
| GET | `/api/onboarding/progress.php` | ดึง course prerequisites status |
| POST | `/api/exams/attempts.php?action=start` | Start/resume attempt |
| POST | `/api/exams/attempts.php?action=submit` | Submit answers + get score |
| POST | `/api/exams/attempts.php?action=heartbeat` | Keepalive (auto-submit check) |
| POST | `/api/exams/attempts.php?action=event` | Log proctoring events (tab_switch, blur, etc.) |

**Data files:**
- `data/{team}/exams/exams.json` — read (exam config)
- `data/{team}/exams/{exam_id}/questions.json` — read (question pool, no answers)
- `data/{team}/exams/attempts.json` — read/write
- `data/{team}/exams/{exam_id}/events.json` — write (audit log)
- `data/{team}/onboarding/progress.json` — read (prerequisite check)
- localStorage: `exam_answers_{attempt_id}` — partial answer save (crash protection)

---

## exam-reports.html

**Role:** All authenticated users (admin สำหรับ all results)

**API endpoints:**
| Method | Path | หน้าที่ |
|--------|------|---------|
| GET | `/api/exams/exams.php` | ดึง exam list |
| GET | `/api/exams/report.php?exam_id={id}` | ดึง result report |

**Data files:**
- `data/{team}/exams/exams.json` — read
- `data/{team}/exams/attempts.json` — read (via report.php)

---

## knowledge-base.html

**Role:** All authenticated users (read) · sm_lead+ สำหรับ write

**API endpoints:**
| Method | Path | หน้าที่ |
|--------|------|---------|
| GET | `/api/knowledge-base/list.php` | ดึง categories + entries ทั้งหมด |
| POST | `/api/knowledge-base/save.php` | สร้าง/อัปเดต entry (`{category, entry_id?, data}`) |
| POST | `/api/knowledge-base/delete.php` | ลบ entry (admin only) |
| POST | `/api/knowledge-base/update-category.php` | แก้ไข category (admin) |
| POST | `/api/knowledge-base/add-category.php` | เพิ่ม category (admin) |

**Data files:**
- `data/{team}/knowledge-base.json` — read/write  
  Structure: `{ categories: [...], entries: { category_id: [...] } }`

---

## ops-runbook.html

**Role:** All authenticated users (read) · sm_lead, sm_admin, dev_sm สำหรับ write

**API endpoints:**
| Method | Path | หน้าที่ |
|--------|------|---------|
| GET | `/api/ops-runbook/index.php` | ดึง sections + columns + rows ทั้งหมด |
| POST | `/api/ops-runbook/index.php` | สร้าง section / column / row (ตาม `?action=`) |
| PUT | `/api/ops-runbook/index.php?id={id}` | อัปเดต item |
| DELETE | `/api/ops-runbook/index.php?id={id}` | ลบ item |

Note: `API.opsRunbook` namespace ไม่ได้นิยามใน api.js — page JS เรียกผ่าน `API.opsRunbook.*` ซึ่งน่าจะถูก extend หลัง load แต่ยังไม่พบ definition ใน codebase (อาจ missing/lazy-added)

**Data files:**
- `data/{team}/ops_runbook.json` — read/write  
  Structure: `{ sections: [{ id, name, icon, order, columns: [...], rows: [...] }] }`

---

## genz-notes.html

**Role:** SM team + `is_genz=true` flag (อ่านจาก users.json live, ไม่จาก JWT)  
sm_admin และ dev_sm เข้าได้แม้ไม่มี is_genz

**API endpoints:**
| Method | Path | หน้าที่ |
|--------|------|---------|
| GET | `/api/genz-notes/index.php` | ดึง notes ทั้งหมด |
| GET | `/api/genz-notes/index.php?id={id}` | ดึง note เดี่ยว |
| POST | `/api/genz-notes/index.php` | สร้าง note |
| PUT | `/api/genz-notes/index.php?id={id}` | อัปเดต note |
| DELETE | `/api/genz-notes/index.php?id={id}` | ลบ note (author หรือ admin) |
| GET | `/api/ma-services/list.php` | ดึง MA services (สำหรับ tag linking) |

**Data files:**
- `data/sm/genz_case_notes.json` — **hard-coded to `sm` team**, ไม่ใช่ multi-team routing  
  อ่าน `users.json` (global) เพื่อตรวจ `is_genz` flag live

---

## genz-hub.html

**Role:** SM team + `is_genz=true` flag

**API endpoints:**
| Method | Path | หน้าที่ |
|--------|------|---------|
| GET | `/api/genz-notes/index.php` | ดึง recent notes (preview) |
| GET | `/api/genz-team/index.php` | ดึง GenZ team member list |

**Data files:**
- `data/sm/genz_case_notes.json` — read
- `data/users.json` (global) — read via genz-team API (filter `is_genz=true`)

---

## onboarding.html

**Role:** All authenticated users

**API endpoints:**
| Method | Path | หน้าที่ |
|--------|------|---------|
| GET | `/api/onboarding/config.php` | ดึง chapter/block definitions |
| GET | `/api/onboarding/progress.php` | ดึง my progress |
| GET | `/api/onboarding/upload.php` | ดึง PDF/media list |
| POST | `/api/onboarding/progress.php?action=toggle_task` | Toggle task |
| POST | `/api/onboarding/progress.php?action=notebook` | Save notebook text |
| POST | `/api/onboarding/progress.php?action=quiz` | Save quiz answer |
| POST | `/api/onboarding/progress.php?action=exam_submit` | Submit scored quiz |
| POST | `/api/onboarding/progress.php?action=finish` | Mark onboarding done |

**Data files:**
- `data/{team}/onboarding/config.json` — read (chapter/task/block definitions)
- `data/{team}/onboarding/progress.json` — read/write (per-user progress, keyed by user_id)

---

## sabai.html

**Role:** All authenticated users

**API endpoints:** ไม่มี (static page)

**External services:**
- Google NotebookLM: `https://notebooklm.google.com/notebook/fb9a0f5f-17a4-4371-97bf-d63c8b066e10`  
  เปิดใน new tab เท่านั้น — ไม่มี API call จาก SOM-Portal ไปยัง AI service โดยตรง

Note: หน้านี้เดิมเชื่อม Ollama API (`api/ai/index.php`) แต่ปัจจุบัน redirect ไป Google NotebookLM แทน

---

## Data File Reference Table

| หน้า | Data files (read) | Data files (write) |
|------|------------------|-------------------|
| ma-status | `ma-status-cache.json`, `ma-services.json`(shared), `jenkins_servers.json`(shared), `ma-status-hidden.json`, `ma-status-jenkins.json` | `ma-status-cache.json`, `ma-status-hidden.json`, `ma-status-jenkins.json` |
| ma-services | `ma-services.json`, `cutoff-services.json`, `jenkins_servers.json`(shared) | `ma-services.json`, `cutoff-services.json` |
| ma-test | `ma-test-catalog.json`, `ma-test-plans-{YYYY-MM}.json`, `ma-test-results-{YYYY-MM}.json`, `ma-services.json` | `ma-test-catalog.json`, `ma-test-plans-{YYYY-MM}.json`, `ma-test-results-{YYYY-MM}.json` |
| ma-planwork | `ma-services.json`, `jira_config.json`(shared) | — |
| import-ma | — | `ma-services.json` |
| batch-monitor | `jenkins_servers.json`(shared), `batch_meta.json`, `batch-records-{YYYY-MM}.json` | `batch_meta.json`, `batch-records-{YYYY-MM}.json` |
| batch-monitor-v2 | เหมือน batch-monitor + `batch_meta.json` (key `dependencies`) | เหมือน batch-monitor |
| batch-file-search | `batch-file-index.json` | — |
| learn | `courses/courses.json`, `courses/progress.json`, `exams/exams.json`, `exams/attempts.json`, `onboarding/config.json`, `onboarding/progress.json` | — |
| learn-course | `courses/courses.json`, `courses/{id}/phases.json`, `courses/progress.json` | — |
| learn-phase | `courses/courses.json`, `courses/{id}/phases.json`, `courses/{id}/lessons.json`, `courses/{id}/quizzes.json`, `courses/progress.json` | `courses/progress.json` |
| learn-reports | `courses/courses.json`, `courses/progress.json` | — |
| exam | `exams/exams.json`, `exams/{id}/questions.json`, `exams/attempts.json`, `onboarding/progress.json` | `exams/attempts.json`, `exams/{id}/events.json` |
| exam-reports | `exams/exams.json`, `exams/attempts.json` | — |
| knowledge-base | `knowledge-base.json` | `knowledge-base.json` |
| ops-runbook | `ops_runbook.json` | `ops_runbook.json` |
| genz-notes | `sm/genz_case_notes.json`, `users.json`(global), `ma-services.json` | `sm/genz_case_notes.json` |
| genz-hub | `sm/genz_case_notes.json`, `users.json`(global) | — |
| onboarding | `onboarding/config.json`, `onboarding/progress.json` | `onboarding/progress.json` |
| sabai | — | — |
