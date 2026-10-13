# HANDOFF — SOM Portal v2 — resume checkpoint (end of Phase 1)

**Last update:** 2026-10-12, end of Phase 1 cleanup.
**Why handing off:** previous session approached context limit after driving 6 parallel feature agents + 3 finisher agents to completion.

## Where we are (verified on disk)

### ✅ Phase 1 — SHIPPED
Seven feature modules + three finisher passes closed the full Phase-1 scope locked in `tickets/T-08-migration-order.md`.

- `tsc --noEmit`: **0 errors**
- `vitest run`: **105 / 105 pass** (10 files)
- All Phase-1 pages return HTTP 200 for the correct role; admin pages return **HTTP 403** (not 200 + forbidden body) when accessed by non-admins
- Multi-team isolation verified: an SM post does NOT appear when the same URL is visited with a `team=dev` JWT
- v1 data on disk restored byte-identical after e2e tests (nothing leaked into `data/`)

### 📦 What's on disk right now

Routes with `page.tsx`:
- Public: `/v2/login` ✅
- `(app)`: `/v2/dashboard`, `/v2/board`, `/v2/board/[id]`, `/v2/board/trash`, `/v2/jenkins-build`, `/v2/jira-templates`, `/v2/settings`
- `(admin)`: `/v2/admin`, `/v2/admin/users`, `/v2/admin/system-settings`, `/v2/admin/menu-permissions`, `/v2/admin/nav-groups`, `/v2/admin/super-team-permissions`
- Helpers: `/v2/bridge`, `/v2/preview/flair`, `/v2/preview/theme`

API routes: 31 under `app/api/*` + `app/api/v1/*` (auth, board via server actions, jira, jenkins, users, teams, nav-groups, menu-permissions, user-prefs, system-settings, feature-flags, page-access).

Service layer: `src/{board,jira,jenkins,admin,perms,account,mail,auth,data,team,ui,theme,icons,logging,lib}` — all services team-scoped via `readTeamFile` / shared via `readSharedFile`, writes gated by `requireRole`, mutations call `logActivity` + `logSecurity`.

### ⚠️ Known bugs still to close before cutover

1. ~~**`app/(public)/forgot-password/page.tsx` and `app/(public)/reset-password/page.tsx` are missing**~~ — **FIXED 2026-10-12.** Both pages now exist with full UI: forgot-password sends the reset link request, reset-password validates token via GET then shows new-password form with strength meter. Three new icons added: `arrow-left`, `eye-off`, `log-in`.
2. ~~Admin index page (`/v2/admin`) is a placeholder~~ — **FIXED 2026-10-12.** Now shows real KPI tiles (user count, team count, session timeout) read from data files, plus the quick-nav card grid. Proper session/role gating added.
3. One `src/board/global-data.ts` `TeamSchema.page_modes` quirk — accepts both `{}` and `[]` because v1 writes `[]` on a fresh team. Keep an eye on it when adding more team-scoped reads.

### 📊 v1 vs v2 coverage

See **`PAGE-COMPARISON.md`** in this directory for the full page-by-page table.
Summary: v2 ships **8 user pages + 6 admin pages = 14 / ~134 active pages (~10%)**. Phase 1's scope is the SM-daily hot path; everything else is in Phase 2 or Phase 3.

## What's next

### Immediate (fix before cutover)
1. Write `app/(public)/forgot-password/page.tsx` + `app/(public)/reset-password/page.tsx` — use existing shadcn Input/Button and the login screen's HeroPanel/AmbientOrbBg. Wire to the two API routes that already exist. Rate-limit UI copy per `data/forgot_rate_limit.json`.
2. Decide `/v2/admin` landing page: redirect to `/v2/admin/users` or build a proper admin index with KPIs.

### Phase 2 — SM T1 modules not yet in v2
After the two bugs above are closed, dog-food Phase 1 for 2 weeks (`tickets/T-08`), collect feedback, then start Phase 2. Suggested agent split (reuse the brief style under `HANDOFF-BRIEFS/`):

- **P2-A**: Service Performance — 3-col command center, Thanos PromQL, CSV drift. Memory references: `project_service_performance`, `feedback_promql_escape`, `research/promql-tag.md`.
- **P2-B**: MA Status + MA Services — use `project_ma_status_integrations`. SM-shared data.
- **P2-C**: Restart Monitor + Restart Analyzer — `project_restart_analyzer`, uses kube-state-metrics via `api/restart-analyzer/`.
- **P2-D**: Log Explorer + per-user OpenSearch creds — `project_log_explorer`, `project_opensearch_log_viewer`, `research/opensearch-creds.md`.
- **P2-E**: Incident Launcher — `project_incident_launcher`, SM-only, 5-task multi-step flow.
- **P2-F**: Mail config + notifications + scheduled-noti — SMTP via `nodemailer`, mock via Mailpit.

Each agent follows the same contract as Phase 1: read v1 PHP source as spec, read/write real `data/<team>/*.json`, multi-team isolation, respect `canSeePage` + `requireRole`, Zod on every write, MSW for external services in tests, Playwright + screenshot before reporting done.

### Phase 3
~110 pages — see `PAGE-COMPARISON.md`. Includes the remaining admin pages, Learn/KB, GenZ, Dev team views, legacy ops pages, maintenance screen, then PHP deprecation.

## How to resume (concrete steps)

1. `cd /Users/warapon.lea/Downloads/otherteam/SOM-Portal/som-portal-v2`
2. If the dev server isn't running, start it: `npm run dev` in the background with the longest allowed timeout. Confirm `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/v2/login` returns `200`.
3. Confirm tests still green: `npx tsc --noEmit` + `npx vitest run`.
4. Read **`PAGE-COMPARISON.md`** for the full v1 vs v2 table — this replaces the earlier `project_som_full_feature_map` memory which was incomplete.
5. Read `map.md` for Phase-0 decisions (T-01..T-09, D-01..D-07) and `tickets/T-08-migration-order.md` for the agreed Phase 1→2→3 split.
6. For the two immediate bugs (forgot/reset UI, admin index), handle them inline — small enough that spawning agents is overkill.
7. For Phase 2, mint six briefs under `HANDOFF-BRIEFS/p2-*.md` using the Phase-1 briefs as templates, then launch six agents in parallel.

## Dev JWT recipe (used by every e2e)

```ts
import { SignJWT } from 'jose';
const secret = new TextEncoder().encode('dev-secret-at-least-16-characters-long-ok');
const token = await new SignJWT({
  sub: 'usr_dev',
  username: 'warapon.lea',
  role: 'sm_user',           // 'sm_admin' / 'super_admin' for admin pages
  team: 'sm',                // or 'dev' etc. for isolation checks
  is_genz: false,
}).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('8h').sign(secret);

await ctx.addCookies([
  { name: 'som_session_v2', value: token, domain: 'localhost', path: '/v2', httpOnly: true },
  { name: 'som_user', value: JSON.stringify({ id:'usr_dev', username:'warapon.lea', role:'sm_user', team:'sm' }), domain: 'localhost', path: '/v2' },
]);
```

`.env.local` already has `JWT_SECRET=dev-secret-at-least-16-characters-long-ok`.

## Standing rules (reminder for sub-agents)

- v1 data path: `/Users/warapon.lea/Downloads/otherteam/SOM-Portal/data/<team>/*.json`
- `readTeamFile`/`writeTeamFile` for team-scoped files; `readSharedFile`/`writeSharedFile` for SM-shared
- Role gate every write: `requireRole(...ADMIN_ROLES)` or finer
- Feature-flag check: `canSeePage(pageId, session)` from `config/permissions.ts`
- Wire envelope: `Result<T> = { ok: true, data } | { ok: false, error, code? }` on every SA + route handler
- `logActivity` + `logSecurity` on every important mutation
- v1 JSON field names 1:1 so dual-run stays consistent
- MSW mocks for Jira / Jenkins / SMTP in tests — never hit real services
- **basePath = `/v2`** → `<Link href="/...">` auto-prepends `/v2`; writing `href="/v2/..."` in Link produces `/v2/v2/...`. Rule: Link gets paths without `/v2`; raw `<a>`, `fetch`, `window.location.*` keep the full `/v2/...` path.
- Clean up any test data in `data/` after e2e
- Do NOT run `npm install` or modify dev server config
- Screenshot every page with Playwright + dev JWT, write to `/tmp/<module>-*.png`

## Reference docs in this directory

- **`PAGE-COMPARISON.md`** — v1 vs v2 page-by-page (replaces old feature-map memory)
- `map.md` — Phase-0 decisions index
- `architecture.md` — RSC + Server Actions patterns
- `codebase_design.md` — 10 code patterns + 7 D-tickets
- `domain_model.md` — entities, access rules, invariants
- `design_system.md` — tokens, components, theming
- `test_strategy.md` — Vitest + Playwright + MSW + Mailpit layering
- `prd.md`, `agents.md` — product + delivery context
- `tickets/T-01..T-09.md`, `tickets/D-01..D-07.md` — closed decisions with reasoning
- `research/inventory.md` — the v1 filesystem baseline (88 user HTML, 73 admin, 101 API dirs)
- `research/{jira-fields,opensearch-creds,promql-tag}.md` — three external-API shape studies for Phase 2
- `research/ui-skills-matrix.md` — 31 ui-skills surveyed, 21-row concern × skill table
- `HANDOFF-BRIEFS/a1..a6.md` — original Phase-1 agent briefs (template for Phase 2)

## Reminders

- The user is on team `sm` (JWT `team: 'sm'`); use that as the default test role unless they say otherwise.
- No emoji in HTML sinks (use `<Icon name="…">` from `src/icons/`).
- Match SP2's 3-column Command Center pattern for new dashboards.
- `ui-skills` registry is the first stop for UI patterns — see `research/ui-skills-matrix.md`.
- Verify files on disk after any sub-agent reports done; a report is not a result.
- Always screenshot UI changes before saying "done".
