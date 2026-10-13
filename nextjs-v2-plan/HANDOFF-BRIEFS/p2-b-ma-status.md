# Brief P2-B — MA Status + MA Services

You are a Feature Engineer building the **MA Status** and **MA Services** modules for SOM Portal v2 (Next.js 15 rewrite). Starting cold.

## Project layout

- v1 (PHP): `/Users/warapon.lea/Downloads/otherteam/SOM-Portal/`
- v2 (Next.js): `/Users/warapon.lea/Downloads/otherteam/SOM-Portal/som-portal-v2/`

## Must read first

1. `som-portal-v2/nextjs-v2-plan/map.md` — Phase-0 decisions
2. `som-portal-v2/nextjs-v2-plan/codebase_design.md` — patterns (RSC + Server Actions + Result<T>)
3. `som-portal-v2/nextjs-v2-plan/domain_model.md` — roles, teams, access rules
4. `som-portal-v2/nextjs-v2-plan/HANDOFF.md` — resume checkpoint, JWT recipe, standing rules
5. `api/ma-status/_lib.php` — default Jenkins jobs list for MA status polling
6. `api/ma-status/_backoffice.php` — backoffice API client (ACM config server)
7. `api/ma-services/list.php`, `create.php`, `update.php`, `delete.php` — CRUD
8. `api/ma-services/jenkins-status.php`, `jenkins-trigger.php`, `jenkins-params.php` — Jenkins integration
9. `api/ma-services/backoffice-get.php`, `backoffice-save.php`, `backoffice-toggle.php` — BO config toggle
10. `api/ma-services/jira-stats.php` — Jira issue stats per MA service
11. `api/ma-services/types.php`, `import.php`, `log.php`, `logs-list.php`
12. `ma-status.html` (237 lines) + `ma-services.html` (if exists) — v1 frontends
13. `data/sm/ma-services.json` — service registry shape
14. `data/sm/ma-modules.json` — module grouping
15. `data/sm/ma-types.json` — MA type taxonomy
16. `data/sm/ma-status-cache.json` — cached Jenkins poll results
17. `data/sm/ma-status-hidden.json` — user-hidden MA items
18. `data/sm/ma-toggle-rl.json` — rate limit for BO toggles

Also peek at existing v2 patterns: `src/jenkins/` for how Jenkins proxy is done, `src/board/` for CRUD patterns.

## Mission

Two pages matching v1's MA subsystem — status dashboard + service registry.

### Service layer (`src/ma/`)

- `types.ts` — Zod schemas for MAService, MAModule, MAType, MAStatusCache, Jenkins poll response
- `services-store.ts` — CRUD for `ma-services.json` (team-scoped via readTeamFile/writeTeamFile)
- `modules-store.ts` — read/write `ma-modules.json`
- `types-store.ts` — read/write `ma-types.json`
- `status-poller.ts` — poll Jenkins jobs for MA status (reads `ma-status-jenkins.json` or defaults from `_lib.php`), cache to `ma-status-cache.json`
- `backoffice-client.ts` — ACM backoffice API client: list apps, get/update config properties
- `jira-stats.ts` — aggregate Jira issue counts per MA service per year

### Pages

- `app/(app)/ma-status/page.tsx` — **MA Status Dashboard**:
  - Grid of MA service cards, each showing:
    - Service name, type badge
    - Current MA status: ON (red) / OFF (green) with timestamp
    - Jenkins job link + last build status
    - Toggle button (if user has permission) with confirmation dialog
    - BO config key + current value
  - Group by module tabs
  - Filter: all / active-MA-only / by type
  - Auto-refresh (poll every 30s by default, configurable)
  - Hide/show individual items (persisted in ma-status-hidden.json per user)

- `app/(app)/ma-services/page.tsx` — **MA Services Registry** (CRUD):
  - Table of all MA services with columns: name, type, module, Jenkins job, BO config key, status, actions
  - Create / Edit dialog (modal form):
    - Name, description, type (from ma-types), module (from ma-modules)
    - Jenkins server + job path + state_param + on_values
    - BO application + property key
    - Critical flag, ordering
  - Delete with confirmation
  - Import from JSON
  - Activity log viewer
  - Jira stats sidebar: issue count per service per month

### API routes

- `app/api/ma-status/route.ts` — GET: poll + cached status
- `app/api/ma-status/toggle/route.ts` — POST: BO config toggle (rate-limited via ma-toggle-rl.json)
- `app/api/ma-services/route.ts` — GET (list) / POST (create)
- `app/api/ma-services/[id]/route.ts` — PUT (update) / DELETE
- `app/api/ma-services/types/route.ts` — GET type taxonomy
- `app/api/ma-services/jenkins-status/route.ts` — GET: poll single job
- `app/api/ma-services/jira-stats/route.ts` — GET: issue counts

### Rules

- Team-scoped: all `ma-*.json` files via readTeamFile
- SM-shared: modules and types configs
- Auth: any authenticated staff for reading, sm_lead / sm_admin for writes
- BO toggle rate limit: 3/min/user (match v1's ma-toggle-rl.json)
- Jenkins proxy: reuse existing `src/jenkins/` proxy infrastructure
- Match v1 field names for dual-run
- Zod on every write
- MSW mock for Jenkins + Backoffice API in tests

### Design

- Status dashboard: card grid with color-coded status indicators (green=normal, red=MA active)
- Toggle: prominent red/green button with loading spinner + rate-limit warning
- Services table: clean data table with inline status badges, filter/search header
- Create/Edit: multi-step form in shadcn Dialog with validation
- Mobile: responsive cards, swipe to toggle
- Dark mode support

### Tests

- Unit: MA service CRUD, status polling logic, BO client request shape
- Unit: rate limit enforcement
- Integration: MSW mock Jenkins + BO responses, verify status dashboard data flow

## Verify

Dev JWT recipe in `HANDOFF.md`. Then: view status dashboard → toggle a service → open services registry → create/edit/delete. 3-4 screenshots to `/tmp/ma-*.png`.

## Report (under 200 words)

What built, v1 endpoints matched, screenshots captured, gaps. No `npm install`.
