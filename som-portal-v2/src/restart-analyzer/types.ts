// src/restart-analyzer/types.ts
// Zod schemas for the restart analyzer — matches v1 api/restart-analyzer responses.
import { z } from 'zod';

export const CascadeStep = z.object({
  id: z.string(),
  title: z.string(),
  verdict: z.enum(['triggered', 'clear', 'fail', 'warn', 'pass', 'inconclusive']),
  narrative: z.string(),
  evidence: z.string(),
  evidenceRefs: z.array(z.string()).optional().default([]),
});
export type CascadeStep = z.infer<typeof CascadeStep>;

export const Candidate = z.object({
  key: z.string(),
  label: z.string(),
  score: z.number(),
  reason: z.string(),
  evidence: z.array(z.string()).optional().default([]),
});
export type Candidate = z.infer<typeof Candidate>;

export const AffectedPod = z.object({
  pod: z.string(),
  namespace: z.string(),
  count: z.number(),
  reason: z.string().default('unknown'),
  restartedAtUnix: z.number().nullable().default(null),
  node: z.string().nullable().default(null),
});
export type AffectedPod = z.infer<typeof AffectedPod>;

export const TimelinePoint = z.tuple([z.number(), z.number()]);

export const AnalysisResult = z.object({
  service: z.string(),
  range: z.string(),
  rangeSec: z.number(),
  namespace: z.string().nullable().default(null),
  fetchedAt: z.string(),
  fromCache: z.boolean().default(false),
  restartCount: z.number(),
  affectedPods: z.array(AffectedPod).default([]),
  reasonCounts: z.record(z.string(), z.number()).default({}),
  primaryReason: z.string(),
  coordSpanSec: z.number().nullable().default(null),
  memPeakPct: z.number().default(0),
  memFailcnt: z.number().default(0),
  cpuPeakPct: z.number().default(0),
  cpuThrottleSec: z.number().default(0),
  cpuThrottlePct: z.number().default(0),
  timeline: z
    .object({
      mem: z.array(z.tuple([z.number(), z.number()])).default([]),
      cpu: z.array(z.tuple([z.number(), z.number()])).default([]),
      restarts: z.array(z.tuple([z.number(), z.number()])).default([]),
    })
    .default({ mem: [], cpu: [], restarts: [] }),
  cascade: z.array(CascadeStep).default([]),
  finalVerdict: z.string(),
  summary: z.string(),
  candidates: z.array(Candidate).default([]),
  // Additional v3/v4 fields
  isHotPod: z.boolean().default(false),
  hotPod: z.string().nullable().default(null),
  hotPodRestarts: z.number().default(0),
  hpaScaleEvent: z.boolean().default(false),
  hpaMin: z.number().default(0),
  hpaMax: z.number().default(0),
});
export type AnalysisResult = z.infer<typeof AnalysisResult>;

export const PodDetailResult = z.object({
  pod: z.string(),
  namespace: z.string(),
  restartedAt: z.number(),
  windowSec: z.number(),
  startUnix: z.number(),
  endUnix: z.number(),
  memBytes: z.array(z.tuple([z.number(), z.number()])).default([]),
  memPct: z.array(z.tuple([z.number(), z.number()])).default([]),
  cpuRate: z.array(z.tuple([z.number(), z.number()])).default([]),
  cpuPct: z.array(z.tuple([z.number(), z.number()])).default([]),
  throttleRate: z.array(z.tuple([z.number(), z.number()])).default([]),
  memLimit: z.number(),
  cpuLimit: z.number(),
  fetchedAt: z.string(),
});
export type PodDetailResult = z.infer<typeof PodDetailResult>;
