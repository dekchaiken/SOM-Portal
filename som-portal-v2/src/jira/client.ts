// som-portal-v2/src/jira/client.ts
//
// Thin fetch client for Jira Cloud REST v3. Basic auth from env
// (JIRA_EMAIL / JIRA_TOKEN) exactly like v1's jiraEmail()/jiraToken().
// JIRA_BASE_URL + JIRA_PROJECT_KEY are hardcoded in v1 api/config.php, so they
// are constants here too (overridable via env for tests/staging).

import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { JIRA_PROJECT_KEY } from "./fields";
import { JiraCreateResponseSchema, JiraFieldMetaSchema } from "./schemas";

export const JIRA_BASE_URL = process.env.JIRA_BASE_URL || "https://truemoney.atlassian.net";
export { JIRA_PROJECT_KEY };

const TIMEOUT_MS = 15_000;

export function jiraCredsReady(): boolean {
  const e = env();
  return Boolean(e.JIRA_EMAIL && e.JIRA_TOKEN);
}

function authHeader(): string {
  const e = env();
  return "Basic " + Buffer.from(`${e.JIRA_EMAIL}:${e.JIRA_TOKEN}`).toString("base64");
}

export interface JiraRaw<T> {
  status: number;
  body: T | null;
}

async function call<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<JiraRaw<T>> {
  if (!jiraCredsReady()) {
    throw new AppError("Jira not configured", "jira_not_configured", 503);
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${JIRA_BASE_URL}${path}`, {
      method: init.method ?? "GET",
      headers: {
        Authorization: authHeader(),
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      signal: ctl.signal,
      cache: "no-store",
    });
    let body: T | null = null;
    const text = await res.text();
    if (text) {
      try {
        body = JSON.parse(text) as T;
      } catch {
        body = null;
      }
    }
    return { status: res.status, body };
  } catch (e) {
    if (e instanceof AppError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new AppError(`Connection to Jira failed: ${msg}`, "jira_unreachable", 502);
  } finally {
    clearTimeout(timer);
  }
}

// ── Cache (10 min, per v2 brief) ────────────────────────────────────────────

interface CacheEntry<T> {
  at: number;
  value: T;
}
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, CacheEntry<unknown>>();

async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as T;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

export function __clearJiraCache(): void {
  cache.clear();
}

// ── Endpoints ──────────────────────────────────────────────────────────────

export interface JiraCustomFieldInfo {
  id: string;
  name: string;
  type: string;
}

/** Port of api/jira/fields.php — customfield_* only, sorted by name. */
export async function listCustomFields(): Promise<JiraCustomFieldInfo[]> {
  return cached("fields", async () => {
    const { status, body } = await call<unknown[]>("/rest/api/3/field");
    if (status !== 200) throw new AppError(`Jira API error: ${status}`, "jira_error", 502);
    const rows = Array.isArray(body) ? body : [];
    const out: JiraCustomFieldInfo[] = [];
    for (const raw of rows) {
      const p = JiraFieldMetaSchema.safeParse(raw);
      if (!p.success) continue; // soft-fail on drift
      if (!p.data.id.startsWith("customfield_")) continue;
      out.push({
        id: p.data.id,
        name: p.data.name,
        type: p.data.schema?.type || p.data.schema?.custom || "",
      });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  });
}

export interface JiraIssueType {
  id: string;
  name: string;
  iconUrl: string;
}

/** Port of api/jira/issue-types.php — createmeta → projects[0].issuetypes[]. */
export async function listIssueTypes(): Promise<JiraIssueType[]> {
  return cached("issue-types", async () => {
    const { status, body } = await call<{
      projects?: { issuetypes?: { id?: string; name?: string; iconUrl?: string }[] }[];
    }>(`/rest/api/3/issue/createmeta?projectKeys=${encodeURIComponent(JIRA_PROJECT_KEY)}`);
    if (status !== 200) throw new AppError(`Jira API error: ${status}`, "jira_error", 502);
    const its = body?.projects?.[0]?.issuetypes ?? [];
    return its.map((it) => ({
      id: it.id ?? "",
      name: it.name ?? "",
      iconUrl: it.iconUrl ?? "",
    }));
  });
}

/**
 * Port of api/jira/field-options.php — createmeta allowedValues first, then the
 * /field/{id}/context + /context/{ctxId}/option fallback.
 */
export async function listFieldOptions(
  fieldIds: { field_id: string; label: string; field_type: string }[],
): Promise<Record<string, { label: string; type: string; options: string[] }>> {
  const wanted = fieldIds.filter(
    (f) => f.field_id && f.field_type !== "text" && f.field_type !== "fault_start",
  );
  if (!wanted.length) return {};
  const key = "field-options:" + wanted.map((f) => f.field_id).join(",");
  return cached(key, async () => {
    const { body } = await call<{
      projects?: { issuetypes?: { fields?: Record<string, { allowedValues?: unknown[] }> }[] }[];
    }>(
      `/rest/api/3/issue/createmeta?projectKeys=${encodeURIComponent(
        JIRA_PROJECT_KEY,
      )}&expand=projects.issuetypes.fields`,
    );
    const merged: Record<string, { allowedValues?: unknown[] }> = {};
    for (const it of body?.projects?.[0]?.issuetypes ?? []) {
      for (const [fid, fdata] of Object.entries(it.fields ?? {})) {
        if (!(fid in merged)) merged[fid] = fdata;
      }
    }

    const out: Record<string, { label: string; type: string; options: string[] }> = {};
    for (const f of wanted) {
      const options: string[] = [];
      for (const opt of merged[f.field_id]?.allowedValues ?? []) {
        const o = opt as { value?: string; name?: string };
        const label = o?.value ?? o?.name ?? "";
        if (label !== "") options.push(label);
      }
      if (!options.length) options.push(...(await optionsViaContext(f.field_id)));
      out[f.field_id] = { label: f.label, type: f.field_type, options };
    }
    return out;
  });
}

async function optionsViaContext(fieldId: string): Promise<string[]> {
  try {
    const ctx = await call<{ values?: { id?: string | number }[] }>(
      `/rest/api/3/field/${encodeURIComponent(fieldId)}/context`,
    );
    const out: string[] = [];
    for (const c of ctx.body?.values ?? []) {
      if (c.id === undefined) continue;
      const opts = await call<{ values?: { value?: string; optionId?: string }[] }>(
        `/rest/api/3/field/${encodeURIComponent(fieldId)}/context/${c.id}/option?maxResults=200`,
      );
      for (const o of opts.body?.values ?? []) {
        const label = o.value ?? o.optionId ?? "";
        if (label !== "" && !out.includes(label)) out.push(label);
      }
    }
    return out;
  } catch {
    return []; // soft-fail, same as v1 (jiraGet returns null → [])
  }
}

export interface CreatedIssue {
  issue_key: string;
  issue_url: string;
  key: string;
  id: string;
  self: string;
}

export type CreateIssueOutcome =
  | { ok: true; issue: CreatedIssue }
  | {
      ok: false;
      status: number;
      message: string;
      jira_errors: Record<string, string>;
      jira_messages: string[];
    };

/** Port of api/jira/create.php's HTTP leg. 201 → created, anything else → 422-style. */
export async function createIssue(
  fields: Record<string, unknown>,
): Promise<CreateIssueOutcome> {
  const { status, body } = await call<unknown>("/rest/api/3/issue", {
    method: "POST",
    body: { fields },
  });
  const parsed = JiraCreateResponseSchema.safeParse(body ?? {});
  const data = parsed.success ? parsed.data : {};
  if (status === 201) {
    const key = data.key ?? "UNKNOWN";
    return {
      ok: true,
      issue: {
        issue_key: key,
        issue_url: `${JIRA_BASE_URL}/browse/${key}`,
        key,
        id: data.id ?? "",
        self: data.self ?? "",
      },
    };
  }
  const { formatJiraErrors } = await import("./fields");
  return {
    ok: false,
    status,
    message: formatJiraErrors(
      { errors: data.errors, errorMessages: data.errorMessages },
      status,
    ),
    jira_errors: data.errors ?? {},
    jira_messages: data.errorMessages ?? [],
  };
}
