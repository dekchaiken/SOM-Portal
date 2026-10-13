# R-02 — Grafana Thanos PromQL quirks (escape rules, cache behaviour)

> Type: `research` · AFK · Blocked by: — · Owner: unclaimed

## Question

Document every PromQL quirk the SOM Thanos endpoint has, and prototype a `promql` tagged template that encodes them safely.

## Why

Memory `feedback_promql_escape`: regex label matchers need `\\\\.` in PHP source → `\\.` on the wire. Bare `\.` is rejected as "unknown escape sequence". We've been bitten by this in Dependencies query and Service Performance.

## Scope

1. Collect every regex label matcher currently in use (`api/service-performance/`, `api/restart-analyzer/`, `api/batch-monitor/`).
2. For each: raw matcher, PHP-escaped form, wire form.
3. Test cases against the live Thanos endpoint (read-only queries): plain string, dot escape, pipe alternation, longest-first ordering.
4. Prototype `promql\`sum(rate(x{service="${svc}"}))\`` that:
   - Automatically escapes variables inserted into string label matchers.
   - Automatically escapes variables inserted into regex label matchers.
   - Rejects alternation that isn't longest-first (defensive against the find-regex gotcha from the Bash tool rules).
5. Document the Thanos cache behaviour (step alignment, lookback-delta impact).

## Deliverable

- `nextjs-v2-plan/research/promql-tag.md` — findings + rules.
- `nextjs-v2-plan/research/promql-tag.proposed.ts` — the tagged template with tests.

## Resolution

_pending_
