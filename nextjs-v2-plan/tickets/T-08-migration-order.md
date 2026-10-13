# T-08 — Module migration order

> Type: `decision` · HITL · Blocked by: T-01, T-02, T-03, T-04 · Owner: unclaimed

## Question

Which page / module ships first after Phase 0?

## Context

Priority 1 pages (from `prd.md` §5):
- Auth (login, profile, change-password, my-activity)
- Dashboard
- Board (+ comments, trash, stars)
- Jira templates
- Jenkins (admin + batch monitor)
- Admin: users, system-settings, nav-groups, menu-permissions

**Factors:**
- **Risk shedding** — ship the riskiest module early so lessons feed back into Phase 2.
- **Dog-food signal** — ship what SM uses most every day so feedback is immediate.
- **Blast radius** — admin pages touch many foundations; ship after Core.

## Proposed order

1. **Login + Dashboard** — smallest surface area, exercises auth + layout + theme + nav config.
2. **Board** — highest daily usage; builds confidence in storage adapter + team scoping + comments.
3. **Jira templates + Jira create issue** — exercises external integration.
4. **Jenkins (batch monitor + build trigger)** — exercises per-server auth + host cooldown.
5. **Admin: users + system-settings** — unlocks SM admins managing v2 users without touching PHP.
6. **Admin: nav-groups + menu-permissions** — critical because the nav is now `config/nav.ts`, so the admin UI edits that file.

Everything else slots into Phase 2 in the order laid out in `prd.md` §5.

## Resolution

**Decision:** Lock the proposed order. First ships after Phase 0:

| # | Module | Why in this slot |
|---|---|---|
| 1 | **Login** (`/v2/login`, `/v2/forgot-password`, `/v2/reset-password`, `/v2/change-password`) + base layout + theme + nav config | Smallest surface. Exercises auth + middleware + theme + nav config end-to-end. Confidence check for everything Foundation shipped. |
| 2 | **Dashboard** (`/v2/dashboard`) | Aggregates widgets (board recent, stars, notifications polling, presence). Smoke test for the SM-shared read + per-team read mix. |
| 3 | **Board** (`/v2/board`, `/v2/board/[id]`, `/v2/board/trash`) + comments + stars | Highest daily usage. Exercises storage adapter under real write load. Soft-delete + restore + pin. |
| 4 | **Jira templates** (`/v2/jira-templates`, `/v2/send-email`) + Jira create issue | Exercises external integration + templates + SM-shared file write. |
| 5 | **Jenkins build + batch-monitor** | Exercises per-server auth + host cooldown + proxy. |
| 6 | **Admin: users + system-settings** | Unblocks SM admins managing v2 without touching PHP. |
| 7 | **Admin: nav-groups + menu-permissions** | Critical because nav is `config/nav.ts` + a persisted `menu-permissions.json`; admin UI edits the file. |

After module 7 lands, SM team cuts over primary. Phase 2 kicks off with MA + Service Performance.

**Why Login + Dashboard + Board over "ship Service Performance first":**
1. Service Performance is Tier 1 but complex (Grafana Thanos + CSV drift + 3-col layout). Shipping it first exposes too many unknowns at once.
2. Board is daily-use feedback. Users notice regressions immediately.
3. Login is the one page every user hits — iron it out before touching anything else.

**Follow-ups:**
- Each module gets a Feature Engineer ticket (not yet created). They'll follow the `agents.md` work-order DAG.
- Phase 2 order (MA, Service Performance, Restart, Log Explorer, Incident Launcher) stays as PRD §5 lays out.

**Owner:** Chief Architect
**Date:** 2026-10-11
