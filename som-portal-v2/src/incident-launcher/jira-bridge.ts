// som-portal-v2/src/incident-launcher/jira-bridge.ts
// Jira operations for incidents — reuses src/jira/client infrastructure.

import { JIRA_BASE_URL, jiraCredsReady } from "@/jira/client";
import { AppError } from "@/lib/errors";
import type { TransitionInfo, JiraIssueInfo } from "./types";

const TIMEOUT_MS = 12_000;

function authHeader(): string {
  const email = process.env.JIRA_EMAIL ?? "";
  const token = process.env.JIRA_TOKEN ?? "";
  return "Basic " + Buffer.from(`${email}:${token}`).toString("base64");
}

async function jiraFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (!jiraCredsReady()) {
    throw new AppError("Jira credentials not configured", "jira_not_configured", 503);
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${JIRA_BASE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: authHeader(),
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...((init?.headers as Record<string, string>) ?? {}),
      },
      signal: ctl.signal,
      cache: "no-store",
    });
    const text = await res.text();
    if (res.status >= 400) {
      throw new AppError(`Jira HTTP ${res.status}: ${text.slice(0, 200)}`, "jira_error", 502);
    }
    return text ? (JSON.parse(text) as T) : ({} as T);
  } catch (e) {
    if (e instanceof AppError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new AppError(`Jira connection failed: ${msg}`, "jira_unreachable", 502);
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch available workflow transitions for an issue. */
export async function getTransitions(issueKey: string): Promise<TransitionInfo[]> {
  const data = await jiraFetch<{
    transitions?: {
      id?: string;
      name?: string;
      fields?: Record<string, {
        name?: string;
        required?: boolean;
        schema?: Record<string, unknown>;
        allowedValues?: { id?: string; value?: string; name?: string }[];
      }>;
    }[];
  }>(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`);

  return (data.transitions ?? []).map((t) => {
    const fields: TransitionInfo["fields"] = {};
    for (const [key, f] of Object.entries(t.fields ?? {})) {
      fields[key] = {
        name: f.name ?? key,
        required: f.required ?? false,
        schema: (f.schema ?? {}) as Record<string, unknown>,
        allowedValues: (f.allowedValues ?? []).map((av) => ({
          id: av.id ?? av.value ?? "",
          name: av.value ?? av.name ?? "",
        })),
      };
    }
    return { id: t.id ?? "", name: t.name ?? "", fields };
  });
}

/** Execute a workflow transition on an issue. */
export async function doTransition(
  issueKey: string,
  transitionId: string,
  fields?: Record<string, unknown>,
): Promise<void> {
  const body: Record<string, unknown> = { transition: { id: transitionId } };
  if (fields && Object.keys(fields).length > 0) {
    body.fields = fields;
  }
  await jiraFetch(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Fetch createmeta for the Incident issue type. */
export async function getCreateMeta(
  project = "SMC",
  issueType = "Incident",
): Promise<Record<string, unknown>> {
  const data = await jiraFetch<{
    projects?: { issuetypes?: { fields?: Record<string, unknown> }[] }[];
  }>(
    `/rest/api/3/issue/createmeta?projectKeys=${encodeURIComponent(project)}&issuetypeNames=${encodeURIComponent(issueType)}&expand=projects.issuetypes.fields`,
  );

  const rawFields = (data.projects?.[0]?.issuetypes?.[0]?.fields ?? {}) as Record<
    string,
    {
      name?: string;
      required?: boolean;
      schema?: { type?: string; system?: string };
      allowedValues?: { id?: string; value?: string; name?: string }[];
    }
  >;
  const skip = ["summary", "issuetype", "project", "reporter", "assignee", "attachment", "labels", "description"];
  const fields: Record<string, unknown> = {};

  for (const [key, f] of Object.entries(rawFields)) {
    if (skip.includes(key)) continue;
    const allowedValues = (f.allowedValues ?? []).map((av) => ({
      id: av.id ?? av.value ?? "",
      name: av.value ?? av.name ?? "",
    }));
    fields[key] = {
      field_id: key,
      label: f.name ?? key,
      required: f.required ?? false,
      schema_type: f.schema?.type ?? "string",
      schema_system: f.schema?.system ?? "",
      allowedValues,
    };
  }
  return fields;
}

/** Fetch issue summary/status/priority/assignee. */
export async function getIssue(issueKey: string): Promise<JiraIssueInfo> {
  const data = await jiraFetch<{
    key?: string;
    fields?: {
      summary?: string;
      status?: { name?: string };
      priority?: { name?: string };
      assignee?: { displayName?: string };
    };
  }>(`/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=summary,status,priority,assignee`);

  return {
    key: data.key ?? issueKey,
    summary: data.fields?.summary ?? "",
    status: data.fields?.status?.name ?? "",
    priority: data.fields?.priority?.name ?? "",
    assignee: data.fields?.assignee?.displayName ?? "",
  };
}
