// src/restart-analyzer/pod-detail.ts
// Port of api/restart-analyzer/pod-detail.php — per-pod deep dive.
import { ThanosClient } from '@/lib/promql/thanos-client';
import { escapeMatcher } from '@/lib/promql';
import type { PodDetailResult } from './types';

export interface PodDetailSource {
  grafanaUrl: string;
  dsUid: string;
  orgId: string | number;
  token: string;
}

/**
 * Query per-pod resource timeline around a restart moment.
 */
export async function getPodDetail(
  src: PodDetailSource,
  pod: string,
  namespace: string,
  restartedAt: number,
  windowSec = 600,
): Promise<PodDetailResult> {
  const client = new ThanosClient(
    {
      grafanaUrl: src.grafanaUrl.replace(/\/+$/, ''),
      dsUid: src.dsUid,
      orgId: String(src.orgId),
      token: src.token,
    },
    { timeoutMs: 30_000 },
  );

  const podEsc = escapeMatcher(pod);
  const nsFilter = namespace ? `,namespace="${escapeMatcher(namespace)}"` : '';
  const start = restartedAt - windowSec * 4;
  const end = restartedAt + windowSec;
  const step = Math.max(10, Math.round((end - start) / 120));

  const queries: Record<string, string> = {
    memBytes: `max(container_memory_working_set_bytes{pod="${podEsc}"${nsFilter},container!="POD",container!=""})`,
    memLimit: `max(kube_pod_container_resource_limits{pod="${podEsc}"${nsFilter},resource="memory"})`,
    cpuRate: `sum(rate(container_cpu_usage_seconds_total{pod="${podEsc}"${nsFilter},container!="POD",container!=""}[1m]))`,
    cpuLimit: `max(kube_pod_container_resource_limits{pod="${podEsc}"${nsFilter},resource="cpu"})`,
    throttle: `sum(rate(container_cpu_cfs_throttled_seconds_total{pod="${podEsc}"${nsFilter},container!="POD",container!=""}[1m]))`,
  };

  const q = await client.rangeBatch(queries, start, end, step);

  const flattenSeries = (mat: typeof q[string]): [number, number][] => {
    if (!mat?.[0]?.values) return [];
    return mat[0].values.map((p) => [parseInt(String(p[0])), parseFloat(String(p[1]))] as [number, number]);
  };

  const memBytes = flattenSeries(q['memBytes'] ?? []);
  const cpuRate = flattenSeries(q['cpuRate'] ?? []);
  const throttle = flattenSeries(q['throttle'] ?? []);

  // Find last non-zero value in a series for limits
  const lastNonZero = (series: [number, number][]): number => {
    for (let i = series.length - 1; i >= 0; i--) {
      if (series[i]![1] > 0) return series[i]![1];
    }
    return 0;
  };

  const memLimitSeries = flattenSeries(q['memLimit'] ?? []);
  const cpuLimitSeries = flattenSeries(q['cpuLimit'] ?? []);
  const memLimit = lastNonZero(memLimitSeries);
  const cpuLimit = lastNonZero(cpuLimitSeries);

  // Build percent-of-limit series
  const memPct: [number, number][] = memLimit > 0
    ? memBytes.map((p) => [p[0], Math.round((p[1] / memLimit) * 10000) / 100])
    : [];
  const cpuPct: [number, number][] = cpuLimit > 0
    ? cpuRate.map((p) => [p[0], Math.round((p[1] / cpuLimit) * 10000) / 100])
    : [];

  return {
    pod,
    namespace,
    restartedAt,
    windowSec,
    startUnix: start,
    endUnix: end,
    memBytes,
    memPct,
    cpuRate,
    cpuPct,
    throttleRate: throttle,
    memLimit,
    cpuLimit,
    fetchedAt: new Date().toISOString(),
  };
}
