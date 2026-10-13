# Tickets

Each file is one open decision or research item. Format:

```markdown
# T-NN / R-NN — <title>

> Type: `decision` | `research` · HITL/AFK · Blocked by: — · Owner: unclaimed

## Question
…

## Context
…

## Options
…

## Resolution
<appended on close>
```

**Prefixes.**
- `T-NN` — HITL decision ticket (user must weigh in).
- `R-NN` — AFK research ticket (sub-agent runs alone).
- `CUTOVER-NN` — pre-cutover checklist tickets, created later.

Close a ticket by appending `## Resolution` and gisting the answer into `../map.md` → Decisions-so-far.
