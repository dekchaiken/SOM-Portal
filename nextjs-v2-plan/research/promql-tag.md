# R-02 · Grafana Thanos PromQL quirks + `promql` tagged template

Research for the Next.js v2 Thanos client. All findings grounded in the v1
PHP proxies — nothing was executed against live Thanos for this doc.

## 1. Observed patterns in v1

### Call shape (reference)
- Transport: Grafana datasource proxy. All PromQL goes through
  `GET/POST {grafanaUrl}/api/datasources/proxy/uid/{dsUid}/api/v1/query`
  (and `.../query_range`). Auth is `Authorization: Basic|Bearer …` with
  `X-Grafana-Org-Id: {orgId}` (see `api/service-performance/_lib.php:183-253`).
  v2 keeps this proxy — tokens stay server-side.
- Parallelism: v1 fires many queries at once via `curl_multi`. v2 should do
  `Promise.all` on `fetch` with per-request timeout + overall budget.
- Config: `data/sm/grafana_sources.json` /
  `data/sm/grafana-alert-sources.json` hold `{ grafanaUrl, dsUid, orgId,
  authMode:"basic"|"token", token, slug, enabled }`. Multiple sources (one
  per k8s cluster / Thanos ring); detail.php picks the first enabled one
  that also has `jvmDsUid` for Spring Boot metrics.

### Where interpolation happens
Two selector shapes dominate — both built by string concat in PHP:

1. **Equality matcher** — a single pod/service literal:
   `container_memory_working_set_bytes{pod="{$podEsc}",container!="POD"}`
   (`api/restart-analyzer/pod-detail.php:51-55`). Here `$podEsc` must
   escape backslash and double-quote in the *string*, not regex.

2. **Regex matcher** — prefix / anchored / alternation:
   `kube_pod_container_status_restarts_total{pod=~"{$podRe}"}` with
   `$podRe = $svcEsc . '.*'` (`api/restart-analyzer/index.php:97`).
   Also the subtler service-anchored pattern:
   ```
   $clientPat = "^{$svcEsc}\$|^{$svcEsc}\\\\..*";  // ^svc$ | ^svc\..*
   $scgPat    = ".*//{$svcEsc}\\\\..*";
   ```
   (`api/service-performance/detail.php:977`, `dep-drill.php:85-88`).

The single `_spPromEscape()` helper (`_lib.php:382-388`) is the
canonical v1 escape:
```php
preg_replace('/([.\\\\+*?\[\]()|^$])/', '\\\\$1', $s);
```
i.e. escape `. \ + * ? [ ] ( ) | ^ $`. Note: **does NOT escape `-`**
on purpose — some older Thanos builds reject `\-`.

### Call sites to migrate
| v1 file | How it builds the query |
|---|---|
| `api/service-performance/_lib.php` | `_spPromEscape`, `spQueryPromQL`, `spQueryPromRange` |
| `api/service-performance/detail.php` | hpaPat (`preg_quote`!), clientPat/scgPat anchored |
| `api/service-performance/dep-drill.php` | clientPat/scgPat + `caller="X"` literal |
| `api/service-performance/subsystems.php`, `pods.php`, `deploys.php`, `suggestions.php` | `_spPromEscape` + pod/service prefix regex |
| `api/restart-analyzer/index.php` | `$podRe = $svcEsc . '.*'`, ~25 instant queries |
| `api/restart-analyzer/pod-detail.php` | equality (`pod="X"`) + namespace filter |

## 2. Gotchas (sharp edges we MUST re-encode in TS)

### G1 · PromQL string escapes ≠ RE2 escapes (the headline bug)
Thanos parses the label-matcher value as a **PromQL string literal first**,
then hands the unescaped result to RE2. Rules:
- A string literal only recognises `\\`, `\"`, `\n`, `\t`, `\r`, `\0`, `\xHH`,
  `\uHHHH`. **`\.` is an "unknown escape sequence"** and the whole query
  is rejected with status 400.
- To get a literal dot through to RE2, we must emit `\\.` **on the wire**:
  PromQL unescapes `\\` → `\`, RE2 sees `\.` = literal dot.
- In PHP double-quoted strings this becomes `"\\\\."` (4 backslashes). In
  JS/TS string literals it's `"\\\\."` as well (same count — JS also doubles).
  In a tagged template with raw processing (`String.raw`) you'd write
  `\\.` directly; without raw, `\\\\.`.
- Grafana's Explore UI accepts bare `\.` because it transforms the query
  before sending — direct API calls do not get this courtesy.

### G2 · `-` must NOT be escaped
Hyphen is literal outside `[...]`. `preg_quote()` (PHP) escapes it anyway
and some Thanos versions return `[]` silently. `_spPromEscape` deliberately
omits `-` from its char class — our TS `escapeRegex()` must too. See the
comment at `api/restart-monitor/_fetch_lib.php:259`.

### G3 · Equality matcher ≠ regex matcher
Different escape rules per matcher. For `pod="X"` we only need to escape
`\` and `"` (string literal). For `pod=~"X"` we need G1 + regex metachars.
Mixing these up is a common bug — `pod="svc.foo"` is a literal dot; no
escape needed. v2 API should force the caller to pick: `=` vs `=~`.

### G4 · PHP variable-parser noise
In v1 you see `\$` sprinkled in query strings (e.g. `"^{$svcEsc}\$"`) —
that's a PHP source-only artefact. On the wire it's a plain `$`
end-anchor. In TS this disappears entirely.

### G5 · `preg_quote` leaks
`detail.php:493` builds `$hpaPat = preg_quote($service, '/') . '|' . preg_quote($svcBase, '/');`
and feeds the result into a PromQL regex. `preg_quote` escapes `/` and `-`
which, as per G2, can silently zero out results. We should NOT replicate
this — all PromQL regex escapes must go through our single `escapeRegex()`.

### G6 · String-matcher values can contain `\` or `"`
Rare in service names but real for URIs (`uri=~".*/api/v1/.*"`). We MUST
escape `"` → `\"` and `\` → `\\` in both equality AND regex matcher values.

### G7 · Multi-source
`grafana_sources.json` has N enabled sources. v2 should take the source
object as an argument to the client factory, not globals.

### G8 · Timing and encoding
POST body is `application/x-www-form-urlencoded` with `query=…` and either
`time=<unix>` (instant) or `start=&end=&step=` (range). The `query` value
IS url-encoded by `URLSearchParams` / `http_build_query` — our tag MUST
return the raw PromQL string, not pre-encoded.

## 3. Tagged template design

### Shape
```ts
const q = promql`
  sum(rate(container_cpu_usage_seconds_total{
    pod=~${re(svc + '.*')},
    container!="POD"
  }[${duration('2m')}]))
`;
```

Rules:
- Every `${…}` interpolation MUST pass through a marker helper:
  - `str(value)` — equality literal, escapes `\` and `"`.
  - `re(value)` — regex pattern, escapes string-literal chars AND regex
    metachars.
  - `raw(value)` — numeric / enum (step, duration, label name). Only accepts
    `/^[a-zA-Z_:][a-zA-Z0-9_:]*$/` for labels and `/^[0-9]+(ms|s|m|h|d|w)$/`
    for durations. Rejects everything else so you can't smuggle `}` into
    the query via a "safe" slot.
- A bare `${string}` without a helper throws at build time — fail loud.
- Return type is an opaque `PromQLQuery` branded string so the ThanosClient
  signature can enforce `promql`-only input.

### Why not just a function?
A tagged template keeps the query readable (fits the shape metricians see
in Grafana) AND prevents the "I'll just concat here real quick" footgun
that caused the v1 `preg_quote` bug.

### `escapeMatcher()` (= matcher, string literal)
```
input   → output on wire
foo     → foo
foo"bar → foo\"bar
C:\x    → C:\\x
```

### `escapeRegex()` (=~ matcher, PromQL regex)
Two layers in one pass:
1. Regex metachars: `. \ + * ? [ ] ( ) | ^ $ { }` → prefixed with `\`.
   NOT `-` (G2). NOT `/`.
2. Then wrap in PromQL string escaping: every `\` doubled, every `"`
   backslashed. So a literal `.` becomes `\\.` on the wire (G1).

Order matters: regex-escape first, then PromQL-escape the whole blob —
that automatically turns `\.` into `\\.`.

### `ThanosClient` skeleton
- Constructor takes `{ grafanaUrl, dsUid, orgId, auth }`.
- `instant(query: PromQLQuery, atUnixSec?)` → POST /api/v1/query.
- `range(query: PromQLQuery, start, end, stepSec)` → POST /api/v1/query_range.
- Internal `fetch()` with AbortController timeout, 1 retry on 5xx with
  host-cooldown hook (see memory `project_host_cooldown_hardening`).
- Returns Prometheus's `{ status, data: { resultType, result } }` as-is;
  caller walks `result` by type. We don't flatten — too lossy for the
  "per-pod matrix" use case detail.php needs.

## 4. Open questions

1. **Multi-cluster fan-out.** v1 picks one source per request. v2 may want
   to fan out across clusters and merge — if yes, do we merge in the
   client or expose per-source results? Current call sites assume one
   cluster, so recommend "one source per client instance, caller merges".
2. **Duration validation strictness.** `[2m]` is pervasive. If we only
   allow `/^[0-9]+(ms|s|m|h|d|w)$/`, we exclude `[1h30m]` compound
   durations (PromQL supports those). Decide now whether to parse or
   just regex.
3. **`caller="X"` style literal substitution inside `{…}` lists.** v1
   dep-drill builds `$callerSel = "app_name=\"{$caller}\""` then
   interpolates it as a raw fragment inside another `{…}` block. Our
   `raw()` helper intentionally rejects anything that isn't a bare label
   name — do we need a `matcher()` helper that composes a whole
   `label="value"` fragment safely, or force callers to always build the
   full `{…}` list in one template?
4. **`host-cooldown` integration point.** Memory notes a generic upstream
   circuit breaker lives in v1 helpers. In v2 that's probably a Next.js
   route-handler-level middleware around the fetch — out of scope for
   this ticket but worth flagging the hook point in `ThanosClient.fetch`.
5. **Timezone handling.** `time=` is unix seconds, no TZ ambiguity. But
   the "range" picker in the UI (last 1h / 6h / 24h) lives in client
   time. Any absolute window must round-trip through unix. Not a bug,
   just a nag for the UI layer.
