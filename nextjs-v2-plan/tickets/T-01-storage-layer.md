# T-01 — Storage layer: stay on JSON or migrate to Postgres?

> Type: `decision` · HITL · Blocked by: — · Owner: unclaimed · Blocks: T-05, T-08

## Question

Does v2 keep reading/writing `data/*.json` the way PHP does, or migrate to Postgres on day one?

## Context

- v1 uses `data/<file>.json` or `data/<team>/<file>.json`, with `flock` for cross-process safety. The lock is advisory and has broken under peak-hour load (two writers on `board.json` have corrupted it twice in the last year — see activity log).
- 150+ API modules touch JSON. Migration isn't 1-to-1; some files are per-row (board posts), some are config maps (jenkins_servers), some are append-only logs.
- Cutover window is tight: we need dual-run between PHP and Next.js, both reading/writing the same storage.

## Options

**A. Stay on JSON (adapter interface, `proper-lockfile` for concurrency)**
- Pros: zero migration risk; v1 and v2 share the exact same files during dual-run.
- Pros: fastest path to shipping. No schema design upfront.
- Cons: concurrency still fundamentally weak (locks are advisory).
- Cons: no indexes; "find all board posts tagged X" scans the file.

**B. Migrate to Postgres (jsonb + typed tables for hot paths)**
- Pros: proper concurrency, indexes, transactions, backup story.
- Pros: types in Postgres pair cleanly with Zod + TS.
- Cons: dual-run is harder — PHP still writes JSON. Either we fork writes (PHP → JSON, v2 → PG with sync), or wait for PHP shutdown. Both are risky.
- Cons: 150+ files to model + migrate.

**C. JSON on disk, Postgres as a read-through cache**
- Pros: dual-run safe; PG optional.
- Cons: more complex than either A or B; two sources of truth.

## Recommendation

**Option A for Phase 0–2.** Ship the adapter interface so the implementation detail is swappable. Revisit as Phase 3 work once PHP is deprecated and we can migrate the ground truth cleanly.

## Resolution

**Decision:** JSON on disk through a `DataAdapter` interface. v1-compatible layout (`data/<team>/<file>.json` + SM-shared + section-scoped). `proper-lockfile` replaces PHP `flock`. `src/data/json-adapter.ts` is the only impl in Phase 1–2; `pg-adapter.ts` ships as a type stub for Phase 3+.

**Why:**
1. Dual-run with PHP needs the same source of truth; migrating PG now forks writes and risks data loss during cutover.
2. Zero infra ask — stays on-prem single-box as deploy decision (T-04) locks.
3. Adapter interface decouples pages from storage, so the eventual PG migration doesn't touch 101 modules.
4. 150 req/s peak on `board.json` is well within `proper-lockfile` + `fs.promises` throughput; concurrency pain in v1 came from `flock` + PHP opcache, not JSON itself.

**Follow-ups:**
- Define exact `DataAdapter` interface + file layout in [T-05](./T-05-team-scoping.md).
- Phase 3 ticket (not yet created) to flip to PG once PHP is deprecated.

**Owner:** Chief Architect
**Date:** 2026-10-11
