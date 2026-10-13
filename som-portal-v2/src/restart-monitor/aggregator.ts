// src/restart-monitor/aggregator.ts
// Port of _aggregate.php: daily -> 7d/30d aggregation, compute trends.
import type { ReportSummary, RunwayTotals } from './types';

export interface AggregatedStats {
  totalRestarts7d: number;
  totalRestarts30d: number;
  totalOOMKilled7d: number;
  totalOOMKilled30d: number;
  avgRestartsPerDay7d: number;
  avgRestartsPerDay30d: number;
  trend7d: 'up' | 'down' | 'flat';
  trend30d: 'up' | 'down' | 'flat';
  topPodsByRestarts: { pod: string; totalRestarts: number }[];
}

/**
 * Aggregate daily report summaries into weekly + monthly stats.
 * Reports must be sorted newest-first.
 */
export function aggregateReports(
  reports: ReportSummary[],
  totals: RunwayTotals,
): AggregatedStats {
  const now = new Date();
  let restarts7d = 0;
  let restarts30d = 0;
  let oomKilled7d = 0;
  let oomKilled30d = 0;
  let days7d = 0;
  let days30d = 0;

  // First half / second half of 7d window for trend calc
  let firstHalf7d = 0;
  let secondHalf7d = 0;
  let firstHalf30d = 0;
  let secondHalf30d = 0;

  for (const r of reports) {
    const d = new Date(r.date + 'T00:00:00+07:00');
    const daysAgo = Math.floor((now.getTime() - d.getTime()) / 86400000);

    if (daysAgo <= 7) {
      restarts7d += r.totalRestarts;
      oomKilled7d += r.reasonSummary['OOMKilled'] ?? 0;
      days7d++;
      if (daysAgo <= 3) secondHalf7d += r.totalRestarts;
      else firstHalf7d += r.totalRestarts;
    }
    if (daysAgo <= 30) {
      restarts30d += r.totalRestarts;
      oomKilled30d += r.reasonSummary['OOMKilled'] ?? 0;
      days30d++;
      if (daysAgo <= 15) secondHalf30d += r.totalRestarts;
      else firstHalf30d += r.totalRestarts;
    }
  }

  function computeTrend(first: number, second: number): 'up' | 'down' | 'flat' {
    if (first === 0 && second === 0) return 'flat';
    const ratio = first > 0 ? second / first : second > 0 ? 2 : 1;
    if (ratio > 1.2) return 'up';
    if (ratio < 0.8) return 'down';
    return 'flat';
  }

  return {
    totalRestarts7d: totals.totalRestarts7d || restarts7d,
    totalRestarts30d: totals.totalRestarts30d || restarts30d,
    totalOOMKilled7d: oomKilled7d,
    totalOOMKilled30d: totals.totalOOMKilled30d || oomKilled30d,
    avgRestartsPerDay7d: days7d > 0 ? Math.round((restarts7d / days7d) * 10) / 10 : 0,
    avgRestartsPerDay30d: days30d > 0 ? Math.round((restarts30d / days30d) * 10) / 10 : 0,
    trend7d: computeTrend(firstHalf7d, secondHalf7d),
    trend30d: computeTrend(firstHalf30d, secondHalf30d),
    topPodsByRestarts: [], // Populated from raw reports when needed
  };
}
