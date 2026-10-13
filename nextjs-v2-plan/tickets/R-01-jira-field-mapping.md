# R-01 — Jira custom-field mapping shape in v2

> Type: `research` · AFK · Blocked by: — · Owner: unclaimed

## Question

Enumerate every Jira custom field v1 reads / writes, produce a typed table for v2, flag drift risk.

## Why

Memory `feedback_promql_escape` and the current PHP `api/jira/` show that field IDs are per-site and v1 reads them from `data/jira_config.json` at runtime. v2 should type them at build time with Zod.

## Scope

1. List every `customfield_*` referenced in:
   - `api/jira/` source
   - `data/jira_config.json`
   - `data/templates.json` field defaults
2. For each: field name, type (string / option / user / array), where it's used (issue create, search, display).
3. Flag any field our site uses that **isn't** present in `data/jira_config.json` (drift).
4. Draft a `src/jira/fields.ts` Zod schema binding the known IDs to typed accessors.

## Deliverable

A branch `research/jira-field-mapping` with:
- `nextjs-v2-plan/research/jira-fields.md` — the audit table.
- `nextjs-v2-plan/research/jira-fields.proposed.ts` — draft Zod schema.

Link both from the ticket on close.

## Resolution

_pending_
