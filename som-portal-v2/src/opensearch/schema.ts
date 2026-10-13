// som-portal-v2/src/opensearch/schema.ts
// Zod schemas for the OpenSearch log explorer module.
// v1 field names preserved 1:1 for dual-run compatibility.
import { z } from 'zod';

// ─── Credential storage ─────────────────────────────────────────────────────

export const CredEntrySchema = z.object({
  username: z.string(),
  password_enc: z.string(),
  saved_at: z.number(),
});
export type CredEntry = z.infer<typeof CredEntrySchema>;

/** { userId: { endpointId: CredEntry } } */
export const UserCredsFileSchema = z.record(z.string(), z.record(z.string(), CredEntrySchema)).default({});
export type UserCredsFile = z.infer<typeof UserCredsFileSchema>;

// ─── Endpoint config ────────────────────────────────────────────────────────

export const EndpointSchema = z.object({
  id: z.string(),
  name: z.string(),
  base_url: z.string(),
  username: z.string().optional().default(''),
  password: z.string().optional().default(''),
  auth_mode: z.enum(['basic', 'dashboards']).default('basic'),
  osd_version: z.string().optional().default('2.7.0'),
  default_index_pattern: z.string(),
  index_patterns: z.array(z.string()).default([]),
  dashboards_url: z.string().optional().default(''),
  enabled: z.boolean().default(true),
  order: z.number().default(99),
});
export type Endpoint = z.infer<typeof EndpointSchema>;

export const ConfigDefaultsSchema = z.object({
  size: z.number().default(200),
  max_size: z.number().default(1000),
  default_time_range_min: z.number().default(15),
});

export const OpenSearchConfigSchema = z.object({
  endpoints: z.array(EndpointSchema).default([]),
  defaults: ConfigDefaultsSchema.default({}),
});
export type OpenSearchConfig = z.infer<typeof OpenSearchConfigSchema>;

// ─── DSL query params ───────────────────────────────────────────────────────

export const LogLevel = z.enum(['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']);
export type LogLevelType = z.infer<typeof LogLevel>;

export const TimeRange = z.enum([
  'last_5m', 'last_15m', 'last_30m', 'last_1h',
  'last_4h', 'last_12h', 'last_24h', 'last_3d', 'last_7d',
]);
export type TimeRangeType = z.infer<typeof TimeRange>;

export const SearchParamsSchema = z.object({
  endpoint_id: z.string().min(1),
  index_pattern: z.string().regex(/^[a-z0-9_\-.*,]+$/i).optional(),
  module: z.string().trim().optional(),
  log_level: LogLevel.optional(),
  correlation_id: z.string().trim().optional(),
  q: z.string().max(200).optional(),
  regexp_rest: z.string().max(500).optional(),
  range: TimeRange.default('last_15m'),
  start: z.string().optional(),
  end: z.string().optional(),
  size: z.number().int().min(1).max(1000).default(200),
  from: z.number().int().min(0).max(9000).default(0),
}).refine(
  (v) => !v.start === !v.end,
  { message: 'start and end must both be set or both omitted' },
);
export type SearchParams = z.infer<typeof SearchParamsSchema>;

// ─── Saved searches ─────────────────────────────────────────────────────────

export const SavedSearchParamsSchema = z.object({
  endpoint_id: z.string(),
  index_pattern: z.string().optional(),
  module: z.string().optional(),
  log_level: z.string().optional(),
  q: z.string().max(200).optional(),
  correlation_id: z.string().optional(),
  regexp_rest: z.string().max(500).optional(),
  range: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  size: z.number().optional(),
}).passthrough();

export const SavedSearchHistoryEntrySchema = z.object({
  action: z.string(),
  by: z.string(),
  by_name: z.string(),
  at: z.number(),
  changes: z.array(z.record(z.unknown())).default([]),
});

export const SavedSearchSchema = z.object({
  id: z.string(),
  name: z.string().max(80),
  folder_id: z.string().nullable().default(null),
  params: SavedSearchParamsSchema,
  created_by: z.string(),
  created_by_name: z.string(),
  created_at: z.number(),
  updated_by: z.string().optional(),
  updated_by_name: z.string().optional(),
  updated_at: z.number().optional(),
  history: z.array(SavedSearchHistoryEntrySchema).default([]),
});
export type SavedSearch = z.infer<typeof SavedSearchSchema>;

export const SavedSearchesFileSchema = z.array(SavedSearchSchema).default([]);

// ─── Saved folders ──────────────────────────────────────────────────────────

export const SavedFolderSchema = z.object({
  id: z.string(),
  name: z.string().max(60),
  color: z.string().default(''),
  created_by: z.string(),
  created_by_name: z.string(),
  created_at: z.number(),
  updated_by: z.string().optional(),
  updated_by_name: z.string().optional(),
  updated_at: z.number().optional(),
});
export type SavedFolder = z.infer<typeof SavedFolderSchema>;

export const SavedFoldersFileSchema = z.array(SavedFolderSchema).default([]);

// ─── Session cache ──────────────────────────────────────────────────────────

export const SessionEntrySchema = z.object({
  cookie: z.string(),
  expires_at: z.number(),
});

export const SessionsFileSchema = z.record(z.string(), SessionEntrySchema).default({});
export type SessionsFile = z.infer<typeof SessionsFileSchema>;

// ─── Normalized hit (response shape) ────────────────────────────────────────

export const NormalizedHitSchema = z.object({
  id: z.string(),
  index: z.string(),
  timestamp: z.string().nullable(),
  module: z.string(),
  log_level: z.string(),
  correlation_id: z.string(),
  rest: z.string(),
  status_code: z.number().nullable(),
  latency_ms: z.number().nullable(),
  pod: z.string(),
  namespace: z.string(),
  host: z.string(),
  source: z.record(z.unknown()).optional(),
});
export type NormalizedHit = z.infer<typeof NormalizedHitSchema>;

// ─── API request schemas ────────────────────────────────────────────────────

export const SaveCredsBodySchema = z.object({
  endpoint_id: z.string().min(1),
  username: z.string().min(1).max(120),
  password: z.string().min(1),
});

export const CreateSavedSearchSchema = z.object({
  name: z.string().min(1).max(80),
  params: SavedSearchParamsSchema,
  folder_id: z.string().nullable().optional(),
});

export const UpdateSavedSearchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  params: SavedSearchParamsSchema.optional(),
  folder_id: z.string().nullable().optional(),
});

export const CreateFolderSchema = z.object({
  name: z.string().min(1).max(60),
  color: z.string().optional(),
});

export const UpdateFolderSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  color: z.string().optional(),
});
