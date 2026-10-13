# Architecture — SOM Portal v2

> Status: **draft**. Marks each decision as **PROPOSED** (default waiting on a ticket), **LOCKED** (ticket closed), or **OPEN** (actively being decided).

## 1. Stack (PROPOSED — see T-02)

| Layer | Pick | Reason |
|---|---|---|
| Runtime | Node.js 20 LTS | Matches on-prem OS versions already deployed. |
| Framework | Next.js 15 App Router | RSC + server actions kill the hand-rolled fetch wrapper. |
| Language | TypeScript 5.x, `strict: true` from day one | Field-map drift is v1's #1 bug class; types kill it. |
| Styling | Tailwind CSS v4 + CSS variables | v4's native CSS variable export matches existing 4-theme system. |
| Components | shadcn/ui on top of Radix UI | Owned source, Radix a11y, works with Tailwind v4. See ui-skills `nextlevelbuilder/ui-styling`. |
| Icons | `lucide-react` | 1-to-1 with current 147-icon SVG set. |
| Forms | `react-hook-form` + `zod` | Zod schemas double as runtime guards for JSON reads. |
| Server state | Next.js `fetch` + RSC caching; `swr` or `@tanstack/react-query` for client bits | Server-side default; client cache only where polling matters. |
| Realtime | SSE (phase 1) | No WebSocket need for Priority 1 features. |
| Testing | Vitest (unit), Playwright (e2e) | See T-06. |

## 2. Folder layout (PROPOSED)

```
som-portal-v2/
├── app/
│   ├── (public)/
│   │   └── login/page.tsx
│   ├── (app)/                      # auth-gated group layout
│   │   ├── layout.tsx              # nav + sidebar + MA gate + theme
│   │   ├── dashboard/page.tsx
│   │   ├── board/
│   │   │   ├── page.tsx
│   │   │   ├── [id]/page.tsx
│   │   │   └── trash/page.tsx
│   │   ├── jira-templates/page.tsx
│   │   ├── service-performance/
│   │   │   ├── page.tsx            # search-first list
│   │   │   └── [service]/page.tsx  # detail
│   │   └── …(each page from PRD §5)
│   ├── (admin)/                    # requires ADMIN_ROLES
│   │   └── admin/
│   │       ├── layout.tsx          # admin-nav
│   │       ├── users/page.tsx
│   │       ├── system-settings/page.tsx
│   │       └── …
│   └── api/                        # Route Handlers (REST compatibility shim)
│       └── v1/                     # same shape as PHP /api so dual-run works
│           ├── auth/[...]/route.ts
│           ├── board/route.ts
│           └── …
├── src/
│   ├── auth/                       # JWT verify, session, requireRole
│   ├── data/                       # storage adapter (T-01)
│   │   ├── adapter.ts              # interface
│   │   ├── json-adapter.ts         # v1 compat
│   │   └── pg-adapter.ts           # future
│   ├── team/                       # teamDataPath equivalent (T-05)
│   ├── jira/                       # service module (api client + types)
│   ├── jenkins/
│   ├── grafana/                    # Thanos client, promql tagged template
│   ├── opensearch/                 # per-user creds, DSL builder
│   ├── mail/
│   ├── nav/                        # single-source nav + menu-perms + MA gate config
│   ├── icons/                      # lucide re-export + Icon component
│   ├── theme/                      # token definitions, OKLCH palettes
│   ├── logging/                    # activity + security audit
│   └── ui/                         # shared components not from shadcn
├── config/
│   ├── nav.ts                      # replaces nav-groups.json + CORE_MENUS + MENU_META
│   ├── permissions.ts              # replaces menu-permissions.json
│   └── maintenance.ts              # replaces maintenance-page.js + PAGE_FILES
├── scripts/
│   └── migrate-json-to-pg.ts       # phase 3 if we ever flip
├── public/
├── data/                           # bind-mount for v1 compat during migration
└── playwright/
```

**Note the single-source `config/nav.ts`** — kills the 8-touchpoint tax. Each page entry declares path, feature flag, allowed roles, teams, maintenance key; layout/sidebar/MA gate/breadcrumb all read from it.

## 3. Data layer (PROPOSED — see T-01)

Adapter pattern lets us start on JSON and swap to Postgres later without rewriting pages.

```ts
// src/data/adapter.ts
export interface DataAdapter {
  read<T>(team: string, file: string): Promise<T>;
  write<T>(team: string, file: string, data: T): Promise<void>;
  lock(team: string, file: string, fn: () => Promise<void>): Promise<void>;
}
```

**json-adapter.ts** — reads/writes `data/<team>/<file>.json`. Uses `proper-lockfile` for cross-process locks (replaces PHP `flock`). SM-shared files short-circuit the team path.

**pg-adapter.ts** — same interface, backed by Postgres. Each file becomes a `(team, file, data jsonb)` row; writes are `UPDATE … WHERE team=$1 AND file=$2 RETURNING data`.

Zod schemas live next to each service module (`src/jira/schema.ts`) and run on every read, logging drift to stderr instead of throwing (same soft-fail behaviour as v1).

## 4. Auth (PROPOSED — see T-03)

Reuse the existing JWT HS256 token shape so a user logged in on v1 is also logged in on v2 during dual-run.

```ts
// src/auth/session.ts
export async function getSession(): Promise<Session | null>
export async function requireAuth(): Promise<Session>   // throws → middleware redirects
export async function requireRole(...roles): Promise<Session>
```

- Middleware verifies the token on every `(app)/*` and `api/*` request.
- Server Components call `requireAuth()` directly (no prop drilling).
- Client components read a thin `useSession()` hook hydrated from a cookie-set-to-non-httpOnly `som-user` payload (same shape as v1's localStorage).
- Rate limiting (login 5/15min, API 120/60s) ported to `@upstash/ratelimit` with a Redis-less in-memory fallback for on-prem (T-04).

## 5. Team scoping (PROPOSED — see T-05)

Thin wrapper over the storage adapter:

```ts
// src/team/scope.ts
export async function readTeamFile<T>(session: Session, file: string): Promise<T>
export async function writeTeamFile<T>(session: Session, file: string, data: T): Promise<void>
export async function readSharedFile<T>(file: string): Promise<T>              // always sm/
export async function writeSharedFile<T>(file: string, data: T): Promise<void> // requires sm_* role
```

All page/API code uses these; nobody touches `data/*.json` directly. Section-scoped shares get a `readSectionScopedFile(file, 'monitoring')` helper that reads from `data/sm/<file>.json` for the given key only.

## 6. API shape

Keep REST surface **identical** to v1 for the dual-run window: `/api/v1/board`, `/api/v1/jira/create-issue`, etc. Route Handlers wrap Server Actions or direct service calls. Once PHP is deprecated, we can collapse the `v1` prefix and switch client calls to Server Actions.

Response envelope (same as v1):
```ts
{ ok: true, data: T } | { ok: false, error: string, code?: string }
```

## 7. External integrations

Each gets a module under `src/<name>/`:

- **jira/** — thin fetch wrapper with Basic auth; `createIssue()`, `getFields()`, `searchJql()`. Field-mapping table typed via Zod (R-01).
- **jenkins/** — per-server auth from `data/sm/jenkins_servers.json`; adds the host-cooldown circuit breaker (`project_host_cooldown_hardening` memory) at module boundary.
- **grafana/thanos** — PromQL tagged template handles escapes (R-02). CSV-backed drift comparison stays on disk.
- **opensearch/** — AES-256 per-user creds (R-03), DSL builder for the Log Explorer saved-search JSON.
- **mail/** — SMTP via `nodemailer`; config from `data/sm/mail_config.json`.

## 8. Logging & audit

- Activity log (`data/logs/activity-YYYY-MM-DD.jsonl`) — port 1:1.
- Security log (same shape) — port 1:1.
- Add OpenTelemetry traces exported to the existing Grafana Tempo (optional, deferred).

## 9. Deploy (OPEN — see T-04)

Three options:

1. **On-prem Node service** — `pm2` + nginx reverse proxy, same box as PHP. Easiest cutover, zero infra ask.
2. **Container (Docker on existing k8s)** — matches other SOM services. Needs a kube manifest.
3. **Vercel** — ruled out: internal data, no public internet egress for Thanos/OpenSearch.

Dual-run assumes path-prefix routing in nginx:
```nginx
location /v2/ { proxy_pass http://som-portal-v2:3000/; }
location /    { # existing PHP }
```
As pages migrate, we flip paths one by one in nginx; the next-config `basePath` matches so Next.js builds relative URLs correctly.

## 10. Observability

- Health endpoint `/api/health` (uptime, build sha, external latency).
- Reuse existing `/api/service-monitoring` Grafana Prometheus + Loki data sources.
- Structured logs to stdout → Alloy → Loki.

## 11. Migration strategy (OPEN — see T-08, T-09)

Overall phases:

1. **Phase 0** — Foundations (this plan + first commit) — T-01…T-07.
2. **Phase 1a** — Login + Dashboard + Board online under `/v2/`. PHP still primary.
3. **Phase 1b** — Add Jira templates, Jenkins, admin users + system-settings.
4. **Phase 2** — MA + Service Performance + Restart + Log Explorer + Incident Launcher.
5. **Cutover** — nginx flips the base path to v2 for SM team; PHP read-only.
6. **Phase 3** — GenZ, Dev, LMS, remaining admin.
7. **PHP deprecation.**

## 12. Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                            Browser                                  │
│  ─────────────────────────────────────────────────────────────────  │
│  (app) layout.tsx  →  config/nav.ts (single source nav + perms)     │
│                    │                                                │
│  Server Components │  Server Actions  │  Client Components          │
└──────────┬─────────┴────────┬─────────┴──────────┬──────────────────┘
           │                  │                     │
           ▼                  ▼                     ▼
     ┌───────────────────────────────────────────────────┐
     │             Next.js 15 Node server                │
     │  ─────────────────────────────────────────────    │
     │  middleware.ts  → JWT verify + rate limit         │
     │  src/auth       → session, requireRole            │
     │  src/team       → scope (team / shared / section) │
     │  src/data       → adapter (json ⇄ pg)             │
     │  src/{jira,jenkins,grafana,opensearch,mail}       │
     └────┬──────────────┬──────────────┬────────────────┘
          │              │              │
          ▼              ▼              ▼
      data/*.json    Jira / Jenkins / Grafana Thanos / OpenSearch
   (bind-mount from
    v1 install path)
```
