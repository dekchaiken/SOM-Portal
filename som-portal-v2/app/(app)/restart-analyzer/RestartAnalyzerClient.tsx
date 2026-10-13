'use client';

import { useCallback, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Icon } from '@/icons';

interface AffectedPod {
  pod: string;
  namespace: string;
  count: number;
  reason: string;
  restartedAtUnix: number | null;
  node: string | null;
}

interface CascadeStep {
  id: string;
  title: string;
  verdict: string;
  narrative: string;
  evidence: string;
}

interface Candidate {
  key: string;
  label: string;
  score: number;
  reason: string;
}

interface AnalysisResult {
  service: string;
  range: string;
  restartCount: number;
  affectedPods: AffectedPod[];
  reasonCounts: Record<string, number>;
  primaryReason: string;
  memPeakPct: number;
  cpuThrottlePct: number;
  cascade: CascadeStep[];
  finalVerdict: string;
  summary: string;
  candidates: Candidate[];
  isHotPod: boolean;
  hotPod: string | null;
  hotPodRestarts: number;
  hpaScaleEvent: boolean;
  hpaMin: number;
  hpaMax: number;
  fetchedAt: string;
}

interface PodDetailResult {
  pod: string;
  namespace: string;
  restartedAt: number;
  memPct: [number, number][];
  cpuPct: [number, number][];
  memLimit: number;
  cpuLimit: number;
  fetchedAt: string;
}

const RANGES = ['1h', '6h', '24h', '7d'] as const;

function verdictBadge(v: string): 'success' | 'warning' | 'danger' | 'default' {
  if (v === 'pass' || v === 'clear') return 'success';
  if (v === 'warn' || v === 'inconclusive') return 'warning';
  if (v === 'fail' || v === 'triggered') return 'danger';
  return 'default';
}

function formatBytes(b: number): string {
  if (b >= 1073741824) return `${(b / 1073741824).toFixed(1)} GB`;
  if (b >= 1048576) return `${(b / 1048576).toFixed(0)} MB`;
  return `${(b / 1024).toFixed(0)} KB`;
}

export function RestartAnalyzerClient() {
  const [service, setService] = useState('');
  const [range, setRange] = useState<string>('24h');
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedPod, setExpandedPod] = useState<string | null>(null);
  const [podDetail, setPodDetail] = useState<PodDetailResult | null>(null);
  const [podLoading, setPodLoading] = useState(false);

  const analyze = useCallback(async () => {
    if (!service.trim()) return;
    setLoading(true);
    setError(null);
    setAnalysis(null);
    try {
      const q = new URLSearchParams({ service: service.trim(), range });
      const res = await fetch(`/v2/api/restart-analyzer?${q}`);
      const json = await res.json();
      if (json.success) {
        setAnalysis(json.data);
      } else {
        setError(json.message ?? 'Analysis failed');
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [service, range]);

  const loadPodDetail = async (pod: string, ns: string, restartedAt: number | null) => {
    if (expandedPod === pod) {
      setExpandedPod(null);
      setPodDetail(null);
      return;
    }
    setExpandedPod(pod);
    setPodLoading(true);
    try {
      const q = new URLSearchParams({ pod, namespace: ns });
      if (restartedAt) q.set('restartedAt', String(restartedAt));
      const res = await fetch(`/v2/api/restart-analyzer/pod-detail?${q}`);
      const json = await res.json();
      if (json.success) setPodDetail(json.data);
      else setPodDetail(null);
    } catch {
      setPodDetail(null);
    } finally {
      setPodLoading(false);
    }
  };

  return (
    <div className="space-y-4 p-4">
      <h1 className="text-xl font-semibold">Restart Analyzer</h1>

      {/* Search */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-[var(--text-muted)]">Service name</label>
          <input
            type="text"
            value={service}
            onChange={(e) => setService(e.target.value)}
            placeholder="e.g. payment-service"
            onKeyDown={(e) => e.key === 'Enter' && analyze()}
            className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[var(--ring)]"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-[var(--text-muted)]">Range</label>
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  range === r
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--surface-card)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        <Button onClick={analyze} disabled={loading || !service.trim()}>
          {loading ? 'Analyzing...' : 'Analyze'}
        </Button>
      </div>

      {error && (
        <div className="rounded-md bg-[var(--chip-danger-bg)] p-3 text-sm text-[var(--chip-danger-fg)]">
          {error}
        </div>
      )}

      {analysis && (
        <>
          {/* Verdict */}
          <Card className={analysis.restartCount > 0 ? 'border-l-4 border-l-[var(--chip-danger-fg)]' : 'border-l-4 border-l-[var(--chip-success-fg)]'}>
            <CardContent className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold">{analysis.service}</h2>
                  <p className="mt-1 text-sm">{analysis.summary}</p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    Verdict: <strong>{analysis.finalVerdict}</strong> | {analysis.restartCount} restarts across {analysis.affectedPods.length} pods
                  </p>
                </div>
                <Badge variant={analysis.restartCount > 0 ? 'danger' : 'success'}>
                  {analysis.finalVerdict}
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card>
              <CardContent className="p-3 text-center">
                <p className="text-xs text-[var(--text-muted)]">Restarts</p>
                <p className="text-2xl font-bold">{analysis.restartCount}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 text-center">
                <p className="text-xs text-[var(--text-muted)]">OOMKilled</p>
                <p className="text-2xl font-bold text-[var(--chip-danger-fg)]">
                  {analysis.reasonCounts['OOMKilled'] ?? 0}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 text-center">
                <p className="text-xs text-[var(--text-muted)]">Mem Peak</p>
                <p className="text-2xl font-bold">{analysis.memPeakPct}%</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 text-center">
                <p className="text-xs text-[var(--text-muted)]">CPU Throttle</p>
                <p className="text-2xl font-bold">{analysis.cpuThrottlePct}%</p>
              </CardContent>
            </Card>
          </div>

          {/* Cascade */}
          {analysis.cascade.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Analysis Cascade</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 p-4 pt-0">
                {analysis.cascade.map((step) => (
                  <div
                    key={step.id}
                    className="flex items-start gap-3 rounded-md border border-[var(--border)] p-3"
                  >
                    <Badge variant={verdictBadge(step.verdict)} className="mt-0.5 shrink-0">
                      {step.verdict}
                    </Badge>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{step.title}</p>
                      <p className="text-xs text-[var(--text-muted)]">{step.narrative}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Root Cause Candidates */}
          {analysis.candidates.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Root Cause Candidates</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 p-4 pt-0">
                {analysis.candidates.map((c) => (
                  <div key={c.key} className="flex items-center gap-3">
                    <div
                      className="h-2 rounded-full bg-[var(--accent)]"
                      style={{ width: `${c.score}%`, maxWidth: 120, minWidth: 8 }}
                    />
                    <span className="text-sm font-medium">{c.label}</span>
                    <span className="text-xs text-[var(--text-muted)]">{c.score}% — {c.reason}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Affected Pods */}
          {analysis.affectedPods.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Affected Pods ({analysis.affectedPods.length})</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-left text-[var(--text-muted)]">
                      <th className="px-3 py-2">Pod</th>
                      <th className="px-3 py-2">Namespace</th>
                      <th className="px-3 py-2 text-right">Restarts</th>
                      <th className="px-3 py-2">Reason</th>
                      <th className="px-3 py-2">Node</th>
                      <th className="px-3 py-2">Restarted At</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {analysis.affectedPods.map((p) => (
                      <>
                        <tr
                          key={p.pod}
                          className="cursor-pointer hover:bg-[var(--surface-hover)]"
                          onClick={() => loadPodDetail(p.pod, p.namespace, p.restartedAtUnix)}
                        >
                          <td className="max-w-[200px] truncate px-3 py-2 font-mono">
                            <span className="mr-1">{expandedPod === p.pod ? '▼' : '▶'}</span>
                            {p.pod}
                          </td>
                          <td className="px-3 py-2">{p.namespace}</td>
                          <td className="px-3 py-2 text-right font-medium">{p.count}</td>
                          <td className="px-3 py-2">
                            <Badge variant={p.reason === 'OOMKilled' ? 'danger' : 'default'}>
                              {p.reason}
                            </Badge>
                          </td>
                          <td className="px-3 py-2 text-[var(--text-muted)]">{p.node ?? '—'}</td>
                          <td className="px-3 py-2 text-[var(--text-muted)]">
                            {p.restartedAtUnix
                              ? new Date(p.restartedAtUnix * 1000).toLocaleString()
                              : '—'}
                          </td>
                        </tr>
                        {expandedPod === p.pod && (
                          <tr key={`${p.pod}-detail`}>
                            <td colSpan={6} className="bg-[var(--surface-hover)] px-6 py-3">
                              {podLoading ? (
                                <p className="text-xs text-[var(--text-muted)]">Loading pod detail...</p>
                              ) : podDetail ? (
                                <div className="grid grid-cols-2 gap-4 text-xs sm:grid-cols-4">
                                  <div>
                                    <p className="text-[var(--text-muted)]">Memory Limit</p>
                                    <p className="font-medium">{formatBytes(podDetail.memLimit)}</p>
                                  </div>
                                  <div>
                                    <p className="text-[var(--text-muted)]">CPU Limit</p>
                                    <p className="font-medium">{podDetail.cpuLimit.toFixed(2)} cores</p>
                                  </div>
                                  <div>
                                    <p className="text-[var(--text-muted)]">Mem Data Points</p>
                                    <p className="font-medium">{podDetail.memPct.length}</p>
                                  </div>
                                  <div>
                                    <p className="text-[var(--text-muted)]">CPU Data Points</p>
                                    <p className="font-medium">{podDetail.cpuPct.length}</p>
                                  </div>
                                </div>
                              ) : (
                                <p className="text-xs text-[var(--text-muted)]">No detail available</p>
                              )}
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {/* HPA */}
          {analysis.hpaScaleEvent && (
            <Card>
              <CardContent className="p-4">
                <p className="text-sm">
                  <Icon name="alert-triangle" size={14} className="mr-1 inline text-[var(--chip-warning-fg)]" />
                  <strong>HPA Scale Event:</strong> Replicas scaled from {analysis.hpaMin} to {analysis.hpaMax}
                </p>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
