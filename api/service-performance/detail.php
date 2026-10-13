<?php
/**
 * GET /api/service-performance/detail.php?service=<name>[&runway=<slug>]
 *
 * All-in-one snapshot for ONE service:
 *   • current per-pod CPU/MEM (instant query)
 *   • 30-minute CPU/MEM time-series (query_range, 30s step → 60 samples)
 *   • CSV-inventory enrichment (BU, team, severity)
 *
 * Runway auto-detect: when `runway` is omitted we fire the narrow pod-scoped
 * `kube_pod_info` query against every enabled runway in parallel; whichever
 * returns matching pods wins. Since each runway query is `pod=~"<svc>-.*"`
 * (single-workload scope) Grafana barely notices.
 *
 * 60s cache per (service, runway) key so tab-switching + refresh don't hammer
 * the datasource.
 */
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/_lib.php';

ini_set('memory_limit', '256M');
set_time_limit(60);
register_shutdown_function(function() {
    $err = error_get_last();
    if ($err && in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR], true)) {
        if (!headers_sent()) { http_response_code(500); header('Content-Type: application/json'); }
        echo json_encode(['success' => false, 'message' => 'PHP fatal: ' . $err['message'] . ' @ ' . basename($err['file']) . ':' . $err['line']]);
    }
});

$payload = requireAuth();
requireRole($payload, ALL_STAFF_ROLES);
if ($_SERVER['REQUEST_METHOD'] !== 'GET') respondError('Method not allowed', 405);

$service    = trim((string)($_GET['service']  ?? ''));
$wantRunway = trim((string)($_GET['runway']   ?? ''));
// Optional cluster pin (e.g. "a-th2p") — when a source's `cluster` config is a
// multi-cluster regex (OCP TH: "a-th2p|b-th1p") the same workload can exist
// independently on each cluster. Without this pin we'd sum pod counts across
// clusters, disagreeing with Grafana dashboards that default to one cluster.
$wantCluster = trim((string)($_GET['cluster'] ?? ''));

// Two ways to specify the time window:
//   1. `window=<minutes>` — relative "last N mins", ending at time() (default)
//   2. `start=<unix>&end=<unix>` — absolute range for a Grafana-style custom pick
// Absolute takes precedence when both are valid. Max span capped at 30 days so
// a runaway query can't OOM the PHP process or hog Thanos.
$MAX_SPAN = 30 * 24 * 60;  // 30 days in minutes
$absStart = (int)($_GET['start'] ?? 0);
$absEnd   = (int)($_GET['end']   ?? 0);
$isCustom = $absStart > 0 && $absEnd > $absStart;
if ($isCustom) {
    $spanMin = (int)round(($absEnd - $absStart) / 60);
    if ($spanMin < 5)         respondError('range must be at least 5 minutes', 400);
    if ($spanMin > $MAX_SPAN) respondError('range too large (max 30 days)', 400);
    $windowMin = $spanMin;
} else {
    $windowMin = min($MAX_SPAN, max(5, (int)($_GET['window'] ?? 30)));  // minutes of history
}
if ($service === '' || !preg_match('/^[a-z0-9._-]+$/i', $service)) respondError('service is required (letters/digits/._-)', 400);
if ($wantRunway  !== '' && !preg_match('/^[a-z0-9_-]+$/', $wantRunway))  respondError('invalid runway', 400);
if ($wantCluster !== '' && !preg_match('/^[a-z0-9._-]+$/i', $wantCluster)) respondError('invalid cluster', 400);

$cfg = spLoadConfig();
$sources = array_values(array_filter($cfg['sources'], fn($s) => ($s['enabled'] ?? true) !== false));
if ($wantRunway !== '') {
    $sources = array_values(array_filter($sources, fn($s) => ($s['slug'] ?? '') === $wantRunway));
    if (!$sources) respondError("Unknown runway '{$wantRunway}'", 404);
}

// ── Cache ────────────────────────────────────────────────────────────────────
// Custom ranges cache per (start,end) pair — that pair uniquely identifies the
// query. Preset windows cache per windowMin so consecutive requests within the
// TTL land on the same file even though `time()` moves.
$cKey = $wantCluster !== '' ? $wantCluster : 'auto';
$cacheKey = $isCustom
    ? preg_replace('/[^a-z0-9._-]+/i', '_', $service . '_' . ($wantRunway ?: 'auto') . '_c' . $cKey . '_' . $absStart . '_' . $absEnd)
    : preg_replace('/[^a-z0-9._-]+/i', '_', $service . '_' . ($wantRunway ?: 'auto') . '_c' . $cKey . '_w' . $windowMin);
$cachePath = teamDataPath('service-performance/cache/detail/' . $cacheKey . '.json');
$cacheTtl  = 60;
if (file_exists($cachePath) && (time() - (int)filemtime($cachePath)) <= $cacheTtl) {
    $c = json_decode((string)file_get_contents($cachePath), true);
    if (is_array($c)) { $c['fromCache'] = true; respondOk($c); }
}

// ── Step 1: auto-detect the runway by firing a narrow probe per source ──────
// Strategy: for each enabled source, fire ONE broad query that just returns
// series with `pod` labels matching the service prefix. Whichever source
// returns matching pods wins. Also collect diagnostic info per source so
// "not found" responses can explain what was actually tried.
$svcRe   = _spPromEscape($service);  // hyphen-safe (see _spPromEscape doc)
$foundSrc = null; $foundNamespace = ''; $matchedPodNames = [];
$probeInfo = [];  // per-source diagnostics returned in the response
// Per-cluster aggregation for the winning source. Key = cluster label; value
// tracks the pod count + the namespace we'll query in Step 2. When a source
// covers multiple clusters (OCP TH regex "a-th2p|b-th1p"), each is presented
// as a separate option so the UI can pin queries to ONE cluster.
$clusterMap = [];  // [cluster => ['namespace' => str, 'pods' => int]]

foreach ($sources as $src) {
    $slug = (string)($src['slug'] ?? '');
    $info = ['slug' => $slug, 'name' => $src['name'] ?? '', 'scheme' => $src['labelScheme'] ?? 'k8s',
             'seriesReturned' => 0, 'matchingWorkloads' => [], 'closePodSample' => [], 'error' => null];

    // Skip sources with missing dsUid (e.g. ACM not fully configured yet).
    if (empty($src['dsUid'])) {
        $info['error'] = 'dsUid not configured';
        $probeInfo[] = $info; continue;
    }

    try {
        if (($src['labelScheme'] ?? 'k8s') === 'appScope') {
            // appScope scheme (ACM org=3): probe `up{env_name=..., appScope=~"<svc>"}`.
            $env   = (string)($src['envName'] ?? 'prod');
            $probeQ = "count by (appScope) (up{env_name=\"{$env}\",appScope=~\"{$svcRe}\"} == 1)";
            $res = spQueryPromQL($src, ['probe' => $probeQ]);
            $vec = $res['probe'] ?? [];
            $info['seriesReturned'] = count($vec);
            foreach ($vec as $r) {
                $scope = (string)($r['metric']['appScope'] ?? '');
                if ($scope === $service) {
                    $foundSrc = $src; $foundNamespace = ''; break 2;
                }
                if ($scope !== '') $info['closePodSample'][] = $scope;
            }
        } else {
            // k8s scheme (TMN/NANO/OCP): pod-scoped `kube_pod_info` with cluster + pod prefix.
            // `cluster` is a regex so multi-cluster sources (e.g. OCP a-th2p|b-th1p) work.
            //
            // Namespace filter matters: EKS TMN federation duplicates kube-state
            // series into `kubernetes-monitoring` (a scraper's own namespace), so
            // a workload like `tmn-mobile-gateway` appears in BOTH its real
            // namespace `truemoney-mobile-backend-production` AND the monitoring
            // one. Without narrowing the probe we may pick the wrong namespace
            // for Step 2, which then finds zero cadvisor data (that metric is
            // scoped to the real namespace only).
            $cluster = (string)($src['cluster'] ?? '');
            $nsRe    = (string)($src['namespaceRegex']   ?? '');
            $nsEx    = (string)($src['namespaceExclude'] ?? '');
            $parts   = [];
            if ($cluster !== '') $parts[] = "cluster=~\"{$cluster}\"";
            if ($nsRe    !== '') $parts[] = "namespace=~\"{$nsRe}\"";
            if ($nsEx    !== '') $parts[] = "namespace!~\"{$nsEx}\"";
            $parts[] = "pod=~\"{$svcRe}.*\"";   // broad match — includes exact + hyphenated suffix pods
            $sel = implode(',', $parts);
            $probeQ = "kube_pod_info{{$sel}}";
            $res = spQueryPromQL($src, ['probe' => $probeQ]);
            $vec = $res['probe'] ?? [];
            $info['seriesReturned'] = count($vec);

            // Walk series and see if any stripped-pod-name matches the workload.
            // For matches, tally by cluster so the caller can pick one.
            $seenNames = [];
            foreach ($vec as $r) {
                $pod = (string)($r['metric']['pod'] ?? '');
                if ($pod === '') continue;
                $seenNames[$pod] = true;
                $stripped = _spStripPodHash($pod);
                if ($stripped === $service) {
                    $foundSrc = $src;
                    $clu = (string)($r['metric']['cluster']   ?? '');
                    $ns  = (string)($r['metric']['namespace'] ?? '');
                    $matchedPodNames[] = $pod;
                    if (!isset($clusterMap[$clu])) {
                        $clusterMap[$clu] = ['namespace' => $ns, 'pods' => 0];
                    }
                    $clusterMap[$clu]['pods']++;
                    // Fallback for non-multi-cluster sources (single cluster or none).
                    $foundNamespace = $ns;
                }
                if (!in_array($stripped, $info['matchingWorkloads'], true)) {
                    $info['matchingWorkloads'][] = $stripped;
                }
            }
            $info['closePodSample'] = array_slice(array_keys($seenNames), 0, 5);
            if ($foundSrc) { $probeInfo[] = $info; break; }
        }
    } catch (Throwable $e) {
        $info['error'] = $e->getMessage();
    }
    $probeInfo[] = $info;
}

// Build the cluster-options list (sorted by pod count desc) and pick which one
// this request's queries target. When the caller pins a cluster we honor it,
// otherwise default to the cluster with the most matching pods.
$clusterOptions = [];
foreach ($clusterMap as $clu => $data) {
    $clusterOptions[] = [
        'cluster'   => $clu,
        'namespace' => $data['namespace'],
        'pods'      => $data['pods'],
    ];
}
usort($clusterOptions, fn($a, $b) => $b['pods'] <=> $a['pods']);

$selectedCluster = '';
if ($foundSrc && ($foundSrc['labelScheme'] ?? 'k8s') === 'k8s' && !empty($clusterOptions)) {
    if ($wantCluster !== '') {
        if (!isset($clusterMap[$wantCluster])) {
            respondError("cluster '{$wantCluster}' has no matching pods for service '{$service}' in runway '" . ($foundSrc['slug'] ?? '') . "'", 404);
        }
        $selectedCluster = $wantCluster;
        $foundNamespace  = $clusterMap[$wantCluster]['namespace'];
    } else {
        $selectedCluster = $clusterOptions[0]['cluster'];
        $foundNamespace  = $clusterOptions[0]['namespace'];
    }
}

if (!$foundSrc) {
    // Diagnostic-rich "not found" — user can see EXACTLY what was probed and
    // why it didn't match (wrong runway hint, service scaled to 0, name mismatch, etc).
    //
    // Special-case: inventory says the service runs on a Runway that ISN'T
    // covered by any configured source (e.g. OCP when only EKS sources exist).
    // Surface that plainly instead of the generic "scale-down 0" message so
    // users don't waste time chasing a phantom scaling issue.
    $invRow    = spLoadServiceInventory()[strtolower($service)] ?? null;
    $invRunway = $invRow ? strtoupper(trim((string)($invRow['runway'] ?? ''))) : '';
    $covered   = [];
    foreach ($sources as $s) {
        $r = strtoupper(trim((string)($s['runway'] ?? '')));
        if ($r !== '') $covered[$r] = true;
    }
    $runwayNotConfigured = ($invRunway !== '' && !isset($covered[$invRunway])) ? $invRunway : null;

    $msg = $runwayNotConfigured
        ? "Service นี้อยู่บน Runway '{$runwayNotConfigured}' — ยังไม่มี source ที่ crawl runway นี้ใน service-performance-sources.json (ให้ admin เพิ่ม source)"
        : 'ไม่พบ pod ที่ match — อาจถูก scale-down เหลือ 0 หรือชื่อ pod ในคลัสเตอร์ต่างจาก service name';

    respondOk([
        'service'             => $service,
        'found'               => false,
        'runway'              => null,
        'namespace'           => null,
        'pods'                => [],
        'series'              => ['cpu' => [], 'mem' => []],
        'inventory'           => $invRow,
        'fetchedAt'           => date('c'),
        'fromCache'           => false,
        'message'             => $msg,
        'runwayNotConfigured' => $runwayNotConfigured,
        'probes'              => $probeInfo,
        'clusterOptions'      => [],
        'selectedCluster'     => '',
        'jvm'                 => null,
        'app'                 => null,
    ]);
}

// ── Step 2: rebuild pod-scoped instant queries with the exact namespace ──────
$namespace = $foundNamespace ?: ($foundSrc['namespaceRegex'] ?? '.+');
$queries = _spQueriesK8sForWorkload($foundSrc, $namespace, $service, $selectedCluster);
try { $instant = spQueryPromQL($foundSrc, $queries); }
catch (Throwable $e) { respondError('Grafana instant query failed: ' . $e->getMessage(), 502); }

// Aggregate per-pod (reuse the same shape as pods.php)
$rows = [];
$blank = ['cpuUsed'=>0, 'cpuLimit'=>0, 'cpuRequest'=>0, 'memUsed'=>0, 'memLimit'=>0, 'memRequest'=>0];
$ingest = function(array $vec, string $bucket) use (&$rows, $service, $blank) {
    foreach ($vec as $r) {
        $m  = $r['metric'] ?? [];
        $pd = (string)($m['pod'] ?? '');
        if ($pd === '' || _spStripPodHash($pd) !== $service) continue;
        if (!isset($rows[$pd])) $rows[$pd] = ['pod' => $pd] + $blank;
        $rows[$pd][$bucket] = (float)($r['value'][1] ?? 0);
    }
};
foreach ($instant['pods'] ?? [] as $r) {
    $m = $r['metric'] ?? [];
    $pd = (string)($m['pod'] ?? '');
    if ($pd === '' || _spStripPodHash($pd) !== $service) continue;
    if (!isset($rows[$pd])) $rows[$pd] = ['pod' => $pd] + $blank;
}
$ingest($instant['cpuUsed']    ?? [], 'cpuUsed');
$ingest($instant['cpuLimit']   ?? [], 'cpuLimit');
$ingest($instant['cpuRequest'] ?? [], 'cpuRequest');
$ingest($instant['memUsed']    ?? [], 'memUsed');
$ingest($instant['memLimit']   ?? [], 'memLimit');
$ingest($instant['memRequest'] ?? [], 'memRequest');

$pods = [];
$sumCpu = 0; $sumMem = 0; $sumCpuLim = 0; $sumMemLim = 0; $sumCpuReq = 0; $sumMemReq = 0;
// Track pod-count per metric — Prometheus may return series for only SOME pods
// (e.g. rate() dropping pods with <2 samples). Dividing sum by "all pods" then
// underestimates. Count pods that actually contributed to each metric.
$nCpu = 0; $nCpuLim = 0; $nCpuReq = 0; $nMem = 0; $nMemLim = 0; $nMemReq = 0;
foreach ($rows as $r) {
    $cpuPct = ($r['cpuLimit'] > 0) ? round(($r['cpuUsed'] / $r['cpuLimit']) * 100, 1) : null;
    $memPct = ($r['memLimit'] > 0) ? round(($r['memUsed'] / $r['memLimit']) * 100, 1) : null;
    if ($r['cpuUsed']    > 0) { $sumCpu    += (float)$r['cpuUsed'];    $nCpu++; }
    if ($r['cpuLimit']   > 0) { $sumCpuLim += (float)$r['cpuLimit'];   $nCpuLim++; }
    if ($r['cpuRequest'] > 0) { $sumCpuReq += (float)$r['cpuRequest']; $nCpuReq++; }
    if ($r['memUsed']    > 0) { $sumMem    += (float)$r['memUsed'];    $nMem++; }
    if ($r['memLimit']   > 0) { $sumMemLim += (float)$r['memLimit'];   $nMemLim++; }
    if ($r['memRequest'] > 0) { $sumMemReq += (float)$r['memRequest']; $nMemReq++; }
    $pods[] = [
        'pod' => $r['pod'],
        'cpuCores'      => round($r['cpuUsed'], 4),
        'cpuLimitCores' => round($r['cpuLimit'], 4),
        'cpuPct'        => $cpuPct,
        'memBytes'      => (int)round($r['memUsed']),
        'memLimitBytes' => (int)round($r['memLimit']),
        'memPct'        => $memPct,
    ];
}
usort($pods, fn($a, $b) => strnatcasecmp($a['pod'], $b['pod']));

// Per-pod averages — the summary now reports AVG-per-pod (not workload total)
// so its values line up 1:1 with what Grafana shows in per-pod charts. CSV
// inventory declares per-pod cpu/mem too, so drift comparison stays trivial.
// Divide by per-metric pod count (not total) so partial coverage from a slow
// scrape doesn't skew the avg toward zero.
$avgCpuUsed    = $nCpu    ? $sumCpu    / $nCpu    : 0;
$avgCpuLimit   = $nCpuLim ? $sumCpuLim / $nCpuLim : 0;
$avgCpuRequest = $nCpuReq ? $sumCpuReq / $nCpuReq : 0;
$avgMemUsed    = $nMem    ? $sumMem    / $nMem    : 0;
$avgMemLimit   = $nMemLim ? $sumMemLim / $nMemLim : 0;
$avgMemRequest = $nMemReq ? $sumMemReq / $nMemReq : 0;

// ── Step 3: time-series ──────────────────────────────────────────────────────
// Absolute range wins over relative window. Step targets ~120 samples so short
// windows stay dense (15m → 15s step floor) and long ones don't blow up the
// response (30d → ~6h step).
if ($isCustom) {
    $start = $absStart;
    $end   = $absEnd;
} else {
    $end   = time();
    $start = $end - ($windowMin * 60);
}
$rangeSec = max(1, $end - $start);
$step     = max(15, (int)round($rangeSec / 120));  // ≥15s floor, ~120 samples target

// Sum across the whole workload — chart is one line per metric, not per pod.
// Pin to the selected cluster (exact match) so the range queries line up with
// the Step 2 instant queries and don't accidentally sum sibling clusters.
$cluster = (string)($foundSrc['cluster'] ?? '');
$svcReRange = _spPromEscape($service);   // hyphen-safe (same as above)
$parts = [];
if ($selectedCluster !== '')      $parts[] = "cluster=\"{$selectedCluster}\"";
elseif ($cluster !== '')          $parts[] = "cluster=~\"{$cluster}\"";
if ($namespace !== '' && $namespace !== '.+') $parts[] = "namespace=\"{$namespace}\"";
else                                          $parts[] = "namespace=~\"{$foundSrc['namespaceRegex']}\"";
$parts[] = "pod=~\"{$svcReRange}.*\"";
$sel = implode(',', $parts);
// Container filter — same convention as Step 2: `container="<service>"` picks
// the main app container (excludes istio-proxy/sidecars) so numbers align with
// Grafana. Aggregate uses `avg(...)` so it dedupes HA-duplicated cadvisor
// series without needing an explicit `/2`; per-pod uses `avg by (pod)` for the
// same reason. Result: chart values are per-pod-average, matching the scale of
// Grafana's per-pod chart lines instead of summing across the whole workload.
$svcContRange = "container=\"{$service}\"";
// Rate window [10m] — see cpuUsed comment in _spQueriesK8sForWorkload:
// OCP Thanos scrape jitters ~2-3min, so [5m] returns partial pod coverage
// which visually appears as gaps in per-pod chart lines. [10m] smooths that.
$rangeQ = [
    'cpu'       => "avg(rate(container_cpu_usage_seconds_total{{$sel},{$svcContRange}}[10m]))",
    'mem'       => "avg(container_memory_working_set_bytes{{$sel},{$svcContRange}})",
    // Min/max across pods at each sample. Rendered as a translucent band
    // behind the avg line so ops can see the pod-spread (e.g. one pod
    // spiking while the rest are cool).
    'cpuMax'    => "max(rate(container_cpu_usage_seconds_total{{$sel},{$svcContRange}}[10m]))",
    'cpuMin'    => "min(rate(container_cpu_usage_seconds_total{{$sel},{$svcContRange}}[10m]))",
    'memMax'    => "max(container_memory_working_set_bytes{{$sel},{$svcContRange}})",
    'memMin'    => "min(container_memory_working_set_bytes{{$sel},{$svcContRange}})",
    // Per-pod variants — same math, grouped by pod. Powers the multi-line
    // chart on the frontend so users can see which specific pod is spiking.
    'cpuPerPod' => "avg by (pod) (rate(container_cpu_usage_seconds_total{{$sel},{$svcContRange}}[10m]))",
    'memPerPod' => "avg by (pod) (container_memory_working_set_bytes{{$sel},{$svcContRange}})",
    // CPU throttling — % of scheduler periods where the container hit its CPU
    // limit and was forced to wait. This is the silent perf killer: `cpu` chart
    // shows headroom (e.g. 60% of limit) but throttling >0 means K8s cut CPU
    // AT scheduler resolution (100ms slices) → tail latency spikes without a
    // visible CPU spike. Ratio form is what Grafana/kubectl top surface.
    'cpuThrottledPct' => "sum(rate(container_cpu_cfs_throttled_periods_total{{$sel},{$svcContRange}}[10m])) / sum(rate(container_cpu_cfs_periods_total{{$sel},{$svcContRange}}[10m])) * 100",
    // Network traffic — sourced from cadvisor (kubelet), so ALWAYS available
    // even when the app-side metrics exporter (php-fpm_exporter / Micrometer)
    // is down. Not a true TPS, but packet+byte throughput tracks request
    // volume closely enough to spot spikes/drops and answer "is traffic
    // reaching this workload at all?" when the primary TPS panel is empty.
    // Uses container="" filter — pod-level network is aggregated on the
    // POD cgroup, NOT the app container cgroup.
    'netRxPkts' => "sum(rate(container_network_receive_packets_total{{$sel}}[5m]))",
    'netTxPkts' => "sum(rate(container_network_transmit_packets_total{{$sel}}[5m]))",
    'netRxBytes'=> "sum(rate(container_network_receive_bytes_total{{$sel}}[5m]))",
    'netTxBytes'=> "sum(rate(container_network_transmit_bytes_total{{$sel}}[5m]))",
];
try { $ranges = spQueryPromRange($foundSrc, $rangeQ, $start, $end, $step); }
catch (Throwable $e) { $ranges = ['cpu' => [], 'mem' => [], 'cpuMax' => [], 'cpuMin' => [], 'memMax' => [], 'memMin' => [], 'cpuPerPod' => [], 'memPerPod' => [], 'cpuThrottledPct' => [], 'netRxPkts' => [], 'netTxPkts' => [], 'netRxBytes' => [], 'netTxBytes' => []]; }

// JVM app-metric range queries fire against jvmDsUid (Micrometer datasource,
// often DIFFERENT from cadvisor's dsUid). Only used when a Spring Boot service
// is detected. Empty for non-JVM services → charts render "no data".
$jvmRanges = ['txnRate' => [], 'procMs' => []];
$jvmDsUidForRange = (string)($foundSrc['jvmDsUid'] ?? '');
if ($jvmDsUidForRange !== '' && $selectedCluster !== '') {
    $jvmRangeSrc = $foundSrc;
    $jvmRangeSrc['dsUid'] = $jvmDsUidForRange;
    $jvmRangeSel = "app_name=\"{$service}\",cluster=\"{$selectedCluster}\"";
    $jvmRangeQ = [
        'txnRate' => "sum(rate(http_server_requests_seconds_count{{$jvmRangeSel}}[5m]))",
        // Avoid divide-by-zero when count=0 (idle service) by adding a small
        // epsilon; Prometheus returns NaN otherwise which the chart drops.
        'procMs'  => "(sum(rate(http_server_requests_seconds_sum{{$jvmRangeSel}}[5m])) / (sum(rate(http_server_requests_seconds_count{{$jvmRangeSel}}[5m])) > 0)) * 1000",
        // TXN rate min/max — pod-spread (load balancer skew). Same metric,
        // just reduced across pods; still meaningful because req/sec is a
        // counter rate that can legitimately differ per pod.
        'txnRateMax' => "max(sum by (pod) (rate(http_server_requests_seconds_count{{$jvmRangeSel}}[5m])))",
        'txnRateMin' => "min(sum by (pod) (rate(http_server_requests_seconds_count{{$jvmRangeSel}}[5m])))",
        // Latency max — use the REAL `http_server_requests_seconds_max` metric,
        // which Micrometer publishes as "highest single request duration
        // observed in the last scrape interval" (per URI/method/status).
        // Previous version calculated max(avg_per_pod) which collapsed to
        // avg since pods are usually load-balanced — you'd never see the
        // 30-second outlier the Grafana _max panel shows.
        // NOTE: no matching `procMsMin` — Micrometer summary metrics don't
        // expose a per-scrape min. Would need histogram buckets (p50) or an
        // explicit min gauge for that. Better to omit than mislead.
        'procMsMax'  => "max(http_server_requests_seconds_max{{$jvmRangeSel}}) * 1000",
    ];
    try { $jvmRanges = spQueryPromRange($jvmRangeSrc, $jvmRangeQ, $start, $end, $step); }
    catch (Throwable $e) { /* silent — chart shows empty state */ }
}

// ══ Timeline events (annotations) ══════════════════════════════════════
// Detect what happened DURING the display window — pod restarts (crashes,
// OOM) and pod creations (deploys, scale-out, replacements). Rendered as
// vertical dashed lines on every chart so users can visually correlate
// "latency spiked at 15:32" with "pod restarted at 15:32".
$events = [];
try {
    // Restarts — `changes()` on the restart counter gives 1 per restart.
    // Range query so we know WHEN each restart happened, not just total.
    // Step-aligned so each bucket represents at most 1 event (larger step
    // for wider windows keeps the response bounded).
    $eventStep = max($step, 60);   // never finer than 1 min for events
    $restartsMx = spQueryPromRange($foundSrc, [
        'r' => "changes(kube_pod_container_status_restarts_total{{$sel},{$svcContRange}}[{$eventStep}s])",
    ], $start, $end, $eventStep);
    foreach ($restartsMx['r'] ?? [] as $row) {
        $pod = (string)($row['metric']['pod'] ?? '');
        if ($pod === '') continue;
        foreach ($row['values'] ?? [] as $pair) {
            $v = (float)($pair[1] ?? 0);
            if ($v <= 0) continue;   // no restart at this timestamp
            $events[] = [
                'ts'   => (int)$pair[0],
                'type' => 'restart',
                'pod'  => $pod,
                'note' => 'Pod restarted',
            ];
        }
    }
} catch (Throwable $e) { /* silent — annotations are best-effort */ }
try {
    // Pod creations — `kube_pod_created` is an instant gauge with the
    // creation Unix timestamp as its value. Filter to pods whose creation
    // ts falls inside the display window (= deploys / rollouts / scale-out
    // events that happened during the window we're showing).
    $createdInst = spQueryPromQL($foundSrc, [
        'c' => "kube_pod_created{{$sel}}",
    ]);
    foreach ($createdInst['c'] ?? [] as $row) {
        $pod = (string)($row['metric']['pod'] ?? '');
        if ($pod === '') continue;
        $createdTs = (int)(float)($row['value'][1] ?? 0);
        if ($createdTs >= $start && $createdTs <= $end) {
            $events[] = [
                'ts'   => $createdTs,
                'type' => 'deploy',
                'pod'  => $pod,
                'note' => 'Pod created (deploy/scale/replace)',
            ];
        }
    }
} catch (Throwable $e) { /* silent */ }

// ── HPA (HorizontalPodAutoscaler) status ─────────────────────────────
// From kube-state-metrics. HPA name usually matches the service name (or
// with the `acm-` prefix stripped). We accept either form and dedup across
// scrape sources (kube-state is scraped by both `kube-state-metrics` and
// `kubernetes-service-endpoints` jobs → same series duplicated 3x).
// Exposes: current/desired/min/max replicas + condition flags.
// Signals:
//   • currentReplicas == maxReplicas → capped (autoscaler wanted more)
//   • ScalingActive=false → metrics adapter broken (autoscaler NOT working)
//   • ScalingLimited=true → hit min/max ceiling
$hpa = null;
try {
    $svcBase = preg_replace('/^acm-/', '', $service);
    $hpaPat  = preg_quote($service, '/') . '|' . preg_quote($svcBase, '/');
    $nsSel   = ($namespace !== '' && $namespace !== '.+') ? "namespace=\"{$namespace}\"" : "namespace=~\"{$foundSrc['namespaceRegex']}\"";
    $cluSel  = ($selectedCluster !== '') ? ",cluster=\"{$selectedCluster}\"" : '';
    $hpaSel  = "horizontalpodautoscaler=~\"^({$hpaPat})$\",{$nsSel}{$cluSel}";
    $hpaRes = spQueryPromQL($foundSrc, [
        'current'    => "avg by (horizontalpodautoscaler) (kube_horizontalpodautoscaler_status_current_replicas{{$hpaSel}})",
        'desired'    => "avg by (horizontalpodautoscaler) (kube_horizontalpodautoscaler_status_desired_replicas{{$hpaSel}})",
        'min'        => "avg by (horizontalpodautoscaler) (kube_horizontalpodautoscaler_spec_min_replicas{{$hpaSel}})",
        'max'        => "avg by (horizontalpodautoscaler) (kube_horizontalpodautoscaler_spec_max_replicas{{$hpaSel}})",
        'conditions' => "avg by (horizontalpodautoscaler, condition, status) (kube_horizontalpodautoscaler_status_condition{{$hpaSel}})",
    ]);
    $pickScalar = function(array $vec): ?int {
        if (empty($vec[0]['value'][1])) return null;
        return (int)round((float)$vec[0]['value'][1]);
    };
    $current = $pickScalar($hpaRes['current'] ?? []);
    $desired = $pickScalar($hpaRes['desired'] ?? []);
    $minR    = $pickScalar($hpaRes['min']     ?? []);
    $maxR    = $pickScalar($hpaRes['max']     ?? []);
    if ($current !== null || $desired !== null) {
        // Build condition map: {ScalingActive: 'True', AbleToScale: 'True', ScalingLimited: 'False'}
        $conds = [];
        foreach ($hpaRes['conditions'] ?? [] as $r) {
            $c = (string)($r['metric']['condition'] ?? '');
            $s = (string)($r['metric']['status'] ?? '');
            $v = (float)($r['value'][1] ?? 0);
            if ($c === '' || $s === '' || $v < 1) continue;
            $conds[$c] = $s;   // e.g. 'ScalingActive' => 'True'
        }
        $atMax = ($current !== null && $maxR !== null && $current >= $maxR);
        $state = 'ok';
        $reason = 'autoscaling healthy';
        if (($conds['ScalingActive'] ?? 'True') === 'False') {
            $state = 'hot'; $reason = 'ScalingActive=False (metrics adapter broken)';
        } elseif (($conds['AbleToScale'] ?? 'True') === 'False') {
            $state = 'warn'; $reason = 'AbleToScale=False (throttled by cooldown/pending)';
        } elseif ($atMax) {
            $state = 'hot'; $reason = 'capped at max — wants more replicas';
        } elseif ($current !== null && $maxR !== null && $maxR > 0 && $current / $maxR >= 0.8) {
            $state = 'warn'; $reason = 'nearing max (' . round($current / $maxR * 100) . '%)';
        } elseif (($conds['ScalingLimited'] ?? 'False') === 'True') {
            $state = 'warn'; $reason = 'ScalingLimited=True (hit min/max)';
        }
        $hpa = [
            'name'     => array_key_first($hpaRes['current']) !== null
                        ? (string)($hpaRes['current'][0]['metric']['horizontalpodautoscaler'] ?? $service)
                        : $service,
            'current'  => $current,
            'desired'  => $desired,
            'min'      => $minR,
            'max'      => $maxR,
            'atMax'    => $atMax,
            'state'    => $state,
            'reason'   => $reason,
            'conditions' => $conds,
        ];
    }
} catch (Throwable $e) { /* silent — no HPA is a valid state (fixed replicas) */ }

// Sort chronologically + dedupe (same pod restarted twice in the same
// step-bucket rarely produces two events, but the sort helps rendering).
usort($events, fn($a, $b) => $a['ts'] <=> $b['ts']);

$asSeries = function(array $matrix): array {
    // Flatten (already single series after `sum()`) → [[ts, value], ...]
    if (empty($matrix[0]['values'])) return [];
    return array_map(fn($p) => [(int)$p[0], (float)$p[1]], $matrix[0]['values']);
};

// Per-pod matrix → [{pod, values: [[ts, val], ...]}], filtered to pods that
// belong to THIS workload (sibling workloads with a shared prefix stay out).
$asMulti = function(array $matrix) use ($service): array {
    $out = [];
    foreach ($matrix as $row) {
        $pod = (string)($row['metric']['pod'] ?? '');
        if ($pod === '' || _spStripPodHash($pod) !== $service) continue;
        $out[] = [
            'pod'    => $pod,
            'values' => array_map(fn($p) => [(int)$p[0], (float)$p[1]], $row['values'] ?? []),
        ];
    }
    usort($out, fn($a, $b) => strnatcasecmp($a['pod'], $b['pod']));
    return $out;
};

// ── Step 4 (optional): JVM heap from Micrometer datasource ─────────────────
// When the source config declares `jvmDsUid` (typically points at a separate
// "Thanos OnPrem" that scrapes /actuator/prometheus), fire the SAME query
// Grafana's "core-service mem %" panel uses so numbers line up byte-for-byte.
// The `pct` query is the primary — computed Prometheus-side so there's zero
// chance of divergence from Grafana. `used` and `max` are pulled separately
// only for the "169 MB / 361 MB" caption under the gauge.
// Returns null for non-Java services (empty vector) so the UI hides the gauge.
$jvm = null;
$app = null;
$jvmDsUid = (string)($foundSrc['jvmDsUid'] ?? '');
if ($jvmDsUid !== '' && $selectedCluster !== '') {
    $jvmSrc = $foundSrc;
    $jvmSrc['dsUid'] = $jvmDsUid;
    $jvmSel = "app_name=\"{$service}\",cluster=\"{$selectedCluster}\"";
    try {
        // Bundle heap + HTTP throughput into one parallel batch — same
        // datasource, one HTTP round-trip. Spring Boot / Micrometer apps
        // expose `http_server_requests_seconds_{count,sum}`; non-Spring apps
        // return empty for those and the UI hides the app-metrics rows.
        $jvmRes = spQueryPromQL($jvmSrc, [
            'pct'    => "avg(jvm_memory_used_bytes{{$jvmSel}}) / avg(jvm_memory_max_bytes{{$jvmSel}}) * 100",
            'used'   => "avg(jvm_memory_used_bytes{{$jvmSel}})",
            'max'    => "avg(jvm_memory_max_bytes{{$jvmSel}})",
            // Total request throughput across the workload (req/sec)
            'txnRate'=> "sum(rate(http_server_requests_seconds_count{{$jvmSel}}[5m]))",
            // Cumulative time / cumulative count = avg per-request latency
            'procMs' => "(sum(rate(http_server_requests_seconds_sum{{$jvmSel}}[5m])) / sum(rate(http_server_requests_seconds_count{{$jvmSel}}[5m]))) * 1000",
        ]);
        $pctVal  = isset($jvmRes['pct'][0]['value'][1])  ? (float)$jvmRes['pct'][0]['value'][1]  : null;
        $usedVal = isset($jvmRes['used'][0]['value'][1]) ? (float)$jvmRes['used'][0]['value'][1] : 0;
        $maxVal  = isset($jvmRes['max'][0]['value'][1])  ? (float)$jvmRes['max'][0]['value'][1]  : 0;
        if ($pctVal !== null) {
            $jvm = [
                'memUsed' => (int)round($usedVal),
                'memMax'  => (int)round($maxVal),
                'memPct'  => round($pctVal, 1),
            ];
        }
        $txnVal = isset($jvmRes['txnRate'][0]['value'][1]) ? (float)$jvmRes['txnRate'][0]['value'][1] : null;
        $procVal= isset($jvmRes['procMs'][0]['value'][1])  ? (float)$jvmRes['procMs'][0]['value'][1]  : null;
        if ($txnVal !== null || $procVal !== null) {
            $app = [
                // Spring Boot HTTP throughput — req/sec across the whole
                // workload (sum), not per pod, so it reads as "TPS".
                'txnRate'    => $txnVal !== null ? round($txnVal, 2) : null,
                // Avg processing time — cumulative time ÷ cumulative count
                // gives the moving average request latency in ms.
                'procTimeMs' => $procVal !== null ? round($procVal, 1) : null,
                'endpoints'  => [],
            ];
        }

        // ── Per-endpoint breakdown ────────────────────────────────────────
        // Group requests by (method, uri, status) and tag 2xx/4xx/5xx buckets
        // so ops can spot which endpoint is spraying errors. Also pull the
        // per-endpoint average latency to expose slow paths.
        try {
            // `latencyMax` = REAL max request duration per endpoint, taken
            // from `http_server_requests_seconds_max` (Micrometer's per-scrape
            // max gauge). This is what makes 30-second spikes visible — the
            // avg-ratio metric smooths them out into a flat line near mean.
            // `latencyMin` intentionally omitted — no true per-scrape min
            // in Micrometer summaries; would need histogram buckets.
            $epRes = spQueryPromQL($jvmSrc, [
                'byStatus'   => "sum by (method, uri, status) (rate(http_server_requests_seconds_count{{$jvmSel}}[5m]))",
                'latency'    => "sum by (method, uri) (rate(http_server_requests_seconds_sum{{$jvmSel}}[5m])) / (sum by (method, uri) (rate(http_server_requests_seconds_count{{$jvmSel}}[5m])) > 0) * 1000",
                'latencyMax' => "max by (method, uri) (http_server_requests_seconds_max{{$jvmSel}}) * 1000",
                // p95/p99 from histogram buckets — only exists when service
                // exports `management.metrics.distribution.percentiles-histogram.http.server.requests=true`.
                // Empty result = service publishes only summary (count/sum) not
                // histogram → frontend hides these columns for this service.
                'p95'        => "histogram_quantile(0.95, sum by (le, method, uri) (rate(http_server_requests_seconds_bucket{{$jvmSel}}[5m]))) * 1000",
                'p99'        => "histogram_quantile(0.99, sum by (le, method, uri) (rate(http_server_requests_seconds_bucket{{$jvmSel}}[5m]))) * 1000",
            ]);
            $endpointMap = [];
            foreach ($epRes['byStatus'] ?? [] as $r) {
                $m       = $r['metric'] ?? [];
                $method  = (string)($m['method'] ?? '');
                $uri     = (string)($m['uri']    ?? '');
                if ($uri === '') continue;
                $key     = $method . ' ' . $uri;
                $statusS = (string)($m['status'] ?? '');
                $status  = (int)$statusS;
                $val     = (float)($r['value'][1] ?? 0);
                if (!isset($endpointMap[$key])) {
                    $endpointMap[$key] = [
                        'method'          => $method,
                        'uri'             => $uri,
                        'rateTotal'       => 0.0,
                        'rate2xx'         => 0.0,
                        'rate4xx'         => 0.0,
                        'rate5xx'         => 0.0,
                        'rateOther'       => 0.0,
                        'latencyMs'       => null,
                        'latencyMaxMs'    => null,
                        'latencyP95Ms'    => null,
                        'latencyP99Ms'    => null,
                        // Per-status-code breakdown so the UI can render pills
                        // like "400 × 30/s · 404 × 10.36/s" instead of only
                        // the 4xx bucket total (user asked to see WHICH code).
                        'statusBreakdown' => [],
                    ];
                }
                $endpointMap[$key]['rateTotal'] += $val;
                if      ($status >= 200 && $status < 300) $endpointMap[$key]['rate2xx']   += $val;
                elseif ($status >= 400 && $status < 500) $endpointMap[$key]['rate4xx']   += $val;
                elseif ($status >= 500 && $status < 600) $endpointMap[$key]['rate5xx']   += $val;
                else                                     $endpointMap[$key]['rateOther'] += $val;
                if ($statusS !== '') {
                    if (!isset($endpointMap[$key]['statusBreakdown'][$statusS])) {
                        $endpointMap[$key]['statusBreakdown'][$statusS] = 0.0;
                    }
                    $endpointMap[$key]['statusBreakdown'][$statusS] += $val;
                }
            }
            foreach ($epRes['latency'] ?? [] as $r) {
                $m      = $r['metric'] ?? [];
                $key    = ($m['method'] ?? '') . ' ' . ($m['uri'] ?? '');
                if (isset($endpointMap[$key])) {
                    $endpointMap[$key]['latencyMs'] = (float)($r['value'][1] ?? 0);
                }
            }
            foreach ($epRes['latencyMax'] ?? [] as $r) {
                $m   = $r['metric'] ?? [];
                $key = ($m['method'] ?? '') . ' ' . ($m['uri'] ?? '');
                if (isset($endpointMap[$key])) $endpointMap[$key]['latencyMaxMs'] = (float)($r['value'][1] ?? 0);
            }
            // histogram_quantile returns NaN for buckets with no data — filter
            // out non-finite values so the UI shows "—" instead of NaN.
            foreach ($epRes['p95'] ?? [] as $r) {
                $m   = $r['metric'] ?? [];
                $key = ($m['method'] ?? '') . ' ' . ($m['uri'] ?? '');
                if (!isset($endpointMap[$key])) continue;
                $v = (float)($r['value'][1] ?? 0);
                if (is_finite($v) && $v > 0) $endpointMap[$key]['latencyP95Ms'] = $v;
            }
            foreach ($epRes['p99'] ?? [] as $r) {
                $m   = $r['metric'] ?? [];
                $key = ($m['method'] ?? '') . ' ' . ($m['uri'] ?? '');
                if (!isset($endpointMap[$key])) continue;
                $v = (float)($r['value'][1] ?? 0);
                if (is_finite($v) && $v > 0) $endpointMap[$key]['latencyP99Ms'] = $v;
            }
            // Sort by total rate desc; ties broken by uri for stable order.
            $endpoints = array_values($endpointMap);
            usort($endpoints, function($a, $b) {
                if ($a['rateTotal'] !== $b['rateTotal']) return $b['rateTotal'] <=> $a['rateTotal'];
                return strcmp($a['method'] . $a['uri'], $b['method'] . $b['uri']);
            });
            // Round for JSON compactness before sending. Convert statusBreakdown
            // from {code:rate} map → sorted array [{status, rate}] so the
            // frontend renders pills in a predictable order (highest rate first).
            foreach ($endpoints as &$ep) {
                $ep['rateTotal'] = round($ep['rateTotal'], 3);
                $ep['rate2xx']   = round($ep['rate2xx'],   3);
                $ep['rate4xx']   = round($ep['rate4xx'],   3);
                $ep['rate5xx']   = round($ep['rate5xx'],   3);
                $ep['rateOther'] = round($ep['rateOther'], 3);
                if ($ep['latencyMs']    !== null) $ep['latencyMs']    = round($ep['latencyMs'],    1);
                if ($ep['latencyMaxMs'] !== null) $ep['latencyMaxMs'] = round($ep['latencyMaxMs'], 1);
                if ($ep['latencyP95Ms'] !== null) $ep['latencyP95Ms'] = round($ep['latencyP95Ms'], 1);
                if ($ep['latencyP99Ms'] !== null) $ep['latencyP99Ms'] = round($ep['latencyP99Ms'], 1);
                $sb = [];
                foreach ($ep['statusBreakdown'] as $code => $rate) {
                    $sb[] = ['status' => (string)$code, 'rate' => round($rate, 3)];
                }
                usort($sb, fn($a, $b) => $b['rate'] <=> $a['rate']);
                $ep['statusBreakdown'] = $sb;
            }
            unset($ep);
            if ($app === null && !empty($endpoints)) {
                $app = ['txnRate' => null, 'procTimeMs' => null];
            }
            if ($app !== null) $app['endpoints'] = $endpoints;
        } catch (Throwable $e) {
            // Silent — endpoint table just won't render.
        }

        // ── Downstream calls (outbound HTTP from this service) ────────────
        // Two candidate metrics carry the REAL downstream URI (not the
        // aggregated `UNKNOWN` from server-side Micrometer):
        //   • `spring_cloud_gateway_requests_seconds_count` — Spring Cloud
        //     Gateway apps. Labels: routeId + routeUri + httpMethod + httpStatusCode
        //   • `http_client_requests_seconds_count`          — any Spring
        //     service that uses RestTemplate/WebClient. Labels: uri + method +
        //     status + client_name (target host)
        // Fire both in parallel; whichever returns data populates `downstream`.
        try {
            // Older Spring Boot (≤2.5) emits `clientName` (camelCase); newer
            // Micrometer (≥2.6) emits `client_name` (snake_case). Group by BOTH
            // so we don't lose rows either way — coalesce in PHP downstream.
            $dsRes = spQueryPromQL($jvmSrc, [
                'scg'         => "sum by (routeId, routeUri, httpMethod, httpStatusCode) (rate(spring_cloud_gateway_requests_seconds_count{{$jvmSel}}[5m]))",
                'scgLatency'  => "sum by (routeId, httpMethod) (rate(spring_cloud_gateway_requests_seconds_sum{{$jvmSel}}[5m])) / (sum by (routeId, httpMethod) (rate(spring_cloud_gateway_requests_seconds_count{{$jvmSel}}[5m])) > 0) * 1000",
                'http'        => "sum by (uri, method, status, client_name, clientName) (rate(http_client_requests_seconds_count{{$jvmSel}}[5m]))",
                'httpLatency' => "sum by (uri, method) (rate(http_client_requests_seconds_sum{{$jvmSel}}[5m])) / (sum by (uri, method) (rate(http_client_requests_seconds_count{{$jvmSel}}[5m])) > 0) * 1000",
            ]);
            $dsMap = [];  // key → aggregated row
            // Detect Spring Cloud Gateway routes whose routeId is a UUID —
            // these come from DYNAMIC route registration (Actuator API /
            // database-backed route locator) rather than static application.yml
            // config, so the routeId is meaningless to humans. When we see
            // UUIDs, collapse rows by routeUri (target host) instead so the
            // user sees "N dynamic routes → target" rather than 20 UUID lines.
            $isUuid = fn(string $s) => (bool)preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $s);
            // Track per-row route-id counts (only meaningful when grouped)
            $dsRouteIds = [];
            // Ingest Spring Cloud Gateway series first (preferred — richer route info)
            foreach ($dsRes['scg'] ?? [] as $r) {
                $m       = $r['metric'] ?? [];
                $method  = (string)($m['httpMethod'] ?? '');
                $routeId = (string)($m['routeId']    ?? '');
                $routeUri= (string)($m['routeUri']   ?? '');
                if ($routeId === '' && $routeUri === '') continue;
                // Group key: use routeUri when routeId is a UUID (dynamic
                // route), else use routeId (static, named route).
                $grouped  = $isUuid($routeId);
                $groupKey = $grouped ? $routeUri : $routeId;
                $key      = 'scg|' . $method . '|' . $groupKey;
                $statusS  = (string)($m['httpStatusCode'] ?? '');
                $status   = (int)$statusS;
                $val      = (float)($r['value'][1] ?? 0);
                if (!isset($dsMap[$key])) {
                    $dsMap[$key] = [
                        'source'          => 'scg',
                        'method'          => $method,
                        // For grouped rows, target is the host (routeUri short-form);
                        // for named routes, target is the routeId (semantic label).
                        'target'          => $grouped ? $routeUri : $routeId,
                        'path'            => $routeUri,
                        'rateTotal'       => 0.0,
                        'rate2xx'         => 0.0,
                        'rate4xx'         => 0.0,
                        'rate5xx'         => 0.0,
                        'rateOther'       => 0.0,
                        'latencyMs'       => null,
                        'statusBreakdown' => [],
                        // Signals to the UI: whether this row aggregates N
                        // dynamic routes, and how many.
                        'grouped'         => $grouped,
                        'dynamicCount'    => 0,
                    ];
                    $dsRouteIds[$key] = [];
                }
                $dsRouteIds[$key][$routeId] = true;
                $dsMap[$key]['rateTotal'] += $val;
                if      ($status >= 200 && $status < 300) $dsMap[$key]['rate2xx']   += $val;
                elseif ($status >= 400 && $status < 500) $dsMap[$key]['rate4xx']   += $val;
                elseif ($status >= 500 && $status < 600) $dsMap[$key]['rate5xx']   += $val;
                else                                     $dsMap[$key]['rateOther'] += $val;
                if ($statusS !== '') {
                    $dsMap[$key]['statusBreakdown'][$statusS] = ($dsMap[$key]['statusBreakdown'][$statusS] ?? 0.0) + $val;
                }
            }
            // Latency query is keyed by (routeId, httpMethod). If the SCG row
            // in $dsMap was grouped by routeUri, we still need to attribute
            // latency values — accept any matching routeId from the group.
            foreach ($dsRes['scgLatency'] ?? [] as $r) {
                $m       = $r['metric'] ?? [];
                $rid     = (string)($m['routeId'] ?? '');
                $method  = (string)($m['httpMethod'] ?? '');
                $val     = (float)($r['value'][1] ?? 0);
                if ($val <= 0) continue;
                // Fast path: direct key (named route)
                $k = 'scg|' . $method . '|' . $rid;
                if (isset($dsMap[$k])) {
                    // For latency, use MAX across the group so a slow route
                    // is still visible rather than getting averaged away.
                    if ($dsMap[$k]['latencyMs'] === null || $val > $dsMap[$k]['latencyMs']) {
                        $dsMap[$k]['latencyMs'] = $val;
                    }
                    continue;
                }
                // Fallback: find the grouped row this routeId belongs to
                foreach ($dsRouteIds as $mapKey => $ridSet) {
                    if (isset($ridSet[$rid]) && str_starts_with($mapKey, 'scg|' . $method . '|')) {
                        if ($dsMap[$mapKey]['latencyMs'] === null || $val > $dsMap[$mapKey]['latencyMs']) {
                            $dsMap[$mapKey]['latencyMs'] = $val;
                        }
                        break;
                    }
                }
            }
            // Fill in dynamicCount for grouped rows
            foreach ($dsMap as $k => &$row) {
                if ($row['grouped']) $row['dynamicCount'] = count($dsRouteIds[$k]);
            }
            unset($row);
            // Ingest generic HTTP client series (RestTemplate/WebClient etc.)
            // Coalesce client_name (snake_case, newer) with clientName
            // (camelCase, older Spring Boot) — a given series has exactly one
            // populated so `$snake ?: $camel` reliably yields the hostname.
            foreach ($dsRes['http'] ?? [] as $r) {
                $m       = $r['metric'] ?? [];
                $method  = (string)($m['method']      ?? '');
                $uri     = (string)($m['uri']         ?? '');
                $client  = (string)($m['client_name'] ?? '') ?: (string)($m['clientName'] ?? '');
                if ($uri === '') continue;
                $key     = 'http|' . $method . '|' . $client . '|' . $uri;
                $statusS = (string)($m['status'] ?? '');
                $status  = (int)$statusS;
                $val     = (float)($r['value'][1] ?? 0);
                if (!isset($dsMap[$key])) {
                    $dsMap[$key] = [
                        'source'          => 'http',
                        'method'          => $method,
                        'target'          => $client,   // "api.krungsri.com"
                        'path'            => $uri,      // "/rest/api/v2/ewallet/payments/..."
                        'rateTotal'       => 0.0,
                        'rate2xx'         => 0.0,
                        'rate4xx'         => 0.0,
                        'rate5xx'         => 0.0,
                        'rateOther'       => 0.0,
                        'latencyMs'       => null,
                        'statusBreakdown' => [],
                    ];
                }
                $dsMap[$key]['rateTotal'] += $val;
                if      ($status >= 200 && $status < 300) $dsMap[$key]['rate2xx']   += $val;
                elseif ($status >= 400 && $status < 500) $dsMap[$key]['rate4xx']   += $val;
                elseif ($status >= 500 && $status < 600) $dsMap[$key]['rate5xx']   += $val;
                else                                     $dsMap[$key]['rateOther'] += $val;
                if ($statusS !== '') {
                    $dsMap[$key]['statusBreakdown'][$statusS] = ($dsMap[$key]['statusBreakdown'][$statusS] ?? 0.0) + $val;
                }
            }
            foreach ($dsRes['httpLatency'] ?? [] as $r) {
                $m   = $r['metric'] ?? [];
                // Latency query is keyed by method+uri only (no client_name); find any matching http row.
                foreach ($dsMap as $k => &$row) {
                    if ($row['source'] === 'http' && $row['method'] === ($m['method'] ?? '') && $row['path'] === ($m['uri'] ?? '')) {
                        $row['latencyMs'] = (float)($r['value'][1] ?? 0);
                    }
                }
                unset($row);
            }
            $downstream = array_values($dsMap);
            usort($downstream, fn($a, $b) => $b['rateTotal'] <=> $a['rateTotal']);
            foreach ($downstream as &$row) {
                $row['rateTotal'] = round($row['rateTotal'], 3);
                $row['rate2xx']   = round($row['rate2xx'],   3);
                $row['rate4xx']   = round($row['rate4xx'],   3);
                $row['rate5xx']   = round($row['rate5xx'],   3);
                $row['rateOther'] = round($row['rateOther'], 3);
                if ($row['latencyMs'] !== null) $row['latencyMs'] = round($row['latencyMs'], 1);
                $sb = [];
                foreach ($row['statusBreakdown'] as $code => $rate) {
                    $sb[] = ['status' => (string)$code, 'rate' => round($rate, 3)];
                }
                usort($sb, fn($a, $b) => $b['rate'] <=> $a['rate']);
                $row['statusBreakdown'] = $sb;
            }
            unset($row);
            if (!empty($downstream)) {
                // Protocol tagging — classify each row so the dependency
                // graph can group by transport (redis / mongo / http / …).
                // Datadog does this via APM integrations; here we infer from
                // the target hostname since our http_client_requests metric
                // records the raw DNS name Micrometer resolved to.
                foreach ($downstream as &$row) {
                    $row['protocol'] = _spClassifyProtocol((string)$row['target'], (string)$row['path']);
                    // Extract a friendly service name from the hostname —
                    // the graph node label uses this instead of the full FQDN
                    // (e.g. "acm-authorization-server" not
                    // "acm-authorization-server.private-a-cloud1p.ascendmoney.io")
                    $row['targetService'] = _spHostToService((string)$row['target']);
                }
                unset($row);
                if ($app === null) $app = ['txnRate' => null, 'procTimeMs' => null, 'endpoints' => []];
                $app['downstream'] = $downstream;
            }
        } catch (Throwable $e) {
            // Silent — downstream section just won't render.
        }

        // ── Upstream callers (services that call THIS service) ────────────
        // Reverse of downstream: find `app_name` values that shipped
        // http_client_requests_seconds_count with a client_name matching this
        // service's DNS hostname. Since Micrometer records client_name as the
        // resolved hostname, we anchor the regex to `^<svc>$` or `^<svc>\.` to
        // avoid false-positive matches on siblings that share a prefix
        // (`mobile-auth` vs `mobile-auth-service`). Errors are split via the
        // `outcome` label (SUCCESS / CLIENT_ERROR / SERVER_ERROR) so the graph
        // node can show a red badge when a caller is seeing failures.
        try {
            $svcEsc = _spPromEscape($service);
            // RE2-friendly: `^svc$` (bare) OR `^svc\.<anything>` (subdomain).
            // Escape math (surprisingly tricky):
            //   • PromQL treats the label-matcher value as a string with its
            //     OWN escape rules — bare `\.` is rejected as "unknown escape
            //     sequence". We MUST send `\\.` on the wire so PromQL unescapes
            //     it to `\.` before handing to RE2 (which then sees a literal
            //     dot). This is different from Grafana Explore, which parses
            //     the query in a friendlier layer that accepts `\.`.
            //   • To emit `\\.` on the wire from a PHP double-quoted string we
            //     write `\\\\.` — PHP `\\\\` = 2 chars `\\`, then a literal `.`.
            //   • `\$` escapes the PHP variable-parser; the `$` reaches
            //     Prometheus as-is (it's the end-of-string anchor).
            $clientPat = "^{$svcEsc}\$|^{$svcEsc}\\\\..*";
            // 3 sources of "who called me" traffic, each with its own metric:
            //   1. http_client_requests_seconds_count{client_name=~"…"}   ← Spring Boot ≥2.6 (snake_case)
            //   2. http_client_requests_seconds_count{clientName=~"…"}    ← Spring Boot ≤2.5 (camelCase)
            //   3. spring_cloud_gateway_requests_seconds_count{routeUri=~"…"} ← SCG (gateways)
            // A given caller service ships EXACTLY one of these — the mobile
            // gateway `tmn-mobile-gateway` shows up ONLY via SCG since Spring
            // Cloud Gateway records outbound traffic there, not via
            // http_client. Merge in PHP so the downstream loop treats them
            // uniformly.
            //
            // SCG's `routeUri` looks like `https://svc.foo.bar:443` — the
            // regex uses `.*<svc>\..*` because routeUri always has a scheme +
            // trailing subdomain, never bare `svc$`. Same double-escape as
            // clientPat: `\\\\.` in PHP → `\\.` on wire → RE2 sees `\.` = dot.
            $scgPat = ".*//{$svcEsc}\\\\..*";
            $upRes = spQueryPromQL($jvmSrc, [
                'byCallerSnake' => "sum by (app_name, outcome) (rate(http_client_requests_seconds_count{client_name=~\"{$clientPat}\"}[5m]))",
                'byCallerCamel' => "sum by (app_name, outcome) (rate(http_client_requests_seconds_count{clientName=~\"{$clientPat}\"}[5m]))",
                'byCallerScg'   => "sum by (app_name, outcome) (rate(spring_cloud_gateway_requests_seconds_count{routeUri=~\"{$scgPat}\"}[5m]))",
                'latencySnake'  => "sum by (app_name) (rate(http_client_requests_seconds_sum{client_name=~\"{$clientPat}\"}[5m])) / (sum by (app_name) (rate(http_client_requests_seconds_count{client_name=~\"{$clientPat}\"}[5m])) > 0) * 1000",
                'latencyCamel'  => "sum by (app_name) (rate(http_client_requests_seconds_sum{clientName=~\"{$clientPat}\"}[5m])) / (sum by (app_name) (rate(http_client_requests_seconds_count{clientName=~\"{$clientPat}\"}[5m])) > 0) * 1000",
                'latencyScg'    => "sum by (app_name) (rate(spring_cloud_gateway_requests_seconds_sum{routeUri=~\"{$scgPat}\"}[5m])) / (sum by (app_name) (rate(spring_cloud_gateway_requests_seconds_count{routeUri=~\"{$scgPat}\"}[5m])) > 0) * 1000",
            ]);
            // Merge across all 3 sources. Each caller ships one variant so
            // no double-counting; SCG's outcome label isn't populated, so
            // those rows land in the "unknown" outcome bucket (which we don't
            // count as errors — see the strtoupper() guard below).
            $upRes['byCaller'] = array_merge(
                $upRes['byCallerSnake'] ?? [],
                $upRes['byCallerCamel'] ?? [],
                $upRes['byCallerScg']   ?? []
            );
            $upRes['latency']  = array_merge(
                $upRes['latencySnake']  ?? [],
                $upRes['latencyCamel']  ?? [],
                $upRes['latencyScg']    ?? []
            );
            $upMap = [];
            foreach ($upRes['byCaller'] ?? [] as $r) {
                $m       = $r['metric'] ?? [];
                $caller  = (string)($m['app_name'] ?? '');
                if ($caller === '' || $caller === $service) continue;
                $outcome = strtoupper((string)($m['outcome'] ?? ''));
                $val     = (float)($r['value'][1] ?? 0);
                if (!isset($upMap[$caller])) {
                    $upMap[$caller] = [
                        'service'   => $caller,
                        'protocol'  => 'http',
                        'rateTotal' => 0.0,
                        'rateError' => 0.0,
                        'latencyMs' => null,
                    ];
                }
                $upMap[$caller]['rateTotal'] += $val;
                // Non-error outcomes vary by source:
                //   • http_client → SUCCESS / INFORMATIONAL / REDIRECTION
                //   • SCG        → SUCCESSFUL / INFORMATIONAL / REDIRECTION
                // Empty = SCG series that never populated `outcome` — treat as
                // ok (SCG-only rate would otherwise all count as errors).
                static $NON_ERROR = ['', 'SUCCESS', 'SUCCESSFUL', 'INFORMATIONAL', 'REDIRECTION'];
                if (!in_array($outcome, $NON_ERROR, true)) {
                    $upMap[$caller]['rateError'] += $val;
                }
            }
            foreach ($upRes['latency'] ?? [] as $r) {
                $m      = $r['metric'] ?? [];
                $caller = (string)($m['app_name'] ?? '');
                if (isset($upMap[$caller])) {
                    // Coalesce: SCG + http_client can both populate latency for
                    // the same caller (unlikely but possible when a gateway
                    // service also uses RestTemplate for side calls). Take the
                    // higher value so a slow path stays visible.
                    $v = (float)($r['value'][1] ?? 0);
                    if ($upMap[$caller]['latencyMs'] === null || $v > $upMap[$caller]['latencyMs']) {
                        $upMap[$caller]['latencyMs'] = $v;
                    }
                }
            }
            $upstream = array_values($upMap);
            usort($upstream, fn($a, $b) => $b['rateTotal'] <=> $a['rateTotal']);
            foreach ($upstream as &$row) {
                $row['rateTotal'] = round($row['rateTotal'], 3);
                $row['rateError'] = round($row['rateError'], 3);
                $row['errorPct']  = $row['rateTotal'] > 0 ? round(($row['rateError'] / $row['rateTotal']) * 100, 2) : 0.0;
                if ($row['latencyMs'] !== null) $row['latencyMs'] = round($row['latencyMs'], 1);
            }
            unset($row);
            // Always set the field (even if empty) so the frontend can tell
            // "queried, no results" from "not queried at all". Same shape for
            // both empty + populated so the UI branches only on length.
            if ($app === null) $app = ['txnRate' => null, 'procTimeMs' => null, 'endpoints' => []];
            $app['upstream']      = $upstream;
            // Diagnostic counts so we can debug label-variant issues live via
            // browser DevTools without adding a full logger.
            $app['upstreamDebug'] = [
                'snakeSeries' => count($upRes['byCallerSnake'] ?? []),
                'camelSeries' => count($upRes['byCallerCamel'] ?? []),
                'scgSeries'   => count($upRes['byCallerScg']   ?? []),
                'clientPat'   => $clientPat,
                'scgPat'      => $scgPat,
            ];
        } catch (Throwable $e) {
            // Non-silent this time — expose the reason via the response so
            // "0 callers" is distinguishable from "the query blew up".
            if ($app === null) $app = ['txnRate' => null, 'procTimeMs' => null, 'endpoints' => []];
            $app['upstream']      = [];
            $app['upstreamError'] = $e->getMessage() . ' @ ' . basename($e->getFile()) . ':' . $e->getLine();
        }

        // ── HTTP client connection pool (Apache HttpComponents) ───────────
        // Surfaces the classic "downstream pool exhausted" failure mode: as
        // `leased` approaches `max`, new requests queue up as `pending` and
        // eventually time out. `_total_max` is per-pod config so we take
        // `max by (pod_ip)` then sum — otherwise a service with N pods would
        // report max as the pod-max, not the fleet capacity.
        try {
            $poolRes = spQueryPromQL($jvmSrc, [
                'pending'   => "sum(httpcomponents_httpclient_pool_total_pending{{$jvmSel}})",
                'leased'    => "sum(httpcomponents_httpclient_pool_total_connections{{$jvmSel},state=\"leased\"})",
                'available' => "sum(httpcomponents_httpclient_pool_total_connections{{$jvmSel},state=\"available\"})",
                'max'       => "sum(max by (pod_ip, httpclient) (httpcomponents_httpclient_pool_total_max{{$jvmSel}}))",
                'poolCount' => "count(count by (httpclient) (httpcomponents_httpclient_pool_total_max{{$jvmSel}}))",
            ]);
            $poolLeased  = isset($poolRes['leased'][0]['value'][1])    ? (float)$poolRes['leased'][0]['value'][1]    : null;
            $poolMax     = isset($poolRes['max'][0]['value'][1])       ? (float)$poolRes['max'][0]['value'][1]       : null;
            $poolPend    = isset($poolRes['pending'][0]['value'][1])   ? (float)$poolRes['pending'][0]['value'][1]   : null;
            $poolAvail   = isset($poolRes['available'][0]['value'][1]) ? (float)$poolRes['available'][0]['value'][1] : null;
            $poolCount   = isset($poolRes['poolCount'][0]['value'][1]) ? (int)$poolRes['poolCount'][0]['value'][1]   : 0;
            // Only expose the block when the service actually reports pool metrics
            // — non-Spring services or those on OkHttp/reactor-netty return empty.
            if ($poolMax !== null && $poolMax > 0) {
                if ($app === null) $app = ['txnRate' => null, 'procTimeMs' => null, 'endpoints' => []];
                $app['httpPool'] = [
                    'pending'   => $poolPend  !== null ? (int)round($poolPend)  : 0,
                    'leased'    => $poolLeased!== null ? (int)round($poolLeased): 0,
                    'available' => $poolAvail !== null ? (int)round($poolAvail) : 0,
                    'max'       => (int)round($poolMax),
                    'utilPct'   => round(($poolLeased !== null ? $poolLeased : 0) / $poolMax * 100, 1),
                    'poolCount' => $poolCount,
                ];
            }
        } catch (Throwable $e) {
            // Silent — pool metrics are a nice-to-have, not core.
        }

        // ── Resilience4j circuit breakers ─────────────────────────────────
        // A circuit breaker is a downstream health guard: after N consecutive
        // failures it "opens" — subsequent calls short-circuit (fail fast) for
        // a cool-down window before probing again. `state="closed"` is healthy;
        // `open` = downstream ruled unhealthy right now; `half_open` = probing
        // recovery. Any non-closed breaker is user-facing risk.
        try {
            $cbRes = spQueryPromQL($jvmSrc, [
                // Per-breaker state (only the ACTIVE state row has value=1)
                'state'      => "resilience4j_circuitbreaker_state{{$jvmSel}}",
                // Rolling failure rate (Resilience4j exposes this as % 0-100).
                // Negative sentinel (-1) means "sliding window not yet full".
                'failRate'   => "avg by (name) (resilience4j_circuitbreaker_failure_rate{{$jvmSel}})",
                'slowRate'   => "avg by (name) (resilience4j_circuitbreaker_slow_call_rate{{$jvmSel}})",
                // Call rate breakdown — kind = successful|failed|not_permitted|ignored
                'calls'      => "sum by (name, kind) (rate(resilience4j_circuitbreaker_calls_seconds_count{{$jvmSel}}[5m]))",
            ]);
            $cbMap = [];   // name → row
            // Ingest state — pick the label where value==1 (Resilience4j emits
            // one row per possible state per breaker per pod).
            foreach ($cbRes['state'] ?? [] as $r) {
                $m = $r['metric'] ?? [];
                $name  = (string)($m['name']  ?? '');
                $state = (string)($m['state'] ?? '');
                $val   = (float)($r['value'][1] ?? 0);
                if ($name === '' || $state === '') continue;
                if (!isset($cbMap[$name])) {
                    $cbMap[$name] = ['name' => $name, 'state' => 'unknown', 'failRate' => null, 'slowRate' => null, 'callsOk' => 0, 'callsFail' => 0, 'callsBlocked' => 0];
                }
                // Multiple pods → same breaker may show "closed" on 4 pods and
                // "half_open" on 1 during a partial recovery. Priority order
                // (worst wins): forced_open > open > half_open > closed.
                if ($val >= 1) {
                    $priority = ['forced_open' => 5, 'open' => 4, 'half_open' => 3, 'closed' => 2, 'disabled' => 1, 'metrics_only' => 0];
                    $curPri = $priority[$cbMap[$name]['state']] ?? -1;
                    $newPri = $priority[$state] ?? 0;
                    if ($newPri > $curPri) $cbMap[$name]['state'] = $state;
                }
            }
            foreach ($cbRes['failRate'] ?? [] as $r) {
                $name = (string)($r['metric']['name'] ?? '');
                if ($name === '' || !isset($cbMap[$name])) continue;
                $v = (float)($r['value'][1] ?? -1);
                $cbMap[$name]['failRate'] = $v < 0 ? null : round($v, 1);
            }
            foreach ($cbRes['slowRate'] ?? [] as $r) {
                $name = (string)($r['metric']['name'] ?? '');
                if ($name === '' || !isset($cbMap[$name])) continue;
                $v = (float)($r['value'][1] ?? -1);
                $cbMap[$name]['slowRate'] = $v < 0 ? null : round($v, 1);
            }
            foreach ($cbRes['calls'] ?? [] as $r) {
                $name = (string)($r['metric']['name'] ?? '');
                $kind = (string)($r['metric']['kind'] ?? '');
                if ($name === '' || !isset($cbMap[$name])) continue;
                $v = (float)($r['value'][1] ?? 0);
                if ($kind === 'successful')     $cbMap[$name]['callsOk']      += $v;
                elseif ($kind === 'failed')     $cbMap[$name]['callsFail']    += $v;
                elseif ($kind === 'not_permitted') $cbMap[$name]['callsBlocked'] += $v;
            }
            if ($cbMap) {
                $breakers = array_values($cbMap);
                // Round call rates for JSON cleanliness
                foreach ($breakers as &$b) {
                    $b['callsOk']      = round($b['callsOk'], 2);
                    $b['callsFail']    = round($b['callsFail'], 2);
                    $b['callsBlocked'] = round($b['callsBlocked'], 2);
                }
                unset($b);
                // ── Range series: state timeline + failure rate + call rate ───
                // Follows the top range picker (start/end/step) so users get
                // real time-filtering "for free" — no separate CB range picker.
                // State timeline is emitted per (name, state) → frontend picks
                // the active state at each timestamp and paints a Gantt bar.
                $cbSeriesByName = [];
                try {
                    $cbRng = spQueryPromRange($jvmSrc, [
                        'state'    => "resilience4j_circuitbreaker_state{{$jvmSel}}",
                        'failRate' => "avg by (name) (resilience4j_circuitbreaker_failure_rate{{$jvmSel}})",
                        'slowRate' => "avg by (name) (resilience4j_circuitbreaker_slow_call_rate{{$jvmSel}})",
                        'callsOk'      => "sum by (name) (rate(resilience4j_circuitbreaker_calls_seconds_count{{$jvmSel},kind=\"successful\"}[5m]))",
                        'callsFail'    => "sum by (name) (rate(resilience4j_circuitbreaker_calls_seconds_count{{$jvmSel},kind=\"failed\"}[5m]))",
                        'callsBlocked' => "sum by (name) (rate(resilience4j_circuitbreaker_calls_seconds_count{{$jvmSel},kind=\"not_permitted\"}[5m]))",
                    ], $start, $end, $step);
                    $init = function($name) use (&$cbSeriesByName) {
                        if (!isset($cbSeriesByName[$name])) {
                            $cbSeriesByName[$name] = [
                                'stateTimeline' => [],   // [{t, state}]
                                'failRate'      => [],
                                'slowRate'      => [],
                                'callsOk'       => [],
                                'callsFail'     => [],
                                'callsBlocked'  => [],
                            ];
                        }
                    };
                    // State: pull per-(name,state,pod) rows. For each timestamp,
                    // pick the worst active state across pods (matches instant
                    // priority: forced_open > open > half_open > closed > ...).
                    $stateByNameByT = [];   // name → t → best state
                    $prio = ['forced_open' => 5, 'open' => 4, 'half_open' => 3, 'closed' => 2, 'disabled' => 1, 'metrics_only' => 0];
                    foreach ($cbRng['state'] ?? [] as $r) {
                        $m = $r['metric'] ?? [];
                        $nm = (string)($m['name']  ?? '');
                        $st = (string)($m['state'] ?? '');
                        if ($nm === '' || $st === '') continue;
                        foreach ($r['values'] ?? [] as $p) {
                            $t = (int)$p[0]; $v = (float)$p[1];
                            if ($v < 1) continue;   // only active state row contributes
                            $cur = $stateByNameByT[$nm][$t] ?? null;
                            if ($cur === null || ($prio[$st] ?? -1) > ($prio[$cur] ?? -1)) {
                                $stateByNameByT[$nm][$t] = $st;
                            }
                        }
                    }
                    foreach ($stateByNameByT as $nm => $pts) {
                        ksort($pts);
                        $init($nm);
                        foreach ($pts as $t => $st) {
                            $cbSeriesByName[$nm]['stateTimeline'][] = [$t, $st];
                        }
                    }
                    // Scalar-by-name series (failRate, slowRate, calls*)
                    $pushRange = function(string $key, string $field) use ($cbRng, &$cbSeriesByName, $init) {
                        foreach ($cbRng[$key] ?? [] as $r) {
                            $nm = (string)($r['metric']['name'] ?? '');
                            if ($nm === '') continue;
                            $init($nm);
                            foreach ($r['values'] ?? [] as $p) {
                                $v = (float)$p[1];
                                if (!is_finite($v) || $v < 0) $v = 0;  // failRate emits -1 for "window not full"
                                $cbSeriesByName[$nm][$field][] = [(int)$p[0], round($v, 2)];
                            }
                        }
                    };
                    $pushRange('failRate',     'failRate');
                    $pushRange('slowRate',     'slowRate');
                    $pushRange('callsOk',      'callsOk');
                    $pushRange('callsFail',    'callsFail');
                    $pushRange('callsBlocked', 'callsBlocked');
                } catch (Throwable $e) {
                    // Silent — chart mode will show "ไม่มีข้อมูล".
                }
                // Attach series to each breaker row for compact frontend consumption.
                foreach ($breakers as &$b) {
                    $b['series'] = $cbSeriesByName[$b['name']] ?? null;
                }
                unset($b);
                // Sort: unhealthy first (open/half_open on top), then by name
                $stateOrder = ['forced_open' => 0, 'open' => 1, 'half_open' => 2, 'closed' => 3, 'disabled' => 4, 'metrics_only' => 5, 'unknown' => 6];
                usort($breakers, function($a, $b) use ($stateOrder) {
                    $ao = $stateOrder[$a['state']] ?? 9;
                    $bo = $stateOrder[$b['state']] ?? 9;
                    if ($ao !== $bo) return $ao <=> $bo;
                    return strcmp($a['name'], $b['name']);
                });
                $openCount = count(array_filter($breakers, fn($b) => in_array($b['state'], ['open', 'forced_open'], true)));
                $halfCount = count(array_filter($breakers, fn($b) => $b['state'] === 'half_open'));
                if ($app === null) $app = ['txnRate' => null, 'procTimeMs' => null, 'endpoints' => []];
                $app['circuitBreakers'] = [
                    'total'     => count($breakers),
                    'open'      => $openCount,
                    'halfOpen'  => $halfCount,
                    'items'     => $breakers,
                ];
            }
        } catch (Throwable $e) {
            // Silent — non-Resilience4j services will just have no breakers key.
        }
    } catch (Throwable $e) {
        // Silent — non-critical. Users still see the main container-mem view.
    }
}

// ══ PHP-FPM app metrics ═══════════════════════════════════════════════════
// For services that expose the php-fpm_exporter (e.g. `ecatalog-web`) instead
// of Micrometer. Detected when no Spring metrics were found. Uses the SAME
// jvmDsUid datasource because prod scrapes both Java and PHP-FPM apps through
// application-metrics-tls. Also grabs `up{app_name=svc}` so the UI can show
// a "scrape DOWN" banner explaining why other tiles are empty when the
// exporter itself is unreachable (this was the ecatalog-web incident:
// exporter died → 0 metrics → no data on any dashboard).
$phpfpm   = null;
$scrapeUp = null;
// Trigger PHP-FPM path when no Spring metrics landed. `$app` can be a non-null
// "shell" object populated by the upstream/circuit-breaker sections above even
// on non-JVM services — so gate on the actual metric (`txnRate === null`) not
// on `$app === null`, otherwise PHP services get skipped.
$appHasSpringMetrics = ($app !== null) && ($app['txnRate'] !== null || !empty($app['endpoints']));
if ($jvmDsUid !== '' && $selectedCluster !== '' && !$appHasSpringMetrics && $jvm === null) {
    $fpmSrc = $foundSrc;
    $fpmSrc['dsUid'] = $jvmDsUid;
    $fpmSel = "app_name=\"{$service}\",cluster=\"{$selectedCluster}\"";
    try {
        // `phpfpm_accepted_conn` (singular) is what the newer exporter emits;
        // older builds use `phpfpm_accepted_connections`. `or` picks whichever
        // series exists so we don't have to detect exporter version upfront.
        $fpmRes = spQueryPromQL($fpmSrc, [
            'up'           => "min(up{{$fpmSel}})",
            'phpfpmUp'     => "min(phpfpm_up{{$fpmSel}})",
            'tps'          => "sum(rate(phpfpm_accepted_conn{{$fpmSel}}[5m])) or sum(rate(phpfpm_accepted_connections{{$fpmSel}}[5m]))",
            'workersBusy'  => "avg(phpfpm_active_processes{{$fpmSel}} / phpfpm_max_active_processes{{$fpmSel}}) * 100",
            'active'       => "sum(phpfpm_active_processes{{$fpmSel}})",
            'idle'         => "sum(phpfpm_idle_processes{{$fpmSel}})",
            'maxActive'    => "sum(phpfpm_max_active_processes{{$fpmSel}})",
            'queue'        => "max(phpfpm_listen_queue{{$fpmSel}})",
            'maxQueue'     => "max(phpfpm_max_listen_queue{{$fpmSel}})",
            'maxChildren'  => "sum(rate(phpfpm_max_children_reached{{$fpmSel}}[5m]))",
            'slowReq'      => "sum(rate(phpfpm_slow_requests{{$fpmSel}}[5m]))",
        ]);
        $pick = function(array $vec): ?float {
            if (!isset($vec[0]['value'][1])) return null;
            $v = (float)$vec[0]['value'][1];
            return is_finite($v) ? $v : null;
        };
        $upV  = $pick($fpmRes['up'] ?? []);
        $pfUp = $pick($fpmRes['phpfpmUp'] ?? []);
        $tps  = $pick($fpmRes['tps'] ?? []);
        if ($upV !== null) $scrapeUp = (int)round($upV);
        if ($pfUp !== null || $tps !== null || $scrapeUp === 0) {
            $round = fn(?float $v, int $d = 2) => $v === null ? null : round($v, $d);
            $intOr = fn(?float $v) => $v === null ? null : (int)round($v);
            $phpfpm = [
                'scrapeUp'          => $scrapeUp,
                'phpfpmUp'          => $intOr($pfUp),
                'txnRate'           => $round($tps),
                'workersBusyPct'    => $round($pick($fpmRes['workersBusy'] ?? []), 1),
                'active'            => $intOr($pick($fpmRes['active'] ?? [])),
                'idle'              => $intOr($pick($fpmRes['idle'] ?? [])),
                'maxActive'         => $intOr($pick($fpmRes['maxActive'] ?? [])),
                'listenQueue'       => $intOr($pick($fpmRes['queue'] ?? [])),
                'maxListenQueue'    => $intOr($pick($fpmRes['maxQueue'] ?? [])),
                'maxChildrenPerSec' => $round($pick($fpmRes['maxChildren'] ?? []), 3),
                'slowReqPerSec'     => $round($pick($fpmRes['slowReq'] ?? []), 3),
            ];
            // Reuse the existing `app.txnRate` plumbing so the TPS tile and the
            // "Transaction Rate" chart light up without frontend forks. Mark
            // kind=phpfpm so the UI hides latency/procTime tiles (PHP-FPM
            // exporter doesn't expose per-request latency).
            if ($tps !== null) {
                if ($app === null) $app = ['endpoints' => []];
                $app['txnRate']    = round($tps, 2);
                $app['procTimeMs'] = null;
                $app['kind']       = 'phpfpm';
            }
        }
        // Range queries — populate txnRate chart + PHP-FPM specific series.
        if ($phpfpm !== null) {
            try {
                $fpmRanges = spQueryPromRange($fpmSrc, [
                    'txnRate'    => "sum(rate(phpfpm_accepted_conn{{$fpmSel}}[5m])) or sum(rate(phpfpm_accepted_connections{{$fpmSel}}[5m]))",
                    'txnRateMax' => "max(sum by (pod_ip) (rate(phpfpm_accepted_conn{{$fpmSel}}[5m]))) or max(sum by (pod_ip) (rate(phpfpm_accepted_connections{{$fpmSel}}[5m])))",
                    'txnRateMin' => "min(sum by (pod_ip) (rate(phpfpm_accepted_conn{{$fpmSel}}[5m]))) or min(sum by (pod_ip) (rate(phpfpm_accepted_connections{{$fpmSel}}[5m])))",
                    'workersBusy'=> "avg(phpfpm_active_processes{{$fpmSel}} / phpfpm_max_active_processes{{$fpmSel}}) * 100",
                    'listenQueue'=> "max(phpfpm_listen_queue{{$fpmSel}})",
                ], $start, $end, $step);
                foreach (['txnRate', 'txnRateMax', 'txnRateMin'] as $k) {
                    if (!empty($fpmRanges[$k])) $jvmRanges[$k] = $fpmRanges[$k];
                }
                $phpfpm['seriesWorkersBusyPct'] = $fpmRanges['workersBusy'] ?? [];
                $phpfpm['seriesListenQueue']    = $fpmRanges['listenQueue'] ?? [];
            } catch (Throwable $e) { /* silent */ }
        }
    } catch (Throwable $e) { /* silent — non-PHP services will just have no phpfpm block */ }
}

// Window-average override: headline "avg" values must reflect the selected
// range, not the instant snapshot. Fold the range series into a single mean
// so summary.cpu*/mem* + app.txnRate/procTimeMs line up with the chart body.
// Falls back to the instant value when the range series is empty (e.g. a
// historical window before the service existed).
$avgOfSeries = function(array $matrix): ?float {
    $vals = $matrix[0]['values'] ?? [];
    if (!$vals) return null;
    $sum = 0.0; $n = 0;
    foreach ($vals as $p) {
        $v = (float)($p[1] ?? 0);
        if (!is_finite($v)) continue;
        $sum += $v; $n++;
    }
    return $n ? $sum / $n : null;
};
$rangeCpu = $avgOfSeries($ranges['cpu'] ?? []);
$rangeMem = $avgOfSeries($ranges['mem'] ?? []);
if ($rangeCpu !== null) $avgCpuUsed = $rangeCpu;
if ($rangeMem !== null) $avgMemUsed = $rangeMem;
$avgThrottledPct = $avgOfSeries($ranges['cpuThrottledPct'] ?? []);
// Window-avg network throughput — used as the headline value on the fallback
// TPS tile so users see a concrete "now" number instead of just a chart line.
$avgNetRxPkts  = $avgOfSeries($ranges['netRxPkts']  ?? []);
$avgNetTxPkts  = $avgOfSeries($ranges['netTxPkts']  ?? []);
$avgNetRxBytes = $avgOfSeries($ranges['netRxBytes'] ?? []);
$avgNetTxBytes = $avgOfSeries($ranges['netTxBytes'] ?? []);
$network = [
    'rxPacketsPerSec' => $avgNetRxPkts  === null ? null : round($avgNetRxPkts, 0),
    'txPacketsPerSec' => $avgNetTxPkts  === null ? null : round($avgNetTxPkts, 0),
    'rxBytesPerSec'   => $avgNetRxBytes === null ? null : (int)round($avgNetRxBytes),
    'txBytesPerSec'   => $avgNetTxBytes === null ? null : (int)round($avgNetTxBytes),
];
// PHP-FPM headline override — instant queries above capture "now", but the
// range picker should drive the tile numbers so 30m vs 6h read differently
// and align with the chart body. Same pattern JVM uses below.
if ($phpfpm !== null) {
    $rangeFpmTxn  = $avgOfSeries($jvmRanges['txnRate'] ?? []);   // txnRate slot was populated by the phpfpm block
    $rangeFpmBusy = $avgOfSeries($phpfpm['seriesWorkersBusyPct'] ?? []);
    $rangeFpmQ    = $avgOfSeries($phpfpm['seriesListenQueue']    ?? []);
    if ($rangeFpmTxn  !== null) $phpfpm['txnRate']        = round($rangeFpmTxn, 2);
    if ($rangeFpmBusy !== null) $phpfpm['workersBusyPct'] = round($rangeFpmBusy, 1);
    if ($rangeFpmQ    !== null) $phpfpm['listenQueue']    = (int)round($rangeFpmQ);
}
if ($app !== null) {
    $rangeTxn = $avgOfSeries($jvmRanges['txnRate'] ?? []);
    $rangeMs  = $avgOfSeries($jvmRanges['procMs']  ?? []);
    if ($rangeTxn !== null) $app['txnRate']    = round($rangeTxn, 2);
    if ($rangeMs  !== null) $app['procTimeMs'] = round($rangeMs, 1);
}

$out = [
    'service'   => $service,
    'found'     => true,
    'runway'    => spSourcePublic($foundSrc),
    'namespace' => $namespace,
    'jvm'       => $jvm,
    'hpa'       => $hpa,
    'summary'   => [
        'pods'         => count($pods),
        // Avg-per-pod values (was workload-total pre-2026-08-04). Aligns with
        // Grafana's per-pod charts; drift comparison stays a direct compare
        // since CSV inventory already declares per-pod cpu/mem limits.
        // cpuCores/memBytes = mean over the selected range (see $avgOfSeries
        // override above) so the headline follows the range picker.
        'cpuCores'     => round($avgCpuUsed,  4),
        'cpuLimit'     => round($avgCpuLimit, 4),
        'cpuPct'       => $avgCpuLimit > 0 ? round(($avgCpuUsed / $avgCpuLimit) * 100, 1) : null,
        'memBytes'     => (int)round($avgMemUsed),
        'memLimit'     => (int)round($avgMemLimit),
        'memPct'       => $avgMemLimit > 0 ? round(($avgMemUsed / $avgMemLimit) * 100, 1) : null,
        // Kept for backwards-compat with the drift card in the frontend.
        // Same numbers as cpuLimit/memLimit above since summary is now per-pod.
        'perPodCpuLimit'    => round($avgCpuLimit,   4),
        'perPodCpuRequest'  => round($avgCpuRequest, 4),
        'perPodMemLimit'    => (int)round($avgMemLimit),
        'perPodMemRequest'  => (int)round($avgMemRequest),
        // CPU throttling — see rangeQ comment. null when kernel doesn't expose
        // CFS metrics (rare — only on CGroupsV2 without stats enabled).
        'cpuThrottledPct'   => $avgThrottledPct === null ? null : round($avgThrottledPct, 2),
    ],
    'pods'      => $pods,
    'series'    => [
        'windowMinutes' => $windowMin,
        'stepSeconds'   => $step,
        'startUnix'     => $start,
        'endUnix'       => $end,
        'isCustom'      => $isCustom,
        'cpu'           => $asSeries($ranges['cpu'] ?? []),
        'cpuMax'        => $asSeries($ranges['cpuMax'] ?? []),
        'cpuMin'        => $asSeries($ranges['cpuMin'] ?? []),
        'mem'           => $asSeries($ranges['mem'] ?? []),
        'memMax'        => $asSeries($ranges['memMax'] ?? []),
        'memMin'        => $asSeries($ranges['memMin'] ?? []),
        'cpuPerPod'     => $asMulti($ranges['cpuPerPod']  ?? []),
        'memPerPod'     => $asMulti($ranges['memPerPod']  ?? []),
        // CPU throttling % over time — see comment on the query above.
        'cpuThrottledPct' => $asSeries($ranges['cpuThrottledPct'] ?? []),
        // Spring Boot HTTP throughput/latency time-series (from jvmDsUid).
        // Empty arrays for non-Spring services so the chart shows "ไม่มีข้อมูล".
        'txnRate'       => $asSeries($jvmRanges['txnRate'] ?? []),
        'txnRateMax'    => $asSeries($jvmRanges['txnRateMax'] ?? []),
        'txnRateMin'    => $asSeries($jvmRanges['txnRateMin'] ?? []),
        'procMs'        => $asSeries($jvmRanges['procMs']  ?? []),
        'procMsMax'     => $asSeries($jvmRanges['procMsMax'] ?? []),
        // Network throughput (always-on fallback — comes from cadvisor, not
        // the app). Frontend swaps these into the TPS/latency cards when
        // primary app metrics are absent (e.g. exporter down) so the page
        // never goes fully blank.
        'netRxPkts'     => $asSeries($ranges['netRxPkts'] ?? []),
        'netTxPkts'     => $asSeries($ranges['netTxPkts'] ?? []),
        'netRxBytes'    => $asSeries($ranges['netRxBytes'] ?? []),
        'netTxBytes'    => $asSeries($ranges['netTxBytes'] ?? []),
    ],
    'inventory'       => spLoadServiceInventory()[strtolower($service)] ?? null,
    // Timeline events (annotations) — restarts + deploys within window.
    // Frontend renders these as vertical dashed lines on every chart so
    // ops can align a latency/CPU spike with "pod restarted at that time"
    // in a single glance instead of pulling up restart-analyzer separately.
    'events'          => $events,
    'fetchedAt'       => date('c'),
    'fromCache'       => false,
    // Multi-cluster support: `clusterOptions` lists every cluster in the winning
    // source that has matching pods for this workload; `selectedCluster` is the
    // one we pinned queries to (either the caller-supplied ?cluster= or the
    // cluster with the most pods). Empty when the source is single-cluster or
    // uses the appScope scheme (which has no cluster concept).
    'clusterOptions'  => $clusterOptions,
    'selectedCluster' => $selectedCluster,
    // Spring Boot HTTP throughput + latency (Micrometer). Null for non-Spring
    // apps or when jvmDsUid isn't configured for this source.
    'app'             => $app,
    // PHP-FPM exporter tiles + `scrapeUp` flag. Null for non-PHP services.
    // When scrapeUp=0 the frontend shows a red banner ("exporter down")
    // explaining why other panels are empty.
    'phpfpm'          => $phpfpm,
    // Network throughput headline values from cadvisor — used by the UI as
    // an always-on fallback for TPS when the app-side exporter is unhealthy.
    'network'         => $network,
];

// Expose PHP-FPM specific time-series alongside the standard series bag so
// the frontend can render "Workers Busy %" and "Listen Queue" charts.
if ($phpfpm !== null) {
    $out['series']['phpfpmWorkersBusyPct'] = $asSeries($phpfpm['seriesWorkersBusyPct'] ?? []);
    $out['series']['phpfpmListenQueue']    = $asSeries($phpfpm['seriesListenQueue']    ?? []);
    unset($out['phpfpm']['seriesWorkersBusyPct'], $out['phpfpm']['seriesListenQueue']);
}

$dir = dirname($cachePath);
if (!is_dir($dir)) @mkdir($dir, 0775, true);
@file_put_contents($cachePath, json_encode($out));

respondOk($out);
