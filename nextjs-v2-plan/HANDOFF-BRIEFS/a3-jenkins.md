# Brief A3 — Jenkins build + Batch monitor

Feature Engineer. Starting cold.

## Must read first

1. `som-portal-v2/nextjs-v2-plan/codebase_design.md`
2. All files under `api/jenkins-proxy/`, `api/jenkins-servers/`, `api/jenkins-build/`, `api/batch-monitor/`, `api/batch-records/`, `api/batch-file-index/`, `api/batch-meta/`
3. `api/jenkins_config.php` + `api/jenkins_helpers.php`
4. Top-level `jenkins-proxy.php` + `batch-records.php` + `batch-records-admin.php`
5. `data/sm/jenkins_servers.json` (shape)
6. Memory `project_host_cooldown_hardening.md`
7. `som-portal-v2/src/team/scope.ts`, `src/auth/policy.ts`, `src/lib/result.ts`

## Mission

### Pages
- `app/(app)/jenkins-build/page.tsx` — pick server → job → params → trigger → status polling
- `app/(app)/batch-monitor/page.tsx` — recent batch runs + filters + detail drawer
- `app/(app)/batch-file-search/page.tsx` — grep indexed batch files
- `app/(admin)/admin/jenkins-servers/page.tsx` — CRUD servers (ADMIN_ROLES)

### Modules
- `src/jenkins/client.ts` — per-server auth; HOST COOLDOWN circuit breaker (open after N fail, half-open after 60s) per `hostCooldownActive`/`hostCooldownMark` from helpers.php
- `src/jenkins/types.ts` — Zod schemas

### APIs
- `GET/POST/PATCH/DELETE /api/v1/jenkins-servers` (ADMIN_ROLES, SM-shared)
- `POST /api/v1/jenkins-proxy` — `{ serverId, method, path, body }` → forward with creds
- `GET /api/v1/batch-records` + filters
- `GET /api/v1/batch-file-index/search?q=`

### Rules
- SM-shared: jenkins_servers.json
- Feature: `feature:jenkins-build`, `feature:batch-monitor`
- Admin page: `requireRole(...ADMIN_ROLES)`
- MSW mocks — never hit real Jenkins
- Status polling: 2s interval, stop on terminal state, max 60 polls

### Design
- Jenkins Build: 3-pane (servers / jobs / params) à la Service Performance
- Batch Monitor: filter bar + table + drawer
- Admin Servers: table + Add + edit modal

## Verify

Dev JWT. MSW for Jenkins. Visit each page + verify flow. Screenshots `/tmp/jenkins-build.png`, `/tmp/batch-monitor.png`, `/tmp/jenkins-admin.png`.

## Report (under 200 words)
