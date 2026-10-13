// som-portal-v2/src/ma/backoffice-client.ts
// ACM Backoffice (Admin Portal) client.
// Port of api/ma-status/_backoffice.php.
// Token management is server-side only; env vars provide credentials.

const BACKOFFICE_DEFAULT_GW = 'https://backoffice-gateway.truemoney.com';
const BASE_PATH = '/acm-backoffice-api-gateway/ops-service-maintenance-server';

function gatewayUrl(): string {
  return process.env.BACKOFFICE_GATEWAY_URL || BACKOFFICE_DEFAULT_GW;
}

export interface BackofficeResult {
  ok: boolean;
  code: number;
  data: unknown;
  error: string | null;
}

/**
 * Obtain an access token from the Keycloak password grant.
 * Matches v1's backofficeToken() — cached in memory for this request.
 */
let tokenCache: { token: string; exp: number } | null = null;

async function getToken(): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.exp - now > 60) return tokenCache.token;

  const user = process.env.BACKOFFICE_USERNAME;
  const pass = process.env.BACKOFFICE_PASSWORD;
  const clientId = process.env.BACKOFFICE_CLIENT_ID || 'backofficeui';
  const tokUrl =
    process.env.BACKOFFICE_TOKEN_URL ||
    'https://api-backoffice-aaa.truemoney.com/auth/realms/backoffice/protocol/openid-connect/token';

  if (!user || !pass) return null;

  try {
    const form = new URLSearchParams({
      grant_type: 'password',
      client_id: clientId,
      username: user,
      password: pass,
    });
    const res = await fetch(tokUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!d.access_token) return null;
    tokenCache = {
      token: d.access_token,
      exp: now + (d.expires_in ?? 900),
    };
    return d.access_token;
  } catch {
    return null;
  }
}

/** Generic authenticated call to the backoffice gateway. */
export async function backofficeCall(
  method: string,
  path: string,
  body?: unknown,
  timeoutMs = 15_000,
): Promise<BackofficeResult> {
  const token = await getToken();
  if (!token) {
    return { ok: false, code: 0, data: null, error: 'No backoffice token' };
  }

  const url = gatewayUrl() + path;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
  const init: RequestInit = {
    method: method.toUpperCase(),
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  try {
    const res = await fetch(url, init);
    const raw = await res.text();
    const data = raw ? JSON.parse(raw) : null;
    if (!res.ok) {
      const msg =
        (data as Record<string, unknown>)?.message ??
        (data as Record<string, unknown>)?.error ??
        `HTTP ${res.status}`;
      return { ok: false, code: res.status, data, error: String(msg) };
    }
    return { ok: true, code: res.status, data, error: null };
  } catch (e) {
    return { ok: false, code: 0, data: null, error: String(e) };
  }
}

/** Fetch use-case list from backoffice search endpoint. */
export async function listUseCases(): Promise<BackofficeResult> {
  return backofficeCall('GET', `${BASE_PATH}/config/use-cases/search?pageSize=500`);
}

/** Fetch a single use case by ID. */
export async function getUseCase(useCaseId: number): Promise<{
  ok: boolean;
  useCase: Record<string, unknown> | null;
  error?: string;
}> {
  const res = await listUseCases();
  if (!res.ok) return { ok: false, useCase: null, error: res.error ?? 'Search failed' };
  const content = ((res.data as Record<string, unknown>)?.content ?? []) as Record<string, unknown>[];
  const uc = content.find((r) => Number(r.use_case_id) === useCaseId) ?? null;
  if (!uc) return { ok: false, useCase: null, error: `use_case_id=${useCaseId} not found` };
  return { ok: true, useCase: uc };
}

/** Toggle MA enable/disable on a use case. Port of backoffice-toggle.php PUT logic. */
export async function toggleUseCase(
  useCaseId: number,
  enable: boolean,
  updatedBy: string,
): Promise<BackofficeResult> {
  // Fetch current state
  const { ok, useCase, error } = await getUseCase(useCaseId);
  if (!ok || !useCase) {
    return { ok: false, code: 404, data: null, error: error ?? 'Use case not found' };
  }

  // Extract property IDs from nested arrays (v1 parity)
  const extractIds = (arr: unknown[]): number[] =>
    arr
      .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
      .map((p) => Number(p.property_id))
      .filter((n) => n > 0);

  const writeBody = {
    useCaseName: String(useCase.use_case_name ?? ''),
    useCaseType: String(useCase.use_case_type ?? 'use_case'),
    maEnable: enable,
    maMessageTh: String(useCase.ma_message_th ?? useCase.maMessageTh ?? ''),
    maMessageEn: String(useCase.ma_message_en ?? useCase.maMessageEn ?? ''),
    updatedBy,
    maEnablePropertyIds: extractIds((useCase.ma_enable_properties ?? []) as unknown[]),
    maMessageThPropertyIds: extractIds((useCase.ma_message_th_properties ?? []) as unknown[]),
    maMessageEnPropertyIds: extractIds((useCase.ma_message_en_properties ?? []) as unknown[]),
  };

  return backofficeCall(
    'PUT',
    `${BASE_PATH}/config/use-cases/${useCaseId}`,
    writeBody,
    20_000,
  );
}
