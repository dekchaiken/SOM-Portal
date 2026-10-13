# Codebase Design — SOM Portal v2

> Status: **draft**. Companion to `architecture.md`. Fixes the shape of modules, request flow, and API contracts before any `src/` code is written.
>
> Scope: _how_ v2 is organised. Not _what_ pages exist (see `map.md`) or _which_ features ship first (see `prd.md`).
>
> Terms: **RSC** = React Server Component. **SA** = Server Action. **RH** = Route Handler (`app/api/.../route.ts`).

---

## 0. Guiding rules

1. **RSC-first.** Pages are Server Components. Data fetching happens in the component, not in a `useEffect`. No `swr`/`react-query` unless the data must poll in the client.
2. **Server Actions for mutations.** Forms submit to Server Actions. Progressive enhancement free. `useFormState` + `useFormStatus` for pending/error UI.
3. **Route Handlers only for third parties.** `app/api/v1/*` exists for one reason: let the browser-side v1 PHP clients (and anything already deep-linked) keep working during dual-run. Internal v2 pages do **not** fetch `/api/v1/*` — they call service modules directly from RSCs or SAs.
4. **One source of truth per concern.** Zod schema = TypeScript type = runtime validator = form resolver. Never redefine.
5. **No raw `data/*.json` from the client.** v1 had `.htaccess` blocking it (`feedback_no_raw_data_fetch`); v2 enforces the same by never exposing a file path to the browser.
6. **No `alert()` / `confirm()` / `prompt()`.** shadcn `Dialog` + `Sonner` toasts (`feedback_frontend_dos_donts`).

---

## 1. Route Handler vs Server Action vs direct RSC fetch

### Decision matrix

| Caller | Pattern | Reason |
|---|---|---|
| v2 page rendering data | **RSC → service module** | Zero network hop, streaming works, cache tags apply. |
| v2 form submit | **Server Action** | Progressive enhancement; typed args; no manual `fetch`. |
| v2 client-side poll (board SSE, presence, service-perf refresh) | **RH `GET`** that calls same service module | SSE/polling needs a URL; RSC can't stream mutations. |
| v1 PHP page or external script | **RH under `/api/v1/*`** | REST compatibility shim; same `{ok, data}` envelope as v1. |
| Jenkins/Jira webhook back to us | **RH `POST`** with signature verify | Third parties can only hit a URL. |

### Shapes

```ts
// app/(app)/board/page.tsx — RSC → service module (NO fetch)
import { listBoardPosts } from "@/src/board/service";
import { requireAuth } from "@/src/auth/session";

export default async function BoardPage({ searchParams }: PageProps) {
  const session = await requireAuth();
  const { q, status, page } = BoardListQuery.parse(await searchParams);
  const result = await listBoardPosts(session, { q, status, page });
  return <BoardList items={result.items} total={result.total} />;
}
```

```ts
// app/(app)/board/actions.ts — Server Action
"use server";
import { createBoardPost } from "@/src/board/service";
import { CreateBoardPost } from "@/src/board/schema";
import { requireAuth } from "@/src/auth/session";
import { revalidateTag } from "next/cache";

export async function createPostAction(_: FormState, fd: FormData): Promise<FormState> {
  const session = await requireAuth();
  const parsed = CreateBoardPost.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  const post = await createBoardPost(session, parsed.data);
  revalidateTag(`board:${session.team}`);
  return { ok: true, data: post };
}
```

```ts
// app/api/v1/board/route.ts — v1 shim (used by legacy JS, retired after cutover)
import { listBoardPosts, createBoardPost } from "@/src/board/service";
import { requireAuthFromRequest } from "@/src/auth/session";
import { envelope } from "@/src/http/envelope";

export const GET = envelope(async (req) => {
  const session = await requireAuthFromRequest(req);
  const q = BoardListQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  return listBoardPosts(session, q);
});

export const POST = envelope(async (req) => {
  const session = await requireAuthFromRequest(req);
  const body = CreateBoardPost.parse(await req.json());
  return createBoardPost(session, body);
});
```

**Mapping from v1:**

| v1 endpoint | v2 primary call site | v2 shim |
|---|---|---|
| `GET  /api/board` | `listBoardPosts()` in `board/page.tsx` | `app/api/v1/board/route.ts GET` |
| `POST /api/board` | `createPostAction()` Server Action | `app/api/v1/board/route.ts POST` |
| `POST /api/jira/create.php` | `createIssueAction()` SA on template page | `app/api/v1/jira/create/route.ts POST` |
| `GET  /api/jenkins-proxy?server=X` | Client poll on `jenkins.html` (RH) | — (RH is primary; proxy is inherently URL-based) |
| `GET  /api/service-performance` | `getPerfSnapshot()` RSC on `service-performance/page.tsx` | RH kept because client auto-refresh polls it |

**OPEN:** do we expose Server Actions over the wire to the mobile companion app? Current answer: no — mobile uses `/api/v1/*`. Needs a ticket if that changes.

---

## 2. Service module pattern

Every logical area is a module under `src/<name>/`. The module is the **only** place that touches storage, external APIs, or encryption keys. Pages, Server Actions, and Route Handlers call it; it has no React import.

```
src/board/
  schema.ts           # Zod schemas (SSOT: types + runtime guards + form resolvers)
  service.ts          # business logic — list/create/update/delete/soft-delete
  storage.ts          # thin wrapper over src/data (reads board.json for current team)
  __tests__/
    service.test.ts   # Vitest; mocks storage, hits service
    schema.test.ts    # round-trip Zod parses on v1 fixtures from data/sm/
  README.md           # 20-line "what this does + where v1 lived"
```

### `schema.ts` — single source of truth

```ts
// src/board/schema.ts
import { z } from "zod";

export const BoardStatus = z.enum(["open", "in_progress", "resolved"]);

export const BoardPost = z.object({
  id: z.string(),
  title: z.string().max(300),
  content: z.string().max(20_000).default(""),
  status: BoardStatus,
  board_type: z.string().default(""),
  pinned: z.boolean().default(false),
  author_id: z.string(),
  author_name: z.string(),
  mentions: z.array(z.string()).default([]),
  created_at: z.string(),            // ISO 8601
  updated_at: z.string().optional(),
  deleted_at: z.string().nullable().default(null),
});
export type BoardPost = z.infer<typeof BoardPost>;

export const BoardFile = z.array(BoardPost);     // whole-file schema
export const CreateBoardPost = BoardPost.pick({
  title: true, content: true, status: true, board_type: true, mentions: true,
}).partial({ content: true, status: true, board_type: true, mentions: true });

export const BoardListQuery = z.object({
  q: z.string().optional(),
  status: BoardStatus.optional(),
  starred: z.coerce.boolean().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(50).default(12),
});
```

### `service.ts` — business logic

```ts
// src/board/service.ts
import { readTeamFile, writeTeamFile } from "@/src/team/scope";
import { BoardFile, CreateBoardPost, type BoardPost } from "./schema";
import { logActivity } from "@/src/logging/activity";
import { newId } from "@/src/ids";
import type { Session } from "@/src/auth/session";

export async function listBoardPosts(session: Session, q: BoardListQuery) {
  const all = await readTeamFile(session, "board.json", BoardFile);
  const visible = all.filter(p => !p.deleted_at);
  // ...filter, sort, paginate (ported from api/board/index.php)
  return { items: paged, total: visible.length };
}

export async function createBoardPost(session: Session, input: CreateBoardPost): Promise<BoardPost> {
  const post: BoardPost = {
    id: newId("post"),
    author_id: session.sub,
    author_name: session.name,
    created_at: new Date().toISOString(),
    deleted_at: null,
    pinned: false,
    ...input,
    content: input.content ?? "",
    status: input.status ?? "open",
    board_type: input.board_type ?? "",
    mentions: input.mentions ?? [],
  };
  await writeTeamFile(session, "board.json", BoardFile, (prev) => [post, ...prev]);
  await logActivity(session, "board_create", { post_id: post.id });
  return post;
}
```

**Rules:**
- `service.ts` takes `Session` as first arg. Never reads it from a global.
- `service.ts` never calls `fetch` directly — only through sibling clients (`src/jira/client.ts`, etc.) that *do* own the HTTP.
- `storage.ts` is optional; collapse into `service.ts` if the module's state is just one JSON file.

---

## 3. Error envelope + handling

v1 ships `{ success: true, message, data }` on OK and `{ success: false, message }` on error. v2 keeps the **wire format identical** on `/api/v1/*` and adopts a cleaner internal type.

### Internal result type (service layer)

```ts
// src/http/result.ts
export type Ok<T>  = { ok: true; data: T };
export type Err    = { ok: false; error: string; code?: ErrorCode; status: number };
export type Result<T> = Ok<T> | Err;

export const ok  = <T>(data: T): Ok<T> => ({ ok: true, data });
export const err = (error: string, status = 400, code?: ErrorCode): Err =>
  ({ ok: false, error, code, status });

export class AppError extends Error {
  constructor(public status: number, msg: string, public code?: ErrorCode) { super(msg); }
}
export const NotFound     = (what: string) => new AppError(404, `${what} not found`,            "NOT_FOUND");
export const Forbidden    = (why: string)  => new AppError(403, why,                             "FORBIDDEN");
export const Unauthorized = ()             => new AppError(401, "Unauthorized",                 "UNAUTHORIZED");
export const Validation   = (msg: string)  => new AppError(400, msg,                             "VALIDATION");
export const RateLimited  = (retry: number)=> new AppError(429, "Rate limit exceeded", "RATE_LIMITED");
```

### Wire envelope (route handlers only — v1 shape)

```ts
// src/http/envelope.ts
export function envelope<R>(handler: (req: Request) => Promise<R>) {
  return async (req: Request): Promise<Response> => {
    try {
      const data = await handler(req);
      return Response.json({ success: true, message: "OK", data });
    } catch (e) {
      if (e instanceof AppError) {
        return Response.json({ success: false, message: e.message, code: e.code }, { status: e.status });
      }
      // Fatal — mirror v1's register_shutdown_function behaviour
      logSecurity("fatal_error", { message: String(e) });
      return Response.json({ success: false, message: "Server error" }, { status: 500 });
    }
  };
}
```

### Server Action result (internal — not the wire envelope)

```ts
// forms submit here; shape is tuned for useFormState
export type FormState<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error?: string; fieldErrors?: Record<string, string[]> };
```

**OPEN:** should SA responses collapse to the same `{success, message, data}` envelope for consistency with RH? Leaning no — SA callers are typed, RH callers are legacy JS. Needs a ticket if we add a shared GraphQL-ish layer.

---

## 4. Zod schemas as single source of truth

```
src/
  <module>/schema.ts     # module-owned shapes
  shared/schema/
    user.ts              # cross-module shapes (User, Team, Session)
    team.ts
    menu.ts              # nav/permissions
    jira-field-map.ts    # the field-map table that bit v1 hardest
```

### Lifecycle: read → validate → return typed; write → validate → persist

```ts
// src/data/json-adapter.ts (sketch)
import { z } from "zod";

export async function readValidated<T>(path: string, schema: z.ZodType<T>, fallback: T): Promise<T> {
  const raw = await readFileOrNull(path);
  if (!raw) return fallback;
  const parsed = schema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    // v1 behaviour: soft-fail. Log drift, don't throw.
    logger.warn({ path, issues: parsed.error.issues }, "schema drift");
    return fallback;
  }
  return parsed.data;
}

export async function writeValidated<T>(path: string, schema: z.ZodType<T>, data: T): Promise<void> {
  schema.parse(data);                      // hard-fail: never write bad data
  await lockfile.lock(path);
  try { await fs.writeFile(path, JSON.stringify(data, null, 2)); }
  finally { await lockfile.unlock(path); }
}
```

### Form resolver reuse

```tsx
// (app)/board/new/BoardForm.tsx — same schema for client-side validation
"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CreateBoardPost } from "@/src/board/schema";

export function BoardForm({ action }: { action: (fs: FormState, fd: FormData) => Promise<FormState> }) {
  const form = useForm({ resolver: zodResolver(CreateBoardPost) });
  // react-hook-form validates client-side; the Server Action re-validates on submit.
}
```

**Key schemas to pin in Phase 0 (because v1 drift here caused outages):**

- `src/jira/schema.ts` — custom field map (`jira_config.json`). v1's `customfield_17026` fault-start handling and select/array type-casting live here. `feedback_promql_escape`-style breakage comes from this file.
- `src/users/schema.ts` — user record + role enum. `GLOBAL_READ_ROLES`, `ADMIN_ROLES`, etc. become `const` arrays derived from a single Role enum.
- `src/team/schema.ts` — team record + `features: string[]` + `page_modes: Record<string, "full"|"read">`.
- `src/opensearch/schema.ts` — endpoint config + saved search DSL.

---

## 5. Dependency injection / request context

v1 uses `$GLOBALS['_current_team']`. v2 uses an explicit `Session` object threaded through every call.

```ts
// src/auth/session.ts
export type Role = "super_admin" | "super_viewer" | "sm_admin" | "dev_sm"
                 | "sm_lead" | "sm_user" | "dev_user" | "external";

export type Session = Readonly<{
  sub: string;
  name: string;
  email: string;
  role: Role;
  team: string;              // effective team after X-Admin-Team override
  homeTeam: string;          // JWT.team (never changes mid-request)
  isSuperViewer: boolean;    // convenience
  isGenz: boolean;           // sm_user flag; see project_genz_team
  devSubteam?: string;       // dev_user only
}>;

// For RSCs / Server Actions
export async function getSession(): Promise<Session | null>;
export async function requireAuth(opts?: { allowExpiredPw?: boolean }): Promise<Session>;
export async function requireRole(...roles: Role[]): Promise<Session>;

// For Route Handlers (no cookies() store yet when the request lands)
export async function requireAuthFromRequest(req: Request, opts?): Promise<Session>;
```

### How team context is resolved (ports v1's logic in helpers.php L612–623)

```ts
// src/auth/resolve-team.ts
export function resolveTeamContext(jwt: JwtPayload, headers: Headers): {
  team: string; homeTeam: string;
} {
  const homeTeam = jwt.team;
  const adminTeam = headers.get("x-admin-team");
  const canOverride = GLOBAL_READ_ROLES.includes(jwt.role);
  const team = canOverride && adminTeam && /^[a-z0-9_-]+$/.test(adminTeam)
    ? adminTeam
    : homeTeam;
  return { team, homeTeam };
}
```

### Logger per request

```ts
// src/logging/logger.ts
export function requestLogger(session: Session | null): Logger {
  return baseLogger.child({
    user: session?.sub ?? "anon",
    team: session?.team ?? "-",
    reqId: crypto.randomUUID(),
  });
}
```

Services take `session` as their first arg; if a service needs a logger it calls `requestLogger(session)` — we do NOT pass logger through every call site.

**OPEN:** should we adopt AsyncLocalStorage for request-scoped context (so services don't thread `session` through 3 layers)? Trade-off: implicit vs explicit. Leaning explicit for v2 Phase 0; revisit if signatures get noisy. **Ticket needed.**

---

## 6. Rate limiting middleware shape

v1 has two tiers: login (5 attempts / 15 min, in `rate_limit.json`) and API (120 req/60s per user+group, in `api_rate_limit.json`).

### Shape

```ts
// src/ratelimit/limiter.ts
export interface RateLimiter {
  check(key: string, limit: number, windowSec: number): Promise<{
    allowed: boolean; remaining: number; retryAfter: number;
  }>;
  fail(key: string): Promise<void>;      // for login counter
  success(key: string): Promise<void>;   // clears login counter
}

export const memoryLimiter: RateLimiter;   // single-process on-prem fallback
export const upstashLimiter: RateLimiter;  // if REDIS_URL set

export function limiter(): RateLimiter {
  return process.env.REDIS_URL ? upstashLimiter : memoryLimiter;
}
```

### Call sites

```ts
// src/auth/login.ts
await limiter().check(`login:${hash(username)}`, 5, 15 * 60);
// ...verify
if (!valid) { await limiter().fail(`login:${hash(username)}`); throw Unauthorized(); }
await limiter().success(`login:${hash(username)}`);
```

```ts
// middleware.ts (edge-compatible; use memoryLimiter at edge, swap in app code)
export async function middleware(req: NextRequest) {
  const session = await verifyJwtFromCookie(req);
  if (session) {
    const r = await limiter().check(`api:${session.sub}`, 120, 60);
    if (!r.allowed) return NextResponse.json(
      { success: false, message: "Rate limit exceeded" },
      { status: 429, headers: { "Retry-After": String(r.retryAfter) } },
    );
  }
  return NextResponse.next();
}
```

Per-group limiting (board/comments/upload/search/stars) stays in the service module:

```ts
// src/board/service.ts
export async function createBoardPost(session: Session, input: CreateBoardPost) {
  await limiter().check(`api:${session.sub}:board`, 120, 60);
  // ...
}
```

**OPEN:** on-prem has no Redis. Memory limiter in a multi-process pm2 cluster undercounts (each worker has its own counter). Options: 1) single Node process behind nginx — acceptable; 2) shared file lock à la v1 — ugly but matches current behaviour; 3) require Redis. **Ticket T-04 covers this.**

---

## 7. Logging (activity + security) hooks

v1 writes JSONL to `data/logs/activity-YYYY-MM-DD.jsonl` and `security-YYYY-MM-DD.jsonl`, team-scoped. v2 keeps the on-disk format identical so the existing log viewer (`admin/log.html` → `/api/log`) works unchanged during dual-run.

```ts
// src/logging/activity.ts
export async function logActivity(
  session: Session | null,
  action: string,
  meta: Record<string, unknown> = {},
): Promise<void>;

export async function logSecurity(
  session: Session | null,
  event: string,
  meta: Record<string, unknown> = {},
): Promise<void>;
```

### Shape of a log entry (matches v1)

```ts
type LogEntry = {
  ts: string;              // ISO-8601
  user_id: string | "-";
  user_name: string | "-";
  team: string | "-";
  ip: string;              // from X-Forwarded-For / X-Real-IP / remoteAddr
  ua: string;              // short UA ("Chrome/120.0")
  action: string;
  meta: Record<string, unknown>;
};
```

### Where to call

| Call | v1 location | v2 location |
|---|---|---|
| `logActivity("board_create", …)` | inline in `api/board/index.php` POST | `src/board/service.ts` `createBoardPost` |
| `logActivity("board_search", …)` | ibid GET branch | `src/board/service.ts` `listBoardPosts` when `q` present |
| `logSecurity("forbidden", …)` | `requireRole()` in `helpers.php` | `src/auth/session.ts` `requireRole()` |
| `logSecurity("brute_force_blocked", …)` | `rl_check()` in `helpers.php` | `src/ratelimit/limiter.ts` on login fail |
| `logSecurity("fatal_error", …)` | `register_shutdown_function` | `src/http/envelope.ts` catch arm + global error.tsx |
| `logSecurity("api_rate_limit_exceeded", …)` | `apiRateLimit()` | limiter middleware |

### Rotation

v1 caps `security.json` at 2000 entries. v2 switches to daily files (`security-2026-10-11.jsonl`) — appendable, no rotate step, grep-friendly, and the admin log viewer already handles date-sliced files.

**OPEN:** should activity/security go through OpenTelemetry to Loki from day one, bypassing JSONL? Would decouple log retention from on-disk JSON. Preserves JSONL for v1 compat but adds a parallel sink. **Ticket needed.**

---

## 8. External integration module template

Every integration (jira, jenkins, grafana/thanos, opensearch, mail) follows the same shape so adding a new one is mechanical.

```
src/jira/
  schema.ts              # IssueType, FieldMap, CreateIssueInput, …
  client.ts              # HTTP — Basic auth header, 1 fetch wrapper, retry, cooldown
  service.ts             # business ops — createIssue, searchJql, transition, …
  jql.ts                 # tagged-template for escapes (R-02 analogue for Jira)
  __tests__/
    client.test.ts       # mocks fetch, verifies auth header + envelope decode
    service.test.ts
  README.md              # creds env vars + v1 endpoint mapping
```

### Client template

```ts
// src/<integration>/client.ts
import { hostCooldownActive, hostCooldownMark } from "@/src/http/cooldown";

type ClientOpts = { timeoutMs?: number; retries?: number };

export class ExternalClient {
  constructor(private cfg: { baseUrl: string; authHeader: () => string; host: string }) {}

  async request<T>(path: string, init: RequestInit = {}, opts: ClientOpts = {}): Promise<T> {
    if (await hostCooldownActive(this.cfg.host)) throw new AppError(503, "Upstream in cooldown");
    const ctrl = new AbortController();
    const to   = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 10_000);
    try {
      const res = await fetch(this.cfg.baseUrl + path, {
        ...init,
        headers: { Authorization: this.cfg.authHeader(), ...(init.headers ?? {}) },
        signal: ctrl.signal,
      });
      if (res.status >= 500) { await hostCooldownMark(this.cfg.host); throw new AppError(502, `${this.cfg.host} ${res.status}`); }
      if (!res.ok) throw new AppError(res.status, await res.text());
      return (await res.json()) as T;
    } finally {
      clearTimeout(to);
    }
  }
}
```

### Jira — v1 `api/jira/create.php` port

```ts
// src/jira/service.ts
import { JiraCreateInput, JiraIssue } from "./schema";
import { readSharedFile } from "@/src/team/scope";

export async function createIssue(session: Session, input: JiraCreateInput): Promise<JiraIssue> {
  const cfg   = await readSharedFile("jira_config.json", JiraConfig);  // SM-shared
  const typed = castFieldsByType(input.fields, cfg.custom_fields);     // the v1 select/array/text branch
  const body  = { fields: { project: { key: "SMC" }, issuetype: { name: input.issuetype }, summary: input.summary, ...typed } };
  const issue = await jira.request<JiraIssue>("/rest/api/3/issue", { method: "POST", body: JSON.stringify(body) });
  await logActivity(session, "jira_create", { key: issue.key });
  return issue;
}
```

### Jenkins — host cooldown wired in

```ts
// src/jenkins/client.ts
export function jenkinsClient(server: JenkinsServer) {
  return new ExternalClient({
    baseUrl:    server.base_url,
    host:       new URL(server.base_url).host,     // cooldown bucket keyed per Jenkins host
    authHeader: () => server.token ? `Basic ${btoa(server.user + ":" + server.token)}` : "",
  });
}
```

Matches `project_host_cooldown_hardening` memory — the circuit breaker lives at the module boundary, not inside a page.

### Grafana / Thanos — PromQL escape helper (fixes `feedback_promql_escape`)

```ts
// src/grafana/promql.ts
export function promql(strings: TemplateStringsArray, ...vals: unknown[]): string {
  // Wire-form backslash-dot = `\\.` — JS string literal needs `\\\\.`
  const escape = (v: unknown) => String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return strings.reduce((acc, s, i) => acc + s + (i < vals.length ? escape(vals[i]) : ""), "");
}
// Usage:
// promql`up{job="${job}", instance=~"${host}\\."}`  → correct `\\.` on wire
```

### OpenSearch — per-user creds (ports v1 `opensearch-user-creds/`)

```ts
// src/opensearch/creds.ts
export async function encryptCred(plain: string): Promise<string> {
  const key = await deriveKey(process.env.JWT_SECRET!);             // same key derivation as v1
  const iv  = crypto.getRandomValues(new Uint8Array(16));
  const ct  = await crypto.subtle.encrypt({ name: "AES-CBC", iv }, key, new TextEncoder().encode(plain));
  return Buffer.concat([iv, new Uint8Array(ct)]).toString("base64");
}
```

Keeping the same AES-256-CBC + base64 shape means v1 and v2 can share `opensearch_user_creds.json` during dual-run.

### Mail (nodemailer)

```ts
// src/mail/service.ts
import nodemailer from "nodemailer";
export async function sendMail(session: Session, msg: MailMessage) {
  const cfg = await readTeamFile(session, "mail_config.json", MailConfig);  // per-team SMTP
  const tx  = nodemailer.createTransport({ host: cfg.host, port: cfg.port, auth: cfg.auth, secure: cfg.secure });
  const info = await tx.sendMail(msg);
  await logActivity(session, "mail_send", { to: msg.to, subject: msg.subject, messageId: info.messageId });
}
```

---

## 9. Server Action patterns for forms (progressive enhancement + Zod)

Baseline form: Zod schema → `useFormState` → Server Action → service module → `revalidateTag`.

```tsx
// (app)/board/new/page.tsx
import { BoardForm } from "./BoardForm";
import { createPostAction } from "../actions";

export default function Page() { return <BoardForm action={createPostAction} />; }
```

```tsx
// (app)/board/new/BoardForm.tsx  — client component
"use client";
import { useFormState, useFormStatus } from "react-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CreateBoardPost } from "@/src/board/schema";

export function BoardForm({ action }: Props) {
  const [state, formAction] = useFormState(action, { ok: false });
  const form = useFormContext ? useFormContext() : useForm({ resolver: zodResolver(CreateBoardPost) });

  return (
    <form action={formAction} onSubmit={form.handleSubmit(() => {})}>
      <Input {...form.register("title")} aria-invalid={!!state.fieldErrors?.title} />
      <FieldError>{state.fieldErrors?.title?.[0]}</FieldError>
      <Textarea {...form.register("content")} />
      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return <Button disabled={pending}>{pending ? "Posting…" : "Post"}</Button>;
}
```

```ts
// (app)/board/actions.ts
"use server";
export async function createPostAction(prev: FormState, fd: FormData): Promise<FormState> {
  const session = await requireAuth();
  const parsed  = CreateBoardPost.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  try {
    const post = await createBoardPost(session, parsed.data);
    revalidateTag(`board:${session.team}`);
    return { ok: true, data: post };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    throw e;
  }
}
```

### Where to deviate from the baseline

- **File upload (board image, inbox attachment)** — form uses `<input type="file">` + Server Action receives `FormData`; action streams to `src/uploads/store.ts`. Progressive enhancement still works.
- **Multi-step wizards (Incident Launcher)** — each step is its own SA; state lives in URL searchParams, not server session. Matches `project_incident_launcher` guided-mode split-panel.
- **Admin bulk edits (users table)** — SA receives JSON (not FormData) via `useTransition()`; no fallback needed because admins have JS.

**OPEN:** should we standardise on `conform-to` for Zod + Server Actions? It auto-wires error IDs and ARIA attributes. Trade-off: another dep vs ~30 lines of boilerplate per form. **Ticket needed.**

---

## 10. Streaming + Suspense for slow dashboards

`service-performance.html` is the stress case: 5+ runways, each with a cold-cache Thanos fetch that can take 10s. v1 handles this by caching to disk (`data/sm/service-performance/*`) + raising `memory_limit=512M, time_limit=180`. v2 does the same cache, but uses RSC Suspense to stream per-runway results so a slow source doesn't block the page.

### Page shell (immediate paint)

```tsx
// app/(app)/service-performance/page.tsx
import { Suspense } from "react";
import { listRunways } from "@/src/service-perf/service";
import { RunwayCard } from "./RunwayCard";
import { RunwayCardSkeleton } from "./skeletons";

export default async function Page({ searchParams }: PageProps) {
  const session = await requireAuth();
  const runways = await listRunways(session);        // fast — metadata only
  return (
    <div className="grid grid-cols-3 gap-4">
      {runways.map(r => (
        <Suspense key={r.slug} fallback={<RunwayCardSkeleton name={r.display} />}>
          <RunwayCard session={session} slug={r.slug} />
        </Suspense>
      ))}
    </div>
  );
}
```

### Per-runway RSC — the slow fetch

```tsx
// app/(app)/service-performance/RunwayCard.tsx
import { getRunwaySnapshot } from "@/src/service-perf/service";

export async function RunwayCard({ session, slug }: Props) {
  // Returns from cache if fresh (<60s), else refetches Thanos.
  // Service module isolates failures per runway (same as v1 try/catch).
  const snap = await getRunwaySnapshot(session, slug);
  if (snap.error) return <RunwayError name={slug} message={snap.error} />;
  return <RunwayView snap={snap} />;
}
```

### Client-side auto-refresh (keeps v1's 30s poll w/ visibility pause)

```tsx
// app/(app)/service-performance/AutoRefresh.tsx  (client)
"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function AutoRefresh({ ms = 30_000 }: { ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    let t: number | undefined;
    const tick = () => { if (!document.hidden) router.refresh(); t = window.setTimeout(tick, ms); };
    t = window.setTimeout(tick, ms);
    return () => { if (t) window.clearTimeout(t); };
  }, [ms, router]);
  return null;
}
```

`router.refresh()` re-runs the RSC, which hits the cache for fresh runways and refetches only stale ones — same semantics as v1 `GET /api/service-performance?runway=all`, zero full-page reload.

### Fallback skeletons

Phase-2 skeleton library (`project_global_loading_plan`) ports to a React component set — the `<RunwayCardSkeleton>` above is one preset. Theme.js's auto-skeleton MutationObserver trick is gone; RSC + Suspense replaces it structurally.

### Service module shape

```ts
// src/service-perf/service.ts
export async function getRunwaySnapshot(session: Session, slug: string): Promise<RunwaySnap> {
  const cached = await readCache(slug);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached;
  try {
    const fresh = await fetchFromThanos(slug);        // may be slow / may throw
    await writeCache(slug, fresh);
    return fresh;
  } catch (e) {
    // Return the stale cache if we have one — same as v1 "single slow source can't stall the page"
    if (cached) return { ...cached, error: `stale: ${(e as Error).message}` };
    throw new AppError(502, `thanos: ${(e as Error).message}`);
  }
}
```

**OPEN:**
- Do we need `loading.tsx` at the page level in addition to Suspense boundaries? Only if the metadata fetch itself (`listRunways`) is slow — currently it's just a JSON read, so no.
- Should the per-runway stream use PPR (Partial Prerendering) once stable? Likely yes in a later phase; keeps SEO-irrelevant for this internal tool, so defer. **Ticket needed when PPR stable.**
- Thanos query volume vs cache hit rate — same `cache/{slug}.json` layout as v1 keeps the on-disk shape stable. Nginx-as-nobody permissions issue (per `project_service_performance` memory) resurfaces for Node — add it to the deployment checklist.

---

## Appendix A: Open decisions (needs tickets)

| # | Topic | Section |
|---|---|---|
| D-01 | Expose Server Actions to mobile app? | §1 |
| D-02 | Collapse SA result shape into v1 wire envelope? | §3 |
| D-03 | AsyncLocalStorage for request context? | §5 |
| D-04 | On-prem rate limiting: Redis, memory, or shared file? | §6 (also arch T-04) |
| D-05 | OpenTelemetry log sink alongside JSONL? | §7 |
| D-06 | Adopt `conform-to` for form actions? | §9 |
| D-07 | PPR when stable, for dashboards? | §10 |

## Appendix B: v1 → v2 call-site map (sampled)

| v1 file | v2 primary call site | v2 compat shim |
|---|---|---|
| `api/helpers.php` | split across `src/auth/`, `src/data/`, `src/logging/`, `src/ratelimit/`, `src/team/` | — |
| `api/board/index.php` | `src/board/service.ts` from `(app)/board/page.tsx` + `actions.ts` | `app/api/v1/board/route.ts` |
| `api/jira/create.php` | `src/jira/service.ts#createIssue` from Incident Launcher SA | `app/api/v1/jira/create/route.ts` |
| `api/jira/fields.php` | `src/jira/service.ts#listFields` from `jira-templates/page.tsx` | `app/api/v1/jira/fields/route.ts` |
| `api/jenkins-proxy/index.php` | `src/jenkins/service.ts#proxy` from client-side `JenkinsBrowser` | `app/api/v1/jenkins-proxy/route.ts` (primary) |
| `api/service-performance/index.php` | `src/service-perf/service.ts` from streaming RSC | `app/api/v1/service-performance/route.ts` |
| `api/opensearch-user-creds/index.php` | `src/opensearch/creds.ts` + `(admin)/opensearch-config/actions.ts` | `app/api/v1/opensearch-user-creds/route.ts` |
| `api/users/index.php` | `src/users/service.ts` from `(admin)/users/page.tsx` + actions | `app/api/v1/users/route.ts` |
| `api/system-settings/index.php` | `src/system-settings/service.ts` | `app/api/v1/system-settings/route.ts` |
| `api/log/index.php` | `src/logging/reader.ts` from `(admin)/log/page.tsx` | `app/api/v1/log/route.ts` |
| `assets/js/api.js` | deleted — RSCs don't fetch; SAs are typed | — (legacy pages still load it during dual-run) |
