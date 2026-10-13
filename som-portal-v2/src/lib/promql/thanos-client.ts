// src/lib/promql/thanos-client.ts
// Minimal ThanosClient — queries Prometheus via Grafana datasource proxy.
// Shared between restart-monitor, restart-analyzer, and service-performance (P2-A).

import type { PromQLQuery } from './index';

export interface ThanosSource {
  grafanaUrl: string;
  dsUid: string;
  orgId: string | number;
  token: string;
}

export interface PromResult {
  metric: Record<string, string>;
  value: [number, string]; // [timestamp, value]
}

export interface PromRangeResult {
  metric: Record<string, string>;
  values: [number, string][]; // [[ts, val], ...]
}

export interface PromResponse<T> {
  status: string;
  data: {
    resultType: string;
    result: T[];
  };
}

export class ThanosClient {
  private readonly src: ThanosSource;
  private readonly timeoutMs: number;

  constructor(src: ThanosSource, opts?: { timeoutMs?: number }) {
    this.src = src;
    this.timeoutMs = opts?.timeoutMs ?? 30_000;
  }

  /** Instant query at a specific unix timestamp (or now). */
  async instant(
    query: PromQLQuery | string,
    atUnixSec?: number,
  ): Promise<PromResult[]> {
    const params = new URLSearchParams({ query });
    if (atUnixSec) params.set('time', String(atUnixSec));

    const url = `${this.src.grafanaUrl}/api/datasources/proxy/uid/${this.src.dsUid}/api/v1/query`;
    const res = await this.doFetch(url, params);
    return (res?.data?.result ?? []) as PromResult[];
  }

  /** Range query. */
  async range(
    query: PromQLQuery | string,
    startUnix: number,
    endUnix: number,
    stepSec: number,
  ): Promise<PromRangeResult[]> {
    const params = new URLSearchParams({
      query,
      start: String(startUnix),
      end: String(endUnix),
      step: String(stepSec),
    });

    const url = `${this.src.grafanaUrl}/api/datasources/proxy/uid/${this.src.dsUid}/api/v1/query_range`;
    const res = await this.doFetch(url, params);
    return (res?.data?.result ?? []) as PromRangeResult[];
  }

  /** Batch instant queries (parallel). Returns results keyed by the input keys. */
  async instantBatch(
    queries: Record<string, PromQLQuery | string>,
    atUnixSec?: number,
  ): Promise<Record<string, PromResult[]>> {
    const entries = Object.entries(queries);
    const results = await Promise.all(
      entries.map(([, q]) => this.instant(q, atUnixSec).catch(() => [] as PromResult[])),
    );
    const out: Record<string, PromResult[]> = {};
    entries.forEach(([key], i) => {
      out[key] = results[i] ?? [];
    });
    return out;
  }

  /** Batch range queries (parallel). */
  async rangeBatch(
    queries: Record<string, PromQLQuery | string>,
    startUnix: number,
    endUnix: number,
    stepSec: number,
  ): Promise<Record<string, PromRangeResult[]>> {
    const entries = Object.entries(queries);
    const results = await Promise.all(
      entries.map(([, q]) =>
        this.range(q, startUnix, endUnix, stepSec).catch(() => [] as PromRangeResult[]),
      ),
    );
    const out: Record<string, PromRangeResult[]> = {};
    entries.forEach(([key], i) => {
      out[key] = results[i] ?? [];
    });
    return out;
  }

  // -------------------------------------------------------------------------
  private async doFetch(
    url: string,
    params: URLSearchParams,
  ): Promise<PromResponse<unknown> | null> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.src.token}`,
          'X-Grafana-Org-Id': String(this.src.orgId),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        console.error(`[ThanosClient] ${res.status} from ${url}`);
        return null;
      }
      const json = (await res.json()) as PromResponse<unknown>;
      if (json.status !== 'success') {
        console.error(`[ThanosClient] Prometheus error: ${JSON.stringify(json).slice(0, 200)}`);
        return null;
      }
      return json;
    } catch (e) {
      console.error(`[ThanosClient] fetch error: ${(e as Error).message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
