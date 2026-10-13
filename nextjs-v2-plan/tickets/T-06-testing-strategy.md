# T-06 — Testing strategy

> Type: `decision` · HITL · Blocked by: — · Owner: unclaimed

## Question

What does the v2 test pyramid look like, and what's the gate for "merged to main"?

## Context

- v1 has **zero tests**. We've paid for this in production.
- Rewriting everything with full TDD is expensive and will stall the cutover.
- The riskiest paths are: auth, team scoping, Jira field mapping, PromQL escapes, Jenkins host-cooldown, OpenSearch creds encryption.

## Proposed

**Layer 1 — Unit (Vitest)**
- Zod schemas (round-trip encode/decode).
- Pure utils (promql tagged template, team scope, nav config normalisation).
- Service module clients with fetch mocked.

**Layer 2 — Integration (Vitest + testcontainers if we add PG)**
- Storage adapter against a tmp dir (JSON) and a Postgres container (future).
- Auth: issue token in test, verify through middleware.

**Layer 3 — E2E (Playwright)**
- One happy-path spec per Priority-1 page.
- One critical cross-page spec: login → board → attach to Jira template → trigger Jenkins build → see status.

**Gate.**
- All layer-1 unit tests must pass to merge.
- Layer-3 Playwright runs on PR; one flaky retry allowed.
- No coverage threshold; coverage is a lagging indicator.

## Open questions

- Visual regression testing? (Percy / Chromatic are overkill for internal; `playwright-visual-comparisons` with a baseline folder could work.)
- Load testing? Deferred to post-cutover.

## Resolution

**Decision:** Adopt `test_strategy.md` as-is (Vitest + Playwright + MSW + Mailpit, 6-layer pyramid, 12 sample specs). **No visual regression. No coverage threshold.**

**Gate:**
- All Vitest unit + integration tests must pass to merge.
- Playwright on PR, retry once allowed, flaky tests go to the 7-day quarantine (delete rule per `test_strategy.md` §5).
- No percentage coverage gate — coverage is a lagging indicator; invest in writing the right tests.

**Why no VR / no coverage threshold:**
1. Visual regression would catch theme/CSS drift but adds CI minutes + flake surface for every page. Mitigate by shipping a `/preview/theme` page (per `design_system.md` §14) that gets a single manual visual review before each theme bump.
2. Coverage gates push authors to write low-value "line coverage" tests. Our risk is behavioural (field-mapping drift, PromQL escape, team scope leaks) — covered by the 12 sample specs explicitly.

**Follow-ups:**
- QA/Verify role in `agents.md` owns `/playwright` folder.
- Revisit VR at Phase 2 if a theme regression ships to prod.

**Owner:** Chief Architect
**Date:** 2026-10-11
