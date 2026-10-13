// som-portal-v2/src/incident-launcher/backoffice-bridge.ts
// BO config peek + update — port of api/incident-launcher bo_config_peek / bo_config_update.

import { AppError } from "@/lib/errors";

const BO_GATEWAY = process.env.BACKOFFICE_GATEWAY_URL || "https://backoffice-gateway.truemoney.com";
const BO_TOKEN_URL =
  process.env.BACKOFFICE_TOKEN_URL ||
  "https://api-backoffice-aaa.truemoney.com/auth/realms/backoffice/protocol/openid-connect/token";
const TIMEOUT_MS = 15_000;

// Simple in-memory token cache
let cachedToken: { token: string; exp: number } | null = null;

async function getToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - now > 60) return cachedToken.token;

  const user = process.env.BACKOFFICE_USERNAME ?? "";
  const pass = process.env.BACKOFFICE_PASSWORD ?? "";
  const clientId = process.env.BACKOFFICE_CLIENT_ID ?? "backofficeui";
  if (!user || !pass) {
    throw new AppError("Backoffice credentials not configured", "bo_not_configured", 503);
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10_000);
  try {
    const res = await fetch(BO_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "password",
        client_id: clientId,
        username: user,
        password: pass,
      }),
      signal: ctl.signal,
    });
    if (!res.ok) throw new AppError(`Backoffice auth failed: HTTP ${res.status}`, "bo_auth_error", 502);
    const d = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!d.access_token) throw new AppError("No access_token from Backoffice", "bo_auth_error", 502);
    cachedToken = { token: d.access_token, exp: now + (d.expires_in ?? 900) };
    return cachedToken.token;
  } finally {
    clearTimeout(timer);
  }
}

async function boFetch<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await getToken();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BO_GATEWAY}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: ctl.signal,
    });
    const text = await res.text();
    if (res.status >= 400) {
      throw new AppError(`Backoffice HTTP ${res.status}: ${text.slice(0, 400)}`, "bo_error", 502);
    }
    return text ? (JSON.parse(text) as T) : ({} as T);
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(`Backoffice connection failed: ${(e as Error).message}`, "bo_unreachable", 502);
  } finally {
    clearTimeout(timer);
  }
}

export interface BoProperty {
  application: string;
  key: string;
  value: string;
  property_group: string;
  property_id: number;
}

/** Peek at a specific BO config property. */
export async function boPeek(application: string, key: string): Promise<BoProperty> {
  const data = await boFetch<{
    data?: {
      contents?: {
        application_name?: string;
        properties?: {
          property_key?: string;
          property_value?: string;
          property_group?: string;
          property_id?: number;
        }[];
      }[];
    };
  }>("GET", "/acm-backoffice-api-gateway/ops-service-maintenance-server/application/list");

  for (const a of data.data?.contents ?? []) {
    if ((a.application_name ?? "").toLowerCase() !== application.toLowerCase()) continue;
    for (const p of a.properties ?? []) {
      if ((p.property_key ?? "").toLowerCase() !== key.toLowerCase()) continue;
      return {
        application: a.application_name ?? "",
        key: p.property_key ?? "",
        value: p.property_value ?? "",
        property_group: p.property_group ?? "",
        property_id: p.property_id ?? 0,
      };
    }
  }
  throw new AppError(`Not found: application="${application}" key="${key}"`, "bo_not_found", 404);
}

/** Update a BO config property value. */
export async function boUpdate(
  application: string,
  key: string,
  value: string,
  environment = "production",
  profile = "main",
  updatedBy = "som-portal",
): Promise<void> {
  // First fetch metadata (group, description, type)
  let group = "default";
  let desc = "";
  let type = "string";

  try {
    const listData = await boFetch<{
      data?: {
        contents?: {
          application_name?: string;
          properties?: {
            property_key?: string;
            property_group?: string;
            property_description?: string;
            property_type?: string;
          }[];
        }[];
      };
    }>("GET", "/acm-backoffice-api-gateway/ops-service-maintenance-server/application/list");

    for (const a of listData.data?.contents ?? []) {
      if ((a.application_name ?? "").toLowerCase() !== application.toLowerCase()) continue;
      for (const p of a.properties ?? []) {
        if ((p.property_key ?? "").toLowerCase() !== key.toLowerCase()) continue;
        group = p.property_group ?? "default";
        desc = p.property_description ?? "";
        type = p.property_type ?? "string";
        break;
      }
      break;
    }
  } catch {
    // If list fails, proceed with defaults
  }

  const putBody = {
    updated_by: updatedBy,
    source: {
      [key]: {
        value,
        description: desc,
        type: type || "string",
        group: group || "default",
      },
    },
  };

  const path = `/acm-backoffice-api-gateway/ops-service-maintenance-server/config/${encodeURIComponent(application)}/${encodeURIComponent(environment)}/${encodeURIComponent(profile)}`;
  await boFetch("PUT", path, putBody);
}

// Test-only reset
export function __resetBoTokenCache(): void {
  cachedToken = null;
}
