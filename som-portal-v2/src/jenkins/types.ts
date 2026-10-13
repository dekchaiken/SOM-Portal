// som-portal-v2/src/jenkins/types.ts
//
// Zod schemas for the Jenkins + Batch surfaces. Field names are 1:1 with v1 so
// the PHP app and v2 can dual-run against the same JSON files:
//
//   data/<team>/jenkins_servers.json     (TEAM-SCOPED — see note below)
//   data/<team>/batch-records-YYYY-MM.json
//   data/<team>/batch_meta.json
//   data/sm/batch_file_index.json        (SM-SHARED)
//
// NOTE on scoping — `jenkins_servers.json` is listed in `teamOperationalFiles()`
// in api/helpers.php and is NOT in `smSharedFiles()`, so every team has its own
// copy with its own credentials and its own enabled/disabled set. Reading it
// from DATA_DIR root or from data/sm/ for a non-SM team would leak another
// team's Jenkins tokens. Always go through readTeamFile().
import { z } from 'zod';

// ─── jenkins_servers.json ────────────────────────────────────────────────────

/** `job_rules[]` entry. v1 validates only pattern+type but preserves the rest. */
export const JobRuleSchema = z
  .object({
    pattern: z.string(),
    type: z.enum(['ignore', 'remark']),
    match: z.string().optional(),
    remark: z.string().optional(),
  })
  .passthrough();
export type JobRule = z.infer<typeof JobRuleSchema>;

export const AUTH_MODES = ['token', 'cookie'] as const;
export const AuthModeSchema = z.enum(AUTH_MODES);
export type AuthMode = z.infer<typeof AuthModeSchema>;

/** Full record, credentials included. Admin-only — never send to the client. */
export const JenkinsServerSchema = z
  .object({
    id: z.string(),
    display: z.string().default(''),
    base_url: z.string().default(''),
    auth_mode: AuthModeSchema.catch('token').default('token'),
    auth_user: z.string().default(''),
    auth_token: z.string().default(''),
    auth_cookie: z.string().default(''),
    enabled: z.boolean().default(true),
    order: z.number().default(99),
    job_rules: z.array(z.unknown()).default([]),
    ip_override: z.string().default(''),
  })
  .passthrough();
export type JenkinsServer = z.infer<typeof JenkinsServerSchema>;

export const JenkinsServersFileSchema = z.array(JenkinsServerSchema).default([]);

/**
 * What the admin table receives: creds reduced to presence/length flags so the
 * page can show "token set" without shipping the secret to the browser.
 * (feedback_no_raw_data_fetch — API responses must be scrubbed.)
 */
export interface JenkinsServerAdminView {
  id: string;
  display: string;
  base_url: string;
  auth_mode: AuthMode;
  auth_user: string;
  has_token: boolean;
  token_len: number;
  has_cookie: boolean;
  cookie_len: number;
  enabled: boolean;
  order: number;
  job_rules: JobRule[];
  ip_override: string;
}

export function toAdminView(s: JenkinsServer): JenkinsServerAdminView {
  return {
    id: s.id,
    display: s.display,
    base_url: s.base_url,
    auth_mode: s.auth_mode,
    auth_user: s.auth_user,
    has_token: s.auth_token.length > 0,
    token_len: s.auth_token.length,
    has_cookie: s.auth_cookie.length > 0,
    cookie_len: s.auth_cookie.length,
    enabled: s.enabled,
    order: s.order,
    job_rules: parseJobRules(s.job_rules),
    ip_override: s.ip_override,
  };
}

/**
 * `GET /api/v1/jenkins-proxy?list=1` shape — exactly the four fields v1 exposes
 * to every authenticated user (id, display, base_url, job_rules). No creds.
 */
export interface JenkinsServerListItem {
  id: string;
  display: string;
  base_url: string;
  job_rules: JobRule[];
}

/** Drop malformed rules the same way v1's array_filter does. */
export function parseJobRules(raw: unknown): JobRule[] {
  if (!Array.isArray(raw)) return [];
  const out: JobRule[] = [];
  for (const r of raw) {
    const p = JobRuleSchema.safeParse(r);
    if (p.success) out.push(p.data);
  }
  return out;
}

// ─── Create / update payloads (admin) ────────────────────────────────────────

const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;

/** Mirrors PHP's FILTER_VALIDATE_IP (v4 + v6) closely enough for form input. */
export function isValidIp(v: string): boolean {
  if (IPV4.test(v)) {
    return v.split('.').every((o) => {
      const n = Number(o);
      return n >= 0 && n <= 255 && String(n) === String(Number(o));
    });
  }
  // IPv6: hex groups with at most one '::' elision.
  if (!v.includes(':')) return false;
  if ((v.match(/::/g) ?? []).length > 1) return false;
  const groups = v.split(':').filter((g) => g !== '');
  if (groups.length === 0 || groups.length > 8) return false;
  return groups.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g));
}

const ipOverrideField = z
  .string()
  .trim()
  .refine((v) => v === '' || isValidIp(v), 'IP Override must be a valid IPv4/IPv6 address');

export const ServerCreateSchema = z.object({
  display: z.string().trim().min(1, 'Display name is required'),
  base_url: z.string().trim().min(1, 'Base URL is required'),
  auth_mode: AuthModeSchema.catch('token').default('token'),
  auth_user: z.string().trim().default(''),
  auth_token: z.string().trim().default(''),
  auth_cookie: z.string().trim().default(''),
  enabled: z.boolean().default(true),
  order: z.coerce.number().int().default(99),
  job_rules: z.array(z.unknown()).default([]),
  ip_override: ipOverrideField.default(''),
});
export type ServerCreateInput = z.input<typeof ServerCreateSchema>;

/** PATCH — every field optional; v1 only touches keys present in the body. */
export const ServerUpdateSchema = z.object({
  display: z.string().trim().optional(),
  base_url: z.string().trim().optional(),
  auth_mode: AuthModeSchema.optional(),
  auth_user: z.string().trim().optional(),
  auth_token: z.string().trim().optional(),
  auth_cookie: z.string().trim().optional(),
  enabled: z.boolean().optional(),
  order: z.coerce.number().int().optional(),
  job_rules: z.array(z.unknown()).optional(),
  ip_override: ipOverrideField.optional(),
});
export type ServerUpdateInput = z.infer<typeof ServerUpdateSchema>;

// ─── Jenkins API response slices we actually read ─────────────────────────────

export const JenkinsJobSchema = z
  .object({
    name: z.string().default(''),
    url: z.string().default(''),
    color: z.string().optional(),
    _class: z.string().optional(),
    jobs: z.array(z.unknown()).optional(), // folders
  })
  .passthrough();
export type JenkinsJob = z.infer<typeof JenkinsJobSchema>;

export const JenkinsJobListSchema = z
  .object({
    jobs: z.array(JenkinsJobSchema).default([]),
  })
  .passthrough();

export const JenkinsParamDefSchema = z
  .object({
    name: z.string().default(''),
    type: z.string().optional(),
    description: z.string().optional(),
    defaultParameterValue: z
      .object({ value: z.unknown().optional() })
      .passthrough()
      .nullable()
      .optional(),
    choices: z.array(z.string()).optional(),
  })
  .passthrough();
export type JenkinsParamDef = z.infer<typeof JenkinsParamDefSchema>;

export const JenkinsJobDetailSchema = z
  .object({
    name: z.string().default(''),
    url: z.string().default(''),
    displayName: z.string().optional(),
    buildable: z.boolean().optional(),
    description: z.string().optional(),
    property: z
      .array(
        z
          .object({
            _class: z.string().optional(),
            parameterDefinitions: z.array(JenkinsParamDefSchema).optional(),
          })
          .passthrough(),
      )
      .default([]),
    builds: z
      .array(
        z
          .object({
            number: z.number(),
            result: z.string().nullable().optional(),
            timestamp: z.number().optional(),
            duration: z.number().optional(),
            url: z.string().optional(),
            building: z.boolean().optional(),
          })
          .passthrough(),
      )
      .default([]),
    jobs: z.array(JenkinsJobSchema).optional(),
  })
  .passthrough();
export type JenkinsJobDetail = z.infer<typeof JenkinsJobDetailSchema>;

/** Jenkins build results that will never change again. Polling stops here. */
export const TERMINAL_RESULTS = ['SUCCESS', 'FAILURE', 'UNSTABLE', 'ABORTED', 'NOT_BUILT'] as const;
export function isTerminalResult(result: string | null | undefined): boolean {
  return !!result && (TERMINAL_RESULTS as readonly string[]).includes(result);
}

/** Extract parameter definitions from a job detail payload. */
export function parameterDefinitions(detail: JenkinsJobDetail): JenkinsParamDef[] {
  for (const p of detail.property) {
    if (p.parameterDefinitions?.length) return p.parameterDefinitions;
  }
  return [];
}

// ─── batch-records-YYYY-MM.json ──────────────────────────────────────────────

/** Per-job cell in a Batch Daily Report. `jobs` is a MAP, not an array. */
export const BatchJobEntrySchema = z
  .object({
    status: z.string().default(''),
    remark: z.string().default(''),
    folder: z.string().default(''),
  })
  .passthrough();
export type BatchJobEntry = z.infer<typeof BatchJobEntrySchema>;

export const BatchRecordSchema = z
  .object({
    id: z.string(),
    timestamp: z.string().default(''),
    reporter: z.string().default(''),
    server: z.string().default(''),
    jobs: z.record(z.string(), BatchJobEntrySchema).default({}),
    backfilled: z.boolean().optional(),
    backfilled_at: z.string().optional(),
    backfilled_by: z.string().optional(),
  })
  .passthrough();
export type BatchRecord = z.infer<typeof BatchRecordSchema>;

export const BatchRecordsFileSchema = z.array(BatchRecordSchema).default([]);

export const BatchSubmitSchema = z.object({
  timestamp: z.string().optional(),
  reporter: z.string().trim().min(1),
  server: z.string().default(''),
  jobs: z.record(z.string(), BatchJobEntrySchema.partial().passthrough()),
  backfill: z.boolean().optional(),
});
export type BatchSubmitInput = z.infer<typeof BatchSubmitSchema>;

export type CoverageStatus = 'ok' | 'partial' | 'missing' | 'future';

export interface CoverageDay {
  date: string;
  weekday: string;
  dow: number;
  is_weekend: boolean;
  holiday: string | null;
  future: boolean;
  submitted_servers: string[];
  missing_servers: string[];
  records: number;
  backfilled: number;
  status: CoverageStatus;
}

export interface CoverageResult {
  month: string;
  today: string;
  expected_servers: string[];
  days: CoverageDay[];
  summary: Record<CoverageStatus, number>;
}

export const HolidaySchema = z
  .object({ date: z.string().default(''), name: z.string().default('') })
  .passthrough();
export const HolidaysFileSchema = z.array(HolidaySchema).default([]);

// ─── batch_file_index.json (SM-shared) ───────────────────────────────────────

export const FileIndexEntrySchema = z
  .object({
    server_id: z.string().default(''),
    server_display: z.string().default(''),
    job_name: z.string().default(''),
    job_path: z.string().default(''),
    job_url: z.string().default(''),
    first_seen_at: z.string().optional(),
    last_seen_at: z.string().optional(),
    last_seen_build: z.number().optional(),
    raw_sample: z.string().optional(),
    log_snippet: z.string().optional(),
    match_kind: z.string().optional(),
  })
  .passthrough();
export type FileIndexEntry = z.infer<typeof FileIndexEntrySchema>;

export const BatchFileIndexSchema = z
  .object({
    patterns: z.record(z.string(), z.array(FileIndexEntrySchema)).default({}),
    generated_at: z.string().nullable().optional(),
  })
  .passthrough()
  .default({ patterns: {} });
export type BatchFileIndex = z.infer<typeof BatchFileIndexSchema>;

// ─── batch_meta.json (per-team) ──────────────────────────────────────────────

export const BatchMetaEntrySchema = z
  .object({
    pattern: z.string().default(''),
    dev_owner: z.string().default(''),
    sm_rerun: z.string().default(''),
    manual_url: z.string().default(''),
    category: z.string().default(''),
    note: z.string().default(''),
  })
  .passthrough();
export type BatchMetaEntry = z.infer<typeof BatchMetaEntrySchema>;

export const BatchMetaFileSchema = z
  .object({
    entries: z.array(BatchMetaEntrySchema).default([]),
    configs: z.array(z.unknown()).default([]),
  })
  .passthrough()
  .default({ entries: [], configs: [] });

export type MatchConfidence = 'exact' | 'partial' | 'fuzzy';

export interface FileIndexMatch {
  pattern: string;
  confidence: MatchConfidence;
  score?: number;
  entry: FileIndexEntry;
  batch_meta?: {
    dev_owner: string;
    sm_rerun: string;
    manual_url: string;
    category: string;
    note: string;
  };
}

export interface FileIndexLookupResult {
  filename: string;
  cleaned: string;
  normalized: string;
  tier: MatchConfidence | null;
  total: number;
  matches: FileIndexMatch[];
  index_size: number;
  index_generated: string | null;
}
