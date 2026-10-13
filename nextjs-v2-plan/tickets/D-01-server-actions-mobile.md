# D-01 — Expose Server Actions to a future mobile app?

> Type: `decision` · HITL · Blocked by: — · Owner: unclaimed · Source: codebase_design.md §1

## Question

Server Actions are not callable from a React Native / Flutter mobile client — they're a Next.js RSC-only wire format. If we expect a future mobile app, do we double-up every mutation as a Route Handler too, or restrict Server Actions to web-only and treat mobile as a separate problem?

## Options

**A. Dual-write (Server Action + Route Handler for every mutation)** — most flexible, 2× the surface area.
**B. Server Actions for web, defer mobile until we decide to build one** — simplest. If mobile ever ships, add Route Handlers at that time.
**C. Route Handlers only (skip Server Actions)** — loses progressive enhancement + typed form helpers.

## Recommendation

Option **B** unless mobile is already on the roadmap (it isn't per PRD §3 non-goals).

## Resolution

**Decision:** Server Actions for web only; defer mobile support. Mobile is non-goal per PRD §3.

**Why:** Dual-writing every mutation 2× costs real engineering time against a hypothetical mobile app. If mobile ships, add Route Handlers at that time.

**Owner:** Chief Architect · **Date:** 2026-10-11
