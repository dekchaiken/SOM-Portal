// src/restart-monitor/types.ts
// Zod schemas matching v1 data file structure exactly.
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Pod restart record (one row in a raw report)
// ---------------------------------------------------------------------------
export const PodRestart = z.object({
  pod: z.string(),
  container: z.string(),
  namespace: z.string(),
  restartCount: z.number(),
  terminationReason: z.string().nullable().default(null),
  restartedAt: z.string().nullable().default(null),
  restartedAtUnix: z.number().nullable().default(null),
  podCreatedUnix: z.number().nullable().default(null),
  podAgeSeconds: z.number().nullable().default(null),
  podAgeDays: z.number().nullable().default(null),
  memoryUsedBytes: z.number().nullable().default(null),
  memoryLimitBytes: z.number().nullable().default(null),
  memoryUsageRatio: z.number().nullable().default(null),
  cpuUsedCores: z.number().nullable().default(null),
  cpuLimitCores: z.number().nullable().default(null),
  cpuUsageRatio: z.number().nullable().default(null),
  priority: z.string().optional().default('normal'),
  severity: z.string().optional().default('info'),
});
export type PodRestart = z.infer<typeof PodRestart>;

// ---------------------------------------------------------------------------
// HPA event (scale history)
// ---------------------------------------------------------------------------
export const HpaEvent = z.object({
  currentReplicas: z.number().nullable().default(null),
  scaleEvents24h: z.number().default(0),
  scaleTimeline: z
    .array(
      z.object({
        ts: z.number(),
        time: z.string(),
        from: z.number(),
        to: z.number(),
      }),
    )
    .optional()
    .default([]),
});
export type HpaEvent = z.infer<typeof HpaEvent>;

// ---------------------------------------------------------------------------
// Severity + reason summaries
// ---------------------------------------------------------------------------
export const SeveritySummary = z.object({
  critical: z.number().default(0),
  warning: z.number().default(0),
  info: z.number().default(0),
});
export type SeveritySummary = z.infer<typeof SeveritySummary>;

export const ReasonSummary = z.record(z.string(), z.number()).default({});
export type ReasonSummary = z.infer<typeof ReasonSummary>;

// ---------------------------------------------------------------------------
// Raw report — one per date per runway
// Matches v1 file: data/sm/grafana-monitoring/raw/<runway>/<date>.json
// ---------------------------------------------------------------------------
export const RawReport = z.object({
  date: z.string(),
  generatedAt: z.string(),
  source: z.string().default('browser'),
  runway: z.string(),
  cluster: z.string().default(''),
  scanWindowHours: z.number().default(24),
  totalPods: z.number(),
  totalRestarts: z.number(),
  severitySummary: SeveritySummary,
  reasonSummary: ReasonSummary,
  hpaEvents: z.record(z.string(), HpaEvent).optional().default({}),
  pods: z.array(PodRestart).default([]),
});
export type RawReport = z.infer<typeof RawReport>;

// ---------------------------------------------------------------------------
// Runway configuration — from grafana-runways.json
// ---------------------------------------------------------------------------
export const RunwayConfig = z.object({
  name: z.string(),
  slug: z.string(),
  grafanaUrl: z.string(),
  tokenEnv: z.string(),
  orgId: z.union([z.string(), z.number()]),
  dsUid: z.string(),
  cluster: z.string().default(''),
  namespaceRegex: z.string().default('.+'),
  namespaceExclude: z.string().default(''),
  podExclude: z.string().default(''),
  chatWebhookEnv: z.string().optional().default(''),
  color: z.string().optional().default('#3b82f6'),
});
export type RunwayConfig = z.infer<typeof RunwayConfig>;

export const RunwaysFile = z.object({
  runways: z.array(RunwayConfig).default([]),
});
export type RunwaysFile = z.infer<typeof RunwaysFile>;

// ---------------------------------------------------------------------------
// Webhook config — restart-monitor-webhooks.json
// ---------------------------------------------------------------------------
export const WebhookConfig = z.object({
  webhooks: z.record(z.string(), z.string()).default({}),
  updatedAt: z.string().optional(),
  updatedBy: z.string().optional(),
});
export type WebhookConfig = z.infer<typeof WebhookConfig>;

// ---------------------------------------------------------------------------
// Monthly report recipients
// ---------------------------------------------------------------------------
export const MonthlyRecipients = z.object({
  recipients: z
    .array(
      z.object({
        email: z.string().email(),
        name: z.string().optional().default(''),
      }),
    )
    .default([]),
  updatedAt: z.string().optional(),
  updatedBy: z.string().optional(),
});
export type MonthlyRecipients = z.infer<typeof MonthlyRecipients>;

// ---------------------------------------------------------------------------
// Report list summary (used in API list responses)
// ---------------------------------------------------------------------------
export const ReportSummary = z.object({
  date: z.string(),
  runway: z.string(),
  generatedAt: z.string().nullable().default(null),
  totalPods: z.number().default(0),
  totalRestarts: z.number().default(0),
  reasonSummary: ReasonSummary,
  severitySummary: SeveritySummary,
});
export type ReportSummary = z.infer<typeof ReportSummary>;

export const RunwayTotals = z.object({
  totalDays: z.number().default(0),
  totalPods7d: z.number().default(0),
  totalRestarts7d: z.number().default(0),
  totalCritical7d: z.number().default(0),
  totalOOMKilled30d: z.number().default(0),
  totalRestarts30d: z.number().optional().default(0),
});
export type RunwayTotals = z.infer<typeof RunwayTotals>;
