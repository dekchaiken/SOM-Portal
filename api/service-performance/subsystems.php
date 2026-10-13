<?php
/**
 * GET /api/service-performance/subsystems.php
 *   ?service=<name>&runway=<slug>[&cluster=<clu>][&window=<min>|start=&end=]
 *   &sections=hikari,tomcat,jvm,txn,chips
 *
 * Lazy-loaded companion to detail.php. Fires the Micrometer /actuator/prometheus
 * queries that back the DB Pool / Tomcat / Runtime / Transaction tabs in
 * service-performance.html. Each `section` is optional — the endpoint only fires
 * the queries the caller asks for, so opening a single tab doesn't hammer
 * Thanos with 40+ series when 6 will do.
 *
 * Runway + cluster are REQUIRED (skip the auto-detect probe — detail.php
 * already ran it, the caller can just forward the values). This keeps
 * subsystems.php cheap: for one section it's usually 1 HTTP round-trip to
 * Grafana with 5-10 parallel PromQL queries.
 *
 * 60s cache per (service, runway, cluster, sections, window) key.
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
$wantCluster= trim((string)($_GET['cluster']  ?? ''));
$sectionsIn = trim((string)($_GET['sections'] ?? ''));

if ($service === '' || !preg_match('/^[a-z0-9._-]+$/i', $service)) respondError('service is required', 400);
if ($wantRunway === '' || !preg_match('/^[a-z0-9_-]+$/', $wantRunway))  respondError('runway is required', 400);
if ($wantCluster !== '' && !preg_match('/^[a-z0-9._-]+$/i', $wantCluster)) respondError('invalid cluster', 400);

$WHITELIST = ['hikari', 'tomcat', 'jvm', 'txn', 'chips', 'httppool'];
$sections = array_values(array_intersect($WHITELIST, array_filter(array_map('trim', explode(',', $sectionsIn)))));
if (!$sections) respondError('sections required (any of: ' . implode(',', $WHITELIST) . ')', 400);

// Time window — mirrors detail.php's convention.
$MAX_SPAN = 30 * 24 * 60;
$absStart = (int)($_GET['start'] ?? 0);
$absEnd   = (int)($_GET['end']   ?? 0);
$isCustom = $absStart > 0 && $absEnd > $absStart;
if ($isCustom) {
    $spanMin = (int)round(($absEnd - $absStart) / 60);
    if ($spanMin < 5 || $spanMin > $MAX_SPAN) respondError('range out of bounds', 400);
    $windowMin = $spanMin;
} else {
    $windowMin = min($MAX_SPAN, max(5, (int)($_GET['window'] ?? 30)));
}
if ($isCustom) { $start = $absStart; $end = $absEnd; }
else           { $end = time(); $start = $end - ($windowMin * 60); }
$step = max(15, (int)round(($end - $start) / 120));

// Look up the source by slug (skip probing — caller knows the runway).
$cfg = spLoadConfig();
$src = null;
foreach ($cfg['sources'] as $s) {
    if (($s['slug'] ?? '') === $wantRunway) { $src = $s; break; }
}
if (!$src) respondError("Unknown runway '{$wantRunway}'", 404);
$jvmDsUid = (string)($src['jvmDsUid'] ?? '');
if ($jvmDsUid === '') {
    // Source has no Micrometer datasource — return empty sections rather than
    // an error so the frontend can render "no data" gracefully.
    respondOk([
        'service' => $service, 'runway' => $wantRunway, 'cluster' => $wantCluster,
        'sections' => array_fill_keys($sections, null),
        'reason'  => 'source has no jvmDsUid configured',
        'fromCache' => false,
    ]);
}

// ── Cache ──────────────────────────────────────────────────────────
$secKey = implode('_', $sections);
$cKey   = $wantCluster !== '' ? $wantCluster : 'auto';
$winTag = $isCustom ? ($absStart . '_' . $absEnd) : ('w' . $windowMin);
$cacheKey = preg_replace('/[^a-z0-9._-]+/i', '_',
    'sub_' . $service . '_' . $wantRunway . '_c' . $cKey . '_' . $secKey . '_' . $winTag);
$cachePath = teamDataPath('service-performance/cache/subsystems/' . $cacheKey . '.json');
$cacheTtl = 60;
if (file_exists($cachePath) && (time() - (int)filemtime($cachePath)) <= $cacheTtl) {
    $c = json_decode((string)file_get_contents($cachePath), true);
    if (is_array($c)) { $c['fromCache'] = true; respondOk($c); }
}

$jvmSrc = $src;
$jvmSrc['dsUid'] = $jvmDsUid;
$sel = "app_name=\"{$service}\"" . ($wantCluster !== '' ? ",cluster=\"{$wantCluster}\"" : '');

// Helpers to reshape Prometheus results into compact JSON for the UI.
$scalar = function(array $vec) {
    return isset($vec[0]['value'][1]) ? (float)$vec[0]['value'][1] : null;
};
$byLabel = function(array $vec, string $label) {
    $out = [];
    foreach ($vec as $r) {
        $k = (string)($r['metric'][$label] ?? '');
        if ($k === '') continue;
        $out[$k] = (float)($r['value'][1] ?? 0);
    }
    return $out;
};
$asSeries = function(array $matrix) {
    if (empty($matrix[0]['values'])) return [];
    return array_map(fn($p) => [(int)$p[0], (float)$p[1]], $matrix[0]['values']);
};
$asMultiById = function(array $matrix, string $labelKey = 'id') {
    $out = [];
    foreach ($matrix as $row) {
        $k = (string)($row['metric'][$labelKey] ?? '');
        if ($k === '') continue;
        $out[$k] = array_map(fn($p) => [(int)$p[0], (float)$p[1]], $row['values'] ?? []);
    }
    return $out;
};

$results = [];

// ══ HIKARI ══════════════════════════════════════════════════════════
if (in_array('hikari', $sections, true)) {
    try {
        $inst = spQueryPromQL($jvmSrc, [
            'active'      => "sum(hikaricp_connections_active{{$sel}})",
            'idle'        => "sum(hikaricp_connections_idle{{$sel}})",
            'pending'     => "sum(hikaricp_connections_pending{{$sel}})",
            'total'       => "sum(hikaricp_connections{{$sel}})",
            'max'         => "max(hikaricp_connections_max{{$sel}})",
            'min'         => "max(hikaricp_connections_min{{$sel}})",
            'timeoutRate' => "sum(rate(hikaricp_connections_timeout_total{{$sel}}[5m]))",
            'acquireMax'  => "max(hikaricp_connections_acquire_seconds_max{{$sel}})",
            'usageMax'    => "max(hikaricp_connections_usage_seconds_max{{$sel}})",
            'createMax'   => "max(hikaricp_connections_creation_seconds_max{{$sel}})",
            'usageRate'   => "sum(rate(hikaricp_connections_usage_seconds_count{{$sel}}[5m]))",
        ]);
        $rangeQ = [
            'active'     => "sum(hikaricp_connections_active{{$sel}})",
            'idle'       => "sum(hikaricp_connections_idle{{$sel}})",
            'pending'    => "sum(hikaricp_connections_pending{{$sel}})",
            'timeout'    => "sum(rate(hikaricp_connections_timeout_total{{$sel}}[5m]))",
            'acquireMax' => "max(hikaricp_connections_acquire_seconds_max{{$sel}}) * 1000",
            'usageMax'   => "max(hikaricp_connections_usage_seconds_max{{$sel}}) * 1000",
            // Per-pod min/max envelopes — reveals pool-usage skew (one pod
            // hogging connections while others idle). For rate metrics use
            // per-pod rate reduced across pods; for absolute gauges just
            // min/max directly (metric is already labelled by pod).
            'activeMax'     => "max(hikaricp_connections_active{{$sel}})",
            'activeMin'     => "min(hikaricp_connections_active{{$sel}})",
            'idleMax'       => "max(hikaricp_connections_idle{{$sel}})",
            'idleMin'       => "min(hikaricp_connections_idle{{$sel}})",
            'pendingMax'    => "max(hikaricp_connections_pending{{$sel}})",
            'pendingMin'    => "min(hikaricp_connections_pending{{$sel}})",
            'timeoutMax'    => "max(rate(hikaricp_connections_timeout_total{{$sel}}[5m]))",
            'timeoutMin'    => "min(rate(hikaricp_connections_timeout_total{{$sel}}[5m]))",
            // `acquireMax`/`usageMax` primary is already `max(_max)` (biggest
            // pod's worst-per-scrape). Only need min variant for the calmest
            // pod's peak — reveals whether the spike is one-pod or fleet-wide.
            'acquireMaxMin' => "min(hikaricp_connections_acquire_seconds_max{{$sel}}) * 1000",
            'usageMaxMin'   => "min(hikaricp_connections_usage_seconds_max{{$sel}}) * 1000",
        ];
        $rng = spQueryPromRange($jvmSrc, $rangeQ, $start, $end, $step);
        $results['hikari'] = [
            'kpis' => [
                'active'         => $scalar($inst['active']),
                'idle'           => $scalar($inst['idle']),
                'pending'        => $scalar($inst['pending']),
                'total'          => $scalar($inst['total']),
                'max'            => $scalar($inst['max']),
                'min'            => $scalar($inst['min']),
                'timeoutRate'    => $scalar($inst['timeoutRate']),
                'acquireMaxMs'   => $scalar($inst['acquireMax']) === null ? null : round($scalar($inst['acquireMax']) * 1000, 2),
                'usageMaxMs'     => $scalar($inst['usageMax'])   === null ? null : round($scalar($inst['usageMax'])   * 1000, 2),
                'createMaxMs'    => $scalar($inst['createMax'])  === null ? null : round($scalar($inst['createMax'])  * 1000, 2),
                'usageRate'      => $scalar($inst['usageRate']),
            ],
            'series' => [
                'active'     => $asSeries($rng['active']),
                'idle'       => $asSeries($rng['idle']),
                'pending'    => $asSeries($rng['pending']),
                'timeout'    => $asSeries($rng['timeout']),
                'acquireMax' => $asSeries($rng['acquireMax']),
                'usageMax'   => $asSeries($rng['usageMax']),
                'activeMax'     => $asSeries($rng['activeMax']),
                'activeMin'     => $asSeries($rng['activeMin']),
                'idleMax'       => $asSeries($rng['idleMax']),
                'idleMin'       => $asSeries($rng['idleMin']),
                'pendingMax'    => $asSeries($rng['pendingMax']),
                'pendingMin'    => $asSeries($rng['pendingMin']),
                'timeoutMax'    => $asSeries($rng['timeoutMax']),
                'timeoutMin'    => $asSeries($rng['timeoutMin']),
                'acquireMaxMin' => $asSeries($rng['acquireMaxMin']),
                'usageMaxMin'   => $asSeries($rng['usageMaxMin']),
            ],
        ];
    } catch (Throwable $e) {
        $results['hikari'] = ['error' => $e->getMessage()];
    }
}

// ══ TOMCAT ══════════════════════════════════════════════════════════
if (in_array('tomcat', $sections, true)) {
    try {
        // Two label variants for Tomcat: `tomcat_threads_*` (Spring Boot ≥2.0
        // Micrometer) and `Tomcat_ThreadPool_*` (older JMX exporter). Query
        // both; whichever the app exposes populates the numbers.
        $inst = spQueryPromQL($jvmSrc, [
            'busy'         => "max(tomcat_threads_busy_threads{{$sel}})",
            'current'      => "max(tomcat_threads_current_threads{{$sel}})",
            'config'       => "max(tomcat_threads_config_max_threads{{$sel}})",
            'jmxBusy'      => "max(Tomcat_ThreadPool_currentThreadsBusy{{$sel}})",
            'jmxCurrent'   => "max(Tomcat_ThreadPool_currentThreadCount{{$sel}})",
            'jmxMax'       => "max(Tomcat_ThreadPool_maxThreads{{$sel}})",
            'jmxConn'      => "max(Tomcat_ThreadPool_connectionCount{{$sel}})",
            'jmxMaxConn'   => "max(Tomcat_ThreadPool_maxConnections{{$sel}})",
            'jmxAcceptCnt' => "max(Tomcat_ThreadPool_acceptCount{{$sel}})",
            'jmxKeepAliveTimeout' => "max(Tomcat_ThreadPool_keepAliveTimeout{{$sel}})",
            'jmxConnTimeout' => "max(Tomcat_ThreadPool_connectionTimeout{{$sel}})",
            'jmxMinSpare'  => "max(Tomcat_ThreadPool_minSpareThreads{{$sel}})",
        ]);
        $rangeQ = [
            'busy'    => "max(tomcat_threads_busy_threads{{$sel}}) or max(Tomcat_ThreadPool_currentThreadsBusy{{$sel}})",
            'current' => "max(tomcat_threads_current_threads{{$sel}}) or max(Tomcat_ThreadPool_currentThreadCount{{$sel}})",
            'connCount' => "max(Tomcat_ThreadPool_connectionCount{{$sel}})",
            // Existing `busy`/`current`/`connCount` are already `max()` across
            // pods → they ARE the upper band. Only add `min` for the lower
            // bound (idlest pod). Avoids duplicating parallel queries.
            'busyMin'      => "min(tomcat_threads_busy_threads{{$sel}}) or min(Tomcat_ThreadPool_currentThreadsBusy{{$sel}})",
            'currentMin'   => "min(tomcat_threads_current_threads{{$sel}}) or min(Tomcat_ThreadPool_currentThreadCount{{$sel}})",
            'connCountMin' => "min(Tomcat_ThreadPool_connectionCount{{$sel}})",
        ];
        $rng = spQueryPromRange($jvmSrc, $rangeQ, $start, $end, $step);
        $results['tomcat'] = [
            'kpis' => [
                'busy'       => $scalar($inst['busy'])    ?? $scalar($inst['jmxBusy']),
                'current'    => $scalar($inst['current']) ?? $scalar($inst['jmxCurrent']),
                'maxThreads' => $scalar($inst['config'])  ?? $scalar($inst['jmxMax']),
                'connCount'  => $scalar($inst['jmxConn']),
                'maxConnections' => $scalar($inst['jmxMaxConn']),
                'acceptCount' => $scalar($inst['jmxAcceptCnt']),
                'keepAliveTimeout' => $scalar($inst['jmxKeepAliveTimeout']),
                'connectionTimeout' => $scalar($inst['jmxConnTimeout']),
                'minSpareThreads' => $scalar($inst['jmxMinSpare']),
            ],
            'series' => [
                'busy'      => $asSeries($rng['busy']),
                'current'   => $asSeries($rng['current']),
                'connCount' => $asSeries($rng['connCount']),
                'busyMin'      => $asSeries($rng['busyMin']),
                'currentMin'   => $asSeries($rng['currentMin']),
                'connCountMin' => $asSeries($rng['connCountMin']),
            ],
        ];
    } catch (Throwable $e) {
        $results['tomcat'] = ['error' => $e->getMessage()];
    }
}

// ══ JVM (Runtime) ═══════════════════════════════════════════════════
if (in_array('jvm', $sections, true)) {
    try {
        $inst = spQueryPromQL($jvmSrc, [
            'poolUsed'    => "avg by (id, area) (jvm_memory_used_bytes{{$sel}})",
            'poolMax'     => "min by (id, area) (jvm_memory_max_bytes{{$sel}})",
            'threadsLive' => "max(jvm_threads_live_threads{{$sel}}) or max(jvm_threads_current{{$sel}})",
            'threadsPeak' => "max(jvm_threads_peak_threads{{$sel}}) or max(jvm_threads_peak{{$sel}})",
            'threadsDaemon' => "max(jvm_threads_daemon_threads{{$sel}}) or max(jvm_threads_daemon{{$sel}})",
            // Thread-state breakdown — Micrometer bucketizes JVM Thread.State
            // into runnable / blocked / waiting / timed-waiting / new / terminated.
            // BLOCKED>0 = lock contention (synchronized), WAITING pile = async pool
            // exhaustion. Diagnoses "slow but low CPU" scenarios.
            'threadsByState' => "sum by (state) (jvm_threads_states_threads{{$sel}})",
            // Classloader leak signal — classes_loaded rising monotonically
            // (never dips despite GC) means Metaspace is filling with old
            // ClassLoader instances (Groovy/hot-reload/reflection heavy code).
            'classesLoaded'  => "max(jvm_classes_loaded_classes{{$sel}})",
            // Off-heap buffer pools — direct + mapped byte buffers. Explains
            // "container mem grows but heap stays flat" (Netty allocations,
            // image/PDF libs). Grouped by pool id.
            'buffersUsed'    => "sum by (id) (jvm_buffer_memory_used_bytes{{$sel}})",
            'buffersCount'   => "sum by (id) (jvm_buffer_count_buffers{{$sel}})",
            'sysCpu'      => "avg(system_cpu_usage{{$sel}})",
            'procCpu'     => "avg(process_cpu_usage{{$sel}})",
            'load1'       => "avg(system_load_average_1m{{$sel}})",
            'filesOpen'   => "max(process_files_open_files{{$sel}}) or max(process_files_open{{$sel}})",
            'filesMax'    => "max(process_files_max_files{{$sel}}) or max(process_files_max{{$sel}})",
            'gcPauseMax'  => "max(jvm_gc_pause_seconds_max{{$sel}})",
            'gcPauseRate' => "sum(rate(jvm_gc_pause_seconds_sum{{$sel}}[5m]))",
            'gcCount'     => "sum(rate(jvm_gc_pause_seconds_count{{$sel}}[5m]))",
            'uptime'      => "max(process_uptime_seconds{{$sel}})",
        ]);
        $rangeQ = [
            'poolUsed'    => "avg by (id) (jvm_memory_used_bytes{{$sel}})",
            'threadsLive' => "max(jvm_threads_live_threads{{$sel}}) or max(jvm_threads_current{{$sel}})",
            // Range series for new Bundle A metrics (used by charts in Runtime tab)
            'threadsByState' => "sum by (state) (jvm_threads_states_threads{{$sel}})",
            'classesLoaded'  => "max(jvm_classes_loaded_classes{{$sel}})",
            'buffersUsed'    => "sum by (id) (jvm_buffer_memory_used_bytes{{$sel}})",
            'sysCpu'      => "avg(system_cpu_usage{{$sel}}) * 100",
            'procCpu'     => "avg(process_cpu_usage{{$sel}}) * 100",
            'load1'       => "avg(system_load_average_1m{{$sel}})",
            'gcPauseMax'  => "max(jvm_gc_pause_seconds_max{{$sel}}) * 1000",
            'gcPauseRate' => "sum(rate(jvm_gc_pause_seconds_sum{{$sel}}[5m])) * 1000",
            'filesOpen'   => "max(process_files_open_files{{$sel}}) or max(process_files_open{{$sel}})",
            // Per-pod envelopes. Skip `Max` variants where the primary series
            // is already `max(...)` — those duplicate work. For CPU/load
            // which use `avg(...)` primary, add both bounds.
            'threadsLiveMin' => "min(jvm_threads_live_threads{{$sel}}) or min(jvm_threads_current{{$sel}})",
            'sysCpuMax'      => "max(system_cpu_usage{{$sel}}) * 100",
            'sysCpuMin'      => "min(system_cpu_usage{{$sel}}) * 100",
            'procCpuMax'     => "max(process_cpu_usage{{$sel}}) * 100",
            'procCpuMin'     => "min(process_cpu_usage{{$sel}}) * 100",
            'load1Max'       => "max(system_load_average_1m{{$sel}})",
            'load1Min'       => "min(system_load_average_1m{{$sel}})",
            'gcPauseMaxMin'  => "min(jvm_gc_pause_seconds_max{{$sel}}) * 1000",
            'filesOpenMin'   => "min(process_files_open_files{{$sel}}) or min(process_files_open{{$sel}})",
        ];
        $rng = spQueryPromRange($jvmSrc, $rangeQ, $start, $end, $step);

        // Pools: merge used + max by id/area for the pool table
        $usedMap = []; $maxMap = []; $areaMap = [];
        foreach ($inst['poolUsed'] ?? [] as $r) {
            $id = (string)($r['metric']['id'] ?? '');
            if ($id === '') continue;
            $usedMap[$id]  = (float)($r['value'][1] ?? 0);
            $areaMap[$id]  = (string)($r['metric']['area'] ?? '');
        }
        foreach ($inst['poolMax'] ?? [] as $r) {
            $id = (string)($r['metric']['id'] ?? '');
            if ($id === '') continue;
            $maxMap[$id] = (float)($r['value'][1] ?? 0);
        }
        $pools = [];
        foreach ($usedMap as $id => $used) {
            $max = $maxMap[$id] ?? 0;
            $pools[] = [
                'id'   => $id,
                'area' => $areaMap[$id] ?? '',
                'used' => (int)round($used),
                'max'  => (int)round($max),
                'pct'  => $max > 0 ? round(($used / $max) * 100, 1) : null,
            ];
        }
        // Heap pools first, then non-heap; within each, sort by descending used.
        usort($pools, function($a, $b) {
            $ar = $a['area'] === 'heap' ? 0 : 1;
            $br = $b['area'] === 'heap' ? 0 : 1;
            if ($ar !== $br) return $ar <=> $br;
            return $b['used'] <=> $a['used'];
        });

        // Thread-state map (state → count). BLOCKED/WAITING are the ones ops
        // actually care about; the frontend surfaces those + shows the full
        // stacked area chart.
        $threadStates = [];
        foreach ($inst['threadsByState'] ?? [] as $r) {
            $st = (string)($r['metric']['state'] ?? '');
            if ($st === '') continue;
            $threadStates[$st] = (int)round((float)($r['value'][1] ?? 0));
        }
        // Off-heap buffer pools (direct + mapped)
        $buffers = [];
        $bufCountMap = [];
        foreach ($inst['buffersCount'] ?? [] as $r) {
            $id = (string)($r['metric']['id'] ?? '');
            if ($id !== '') $bufCountMap[$id] = (int)round((float)($r['value'][1] ?? 0));
        }
        foreach ($inst['buffersUsed'] ?? [] as $r) {
            $id = (string)($r['metric']['id'] ?? '');
            if ($id === '') continue;
            $buffers[] = [
                'id'    => $id,
                'used'  => (int)round((float)($r['value'][1] ?? 0)),
                'count' => $bufCountMap[$id] ?? null,
            ];
        }
        usort($buffers, fn($a, $b) => $b['used'] <=> $a['used']);

        $results['jvm'] = [
            'pools'    => $pools,
            'buffers'  => $buffers,
            'threads'  => [
                'live'   => $scalar($inst['threadsLive']),
                'peak'   => $scalar($inst['threadsPeak']),
                'daemon' => $scalar($inst['threadsDaemon']),
                'byState'=> $threadStates,
            ],
            'classesLoaded' => $scalar($inst['classesLoaded']) === null ? null : (int)$scalar($inst['classesLoaded']),
            'system'   => [
                'sysCpuPct'  => $scalar($inst['sysCpu'])  === null ? null : round($scalar($inst['sysCpu'])  * 100, 1),
                'procCpuPct' => $scalar($inst['procCpu']) === null ? null : round($scalar($inst['procCpu']) * 100, 1),
                'load1'      => $scalar($inst['load1']),
            ],
            'files'    => [
                'open' => $scalar($inst['filesOpen']),
                'max'  => $scalar($inst['filesMax']),
            ],
            'gc'       => [
                'pauseMaxMs' => $scalar($inst['gcPauseMax']) === null ? null : round($scalar($inst['gcPauseMax']) * 1000, 2),
                'pauseRateMsPerSec' => $scalar($inst['gcPauseRate']) === null ? null : round($scalar($inst['gcPauseRate']) * 1000, 2),
                'countPerSec' => $scalar($inst['gcCount']),
            ],
            'uptimeSec' => $scalar($inst['uptime']),
            'series' => [
                'poolUsed'    => $asMultiById($rng['poolUsed']),
                'threadsLive' => $asSeries($rng['threadsLive']),
                'sysCpuPct'   => $asSeries($rng['sysCpu']),
                'procCpuPct'  => $asSeries($rng['procCpu']),
                'load1'       => $asSeries($rng['load1']),
                'gcPauseMaxMs'=> $asSeries($rng['gcPauseMax']),
                'gcPauseRate' => $asSeries($rng['gcPauseRate']),
                'filesOpen'   => $asSeries($rng['filesOpen']),
                'threadsLiveMin' => $asSeries($rng['threadsLiveMin']),
                'sysCpuPctMax'   => $asSeries($rng['sysCpuMax']),
                'sysCpuPctMin'   => $asSeries($rng['sysCpuMin']),
                'procCpuPctMax'  => $asSeries($rng['procCpuMax']),
                'procCpuPctMin'  => $asSeries($rng['procCpuMin']),
                'load1Max'       => $asSeries($rng['load1Max']),
                'load1Min'       => $asSeries($rng['load1Min']),
                'gcPauseMaxMsMin'=> $asSeries($rng['gcPauseMaxMin']),
                'filesOpenMin'   => $asSeries($rng['filesOpenMin']),
                // Bundle A series
                'threadsByState' => $asMultiById($rng['threadsByState'] ?? [], 'state'),
                'classesLoaded'  => $asSeries($rng['classesLoaded'] ?? []),
                'buffersUsed'    => $asMultiById($rng['buffersUsed'] ?? []),
            ],
        ];
    } catch (Throwable $e) {
        $results['jvm'] = ['error' => $e->getMessage()];
    }
}

// ══ TRANSACTION (peaks over the window) ═════════════════════════════
if (in_array('txn', $sections, true)) {
    try {
        // "Peak" values = max_over_time across the selected window. Runs a
        // parallel batch of instant queries with `[<window>]` range vectors.
        $winSec = max(60, (int)($end - $start));
        // Cap the max_over_time window to 30 days to avoid nuking Thanos on
        // huge custom ranges — the value is still an accurate peak within the
        // display window since max_over_time is monotone in window size.
        $winStr = $winSec . 's';
        $inst = spQueryPromQL($jvmSrc, [
            'peakTps'    => "max_over_time(sum(rate(http_server_requests_seconds_count{{$sel}}[1m]))[{$winStr}:15s])",
            'peakClientTps' => "max_over_time(sum(rate(http_client_requests_seconds_count{{$sel}}[1m]))[{$winStr}:15s])",
            'latMaxMs'   => "max_over_time(max(http_server_requests_seconds_max{{$sel}})[{$winStr}:15s]) * 1000",
            'clientRtMaxMs' => "max_over_time(max(http_client_requests_seconds_max{{$sel}})[{$winStr}:15s]) * 1000",
            'peakDbActive' => "max_over_time(max(hikaricp_connections_active{{$sel}})[{$winStr}:15s])",
            'peakDbTotal'  => "max_over_time(max(hikaricp_connections{{$sel}})[{$winStr}:15s])",
            'maxDb'        => "max(hikaricp_connections_max{{$sel}})",
            'minDb'        => "max(hikaricp_connections_min{{$sel}})",
            'peakDbUsage'  => "max_over_time(max(rate(hikaricp_connections_usage_seconds_count{{$sel}}[1m]))[{$winStr}:15s])",
            'peakTcThread' => "max_over_time(max(tomcat_threads_busy_threads{{$sel}} or Tomcat_ThreadPool_currentThreadsBusy{{$sel}})[{$winStr}:15s])",
            'peakTcConn'   => "max_over_time(max(Tomcat_ThreadPool_connectionCount{{$sel}})[{$winStr}:15s])",
            'peakThreads'  => "max_over_time(max(jvm_threads_live_threads{{$sel}} or jvm_threads_current{{$sel}})[{$winStr}:15s])",
            'peakHeapPct'  => "max_over_time(( avg(jvm_memory_used_bytes{{$sel},area=\"heap\"}) / avg(jvm_memory_max_bytes{{$sel},area=\"heap\"}) * 100 )[{$winStr}:15s])",
        ]);
        $results['txn'] = [
            'windowSec'   => $winSec,
            'peakTps'     => $scalar($inst['peakTps']),
            'peakClientTps' => $scalar($inst['peakClientTps']),
            'latMaxMs'    => $scalar($inst['latMaxMs']),
            'clientRtMaxMs' => $scalar($inst['clientRtMaxMs']),
            'peakDbActive'=> $scalar($inst['peakDbActive']),
            'peakDbTotal' => $scalar($inst['peakDbTotal']),
            'maxDb'       => $scalar($inst['maxDb']),
            'minDb'       => $scalar($inst['minDb']),
            'peakDbUsageQps' => $scalar($inst['peakDbUsage']),
            'peakTcThread'=> $scalar($inst['peakTcThread']),
            'peakTcConn'  => $scalar($inst['peakTcConn']),
            'peakThreads' => $scalar($inst['peakThreads']),
            'peakHeapPct' => $scalar($inst['peakHeapPct']) === null ? null : round($scalar($inst['peakHeapPct']), 1),
        ];
    } catch (Throwable $e) {
        $results['txn'] = ['error' => $e->getMessage()];
    }
}

// ══ HTTP CLIENT POOL (Apache HttpComponents) ═══════════════════════
// Powers the "HTTP Client Pool" subsystem tab — parity with Grafana panel 38
// on bay-pp/JVM dashboards. Surfaces pool saturation as a leading indicator
// of downstream slowdowns: as `leased` climbs toward `max`, `pending` starts
// building → new outbound requests time out → callers see 5xx spikes upstream.
if (in_array('httppool', $sections, true)) {
    try {
        // Instant KPIs
        $inst = spQueryPromQL($jvmSrc, [
            'leased'    => "sum(httpcomponents_httpclient_pool_total_connections{{$sel},state=\"leased\"})",
            'available' => "sum(httpcomponents_httpclient_pool_total_connections{{$sel},state=\"available\"})",
            'pending'   => "sum(httpcomponents_httpclient_pool_total_pending{{$sel}})",
            // `_total_max` is per-pod config → sum(max by pod+httpclient) to get fleet capacity.
            'max'       => "sum(max by (pod_ip, httpclient) (httpcomponents_httpclient_pool_total_max{{$sel}}))",
            'routeMax'  => "avg(httpcomponents_httpclient_pool_route_max_default{{$sel}})",
            // Per-pool breakdown (some services define multiple httpclient beans, one per downstream)
            'byPoolLeased'    => "sum by (httpclient) (httpcomponents_httpclient_pool_total_connections{{$sel},state=\"leased\"})",
            'byPoolAvailable' => "sum by (httpclient) (httpcomponents_httpclient_pool_total_connections{{$sel},state=\"available\"})",
            'byPoolPending'   => "sum by (httpclient) (httpcomponents_httpclient_pool_total_pending{{$sel}})",
            'byPoolMax'       => "sum by (httpclient) (max by (pod_ip, httpclient) (httpcomponents_httpclient_pool_total_max{{$sel}}))",
        ]);
        // Range series for the chart panel (Max/Leased/Available/Pending)
        $rangeQ = [
            'leased'    => "sum(httpcomponents_httpclient_pool_total_connections{{$sel},state=\"leased\"})",
            'available' => "sum(httpcomponents_httpclient_pool_total_connections{{$sel},state=\"available\"})",
            'pending'   => "sum(httpcomponents_httpclient_pool_total_pending{{$sel}})",
            'max'       => "sum(max by (pod_ip, httpclient) (httpcomponents_httpclient_pool_total_max{{$sel}}))",
            // Per-pod envelope for leased/pending → surface hot pod
            'leasedMax'  => "max by (pod_ip) (sum by (pod_ip) (httpcomponents_httpclient_pool_total_connections{{$sel},state=\"leased\"}))",
            'leasedMin'  => "min by (pod_ip) (sum by (pod_ip) (httpcomponents_httpclient_pool_total_connections{{$sel},state=\"leased\"}))",
            'pendingMax' => "max by (pod_ip) (sum by (pod_ip) (httpcomponents_httpclient_pool_total_pending{{$sel}}))",
        ];
        $rng = spQueryPromRange($jvmSrc, $rangeQ, $start, $end, $step);

        $leased   = $scalar($inst['leased']);
        $avail    = $scalar($inst['available']);
        $pending  = $scalar($inst['pending']);
        $maxCap   = $scalar($inst['max']);
        $routeMax = $scalar($inst['routeMax']);

        // Only expose when the service actually reports pool metrics.
        if ($maxCap === null || $maxCap <= 0) {
            $results['httppool'] = null;   // frontend hides section on empty
        } else {
            // Merge per-pool rows keyed by httpclient bean name.
            $poolsMap = [];
            $ingest = function(string $key, string $field) use (&$poolsMap, $inst) {
                foreach ($inst[$key] ?? [] as $r) {
                    $name = (string)($r['metric']['httpclient'] ?? '');
                    if ($name === '') continue;
                    if (!isset($poolsMap[$name])) {
                        $poolsMap[$name] = ['name' => $name, 'leased' => 0, 'available' => 0, 'pending' => 0, 'max' => 0];
                    }
                    $poolsMap[$name][$field] = (float)($r['value'][1] ?? 0);
                }
            };
            $ingest('byPoolLeased',    'leased');
            $ingest('byPoolAvailable', 'available');
            $ingest('byPoolPending',   'pending');
            $ingest('byPoolMax',       'max');
            $pools = [];
            foreach ($poolsMap as $p) {
                $p['utilPct'] = $p['max'] > 0 ? round($p['leased'] / $p['max'] * 100, 1) : null;
                $p['leased']    = (int)round($p['leased']);
                $p['available'] = (int)round($p['available']);
                $p['pending']   = (int)round($p['pending']);
                $p['max']       = (int)round($p['max']);
                $pools[] = $p;
            }
            // Order: highest utilization first (hottest pool on top).
            usort($pools, fn($a, $b) => ($b['utilPct'] ?? 0) <=> ($a['utilPct'] ?? 0));

            $utilPct = ($leased !== null && $maxCap > 0) ? round($leased / $maxCap * 100, 1) : null;
            $results['httppool'] = [
                'kpis' => [
                    'leased'    => $leased    !== null ? (int)round($leased)   : 0,
                    'available' => $avail     !== null ? (int)round($avail)    : 0,
                    'pending'   => $pending   !== null ? (int)round($pending)  : 0,
                    'max'       => (int)round($maxCap),
                    'routeMax'  => $routeMax  !== null ? (int)round($routeMax) : null,
                    'utilPct'   => $utilPct,
                    'poolCount' => count($pools),
                ],
                'pools' => $pools,
                'series' => [
                    'leased'     => $asSeries($rng['leased']),
                    'available'  => $asSeries($rng['available']),
                    'pending'    => $asSeries($rng['pending']),
                    'max'        => $asSeries($rng['max']),
                    'leasedMax'  => $asSeries($rng['leasedMax']),
                    'leasedMin'  => $asSeries($rng['leasedMin']),
                    'pendingMax' => $asSeries($rng['pendingMax']),
                ],
            ];
        }
    } catch (Throwable $e) {
        $results['httppool'] = ['error' => $e->getMessage()];
    }
}

// ══ CHIPS (fast health summary — powers the Command Center chip row) ═════
if (in_array('chips', $sections, true)) {
    try {
        $inst = spQueryPromQL($jvmSrc, [
            'dbActive'   => "sum(hikaricp_connections_active{{$sel}})",
            'dbMax'      => "max(hikaricp_connections_max{{$sel}})",
            'dbPending'  => "sum(hikaricp_connections_pending{{$sel}})",
            'dbTimeout'  => "sum(rate(hikaricp_connections_timeout_total{{$sel}}[5m]))",
            'tcBusy'     => "max(tomcat_threads_busy_threads{{$sel}} or Tomcat_ThreadPool_currentThreadsBusy{{$sel}})",
            'tcMax'      => "max(tomcat_threads_config_max_threads{{$sel}} or Tomcat_ThreadPool_maxThreads{{$sel}})",
            'gcPauseMax' => "max(jvm_gc_pause_seconds_max{{$sel}}) * 1000",
            'gcCount'    => "sum(rate(jvm_gc_pause_seconds_count{{$sel}}[5m]))",
            'threadsLive'=> "max(jvm_threads_live_threads{{$sel}} or jvm_threads_current{{$sel}})",
            'heapPct'    => "avg(jvm_memory_used_bytes{{$sel},area=\"heap\"}) / avg(jvm_memory_max_bytes{{$sel},area=\"heap\"}) * 100",
        ]);
        $dbActive = $scalar($inst['dbActive']);
        $dbMax    = $scalar($inst['dbMax']);
        $dbPending= $scalar($inst['dbPending']);
        $dbTimeout= $scalar($inst['dbTimeout']);
        $tcBusy   = $scalar($inst['tcBusy']);
        $tcMax    = $scalar($inst['tcMax']);
        $gcPause  = $scalar($inst['gcPauseMax']);
        $threads  = $scalar($inst['threadsLive']);
        $heapPct  = $scalar($inst['heapPct']);

        $dbState = 'na';
        if ($dbActive !== null) {
            $ratio = ($dbMax && $dbMax > 0) ? ($dbActive / $dbMax) : 0;
            $dbState = ($dbTimeout > 0.05 || $dbPending > 0 || $ratio >= 0.9) ? 'hot'
                     : (($dbTimeout > 0 || $ratio >= 0.7) ? 'warn' : 'ok');
        }
        $tcState = 'na';
        if ($tcBusy !== null) {
            $ratio = ($tcMax && $tcMax > 0) ? ($tcBusy / $tcMax) : 0;
            $tcState = $ratio >= 0.9 ? 'hot' : ($ratio >= 0.7 ? 'warn' : 'ok');
        }
        $gcState = 'na';
        if ($gcPause !== null) {
            $gcState = $gcPause >= 500 ? 'hot' : ($gcPause >= 100 ? 'warn' : 'ok');
        }
        $thState = $threads === null ? 'na' : ($threads >= 500 ? 'warn' : 'ok');

        $results['chips'] = [
            'dbPool' => [
                'state' => $dbState,
                'label' => $dbActive === null ? 'no data'
                    : sprintf('%d/%s active%s', (int)$dbActive,
                        $dbMax ? (int)$dbMax : '?',
                        $dbPending > 0 ? ' · ' . (int)$dbPending . ' pending' : ''),
                'active' => $dbActive,
                'max'    => $dbMax,
                'pending'=> $dbPending,
                'timeoutRate' => $dbTimeout,
            ],
            'tomcat' => [
                'state' => $tcState,
                'label' => $tcBusy === null ? 'no data'
                    : sprintf('%d/%s busy', (int)$tcBusy, $tcMax ? (int)$tcMax : '?'),
                'busy'  => $tcBusy,
                'max'   => $tcMax,
            ],
            'gc' => [
                'state' => $gcState,
                'label' => $gcPause === null ? 'no data'
                    : sprintf('%s pause · %s/s',
                        $gcPause >= 1 ? number_format($gcPause, 0) . ' ms' : number_format($gcPause, 2) . ' ms',
                        $scalar($inst['gcCount']) === null ? '?' : number_format($scalar($inst['gcCount']), 2)),
                'pauseMaxMs' => $gcPause,
                'countPerSec'=> $scalar($inst['gcCount']),
            ],
            'threads' => [
                'state' => $thState,
                'label' => $threads === null ? 'no data' : (int)$threads . ' live',
                'live'  => $threads,
            ],
            'heap' => [
                'state' => $heapPct === null ? 'na' : ($heapPct >= 85 ? 'hot' : ($heapPct >= 70 ? 'warn' : 'ok')),
                'label' => $heapPct === null ? 'no data' : number_format($heapPct, 1) . '%',
                'pct'   => $heapPct === null ? null : round($heapPct, 1),
            ],
        ];
    } catch (Throwable $e) {
        $results['chips'] = ['error' => $e->getMessage()];
    }
}

$out = [
    'service'  => $service,
    'runway'   => $wantRunway,
    'cluster'  => $wantCluster,
    'sections' => $results,
    'window'   => [
        'startUnix' => $start, 'endUnix' => $end,
        'windowMinutes' => $windowMin, 'stepSeconds' => $step,
        'isCustom' => $isCustom,
    ],
    'fetchedAt' => date('c'),
    'fromCache' => false,
];

$dir = dirname($cachePath);
if (!is_dir($dir)) @mkdir($dir, 0775, true);
@file_put_contents($cachePath, json_encode($out));

respondOk($out);
