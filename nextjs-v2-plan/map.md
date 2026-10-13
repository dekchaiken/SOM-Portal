# SOM Portal v2 — Wayfinder Map

Low-resolution view of the whole rewrite. Load once per session; zoom into tickets or design docs as needed.

## Destination

A production-ready **som-portal-v2** Next.js 15 (App Router, TypeScript) application that reaches feature parity with the current PHP system for the SM team's daily workflow, then expands to all 8 roles and the full 71 user pages + 73 admin pages. Shipping criteria: SM team runs on v2 for 2 weeks without falling back to the PHP app; data flows cleanly from existing JSON files; no regression in auth, team scoping, or external integrations (Jira, Jenkins, Grafana Thanos, OpenSearch).

**Not the destination:** rewriting every corner before dog-fooding. Shutting off PHP day one. Changing feature behaviour. "Modernising" workflows SM already likes.

## Notes

**Domain.** Internal ops console. Multi-team (teams.json + feature flags), 8 roles, SM-shared files pattern (SM writes, all teams read), section-scoped shares (one key of a per-team file lifted to shared). Hard dependencies on Jira (truemoney.atlassian.net), Jenkins (per-server auth), Grafana Thanos (PromQL), OpenSearch (per-user creds).

**Standing preferences.**
- Icons = SVG via `<i data-icon="NAME">` style (147-icon library already shipped); use `lucide-react` in v2.
- No emoji anywhere in HTML sinks.
- No native `alert`/`confirm`/`prompt`; use toasts/modal utility.
- Grid templates must use `minmax(0, 1fr)` to prevent overflow.
- Never fetch raw `/data/*.json` from the browser; always go through the API.
- UI patterns reference [ui-skills.com](https://www.ui-skills.com) registry first. Primary skills: `dammyjay93/interface-design`, `nextlevelbuilder/design-system`, `nextlevelbuilder/ui-styling`, `jakubkrehel/better-colors`, `vercel/next-cache-components`.
- `service-performance.html` 3-column Command Center layout is the reference pattern for new dashboards.

**Skills to call per session.** `domain-modeling` for anything cross-cutting (team scoping, roles). `research` for third-party API shape questions. `prototype` for layout/behaviour calls. `code-review` + `pr` before every merge once implementation starts.

**Context pointers.**
- Full PHP feature map: memory `project_som_full_feature_map.md`.
- Multi-team architecture: memory `multi_team_arch.md`, `team_data_path_helper.md`.
- Feedback rules: memory `feedback_frontend_dos_donts.md`.
- Reference pages: `service-performance.html`, `about-som.html` (visual pattern reference).

## Decisions so far

<!-- One line per closed ticket. Append newest at the top. -->

- **[D-07 PPR](./tickets/D-07-ppr-dashboards.md)** (2026-10-11): Suspense only; revisit when PPR stable.
- **[D-06 Form library](./tickets/D-06-conform-to.md)** (2026-10-11): `react-hook-form` + shadcn Form; manual SA wiring; `@hookform/resolvers/zod`.
- **[D-05 OTel sink](./tickets/D-05-otel-sink.md)** (2026-10-11): JSONL only at ship; OTel is Phase 3.
- **[D-04 Rate-limit backend](./tickets/D-04-rate-limit-backend.md)** (2026-10-11): Shared JSON file + `proper-lockfile`; `RateLimitBackend` interface for later swap.
- **[D-03 AsyncLocalStorage](./tickets/D-03-async-local-storage.md)** (2026-10-11): No ALS; rely on `getSession()`+`cookies()` cache + explicit args to services.
- **[D-02 Wire envelope](./tickets/D-02-wire-envelope.md)** (2026-10-11): All SA + RH responses use `Result<T>` = `{ok,data}|{ok:false,error,code}` through cutover. Lint-enforced.
- **[D-01 SA mobile exposure](./tickets/D-01-server-actions-mobile.md)** (2026-10-11): Web-only; defer mobile (non-goal).
- **[T-09 Dual-run](./tickets/T-09-dual-run.md)** (2026-10-11): `basePath: '/v2'` + per-page nginx `return 302 /v2/<page>` cutover. Shared cookie `som_session_v2`. `/v2/_bridge` migrates legacy `localStorage.som_token`.
- **[T-08 Migration order](./tickets/T-08-migration-order.md)** (2026-10-11): Login → Dashboard → Board → Jira templates → Jenkins → Admin users/system-settings → Admin nav-groups/menu-perms. SM team cuts over primary after module 7.
- **[T-07 Theme system](./tickets/T-07-theme-system.md)** (2026-10-11): Per-user prefs stored in team-scoped `user-prefs.json` + system fallback. 4 themes × 2 modes + GenZ overlay. Console-theme-always-dark enforced in ThemeProvider.
- **[T-06 Testing strategy](./tickets/T-06-testing-strategy.md)** (2026-10-11): Vitest + Playwright + MSW + Mailpit per `test_strategy.md`. No visual regression. No coverage threshold. Flaky tests → 7-day quarantine → delete.
- **[T-05 Team scoping](./tickets/T-05-team-scoping.md)** (2026-10-11): Final API shape locked with super_admin cross-team escape hatch (`readTeamFile(file, schema, {team})`). Audit-logged on every cross-team access.
- **[T-04 Deploy target](./tickets/T-04-deploy-target.md)** (2026-10-11): On-prem Node + PM2 cluster-2 + nginx reverse proxy, same box as PHP, shared `data/` bind-mount. Cutover = nginx config flip. Unblocks D-04, T-09.
- **[T-03 Auth strategy](./tickets/T-03-auth-strategy.md)** (2026-10-11): Reuse v1 JWT shape via `jose` + HttpOnly `som_session_v2` cookie + non-sensitive `som_user` mirror. Legacy `localStorage.som_token` bridged on first `/v2/` visit. PHP + v2 share `JWT_SECRET`.
- **[T-02 Tech stack](./tickets/T-02-tech-stack.md)** (2026-10-11): Next.js 15 (App Router) + React 19 + TS strict + Tailwind v4 + shadcn/ui + Radix + Lucide + react-hook-form + zod + Vitest + Playwright + jose + proper-lockfile + nodemailer. Unblocks T-07, D-06.
- **[T-01 Storage layer](./tickets/T-01-storage-layer.md)** (2026-10-11): JSON on disk through `DataAdapter` interface. `proper-lockfile` for concurrency. `pg-adapter.ts` stub for Phase 3. Unblocks T-05.
- **Inventory baseline captured** (2026-10-11): [`research/inventory.md`](./research/inventory.md) is now source of truth. **Real scale: 88 user HTML + 73 admin HTML + 101 API dirs + 22 top-level PHP endpoints.** Memory `project_som_full_feature_map` is superseded (missed ~55 pages + ~35 API modules).
- **Domain model captured** (2026-10-11): [`domain_model.md`](./domain_model.md) — entities, access rules, invariants, state machines, 12 open modelling questions.
- **Codebase design baseline** (2026-10-11): [`codebase_design.md`](./codebase_design.md) — 10 patterns + 7 OPEN design decisions (D-01..D-07).
- **Test strategy baseline** (2026-10-11): [`test_strategy.md`](./test_strategy.md) — Vitest + Playwright + MSW + Mailpit, 12 sample specs, 6-layer pyramid.
- **ui-skills matrix captured** (2026-10-11): [`research/ui-skills-matrix.md`](./research/ui-skills-matrix.md) — 31 skills catalogued, 21-row concern × skills table, 9 registry gaps where we build bespoke.

## Modelling questions surfaced by domain_model.md

See `domain_model.md` §6 for the full list of 12 open modelling questions. Promote to tickets as they become sharp:
- Multi-team membership (one user → many teams)?
- Role inheritance tree flat or hierarchical?
- Audit log retention / TTL?
- `isSmCoverageAdmin` scope — formalise or inline?
- Global-role fallback semantics (super_admin team claim)?
- …7 more in `domain_model.md`

## Not yet specified

<!-- In-scope fog: decisions I can tell are coming but can't phrase sharply yet. -->

- **Realtime presence / notifications in v2.** PHP has `presence/` and `notifications/`. The push model (polling? SSE? WebSocket? Pusher-like service?) depends on deploy target decision (T-04).
- **Scheduled jobs (`scheduled-noti/`, cron builder, Teamup sync).** How recurring tasks run in a Node world — cron files on the server, a BullMQ queue, Vercel cron? Depends on T-04.
- **Backup/export strategy** post-cutover. Current `backup/` endpoint zips `/data`. If we migrate to Postgres (T-01), the shape changes.
- **GenZ theme / `is_genz` flag UX.** Lifted-user flag, not a role, with a purple/pink body class. Needs a theme-system call once T-02 lands.
- **Mobile UX.** Current PHP app is desktop-centric. v2 should hold the line but a mobile pass is in-scope eventually.
- **LMS (`learn.html`, `courses.html`, `exams.html`).** Isolated module, low daily usage. Can migrate last; shape of its data model needs a look.
- **Admin UI consolidation.** 73 admin pages is a lot. Many are per-feature config forms that could collapse into a shared pattern — needs a prototype pass before the admin phase.

## Out of scope

<!-- Work beyond the destination. One line + why. -->

- **Multi-tenancy beyond current team system.** Current `team` claim + feature flags are enough; no customer-isolated tenancy.
- **Public API / webhooks for third-party integrations.** v2 stays internal.
- **Replacing Grafana / Jira / Jenkins.** v2 keeps consuming them.
- **AI/LLM features (chat, summarisation).** Not asked for; adding would blow scope.

## Open tickets (frontier)

<!-- Mirror of unclaimed tickets in ./tickets/. Updated on close. -->

### Phase 0 — ✅ ALL CLOSED
All T-01..T-09 and D-01..D-07 resolved on 2026-10-11. Scaffold work can begin.

### Research (AFK — closed, kept for reference)

- [R-04: ui-skills registry audit](./tickets/R-04-ui-skills-audit.md) — ✅ closed, see [`research/ui-skills-matrix.md`](./research/ui-skills-matrix.md)

### Research (AFK — still open, can run in parallel)

- [R-01: Jira custom-field mapping shape in v2](./tickets/R-01-jira-field-mapping.md) · research
- [R-02: Grafana Thanos PromQL quirks (escape rules, cache behaviour)](./tickets/R-02-grafana-thanos.md) · research
- [R-03: OpenSearch per-user creds encryption migration](./tickets/R-03-opensearch-creds.md) · research

## Legend

- **HITL** — human in the loop (needs you to decide)
- **AFK** — agent runs alone (research / mechanical task)
- **Blocked** — can't start until named ticket closes
- **Frontier** — open + unblocked + unclaimed = pick-up-able now
