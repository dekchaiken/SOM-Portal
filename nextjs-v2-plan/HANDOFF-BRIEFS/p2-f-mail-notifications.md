# Brief P2-F — Mail Config + Notifications + Scheduled Notifications

You are a Feature Engineer building the **Mail**, **Notifications**, and **Scheduled Notifications** modules for SOM Portal v2 (Next.js 15 rewrite). Starting cold.

## Project layout

- v1 (PHP): `/Users/warapon.lea/Downloads/otherteam/SOM-Portal/`
- v2 (Next.js): `/Users/warapon.lea/Downloads/otherteam/SOM-Portal/som-portal-v2/`

## Must read first

1. `som-portal-v2/nextjs-v2-plan/map.md` — Phase-0 decisions
2. `som-portal-v2/nextjs-v2-plan/codebase_design.md` — patterns
3. `som-portal-v2/nextjs-v2-plan/domain_model.md` — roles, teams, access rules
4. `som-portal-v2/nextjs-v2-plan/HANDOFF.md` — resume checkpoint, JWT recipe, standing rules
5. `api/mail/_mailer.php` — core mailer: SMTP via PHPMailer, dry-run mode, logging
6. `api/mail/_branding.php` — email HTML template/branding
7. `api/mail/_templates.php` — email template definitions (password reset, notifications, reports)
8. `api/mail/send.php` — send email endpoint
9. `api/mail/test-connection.php`, `test.php` — SMTP test endpoints
10. `api/mail/logs.php` — mail log viewer
11. `api/mail-config/index.php` — SMTP config CRUD (admin)
12. `api/notifications/index.php` — notification CRUD (user notifications bell)
13. `api/scheduled-noti/index.php` — scheduled notification job management
14. `api/scheduled-noti/send-chat.php` — send Google Chat messages on schedule
15. `api/scheduled-noti/send-grafana-paused.php` — check Grafana alert pauses
16. `api/scheduled-noti/send-shift-summary.php` — shift summary email
17. `data/sm/mail_config.json` — SMTP configuration (host, port, auth, TLS)
18. `data/sm/mail_logs.json` — sent email log
19. `data/sm/email_templates.json` — custom email template registry
20. `data/sm/notifications.json` — user notifications
21. `data/sm/scheduled-noti.json` — scheduled job definitions

Also peek at existing v2 `src/mail/` — there's already `mailer.ts`, `mail-config.ts`, `reset-password-email.ts` from Phase 1 (A6). Build on those, don't duplicate.

## Mission

Complete mail + notification subsystem. Phase 1 already built basic mailer and mail-config reader — this module completes the admin UI, notification bell, and scheduled jobs.

### Existing v2 mail layer (from Phase 1, DO NOT rewrite)

Check `src/mail/` — it should already have:
- `mailer.ts` — `sendMail()` function using nodemailer
- `mail-config.ts` — `resolveMailConfig()` reading from `mail_config.json`
- `reset-password-email.ts` — password reset email builder

Build on top of these. Read them first to understand the patterns.

### New service layer

**Mail admin (`src/mail/` additions):**
- `mail-admin.ts` — SMTP config CRUD: `getMailConfig()`, `updateMailConfig()` (admin only), `testConnection()`, `sendTestEmail()`
- `templates.ts` — email template registry: CRUD for `email_templates.json`, render template with variable substitution
- `branding.ts` — HTML email wrapper matching v1's `_branding.php` (header, footer, logo, colors)
- `logs.ts` — mail log: `listMailLogs()`, `getMailLog()`, cleanup old entries

**Notifications (`src/notifications/`):**
- `types.ts` — Zod schemas: Notification (id, user_id, type, title, body, link, read, created_at)
- `store.ts` — CRUD for `notifications.json` (team-scoped):
  - `listForUser(userId, opts)` — paginated, filter read/unread
  - `markRead(userId, notificationId)`, `markAllRead(userId)`
  - `create(notification)` — used by other modules to push notifications
  - `deleteOld(days)` — cleanup
- `push.ts` — notification creation helpers: `notifyUser()`, `notifyRole()`, `notifyTeam()`

**Scheduled notifications (`src/scheduled-noti/`):**
- `types.ts` — Zod schemas: ScheduledJob (id, name, type, schedule_cron, config, enabled, last_run, next_run)
- `store.ts` — CRUD for `scheduled-noti.json` (team-scoped)
- `runner.ts` — job type handlers:
  - `send-chat`: Google Chat webhook message
  - `send-grafana-paused`: check Grafana for paused alerts, notify if found
  - `send-shift-summary`: compile shift summary email from board/activity data and send

### Pages

- `app/(admin)/admin/mail-config/page.tsx` — **Mail Configuration** (admin):
  - SMTP settings form: host, port, encryption (none/TLS/STARTTLS), username, password (masked), from_name, from_email
  - "Test Connection" button with live result (success/failure + latency)
  - "Send Test Email" with recipient input
  - Mail log table: timestamp, recipient, subject, status, error
  - Email template editor: list templates, edit HTML with live preview

- `app/(app)/notifications/page.tsx` — **Notifications** (or could be a popover component):
  - Actually, notifications in v1 are a bell icon in the header, not a separate page.
  - Build a **NotificationBell** component for the app layout header:
    - Badge with unread count
    - Click → dropdown/popover listing recent notifications
    - Each: icon + title + body preview + timestamp + read/unread indicator
    - Click notification → navigate to link, mark as read
    - "Mark all as read" button
    - "View all" link → full notifications page (optional)
  - Wire the bell component into `app/(app)/layout.tsx` header

- `app/(admin)/admin/scheduled-noti/page.tsx` — **Scheduled Notifications** (admin):
  - Table of scheduled jobs: name, type, schedule (cron expression + human-readable), enabled toggle, last run, next run, status
  - Create/Edit dialog:
    - Name, type (send-chat / send-grafana-paused / send-shift-summary)
    - Schedule: cron expression with helper (e.g., "every day at 9:00 AM")
    - Type-specific config (webhook URL, recipient list, etc.)
    - Enable/disable toggle
  - Manual "Run now" button per job
  - Execution log: last N runs with result

### API routes

- `app/api/mail/config/route.ts` — GET/PUT: SMTP config (admin)
- `app/api/mail/test-connection/route.ts` — POST: test SMTP
- `app/api/mail/send-test/route.ts` — POST: send test email
- `app/api/mail/logs/route.ts` — GET: mail logs
- `app/api/mail/templates/route.ts` — GET/POST/PUT/DELETE: email templates
- `app/api/notifications/route.ts` — GET (list for current user) / POST (create, internal)
- `app/api/notifications/read/route.ts` — POST: mark read / mark all read
- `app/api/scheduled-noti/route.ts` — GET/POST: scheduled jobs CRUD
- `app/api/scheduled-noti/[id]/route.ts` — PUT/DELETE: update/remove job
- `app/api/scheduled-noti/[id]/run/route.ts` — POST: manual trigger

### Rules

- Mail config: sm_admin only for writes
- Notifications: user-scoped (each user sees only their own)
- Scheduled noti: sm_admin only
- Team-scoped: all data files via readTeamFile
- SMTP password: store encrypted or at minimum never return in GET responses — mask with `****`
- logActivity on config changes, job creation, manual runs
- logSecurity on SMTP config changes
- Zod on every write
- MSW mock for SMTP (use existing Mailpit mock pattern if available in v2)
- DO NOT install new npm packages — nodemailer is already available from Phase 1

### Design

- Mail config: clean admin form with card layout, test results in alert boxes
- Notification bell: subtle badge (red dot or count), dropdown max 5 items with "View all"
- Scheduled noti: data table with toggle switches, cron helper tooltip
- Email template editor: side-by-side code/preview (optional, can be simplified to textarea + preview button)
- Dark mode support throughout

### Nav registration

Add these to `config/nav.ts` if not present:
- `admin-mail-config` under admin group
- `admin-scheduled-noti` under admin group

### Tests

- Unit: notification CRUD, mark read, cleanup
- Unit: email template variable substitution
- Unit: SMTP config validation (required fields)
- Unit: scheduled job cron parsing
- Integration: MSW mock SMTP, verify send flow

## Verify

Dev JWT recipe in `HANDOFF.md`. Then: configure SMTP → test connection → send test email → check logs → create a notification → see bell → create a scheduled job → run it. 3-4 screenshots to `/tmp/mail-*.png`.

## Report (under 200 words)

What built, v1 endpoints matched, screenshots captured, gaps. No `npm install`.
