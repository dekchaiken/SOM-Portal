/**
 * R-01 — Proposed Jira field-mapping module for SOM-Portal v2.
 *
 * NOT runnable in isolation. Reference sketch only.
 * Assumes: zod ^3, undici/fetch, Next.js route handlers.
 *
 * Design goals:
 *   - Per-site customfield_* IDs stay runtime data (loaded from JSON).
 *   - Code refers to fields by semantic ROLE, not raw ID.
 *   - All boundary crossings are safeParse — unknown shapes degrade, never throw.
 *   - Serialization lives in one toJiraWire() function, not scattered.
 */

import { z } from "zod";

// ────────────────────────────────────────────────────────────────────────────
// Catalog schema (persisted in data/[team]/jira_config.json)
// ────────────────────────────────────────────────────────────────────────────

export const JiraFieldKind = z.enum([
  "text",
  "select",
  "multiSelect",
  "cascade",
  "datetime",
  "number",
]);
export type JiraFieldKind = z.infer<typeof JiraFieldKind>;

export const JiraFieldRole = z.enum([
  "detectedBy",
  "severity",
  "causedByThirdParty",
  "serviceImpacted",
  "businessUnit",
  "channel",
  "faultStart",
  "smPriority",
  "batchIssue",
  "batchFileType",
]);
export type JiraFieldRole = z.infer<typeof JiraFieldRole>;

export const JiraCustomFieldDefSchema = z.object({
  fieldId: z.string().regex(/^customfield_\d+$/),
  label: z.string().min(1),
  kind: JiraFieldKind,
  role: JiraFieldRole.optional(),
  required: z.boolean().default(false),
  enabled: z.boolean().default(true),
  order: z.number().int().default(0),
  placeholder: z.string().default(""),
  defaultValue: z.unknown().nullable().default(null),
});
export type JiraCustomFieldDef = z.infer<typeof JiraCustomFieldDefSchema>;

export const JiraFieldCatalogSchema = z.object({
  issueTypes: z.array(z.object({ id: z.string(), name: z.string() })).default([]),
  categories: z.array(z.object({ id: z.string(), name: z.string() })).default([]),
  customFields: z.array(JiraCustomFieldDefSchema).default([]),
  inheritFromGlobal: z.boolean().default(false),
});
export type JiraFieldCatalog = z.infer<typeof JiraFieldCatalogSchema>;

// ────────────────────────────────────────────────────────────────────────────
// Wire shapes
// ────────────────────────────────────────────────────────────────────────────

export const JiraSelectWire = z.object({ value: z.string(), id: z.string().optional() });
export const JiraCascadeWire = z.object({
  value: z.string(),
  child: z.object({ value: z.string() }).optional(),
});
export type JiraCascadeValue = z.infer<typeof JiraCascadeWire>;

/** Soft-fail issue-fields envelope — unknown customfield_* allowed through. */
export const JiraIssueFieldsSchema = z
  .object({
    summary: z.string().optional(),
    status: z.object({ name: z.string(), statusCategory: z.object({ key: z.string() }).partial() }).partial().optional(),
    assignee: z.object({ displayName: z.string() }).partial().nullable().optional(),
    created: z.string().optional(),
  })
  .catchall(z.unknown()); // customfield_* and anything else

// Template defaults are keyed by raw fieldId (legacy). We validate loosely.
export const TemplateFieldsSchema = z.record(z.string(), z.unknown());

// ────────────────────────────────────────────────────────────────────────────
// Serialization — the one place that turns UI values into Jira wire JSON
// ────────────────────────────────────────────────────────────────────────────

export function toJiraWire(kind: JiraFieldKind, raw: unknown): unknown | undefined {
  if (raw == null || raw === "") return undefined;
  switch (kind) {
    case "text":
    case "number":
      return raw;
    case "datetime":
      return raw === "auto" ? new Date().toISOString() : raw;
    case "select":
      return { value: String(raw) };
    case "multiSelect": {
      const items = Array.isArray(raw)
        ? raw
        : String(raw).split(",").map((s) => s.trim()).filter(Boolean);
      return items.map((v) => ({ value: String(v) }));
    }
    case "cascade": {
      const parsed = JiraCascadeWire.safeParse(raw);
      return parsed.success ? parsed.data : undefined;
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Client with typed, role-based accessors
// ────────────────────────────────────────────────────────────────────────────

export interface JiraClientOptions {
  baseUrl: string;        // e.g. https://truemoney.atlassian.net
  projectKey: string;     // e.g. SMC
  email: string;
  apiToken: string;
  catalog: JiraFieldCatalog;
}

export class JiraClient {
  private readonly roleIndex: Map<JiraFieldRole, JiraCustomFieldDef>;
  private readonly byId: Map<string, JiraCustomFieldDef>;

  constructor(private readonly opts: JiraClientOptions) {
    this.roleIndex = new Map();
    this.byId = new Map();
    for (const def of opts.catalog.customFields) {
      this.byId.set(def.fieldId, def);
      if (def.role) this.roleIndex.set(def.role, def);
    }
  }

  /** Resolve a semantic role to the live customfield_* for this site. */
  fieldIdFor(role: JiraFieldRole): string | undefined {
    return this.roleIndex.get(role)?.fieldId;
  }

  /** Build a Jira REST v3 fields payload from mixed role-keyed and id-keyed inputs. */
  buildFields(input: {
    summary: string;
    description?: string;
    issueType?: string;
    byRole?: Partial<Record<JiraFieldRole, unknown>>;
    byId?: Record<string, unknown>;      // template defaults still allowed
    warnings?: string[];
  }): Record<string, unknown> {
    const out: Record<string, unknown> = {
      project: { key: this.opts.projectKey },
      issuetype: { name: input.issueType ?? "Task" },
      summary: input.summary,
    };
    if (input.description) out.description = descriptionToAdf(input.description);

    for (const [role, value] of Object.entries(input.byRole ?? {}) as [JiraFieldRole, unknown][]) {
      const def = this.roleIndex.get(role);
      if (!def) { input.warnings?.push(`role ${role} not mapped`); continue; }
      const wire = toJiraWire(def.kind, value);
      if (wire !== undefined) out[def.fieldId] = wire;
    }
    for (const [fid, value] of Object.entries(input.byId ?? {})) {
      if (fid in out) continue;                        // role already filled it
      const def = this.byId.get(fid);
      if (!def) { input.warnings?.push(`${fid} not in catalog`); continue; }
      const wire = toJiraWire(def.kind, value);
      if (wire !== undefined) out[fid] = wire;
    }
    return out;
  }

  async createIssue(fields: Record<string, unknown>) {
    const res = await fetch(`${this.opts.baseUrl}/rest/api/3/issue`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${this.opts.email}:${this.opts.apiToken}`).toString("base64"),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ fields }),
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.status === 201, status: res.status, body: json };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Catalog loader — soft-fail per Phase-1 recommendations
// ────────────────────────────────────────────────────────────────────────────

export async function loadCatalog(team: string, read: (path: string) => Promise<unknown>): Promise<{
  catalog: JiraFieldCatalog;
  warnings: string[];
}> {
  const warnings: string[] = [];
  let raw: unknown = {};
  try { raw = await read(`data/${team}/jira_config.json`); }
  catch { warnings.push(`per-team catalog missing for ${team}; falling back to global`); }

  const parsed = JiraFieldCatalogSchema.safeParse(raw);
  if (!parsed.success) {
    warnings.push("catalog shape drift: " + parsed.error.issues.map(i => i.path.join(".")).join(","));
    return { catalog: JiraFieldCatalogSchema.parse({}), warnings };
  }
  return { catalog: parsed.data, warnings };
}

declare function descriptionToAdf(text: string): unknown;  // ADF builder, elsewhere
