# Login redesign: Keycloak SSO (Auth.js) + username/password

Status: implemented in som-portal-v2 (branch `claude/keycloak-auth-draft`). Keycloak
itself is not configured yet. The superadmin enters the settings in the admin UI.

## 1. Model

- Every user has `allowed_methods`, a list drawn from `['sso', 'password']`.
  - Missing field = legacy v1 account. It keeps password login so nothing breaks before
    SSO is configured. The superadmin can close it in bulk (section 5).
- New users are created by the superadmin with an email. They get `['sso']` and no password.
- Granting `password` issues a one-time setup link (24 h, single use) through the existing
  reset-password flow. No password is ever sent by email.
- `super_admin` accounts always keep password as a break-glass login. The server enforces
  this on edit, on bulk close and at login.
- Teams `wealth`, `jenkins` and `sojenkins` (Wealth BU, Jenkins Portal, SO Jenkins) get
  `['password']` in the bulk close.

## 2. Sign-in flows

- **Keycloak:** Auth.js (next-auth 5.0.0-beta.32, pinned) with the Keycloak provider.
  The login page shows the button only when the superadmin has finished setup
  (`/v2/api/auth/methods`). After Keycloak signs the user in, `signIn` checks the verified
  email against `data/users.json` (global). A legacy record or an explicit `sso` grant allows
  SSO. Then `/v2/api/auth/sso/complete` issues the normal portal session cookie. Keycloak
  never creates users.
- **Password:** unchanged, except that it refuses users without `password` in
  `allowed_methods`. A refusal gives the same generic error as a wrong password.

Session shape is the same for both methods, so `policy.ts` and every page guard are unchanged.

## 3. Superadmin UI and API

- Page: `/v2/admin/auth-access` (nav "Login Access", super_admin only).
  - Keycloak settings: enable switch, button label, issuer, client ID, client secret
    (write-only; blank keeps the stored value).
  - User table: toggle SSO and Password per user, copy setup links, search.
  - "Add SSO user" (email, name, team, role, optional username).
  - "Close password for legacy accounts" (bulk, asks for confirmation).
- API (all `requireRole('super_admin')`):
  - `GET/PUT /v2/api/v1/auth/config`
  - `GET /v2/api/v1/auth/users`, `POST /v2/api/v1/auth/users`
  - `PATCH /v2/api/v1/auth/users/[id]` with `{ allowed_methods }`
  - `POST /v2/api/v1/auth/legacy-close`

## 4. Storage and secrets

- `data/auth-config.json` (global). The client secret is encrypted with AES-256-GCM,
  using the same helper as mailbox passwords and the same `MAIL_CREDS_KEY` (32+ characters).
  Saving a secret fails if the key is not set.
- The config API never returns the secret, only whether one is set.
- Every change writes to the security log (`auth.config_changed`, `auth.methods_changed`,
  `auth.user_created`, `auth.legacy_closed`).

## 5. Server settings for Keycloak

| Setting | Where |
|---|---|
| `AUTH_SECRET` | env (falls back to `JWT_SECRET`) |
| `AUTH_URL` | env: `https://<portal host>/v2/api/auth`. Auth.js builds the callback from it. |
| `MAIL_CREDS_KEY` | env, 32+ characters, needed to encrypt the client secret |
| issuer, client ID, client secret | superadmin UI (`/v2/admin/auth-access`) |

Keycloak client:
- Confidential client, standard flow on, PKCE S256.
- Redirect URI: `<AUTH_URL>/callback/keycloak`, for example
  `https://portal.example/v2/api/auth/callback/keycloak`.
- Scopes `openid email profile`. Emails must be verified in Keycloak.

## 6. Tests and what was verified

- Unit tests (`vitest run src/auth`, 23 tests): method rules, legacy default, break-glass,
  SSO eligibility, verified-email rule, duplicate detection, username suggestion, no hash in
  views, secret never exposed in public config.
- Dev server against a copy of the data, with a local mock OIDC provider (Keycloak itself is
  not reachable from the sandbox):
  - password login works for legacy and granted accounts, and is refused for SSO-only accounts
  - superadmin config API works, a non-admin gets 403
  - create user, duplicate rejected, grant password, reset link works once
  - bulk close keeps super_admin on password
  - full Keycloak flow: sign-in, callback, completion route, portal session, dashboard 200
  - denied: password-only user, unverified email
  - browser: login page shows the Keycloak button only when enabled; the console renders
- **Not verified:** a real Keycloak instance. Run the same checks against it on your side.

## 7. Open items

- Password reset links are shown to the superadmin to copy. Sending them by mail through the
  team mailbox is a follow-up.
- Keycloak group-to-role mapping is not used. Roles and teams come from `users.json`.
- `next-auth` is installed with `--legacy-peer-deps` because its optional peer
  `nodemailer@^7/^8` conflicts with the existing `nodemailer@6`. Upgrading nodemailer
  would remove that flag.
