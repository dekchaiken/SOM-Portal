# Brief A6 — Settings page + Forgot/Reset password

Feature Engineer. Starting cold.

## Must read first

1. `api/auth/` (login, logout, me, profile, change-password, forgot-password if present), `api/mail/`, `api/mail-config/`
2. `data/sm/users.json`, `data/sm/mail_config.json` (shape)
3. `som-portal-v2/src/auth/session.ts`, `src/auth/password.ts`, `src/auth/user-lookup.ts`
4. `som-portal-v2/src/theme/ThemeProvider.tsx`, `src/theme/useTheme.ts`
5. `som-portal-v2/app/(public)/login/page.tsx` (reuse hero + BrandMark)

## Mission

### 1. Settings page `/v2/settings`
- Theme picker: 4 themes × 2 modes + GenZ overlay — persist per-user `data/<team>/user-prefs.json`
- Profile: name, nickname, email, avatar upload (base64)
- Password: change (current + new + confirm) via bcrypt
- Notifications: toggle types (board, jira, jenkins, incident) — persist in user-prefs
- Sessions: list active + "Sign out everywhere"

APIs: `GET/PATCH /api/v1/user-prefs`, `POST /api/v1/auth/change-password`, `POST /api/v1/auth/sign-out-everywhere`

### 2. Forgot password `/v2/forgot-password`
- Form: email only
- POST `/v2/api/auth/forgot-password` → lookup by email → 32-byte token → store `data/<team>/reset-tokens.json` `{token, user_id, expires_at}` → email reset link via nodemailer (SMTP from mail_config.json)
- Always respond ok:true (don't leak existence)
- Dev mode: log reset link to console instead of email

### 3. Reset password `/v2/reset-password?token=...`
- Form: new password + confirm
- POST `/v2/api/auth/reset-password` → validate token (not expired/consumed) → bcrypt → update users.json (password + password_history last 3 + password_changed_at + clear must_reset) → delete token
- Success → redirect `/v2/login`

### Rules
- Auth routes public (check middleware.ts — forgot/reset should be in PUBLIC_PATHS already from Phase 0)
- Rate limit: forgot 3/hour/ip, reset 5/hour/ip
- Password policy: min 10, upper + digit
- Theme change applies IMMEDIATELY (don't wait for save)
- Audit via logSecurity on password change
- MSW mock nodemailer in tests

### Design
- Settings: tabbed (Appearance / Profile / Password / Notifications / Sessions), left tabs, right content
- Appearance: Theme grid (4 live preview cards) + Mode toggle + GenZ overlay (SM-only)
- Forgot: reuse login split-screen hero + simple form
- Reset: same split-screen + strength meter on new password

## Verify

Dev JWT (sm_user). Steps:
1. /v2/settings → theme to "console" → verify html data-theme updates + user-prefs.json
2. /v2/settings → change password with test values → revert
3. /v2/forgot-password → submit → verify reset link in console log
4. Grab token → /v2/reset-password → set new password → verify → log in with new → revert

**Cleanup**: revert password changes. Delete test tokens.

Screenshots `/tmp/settings.png`, `/tmp/forgot.png`, `/tmp/reset.png`.

## Report (under 200 words)
