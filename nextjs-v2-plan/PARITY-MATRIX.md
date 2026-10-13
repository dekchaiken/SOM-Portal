# Parity matrix: v1 PHP vs v2 Next.js (per page)

Updated: 2026-10-13, session 3.
Detail per behaviour: `AUDIT-V1-VS-V2.md` (TC-<area>-<nn> rows).

## How to read the status columns

- **Features**: share of v1 behaviours on this page that v2 implements (from the audit). Not a test result.
- **Real data**: the page was exercised end-to-end against a copy of the v1 `data/` folder (not the live folder). Only "verified" when a Playwright test in `playwright/phase1-parity.spec.ts` reads the expected value from the data file.
- **Tests**: `e2e` = Playwright in `playwright/phase1-parity.spec.ts`; `unit` = Vitest in `src/**`; `none` = no automated test.

Test data: copy of `data/` with four QA users (`qa.user`, `qa.first`, `qa.expired`, `qa.reset`; password `Test1234!`). Created in the copy only.

## Phase 1 pages (shipped)

| v1 page / API | v2 route | Features (audit) | Real data | Tests | Status after session 3 |
|---|---|---|---|---|---|
| index.html + api/auth/login.php | `/v2/login` | Mostly parity. Forced change after first login / expiry / reset now matches v1 (signs in, sends the user to settings) | verified (users.json) | e2e: wrong password, valid login, forced change, API flag | **Fixed this session**: v2 used to block these users |
| change-password.html | `/v2/settings` (password tab) | Parity on the happy path | not verified | none | Forced redirect added; change clears the flag |
| forgot-password / reset-password | `/v2/forgot-password`, `/v2/reset-password` | Parity on flow. Reset email delivery not verified | not verified | e2e: none | Token no longer logged to console |
| profile.html | `/v2/settings` (profile tab) | Parity on fields. Admin editing another user's profile not verified | not verified | none | Not changed |
| dashboard.html | `/v2/dashboard` | **Partial**. v1 pulls 11 sources (board, log feed, announcements, Jira analytics, n8n oncall, requests, schedule, leave, inbox, learning). v2 now shows board counts and recent posts only | verified (board.json) | e2e: KPI matches file, quick links, no mock title | **Was mock data**; now real for board. Service Health chart is still a labelled placeholder |
| board.html | `/v2/board` | Partial. List, filters, new post, star work. Pin, delete, status, edit post and image upload are on the detail page or missing | verified in detail page only | none for list | Not changed in this session |
| board detail (no v1 page, v1 used a modal) | `/v2/board/[id]` | Partial: view, status, pin, move to trash, star, comments list + add + delete. Edit post and image upload missing | verified (title renders) | e2e: renders, unknown id shows not-found | **Was 404 (missing file)**; created this session |
| board trash | `/v2/board/trash` | Parity on restore / hard delete / purge in service | not verified | none | **Actions were broken** (passed arrow functions to client component); fixed with `.bind` |
| jira-templates.html + api/jira | `/v2/jira-templates` | Partial (audit TC-JIRA-*) | not verified | none | Not changed |
| jenkins-build.html + batch monitor | `/v2/jenkins-build` | **Partial**: trigger works; maker/checker approval and batch monitor UI missing | not verified | none | Not changed |
| admin/users.html | `/v2/admin/users` | Partial: admin reset / create differ from v1 (see audit TC-USR-05, 06, 17) | not verified | none | Not changed |
| admin/system-settings.html | `/v2/admin/system-settings` | Parity on listed fields | not verified | none | Not changed |
| admin/nav-groups, menu-permissions, super-team-permissions | `/v2/admin/*` | Parity on save; team create / copy missing | not verified | none | Not changed |
| admin/index.html | `/v2/admin` | Parity (KPI tiles from data files) | not verified | none | Not changed |
| notifications bell | topbar | Parity on list and mark read; clear-read has no UI | not verified | none | Not changed |
| presence, search, my-activity, backup, log viewer | none | **Missing** | n/a | none | Phase 2 backlog (see below) |

## Phase 2 and 3 pages

Phase 2 (per `PAGE-COMPARISON.md`): MA Status, MA Services, Service Performance, Restart Monitor, Restart Analyzer, Log Explorer, Incident Launcher, Mail, 9 integration admin pages. **Started, not finished.** Pages exist for all of the first seven tools and for mail-config and scheduled-noti. Per-feature status is in `COMPARE-PHASE2.md`. Several features need Grafana Thanos, OpenSearch or Jenkins, which are not reachable from the dev container.

Phase 3 (~110 pages): not started.

## Known issues, not fixed in this session

1. `/v2/board/[id]` for an unknown id returns HTTP 200 with the not-found UI in dev. Next.js streams the app shell before `notFound()` runs. The page is correct for users; the status code is wrong. Check again on `next build && next start`.
2. Vitest: 4 failing tests in `src/ma`, `src/opensearch`, `src/service-performance`. Not in files touched this session.
3. `tsc --noEmit`: 178 errors, all in files outside this session's changes (opensearch, service-performance, ma-status, board list icon fixed).
4. Dev log: `[team.readTeamFile] schema drift: user-prefs.json` appears for real v1 data (null value). Data-quality issue in v1 data, not a crash.
5. Security items from the audit still open: no CSRF token on mutations, `super_viewer` can write board via `resolveWriteMode`, layout session fallback fixed this session.
