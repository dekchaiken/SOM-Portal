# Jira & Jenkins — Detailed API Spec

---

## ── Constants (api/config.php) ────────────────────────────────────────────────

```
JIRA_BASE_URL    = 'https://truemoney.atlassian.net'   (hardcoded)
JIRA_PROJECT_KEY = 'SMC'                               (hardcoded)
JIRA_EMAIL       = env('JIRA_EMAIL')
JIRA_TOKEN       = env('JIRA_TOKEN')
GRAFANA_URL      = env('GRAFANA_URL') ?: 'https://grafana-thanos.truemoney.com'
GRAFANA_TOKEN    = env('GRAFANA_SERVICE_ACCOUNT_TOKEN')
GRAFANA_ORG_ID   = env('GRAFANA_ORG_ID') ?: '2'
GRAFANA_DS_UID   = env('GRAFANA_DATASOURCE_UID') ?: 'e4b184ea-3a40-4b6a-b6cb-fa6f2ba17c1e'
OLLAMA_HOST      = env('OLLAMA_HOST') ?: 'http://localhost:11434'
OLLAMA_MODEL     = env('OLLAMA_MODEL') ?: 'qwen2.5:7b'
APP_BASE_URL     = env('APP_BASE_URL') | auto-detect from HTTP_HOST | 'http://localhost:8000'
JWT_EXPIRY       = system-settings.json session_timeout_hours * 3600   (default 8h)
HOST_COOLDOWN_TTL = 30  (seconds — circuit breaker window)
```

## ── Role Constants (api/helpers.php) ─────────────────────────────────────────

```php
SUPER_ADMIN_ROLE = 'super_admin'
ADMIN_ROLES      = ['super_admin', 'sm_admin', 'dev_sm']
LEAD_ROLES       = ['super_admin', 'sm_admin', 'dev_sm', 'sm_lead']
ALL_STAFF_ROLES  = ['super_admin', 'super_viewer', 'sm_admin', 'dev_sm', 'sm_lead', 'sm_user', 'dev_user', 'external']
GLOBAL_READ_ROLES = ['super_admin', 'super_viewer']
REPORT_READ_ROLES = ['super_admin', 'sm_admin', 'dev_sm', 'super_viewer']
```

---

## 1. Jira Integration

### 1.1 Create Issue

**`POST /api/jira/create.php`**

Auth: `requireAuth()` (any authenticated user)

Request body:
```json
{
  "summary": "string (required)",
  "description": "string (plain text — converted to ADF on server)",
  "fields": {
    "issuetype": "Bug | Task | Story | ...",
    "customfield_17026": "2026-09-30T10:00:00.000+0700 | 'auto'",
    "customfield_17031": "string (select — Incident Launcher field)",
    "customfield_17016": "string (select)",
    "customfield_17238": "string (select)",
    "customfield_17066": "string (array — comma-separated)",
    "customfield_17024": "string (array)",
    "customfield_17023": "string (array)",
    "customfield_17019": "string (single-select)",
    "customfield_17030": "string (single-select)",
    "customfield_17058": {"value": "...", "child": {...}}
  }
}
```

Response `201`:
```json
{
  "success": true,
  "data": {
    "issue_key": "SMC-123",
    "issue_url": "https://truemoney.atlassian.net/browse/SMC-123"
  }
}
```

Response `422` (Jira rejected):
```json
{
  "success": false,
  "message": "field: error message | ...",
  "jira_errors": {},
  "jira_messages": [],
  "jira_payload": {}
}
```

External API:
- `POST https://truemoney.atlassian.net/rest/api/3/issue`
- Header: `Authorization: Basic base64(JIRA_EMAIL:JIRA_TOKEN)`
- Content-Type: `application/json`
- Timeout: 15s

Field type mapping (from `jira_config.json`):
| `field_type` | Jira payload format |
|---|---|
| `text` | `"plain string"` |
| `select` | `{"value": "..."}` |
| `array` | `[{"value": "..."}, ...]` (comma-split input) |
| `fault_start` | ISO-8601 datetime string (`auto` → server fills `now`) |

Side effects: `logActivity('jira_create_ticket', {issue_key, summary})`

---

### 1.2 Get Issue Types

**`GET /api/jira/issue-types.php`**

Auth: `requireAuth()`

Calls Jira: `GET {JIRA_BASE_URL}/rest/api/3/issue/createmeta?projectKeys=SMC`

Response:
```json
{
  "success": true,
  "data": [
    { "id": "10001", "name": "Bug", "iconUrl": "https://..." },
    ...
  ]
}
```

---

### 1.3 Get All Custom Fields

**`GET /api/jira/fields.php`**

Auth: `requireAuth()`

Calls Jira: `GET {JIRA_BASE_URL}/rest/api/3/field`

Response: array of custom fields only (`id` starts with `customfield_`):
```json
{
  "success": true,
  "data": [
    { "id": "customfield_17026", "name": "Fault Start", "type": "datetime" },
    ...
  ]
}
```

---

### 1.4 Get Issue Detail + Transitions

**`GET /api/jira/issue-detail.php?key=SMC-123`**

Auth: `requireAuth()` + `requireRole(ALL_STAFF_ROLES)`

Calls Jira (parallel):
1. `GET {JIRA_BASE_URL}/rest/api/3/issue/SMC-123?fields=*all&expand=renderedFields,names`
2. `GET {JIRA_BASE_URL}/rest/api/3/issue/SMC-123/transitions`

Response:
```json
{
  "success": true,
  "data": {
    "issue": { ...full Jira fields... },
    "transitions": [
      { "id": "31", "name": "In Progress", "to": { "name": "In Progress", "statusCategory": {...} } }
    ]
  }
}
```

---

### 1.5 Transition Issue Status

**`POST /api/jira/transition.php`**

Auth: `requireAuth()` + `requireRole(ALL_STAFF_ROLES)`

Request body:
```json
{
  "key": "SMC-123",
  "transitionId": "31",
  "fields": {
    "comment": "optional plain text — moved to update.comment (ADF) automatically"
  }
}
```

Calls Jira: `POST {JIRA_BASE_URL}/rest/api/3/issue/SMC-123/transitions`
- Jira returns `204 No Content` on success

Response `200`:
```json
{ "success": true, "data": { "transitioned": true } }
```

Response `422` (fields required):
```json
{
  "success": false,
  "message": "...",
  "missingFields": ["Fault End", "Resolution"],
  "code": "MISSING_FIELDS"
}
```

Side effects: `logActivity('jira_transition', {key, transitionId})`

---

### 1.6 Assign Issue

**`POST /api/jira/assign.php`**

Auth: `requireAuth()` + `requireRole(ALL_STAFF_ROLES)`

Request body:
```json
{
  "key": "SMC-123",
  "accountId": "abc123..." 
}
```
Pass `accountId: null` to unassign.

Calls Jira: `PUT {JIRA_BASE_URL}/rest/api/3/issue/SMC-123/assignee`
- Returns `204 No Content` on success

Side effects: `logActivity('jira_assign', {key, accountId})`

---

### 1.7 Add Comment

**`POST /api/jira/add-comment.php`**

Auth: `requireAuth()` + `requireRole(ALL_STAFF_ROLES)`

Request body:
```json
{
  "key": "SMC-123",
  "body": "plain text comment\nsecond line"
}
```

Converts plain text → ADF (each newline = new paragraph).

Calls Jira: `POST {JIRA_BASE_URL}/rest/api/3/issue/SMC-123/comment`
- Returns `201` with `{ "id": "comment-id", "created": "..." }`

Side effects: `logActivity('jira_add_comment', {key, comment_id})`

---

### 1.8 Get Incidents List (legacy endpoint)

**`GET /api/jira/incidents.php`**

Auth: none (raw PHP — no helpers.php `requireAuth`)

Query params:
| Param | Type | Description |
|---|---|---|
| `maxResults` | int | Max 1000, default 100 |
| `fromDate` | date | `YYYY-MM-DD` filter on `created` |
| `toDate` | date | `YYYY-MM-DD` filter |
| `days` | int\|'all' | Last N days (ignored when `search` is set) |
| `search` | string | Full-text in `summary` field (wildcard prefix `~`) |

JQL: `"Ticket category" = Incidents AND project = TJCR AND issuetype in ("Sub-incidents","TH incident") ORDER BY created DESC`

Calls Jira: `GET {JIRA_BASE_URL}/rest/api/3/search/jql?jql=...&maxResults=...&fields=summary,created,status,assignee,customfield_17031,customfield_17016`

⚠️ Note: credentials hardcoded (not from env) — legacy file.

---

### 1.9 Jira Config (Custom Field Mappings)

**File: `api/jira-config/index.php`**  
**Data: SM-shared `data/sm/jira_config.json`**

```json
{
  "categories": [{ "id": "c_xxx", "name": "Incident" }],
  "issue_types": [{ "id": "it_xxx", "name": "Bug" }],
  "custom_fields": [
    {
      "id": "cf_xxx",
      "field_id": "customfield_17026",
      "label": "Fault Start",
      "placeholder": "auto",
      "field_type": "fault_start | text | select | array",
      "enabled": true,
      "order": 1
    }
  ]
}
```

| Method | Query | Auth | Action |
|---|---|---|---|
| GET | — | any auth | Return full config |
| POST | — | `requireSmForShared()` + `LEAD_ROLES` | Add category/issue_type/custom_field |
| PUT | `?id=xxx` | `requireSmForShared()` + `LEAD_ROLES` | Update item |
| DELETE | `?id=xxx` | `requireSmForShared()` + `LEAD_ROLES` | Delete item |

POST body for `kind=custom_field`:
```json
{
  "kind": "custom_field",
  "field_id": "customfield_12345",
  "label": "Squad",
  "placeholder": "",
  "field_type": "text | select | array | fault_start",
  "enabled": true
}
```

---

### 1.10 Jira Templates

**File: `api/templates/index.php`**  
**Data: SM-shared `data/sm/templates.json`**

Access: teams need feature `jira-templates` or `jira-templates-shared` in `teams.json`

Template schema:
```json
{
  "id": "tpl_xxx",
  "name": "Production Incident",
  "category": "Incident",
  "service_type_id": "svc_xxx",
  "service_subtype_id": "sub_xxx",
  "summary": "[INCIDENT] {service_name}",
  "fields": {
    "issuetype": "Bug",
    "customfield_17026": "auto",
    "customfield_17031": "Production"
  },
  "created_at": "2026-09-01T00:00:00+07:00",
  "created_by": "user-uuid",
  "author_name": "John"
}
```

| Method | Query | Auth | Action |
|---|---|---|---|
| GET | — | any auth + team feature check | List all templates (sorted by created_at desc) |
| POST | — | `requireSmForShared()` + CSRF | Create template |
| PUT | `?id=xxx` | `requireSmForShared()` + CSRF | Update template |
| DELETE | `?id=xxx` | `requireSmForShared()` + CSRF + `LEAD_ROLES` | Delete template |

---

### 1.11 Jira Requests Inbox

**File: `api/jira-requests/index.php`**  
**JQL constant:** `project = SMC AND issuetype = "Requests SOM Portal" ORDER BY created DESC`  
**Max results:** 50

Auth: SM team OR role in `['sm_admin','sm_lead','sm_user','dev_sm','super_admin','super_viewer']`

Actions (via `?action=` query or POST body `action`):

| Action | Method | Params | Description |
|---|---|---|---|
| `list` (default) | GET | — | JQL search, returns sorted issue list |
| `detail` | GET | `?key=SMC-xxx` | Full issue + available transitions |
| `assign` | POST | `{key}` | Assign to self (resolves `/rest/api/3/myself` first) — owner only |
| `transition` | POST | `{key, transitionId}` | Change issue status — owner only |
| `comment` | POST | `{key, text}` | Add ADF comment — owner only |

Owner-only actions (`INBOX_OWNER = 'warapon.lea'`) — `username` from JWT payload must match.

List response:
```json
{
  "success": true,
  "data": {
    "issues": [
      {
        "key": "SMC-456",
        "summary": "...",
        "status": "Open",
        "status_cat": "new | indeterminate | done",
        "priority": "High",
        "created": "...",
        "updated": "...",
        "reporter_name": "Alice",
        "reporter_email": "alice@...",
        "reporter_avatar": "https://...",
        "assignee_name": "Bob",
        "is_assigned": true,
        "url": "https://truemoney.atlassian.net/browse/SMC-456"
      }
    ],
    "total": 42,
    "open_count": 5
  }
}
```

---

## 2. Jenkins Integration

### 2.1 Host Cooldown Circuit Breaker

**Functions in `api/helpers.php`:**

```
HOST_COOLDOWN_TTL  = 30 seconds
HOST_COOLDOWN_FILE = 'host-cooldown.json'  (DATA_DIR root, not per-team)
```

```php
hostCooldownActive(string $host): ?array
// Returns null if no active cooldown
// Returns {reason, fail_at, expires_at} if host is in cooldown

hostCooldownMark(string $host, string $reason): void
// Sets host cooldown with flock(LOCK_EX)
// GC entries older than TTL*4

hostCooldownClear(string $host): void
// Remove cooldown entry (used after updating IP override)
```

Triggered automatically in `jenkinsRequestFull()` when:
- `curl_error !== ''`
- HTTP code === 0
- HTTP code >= 500

---

### 2.2 Jenkins Server CRUD

**File: `api/jenkins-servers/index.php`**  
**Data: SM-shared `data/sm/jenkins_servers.json`** (all teams read same config)  
Auth: `ADMIN_ROLES`

Server schema:
```json
{
  "id": "jsrv_xxx",
  "display": "Production Jenkins",
  "base_url": "https://jenkins.internal.example.com",
  "auth_mode": "token | cookie",
  "auth_user": "jenkins-user",
  "auth_token": "api-token-string",
  "auth_cookie": "JSESSIONID=abc123...",
  "enabled": true,
  "order": 1,
  "job_rules": [
    { "pattern": ".*-test.*", "type": "ignore | remark" }
  ],
  "ip_override": "10.1.2.3"
}
```

| Method | Query | Auth | Action |
|---|---|---|---|
| GET | — | `ADMIN_ROLES` | List all servers (sorted by order) |
| POST | — | `ADMIN_ROLES` + `requirePageMode('jenkins-servers')` + CSRF | Create server |
| PUT | `?id=xxx` | `ADMIN_ROLES` + `requirePageMode` + CSRF | Update server |
| DELETE | `?id=xxx` | `ADMIN_ROLES` + `requirePageMode` + CSRF | Delete server |

On create/update with `ip_override`: `hostCooldownClear(host)` called to allow immediate probe.

---

### 2.3 Jenkins Proxy (Read-only API pass-through)

**File: `api/jenkins-proxy/index.php`**  
Auth: any authenticated user

**Request flow in `jenkinsRequestFull()`:**
1. `hostCooldownActive(host)` — return 503 if in cooldown
2. Build cURL with auth (token = `Authorization: Basic base64(user:token)` | cookie = `Cookie: value`)
3. `CURLOPT_FOLLOWLOCATION = false` — must read `Location` header for queue item
4. `applyDnsOverrides($ch, $url)` — inject `CURLOPT_RESOLVE` from `data/dns-overrides.json`
5. On error/timeout → `hostCooldownMark(host, reason)`

#### GET — Proxy read-only Jenkins API

`GET /api/jenkins-proxy/?server={server_id}&path={jenkins_path}`

| Param | Required | Description |
|---|---|---|
| `server` | yes | Server ID from `jenkins_servers.json` |
| `path` | yes | Must end with `/api/json` (enforced) |
| `tree` | no | Jenkins tree filter (forwarded as-is) |
| `depth` | no | Jenkins depth param |

Security:
- Path must end with `/api/json` (read-only guard)
- Path must NOT contain `..` or `<>"'\s`

Forwards to: `{server.base_url}{path}?tree=...&depth=...`

Response: raw Jenkins JSON, wrapped in `{success:true, data: {...}}`

Error responses:
- `401` → `"Jenkins rejected credentials — token may be invalid or expired"` (422)
- `403` → `"Jenkins access denied — cookie/session may have expired"` (422)
- `404` → `"Jenkins path not found (404)"` (404)
- `200` but invalid JSON → `"Jenkins returned invalid JSON — may be a login redirect page"` (502)

#### GET ?list=1 — Server list

`GET /api/jenkins-proxy/?list=1`

Returns: `[{id, display, base_url, job_rules}]`

#### POST ?action=build — Trigger build

`POST /api/jenkins-proxy/?action=build`

Request body:
```json
{
  "server": "jsrv_prod",
  "path": "/job/payment/job/deploy",
  "params": {
    "BRANCH": "main",
    "ENV": "prod"
  }
}
```

Flow:
1. Validate job path: must match `#^(/job/[A-Za-z0-9_.%+\-]+)+$#`
2. Fetch CSRF crumb: `GET {base_url}/crumbIssuer/api/json`
3. POST to `{base_url}{path}/buildWithParameters` (or `/build` if no params)
4. Success: Jenkins returns `201 Created` (or `200 | 302`)

Response: `{success: true, data: {queued: true}}`

Side effects: `logActivity('jenkins_build_trigger', {server, job})`

---

### 2.4 Jenkins Build (Advanced: Maker/Checker + Approval)

**File: `api/jenkins-build/index.php`**  
**Data: `data/{team}/jenkins-build-tools.json`** (per-team)  
**Data: `data/{team}/jenkins-build-history.json`**, `jenkins-build-approvals.json`

Feature gate: `requireTeamFeature($payload, 'jenkins-build')`

#### External user roles (jb_role field on user)
| jb_role | Can submit | Can approve |
|---|---|---|
| `maker` | ✅ | ❌ |
| `checker` | ❌ | ✅ |
| `admin` | ✅ | ✅ |

Internal roles (`sm_admin`, `sm_lead`, `dev_sm`, `super_admin`): can do both.

#### Tool schema (`jenkins-build-tools.json` entry):
```json
{
  "id": "tool_xxx",
  "name": "Deploy Payment",
  "server_id": "jsrv_prod",
  "job_path": "/job/payment/job/deploy",
  "params": [
    { "key": "BRANCH", "label": "Branch", "required": true, "pattern": "^[a-z0-9/_-]+$" },
    { "key": "ENV", "label": "Environment", "required": true }
  ],
  "auto_params": { "updated_by": "username" },
  "requires_approval": false
}
```

#### Endpoints

| Method | Query/Body | Description |
|---|---|---|
| GET | — | List tools + server names + `can_admin` flag |
| GET | `?history=1` | Build history (auto-syncs live builds via poll) |
| GET | `?approvals=1` | Pending approval queue |
| GET | `?action=status&tool_id=X&queue_id=Y` | Poll Jenkins queue/build status |
| POST | `{action:'submit', tool_id, params:{...}}` | Validate params → trigger or queue for approval |
| POST | `{action:'approve', approval_id}` | Checker approves → triggers actual build |
| POST | `{action:'reject', approval_id}` | Checker rejects |

#### Build trigger flow (jb_triggerBuild):
1. Fetch CSRF crumb from `{base_url}/crumbIssuer/api/json`
2. URL-encode each path segment (handle pre-encoded paths)
3. POST to `/buildWithParameters` (or `/build`) with `application/x-www-form-urlencoded`
4. If `400` returned and no params: retry with `json={}` body
5. Read `Location` header → extract `queue_id` from `/queue/item/{id}/`

#### Status poll flow (jb_pollStatus):
1. `GET {base_url}/queue/item/{queue_id}/api/json`
   - If `executable.url` present → build started → check build endpoint
2. `GET {build_url}/api/json` → `{building, result, number, duration}`
3. Returns: `{status: 'In Queue'|'Building'|'Finished', progress: 0-100, result: 'SUCCESS'|'FAILURE'|null}`

---

### 2.5 Jenkins Portal (Unbind Tool)

**File: `api/jenkins-portal/index.php`**  
**Data: `data/{team}/jenkins-portal-tools.json`**, `jenkins-portal-history.json`

Feature gate: `requireTeamFeature($payload, 'jenkins-portal')`

Same maker/checker pattern as Jenkins Build.

| Endpoint | Description |
|---|---|
| `GET /api/jenkins-portal/` | Config (tools, apps, stats, can_admin) |
| `GET ?history=1` | Build history (team-scoped) |
| `GET ?logs=1` | Raw build logs (admin) |
| `GET ?sessions=1` | Login sessions (admin) |
| `GET ?users=1` | Portal users (admin, team-scoped) |
| `GET ?status=1` | Live Jenkins job status |
| `GET ?action=status&queue_id=X` | Poll triggered build |
| `POST {action:'trigger', tool_id, params}` | Validate → trigger |
| `POST {action:'add_app'\|'update_app'\|'delete_app'}` | Apps CRUD (admin) |
| `POST {action:'create_user'\|'update_user'\|...}` | User CRUD (admin, jenkins team only) |
| `POST {action:'clear_history'}` | Wipe build history (admin) |

Portal user schema:
```json
{
  "id": "u_xxx",
  "username": "alice",
  "display_name": "Alice",
  "role": "maker | checker | admin",
  "team": "payment",
  "enabled": true
}
```

---

### 2.6 Health Check

**File: `api/health/index.php`**  
Auth: `requireAuth()` + `requireRole(ALL_STAFF_ROLES)`

`GET /api/health/`

| Param | Description |
|---|---|
| `?fresh=1` | Bypass 60s cache, force re-check |

Cache: `data/health_cache.json`, TTL 60s

Checks performed:
1. **SMTP** — config existence check only (no connection test)
2. **Jira** — `GET {JIRA_BASE_URL}/rest/api/2/myself` (Basic Auth, timeout 5s)
3. **Jenkins** (each server) — `GET {base_url}/api/json` (token/cookie auth, timeout 5s, with cooldown)

Response:
```json
{
  "success": true,
  "data": {
    "checked_at": "2026-09-30T10:00:00+07:00",
    "services": {
      "smtp": { "name": "SMTP", "status": "ok | not_configured" },
      "jira": { "name": "Jira", "status": "ok | error | timeout | cooldown", "latency_ms": 120 },
      "jenkins": [
        {
          "id": "jsrv_prod",
          "display": "Production Jenkins",
          "status": "ok | error | timeout | cooldown",
          "latency_ms": 85,
          "detail": "optional error string"
        }
      ]
    }
  }
}
```

Status values: `ok | error | timeout | not_configured | cooldown`

Side effects: `logActivity('health_check', {...})` — only for ADMIN_ROLES

---

## 3. Data File Reference

| File | Location | Owner | Reader |
|---|---|---|---|
| `jenkins_servers.json` | `data/sm/` (SM-shared) | SM | All teams |
| `jira_config.json` | `data/sm/` (SM-shared) | SM | All teams |
| `templates.json` | `data/sm/` (SM-shared) | SM | Teams with feature |
| `jenkins-build-tools.json` | `data/{team}/` | Each team | Same team |
| `jenkins-build-history.json` | `data/{team}/` | Each team | Same team |
| `jenkins-build-approvals.json` | `data/{team}/` | Each team | Same team |
| `jenkins-portal-tools.json` | `data/{team}/` | Each team | Same team |
| `host-cooldown.json` | `data/` (global) | System | System |
| `health_cache.json` | `data/` (global) | System | System |

---

## 4. Jenkins Auth Methods

### Token Auth
```
Authorization: Basic base64(auth_user:auth_token)
```

### Cookie Auth
```
Cookie: {auth_cookie value}
```
Cookie string is stored raw in `jenkins_servers.json.auth_cookie` — typically `JSESSIONID=abc...` or full cookie string.

### CSRF Crumb (Jenkins)
Required by some Jenkins instances before POST:
```
GET {base_url}/crumbIssuer/api/json
→ { "crumbRequestField": "Jenkins-Crumb", "crumb": "abc123" }
→ Add header: Jenkins-Crumb: abc123
```
If server doesn't require it → returns 404 → skip crumb.

### DNS Override
`data/dns-overrides.json`: `{ "jenkins.internal.example.com": "10.1.2.3" }`

Applied via `CURLOPT_RESOLVE`: `["hostname:443:10.1.2.3", "hostname:80:10.1.2.3"]`

Bypasses system DNS — used when Jenkins is reachable by IP but hostname doesn't resolve (DRP/failover).

---

## 5. Common Jira API Paths Used

| SOM Use | Jira REST path | Method |
|---|---|---|
| Create issue | `/rest/api/3/issue` | POST |
| Get issue detail | `/rest/api/3/issue/{key}?fields=*all&expand=renderedFields,names` | GET |
| Get transitions | `/rest/api/3/issue/{key}/transitions` | GET |
| Execute transition | `/rest/api/3/issue/{key}/transitions` | POST |
| Assign issue | `/rest/api/3/issue/{key}/assignee` | PUT |
| Add comment | `/rest/api/3/issue/{key}/comment` | POST |
| Get custom fields | `/rest/api/3/field` | GET |
| Get issue types | `/rest/api/3/issue/createmeta?projectKeys=SMC` | GET |
| Search issues (JQL) | `/rest/api/3/search/jql?jql=...` | GET |
| Get current user | `/rest/api/2/myself` | GET |
| Search users | `/rest/api/3/user/search?query=...` | GET |
| Get field options | `/rest/api/3/field/{field_id}/context/{ctx_id}/option` | GET |
| Attach file | `/rest/api/3/issue/{key}/attachments` | POST (multipart) |

---

## 6. Environment Variables Summary

| Variable | Default | Used by |
|---|---|---|
| `JWT_SECRET` | FALLBACK_CHANGE_ME... | All auth |
| `JIRA_EMAIL` | — | All Jira calls |
| `JIRA_TOKEN` | — | All Jira calls |
| `GRAFANA_URL` | `https://grafana-thanos.truemoney.com` | Service Performance, Restart Analyzer, Begin-Grafana |
| `GRAFANA_SERVICE_ACCOUNT_TOKEN` | — | Grafana API calls |
| `GRAFANA_ORG_ID` | `2` | Grafana API calls |
| `GRAFANA_DATASOURCE_UID` | `e4b184ea-3a40-4b6a-b6cb-fa6f2ba17c1e` | Prometheus datasource proxy |
| `OLLAMA_HOST` | `http://localhost:11434` | SABai AI chatbot |
| `OLLAMA_MODEL` | `qwen2.5:7b` | SABai AI chatbot |
| `APP_BASE_URL` | auto-detect | Email links, password reset |
| `RESTART_MONITOR_UPLOAD_TOKEN` | — | Cron upload endpoint (shared secret, no JWT) |
