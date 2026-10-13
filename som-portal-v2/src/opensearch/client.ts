// som-portal-v2/src/opensearch/client.ts
// OpenSearchClient — basic auth mode + Dashboards mode, session cookie cache.
import type { Endpoint } from './schema';
import type { DecryptedCreds } from './creds';
import { loadSessionCookie, saveSessionCookie, clearSessionCookie } from './sessions';

interface SearchResult {
  data: Record<string, unknown>;
  code: number;
}

/**
 * OpenSearch client that supports both basic auth and Dashboards proxy modes.
 */
export class OpenSearchClient {
  constructor(
    private readonly endpoint: Endpoint,
    private readonly creds: DecryptedCreds,
    private readonly userId: string,
  ) {}

  private get sessionCacheKey(): string {
    return `${this.endpoint.id}:${this.userId}`;
  }

  /**
   * Execute a search DSL against the endpoint.
   */
  async search(indexPattern: string, dsl: Record<string, unknown>): Promise<SearchResult> {
    const mode = this.endpoint.auth_mode ?? 'basic';
    if (mode === 'dashboards') {
      return this.dashboardsSearch(indexPattern, dsl);
    }
    return this.basicSearch(indexPattern, dsl);
  }

  /**
   * Test credentials against the endpoint.
   */
  async testConnection(): Promise<{ ok: boolean; latencyMs: number; error?: string; mode: string }> {
    const mode = this.endpoint.auth_mode ?? 'basic';
    const t0 = Date.now();
    try {
      if (mode === 'dashboards') {
        const result = await this.dashboardsLogin();
        const ms = Date.now() - t0;
        if (!result.ok) return { ok: false, latencyMs: ms, error: result.error, mode };
        return { ok: true, latencyMs: ms, mode };
      }
      // Basic mode: probe /_cluster/health
      const baseUrl = this.endpoint.base_url.replace(/\/+$/, '');
      const auth = Buffer.from(`${this.creds.username}:${this.creds.password}`).toString('base64');
      const res = await fetch(`${baseUrl}/_cluster/health`, {
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(10_000),
      });
      const ms = Date.now() - t0;
      if (res.status === 401) return { ok: false, latencyMs: ms, error: 'Invalid username or password', mode };
      if (res.status === 403) return { ok: false, latencyMs: ms, error: 'Access denied', mode };
      if (!res.ok) return { ok: false, latencyMs: ms, error: `HTTP ${res.status}`, mode };
      const body = await res.text();
      if (body.trimStart().startsWith('<')) {
        return { ok: false, latencyMs: ms, error: 'Got HTML instead of JSON -- check Base URL', mode };
      }
      return { ok: true, latencyMs: ms, mode };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - t0, error: String(e), mode };
    }
  }

  // ─── Basic auth mode ────────────────────────────────────────────────────

  private async basicSearch(indexPattern: string, dsl: Record<string, unknown>): Promise<SearchResult> {
    const baseUrl = this.endpoint.base_url.replace(/\/+$/, '');
    const auth = Buffer.from(`${this.creds.username}:${this.creds.password}`).toString('base64');
    const url = `${baseUrl}/${encodeURIComponent(indexPattern)}/_search`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(dsl),
      signal: AbortSignal.timeout(45_000),
    });

    const text = await res.text();
    if (text.trimStart().startsWith('<')) {
      throw new Error('OpenSearch returned HTML instead of JSON');
    }
    const data = JSON.parse(text);
    return { data, code: res.status };
  }

  // ─── Dashboards proxy mode ──────────────────────────────────────────────

  private async dashboardsLogin(): Promise<{ ok: boolean; cookie?: string; error?: string }> {
    const baseUrl = this.endpoint.base_url.replace(/\/+$/, '');
    const osdVer = this.endpoint.osd_version ?? '2.7.0';

    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: '*/*',
        'osd-xsrf': 'true',
        'osd-version': osdVer,
      },
      body: JSON.stringify({ username: this.creds.username, password: this.creds.password }),
      signal: AbortSignal.timeout(15_000),
      redirect: 'manual',
    });

    if (res.status === 401) return { ok: false, error: 'Invalid Dashboards credentials' };
    if (res.status < 200 || res.status >= 300) return { ok: false, error: `Login HTTP ${res.status}` };

    // Extract Set-Cookie headers
    const cookies: string[] = [];
    const setCookieHeader = res.headers.get('set-cookie');
    if (setCookieHeader) {
      for (const part of setCookieHeader.split(/,(?=[^;]*=)/)) {
        const m = part.match(/^([^;]+)/);
        if (m) cookies.push(m[1].trim());
      }
    }
    if (cookies.length === 0) return { ok: false, error: 'Login returned no cookies' };

    const cookieHeader = cookies.join('; ');
    await saveSessionCookie(this.endpoint.id, this.userId, cookieHeader);
    return { ok: true, cookie: cookieHeader };
  }

  private async dashboardsSearch(
    indexPattern: string,
    dsl: Record<string, unknown>,
    retry = true,
  ): Promise<SearchResult> {
    // Try cached cookie first
    let cookie = await loadSessionCookie(this.endpoint.id, this.userId);
    if (!cookie) {
      const login = await this.dashboardsLogin();
      if (!login.ok) throw new Error(login.error ?? 'Dashboards login failed');
      cookie = login.cookie!;
    }

    const baseUrl = this.endpoint.base_url.replace(/\/+$/, '');
    const osdVer = this.endpoint.osd_version ?? '2.7.0';

    const payload = {
      params: {
        index: indexPattern,
        body: dsl,
        preference: Date.now(),
      },
    };

    const res = await fetch(`${baseUrl}/internal/search/opensearch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: '*/*',
        'osd-xsrf': 'osd-fetch',
        'osd-version': osdVer,
        Cookie: cookie,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(45_000),
    });

    // 401 = session expired; retry once with fresh login
    if (res.status === 401 && retry) {
      await clearSessionCookie(this.endpoint.id, this.userId);
      return this.dashboardsSearch(indexPattern, dsl, false);
    }

    const text = await res.text();
    if (text.trimStart().startsWith('<')) {
      throw new Error('Dashboards returned HTML instead of JSON');
    }
    const data = JSON.parse(text);
    // Dashboards wraps in rawResponse
    const resolved = data.rawResponse ?? data;
    return { data: resolved, code: res.status };
  }
}
