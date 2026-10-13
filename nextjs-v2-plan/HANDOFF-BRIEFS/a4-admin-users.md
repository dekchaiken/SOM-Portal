# Brief A4 — Admin Users + System Settings

Feature Engineer. Starting cold.

## Must read first

1. `api/users/`, `api/system-settings/` (all files)
2. `api/helpers.php` (requireAuth/requireRole/logActivity/logSecurity/verifyPassword/hashPassword)
3. `data/sm/users.json`, `data/system-settings.json` (shape)
4. `som-portal-v2/src/auth/policy.ts`, `src/team/scope.ts`, `src/auth/password.ts`

## Mission

### Pages
- `app/(admin)/admin/users/page.tsx` — table (search, role filter, avatar), row → side-drawer edit, Add user button
- `app/(admin)/admin/system-settings/page.tsx` — grouped form (session timeout, login/api rate limits, MA default, logo, email signature)

### APIs
- `GET /api/v1/users` (ADMIN_ROLES) — current team's users
- `POST /api/v1/users` — create (bcrypt hash)
- `PATCH /api/v1/users/[id]`
- `DELETE /api/v1/users/[id]` — soft (deleted_at)
- `POST /api/v1/users/[id]/reset-password` — temp password, must_reset_password=true, return cleartext once
- `GET/PATCH /api/v1/system-settings` (ADMIN_ROLES; some fields super_admin)

### Rules
- Users per-team (readTeamFile/writeTeamFile users.json)
- SM-shared system-settings.json
- Super admin can switch team via dropdown (`scope.team` escape hatch)
- Role assignment: can only assign ≤ your own (sm_admin ≠ super_admin)
- Password policy: min 10, 1 upper + 1 digit
- Audit every write

### Design
- Users table: avatar circle, name+username, email, role chip, last-active, hover highlight, drawer slides right
- Form sections: Identity / Account / Password actions
- Settings: 2-col grid, group headers, number steppers, debounced inline save with toast
- Confirmation dialogs for destructive

## Verify

sm_admin JWT. Visit `/v2/admin/users` → add test user → change role → reset password → verify security log → DELETE test user (cleanup). `/v2/admin/system-settings` → change session_timeout → save → verify json → revert.

Screenshots `/tmp/admin-users.png`, `/tmp/admin-users-drawer.png`, `/tmp/admin-system-settings.png`.

## Report (under 200 words)
