// som-portal-v2/src/jenkins/client.ts
//
// Per-server authenticated Jenkins client. Port of api/jenkins_helpers.php
// (jenkinsServers / jenkinsRequest / jenkinsRequestFull / jenkinsCrumbHeader)
// plus the validation + error mapping from api/jenkins-proxy/index.php.
//
// Auth (per JENKINS-AUTH-FIX.md + data/<team>/jenkins_servers.json):
//   auth_mode 'token'  → Authorization: Basic base64(auth_user:auth_token)
//   auth_mode 'cookie' → Cookie: <auth_cookie>
// Credentials are per-team and per-server; they never leave the server process.
//
// Every outbound call goes through the host-cooldown breaker first.
import {
  hostFromUrl,
  hostCooldownActive,
  hostCooldownMark,
  shouldTrip,
} from './cooldown';
import {
  JenkinsServersFileSchema,
  type JenkinsServer,
  type JenkinsServerListItem,
  parseJobRules,
} from './types';
import { readTeamFile, type Scope } from '@/team/scope';

export const JENKINS_SERVERS_FILE = 'jenkins_servers.json';

/** v1 cURL budget: CURLOPT_CONNECTTIMEOUT 4 / CURLOPT_TIMEOUT 12. */
export const JENKINS_TIMEOUT_MS = 12_000;
export const JENKINS_USER_AGENT = 'CentralizeSOM/1.0 Jenkins-Client';

export interface JenkinsResponse {
  body: string;
  code: number;
  err: string;
  headers: Record<string, string>;
}

// ─── Server registry (team-scoped) ───────────────────────────────────────────

/**
 * Every server row for the caller's team, credentials included, ordered by
 * `order` like v1's `usort`. Admin-only — callers must gate before calling.
 */
export async function allServers(scope?: Scope): Promise<JenkinsServer[]> {
  const rows = await readTeamFile(JENKINS_SERVERS_FILE, JenkinsServersFileSchema, scope);
  return [...(rows ?? [])].sort((a, b) => (a.order ?? 99) - (b.order ?? 99)) as JenkinsServer[];
}

/**
 * Enabled servers keyed by id — the exact contract of api/jenkins_config.php,
 * which every v1 Jenkins caller consumes. Disabled rows are invisible here, so
 * a disabled server can never be proxied to.
 */
export async function jenkinsServers(scope?: Scope): Promise<Record<string, JenkinsServer>> {
  const out: Record<string, JenkinsServer> = {};
  for (const s of await allServers(scope)) {
    if (!s.enabled) continue;
    out[s.id] = s;
  }
  return out;
}

export async function getServer(id: string, scope?: Scope): Promise<JenkinsServer | null> {
  return (await jenkinsServers(scope))[id] ?? null;
}

/** The scrubbed list v1 returns from `GET /api/jenkins-proxy?list=1`. */
export function toListItems(servers: Record<string, JenkinsServer>): JenkinsServerListItem[] {
  return Object.values(servers)
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
    .map((s) => ({
      id: s.id,
      display: s.display,
      base_url: s.base_url,
      job_rules: parseJobRules(s.job_rules),
    }));
}

// ─── Low-level request ───────────────────────────────────────────────────────

function authHeaders(server: JenkinsServer): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': JENKINS_USER_AGENT,
  };
  if (server.auth_mode === 'token' && server.auth_token) {
    const basic = Buffer.from(`${server.auth_user}:${server.auth_token}`).toString('base64');
    h.Authorization = `Basic ${basic}`;
  } else if (server.auth_mode === 'cookie' && server.auth_cookie) {
    h.Cookie = server.auth_cookie;
  }
  return h;
}

/**
 * Port of `jenkinsRequestFull()`. Never throws — transport failures come back
 * as `{ code: 0, err }` exactly like the cURL version, because callers map
 * codes to user-facing messages.
 *
 * `redirect: 'manual'` matches CURLOPT_FOLLOWLOCATION=false: a 201/302 from
 * buildWithParameters carries the queue-item URL in `Location`, which we need.
 */
export async function jenkinsRequestFull(
  server: JenkinsServer,
  url: string,
  method: 'GET' | 'POST' = 'GET',
  postBody?: string | null,
  extraHeaders: Record<string, string> = {},
): Promise<JenkinsResponse> {
  const host = hostFromUrl(url);
  const cd = await hostCooldownActive(host);
  if (cd) {
    return { body: '', code: 0, err: `host in cooldown: ${cd.reason}`, headers: {} };
  }

  const headers = { ...authHeaders(server), ...extraHeaders };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), JENKINS_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: method === 'POST' ? (postBody ?? '') : undefined,
      redirect: 'manual',
      signal: ac.signal,
      cache: 'no-store',
    });
    const body = await res.text();
    const outHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      outHeaders[k.toLowerCase()] = v;
    });
    if (shouldTrip(res.status, '')) {
      await hostCooldownMark(host, `HTTP ${res.status}`);
    }
    return { body, code: res.status, err: '', headers: outHeaders };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    await hostCooldownMark(host, err);
    return { body: '', code: 0, err, headers: {} };
  } finally {
    clearTimeout(timer);
  }
}

/** Body-only variant, matching `jenkinsRequest()`'s `[body, code, err]`. */
export async function jenkinsRequest(
  server: JenkinsServer,
  url: string,
  method: 'GET' | 'POST' = 'GET',
  postBody?: string | null,
  extraHeaders: Record<string, string> = {},
): Promise<[string, number, string]> {
  const r = await jenkinsRequestFull(server, url, method, postBody, extraHeaders);
  return [r.body, r.code, r.err];
}

/**
 * Fetch a CSRF crumb header, or '' when the server has crumbs disabled.
 * Port of `jenkinsCrumbHeader()` — a missing crumb is not an error.
 */
export async function crumbHeader(server: JenkinsServer): Promise<Record<string, string>> {
  const base = (server.base_url ?? '').replace(/\/+$/, '');
  if (!base) return {};
  const r = await jenkinsRequestFull(server, `${base}/crumbIssuer/api/json`);
  if (r.code !== 200) return {};
  try {
    const d = JSON.parse(r.body) as { crumbRequestField?: string; crumb?: string };
    if (!d.crumbRequestField || !d.crumb) return {};
    return { [d.crumbRequestField]: d.crumb };
  } catch {
    return {};
  }
}

// ─── Path validation (verbatim rules from api/jenkins-proxy/index.php) ───────

/** Read proxying is restricted to the read-only Jenkins JSON API. */
export function validateReadPath(rawPath: string): { path: string } | { error: string; status: number } {
  const p = '/' + String(rawPath ?? '/api/json').trim().replace(/^\/+/, '');
  if (!p.endsWith('/api/json')) {
    return { error: 'Only /api/json paths are allowed', status: 403 };
  }
  if (/\.\.|[<>"'\s]/.test(p)) {
    return { error: 'Invalid path characters', status: 400 };
  }
  return { path: p };
}

const JOB_PATH_RE = /^(\/job\/[A-Za-z0-9_.%+-]+)+$/;

/** A build target must be nothing but `/job/<safe-name>` segments. */
export function isValidJobPath(jobPath: string): boolean {
  return !!jobPath && JOB_PATH_RE.test(jobPath);
}

// ─── High-level operations ───────────────────────────────────────────────────

export interface ProxyError {
  error: string;
  status: number;
}

/** v1's httpCode → message table, shared by the read and build paths. */
function mapFailure(code: number, err: string, notFound: string): ProxyError | null {
  if (err) return { error: `Cannot reach Jenkins: ${err}`, status: 502 };
  if (code === 401) {
    return {
      error: 'Jenkins rejected credentials — token may be invalid or expired',
      status: 422,
    };
  }
  if (code === 403) {
    return { error: 'Jenkins access denied — cookie/session may have expired', status: 422 };
  }
  if (code === 404) return { error: notFound, status: 404 };
  return null;
}

/**
 * Proxy a read against `/…/api/json`. Mirrors v1 including the "invalid JSON —
 * may be a login redirect page" case, which is what a stale cookie looks like.
 */
export async function proxyRead(
  server: JenkinsServer,
  rawPath: string,
  query: { tree?: string; depth?: number } = {},
): Promise<{ data: unknown } | ProxyError> {
  const v = validateReadPath(rawPath);
  if ('error' in v) return v;

  const qp = new URLSearchParams();
  if (query.tree) qp.set('tree', query.tree);
  if (query.depth !== undefined && Number.isFinite(query.depth)) {
    qp.set('depth', String(Math.trunc(query.depth)));
  }
  const qs = qp.toString() ? `?${qp.toString()}` : '';
  const url = `${(server.base_url ?? '').replace(/\/+$/, '')}${v.path}${qs}`;

  const r = await jenkinsRequestFull(server, url);
  const failure = mapFailure(r.code, r.err, 'Jenkins path not found (404)');
  if (failure) return failure;
  if (r.code !== 200) return { error: `Jenkins returned HTTP ${r.code}`, status: 502 };

  try {
    return { data: JSON.parse(r.body) };
  } catch {
    return {
      error: 'Jenkins returned invalid JSON — may be a login redirect page',
      status: 502,
    };
  }
}

export interface BuildTriggerResult {
  queued: true;
  /** Queue-item URL from the `Location` header, when Jenkins supplies one. */
  queue_url: string | null;
  queue_id: number | null;
  code: number;
}

/**
 * Trigger a build. Parameterized jobs go to /buildWithParameters with a
 * urlencoded body; plain jobs to /build. Jenkins answers 201 (or 200/302).
 */
export async function triggerBuild(
  server: JenkinsServer,
  jobPath: string,
  params?: Record<string, string> | null,
): Promise<BuildTriggerResult | ProxyError> {
  if (!isValidJobPath(jobPath)) return { error: 'Invalid job path', status: 400 };

  const base = (server.base_url ?? '').replace(/\/+$/, '');
  const hasParams = !!params && Object.keys(params).length > 0;

  const headers = await crumbHeader(server);
  let postBody = '';
  if (hasParams) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    const form = new URLSearchParams();
    for (const [k, val] of Object.entries(params)) form.set(k, String(val ?? ''));
    postBody = form.toString();
  }

  const buildUrl = `${base}${jobPath}${hasParams ? '/buildWithParameters' : '/build'}`;
  const r = await jenkinsRequestFull(server, buildUrl, 'POST', postBody, headers);

  if (r.err) return { error: `Cannot reach Jenkins: ${r.err}`, status: 502 };
  if (r.code === 401) return { error: 'Jenkins rejected credentials — check token/cookie', status: 422 };
  if (r.code === 403) return { error: 'Access denied — insufficient Jenkins permissions', status: 422 };
  if (r.code === 404) return { error: 'Job not found', status: 404 };
  if (![200, 201, 302].includes(r.code)) {
    return { error: `Jenkins returned HTTP ${r.code}`, status: 502 };
  }

  const loc = r.headers['location'] ?? null;
  const m = loc ? /\/queue\/item\/(\d+)\/?$/.exec(loc) : null;
  return {
    queued: true,
    queue_url: loc,
    queue_id: m ? Number(m[1]) : null,
    code: r.code,
  };
}
