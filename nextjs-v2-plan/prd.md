# PRD — SOM Portal v2

> Status: **draft**. Open questions live as tickets; closed decisions get folded in. Not for stakeholder sign-off yet.
>
> **Scope source of truth:** [`research/inventory.md`](./research/inventory.md). Memory `project_som_full_feature_map` was incomplete (missed ~55 pages + ~35 API modules). Real counts: **88 user HTML + 73 admin HTML + 101 API dirs + 22 top-level PHP endpoints**. Numbers below reflect inventory.

## 1. Problem

SOM Portal v1 is procedural PHP + vanilla JS + JSON files, grown organically for ~2 years. It works, but:

1. **No concurrency safety at scale.** `flock` on JSON files breaks silently when two writers overlap at peak hours.
2. **8-touchpoint tax on every new page.** Adding one page means editing 8+ files across layout.js, nav-groups.json, menu-permissions.json, PHP CORE_MENUS, maintenance gate, etc. See `feedback_sm_user_menu_perms` memory. Mistakes leak user→admin or team→team.
3. **No type safety.** Field map drift between JSON schema and JS reader is the single most common source of bugs.
4. **No test suite.** Every change is production-tested.
5. **Theme + icon systems carry hard-coded Tailwind pastels and `!important` overrides** stacked against inline HTML content; dark-mode fidelity is manual labour.
6. **Fragile external integrations.** Jira field mapping, Grafana PromQL escaping (see `feedback_promql_escape`), Jenkins per-server auth all live in ad-hoc proxy files.

v2 is a **rewrite, not a refactor** — the structural debt makes incremental migration cheaper than fix-in-place.

## 2. Goals

**Primary.** Ship a Next.js 15 app the SM team can run on daily for 2 weeks without falling back. Feature parity for the SM daily workflow (**Tier 1** in inventory):
- Login / profile / password / activity log
- Service Board (CRUD, soft-delete, trash, comments, stars)
- Jira templates + Jira issue creation
- Jenkins build triggers + status
- MA Status + MA Services
- Service Performance (CPU/MEM/pod + CSV drift)
- Restart Analyzer + Restart Monitor
- Log Explorer (OpenSearch, per-user creds)
- Incident Launcher
- Admin: users, system-settings, templates, menu-permissions, nav-groups, team CRUD, feature flags

**Secondary.** After SM dog-foods for 2 weeks:
- Migrate GenZ perks pages (`genz-hub`, `genz-notes`)
- Migrate Dev team read-only views
- Migrate LMS (`learn`, `courses`, `exams`)
- Admin pages consolidation (73 → ~30 by sharing patterns)

**Tertiary.** Post-parity:
- Mobile pass
- Realtime presence / notifications over SSE
- Postgres migration (if JSON held long enough to warrant it)

## 3. Non-goals

- Changing how any feature works for the user. "I open board, I see board." No workflow redesign in v2.
- Replacing Jira / Jenkins / Grafana / OpenSearch.
- Multi-tenancy, public API, LLM features — all out of scope (see `map.md`).
- Running both apps on the same URL path simultaneously. Dual-run splits by **path prefix**, not by cookie or user.
- Deprecating PHP day one. PHP app stays live and read-only through cutover.

## 4. Users & roles

8 roles, 3 scopes:

| Role | Scope | What they do in v2 |
|---|---|---|
| `super_admin` | Global | Flip team feature flags, view-as any team, manage all users. |
| `super_viewer` | Global | Read-only cross-team dashboards + audit logs. |
| `sm_admin` | SM team | Admin of SM, manages SM users, SM-shared content, system settings. |
| `dev_sm` | SM team | SM developer / service account; same tools as sm_lead for scripting. |
| `sm_lead` | SM team | Lead-only tools: Incident Launcher, super-sensitive admin forms. |
| `sm_user` | SM team | Regular SM: board, Jira, Jenkins, MA, service perf, log explorer. |
| `dev_user` | Dev team (29 sub-teams) | Read-only service-performance + restart-monitor. |
| `external` | Other teams | Very restricted; dashboard + team-docs. |

**Team scoping.** JWT carries `team`. Data writes route to `data/<team>/…`; SM-shared files (ma-services, templates, service-performance-sources, etc.) read from `data/sm/…` for everyone and write SM-only. Section-scoped shares: one key of a per-team file is lifted to shared (e.g. `monitoring` section of `links.json`).

## 5. Feature parity scope (phase 1)

### Priority 1 — Must ship for SM dog-food cutover

| Area | Pages | API modules |
|---|---|---|
| Auth | login, profile, change-password, my-activity | auth/ |
| Board | board, board-config | board/, board-comments/, board-config/, stars/ |
| Jira | jira-templates, (admin) templates, jira-config | jira/, templates/, jira-config/ |
| Jenkins | (admin) jenkins-servers, batch-monitor, jenkins-build | jenkins-proxy/, jenkins-servers/ |
| Dashboard | dashboard | search/, log/ (activity) |
| Admin | users, system-settings, nav-groups, menu-permissions | users/, system-settings/, nav-groups/, log/ |
| Settings/UX | settings (theme switcher), notifications | notifications/, presence/ (polling only) |

### Priority 2 — Ships inside the 2-week window

| Area | Pages |
|---|---|
| MA | ma-status, ma-services, (admin) ma-config |
| Service Performance | service-performance, (admin) service-performance-sources |
| Restart | restart-analyzer, restart-monitor |
| Log Explorer | log-explorer, (admin) opensearch-config |
| Incident | incident-launcher, (admin) incident-launcher-config |
| About | about-som, (admin) about-page |

### Priority 3 — Post dog-food (Tier 3 in inventory)

GenZ pages, Dev team read-only, LMS (`learn`, `learn-course`, `learn-phase`, `exam`, `learn-reports`, `exam-reports`), PW Schedule, mail config + logs, Teamup calendar, Sheets embed, Sabai (iframe), onboarding, knowledge-base, ops-runbook, holiday-plans, feature-requests, achievements, announcements, syncup, sms-gateway, migrate-user, pipeline-flow, collection-lead-flow, batch-monitor-v2, so-jenkins, analytics, grafana-alerts, test-service, scheduled-noti, email-noti, n8n-oncall, super-feature-requests, super-email-templates, requests, email templates, dev-tools suite (6 pages), genz-notes, genz-hub, about-page admin.

**Full enumeration:** [`research/inventory.md`](./research/inventory.md) §2 and §3 — each row carries nav group, role, feature flag, API deps, active flag, and v2 tier.

### Priority X — Drop (do not port)

Mockups, backups, dev scratch flagged `TX` in inventory. ~25 files, including `command-center-real`, `cron`, `cron-builder`, `debug-nano-ma`, `test-incident-launcher`, `_dcl`, `*-back*.html`, `*-mockup*.html`, `card-mockups-v2`, `card-mockups-v3`, admin email mockup pages.

## 6. Success criteria

Cutover gate (SM team moves to v2 primary):
1. ✅ All P1 pages reachable; feature parity verified by SM lead click-through.
2. ✅ Zero data loss from v1 → v2 (same JSON files or clean one-way migration).
3. ✅ Auth tokens issued by v2 are honoured by any remaining v1 endpoints during the transition window.
4. ✅ p95 page-interactive < 1.5s on internal network.
5. ✅ Rate limits + security audit log retained (`logSecurity()` equivalent in v2).
6. ✅ Playwright smoke suite green: login → create board post → attach to Jira template → trigger Jenkins build → see status.
7. ✅ Rollback plan documented: nginx config revert reroutes 100 % of P1 pages back to PHP in < 5 min.

Post-cutover gate (deprecate PHP):
1. ✅ 2 weeks SM primary usage without a fallback incident.
2. ✅ All P2 pages shipped.
3. ✅ Dev + GenZ + external teams onboarded.
4. ✅ P3 pages shipped or explicitly deferred with user sign-off.

## 7. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| JSON concurrency gets worse under Node (no `flock` equivalent out of the box) | High | T-01 — pick storage layer early; adapter pattern lets us swap later. |
| Field mapping drift between Jira and v2 | High | R-01 — enumerate all custom fields before coding Jira module. |
| Grafana PromQL escape bugs recur | Med | R-02 — write a `promql()` tagged template in v2; add integration tests. |
| Theme fidelity regression | Med | T-07 — port tokens through OKLCH, keep visual snapshots. |
| 8-touchpoint tax reappears in Next.js | Med | Treat nav + menu + MA gate as a single config file + codegen. |
| Scope creep from "while we're rewriting…" | High | Non-goals section + stern Out-of-scope rule in map.md. |

## 8. Open PRD-level questions

See [`map.md`](./map.md) → "Open tickets" for the current frontier. The Phase 0 blockers:
- [T-01 Storage](./tickets/T-01-storage-layer.md)
- [T-02 Tech stack](./tickets/T-02-tech-stack.md)
- [T-03 Auth](./tickets/T-03-auth-strategy.md)
- [T-04 Deploy](./tickets/T-04-deploy-target.md)
- [T-08 Migration order](./tickets/T-08-migration-order.md)

Design-level decisions surfaced by `codebase_design.md`: D-01 through D-07 (see map).
