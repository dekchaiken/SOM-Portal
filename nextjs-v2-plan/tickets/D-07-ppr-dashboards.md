# D-07 — Partial Prerendering (PPR) for dashboards once stable?

> Type: `decision` · HITL · Blocked by: — (gate: Next.js stable release) · Owner: unclaimed · Source: codebase_design.md §10

## Question

PPR lets Next.js prerender a route's static shell and stream the dynamic parts on request. Service Performance + Dashboard + MA Status all benefit. Adopt when PPR exits experimental, or stay on Suspense boundaries only?

## Options

**A. Stay on Suspense only** — predictable, no experimental flags.
**B. Adopt PPR for dashboards once stable** — faster TTFB on repeat visits.

## Recommendation

**A** for Phase 1. Revisit when Next.js promotes PPR to stable.

## Resolution

**Decision:** Stay on Suspense boundaries. Revisit PPR when it ships stable in Next.js (not before).

**Why:** PPR is still experimental in Next.js 15. Our dashboards are already fast enough with RSC + Suspense; the gain from PPR is TTFB on repeat visits, which matters more for public pages than an authenticated internal tool.

**Owner:** Chief Architect · **Date:** 2026-10-11
