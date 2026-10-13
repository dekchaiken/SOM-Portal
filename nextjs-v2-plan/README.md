# SOM Portal v2 — Next.js Rewrite Plan

Planning workspace for the Next.js v2 rewrite of SOM Portal. **This folder holds decisions, not code.** Nothing here ships; it exists to make the first commit of `som-portal-v2` a confident one.

## Where to start

| If you want to | Open |
|---|---|
| See the whole plan at a glance | [map.md](./map.md) |
| Know what we're building and for whom | [prd.md](./prd.md) |
| Know the shape of the system | [architecture.md](./architecture.md) |
| Know how it should look and feel | [design_system.md](./design_system.md) |
| Know which agent/person owns which slice | [agents.md](./agents.md) |
| See open decisions and pick one up | [tickets/](./tickets/) |

## How this folder is used

Follows the [wayfinder](https://github.com/mattpocock/skills/tree/main/skills/engineering/wayfinder) pattern: `map.md` is the index of decisions, `tickets/*.md` are open decisions, and the four `*.md` design docs are living artifacts that get updated as tickets close.

Rules:
1. **Decisions only.** No implementation code lives here. Prototypes link out.
2. **One decision per ticket.** Close by appending the answer to the ticket file and gisting it into `map.md`'s "Decisions so far".
3. **Fog is fine.** Not everything is specifiable yet. Park the dim view in `map.md` → "Not yet specified" and graduate it later.
4. **Out of scope is a decision too.** Record it in `map.md` → "Out of scope" with a reason.

## Status

- Charted: 2026-10-11
- Current phase: Phase 0 — Foundation decisions
- Blocking the first line of v2 code: tickets T-01, T-02, T-03, T-04
