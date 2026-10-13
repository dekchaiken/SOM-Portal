// som-portal-v2/src/service-performance/schema.ts
//
// Zod schemas for Service Performance — field names match v1 API responses 1:1.

import { z } from 'zod';

// ─── Source config (service-performance-sources.json) ───────────────────────

export const SourceConfigSchema = z.object({
  name: z.string(),
  slug: z.string(),
  runway: z.string().optional().default(''),
  grafanaUrl: z.string(),
  orgId: z.number().default(0),
  dsUid: z.string().default(''),
  jvmDsUid: z.string().optional().default(''),
  authMode: z.enum(['basic', 'token']).default('basic'),
  token: z.string().default(''),
  labelScheme: z.enum(['k8s', 'appScope']).default('k8s'),
  cluster: z.string().default(''),
  namespaceRegex: z.string().default('.+'),
  namespaceExclude: z.string().default(''),
  podExclude: z.string().default(''),
  envName: z.string().optional().default('prod'),
  appScope: z.string().optional().default('.+'),
  dashboardUid: z.string().default(''),
  dashboardVarName: z.string().default('App'),
  color: z.string().default('#71717a'),
  enabled: z.boolean().default(true),
});
export type SourceConfig = z.infer<typeof SourceConfigSchema>;

export const SourcesFileSchema = z.object({
  sources: z.array(SourceConfigSchema).default([]),
  cacheTtlSeconds: z.number().default(60),
  sheetEmbedUrl: z.string().default(''),
  sheetOpenUrl: z.string().default(''),
  serviceInventoryCsvPath: z.string().default(''),
});
export type SourcesFile = z.infer<typeof SourcesFileSchema>;

// ─── Per-service row (matches v1 spFetchSource → services[] shape) ──────────

export const ServiceRowSchema = z.object({
  key: z.string(),
  service: z.string(),
  namespace: z.string().nullable().default(null),
  workloadType: z.string().nullable().default(null),
  pods: z.number().default(0),
  cpuCores: z.number().default(0),
  cpuLimitCores: z.number().default(0),
  cpuPct: z.number().nullable().default(null),
  memBytes: z.number().default(0),
  memLimitBytes: z.number().default(0),
  memPct: z.number().nullable().default(null),
  // Inventory enrichment fields
  inInventory: z.boolean().optional(),
  bu: z.string().optional(),
  team: z.string().optional(),
  severity: z.string().optional(),
});
export type ServiceRow = z.infer<typeof ServiceRowSchema>;

// ─── Runway snapshot (matches v1 spFetchSource / spGetSource return) ────────

export const TotalsSchema = z.object({
  services: z.number().default(0),
  pods: z.number().default(0),
  cpuHotspots: z.number().default(0),
  memHotspots: z.number().default(0),
});

export const RunwaySnapshotSchema = z.object({
  slug: z.string(),
  name: z.string(),
  orgId: z.number().default(0),
  color: z.string().default('#71717a'),
  labelScheme: z.string().default('k8s'),
  grafanaUrl: z.string().default(''),
  dashboardUid: z.string().default(''),
  fetchedAt: z.string(),
  services: z.array(ServiceRowSchema).default([]),
  totals: TotalsSchema.default({}),
  error: z.string().nullable().default(null),
  fromCache: z.boolean().default(false),
  hasInventory: z.boolean().default(false),
  _cacheAgeSeconds: z.number().optional(),
});
export type RunwaySnapshot = z.infer<typeof RunwaySnapshotSchema>;

// ─── Overview response (matches v1 GET /api/service-performance) ────────────

export const OverviewResponseSchema = z.object({
  runways: z.array(RunwaySnapshotSchema),
  sheetEmbedUrl: z.string().default(''),
  sheetOpenUrl: z.string().default(''),
  cacheTtlSeconds: z.number().default(60),
  sources: z.array(z.object({
    slug: z.string(),
    name: z.string(),
    orgId: z.number(),
    color: z.string(),
    labelScheme: z.string(),
    grafanaUrl: z.string(),
    dashboardUid: z.string(),
    dashboardVarName: z.string().default('App'),
    dsUid: z.string(),
    jvmDsUid: z.string().default(''),
    cluster: z.string().default(''),
    namespaceRegex: z.string().default(''),
    enabled: z.boolean(),
  })).default([]),
  hasInventory: z.boolean().default(false),
  showAll: z.boolean().default(false),
  unfilteredTotal: z.number().default(0),
});
export type OverviewResponse = z.infer<typeof OverviewResponseSchema>;

// ─── Per-pod detail row (matches v1 spFetchWorkloadPods → pods[]) ───────────

export const PodDetailSchema = z.object({
  pod: z.string(),
  cpuCores: z.number(),
  cpuLimitCores: z.number(),
  cpuPct: z.number().nullable(),
  memBytes: z.number(),
  memLimitBytes: z.number(),
  memPct: z.number().nullable(),
});
export type PodDetail = z.infer<typeof PodDetailSchema>;

// ─── Service detail response (matches v1 detail.php) ────────────────────────

export const ServiceDetailResponseSchema = z.object({
  service: z.string(),
  runway: z.string(),
  cluster: z.string().default(''),
  namespace: z.string().default(''),
  pods: z.array(PodDetailSchema).default([]),
  totals: z.object({
    pods: z.number().default(0),
    cpuCores: z.number().default(0),
    cpuLimitCores: z.number().default(0),
    cpuPct: z.number().nullable().default(null),
    memBytes: z.number().default(0),
    memLimitBytes: z.number().default(0),
    memPct: z.number().nullable().default(null),
  }),
  inventory: z.record(z.string(), z.string()).nullable().default(null),
  fromCache: z.boolean().default(false),
  error: z.string().nullable().default(null),
});
export type ServiceDetailResponse = z.infer<typeof ServiceDetailResponseSchema>;
