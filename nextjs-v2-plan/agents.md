# Agents — SOM Portal v2

> How the work is sliced across sub-agents + skills, and how they hand off. Treat each row as a role, not a person — the same model session plays whichever role the current ticket needs.

## 1. Operating principles

1. **One ticket per session.** Resolve, close, hand off. Exception: `research` tickets can be batched.
2. **Claim before touch.** Mark a ticket in-progress + add your name/role before any work. Prevents two sessions racing.
3. **Skills ride with the role.** Each role lists the mattpocock + ui-skills to call. Don't guess; call the skill.
4. **Decisions written down.** Every closed ticket appends to `map.md` → Decisions-so-far with a one-line gist. No decision survives in chat alone.
5. **Never half-implement.** If a module is too big for one session, split into tickets; don't leave stubs.

## 2. Roles

### 2.1 Chief Architect (you + Opus)

**Scope.** The plan itself. Owns `map.md`, `prd.md`, `architecture.md`. Decides scope, closes HITL decision tickets with the user, routes work.

**Skills.** `wayfinder`, `domain-modeling`, `grill-me`, `grilling`, `code-review` on structural PRs.

**Handoff out.** When a decision closes, update `map.md` + the relevant doc, then nominate the next role.

**Handoff in.** When an implementation role surfaces a scope question, they open a new ticket and the Chief Architect takes it.

### 2.2 Researcher (AFK sub-agents)

**Scope.** All `research` tickets. Runs in parallel; one branch `research/<ticket>` per investigation, no code in main.

**Skills.** `research` (mattpocock), raw `WebFetch`, Grafana + OpenSearch MCP tools where applicable.

**Deliverable.** A `tickets/R-NN-*.md` ticket file with the answer appended under `## Resolution`. Attach links, not pasted screenshots.

**Spawn as `subagent_type: general-purpose` or `Explore`** from the Chief Architect session.

### 2.3 Foundation Engineer

**Scope.** Phase 0 code: project scaffolding, storage adapter, auth, team scoping, nav/perm/MA config, theme tokens. Everything that unblocks per-module engineers.

**Skills.** `implement-spec`, `tdd`, `codebase-design`, `domain-modeling`, ui-skills `nextlevelbuilder/design-system`, `jakubkrehel/better-colors`.

**Boundary.** Does NOT ship application pages. Hands off a working skeleton: login works, protected routes work, theme switches, one dummy page renders inside the layout.

### 2.4 Feature Engineer × N (parallelisable)

One per module in Priority 1 / 2 (board, jira-templates, jenkins, ma, service-performance, restart, log-explorer, incident-launcher, admin-users, admin-system-settings, …).

**Scope.** Build one module end-to-end: page(s), server actions, Zod schemas, Playwright smoke test, admin counterpart if any.

**Skills.** `implement`, `tdd`, `prototype` (when "how should this look" opens), `pr`, `code-review`, ui-skills `dammyjay93/interface-design`, `nextlevelbuilder/ui-styling`.

**Preconditions.** All of Phase 0 complete. The module's R-NN research ticket closed (where applicable).

**Deliverable.** PR with: pages, API routes, Zod schemas, tests, migration script (if JSON shape differs), screenshot gallery for visual review.

### 2.5 Integrations Engineer

**Scope.** External service modules: `src/jira/`, `src/jenkins/`, `src/grafana/`, `src/opensearch/`, `src/mail/`. Feature Engineers consume these.

**Skills.** `research`, `tdd`, `code-review`.

**Deliverable.** Typed clients + Zod schemas + fixture-based tests. One module per PR, in dependency order (jira → jenkins → grafana → opensearch → mail).

### 2.6 QA / Verify

**Scope.** Playwright smoke suite, visual regression if we ship one, cutover verification.

**Skills.** `verify` (Claude Code skill), Playwright, ui-skills `vercel/next-cache-components-optimizer` for perf regressions.

**Deliverable.** `playwright/*.spec.ts` + a cutover checklist in `tickets/CUTOVER-01-*.md`.

### 2.7 Release Engineer

**Scope.** nginx config, dual-run routing, PM2 / container config, backup migration, cutover drill.

**Skills.** `research` on nginx + PM2, `verify` for the staging drill.

**Deliverable.** `deploy/` folder with nginx + pm2 configs, a cutover runbook, a rollback runbook.

## 3. Work order (dependencies)

```
Chief Architect ─┬─> Research (R-01..R-04) ────────────┐
                 │                                     ▼
                 └─> Phase-0 tickets (T-01..T-07) ──> Foundation Engineer
                                                        │
                                                        ▼
                                       ┌────────── skeleton merged ──────────┐
                                       ▼                                     ▼
                           Integrations Engineer                    Feature Engineers × N
                           (jira → jenkins → grafana →              (board, jira-templates,
                            opensearch → mail)                       admin-users, …)
                                       │                                     │
                                       └─────────────┬───────────────────────┘
                                                     ▼
                                                QA / Verify
                                                     ▼
                                              Release Engineer
                                                     ▼
                                               Cutover drill
```

## 4. Session kickoff checklist

Every session that picks up a ticket:

1. Open `map.md`. Confirm your ticket is in the frontier.
2. Mark the ticket in-progress + add owner at the top of the ticket file.
3. Read the ticket question.
4. Call the skills listed on the ticket (or default: `domain-modeling` + `grilling` for HITL decisions).
5. Resolve. Append `## Resolution` to the ticket file. Close by moving the ticket link from "Open tickets" to "Decisions so far" in `map.md`.
6. If the resolution surfaces new fog, add it to "Not yet specified"; new sharp questions become new tickets.

## 5. Parallelism rules

**Safe to run in parallel:**
- All `research` tickets.
- Feature-engineer modules once Phase 0 is merged (they touch different files).
- Integrations module × Feature Engineer that doesn't depend on it yet.

**Serialise:**
- Phase 0 tickets T-01…T-07 (each decision shapes the next).
- Anything touching `config/nav.ts` — single-writer file to avoid merge pain.
- Theme token work (T-07) — collapses all CSS variables.

**How to spawn in parallel from Chief Architect:** send one Agent message with multiple tool calls, one per research ticket. Each sub-agent gets its own worktree (optional) so branches don't collide.

## 6. Communication contracts

**Ticket resolution.** Append this block to the ticket file; never into chat alone:

```markdown
## Resolution

**Decision:** <one-line answer>
**Why:** <two-to-four lines, why this over alternatives>
**Follow-ups:** <new tickets created, if any>
**Owner:** <role name>
**Date:** <YYYY-MM-DD>
```

**Map update.** After closing, prepend to `map.md` → Decisions so far:

```markdown
- [T-01: Storage layer](./tickets/T-01-storage-layer.md): JSON adapter now, Postgres interface stub for later. Reason: cutover cost dominates.
```

**PR descriptions.** Reference the ticket by name (not just number):

```markdown
Closes [T-11: Board module](./nextjs-v2-plan/tickets/T-11-board-module.md).

Covers: page list, detail, trash, star integration. Server actions + Zod schemas live in src/board/.
```

**Handoff note.** When a session ends mid-ticket, append `## Handoff` with:
- what's done
- what's not
- the single next thing to do
- any surprises worth knowing

## 7. Skill routing cheat sheet

| Situation | Skill |
|---|---|
| User brings a loose idea | `wayfinder` + `grilling` |
| Open question "what shape should this have?" | `domain-modeling` |
| Need facts from docs / APIs | `research` |
| "What should the UI look like?" | `prototype` + ui-skills `dammyjay93/interface-design` |
| Writing or re-shaping code | `implement` + `tdd` |
| Several specs ready to execute in parallel | `implement-spec` |
| Diff ready for review | `code-review` → `pr` |
| Pre-merge sanity check | `verify` |
| Session running long, context full | `handoff` |
| Confused about an earlier message | `wait-what` |
