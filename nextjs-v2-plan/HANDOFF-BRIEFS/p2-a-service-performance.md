# Brief P2-A — Service Performance

You are a Feature Engineer building the **Service Performance** module for SOM Portal v2 (Next.js 15 rewrite). Starting cold.

## Project layout

- v1 (PHP): `/Users/warapon.lea/Downloads/otherteam/SOM-Portal/`
- v2 (Next.js): `/Users/warapon.lea/Downloads/otherteam/SOM-Portal/som-portal-v2/`

## Must read first

1. `som-portal-v2/nextjs-v2-plan/map.md` — all Phase-0 decisions
2. `som-portal-v2/nextjs-v2-plan/codebase_design.md` — patterns (RSC + Server Actions + Result<T>)
3. `som-portal-v2/nextjs-v2-plan/domain_model.md` — roles, teams, access rules
4. `som-portal-v2/nextjs-v2-plan/HANDOFF.md` — resume checkpoint, JWT recipe, standing rules
5. `som-portal-v2/nextjs-v2-plan/research/promql-tag.md` — **CRITICAL**: PromQL escape rules, ThanosClient design, tagged template spec
6. `api/service-performance/_lib.php` (826 lines) — spLoadConfig, spQueryPromQL, spGetSource, spApplyInventoryFilter, _spPromEscape
7. `api/service-performance/index.php` — GET /api/service-performance endpoint
8. `api/service-performance/detail.php` (1542 lines) — per-service detail: CPU/MEM/Pod/HPA/deps/subsystem/deploy panels
9. `api/service-performance/dep-drill.php`, `pods.php`, `deploys.php`, `subsystems.php`, `suggestions.php` — sub-endpoints
10. `service-performance.html` + `assets/pages/service-performance/` — v1 frontend (3-column command center)
11. `data/sm/service-performance-sources.json` — Grafana source config shape
12. `data/sm/grafana_sources.json` — Grafana proxy config (dsUid, orgId, authMode, token)

Also peek at existing v2 patterns in `src/board/`, `src/jira/`, `src/jenkins/` for how services are structured.

## Mission

Full Service Performance module matching v1's 3-column command center layout.

### Service layer (`src/service-performance/`)

- `thanos-client.ts` — ThanosClient class: `instant()`, `range()`, AbortController timeout, 1 retry on 5xx
- `promql.ts` — tagged template `promql` with `str()`, `re()`, `raw()` helpers per research/promql-tag.md
- `escape.ts` — `escapeMatcher()`, `escapeRegex()` matching v1's `_spPromEscape` exactly (DO NOT escape `-`)
- `sources.ts` — read `service-performance-sources.json`, resolve grafana proxy config from `grafana_sources.json`
- `cache.ts` — in-memory + file cache (same TTL as v1's cacheTtlSeconds, default 60s)
- `inventory.ts` — read CSV service inventory, filter services
- `service.ts` — `getOverview()` (all runways), `getServiceDetail()` (single service deep-dive)
- `queries.ts` — all PromQL query templates ported from `_lib.php` and `detail.php`

### Pages

- `app/(app)/service-performance/page.tsx` — **3-column command center**:
  - Left column: runway selector tabs, service list with CPU/MEM mini bars, search/filter
  - Center column: selected service detail — CPU chart, Memory chart, Pod count, HPA status
  - Right column: dependencies drill-down, subsystems, recent deploys, suggestions
  - Auto-refresh with configurable interval (from sources config)
  - Responsive: stack to single column on mobile
- `app/(app)/service-performance/[service]/page.tsx` — deep-dive detail (optional, can be a slide-out panel instead)

### API routes

- `app/api/service-performance/route.ts` — GET: overview (all runways, cached)
- `app/api/service-performance/detail/route.ts` — GET ?service=X&runway=Y: per-service detail
- `app/api/service-performance/dep-drill/route.ts` — GET: dependency drill
- `app/api/service-performance/suggestions/route.ts` — GET: auto-suggestions

### Rules

- Team-scoped: `service-performance-sources.json`, `grafana_sources.json` are SM-shared
- Feature gate: `feature:service-performance` (nav.ts already has `menuId: "service-performance"`)
- Auth: any authenticated staff (ALL_STAFF_ROLES equivalent)
- Grafana proxy auth stays server-side — never expose tokens to client
- Match v1 field names in API responses for dual-run
- Zod on every write and API response shape
- MSW mock for Grafana/Thanos in tests — never hit real services

### Design

- **Command center 3-column layout** matching v1's SP2 design:
  - Service list with StatusChip (healthy/warning/critical) based on CPU/MEM thresholds
  - Sparkline charts using `<canvas>` or lightweight charting (no heavy chart lib — match v1's inline canvas approach)
  - Color-coded resource bars: green < 60%, yellow 60-80%, red > 80%
  - HPA status indicator, pod count badge
  - Dependency graph as a simple tree list (not a full D3 graph)
- Dark mode support via CSS custom properties
- Skeleton loading states for each column independently
- Mobile: single column with collapsible sections

### Tests

- Unit: PromQL escape roundtrip, escapeRegex vs v1 _spPromEscape parity, tagged template rejects bare interpolation
- Unit: ThanosClient request shape, cache TTL behavior
- Integration: MSW mock Grafana responses, verify overview + detail data flow

## Verify

Dev JWT recipe in `HANDOFF.md`. Then: load overview → select a service → see detail panels → check dependency drill. 3-4 screenshots to `/tmp/sp-*.png`.

## Report (under 200 words)

What built, v1 endpoints matched, screenshots captured, gaps. No `npm install`.
