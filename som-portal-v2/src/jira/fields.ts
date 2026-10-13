// som-portal-v2/src/jira/fields.ts
//
// Exact port of the payload builder in v1 `api/jira/create.php`.
// Every branch below maps to a block in that file; keep them in step.

import type { JiraConfig, JiraCustomFieldDef, JiraFieldType } from "./schemas";

export const JIRA_PROJECT_KEY = "SMC";

/** v1 hardcoded fallbacks (create.php) for Incident Launcher fields. */
export const IL_SELECT_FIELDS = [
  "customfield_17031", // Severity
  "customfield_17016", // Detected by
  "customfield_17238", // Caused by 3rd Party
] as const;
export const IL_ARRAY_FIELDS = [
  "customfield_17066", // Business Unit Impacted
  "customfield_17024", // TH Service Impacted
  "customfield_17023", // TH Channel / Component
] as const;
/** v1 hardcoded fallbacks (create.php) for Batch fields. */
export const BATCH_SELECT_FIELDS = ["customfield_17019", "customfield_17030"] as const;
export const BATCH_CASCADE_FIELD = "customfield_17058";
/** v1 default when no `fault_start` field is configured. */
export const LEGACY_FAULT_START_FIELD = "customfield_17026";

export type FieldValue = unknown;
export type FieldMap = Record<string, FieldValue>;

/** `field_id` → `field_type`, built from jira_config.json (create.php lines 18-25). */
export function fieldTypeMap(cfg: JiraConfig): Record<string, JiraFieldType> {
  const out: Record<string, JiraFieldType> = {};
  for (const cf of cfg.custom_fields) {
    if (cf.field_id) out[cf.field_id] = cf.field_type;
  }
  return out;
}

/** The configured fault_start field, or v1's legacy fallback. */
export function faultStartFieldId(cfg: JiraConfig): string {
  const hit = cfg.custom_fields.find((cf) => cf.field_type === "fault_start");
  return hit?.field_id || LEGACY_FAULT_START_FIELD;
}

/** Enabled catalog rows, ordered — what the Create-Issue form renders. */
export function visibleFields(cfg: JiraConfig): JiraCustomFieldDef[] {
  return cfg.custom_fields
    .filter((cf) => cf.enabled)
    .slice()
    .sort((a, b) => a.order - b.order);
}

/** ISO-8601 with numeric offset — PHP `date('Y-m-d\TH:i:s.000O')`. */
export function nowFaultStart(d: Date = new Date(), offsetMinutes?: number): string {
  // v1 runs in Asia/Bangkok (+07:00). Default to that so dual-run output matches.
  const off = offsetMinutes ?? 7 * 60;
  const shifted = new Date(d.getTime() + off * 60_000);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  const sign = off >= 0 ? "+" : "-";
  const a = Math.abs(off);
  return (
    `${shifted.getUTCFullYear()}-${p(shifted.getUTCMonth() + 1)}-${p(shifted.getUTCDate())}` +
    `T${p(shifted.getUTCHours())}:${p(shifted.getUTCMinutes())}:${p(shifted.getUTCSeconds())}.000` +
    `${sign}${p(Math.floor(a / 60))}${p(a % 60)}`
  );
}

/** Jira API v3 ADF document from a plain-text description (create.php lines 37-47). */
export function toAdf(description: string): Record<string, unknown> {
  return {
    type: "doc",
    version: 1,
    content: description.split("\n").map((line) => ({
      type: "paragraph",
      content: line === "" ? [] : [{ type: "text", text: line }],
    })),
  };
}

function asString(v: FieldValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

/** Comma-split multi-select, v1 semantics (`array_filter(array_map('trim', explode(',', $val)))`). */
export function splitMulti(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/** Serialize one value for the Jira wire, by v1 field_type. */
export function toJiraWire(type: JiraFieldType, value: FieldValue): unknown {
  const s = asString(value);
  if (type === "select") return { value: s };
  if (type === "array") return splitMulti(s).map((v) => ({ value: v }));
  return s;
}

export interface BuildIssueInput {
  cfg: JiraConfig;
  summary: string;
  description?: string;
  fields: FieldMap;
  /** Injected for deterministic tests. */
  now?: Date;
}

/**
 * Build the `fields` object for POST /rest/api/3/issue.
 * Mirrors create.php block-for-block, including the IL + batch fallbacks.
 */
export function buildIssueFields(input: BuildIssueInput): Record<string, unknown> {
  const { cfg, summary, description = "", fields: fieldsIn, now } = input;
  const types = fieldTypeMap(cfg);
  const faultId = faultStartFieldId(cfg);

  // Determine fault start. v1 reads customfield_17026 explicitly; we honour the
  // configured field first and fall back to the legacy id so both work.
  const rawFault = asString(fieldsIn[faultId] ?? fieldsIn[LEGACY_FAULT_START_FIELD] ?? "auto");
  const faultStart =
    rawFault === "auto" || rawFault === "manual" || rawFault === ""
      ? nowFaultStart(now ?? new Date())
      : rawFault;

  const issuetype = asString(fieldsIn["issuetype"]).trim() || "Task";

  const out: Record<string, unknown> = {
    project: { key: JIRA_PROJECT_KEY },
    issuetype: { name: issuetype },
    summary,
  };

  if (description.trim() !== "") out["description"] = toAdf(description);

  // Catalog-driven mapping.
  for (const [fieldId, ftype] of Object.entries(types)) {
    if (ftype === "fault_start") continue; // handled below
    const val = fieldsIn[fieldId];
    const s = asString(val);
    if (s === "") continue;
    out[fieldId] = toJiraWire(ftype, s);
  }

  // Fault start as a datetime string, only when the template supplied the key.
  if (fieldsIn[faultId] !== undefined || fieldsIn[LEGACY_FAULT_START_FIELD] !== undefined) {
    out[faultId] = faultStart;
  }

  // ── Incident Launcher explicit fallbacks (fields missing from jira_config) ──
  for (const fid of IL_SELECT_FIELDS) {
    if (out[fid] !== undefined) continue;
    const v = asString(fieldsIn[fid]).trim();
    if (v === "") continue;
    out[fid] = { value: v };
  }
  for (const fid of IL_ARRAY_FIELDS) {
    if (out[fid] !== undefined) continue;
    const items = splitMulti(asString(fieldsIn[fid]).trim());
    if (items.length) out[fid] = items.map((v) => ({ value: v }));
  }

  // ── Batch-specific fields (never in jira_config.json) ──
  for (const fid of BATCH_SELECT_FIELDS) {
    const v = fieldsIn[fid];
    if (typeof v === "string" && v !== "") out[fid] = { value: v };
  }
  // Cascading select — passed through as-is, like v1.
  const casc = fieldsIn[BATCH_CASCADE_FIELD];
  if (casc && typeof casc === "object") out[BATCH_CASCADE_FIELD] = casc;

  return out;
}

/** Flatten Jira's error envelope the way create.php does. */
export function formatJiraErrors(
  body: { errors?: Record<string, string>; errorMessages?: string[] } | null,
  httpStatus: number,
): string {
  const parts: string[] = [];
  for (const [field, msg] of Object.entries(body?.errors ?? {})) parts.push(`${field}: ${msg}`);
  for (const msg of body?.errorMessages ?? []) parts.push(msg);
  return parts.length ? parts.join(" | ") : `HTTP ${httpStatus}`;
}

/**
 * Template lint — any `fields` key not in the catalog (and not `issuetype` or a
 * known hardcoded id) is reported. Picks up the orphan customfield_17022 noted
 * in R-01 §2. Soft-fail: warnings only, never blocks.
 */
export function lintTemplateFields(cfg: JiraConfig, fields: FieldMap): string[] {
  const known = new Set<string>([
    "issuetype",
    ...Object.keys(fieldTypeMap(cfg)),
    ...IL_SELECT_FIELDS,
    ...IL_ARRAY_FIELDS,
    ...BATCH_SELECT_FIELDS,
    BATCH_CASCADE_FIELD,
    LEGACY_FAULT_START_FIELD,
  ]);
  return Object.keys(fields)
    .filter((k) => !known.has(k))
    .map((k) => `Unknown field "${k}" — not in jira_config.json catalog`);
}
