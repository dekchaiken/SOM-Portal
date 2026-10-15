# Auth draft: Keycloak SSO (NextAuth) + local username/password

Status: DRAFT for review. Not implemented. Scope: som-portal-v2 login and session only.

## 1. Goals

- Two login methods on the login page:
  1. **Keycloak SSO** through NextAuth (Auth.js) with the Keycloak OIDC provider. This is the default for staff.
  2. **Username and password**, the existing flow. It stays for teams that see a restricted set of tools: Wealth BU, Jenkins Portal and SO Jenkins.
- Both methods produce the same internal session shape `{ sub, username, role, team, ... }`, so `src/auth/policy.ts` and every page that calls `requireAuth` / `requireRole` stay unchanged.
- Only `super_admin` can create, edit or disable users and change their roles and teams. This is enforced on the server, not only hidden in the UI.

## 2. Identity model

- `data/users.json` stays the source of truth for **who may use the portal**, and for their `role` and `team`.
- Keycloak only proves identity. After a successful Keycloak login, the portal looks the user up in `users.json` by **email** (`email` must be added to the user record and must be unique).
- Rules:
  - Email found and user is active: sign in with that user's `role` and `team`.
  - Email not found, or user disabled: deny access and show a clear message. Keycloak never creates a portal user by itself.
  - Keycloak group or role claims are **not** used for authorization in this draft. They can be added later if you want them.

## 3. Choosing the login method

Decision needed (see section 8). Proposed default:

- Each user record gets `auth_method: 'sso' | 'password'`.
- The login page shows both buttons. The server rejects a password login for an `sso` user and rejects an SSO login for a `password` user.
- Teams Wealth BU, Jenkins Portal and SO Jenkins are set to `password` when their accounts are created. Everyone else defaults to `sso`.

## 4. Flows

### 4.1 Keycloak SSO

1. User clicks "Sign in with Keycloak". NextAuth starts the OIDC authorization-code flow (with PKCE) against the Keycloak realm.
2. Keycloak returns an ID token with `email`, `preferred_username` and `sub`.
3. A NextAuth `signIn` callback looks up `users.json` by email.
   - If allowed, it returns the user and the callback attaches `role` and `team`.
   - If not, it returns false and the user lands on an access-denied page.
4. The NextAuth session is converted into the existing portal session cookie so that `getSession()` keeps working.

### 4.2 Username and password

Unchanged: `/api/auth/login` checks the bcrypt hash in `users.json`, then issues the current session cookie. Only applies to users with `auth_method = 'password'`.

### 4.3 Logout

Clears the portal session cookie and calls Keycloak's end-session endpoint for SSO users.

## 5. User administration (super_admin only)

- Pages and endpoints under `admin/users` require `super_admin`. Other admin roles get a 403 from the server.
- Editable fields: name, email, username, role, team, `auth_method`, active flag.
- Every change is written to the security log with the actor, the target and the diff.
- Creating a user requires email, because SSO matching depends on it.

## 6. Configuration

Environment variables (server only):

| Name | Purpose |
|---|---|
| `AUTH_SECRET` | NextAuth signing secret |
| `AUTH_URL` | Public base URL of the portal (`/v2` basePath included) |
| `KEYCLOAK_ISSUER` | `https://<host>/realms/<realm>` |
| `KEYCLOAK_CLIENT_ID` | Confidential client ID |
| `KEYCLOAK_CLIENT_SECRET` | Client secret (never committed) |
| `JWT_SECRET` | Existing portal session secret, unchanged |

Keycloak client settings to request from the Keycloak admin:
- Client type: confidential, standard flow on, PKCE S256.
- Valid redirect URI: `<AUTH_URL>/api/auth/callback/keycloak`.
- Scopes: `openid email profile`.
- Email must be verified in Keycloak, otherwise matching is unsafe.

## 7. Security notes

- No credentials are stored in this repo. Secrets come from the environment.
- Email matching only after a verified email claim. Unverified emails are rejected.
- Rate limiting on the password login stays as it is.
- An SSO user cannot log in with a password, and a password user cannot use SSO, which keeps the two paths separate.
- Superadmin changes are logged. Removing the last superadmin is blocked.

## 8. Open questions

1. Which teams default to SSO and which to password? The draft assumes everyone except the three named teams uses SSO.
2. Should SSO users ever be able to log in with a password as a fallback, for example during a Keycloak outage? Draft says no.
3. Do you want to keep `users.json` as the store for now, or move users into a database later?
4. Keycloak realm name, and confirmation that users' Keycloak emails match the emails in `users.json`.

## 9. Test plan

- Unit tests: email-to-user mapping (found, not found, disabled, unverified email), `auth_method` enforcement, superadmin-only checks on user admin routes.
- Integration: run a local OIDC mock (for example a containerised Keycloak or a mock issuer) through the NextAuth callback. The sandbox cannot reach the internal Keycloak host, so the real Keycloak test has to run on your side.
- E2E: Playwright login for each method, plus a denied case for a user missing from `users.json`.

## 10. Out of scope for this draft

- Keycloak group-to-role mapping.
- Social login or MFA beyond what Keycloak provides.
- Changing the team-based access model for tools and data.
