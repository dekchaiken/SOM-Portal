# D-03 — AsyncLocalStorage for request context?

> Type: `decision` · HITL · Blocked by: — · Owner: unclaimed · Source: codebase_design.md §5

## Question

Should we propagate session/team/traceId through `AsyncLocalStorage` so service modules can read request context without prop-drilling, or pass context explicitly to every service call?

## Options

**A. AsyncLocalStorage** — ergonomic (`getSession()` works anywhere), slight perf cost, debugging is harder.
**B. Explicit context arg** — verbose but obvious; typed.
**C. Hybrid: context lives in the `getSession()` cache for cookies-based reads (Next.js default), service modules take explicit args** — our current `architecture.md` assumes this.

## Recommendation

Option **C** (status quo of the architecture doc). Reconsider if the explicit-arg verbosity shows up in review.

## Resolution

**Decision:** Hybrid. `getSession()` uses Next.js' `cookies()` cache (no AsyncLocalStorage needed). Service modules take explicit context args. No AsyncLocalStorage wrapper.

**Why:** Next.js already provides request-scoped access to cookies / headers; wrapping it adds a layer that debugging has to peel back. Explicit args are more verbose but obvious under code review.

**Owner:** Chief Architect · **Date:** 2026-10-11
