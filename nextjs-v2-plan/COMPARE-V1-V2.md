# v1 (PHP) vs v2 (Next.js): status by tool

Snapshot: 2026-10-13, after PR #4, #5, #6 merged. Read this first.

- Page list: `PAGE-INVENTORY.md` (136 live pages, mapped to v2 routes)
- Phase 1 detail (25 areas, 198 behaviours with test IDs): `AUDIT-V1-VS-V2.md`
- Phase 2 detail (9 tools, every feature DONE / PARTIAL / MISSING): `COMPARE-PHASE2.md`
- Test status: `playwright/phase1-parity.spec.ts` (14 tests, Phase 1 only). No Phase 2 UI test exists yet.

Method: the Phase 2 and inventory numbers are from static reading of code, not from running the pages. The phase1 parity suite runs; Phase 2 has not been run in a browser.

## Totals

| | PRESENT | MISSING | Phase 2 | Phase 3 |
|---|---|---|---|---|
| User pages (67 live) | 17 | 50 | 19 | 48 |
| Admin pages (69 live) | 9 | 60 | 19 | 50 |
| **Total (136)** | **26** | **110** | **38** | **98** |

"PRESENT" means a route with real client code and API calls. It does not mean feature parity. Phase 1 pages marked PRESENT are only partly at parity (see AUDIT).

## Phase 1 (shipped, partial parity)

| Tool | Has | Missing or partial |
|---|---|---|
| Login | Sign-in, forced password change (first login, reset, expiry), remember me | Expired-password rules only tested for login flow; change-password happy path only |
| Forgot / reset password | Full flow pages | Email delivery unverified |
| Dashboard | Board counts, recent posts, quick access filtered by team | Service-health chart is a placeholder; v1 pulls 11 sources (announcements, logs, Jira analytics, n8n oncall, requests, leave, inbox, learning) |
| Board | List, filters, new post, star, comments, detail page with status, pin, trash | Post edit, image upload, polling, drag-drop; board detail sends a fixed list of actions |
| Board trash | Restore, hard delete, purge | Not tested with real data for sm_lead |
| Jira templates | Page and API | Create-issue and field handling partly per audit TC-JIRA rows |
| Jenkins build | Trigger | Maker-checker approval, batch monitor UI, tools catalog |
| Admin users | List, create, edit role | Admin reset and create differ from v1 (temp password shown on screen; no welcome email) |
| Admin system settings | Listed fields | Fields not in the audit list |
| Admin nav groups / menu permissions | Save | Parity on save only |
| Admin super team permissions | Edit | Team create, team copy |
| Notifications, presence, search, my-activity, backup, log viewer | Notifications bell | Presence, search, my-activity, backup, log viewer all missing |

## Phase 2 (started, many partial)

Source: `COMPARE-PHASE2.md`. Counts are DONE / PARTIAL / MISSING.

| Tool | DONE | PARTIAL | MISSING | Biggest gap |
|---|---|---|---|---|
| MA Services | 9 | 6 | 6 | Read-only UI for non-SM teams; Jira stats refresh; cut-off tab; import |
| MA Status | 4 | 7 | 3 | Upstream fetch: v2 reads a cache that only v1 writes; no admin UI |
| Restart Monitor | 6 | 9 | 11 | No daily scheduler; no charts; no email preview; recipients file mismatch with v1 |
| Restart Analyzer | 8 | 2 | 7 | Analysis phases 4–7, 9, 10 missing; no timeline chart |
| Service Performance | 6 | 7 | 10 | Charts, alerts drawer, log viewer, compare, deep analysis missing; detail sections have APIs but no UI |
| Log Explorer | 13 | 4 | 8 | Custom date range, CSV export, URL sync; delete permission not restricted to creator or lead |
| Incident Launcher | 6 | 2 | 8 | v2 has 5 steps, v1 has 9; war room, partner email, maintenance job, admin config editor |
| Mail | 4 | 3 | 3 | Compose and send has API but no UI; branding editor; mail-log filters |
| Scheduled notifications | 7 | 3 | 5 | No automatic scheduler (v1 runs in the browser); exclude dates; test send |

Cross-cutting:
- **No cron or scheduler in v2.** v1 daily Restart Monitor run and browser-driven scheduled notifications have no v2 equivalent.
- **Permission divergence.** v1 gates several writes on `requireSmForShared()`; v2 uses role lists in some places (MA Status toggle and mapping, Restart Monitor fetch, Log Explorer delete). To be verified in code and fixed.
- **Data mismatch.** Restart Monitor recipients are stored in a different file than v1 (`grafana-monitoring/monthly-recipients.json` vs `restart-monitor-recipients.json`), so recipients saved in one portal are invisible in the other.

## Phase 3

98 live pages, not started. Full list in `PAGE-INVENTORY.md`. Examples: Learn and exams, GenZ, dev tools, knowledge base, schedule, team admin pages, batch monitor UI, jenkins-portal, report center, maintenance screen.

## Corrections made in this update

- `PAGE-COMPARISON.md` and `PARITY-MATRIX.md` said Phase 2 was not started. It is started; pages exist.
- `forgot-password` and `reset-password` are no longer empty; both have pages.
- Scheduled-notification handlers for `grafana_paused` and `shift_summary` returned success without doing anything. They now return an explicit failure until implemented.

## Next steps

1. Fix the permission divergence: write gates on SM-shared data must match v1 `requireSmForShared()`. Affects MA Status, Restart Monitor, Log Explorer delete.
2. Resolve the Restart Monitor recipients data mismatch with a single file path that both portals read.
3. Decide on the scheduler. Options: server-side cron in Next.js, or keep v1's browser-based runner. Without it, Restart Monitor daily run and scheduled notifications do not run.
4. Finish Phase 2 tools in this order: Mail (send UI, logs), MA Status (admin UI and cache writer), Restart Monitor (monthly report UI, email), Log Explorer (small gaps), then the remaining features.
5. Add UI tests for each Phase 2 tool to `playwright/`, against the data copy, as was done for Phase 1.
