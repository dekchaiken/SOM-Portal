# Page → Data Source Map: Dashboard, Board, Jira, Auth Pages

> Source-derived from HTML + JS files. Every API call, data file, and external dependency listed.

---

## index.html — Login

**Role:** Public (redirects to dashboard if already authenticated)  
**Script:** `assets/pages/index/index.js`

**API calls:**
- `POST /api/auth/login.php` → reads `data/users.json` (global) · writes `data/rate_limit.json`

**Data files:**
- `data/users.json` (global) — user lookup + bcrypt verify
- `data/rate_limit.json` (global) — login rate limit state

**localStorage keys read/written:**
- `som_token`, `som_user` — JWT + user object (set on success)
- `csrf_token` — CSRF token from login response
- `som_remember_user` — remembered username
- `som_saved_accounts` — account picker list (max 5)

**External:** none  
**Special logic:** `?reason=extend` flow clears existing token before showing form

---

## dashboard.html — Main Dashboard

**Role:** All authenticated (dev_user redirect to dev-hub.html)  
**Script:** `assets/pages/dashboard/dashboard.js`

**API calls:**

| Call | Endpoint | Data files read |
|------|----------|-----------------|
| Board posts (recent) | `GET /api/board/index.php?limit=500` | `data/{team}/board.json`, `data/{team}/stars.json` |
| Activity feed | `GET /api/log/feed.php?limit=30` | `data/{team}/logs/activity.json` |
| Learning status widget | `GET /api/dashboard/learning-status.php` | `data/{team}/onboarding/config.json`, `data/{team}/onboarding/progress/<uid>.json`, `data/{team}/courses/courses.json`, `data/{team}/courses/progress.json`, `data/{team}/courses/<id>/phases.json` |
| Announcements banner | `GET /api/announcements/index.php` | `data/{team}/announcements.json` |
| On-call schedule | `GET /api/n8n-oncall.php?date=<today>` | `data/n8n_oncall_config.json` (global) · calls **n8n webhook** externally |
| Schedule (calendar widget) | `GET /api/schedule/index.php?year=&month=` | `data/{team}/schedule.json` |
| Users list (team roster) | `GET /api/users/` | `data/users.json` (global) |
| Leave (approved) | `GET /api/schedule/leave.php?status=approved` | `data/{team}/leave-requests.json`, `data/{team}/schedule.json` |
| Jira incidents analytics | `GET /api/jira/incidents-analytics.php?fromDate=&toDate=` | `data/analytics-cache/incidents-YYYY-MM.json` (cache) · calls **Jira Cloud REST API** |
| Feature requests | `GET /api/requests/index.php` | `data/requests.json` (global) |
| Feature request submit | `POST /api/requests/index.php` | `data/requests.json`, `data/users.json` |
| Feature request comment | `PATCH /api/requests/index.php` | `data/requests.json` |
| Jira field options (quick create) | `GET /api/jira/field-options.php` | `data/sm/jira_config.json` (SM-shared) · calls **Jira Cloud** `/rest/api/3/issue/createmeta`, `/rest/api/3/field/{id}/context` |
| Create Jira ticket (quick) | `POST /api/jira/create.php` | `data/sm/jira_config.json` · calls **Jira Cloud** `POST /rest/api/3/issue` |
| Inbox (IMAP email) | `GET /api/inbox/list.php?folder=INBOX` | `data/{team}/mail_config.json` · connects to **Gmail IMAP** (`imap.gmail.com:993`) |
| Inbox send | `POST /api/inbox/send.php` | `data/{team}/mail_config.json` · connects to **Gmail SMTP** |

**Data files summary:**
`data/{team}/board.json`, `data/{team}/stars.json`, `data/{team}/logs/activity.json`, `data/{team}/announcements.json`, `data/{team}/onboarding/config.json`, `data/{team}/onboarding/progress/<uid>.json`, `data/{team}/courses/courses.json`, `data/{team}/courses/progress.json`, `data/{team}/schedule.json`, `data/{team}/leave-requests.json`, `data/{team}/mail_config.json`, `data/users.json` (global), `data/requests.json` (global), `data/n8n_oncall_config.json` (global), `data/sm/jira_config.json` (SM-shared), `data/analytics-cache/incidents-YYYY-MM.json`

**External services:**
- **Jira Cloud** `https://truemoney.atlassian.net` — incidents analytics + quick Jira create
- **n8n webhook** (configured in admin) — on-call schedule
- **Gmail IMAP** `imap.gmail.com:993` — team inbox
- **Gmail SMTP** — send email from inbox widget

---

## board.html — Service Board

**Role:** All authenticated (requirePagePermission `board`)  
**Script:** `assets/pages/board/board.js`  
**CDN libs:** `marked.js` (markdown parser) · `DOMPurify` (XSS sanitizer) — both from cdnjs.cloudflare.com

**API calls:**

| Call | Endpoint | Data files |
|------|----------|-----------|
| Load posts | `GET /api/board/index.php?board_type=&status=&limit=12&offset=0` | `data/{team}/board.json`, `data/{team}/stars.json` |
| Poll new posts | `GET /api/board/index.php?since=<ISO>` | `data/{team}/board.json` |
| Create post | `POST /api/board/index.php` | `data/{team}/board.json`, `data/{team}/notifications.json`, `data/users.json` |
| Edit post | `PUT /api/board/index.php?id=` | `data/{team}/board.json` |
| Delete post (soft) | `DELETE /api/board/index.php?id=` | `data/{team}/board.json` |
| Pin post | `PATCH /api/board/index.php?id=` | `data/{team}/board.json` |
| List comments | `GET /api/board-comments/index.php?post_id=` | `data/{team}/board-comments.json` |
| Comment count (batch) | `GET /api/board-comments/index.php?counts=id1,id2` | `data/{team}/board-comments.json` |
| Create comment | `POST /api/board-comments/index.php` | `data/{team}/board-comments.json`, `data/{team}/notifications.json` |
| Edit comment | `PATCH /api/board-comments/index.php?id=` | `data/{team}/board-comments.json` |
| Delete comment | `DELETE /api/board-comments/index.php?id=` | `data/{team}/board-comments.json` |
| Star / unstar | `POST/DELETE /api/stars/index.php` | `data/{team}/stars.json` |
| Board config | `GET /api/board-config/index.php` | `data/{team}/board_categories.json`, `data/{team}/board_service_types.json` |
| Add service type | `POST /api/board-config/index.php?kind=service_type` | `data/{team}/board_service_types.json` |
| Add subtype | `POST /api/board-config/index.php?kind=subtype&parent=` | `data/{team}/board_service_types.json` |
| Upload image | `POST /api/upload.php` | `uploads/` directory |
| User avatars | `GET /api/users/` (limited fields) | `data/users.json` (global) |

**Data files summary:**
`data/{team}/board.json`, `data/{team}/board-comments.json`, `data/{team}/stars.json`, `data/{team}/notifications.json`, `data/{team}/board_categories.json`, `data/{team}/board_service_types.json`, `data/users.json` (global), `uploads/` (image files)

**External:** none (markdown rendered client-side via marked.js; content sanitized via DOMPurify)

---

## jira-templates.html — Jira Issue Templates

**Role:** All authenticated; manage (create/edit/delete) requires sm_lead/sm_admin/dev_sm/super_admin AND SM team  
**Script:** `assets/pages/jira-templates/jira-templates.js`

**API calls:**

| Call | Endpoint | Data files |
|------|----------|-----------|
| Load templates | `GET /api/templates/index.php` | `data/sm/templates.json` (SM-shared) · also reads `data/teams.json` for feature check |
| Load Jira config | `GET /api/jira-config/index.php` | `data/sm/jira_config.json` (SM-shared) |
| Load field options | `GET /api/jira/field-options.php` | `data/sm/jira_config.json` · calls **Jira Cloud** `/rest/api/3/issue/createmeta`, `/rest/api/3/field/{id}/context` |
| Load issue types | `GET /api/jira/issue-types.php` | calls **Jira Cloud** `GET /rest/api/3/issue/createmeta?projectKeys=SMC` |
| Load service types | `GET /api/service-types/index.php` | `data/{team}/service_types.json` |
| Create template | `POST /api/templates/index.php` | `data/sm/templates.json` (SM-shared) · reads `data/sm/jira_config.json` |
| Edit template | `PUT /api/templates/index.php?id=` | `data/sm/templates.json` |
| Delete template | `DELETE /api/templates/index.php?id=` | `data/sm/templates.json` |
| Create Jira issue | `POST /api/jira/create.php` | calls **Jira Cloud** `POST /rest/api/3/issue` |
| Mail config (for email send) | `GET /api/mail-config/index.php` | `data/{team}/mail_config.json` |
| Send email (after create) | `POST /api/mail/send.php` | `data/{team}/mail_config.json` · connects to **SMTP** |
| Add service type | `POST /api/service-types/index.php` | `data/{team}/service_types.json` |
| Add service subtype | `POST /api/service-types/index.php?parent=` | `data/{team}/service_types.json` |
| Delete service type | `DELETE /api/service-types/index.php?id=` | `data/{team}/service_types.json` |

**Data files summary:**
`data/sm/templates.json` (SM-shared), `data/sm/jira_config.json` (SM-shared), `data/{team}/service_types.json`, `data/{team}/mail_config.json`, `data/teams.json` (global)

**External services:**
- **Jira Cloud** `https://truemoney.atlassian.net` — fetch field options, issue types, create issue
- **SMTP** (configured in mail_config.json) — optional email after Jira create

---

## inbox.html — Team Email Inbox

**Role:** ALL_STAFF_ROLES (super_viewer blocked)  
**Script:** `assets/pages/inbox/inbox.js`

**API calls:**

| Call | Endpoint | External / Data files |
|------|----------|-----------------------|
| Load folders | `GET /api/inbox/folders.php` | **Gmail IMAP** `imap.gmail.com:993` via `data/{team}/mail_config.json` |
| List emails | `GET /api/inbox/list.php?folder=INBOX&filter=all&limit=50&offset=0` | **Gmail IMAP** + `data/{team}/mail_config.json` |
| Open email | `GET /api/inbox/message.php?folder=INBOX&uid=` | **Gmail IMAP** |
| Mark read/flag | `POST /api/inbox/flag.php` | **Gmail IMAP** |
| Move to trash/archive | `POST /api/inbox/move.php` | **Gmail IMAP** |
| Send email | `POST /api/inbox/send.php` | **Gmail SMTP** via `data/{team}/mail_config.json` |
| Service types (compose tags) | `GET /api/service-types/index.php` | `data/{team}/service_types.json` |

**Data files:**
`data/{team}/mail_config.json` (SMTP/IMAP credentials — `smtp_user`, `smtp_password`, IMAP connects to `imap.gmail.com:993`)

**External services:**
- **Gmail IMAP** `imap.gmail.com:993` — read emails (all folder operations)
- **Gmail SMTP** — send emails

---

## profile.html — User Profile

**Role:** All authenticated  
**Script:** `assets/pages/profile/profile.js`

**API calls:**

| Call | Endpoint | Data files |
|------|----------|-----------|
| Load profile | `GET /api/auth/profile.php` | `data/users.json` (global) |
| Update profile | `PATCH /api/auth/profile.php` | `data/users.json` (global) |
| Admin update another user | `PUT /api/users/?id=` | `data/users.json` (global) |
| My activity log | `GET /api/auth/my-activity.php?limit=&offset=` | `data/{team}/logs/activity.json` |
| My achievements | `GET /api/achievements/index.php` | `data/{team}/courses/courses.json`, `data/{team}/courses/progress.json`, `data/{team}/courses/<id>/phases.json`, `data/{team}/exams/exams.json`, `data/{team}/exams/attempts.json`, `data/{team}/onboarding/config.json`, `data/{team}/onboarding/progress/<uid>.json` |
| View another user's achievements | `GET /api/achievements/index.php?user_id=` | Same as above (ADMIN_ROLES only) |
| My recent posts | `GET /api/board/index.php?author_id=&limit=5` | `data/{team}/board.json` |
| Teams list (super_admin) | `GET /api/teams/index.php` | `data/teams.json` (global) |

**Data files summary:**
`data/users.json` (global), `data/{team}/logs/activity.json`, `data/{team}/board.json`, `data/{team}/courses/courses.json`, `data/{team}/courses/progress.json`, `data/{team}/courses/<id>/phases.json`, `data/{team}/exams/exams.json`, `data/{team}/exams/attempts.json`, `data/{team}/onboarding/config.json`, `data/{team}/onboarding/progress/<uid>.json`, `data/teams.json` (global)

**External:** none

---

## settings.html — Theme & Preferences

**Role:** All authenticated  
**Script:** `assets/pages/settings/settings.js`

**API calls:** **none** — settings are stored entirely in localStorage

**localStorage keys read/written:**
- `som_ui_theme` — theme key (`horizon`, `glass`, `enterprise`, `console`, `warm`)
- `som_dark_mode` — `1` / `0`
- Various `som_pref_*` toggles (notification prefs, etc.)

**Data files:** none  
**External:** none  
**Note:** The settings page manages UI preferences only. OpenSearch credentials (if any were previously here) are managed via `api/opensearch-user-creds/` from `log-explorer.html`.

---

## change-password.html — Change Password

**Role:** All authenticated (including expired/first_login tokens — `requireAuth(true)`)  
**Script:** `assets/pages/change-password/change-password.js`

**API calls:**
- `POST /api/auth/change-password.php` → reads/writes `data/users.json` (global)

**Data files:**
- `data/users.json` (global) — find user, verify old hash, check password history, write new hash

**localStorage written on success:**
- `som_token` — refreshed JWT with cleared flags
- `som_user` — updated user object

**External:** none

---

## about-som.html — About SOM / Org Chart

**Role:** All authenticated (all roles including dev_user, external)  
**Script:** `assets/pages/about-som/about-som.js`

**API calls:**
- `GET /api/about-page/index.php` → reads `data/{team}/about-page.json`, `data/users.json` (global), `data/teams.json` (global)

**Data files:**
- `data/{team}/about-page.json` — org chart content, team description, links
- `data/users.json` (global) — member list (enriched from users)
- `data/teams.json` (global) — team metadata

**External:** none  
**Note:** Write access (`PUT /api/about-page/index.php`) is ADMIN_ROLES only, done via `admin/about-page.html`

---

## my-team.html — Team Member Directory

**Role:** All authenticated  
**Script:** `assets/pages/my-team/my-team.js`

**API calls:**

| Call | Endpoint | Data files |
|------|----------|-----------|
| Load team members | `GET /api/my-team/index.php` | `data/users.json` (global) — filtered by `team` field + `schedule_include=true` |
| Update own profile (inline edit) | `PATCH /api/auth/profile.php` | `data/users.json` (global) |
| Admin update another member | `PUT /api/users/?id=` | `data/users.json` (global) |

**Data files:**
- `data/users.json` (global) — sole data source; filters by `team` + excludes `external` role + requires `schedule_include=true`

**External:** none  
**Note:** super_admin/super_viewer can pass `?team=<slug>` or `X-Admin-Team` header to view any team; omitting both returns all teams merged.
