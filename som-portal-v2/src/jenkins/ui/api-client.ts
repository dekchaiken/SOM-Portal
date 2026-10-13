// som-portal-v2/src/jenkins/ui/api-client.ts
'use client';

// Thin browser-side wrapper over the /api/v1 routes. Everything returns the
// `Result<T>` envelope, so callers branch on `ok` rather than catching.
//
// Never fetch /data/*.json from the browser (feedback_no_raw_data_fetch) —
// jenkins_servers.json holds API tokens and data/.htaccess blocks it anyway.
import type { Result } from '@/lib/result';

const BASE = '/v2/api/v1';

async function call<T>(url: string, init?: RequestInit): Promise<Result<T>> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      cache: 'no-store',
      credentials: 'same-origin',
    });
    const body = (await res.json()) as Result<T>;
    if (body && typeof body === 'object' && 'ok' in body) return body;
    return { ok: false, error: `Unexpected response (HTTP ${res.status})` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
  }
}

export const jenkinsApi = {
  listServers: () => call<Array<{ id: string; display: string; base_url: string }>>(
    `${BASE}/jenkins-proxy?list=1`,
  ),
  read: <T>(serverId: string, path: string, opts: { tree?: string; depth?: number } = {}) => {
    const q = new URLSearchParams({ server: serverId, path });
    if (opts.tree) q.set('tree', opts.tree);
    if (opts.depth !== undefined) q.set('depth', String(opts.depth));
    return call<T>(`${BASE}/jenkins-proxy?${q.toString()}`);
  },
  build: (serverId: string, jobPath: string, params?: Record<string, string> | null) =>
    call<{ queued: true; queue_url: string | null; queue_id: number | null }>(
      `${BASE}/jenkins-proxy?action=build`,
      { method: 'POST', body: JSON.stringify({ server: serverId, path: jobPath, params }) },
    ),
};

export const adminServersApi = {
  list: () => call<unknown[]>(`${BASE}/jenkins-servers`),
  create: (body: unknown) =>
    call<unknown>(`${BASE}/jenkins-servers`, { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: unknown) =>
    call<null>(`${BASE}/jenkins-servers?id=${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  remove: (id: string) =>
    call<null>(`${BASE}/jenkins-servers?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

export const batchApi = {
  months: () => call<string[]>(`${BASE}/batch-records?action=months`),
  list: (month?: string | null) =>
    call<{
      month: string | null;
      records: unknown[];
      summaries: unknown[];
      can_backfill: boolean;
    }>(`${BASE}/batch-records?action=list${month ? `&month=${encodeURIComponent(month)}` : ''}`),
  coverage: (month?: string | null) =>
    call<unknown>(
      `${BASE}/batch-records?action=coverage${month ? `&month=${encodeURIComponent(month)}` : ''}`,
    ),
};

export const fileIndexApi = {
  search: (q: string) =>
    call<unknown>(`${BASE}/batch-file-index/search?q=${encodeURIComponent(q)}`),
};

export { BASE as API_V1_BASE };
