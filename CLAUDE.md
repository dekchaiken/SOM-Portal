# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Centralize-SOM is an internal service operations management dashboard for Ascend/TrueMoney teams. It centralizes incident posting, Jira issue creation (via templates), Jenkins pipeline health checks, and user/admin management.

**Stack:** PHP (procedural, no framework) + vanilla JS/HTML, JSON file-based storage, JWT authentication.

## Running Locally

No build step required. Serve directly with PHP:

```bash
cp .env.example .env
# Edit .env: set JWT_SECRET, JIRA_EMAIL, JIRA_TOKEN

php -S localhost:8000
```

Or deploy to Apache/NGINX with PHP 7.4+ and `mod_rewrite` enabled.

There is no test suite.

## Architecture

### Request Flow

```
Browser (*.html)  →  /api/* (PHP endpoints)  →  requireAuth() / requireRole()
                                              →  readJson() / writeJson() on /data/*.json
                                              →  External APIs (Jira, Jenkins)
```

### Key Files

- **`api/helpers.php`** — Core library: JWT, auth middleware (`requireAuth`, `requireRole`), JSON I/O with file locking, rate limiting, activity/security logging, ID generation. Read this first before touching any API endpoint.
- **`api/config.php`** — Loads `.env`, sets constants (`JWT_SECRET`, `DATA_DIR`, `UPLOADS_DIR`), applies CORS and security headers, reads `data/system-settings.json`.
- **`data/`** — All persistent state as JSON files (`users.json`, `board.json`, `templates.json`, `jira_config.json`, `jenkins_servers.json`, `system-settings.json`, etc.).

### API Structure (`/api/`)

Each subdirectory is a module. Most expose `index.php`; `auth/` uses named files (`login.php`, `logout.php`, `me.php`, `profile.php`, `change-password.php`, `my-activity.php`). There are also top-level endpoint files: `upload.php`, `batch-records.php`, `test-records.php`, `fundout-proxy.php`.

| Module | Responsibility |
|--------|---------------|
| `auth/` | Login, logout, profile, password change; JWT creation |
| `board/` | CRUD for service board posts (soft-delete, trash, restore, pin); statuses: `open`, `in_progress`, `resolved` |
| `board-comments/` | Comments on board posts |
| `board-config/` | Manage board categories/tabs and service type taxonomy |
| `jira/` | Create Jira issues, fetch issue types and custom fields |
| `jira-config/` | Manage Jira custom field mappings |
| `jenkins-proxy/` | Proxy Jenkins API requests with per-server auth |
| `jenkins-servers/` | CRUD for Jenkins server configurations |
| `templates/` | Jira issue templates with pre-filled field defaults |
| `health/` | Health checks for Jira & Jenkins (with latency) |
| `users/` | User CRUD (admin only), role assignment |
| `system-settings/` | Admin-configurable settings (session timeout, rate limits, etc.) |
| `log/` | Retrieve activity and security audit logs |
| `search/` | Full-text search across board, templates, links |
| `notifications/` | Notification system |
| `scheduled-noti/` | Scheduled notification jobs |
| `presence/` | User presence tracking |
| `stars/` | Personal post bookmarks per user |
| `links/` | Quick-link shortcuts (by section) |
| `sheets/` | Google Sheets embed config |
| `sidebar-tools/` | Sidebar tool/link management |
| `service-types/` | Service type tree (separate from board-config) |
| `mail/` | Email send/test-connection; `mail-config/` stores SMTP settings |
| `backup/` | Data backup download |

### Roles

Three roles enforced via `requireRole()` in helpers.php: `sm_user`, `sm_lead`, `sm_admin`.

### Data Persistence

All data lives in `/data/*.json`. File locking (`flock`) is used for concurrent writes, but this is not safe under high concurrency. The `readJson()` / `writeJson()` helpers in `helpers.php` handle all I/O — always use them, never write files directly.

### Frontend (`assets/js/`)

- **`api.js`** — Centralized fetch wrapper. Exposes `API.get/post/put/patch/delete/upload` and typed namespaces (`API.auth`, `API.board`, `API.users`, `API.templates`, etc.). Resolves `API_BASE` from the URL path to support sub-directory hosting. On 401, silently calls `Auth._doLogout()`.
- **`auth.js`** — `Auth` object manages JWT in `localStorage` (`som_token`, `som_user`). Call `Auth.requireAuth()` at the top of each page to redirect unauthenticated users.
- **`utils.js`** — Shared UI helpers (toasts, modals, formatting).
- **`layout.js`** — Shared nav/sidebar rendering.
- **`admin-nav.js`** — Admin panel navigation (used by pages under `admin/`).

Pages under `admin/` are the admin UI; top-level `*.html` files are the user-facing UI.

### External Integrations

- **Jira** — `api/jira/`: Basic auth (email + API token from `.env`). Creates issues and fetches field metadata from `truemoney.atlassian.net`.
- **Jenkins** — `api/jenkins-proxy/` and `api/jenkins-servers/`: Per-server tokens/cookies stored in `data/jenkins_servers.json`. Proxies API requests to internal Jenkins instances.
- **Google Sheets / Grafana / DataDog** — Embedded as iframes; allowlisted in `.htaccess` CSP headers.

## Security Model

- JWT HS256 tokens signed with `JWT_SECRET` from `.env`. Standard sessions expire per `session_timeout_hours` (default 8h); "remember me" sets 30-day expiry.
- Login rate limiting: 5 failures → 15-min lockout (file-based, `data/rate_limit.json`).
- API rate limiting: 120 req/60s per user per group (configurable via system-settings).
- All auth failures and security events are written to `data/logs/` via `logSecurity()`.
- Password hashing uses bcrypt via PHP's `password_hash`. The `$2b$` → `$2y$` prefix normalization in `verifyPassword()` exists for compatibility with legacy Python-generated hashes.

## Environment Variables (`.env`)

```
JWT_SECRET=<256-bit hex string>
JIRA_EMAIL=user@company.com
JIRA_TOKEN=<Jira API token>
```

`JIRA_BASE_URL` (`https://truemoney.atlassian.net`) and `JIRA_PROJECT_KEY` (`SMC`) are hardcoded in `api/config.php` — not in `.env`.
