// som-portal-v2/src/ma/overview.ts
// MA Overview numbers: Jira stats for the year, the usecase registry, and the cut-off list.
// Same sources as v1 ma-services.html (landing) and api/ma-services/jira-stats.php.
import { listServices } from './services-store';
import { readSharedFile } from '@/team/scope';
import { z } from 'zod';

/** Summary written by the Jira sync: ma-services-jira-stats-<year>.json. */
export const JiraSummarySchema = z
  .object({
    year: z.number().default(0),
    total: z.number().default(0),
    tmn: z.object({ count: z.number().default(0), percent: z.number().default(0) }).default({ count: 0, percent: 0 }),
    nano: z.object({ count: z.number().default(0), percent: z.number().default(0) }).default({ count: 0, percent: 0 }),
    byMonth: z.array(z.object({ month: z.string(), count: z.number() })).default([]),
    byDomain: z.array(z.object({ key: z.string(), label: z.string().optional(), count: z.number(), percent: z.number().optional() })).default([]),
    pipeline: z
      .object({
        total: z.number().default(0),
        todo: z.number().default(0),
        inProgress: z.number().default(0),
        items: z.array(z.object({ key: z.string(), summary: z.string().default('') }).passthrough()).default([]),
      })
      .default({ total: 0, todo: 0, inProgress: 0, items: [] }),
    updatedAt: z.string().default(''),
    fromCache: z.boolean().default(false),
  })
  .passthrough();
export type JiraSummary = z.infer<typeof JiraSummarySchema>;

const CutoffFileSchema = z.object({ cutoffs: z.array(z.object({ site_type: z.string().nullable().optional() }).passthrough()).default([]) }).passthrough();

/** One domain name per usecase. The data has "WELTH" typos, so both spellings map to WEALTH. */
export function domainOf(serviceType: string | null | undefined): string {
  const t = (serviceType ?? '').trim().toUpperCase();
  if (t === 'WELTH' || t === 'WEALTH') return 'WEALTH';
  return t || 'OTHER';
}

function countBy<T>(items: T[], key: (x: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) {
    const k = key(it);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export interface MAOverview {
  year: number;
  jira: JiraSummary | null;
  usecases: { total: number; byDomain: Record<string, number> };
  cutoffs: { total: number; bySiteType: Record<string, number> };
}

export async function getOverview(year: number): Promise<MAOverview> {
  const [services, cutoffFile] = await Promise.all([
    listServices(),
    readSharedFile('cutoff-services.json', CutoffFileSchema),
  ]);
  const jira = await readSharedFile(`ma-services-jira-stats-${year}.json`, JiraSummarySchema).catch(() => null);
  const cutoffs = cutoffFile.cutoffs;
  return {
    year,
    jira,
    usecases: { total: services.length, byDomain: countBy(services, (s) => domainOf(s.service_type)) },
    cutoffs: {
      total: cutoffs.length,
      bySiteType: countBy(cutoffs, (c) => (c.site_type ?? '').trim() || 'Unknown'),
    },
  };
}
