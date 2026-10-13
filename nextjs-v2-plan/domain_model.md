# Domain Model — SOM Portal

Reference baseline for the TypeScript / Next.js v2 rewrite. Facts drawn from
the current PHP source — citations are `file:line`. Neutral description, not a
proposed redesign.

---

## 1. Entities

### 1.1 User
Stored in `data/users.json` (global file — `helpers.php:142`). Shape as seen in
`api/users/index.php:60-115`, `api/auth/login.php:85-150`.

| Field                 | Type           | Notes |
|-----------------------|----------------|-------|
| `id`                  | string         | `usr_xxx…` — `genId('usr')` (`helpers.php:968`) |
| `name`                | string         | display name |
| `username`            | string         | unique, lower-cased for RL key (`helpers.php:1075`) |
| `email`               | string         | |
| `password`            | string (bcrypt)| `$2y$` or legacy `$2b$` (`helpers.php:985`) |
| `role`                | enum           | see §1.3 |
| `team`                | string \| null | team slug; `null` only for `super_admin` / `super_viewer` |
| `is_genz`             | bool           | SM-only perk flag — NOT a role (`login.php:143`, memory `project_genz_team`) |
| `dev_subteam`         | string \| null | only when `role='dev_user'` — else forced `null` (`users/index.php:299`) |
| `permissions`         | string[]       | page allow-list, **only for `external` role** (`helpers.php:898-911`) |
| `extra_pages`         | `{page, source_team}[]` | cross-team per-page grants, super_admin only (`users/index.php:325`, `helpers.php:825-843`) |
| `menu_permissions`    | `{grant[], deny[]}` | per-user sidebar overrides (`helpers.php:946-958`) |
| `first_login`         | bool           | bypass password expiry until first change (`helpers.php:644`) |
| `must_reset_password` | bool           | blocks all protected endpoints (`helpers.php:650`) |
| `password_changed_at` | ISO8601        | drives 60-day expiry (`config.php:46`, `helpers.php:646`) |
| `password_history`    | string[]       | last N bcrypt hashes, `PW_HIST_COUNT=5` (`config.php:47`) |
| `created_at`, `created_by` | | audit |

### 1.2 Team
Stored in `data/teams.json` (global). See `teams.json` + `login.php:112-124`.

| Field           | Type              | Notes |
|-----------------|-------------------|-------|
| `id`            | string            | `tm_xxx…` |
| `slug`          | string            | **URL + path segment** — regex `^[a-z0-9_-]+$` (`helpers.php:620`) |
| `name`          | string            | display |
| `description`   | string            | |
| `color`         | string (hex)      | UI accent |
| `active`        | bool              | |
| `features`      | string[]          | enabled feature flags; see §1.4 |
| `feature_pages` | `{[feature]: {user_pages[], admin_pages[]}}` \| `[]` | optional per-feature page allow-list |
| `page_modes`    | `{[page]: 'read'\|'full'}` | per-page read-only lock (`helpers.php:850-871`) |
| `created_at`, `created_by` | | audit |

Known teams at time of writing: `sm` (home), `ss`, `ts`, `fas`, `im`, `cmt`,
`smart`, `wealth`, `jenkins`, `sojenkins`, `dev`.

### 1.3 Role
Defined as PHP constants in `helpers.php:73-87`.

| Role           | Scope                | In `ADMIN_ROLES` | In `LEAD_ROLES` | In `GLOBAL_READ_ROLES` | Notes |
|----------------|----------------------|------------------|-----------------|------------------------|-------|
| `super_admin`  | global, bypass team  | yes              | yes             | yes                    | `requireRole()` short-circuits (`helpers.php:746`) |
| `super_viewer` | global, **read-only**| no               | no              | yes                    | writes auto-blocked (`helpers.php:629-638`) |
| `sm_admin`     | per-team admin       | yes              | yes             | no                     | |
| `dev_sm`       | per-team admin (dev) | yes              | yes             | no                     | sibling of sm_admin for dev team |
| `sm_lead`      | per-team lead        | no               | yes             | no                     | |
| `sm_user`      | per-team member      | no               | no              | no                     | |
| `dev_user`     | dev-team member      | no               | no              | no                     | carries `dev_subteam`; read-only on monitoring (`memory project_dev_team`) |
| `external`     | per-user allow-list  | no               | no              | no                     | needs `permissions[]`, falls through `requirePagePermission()` (`helpers.php:898`) |

**No formal role inheritance.** Hierarchy exists only via membership in the
`ADMIN_ROLES` / `LEAD_ROLES` / `ALL_STAFF_ROLES` arrays and the explicit
`super_admin` bypass in `requireRole()`.

### 1.4 Feature flag
Catalog in `helpers.php:376-475` (`featureDataFiles()`). Default flags from
`defaultFeatures()` (`helpers.php:267`).

| Field            | Meaning |
|------------------|---------|
| `key`            | string, listed in a team's `features[]` |
| `default_on`     | if in `defaultFeatures()`: `dashboard`, `board`, `team-docs`, `sabai`, `schedule`, `learning` |
| `data_files`     | list of JSON file names provisioned on grant (`_provisionFeatureFiles` `helpers.php:274`) |
| `requestable`    | if listed in `REQUESTABLE_FEATURES` in `api/feature-requests/index.php` |
| `sm_shared`      | if files are in `smSharedFiles()` → feature is view-only share, provisioning is a no-op |

Known view-only share features: `batch-file-search`, `grafana-alerts`,
`jira-templates-shared`, `pw-schedule` (`helpers.php:447-454`).

### 1.5 Session (JWT claims)
HS256, no library (`helpers.php:547-574`). Payload shape from
`api/auth/login.php:85-98`:

| Claim                | Type         | Source |
|----------------------|--------------|--------|
| `sub`                | user id      | `user.id` |
| `username`           | string       | `user.username` |
| `name`               | string       | `user.name` |
| `role`               | enum         | `user.role` |
| `team`               | string\|null | `user.team` — team-slug context key, injected into `$GLOBALS['_current_team']` (`helpers.php:613`) |
| `dev_subteam`        | string\|null | only when role=`dev_user`, else `null` |
| `first_login`        | bool         | |
| `password_expired`   | bool         | precomputed at login |
| `pw_expires_at`      | unix seconds | 0 for first_login |
| `must_reset_password`| bool         | |
| `remember_me`        | bool         | determines `exp` (30d vs 8h) |
| `permissions`        | string[]     | **only** if role=`external`, else `[]` |
| `iat`, `exp`         | unix seconds | set by `jwt_create` (`helpers.php:558-559`) |

The login response **also** sends non-JWT user fields (`team_features`,
`team_feature_pages`, `team_page_modes`, `is_genz`, `extra_pages`) separately
in `response.user` for the client to cache (`login.php:126-150`).

Notable: `is_genz` is **not** a JWT claim — client reads it from
`localStorage.som_user` only.

### 1.6 File record abstraction
Three storage patterns resolved by `_teamDataPath()` (`helpers.php:238-243`):

| Pattern        | Resolution                           | Example                           |
|----------------|--------------------------------------|-----------------------------------|
| Global         | `data/{file}`                        | `users.json`, `teams.json`        |
| SM-shared      | `data/sm/{file}` for every reader    | `ma-services.json`, `templates.json` |
| Team-scoped    | `data/{team}/{file}`                 | `board.json`, `links.json`        |
| Section-scoped | sub-key of per-team file read via SM fallback | `monitoring` section of `links.json` (memory `section_scoped_sm_share.md`) |

Section-scoped is **not** modelled as a filesystem pattern — it's a convention
inside otherwise team-scoped files; one section is treated as SM-managed, the
rest stays team-local. v2 should encode this at the schema/record level, not
the file level.

Monthly files (`batch-records-YYYY-MM.json`, `test-records-YYYY-MM.json`) use
`monthlyFilename()` + `listMonths()` helpers (`helpers.php:676-697`).

---

## 2. Access rules

Rows cite the enforcing function/file. "Scope" is the data boundary. The
`super_admin` bypass applies universally unless noted (`helpers.php:746`).

| Action                                        | Required role                             | Scope rule / Notes |
|-----------------------------------------------|-------------------------------------------|--------------------|
| Login                                         | any user in `users.json`                  | rate-limited: 5 attempts / 15 min (`helpers.php:1070-1105`) |
| Any protected request                         | valid JWT w/ non-expired password         | `requireAuth` (`helpers.php:599`) |
| Password-change / logout / `/me`              | valid JWT, expiry allowed                 | `$allowExpiredPw=true` (`helpers.php:599`) |
| Read own-team file                            | any role w/ matching `team`               | `readJson` auto-scopes via `_current_team` (`helpers.php:482`) |
| Read SM-shared file                           | any role                                  | always routes to `data/sm/{file}` (`helpers.php:240`) |
| Write SM-shared file                          | caller's team must be `sm`                | `requireSmForShared()` (`helpers.php:720`); super_admin must view-as `sm` to write |
| Read-only shared feature access               | team must have feature flag OR be super_admin | `requireTeamFeature` (`helpers.php:766`) |
| Write to arbitrary team's file (view-as)      | `super_admin`                             | `X-Admin-Team` header (`helpers.php:619`); `super_viewer` sees but can't mutate |
| Mutate anything                               | not `super_viewer` (unless opt-in flag)   | 403 auto-block on non-GET (`helpers.php:629-638`) |
| Toggle team feature flag                      | `super_admin`                             | `api/teams/index.php` PATCH |
| Grant `extra_pages` to a user                 | `super_admin`                             | `users/index.php:325` |
| Edit `menu-permissions.json`                  | `sm_admin` / `dev_sm` / `super_admin`     | per-team file |
| Edit `nav-groups.json`                        | `sm_admin` / `dev_sm` / `super_admin`     | per-team (`api/nav-groups/index.php:28,69`) |
| Access `/admin/*` pages                       | `sm_admin` / `dev_sm` / `super_admin`     | `super_viewer` blocked (`memory feedback_sm_user_menu_perms`) |
| Access oversight pages (`learn-reports`, `exam-reports`) | `super_admin` / `super_viewer` | allow-list in `coreNavItems` (`layout.js:1187-1188`) |
| Read course/exam progress across teams        | `REPORT_READ_ROLES`                       | adds `super_viewer` on top of admin set (`helpers.php:87`) |
| Jira-template write                           | SM team only                              | SM-shared file |
| Case-incident / incident-launcher / log-explorer / restart-analyzer / begin-grafana | SM team only, no `super_viewer` | `team:'sm'` + `denyRoles:['super_viewer']` (`layout.js:1204-1212`) |
| Edit own password                             | self                                      | `allowSuperViewerWrite` (`helpers.php:599`) |
| Access per-page cross-team data               | user with matching `extra_pages[page]`    | `applyExtraPageTeam()` swaps context (`helpers.php:825-843`) |
| Page in `page_modes[page]='read'`             | writes blocked for that team              | `requirePageMode()` (`helpers.php:850-871`) |
| SM-coverage admin ops                         | super_admin, OR sm_admin/dev_sm with `team=sm` | `isSmCoverageAdmin()` (`helpers.php:877-882`) |
| Super-sensitive data (inbox, personal mail)   | not `super_viewer` even in read mode      | `denySuperViewer()` (`helpers.php:703`) |

---

## 3. Invariants

| Invariant | Enforced? Where |
|-----------|-----------------|
| Every user has exactly one team **OR** role ∈ `GLOBAL_READ_ROLES` | login.php:112-124 treats `super_admin` / `super_viewer` as team-less; otherwise team is set from `user.team`. Nothing in users CRUD validates team required for non-global roles. **v2 should enforce.** |
| `team` slug matches `/^[a-z0-9_-]+$/` | Only when read from `X-Admin-Team` (`helpers.php:620`). Not re-validated on write — teams.json could in principle hold other characters. |
| SM-shared writes require caller team = `sm` | Yes — `requireSmForShared()` at the top of each write endpoint for SM-shared files (`helpers.php:720`). super_admin must switch view-as to `sm`. |
| Section-scoped shares: SM version read by all, writes split | Not a filesystem-level invariant — enforced by endpoint logic per-section. Easy to miss when adding features. |
| Feature flag off ⇒ page hidden **AND** API returns 403 | **Both ends, but weakly.** Sidebar hides via `feature:` key in `coreNavItems` (`layout.js:1144-1226`). API gate requires every endpoint to call `requireTeamFeature()` (`helpers.php:766`) — not auto-wired. Missing a call = silent exposure. |
| `super_admin` bypasses all role / feature / page-mode checks | Yes — explicit short-circuit in `requireRole`, `requireTeamFeature`, `requirePageMode` (`helpers.php:746, 767, 851`). |
| `super_viewer` is strictly read-only | Enforced globally in `requireAuth` for all non-GET methods (`helpers.php:629-638`). Opt-out via `$allowSuperViewerWrite` flag on specific endpoints. |
| `is_genz` is a flag, not a role | Set/read as `user.is_genz` boolean; only triggers client-side nav visibility (`layout.js:1214-1215 genzOnly:true`) + `genz-hub.html` / `genz-notes.html` entry. No server endpoint consistently gates on it. |
| `dev_subteam` only meaningful for `dev_user` | Users CRUD forces `null` when role≠`dev_user` (`users/index.php:299`). JWT only emits it for `dev_user` (`login.php:91`). |
| JWT team claim defines all data scoping | Via `$GLOBALS['_current_team']` injection in `requireAuth` (`helpers.php:613`). Missing claim ⇒ reads fall back to `data/{file}` root (dangerous when testing — memory `feedback_jwt_team_testing`). |
| `super_admin` / `super_viewer` can override team context via `X-Admin-Team` | Yes, bounded by regex (`helpers.php:619`). No other role honoured. |
| Admin-only pages (`/admin/*`) deny `super_viewer` | Enforced at page level (not in `requireAuth`) — the super_viewer config also carries `denied_pages[]` cached in sessionStorage. |
| Default features cannot be revoked | `defaultFeatures()` (`helpers.php:267`) is read-only; not checked on PATCH — admins can in principle remove from `features[]`. v2 should enforce. |
| Password history size = 5, expiry = 60d | `config.php:46-47`, dynamic via system-settings. |
| Rate limit: 5 fails / 15-min lockout | `helpers.php:1070-1105`, dynamic via system-settings. |
| API rate limit: 120 req / 60 s / (user,group) | `helpers.php:1139-1142`. |
| JSON writes serialised by `flock(LOCK_EX)` | Yes (`helpers.php:502-517`). Not safe under high concurrency across hosts. |

**8-touchpoint tax for adding a new page** — confirmed from source
(matches memory `feedback_sm_user_menu_perms`):

1. `assets/js/layout.js` → `coreNavItems` entry (`layout.js:1144+`).
2. `data/{team}/nav-groups.json` → `items[]` membership (per team).
3. `api/nav-groups/index.php` → `$defaultGroups` fallback (`nav-groups/index.php:7-15`).
4. `data/menu-permissions.json` → `roles.sm_user` allow-list (if visible to sm_user).
5. `assets/js/super-team-permissions.js` → ALL_ITEMS listing (**file missing from this checkout**; derived from memory + referenced by `_SV_CONFIG_SS_KEY` flow in `layout.js`).
6. `api/core-menus.php` or similar → `CORE_MENUS` (not in this checkout tree; see memory).
7. `assets/js/maintenance.js` → `PAGE_FILES` map (`maintenance.js:41-96`).
8. `admin/maintenance.html` → PAGES array (companion to above).

If the page is per-feature-gated, also add it to `featureDataFiles()`
(`helpers.php:376`) + `FEATURE_CATALOGUE` + `REQUESTABLE_FEATURES`.

---

## 4. State machines

### 4.1 Board post
Fields: `status`, `pinned`, `deleted_at`. See `api/board/index.php`.

```
          ┌──────── pin/unpin ───────┐
          ▼                          │
    [open] ──► [in_progress] ──► [resolved]
       │             │                │
       └── soft-delete (deleted_at = now) ──► [trash]
                                                 │
                                      restore (deleted_at = null)
                                                 ▼
                                      previous status
```

- Statuses: `open` | `in_progress` | `resolved` (`board/index.php:40,103`).
- `pinned` is orthogonal to status, affects sort order (`board/index.php:65`).
- Soft-delete sets `deleted_at`; list queries filter it out (`board/index.php:17,35`).
- Status change logs old → new (`board/index.php:210`).

### 4.2 Session
```
unauth ──login──► authed(JWT, exp=+8h)
              └─remember_me──► authed(JWT, exp=+30d)
authed ──exp passes──► expired → next request 401 → unauth
authed ──password_expired──► 403 { code: 'PASSWORD_EXPIRED' } (unless /change-password)
authed ──must_reset_password──► 403 { code: 'MUST_RESET_PASSWORD' }
```
Transitions and 403 codes from `helpers.php:640-654`.

### 4.3 Login rate limit
```
fresh ──fail──► attempt(1)
attempt(n<5) ──fail──► attempt(n+1)
attempt(n>=5) ──► blocked(until = now+15min)
blocked ──clock passes──► fresh
any ──login_success──► fresh (entry cleared, helpers.php:1128-1133)
```

### 4.4 Password reset token
```
created (TTL 24h) ──verify──► still valid
created ──consume──► used (used_at set, single-use)
created ──TTL expires──► invalid
created ──new token for same user──► invalidated (used_at set + invalidated_by_new=true)
used/expired >7d ──_resetTokenGc──► purged (helpers.php:997-1004)
```

### 4.5 Host cooldown (upstream circuit breaker)
```
healthy ──curl err / HTTP 5xx──► cooldown(30s)
cooldown ──TTL expires──► probe (healthy)
cooldown ──hostCooldownClear()──► healthy
cooldown(>120s old) ──gc──► purged
```
`helpers.php:1275-1330`.

---

## 5. Edge cases + exceptions

- **`super_admin` bypasses MA page gate.** Only `sm_admin`, `dev_sm`,
  `super_admin` escape page overlays (`maintenance.js:122`). `super_viewer` is
  not in that list — hits MA like a regular user. Memory
  `feedback_frontend_dos_donts.md` notes super_admin bypass must be preserved.
- **`external` role allow-list.** `permissions[]` lives on the user record
  (not role config); `requirePagePermission()` reads it (`helpers.php:898-911`).
  SM roles short-circuit the check (`:899`). JWT only carries this field for
  `external` (`login.php:97`).
- **Legacy `$2b$` bcrypt.** Python-generated hashes rewritten to `$2y$` on verify
  (`helpers.php:985`). Needs same compatibility in v2.
- **Password placeholder self-heal.** `ensureAdminExists()` rewrites any hash
  containing `'placeholder'` on every boot (`helpers.php:1571-1577`).
- **Timezone.** Hard-coded `Asia/Bangkok` (`helpers.php:5`). All `date('c')`
  calls emit `+07:00`.
- **CORS whitelist is tiny.** Only `localhost` / `127.0.0.1` on `:80` /
  `:8888` (`config.php:73`). Production relies on same-origin.
- **`SM Coverage` admin.** Not a role — a predicate: `super_admin` OR
  (admin role AND `team=sm`) (`helpers.php:877`). Used to gate SM-only ops
  features from other teams' admins.
- **`sm_lead` and `sm_user` not in menu-permissions `sm_lead`/`sm_user`
  lists.** `sm_lead` resolves to `*` wildcard (`menu-permissions.json:5`),
  only `sm_user` and `external` are restrictive.
- **`always_visible` menu bypass.** `profile`, `change-password` always
  rendered regardless of role filter (`menu-permissions.json:48`,
  `helpers.php:961`).
- **Global-role "All Teams" fallback.** `super_admin` / `super_viewer` with
  no `X-Admin-Team` and whose home team has an empty file auto-switch to the
  first team that has data for that file (`helpers.php:796-815`). Silent
  context switch — can confuse debugging.
- **Fatal / uncaught errors still JSON.** `register_shutdown_function` +
  `set_exception_handler` guarantee a `{success:false}` body (`helpers.php:21-70`).
- **`envFallback()` re-reads `.env` on demand.** Guards against PHP workers
  spawned before `.env` was populated (`helpers.php:104-121`).
- **DNS override via `data/dns-overrides.json` + per-Jenkins-server
  `ip_override`** (`helpers.php:1367-1416`). Bypasses system DNS.
- **PromQL regex escape quirk.** `preg_quote` output needs double-escape for
  Thanos (`\\\\.` in PHP → `\\.` on wire); memory `feedback_promql_escape.md`.
- **Monthly file team routing bug.** `listMonths()` falls back to
  `DATA_DIR` root for `team=='sm'` as well as null (`helpers.php:685`) — so
  SM-team monthly files are expected at root, not `data/sm/`. Different from
  `_teamDataPath()`'s rule for team=`sm`. v2 should unify.
- **`requireRole()` logs forbidden but `requireTeamFeature()` logs
  `feature_forbidden`.** Different event names in security log — v2
  taxonomy decision.
- **Admin notifications are team-scoped.** `createNotificationForAdmins()`
  excludes super_admin (team=null) by design (`helpers.php:1528-1538`).
- **File locking vs multi-host.** `flock()` is POSIX-local; any multi-node
  deploy loses write safety. v2 needs real DB.
- **Login response leaks data.** Response includes `team_features`,
  `team_feature_pages`, `team_page_modes`, `is_genz`, `extra_pages`
  (`login.php:135-150`) — v2 should decide what the client needs to cache
  versus re-fetch.

---

## 6. Open modelling questions

- **Multi-team membership.** Current model: strictly 1 user ↔ 1 team, with
  `extra_pages[]` as a per-page escape hatch. Does v2 need true
  many-to-many membership (e.g. SM lead on-call rotating into IM)?
- **Role inheritance.** Flat today; `super_admin` bypass is hard-coded.
  Should v2 express `super_admin ⊃ admin ⊃ lead ⊃ user` as a lattice, or
  keep flat?
- **Feature flags: team-level only?** Current flags are team-scoped. No
  per-user override exists (except for the `external` allow-list + the
  super_admin global). Should feature flags admit per-user grants (like
  `extra_pages`)?
- **SM-shared vs section-scoped.** Section-scoped is a convention, not a
  type. v2 should decide: do we model shared *records* (a `shared: true`
  flag on each entity row — see memory `project_shared_courses_plan.md`),
  or shared *collections* (file-level)?
- **Audit log retention.** Explicit cap only for `security.json`
  (`LOG_MAX_SECURITY = 2000`, `helpers.php:92`); `activity.json` is
  `PHP_INT_MAX` (unbounded). v2 needs TTL policy per log type +
  per-team-vs-global split.
- **`sm_lead` policy.** Currently resolves to `*` wildcard — effectively
  identical to `sm_admin` from a sidebar standpoint but *not* in
  `ADMIN_ROLES`. Was this intentional? Should lead have its own menu set?
- **`is_genz` lifecycle.** Currently a toggle on the user record. Any
  automatic criteria (hire date, team)? Expires?
- **Dev-team coupling.** `dev_user` is tightly bound to a hard-coded set of
  monitoring pages. Is "team=dev + role=dev_user + dev_subteam=…" better
  modelled as a separate `DevUser` entity in v2 or as flags on `User`?
- **`page_modes='read'` vs feature not granted.** Overlapping concepts
  today — a team can have a feature with the page in read mode (view but
  not edit). Semantics overlap with "SM-shared" view-only. Can v2 collapse
  these into one `accessMode: 'none'|'read'|'write'` per (team, feature)?
- **`extra_pages` cross-team reads.** `applyExtraPageTeam()` silently
  swaps `_current_team`. The user has no way to view *both* their team's
  and the extra team's data on the same page. v2 should decide whether
  this is "subscribe to another team's data" (merge) or "jump into another
  team's shoes" (swap). Today it's swap.
- **Global file list.** `_isGlobalFile()` is hard-coded (`helpers.php:142-158`).
  Should v2 model this as metadata on the entity type?
- **`super_viewer` denied_pages.** Stored in server config
  (`super-viewer-config/index.php`) and cached in sessionStorage. Why not
  encode as role permissions? Open design question.
