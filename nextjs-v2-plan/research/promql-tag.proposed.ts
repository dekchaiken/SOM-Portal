/**
 * R-02 · `promql` tagged template + ThanosClient skeleton (SKETCH)
 *
 * Not wired in yet — this file lives in nextjs-v2-plan/ for review.
 * See promql-tag.md for the "why". Vitest cases at the bottom cover
 * the headline escape bug (`\.` vs `\\.`) and the `-` must-not-escape
 * gotcha so a future refactor can't silently regress them.
 */

// ─── Branded output type ────────────────────────────────────────────────────
export type PromQLQuery = string & { readonly __promql: unique symbol };

// ─── Interpolation markers ──────────────────────────────────────────────────
// Only values wrapped in str()/re()/raw() are allowed inside `${…}`.
type Interp =
  | { kind: 'str'; value: string }
  | { kind: 're';  value: string }
  | { kind: 'raw'; value: string };

export const str = (value: string): Interp => ({ kind: 'str', value });
export const re  = (value: string): Interp => ({ kind: 're',  value });
export const raw = (value: string | number): Interp => ({ kind: 'raw', value: String(value) });

// ─── Escape primitives ──────────────────────────────────────────────────────

/** Escape a value for a PromQL string literal (equality matcher).
 *  Only `\` and `"` are special inside `"…"`. */
export function escapeMatcher(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Escape a value for use INSIDE a PromQL regex matcher (`=~"…"`).
 *  Two layers:
 *    1. RE2 metachars → `\x`                 (NOT `-` — G2)
 *    2. PromQL string escaping over the result (every `\` doubled, `"` escaped)
 *       …so a literal `.` goes out as `\\.` on the wire (G1). */
export function escapeRegex(s: string): string {
  // Layer 1: RE2 metachars. Deliberately omits `-` (literal outside []).
  // Deliberately omits `/` (preg_quote would escape it; Thanos rejects).
  const re2 = s.replace(/[.\\+*?\[\]()|^$\{\}]/g, '\\$&');
  // Layer 2: PromQL string literal escapes.
  return re2.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

const RAW_LABEL_RE    = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
const RAW_DURATION_RE = /^[0-9]+(ms|s|m|h|d|w)$/;
const RAW_NUMBER_RE   = /^-?[0-9]+(\.[0-9]+)?$/;

/** Validate that a raw-interpolated value is a label name, duration, or
 *  plain number. Rejects anything that could inject structure. */
export function validateRaw(v: string): string {
  if (RAW_LABEL_RE.test(v))    return v;
  if (RAW_DURATION_RE.test(v)) return v;
  if (RAW_NUMBER_RE.test(v))   return v;
  throw new Error(`promql: raw(${JSON.stringify(v)}) is not a safe label/duration/number`);
}

// ─── Tagged template ────────────────────────────────────────────────────────
export function promql(strings: TemplateStringsArray, ...values: unknown[]): PromQLQuery {
  const parts: string[] = [];
  for (let i = 0; i < strings.length; i++) {
    parts.push(strings[i]);
    if (i >= values.length) continue;
    const v = values[i];
    if (v == null || typeof v !== 'object' || !('kind' in (v as object))) {
      throw new Error(
        `promql: bare interpolation at slot ${i}; wrap values in str()/re()/raw()`
      );
    }
    const slot = v as Interp;
    switch (slot.kind) {
      case 'str': parts.push(`"${escapeMatcher(slot.value)}"`); break;
      case 're':  parts.push(`"${escapeRegex(slot.value)}"`); break;
      case 'raw': parts.push(validateRaw(slot.value)); break;
    }
  }
  // Collapse multi-line templates to one line + trim — makes URL-encoded
  // query bodies smaller and matches what Grafana ships.
  return parts.join('').replace(/\s+/g, ' ').trim() as PromQLQuery;
}

// ─── ThanosClient skeleton ──────────────────────────────────────────────────
export interface ThanosSource {
  grafanaUrl: string;     // e.g. "https://grafana.example"
  dsUid: string;          // Grafana datasource UID
  orgId: number;
  auth: { kind: 'basic'; user: string; pass: string }
       | { kind: 'token'; token: string };
}

export interface PromResult<T = unknown> {
  status: 'success' | 'error';
  data?: { resultType: 'vector' | 'matrix' | 'scalar' | 'string'; result: T };
  errorType?: string;
  error?: string;
}

export class ThanosClient {
  constructor(private readonly src: ThanosSource, private readonly timeoutMs = 15_000) {}

  async instant<T = unknown>(q: PromQLQuery, atUnixSec?: number): Promise<PromResult<T>> {
    const body = new URLSearchParams({ query: q, time: String(atUnixSec ?? Math.floor(Date.now() / 1000)) });
    return this.post<T>('query', body);
  }

  async range<T = unknown>(q: PromQLQuery, startSec: number, endSec: number, stepSec: number): Promise<PromResult<T>> {
    const body = new URLSearchParams({
      query: q, start: String(startSec), end: String(endSec), step: String(stepSec),
    });
    return this.post<T>('query_range', body);
  }

  private async post<T>(path: 'query' | 'query_range', body: URLSearchParams): Promise<PromResult<T>> {
    const url = `${this.src.grafanaUrl.replace(/\/$/, '')}/api/datasources/proxy/uid/${encodeURIComponent(this.src.dsUid)}/api/v1/${path}`;
    const auth = this.src.auth.kind === 'basic'
      ? 'Basic ' + Buffer.from(`${this.src.auth.user}:${this.src.auth.pass}`).toString('base64')
      : 'Bearer ' + this.src.auth.token;

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': auth,
          'X-Grafana-Org-Id': String(this.src.orgId),
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body,
        signal: ctl.signal,
      });
      // Keep raw Prometheus shape — callers walk resultType themselves.
      return (await res.json()) as PromResult<T>;
    } finally {
      clearTimeout(timer);
    }
  }
}

// ─── Vitest tests (import.meta.vitest; also runnable as a plain file) ───────
// @ts-ignore — vitest's `import.meta.vitest` is injected by its vite plugin.
if (import.meta.vitest) {
  // @ts-ignore
  const { it, expect, describe } = import.meta.vitest;

  describe('escapeMatcher (equality `=`)', () => {
    it('passes dots and hyphens through unchanged', () => {
      // dots are literal inside a string matcher — no escaping needed.
      expect(escapeMatcher('acm-authorization.ascendmoney.io'))
        .toBe('acm-authorization.ascendmoney.io');
    });
    it('escapes backslash and double quote only', () => {
      expect(escapeMatcher('a\\b"c')).toBe('a\\\\b\\"c');
    });
  });

  describe('escapeRegex (regex `=~`)', () => {
    it('emits `\\\\.` on the wire for a literal dot (G1 — the headline bug)', () => {
      // We test the STRING we would send. One `.` in → `\\.` out (4 chars:
      // backslash, backslash, dot — JS source `'\\\\.'`).
      expect(escapeRegex('foo.bar')).toBe('foo\\\\.bar');
    });
    it('does NOT escape hyphens (G2 — would silently return [])', () => {
      expect(escapeRegex('acm-kyc')).toBe('acm-kyc');
    });
    it('escapes other RE2 metachars + PromQL-escapes the backslashes', () => {
      // `+` → `\+` → PromQL `\\+`
      expect(escapeRegex('a+b')).toBe('a\\\\+b');
      // `|` → `\|` → PromQL `\\|`
      expect(escapeRegex('a|b')).toBe('a\\\\|b');
    });
  });

  describe('promql tagged template', () => {
    it('builds the known-good restart-analyzer query', () => {
      const svc = 'acm-kyc';
      const q = promql`sum(increase(kube_pod_container_status_restarts_total{pod=~${re(svc + '.*')}}[${raw('5m')}]))`;
      expect(q).toBe(
        'sum(increase(kube_pod_container_status_restarts_total{pod=~"acm-kyc.*"}[5m]))'
      );
    });
    it('anchored service pattern emits `\\\\.` for the subdomain dot', () => {
      const svc = 'mobile-auth';
      const pat = `^${svc}$|^${svc}\\..*`;
      // Caller composes the regex THEN hands it to re(); re() must preserve
      // the already-literal dot and emit `\\.` on the wire.
      const q = promql`http_client_requests_seconds_count{client_name=~${re(pat)}}`;
      // Expected wire form: ...client_name="^mobile-auth$|^mobile-auth\\..*"
      expect(q).toBe(
        'http_client_requests_seconds_count{client_name="^mobile-auth$|^mobile-auth\\\\..*"}'
      );
    });
    it('rejects bare string interpolation', () => {
      // @ts-expect-error — intentional runtime check
      expect(() => promql`pod=${'foo'}`).toThrow(/wrap values/);
    });
    it('raw() rejects anything that could inject structure', () => {
      expect(() => promql`sum(x[${raw('5m")} + evil(')}])`).toThrow(/not a safe/);
      // But accepts valid labels + durations:
      expect(promql`sum by (${raw('pod')}) (x[${raw('30s')}])`)
        .toBe('sum by (pod) (x[30s])');
    });
  });
}
