// som-portal-v2/src/service-performance/service.ts
//
// Business logic for Service Performance — port of v1's _lib.php + index.php.
// Every function takes explicit args (no globals). Caching matches v1's 60s TTL.

import type { PromVector } from './thanos-client';
import { ThanosClient } from './thanos-client';
import { readCache, writeCache } from './cache';
import {
  loadSourcesConfig,
  getEnabledSources,
  toThanosSource,
  sourcePublic,
} from './sources';
import { queriesForSource, stripPodHash, queriesK8sForWorkload } from './queries';
import type {
  SourceConfig,
  RunwaySnapshot,
  ServiceRow,
  OverviewResponse,
  PodDetail,
  ServiceDetailResponse,
} from './schema';

// ─── Vector helpers (port of _spVecToMap) ───────────────────────────────────

function vecToMap(
  vec: PromVector[],
  keyFn: (metric: Record<string, string>) => string | null,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of vec) {
    const key = keyFn(r.metric);
    if (!key) continue;
    const val = r.value[1] !== undefined ? parseFloat(r.value[1]) : 0;
    if (!(key in out)) out[key] = val;
  }
  return out;
}

// ─── Fetch a single source (port of spFetchSource) ──────────────────────────

async function fetchSource(src: SourceConfig): Promise<RunwaySnapshot> {
  const entry: RunwaySnapshot = {
    slug: src.slug,
    name: src.name,
    orgId: src.orgId,
    color: src.color,
    labelScheme: src.labelScheme,
    grafanaUrl: src.grafanaUrl.replace(/\/$/, ''),
    dashboardUid: src.dashboardUid,
    fetchedAt: new Date().toISOString(),
    services: [],
    totals: { services: 0, pods: 0, cpuHotspots: 0, memHotspots: 0 },
    error: null,
    fromCache: false,
    hasInventory: false,
  };

  const thanosSource = toThanosSource(src);
  if (
    (thanosSource.auth.kind === 'basic' && (!thanosSource.auth.user || !thanosSource.auth.pass)) &&
    (thanosSource.auth.kind !== 'token')
  ) {
    entry.error = 'Grafana auth not configured';
    return entry;
  }

  const client = new ThanosClient(thanosSource);
  const queries = queriesForSource(src);

  let res: Record<string, PromVector[]>;
  try {
    res = await client.instantBatch(queries);
  } catch (e) {
    entry.error = e instanceof Error ? e.message : String(e);
    return entry;
  }

  // Build per-service rows
  let services: ServiceRow[];
  let totalPods = 0;
  let cpuHot = 0;
  let memHot = 0;

  if (src.labelScheme === 'appScope') {
    const keyFn = (m: Record<string, string>) => m['appScope'] ?? null;
    const pods = vecToMap(res['pods'] ?? [], keyFn);
    const cpuUsed = vecToMap(res['cpuUsed'] ?? [], keyFn);
    const cpuLimit = vecToMap(res['cpuLimit'] ?? [], keyFn);
    const memUsed = vecToMap(res['memUsed'] ?? [], keyFn);
    const memLimit = vecToMap(res['memLimit'] ?? [], keyFn);

    const allKeys = [
      ...new Set([
        ...Object.keys(pods),
        ...Object.keys(cpuUsed),
        ...Object.keys(cpuLimit),
        ...Object.keys(memUsed),
        ...Object.keys(memLimit),
      ]),
    ].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));

    services = allKeys.map((k) => {
      const podN = Math.round(pods[k] ?? 0);
      const cpuU = cpuUsed[k] ?? 0;
      const cpuL = cpuLimit[k] ?? 0;
      const memU = memUsed[k] ?? 0;
      const memL = memLimit[k] ?? 0;
      const cpuPct = cpuL > 0 ? Math.round(((cpuU / cpuL) * 100) * 10) / 10 : null;
      const memPct = memL > 0 ? Math.round(((memU / memL) * 100) * 10) / 10 : null;
      if (cpuPct !== null && cpuPct >= 80) cpuHot++;
      if (memPct !== null && memPct >= 80) memHot++;
      totalPods += podN;
      return {
        key: k,
        service: k,
        namespace: null,
        workloadType: null,
        pods: podN,
        cpuCores: Math.round(cpuU * 10000) / 10000,
        cpuLimitCores: Math.round(cpuL * 10000) / 10000,
        cpuPct,
        memBytes: Math.round(memU),
        memLimitBytes: Math.round(memL),
        memPct,
      };
    });
  } else {
    // k8s scheme — aggregate per (namespace, workload)
    const agg: Record<
      string,
      { pods: Set<string>; cpuU: number; cpuL: number; memU: number; memL: number }
    > = {};

    const addPod = (ns: string, pod: string, bucket: 'cpuU' | 'cpuL' | 'memU' | 'memL', val: number) => {
      if (!ns || !pod) return;
      const wl = stripPodHash(pod);
      const key = `${ns}/${wl}`;
      if (!agg[key]) agg[key] = { pods: new Set(), cpuU: 0, cpuL: 0, memU: 0, memL: 0 };
      agg[key]!.pods.add(pod);
      agg[key]![bucket] += val;
    };

    for (const r of res['pods'] ?? []) {
      const ns = r.metric['namespace'] ?? '';
      const pd = r.metric['pod'] ?? '';
      if (ns && pd) {
        const wl = stripPodHash(pd);
        const key = `${ns}/${wl}`;
        if (!agg[key]) agg[key] = { pods: new Set(), cpuU: 0, cpuL: 0, memU: 0, memL: 0 };
        agg[key]!.pods.add(pd);
      }
    }
    for (const r of res['cpuUsed'] ?? []) addPod(r.metric['namespace'] ?? '', r.metric['pod'] ?? '', 'cpuU', parseFloat(r.value[1] ?? '0'));
    for (const r of res['cpuLimit'] ?? []) addPod(r.metric['namespace'] ?? '', r.metric['pod'] ?? '', 'cpuL', parseFloat(r.value[1] ?? '0'));
    for (const r of res['memUsed'] ?? []) addPod(r.metric['namespace'] ?? '', r.metric['pod'] ?? '', 'memU', parseFloat(r.value[1] ?? '0'));
    for (const r of res['memLimit'] ?? []) addPod(r.metric['namespace'] ?? '', r.metric['pod'] ?? '', 'memL', parseFloat(r.value[1] ?? '0'));

    const keys = Object.keys(agg).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }),
    );

    services = keys.map((k) => {
      const [ns, svc] = k.split('/', 2) as [string, string];
      const a = agg[k]!;
      const podN = a.pods.size;
      const cpuU = a.cpuU;
      const cpuL = a.cpuL;
      const memU = a.memU;
      const memL = a.memL;
      const cpuPct = cpuL > 0 ? Math.round(((cpuU / cpuL) * 100) * 10) / 10 : null;
      const memPct = memL > 0 ? Math.round(((memU / memL) * 100) * 10) / 10 : null;
      if (cpuPct !== null && cpuPct >= 80) cpuHot++;
      if (memPct !== null && memPct >= 80) memHot++;
      totalPods += podN;
      return {
        key: k,
        service: svc ?? k,
        namespace: ns ?? null,
        workloadType: null,
        pods: podN,
        cpuCores: Math.round(cpuU * 10000) / 10000,
        cpuLimitCores: Math.round(cpuL * 10000) / 10000,
        cpuPct,
        memBytes: Math.round(memU),
        memLimitBytes: Math.round(memL),
        memPct,
      };
    });
  }

  entry.services = services;
  entry.totals = { services: services.length, pods: totalPods, cpuHotspots: cpuHot, memHotspots: memHot };
  return entry;
}

// ─── Inventory filter (port of spApplyInventoryFilter) ──────────────────────

function applyInventoryFilter(snapshot: RunwaySnapshot, showAll: boolean): RunwaySnapshot {
  if (showAll || !snapshot.hasInventory) return snapshot;
  const filtered = snapshot.services.filter((s) => s.inInventory);
  let totalPods = 0;
  let cpuHot = 0;
  let memHot = 0;
  for (const s of filtered) {
    totalPods += s.pods;
    if (s.cpuPct !== null && s.cpuPct >= 80) cpuHot++;
    if (s.memPct !== null && s.memPct >= 80) memHot++;
  }
  return {
    ...snapshot,
    services: filtered,
    totals: { services: filtered.length, pods: totalPods, cpuHotspots: cpuHot, memHotspots: memHot },
  };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Get a source snapshot, honoring cache. Port of v1 spGetSource.
 */
async function getSourceSnapshot(
  src: SourceConfig,
  ttlMs: number,
  force = false,
): Promise<RunwaySnapshot> {
  if (!force) {
    const cached = await readCache(src.slug, ttlMs);
    if (cached) return { ...cached, fromCache: true };
  }
  const snap = await fetchSource(src);
  snap.fromCache = false;
  await writeCache(src.slug, snap);
  return snap;
}

/**
 * Get the overview (all runways). Matches v1 GET /api/service-performance.
 */
export async function getOverview(opts: {
  runway?: string;
  showAll?: boolean;
}): Promise<OverviewResponse> {
  const cfg = await loadSourcesConfig();
  const sources = await getEnabledSources(opts.runway);
  const ttlMs = cfg.cacheTtlSeconds * 1000;

  let hasInventory = false;
  let unfilteredTotal = 0;
  const runways: RunwaySnapshot[] = [];

  for (const src of sources) {
    let snap: RunwaySnapshot;
    try {
      snap = await getSourceSnapshot(src, ttlMs);
    } catch (e) {
      snap = {
        slug: src.slug,
        name: src.name,
        orgId: src.orgId,
        color: src.color,
        labelScheme: src.labelScheme,
        grafanaUrl: src.grafanaUrl,
        dashboardUid: src.dashboardUid,
        fetchedAt: new Date().toISOString(),
        services: [],
        totals: { services: 0, pods: 0, cpuHotspots: 0, memHotspots: 0 },
        error: e instanceof Error ? e.message : String(e),
        fromCache: false,
        hasInventory: false,
      };
    }
    unfilteredTotal += snap.totals.services;
    if (snap.hasInventory) hasInventory = true;
    runways.push(applyInventoryFilter(snap, opts.showAll ?? false));
  }

  return {
    runways,
    sheetEmbedUrl: cfg.sheetEmbedUrl,
    sheetOpenUrl: cfg.sheetOpenUrl || cfg.sheetEmbedUrl,
    cacheTtlSeconds: cfg.cacheTtlSeconds,
    sources: cfg.sources.map(sourcePublic),
    hasInventory,
    showAll: opts.showAll ?? false,
    unfilteredTotal,
  };
}

/**
 * Get per-service detail. Matches v1 GET /api/service-performance/detail.php.
 */
export async function getServiceDetail(opts: {
  service: string;
  runway?: string;
  cluster?: string;
}): Promise<ServiceDetailResponse> {
  const sources = await getEnabledSources(opts.runway);
  if (sources.length === 0) {
    return {
      service: opts.service,
      runway: opts.runway ?? '',
      cluster: opts.cluster ?? '',
      namespace: '',
      pods: [],
      totals: { pods: 0, cpuCores: 0, cpuLimitCores: 0, cpuPct: null, memBytes: 0, memLimitBytes: 0, memPct: null },
      inventory: null,
      fromCache: false,
      error: 'No enabled sources found',
    };
  }

  // Auto-detect runway by probing each source for matching pods
  let foundSrc: SourceConfig | null = null;
  let foundNamespace = '';
  let foundPods: PodDetail[] = [];

  for (const src of sources) {
    if (src.labelScheme !== 'k8s') continue;
    const thanosSource = toThanosSource(src);
    const client = new ThanosClient(thanosSource);
    const queries = queriesK8sForWorkload(src, '', opts.service, opts.cluster);

    // Use a broader probe — just kube_pod_info matching pod prefix
    const escSvc = escapeRegexForProbe(opts.service);
    const probeParts: string[] = [];
    if (opts.cluster) {
      probeParts.push(`cluster="${opts.cluster}"`);
    } else if (src.cluster) {
      probeParts.push(`cluster=~"${src.cluster}"`);
    }
    if (src.namespaceRegex) probeParts.push(`namespace=~"${src.namespaceRegex}"`);
    probeParts.push(`pod=~"${escSvc}.*"`);
    const probeQuery = `kube_pod_info{${probeParts.join(',')}}` as import('./promql').PromQLQuery;

    try {
      const probeRes = await client.instant<PromVector[]>(probeQuery);
      const pods = probeRes.status === 'success' && probeRes.data ? probeRes.data.result : [];
      const matching = pods.filter((r) => stripPodHash(r.metric['pod'] ?? '') === opts.service);
      if (matching.length > 0) {
        foundSrc = src;
        foundNamespace = matching[0]!.metric['namespace'] ?? '';
        break;
      }
    } catch {
      // Try next source
    }
  }

  if (!foundSrc) {
    // Fall back to first source for appScope or if no k8s matched
    foundSrc = sources[0]!;
  }

  // Fetch per-pod detail
  if (foundSrc.labelScheme === 'k8s' && foundNamespace) {
    const thanosSource = toThanosSource(foundSrc);
    const client = new ThanosClient(thanosSource);
    const queries = queriesK8sForWorkload(foundSrc, foundNamespace, opts.service, opts.cluster);
    try {
      const res = await client.instantBatch(queries);
      const rows: Record<string, PodDetail> = {};

      // Process kube_pod_info first
      for (const r of res['pods'] ?? []) {
        const pd = r.metric['pod'] ?? '';
        if (pd && stripPodHash(pd) === opts.service) {
          rows[pd] = { pod: pd, cpuCores: 0, cpuLimitCores: 0, cpuPct: null, memBytes: 0, memLimitBytes: 0, memPct: null };
        }
      }

      const ingest = (vec: PromVector[], field: keyof Pick<PodDetail, 'cpuCores' | 'cpuLimitCores' | 'memBytes' | 'memLimitBytes'>) => {
        for (const r of vec) {
          const pd = r.metric['pod'] ?? '';
          if (!pd || stripPodHash(pd) !== opts.service) continue;
          if (!rows[pd]) rows[pd] = { pod: pd, cpuCores: 0, cpuLimitCores: 0, cpuPct: null, memBytes: 0, memLimitBytes: 0, memPct: null };
          (rows[pd] as Record<string, unknown>)[field] = parseFloat(r.value[1] ?? '0');
        }
      };
      ingest(res['cpuUsed'] ?? [], 'cpuCores');
      ingest(res['cpuLimit'] ?? [], 'cpuLimitCores');
      ingest(res['memUsed'] ?? [], 'memBytes');
      ingest(res['memLimit'] ?? [], 'memLimitBytes');

      foundPods = Object.values(rows)
        .map((r) => ({
          ...r,
          cpuCores: Math.round(r.cpuCores * 10000) / 10000,
          cpuLimitCores: Math.round(r.cpuLimitCores * 10000) / 10000,
          cpuPct: r.cpuLimitCores > 0 ? Math.round(((r.cpuCores / r.cpuLimitCores) * 100) * 10) / 10 : null,
          memBytes: Math.round(r.memBytes),
          memLimitBytes: Math.round(r.memLimitBytes),
          memPct: r.memLimitBytes > 0 ? Math.round(((r.memBytes / r.memLimitBytes) * 100) * 10) / 10 : null,
        }))
        .sort((a, b) => a.pod.localeCompare(b.pod));
    } catch (e) {
      return {
        service: opts.service,
        runway: foundSrc.slug,
        cluster: opts.cluster ?? '',
        namespace: foundNamespace,
        pods: [],
        totals: { pods: 0, cpuCores: 0, cpuLimitCores: 0, cpuPct: null, memBytes: 0, memLimitBytes: 0, memPct: null },
        inventory: null,
        fromCache: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  // Compute totals
  let totalCpu = 0;
  let totalCpuLimit = 0;
  let totalMem = 0;
  let totalMemLimit = 0;
  for (const p of foundPods) {
    totalCpu += p.cpuCores;
    totalCpuLimit += p.cpuLimitCores;
    totalMem += p.memBytes;
    totalMemLimit += p.memLimitBytes;
  }

  return {
    service: opts.service,
    runway: foundSrc.slug,
    cluster: opts.cluster ?? '',
    namespace: foundNamespace,
    pods: foundPods,
    totals: {
      pods: foundPods.length,
      cpuCores: Math.round(totalCpu * 10000) / 10000,
      cpuLimitCores: Math.round(totalCpuLimit * 10000) / 10000,
      cpuPct: totalCpuLimit > 0 ? Math.round(((totalCpu / totalCpuLimit) * 100) * 10) / 10 : null,
      memBytes: Math.round(totalMem),
      memLimitBytes: Math.round(totalMemLimit),
      memPct: totalMemLimit > 0 ? Math.round(((totalMem / totalMemLimit) * 100) * 10) / 10 : null,
    },
    inventory: null,
    fromCache: false,
    error: null,
  };
}

// Internal helper — escapeRegex but for probe queries built from config + user service name
function escapeRegexForProbe(s: string): string {
  // Same as escape.ts escapeRegex but for the probe query selector
  return s.replace(/[.\\+*?\[\]()|^${}]/g, '\\$&').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
