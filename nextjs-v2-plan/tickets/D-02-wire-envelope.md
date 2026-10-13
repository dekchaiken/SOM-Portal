# D-02 — Collapse Server Action result shape into v1 wire envelope?

> Type: `decision` · HITL · Blocked by: — · Owner: unclaimed · Source: codebase_design.md §3

## Question

v1 responses: `{ ok: true, data: T } | { ok: false, error: string, code? }`. Server Actions return raw values + throw. Do we wrap every SA in the v1 envelope to keep client code consistent, or let SAs be idiomatic and reserve the envelope for Route Handlers only?

## Options

**A. All responses use the v1 envelope (SAs + RHs)** — one shape to remember.
**B. SAs idiomatic (raw value or throw), RHs keep v1 envelope** — matches Next.js grain; client code uses two patterns.
**C. New shared `Result<T, E>` type (think Rust)** — richer but adds a dependency.

## Recommendation

Option **A** during dual-run (consistency with PHP), transition to **B** after cutover.

## Resolution

**Decision:** All responses — Server Actions and Route Handlers — use the v1 envelope `{ ok: true, data: T } | { ok: false, error: string, code?: string }` **through cutover**. Post-cutover (Phase 3), transition SAs to idiomatic raw returns + `throw`.

**Why:**
1. Client code written during dual-run (both PHP + v2 API calls) assumes the envelope. Breaking it = rewriting every callsite.
2. One shape to type: `type Result<T> = { ok: true; data: T } | { ok: false; error: string; code?: string }`.
3. Phase 3 is a mechanical rewrite once we've shut PHP off.

**Implementation:**
```ts
// src/lib/result.ts
export type Result<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };

// All server actions:
'use server';
export async function createBoardPost(input: unknown): Promise<Result<BoardPost>> {
  try {
    const data = schema.parse(input);
    const post = await writeTeamFile(/*…*/);
    return { ok: true, data: post };
  } catch (e) {
    return { ok: false, error: (e as Error).message, code: inferCode(e) };
  }
}
```

**Follow-ups:**
- Lint rule in Phase 1: Server Action return types must be `Result<…>`.
- Phase 3 ticket to drop the envelope.

**Owner:** Chief Architect
**Date:** 2026-10-11
