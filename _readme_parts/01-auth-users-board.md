# Part 1 — Auth, Users, Board, Board-Comments, Board-Config, Stars

## Role Constants (helpers.php)

```
SUPER_ADMIN_ROLE  = 'super_admin'
ADMIN_ROLES       = ['super_admin', 'sm_admin', 'dev_sm']
LEAD_ROLES        = ['super_admin', 'sm_admin', 'dev_sm', 'sm_lead']
ALL_STAFF_ROLES   = ['super_admin', 'super_viewer', 'sm_admin', 'dev_sm', 'sm_lead', 'sm_user', 'dev_user', 'external']
GLOBAL_READ_ROLES = ['super_admin', 'super_viewer']
REPORT_READ_ROLES = ['super_admin', 'sm_admin', 'dev_sm', 'super_viewer']
```

## Config Constants (config.php / system-settings.json)

| Constant | Default | Source |
|----------|---------|--------|
| `JWT_EXPIRY` | 8 × 3600 = 28800s | `system-settings.json → session_timeout_hours` |
| `REMEMBER_ME_DAYS` | 30 | `system-settings.json → remember_me_days` |
| `PW_EXPIRY_DAYS` | 60 | `system-settings.json → password_expiry_days` |
| `PW_HIST_COUNT` | 5 | `system-settings.json → password_history_count` |
| `RL_MAX_ATTEMPTS` | 5 | `system-settings.json → max_login_attempts` |
| `RL_WINDOW_SECONDS` | 900 (15 min) | `system-settings.json → lockout_minutes` |
| `API_RL_MAX` | 120 | `system-settings.json → api_rate_limit_requests` |
| `API_RL_WINDOW` | 60 | `system-settings.json → api_rate_limit_window_seconds` |
| `APP_BASE_URL` | `http://localhost:8000` | env `APP_BASE_URL` or auto-detect |

---

## 1. Auth

### POST /api/auth/login.php

**Auth:** Public (no token required)

**Request Body:**
```json
{
  "username": "string (required)",
  "password": "string (required)",
  "remember_me": "boolean (optional, default false)"
}
```

**Business Logic:**
1. `rl_check(username)` — abort with 429 if username has ≥ 5 failed attempts within the lockout window
2. Case-insensitive username lookup in `data/users.json`
3. `verifyPassword()` — bcrypt verify, normalises `$2b$` → `$2y$` for legacy Python hashes
4. On failure: `rl_fail(username)` increments counter; logs `login_failed` to security log
5. On success: `rl_success(username)` resets counter
6. Checks `password_expired` (based on `password_changed_at` + `PW_EXPIRY_DAYS`)
7. Checks `must_reset_password` flag (admin-forced reset)
8. Issues JWT HS256. Expiry: `remember_me=true` → `REMEMBER_ME_DAYS × 86400`; else `JWT_EXPIRY`
9. Generates CSRF token via `CsrfProtector`
10. Resolves `team_features`, `team_feature_pages`, `team_page_modes` from `teams.json`; `super_admin`/`super_viewer` get `null` (no scoping)

**Data files read:** `data/users.json`, `data/teams.json`  
**Data files written:** `data/users.json` (only when `password_expired` flag needs persisting)

**Response (200):**
```json
{
  "success": true,
  "token": "eyJ...",
  "csrf_token": "abc123",
  "user": {
    "id": "usr_01HX...",
    "name": "Warapon Lea",
    "username": "warapon",
    "role": "sm_admin",
    "team": "sm",
    "team_features": ["board", "ma-services"],
    "team_feature_pages": [],
    "team_page_modes": { "ma-services": "full" },
    "first_login": false,
    "password_expired": false,
    "must_reset_password": false,
    "avatar_url": "https://...",
    "permissions": [],
    "is_genz": false
  },
  "message": "Login successful"
}
```

**Error responses:**
- `400` — missing username/password
- `401` — invalid credentials
- `429` — rate limit exceeded (`{"message":"บัญชีถูกล็อคในอีก X นาที"}`)

---

### POST /api/auth/logout.php

**Auth:** Required (all roles including `super_viewer`)

**Request Body:** none

**Business Logic:** Logs `logout` to activity + security log. Token revocation is client-side only (delete `som_token` from localStorage) — server is stateless.

**Response (200):**
```json
{ "success": true, "message": "Logged out" }
```

---

### GET /api/auth/me.php

**Auth:** Required (`requireAuth(true)` — allows expired/first_login tokens through for the password-change gate)

**Business Logic:** Reads `data/users.json`, finds by JWT `sub`, re-calculates `password_expired` live.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "usr_01HX...",
    "name": "Warapon Lea",
    "username": "warapon",
    "email": "warapon@company.com",
    "role": "sm_admin",
    "first_login": false,
    "password_expired": false,
    "must_reset_password": false,
    "team": "sm",
    "dev_subteam": null,
    "is_genz": false,
    "extra_pages": [
      { "page": "service-performance", "source_team": "ops" }
    ]
  }
}
```

---

### GET /api/auth/profile.php

**Auth:** Required (all roles including `super_viewer`)

**Response:** Same shape as me.php but adds extra contact fields:
```json
{
  "id": "...", "name": "...", "nickname": "...", "username": "...",
  "email": "...", "role": "...", "avatar_url": "...",
  "name_th": "วรพล เลา", "emp_id": "EMP001", "phone": "0812345678",
  "tmn_id": "tmn.warapon", "net_home": "192.168.1.0/24", "net_mobile": "10.0.0.0/8"
}
```

---

### PATCH /api/auth/profile.php

**Auth:** Required (all roles including `super_viewer`)

**Request Body (all fields optional — only include what's changing):**
```json
{
  "name": "string (1–60 chars)",
  "nickname": "string (max 30 chars)",
  "avatar_url": "string — data URI (data:image/png;base64,...) or https URL, max ~200KB",
  "email": "string — valid email, must be unique",
  "name_th": "string (max 80 chars)",
  "emp_id": "string (max 20 chars)",
  "phone": "string (max 20 chars)",
  "tmn_id": "string (max 20 chars)",
  "net_home": "string (max 100 chars)",
  "net_mobile": "string (max 50 chars)"
}
```

**Data files read/written:** `data/users.json`

**Response (200):** Updated profile object (same fields as GET profile)

---

### POST /api/auth/change-password.php

**Auth:** Required (all roles including `super_viewer`; also allows expired/first_login tokens)

**Request Body:**
```json
{
  "old_password": "string (required unless first_login=true or must_reset_password=true)",
  "new_password": "string (required, min 8 chars)",
  "confirm_password": "string (required, must match new_password)"
}
```

**Business Logic:**
1. Skips old_password check if `first_login=true` OR `must_reset_password=true`
2. Rejects if `new_password === current_password` (cannot reuse current)
3. Checks last `PW_HIST_COUNT` (default 5) hashes — rejects if match
4. Stores old hash into `password_history` (rolling window of `PW_HIST_COUNT`)
5. Clears `first_login`, `password_expired`, `must_reset_password` flags
6. Issues fresh JWT with cleared flags

**Data files read/written:** `data/users.json`

**Response (200):**
```json
{ "success": true, "token": "eyJ... (fresh JWT with cleared flags)", "message": "Password changed successfully" }
```

**Error responses:**
- `400` — new_password < 8 chars, mismatch, or reuse violation
- `401` — old_password incorrect

---

### GET /api/auth/my-activity.php

**Auth:** Required

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | int | 20 | Max records (capped at 1000) |
| `offset` | int | 0 | Skip N records |

**Business Logic:** Reads activity log file for current user's team (`data/<team>/logs/activity.json`), filters to `user_id === JWT.sub`.

**Data files read:** `data/<team>/logs/activity.json`

**Response (200):**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "action": "login",
        "ts": "2026-09-30T10:00:00+07:00",
        "created_at": "2026-09-30T10:00:00+07:00",
        "user_id": "usr_01HX...",
        "meta": { "username": "warapon", "role": "sm_admin" }
      }
    ],
    "total": 42
  }
}
```

---

## 2. Users (`/api/users/`)

**Data file:** `data/users.json` (global, not per-team)

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
  "password": "$2y$10$... (bcrypt, never returned to client)",
  "password_history": ["$2y$...", "..."],
  "password_changed_at": "2026-09-01T00:00:00+07:00",
  "first_login": false,
  "password_expired": false,
  "must_reset_password": false,
  "created_at": "2026-01-01T00:00:00+07:00",
  "created_by": "usr_...",
  "avatar_url": "https://...",
  "permissions": [],
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

**Auth:** Required

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `team` | string | Filter by team slug (super_admin/viewer: any team; sm_admin: only `dev` is allowed as override) |

**Response by role:**

| Caller role | What they get |
|-------------|--------------|
| `super_admin` / `super_viewer` | All users across all teams (or filtered by `?team=` / `X-Admin-Team` header). Full profile object. |
| `sm_admin` / `dev_sm` | Own team users only (+ `?team=dev` for dev users). Full profile object. |
| `sm_user` / `sm_lead` / `external` | Own team non-external users with `schedule_include=true`. Limited fields: `id, name, nickname, role` only. |

---

### POST /api/users/

**Auth:** ADMIN_ROLES + CSRF

**Request Body:**
```json
{
  "name": "string (required)",
  "username": "string (required, must be unique case-insensitive)",
  "email": "string (required, valid email — temp password is sent here)",
  "role": "sm_user | sm_lead | sm_admin | dev_sm | external | super_viewer | dev_user",
  "team": "string (required for super_admin; sm_admin is locked to own team)",
  "nickname": "string (optional)",
  "dev_subteam": "string (only for dev_user)",
  "permissions": ["page_slug", ...],
  "schedule_include": "boolean (default true, false for external/dev_user)",
  "course_include": "boolean (default true, false for external/dev_user)",
  "exam_include": "boolean (default true, false for external/dev_user)",
  "name_th": "string", "emp_id": "string", "phone": "string",
  "tmn_id": "string", "net_home": "string", "net_mobile": "string"
}
```

**Business Logic:**
- Generates temp password: `SOM_` + 6 random chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`
- Sends welcome email via SMTP **before** writing user — SMTP failure aborts creation (returns `SMTP_NOT_CONFIGURED` or `SMTP_SEND_FAILED` error)
- `dev_user` role → team forced to `"dev"`
- `super_viewer` role → team set to `null`
- `sm_admin` can only assign: `sm_user`, `sm_admin`, `dev_user`

**Response (200):**
```json
{
  "success": true,
  "data": { "id": "usr_...", "name": "...", "username": "...", "role": "...", "sent_to": "w*****n@company.com" },
  "message": "User created — temporary password sent to w*****n@company.com"
}
```

**Error codes:**
- `SMTP_NOT_CONFIGURED` (400) — SMTP not set up for this team
- `SMTP_SEND_FAILED` (500) — SMTP send error

---

### PUT /api/users/?id={id}

**Auth:** ADMIN_ROLES + CSRF

**Query Parameters:**
| Param | Type | Required |
|-------|------|----------|
| `id` | string | Yes |

**Request Body (all optional — only changed fields):**
```json
{
  "name": "string",
  "nickname": "string",
  "email": "string",
  "avatar_url": "data URI or https URL, max ~200KB",
  "role": "sm_user | sm_lead | sm_admin | dev_sm | external | dev_user",
  "dev_subteam": "string",
  "permissions": ["page_slug"],
  "schedule_include": "boolean",
  "course_include": "boolean",
  "exam_include": "boolean",
  "must_reset_password": "boolean",
  "extra_pages": [{ "page": "service-performance", "source_team": "ops" }],
  "name_th": "string", "emp_id": "string", "phone": "string",
  "tmn_id": "string", "net_home": "string", "net_mobile": "string"
}
```

**Business Logic:**
- Cannot change own role (returns 403)
- `extra_pages` — only settable by `super_admin`
- `dev_user` role change → team auto-set to `"dev"`
- Invalidates `users_list_*` cache entries

---

### DELETE /api/users/?id={id}

**Auth:** ADMIN_ROLES + CSRF

**Business Logic:** Cannot delete self (returns error). Permanent deletion — no soft-delete for users.

---

### PATCH /api/users/?id={id}

**Auth:** ADMIN_ROLES + CSRF  
**Action:** Admin-triggered password reset — creates a 24h reset token and sends email link.

**Response (200):**
```json
{
  "success": true,
  "data": { "sent_to": "w*****n@company.com", "expires_at": "2026-10-01T10:00:00+07:00" },
  "message": "ส่งลิงก์รีเซ็ตรหัสผ่าน..."
}
```

---

## 3. Board (`/api/board/`)

**Data files:** `data/<team>/board.json`, `data/<team>/stars.json`, `data/<team>/notifications.json`  
**Permission gate:** `requirePagePermission($payload, 'board')` — checked against `menu-permissions.json`  
**Rate limit group:** `'board'`

### Post Object Schema

```json
{
  "id": "post_01HX...",
  "title": "string (max 300 chars)",
  "content": "string (max 20,000 chars)",
  "mentions": [{ "id": "usr_...", "name": "Alice" }],
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
    {
      "edited_at": "...", "editor_id": "...", "editor_name": "...",
      "old_title": "...", "old_content": "...", "old_status": "open"
    }
  ],
  "author_id": "usr_...",
  "author_name": "Warapon",
  "author_role": "sm_admin",
  "created_at": "2026-09-30T10:00:00+07:00",
  "updated_at": "2026-09-30T10:00:00+07:00",
  "deleted_at": null,
  "deleted_by": null,
  "deleted_by_name": null,
  "starred": false
}
```

---

### GET /api/board/

**Auth:** Required + page permission  
**Rate limit:** `board` group

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `search` | string | — | Full-text search in title, content, author_name (logs `board_search` activity) |
| `board_type` | string | — | Filter by board category ID |
| `status` | string | — | Filter: `open`, `in_progress`, `resolved` |
| `author_id` | string | — | Filter to a specific author's posts |
| `starred` | any | — | If present, return only posts starred by current user |
| `since` | ISO datetime | — | **Special mode:** returns only posts created after this timestamp (used for real-time polling). Skips all other filters. |
| `limit` | int | 12 | Pagination: 1–50 |
| `offset` | int | 0 | Pagination offset |

**Special `?since=` mode** returns: `{ "count": N, "posts": [...] }` — skips all other filters.

**Normal response (200):**
```json
{
  "success": true,
  "data": {
    "items": [ /* post objects with starred:bool injected */ ],
    "total": 42
  }
}
```

**Sort order:** Pinned first → `created_at` descending. Soft-deleted posts always excluded.

---

### POST /api/board/

**Auth:** Required + page permission + CSRF  
**Rate limit:** `board` group

**Request Body:**
```json
{
  "title": "string (required, max 300 chars)",
  "content": "string (optional, max 20,000 chars)",
  "mentions": [{ "id": "usr_... | __all__", "name": "Alice" }],
  "status": "open | in_progress | resolved (default: open)",
  "image_url": "string | null",
  "board_type": "string — board category ID",
  "board_type_name": "string",
  "service_type_id": "string",
  "service_type_name": "string",
  "service_subtype_id": "string",
  "service_subtype_name": "string"
}
```

**Side effects:**
- Creates in-app notifications for `@mentioned` users (type: `mention`)
- `__all__` expands to all users in `users.json` (except self)

**Response (200):** Full post object

---

### PUT /api/board/?id={id}

**Auth:** Required + CSRF  
**Permission:** Author OR LEAD_ROLES

**Request Body (all optional):**
```json
{
  "title": "string",
  "content": "string",
  "image_url": "string | null",
  "status": "open | in_progress | resolved",
  "board_type": "string", "board_type_name": "string",
  "service_type_id": "string", "service_type_name": "string",
  "service_subtype_id": "string", "service_subtype_name": "string"
}
```

**Side effects:**
- Snapshots previous state into `edit_history` (rolling 20 entries max)
- If `status` changes, logs separate `board_status_change` activity entry

---

### PATCH /api/board/?id={id}

**Auth:** Required + CSRF  
**Permission:** LEAD_ROLES only  
**Action:** Toggle `pinned` (true → false, false → true)

---

### DELETE /api/board/?id={id}

**Auth:** Required + CSRF  
**Permission:** Author OR LEAD_ROLES  
**Action:** Soft-delete — sets `deleted_at`, `deleted_by`, `deleted_by_name`. Post remains in JSON but filtered from GET results.

> Hard-delete is done via the admin trash endpoint (separate page: `admin/trash.html` → `admin/board.html`)

---

## 4. Board Comments (`/api/board-comments/`)

**Data files:** `data/<team>/board-comments.json`, `data/<team>/notifications.json`, `data/<team>/board.json`  
**Rate limit group:** `'comments'`

### Comment Object Schema

```json
{
  "id": "cmt_01HX...",
  "post_id": "post_01HX...",
  "content": "string (max 5,000 chars)",
  "mentions": [{ "id": "usr_...", "name": "Alice" }],
  "author_id": "usr_...",
  "author_name": "Warapon",
  "created_at": "2026-09-30T10:00:00+07:00",
  "updated_at": null,
  "deleted_at": null,
  "deleted_by": null,
  "deleted_by_name": null
}
```

---

### GET /api/board-comments/

**Auth:** Required

**Query Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `post_id` | string | Yes (unless `counts`) | Return all non-deleted comments for this post, sorted by `created_at` ASC |
| `counts` | string | — | Comma-separated post IDs. Returns `{ "post_01HX": 3, ... }` batch count |

---

### POST /api/board-comments/

**Auth:** Required + CSRF  
**Rate limit:** `comments` group

**Request Body:**
```json
{
  "post_id": "string (required — must exist and not be deleted)",
  "content": "string (required, max 5,000 chars)",
  "mentions": [{ "id": "usr_... | __all__", "name": "Alice" }]
}
```

**Side effects:**
- Creates `mention` notifications for each @mentioned user
- Creates `comment` notification for post author (if not self and not already mentioned)
- `__all__` expands to all users

**Response:** Full comment object

---

### PATCH /api/board-comments/?id={id}

**Auth:** Required + CSRF  
**Permission:** Author only

**Request Body:**
```json
{ "content": "string (required, max 5,000 chars)" }
```

Sets `updated_at`.

---

### DELETE /api/board-comments/?id={id}

**Auth:** Required + CSRF  
**Permission:** Author OR LEAD_ROLES  
**Action:** Soft-delete (sets `deleted_at`, `deleted_by`, `deleted_by_name`)

---

## 5. Board Config (`/api/board-config/`)

**Data files:** `data/<team>/board_categories.json`, `data/<team>/board_service_types.json`

### GET /api/board-config/

**Auth:** Required

**Response:**
```json
{
  "success": true,
  "data": {
    "categories": [
      { "id": "bcat_01HX...", "name": "Incident", "order": 1 }
    ],
    "service_types": [
      {
        "id": "bst_01HX...", "name": "Payment", "order": 1,
        "subtypes": [
          { "id": "bsst_01HX...", "name": "Settlement", "order": 1 }
        ]
      }
    ]
  }
}
```

---

### POST /api/board-config/?kind={kind}&parent={parent_id}

**Auth:** Required + CSRF

**Query Parameters:**
| Param | Value | Auth required |
|-------|-------|--------------|
| `kind=category` | Add board tab/category | LEAD_ROLES |
| `kind=service_type` | Add top-level service type | Any authenticated |
| `kind=subtype` + `parent={id}` | Add subtype to existing service_type | Any authenticated |

**Request Body:**
```json
{ "name": "string (required)" }
```

---

### PUT /api/board-config/?id={id}

**Auth:** Required + CSRF + LEAD_ROLES  
**Action:** Rename any item (searches categories, service_types, subtypes by ID)

**Request Body:**
```json
{ "name": "string (required)" }
```

---

### DELETE /api/board-config/?id={id}

**Auth:** Required + CSRF + LEAD_ROLES  
**Action:** Delete item by ID (searches categories → service_types → subtypes)

---

## 6. Stars (`/api/stars/`)

**Data files:** `data/<team>/stars.json`, `data/<team>/board.json`  
**Rate limit group:** `'stars'`

### GET /api/stars/

**Auth:** Required  
**Response:** Array of post IDs starred by current user

```json
{ "success": true, "data": ["post_01HX...", "post_02HX..."] }
```

---

### POST /api/stars/

**Auth:** Required + CSRF  
**Rate limit:** `stars` group

**Request Body:**
```json
{ "post_id": "string (required — must exist and not be deleted)" }
```

**Idempotent:** Already-starred post returns success without duplicating.

---

### DELETE /api/stars/?post_id={post_id}

**Auth:** Required + CSRF

**Query Parameters:**
| Param | Required |
|-------|----------|
| `post_id` | Yes |

Removes star for current user only (other users' stars not affected).
