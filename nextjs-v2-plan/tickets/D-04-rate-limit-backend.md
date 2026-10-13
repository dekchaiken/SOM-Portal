# D-04 — On-prem rate limiting: Redis, memory, or shared file?

> Type: `decision` · HITL · Blocked by: T-04 · Owner: unclaimed · Source: codebase_design.md §6

## Question

v1 uses file-based rate limiting (`data/rate_limit.json`) — works for single-process PHP. v2 Next.js is multi-process by default (even on-prem via PM2 cluster). Options:

**A. `@upstash/ratelimit` with in-memory fallback** — fine for single-instance; cluster-aware needs Redis.
**B. Redis** — infra ask (small, but a new box).
**C. Shared file via `proper-lockfile`** — same model as v1, cross-process safe. Slower but no new infra.
**D. Pin PM2 to a single process** — kills horizontal scale (we don't need it anyway).

## Recommendation

**C** for Phase 1 (zero infra ask, matches PHP semantics), with the rate-limit module behind an interface so **B** can replace it later.

## Resolution

**Decision:** Shared JSON file (`data/rate_limit.json`) coordinated by `proper-lockfile`. Same semantics as PHP v1 so dual-run keeps rate counters in sync.

```ts
// src/lib/rate-limit.ts (sketch)
export async function rateLimit(bucket: string, limit: number, windowSec: number): Promise<RateLimitResult> {
  return withLock('rate_limit.json', async (store) => {
    const now = Date.now();
    const entry = store[bucket] ?? { count: 0, resetAt: now + windowSec * 1000 };
    if (now >= entry.resetAt) { entry.count = 0; entry.resetAt = now + windowSec * 1000; }
    if (entry.count >= limit) return { ok: false, retryAfter: entry.resetAt - now };
    entry.count++;
    store[bucket] = entry;
    return { ok: true };
  });
}
```

**Buckets ported from v1:**
- `login:<ip>` → 5 per 15 min
- `api:<userId>:<group>` → 120 per 60s (configurable via system-settings)

**Why file over Redis:**
1. Zero infra ask (per T-04 — on-prem, no new boxes).
2. Shares state with PHP during dual-run — a user who hits the login limit on PHP is still rate-limited on v2.
3. Lock overhead at 100-200 req/s is negligible; our traffic is 10% of that.
4. Interface is swappable — if we ever hit scale, swap in `@upstash/ratelimit` + Redis without touching callers.

**Follow-ups:**
- Interface `RateLimitBackend` in `src/lib/rate-limit.ts` so a Redis impl can replace the file-based one.
- Observability: emit metric `rate_limit.rejected{bucket}` to Grafana after cutover.

**Owner:** Chief Architect
**Date:** 2026-10-11
