# T-09 — Dual-run strategy: nginx path routing

> Type: `decision` · HITL · Blocked by: T-04 · Owner: unclaimed

## Question

How do PHP and Next.js serve the same portal under the same hostname during migration?

## Context

Users must not know a cutover is happening. Each page migrated flips independently.

## Proposed

**Base path.** Next.js app runs with `basePath: '/v2'` in `next.config.ts`. During build-up, every v2 page lives under `/v2/<page>` and the top-level nav links to it. PHP keeps `/`.

**Cutover.** When a module is ready for SM primary, nginx rewrites `/old-path` → `/v2/<path>`:

```nginx
# nginx cutover block, appended page-by-page
location = /board.html { return 302 /v2/board; }
location = /jira-templates.html { return 302 /v2/jira-templates; }
# ...
```

**Shared static assets** (`/data/`, `/assets/icons/`): served by PHP box; v2 proxies to them (`rewrites: [{ source: '/data/:path*', destination: 'http://localhost/data/:path*' }]`).

**Session.** HttpOnly cookie `som_session_v2` set at `Domain=.som-portal.local; Path=/`; both apps read it.

## Open questions

- Final-state URLs after PHP shutdown: do we drop the `/v2` prefix, or keep it to avoid cache poisoning?
- Who issues the login? Proposal: v2 owns login after Phase 1; PHP's login page redirects to `/v2/login` with a `?return=` param.

## Resolution

**Decision:** Lock the proposed strategy.

- `next.config.ts`: `basePath: '/v2'`, so every v2 page lives at `/v2/<path>` and asset URLs resolve correctly.
- nginx config appended per-page as each module migrates:
  ```nginx
  # /etc/nginx/conf.d/som-portal.conf
  location /v2/ { proxy_pass http://127.0.0.1:3000; }      # Node (PM2 cluster)
  location /    { # existing PHP root }

  # Cutover (one entry per migrated page)
  location = /board.html         { return 302 /v2/board; }
  location = /jira-templates.html { return 302 /v2/jira-templates; }
  # …
  ```
- Shared static assets: `/data/*` and `/assets/icons/*` served by PHP; v2 proxies to them via `next.config.ts` `rewrites`.
- Session: HttpOnly cookie `som_session_v2`, `Domain=.som-portal.local; Path=/`, read by both apps.
- Login after Phase 1: PHP's login redirects to `/v2/login?return=<orig>`; `/v2/login` sets both cookies (v1 `som_token` for compat + v2 HttpOnly).
- Post-cutover cleanup (Phase 3): drop `basePath`; nginx map rewrites `/v2/* → /*` and the Next.js build is rebased.

**Why basePath over naked routing:** keeps the PHP app's URLs stable during migration (no 404s for links in email / Jira comments). The 302 nginx entries are reversible per page, so rollback is clean.

**Follow-ups:**
- Release Engineer owns `deploy/nginx.conf` + per-module cutover notes.
- Add a `/v2/_bridge` route that reads `localStorage.som_token` and sets `som_session_v2` cookie once (ties to T-03 resolution).

**Owner:** Chief Architect
**Date:** 2026-10-11
