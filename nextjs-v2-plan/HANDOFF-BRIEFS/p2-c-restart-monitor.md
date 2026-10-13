# Brief P2-C — Restart Monitor + Restart Analyzer

You are a Feature Engineer building the **Restart Monitor** and **Restart Analyzer** modules for SOM Portal v2 (Next.js 15 rewrite). Starting cold.

## Project layout

- v1 (PHP): `/Users/warapon.lea/Downloads/otherteam/SOM-Portal/`
- v2 (Next.js): `/Users/warapon.lea/Downloads/otherteam/SOM-Portal/som-portal-v2/`

## Must read first

1. `som-portal-v2/nextjs-v2-plan/map.md` — Phase-0 decisions
2. `som-portal-v2/nextjs-v2-plan/codebase_design.md` — patterns
3. `som-portal-v2/nextjs-v2-plan/domain_model.md` — roles, teams, access rules
4. `som-portal-v2/nextjs-v2-plan/HANDOFF.md` — resume checkpoint, JWT recipe, standing rules
5. `som-portal-v2/nextjs-v2-plan/research/promql-tag.md` — PromQL escape rules (shared with P2-A)
6. `api/restart-monitor/index.php` — list endpoint: raw reports per date per runway, monthly aggregation
7. `api/restart-monitor/fetch.php` — trigger Prometheus fetch for a runway+date, writes to `data/sm/grafana-monitoring/raw/<runway>/<date>.json`
8. `api/restart-monitor/_fetch_lib.php` — core: ~25 instant PromQL queries per pod, kube-state-metrics
9. `api/restart-monitor/_aggregate.php` — daily → monthly aggregation logic
10. `api/restart-monitor/_notify.php`, `_email.php` — webhook + email notification on restart spikes
11. `api/restart-monitor/monthly.php`, `preview-monthly.php`, `send-monthly.php` — monthly report generation
12. `api/restart-monitor/monthly-recipients.php` — manage email recipients for monthly reports
13. `api/restart-monitor/upload.php`, `backfill.php` — manual data import
14. `api/restart-analyzer/index.php` — service-level restart analysis: restart counts + OOMKill + age
15. `api/restart-analyzer/pod-detail.php` — per-pod deep dive: CPU, memory, restart history, events
16. `restart-monitor.html` (473 lines) — v1 frontend
17. `restart-analyzer.html` — v1 analyzer page
18. `data/sm/grafana-runways.json` — runway definitions (name, slug, grafana source ref)
19. `data/sm/grafana-monitoring/raw/<runway>/<date>.json` — daily raw reports
20. `data/sm/restart-monitor-webhooks.json` — notification webhook config

Also peek at `data/sm/grafana_sources.json` for Grafana proxy config and `src/service-performance/` if P2-A has been built (shares ThanosClient).

## Mission

Two pages + scheduler covering pod restart monitoring and analysis.

### Service layer (`src/restart-monitor/`)

- `types.ts` — Zod schemas: RawReport (per-date snapshot), PodRestart, MonthlyAggregate, RunwayConfig, WebhookConfig
- `runways.ts` — read `grafana-runways.json`, resolve Grafana datasource per runway
- `raw-store.ts` — read/write raw reports from `grafana-monitoring/raw/<runway>/<date>.json` (team-scoped)
- `fetcher.ts` — port of `_fetch_lib.php`: ~25 PromQL instant queries via ThanosClient to gather restart_total, OOMKilled, pod age, CPU/MEM per pod. If P2-A ThanosClient exists, import it; otherwise build a minimal one following research/promql-tag.md
- `aggregator.ts` — port of `_aggregate.php`: daily → 7d / 30d aggregation, compute trends
- `monthly.ts` — monthly report generation + formatting
- `webhooks.ts` — read `restart-monitor-webhooks.json`, send Google Chat webhook on restart spikes

### Restart Analyzer layer (`src/restart-analyzer/`)

- `analyzer.ts` — port of `api/restart-analyzer/index.php`: per-service restart analysis
- `pod-detail.ts` — per-pod deep dive queries (CPU, memory, restart timeline)

### Pages

- `app/(app)/restart-monitor/page.tsx` — **Restart Monitor Dashboard**:
  - Runway selector tabs (from grafana-runways.json)
  - Date picker: calendar to select report date (defaults to today)
  - Summary bar: total pods, total restarts, OOMKilled count, trend arrows
  - Main table: per-pod rows with columns:
    - Pod name (clickable → detail), namespace, service
    - Restart count (last 24h), total restarts, OOM killed
    - Age, CPU %, Memory %
    - Status chip (healthy / warning if restarts > threshold / critical if OOM)
  - Sort by any column, filter by namespace/service
  - Charts: restart trend sparkline (7d), top-N restarting pods bar chart
  - Pagination (25 per page)
  - Monthly report section: view/preview/send monthly report to recipients
  - Auto-refresh toggle (configurable interval)

- `app/(app)/restart-analyzer/page.tsx` — **Restart Analyzer**:
  - Service selector dropdown (from restart data)
  - Overview: total restarts, OOM events, affected pods
  - Pod list with expandable detail:
    - CPU/Memory usage (sparkline or bar)
    - Restart timeline (last 7 events with timestamps)
    - Container statuses
    - K8s events related to the pod
  - Compare two services side-by-side (optional, nice-to-have)

### API routes

- `app/api/restart-monitor/route.ts` — GET: list reports (with date + runway filters)
- `app/api/restart-monitor/fetch/route.ts` — POST: trigger Prometheus fetch for runway+date (admin only)
- `app/api/restart-monitor/monthly/route.ts` — GET: monthly report data; POST: send monthly report
- `app/api/restart-monitor/monthly-recipients/route.ts` — GET/POST: manage recipients
- `app/api/restart-monitor/webhooks/route.ts` — GET/POST: manage webhook config
- `app/api/restart-analyzer/route.ts` — GET ?service=X: service analysis
- `app/api/restart-analyzer/pod-detail/route.ts` — GET ?pod=X: per-pod deep dive

### Rules

- Team-scoped: all data files via readTeamFile
- Feature gate: `feature:restart-monitor` (nav.ts has it)
- Auth: any authenticated staff for reads; sm_admin for fetch trigger + webhook config
- Grafana proxy auth stays server-side
- Match v1 data file structure exactly (`grafana-monitoring/raw/<runway>/<date>.json`)
- Zod on every write
- MSW mock for Grafana/Thanos in tests
- The promql tagged template from P2-A's `src/service-performance/promql.ts` should be shared — if it exists, import it. If not, build it per `research/promql-tag.md` in a shared location like `src/lib/promql/`.

### Design

- Dashboard: data-dense table with color-coded restart counts, sparkline trends
- Pod detail: expandable row or slide-over panel
- Monthly report: clean HTML email template (matches v1 branding)
- Runway tabs: pill-style selector at top
- Status coloring: green=0 restarts, yellow=1-3, orange=4-9, red=10+, purple=OOMKilled
- Skeleton loading per section
- Mobile: horizontal scroll for the table with sticky pod name column

### Tests

- Unit: aggregator logic, PromQL query construction, webhook payload
- Unit: fetcher mock (MSW intercept of Grafana proxy, return canned Prometheus response)
- Integration: list → fetch → re-list → verify data file written

## Verify

Dev JWT recipe in `HANDOFF.md`. Then: load monitor → pick a date → see report → trigger fetch → load analyzer → pick a service. 3-4 screenshots to `/tmp/restart-*.png`.

## Report (under 200 words)

What built, v1 endpoints matched, screenshots captured, gaps. No `npm install`.
