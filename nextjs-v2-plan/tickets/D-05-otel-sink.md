# D-05 — OpenTelemetry log sink alongside JSONL?

> Type: `decision` · HITL · Blocked by: — · Owner: unclaimed · Source: codebase_design.md §7

## Question

v1 writes activity + security logs to `data/logs/*.jsonl`. v2 could do the same **and/or** emit OpenTelemetry traces + logs that land in the existing Grafana Tempo / Loki stack.

## Options

**A. JSONL only** — matches v1, zero new deps.
**B. OTel only** — centralised, searchable in Grafana, but new infra bind.
**C. Both (JSONL for compliance / audit, OTel for traces)** — most expressive, more code.

## Recommendation

**A** at ship. Flip to **C** post-cutover if the audit team wants deeper queries.

## Resolution

**Decision:** JSONL only at ship. OTel is a Phase 3 consideration.

**Why:** Audit team already consumes v1 JSONL via Loki — one source of truth beats two. OTel adds a new infra dependency (Tempo + collector) with limited payback for an internal tool. Revisit if the audit team requests span-level queries.

**Owner:** Chief Architect · **Date:** 2026-10-11
