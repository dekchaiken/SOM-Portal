// som-portal-v2/src/incident-launcher/types.ts
// Zod schemas for Incident Launcher config (v1 field names for dual-run compat).

import { z } from "zod";

// ── Channel ─────────────────────────────────────────────────────────────────
export const ChannelPlatformSchema = z
  .enum(["googlechat", "line", "dingtalk", "manual"])
  .catch("manual");

export const ChannelSchema = z.object({
  id: z.string(),
  name: z.string().default(""),
  platform: ChannelPlatformSchema,
  auth: z.string().default(""),
  template_alert: z.string().default(""),
  template_resolved: z.string().default(""),
  enabled: z.boolean().default(true),
});
export type Channel = z.infer<typeof ChannelSchema>;

// ── BO Config entry (per MA job) ────────────────────────────────────────────
export const BoConfigEntrySchema = z.object({
  label: z.string().default(""),
  application: z.string(),
  key: z.string(),
  environment: z.string().default("production"),
  profile: z.string().default("main"),
  editable: z.boolean().default(false),
});
export type BoConfigEntry = z.infer<typeof BoConfigEntrySchema>;

// ── MA Job ──────────────────────────────────────────────────────────────────
export const MaJobSchema = z.object({
  id: z.string(),
  name: z.string().default(""),
  type: z.enum(["jenkins", "rundeck", "manual"]).catch("manual"),
  server_id: z.string().default(""),
  job_path: z.string().default(""),
  url: z.string().default(""),
  optional: z.boolean().default(false),
  notes: z.string().default(""),
  bo_configs: z.array(BoConfigEntrySchema).catch([]),
  enabled: z.boolean().default(true),
});
export type MaJob = z.infer<typeof MaJobSchema>;

// ── Partner Group ───────────────────────────────────────────────────────────
export const PartnerGroupSchema = z.object({
  id: z.string(),
  name: z.string().default(""),
  color: z.string().default("#3b82f6"),
  to_emails: z.array(z.string()).catch([]),
  cc_emails: z.array(z.string()).catch([]),
  bcc_emails: z.array(z.string()).catch([]),
  emails: z.array(z.string()).catch([]), // backward compat
});
export type PartnerGroup = z.infer<typeof PartnerGroupSchema>;

// ── Template ────────────────────────────────────────────────────────────────
export const IncidentTemplateSchema = z.object({
  id: z.string(),
  name: z.string().default(""),
  icon: z.string().default("zap"),
  color: z.string().default("#ef4444"),
  service: z.string().default(""),
  severity: z.enum(["sev1", "sev2", "sev3"]).catch("sev1"),
  description: z.string().default(""),
  partner_group_ids: z.array(z.string()).catch([]),
  jira_summary: z.string().default(""),
});
export type IncidentTemplate = z.infer<typeof IncidentTemplateSchema>;

// ── Case (incident type definition) ─────────────────────────────────────────
export const CaseSchema = z.object({
  id: z.string(),
  name: z.string().default(""),
  icon: z.string().default("zap"),
  color: z.string().default("#ef4444"),
  description: z.string().default(""),
  default_title: z.string().default(""),
  default_service: z.string().default(""),
  default_severity: z.enum(["sev1", "sev2", "sev3"]).catch("sev1"),
  ma_job_ids: z.array(z.string()).catch([]),
  channel_ids: z.array(z.string()).catch([]),
  partner_group_ids: z.array(z.string()).catch([]),
  sp_services: z.array(z.string()).catch([]),
});
export type Case = z.infer<typeof CaseSchema>;

// ── Quick Link ──────────────────────────────────────────────────────────────
export const QuickLinkSchema = z.object({
  id: z.string(),
  label: z.string().default(""),
  icon: z.string().default("link"),
  url: z.string().default(""),
});

// ── Jira Preset Field ───────────────────────────────────────────────────────
export const JiraPresetFieldSchema = z.object({
  field_id: z.string(),
  label: z.string().default(""),
  value: z.string().default(""),
});

// ── Jira Field Defaults ─────────────────────────────────────────────────────
export const JiraFieldDefaultsSchema = z.object({
  bu: z.array(z.string()).catch([]),
  svc: z.array(z.string()).catch([]),
  chn: z.array(z.string()).catch([]),
  detected: z.string().default("Service Monitoring (SM)"),
  third_party: z.string().default(""),
});

// ── Full Config (incident-launcher-config.json) ─────────────────────────────
const IncidentConfigObject = z.object({
  chat_webhook_url: z.string().default(""),
  meet_main_url: z.string().default(""),
  meet_channel_ids: z.array(z.string()).catch([]),
  meet_msg_tpl: z.string().default(""),
  jira_issue_type: z.string().default("Monitoring"),
  jira_default_severity: z.enum(["sev1", "sev2", "sev3"]).catch("sev1"),
  jira_summary_tpl: z.string().default(""),
  jira_detected_by: z.string().default(""),
  jira_desc_tpl: z.string().default(""),
  jira_field_defaults: JiraFieldDefaultsSchema.catch({
    bu: [],
    svc: [],
    chn: [],
    detected: "Service Monitoring (SM)",
    third_party: "",
  }),
  jira_escalate_transition: z.string().default(""),
  partner_groups: z.array(PartnerGroupSchema).catch([]),
  templates: z.array(IncidentTemplateSchema).catch([]),
  quick_links: z.array(QuickLinkSchema).catch([]),
  channels: z.array(ChannelSchema).catch([]),
  ma_jobs: z.array(MaJobSchema).catch([]),
  cases: z.array(CaseSchema).catch([]),
  jira_preset_fields: z.array(JiraPresetFieldSchema).catch([]),
  sp_services: z.array(z.string()).catch([]),
  updated_at: z.number().default(0),
  updated_by: z.string().default(""),
});

export type IncidentConfig = z.infer<typeof IncidentConfigObject>;
export const IncidentConfigSchema: z.ZodType<IncidentConfig, z.ZodTypeDef, unknown> =
  IncidentConfigObject.catch({
    chat_webhook_url: "",
    meet_main_url: "",
    meet_channel_ids: [],
    meet_msg_tpl: "",
    jira_issue_type: "Monitoring",
    jira_default_severity: "sev1",
    jira_summary_tpl: "",
    jira_detected_by: "",
    jira_desc_tpl: "",
    jira_field_defaults: { bu: [], svc: [], chn: [], detected: "Service Monitoring (SM)", third_party: "" },
    jira_escalate_transition: "",
    partner_groups: [],
    templates: [],
    quick_links: [],
    channels: [],
    ma_jobs: [],
    cases: [],
    jira_preset_fields: [],
    sp_services: [],
    updated_at: 0,
    updated_by: "",
  });

// ── Impact result ───────────────────────────────────────────────────────────
export const ImpactSeveritySchema = z.enum(["low", "medium", "high", "critical"]);
export type ImpactSeverity = z.infer<typeof ImpactSeveritySchema>;

export interface ImpactLayerItem {
  app_name?: string;
  service?: string;
  namespace?: string;
  restarts?: number;
  http_5xx?: number;
  errors?: number;
  peak_ms?: number;
  exploreUrl?: string;
  [key: string]: unknown;
}

export interface ImpactResult {
  from: string;
  to: string;
  range_seconds: number;
  severity: ImpactSeverity;
  summary: {
    total_http_5xx: number;
    total_restarts: number;
    total_bank_errors: number;
    services_count: number;
    banks_count: number;
    unknown_apps: number;
  };
  layers: {
    infrastructure: ImpactLayerItem[];
    http_errors: ImpactLayerItem[];
    performance: ImpactLayerItem[];
    banking: ImpactLayerItem[];
    business_ops: ImpactLayerItem[];
  };
  business_impact: { category: string; services: string[] }[];
  unknown_apps: string[];
  source_count: number;
}

// ── Jira transition info ────────────────────────────────────────────────────
export interface TransitionField {
  name: string;
  required: boolean;
  schema: Record<string, unknown>;
  allowedValues: { id: string; name: string }[];
}

export interface TransitionInfo {
  id: string;
  name: string;
  fields: Record<string, TransitionField>;
}

// ── Jira issue info ─────────────────────────────────────────────────────────
export interface JiraIssueInfo {
  key: string;
  summary: string;
  status: string;
  priority: string;
  assignee: string;
}

// ── Request schemas ─────────────────────────────────────────────────────────
export const DoTransitionSchema = z.object({
  key: z.string().regex(/^[A-Z]+-\d+$/, "Invalid Jira key"),
  transition_id: z.string().min(1, "transition_id required"),
  fields: z.record(z.unknown()).optional().default({}),
});

export const BoUpdateSchema = z.object({
  application: z.string().min(1, "application required"),
  key: z.string().min(1, "key required"),
  value: z.string().max(5000, "value too long"),
  environment: z.string().default("production"),
  profile: z.string().default("main"),
});

export const WebhookSendSchema = z.object({
  url: z.string().min(1, "Webhook URL required"),
  text: z.string().min(1, "Message text required"),
});

export const NotifyChannelSchema = z.object({
  channel_id: z.string().min(1, "channel_id required"),
  message: z.string().min(1, "message required"),
  thread_key: z.string().optional().default(""),
});

export const JiraKeySchema = z.string().regex(/^[A-Z]+-\d+$/, "Invalid Jira key");
