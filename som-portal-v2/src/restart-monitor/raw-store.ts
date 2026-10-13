// src/restart-monitor/raw-store.ts
// Read/write raw reports from grafana-monitoring/raw/<runway>/<date>.json
// Team-scoped via readTeamFile / writeTeamFile.
import fs from 'node:fs/promises';
import path from 'node:path';
import { getDataAdapter } from '@/data/json-adapter';
import { type TeamScope } from '@/data/adapter';
import { RawReport, type ReportSummary, type RunwayTotals, type RunwayConfig } from './types';

function rawPath(slug: string, date: string): string {
  return `grafana-monitoring/raw/${slug}/${date}.json`;
}

function dailyPath(slug: string, date: string): string {
  return `grafana-monitoring/daily/${slug}/${date}.json`;
}

/**
 * Read a single raw report for a runway+date.
 * Returns null if the file does not exist.
 */
export async function readRawReport(
  team: string,
  slug: string,
  date: string,
): Promise<RawReport | null> {
  const adapter = getDataAdapter();
  const scope: TeamScope = { team };
  const data = await adapter.read<unknown>(scope, rawPath(slug, date));
  if (!data) return null;
  const parsed = RawReport.safeParse(data);
  if (!parsed.success) {
    console.error(`[raw-store] schema drift: ${rawPath(slug, date)}`, parsed.error.flatten());
    return null;
  }
  return parsed.data;
}

/**
 * Write a raw report to disk (team-scoped).
 * Also writes the daily/ copy (same content + extra fields).
 */
export async function writeRawReport(
  team: string,
  slug: string,
  date: string,
  report: RawReport,
): Promise<void> {
  const adapter = getDataAdapter();
  const scope: TeamScope = { team };
  // Validate before write
  RawReport.parse(report);
  await adapter.write(scope, rawPath(slug, date), report);
  // Also write daily copy with extra metadata
  const daily = {
    ...report,
    source: report.source === 'browser' ? 'browser-auto' : report.source,
  };
  await adapter.write(scope, dailyPath(slug, date), daily);
}

/**
 * List all raw report dates for a runway (scans filesystem).
 */
export async function listRawReportDates(
  team: string,
  slug: string,
): Promise<string[]> {
  const adapter = getDataAdapter();
  const scope: TeamScope = { team };
  const dir = path.dirname(adapter.resolvePath(scope, rawPath(slug, 'x')));
  try {
    const files = await fs.readdir(dir);
    return files
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .map((f) => f.replace('.json', ''))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/**
 * List raw report summaries for a runway with totals.
 * Matches v1's raw-list action.
 */
export async function listRawReports(
  team: string,
  slug: string,
): Promise<{ reports: ReportSummary[]; totals: RunwayTotals }> {
  const dates = await listRawReportDates(team, slug);
  const reports: ReportSummary[] = [];
  const now = new Date();

  for (const date of dates) {
    const report = await readRawReport(team, slug, date);
    if (!report) continue;
    reports.push({
      date,
      runway: report.runway,
      generatedAt: report.generatedAt,
      totalPods: report.totalPods,
      totalRestarts: report.totalRestarts,
      reasonSummary: report.reasonSummary,
      severitySummary: report.severitySummary,
    });
  }

  // Compute totals matching v1 shape
  const totals: RunwayTotals = {
    totalDays: reports.length,
    totalPods7d: 0,
    totalRestarts7d: 0,
    totalCritical7d: 0,
    totalOOMKilled30d: 0,
    totalRestarts30d: 0,
  };

  for (const r of reports) {
    const d = new Date(r.date + 'T00:00:00+07:00');
    const daysAgo = Math.floor((now.getTime() - d.getTime()) / 86400000);
    if (daysAgo <= 7) {
      totals.totalPods7d += r.totalPods;
      totals.totalRestarts7d += r.totalRestarts;
      totals.totalCritical7d += r.severitySummary.critical;
    }
    if (daysAgo <= 30) {
      totals.totalOOMKilled30d += r.reasonSummary['OOMKilled'] ?? 0;
      totals.totalRestarts30d! += r.totalRestarts;
    }
  }

  return { reports, totals };
}

/**
 * List raw reports across all runways.
 */
export async function listAllRunwayReports(
  team: string,
  runways: RunwayConfig[],
): Promise<
  Record<string, { reports: ReportSummary[]; totals: RunwayTotals }>
> {
  const result: Record<string, { reports: ReportSummary[]; totals: RunwayTotals }> = {};
  await Promise.all(
    runways.map(async (rw) => {
      result[rw.slug] = await listRawReports(team, rw.slug);
    }),
  );
  return result;
}
