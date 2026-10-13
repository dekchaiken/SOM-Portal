# SOM Portal v2

Next.js 15 rewrite of the SOM Portal. Dual-runs alongside the PHP v1 app on `/v2/`.

## Stack

- Next.js 15 (App Router, React 19, TypeScript strict)
- Tailwind v4 + shadcn/ui + lucide-react
- JWT auth (`jose`) — shares `JWT_SECRET` with v1 so logins carry across
- Zod-validated JSON storage (`src/data/json-adapter.ts` + `proper-lockfile`)
- Team-scoped reads/writes via `src/team/scope.ts` (`data/<team>/*.json`)
- Vitest (unit) + Playwright (e2e)

## Running

```bash
cp .env.example .env
# fill in JWT_SECRET, JIRA_EMAIL, JIRA_TOKEN, OPENSEARCH_CREDS_KEY
npm install
npm run dev     # http://localhost:3000/v2
npm run test
npm run typecheck
```

## Layout

```
app/           Next.js routes (Server Components by default)
  (public)/    unauthenticated — login, bridge
  (app)/      auth-gated layout group
  (admin)/    requires ADMIN_ROLES
  api/        REST shim preserving v1 wire shape
src/
  auth/        session (jose), middleware, policy, password
  data/        DataAdapter + json-adapter + Zod schemas
  team/        readTeamFile / writeTeamFile / shared / section-scoped
  logging/     activity + security JSONL audit logs
  lib/         Result<T>, errors, env, rate-limit
  theme/       token palettes (Agent B owns)
  ui/          shadcn components (Agent B owns)
config/        single-source nav + permissions + maintenance
middleware.ts  JWT verify + rate limit for (app)/(admin)/api
```

## Dual-run notes

- `basePath: /v2` — all client URLs are relative so nginx can path-prefix proxy.
- `som_session_v2` HttpOnly cookie carries the JWT; legacy `som_token` localStorage is picked up once at `/v2/bridge` and converted.
- Response envelope stays `{ ok, data } | { ok, error, code }` matching v1 (`src/lib/result.ts`).
- Rate limit backend writes to the same `data/rate_limit.json` as PHP (see `src/lib/rate-limit.ts`).

## Who owns what

- Backend/infra scaffold: `src/auth`, `src/data`, `src/team`, `src/logging`, `src/lib`, `middleware.ts`, `app/api/*`, `app/_bridge`, root config files.
- UI/theme: `src/theme`, `src/ui`, `src/icons`, `config/*`, `app/(public|app|admin)/*`, `tailwind.config.ts`, `components.json`, `app/globals.css`.
