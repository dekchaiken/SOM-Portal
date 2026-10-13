# Part 4 — MA Suite, Batch Monitoring, Knowledge & Learning

> Source-derived API spec. Every endpoint, data file, external call, and business rule extracted from PHP source.

---

## MA Status (`api/ma-status/`)

### Overview

Aggregates live maintenance state from **3 upstream sources** in parallel (curl_multi), joins against `ma-services.json`, and caches the merged result per team.

**Cache:** `data/{team}/ma-status-cache.json` — TTL **15 seconds**. Bypass with `?refresh=1`.

### External Sources

| Key | URL | Auth | Notes |
|-----|-----|------|-------|
| `nano` | `https://cdn-loan-product.ascendnano.com/products.json` | None (public CloudFront) | Optionally cross-checks with NANO-internal Jenkins (server `display=NANO-internal` in `jenkins_servers.json`) for author info |
| `tmn_jenkins` | Per-job path on TMN-OPS Jenkins server (`data/shared/jenkins_servers.json`, `display=TMN-OPS`) | Basic auth: `username:auth_token` from `jenkins_servers.json` | Job list from `data/{team}/ma-status-jenkins.json` override, or `ma_default_jenkins_jobs()` in `_lib.php` |
| `tmn_backoffice` | `GET {BACKOFFICE_GATEWAY_URL}/acm-backoffice-api-gateway/ops-service-maintenance-server/config/use-cases/search?pageSize=500` | Keycloak password grant → Bearer token (cached in `backoffice-token.json`, 60s safety margin) | Token URL: `BACKOFFICE_TOKEN_URL` env or `https://api-backoffice-aaa.truemoney.com/auth/realms/backoffice/protocol/openid-connect/token` |

**Env vars for backoffice:**
```
BACKOFFICE_USERNAME=<service account>
BACKOFFICE_PASSWORD=<password>
BACKOFFICE_CLIENT_ID=backofficeui   (default)
BACKOFFICE_GATEWAY_URL=https://backoffice-gateway.truemoney.com   (default)
BACKOFFICE_TOKEN_URL=https://api-backoffice-aaa.truemoney.com/auth/realms/backoffice/protocol/openid-connect/token   (default)
```

### Default Jenkins Job List (in `_lib.php`)

| Label | Server | Job Path | State Param | On Values |
|-------|--------|----------|-------------|-----------|
| Wallet Login MA | TMN-OPS | `/view/V1%20Maintenance%20page/job/wallet-maintenance_login` | `IS_MAINTENANCE` | `1,true,True` |
| Register SAVING Service | TMN-OPS | `/view/V1%20Maintenance%20page/job/maintenance-register-SAVING-SERVICE` | `IS_MAINTENANCE` | `true,True,1` |
| SAVING Service | TMN-OPS | `/view/V1%20Maintenance%20page/job/maintenance-SAVING-SERVICE` | `IS_MAINTENANCE` | `true,True,1` |
| TMN Mobile Gateway Feature Toggle | TMN-OPS | `/view/Config%20Service/job/acm-tmn-mobile-gateway-feature-toggle` | `enable_feature` | `false,False,0` |

Override list via `PUT /api/ma-status/jenkins-jobs.php` → saved to `data/{team}/ma-status-jenkins.json`.

---

### `GET /api/ma-status/index.php`

```
Auth:    requireAuth() — any authenticated user
Method:  GET
```

**Query params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `source` | string | `all` | Filter: `all \| nano \| tmn_jenkins \| tmn_backoffice` |
| `refresh` | bool | false | `?refresh=1` — bypass 15s cache |

**Response:**
```json
{
  "sources": {
    "nano":           { "ok": true, "fetched_at": "...", "items": [{"name":"...", "label":"...", "type":"...", "status":"open|closed|unknown", "updated_at":"...", "link":"..."}] },
    "tmn_jenkins":    { "ok": true, "fetched_at": "...", "items": [...] },
    "tmn_backoffice": { "ok": true, "fetched_at": "...", "items": [...] }
  },
  "services": [
    { "id":"...", "service_name":"...", "service_type":"...", "tool_type":"...",
      "matched": true, "status": "open|closed|unknown",
      "source": "nano|tmn_jenkins|tmn_backoffice",
      "upstream_ref": "...", "updated_at": "...", "url": "..." }
  ],
  "unmapped_backoffice": [...]
}
```

**Data files:** reads `ma-status-cache.json`, `ma-services.json`, `jenkins_servers.json`, `ma-status-hidden.json`, `ma-status-jenkins.json`

---

### `GET/PUT /api/ma-status/hidden.php` (Admin)

Manage ignore list — items whose stable key is in the list are filtered from the dashboard.

```
Auth:  requireRole(ADMIN_ROLES)
```

| Source | Stable key used |
|--------|----------------|
| `nano` | `item.name` (e.g. `PAYNEXTEXTRA:payment`) |
| `tmn_jenkins` | `item.name` (job path) |
| `tmn_features` | feature name |
| `tmn_backoffice` | `use_case_id` (int) |

**GET response / PUT body:**
```json
{ "nano": [], "tmn_jenkins": [], "tmn_features": [], "tmn_backoffice": [] }
```

Side effect on PUT: `writeJson('ma-status-cache.json', [])` — invalidates cache.

**Data file:** `data/{team}/ma-status-hidden.json`

---

### `GET/PUT /api/ma-status/jenkins-jobs.php` (Admin)

Manage the Jenkins job list for MA Status polling.

```
Auth:  requireRole(ADMIN_ROLES)
```

**GET response:**
```json
{ "jobs": [...], "source": "default|override" }
```

**PUT body:**
```json
{ "jobs": [{ "label":"...", "server":"TMN-OPS", "path":"/view/…/job/xxx", "state_param":"IS_MAINTENANCE", "on_values":["1","true"] }] }
```

Empty `jobs` array resets to defaults. Side effect: invalidates `ma-status-cache.json`.

**Data file:** `data/{team}/ma-status-jenkins.json`

---

### `POST /api/ma-status/mapping.php` (Admin — SM only)

Link/unlink a `ma-services.json` row to a backoffice `use_case_id`.

```
Auth:  requireRole(ADMIN_ROLES) + requireSmForShared()
Method: POST
```

**Body:**
```json
{ "service_id": "srv_xxx", "use_case_id": 1234 }
// use_case_id: null = unlink
```

**Data file:** `data/shared/ma-services.json`  
Side effect: `writeJson('ma-status-cache.json', [])` — cache invalidated.

---

## Batch Records (`api/batch-records.php`)

### Endpoints

#### `GET /api/batch-records.php?action=months`
Returns list of months that have batch records.
```
Auth:  None required
Response: ["2026-04", "2026-05", "2026-09"]
```

---

#### `POST /api/batch-records.php?action=submit`
Submit a batch daily report.

```
Auth:  requireAuth() + requireCsrf()
Method: POST
```

**Body:**
```json
{
  "timestamp": "2026-09-30T07:00:00+07:00",
  "reporter": "Warapon",
  "server": "BatchServer-01",
  "jobs": [
    { "name": "PaymentBatch", "status": "SUCCESS", "duration": 1800 }
  ],
  "backfill": false
}
```

`backfill: true` requires `requireSmCoverageAdmin()` — adds `backfilled`, `backfilled_at`, `backfilled_by` fields.

**Response:** `{ "id": "br_xxx", "month": "2026-09" }`

**Data file:** `data/{team}/batch-records-YYYY-MM.json` (monthly files, e.g. `batch-records-2026-09.json`)

**Activity log:** `batch_report_submitted`

---

#### `GET /api/batch-records.php?action=list&month=YYYY-MM`
List records for a month.

```
Auth:  requireAuth() + requirePagePermission('batch-monitor')
```

**Response:** Array of records, sorted by timestamp desc.

---

#### `GET /api/batch-records.php?action=coverage&month=YYYY-MM`
Per-day submission status for a month. Used to highlight missing days.

```
Auth:  requireAuth() + requirePagePermission('batch-monitor') + requireSmCoverageAdmin()
```

Expected server set = union across target month + 2 prior months.
Holiday data from `data/{team}/holidays.json`.

**Response:**
```json
{
  "month": "2026-09",
  "today": "2026-09-30",
  "expected_servers": ["BatchServer-01", "BatchServer-02"],
  "days": [
    {
      "date": "2026-09-01",
      "weekday": "Tue",
      "dow": 2,
      "is_weekend": false,
      "holiday": null,
      "future": false,
      "submitted_servers": ["BatchServer-01"],
      "missing_servers": ["BatchServer-02"],
      "records": 1,
      "backfilled": 0,
      "status": "partial"
    }
  ],
  "summary": { "ok": 15, "partial": 5, "missing": 3, "future": 7 }
}
```

Day status values: `ok | partial | missing | future`

---

## Batch Meta (`api/batch-meta/index.php`)

Stores batch job configurations and metadata (schedule, owner, SLA, Sheet sync).

### `GET /api/batch-meta/`

```
Auth:  requireAuth()
```

**Response:**
```json
{
  "configs": [
    { "id": "cfg_xxx", "name": "...", "last_synced": "...", "entry_count": 42 }
  ],
  "entries": [
    { "id": "...", "name": "PaymentBatch", "url": "https://jenkins/job/...", "schedule": "0 5 * * *", "owner": "..." }
  ],
  "dependencies": { "PaymentBatch": { "upstream": [], "downstream": ["ReportBatch"] } }
}
```

**Data file:** `data/{team}/batch_meta.json`

---

### `POST /api/batch-meta/?action=fetch-sheet`

Proxy-fetch first N rows from a Google Sheets CSV (for config preview).

```
Auth:  requireAuth()
Body:  { "sheet_id": "...", "gid": "...", "max_rows": 5 }
```

Tries `gviz?tqx=out:csv` first, falls back to `/export?format=csv`.

---

### `POST /api/batch-meta/?action=sync-entries&id=<cfg_id>`

Accept pre-parsed entries from browser and save to `batch_meta.json`.

```
Auth:  requireRole(ADMIN_ROLES) + requireCsrf()
Body:  { "entries": [...] }
```

---

## Batch File Index (`api/batch-file-index/`)

File search index for batch output files.

| File | Method | Description |
|------|--------|-------------|
| `index.php` | GET | List indexed files; POST to add entries |
| `crawl.php` | POST | Admin: crawl and index new files |
| `lookup.php` | GET `?name=...` | Lookup a file by name |
| `index_logs.php` | GET | Show crawl logs |

```
Auth:  requireAuth() (read) / requireRole(ADMIN_ROLES) (write)
Data file: data/{team}/batch-file-index.json
```

---

## Batch Dependencies (`api/batch-deps/index.php`)

User-defined upstream/downstream links between batch jobs. Stored inside `batch_meta.json` under `dependencies` key.

### `GET /api/batch-deps/`
```
Auth:  requireAuth()
Response: { "entries": { "PaymentBatch": { "upstream": [], "downstream": ["ReportBatch"], "note": "", "updated_at": "...", "updated_by_name": "..." } } }
```

### `POST /api/batch-deps/?action=set`
```
Auth:  requireRole(ADMIN_ROLES) + requireCsrf()
Body:  { "job": "PaymentBatch", "upstream": ["FundBatch"], "downstream": [], "note": "..." }
```

### `POST /api/batch-deps/?action=delete`
```
Auth:  requireRole(ADMIN_ROLES) + requireCsrf()
Body:  { "job": "PaymentBatch" }
```

**Data file:** `data/{team}/batch_meta.json` (key `dependencies`)

---

## Batch Monitor Notifications (`api/batch-monitor-noti/`)

Webhook config per Jenkins server for batch failure alerts.

**Data files:**
- `data/{team}/batch-monitor-noti-config.json` — `{ "servers": { "<serverId>": { "enabled": bool, "webhook_url": "...", "updated_at": "...", "updated_by": "..." } } }`
- `data/{team}/batch-monitor-noti-log.json` — send history
- `data/{team}/batch-monitor-noti-state.json` — per-job last result state (key format: `<serverId>__<jobPath>`)

### `GET /api/batch-monitor-noti/`
```
Auth:  requireRole(ADMIN_ROLES)
Response: {
  servers: [{ id, display, base_url, enabled, webhook_url_masked, state_summary }],
  log: [...recent sends...],
  state_summary: { "<serverId>": { total, statusCounts: {SUCCESS,FAILURE,ABORTED,UNSTABLE}, lastUpdated, jobs: [...] } }
}
```
Webhook URLs are masked: `scheme://host/prefix…suffix?…`

### `PUT /api/batch-monitor-noti/?server=<id>`
```
Auth:  requireRole(ADMIN_ROLES) + requireCsrf()
Body:  { "enabled": true, "webhook_url": "https://chat.googleapis.com/..." }
```

### `DELETE /api/batch-monitor-noti/?server=<id>`
```
Auth:  requireRole(ADMIN_ROLES) + requireCsrf()
```

### `POST /api/batch-monitor-noti/?action=test&server=<id>`
Sends a test Google Chat card. Uses `postToChatThread()` from `restart-monitor/_notify.php`.
```
Auth:  requireRole(ADMIN_ROLES) + requireCsrf()
```

### `tick.php` (cron / internal)
Called periodically. Polls Jenkins via `jenkins-proxy`, compares job results against saved state in `batch-monitor-noti-state.json`, fires webhook on change.

---

## Cutoff Services (`api/cutoff-services/`)

Batch cutoff time registry — services that batch jobs must wait for.

**Data file:** `data/{team}/cutoff-services.json` → `{ "cutoffs": [{ "id": 1, "site_type": "...", "service_name": "...", "cutoff_time": "23:00", "cutoff_day": "D", ... }] }`

| Endpoint | Method | Auth | Notes |
|----------|--------|------|-------|
| `list.php` | GET | requireAuth() | Returns `{ success, data: [...], count }`, sorted by id asc |
| `create.php` | POST | requireAuth() + requireSmForShared() | Required: `site_type, service_name, cutoff_time, cutoff_day` |
| `update.php` | POST | requireAuth() + requireSmForShared() | Body must include `id` |
| `delete.php` | POST/DELETE | requireAuth() + requireSmForShared() | Body: `{ id }` |
| `types.php` | GET | requireAuth() | Returns distinct `site_type` values |
| `import-from-db.php` | POST | requireRole(ADMIN_ROLES) | Bulk import from external DB |

`requireSmForShared()` — writes require SM team membership.

---

## Knowledge Base (`api/knowledge-base/`)

**Data file:** `data/{team}/knowledge-base.json`  
**Schema:**
```json
{
  "categories": [{ "id": "block-biz-rule", "name": "Business Rules", "order": 1 }],
  "entries": {
    "block-biz-rule": [
      { "id": "kb_xxx", "data": { "title": "...", "content": "...", ... }, "created_at": "...", "created_by": "...", "updated_at": "...", "updated_by": "..." }
    ]
  }
}
```

| Endpoint | Method | Auth | Role | Notes |
|----------|--------|------|------|-------|
| `list.php` | GET | requireAuth() | Any | Returns `{ categories, entries }` (all entries by category) |
| `save.php` | POST | requireAuth() | `LEAD_ROLES` | `{ category, entry_id?, data }` — create (no `entry_id`) or update |
| `delete.php` | POST/DELETE | requireAuth() | `ADMIN_ROLES` | `{ category, entry_id }` |
| `add-category.php` | POST | requireAuth() | `ADMIN_ROLES` | `{ id, name, order? }` |
| `delete-category.php` | POST | requireAuth() | `ADMIN_ROLES` | Deletes category + all entries |
| `update-category.php` | POST | requireAuth() | `ADMIN_ROLES` | `{ id, name, order? }` |
| `import.php` | POST | requireAuth() | `ADMIN_ROLES` | Bulk import JSON |
| `clear-all.php` | POST | requireAuth() | `ADMIN_ROLES` | Wipe all data |

---

## Courses (`api/courses/`)

**Storage layout:**
```
data/{team}/courses/
  courses.json                 ← course index (no lessons/quizzes)
  progress.json                ← per-user × phase progress (cross-course)
  <course_id>/phases.json      ← phases for that course
  <course_id>/lessons.json     ← lessons for all phases
  <course_id>/quizzes.json     ← quizzes for all phases
```

**Shared courses:** `shared: true` in `courses.json` → visible to all teams (read their own attempts; only owner team admin can edit).

| Endpoint | Method | Auth | Role | Notes |
|----------|--------|------|------|-------|
| `courses.php` | GET | requireAuth() | Any | List published courses (+ my attempt info); admin sees drafts |
| `courses.php` | GET `?id=...` | requireAuth() | Any | Single course detail |
| `courses.php` | POST | requireAuth() | `ADMIN_ROLES` | Create course |
| `courses.php` | PUT `?id=...` | requireAuth() | `ADMIN_ROLES` | Update course |
| `courses.php` | DELETE `?id=...` | requireAuth() | `ADMIN_ROLES` | Delete course |
| `phases.php` | GET `?course_id=...` | requireAuth() | Any | List phases for a course |
| `phases.php` | POST/PUT/DELETE | requireAuth() | `ADMIN_ROLES` | CRUD phases |
| `lessons.php` | GET/POST/PUT/DELETE | requireAuth() | Various | CRUD lessons |
| `quizzes.php` | GET/POST/PUT/DELETE | requireAuth() | Various | CRUD quizzes |
| `progress.php` | GET | requireAuth() | Any | My progress |
| `complete-phase.php` | POST | requireAuth() | Any | Mark phase complete `{ phase_id, score? }` |
| `page-config.php` | GET/PUT | requireAuth() | Admin (PUT) | Page display config |

---

## Exams (`api/exams/`)

**Storage layout:**
```
data/{team}/exams/
  exams.json            ← exam index (id, title, status, config — NO questions)
  attempts.json         ← all attempt records
  <exam_id>/
    questions.json      ← question pool
    events.json         ← audit log per exam
```

**Shared exams:** same pattern as courses (`shared: true`).

---

### `GET /api/exams/exams.php`

List exams. Non-admin sees only `published`. Admin sees all.

```
Auth:  requireAuth()
Query: ?id=<exam_id>  → single exam detail
       ?action=preset&name=basic|standard|strict|custom  → preset config reference
```

For single exam, non-admin response omits questions (delivered only at attempt start). Includes:
```json
{
  "my_attempts": 2,
  "my_best_score": 75,
  "my_passed": true,
  "questions_count": 25,
  "pool_enabled": false,
  "my_course_locked": false,
  "unmet_course_prereqs": []
}
```

**Exam config presets (`basic | standard | strict`):**

| Config key | basic | standard | strict |
|------------|-------|----------|--------|
| `time_limit.enabled` | false | true (60 min) | true (45 min) |
| `shuffle_questions.enabled` | false | true | true |
| `shuffle_choices.enabled` | false | true | true |
| `attempts.enabled` | false | true (3 max) | true (1 max) |
| `attempts.cooldown_minutes` | 0 | 0 | 1440 (24h) |
| `pool.enabled` | false | false | true |

---

### `POST /api/exams/attempts.php?action=start`

Start or resume an exam attempt.

```
Auth:  requireAuth() + requireCsrf()
Body:  { "exam_id": "exam_xxx" }
```

Pre-flight checks (in order):
1. Exam `status === published` (or admin)
2. Course prerequisite gate (`course_prerequisites` array in exam config)
3. Time window check (if configured)
4. Attempt-count gate (max attempts, cooldown between attempts)
5. Resume in-progress attempt if exists (with server-side time expiry check)

**Response (attempt view):**
```json
{
  "attempt_id": "att_xxx",
  "exam_id": "exam_xxx",
  "status": "in_progress",
  "started_at": "...",
  "deadline_at": "...",
  "questions": [{ "id": "...", "text": "...", "choices": [{"id":"A","text":"..."}] }],
  "choice_orders": { "q_xxx": ["A","C","B","D"] },
  "time_limit_minutes": 30,
  "answers": {}
}
```

Questions are delivered WITHOUT correct answers. `choice_orders` is the per-attempt shuffled order.

Activity logged: `exam_attempt_start`
Exam event appended to `events.json`: type `attempt_start`

---

### `POST /api/exams/attempts.php?action=submit`

Submit answers and get score.

```
Auth:  requireAuth() + requireCsrf()
Body:  { "attempt_id": "att_xxx", "answers": { "q_xxx": "A", ... }, "auto": false, "violations": {...} }
```

**Scoring algorithm:**
1. Load questions for the exam (from `data/{team}/exams/<exam_id>/questions.json`)
2. For each question in the attempt's `question_ids`, check `answers[q_id]` against `correct_choice_id`
3. `score = (correct_count / total_questions) * 100` (integer, rounded)
4. `passed = score >= exam.pass_score` (default `pass_score = 70`)
5. Badge assigned in achievements: `score >= 95 → gold`, `>= 85 → silver`, else `bronze`

**Response:**
```json
{
  "score": 88,
  "passed": true,
  "correct": 22,
  "total": 25,
  "pass_score": 70,
  "answers_review": [{ "q_id": "...", "given": "A", "correct": "A", "is_correct": true, "explain": "..." }]
}
```

Activity logged: `exam_attempt_submit`
Exam event appended: type `attempt_submit`

---

### `POST /api/exams/attempts.php?action=event`

Log a security/proctoring event during an attempt.

```
Body:  { "attempt_id": "att_xxx", "type": "tab_switch|blur|fullscreen_exit|paste|copy", "meta": {} }
```

Increments `violations.<type>` counter in `attempts.json`. Appended to `events.json`.

---

### `POST /api/exams/attempts.php?action=heartbeat`

Keepalive ping. Server checks if time limit expired and auto-submits if so.

```
Body:  { "attempt_id": "att_xxx" }
```

---

### `GET /api/exams/report.php` (Admin)

Exam results report with per-user breakdown.

```
Auth:  requireRole(ADMIN_ROLES) or REPORT_READ_ROLES
Query: ?exam_id=...  → filter by exam
       ?user_id=...  → filter by user
       ?month=YYYY-MM → filter by submission month
```

---

## Achievements (`api/achievements/index.php`)

Aggregates courses + exams + onboarding for a user's gamification summary.

```
Auth:    requireAuth()
Method:  GET
Query:   ?user_id=<uid>  → admin view another user (requireRole ADMIN_ROLES implied)
```

### Scoring / Point System

| Item | Points | Bonus |
|------|--------|-------|
| Onboarding finished | 100 | — |
| Course completed | 50 | +20 (silver), +50 (gold) |
| Exam passed | 30 | +15 (silver), +40 (gold) |

**Badge thresholds:**

| Badge | Course (avg score across phases) | Exam (best score) |
|-------|----------------------------------|-------------------|
| Gold | ≥ 95% | ≥ 95% |
| Silver | ≥ 85% | ≥ 85% |
| Bronze | < 85% (but completed/passed) | < 85% (but passed) |

**Response:**
```json
{
  "stats": {
    "courses_completed": 3,
    "courses_total": 5,
    "exams_passed": 2,
    "exams_taken": 3,
    "total_points": 280,
    "onboarding_done": true
  },
  "courses": [
    { "id":"...", "title":"...", "phases_total": 5, "phases_passed": 5,
      "percent": 100, "completed": true, "completed_at":"...", "avg_score": 92, "badge":"silver" }
  ],
  "exams": [
    { "id":"...", "title":"...", "best_score": 97, "pass_score": 70, "attempts": 2, "passed": true, "passed_at":"...", "badge":"gold" }
  ],
  "onboarding": { "finished": true, "finished_at": "...", "percent": 100, "done": 10 }
}
```

**Data files read:** `courses/courses.json`, `courses/progress.json`, `courses/<id>/phases.json`, `exams/exams.json`, `exams/attempts.json`, `onboarding/config.json`, `onboarding/progress/<uid>.json`

---

## Ops Runbook (`api/ops-runbook/`)

Step-by-step runbooks for common problems.

**Data file:** `data/{team}/ops-runbook.json`

| Endpoint | Method | Role | Notes |
|----------|--------|------|-------|
| `index.php` | GET | Any | List runbooks (optionally `?category=...`, `?q=...` search) |
| `index.php` | GET `?id=...` | Any | Single runbook detail |
| `index.php` | POST | `LEAD_ROLES` | Create runbook `{ title, category, steps: [...], tags: [...] }` |
| `index.php` | PUT `?id=...` | `LEAD_ROLES` | Update |
| `index.php` | DELETE `?id=...` | `ADMIN_ROLES` | Delete |

---

## GenZ Notes (`api/genz-notes/index.php`)

Obsidian-style case notes. **Access: SM team + `is_genz` flag** (or `sm_admin`/`dev_sm`).

`is_genz` is read live from `users.json` — NOT from JWT (avoids requiring re-login when flag is toggled).

**Data file:** `data/sm/genz_case_notes.json` (hard-coded to `sm` team, not multi-team routed)

**Note schema:**
```json
{
  "id": "gzn_xxx",
  "title": "...",
  "category": "general",
  "tags": ["payment", "OOM"],
  "steps": [{ "text": "...", "done": false }],
  "links": [{ "label": "Jira", "url": "https://..." }],
  "teams_custom": ["Payment", "Card"],
  "ma_services": [{ "id": 12, "name": "Wallet Login" }],
  "related": [{ "id": "gzn_yyy", "title": "..." }],
  "created_at": "...",
  "created_by": "...",
  "updated_at": "..."
}
```

**Endpoints (all via `index.php`):**

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/genz-notes/` | List all notes |
| GET | `/api/genz-notes/?id=...` | Single note |
| POST | `/api/genz-notes/` | Create note — all fields validated with `_cleanStr/_cleanTags/_cleanSteps/_cleanLinks` |
| PUT | `/api/genz-notes/?id=...` | Update note |
| DELETE | `/api/genz-notes/?id=...` | Delete — author OR `sm_admin`/`dev_sm` |

**Field constraints:**
- `title`: max 200 chars
- `category`: max 60 chars (free-form)
- `tags`: each max 40 chars
- `steps[].text`: max 400 chars
- `links[].url`: must match `^https?://`
- `teams_custom`: max 20 teams, each max 40 chars

---

## Onboarding (`api/onboarding/`)

Multi-chapter onboarding flow with tasks, notebooks, quizzes (including scored quizzes), and exam integration.

**Data files:**
- `data/{team}/onboarding/config.json` — chapter/task/block definitions
- `data/{team}/onboarding/progress/<user_id>.json` — per-user progress

---

### `GET /api/onboarding/config.php`

```
Auth:  requireAuth()
```

Returns chapters with blocks and tasks. For non-admin: `correct_choice_id` and `explain` are stripped from `scored_quiz` blocks.

**Chapter block types:** `text | tasks | quiz | scored_quiz | embed | checklist`

---

### `PUT /api/onboarding/config.php`

```
Auth:  requireRole(ADMIN_ROLES) + requireCsrf()
Body:  { "version": 1, "intro": {...}, "chapters": [{ "id":"...", "order": 1, "label":"...", "title":"...", "description":"...", "blocks":[...], "tasks":[...] }] }
```

---

### `GET /api/onboarding/progress.php`

```
Auth:  requireAuth()
```

**Response summary includes:**
```json
{
  "user_id": "...",
  "completed_tasks": { "ch1": ["task_a", "task_b"] },
  "notebook": { "ch1": "my notes..." },
  "quizzes": { "ch1": { "block_id::q_id": "my answer" } },
  "exam_results": { "ch1": { "attempts": 2, "best_score": 88, "last_score": 88, "passed": true, "last_attempt_at": "..." } },
  "finished_at": "2026-09-01T...",
  "percent": 100,
  "done": 10,
  "total": 10,
  "chapters": [
    { "id":"ch1", "unlocked": true, "completed": true, "task_count": 3, "done_count": 3, "quiz_total": 2, "quiz_done": 2 }
  ]
}
```

---

### Progress Mutations (POST `/api/onboarding/progress.php?action=...`)

| Action | Body | Notes |
|--------|------|-------|
| `toggle_task` | `{ chapter_id, task_id }` | Toggle task complete/incomplete |
| `notebook` | `{ chapter_id, text }` | Save free-text notebook entry |
| `quiz` | `{ chapter_id, question_id, text }` | Save quiz answer |
| `finish` | — | Mark entire onboarding finished, sets `finished_at` |
| `unfinish` | — | Debug: clear `finished_at` |

Chapter unlock logic is evaluated server-side on each read via `onboardingUnlockMap()`.

---

### `GET /api/onboarding/admin.php` (Admin)

Progress overview for all users.

```
Auth:  requireRole(ADMIN_ROLES)
Response: { users: [{ user_id, name, percent, finished_at, chapters: [...] }] }
```

### `POST /api/onboarding/upload.php`

Upload images/attachments for onboarding content (admin only).

```
Auth:  requireRole(ADMIN_ROLES)
Content-Type: multipart/form-data
```
