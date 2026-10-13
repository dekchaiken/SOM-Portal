// som-portal-v2/src/service-performance/thanos-client.ts
//
// HTTP client for Grafana's Thanos datasource proxy. Port of v1's
// spQueryPromQL/_lib.php:183-253. Keeps tokens server-side — never exposed.

import type { PromQLQuery } from './promql';
import {
  hostCooldownActive,
  hostCooldownMark,
  hostFromUrl,
  shouldTrip,
} from '@/jenkins/cooldown';

export interface ThanosSource {
  grafanaUrl: string;
  dsUid: string;
  orgId: number;
  auth: { kind: 'basic'; user: string; pass: string } | { kind: 'token'; token: string };
}

export interface PromVector {
  metric: Record<string, string>;
  value: [number, string];
}

export interface PromMatrix {
  metric: Record<string, string>;
  values: Array<[number, string]>;
}

export interface PromResult<T = unknown> {
  status: 'success' | 'error';
  data?: { resultType: 'vector' | 'matrix' | 'scalar' | 'string'; result: T };
  errorType?: string;
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 25_000;
const MAX_RETRIES = 1;

export class ThanosClient {
  private readonly host: string;

  constructor(
    private readonly src: ThanosSource,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {
    this.host = hostFromUrl(src.grafanaUrl);
  }

  /** Instant query — POST /api/v1/query. */
  async instant<T = PromVector[]>(
    query: PromQLQuery,
    atUnixSec?: number,
  ): Promise<PromResult<T>> {
    const body = new URLSearchParams({
      query,
      time: String(atUnixSec ?? Math.floor(Date.now() / 1000)),
    });
    return this.post<T>('query', body);
  }

  /** Range query — POST /api/v1/query_range. */
  async range<T = PromMatrix[]>(
    query: PromQLQuery,
    startSec: number,
    endSec: number,
    stepSec: number,
  ): Promise<PromResult<T>> {
    const body = new URLSearchParams({
      query,
      start: String(startSec),
      end: String(endSec),
      step: String(stepSec),
    });
    return this.post<T>('query_range', body);
  }

  /** Fire multiple instant queries in parallel (mirrors v1 curl_multi). */
  async instantBatch(
    queries: Record<string, PromQLQuery>,
  ): Promise<Record<string, PromVector[]>> {
    const entries = Object.entries(queries);
    const results = await Promise.all(
      entries.map(async ([key, q]) => {
        try {
          const res = await this.instant<PromVector[]>(q);
          return [key, res.status === 'success' && res.data ? res.data.result : []] as const;
        } catch {
          return [key, []] as const;
        }
      }),
    );
    return Object.fromEntries(results);
  }

  private async post<T>(
    path: 'query' | 'query_range',
    body: URLSearchParams,
    attempt = 0,
  ): Promise<PromResult<T>> {
    // Circuit breaker check
    const cooldown = await hostCooldownActive(this.host);
    if (cooldown) {
      return {
        status: 'error',
        error: `Host in cooldown: ${cooldown.reason}`,
        errorType: 'cooldown',
      };
    }

    const url = `${this.src.grafanaUrl.replace(/\/$/, '')}/api/datasources/proxy/uid/${encodeURIComponent(this.src.dsUid)}/api/v1/${path}`;
    const auth =
      this.src.auth.kind === 'basic'
        ? 'Basic ' + Buffer.from(`${this.src.auth.user}:${this.src.auth.pass}`).toString('base64')
        : 'Bearer ' + this.src.auth.token;

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: auth,
          'X-Grafana-Org-Id': String(this.src.orgId),
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body,
        signal: ctl.signal,
      });

      if (shouldTrip(res.status, '')) {
        await hostCooldownMark(this.host, `HTTP ${res.status}`);
        // 1 retry on 5xx
        if (attempt < MAX_RETRIES) {
          return this.post<T>(path, body, attempt + 1);
        }
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { status: 'error', error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
      }

      return (await res.json()) as PromResult<T>;
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      if (!reason.includes('cooldown')) {
        await hostCooldownMark(this.host, reason.slice(0, 200));
      }
      if (attempt < MAX_RETRIES) {
        return this.post<T>(path, body, attempt + 1);
      }
      return { status: 'error', error: reason };
    } finally {
      clearTimeout(timer);
    }
  }
}
