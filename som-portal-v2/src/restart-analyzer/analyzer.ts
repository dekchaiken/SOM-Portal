// src/restart-analyzer/analyzer.ts
// Port of api/restart-analyzer/index.php — per-service restart forensics.
// Delegates to ThanosClient for PromQL queries, then builds the cascade narrative.
import { ThanosClient, type PromResult } from '@/lib/promql/thanos-client';
import { escapeRegex, escapeMatcher } from '@/lib/promql';
import type { AnalysisResult, AffectedPod, CascadeStep, Candidate } from './types';

const RANGE_MAP: Record<string, number> = {
  '1h': 3600,
  '6h': 21600,
  '24h': 86400,
  '7d': 604800,
};

export interface GrafanaSource {
  grafanaUrl: string;
  dsUid: string;
  orgId: string | number;
  token: string;
  jvmDsUid?: string;
}

function scalarVal(results: PromResult[]): number {
  let sum = 0;
  for (const r of results) sum += parseFloat(r.value[1] ?? '0');
  return sum;
}

/**
 * Run multi-phase restart analysis for a given service.
 * Returns the full analysis result matching v1 shape.
 */
export async function analyzeService(
  src: GrafanaSource,
  service: string,
  range: string,
): Promise<AnalysisResult> {
  const rangeSec = RANGE_MAP[range];
  if (!rangeSec) throw new Error(`range must be 1h/6h/24h/7d, got: ${range}`);

  const client = new ThanosClient(
    {
      grafanaUrl: src.grafanaUrl.replace(/\/+$/, ''),
      dsUid: src.dsUid,
      orgId: String(src.orgId),
      token: src.token,
    },
    { timeoutMs: 30_000 },
  );

  const svcEsc = escapeRegex(service);
  const podRe = svcEsc + '.*';
  const rangeExpr = range;
  const now = Math.floor(Date.now() / 1000);
  const start = now - rangeSec;
  const step = Math.max(30, Math.round(rangeSec / 120));

  // Phase 1-5: instant queries
  const instant: Record<string, string> = {
    restartsTotal: `sum(increase(kube_pod_container_status_restarts_total{pod=~"${podRe}"}[${rangeExpr}]))`,
    perPodRestart: `sum by (pod, namespace) (increase(kube_pod_container_status_restarts_total{pod=~"${podRe}"}[${rangeExpr}])) > 0`,
    perPodReason: `sum by (pod, reason) (kube_pod_container_status_last_terminated_reason{pod=~"${podRe}"} > 0)`,
    containerStart: `container_start_time_seconds{pod=~"${podRe}",container!="POD",container!=""}`,
    podInfo: `kube_pod_info{pod=~"${podRe}"}`,
    memMax: `max(max_over_time(container_memory_working_set_bytes{pod=~"${podRe}",container!="POD",container!=""}[${rangeExpr}])) by (pod)`,
    memLimit: `max(kube_pod_container_resource_limits{pod=~"${podRe}",resource="memory"}) by (pod)`,
    cpuThrottlePct: `sum(increase(container_cpu_cfs_throttled_periods_total{pod=~"${podRe}",container!="POD",container!=""}[${rangeExpr}])) / sum(increase(container_cpu_cfs_periods_total{pod=~"${podRe}",container!="POD",container!=""}[${rangeExpr}])) * 100`,
    readyPods: `sum(kube_pod_status_ready{pod=~"${podRe}",condition="true"} == 1)`,
    totalPods: `sum(kube_pod_status_phase{pod=~"${podRe}",phase="Running"})`,
    hpaMin: `min(min_over_time(kube_deployment_status_replicas{deployment=~"${svcEsc}.*"}[${rangeExpr}]))`,
    hpaMax: `max(max_over_time(kube_deployment_status_replicas{deployment=~"${svcEsc}.*"}[${rangeExpr}]))`,
  };

  const q = await client.instantBatch(instant, now);

  // Phase 8: timeline range queries
  const timelineQueries: Record<string, string> = {
    memPctMax: `max(container_memory_working_set_bytes{pod=~"${podRe}",container!="POD",container!=""}) by () / on() group_left max(kube_pod_container_resource_limits{pod=~"${podRe}",resource="memory"}) * 100`,
    cpuPctMax: `max(rate(container_cpu_usage_seconds_total{pod=~"${podRe}",container!="POD",container!=""}[2m])) by () / on() group_left max(kube_pod_container_resource_limits{pod=~"${podRe}",resource="cpu"}) * 100`,
    restartRate: `sum(rate(kube_pod_container_status_restarts_total{pod=~"${podRe}"}[5m])) * 60`,
  };

  const rq = await client.rangeBatch(timelineQueries, start, now, step);

  // Process results
  const totalRestarts = Math.round(scalarVal(q['restartsTotal'] ?? []) * 10) / 10;

  // Per-pod analysis
  const perPod: AffectedPod[] = [];
  const podReasons = new Map<string, string>();
  for (const r of q['perPodReason'] ?? []) {
    const pod = r.metric['pod'] ?? '';
    const reason = r.metric['reason'] ?? '';
    if (pod && reason) {
      const priority: Record<string, number> = { OOMKilled: 3, Error: 2, Completed: 1 };
      const cur = podReasons.get(pod);
      const curPri = cur ? (priority[cur] ?? 0) : 0;
      const newPri = priority[reason] ?? 0;
      if (newPri >= curPri) podReasons.set(pod, reason);
    }
  }

  const startTimes = new Map<string, number>();
  for (const r of q['containerStart'] ?? []) {
    const pod = r.metric['pod'] ?? '';
    if (pod) startTimes.set(pod, parseFloat(r.value[1] ?? '0'));
  }

  const podNodes = new Map<string, string>();
  for (const r of q['podInfo'] ?? []) {
    const pod = r.metric['pod'] ?? '';
    const node = r.metric['node'] ?? '';
    if (pod && node) podNodes.set(pod, node);
  }

  for (const r of q['perPodRestart'] ?? []) {
    const pod = r.metric['pod'] ?? '';
    const ns = r.metric['namespace'] ?? '';
    const count = Math.round(parseFloat(r.value[1] ?? '0') * 10) / 10;
    if (!pod || count <= 0) continue;
    perPod.push({
      pod,
      namespace: ns,
      count,
      reason: podReasons.get(pod) ?? 'unknown',
      restartedAtUnix: startTimes.has(pod) ? Math.floor(startTimes.get(pod)!) : null,
      node: podNodes.get(pod) ?? null,
    });
  }
  perPod.sort((a, b) => (b.restartedAtUnix ?? 0) - (a.restartedAtUnix ?? 0));

  // Reason counts
  const reasonCounts: Record<string, number> = { OOMKilled: 0, Error: 0, Completed: 0, unknown: 0 };
  for (const p of perPod) reasonCounts[p.reason] = (reasonCounts[p.reason] ?? 0) + 1;

  let primaryReason = 'unknown';
  if (reasonCounts['OOMKilled'] > 0) primaryReason = 'OOMKilled';
  else if (reasonCounts['Error'] > reasonCounts['Completed']) primaryReason = 'Error';
  else if (reasonCounts['Completed'] > 0) primaryReason = 'Completed';

  // Memory peak
  const memPctByPod = new Map<string, number>();
  const memUsed = new Map<string, number>();
  for (const r of q['memMax'] ?? []) {
    const pod = r.metric['pod'] ?? '';
    if (pod) memUsed.set(pod, parseFloat(r.value[1] ?? '0'));
  }
  for (const r of q['memLimit'] ?? []) {
    const pod = r.metric['pod'] ?? '';
    const limit = parseFloat(r.value[1] ?? '0');
    const used = memUsed.get(pod) ?? 0;
    if (limit > 0) memPctByPod.set(pod, (used / limit) * 100);
  }
  let maxMemPct = 0;
  for (const v of memPctByPod.values()) if (v > maxMemPct) maxMemPct = v;
  maxMemPct = Math.round(maxMemPct * 10) / 10;

  const cpuThrottlePct = q['cpuThrottlePct']?.[0]
    ? Math.round(parseFloat(q['cpuThrottlePct'][0].value[1] ?? '0') * 10) / 10
    : 0;

  // Coordinated timing
  const recent = Array.from(startTimes.values()).filter((t) => now - t <= rangeSec + 300);
  const coordSpanSec =
    recent.length >= 2 ? Math.round(Math.max(...recent) - Math.min(...recent)) : null;

  // HPA
  const hpaMin = q['hpaMin']?.[0] ? parseInt(q['hpaMin'][0].value[1] ?? '0') : 0;
  const hpaMax = q['hpaMax']?.[0] ? parseInt(q['hpaMax'][0].value[1] ?? '0') : 0;
  const hpaScaleEvent = hpaMax - hpaMin >= 2;

  // Hot pod detection
  let maxRestartPod: string | null = null;
  let maxRestartCount = 0;
  for (const p of perPod) {
    if (p.count > maxRestartCount) {
      maxRestartCount = p.count;
      maxRestartPod = p.pod;
    }
  }
  const hotPodShare = totalRestarts > 0 ? (maxRestartCount / totalRestarts) * 100 : 0;
  const isHotPod = maxRestartCount >= 5 && hotPodShare >= 50;

  // Timeline
  const flattenSeries = (mat: typeof rq[string]): [number, number][] => {
    if (!mat?.[0]?.values) return [];
    return mat[0].values.map((p) => [parseInt(String(p[0])), parseFloat(String(p[1]))] as [number, number]);
  };

  // Build cascade
  const cascade: CascadeStep[] = [];
  const affectedCount = perPod.length;

  cascade.push({
    id: 'trigger',
    title: 'Restart detected?',
    verdict: totalRestarts > 0 ? 'triggered' : 'clear',
    narrative:
      totalRestarts > 0
        ? `Found ${totalRestarts} restarts across ${affectedCount} pods. Primary reason: ${primaryReason}`
        : 'No restarts in this window.',
    evidence: `restarts=${totalRestarts} pods=${affectedCount} reason=${primaryReason}`,
    evidenceRefs: ['restartCount'],
  });

  if (totalRestarts > 0) {
    cascade.push({
      id: 'memory',
      title: 'Memory pressure?',
      verdict:
        reasonCounts['OOMKilled'] > 0 ? 'fail' : maxMemPct >= 90 ? 'warn' : 'pass',
      narrative:
        reasonCounts['OOMKilled'] > 0
          ? `${reasonCounts['OOMKilled']} pods OOM-Killed. Memory peak: ${maxMemPct}%`
          : `Memory peak: ${maxMemPct}% of limit`,
      evidence: `peak=${maxMemPct}% OOMKilled=${reasonCounts['OOMKilled']}`,
      evidenceRefs: ['memPeak'],
    });

    cascade.push({
      id: 'cpu',
      title: 'CPU starvation?',
      verdict: cpuThrottlePct >= 5 ? 'warn' : 'pass',
      narrative: `CPU throttle: ${cpuThrottlePct}%`,
      evidence: `throttle=${cpuThrottlePct}%`,
      evidenceRefs: ['cpuPeak'],
    });

    if (coordSpanSec !== null) {
      cascade.push({
        id: 'coordinated',
        title: 'Coordinated restarts?',
        verdict: coordSpanSec <= 120 ? 'triggered' : 'clear',
        narrative:
          coordSpanSec <= 120
            ? `${affectedCount} pods restarted within ${coordSpanSec}s`
            : `Restarts spread over ${coordSpanSec}s — independent events`,
        evidence: `spread=${coordSpanSec}s pods=${affectedCount}`,
        evidenceRefs: ['coord'],
      });
    }
  }

  // Verdict
  let verdict = 'no-restart';
  let summary = 'No restarts detected.';
  if (affectedCount > 0) {
    if (reasonCounts['OOMKilled'] > 0) {
      verdict = 'oom';
      summary = `OOM-Killed: ${reasonCounts['OOMKilled']} pods exceeded memory limits (peak ${maxMemPct}%)`;
    } else if (isHotPod) {
      verdict = 'hot-pod';
      summary = `Hot pod: ${maxRestartPod} restarted ${maxRestartCount} times (${Math.round(hotPodShare)}% of all)`;
    } else if (reasonCounts['Error'] > 0) {
      verdict = 'app-crash';
      summary = `App crash: ${reasonCounts['Error']} pods exited with error code`;
    } else if (
      primaryReason === 'Completed' &&
      coordSpanSec !== null &&
      coordSpanSec <= 120
    ) {
      verdict = 'external-sigterm';
      summary = `Coordinated restart: ${affectedCount} pods within ${coordSpanSec}s, clean exit`;
    } else {
      verdict = 'individual-restart';
      summary = `Individual restarts: ${affectedCount} pods, primary reason: ${primaryReason}`;
    }
  }

  // Candidates
  const candidates: Candidate[] = [];
  if (affectedCount > 0) {
    if (reasonCounts['OOMKilled'] > 0)
      candidates.push({
        key: 'oom',
        label: 'Memory exhaustion',
        score: 95,
        reason: `${reasonCounts['OOMKilled']} OOM-Killed pods`,
      });
    if (isHotPod)
      candidates.push({
        key: 'hot-pod',
        label: 'Hot pod (single pod crash loop)',
        score: 80,
        reason: `${maxRestartPod} has ${maxRestartCount} restarts`,
      });
    if (reasonCounts['Error'] > 0)
      candidates.push({
        key: 'app-crash',
        label: 'Application crash',
        score: reasonCounts['Error'] > reasonCounts['Completed'] ? 90 : 60,
        reason: `${reasonCounts['Error']} pods exited with error`,
      });
    if (hpaScaleEvent)
      candidates.push({
        key: 'traffic-spike',
        label: 'Traffic spike',
        score: 50,
        reason: `HPA scaled ${hpaMin} -> ${hpaMax}`,
      });

    candidates.sort((a, b) => b.score - a.score);
  }

  return {
    service,
    range,
    rangeSec,
    namespace: perPod[0]?.namespace ?? null,
    fetchedAt: new Date().toISOString(),
    fromCache: false,
    restartCount: totalRestarts,
    affectedPods: perPod,
    reasonCounts,
    primaryReason,
    coordSpanSec,
    memPeakPct: maxMemPct,
    memFailcnt: 0,
    cpuPeakPct: 0,
    cpuThrottleSec: 0,
    cpuThrottlePct: cpuThrottlePct,
    timeline: {
      mem: flattenSeries(rq['memPctMax'] ?? []),
      cpu: flattenSeries(rq['cpuPctMax'] ?? []),
      restarts: flattenSeries(rq['restartRate'] ?? []),
    },
    cascade,
    finalVerdict: verdict,
    summary,
    candidates,
    isHotPod,
    hotPod: isHotPod ? maxRestartPod : null,
    hotPodRestarts: maxRestartCount,
    hpaScaleEvent,
    hpaMin,
    hpaMax,
  };
}
