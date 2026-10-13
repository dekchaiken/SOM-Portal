# SOM-Portal — Centralize-SOM

> Internal Service Operations Management Dashboard · Ascend/TrueMoney  
> Version: Sep 2026 · Stack: PHP (procedural) + Vanilla JS/HTML + JSON file storage + JWT HS256

---

## สารบัญ

1. [ภาพรวมและ Tech Stack](#1-ภาพรวมและ-tech-stack)
2. [Environment Variables ทั้งหมด](#2-environment-variables-ทั้งหมด)
3. [Architecture & Data Model](#3-architecture--data-model)
4. [Multi-Team System](#4-multi-team-system)
5. [Core Library — `api/helpers.php`](#5-core-library--apihelphp)
6. [Authentication & Users](#6-authentication--users)
7. [Service Board](#7-service-board)
8. [Jira Integration](#8-jira-integration)
9. [Jenkins Integration](#9-jenkins-integration)
10. [Service Performance & Monitoring](#10-service-performance--monitoring)
11. [Log Explorer & OpenSearch](#11-log-explorer--opensearch)
12. [MA (Mobile App) Suite](#12-ma-mobile-app-suite)
13. [Batch Monitoring](#13-batch-monitoring)
14. [Knowledge, Learning & Onboarding](#14-knowledge-learning--onboarding)
15. [Communications (Email, Chat, SMS, Notifications)](#15-communications)
16. [Quick Tools & Utilities](#16-quick-tools--utilities)
17. [System & Admin APIs](#17-system--admin-apis)
18. [Frontend Architecture](#18-frontend-architecture)
19. [Security Model](#19-security-model)
20. [Page Index & Role Access Matrix](#20-page-index--role-access-matrix)

---

## 1. ภาพรวมและ Tech Stack

SOM-Portal รวมงาน operations ประจำวันไว้ในที่เดียว — incident board, Jira ticket, Jenkins pipeline, service performance, batch monitoring, application logs, และ AI assistant

### Roles

| Role | สิทธิ์ |
|------|--------|
| `sm_user` | ดูและใช้งานฟีเจอร์ทั่วไป |
| `sm_lead` | + pin post, อนุมัติ leave, เขียน KB |
| `sm_admin` | + Admin Panel ทั้งหมด (ยกเว้น super-admin pages) |
| `super_admin` | ทุกสิทธิ์ + ข้ามทีม + bypass maintenance |
| `super_viewer` | Read-only ทุกทีม |
| `dev_sm` | Admin สำหรับทีม dev |
| `dev_user` | Read-only service-performance + restart-monitor เท่านั้น |
| `external` | สิทธิ์ตาม `user.permissions[]` explict list |

### Role Constants (ใน `api/helpers.php`)

```
SUPER_ADMIN_ROLE  = 'super_admin'
ADMIN_ROLES       = ['super_admin', 'sm_admin', 'dev_sm']
LEAD_ROLES        = ['super_admin', 'sm_admin', 'dev_sm', 'sm_lead']
ALL_STAFF_ROLES   = ['super_admin', 'super_viewer', 'sm_admin', 'dev_sm', 'sm_lead', 'sm_user', 'dev_user', 'external']
GLOBAL_READ_ROLES = ['super_admin', 'super_viewer']
REPORT_READ_ROLES = ['super_admin', 'sm_admin', 'dev_sm', 'super_viewer']
```

### Tech Stack

| Layer | Stack |
|-------|-------|
| Backend | PHP (procedural, ไม่มี framework) |
| Frontend | Vanilla JS + HTML5 (ไม่มี build step) |
| Storage | JSON files ใน `data/` (ไม่มี database) |
| Auth | JWT HS256 (signed ด้วย `JWT_SECRET`) |
| File locking | `flock(LOCK_EX)` ใน `writeJson()` |
| Hosting | PHP built-in server หรือ Apache/NGINX |
| Icon system | 147 Lucide-style icons (layout.js + MutationObserver) |
| LLM | Ollama (`qwen2.5:7b` default) |

---

## 2. Environment Variables ทั้งหมด

| Variable | Default | Required | ใช้ใน |
|----------|---------|----------|-------|
| `JWT_SECRET` | `FALLBACK_CHANGE_ME...` | **Yes** | Auth ทุก endpoint |
| `JIRA_EMAIL` | — | Yes (Jira) | All Jira REST calls |
| `JIRA_TOKEN` | — | Yes (Jira) | All Jira REST calls |
| `GRAFANA_URL` | `https://grafana-thanos.truemoney.com` | No | Service Performance, Restart Analyzer, Begin-Grafana |
| `GRAFANA_SERVICE_ACCOUNT_TOKEN` | — | No | Grafana API calls |
| `GRAFANA_ORG_ID` | `2` | No | Grafana API calls |
| `GRAFANA_DATASOURCE_UID` | `e4b184ea-3a40-4b6a-b6cb-fa6f2ba17c1e` | No | Prometheus datasource proxy |
| `GRAFANA_BASIC_USER` | — | No (per-source config แนะนำ) | Grafana cross-org basic auth |
| `GRAFANA_BASIC_PASS` | — | No | Grafana cross-org basic auth |
| `OLLAMA_HOST` | `http://localhost:11434` | No | SABai AI (api/ai/) |
| `OLLAMA_MODEL` | `qwen2.5:7b` | No | SABai AI |
| `APP_BASE_URL` | auto-detect จาก HTTP_HOST | No | Email links, password reset URL |
| `BACKOFFICE_USERNAME` | — | No (MA Status) | Keycloak password grant |
| `BACKOFFICE_PASSWORD` | — | No | Keycloak password grant |
| `BACKOFFICE_CLIENT_ID` | `backofficeui` | No | Keycloak |
| `BACKOFFICE_GATEWAY_URL` | `https://backoffice-gateway.truemoney.com` | No | Backoffice API |
| `BACKOFFICE_TOKEN_URL` | `https://api-backoffice-aaa.truemoney.com/auth/realms/backoffice/protocol/openid-connect/token` | No | Keycloak token |
| `RESTART_MONITOR_UPLOAD_TOKEN` | — | No | Cron upload endpoint (shared secret) |

### Hardcoded ใน `api/config.php` (ไม่ได้อ่านจาก .env)

```
JIRA_BASE_URL    = 'https://truemoney.atlassian.net'
JIRA_PROJECT_KEY = 'SMC'
HOST_COOLDOWN_TTL = 30  (วินาที — circuit breaker window)
```

### System Settings (configure ผ่าน Admin > System Settings)

| Key | Default | คำอธิบาย |
|-----|---------|----------|
| `session_timeout_hours` | 8 | JWT expiry (ชั่วโมง) |
| `remember_me_days` | 30 | Remember me expiry |
| `password_expiry_days` | 60 | บังคับเปลี่ยนรหัสทุก N วัน |
| `password_history_count` | 5 | จำรหัสเก่ากี่ครั้ง |
| `max_login_attempts` | 5 | ก่อน lockout |
| `lockout_minutes` | 15 | Lockout duration |
| `api_rate_limit_requests` | 120 | Max req ต่อ window |
| `api_rate_limit_window_seconds` | 60 | Rate limit window |
| `trash_retention_days` | 30 | อายุ soft-deleted posts |

---

## 3. Architecture & Data Model

### Request Flow

```
Browser (*.html)
  → Authorization: Bearer <JWT>   หรือ   X-CSRF-Token: <token>
  → /api/<module>/index.php
    → requireAuth()          ← verify JWT, set $GLOBALS['_current_team']
    → requireRole()          ← check role constant
    → teamDataPath()         ← route to data/<team>/<file>.json
    → readJson() / writeJson()  ← flock(LOCK_EX) on write
    → External APIs (Jira, Jenkins, Grafana, OpenSearch, Ollama)
```

### Data Directory Structure

```
data/
├── users.json                    ← global (ทุกทีม รวมกัน)
├── teams.json                    ← global
├── system-settings.json          ← global
├── rate_limit.json               ← global (login rate limit)
├── api_rate_limit.json           ← global (API rate limit)
├── maintenance.json              ← global
├── host-cooldown.json            ← global (circuit breaker state)
├── dns-overrides.json            ← global (Jenkins DNS override)
├── password_reset_tokens.json    ← global
├── requests.json                 ← global (feature requests)
│
├── sm/                           ← Team "sm" per-team data
│   ├── board.json
│   ├── board-comments.json
│   ├── board_categories.json
│   ├── board_service_types.json
│   ├── stars.json
│   ├── notifications.json
│   ├── presence.json
│   ├── links.json
│   ├── knowledge-base.json
│   ├── ops-runbook.json
│   ├── courses/
│   ├── exams/
│   ├── onboarding/
│   ├── batch-records-YYYY-MM.json
│   ├── batch_meta.json
│   ├── batch-file-index.json
│   ├── batch-monitor-noti-config.json
│   ├── cutoff-services.json
│   ├── uptime.json
│   ├── downstream-health.json
│   ├── analytics_events.json
│   ├── jenkins-build-tools.json
│   ├── jenkins-build-history.json
│   ├── jenkins-build-approvals.json
│   ├── jenkins-portal-tools.json
│   ├── incident-launcher-config.json
│   ├── opensearch_user_creds.json
│   ├── opensearch_saved_searches.json
│   ├── opensearch_saved_folders.json
│   ├── about-page.json
│   ├── genz_case_notes.json
│   ├── holiday-plans.json
│   ├── schedule.json
│   ├── pw_schedule.json
│   ├── weekly-report.json
│   ├── service-severity.json
│   ├── service-inventory/
│   │   └── inventory.csv
│   ├── service-performance/
│   │   └── cache/
│   ├── restart-analyzer/
│   │   └── cache/
│   ├── ma-status-cache.json
│   ├── ma-status-jenkins.json
│   ├── ma-status-hidden.json
│   └── logs/
│       ├── activity.json
│       └── security.json
│
├── shared/                       ← SM-owned, ทุกทีมอ่านได้
│   ├── templates.json            ← Jira templates
│   ├── jira_config.json          ← Custom field mappings
│   ├── jenkins_servers.json      ← Jenkins server configs
│   ├── opensearch_config.json    ← OpenSearch endpoints
│   ├── ma-services.json          ← MA service catalog
│   ├── ma-modules.json           ← MA module registry
│   ├── service-performance-sources.json  ← Grafana runway config
│   ├── grafana-alert-sources.json
│   ├── grafana-sources.json
│   ├── links.json                ← shared sections (monitoring)
│   ├── mail_config.json          ← SMTP settings
│   └── backoffice-token.json     ← Keycloak token cache
│
└── ops/                          ← Team "ops" (same structure as sm/)
    └── ...
```

### SM-Shared Files Pattern

Files ที่ SM เป็นเจ้าของ แต่ทุกทีมอ่านได้ — ตรวจผ่าน `_isSmSharedFile()` + `smSharedFiles()`:

```
ma-services.json, ma-modules.json, cutoff-services.json,
jenkins_jobs_catalog.json, batch_file_index.json,
grafana-alert-sources.json, grafana-runways.json, grafana-monitoring/*,
service-performance-sources.json, service-performance/*,
service-inventory.csv, templates.json, jira_config.json,
pw_schedule.json, pw_schedule_config.json
```

Write access ต้องผ่าน `requireSmForShared()` — blocks ถ้า `current_team !== 'sm'`

---

## 4. Multi-Team System

### Data Routing Logic

```php
teamDataPath('board.json')
// JWT team='sm'  → data/sm/board.json
// JWT team='ops' → data/ops/board.json
// global file    → data/board.json
// sm-shared file → data/sm/board.json  (regardless of current team)
```

**Global files** (route to `data/` root ไม่ว่า team จะเป็นอะไร):
`users.json, teams.json, system-settings.json, rate_limit.json, api_rate_limit.json, maintenance.json, requests.json, password_reset_tokens.json, metrics.json, n8n_oncall_config.json, n8n_severity_config.json`

### JWT Token Structure

```json
{
  "sub": "usr_01HX...",
  "role": "sm_admin",
  "team": "sm",
  "exp": 1234567890,
  "iat": 1234539090,
  "is_genz": false
}
```

### super_admin / super_viewer Team Override

GLOBAL_READ_ROLES (`super_admin`, `super_viewer`) สามารถส่ง header `X-Admin-Team: ops` เพื่อดูข้อมูลทีมอื่น — `requireAuth()` จะ override `_current_team` ตาม header

### New Team Provisioning

```
POST /api/teams/           { slug, name, features }
  → initTeamDirectory(slug)
  → mkdir data/<slug>/
  → สร้าง empty JSON files ตาม features + defaultFeatures()
  → สร้าง logs/ directory + menu-permissions.json

POST /api/teams/copy-config.php   { team_slug, feature, overwrite:false }
  → snapshot copy data/sm/<files> → data/<team>/<files>
  → ห้ามตั้ง team_slug='sm'
```

`teams.json` schema:
```json
{
  "id": "team-uuid",
  "slug": "ops",
  "name": "Ops Team",
  "features": ["board", "ma-services", "batch-monitor"],
  "page_modes": { "jenkins-build": "read" },
  "created_at": "2026-09-01T00:00:00+07:00"
}
```

---

## 5. Core Library — `api/helpers.php`

### Auth Functions

```php
requireAuth(bool $allowExpiredPw=false, bool $allowSuperViewerWrite=false): array
// Returns JWT payload. Sets $GLOBALS['_current_team'].
// GLOBAL_READ_ROLES: override team via X-Admin-Team header.
// super_viewer: blocks non-GET unless $allowSuperViewerWrite=true.
// 403 PASSWORD_EXPIRED (code) if password_expiry_days exceeded.
// 403 MUST_RESET_PASSWORD if flag set.

requireRole(array $payload, array $roles): void
// super_admin always passes. Others: 403 if role not in $roles.

requireCsrf(): void
// POST/PUT/DELETE/PATCH only — via api/security/CsrfProtector.php

requireSmForShared(): void         // 403 if team !== 'sm'
requireSmTeamOnly(string $label)   // Full lockout (read+write) for non-sm

requireTeamFeature(array $payload, string $featureKey): void
// Check teams.json features[]. super_admin bypasses.

requirePageMode(array $payload, string $pageId, string $mode='full'): void
// Check teams.json page_modes. 403 if 'read'.

requirePagePermission(array $payload, string $page): void
// For role='external': check user.permissions[] array.

denySuperViewer(array $payload, string $label): void   // 403 if super_viewer

isSmCoverageAdmin(array $payload): bool
// true if super_admin OR (sm_admin/dev_sm AND team=='sm')

applyExtraPageTeam(array $payload, string $pageKey): void
// Switch _current_team to user.extra_pages[pageKey].source_team
```

### Data Path Functions

```php
teamDataPath(string $file, ?string $team=null): string
// Resolves path based on: global → SM-shared → per-team routing

readJson(string $file): array
// Silent recovery on missing file / JSON parse error → returns []
// Logs parse error to error_log

writeJson(string $file, array $data): bool
// Auto-creates directory.
// fopen('c+') → flock(LOCK_EX) → ftruncate → fwrite
// JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE
```

### Response Functions

```php
respondOk($data=null, string $message='OK'): void
// {success:true, message:"OK", data:$data} + exit

respondError(string $message, int $code=400): void
// {success:false, message:$message} + exit
// code >= 500 also logs to security.json

respond(array $data, int $code=200): void   // raw respond + exit
```

### JWT Functions

```php
jwt_create(array $payload, int $expiry=0): string
// HS256, sets exp=now+JWT_EXPIRY (or $expiry), iat=now

jwt_verify(string $token): ?array
// Returns payload or null. hash_equals() comparison (timing-safe).
```

### Password Functions

```php
hashPassword(string $pw): string
// password_hash(PASSWORD_BCRYPT, cost=10)

verifyPassword(string $pw, string $hash): bool
// Normalizes $2b$ → $2y$ for legacy Python bcrypt hashes

createResetToken(string $userId, int $ttlHours=24): array
// 64-char hex token → data/password_reset_tokens.json
// Invalidates previous unused tokens for same user

verifyResetToken(string $token): ?string    // user_id | null
consumeResetToken(string $token): ?string   // marks used, returns user_id | null
```

### Rate Limiting

```php
// Login rate limit
rl_check(string $username): void   // 429 if blocked
rl_fail(string $username): void    // increment + block if >= RL_MAX_ATTEMPTS (5)
rl_success(string $username): void // reset counter
// State file: data/rate_limit.json, window: RL_WINDOW_SECONDS (900s = 15min)

// API rate limit
apiRateLimit(string $userId, string $group): void
// Key: sha256(userId:group)[0:16]
// 429 + Retry-After header if count >= API_RL_MAX (120) within API_RL_WINDOW (60s)
// State file: data/api_rate_limit.json
// Groups used: 'board', 'comments', 'upload', 'search', 'stars', 'opensearch'
```

### Host Cooldown Circuit Breaker

```php
// TTL = 30 seconds. State file: data/host-cooldown.json (global)

hostCooldownActive(string $host): ?array
// null = no cooldown | {reason, fail_at, expires_at} = in cooldown

hostCooldownMark(string $host, string $reason): void
// Sets fail_at=now. GC entries older than TTL×4.

hostCooldownClear(string $host): void
// Remove entry (ops override after DNS/network fix)

applyDnsOverrides($ch, string $url): void
// Apply CURLOPT_RESOLVE from data/dns-overrides.json + jenkins ip_override
// Used to bypass DNS when Jenkins reachable by IP only (DRP/failover)
```

### Logging

```php
logActivity(string $action, array $detail=[], ?string $userId=null, ?string $userName=null): void
// Writes to data/{team}/logs/activity.json
// Entry: {id, ts, action, user_id, user_name, ip, ua, detail}

logSecurity(string $event, array $detail=[], ...): void
// Writes to data/{team}/logs/security.json (max 2000 entries)
// Also triggered by respondError() for code >= 500

logIntegrationError(string $service, string $endpoint, string $error, array $context=[]): void
// Calls logSecurity('integration_error', ...)
```

### Notification Helper

```php
createNotification($userIds, string $type, string $title, ?string $body=null, array $meta=[]): void
// Appends to notifications.json for each userId
// Entry: {id, user_id, type, title, body, read:false, created_at, ...meta}

createNotificationForAdmins(string $type, string $title, ?string $body, ...): void
// Finds all sm_admin/dev_sm in current team → createNotification
```

### Utility Functions

```php
genId(string $prefix='id'): string       // prefix_<12 hex chars> (random_bytes(6))
getBody(): array                          // json_decode(php://input) ?? []
monthlyFilename(string $prefix): string   // e.g. "batch-records-2026-09.json"
listMonths(string $prefix): array         // sorted months that have files (newest first)
sendGoogleChatCard(array $webhookUrls, array $card): array  // POST JSON card, timeout=10s
```

---

## 6. Authentication & Users

### POST /api/auth/login.php

**Auth:** Public

**Request:**
```json
{
  "username": "string (required)",
  "password": "string (required)",
  "remember_me": "boolean (optional)"
}
```

**Flow:**
1. `rl_check(username)` — 429 ถ้าล็อค
2. Lookup user case-insensitive ใน `data/users.json`
3. `verifyPassword()` — bcrypt, normalize `$2b$→$2y$`
4. ล้มเหลว → `rl_fail()` + logSecurity `login_failed`
5. สำเร็จ → `rl_success()` + ตรวจ `password_expired` + `must_reset_password`
6. สร้าง JWT: expiry = `remember_me ? 30d : 8h`
7. สร้าง CSRF token

**Response (200):**
```json
{
  "success": true,
  "token": "eyJ...",
  "csrf_token": "abc123",
  "user": {
    "id": "usr_01HX...", "name": "Warapon", "username": "warapon",
    "role": "sm_admin", "team": "sm",
    "team_features": ["board", "ma-services"],
    "team_page_modes": { "jenkins-build": "read" },
    "first_login": false, "password_expired": false, "must_reset_password": false,
    "is_genz": false, "avatar_url": "https://..."
  }
}
```

**Errors:** `400` missing fields · `401` invalid credentials · `429` rate limit

---

### POST /api/auth/logout.php

**Auth:** Required (all roles + super_viewer)  
**Action:** Logs `logout` activity. Token revocation is client-side only (delete `som_token` from localStorage — server stateless).

---

### GET /api/auth/me.php

**Auth:** `requireAuth(true)` — allows expired/first_login tokens (password-change gate)

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "usr_01HX...", "name": "Warapon", "username": "warapon",
    "email": "warapon@company.com", "role": "sm_admin",
    "first_login": false, "password_expired": false, "must_reset_password": false,
    "team": "sm", "dev_subteam": null, "is_genz": false,
    "extra_pages": [{ "page": "service-performance", "source_team": "ops" }]
  }
}
```

---

### GET /api/auth/profile.php · PATCH /api/auth/profile.php

**Auth:** Required (all roles + super_viewer)

**PATCH Request Body (all optional):**
```json
{
  "name": "string (1–60 chars)",
  "nickname": "string (max 30)",
  "avatar_url": "data URI (data:image/png;base64,...) or https URL, max ~200KB",
  "email": "valid email, must be unique",
  "name_th": "string (max 80)",
  "emp_id": "string (max 20)",
  "phone": "string (max 20)",
  "tmn_id": "string (max 20)",
  "net_home": "string (max 100)",
  "net_mobile": "string (max 50)"
}
```

---

### POST /api/auth/change-password.php

**Auth:** `requireAuth(true)` — allows expired tokens

**Request:**
```json
{
  "old_password": "string (skip if first_login=true OR must_reset_password=true)",
  "new_password": "string (min 8 chars)",
  "confirm_password": "string"
}
```

**Rules:**
- ห้ามซ้ำกับ current password
- ตรวจ `password_history` (rolling last 5)
- Clears: `first_login`, `password_expired`, `must_reset_password`
- ออก fresh JWT

---

### GET /api/auth/my-activity.php

**Query:** `?limit=20&offset=0` (limit capped at 1000)  
**Data:** `data/<team>/logs/activity.json` — filter by `user_id === JWT.sub`

---

### User Object Schema

```json
{
  "id": "usr_01HX...",
  "name": "Warapon Lea",
  "nickname": "War",
  "username": "warapon",
  "email": "warapon@company.com",
  "role": "sm_admin",
  "team": "sm",
  "password": "$2y$10$... (bcrypt, ไม่ return ให้ client)",
  "password_history": ["$2y$...", "..."],
  "password_changed_at": "2026-09-01T00:00:00+07:00",
  "first_login": false,
  "password_expired": false,
  "must_reset_password": false,
  "created_at": "2026-01-01T00:00:00+07:00",
  "created_by": "usr_...",
  "avatar_url": "https://...",
  "permissions": ["page_slug"],
  "schedule_include": true,
  "course_include": true,
  "exam_include": true,
  "dev_subteam": null,
  "is_genz": false,
  "name_th": "วรพล เลา",
  "emp_id": "EMP001",
  "phone": "0812345678",
  "tmn_id": "tmn.warapon",
  "net_home": "192.168.1.0/24",
  "net_mobile": "10.0.0.0/8",
  "extra_pages": [{ "page": "service-performance", "source_team": "ops" }]
}
```

---

### GET /api/users/

**Query:** `?team=<slug>` (super_admin: any team · sm_admin: own team only, `?team=dev` allowed)

**Response by role:**

| Role | ได้ข้อมูล |
|------|-----------|
| `super_admin` / `super_viewer` | All users (filtered by `?team=` or `X-Admin-Team` header). Full profile. |
| `sm_admin` / `dev_sm` | Own team only (+ `?team=dev`). Full profile. |
| `sm_user` / `sm_lead` / `external` | Own team, `schedule_include=true` only. Limited fields: `id, name, nickname, role` only. |

---

### POST /api/users/ (Create)

**Auth:** ADMIN_ROLES + CSRF

**Request:**
```json
{
  "name": "string (required)",
  "username": "string (required, unique case-insensitive)",
  "email": "string (required, valid email — temp password sent here)",
  "role": "sm_user | sm_lead | sm_admin | dev_sm | external | super_viewer | dev_user",
  "team": "string (required for super_admin; sm_admin locked to own team)",
  "nickname": "string", "dev_subteam": "string (dev_user only)",
  "permissions": ["page_slug"], "schedule_include": true,
  "name_th": "string", "emp_id": "string", "phone": "string",
  "tmn_id": "string", "net_home": "string", "net_mobile": "string"
}
```

**Logic:**
- Temp password: `SOM_` + 6 random uppercase alphanumeric chars
- ส่ง welcome email **ก่อน** write user (SMTP failure = abort creation)
- `dev_user` role → team force `"dev"`
- Error codes: `SMTP_NOT_CONFIGURED` (400) · `SMTP_SEND_FAILED` (500)

---

### PUT /api/users/?id={id} · DELETE /api/users/?id={id}

**Auth:** ADMIN_ROLES + CSRF  
**PUT:** Update fields (all optional) — ห้ามเปลี่ยน own role  
**DELETE:** ลบถาวร ห้ามลบตัวเอง  
**PATCH /api/users/?id={id}:** Admin-triggered password reset — ส่ง email link (24h token)

---

## 7. Service Board

**Data files:** `board.json`, `stars.json`, `notifications.json`, `board_categories.json`, `board_service_types.json`  
**Permission gate:** `requirePagePermission($payload, 'board')`  
**Rate limit:** group `board`

### Post Object Schema

```json
{
  "id": "post_01HX...",
  "title": "string (max 300)",
  "content": "string (max 20,000)",
  "mentions": [{ "id": "usr_... | __all__", "name": "Alice" }],
  "status": "open | in_progress | resolved",
  "image_url": "string | null",
  "board_type": "bcat_01HX...",
  "board_type_name": "Incident",
  "service_type_id": "bst_01HX...",
  "service_type_name": "Payment",
  "service_subtype_id": "bsst_01HX...",
  "service_subtype_name": "Settlement",
  "pinned": false,
  "edit_history": [
    { "edited_at": "...", "editor_id": "...", "editor_name": "...",
      "old_title": "...", "old_content": "...", "old_status": "open" }
  ],
  "author_id": "usr_...", "author_name": "Warapon", "author_role": "sm_admin",
  "created_at": "2026-09-30T10:00:00+07:00",
  "updated_at": "2026-09-30T10:00:00+07:00",
  "deleted_at": null, "deleted_by": null, "deleted_by_name": null,
  "starred": false
}
```

---

### GET /api/board/

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `search` | string | — | Full-text: title + content + author_name (logs `board_search`) |
| `board_type` | string | — | Filter by category ID |
| `status` | string | — | `open` / `in_progress` / `resolved` |
| `author_id` | string | — | Filter by author |
| `starred` | any | — | Return only starred posts of current user |
| `since` | ISO datetime | — | **Poll mode:** return only posts created after timestamp (skips other filters) |
| `limit` | int | 12 | 1–50 |
| `offset` | int | 0 | Pagination |

**Sort:** pinned first → `created_at` desc  
**Special `?since=` response:** `{ "count": N, "posts": [...] }`

---

### POST /api/board/ (Create)

**Auth:** Required + page permission + CSRF  
**Request Body:**
```json
{
  "title": "string (required, max 300)",
  "content": "string (optional, max 20,000)",
  "mentions": [{ "id": "usr_... | __all__", "name": "Alice" }],
  "status": "open | in_progress | resolved (default: open)",
  "image_url": "string | null",
  "board_type": "category ID",
  "board_type_name": "string",
  "service_type_id": "string", "service_type_name": "string",
  "service_subtype_id": "string", "service_subtype_name": "string"
}
```

**Side effects:** Creates `mention` notifications for @mentioned users (`__all__` expands to all users)

---

### PUT /api/board/?id={id}

**Permission:** Author OR LEAD_ROLES  
**Side effects:** Snapshots to `edit_history` (max 20) · `board_status_change` activity log if status changes

---

### PATCH /api/board/?id={id}

**Permission:** LEAD_ROLES only  
**Action:** Toggle `pinned`

---

### DELETE /api/board/?id={id}

**Permission:** Author OR LEAD_ROLES  
**Action:** Soft-delete (sets `deleted_at`, `deleted_by`, `deleted_by_name`)  
**Hard-delete:** Admin via `admin/board.html` + `admin/trash.html`

---

### Board Comments (`/api/board-comments/`)

**Data files:** `board-comments.json`, `notifications.json`  
**Rate limit:** group `comments`

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/board-comments/?post_id={id}` | GET | Required | All comments for post (asc by created_at) |
| `/api/board-comments/?counts={id1,id2}` | GET | Required | Batch comment count for multiple posts |
| `/api/board-comments/` | POST | Required + CSRF | Create comment (max 5,000 chars) |
| `/api/board-comments/?id={id}` | PATCH | Required + CSRF | Edit (author only) |
| `/api/board-comments/?id={id}` | DELETE | Required + CSRF | Soft-delete (author OR LEAD_ROLES) |

**POST side effects:** `mention` notifications + `comment` notification to post author

---

### Board Config (`/api/board-config/`)

**Data files:** `board_categories.json`, `board_service_types.json`

| Method | Query | Role | Action |
|--------|-------|------|--------|
| GET | — | any auth | Return categories + service_types (3-level tree) |
| POST | `?kind=category` | LEAD_ROLES | Add board tab/category |
| POST | `?kind=service_type` | any auth | Add top-level service type |
| POST | `?kind=subtype&parent={id}` | any auth | Add subtype |
| PUT | `?id={id}` | LEAD_ROLES | Rename any item |
| DELETE | `?id={id}` | LEAD_ROLES | Delete item |

---

### Stars (`/api/stars/`)

**Data file:** `stars.json`  
**Rate limit:** group `stars`

| Method | Description |
|--------|-------------|
| GET | Array of post IDs starred by current user |
| POST `{post_id}` | Star (idempotent) |
| DELETE `?post_id={id}` | Unstar (current user only) |

---

## 8. Jira Integration

### Constants
```
JIRA_BASE_URL    = 'https://truemoney.atlassian.net'
JIRA_PROJECT_KEY = 'SMC'
Auth header      = 'Authorization: Basic ' + base64(JIRA_EMAIL:JIRA_TOKEN)
Timeout          = 15s
```

### POST /api/jira/create.php (Create Issue)

**Auth:** any authenticated user

**Request:**
```json
{
  "summary": "string (required)",
  "description": "string — converted to ADF on server",
  "fields": {
    "issuetype": "Bug | Task | Story | ...",
    "customfield_17026": "2026-09-30T10:00:00.000+0700 | 'auto'",
    "customfield_17031": "string (select)",
    "customfield_17016": "string (select)",
    "customfield_17238": "string (select)",
    "customfield_17066": "string (comma-separated → array)",
    "customfield_17058": {"value": "...", "child": {}}
  }
}
```

**Field type mapping (from `jira_config.json`):**

| `field_type` | Jira payload format |
|---|---|
| `text` | `"plain string"` |
| `select` | `{"value": "..."}` |
| `array` | `[{"value": "..."}, ...]` (comma-split) |
| `fault_start` | ISO-8601 datetime (`auto` → fills `now`) |

**External call:** `POST https://truemoney.atlassian.net/rest/api/3/issue`

**Response (201):**
```json
{ "success": true, "data": { "issue_key": "SMC-123", "issue_url": "https://truemoney.atlassian.net/browse/SMC-123" } }
```

---

### GET /api/jira/issue-types.php

Calls: `GET {JIRA_BASE_URL}/rest/api/3/issue/createmeta?projectKeys=SMC`

---

### GET /api/jira/fields.php

Calls: `GET {JIRA_BASE_URL}/rest/api/3/field` — returns custom fields only

---

### GET /api/jira/issue-detail.php?key=SMC-123

**Auth:** ALL_STAFF_ROLES

Calls in parallel:
1. `GET {JIRA_BASE_URL}/rest/api/3/issue/SMC-123?fields=*all&expand=renderedFields,names`
2. `GET {JIRA_BASE_URL}/rest/api/3/issue/SMC-123/transitions`

---

### POST /api/jira/transition.php

**Request:** `{ "key": "SMC-123", "transitionId": "31", "fields": { "comment": "text" } }`  
**External:** `POST {JIRA_BASE_URL}/rest/api/3/issue/{key}/transitions` → 204

**Error 422 (missing fields):** `{ "missingFields": ["Fault End"], "code": "MISSING_FIELDS" }`

---

### POST /api/jira/assign.php

**Request:** `{ "key": "SMC-123", "accountId": "abc123..." }`  (`null` = unassign)  
**External:** `PUT {JIRA_BASE_URL}/rest/api/3/issue/{key}/assignee` → 204

---

### POST /api/jira/add-comment.php

**Request:** `{ "key": "SMC-123", "body": "plain text (newline = ADF paragraph)" }`  
**External:** `POST {JIRA_BASE_URL}/rest/api/3/issue/{key}/comment` → 201

---

### Jira Requests Inbox (`/api/jira-requests/`)

**Auth:** SM team OR specific roles  
**JQL:** `project = SMC AND issuetype = "Requests SOM Portal" ORDER BY created DESC` (max 50)

| Action (`?action=`) | Method | Description |
|---------------------|--------|-------------|
| `list` (default) | GET | JQL search |
| `detail` | GET `?key=SMC-xxx` | Full issue + transitions |
| `assign` | POST `{key}` | Assign to self (owner only) |
| `transition` | POST `{key, transitionId}` | Change status (owner only) |
| `comment` | POST `{key, text}` | Add ADF comment (owner only) |

**Owner:** `INBOX_OWNER = 'warapon.lea'` (username must match JWT)

---

### Jira Config (`/api/jira-config/`)

**Data:** SM-shared `data/sm/jira_config.json`

```json
{
  "categories": [{ "id": "c_xxx", "name": "Incident" }],
  "issue_types": [{ "id": "it_xxx", "name": "Bug" }],
  "custom_fields": [
    { "id": "cf_xxx", "field_id": "customfield_17026", "label": "Fault Start",
      "placeholder": "auto", "field_type": "fault_start | text | select | array",
      "enabled": true, "order": 1 }
  ]
}
```

| Method | Auth | Action |
|--------|------|--------|
| GET | any | Return full config |
| POST | `requireSmForShared()` + LEAD_ROLES | Add item |
| PUT `?id=xxx` | Same | Update |
| DELETE `?id=xxx` | Same | Delete |

---

### Jira Templates (`/api/templates/`)

**Data:** SM-shared `data/sm/templates.json`  
**Feature gate:** teams need `jira-templates` or `jira-templates-shared` in `teams.json`

```json
{
  "id": "tpl_xxx", "name": "Production Incident", "category": "Incident",
  "service_type_id": "...", "service_subtype_id": "...",
  "summary": "[INCIDENT] {service_name}",
  "fields": { "issuetype": "Bug", "customfield_17026": "auto" },
  "created_at": "...", "created_by": "user-uuid", "author_name": "John"
}
```

| Method | Auth | Action |
|--------|------|--------|
| GET | any | List all templates (desc by created_at) |
| POST | `requireSmForShared()` + CSRF | Create |
| PUT `?id=xxx` | Same | Update |
| DELETE `?id=xxx` | Same + LEAD_ROLES | Delete |

---

### Jira REST Paths Summary

| Use | Path | Method |
|-----|------|--------|
| Create issue | `/rest/api/3/issue` | POST |
| Issue detail | `/rest/api/3/issue/{key}?fields=*all` | GET |
| Transitions | `/rest/api/3/issue/{key}/transitions` | GET/POST |
| Assign | `/rest/api/3/issue/{key}/assignee` | PUT |
| Comment | `/rest/api/3/issue/{key}/comment` | POST |
| Fields list | `/rest/api/3/field` | GET |
| Issue types | `/rest/api/3/issue/createmeta?projectKeys=SMC` | GET |
| JQL search | `/rest/api/3/search/jql?jql=...` | GET |
| Current user | `/rest/api/2/myself` | GET |
| Attach file | `/rest/api/3/issue/{key}/attachments` | POST (multipart) |

---

## 9. Jenkins Integration

### Data Files

| File | Location | Owner |
|------|----------|-------|
| `jenkins_servers.json` | `data/sm/` (SM-shared) | SM |
| `jenkins-build-tools.json` | `data/{team}/` | Each team |
| `jenkins-build-history.json` | `data/{team}/` | Each team |
| `jenkins-build-approvals.json` | `data/{team}/` | Each team |
| `jenkins-portal-tools.json` | `data/{team}/` | Each team |
| `host-cooldown.json` | `data/` (global) | System |

### Jenkins Server Schema

```json
{
  "id": "jsrv_xxx", "display": "Production Jenkins",
  "base_url": "https://jenkins.internal.example.com",
  "auth_mode": "token | cookie",
  "auth_user": "jenkins-user", "auth_token": "api-token",
  "auth_cookie": "JSESSIONID=abc123...",
  "enabled": true, "order": 1,
  "job_rules": [{ "pattern": ".*-test.*", "type": "ignore | remark" }],
  "ip_override": "10.1.2.3"
}
```

### Auth Methods

```
Token:  Authorization: Basic base64(auth_user:auth_token)
Cookie: Cookie: <auth_cookie value>

CSRF Crumb (some Jenkins):
  GET {base_url}/crumbIssuer/api/json
  → { "crumbRequestField": "Jenkins-Crumb", "crumb": "abc123" }
  → Add header: Jenkins-Crumb: abc123
  If 404 → skip crumb

DNS Override:
  data/dns-overrides.json: { "jenkins.internal.com": "10.1.2.3" }
  Applied via CURLOPT_RESOLVE → bypasses system DNS
```

---

### GET /api/jenkins-proxy/?server={id}&path={jenkins_path}

**Auth:** any authenticated user

**Query:**
| Param | Required | Description |
|-------|----------|-------------|
| `server` | Yes | Server ID from `jenkins_servers.json` |
| `path` | Yes | Must end with `/api/json` (read-only guard) |
| `tree` | No | Jenkins tree filter |
| `depth` | No | Jenkins depth |

**Security:** path must end `/api/json` + must not contain `..` or `<>"'\s`

**Flow:**
1. `hostCooldownActive(host)` → 503 ถ้าใน cooldown
2. Build cURL with token/cookie auth
3. `applyDnsOverrides()` — inject CURLOPT_RESOLVE
4. Error/timeout → `hostCooldownMark(host, reason)`

**Error mapping:**
- 401 Jenkins → `"Jenkins rejected credentials"` (422)
- 403 Jenkins → `"Jenkins access denied"` (422)
- 404 Jenkins → 404
- Invalid JSON → `"Jenkins returned invalid JSON"` (502)

---

### POST /api/jenkins-proxy/?action=build (Trigger Build)

**Request:**
```json
{
  "server": "jsrv_prod",
  "path": "/job/payment/job/deploy",
  "params": { "BRANCH": "main", "ENV": "prod" }
}
```

**Flow:**
1. Validate path: regex `#^(/job/[A-Za-z0-9_.%+\-]+)+$#`
2. Fetch CSRF crumb
3. `POST {base_url}{path}/buildWithParameters` (or `/build` if no params)
4. Jenkins returns `201` + `Location: /queue/item/{id}/`

---

### Jenkins Build Advanced (`/api/jenkins-build/`) — Maker/Checker

**Feature gate:** `requireTeamFeature($payload, 'jenkins-build')`

**User roles (jb_role field):**

| jb_role | Can submit | Can approve |
|---------|-----------|------------|
| `maker` | ✅ | ❌ |
| `checker` | ❌ | ✅ |
| `admin` | ✅ | ✅ |

Internal roles (`sm_admin`, `sm_lead`, `dev_sm`, `super_admin`): can do both

**Tool schema:**
```json
{
  "id": "tool_xxx", "name": "Deploy Payment",
  "server_id": "jsrv_prod",
  "job_path": "/job/payment/job/deploy",
  "params": [
    { "key": "BRANCH", "label": "Branch", "required": true, "pattern": "^[a-z0-9/_-]+$" }
  ],
  "auto_params": { "updated_by": "username" },
  "requires_approval": false
}
```

| Endpoint | Description |
|----------|-------------|
| GET | List tools + server names + `can_admin` flag |
| GET `?history=1` | Build history |
| GET `?approvals=1` | Pending approval queue |
| GET `?action=status&tool_id=X&queue_id=Y` | Poll Jenkins queue/build |
| POST `{action:'submit', tool_id, params:{...}}` | Validate → trigger or queue for approval |
| POST `{action:'approve', approval_id}` | Checker approves → triggers build |
| POST `{action:'reject', approval_id}` | Checker rejects |

**Status poll flow:**
1. `GET {base_url}/queue/item/{queue_id}/api/json` → check `executable.url`
2. `GET {build_url}/api/json` → `{building, result, number, duration}`
3. Returns: `{status: 'In Queue'|'Building'|'Finished', progress: 0-100, result: 'SUCCESS'|'FAILURE'|null}`

---

### Health Check (`/api/health/`)

**Auth:** ALL_STAFF_ROLES  
**Query:** `?fresh=1` bypass 60s cache  
**Cache:** `data/health_cache.json`, TTL 60s

**Checks:**
1. SMTP — config existence only (no connection test)
2. Jira — `GET {JIRA_BASE_URL}/rest/api/2/myself` (Basic Auth, timeout 5s)
3. Jenkins (each server) — `GET {base_url}/api/json` (timeout 5s, with cooldown)

**Response:**
```json
{
  "data": {
    "checked_at": "2026-09-30T10:00:00+07:00",
    "services": {
      "smtp": { "name": "SMTP", "status": "ok | not_configured" },
      "jira": { "name": "Jira", "status": "ok | error | timeout | cooldown", "latency_ms": 120 },
      "jenkins": [{ "id": "jsrv_prod", "display": "...", "status": "ok | error | timeout | cooldown", "latency_ms": 85 }]
    }
  }
}
```

---

## 10. Service Performance & Monitoring

### Service Performance Config (`data/sm/service-performance-sources.json`)

```json
{
  "cacheTtlSeconds": 60,
  "sheetEmbedUrl": "https://docs.google.com/...",
  "serviceInventoryCsvPath": "data/sm/service-inventory/inventory.csv",
  "sources": [
    {
      "slug": "tmn-eks-prod", "name": "TMN EKS Production",
      "enabled": true,
      "grafanaUrl": "https://grafana.internal",
      "dsUid": "PROM_THANOS_UID",
      "jvmDsUid": "JVM_MICROMETER_UID",
      "orgId": 1,
      "authMode": "basic",
      "token": "",
      "color": "#3b82f6",
      "labelScheme": "k8s",
      "cluster": "acm-tmn-eks-prod",
      "namespaceRegex": "tmn-.+",
      "namespaceExclude": "tmn-infra",
      "podExclude": ".*-job-.*",
      "dashboardUid": "grafana-dashboard-uid"
    }
  ]
}
```

**labelScheme:**
- `k8s` — cadvisor + kube-state-metrics, group by `(namespace, pod)`, aggregate PHP-side
- `appScope` — `up{env_name, appScope}` for ACM org=3

**PHP settings:**
```
ini_set('memory_limit', '512M')  ← cold fill can OOM
set_time_limit(180)
CURLOPT_TIMEOUT = 25s per query
```

**Grafana endpoint:** `POST {grafanaUrl}/api/datasources/proxy/uid/{dsUid}/api/v1/query`  
**Body:** `query=<promql>&time=<unix_ts>`

---

### GET /api/service-performance/

**Auth:** ALL_STAFF_ROLES  
**Query:** `?runway=<slug>` (or `all`) · `?showAll=1` (skip CSV inventory filter)

**Response:** `{ runways: [...], sheetEmbedUrl, cacheTtlSeconds, hasInventory, debug: {...} }`

---

### PromQL Queries — k8s label scheme (Overview)

```promql
# Active pods
kube_pod_info{cluster=~"<cluster>", namespace=~"<ns>", namespace!~"<nsExclude>", pod!~"<podExclude>"}

# CPU used (rate 5m window, per pod)
sum by (namespace, pod) (rate(container_cpu_usage_seconds_total{<sel>, container!="", container!="POD"}[5m]))

# CPU limit per pod
sum by (namespace, pod) (kube_pod_container_resource_limits{<sel>, resource="cpu", container!=""})

# Memory used (working set) per pod
sum by (namespace, pod) (container_memory_working_set_bytes{<sel>, container!="", container!="POD"})

# Memory limit per pod
sum by (namespace, pod) (kube_pod_container_resource_limits{<sel>, resource="memory", container!=""})
```

**Pod-name → workload aggregation** (`_spStripPodHash()`):
1. Deployment: `^(.+)-[a-z0-9]{5,11}-[a-z0-9]{5}$`
2. CronJob: `^(.+)-\d{8,13}-\d{1,6}$`
3. DaemonSet: `^(.+)-[a-z0-9]{5}$`
4. StatefulSet: `^(.+)-\d{1,5}$`

**Regex escaping:** `_spPromEscape()` escapes `.\\+*?[]()|\^$` but NOT `-` (Thanos rejects `\-`)  
**Important:** In PHP source, literal dot in service name needs `\\\\.` → wire gets `\\.`

---

### GET /api/service-performance/subsystems.php

**Auth:** ALL_STAFF_ROLES  
**Query params:**

| Param | Required | Description |
|-------|----------|-------------|
| `service` | ✅ | Service name (regex: `[a-z0-9._-]+`) |
| `runway` | ✅ | Runway slug |
| `sections` | ✅ | Comma-separated: `hikari,tomcat,jvm,txn,chips,httppool` |
| `window` | No | Minutes (default 30, max 43200) |
| `start` / `end` | No | Unix timestamp (override `window`) |

**Datasource:** `jvmDsUid` (Micrometer — different from k8s `dsUid`)  
**Selector:** `app_name="<service>"[, cluster="<cluster>"]`  
**Cache:** 60s per `(service, runway, cluster, sections, window)`

---

#### Section: `hikari` — DB Connection Pool

**Instant queries:**
```promql
sum(hikaricp_connections_active{app_name="<svc>"})
sum(hikaricp_connections_idle{app_name="<svc>"})
sum(hikaricp_connections_pending{app_name="<svc>"})
sum(hikaricp_connections{app_name="<svc>"})
max(hikaricp_connections_max{app_name="<svc>"})
max(hikaricp_connections_min{app_name="<svc>"})
sum(rate(hikaricp_connections_timeout_total{app_name="<svc>"}[5m]))
max(hikaricp_connections_acquire_seconds_max{app_name="<svc>"})
max(hikaricp_connections_usage_seconds_max{app_name="<svc>"})
max(hikaricp_connections_creation_seconds_max{app_name="<svc>"})
sum(rate(hikaricp_connections_usage_seconds_count{app_name="<svc>"}[5m]))
```

**Range queries (with min/max envelopes):**
```promql
sum(hikaricp_connections_active{<sel>})           # active
sum(hikaricp_connections_idle{<sel>})             # idle
sum(hikaricp_connections_pending{<sel>})          # pending
sum(rate(hikaricp_connections_timeout_total{<sel>}[5m]))  # timeout rate
max(hikaricp_connections_acquire_seconds_max{<sel>}) * 1000
max(hikaricp_connections_usage_seconds_max{<sel>}) * 1000
max/min variants for envelopes...
```

---

#### Section: `tomcat` — Thread Pool

```promql
# Spring Boot ≥ 2.0 Micrometer
max(tomcat_threads_busy_threads{<sel>})
max(tomcat_threads_current_threads{<sel>})
max(tomcat_threads_config_max_threads{<sel>})

# Older JMX exporter
max(Tomcat_ThreadPool_currentThreadsBusy{<sel>})
max(Tomcat_ThreadPool_currentThreadCount{<sel>})
max(Tomcat_ThreadPool_maxThreads{<sel>})
max(Tomcat_ThreadPool_connectionCount{<sel>})
max(Tomcat_ThreadPool_maxConnections{<sel>})
max(Tomcat_ThreadPool_acceptCount{<sel>})
max(Tomcat_ThreadPool_keepAliveTimeout{<sel>})
```

---

#### Section: `jvm` — Runtime / JVM

```promql
avg by (id, area) (jvm_memory_used_bytes{<sel>})
min by (id, area) (jvm_memory_max_bytes{<sel>})
max(jvm_threads_live_threads{<sel>}) or max(jvm_threads_current{<sel>})
max(jvm_threads_peak_threads{<sel>})
sum by (state) (jvm_threads_states_threads{<sel>})
max(jvm_classes_loaded_classes{<sel>})
sum by (id) (jvm_buffer_memory_used_bytes{<sel>})
avg(system_cpu_usage{<sel>})
avg(process_cpu_usage{<sel>})
avg(system_load_average_1m{<sel>})
max(process_files_open_files{<sel>}) or max(process_files_open{<sel>})
max(jvm_gc_pause_seconds_max{<sel>})
sum(rate(jvm_gc_pause_seconds_sum{<sel>}[5m]))
max(process_uptime_seconds{<sel>})
```

---

#### Section: `txn` — Transaction Peaks

```promql
max_over_time(sum(rate(http_server_requests_seconds_count{<sel>}[1m]))[<win>:15s])   # peakTps
max_over_time(sum(rate(http_client_requests_seconds_count{<sel>}[1m]))[<win>:15s])  # peakClientTps
max_over_time(max(http_server_requests_seconds_max{<sel>})[<win>:15s]) * 1000        # latMaxMs
max_over_time(max(hikaricp_connections_active{<sel>})[<win>:15s])                    # peakDbActive
max_over_time(max(tomcat_threads_busy_threads{<sel>} or Tomcat_ThreadPool_currentThreadsBusy{<sel>})[<win>:15s])
max_over_time((avg(jvm_memory_used_bytes{<sel>,area="heap"}) / avg(jvm_memory_max_bytes{<sel>,area="heap"}) * 100)[<win>:15s])
```

---

#### Section: `httppool` — Apache HttpComponents Client Pool

```promql
sum(httpcomponents_httpclient_pool_total_connections{<sel>, state="leased"})
sum(httpcomponents_httpclient_pool_total_connections{<sel>, state="available"})
sum(httpcomponents_httpclient_pool_total_pending{<sel>})
sum(max by (pod_ip, httpclient) (httpcomponents_httpclient_pool_total_max{<sel>}))
avg(httpcomponents_httpclient_pool_route_max_default{<sel>})
# Per-pool breakdown by httpclient bean name
sum by (httpclient) (httpcomponents_httpclient_pool_total_connections{<sel>, state="leased"})
```

Returns `null` if no pool metrics → frontend hides section.

---

#### Section: `chips` — Health Summary Chips

```promql
sum(hikaricp_connections_active{<sel>})
max(hikaricp_connections_max{<sel>})
sum(hikaricp_connections_pending{<sel>})
sum(rate(hikaricp_connections_timeout_total{<sel>}[5m]))
max(tomcat_threads_busy_threads{<sel>} or Tomcat_ThreadPool_currentThreadsBusy{<sel>})
max(tomcat_threads_config_max_threads{<sel>} or Tomcat_ThreadPool_maxThreads{<sel>})
max(jvm_gc_pause_seconds_max{<sel>}) * 1000
sum(rate(jvm_gc_pause_seconds_count{<sel>}[5m]))
max(jvm_threads_live_threads{<sel>} or jvm_threads_current{<sel>})
avg(jvm_memory_used_bytes{<sel>,area="heap"}) / avg(jvm_memory_max_bytes{<sel>,area="heap"}) * 100
```

**Chip thresholds:**

| Chip | hot | warn | ok |
|------|-----|------|----|
| dbPool | timeout>0.05 OR pending>0 OR ratio≥0.9 | timeout>0 OR ratio≥0.7 | else |
| tomcat | ratio≥0.9 | ratio≥0.7 | else |
| gc | pauseMaxMs≥500 | pauseMaxMs≥100 | else |
| threads | live≥500 | — | else |
| heap | pct≥85 | pct≥70 | else |

---

### Restart Analyzer (`/api/restart-analyzer/`)

**Auth:** ALL_STAFF_ROLES  
**Cache:** 60s · `data/sm/restart-analyzer/cache/ra3_<service>_<range>.json`  
**Memory:** `512M` · **Timeout:** 90s

**GET /api/restart-analyzer/?service={name}&range={1h|6h|24h|7d}**

**Phase 1–5 Instant Queries (fired in parallel via curl_multi):**
```promql
sum(increase(kube_pod_container_status_restarts_total{pod=~"<svc>.*"}[<range>]))
sum by (pod, namespace) (increase(kube_pod_container_status_restarts_total{pod=~"<svc>.*"}[<range>])) > 0
sum by (pod, reason) (kube_pod_container_status_last_terminated_reason{pod=~"<svc>.*"} > 0)
container_start_time_seconds{pod=~"<svc>.*", container!="POD", container!=""}
kube_pod_start_time{pod=~"<svc>.*"}
kube_pod_info{pod=~"<svc>.*"}
max(max_over_time(container_memory_working_set_bytes{pod=~"<svc>.*", container!="POD", container!=""}[<range>])) by (pod)
max(kube_pod_container_resource_limits{pod=~"<svc>.*", resource="memory"}) by (pod)
max(max_over_time(rate(container_cpu_usage_seconds_total{...}[2m])[<range>:2m])) by (pod)
  / on(pod) group_left max(kube_pod_container_resource_limits{..., resource="cpu"}) by (pod) * 100
sum(increase(container_cpu_cfs_throttled_seconds_total{...}[<range>]))
sum(increase(container_cpu_cfs_throttled_periods_total{...}[<range>]))
  / sum(increase(container_cpu_cfs_periods_total{...}[<range>])) * 100
sum(increase(container_memory_failures_total{...}[<range>]))
sum(increase(container_network_receive_errors_total{pod=~"<svc>.*"}[<range>]))
sum(increase(container_network_transmit_errors_total{pod=~"<svc>.*"}[<range>]))
sum by (pod, reason) (kube_pod_container_status_waiting_reason{pod=~"<svc>.*"} > 0)
sum(kube_pod_status_ready{pod=~"<svc>.*", condition="true"} == 1)
sum(kube_pod_status_phase{pod=~"<svc>.*", phase="Running"})
sum(rate(container_fs_writes_bytes_total{...}[5m]))
min(min_over_time(kube_deployment_status_replicas{deployment=~"<svc>.*"}[<range>]))
max(max_over_time(kube_deployment_status_replicas{deployment=~"<svc>.*"}[<range>]))
min by (node) (time() - kube_node_created{})
```

**Phase 6 Downstream (Micrometer — `jvmDsUid`):**
```promql
topk(6, sum by (client_name, status) (rate(http_client_requests_seconds_count{app_name="<svc>", status=~"5.."}[<range>])) > 0)
topk(6, sum by (uri, status) (rate(http_server_requests_seconds_count{app_name="<svc>", status=~"5.."}[<range>])) > 0)
max(jvm_memory_used_bytes{app_name="<svc>", area="heap"}) / max(jvm_memory_max_bytes{...}) * 100
max(jvm_threads_live_threads{app_name="<svc>"})
```

**Verdict Classification:**

| Verdict | Primary condition |
|---------|------------------|
| `no-restart` | affectedPods == 0 |
| `oom` | OOMKilled > 0 |
| `app-crash` | CrashLoopBackOff waiting OR Error > Completed |
| `hot-pod` | 1 pod ≥5 restarts + ≥50% share |
| `internal-overload` | selfErrRate ≥ 1/s + memFailcnt ≥ 100k |
| `downstream-failure` | downstream 5xx ≥ 1/s + Completed + coordinated |
| `traffic-spike` | HPA scale event + CPU ≥ 80% or self-5xx |
| `external-sigterm` | Completed + all pods coordinated within 120s |
| `inconclusive` | fallback |

---

### Begin Grafana — Endpoint Discovery (`/api/begin-grafana/`)

**Auth:** SM team only

**GET /api/begin-grafana/endpoints.php?service={name}&window={min}**

**PromQL queries fired:**
```promql
sum by (method, uri, status) (rate(http_server_requests_seconds_count{<sel>}[<range>s]))
1000 * sum by (method, uri) (rate(http_server_requests_seconds_sum{<sel>}[<range>s]))
     / sum by (method, uri) (rate(http_server_requests_seconds_count{<sel>}[<range>s]))
1000 * max by (method, uri) (http_server_requests_seconds_max{<sel>})
1000 * histogram_quantile(0.95, sum by (method, uri, le) (rate(http_server_requests_seconds_bucket{<sel>}[<range>s])))
```

**Health thresholds:** `healthy` (errorRate<1% AND p95<1s) · `degraded` (1–5% OR 1–5s) · `failing` (>5% OR >5s) · `idle`

**GET /api/begin-grafana/promql.php?service={name}&uri={uri}&method={method}**

Returns: ready-to-paste PromQL + Grafana Explore URL for each metric of the endpoint

---

### Grafana Alerts — Paused Alerts (`/api/grafana-alerts/paused.php`)

**Auth:** ANY  
**Grafana API:** `GET {grafanaUrl}/api/alerts?state=paused`  
**Headers:** `Authorization: Bearer|Basic ...` + `X-Grafana-Org-Id: <orgId>`

Per-source auth:
- `authMode: token` → `Authorization: Bearer <token>` (per-org service-account)
- `authMode: basic` → `GRAFANA_BASIC_USER` / `GRAFANA_BASIC_PASS` from env

---

## 11. Log Explorer & OpenSearch

### Tech Stack

| Item | Value |
|------|-------|
| Auth (OpenSearch) | Per-user AES-256-CBC creds (key = `sha256(JWT_SECRET)`) |
| Session (Dashboards) | Cookie-based, 30min TTL → `data/sm/opensearch_sessions.json` |
| Config file | `data/sm/opensearch_config.json` (SM-shared) |
| Circuit breaker | `hostCooldownActive()` / `hostCooldownMark()` |
| Rate limit | `apiRateLimit($id, 'opensearch')` — 120 req/60s |
| Access | SM team only (`requireSmTeamOnly()`) |
| Query timeout | 20s (cURL), 30s (OpenSearch server-side `"timeout":"30s"`) |
| Max hits | Configurable up to 1000 (default 200) |

### OpenSearch Endpoint Config Schema

```json
{
  "id": "tmn-os", "name": "TMN OpenSearch",
  "base_url": "https://opensearch.internal:9200",
  "dashboards_url": "https://opensearch-dash.internal",
  "username": "admin", "password": "...",
  "auth_mode": "basic | dashboards",
  "osd_version": "2.7.0",
  "default_index_pattern": "tmn-app-*",
  "index_patterns": ["tmn-app-*", "tmn-payment-*"],
  "enabled": true, "order": 1
}
```

---

### POST /api/opensearch-proxy/?action=search

**Request:**
```json
{
  "endpoint_id": "tmn-os",
  "index_pattern": "tmn-app-*",
  "module": "payment-service",
  "log_level": "ERROR",
  "correlation_id": "TMG-abc123",
  "q": "NullPointerException",
  "regexp_rest": "[4-5][0-9]{2}",
  "range": "last_1h",
  "start": "2026-09-30T09:00:00Z",
  "end": "2026-09-30T10:00:00Z",
  "size": 200,
  "from": 0
}
```

**Range presets:** `last_5m` · `last_15m` · `last_30m` · `last_1h` · `last_4h` · `last_12h` · `last_24h` · `last_3d` · `last_7d`

**Histogram interval auto-select:**

| Span | Interval |
|------|----------|
| ≤15m | 30s |
| ≤1h | 2m |
| ≤4h | 10m |
| ≤12h | 30m |
| ≤24h | 1h |
| ≤3d | 3h |
| ≤7d | 12h |

**DSL built server-side (browser never sends raw DSL):**
```json
{
  "size": 200, "from": 0,
  "sort": [{"@timestamp": {"order": "desc"}}],
  "query": {
    "bool": {
      "filter": [
        {"range": {"@timestamp": {"gte": <ms>, "lte": <ms>, "format": "epoch_millis"}}},
        {"bool": {"should": [
          {"term": {"Module.keyword": "payment-service"}},
          {"term": {"Module": "payment-service"}}
        ], "minimum_should_match": 1}},
        {"bool": {"should": [
          {"term": {"Log_Level.keyword": "ERROR"}},
          {"term": {"Log_Level": "ERROR"}}
        ], "minimum_should_match": 1}}
      ],
      "must": [
        {"query_string": {"query": "NullPointerException", "default_field": "REST", "analyze_wildcard": true, "lenient": true}}
      ]
    }
  },
  "aggs": {
    "histogram": {
      "date_histogram": {"field": "@timestamp", "fixed_interval": "2m", "min_doc_count": 0, "extended_bounds": {"min": ..., "max": ...}},
      "aggs": { "by_level": {"terms": {"field": "Log_Level.keyword", "size": 6, "missing": "UNKNOWN"}} }
    },
    "top_pods": {"terms": {"field": "kubernetes.pod_name.keyword", "size": 10, "missing": ""}}
  },
  "track_total_hits": 10000,
  "timeout": "30s"
}
```

**OpenSearch URL:** `POST {base_url}/{index_pattern}/_search` (basic auth) or `POST {base_url}/internal/search/opensearch` (dashboards cookie)

**Special error:** HTTP 422 `{"ok": false, "message": "no_user_creds", "data": {"endpoint_id": "tmn-os"}}` → frontend shows credential input prompt

---

### POST /api/opensearch-proxy/?action=trace

**Request:** `{ "endpoint_id", "index_pattern", "correlation_id", "range", "size": 500 }`

**DSL (cross-service, no Module filter):**
```json
{
  "sort": [{"@timestamp": {"order": "asc"}}],
  "query": {"bool": {"filter": [
    {"range": {"@timestamp": {"gte": ..., "lte": <lte + 90000>, "format": "epoch_millis"}}},
    {"bool": {"should": [
      {"term": {"CORRELATION_ID.keyword": "<id>"}},
      {"query_string": {"query": "\"<id>\"", "analyze_wildcard": true}}
    ], "minimum_should_match": 1}}
  ]}}
}
```

Note: `lte` extended +90s to absorb Fluentd shipping latency

---

### OpenSearch User Credentials (`/api/opensearch-user-creds/`)

**Encryption:** AES-256-CBC · key = `hash('sha256', JWT_SECRET, true)` · random 16-byte IV prepended

| Method | Description |
|--------|-------------|
| GET | Saved endpoints (without passwords) for current user |
| POST `{endpoint_id, username, password}` | Save/update creds (encrypt + store) |
| DELETE `?endpoint_id=...` | Remove creds |

---

### OpenSearch Saved Searches (`/api/opensearch-saved-searches/`)

**Data:** `data/sm/opensearch_saved_searches.json` (team-shared within SM)

Standard CRUD (GET/POST/PUT/DELETE). Schema:
```json
{
  "id": "srch_01HX...", "name": "Payment ERROR logs",
  "endpoint_id": "tmn-os", "index_pattern": "tmn-app-*",
  "params": { "module": "payment-service", "log_level": "ERROR", "range": "last_1h" },
  "folder_id": "folder_01HX...", "created_by": "user-uuid", "created_at": "..."
}
```

---

## 12. MA (Mobile App) Suite

### MA Status — External Sources

| Key | URL | Auth |
|-----|-----|------|
| `nano` | `https://cdn-loan-product.ascendnano.com/products.json` | None (public CloudFront) |
| `tmn_jenkins` | Jenkins job paths from `jenkins_servers.json` (display=TMN-OPS) | Basic auth: `username:auth_token` |
| `tmn_backoffice` | `GET {BACKOFFICE_GATEWAY_URL}/acm-backoffice-api-gateway/ops-service-maintenance-server/config/use-cases/search?pageSize=500` | Keycloak Bearer token (60s safety margin cache) |

**Backoffice env vars:**
```
BACKOFFICE_USERNAME, BACKOFFICE_PASSWORD, BACKOFFICE_CLIENT_ID=backofficeui
BACKOFFICE_GATEWAY_URL=https://backoffice-gateway.truemoney.com
BACKOFFICE_TOKEN_URL=https://api-backoffice-aaa.truemoney.com/auth/realms/backoffice/protocol/openid-connect/token
```

**Default Jenkins Jobs (TMN-OPS):**

| Label | Job Path | State Param | On Values |
|-------|----------|-------------|-----------|
| Wallet Login MA | `/view/V1%20Maintenance%20page/job/wallet-maintenance_login` | `IS_MAINTENANCE` | `1,true,True` |
| Register SAVING Service | `/view/V1%20Maintenance%20page/job/maintenance-register-SAVING-SERVICE` | `IS_MAINTENANCE` | `true,True,1` |
| SAVING Service | `/view/V1%20Maintenance%20page/job/maintenance-SAVING-SERVICE` | `IS_MAINTENANCE` | `true,True,1` |
| TMN Mobile Gateway Feature Toggle | `/view/Config%20Service/job/acm-tmn-mobile-gateway-feature-toggle` | `enable_feature` | `false,False,0` |

**Cache:** `data/{team}/ma-status-cache.json` — TTL 15s (bypass: `?refresh=1`)

---

### GET /api/ma-status/

**Query:** `?source=all|nano|tmn_jenkins|tmn_backoffice` · `?refresh=1`

**Response:**
```json
{
  "sources": {
    "nano": { "ok": true, "items": [{"name": "...", "label": "...", "status": "open|closed|unknown", "updated_at": "..."}] },
    "tmn_jenkins": { "ok": true, "items": [...] },
    "tmn_backoffice": { "ok": true, "items": [...] }
  },
  "services": [
    { "id": "...", "service_name": "...", "matched": true, "status": "open|closed|unknown", "source": "nano|tmn_jenkins|tmn_backoffice" }
  ],
  "unmapped_backoffice": [...]
}
```

---

## 13. Batch Monitoring

### Batch Records (`/api/batch-records.php`)

| Action | Method | Auth | Description |
|--------|--------|------|-------------|
| `months` | GET | None | List months with data |
| `submit` | POST | Required + CSRF | Submit daily report |
| `list&month=YYYY-MM` | GET | Required + page permission | List records for month |
| `coverage&month=YYYY-MM` | GET | Required + `isSmCoverageAdmin` | Per-day submission status |

**Submit Request:**
```json
{
  "timestamp": "2026-09-30T07:00:00+07:00",
  "reporter": "Warapon",
  "server": "BatchServer-01",
  "jobs": [{ "name": "PaymentBatch", "status": "SUCCESS", "duration": 1800 }],
  "backfill": false
}
```

**Data file:** `data/{team}/batch-records-YYYY-MM.json` (monthly files)

**Coverage response:**
```json
{
  "expected_servers": ["BatchServer-01", "BatchServer-02"],
  "days": [
    {
      "date": "2026-09-01", "is_weekend": false, "holiday": null,
      "submitted_servers": ["BatchServer-01"], "missing_servers": ["BatchServer-02"],
      "status": "ok | partial | missing | future"
    }
  ],
  "summary": { "ok": 15, "partial": 5, "missing": 3, "future": 7 }
}
```

Expected server set = union across target month + 2 prior months

---

### Batch Monitor Notifications (`/api/batch-monitor-noti/`)

**State file key format:** `<serverId>__<jobPath>`

| Method | Auth | Description |
|--------|------|-------------|
| GET | ADMIN_ROLES | Config + log + state summary |
| PUT `?server=<id>` | ADMIN_ROLES + CSRF | `{ enabled, webhook_url }` |
| DELETE `?server=<id>` | ADMIN_ROLES + CSRF | Remove config |
| POST `?action=test&server=<id>` | ADMIN_ROLES + CSRF | Send test Google Chat card |

Webhook URLs masked in response: `scheme://host/prefix…suffix?…`

---

### Cutoff Services (`/api/cutoff-services/`)

**Auth:** all reads require auth · writes require `requireSmForShared()`

| Endpoint | Description |
|----------|-------------|
| `list.php` | List all cutoffs (sorted by id asc) |
| `create.php` | Create: `{ site_type, service_name, cutoff_time, cutoff_day }` |
| `update.php` | Update (body must include `id`) |
| `delete.php` | Delete: `{ id }` |
| `types.php` | Distinct `site_type` values |
| `import-from-db.php` | Bulk import (ADMIN_ROLES) |

---

## 14. Knowledge, Learning & Onboarding

### Knowledge Base (`/api/knowledge-base/`)

**Data:** `data/{team}/knowledge-base.json` — `{ categories: [...], entries: { category_id: [...] } }`

| Endpoint | Role | Description |
|----------|------|-------------|
| `list.php` GET | any | All entries by category |
| `save.php` POST | LEAD_ROLES | Create/update entry (`{ category, entry_id?, data }`) |
| `delete.php` POST | ADMIN_ROLES | Delete entry |
| `add-category.php` POST | ADMIN_ROLES | Add category `{ id, name, order? }` |
| `delete-category.php` POST | ADMIN_ROLES | Delete category + all entries |

---

### Courses (`/api/courses/`)

**Storage:**
```
data/{team}/courses/
  courses.json          ← index (no lessons/quizzes inline)
  progress.json         ← per-user × phase progress
  <course_id>/phases.json
  <course_id>/lessons.json
  <course_id>/quizzes.json
```

`shared: true` on course → visible to all teams (read their own attempts; only owner admin edits)

---

### Exams (`/api/exams/`)

**Storage:**
```
data/{team}/exams/
  exams.json                  ← index (NO questions)
  attempts.json               ← all attempt records
  <exam_id>/questions.json    ← question pool
  <exam_id>/events.json       ← audit log
```

**Config presets:**

| Key | basic | standard | strict |
|-----|-------|----------|--------|
| `time_limit.enabled` | false | true (60min) | true (45min) |
| `shuffle_questions.enabled` | false | true | true |
| `shuffle_choices.enabled` | false | true | true |
| `attempts.enabled` | false | true (3 max) | true (1 max) |
| `attempts.cooldown_minutes` | 0 | 0 | 1440 (24h) |
| `pool.enabled` | false | false | true |

#### POST /api/exams/attempts.php?action=start

Pre-flight: exam published → course prerequisites → time window → attempt count/cooldown → resume if in-progress

**Response includes shuffled questions WITHOUT correct answers.**

#### POST /api/exams/attempts.php?action=submit

**Scoring algorithm:**
1. Load `data/{team}/exams/<exam_id>/questions.json`
2. Each question: check `answers[q_id]` vs `correct_choice_id`
3. `score = (correct_count / total_questions) * 100` (integer, rounded)
4. `passed = score >= exam.pass_score` (default 70)
5. Badge: `score >= 95 → gold` · `>= 85 → silver` · else `bronze`

**Proctoring events:** `tab_switch`, `blur`, `fullscreen_exit`, `paste`, `copy` → `violations` counter in attempts.json

---

### Achievements (`/api/achievements/`)

**Point system:**

| Item | Points | Silver bonus | Gold bonus |
|------|--------|-------------|-----------|
| Onboarding finished | 100 | — | — |
| Course completed | 50 | +20 | +50 |
| Exam passed | 30 | +15 | +40 |

**Badge thresholds:**

| Badge | Course (avg score across phases) | Exam (best score) |
|-------|----------------------------------|-------------------|
| Gold | ≥ 95% | ≥ 95% |
| Silver | ≥ 85% | ≥ 85% |
| Bronze | < 85% (but completed/passed) | < 85% (but passed) |

**GET /api/achievements/?user_id={id}** — ADMIN_ROLES to view others

---

### GenZ Notes (`/api/genz-notes/`)

**Access:** SM team + `is_genz` flag (read live from `users.json`, NOT from JWT)  
**Data:** `data/sm/genz_case_notes.json` (hard-coded to `sm` team, not multi-team)

**Field constraints:**
- `title`: max 200 chars
- `tags`: each max 40 chars
- `steps[].text`: max 400 chars
- `links[].url`: must match `^https?://`
- `teams_custom`: max 20 teams

Standard CRUD (GET/POST/PUT/DELETE)

---

### Onboarding (`/api/onboarding/`)

**Data:** `data/{team}/onboarding/config.json` + `data/{team}/onboarding/progress/<user_id>.json`

**Block types:** `text | tasks | quiz | scored_quiz | embed | checklist`

**Progress mutations (POST `?action=...`):**

| Action | Body | Description |
|--------|------|-------------|
| `toggle_task` | `{ chapter_id, task_id }` | Toggle complete |
| `notebook` | `{ chapter_id, text }` | Save notes |
| `quiz` | `{ chapter_id, question_id, text }` | Save answer |
| `finish` | — | Mark finished |

Chapter unlock evaluated server-side via `onboardingUnlockMap()` on each read.

---

## 15. Communications

### Email (`/api/mail/send.php`)

**Implementation:** Raw SMTP via cURL (NOT PHPMailer)  
**MIME:** Built manually — `multipart/related` for inline images, `multipart/mixed` for attachments  
**Log:** `data/{team}/mail_logs.json` (max 2000 entries)

**Request:**
```json
{
  "to": ["user@example.com"],
  "cc": ["cc@example.com"],
  "bcc": ["bcc@example.com"],
  "subject": "string",
  "body": "HTML or plain text",
  "isHtml": true,
  "useBranding": true,
  "attachments": [{ "filename": "report.pdf", "mime": "application/pdf", "data": "<base64>" }]
}
```

**SMTP URL format:**
- TLS: `smtp://{host}:{port}` + `CURLUSESSL_ALL`
- SSL: `smtps://{host}:{port}`
- Timeout: 20s

**mail_config.json:**
```json
{
  "smtp_host": "smtp.example.com", "smtp_port": 587, "smtp_encryption": "tls",
  "smtp_user": "user@example.com", "smtp_password": "...",
  "from_email": "noreply@example.com", "from_name": "SOM-Portal",
  "email_footer_style": "typewriter", "email_public_base_url": "https://..."
}
```

---

### In-App Notifications (`/api/notifications/`)

**Data:** `notifications.json` (team-scoped)

**Notification types:** `mention`, `comment`, `leave_request`, `board_status`, `exam_reminder`, `announcement`

| Method | Description |
|--------|-------------|
| GET | Last 50 notifications for current user, newest first |
| PATCH `{ "id": "..." }` or `"all"` | Mark as read |
| DELETE | Clear all **read** notifications |

---

### Presence (`/api/presence/`)

**Data:** `presence.json` (team-scoped)  
**Auth:** any user (super_viewer write allowed via `allowSuperViewerWrite=true`)

| Method | Description |
|--------|-------------|
| POST `{ "status": "online", "page": "board" }` | Heartbeat upsert |
| GET | Online users (last_seen > now-60s) |

---

### Chat Proxy (`/api/chat-proxy.php`)

**Auth:** Any authenticated user  
**Request:** `{ "webhook": "https://chat.googleapis.com/...", "message": "text" }`  
**Validation:** webhook must match `^https://chat\.googleapis\.com/`  
**Timeout:** 15s · `SSL_VERIFYPEER=false`

---

### Incident Launcher (`/api/incident-launcher/`)

**Auth:** SM team only (most actions)  
**Config:** `data/sm/incident-launcher-config.json`

**Supported notification platforms:**

| Platform | Method |
|----------|--------|
| `googlechat` | POST JSON `{text}` to webhook URL · optional thread |
| `line` | POST form-encoded to `https://notify-api.line.me/api/notify`, Bearer token |
| `dingtalk` | POST JSON `{msgtype:"text", text:{content:"..."}}` to webhook |
| `manual` | No HTTP call — copy-only |

**Jira operations:**
- `jira_transitions` → `GET {JIRA_BASE_URL}/rest/api/3/issue/{key}/transitions`
- `jira_create_meta` → `GET {JIRA_BASE_URL}/rest/api/3/issue/createmeta?...`
- `jira_do_transition` → `POST {JIRA_BASE_URL}/rest/api/3/issue/{key}/transitions`

**Backoffice operations (via Keycloak Bearer token):**
- `bo_config_peek` → `GET /acm-backoffice-api-gateway/ops-service-maintenance-server/application/list`
- `bo_config_update` → `PUT /acm-backoffice-api-gateway/ops-service-maintenance-server/config/{app}/{env}/{profile}`

---

### SABai AI (`/api/ai/`)

**Auth:** `requireAuth(false, true)` — super_viewer allowed  
**External:** Ollama HTTP API

**Ollama request:**
```json
{
  "model": "qwen2.5:7b",
  "messages": [
    { "role": "system", "content": "<Thai persona: ตุ้มเม้ง AI, internal data only>" },
    { "role": "user",   "content": "<question>" }
  ],
  "stream": false,
  "options": { "temperature": 0.3, "num_ctx": 8192 }
}
```

**URL:** `{OLLAMA_HOST}/api/chat` · Timeout: `set_time_limit(300)` · connect 5s  
**Context sections (auto-detect from keywords):** board, users, jenkins, templates, announcements, links, categories

---

### n8n Severity Sync (`/api/n8n-severity-sync.php`)

**POST:** Trigger sync — calls n8n webhook → receive `[{name, priority, serviceGroup, bu}]` → "sheet wins" merge → write `service-severity.json`

**GET:** Return last sync metadata

---

## 16. Quick Tools & Utilities

### Search (`/api/search/`)

**Auth:** any · **Rate limit:** group `search` · **Min query length:** 2 chars  
**Data:** `board.json`, `sheets.json`, `users.json`  
**Sort:** post → sheet → user; within type: date DESC  
**Limit:** 40 results + pagination via `?offset=`

---

### Links (`/api/links/`)

**Shared sections (SM-managed):** `['monitoring']`  
**Valid sections:** `['monitoring','test-service','batch-monitor','report']`

GET merges team's own non-shared links + SM's shared sections. Write to SM file if section is shared (requires `requireSmForShared()`).

---

### Version / Deploy Detection (`/api/version.php`)

**Auth:** None (public)  
**Hash:** `substr(sha1(join('|', "file:mtime" pairs)), 0, 12)`

**Tracked files:**
```
assets/js/theme.js, layout.js, api.js, auth.js, utils.js,
skeletons.js, analytics.js, maintenance.js
assets/css/style.css, dark.css, ui-themes.css
```

Client polls every 90 seconds. If version differs → show "reload" toast.

---

### Upload (`/api/upload.php`)

**Auth:** Required + CSRF · **Rate limit:** group `upload`  
**Max size:** 5MB · **Allowed:** `image/jpeg`, `image/png`, `image/gif`, `image/webp`  
**MIME check:** finfo → mime_content_type → magic bytes fallback  
**Output:** `{ "url": "/uploads/abc123.jpg", "filename": "abc123.jpg" }`

---

## 17. System & Admin APIs

### System Settings (`/api/system-settings/`)

**Auth:** GET = any · PUT = ADMIN_ROLES  
**Data:** `DATA_DIR/system-settings.json` (global)

Default values listed in Section 2. PUT validates webhook URLs: must be `https://chat.googleapis.com/`.

---

### Service Severity (`/api/service-severity/`)

**Auth:** GET = ALL_STAFF_ROLES · POST = ADMIN_ROLES  
**Data:** `data/{team}/service-severity.json`

| Action | Method | Description |
|--------|--------|-------------|
| `list` | GET `?action=list[&search=keyword]` | List services with priority |
| `stats` | GET `?action=stats` | Count by priority P1/P2/P3 |
| `upsert` | POST | `{ action, name, priority, serviceGroup, bu, runway }` |
| `import` | POST | `{ action, services: [...] }` |
| `delete` | POST | `{ action, name }` |

---

### Menu Permissions (`/api/menu-permissions/`)

**Data:** `menu-permissions.json` (team-scoped)

```json
{
  "roles": {
    "sm_admin": "*",
    "sm_lead": "*",
    "sm_user": "*",
    "dev_user": [],
    "external": []
  },
  "always_visible": ["profile", "change-password"]
}
```

`"*"` = all menus · Array = explicit list

---

### Nav Groups (`/api/nav-groups/`)

**Data:** `nav-groups.json` (team-scoped)

```json
{
  "groups": [
    { "id": "operations", "label": "Operations", "items": ["board","jira-templates","incident-launcher"] },
    { "id": "monitoring", "label": "Monitoring", "items": ["service-performance","restart-analyzer"] }
  ]
}
```

---

### Teams (`/api/teams/`)

**Auth:** GET = ALL_STAFF_ROLES · POST/PATCH = SUPER_ADMIN_ROLE

| Method | Description |
|--------|-------------|
| GET | List teams (sm_admin sees own team only) |
| POST `{ slug, name, features }` | Create team + provision directories |
| PATCH `?id=...` | Update name/features/page_modes |
| POST `/api/teams/copy-config.php` `{ team_slug, feature, overwrite }` | Copy SM config to team |

---

## 18. Frontend Architecture

### Required Load Order (every page)

```html
<script src="assets/js/auth.js"></script>
<script src="assets/js/layout.js"></script>
<script src="assets/js/theme.js"></script>
<script src="assets/js/api.js"></script>
<script src="assets/js/utils.js"></script>

<!-- Required calls in page JS -->
Auth.requireAuth();   // redirect if unauth
Layout.init();        // render nav + icons
```

### Core JS Files

| File | หน้าที่ |
|------|---------|
| `api.js` | `API.get/post/put/patch/delete/upload` — resolve `API_BASE` from URL path — on 401 → `Auth._doLogout()` — typed namespaces: `API.board`, `API.users`, `API.templates`, ฯลฯ |
| `auth.js` | JWT ใน `localStorage` (`som_token`, `som_user`) — `Auth.requireAuth()` — `Auth.getUser()` |
| `layout.js` | Nav/sidebar + 147-icon Lucide-style system — `Icons.replaceAll()` + `MutationObserver` dynamic insert |
| `utils.js` | `showToast()`, modal helpers, formatting |
| `theme.js` | Load + apply theme + inject skeletons.js |
| `admin-nav.js` | Admin panel navigation |
| `skeletons.js` | 10 skeleton patterns (auto-loaded via theme.js) |
| `loading-overlay.js` | Bots animation |
| `maintenance.js` | Maintenance mode gate + MA gate (PAGE_FILES bypass list) |

### Frontend Rules

| Rule | เหตุผล |
|------|--------|
| ห้าม `alert/confirm/prompt` | ใช้ toast + modal จาก utils.js |
| Icon ใช้ `<i data-icon="NAME">` เท่านั้น | MutationObserver จับ dynamic |
| ห้าม emoji ใน HTML/JS | ใช้ SVG icon system เท่านั้น |
| CSS vars: ใช้ `:root` tokens (`--bg-card`, `--border`, `--text`) | scoped vars จะ transparent ถ้าใช้ body.appendChild |
| Grid: `minmax(0, 1fr)` เสมอ | ไม่ใช้ `1fr` เปล่า (overflow) |
| ห้าม fetch `/data/*.json` โดยตรง | `.htaccess` block — bcrypt hashes |
| ใช้ `Icons.replaceAll()` ไม่ใช่ `Icons.process()` | ชื่อ method ถูกต้อง |
| `Auth` + `Layout` ต้อง call top-level | ทุกหน้า ไม่มีข้อยกเว้น |

### Theme System

4 themes × 2 modes = 8 combinations

| Theme | ลักษณะ | Always dark? |
|-------|--------|-------------|
| Glass | Glassmorphism, โปร่งแส | ไม่ |
| Enterprise | Clean, professional | ไม่ |
| Console | Terminal สีเขียว | **ใช่** |
| Warm | Warm tones | ไม่ |

`.stat-card` + `.badge` มีค่า hardcoded — ต้องเพิ่ม structural `!important` overrides ด้วยเสมอ

---

## 19. Security Model

### JWT

- **Algorithm:** HS256 signed ด้วย `JWT_SECRET`
- **Logout:** ลบ `som_token` จาก localStorage — server stateless (ไม่มี revoke list)
- **CSRF:** `CsrfProtector.php` — ทุก POST/PUT/DELETE/PATCH ต้อง pass CSRF token

### Password

- bcrypt `password_hash(PASSWORD_BCRYPT, cost=10)`
- Normalize `$2b$→$2y$` สำหรับ legacy Python hashes

### Security Headers (ทุก API response)

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Cache-Control: no-store, no-cache, must-revalidate
```

### Data Access Control

- `requireAuth()` — ทุก request
- `requireRole(roles)` — ทุก write
- `teamDataPath()` — routing ผิดทีมไม่ได้
- `.htaccess` block `GET /data/*.json`
- `flock(LOCK_EX)` ใน `writeJson()` ทุกครั้ง

### File Upload Security

`api/security/FileScanner.php`:
- MIME check: finfo → mime_content_type → magic bytes fallback
- Extension validation
- Max size: 5MB

---

## 20. Page Index & Role Access Matrix

### User-Facing Pages

| หมวด | Pages |
|------|-------|
| Auth | `index.html`, `forgot-password.html`, `reset-password.html`, `change-password.html`, `profile.html`, `settings.html`, `setup-guide.html` |
| Dashboard | `dashboard.html`, `command-center-real.html` |
| AI | `sabai.html` |
| Service Board | `board.html` |
| Jira | `jira-templates.html`, `inbox.html` |
| Jenkins | `jenkins-portal.html`, `jenkins-build.html`, `so-jenkins.html` |
| Monitoring | `service-performance.html`, `restart-analyzer.html`, `restart-monitor.html`, `alert-monitor.html`, `grafana-alerts.html`, `begin-grafana.html`, `monitoring.html`, `uptime.html`, `compare.html` |
| MA Suite | `ma-status.html`, `ma-services.html`, `ma-test.html`, `ma-planwork.html`, `import-ma.html` |
| Batch | `batch-monitor.html`, `batch-monitor-v2.html`, `batch-file-search.html` |
| Logs | `log-explorer.html` |
| Learning | `learn.html`, `learn-course.html`, `learn-phase.html`, `learn-reports.html`, `exam.html`, `exam-reports.html`, `knowledge-base.html`, `ops-runbook.html`, `documentation.html`, `genz-notes.html` |
| Communications | `send-email.html`, `sms-gateway-switches.html` |
| Team | `my-team.html`, `about-som.html`, `genz-hub.html`, `dev-hub.html`, `pw-schedule.html`, `syncup.html`, `schedule.html`, `holiday-plans.html`, `weekly-report.html`, `weekly-report-form.html` |
| Tools | `analytics.html`, `incident-launcher.html`, `report-center.html`, `report.html`, `pipeline-flow.html`, `collection-lead-flow.html`, `sheets.html`, `onboarding.html`, `cron-builder.html`, `office.html`, `migrate-user.html`, `test-service.html` |

### Admin Pages (sm_admin+)

| หมวด | Pages |
|------|-------|
| User & Access | `users.html`, `menu-permissions.html`, `nav-groups.html`, `genz-team.html`, `leave-approval.html` |
| System | `system-settings.html`, `maintenance.html`, `backup.html`, `system-monitor.html` |
| Board & Content | `board.html`, `trash.html`, `templates.html`, `jira-config.html`, `knowledge-base.html`, `ops-runbook.html`, `courses.html`, `exams.html`, `achievements.html` |
| Monitoring | `jenkins-servers.html`, `alert-monitor-config.html`, `grafana-sources.html`, `opensearch-config.html`, `ma-config.html`, `ma-status.html`, `service-inventory.html`, `service-severity.html` |
| MA | `ma-test-catalog.html`, `ma-test-plans.html`, `ma-test-overview.html` |
| Comms | `mail-config.html`, `mail-logs.html`, `email-noti.html`, `scheduled-noti.html`, `announcements.html`, `sms-gateway-config.html`, `n8n-oncall-config.html`, `fh-config.html` |
| Team | `schedule.html`, `syncup-config.html`, `pw-schedule.html`, `holiday-plans.html`, `weekly-report.html`, `onboarding.html`, `links.html`, `tools.html`, `sheets.html`, `about-page.html` |
| Logs | `logs.html`, `mail-logs.html`, `analytics.html` |
| Requests | `requests.html`, `feature-requests.html` |
| Dev Tools | `devtools.html`, `dev-api.html`, `dev-data.html`, `dev-email.html`, `dev-logs.html`, `dev-system.html` |
| Super-Admin | `super-admin.html`, `super-viewer.html`, `super-team-permissions.html`, `super-email-templates.html`, `super-feature-requests.html` |

### Role Access Matrix

| Feature | sm_user | sm_lead | sm_admin | super_admin | dev_user |
|---------|---------|---------|----------|-------------|---------|
| Board read + create | ✅ | ✅ | ✅ | ✅ | ❌ |
| Board pin | ❌ | ✅ | ✅ | ✅ | ❌ |
| Board hard-delete | ❌ | ❌ | ✅ | ✅ | ❌ |
| Jira templates | ✅ | ✅ | ✅ | ✅ | ❌ |
| Jira request approval | ❌ | ✅ | ✅ | ✅ | ❌ |
| Jenkins build/portal | ✅ | ✅ | ✅ | ✅ | ❌ |
| Service Performance | ✅ | ✅ | ✅ | ✅ | ✅ (read) |
| Restart Monitor/Analyzer | ✅ | ✅ | ✅ | ✅ | ✅ (read) |
| MA Suite | ✅ | ✅ | ✅ | ✅ | ❌ |
| Batch Monitor | ✅ | ✅ | ✅ | ✅ | ❌ |
| Log Explorer | ✅ | ✅ | ✅ | ✅ | ❌ |
| KB read | ✅ | ✅ | ✅ | ✅ | ❌ |
| KB write | ❌ | ✅ | ✅ | ✅ | ❌ |
| Courses + Exams | ✅ | ✅ | ✅ | ✅ | ❌ |
| SABai AI | ✅ | ✅ | ✅ | ✅ | ❌ |
| Incident Launcher | ✅ (SM) | ✅ | ✅ | ✅ | ❌ |
| OpenSearch logs | ✅ (SM) | ✅ | ✅ | ✅ | ❌ |
| GenZ Hub + Notes | is_genz flag | is_genz flag | is_genz flag | ✅ | ❌ |
| Dev Hub | ❌ | ❌ | ❌ | ✅ | ✅ |
| Admin Panel | ❌ | ❌ | ✅ | ✅ | ❌ |
| Super-Admin pages | ❌ | ❌ | ❌ | ✅ | ❌ |
| View all teams | ❌ | ❌ | ❌ | ✅ | ❌ |
| Bypass maintenance | ❌ | ❌ | ❌ | ✅ | ❌ |

---

## Notes สำหรับ React/Next.js Rewrite

### Auth

- JWT + `team` claim ยังเหมาะสม — เปลี่ยนเป็น `httpOnly cookie` เพื่อความปลอดภัย
- `requireAuth()` → Next.js middleware
- Menu permissions → fetch ครั้งเดียวเมื่อ login + Zustand/Redux

### Backend

- API Routes (Next.js) หรือ Express/Fastify แยก
- `teamDataPath()` logic ต้องคง → ย้ายไป PostgreSQL + row-level security หรือ per-tenant schema
- SM-shared files → ตาราง shared ที่ทุก tenant อ่านได้ แต่เขียนได้เฉพาะ SM

### Real-time

- Presence + Board notifications ปัจจุบัน poll-based → ย้ายเป็น SSE หรือ WebSocket

### Proxy Layers ที่ยังต้องอยู่ฝั่ง server

- Jenkins proxy (credentials + circuit breaker)
- OpenSearch proxy (AES-256 user creds)
- Rundeck proxy
- Google Chat webhook proxy (bypass CSP)
- Grafana/Thanos proxy (service account token)

### Pattern Mapping

| PHP/Vanilla JS | React/Next.js |
|---------------|---------------|
| `Auth.requireAuth()` | `useAuth` hook + middleware |
| `Layout.init()` + nav render | `<AppLayout>` component |
| `Icons.replaceAll()` | `<Icon name="..." />` component |
| `API.get/post/...` | React Query / SWR `useQuery/useMutation` |
| `utils.showToast()` | react-hot-toast / sonner |
| `theme.js` + CSS vars | CSS variables + `ThemeProvider` |
| Skeleton patterns | `<Skeleton>` component |
| `hostCooldown` circuit breaker | Server-side (unchanged pattern) |
| `flock(LOCK_EX)` | Database transactions / optimistic locking |
| JWT `team` claim | JWT `team` claim → middleware team routing |

---

*Last updated: Sep 2026 · Source: PHP source code + SOM-Portal System Manual*
# SOM-Portal
