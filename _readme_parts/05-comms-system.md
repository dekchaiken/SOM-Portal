# Part 5 — Core Library, Communications & System APIs

> อ่านจาก source PHP โดยตรง · Sep 2026

---

## 1. `api/helpers.php` — Core Library (ทุก function)

### Timezone & Response Headers (auto-applied)
```
date_default_timezone_set('Asia/Bangkok')
Content-Type: application/json; charset=utf-8
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Cache-Control: no-store, no-cache, must-revalidate
```

---

### Role Constants

| Constant | Values |
|----------|--------|
| `SUPER_ADMIN_ROLE` | `'super_admin'` |
| `ADMIN_ROLES` | `['super_admin','sm_admin','dev_sm']` |
| `LEAD_ROLES` | `['super_admin','sm_admin','dev_sm','sm_lead']` |
| `ALL_STAFF_ROLES` | `['super_admin','super_viewer','sm_admin','dev_sm','sm_lead','sm_user','dev_user','external']` |
| `GLOBAL_READ_ROLES` | `['super_admin','super_viewer']` |
| `REPORT_READ_ROLES` | `['super_admin','sm_admin','dev_sm','super_viewer']` |

---

### Function Signatures

#### Auth & Team

```php
requireAuth(bool $allowExpiredPw = false, bool $allowSuperViewerWrite = false): array
// Returns JWT payload array. Sets $GLOBALS['_current_team'] from JWT.team claim.
// GLOBAL_READ_ROLES may override team via X-Admin-Team header.
// super_viewer: blocks non-GET unless $allowSuperViewerWrite=true.
// Checks PW_EXPIRY_DAYS (60d default) → 403 PASSWORD_EXPIRED.
// Checks must_reset_password flag → 403 MUST_RESET_PASSWORD.

requireRole(array $payload, array $roles): void
// super_admin always passes. Others: 403 if not in $roles.

requireCsrf(): void
// Only for POST/PUT/DELETE/PATCH. Uses api/security/CsrfProtector.php.

requireSmForShared(): void
// Blocks write if current team != 'sm'. Returns 403.

requireSmTeamOnly(string $featureLabel): void
// Full lockout (read + write) for non-sm teams.

requireTeamFeature(array $payload, string $featureKey): void
// Check teams.json features[]. super_admin bypasses.

requirePageMode(array $payload, string $pageId, string $requiredMode = 'full'): void
// Check teams.json page_modes[pageId]. 403 if 'read'.

requirePagePermission(array $payload, string $page): void
// For role='external': check user.permissions[] array.

denySuperViewer(array $payload, string $resourceLabel): void
// 403 if role === 'super_viewer'.

isSmCoverageAdmin(array $payload): bool
// true if super_admin OR (sm_admin/dev_sm AND team=='sm').

requireSmCoverageAdmin(array $payload, string $resource): void
// 403 unless isSmCoverageAdmin().

applyExtraPageTeam(array $payload, string $pageKey): void
// Switch _current_team to user.extra_pages[pageKey].source_team.

teamContextFallbackForGlobalRole(array $payload, string $file): void
// For super_admin/super_viewer without X-Admin-Team: find first team with data.

resolveUserMenus(string $userId, string $role, array $allMenuIds): array
// Returns {allowed: string[], mode: 'wildcard'|'explicit'}.
// Merges: role default + user.menu_permissions.grant - deny + always_visible.
```

#### Data Path Helpers

```php
teamDataPath(string $file, ?string $team = null): string
// Returns filesystem path for a data file.
// Global files  → DATA_DIR/{file}
// SM-shared files → DATA_DIR/sm/{file}
// Others        → DATA_DIR/{team}/{file}

_isGlobalFile(string $file): bool
// Returns true for: users.json, teams.json, feature_requests.json,
// system-settings.json, rate_limit.json, api_rate_limit.json,
// forgot_rate_limit.json, password_reset_tokens.json,
// metrics.json, server_metrics.json, n8n_oncall_config.json,
// n8n_severity_config.json, maintenance.json, requests.json

smSharedFiles(): array
// SM-owned files everyone reads. Includes patterns with '*' (fnmatch).
// Key entries: ma-services.json, ma-modules.json, cutoff-services.json,
// jenkins_jobs_catalog.json, batch_file_index.json,
// grafana-alert-sources.json, grafana-runways.json, grafana-monitoring/*,
// service-performance-sources.json, service-performance/*,
// service-inventory.csv, templates.json, jira_config.json,
// pw_schedule.json, pw_schedule_config.json

_isSmSharedFile(string $file): bool
// Checks exact match + fnmatch for pattern entries.
```

#### JSON I/O

```php
readJson(string $file): array
// Resolves path via _teamDataPath(). flock not needed on read.
// Returns [] on missing file, empty content, or JSON parse error.
// Logs parse error to error_log (silent recovery, but visible in logs).

writeJson(string $file, array $data): bool
// Resolves path, auto-creates directory.
// Opens with fopen('c+'), flock(LOCK_EX), ftruncate, rewind, fwrite.
// JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE.
// Returns bool success.
```

#### Response Helpers

```php
respond(array $data, int $code = 200): void
// http_response_code($code) + json_encode($data, JSON_UNESCAPED_UNICODE) + exit.

respondOk($data = null, string $message = 'OK'): void
// Wrapper: {success:true, message:"OK", data:$data}

respondError(string $message, int $code = 400): void
// Wrapper: {success:false, message:$message}
// Also logs to security.json for code >= 500.
```

#### JWT

```php
jwt_create(array $payload, int $expiry = 0): string
// HS256, sets payload.exp = now + JWT_EXPIRY (default) or $expiry.
// Sets payload.iat = now.

jwt_verify(string $token): ?array
// Returns payload array or null if invalid/expired.
// hash_equals() comparison (timing-safe).
```

#### Password

```php
hashPassword(string $pw): string        // password_hash(PASSWORD_BCRYPT, cost=10)
verifyPassword(string $pw, string $hash): bool   // normalizes $2b$→$2y$ for Python compat
```

#### Password Reset Tokens

```php
createResetToken(string $userId, int $ttlHours = 24): array
// 64-char hex token, stored in data/password_reset_tokens.json.
// Invalidates previous unused tokens for same user.

verifyResetToken(string $token): ?string    // returns user_id or null
consumeResetToken(string $token): ?string   // marks used, returns user_id or null
```

#### Rate Limiting

```php
// Login rate limit (from system-settings):
// RL_MAX_ATTEMPTS = max_login_attempts (default 5)
// RL_WINDOW_SECONDS = lockout_minutes * 60 (default 15min)
// RL_BLOCK_SECONDS = same as window
rl_check(string $username): void       // 429 if blocked
rl_fail(string $username): void        // increment + block if >= MAX
rl_success(string $username): void     // reset counter

// API rate limit (from system-settings):
// API_RL_MAX = api_rate_limit_requests (default 120)
// API_RL_WINDOW = api_rate_limit_window_seconds (default 60)
apiRateLimit(string $userId, string $group): void
// Key = sha256(userId:group)[0:16].
// 429 with Retry-After header if exceeded.
// Groups: 'board', 'comments', 'upload', 'search', 'stars', etc.
```

#### Host Cooldown (Circuit Breaker)

```php
// HOST_COOLDOWN_TTL = 30 seconds
// State file: DATA_DIR/host-cooldown.json (global, not team-scoped)

hostCooldownActive(string $host): ?array
// Returns null (no cooldown) or {reason, fail_at, expires_at}.

hostCooldownMark(string $host, string $reason): void
// Sets fail_at=now in host-cooldown.json.

hostCooldownClear(string $host): void
// Removes entry (ops override after fix).

hostFromUrl(string $url): string        // parse_url → lowercase hostname
applyDnsOverrides($ch, string $url): void
// Applies CURLOPT_RESOLVE from data/dns-overrides.json + jenkins ip_override.
```

#### Logging

```php
logActivity(string $action, array $detail = [], ?string $userId = null, ?string $userName = null): void
// Writes to data/{team}/logs/activity.json (or data/logs/ for SM/global).
// Entry: {id, ts, action, user_id, user_name, ip, ua, detail}
// LOG_MAX_ACTIVITY = PHP_INT_MAX (no cap)

logSecurity(string $event, array $detail = [], ?string $userId = null, ?string $userName = null): void
// Writes to data/{team}/logs/security.json.
// Entry: {id, ts, event, user_id, user_name, ip, ua, path, detail}
// LOG_MAX_SECURITY = 2000 entries

logIntegrationError(string $service, string $endpoint, string $error, array $context = []): void
// Calls logSecurity('integration_error', {service, endpoint, error, ...context})
```

#### Notification Helpers

```php
createNotification($userIds, string $type, string $title, ?string $body = null, array $meta = []): void
// Appends to notifications.json for each userId.
// Entry: {id, user_id, type, title, body, read:false, created_at, ...meta}

createNotificationForAdmins(string $type, string $title, ?string $body, ?int $postId, array $meta): void
// Finds all sm_admin/dev_sm in current team → createNotification for each.
```

#### Google Chat Card Sender

```php
sendGoogleChatCard(array $webhookUrls, array $card, string $source = 'chat-card'): array
// POST JSON card to each URL. Timeout=10s, SSL_VERIFYPEER=false.
// Returns {success, sent:int, failed:int, errors:string[], last_http_code:int}
```

#### Other Helpers

```php
genId(string $prefix = 'id'): string        // prefix_<12 hex chars> (random_bytes(6))
getBody(): array                             // json_decode(php://input) ?? []
getRequestHeader(string $name): string      // getallheaders() + $_SERVER fallback

monthlyFilename(string $prefix, ?string $month = null): string
// Returns e.g. "batch-records-2026-09.json"

listMonths(string $prefix): array
// Returns sorted months (newest first) that have files for prefix.

envFallback(string $key): string            // Re-parse .env on getenv() miss (cached static)
jiraEmail(): string                         // JIRA_EMAIL constant or envFallback
jiraToken(): string                         // JIRA_TOKEN constant or envFallback
jiraCredsReady(): bool                      // both non-empty
jiraAuthHeader(): string                    // 'Authorization: Basic ' + base64(email:token)
```

#### Team Provisioning

```php
initTeamDirectory(string $slug): void
// Creates data/{slug}/ with all operational files (board.json etc.),
// default-feature config files, logs/ directory, and menu-permissions.json.

featureDataFiles(): array
// Map of featureKey → [filenames to provision/copy].

defaultFeatures(): array
// ['dashboard','board','team-docs','sabai','schedule','learning']

_provisionFeatureFiles(string $featureKey, string $teamSlug): void
// Creates empty JSON files for a feature (idempotent).
```

---

## 2. Email API (`api/mail/send.php`)

### `POST /api/mail/send.php`

**Auth:** Any authenticated user  
**Data read:** `mail_config.json` (SMTP settings)  
**Data write:** `mail_logs.json` (max 2000 entries)  
**External:** Raw SMTP via cURL (`smtp://` or `smtps://` URL)

**Request Body:**
```json
{
  "to":          ["user@example.com"],
  "cc":          ["cc@example.com"],
  "bcc":         ["bcc@example.com"],
  "subject":     "string",
  "body":        "HTML or plain text string",
  "isHtml":      true,
  "useBranding": true,
  "attachments": [
    { "filename": "report.pdf", "mime": "application/pdf", "data": "<base64>" }
  ]
}
```

**Response:**
```json
{ "success": true, "data": { "sent": true, "to_count": 1, "cc_count": 0 } }
```

**Business Logic:**
- Validates all email addresses with `FILTER_VALIDATE_EMAIL`
- Builds MIME manually (no PHPMailer) — `multipart/related` for inline images, `multipart/mixed` for attachments
- Extracts `data:image/...;base64,...` from HTML body → replaces with `cid:` references → attaches as inline parts
- If `useBranding=true` and no `useBranding` key at all: calls `buildGradientEmail()` from `_branding.php` to wrap in admin-configurable gradient template
- Special: attaches `uploads/sm-logo-typewriter.gif` as CID when footer style = 'typewriter' and no public base URL configured
- SMTP config fields used: `smtp_host`, `smtp_port` (default 587), `smtp_encryption` ('tls'|'ssl'), `smtp_user`, `smtp_password`, `from_email`, `from_name`
- For TLS: `CURLUSESSL_ALL`; for SSL: `smtps://` scheme
- Timeout: 20 seconds
- Logs to `mail_logs.json` on both success and failure

**SMTP URL format:**
- TLS: `smtp://{host}:{port}` + `CURLUSESSL_ALL`
- SSL: `smtps://{host}:{port}`

**mail_config.json schema:**
```json
{
  "smtp_host": "smtp.example.com",
  "smtp_port": 587,
  "smtp_encryption": "tls",
  "smtp_user": "user@example.com",
  "smtp_password": "...",
  "from_email": "noreply@example.com",
  "from_name": "SOM-Portal",
  "email_footer_style": "typewriter",
  "email_public_base_url": "https://..."
}
```

---

## 3. Notifications API (`api/notifications/index.php`)

**Auth:** Any authenticated user  
**Data file:** `notifications.json` (team-scoped)

### `GET /api/notifications/`
Returns notifications for current user only (last 50, newest first).

**Response:**
```json
{
  "success": true,
  "data": {
    "notifications": [
      {
        "id": "notif_abc123",
        "user_id": "usr_...",
        "type": "mention",
        "title": "คุณถูก mention ใน post",
        "body": "...",
        "read": false,
        "created_at": "2026-09-30T10:00:00+07:00"
      }
    ],
    "unread": 3
  }
}
```

### `PATCH /api/notifications/`
Mark as read (single or all).

**Request Body:**
```json
{ "id": "notif_abc123" }   // or "all"
```

### `DELETE /api/notifications/`
Clear all read notifications for current user.

**Notification types used across system:** `mention`, `comment`, `leave_request`, `board_status`, `exam_reminder`, `announcement`

---

## 4. Presence API (`api/presence/index.php`)

**Auth:** Any authenticated user (super_viewer allowed to write via `allowSuperViewerWrite=true`)  
**Data file:** `presence.json` (team-scoped)

### `POST /api/presence/`
Heartbeat or offline update.

**Request Body:**
```json
{ "status": "online", "page": "board" }
```

Upserts `{user_id, status, page, last_seen: now}` in presence.json.

### `GET /api/presence/`
Returns users active in last 60 seconds.

**Response:**
```json
{
  "success": true,
  "data": {
    "online": [
      { "user_id": "usr_...", "name": "Alice", "avatar": null, "page": "board" }
    ]
  }
}
```

---

## 5. Search API (`api/search/index.php`)

**Auth:** Any authenticated user  
**Query params:** `?q=keyword` (min 2 chars), `?offset=0`  
**Data files read:** `board.json`, `sheets.json`, `users.json` (all team-scoped)  
**Rate limit group:** `search`

### `GET /api/search/?q=keyword`

**Response:**
```json
{
  "success": true,
  "data": {
    "results": [
      {
        "type": "post",
        "id": "post_abc",
        "title": "Payment service down",
        "excerpt": "...keyword context...",
        "meta": "author name",
        "badge": "Incident",
        "date": "2026-09-30T10:00:00+07:00",
        "pinned": false
      },
      { "type": "sheet", "id": "...", "title": "...", "url": "..." },
      { "type": "user",  "id": "...", "title": "Alice", "excerpt": "@alice" }
    ],
    "total": 12,
    "query": "keyword"
  }
}
```

**Sort order:** post → sheet → user; within type: date DESC  
**Limit:** 40 results + pagination via `offset`

---

## 6. Links API (`api/links/index.php`)

**Auth:** GET = any; POST/PUT/DELETE = `LEAD_ROLES`  
**Data files:** `links.json` (team-scoped for non-shared sections) + `data/sm/links.json` (shared sections)

### Shared Sections (SM-managed, everyone reads)
`LINKS_SHARED_SECTIONS = ['monitoring']`

### Valid Sections
`LINKS_VALID_SECTIONS = ['monitoring','test-service','batch-monitor','report']`

### `GET /api/links/[?section=monitoring]`
Merges team's own non-shared links + SM's shared-section links. Sorted by `order` field.

**Response:** `{ "success": true, "data": [{ "id", "name", "url", "section", "order", "icon" }] }`

### `POST /api/links/`
Create link.  
**Body:** `{ "name", "url", "section", "icon"?, "order"? }`  
Write to SM file if section is shared (requires `requireSmForShared()`).

### `PUT /api/links/?id=...`
Update link.

### `DELETE /api/links/?id=...`
Delete link.

**Link schema:**
```json
{
  "id": "lnk_abc123",
  "name": "Grafana Dashboard",
  "url": "https://grafana.internal/...",
  "section": "monitoring",
  "icon": "bar-chart",
  "order": 1,
  "created_at": "2026-09-30T10:00:00+07:00"
}
```

---

## 7. System Settings API (`api/system-settings/index.php`)

**Auth:** GET = any; PUT = `ADMIN_ROLES`  
**Data file:** `DATA_DIR/system-settings.json` (global, not team-scoped)

### `GET /api/system-settings/`
Returns merged defaults + saved settings.

**Default values:**
```json
{
  "site_name": "SOM-Portal",
  "site_tagline": "Service Operations Management",
  "session_timeout_hours": 8,
  "remember_me_days": 30,
  "password_expiry_days": 60,
  "password_history_count": 5,
  "max_login_attempts": 5,
  "lockout_minutes": 15,
  "api_rate_limit_requests": 120,
  "api_rate_limit_window_seconds": 60,
  "trash_retention_days": 30,
  "enable_markdown": true,
  "email_noti_chat_webhooks": [],
  "exam_reminder_chat_webhooks": []
}
```

### `PUT /api/system-settings/`
Update settings. Only known keys accepted. Webhook URLs validated: must pass `FILTER_VALIDATE_URL` + host must contain `chat.googleapis.com`.

---

## 8. Analytics API (`api/analytics/index.php`)

**Auth:** GET = `ALL_STAFF_ROLES`; POST = any auth  
**Data file:** `analytics_events.json` (team-scoped)

### `GET /api/analytics/[?type=activity_feed&limit=20]`
Returns usage analytics and activity feed.

**Query params:**
- `type=activity_feed` — recent activity stream (default limit 20)
- `type=stats` — aggregate usage stats

### `POST /api/analytics/`
Track an analytics event (client-side events).

**Body:** `{ "event": "page_view", "page": "board", "meta": {} }`

---

## 9. Service Severity API (`api/service-severity/index.php`)

**Auth:** GET = `ALL_STAFF_ROLES`; POST = `ADMIN_ROLES`  
**Data file:** `service-severity.json` (team-scoped; SM can sync from Google Sheet)

### `GET /api/service-severity/?action=list[&search=keyword]`

**Response:**
```json
{
  "success": true,
  "data": {
    "services": [
      { "name": "payment-service", "priority": "P1", "serviceGroup": "Core", "bu": "TH", "runway": "EKS" }
    ],
    "total": 142,
    "filtered": 10,
    "lastUpdated": "2026-09-30T10:00:00+07:00",
    "updatedBy": "admin"
  }
}
```

### `GET /api/service-severity/?action=stats`

**Response:**
```json
{
  "success": true,
  "data": {
    "total": 142,
    "byPriority": { "P1": 15, "P2": 42, "P3": 85 },
    "lastUpdated": "2026-09-30T10:00:00+07:00"
  }
}
```

### `POST /api/service-severity/` with `action=upsert`

**Body:**
```json
{
  "action": "upsert",
  "name": "payment-service",
  "priority": "P1",
  "serviceGroup": "Core",
  "bu": "TH",
  "runway": "EKS"
}
```

### `POST /api/service-severity/` with `action=import`

**Body:**
```json
{
  "action": "import",
  "services": [
    { "name": "...", "priority": "P1", "serviceGroup": "...", "bu": "..." }
  ]
}
```

### `POST /api/service-severity/` with `action=delete`

**Body:** `{ "action": "delete", "name": "service-name" }`

**service-severity.json schema:**
```json
{
  "services": {
    "payment-service": { "priority": "P1", "serviceGroup": "Core", "bu": "TH", "runway": "EKS" }
  },
  "count": 142,
  "lastUpdated": "2026-09-30T10:00:00+07:00",
  "updatedBy": "admin"
}
```

---

## 10. n8n Severity Sync (`api/n8n-severity-sync.php`)

**Auth:** `ADMIN_ROLES`  
**Data read:** `n8n_severity_config.json` (global), `service-severity.json`  
**Data write:** `service-severity.json`, `n8n_severity_last_sync.json`  
**External:** n8n webhook URL (POST `{}`)

### `GET /api/n8n-severity-sync.php`
Return last sync metadata.

**Response:**
```json
{
  "success": true,
  "data": {
    "lastSync": {
      "lastSyncedAt": "2026-09-30T10:00:00+07:00",
      "lastResult": { "added": 3, "updated": 1, "deleted": 0 }
    }
  }
}
```

### `POST /api/n8n-severity-sync.php`
Trigger sync.

**Flow:**
1. Load webhook URL from `n8n_severity_config.json`
2. POST `{}` to n8n webhook (timeout 60s)
3. n8n returns `[{name, priority, serviceGroup, bu}]` or `[{json:{...}}]` wrapper
4. Apply "sheet wins" strategy: add new, update changed, delete removed
5. Write merged result to `service-severity.json`
6. Write sync metadata to `n8n_severity_last_sync.json`

**Response:**
```json
{
  "success": true,
  "data": { "added": 3, "updated": 1, "deleted": 0, "total": 142, "lastSyncedAt": "..." }
}
```

**n8n_severity_config.json:**
```json
{ "webhook_url": "https://n8n.internal/webhook/severity-sync" }
```

---

## 11. Chat Proxy (`api/chat-proxy.php`)

**Auth:** Any authenticated user  
**External:** Google Chat webhook (direct HTTPS POST)

### `POST /api/chat-proxy.php`

**Request Body:**
```json
{ "webhook": "https://chat.googleapis.com/...", "message": "text" }
```

**Validation:** webhook must match `^https://chat\.googleapis\.com/`

**Response:** `{ "success": true, "data": { "sent": true } }`

**cURL settings:** timeout=15s, SSL_VERIFYPEER=false

---

## 12. Version / Deploy Detection (`api/version.php`)

**Auth:** None (public)  
**No data file** — reads file mtimes

### `GET /api/version.php`

**Response:**
```json
{
  "ok": true,
  "version": "abc123def456",
  "updated_at": 1727686800,
  "file_count": 12
}
```

**Tracked files** (mtime-based hash):
```
assets/js/theme.js, layout.js, api.js, auth.js, utils.js,
skeletons.js, analytics.js, analytics-features.js, maintenance.js
assets/css/style.css, dark.css, ui-themes.css
```

**Hash:** `substr(sha1(join('|', "file:mtime" pairs)), 0, 12)`  
**Client polls every 90 seconds.** If version differs from stored value → show "reload" toast.

---

## 13. Upload API (`api/upload.php`)

**Auth:** Required  
**CSRF:** Required  
**Rate limit group:** `upload`  
**Data write:** `uploads/` directory

### `POST /api/upload.php` (multipart/form-data, field: `image`)

**Validation:**
- Max size: `MAX_UPLOAD_SIZE` (5MB)
- MIME check: finfo → mime_content_type → magic bytes fallback
- Allowed types: `image/jpeg`, `image/png`, `image/gif`, `image/webp`
- Extension check via `api/security/FileScanner.php`

**Response:**
```json
{
  "success": true,
  "data": { "url": "/uploads/abc123.jpg", "filename": "abc123.jpg" }
}
```

---

## 14. SABai AI API (`api/ai/index.php`)

**Auth:** `requireAuth(false, true)` — super_viewer allowed  
**Method:** POST only  
**External:** Ollama HTTP API

### `POST /api/ai/`

**Request Body:**
```json
{ "message": "คำถาม (max 2000 chars)" }
```

**Ollama config:**
```
Model:   OLLAMA_MODEL constant (default: 'qwen2.5:7b')
Host:    OLLAMA_HOST constant  (default: 'http://localhost:11434')
URL:     {OLLAMA_HOST}/api/chat
Timeout: 120s (connect: 5s)
```

**Ollama request payload:**
```json
{
  "model": "qwen2.5:7b",
  "messages": [
    { "role": "system", "content": "<system prompt + context>" },
    { "role": "user",   "content": "<user message>" }
  ],
  "stream": false,
  "options": { "temperature": 0.3, "num_ctx": 8192 }
}
```

**System prompt:** Thai-language persona "ตุ้มเม้ง AI" for SOM team. Rules: only answer from internal data, no external knowledge, always Thai.

**Context building (`_aiContext`):**
Detects sections from question keywords, then reads:
- `board` → board.json: stats (by_status, by_type, top_posters) + last 20 posts
- `users` → users.json: stats (by_role) + active user list (username, role, email)
- `jenkins` → jenkins_servers.json: stats + server list (name, url, enabled)
- `templates` → templates.json: stats (by_issue_type) + template list
- `announcements` → announcements.json: active announcements only
- `links` → links.json: first 30 links
- `categories` → board_categories.json: full data

**Response:**
```json
{ "ok": true, "data": { "answer": "คำตอบเป็นภาษาไทย..." } }
```

**Error responses:**
- 400: `{ "ok": false, "message": "Invalid message" }`
- 503: `{ "ok": false, "message": "เชื่อมต่อ Ollama ไม่ได้..." }`
- 502: Bad Ollama response

**PHP timeout:** `set_time_limit(300)` (5 minutes)

---

## 15. Incident Launcher API (`api/incident-launcher/index.php`)

**Auth:** Required. Most actions: SM team only (`team === 'sm'`).  
**Data files:** `incident-launcher-config.json` (team-scoped SM), `board.json`, `templates.json`  
**External:** Jira REST API, Google Chat, LINE Notify, DingTalk, ACM Backoffice

### `GET /api/incident-launcher/?action=config`
Returns config. SM only.

**Response:** `{ "config": { ...config object... } }`

### `GET /api/incident-launcher/?action=impact_summary`
Delegates to `api/incident-launcher/impact.php`.

### `GET /api/incident-launcher/?action=jira_transitions&key=SMC-123`
Fetch Jira issue transitions. SM only.

**External:** `GET {JIRA_BASE_URL}/rest/api/3/issue/{key}/transitions`  
**Auth header:** `Authorization: Basic base64(email:token)` (Basic Auth)

### `GET /api/incident-launcher/?action=jira_create_meta&project=SMC&issuetype=Incident`
Fetch Jira issue create metadata (custom fields for a project+issuetype). SM only.

**External:** `GET {JIRA_BASE_URL}/rest/api/3/issue/createmeta?projectKeys=SMC&issuetypeNames=Incident&expand=projects.issuetypes.fields`

### `GET /api/incident-launcher/?action=jira_issue&key=SMC-123`
Fetch Jira issue summary/status. SM only.

**External:** `GET {JIRA_BASE_URL}/rest/api/3/issue/{key}?fields=summary,status,priority,assignee`

### `GET /api/incident-launcher/?action=bo_config_peek&application=X&key=Y`
Read a backoffice config property. SM only.

**External:** `GET /acm-backoffice-api-gateway/ops-service-maintenance-server/application/list` via `backofficeCall()` from `api/ma-status/_backoffice.php`

### `POST /api/incident-launcher/` with `action=webhook`
Single-webhook proxy (legacy). SM only.

**Body:** `{ "action": "webhook", "url": "https://chat.googleapis.com/...", "text": "..." }`

### `POST /api/incident-launcher/` with `action=notify_channel`
Notify a configured channel. SM only.

**Body:**
```json
{
  "action": "notify_channel",
  "channel_id": "ch_abc",
  "message": "Incident text",
  "thread_key": "optional-thread-key"
}
```

**Platforms supported:**
| Platform | Method |
|----------|--------|
| `googlechat` | POST JSON `{text}` to webhook URL; optional thread via `?messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD` |
| `line` | POST form-encoded to `https://notify-api.line.me/api/notify`, Bearer token auth |
| `dingtalk` | POST JSON `{msgtype:"text", text:{content:"..."}}` to webhook |
| `manual` | No HTTP call — copy-only |

### `POST /api/incident-launcher/` with `action=jira_do_transition`
Perform a Jira transition. SM only.

**Body:**
```json
{ "action": "jira_do_transition", "key": "SMC-123", "transition_id": "21", "fields": {} }
```

**External:** `POST {JIRA_BASE_URL}/rest/api/3/issue/{key}/transitions`

### `POST /api/incident-launcher/` with `action=bo_config_update`
Update a backoffice config value. SM only.

**Body:**
```json
{
  "action": "bo_config_update",
  "application": "payment-service",
  "key": "feature.flag.x",
  "value": "true",
  "environment": "production",
  "profile": "main"
}
```

**External:** `PUT /acm-backoffice-api-gateway/ops-service-maintenance-server/config/{app}/{env}/{profile}` via `backofficeCall()`

### `POST /api/incident-launcher/` with `action=save_config`
Save full config. SM only, admin/lead role required.

**incident-launcher-config.json schema:**
```json
{
  "chat_webhook_url": "...",
  "meet_main_url": "...",
  "meet_channel_ids": [],
  "jira_issue_type": "Monitoring",
  "jira_default_severity": "sev1",
  "jira_summary_tpl": "[INC] {service} - {description}",
  "jira_desc_tpl": "...",
  "jira_field_defaults": { "bu": [], "svc": [], "chn": [], "detected": "...", "third_party": "" },
  "partner_groups": [
    { "id": "grp_", "name": "...", "color": "#3b82f6", "to_emails": [], "cc_emails": [], "bcc_emails": [] }
  ],
  "templates": [
    { "id": "tpl_", "name": "...", "icon": "zap", "color": "#ef4444", "service": "", "severity": "sev1", "partner_group_ids": [], "jira_summary": "" }
  ],
  "channels": [
    { "id": "ch_", "name": "...", "platform": "googlechat", "auth": "webhook-url", "enabled": true }
  ],
  "ma_jobs": [
    { "id": "ma_", "name": "...", "type": "jenkins|rundeck|manual", "server_id": "", "job_path": "", "bo_configs": [], "enabled": true }
  ],
  "quick_links": [{ "id": "", "label": "", "icon": "link", "url": "" }],
  "jira_preset_fields": [{ "field_id": "", "label": "", "value": "" }],
  "sp_services": []
}
```

---

## 16. Teams API (`api/teams/index.php`)

**Auth:** GET = `ALL_STAFF_ROLES`; POST/PATCH = `SUPER_ADMIN_ROLE` only  
**Data file:** `teams.json` (global)

### `GET /api/teams/`
List teams. sm_admin sees only own team.

### `POST /api/teams/`
Create team. super_admin only.

**Body:**
```json
{ "slug": "ops", "name": "Ops Team", "features": ["board","ma-services"] }
```

Calls `initTeamDirectory(slug)` — creates all data files.

### `PATCH /api/teams/?id=...`
Update team (name, features, page_modes).

**teams.json entry schema:**
```json
{
  "id": "team-uuid",
  "slug": "ops",
  "name": "Ops Team",
  "features": ["board","ma-services"],
  "page_modes": { "jenkins-build": "read" },
  "created_at": "..."
}
```

### `POST /api/teams/copy-config.php`
Copy config files from SM to another team (snapshot). super_admin only.

**Body:**
```json
{ "team_slug": "ops", "feature": "ma-services", "overwrite": false }
```

Reads from `data/sm/{files}`, writes to `data/ops/{files}`. Cannot target 'sm'.

---

## 17. Menu Permissions API (`api/menu-permissions/index.php`)

**Auth:** GET = any; PUT = `ADMIN_ROLES`  
**Data file:** `menu-permissions.json` (team-scoped)

### `GET /api/menu-permissions/`

**Response (example):**
```json
{
  "success": true,
  "data": {
    "roles": {
      "sm_admin": "*",
      "sm_lead":  "*",
      "sm_user":  "*",
      "dev_user": [],
      "external": []
    },
    "always_visible": ["profile","change-password"]
  }
}
```

`"*"` = all menus visible. Array = explicit list.

### `PUT /api/menu-permissions/`
Update permissions map.

**Body:** Same structure as GET response.

---

## 18. Nav Groups API (`api/nav-groups/index.php`)

**Auth:** GET = any; PUT = `ADMIN_ROLES`  
**Data file:** `nav-groups.json` (team-scoped)

### `GET /api/nav-groups/[?role=sm_user]`
Returns nav group structure for a role.

**Response:**
```json
{
  "success": true,
  "data": {
    "groups": [
      {
        "id": "operations",
        "label": "Operations",
        "items": ["board","jira-templates","incident-launcher"]
      },
      {
        "id": "monitoring",
        "label": "Monitoring",
        "items": ["service-performance","restart-analyzer","alert-monitor"]
      }
    ]
  }
}
```

### `PUT /api/nav-groups/`
Update nav group definitions.
