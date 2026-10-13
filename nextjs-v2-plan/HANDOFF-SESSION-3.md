# HANDOFF — SOM Portal v2 — session 3 checkpoint

**Branch:** `claude/inspiring-edison-xz9wno` (PR #4 open, login redesign)
**Read first:** `nextjs-v2-plan/AUDIT-V1-VS-V2.md` (198 v1 behaviors, 213 test-case rows, TC-<area>-<nn> IDs)

## Done this session
- Login visuals: mascot enlarged and centred (canvas was measured during a scale animation and stuck at 0.3x; the entrance now animates opacity and translate only), halo rings, ground shadow, colour blobs behind the glass card, no horizontal scroll on mobile (390px verified).
- Not yet verified in a browser: the loading, success and error animations on the sign-in button. Only the static page was screenshotted.
- Full v1 vs v2 audit written (see AUDIT file).

## Verified gaps (checked against disk)
1. `app/(app)/dashboard/page.tsx` KPI row is hardcoded (`value: "4"`, `"18"`, etc.). Docs call it shipped; it is not wired to data.
2. `/v2/board/[id]` is linked from the board list but the route file does not exist (404).
3. Board lacks pin, delete, status change, comment edit, image upload UI.
4. Login blocks expired or forced-reset passwords instead of forcing a change as v1 does (`first_login` not handled).
5. Admin create/reset user differs from v1 (temp password shown on screen; welcome email not sent despite audit claim).
6. Missing entirely: Jenkins maker/checker approval, team create/copy, presence, search, backup, log viewer.
7. Security items reported by the audit, to be re-verified before fixing: no CSRF protection on mutations; `super_viewer` can write board; password-reset token written to console.
8. `tsc --noEmit` reports 178 errors outside login (e.g. `src/service-performance/service.ts`, `sources.ts`). Login has 0. Establish whether these predate this branch before fixing.

## Scope reality
Phase 3 in `PAGE-COMPARISON.md` is about 110 pages. Parity with v1 for the Phase 1 surface is the prerequisite; Phase 2 (MA, Service Performance, Restart, Log Explorer, Incident Launcher) is listed as "not started" in the same doc, and the user asked for Phase 3 explicitly. Confirm the order with the user before starting Phase 3 pages.

## Suggested next steps (in order)
1. Fix the dashboard: replace the hardcoded KPIs with real reads from the same sources v1 uses. Check `api/dashboard/` for the query.
2. Create `app/(app)/board/[id]/page.tsx` (detail view) or remove the dead link.
3. Close the security items in item 7 after confirming each in code.
4. Login: handle `first_login` / expired password the way v1 does.
5. Verify the sign-in button states in a browser (loading, success, error) and screenshot each.
6. Then begin Phase 3 pages from the AUDIT section 5 list.

## How to resume
- `cd /home/user/SOM-Portal/som-portal-v2 && npm ci && npx next dev -p 3000`
- Check `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/v2/login` returns 200.
- Playwright: use `executablePath: "/opt/pw-browsers/chromium"`. Do not run `playwright install`.
- Screenshots: write to the session scratchpad, not the repo.

## Standing rules
- basePath is `/v2`. `<Link href>` takes paths without `/v2`; raw `<a>`, `fetch` and `window.location` take the full `/v2/...` path.
- Never write v1 data outside test data. Clean up `data/` after any e2e run.
- Every completed piece of work gets a PR.
- Commit attribution: Co-Authored-By line and Claude-Session line as given in the session instructions. No model name in commits or PR text.
