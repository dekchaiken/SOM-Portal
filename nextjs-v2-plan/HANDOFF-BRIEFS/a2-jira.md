# Brief A2 — Jira templates + Create Issue

Feature Engineer building Jira module for SOM Portal v2. Starting cold.

## Must read first

1. `som-portal-v2/nextjs-v2-plan/research/jira-fields.md` + `jira-fields.proposed.ts`
2. `som-portal-v2/nextjs-v2-plan/codebase_design.md`
3. All files under `api/jira/`, `api/templates/`, `api/jira-config/`
4. `data/sm/templates.json`, `data/sm/jira_config.json` (shape)
5. `som-portal-v2/src/team/scope.ts`, `src/auth/policy.ts`, `src/lib/result.ts`
6. `som-portal-v2/app/(app)/dashboard/page.tsx` + `src/ui/*`

## Mission

### Pages
- `app/(app)/jira-templates/page.tsx` — template cards grouped by category; click → modal/sheet form → Create Issue
- `app/(app)/send-email/page.tsx` — compose + preview + Create Jira + attach to Board + send email

### Modules
- `src/jira/client.ts` — fetch client to `truemoney.atlassian.net`, Basic auth from env
- `src/jira/fields.ts` — Zod + typed accessors (match R-01 sketch)
- `src/jira/templates.ts` — load/save via `readSharedFile`/`writeSharedFile("templates.json")`

### APIs
- `POST /api/v1/jira/create-issue` — Node runtime; `{ templateId, overrides }` → `{ ok, data:{ key, self, id } }`
- `GET /api/v1/jira/fields` — cached 10 min
- `GET /api/v1/templates` + `POST` (sm_* for write)

### Rules
- Field mapping per-site via jira_config.json (hot-reload)
- Soft-fail on drift
- Rate limit create-issue 20/min/user
- Feature: `feature:jira-templates`
- SM-shared read + SM-only write for templates
- MSW mock Jira in tests — never hit real

### Design
- Cards: icon + name + 2-line summary + "Last used N days ago"
- Modal: field groups by type, required highlighted, "Save as new template"
- Success toast: "Issue SMC-1234 created" + "Open in Jira" link

## Verify

Dev JWT. Mock Jira via MSW. Visit /v2/jira-templates → templates list → click → modal → submit → verify mocked Jira received payload. Screenshots `/tmp/jira-*.png`.

## Report (under 200 words)
