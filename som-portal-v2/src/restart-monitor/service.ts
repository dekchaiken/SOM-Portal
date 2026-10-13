// src/restart-monitor/service.ts
// Main service — orchestrates runways, raw-store, fetcher, aggregator.
import { requireAuth, requireRole, ADMIN_ROLES, ALL_STAFF_ROLES } from '@/auth/policy';
import type { Session } from '@/auth/session';
import { logActivity } from '@/logging/activity';
import { listRunways, findRunwayBySlug } from './runways';
import {
  readRawReport,
  writeRawReport,
  listRawReports,
  listAllRunwayReports,
} from './raw-store';
import { fetchRunwayData } from './fetcher';
import { aggregateReports, type AggregatedStats } from './aggregator';
import type {
  RunwayConfig,
  RawReport,
  ReportSummary,
  RunwayTotals,
} from './types';

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export interface MonitorListResult {
  byRunway: Record<string, { reports: ReportSummary[]; totals: RunwayTotals }>;
  runways: { name: string; slug: string; cluster: string; color?: string }[];
}

export async function listMonitorReports(
  session: Session,
  runwaySlug?: string,
): Promise<MonitorListResult> {
  const runways = await listRunways();

  if (runwaySlug) {
    const rw = runways.find((r) => r.slug === runwaySlug);
    if (!rw) throw new Error(`Unknown runway slug: ${runwaySlug}`);
    const data = await listRawReports(session.team, rw.slug);
    return {
      byRunway: { [rw.slug]: data },
      runways: runways.map((r) => ({
        name: r.name,
        slug: r.slug,
        cluster: r.cluster,
        color: r.color,
      })),
    };
  }

  const byRunway = await listAllRunwayReports(session.team, runways);
  return {
    byRunway,
    runways: runways.map((r) => ({
      name: r.name,
      slug: r.slug,
      cluster: r.cluster,
      color: r.color,
    })),
  };
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export async function getReportDetail(
  session: Session,
  slug: string,
  date: string,
): Promise<RawReport | null> {
  return readRawReport(session.team, slug, date);
}

// ---------------------------------------------------------------------------
// Fetch (trigger Prometheus query)
// ---------------------------------------------------------------------------

export interface FetchResult {
  runway: string;
  status: 'done' | 'skip' | 'error' | 'already_done';
  totalPods?: number;
  totalRestarts?: number;
  reason?: string;
}

export async function triggerFetch(
  session: Session,
  runwayName?: string,
  dateStr?: string,
  force = false,
): Promise<{ date: string; results: FetchResult[] }> {
  const runways = await listRunways();
  const targets = runwayName
    ? runways.filter((r) => r.name === runwayName)
    : runways;

  if (runwayName && targets.length === 0) {
    throw new Error(`Unknown runway: ${runwayName}`);
  }

  // Default to today 09:00 ICT
  const anchorDate =
    dateStr ?? new Date().toISOString().slice(0, 10);
  const anchor = new Date(`${anchorDate}T09:00:00+07:00`);
  const anchorTs = Math.floor(anchor.getTime() / 1000);

  const results: FetchResult[] = [];

  for (const rw of targets) {
    const token = process.env[rw.tokenEnv] ?? '';
    if (!token) {
      results.push({ runway: rw.name, status: 'skip', reason: `${rw.tokenEnv} not set` });
      continue;
    }

    // Check if already exists
    if (!force) {
      const existing = await readRawReport(session.team, rw.slug, anchorDate);
      if (existing) {
        results.push({ runway: rw.name, status: 'already_done' });
        continue;
      }
    }

    try {
      const report = await fetchRunwayData(rw, anchorDate, anchorTs, token);
      await writeRawReport(session.team, rw.slug, anchorDate, report);

      await logActivity({
        user: session.sub,
        team: session.team,
        action: 'restart_monitor_raw_fetch',
        meta: {
          date: anchorDate,
          runway: rw.name,
          totalPods: report.totalPods,
          totalRestarts: report.totalRestarts,
          triggeredBy: session.username,
        },
      });

      results.push({
        runway: rw.name,
        status: 'done',
        totalPods: report.totalPods,
        totalRestarts: report.totalRestarts,
      });
    } catch (e) {
      results.push({
        runway: rw.name,
        status: 'error',
        reason: (e as Error).message,
      });
    }
  }

  return { date: anchorDate, results };
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export async function getAggregatedStats(
  session: Session,
  slug: string,
): Promise<AggregatedStats> {
  const { reports, totals } = await listRawReports(session.team, slug);
  return aggregateReports(reports, totals);
}
