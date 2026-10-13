// som-portal-v2/src/ma/types.ts
// Zod schemas for MA Services, Modules, Types, and Status Cache.
// Field names match v1 data/sm/ma-services.json exactly for dual-run.
import { z } from 'zod';

// ── MA Service (one row in ma-services.json → services[]) ───────────────────

export const MAServiceSchema = z.object({
  id: z.number(),
  service_name: z.string(),
  service_type: z.string(),
  tool_type: z.string(),
  can_change_text: z.string().default(''),
  remark: z.string().default(''),
  link_manual: z.string().default(''),
  direct_link: z.string().default(''),
  custom_url: z.string().default(''),
  grafana_link: z.string().default(''),
  opensearch_url: z.string().default(''),
  images: z.array(z.string()).default([]),
  backoffice_use_case_id: z.number().nullable().default(null),
  jenkins_server_id: z.string().default(''),
  jenkins_job_path: z.string().default(''),
  created_at: z.string(),
  updated_at: z.string(),
  // Fields set by toggle/trigger actions (optional — not on every record)
  last_toggled_action: z.string().optional(),
  last_toggled_by: z.string().optional(),
  last_toggled_by_name: z.string().optional(),
  last_toggled_reason: z.string().optional(),
  last_toggled_at: z.number().optional(),
  last_jenkins_by: z.string().optional(),
  last_jenkins_by_name: z.string().optional(),
  last_jenkins_at: z.number().optional(),
  last_jenkins_params: z.record(z.string(), z.unknown()).optional(),
});
export type MAService = z.infer<typeof MAServiceSchema>;

export const MAServicesFileSchema = z.object({
  services: z.array(MAServiceSchema).default([]),
  next_id: z.number().default(1),
});
export type MAServicesFile = z.infer<typeof MAServicesFileSchema>;

// ── Create / Update inputs ──────────────────────────────────────────────────

export const CreateMAServiceInput = z.object({
  service_name: z.string().min(1, 'service_name is required'),
  service_type: z.string().min(1, 'service_type is required'),
  tool_type: z.string().min(1, 'tool_type is required'),
  can_change_text: z.string().default(''),
  remark: z.string().default(''),
  link_manual: z.string().default(''),
  direct_link: z.string().default(''),
  custom_url: z.string().default(''),
  grafana_link: z.string().default(''),
  opensearch_url: z.string().default(''),
  images: z.array(z.string()).default([]),
  backoffice_use_case_id: z.number().nullable().default(null),
  jenkins_server_id: z.string().default(''),
  jenkins_job_path: z.string().default(''),
});
export type CreateMAServiceInput = z.infer<typeof CreateMAServiceInput>;

export const UpdateMAServiceInput = z.object({
  id: z.number(),
  service_name: z.string().optional(),
  service_type: z.string().optional(),
  tool_type: z.string().optional(),
  can_change_text: z.string().optional(),
  remark: z.string().optional(),
  link_manual: z.string().optional(),
  direct_link: z.string().optional(),
  custom_url: z.string().optional(),
  grafana_link: z.string().optional(),
  opensearch_url: z.string().optional(),
  images: z.array(z.string()).optional(),
  backoffice_use_case_id: z.number().nullable().optional(),
  jenkins_server_id: z.string().optional(),
  jenkins_job_path: z.string().optional(),
});
export type UpdateMAServiceInput = z.infer<typeof UpdateMAServiceInput>;

// ── MA Module (ma-modules.json) ─────────────────────────────────────────────

export const MAModuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  desc: z.string().default(''),
  icon: z.string().default(''),
  theme: z.string().default('amber'),
  enabled: z.boolean().default(true),
  order: z.number().default(0),
  builtin: z.boolean().default(false),
  status: z.string().default('active'),
});
export type MAModule = z.infer<typeof MAModuleSchema>;

export const MAModulesFileSchema = z.object({
  modules: z.array(MAModuleSchema).default([]),
});
export type MAModulesFile = z.infer<typeof MAModulesFileSchema>;

// ── MA Type (ma-types.json) ─────────────────────────────────────────────────

export const MATypeSchema = z.object({
  name: z.string(),
  description: z.string().default(''),
  color: z.string().default('gray'),
});
export type MAType = z.infer<typeof MATypeSchema>;

export const MATypesFileSchema = z.object({
  service_types: z.array(MATypeSchema).default([]),
  site_types: z.array(MATypeSchema).default([]),
});
export type MATypesFile = z.infer<typeof MATypesFileSchema>;

// ── MA Status Cache (ma-status-cache.json) ──────────────────────────────────

export const MAStatusItemSchema = z.object({
  name: z.string(),
  label: z.string(),
  use_case_id: z.number().optional(),
  type: z.string(),
  status: z.string(), // 'open' = MA active, 'closed' = normal
  updated_at: z.string().default(''),
  updated_by: z.string().default(''),
  category: z.string().default(''),
});
export type MAStatusItem = z.infer<typeof MAStatusItemSchema>;

export const MAStatusSourceSchema = z.object({
  ok: z.boolean(),
  fetched_at: z.number(),
  items: z.array(MAStatusItemSchema).default([]),
  error: z.string().optional(),
});

export const MAStatusSummarySchema = z
  .object({
    total: z.number().default(0),
    open: z.number().default(0),
    closed: z.number().default(0),
    unknown: z.number().default(0),
    matched: z.number().default(0),
    per_source: z.record(z.string(), z.object({ ok: z.boolean(), count: z.number().default(0), fetched_at: z.number().default(0), error: z.string().nullable().optional() }).passthrough()).default({}),
  })
  .passthrough();

/** One MA usecase as the status cache matched it (v1 payload.services). */
export const MAStatusServiceSchema = z
  .object({
    id: z.number(),
    service_name: z.string(),
    service_type: z.string().default(''),
    tool_type: z.string().default(''),
    status: z.string().default('unknown'),
    source: z.string().nullable().optional(),
    matched: z.boolean().default(false),
    updated_at: z.string().nullable().optional(),
    link: z.string().nullable().optional(),
  })
  .passthrough();

export const MAStatusCacheSchema = z.object({
  ts: z.number().default(0),
  filter: z.string().default(''),
  payload: z
    .object({
      sources: z.record(z.string(), MAStatusSourceSchema).default({}),
      summary: MAStatusSummarySchema.optional(),
      services: z.array(MAStatusServiceSchema).default([]),
      unmapped_backoffice: z.array(MAStatusItemSchema).default([]),
    })
    .passthrough()
    .default({ sources: {}, services: [], unmapped_backoffice: [] }),
});
export type MAStatusCache = z.infer<typeof MAStatusCacheSchema>;

// ── MA Status Hidden (per-user hidden items) ────────────────────────────────

export const MAStatusHiddenSchema = z.record(
  z.string(), // source key (e.g. 'tmn_backoffice')
  z.array(z.string()), // hidden item names
).default({});
export type MAStatusHidden = z.infer<typeof MAStatusHiddenSchema>;

// ── Toggle rate limit ───────────────────────────────────────────────────────

export const MAToggleRLSchema = z.record(z.string(), z.number()).default({});
export type MAToggleRL = z.infer<typeof MAToggleRLSchema>;

// ── Backoffice toggle input ─────────────────────────────────────────────────

export const ToggleMAInput = z.object({
  id: z.number().min(1, 'Missing or invalid id'),
  action: z.enum(['enable', 'disable']),
  reason: z.string().max(500).default(''),
  use_case_id: z.number().optional(),
});
export type ToggleMAInput = z.infer<typeof ToggleMAInput>;

// ── Jenkins trigger input ───────────────────────────────────────────────────

export const JenkinsTriggerInput = z.object({
  service_id: z.number().min(1, 'Missing service_id'),
  params: z.record(z.string(), z.string()).default({}),
});
export type JenkinsTriggerInput = z.infer<typeof JenkinsTriggerInput>;

// ── Jira stats ──────────────────────────────────────────────────────────────

export const JiraStatsFileSchema = z.record(
  z.string(), // service_id as string key
  z.record(z.string(), z.number()), // month → count
).default({});
export type JiraStatsFile = z.infer<typeof JiraStatsFileSchema>;
