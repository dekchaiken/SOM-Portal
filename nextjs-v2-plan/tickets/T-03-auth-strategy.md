# T-03 — Auth: reuse v1 JWT or adopt Auth.js?

> Type: `decision` · HITL · Blocked by: — · Owner: unclaimed · Blocks: T-08, T-09

## Question

How does v2 authenticate users during dual-run and after?

## Context

- v1: JWT HS256, `JWT_SECRET` in `.env`, 8h default expiry, 30d "remember me". Stored in `localStorage` as `som_token` + `som_user`.
- Rate limiting: 5 failed logins / 15min lockout (file-based `data/rate_limit.json`).
- Session timeout configurable via system-settings.
- Password hashing: bcrypt (`$2y$`), with `$2b$` normalisation for legacy Python hashes.
- Users living in `data/users.json` (per-team).

During dual-run, a user who logs in on PHP should NOT have to log in again on `/v2/`. Easiest path: both sides issue + verify the same JWT shape.

## Options

**A. Reuse v1 JWT verbatim** _(recommended)_
- v2 reads `JWT_SECRET` from the same `.env`.
- `jose` library for HS256 verify + sign.
- Store token in an **HttpOnly cookie** on v2 (safer than localStorage) + mirror a non-sensitive `som-user` cookie for `useSession()` hydration.
- During dual-run, v2 also tolerates reading `localStorage.som_token` via a one-time migration page that sets the HttpOnly cookie.

**B. Adopt Auth.js (NextAuth v5)**
- Pros: library handles cookies, session refresh, OAuth if we ever add it.
- Cons: Auth.js's default JWT shape is different; we'd have to write a custom encoder/decoder to match v1 and risk drift. Also, Auth.js's "users" model doesn't map cleanly to our per-team `data/<team>/users.json` layout.

**C. Build custom + session store in Postgres (if T-01 picks PG)**
- Cleanest long-term; blocked on T-01.

## Resolution

**Decision:** Reuse v1 JWT shape verbatim. Verify + sign with `jose` using the same `JWT_SECRET` from `.env`. v2 issues an **HttpOnly `som_session_v2` cookie** carrying the token; a mirror non-sensitive `som_user` cookie carries `{sub, team, role, is_genz, dev_subteam}` for `useSession()` hydration. One-time compat page at `/v2/_bridge` reads legacy `localStorage.som_token` and sets the HttpOnly cookie.

**Why:**
1. Users already logged into PHP shouldn't re-login when they hit `/v2/`. Shared secret = shared sessions.
2. HttpOnly cookie closes the XSS exfiltration window v1's localStorage leaves open.
3. Auth.js introduces a token encoder we'd have to reverse to stay compatible — more risk than reward.
4. Rate limiting + password policy stay identical (bcrypt `$2y$` + `$2b$` legacy quirk preserved).

**Follow-ups:**
- Define `src/auth/{session,middleware,policy}.ts` shape in Foundation Engineer's first PR.
- Rate-limit backend choice in [D-04](./D-04-rate-limit-backend.md).

**Owner:** Chief Architect
**Date:** 2026-10-11
