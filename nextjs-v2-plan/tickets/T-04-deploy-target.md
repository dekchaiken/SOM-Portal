# T-04 — Deploy target: on-prem Node, container, or Vercel?

> Type: `decision` · HITL · Blocked by: — · Owner: unclaimed · Blocks: T-09

## Question

Where does v2 run in production?

## Context

- PHP runs on-prem on the SOM team's own box, behind nginx. Grafana Thanos, Jira, OpenSearch all reachable from that box only — no public egress.
- Backups + `data/*.json` live on that same disk.
- Jenkins proxy traffic is internal.

Vercel is **ruled out** by data residency + internal-only service network. The real choice is between a plain Node service and running inside the existing k8s cluster.

## Options

**A. Plain Node service on the existing box, nginx reverse proxy, PM2 for supervision** _(recommended for Phase 1)_
- Pros: zero infra ask; cutover is nginx-only.
- Pros: shares `data/` directly, no bind-mount dance.
- Cons: no horizontal scaling (SOM traffic doesn't need it).
- Cons: box becomes a pet, not a herd.

**B. Container inside the existing k8s cluster**
- Pros: matches other SOM services' deploy story; HPA if we ever care.
- Cons: `data/*.json` needs a PVC or we migrate to Postgres (T-01) now.
- Cons: nginx dual-run routing gets messier (ingress rules per path).

**C. Hybrid: PHP on-prem, Next.js in k8s, data on NFS**
- Pros: lets us test k8s without migrating data.
- Cons: NFS semantics + file locking is a known nightmare.

## Decision this unlocks

- Dual-run strategy (T-09) depends on whether v2 is on the same box (nginx `location /v2/`) or a cluster (ingress rules).

## Resolution

**Decision:** On-prem Node service on the same host as PHP. `pm2` (cluster mode, 2 workers) for supervision; nginx reverse proxy routes `/v2/` to `localhost:3000` and keeps PHP on `/`. `data/` is a bind-shared directory read + written by both apps.

**Why:**
1. Zero infra ask. No new hostname, no new TLS cert, no PVC.
2. Cutover = nginx config change. Rollback = revert the config. 5-minute operation per PRD §6.
3. SM traffic is a few hundred req/s on a bad day — horizontal scale isn't needed.
4. Grafana Thanos + Jira + Jenkins + OpenSearch are only reachable from this box; moving v2 off-box breaks every integration simultaneously.

**Follow-ups:**
- Rate-limit backend decision [D-04](./D-04-rate-limit-backend.md) now unblocked — pm2 cluster → cross-process state is live.
- Dual-run ticket [T-09](./T-09-dual-run.md) now unblocked — can finalise the nginx map.
- Release Engineer deliverable: `deploy/{nginx.conf,ecosystem.config.cjs}` + a 1-page cutover runbook.

**Owner:** Chief Architect
**Date:** 2026-10-11
