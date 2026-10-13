# Test Strategy — SOM Portal v2

Starting from zero. The PHP app has no tests. We will not retrofit tests into
PHP; v2 ships with a test suite from day one. The goals, in priority order:

1. Prevent cross-team data leakage (team scoping is the #1 regression risk).
2. Lock in the escape rules for upstream query languages (PromQL, Lucene, JQL).
3. Keep the auth surface honest (JWT, roles, team claim).
4. Make a developer confident that `pnpm test` catches real breakage before PR.

Everything else is secondary.

## 1. Pyramid

| Layer         | Tool                  | Location                          | Covers                                                                 |
|---------------|-----------------------|-----------------------------------|------------------------------------------------------------------------|
| Unit          | Vitest                | `src/**/*.test.ts` (colocated)    | Pure functions: JWT, crypto, Zod schemas, PromQL builder, mappers.     |
| Component     | Vitest + Testing Lib  | `src/components/**/*.test.tsx`    | React server/client components rendered in isolation (jsdom).          |
| Route handler | Vitest + MSW          | `src/app/api/**/*.test.ts`        | Next.js route handlers against mocked upstreams + a tmp data dir.      |
| Contract      | Vitest + MSW          | `tests/contract/*.test.ts`        | Shape of real Jira / Jenkins / Grafana / OpenSearch responses (saved fixtures). |
| E2E           | Playwright            | `tests/e2e/*.spec.ts`             | Full browser flows against a seeded dev server (`pnpm dev`).           |
| Smoke         | Playwright `@smoke`   | `tests/e2e/smoke/*.spec.ts`       | Post-deploy ping of login + /board + /service-performance.             |

Roughly: 70 % unit, 20 % route-handler, 8 % component, 2 % E2E. We do not chase
coverage of leaf components — we chase coverage of boundary code (auth, team
scoping, upstream adapters).

The split between **unit** and **route handler** is deliberate: a route handler
test boots the real Next.js handler function (`import { GET } from
'./route'`), passes a `Request`, and asserts on the `Response`. No HTTP, no
dev server. That makes them fast enough to run on every save.

Contract tests are a quarantined folder: they load **recorded** upstream
responses captured from the real services (sanitised). They re-run on CI
nightly against a shadow MSW handler that validates the recorded shape against
the live one — early-warning for upstream drift (Jira field renames, Thanos
label changes).

## 2. Fixture + mock strategy

### Upstream HTTP: MSW

A single MSW `setupServer()` is started per Vitest project
(`tests/setup/msw.ts`). Handlers live under `tests/mocks/handlers/` and are
grouped by upstream:

- `handlers/jira.ts` — `POST /rest/api/3/issue`, `GET /rest/api/3/field`,
  `GET /rest/api/3/issuetype`.
- `handlers/jenkins.ts` — `GET /job/.../api/json`, `POST /job/.../build`.
- `handlers/thanos.ts` — `GET /api/v1/query_range`, `GET /api/v1/labels`.
- `handlers/opensearch.ts` — `POST /_search`.
- `handlers/smtp.ts` — not MSW; see below.

Each handler file exports the default happy-path response **plus** named error
cases:

```ts
// tests/mocks/handlers/jira.ts
export const jiraHappy = http.post(
  'https://truemoney.atlassian.net/rest/api/3/issue',
  () => HttpResponse.json({ id: '10001', key: 'SMC-1234' }, { status: 201 }),
);
export const jiraRateLimited = http.post(
  'https://truemoney.atlassian.net/rest/api/3/issue',
  () => new HttpResponse(null, { status: 429, headers: { 'Retry-After': '30' } }),
);
```

Tests opt in to a non-default handler via `server.use(jiraRateLimited)`.
`server.resetHandlers()` runs in `afterEach`.

We explicitly do **not** use `nock`. One mock layer, one syntax. MSW also
intercepts `fetch` in both Node and jsdom, which matters for Next.js server
components and client fetchers.

### Playwright: upstream mocks via `page.route()`

Playwright tests mock upstreams at the browser layer with `page.route()`.
Example in `tests/e2e/fixtures.ts`:

```ts
export const test = base.extend<{ mockJira: void }>({
  mockJira: [async ({ page }, use) => {
    await page.route('**/rest/api/3/issue', (route) =>
      route.fulfill({ status: 201, json: { key: 'SMC-9999' } }));
    await use();
  }, { auto: true }],
});
```

The dev server itself is launched with `NODE_ENV=test` and reads
`.env.test`, which points `JIRA_BASE_URL` etc. at `http://localhost:4010` —
an MSW standalone server shared across Playwright workers. That means the
same handler files power both Vitest and Playwright. One source of truth.

### Storage adapter: tmp dirs

The storage adapter (`src/lib/storage/jsonFileStore.ts`) takes a root path.
Tests create a tmp root per test:

```ts
beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'som-'));
  store = createJsonFileStore({ root: dataDir });
});
afterEach(() => fs.rm(dataDir, { recursive: true, force: true }));
```

Team scope tests seed `${dataDir}/sm/users.json`, `${dataDir}/tmn/users.json`,
etc. and assert the correct one is read based on the JWT `team` claim.

### SMTP: Mailpit

For the `mail/` module we run **Mailpit** (`docker run axllent/mailpit`) on a
random port in CI. The adapter points at `localhost:${MAILPIT_SMTP_PORT}` and
tests read sent messages via Mailpit's HTTP API. Mailpit is tiny, fast, and
captures the full RFC822 bytes — much better than mocking nodemailer.

### Grafana Thanos: PromQL recording

PromQL queries are too easy to subtly break (see §3 escape bug). We keep a
`tests/fixtures/thanos/*.json` folder of real responses captured once, and
match on the query string. If the builder emits a different query, the mock
404s and the test fails loudly — no silent empty-result pass.

## 3. Sample specs (12)

### 3.1 Auth — JWT verify unit test

```ts
// src/lib/auth/jwt.test.ts
import { describe, test, expect, vi } from 'vitest';
import { signToken, verifyToken } from './jwt';

describe('jwt', () => {
  const secret = 'a'.repeat(64);

  test('round-trips payload and preserves team claim', async () => {
    const token = await signToken({ sub: 'u1', role: 'sm_user', team: 'sm' }, secret, '8h');
    const decoded = await verifyToken(token, secret);
    expect(decoded).toMatchObject({ sub: 'u1', role: 'sm_user', team: 'sm' });
    expect(decoded.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  test('rejects token signed with a different secret', async () => {
    const token = await signToken({ sub: 'u1', role: 'sm_user', team: 'sm' }, secret, '8h');
    await expect(verifyToken(token, 'b'.repeat(64))).rejects.toThrow(/signature/i);
  });

  test('rejects expired token', async () => {
    vi.useFakeTimers();
    const token = await signToken({ sub: 'u1', role: 'sm_user', team: 'sm' }, secret, '1s');
    vi.advanceTimersByTime(2000);
    await expect(verifyToken(token, secret)).rejects.toThrow(/expired/i);
    vi.useRealTimers();
  });

  test('rejects token with missing team claim (regression: silent sm-root read)', async () => {
    const bad = await signToken({ sub: 'u1', role: 'sm_user' } as any, secret, '8h');
    await expect(verifyToken(bad, secret)).rejects.toThrow(/team/i);
  });
});
```

### 3.2 Team scope — `readTeamFile` routes to the right dir

```ts
// src/lib/storage/teamScope.test.ts
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createJsonFileStore } from './jsonFileStore';

describe('team-scoped storage', () => {
  let root: string;
  let store: ReturnType<typeof createJsonFileStore>;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'som-scope-'));
    await mkdir(path.join(root, 'sm'), { recursive: true });
    await mkdir(path.join(root, 'tmn'), { recursive: true });
    await writeFile(path.join(root, 'sm', 'board.json'), JSON.stringify({ posts: [{ id: 'sm-1' }] }));
    await writeFile(path.join(root, 'tmn', 'board.json'), JSON.stringify({ posts: [{ id: 'tmn-1' }] }));
    await writeFile(path.join(root, 'board.json'), JSON.stringify({ posts: [{ id: 'root-LEAK' }] }));
    store = createJsonFileStore({ root });
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  test('sm user reads from data/sm/', async () => {
    const board = await store.readTeamFile({ team: 'sm' }, 'board.json');
    expect(board.posts[0].id).toBe('sm-1');
  });

  test('tmn user never sees sm data', async () => {
    const board = await store.readTeamFile({ team: 'tmn' }, 'board.json');
    expect(JSON.stringify(board)).not.toContain('sm-1');
    expect(JSON.stringify(board)).not.toContain('root-LEAK');
  });

  test('throws when team claim is empty rather than falling back to root', async () => {
    await expect(store.readTeamFile({ team: '' as any }, 'board.json')).rejects.toThrow(/team/i);
  });
});
```

### 3.3 Zod schema — board post round-trip

```ts
// src/lib/schemas/boardPost.test.ts
import { describe, test, expect } from 'vitest';
import { BoardPost, BoardPostInput } from './boardPost';

describe('BoardPost schema', () => {
  test('accepts a minimal valid post and fills defaults', () => {
    const parsed = BoardPostInput.parse({
      title: 'DB slow',
      service_type: 'db',
      author_id: 'u1',
    });
    expect(parsed.status).toBe('open');
    expect(parsed.pinned).toBe(false);
  });

  test('rejects unknown status (regression: free-text status in legacy)', () => {
    expect(() =>
      BoardPost.parse({ id: 'p1', title: 't', status: 'archived', author_id: 'u1', created_at: new Date().toISOString() }),
    ).toThrow(/status/);
  });

  test('encode → decode is idempotent', () => {
    const sample = BoardPost.parse({
      id: 'p1', title: 'x', status: 'open', author_id: 'u1',
      created_at: '2026-01-01T00:00:00.000Z', pinned: false, deleted: false,
    });
    expect(BoardPost.parse(JSON.parse(JSON.stringify(sample)))).toEqual(sample);
  });
});
```

### 3.4 PromQL tagged template — escape rules

Known bug: `\.` is rejected by Thanos as "unknown escape sequence". Builder
must emit `\\.` on the wire (i.e. `\\\\.` in TS source).

```ts
// src/lib/promql/build.test.ts
import { describe, test, expect } from 'vitest';
import { promql } from './build';

describe('promql tagged template', () => {
  test('escapes dots in regex label matchers', () => {
    const q = promql`up{job=~${{ regex: 'api.v1.*' }}}`;
    expect(q).toBe('up{job=~"api\\\\.v1\\\\..*"}');
  });

  test('quotes plain string label values', () => {
    const q = promql`up{instance=${'host-01'}}`;
    expect(q).toBe('up{instance="host-01"}');
  });

  test('rejects embedded double-quote in string value', () => {
    expect(() => promql`up{instance=${'ho"st'}}`).toThrow(/quote/i);
  });

  test('passes raw expressions through for numeric durations', () => {
    const q = promql`rate(http_requests_total[${{ raw: '5m' }}])`;
    expect(q).toBe('rate(http_requests_total[5m])');
  });

  test('regression: Dependencies upstream query uses double-escaped dot', () => {
    const svc = 'wallet.api';
    const q = promql`sum by (service) (http_requests_total{service=~${{ regex: `${svc}\\..*` }}})`;
    // on wire: service=~"wallet\\.api\\..*"
    expect(q).toContain('service=~"wallet\\\\.api\\\\..*"');
  });
});
```

### 3.5 Jira field mapping — typed accessor rejects wrong type

```ts
// src/lib/jira/fieldMap.test.ts
import { describe, test, expect } from 'vitest';
import { JiraFieldMap } from './fieldMap';

describe('JiraFieldMap', () => {
  const map = new JiraFieldMap({
    severity:   { id: 'customfield_10040', type: 'option' },
    sprint:     { id: 'customfield_10020', type: 'array<sprint>' },
    story_pts:  { id: 'customfield_10026', type: 'number' },
  });

  test('encodes an option field as { value } object', () => {
    expect(map.encode('severity', 'P1')).toEqual({ customfield_10040: { value: 'P1' } });
  });

  test('encodes a number field as raw number', () => {
    expect(map.encode('story_pts', 5)).toEqual({ customfield_10026: 5 });
  });

  test('rejects string value for number field (regression: "3" silently stored)', () => {
    // @ts-expect-error — compile-time catch; still verify runtime
    expect(() => map.encode('story_pts', '3')).toThrow(/number/i);
  });

  test('rejects unknown logical field', () => {
    expect(() => map.encode('nope' as any, 'x')).toThrow(/unknown field/i);
  });
});
```

### 3.6 Jenkins host-cooldown — circuit breaker

```ts
// src/lib/jenkins/cooldown.test.ts
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { createCircuit } from './cooldown';

describe('host cooldown circuit breaker', () => {
  beforeEach(() => vi.useFakeTimers());

  test('opens after 3 consecutive failures and short-circuits', async () => {
    const circuit = createCircuit({ threshold: 3, cooldownMs: 60_000 });
    const upstream = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    for (let i = 0; i < 3; i++) {
      await expect(circuit.call('jenkins-prod', upstream)).rejects.toThrow();
    }
    expect(upstream).toHaveBeenCalledTimes(3);

    await expect(circuit.call('jenkins-prod', upstream)).rejects.toThrow(/cooldown/i);
    expect(upstream).toHaveBeenCalledTimes(3); // not called again
  });

  test('cooldown clears after the window and half-open probe succeeds', async () => {
    const circuit = createCircuit({ threshold: 2, cooldownMs: 60_000 });
    const upstream = vi.fn()
      .mockRejectedValueOnce(new Error('x'))
      .mockRejectedValueOnce(new Error('x'))
      .mockResolvedValueOnce({ ok: true });

    await expect(circuit.call('h', upstream)).rejects.toThrow();
    await expect(circuit.call('h', upstream)).rejects.toThrow();
    await expect(circuit.call('h', upstream)).rejects.toThrow(/cooldown/i);

    vi.advanceTimersByTime(61_000);
    await expect(circuit.call('h', upstream)).resolves.toEqual({ ok: true });
  });

  test('breakers are per-host (DRP-DNS incident regression)', async () => {
    const circuit = createCircuit({ threshold: 1, cooldownMs: 60_000 });
    const bad = vi.fn().mockRejectedValue(new Error('x'));
    const good = vi.fn().mockResolvedValue({ ok: true });

    await expect(circuit.call('bad.host', bad)).rejects.toThrow();
    await expect(circuit.call('bad.host', bad)).rejects.toThrow(/cooldown/i);
    await expect(circuit.call('good.host', good)).resolves.toEqual({ ok: true });
  });
});
```

### 3.7 OpenSearch per-user creds — encrypt / decrypt round-trip

```ts
// src/lib/opensearch/userCreds.test.ts
import { describe, test, expect } from 'vitest';
import { encryptCred, decryptCred } from './userCreds';

describe('per-user OpenSearch creds', () => {
  const key = Buffer.alloc(32, 7); // 256-bit zeroed-ish key for test

  test('encrypt → decrypt round-trips username+password', () => {
    const cipher = encryptCred({ username: 'alice', password: 's3cret!' }, key);
    expect(cipher).not.toContain('s3cret');
    expect(decryptCred(cipher, key)).toEqual({ username: 'alice', password: 's3cret!' });
  });

  test('each encryption produces a fresh IV (ciphertexts differ)', () => {
    const a = encryptCred({ username: 'u', password: 'p' }, key);
    const b = encryptCred({ username: 'u', password: 'p' }, key);
    expect(a).not.toEqual(b);
  });

  test('tampered ciphertext fails authenticated decryption', () => {
    const cipher = encryptCred({ username: 'u', password: 'p' }, key);
    const tampered = cipher.slice(0, -2) + 'XX';
    expect(() => decryptCred(tampered, key)).toThrow(/auth/i);
  });

  test('wrong key fails cleanly, not silently', () => {
    const cipher = encryptCred({ username: 'u', password: 'p' }, key);
    expect(() => decryptCred(cipher, Buffer.alloc(32, 8))).toThrow();
  });
});
```

### 3.8 Route handler — board POST writes to the team dir

```ts
// src/app/api/board/route.test.ts
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { POST } from './route';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { withTmpData, mintJwt } from '../../../../tests/helpers';

describe('POST /api/board', () => {
  let ctx: Awaited<ReturnType<typeof withTmpData>>;
  beforeEach(async () => { ctx = await withTmpData({ team: 'sm' }); });
  afterEach(() => ctx.cleanup());

  test('creates a post under data/sm/board.json', async () => {
    const token = await mintJwt({ sub: 'u1', role: 'sm_user', team: 'sm' });
    const req = new Request('http://x/api/board', {
      method: 'POST',
      headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'DB slow', service_type: 'db' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toMatch(/^post_/);

    const file = await readFile(path.join(ctx.dataRoot, 'sm', 'board.json'), 'utf8');
    expect(JSON.parse(file).posts).toHaveLength(1);
  });

  test('401 without a token (no silent fallthrough)', async () => {
    const req = new Request('http://x/api/board', { method: 'POST', body: '{}' });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});
```

### 3.9 Playwright E2E — login → board → create → Jira → status

```ts
// tests/e2e/board-to-jira.spec.ts
import { test, expect } from './fixtures';

test('operator posts an incident on the board and files a Jira issue', async ({ page }) => {
  // Upstream mocks are registered by fixtures (jira happy path).
  await page.goto('/login');
  await page.getByLabel('Email').fill('ops@example.com');
  await page.getByLabel('Password').fill('test-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/board/);

  await page.getByRole('button', { name: 'New post' }).click();
  await page.getByLabel('Title').fill('Payments API 5xx spike');
  await page.getByLabel('Service type').selectOption('payments');
  await page.getByLabel('Severity').selectOption('P1');
  await page.getByRole('button', { name: 'Create' }).click();

  const card = page.getByRole('article', { name: /Payments API 5xx spike/ });
  await expect(card).toBeVisible();
  await expect(card.getByText(/open/i)).toBeVisible();

  await card.getByRole('button', { name: 'File Jira' }).click();
  await page.getByRole('button', { name: 'Submit' }).click();

  await expect(card.getByRole('link', { name: /SMC-9999/ })).toBeVisible();
  await expect(card.getByText(/in_progress/i)).toBeVisible();
});
```

### 3.10 Component — board status badge renders role-correct actions

```tsx
// src/components/board/StatusBadge.test.tsx
import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from './StatusBadge';

describe('<StatusBadge/>', () => {
  test('sm_user sees status but no resolve button', () => {
    render(<StatusBadge status="open" viewerRole="sm_user" />);
    expect(screen.getByText(/open/i)).toBeVisible();
    expect(screen.queryByRole('button', { name: /resolve/i })).toBeNull();
  });

  test('sm_lead sees a resolve action on open post', () => {
    render(<StatusBadge status="open" viewerRole="sm_lead" />);
    expect(screen.getByRole('button', { name: /resolve/i })).toBeEnabled();
  });

  test('resolved posts never offer a resolve action, even for admin', () => {
    render(<StatusBadge status="resolved" viewerRole="sm_admin" />);
    expect(screen.queryByRole('button', { name: /resolve/i })).toBeNull();
  });
});
```

### 3.11 OpenSearch query builder — Lucene escape

```ts
// src/lib/opensearch/queryBuilder.test.ts
import { describe, test, expect } from 'vitest';
import { buildLucene } from './queryBuilder';

describe('Lucene query builder', () => {
  test('escapes reserved characters in a free-text term', () => {
    expect(buildLucene({ term: 'cost: $5+ (ok)' }))
      .toBe('cost\\: \\$5\\+ \\(ok\\)');
  });

  test('wraps multi-word phrase in quotes', () => {
    expect(buildLucene({ term: 'db pool exhausted' })).toBe('"db pool exhausted"');
  });

  test('joins filters with AND and preserves correlation id as exact match', () => {
    expect(buildLucene({ term: 'error', filters: { correlation_id: 'abc-123' } }))
      .toBe('error AND correlation_id:"abc-123"');
  });
});
```

### 3.12 Mail adapter — Mailpit integration

```ts
// src/lib/mail/send.int.test.ts
import { describe, test, expect, beforeAll } from 'vitest';
import { sendMail } from './send';

const MAILPIT_HTTP = process.env.MAILPIT_HTTP ?? 'http://localhost:8025';

describe('mail adapter (integration)', () => {
  beforeAll(async () => {
    await fetch(`${MAILPIT_HTTP}/api/v1/messages`, { method: 'DELETE' });
  });

  test('sends an HTML mail that Mailpit records with the correct subject', async () => {
    await sendMail({
      to: ['oncall@example.com'],
      subject: 'Incident SMC-1234',
      html: '<p>Payments API 5xx spike</p>',
    });

    const res = await fetch(`${MAILPIT_HTTP}/api/v1/messages`);
    const { messages } = await res.json();
    expect(messages).toHaveLength(1);
    expect(messages[0].Subject).toBe('Incident SMC-1234');
    expect(messages[0].To[0].Address).toBe('oncall@example.com');
  });
});
```

## 4. CI gates

Pipeline (GitHub Actions, matrix on Node 20):

1. `pnpm install --frozen-lockfile`
2. `pnpm lint` — ESLint + `tsc --noEmit`. Hard fail.
3. `pnpm test:unit` — Vitest unit + component + route-handler projects.
   Hard fail. Must pass to merge.
4. `pnpm test:int` — Vitest integration project (Mailpit, tmp dirs).
   Hard fail.
5. `pnpm test:e2e` — Playwright against `pnpm build && pnpm start`.
   One retry allowed per test. Hard fail on second failure.
6. `pnpm test:contract` — nightly cron only; failure opens a GitHub issue,
   does not block PRs.

### Merge rules

- `pnpm test:unit` and `pnpm test:int` are **required status checks** on
  `main`. No bypass, including for admins.
- `pnpm test:e2e` is required but allowed to retry once (Playwright
  `retries: process.env.CI ? 1 : 0`).
- `pnpm lint` is required.
- Contract tests are informational.

### Visual regression

**Proposal: no.** We will not run Playwright snapshot / Percy / Chromatic
in v2. Reason: the design system is still churning (per
`design_system.md`) and screenshot diffs will produce more review noise
than signal. We revisit after the design system freezes (post-M4).

If a specific component (e.g. the pulse header) stabilises and visual
regressions bite, we add a single targeted snapshot test for *that*
component. Opt-in, not blanket.

### Coverage threshold

**Proposal: per-module, not global.** A single global number encourages
chasing coverage of trivial code and ignoring hard code. We set:

| Module                       | Line coverage floor |
|------------------------------|---------------------|
| `src/lib/auth`               | 95 %                |
| `src/lib/storage` (team scope) | 95 %              |
| `src/lib/promql`             | 90 %                |
| `src/lib/jira`               | 85 %                |
| `src/lib/opensearch`         | 85 %                |
| `src/lib/jenkins`            | 85 %                |
| `src/components/**`          | — (no floor)        |
| `src/app/api/**` route code  | 80 %                |

Vitest `coverage.thresholds` enforces per-glob. CI fails if a floor is
broken by the PR diff (not by pre-existing debt — we grandfather baseline
at M0).

## 5. Flaky-test discipline

A flaky test is a bug, not a nuisance. Zero tolerance for "re-run CI and
hope."

**Policy:**

1. First observed flake on `main`: an issue is auto-opened by the CI job
   (title `[flake] <test name>`), labelled `flake` and assigned to the
   test owner (from `CODEOWNERS`).
2. Second flake within 7 days: the test is **auto-quarantined** by a bot
   PR that moves it to a `test.skip(...)` with a link to the issue and
   adds `@flaky` tag. Quarantine lasts max 7 days.
3. The owner has 7 calendar days to fix or delete. After 7 days, the
   quarantined test is **deleted** by a scheduled job and the issue is
   closed with reason `expired`. We would rather have fewer honest tests
   than a graveyard of skipped ones.
4. Playwright-specific: we never fix a flake by increasing `timeout` or
   adding `page.waitForTimeout`. If the fix would be a sleep, delete the
   test instead.
5. "Flaky" is defined by CI metrics: a test that passes and fails
   across two runs of the same commit SHA. We tag runs in BuildKite /
   Actions with the SHA to detect this.

A visible dashboard (`/internal/flake-board`, dogfooded from the SOM
Portal itself) shows active quarantines. Count > 0 is a yellow signal in
weekly engineering standup.

## 6. Test data strategy

Three distinct fixture tiers. Mixing them is a smell.

### Tier 1 — Unit JSON fixtures (`tests/fixtures/**`)

Static, hand-authored, minimal. One file per logical shape.
Example: `tests/fixtures/jira/issue-create-201.json`,
`tests/fixtures/thanos/query-range-cpu-happy.json`.

Rules:
- No PII, no real tokens, no real user emails. Replace with
  `user-01@example.com` style.
- No dates in the past — use `__NOW__` placeholder; test helpers
  substitute with `Date.now()` at load.
- Checked in; reviewed in PR like any other code.

### Tier 2 — E2E seed (`tests/e2e/seed/`)

A single script `pnpm test:e2e:seed` runs before Playwright and writes a
deterministic set of users, board posts, Jenkins servers, nav groups,
and system settings into the dev data dir. Users:

- `ops@example.com` / `test-password` → `sm_user`, team `sm`
- `lead@example.com` / `test-password` → `sm_lead`, team `sm`
- `admin@example.com` / `test-password` → `sm_admin`, team `sm`
- `tmn-ops@example.com` → `sm_user`, team `tmn` (for cross-team tests)

Seed is idempotent: it `rm -rf`s the data dir first and rebuilds. Never
"add on top" — reproducibility matters more than speed.

### Tier 3 — Contract fixtures (`tests/fixtures/contract/`)

Captured once from the real upstream, redacted, dated in filename
(`jira-field-metadata-2026-10-11.json`). Rotated manually when a nightly
contract test fails. Not touched by unit tests.

### Cleanup

- Vitest: `afterEach` removes tmp dirs via the shared `withTmpData`
  helper. If a worker crashes, the OS cleans `os.tmpdir()` on reboot.
- Playwright: the dev server runs against `./.test-data/` which is
  deleted and reseeded in `globalSetup`.
- Mailpit: inbox cleared in `beforeAll` of each integration file.

## 7. Non-tests

Explicitly out of scope for v2 launch.

- **Load / stress testing.** Deferred. The user base is small (internal
  tools, bounded concurrency). We will revisit if the Next.js app shows
  real traffic hot spots in production tracing. No k6 / Artillery in CI.
- **Browser compatibility matrix.** Playwright CI runs **Chromium only**.
  Firefox and WebKit are available in local dev (`pnpm test:e2e
  --project=firefox`) for one-off checks but are not required for merge.
  Internal users are standardised on Chrome.
- **Mobile viewports.** Not tested in CI. One manual pass per milestone
  on iPhone-13-sized viewport via Chrome devtools. The portal is
  explicitly a desktop operator tool; mobile is best-effort.
- **Accessibility audit automation.** No axe-core in CI for v2. We will
  manually run Lighthouse on the top 5 pages per milestone. Full a11y
  automation is a candidate for v2.1.
- **Dependency vulnerability scanning in test suite.** Handled by
  Dependabot + `pnpm audit` in a separate workflow, not the test
  pipeline.
- **PHP legacy app.** Not under test. We rely on manual smoke before
  cutover; the v2 rewrite is the test strategy.
- **Visual regression** (restated from §4). No.
- **End-to-end against real Jira / Jenkins / Thanos.** No live-upstream
  tests in CI. Contract tests (nightly) are the only thing that touches
  real APIs, and they are informational, not blocking.

---

Living document. Reviewed at the end of each milestone (M1–M5). If a
production incident bypasses the test suite, we open a `[test-gap]` issue
and either add a test or document explicitly why we chose not to.
