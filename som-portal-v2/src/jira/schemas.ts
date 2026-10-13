// som-portal-v2/src/jira/schemas.ts
//
// Zod shapes for the REAL v1 data files. Field names are 1:1 with
//   data/<team>/jira_config.json   (SM-shared — see helpers.php smSharedFiles())
//   data/<team>/templates.json     (SM-shared)
// so PHP v1 and v2 can dual-run against the same JSON on disk.
//
// Everything is tolerant (passthrough + optional) because v1 rows drifted over
// time (e.g. tpl_001 has no `author_name`, and carries an orphan
// `customfield_17022` that is not in the catalog — see R-01 §2).

import { z } from "zod";

/** v1 `field_type` — a serialization hint invented by v1, NOT a Jira schema type. */
export const JiraFieldTypeSchema = z
  .enum(["text", "select", "array", "fault_start"])
  .catch("text");
export type JiraFieldType = z.infer<typeof JiraFieldTypeSchema>;

export const JiraCustomFieldDefSchema = z.object({
  id: z.string().default(""),
  field_id: z.string(),
  label: z.string().default(""),
  placeholder: z.string().default(""),
  field_type: JiraFieldTypeSchema.default("text"),
  enabled: z.boolean().default(true),
  order: z.number().default(0),
});
export type JiraCustomFieldDef = z.infer<typeof JiraCustomFieldDefSchema>;

export const JiraNamedItemSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type JiraNamedItem = z.infer<typeof JiraNamedItemSchema>;

/** The whole jira_config.json. Matches v1's `{categories, issue_types, custom_fields}`. */
const JiraConfigObject = z.object({
  categories: z.array(JiraNamedItemSchema).catch([]),
  issue_types: z.array(JiraNamedItemSchema).catch([]),
  custom_fields: z.array(JiraCustomFieldDefSchema).catch([]),
});
export type JiraConfig = z.infer<typeof JiraConfigObject>;
/* Annotated so the input type is `unknown` — the file on disk is whatever v1
   last wrote, and a missing file reads as `null`. Drift never throws. */
export const JiraConfigSchema: z.ZodType<JiraConfig, z.ZodTypeDef, unknown> =
  JiraConfigObject.catch({ categories: [], issue_types: [], custom_fields: [] });

/**
 * Template `fields` map. Keys are `issuetype` plus raw `customfield_*` ids.
 * Values are plain strings in v1 (multi-selects are comma-separated), with the
 * one exception of the cascading batch field which v1 stores/sends as an object.
 */
export const TemplateFieldsSchema = z
  .record(z.union([z.string(), z.number(), z.boolean(), z.null(), z.record(z.unknown()), z.array(z.unknown())]))
  .default({});
export type TemplateFields = z.infer<typeof TemplateFieldsSchema>;

export const TemplateSchema = z.object({
  id: z.string(),
  name: z.string().default(""),
  category: z.string().default("Incident"),
  service_type_id: z.string().default(""),
  service_subtype_id: z.string().default(""),
  summary: z.string().default(""),
  fields: TemplateFieldsSchema,
  created_at: z.string().default(""),
  created_by: z.string().default(""),
  author_name: z.string().default(""),
  // v1 never wrote these, but the UI wants them. Kept optional so a v1 write
  // that drops them does not fail validation on the next v2 read.
  updated_at: z.string().optional(),
  last_used_at: z.string().optional(),
});
export type Template = z.infer<typeof TemplateSchema>;

/** templates.json is a bare JSON array in v1. */
export type TemplatesFile = Template[];
export const TemplatesFileSchema: z.ZodType<TemplatesFile, z.ZodTypeDef, unknown> = z
  .array(TemplateSchema)
  .catch([]);

// ── Request bodies ──────────────────────────────────────────────────────────

export const TemplateCreateSchema = z.object({
  name: z.string().trim().min(1, "Template name is required"),
  summary: z.string().trim().min(1, "Summary (case title) is required"),
  category: z.string().trim().default("Incident"),
  service_type_id: z.string().trim().default(""),
  service_subtype_id: z.string().trim().default(""),
  fields: z.record(z.unknown()).default({}),
});

export const TemplateUpdateSchema = z.object({
  name: z.string().trim().optional(),
  summary: z.string().trim().optional(),
  category: z.string().trim().optional(),
  service_type_id: z.string().trim().optional(),
  service_subtype_id: z.string().trim().optional(),
  fields: z.record(z.unknown()).optional(),
});

/**
 * create-issue body. v1 `api/jira/create.php` takes `{summary, description, fields}`.
 * The brief's `{templateId, overrides}` form is also accepted — the route
 * resolves the template server-side and merges overrides over its fields.
 */
export const CreateIssueSchema = z
  .object({
    templateId: z.string().optional(),
    summary: z.string().trim().optional(),
    description: z.string().optional(),
    fields: z.record(z.unknown()).optional(),
    overrides: z.record(z.unknown()).optional(),
  })
  .refine((b) => Boolean(b.templateId) || Boolean(b.summary), {
    message: "Summary is required",
  });

// ── Jira wire shapes (soft-parsed — drift must never throw) ─────────────────

export const JiraFieldMetaSchema = z.object({
  id: z.string(),
  name: z.string().default(""),
  schema: z.object({ type: z.string().optional(), custom: z.string().optional() }).optional(),
});

export const JiraCreateResponseSchema = z.object({
  id: z.string().optional(),
  key: z.string().optional(),
  self: z.string().optional(),
  errors: z.record(z.string()).optional(),
  errorMessages: z.array(z.string()).optional(),
});
