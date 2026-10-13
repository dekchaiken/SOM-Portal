// src/restart-monitor/fetcher.ts
// Port of _fetch_lib.php: queries Prometheus for pod restart data for one runway+date.
import { ThanosClient, type PromResult } from '@/lib/promql/thanos-client';
import { escapeMatcher } from '@/lib/promql';
import type { RunwayConfig, PodRestart, RawReport, SeveritySummary, ReasonSummary } from './types';

function mkKey(m: Record<string, string>): string {
  return `${m['pod'] ?? ''}|${m['container'] ?? ''}|${m['namespace'] ?? ''}`;
}

function buildIndex(results: PromResult[], extract: 'max' | 'first' = 'first'): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of results) {
    const k = mkKey(r.metric);
    const v = parseFloat(r.value[1] ?? '0');
    if (extract === 'max') {
      map.set(k, Math.max(map.get(k) ?? 0, v));
    } else if (!map.has(k)) {
      map.set(k, v);
    }
  }
  return map;
}

function buildStringIndex(results: PromResult[], label: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of results) {
    const k = mkKey(r.metric);
    if (!map.has(k)) {
      map.set(k, r.metric[label] ?? '');
    }
  }
  return map;
}

/**
 * Fetch restart data for one runway at a given anchor date.
 * Returns a RawReport ready for disk storage.
 */
export async function fetchRunwayData(
  rw: RunwayConfig,
  anchorDate: string,
  anchorTs: number,
  token: string,
): Promise<RawReport> {
  const client = new ThanosClient(
    {
      grafanaUrl: rw.grafanaUrl.replace(/\/+$/, ''),
      dsUid: rw.dsUid,
      orgId: String(rw.orgId),
      token,
    },
    { timeoutMs: 30_000 },
  );

  // Build base selector
  const parts: string[] = [];
  if (rw.cluster) parts.push(`cluster="${escapeMatcher(rw.cluster)}"`);
  parts.push(`namespace=~"${rw.namespaceRegex}"`);
  if (rw.namespaceExclude) parts.push(`namespace!~"${rw.namespaceExclude}"`);
  if (rw.podExclude) parts.push(`pod!~"${rw.podExclude}"`);
  const base = parts.join(',');
  const baseKs = `${base},job="kubernetes-state"`;

  // Batch all instant queries
  const queries: Record<string, string> = {
    restarts: `increase(kube_pod_container_status_restarts_total{${baseKs}}[24h]) > 0`,
    times: `last_over_time(kube_pod_container_status_last_terminated_timestamp{${base}}[24h])`,
    reasons: `last_over_time(kube_pod_container_status_last_terminated_reason{${base}}[24h]) > 0`,
    memUsed: `last_over_time(container_memory_working_set_bytes{${base},container!="",container!="POD"}[24h])`,
    memLimit: `last_over_time(kube_pod_container_resource_limits{${base},resource="memory",container!=""}[24h])`,
    cpuUsed: `last_over_time(rate(container_cpu_usage_seconds_total{${base},container!="",container!="POD"}[5m])[24h:30m])`,
    cpuLimit: `last_over_time(kube_pod_container_resource_limits{${base},resource="cpu",container!=""}[24h])`,
    podCreated: `kube_pod_created{${base}}`,
  };

  const q = await client.instantBatch(queries, anchorTs);

  const mapRestarts = buildIndex(q['restarts'] ?? [], 'max');
  const mapTimes = buildIndex(q['times'] ?? []);
  const mapReasons = buildStringIndex(q['reasons'] ?? [], 'reason');
  const mapMemUsed = buildIndex(q['memUsed'] ?? []);
  const mapMemLimit = buildIndex(q['memLimit'] ?? []);
  const mapCpuUsed = buildIndex(q['cpuUsed'] ?? []);
  const mapCpuLimit = buildIndex(q['cpuLimit'] ?? []);

  // Pod creation times (keyed by pod|namespace)
  const podCreated = new Map<string, number>();
  for (const r of q['podCreated'] ?? []) {
    const k = `${r.metric['pod'] ?? ''}|${r.metric['namespace'] ?? ''}`;
    if (!podCreated.has(k)) podCreated.set(k, parseFloat(r.value[1] ?? '0'));
  }

  // Build pod records
  const pods: PodRestart[] = [];
  for (const [key, rawCount] of mapRestarts.entries()) {
    const count = Math.round(rawCount);
    if (count < 1) continue;

    const [pod, container, namespace] = key.split('|');

    const timeUnix = mapTimes.get(key);
    const restartedAtUnix = timeUnix && timeUnix > 0 ? Math.floor(timeUnix) : null;
    const restartedAt = restartedAtUnix
      ? new Date(restartedAtUnix * 1000).toISOString()
      : null;

    const memUsedBytes = mapMemUsed.has(key) ? Math.floor(mapMemUsed.get(key)!) : null;
    const memLimitBytes = mapMemLimit.has(key) ? Math.floor(mapMemLimit.get(key)!) : null;
    const memRatio =
      memUsedBytes !== null && memLimitBytes && memLimitBytes > 0
        ? Math.round((memUsedBytes / memLimitBytes) * 10000) / 10000
        : null;

    const cpuCores = mapCpuUsed.has(key)
      ? Math.round(mapCpuUsed.get(key)! * 1000000) / 1000000
      : null;
    const cpuLimitCores = mapCpuLimit.has(key)
      ? Math.round(mapCpuLimit.get(key)! * 10000) / 10000
      : null;
    const cpuRatio =
      cpuCores !== null && cpuLimitCores && cpuLimitCores > 0
        ? Math.round((cpuCores / cpuLimitCores) * 10000) / 10000
        : null;

    const podKey = `${pod}|${namespace}`;
    const podCreatedUnix = podCreated.has(podKey) && podCreated.get(podKey)! > 0
      ? Math.floor(podCreated.get(podKey)!)
      : null;
    const podAgeSeconds = podCreatedUnix !== null ? Math.max(0, anchorTs - podCreatedUnix) : null;
    const podAgeDays = podAgeSeconds !== null ? Math.round((podAgeSeconds / 86400) * 1000) / 1000 : null;

    pods.push({
      pod: pod ?? '',
      container: container ?? '',
      namespace: namespace ?? '',
      restartCount: count,
      terminationReason: mapReasons.get(key) || null,
      restartedAt,
      restartedAtUnix,
      podCreatedUnix,
      podAgeSeconds,
      podAgeDays,
      memoryUsedBytes: memUsedBytes,
      memoryLimitBytes: memLimitBytes,
      memoryUsageRatio: memRatio,
      cpuUsedCores: cpuCores,
      cpuLimitCores: cpuLimitCores,
      cpuUsageRatio: cpuRatio,
      priority: 'normal',
      severity: 'info',
    });
  }

  // Sort: highest restarts first, then alphabetical by pod
  pods.sort((a, b) =>
    b.restartCount !== a.restartCount
      ? b.restartCount - a.restartCount
      : a.pod.localeCompare(b.pod),
  );

  // Build summaries
  const reasonSummary: ReasonSummary = {};
  const severitySummary: SeveritySummary = { critical: 0, warning: 0, info: 0 };
  for (const p of pods) {
    const reason = p.terminationReason ?? 'Unknown';
    reasonSummary[reason] = (reasonSummary[reason] ?? 0) + 1;
    const s = p.severity ?? 'info';
    if (s === 'critical') severitySummary.critical++;
    else if (s === 'warning') severitySummary.warning++;
    else severitySummary.info++;
  }

  return {
    date: anchorDate,
    generatedAt: new Date(anchorTs * 1000).toISOString(),
    source: 'browser',
    runway: rw.name,
    cluster: rw.cluster,
    scanWindowHours: 24,
    totalPods: pods.length,
    totalRestarts: pods.reduce((sum, p) => sum + p.restartCount, 0),
    severitySummary,
    reasonSummary,
    hpaEvents: {},
    pods,
  };
}
