# Brief P2-E — Incident Launcher

You are a Feature Engineer building the **Incident Launcher** module for SOM Portal v2 (Next.js 15 rewrite). Starting cold.

## Project layout

- v1 (PHP): `/Users/warapon.lea/Downloads/otherteam/SOM-Portal/`
- v2 (Next.js): `/Users/warapon.lea/Downloads/otherteam/SOM-Portal/som-portal-v2/`

## Must read first

1. `som-portal-v2/nextjs-v2-plan/map.md` — Phase-0 decisions
2. `som-portal-v2/nextjs-v2-plan/codebase_design.md` — patterns
3. `som-portal-v2/nextjs-v2-plan/domain_model.md` — roles, teams, access rules
4. `som-portal-v2/nextjs-v2-plan/HANDOFF.md` — resume checkpoint, JWT recipe, standing rules
5. `api/incident-launcher/index.php` (full file, ~340 lines) — ALL endpoints: config, impact_summary, jira_transitions, jira_create_meta, jira_issue, bo_config_peek, bo_config_update, jira_do_transition, webhook, notify_channel
6. `api/incident-launcher/impact.php` — impact analyzer: multi-layer (pod health, MA status, Grafana alerts, service deps)
7. `incident-launcher.html` (373 lines) — v1 frontend: 5-step wizard flow
8. `data/sm/incident-launcher-config.json` — channel config, step definitions, templates
9. `api/ma-status/_backoffice.php` — backoffice API client (shared with P2-B)

Also peek at existing v2 `src/jira/` for Jira integration patterns and `src/jenkins/` for proxy patterns.

## Mission

SM-only Incident Launcher — a 5-step multi-task wizard for declaring and managing incidents.

### Service layer (`src/incident-launcher/`)

- `types.ts` — Zod schemas: IncidentConfig (channels, steps, templates), ImpactResult, TransitionInfo
- `config-store.ts` — read/write `incident-launcher-config.json` (team-scoped)
- `impact-analyzer.ts` — port of `impact.php`: multi-layer health check:
  - Pod health (from Prometheus / restart data)
  - MA status (from ma-status-cache or live poll)
  - Grafana alerts (from alert sources)
  - Service dependency check
  - Returns aggregated impact summary with severity rating
- `jira-bridge.ts` — Jira operations for incidents:
  - `getTransitions(issueKey)` — available workflow transitions
  - `doTransition(issueKey, transitionId, fields)` — execute transition (e.g., "Investigating")
  - `getCreateMeta(project, issueType)` — createmeta for Incident issue type
  - `getIssue(key)` — fetch issue summary/status/priority/assignee
  - Reuse `src/jira/` client infrastructure for Jira API calls
- `backoffice-bridge.ts` — BO config peek + update (reuse from P2-B if available, otherwise port `_backoffice.php`)
- `webhook.ts` — Google Chat webhook sender (validate URL starts with `https://chat.googleapis.com/`)
- `channels.ts` — configured notification channels from config, send to specific channel by ID

### Pages

- `app/(app)/incident-launcher/page.tsx` — **5-Step Incident Wizard**:

  **Step 1 — Identify**: 
  - Jira issue key input (e.g., SMC-1234) with live lookup showing summary/status/priority
  - Or create new incident issue inline (using createmeta fields)
  - Impact analysis button: runs the multi-layer analyzer, shows severity card

  **Step 2 — Investigate**:
  - Transition issue to "Investigating" status (fetch available transitions, let user pick)
  - Fill in required transition fields (dynamic form from Jira transition metadata)
  - Show current issue status badge

  **Step 3 — MA Toggle** (optional):
  - Show related MA services (from impact analysis or config)
  - One-click toggle BO config keys (with confirmation + rate limit)
  - Peek at current config values before toggling

  **Step 4 — Notify**:
  - Pre-configured notification channels (from incident-launcher-config.json)
  - Message template with variable substitution (issue key, summary, severity, timestamp)
  - Send to selected channels (Google Chat webhooks)
  - Message preview before sending

  **Step 5 — Summary**:
  - Timeline of actions taken (each step's result)
  - Issue status after transitions
  - Links: Jira issue, Grafana dashboard, service board post
  - "Create Board Post" shortcut (opens board with pre-filled incident info)

  Wizard state persisted in React state (not server). User can navigate back/forward between steps. Each step validates before allowing next.

### API routes

- `app/api/incident-launcher/config/route.ts` — GET: launcher config
- `app/api/incident-launcher/impact/route.ts` — GET: impact analysis for a service/issue
- `app/api/incident-launcher/jira/transitions/route.ts` — GET ?key=X: available transitions
- `app/api/incident-launcher/jira/transition/route.ts` — POST: execute transition
- `app/api/incident-launcher/jira/create-meta/route.ts` — GET: createmeta for Incident type
- `app/api/incident-launcher/jira/issue/route.ts` — GET ?key=X: fetch issue info
- `app/api/incident-launcher/bo/peek/route.ts` — GET: peek at BO config value
- `app/api/incident-launcher/bo/update/route.ts` — POST: update BO config
- `app/api/incident-launcher/notify/route.ts` — POST: send webhook/channel notification

### Rules

- SM team only: `roles: ["sm_user", "sm_lead", "sm_admin", "super_admin"]` (per nav.ts)
- Team-scoped: `incident-launcher-config.json` via readTeamFile
- Jira API: reuse `src/jira/` client — never expose Jira credentials to frontend
- Webhook URL validation: must start with `https://chat.googleapis.com/`
- logActivity on every action: jira_transition, bo_config_update, webhook_send, channel_notify
- logSecurity on BO config changes
- Zod on every POST body
- MSW mock for Jira + BO + webhook in tests

### Design

- **Wizard UI**: horizontal step indicator at top (1-2-3-4-5), active step highlighted
- **Step transitions**: slide animation between steps, back/next buttons at bottom
- **Jira issue card**: compact card showing key, summary, status badge, priority icon
- **Impact analysis**: color-coded severity cards (low=green, medium=yellow, high=orange, critical=red)
- **MA toggle**: big toggle buttons with confirmation dialog, green/red status
- **Notification**: message preview in a chat-bubble style, channel selector checkboxes
- **Summary timeline**: vertical timeline with step icons and results
- Responsive: works on tablet (primary use case during incidents), stacks on phone
- Dark mode support

### Tests

- Unit: impact analyzer (mock pod health + MA + alerts → verify severity computation)
- Unit: webhook URL validation, message template variable substitution
- Unit: Jira transition request shape
- Integration: MSW mock Jira + BO, verify full wizard flow data

## Verify

Dev JWT recipe in `HANDOFF.md`. Then: start wizard → enter issue key → investigate → toggle MA → notify → see summary. 3-4 screenshots to `/tmp/incident-*.png`.

## Report (under 200 words)

What built, v1 endpoints matched, screenshots captured, gaps. No `npm install`.
