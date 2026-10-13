# R-04 — ui-skills registry audit: which skills apply where

> Type: `research` · AFK · Blocked by: — · Owner: unclaimed

## Question

Walk the ui-skills.com registry and tag each applicable skill to a v2 module or decision ticket.

## Why

Feedback memory `feedback_ui_skills_reference`: all UI/web design work must consult the ui-skills registry first. We've only sampled it; a focused audit lets each Feature Engineer open their module with the right skill already named on the ticket.

## Scope

1. Call `mcp__ui-skills__list_skills` with queries covering: `dashboard`, `admin`, `theme`, `color`, `next`, `shadcn`, `tailwind`, `table`, `form`, `chart`, `animation`, `motion`, `page transition`, `empty state`.
2. For each returned skill, fetch via `mcp__ui-skills__get_skill` and note:
   - What it covers (one line).
   - Which v2 module benefits.
   - Priority (must-call / nice-to-have).
3. Produce a matrix: `module × skills to call`.

## Deliverable

- `nextjs-v2-plan/research/ui-skills-matrix.md` — the matrix.
- Links added to each Feature Engineer ticket as it's created.

## Resolution

_pending_
