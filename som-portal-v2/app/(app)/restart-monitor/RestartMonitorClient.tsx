'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Icon } from '@/icons';

interface PodRow {
  pod: string;
  container: string;
  namespace: string;
  restartCount: number;
  terminationReason: string | null;
  restartedAt: string | null;
  podAgeDays: number | null;
  memoryUsageRatio: number | null;
  cpuUsageRatio: number | null;
  severity: string;
}

interface RawReport {
  date: string;
  generatedAt: string;
  runway: string;
  totalPods: number;
  totalRestarts: number;
  severitySummary: { critical: number; warning: number; info: number };
  reasonSummary: Record<string, number>;
  pods: PodRow[];
}

interface ReportSummary {
  date: string;
  runway: string;
  generatedAt: string | null;
  totalPods: number;
  totalRestarts: number;
}

interface RunwayMeta {
  name: string;
  slug: string;
  cluster?: string;
  color?: string;
}

interface ListData {
  byRunway: Record<string, { reports: ReportSummary[] }>;
  runways: RunwayMeta[];
}

const PAGE_SIZE = 25;

function severityBadge(severity: string) {
  const map: Record<string, 'success' | 'warning' | 'danger' | 'default'> = {
    info: 'success',
    warning: 'warning',
    critical: 'danger',
  };
  return map[severity] ?? 'default';
}

function restartColor(count: number): string {
  if (count === 0) return 'var(--chip-success-fg)';
  if (count <= 3) return 'var(--chip-warning-fg)';
  if (count <= 9) return '#f97316';
  return 'var(--chip-danger-fg)';
}

export function RestartMonitorClient() {
  const [runways, setRunways] = useState<RunwayMeta[]>([]);
  const [activeRunway, setActiveRunway] = useState('');
  const [reportList, setReportList] = useState<ReportSummary[]>([]);
  const [selectedDate, setSelectedDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [detail, setDetail] = useState<RawReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [fetchingData, setFetchingData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState<'restartCount' | 'pod' | 'namespace' | 'memoryUsageRatio' | 'cpuUsageRatio'>('restartCount');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);

  const fetchList = useCallback(async () => {
    try {
      setLoading(true);
      const q = activeRunway ? `?runway=${encodeURIComponent(activeRunway)}` : '';
      const res = await fetch(`/v2/api/restart-monitor${q}`);
      const json = await res.json();
      if (json.success) {
        const data = json.data as ListData;
        if (data.runways) setRunways(data.runways);
        if (activeRunway && data.byRunway) {
          const slug = data.runways.find((r) => r.name === activeRunway)?.slug ?? '';
          const rw = data.byRunway[slug] ?? Object.values(data.byRunway)[0];
          setReportList(rw?.reports ?? []);
        } else if (data.byRunway) {
          const all: ReportSummary[] = [];
          for (const v of Object.values(data.byRunway)) all.push(...(v.reports ?? []));
          all.sort((a, b) => b.date.localeCompare(a.date));
          setReportList(all);
        }
        setError(null);
      } else {
        setError(json.message ?? 'Failed to load');
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [activeRunway]);

  const fetchDetail = useCallback(async (date: string) => {
    if (!activeRunway && runways.length === 0) return;
    try {
      setDetailLoading(true);
      const runway = activeRunway || runways[0]?.name || '';
      const slug = runways.find((r) => r.name === runway)?.slug ?? '';
      const res = await fetch(
        `/v2/api/restart-monitor?action=detail&date=${date}&slug=${encodeURIComponent(slug)}`,
      );
      const json = await res.json();
      if (json.success) {
        setDetail(json.data);
        setPage(0);
      } else {
        setDetail(null);
      }
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, [activeRunway, runways]);

  const triggerFetch = async () => {
    setFetchingData(true);
    try {
      const runway = activeRunway || '';
      const q = new URLSearchParams({ date: selectedDate });
      if (runway) q.set('runway', runway);
      const res = await fetch(`/v2/api/restart-monitor/fetch?${q}`, { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        await fetchList();
        await fetchDetail(selectedDate);
      } else {
        setError(json.message);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setFetchingData(false);
    }
  };

  useEffect(() => { fetchList(); }, [fetchList]);
  useEffect(() => {
    if (selectedDate && runways.length > 0) fetchDetail(selectedDate);
  }, [selectedDate, fetchDetail, runways.length]);

  const toggleSort = (col: typeof sortCol) => {
    if (sortCol === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortCol(col); setSortDir('desc'); }
  };

  const filteredPods = (detail?.pods ?? [])
    .filter((p) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return p.pod.toLowerCase().includes(q) || p.namespace.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      const av = a[sortCol] ?? 0;
      const bv = b[sortCol] ?? 0;
      if (typeof av === 'string' && typeof bv === 'string')
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === 'asc' ? Number(av) - Number(bv) : Number(bv) - Number(av);
    });

  const totalPages = Math.ceil(filteredPods.length / PAGE_SIZE);
  const pagedPods = filteredPods.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-4 p-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Restart Monitor</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchList} disabled={loading}>
            <Icon name="refresh-cw" size={14} /> Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-[var(--chip-danger-bg)] p-3 text-sm text-[var(--chip-danger-fg)]">
          {error}
        </div>
      )}

      {/* Runway Tabs */}
      {runways.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setActiveRunway('')}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              !activeRunway
                ? 'bg-[var(--accent)] text-white'
                : 'bg-[var(--surface-card)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]'
            }`}
          >
            All
          </button>
          {runways.map((rw) => (
            <button
              key={rw.slug}
              onClick={() => setActiveRunway(rw.name)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                activeRunway === rw.name
                  ? 'text-white'
                  : 'bg-[var(--surface-card)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]'
              }`}
              style={activeRunway === rw.name ? { backgroundColor: rw.color ?? 'var(--accent)' } : undefined}
            >
              {rw.name}
            </button>
          ))}
        </div>
      )}

      {/* Date + Fetch controls */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-3 py-1.5 text-sm"
        />
        <Button variant="outline" size="sm" onClick={triggerFetch} disabled={fetchingData}>
          {fetchingData ? 'Fetching...' : 'Fetch from Prometheus'}
        </Button>
      </div>

      {/* Summary KPIs */}
      {detail && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-xs text-[var(--text-muted)]">Total Pods</p>
              <p className="text-2xl font-bold">{detail.totalPods}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-xs text-[var(--text-muted)]">Total Restarts</p>
              <p className="text-2xl font-bold" style={{ color: restartColor(detail.totalRestarts) }}>
                {detail.totalRestarts}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-xs text-[var(--text-muted)]">OOMKilled</p>
              <p className="text-2xl font-bold text-[var(--chip-danger-fg)]">
                {detail.reasonSummary['OOMKilled'] ?? 0}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-xs text-[var(--text-muted)]">Critical</p>
              <p className="text-2xl font-bold text-[var(--chip-danger-fg)]">
                {detail.severitySummary.critical}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Pod Table */}
      {detailLoading && !detail && (
        <Card><CardContent className="p-8 text-center text-sm text-[var(--text-muted)]">Loading report...</CardContent></Card>
      )}

      {detail && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-sm">
                Pods — {detail.date} / {detail.runway}
              </CardTitle>
              <input
                type="text"
                placeholder="Filter pods..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-3 py-1 text-xs outline-none focus:ring-2 focus:ring-[var(--ring)]"
              />
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-[var(--text-muted)]">
                  <th className="cursor-pointer px-3 py-2" onClick={() => toggleSort('pod')}>
                    Pod {sortCol === 'pod' && (sortDir === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="cursor-pointer px-3 py-2" onClick={() => toggleSort('namespace')}>
                    Namespace {sortCol === 'namespace' && (sortDir === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="cursor-pointer px-3 py-2 text-right" onClick={() => toggleSort('restartCount')}>
                    Restarts {sortCol === 'restartCount' && (sortDir === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="px-3 py-2">Reason</th>
                  <th className="cursor-pointer px-3 py-2 text-right" onClick={() => toggleSort('memoryUsageRatio')}>
                    Mem% {sortCol === 'memoryUsageRatio' && (sortDir === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="cursor-pointer px-3 py-2 text-right" onClick={() => toggleSort('cpuUsageRatio')}>
                    CPU% {sortCol === 'cpuUsageRatio' && (sortDir === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="px-3 py-2">Severity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {pagedPods.map((p, i) => (
                  <tr key={`${p.pod}-${i}`} className="hover:bg-[var(--surface-hover)]">
                    <td className="max-w-[200px] truncate px-3 py-2 font-mono">{p.pod}</td>
                    <td className="px-3 py-2">{p.namespace}</td>
                    <td className="px-3 py-2 text-right font-medium" style={{ color: restartColor(p.restartCount) }}>
                      {p.restartCount}
                    </td>
                    <td className="px-3 py-2">
                      {p.terminationReason && (
                        <Badge variant={p.terminationReason === 'OOMKilled' ? 'danger' : 'default'}>
                          {p.terminationReason}
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {p.memoryUsageRatio != null ? `${Math.round(p.memoryUsageRatio * 100)}%` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {p.cpuUsageRatio != null ? `${Math.round(p.cpuUsageRatio * 100)}%` : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={severityBadge(p.severity)}>{p.severity}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredPods.length === 0 && (
              <p className="py-8 text-center text-sm text-[var(--text-muted)]">No pods found.</p>
            )}
          </CardContent>
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-[var(--border)] px-3 py-2">
              <span className="text-xs text-[var(--text-muted)]">
                {filteredPods.length} pods — page {page + 1}/{totalPages}
              </span>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}>
                  Prev
                </Button>
                <Button variant="outline" size="sm" onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Recent Reports */}
      {reportList.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Recent Reports</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-[var(--text-muted)]">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Runway</th>
                  <th className="px-3 py-2 text-right">Pods</th>
                  <th className="px-3 py-2 text-right">Restarts</th>
                  <th className="px-3 py-2">Generated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {reportList.slice(0, 14).map((r) => (
                  <tr
                    key={`${r.runway}-${r.date}`}
                    className="cursor-pointer hover:bg-[var(--surface-hover)]"
                    onClick={() => setSelectedDate(r.date)}
                  >
                    <td className="px-3 py-2 font-medium">{r.date}</td>
                    <td className="px-3 py-2">{r.runway}</td>
                    <td className="px-3 py-2 text-right">{r.totalPods}</td>
                    <td className="px-3 py-2 text-right" style={{ color: restartColor(r.totalRestarts) }}>
                      {r.totalRestarts}
                    </td>
                    <td className="px-3 py-2 text-[var(--text-muted)]">
                      {r.generatedAt ? new Date(r.generatedAt).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
