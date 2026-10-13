// som-portal-v2/src/jira/templates.ts
//
// CRUD over the REAL v1 SM-shared files:
//   data/sm/templates.json    (array of templates)
//   data/sm/jira_config.json  ({categories, issue_types, custom_fields})
//
// Semantics are a 1:1 port of api/templates/index.php + api/jira-config/index.php.

import { randomBytes } from "node:crypto";
import type { ZodSchema } from "zod";
import { readSharedFile, writeSharedFile } from "@/team/scope";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { logActivity } from "@/logging/activity";
import type { Session } from "@/auth/session";
import {
  JiraConfigSchema,
  TemplatesFileSchema,
  type JiraConfig,
  type Template,
  type TemplateFields,
  type TemplatesFile,
} from "./schemas";
import { faultStartFieldId } from "./fields";

export const TEMPLATES_FILE = "templates.json";
// readSharedFile/writeSharedFile take ZodSchema<T> (input === output). Our file
// schemas intentionally accept `unknown` input so v1 drift is tolerated, so we
// narrow the declared type here rather than loosening the shared helpers.
const Templates = TemplatesFileSchema as unknown as ZodSchema<TemplatesFile>;
const Config = JiraConfigSchema as unknown as ZodSchema<JiraConfig>;
export const JIRA_CONFIG_FILE = "jira_config.json";

/** PHP `genId('tpl')` → `tpl_<12 hex>`. */
export function genId(prefix = "id"): string {
  return `${prefix}_${randomBytes(6).toString("hex")}`;
}

/** Hot-reloaded on every request — no module-level cache, per the brief. */
export async function loadJiraConfig(): Promise<JiraConfig> {
  return readSharedFile(JIRA_CONFIG_FILE, Config);
}

/** v1 GET: newest first by `created_at` (strcmp desc). */
export async function listTemplates(): Promise<Template[]> {
  const rows = await readSharedFile(TEMPLATES_FILE, Templates);
  return rows
    .slice()
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
}

export async function getTemplate(id: string): Promise<Template | null> {
  const rows = await readSharedFile(TEMPLATES_FILE, Templates);
  return rows.find((t) => t.id === id) ?? null;
}

/**
 * Keep only `issuetype` + `customfield_*` keys, then default the configured
 * fault_start field to 'auto' when absent — exactly api/templates/index.php POST.
 */
export function cleanFields(raw: Record<string, unknown>, cfg: JiraConfig): TemplateFields {
  const out: TemplateFields = {};
  const issuetype = raw["issuetype"];
  if (typeof issuetype === "string" && issuetype.trim() !== "") {
    out["issuetype"] = issuetype.trim();
  }
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith("customfield_")) {
      out[k] = v as TemplateFields[string];
    }
  }
  const faultId = faultStartFieldId(cfg);
  if (out[faultId] === undefined) out[faultId] = "auto";
  return out;
}

export interface CreateTemplateInput {
  name: string;
  summary: string;
  category?: string;
  service_type_id?: string;
  service_subtype_id?: string;
  fields?: Record<string, unknown>;
}

export async function createTemplate(
  input: CreateTemplateInput,
  session: Session,
): Promise<Template> {
  const name = input.name.trim();
  const summary = input.summary.trim();
  if (!name) throw new ValidationError("Template name is required");
  if (!summary) throw new ValidationError("Summary (case title) is required");

  const cfg = await loadJiraConfig();
  const tpl: Template = {
    id: genId("tpl"),
    name,
    category: (input.category ?? "Incident").trim() || "Incident",
    service_type_id: (input.service_type_id ?? "").trim(),
    service_subtype_id: (input.service_subtype_id ?? "").trim(),
    summary,
    fields: cleanFields(input.fields ?? {}, cfg),
    created_at: new Date().toISOString(),
    created_by: session.sub,
    author_name: session.username,
  };

  const rows = await readSharedFile(TEMPLATES_FILE, Templates);
  rows.push(tpl);
  await writeSharedFile(TEMPLATES_FILE, rows, Templates);
  await logActivity({
    user: session.sub,
    team: session.team,
    action: "template_create",
    meta: { id: tpl.id, name, category: tpl.category },
  });
  return tpl;
}

export interface UpdateTemplateInput {
  name?: string;
  summary?: string;
  category?: string;
  service_type_id?: string;
  service_subtype_id?: string;
  fields?: Record<string, unknown>;
}

export async function updateTemplate(
  id: string,
  patch: UpdateTemplateInput,
  session: Session,
): Promise<Template> {
  if (!id) throw new ValidationError("Template ID required");
  const rows = await readSharedFile(TEMPLATES_FILE, Templates);
  const idx = rows.findIndex((t) => t.id === id);
  if (idx === -1) throw new NotFoundError("Template not found");

  const row = rows[idx]!;
  if (patch.name !== undefined) row.name = patch.name.trim();
  if (patch.category !== undefined) row.category = patch.category.trim();
  if (patch.service_type_id !== undefined) row.service_type_id = patch.service_type_id.trim();
  if (patch.service_subtype_id !== undefined)
    row.service_subtype_id = patch.service_subtype_id.trim();
  if (patch.summary !== undefined) row.summary = patch.summary.trim();
  // v1 assigns `fields` verbatim on PUT (no cleaning) — keep that behaviour.
  if (patch.fields !== undefined) row.fields = patch.fields as TemplateFields;
  row.updated_at = new Date().toISOString();

  await writeSharedFile(TEMPLATES_FILE, rows, Templates);
  await logActivity({
    user: session.sub,
    team: session.team,
    action: "template_update",
    meta: { id },
  });
  return row;
}

export async function deleteTemplate(id: string, session: Session): Promise<void> {
  if (!id) throw new ValidationError("Template ID required");
  const rows = await readSharedFile(TEMPLATES_FILE, Templates);
  const filtered = rows.filter((t) => t.id !== id);
  if (filtered.length === rows.length) throw new NotFoundError("Template not found");
  await writeSharedFile(TEMPLATES_FILE, filtered, Templates);
  await logActivity({
    user: session.sub,
    team: session.team,
    action: "template_delete",
    meta: { id },
  });
}

/** Stamp last_used_at after a successful create-issue. Best-effort. */
export async function markTemplateUsed(id: string): Promise<void> {
  try {
    const rows = await readSharedFile(TEMPLATES_FILE, Templates);
    const row = rows.find((t) => t.id === id);
    if (!row) return;
    row.last_used_at = new Date().toISOString();
    await writeSharedFile(TEMPLATES_FILE, rows, Templates);
  } catch {
    /* view-only teams cannot write the shared file — ignore */
  }
}
