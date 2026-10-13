<?php
/**
 * GET /api/restart-analyzer/index.php?service=<name>&range=<1h|6h|24h|7d>
 *
 * Multi-phase pod-restart forensics. Builds a cascade of evidence steps that
 * the frontend renders as a narrative story — mimicking how a human ops
 * engineer would investigate a restart alert.
 *
 * Investigation pipeline:
 *   Phase 1 · Trigger      → when + how many pods + last-terminated reason
 *   Phase 2 · Resources    → mem/cpu pressure, throttling, memory failcnt
 *   Phase 3 · Network      → packet drops, TX/RX errors
 *   Phase 4 · K8s waiting  → CrashLoopBackOff / ImagePull / etc
 *   Phase 5 · Placement    → coordinated timing, node co-location analysis
 *   Phase 6 · Downstream   → HTTP client 5xx spike, latency spike, target
 *                            services showing errors in the preceding 5 min
 *   Phase 7 · Self-metrics → JVM heap/GC/threads if Spring Boot
 *   Phase 8 · Timeline     → range-query series for the chart
 *
 * Verdict priority (final):
 *   OOMKilled → oom
 *   Error exit → app-crash
 *   Downstream 5xx spike + Completed → downstream-failure
 *   Coordinated Completed w/o pressure → external-sigterm
 *   Scattered Completed → individual-restart
 *   Otherwise → no-restart / inconclusive
 */
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/../service-performance/_lib.php';

ini_set('memory_limit', '384M');
set_time_limit(90);
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

$service = trim((string)($_GET['service'] ?? ''));
$range   = trim((string)($_GET['range']   ?? '1h'));
// Custom absolute range: ?start=<unix>&end=<unix>. Overrides `range` when
// both are valid. Same shape as service-performance/detail.php so the
// picker on the frontend can be shared 1:1.
$absStart = (int)($_GET['start'] ?? 0);
$absEnd   = (int)($_GET['end']   ?? 0);
if ($service === '' || !preg_match('/^[a-z0-9._-]+$/i', $service)) {
    respondError('service is required (letters/digits/._-)', 400);
}
$RANGE_MAP = ['1h' => 3600, '6h' => 21600, '24h' => 86400, '7d' => 604800];
$isCustom  = $absStart > 0 && $absEnd > $absStart;
if ($isCustom) {
    $rangeSec = $absEnd - $absStart;
    if ($rangeSec < 300)         respondError('range must be at least 5 minutes', 400);
    if ($rangeSec > 30 * 86400)  respondError('range too large (max 30 days)', 400);
    // Prometheus range-vector syntax expects `Ns` for arbitrary seconds.
    $rangeExpr = $rangeSec . 's';
    // Human-readable label for cache key + response.
    $range = 'custom_' . $absStart . '_' . $absEnd;
} else {
    if (!isset($RANGE_MAP[$range])) respondError('range must be 1h/6h/24h/7d or start/end', 400);
    $rangeSec  = $RANGE_MAP[$range];
    $rangeExpr = $range;
}

// Pick first source with dsUid (Thanos federates k8s metrics across runways).
// JVM/app metrics live on jvmDsUid (may differ from dsUid); track both.
$cfg = spLoadConfig();
$src = null; $jvmSrc = null;
foreach ($cfg['sources'] as $s) {
    if (($s['enabled'] ?? true) === false) continue;
    if (!empty($s['dsUid'])) {
        $src = $s;
        if (!empty($s['jvmDsUid'])) {
            $jvmSrc = $s; $jvmSrc['dsUid'] = $s['jvmDsUid'];
        }
        break;
    }
}
if (!$src) respondError('no enabled source with dsUid configured', 500);

// 60s cache. Custom ranges hash the absolute window into the key so a
// re-open of the same investigation is instant.
$cacheKey  = preg_replace('/[^a-z0-9._-]+/i', '_', "ra3_{$service}_{$range}");
$cachePath = teamDataPath('restart-analyzer/cache/' . $cacheKey . '.json');
if (file_exists($cachePath) && (time() - (int)filemtime($cachePath)) <= 60) {
    $c = json_decode((string)file_get_contents($cachePath), true);
    if (is_array($c)) { $c['fromCache'] = true; respondOk($c); }
}

$svcEsc = _spPromEscape($service);
$podRe  = $svcEsc . '.*';
// Evaluation time — end of investigation window. For custom ranges use the
// absolute end; for relative "last N" use `now`.
$evalTime = $isCustom ? $absEnd : time();
$now      = time();
$start    = $isCustom ? $absStart : ($now - $rangeSec);
$end      = $isCustom ? $absEnd   : $now;
$step     = max(30, (int)round($rangeSec / 120));  // ~120 points per chart

// ── Phase 1-5 · Instant queries (single round-trip via curl_multi) ───────
$instant = [
    'restartsTotal'   => "sum(increase(kube_pod_container_status_restarts_total{pod=~\"{$podRe}\"}[{$rangeExpr}]))",
    'perPodRestart'   => "sum by (pod, namespace) (increase(kube_pod_container_status_restarts_total{pod=~\"{$podRe}\"}[{$rangeExpr}])) > 0",
    'perPodReason'    => "sum by (pod, reason) (kube_pod_container_status_last_terminated_reason{pod=~\"{$podRe}\"} > 0)",
    'containerStart'  => "container_start_time_seconds{pod=~\"{$podRe}\",container!=\"POD\",container!=\"\"}",
    'podStart'        => "kube_pod_start_time{pod=~\"{$podRe}\"}",
    'podInfo'         => "kube_pod_info{pod=~\"{$podRe}\"}",
    // Resource peaks in the window.
    'memMax'          => "max(max_over_time(container_memory_working_set_bytes{pod=~\"{$podRe}\",container!=\"POD\",container!=\"\"}[{$rangeExpr}])) by (pod)",
    'memLimit'        => "max(kube_pod_container_resource_limits{pod=~\"{$podRe}\",resource=\"memory\"}) by (pod)",
    'cpuMaxPct'       => "max(max_over_time(rate(container_cpu_usage_seconds_total{pod=~\"{$podRe}\",container!=\"POD\",container!=\"\"}[2m])[{$rangeExpr}:2m])) by (pod) / on(pod) group_left max(kube_pod_container_resource_limits{pod=~\"{$podRe}\",resource=\"cpu\"}) by (pod) * 100",
    // Throttling: cfs_throttled_periods > 0 = kernel forced CPU wait.
    'cpuThrottleSec'  => "sum(increase(container_cpu_cfs_throttled_seconds_total{pod=~\"{$podRe}\",container!=\"POD\",container!=\"\"}[{$rangeExpr}]))",
    'cpuThrottlePct'  => "sum(increase(container_cpu_cfs_throttled_periods_total{pod=~\"{$podRe}\",container!=\"POD\",container!=\"\"}[{$rangeExpr}])) / sum(increase(container_cpu_cfs_periods_total{pod=~\"{$podRe}\",container!=\"POD\",container!=\"\"}[{$rangeExpr}])) * 100",
    // Memory allocation failures (kernel OOM approach counter — increments
    // BEFORE actual OOM kill in many kernels).
    'memFailcnt'      => "sum(increase(container_memory_failures_total{pod=~\"{$podRe}\",container!=\"POD\",container!=\"\"}[{$rangeExpr}]))",
    // Network health.
    'netRxErrors'     => "sum(increase(container_network_receive_errors_total{pod=~\"{$podRe}\"}[{$rangeExpr}]))",
    'netTxErrors'     => "sum(increase(container_network_transmit_errors_total{pod=~\"{$podRe}\"}[{$rangeExpr}]))",
    'netRxDropped'    => "sum(increase(container_network_receive_packets_dropped_total{pod=~\"{$podRe}\"}[{$rangeExpr}]))",
    'netTxDropped'    => "sum(increase(container_network_transmit_packets_dropped_total{pod=~\"{$podRe}\"}[{$rangeExpr}]))",
    // K8s waiting reasons — CrashLoopBackOff, ImagePullBackOff, etc.
    'waitingReason'   => "sum by (pod, reason) (kube_pod_container_status_waiting_reason{pod=~\"{$podRe}\"} > 0)",
    // ─── Deeper signals (added in v3) ───
    // Post-restart recovery: how many pods are Ready right NOW?
    'readyPods'       => "sum(kube_pod_status_ready{pod=~\"{$podRe}\",condition=\"true\"} == 1)",
    'totalPods'       => "sum(kube_pod_status_phase{pod=~\"{$podRe}\",phase=\"Running\"})",
    // Disk pressure — high write rate can trigger OOM-like symptoms if the
    // filesystem cache pushes memory pressure.
    'diskWriteBytes'  => "sum(rate(container_fs_writes_bytes_total{pod=~\"{$podRe}\",container!=\"POD\",container!=\"\"}[5m]))",
    // HPA activity — did the deployment scale up/down during the window?
    // If replicas changed AT the restart moment → coordinated scale-down.
    'hpaMin'          => "min(min_over_time(kube_deployment_status_replicas{deployment=~\"{$svcEsc}.*\"}[{$rangeExpr}]))",
    'hpaMax'          => "max(max_over_time(kube_deployment_status_replicas{deployment=~\"{$svcEsc}.*\"}[{$rangeExpr}]))",
    // Cluster autoscaler / node lifecycle — did any of our pods' nodes get
    // created OR deleted within the window? Fresh node = likely eviction.
    'nodeAge'         => "min by (node) (time() - kube_node_created{})",
];
try {
    $q = spQueryPromQL($src, $instant, $evalTime);
} catch (Throwable $e) {
    respondError('query failed: ' . $e->getMessage(), 502);
}

// ── Phase 6 · Downstream health (Spring Boot Micrometer only) ────────────
// Two label variants (client_name / clientName). Filter to error outcomes.
// If service has NO http_client metrics at all, these arrays stay empty and
// the checklist reports "no HTTP client instrumentation".
$downstreamErrs = [];
$downstreamLat  = [];
$selfHttpErrs   = [];
$appMetrics     = null;
if ($jvmSrc) {
    $jvmSel = "app_name=\"{$service}\"";
    try {
        $dq = spQueryPromQL($jvmSrc, [
            'dsErrSnake' => "topk(6, sum by (client_name, status) (rate(http_client_requests_seconds_count{{$jvmSel},status=~\"5..\"}[{$rangeExpr}])) > 0)",
            'dsErrCamel' => "topk(6, sum by (clientName,  status) (rate(http_client_requests_seconds_count{{$jvmSel},status=~\"5..\"}[{$rangeExpr}])) > 0)",
            'dsLatSnake' => "topk(6, sum by (client_name) (rate(http_client_requests_seconds_sum{{$jvmSel}}[{$rangeExpr}])) / (sum by (client_name) (rate(http_client_requests_seconds_count{{$jvmSel}}[{$rangeExpr}])) > 0) * 1000)",
            'dsLatCamel' => "topk(6, sum by (clientName)  (rate(http_client_requests_seconds_sum{{$jvmSel}}[{$rangeExpr}])) / (sum by (clientName)  (rate(http_client_requests_seconds_count{{$jvmSel}}[{$rangeExpr}])) > 0) * 1000)",
            'selfErr'    => "topk(6, sum by (uri, status) (rate(http_server_requests_seconds_count{{$jvmSel},status=~\"5..\"}[{$rangeExpr}])) > 0)",
            // JVM self-health at time of investigation.
            'jvmHeapPct' => "max(jvm_memory_used_bytes{{$jvmSel},area=\"heap\"}) / max(jvm_memory_max_bytes{{$jvmSel},area=\"heap\"}) * 100",
            'jvmThreads' => "max(jvm_threads_live_threads{{$jvmSel}})",
            'jvmGcSec'   => "sum(increase(jvm_gc_pause_seconds_sum{{$jvmSel}}[{$rangeExpr}]))",
        ], $evalTime);
        // Aggregate downstream 5xx across label variants.
        foreach (['dsErrSnake' => 'client_name', 'dsErrCamel' => 'clientName'] as $key => $lbl) {
            foreach ($dq[$key] ?? [] as $r) {
                $target = (string)($r['metric'][$lbl] ?? '');
                $status = (string)($r['metric']['status'] ?? '');
                $rate   = (float)($r['value'][1] ?? 0);
                if ($target === '' || $rate <= 0) continue;
                if (!isset($downstreamErrs[$target])) {
                    $downstreamErrs[$target] = ['target' => $target, 'rate5xx' => 0.0, 'statuses' => []];
                }
                $downstreamErrs[$target]['rate5xx'] += $rate;
                $downstreamErrs[$target]['statuses'][$status] = ($downstreamErrs[$target]['statuses'][$status] ?? 0.0) + $rate;
            }
        }
        // Latency per downstream.
        foreach (['dsLatSnake' => 'client_name', 'dsLatCamel' => 'clientName'] as $key => $lbl) {
            foreach ($dq[$key] ?? [] as $r) {
                $target = (string)($r['metric'][$lbl] ?? '');
                $ms     = (float)($r['value'][1] ?? 0);
                if ($target === '' || $ms <= 0) continue;
                $downstreamLat[$target] = max($downstreamLat[$target] ?? 0, $ms);
            }
        }
        // Self-HTTP 5xx (client-facing errors from THIS service).
        foreach ($dq['selfErr'] ?? [] as $r) {
            $uri    = (string)($r['metric']['uri']    ?? '');
            $status = (string)($r['metric']['status'] ?? '');
            $rate   = (float)($r['value'][1] ?? 0);
            if ($uri === '' || $rate <= 0) continue;
            $selfHttpErrs[] = ['uri' => $uri, 'status' => $status, 'rate' => round($rate, 3)];
        }
        // JVM snapshot.
        $heap    = isset($dq['jvmHeapPct'][0]['value'][1]) ? round((float)$dq['jvmHeapPct'][0]['value'][1], 1) : null;
        $threads = isset($dq['jvmThreads'][0]['value'][1]) ? (int)$dq['jvmThreads'][0]['value'][1]           : null;
        $gcSec   = isset($dq['jvmGcSec'][0]['value'][1])   ? round((float)$dq['jvmGcSec'][0]['value'][1], 1) : null;
        if ($heap !== null || $threads !== null || $gcSec !== null) {
            $appMetrics = ['heapPct' => $heap, 'liveThreads' => $threads, 'gcSecondsInWindow' => $gcSec];
        }
    } catch (Throwable $_) { /* silent — service may not expose Micrometer */ }
}
// Sort + round downstream error list.
$downstreamErrList = [];
foreach ($downstreamErrs as $target => $row) {
    $sbd = [];
    foreach ($row['statuses'] as $status => $rate) {
        $sbd[] = ['status' => $status, 'rate' => round($rate, 3)];
    }
    usort($sbd, fn($a, $b) => $b['rate'] <=> $a['rate']);
    $downstreamErrList[] = [
        'target'         => $target,
        'rate5xx'        => round($row['rate5xx'], 3),
        'latencyPeakMs'  => isset($downstreamLat[$target]) ? round($downstreamLat[$target], 1) : null,
        'statusBreakdown'=> $sbd,
    ];
}
usort($downstreamErrList, fn($a, $b) => $b['rate5xx'] <=> $a['rate5xx']);

// ── Phase 8 · Timeline (range queries — one per series) ──────────────────
// Kept lightweight — 3 series × ~120 points × 8 bytes ≈ 3KB payload.
$timeline = ['mem' => [], 'cpu' => [], 'restarts' => []];
try {
    $rq = spQueryPromRange($src, [
        'memPctMax'   => "max(container_memory_working_set_bytes{pod=~\"{$podRe}\",container!=\"POD\",container!=\"\"}) by () / on() group_left max(kube_pod_container_resource_limits{pod=~\"{$podRe}\",resource=\"memory\"}) * 100",
        'cpuPctMax'   => "max(rate(container_cpu_usage_seconds_total{pod=~\"{$podRe}\",container!=\"POD\",container!=\"\"}[2m])) by () / on() group_left max(kube_pod_container_resource_limits{pod=~\"{$podRe}\",resource=\"cpu\"}) * 100",
        'restartRate' => "sum(rate(kube_pod_container_status_restarts_total{pod=~\"{$podRe}\"}[5m])) * 60",
    ], $start, $end, $step);
    $asSeries = function (array $mat): array {
        // Flatten single-series matrix result to [[ts, val], ...].
        if (empty($mat)) return [];
        $out = [];
        foreach ($mat[0]['values'] ?? [] as $p) $out[] = [(int)$p[0], (float)$p[1]];
        return $out;
    };
    $timeline['mem']      = $asSeries($rq['memPctMax']   ?? []);
    $timeline['cpu']      = $asSeries($rq['cpuPctMax']   ?? []);
    $timeline['restarts'] = $asSeries($rq['restartRate'] ?? []);
} catch (Throwable $_) { /* charts optional */ }

// ── Aggregate Phase 1-5 results ──────────────────────────────────────────
$totalRestarts = 0.0;
foreach ($q['restartsTotal'] ?? [] as $r) $totalRestarts += (float)($r['value'][1] ?? 0);
$totalRestarts = round($totalRestarts, 1);

$perPod = [];
foreach ($q['perPodRestart'] ?? [] as $r) {
    $pod = (string)($r['metric']['pod'] ?? '');
    $ns  = (string)($r['metric']['namespace'] ?? '');
    if ($pod === '') continue;
    $v = (float)($r['value'][1] ?? 0);
    if (!isset($perPod[$pod]) || $v > $perPod[$pod]['count']) {
        $perPod[$pod] = ['pod' => $pod, 'namespace' => $ns, 'count' => round($v, 1)];
    }
}
$perPodReason = [];
foreach ($q['perPodReason'] ?? [] as $r) {
    $pod    = (string)($r['metric']['pod']    ?? '');
    $reason = (string)($r['metric']['reason'] ?? '');
    if ($pod === '' || $reason === '') continue;
    $priority = ['OOMKilled' => 3, 'Error' => 2, 'Completed' => 1];
    $curPri   = $perPodReason[$pod]['priority'] ?? 0;
    $newPri   = $priority[$reason] ?? 0;
    if ($newPri >= $curPri) $perPodReason[$pod] = ['reason' => $reason, 'priority' => $newPri];
}
$startTimes = [];
foreach ($q['containerStart'] ?? [] as $r) {
    $pod = (string)($r['metric']['pod'] ?? '');
    if (!isset($perPod[$pod])) continue;
    $startTimes[$pod] = (float)($r['value'][1] ?? 0);
}
$podNodes = [];
foreach ($q['podInfo'] ?? [] as $r) {
    $m = $r['metric'] ?? [];
    $pod = (string)($m['pod'] ?? '');
    if ($pod !== '' && !empty($m['node'])) $podNodes[$pod] = (string)$m['node'];
}
foreach ($perPod as $pod => &$row) {
    $row['reason']         = $perPodReason[$pod]['reason'] ?? 'unknown';
    $row['restartedAtUnix']= isset($startTimes[$pod]) ? (int)$startTimes[$pod] : null;
    $row['node']           = $podNodes[$pod] ?? null;
}
unset($row);
usort($perPod, fn($a, $b) => ($b['restartedAtUnix'] ?? 0) - ($a['restartedAtUnix'] ?? 0));
$perPod = array_values($perPod);
$reasonCounts = ['OOMKilled' => 0, 'Error' => 0, 'Completed' => 0, 'unknown' => 0];
foreach ($perPod as $row) $reasonCounts[$row['reason']] = ($reasonCounts[$row['reason']] ?? 0) + 1;
$primaryReason = 'unknown';
if      ($reasonCounts['OOMKilled'] > 0)                          $primaryReason = 'OOMKilled';
elseif ($reasonCounts['Error']     > $reasonCounts['Completed']) $primaryReason = 'Error';
elseif ($reasonCounts['Completed'] > 0)                          $primaryReason = 'Completed';

// Coordinated-timing analysis.
$recent = [];
foreach ($startTimes as $t) if (($now - $t) <= $rangeSec + 300) $recent[] = $t;
$coordSpanSec = count($recent) >= 2 ? (int)round(max($recent) - min($recent)) : null;
$coordFirstAt = count($recent) >= 1 ? (int)min($recent) : null;

// Resource peaks per pod.
$memPct = [];
foreach ($q['memMax'] ?? [] as $r) {
    $pod = (string)($r['metric']['pod'] ?? '');
    $memPct[$pod] = ['used' => (float)($r['value'][1] ?? 0)];
}
foreach ($q['memLimit'] ?? [] as $r) {
    $pod = (string)($r['metric']['pod'] ?? '');
    if (isset($memPct[$pod]) && ($v = (float)($r['value'][1] ?? 0)) > 0) {
        $memPct[$pod]['limit'] = $v;
        $memPct[$pod]['pct']   = $memPct[$pod]['used'] / $v * 100;
    }
}
$maxMemPct = 0; foreach ($memPct as $row) if (($row['pct'] ?? 0) > $maxMemPct) $maxMemPct = $row['pct'];
$maxMemPct = round($maxMemPct, 1);
$maxCpuPct = 0;
foreach ($q['cpuMaxPct'] ?? [] as $r) if (($v = (float)($r['value'][1] ?? 0)) > $maxCpuPct) $maxCpuPct = $v;
$maxCpuPct = round($maxCpuPct, 1);
$cpuThrottleSec = 0;
foreach ($q['cpuThrottleSec'] ?? [] as $r) $cpuThrottleSec += (float)($r['value'][1] ?? 0);
$cpuThrottleSec = round($cpuThrottleSec, 1);
$cpuThrottlePct = isset($q['cpuThrottlePct'][0]['value'][1]) ? round((float)$q['cpuThrottlePct'][0]['value'][1], 1) : 0;
$memFailcnt = 0;
foreach ($q['memFailcnt'] ?? [] as $r) $memFailcnt += (float)($r['value'][1] ?? 0);
$memFailcnt = (int)round($memFailcnt);

// Network errors.
$netTotals = ['rxErr' => 0, 'txErr' => 0, 'rxDrop' => 0, 'txDrop' => 0];
foreach ($q['netRxErrors']  ?? [] as $r) $netTotals['rxErr']  += (float)($r['value'][1] ?? 0);
foreach ($q['netTxErrors']  ?? [] as $r) $netTotals['txErr']  += (float)($r['value'][1] ?? 0);
foreach ($q['netRxDropped'] ?? [] as $r) $netTotals['rxDrop'] += (float)($r['value'][1] ?? 0);
foreach ($q['netTxDropped'] ?? [] as $r) $netTotals['txDrop'] += (float)($r['value'][1] ?? 0);
foreach ($netTotals as $k => $v) $netTotals[$k] = (int)round($v);
$netUnhealthy = ($netTotals['rxErr'] + $netTotals['txErr']) > 0
             || ($netTotals['rxDrop'] + $netTotals['txDrop']) > 1000;  // some drop noise is normal

// Waiting reasons.
$waitingReasons = [];
foreach ($q['waitingReason'] ?? [] as $r) {
    $reason = (string)($r['metric']['reason'] ?? '');
    if ($reason !== '') $waitingReasons[$reason] = ($waitingReasons[$reason] ?? 0) + 1;
}

// Node placement: mixed = restarted+sibling on same node → NOT node event.
$restartedNodes = [];
foreach ($perPod as $row) if (!empty($row['node'])) $restartedNodes[$row['node']] = ($restartedNodes[$row['node']] ?? 0) + 1;
$siblingNodes = [];
foreach ($q['podStart'] ?? [] as $r) {
    $pod = (string)($r['metric']['pod'] ?? '');
    if ($pod === '') continue;
    $isRestarted = false;
    foreach ($perPod as $rp) if ($rp['pod'] === $pod) { $isRestarted = true; break; }
    if ($isRestarted) continue;
    if (isset($podNodes[$pod])) $siblingNodes[$podNodes[$pod]] = ($siblingNodes[$podNodes[$pod]] ?? 0) + 1;
}
$mixedNodes = 0;
foreach ($restartedNodes as $node => $_) if (!empty($siblingNodes[$node])) $mixedNodes++;

// Total downstream 5xx.
$totalDs5xxRate = 0;
foreach ($downstreamErrList as $r) $totalDs5xxRate += $r['rate5xx'];
$totalDs5xxRate = round($totalDs5xxRate, 3);

// ── Deep signals (v3) ────────────────────────────────────────────────────
// Post-restart readiness snapshot: how many pods are healthy right now?
$readyPods = isset($q['readyPods'][0]['value'][1]) ? (int)$q['readyPods'][0]['value'][1] : 0;
$totalPods = isset($q['totalPods'][0]['value'][1]) ? (int)$q['totalPods'][0]['value'][1] : 0;
$notReadyPods = max(0, $totalPods - $readyPods);

// Uptime-before-death: average / min / max age of pods that restarted.
// container_start_time_seconds for restarted pods stores the NEW start time,
// but pod_start_time is unchanged (pods themselves don't restart). Diff =
// pod age. If uptime is VERY short (<10 min) → CrashLoopBackOff pattern.
$uptimeSecs = [];
foreach ($perPod as $row) {
    if (!empty($row['restartedAtUnix']) && isset($startTimes[$row['pod']])) {
        // pod_start_time − now approx = age. For coordinated restarts, all
        // ages will cluster. For CrashLoop, ages will be tiny.
        $podAge = $evalTime - ($startTimes[$row['pod']] ?? $evalTime);
        if ($podAge >= 0) $uptimeSecs[] = $podAge;
    }
}
$uptimeStats = null;
if (!empty($uptimeSecs)) {
    sort($uptimeSecs);
    $uptimeStats = [
        'minSec' => $uptimeSecs[0],
        'maxSec' => $uptimeSecs[count($uptimeSecs) - 1],
        'avgSec' => (int)round(array_sum($uptimeSecs) / count($uptimeSecs)),
    ];
}

// Disk write pressure (5-min rolling).
$diskWriteBps = isset($q['diskWriteBytes'][0]['value'][1]) ? (float)$q['diskWriteBytes'][0]['value'][1] : 0;
$diskPressure = $diskWriteBps > 100 * 1024 * 1024;  // >100 MB/s sustained = notable

// HPA / deployment replica delta during the window.
$hpaMin = isset($q['hpaMin'][0]['value'][1]) ? (int)$q['hpaMin'][0]['value'][1] : 0;
$hpaMax = isset($q['hpaMax'][0]['value'][1]) ? (int)$q['hpaMax'][0]['value'][1] : 0;
$hpaScaleEvent = ($hpaMax - $hpaMin) >= 2;

// Freshly-created nodes hosting our restarted pods → node churn signal.
$freshNodes = [];
foreach ($q['nodeAge'] ?? [] as $r) {
    $node = (string)($r['metric']['node'] ?? '');
    $age  = (float)($r['value'][1] ?? 0);
    if ($node !== '' && $age >= 0 && $age <= $rangeSec + 3600) $freshNodes[$node] = (int)$age;
}
$freshNodesHostingUs = 0;
foreach ($restartedNodes as $node => $_) if (isset($freshNodes[$node])) $freshNodesHostingUs++;

// ── Hot-pod detection (added v4) ──────────────────────────────────────────
// If ONE pod dominates the restart count (e.g. 15 restarts on 1 pod out of
// 3 running), that's a fundamentally different failure than "pods die
// randomly across the fleet". Signals internal state stuck on that pod:
// deadlock, connection pool exhausted, stuck request, corrupt cache.
$maxRestartPod = null; $maxRestartCount = 0;
foreach ($perPod as $p) {
    if (($p['count'] ?? 0) > $maxRestartCount) {
        $maxRestartCount = $p['count'];
        $maxRestartPod   = $p['pod'];
    }
}
$hotPodShare = $totalRestarts > 0 ? ($maxRestartCount / $totalRestarts * 100) : 0;
// "Hot pod" = one pod restarts ≥5 times AND holds ≥50% of all restarts.
$isHotPod = $maxRestartCount >= 5 && $hotPodShare >= 50;

// Self-served 5xx aggregate (v4 addition — was only in cascade before).
// If service itself is throwing 500s at high rate BEFORE restart, that's
// evidence of internal overload (thread pool / DB pool / GC pause) —
// deserves its own top-level hypothesis.
$totalSelfErrRate = 0;
foreach ($selfHttpErrs as $e) $totalSelfErrRate += ($e['rate'] ?? 0);
$totalSelfErrRate = round($totalSelfErrRate, 3);

// ── Cascade builder — ordered narrative steps ────────────────────────────
$cascade = [];
$affectedCount = count($perPod);

// Map exit-reason keyword → plain Thai explanation for cascade narratives.
$reasonPlain = [
    'OOMKilled' => 'memory เต็ม (Kubernetes จำเป็นต้องบังคับปิด)',
    'Error'     => 'app ตัวเองพัง (exit ด้วย error code)',
    'Completed' => 'app ปิดตัวเองเรียบร้อย (exit code 0)',
    'unknown'   => 'ไม่มีข้อมูล',
];
$reasonPlainStr = $reasonPlain[$primaryReason] ?? $primaryReason;

// Step 1 · trigger
$cascade[] = [
    'id'       => 'trigger',
    'title'    => 'มีการ restart เกิดขึ้นมั้ย',
    'verdict'  => $totalRestarts > 0 ? 'triggered' : 'clear',
    'narrative'=> $totalRestarts > 0
        ? "พบ container ของ service นี้ **restart {$totalRestarts} ครั้ง** จาก **{$affectedCount} pod** ในช่วงเวลาที่เลือก. Kubernetes บอกสาเหตุหลักไว้ว่า: **{$reasonPlainStr}**"
        : "ไม่มี pod restart ในช่วงเวลานี้ — service ทำงานปกติ ไม่มีอะไรต้องสืบ",
    'evidence' => "restarts={$totalRestarts} · pods={$affectedCount} · reason={$primaryReason}",
];

if ($totalRestarts > 0) {
    // Step 2 · Memory
    $oomVerdict = $reasonCounts['OOMKilled'] > 0 ? 'fail'
                : ($maxMemPct >= 90 || $memFailcnt > 0 ? 'warn' : 'pass');
    $oomNarr = $reasonCounts['OOMKilled'] > 0
        ? "**pod {$reasonCounts['OOMKilled']} ตัวโดน OOM-Killed** — memory ที่ใช้จริงเกินโควต้าที่ตั้งไว้ ระบบเลยฆ่าทิ้ง. Memory ที่ใช้ตอน peak = **{$maxMemPct}% ของ limit**" . ($memFailcnt > 0 ? " · ก่อนตายพบว่า kernel แจ้ง allocation fail ไปแล้ว {$memFailcnt} ครั้ง (สัญญาณเตือน)" : "")
        : ($maxMemPct >= 90
            ? "Memory peak = **{$maxMemPct}%** ของ limit — ใกล้เต็มแล้ว ยังไม่ถึงกับโดนฆ่า แต่เสี่ยงถ้าโหลดเพิ่ม" . ($memFailcnt > 0 ? " (มี failcnt {$memFailcnt} ครั้ง)" : "")
            : "Memory peak = **{$maxMemPct}%** ของ limit — สบายๆ ไม่ใกล้เต็ม" . ($memFailcnt > 0 ? " (มี failcnt {$memFailcnt} ครั้งแต่ไม่รุนแรง)" : ""));
    $cascade[] = [
        'id' => 'memory', 'title' => 'memory ที่ใช้ ถึง limit มั้ย', 'verdict' => $oomVerdict,
        'narrative' => $oomNarr,
        'evidence' => "peak={$maxMemPct}% · failcnt={$memFailcnt} · OOMKilled={$reasonCounts['OOMKilled']}",
    ];

    // Step 3 · CPU
    $cpuVerdict = $cpuThrottlePct >= 5 ? 'warn' : ($maxCpuPct >= 90 ? 'warn' : 'pass');
    $cpuNarr = $cpuThrottlePct >= 5
        ? "**CPU โดนจำกัด (throttle) {$cpuThrottlePct}% ของเวลา** ({$cpuThrottleSec} วิรวมกัน) — pod ไม่ได้ CPU ที่ต้องการ ทำให้ตอบ health check ช้า → Kubernetes เข้าใจว่าตายแล้วเลยฆ่า"
        : ($maxCpuPct >= 90
            ? "CPU peak = {$maxCpuPct}% ของ limit แต่โดน throttle นิดเดียว ({$cpuThrottlePct}%) — โหลดขึ้นเป็น spike ชั่วคราวไม่ได้ต่อเนื่อง"
            : "CPU peak = {$maxCpuPct}% ของ limit · throttle {$cpuThrottlePct}% — ไม่มีปัญหา CPU");
    $cascade[] = [
        'id' => 'cpu', 'title' => 'CPU พอใช้มั้ย ไม่โดนจำกัดใช่มั้ย', 'verdict' => $cpuVerdict,
        'narrative' => $cpuNarr,
        'evidence' => "peak={$maxCpuPct}% · throttle={$cpuThrottleSec}s ({$cpuThrottlePct}%)",
    ];

    // Step 4 · App crash
    if ($reasonCounts['Error'] > 0) {
        $cascade[] = [
            'id' => 'crash', 'title' => 'app crash เองมั้ย', 'verdict' => 'fail',
            'narrative' => "**pod {$reasonCounts['Error']} ตัวปิดตัวด้วย error code** — แปลว่า app โดน exception หรือ fatal error ข้างในตัวเอง. ต้องเปิด log ของ pod เหล่านั้นดู stack trace",
            'evidence' => "exitReason=Error × {$reasonCounts['Error']}",
        ];
    }

    // Step 5 · Network
    $netVerdict = $netUnhealthy ? 'warn' : 'pass';
    $netNarr = $netUnhealthy
        ? "พบสัญญาณผิดปกติ: RX errors {$netTotals['rxErr']} · TX errors {$netTotals['txErr']} · packet drops (รับ/ส่ง) {$netTotals['rxDrop']}/{$netTotals['txDrop']}. อาจเป็นปัญหาที่ node NIC / VPC / CNI ทำให้ health check ล้ม"
        : "network สะอาด — ไม่มี error/drop ที่น่ากังวล (RX/TX err {$netTotals['rxErr']}/{$netTotals['txErr']}, drops {$netTotals['rxDrop']}/{$netTotals['txDrop']})";
    $cascade[] = [
        'id' => 'network', 'title' => 'เน็ตเวิร์กมีปัญหามั้ย', 'verdict' => $netVerdict, 'narrative' => $netNarr,
        'evidence' => "err={$netTotals['rxErr']}/{$netTotals['txErr']} · drops={$netTotals['rxDrop']}/{$netTotals['txDrop']}",
    ];

    // Step 6 · Waiting
    if (!empty($waitingReasons)) {
        $waitDetail = implode(', ', array_map(fn($k, $v) => "$k × $v", array_keys($waitingReasons), $waitingReasons));
        $isLoop = isset($waitingReasons['CrashLoopBackOff']);
        $cascade[] = [
            'id' => 'waiting', 'title' => 'pod ค้างสถานะอะไรมั้ย', 'verdict' => $isLoop ? 'fail' : 'warn',
            'narrative' => "pod เข้าสถานะรอเหล่านี้: **{$waitDetail}**. " . ($isLoop
                ? "`CrashLoopBackOff` แปลว่า pod ตายซ้ำๆ ระบบเลยหน่วงเวลา restart ให้ห่างขึ้นเรื่อยๆ. แน่นอนว่า **app พังตอน startup** — ดู log ของ pod ที่ค้าง"
                : "อาจเกิดชั่วคราวระหว่างสร้าง pod ใหม่"),
            'evidence' => $waitDetail,
        ];
    }

    // Step 7 · Coordination
    if ($coordSpanSec !== null) {
        $coordVerdict = $coordSpanSec <= 120 ? 'triggered' : 'clear';
        $coordNarr = $coordSpanSec <= 120
            ? "**pod {$affectedCount} ตัว restart พร้อมกันภายใน {$coordSpanSec} วินาที** — pattern แบบนี้ไม่ใช่เรื่องบังเอิญ. เป็นได้ 3 สาเหตุ: (1) มีคน/สคริปต์สั่ง restart หลายตัวพร้อมกัน · (2) health check ล้มพร้อมกันเพราะ downstream ที่ทุก pod เรียกใช้พังไปช่วงนั้น · (3) มี rolling maintenance บน node หลายตัว"
            : "restart กระจายกันประมาณ {$coordSpanSec} วิ — เป็น pattern ธรรมชาติ ไม่ใช่ event เดียวกัน. แต่ละ pod มี trigger ของตัวเอง";
        $cascade[] = [
            'id' => 'coordinated', 'title' => 'pod ตายพร้อมกันหลายตัวมั้ย', 'verdict' => $coordVerdict, 'narrative' => $coordNarr,
            'evidence' => "spread={$coordSpanSec}s across {$affectedCount} pods",
        ];
    }

    // Step 8 · Node event
    $nodeVerdict = $mixedNodes > 0 ? 'pass'
                 : ($affectedCount > 0 && count($restartedNodes) < $affectedCount ? 'warn' : 'inconclusive');
    $nodeCount = count($restartedNodes);
    $nodeNarr = $mixedNodes > 0
        ? "**ไม่ใช่ปัญหา node** — มี **{$mixedNodes} node ที่ทั้ง pod ที่ตายและ pod ที่ยังอยู่ทำงานร่วมกัน**. ถ้า node นั้นตายจริง pod ทุกตัวบน node จะตายด้วย — แต่ยังมี pod รอดอยู่ที่ node เดียวกัน → ตัด node event ออก"
        : ($affectedCount > 0 && $nodeCount < $affectedCount
            ? "pod ที่ restart กระจุกอยู่บน {$nodeCount} node เท่านั้น (น้อยกว่าจำนวน pod ที่ตาย = {$affectedCount}). อาจเป็น node ล่ม / Karpenter consolidation — เช็ค EC2 spot notice หรือ Karpenter log"
            : "หาไม่เจอ — ข้อมูลไม่พอบอกว่า node มีปัญหามั้ย");
    $cascade[] = [
        'id' => 'node-event', 'title' => 'server (node) ที่ pod อยู่ มีปัญหามั้ย', 'verdict' => $nodeVerdict, 'narrative' => $nodeNarr,
        'evidence' => "nodes={$nodeCount} · mixed={$mixedNodes}",
    ];

    // Step 9 · Downstream 5xx
    if ($totalDs5xxRate > 0) {
        $topFew = array_slice($downstreamErrList, 0, 3);
        $topDesc = implode(', ', array_map(fn($r) => "**" . _spHostToService($r['target']) . "** (" . round($r['rate5xx'], 2) . " req/s)", $topFew));
        $dsVerdict = $totalDs5xxRate >= 1 ? 'fail' : 'warn';
        $cascade[] = [
            'id' => 'downstream-5xx', 'title' => 'ระบบที่เราเรียกใช้ ตอบ error กลับมั้ย', 'verdict' => $dsVerdict,
            'narrative' => "service นี้ยิง request ออกไป แล้วโดนตอบกลับเป็น **5xx (error) {$totalDs5xxRate} req/s** ในช่วงเวลาที่เลือก. ตัวที่ตอบ error มากสุด: {$topDesc}. **ถ้า dependency หลัก (DB / auth / gateway) พัง — service นี้ก็จะ health check fail ตาม**",
            'evidence' => count($downstreamErrList) . " downstream · " . $totalDs5xxRate . " req/s",
        ];
    } elseif ($jvmSrc) {
        $cascade[] = [
            'id' => 'downstream-5xx', 'title' => 'ระบบที่เราเรียกใช้ ตอบ error กลับมั้ย', 'verdict' => 'pass',
            'narrative' => "downstream ทั้งหมด ตอบกลับปกติ ไม่มี 5xx ในช่วงนี้",
            'evidence' => "0 downstream errors",
        ];
    } else {
        $cascade[] = [
            'id' => 'downstream-5xx', 'title' => 'ระบบที่เราเรียกใช้ ตอบ error กลับมั้ย', 'verdict' => 'inconclusive',
            'narrative' => "service นี้ไม่ได้ปล่อย metric ของ HTTP client — เช็คไม่ได้ว่า downstream ตอบอะไรกลับมา. ถ้าอยากได้ ต้องเพิ่ม Micrometer HTTP client instrumentation ที่ Spring Boot",
            'evidence' => "no http_client metrics",
        ];
    }

    // Step 10 · Self-served 5xx
    if (!empty($selfHttpErrs)) {
        $topSelf = array_slice($selfHttpErrs, 0, 3);
        $selfDesc = implode(', ', array_map(fn($r) => "`{$r['status']} {$r['uri']}` ({$r['rate']} req/s)", $topSelf));
        $cascade[] = [
            'id' => 'self-5xx', 'title' => 'service ของเราเอง ตอบ error กลับให้คนเรียกใช้มั้ย', 'verdict' => 'warn',
            'narrative' => "ก่อน restart service นี้ตอบ 5xx ให้ caller: {$selfDesc}. เข้ากับสมมติฐาน app ใกล้พัง / thread pool ท่วม",
            'evidence' => "self 5xx endpoints",
        ];
    }

    // Step 11 · JVM
    if ($appMetrics) {
        $heapV = $appMetrics['heapPct'] == null ? 'ไม่ทราบ' : "{$appMetrics['heapPct']}%";
        $thrV  = $appMetrics['liveThreads'] ?? '?';
        $gcV   = $appMetrics['gcSecondsInWindow'] ?? '?';
        $heapVerdict = ($appMetrics['heapPct'] ?? 0) >= 85 ? 'warn' : 'pass';
        $cascade[] = [
            'id' => 'jvm', 'title' => 'ภายในของ app (Java heap / thread / GC)', 'verdict' => $heapVerdict,
            'narrative' => "Heap ใช้ {$heapV} · thread ที่ยัง alive {$thrV} · เวลารวมที่ GC pause ในช่วงนี้ {$gcV} วิ. " . (($appMetrics['heapPct'] ?? 0) >= 85 ? "**heap ใกล้เต็ม** — น่าจะมี memory leak หรือ cache ที่ไม่ evict" : "ปกติดี"),
            'evidence' => "heap={$heapV} · threads={$thrV} · gc={$gcV}s",
        ];
    }
}

// ── สรุปผลรวม (plain Thai) ──────────────────────────────────────────────
// Priority order — most specific/actionable first. The prior version fell
// to "individual-restart" too eagerly, missing overload + hot-pod cases.
$verdict = 'no-restart';
if ($affectedCount === 0) {
    $summary = 'ไม่พบ pod restart ในช่วงเวลาที่เลือก — service ทำงานปกติ ไม่มีเหตุการณ์อะไร';
} elseif ($reasonCounts['OOMKilled'] > 0) {
    $verdict = 'oom';
    $summary = "**memory เต็ม** — pod **{$reasonCounts['OOMKilled']} ตัว** ใช้ memory เกินโควต้าที่ตั้งไว้ ระบบเลยฆ่าทิ้ง. memory ที่ใช้ตอน peak = **{$maxMemPct}% ของ limit**. วิธีแก้: เพิ่ม memory limit หรือหา memory leak ในโค้ด";
} elseif (isset($waitingReasons['CrashLoopBackOff']) && !$isHotPod) {
    // Fleet-wide crash loop (not just one hot pod).
    $verdict = 'app-crash';
    $summary = "**app crash ซ้ำๆ (CrashLoopBackOff)** — pod พังตอน startup แล้ว restart ซ้ำๆ จน Kubernetes หน่วง restart ให้ห่างขึ้นเรื่อยๆ. ต้องดู log ของ pod ที่ค้างเพื่อหา exception ตอนเริ่ม (init / boot phase)";
} elseif ($reasonCounts['Error'] >= $reasonCounts['Completed'] && $reasonCounts['Error'] > 0) {
    $verdict = 'app-crash';
    $summary = "**app พังเอง** — pod **{$reasonCounts['Error']} ตัว** exit ด้วย error code (ไม่ใช่ 0). แปลว่า app โดน exception หรือ fatal error ข้างในตัวเอง. เปิด application log ของ pod ที่ตายเพื่อดู stack trace";
} elseif ($isHotPod && $totalSelfErrRate >= 0.5) {
    // Combined signal: one pod dominating AND service returning 5xx.
    // Overload concentrated on one pod that can't recover.
    $verdict = 'hot-pod';
    $summary = "**pod ตัวเดียวรับภาระเกิน** — pod **`{$maxRestartPod}`** restart **{$maxRestartCount} ครั้ง** จาก **" . round($hotPodShare) . "%** ของ restart ทั้งหมด · service ตอบ 5xx ให้ caller **{$totalSelfErrRate}/s** · " . ($memFailcnt >= 100000 ? "kernel แจ้ง memory failcnt **" . number_format($memFailcnt) . " ครั้ง** · " : "") . ($hpaScaleEvent ? "HPA พยายาม scale up **{$hpaMin}→{$hpaMax} pod** ตาม" : "") . ". สาเหตุจริงน่าจะเป็น app ข้างในค้าง (thread pool / DB pool / stuck request). **ควร kill pod นี้ทิ้งหรือ rollout restart deployment**";
} elseif ($isHotPod) {
    $verdict = 'hot-pod';
    $summary = "**pod ตัวเดียวพังซ้ำๆ** — pod **`{$maxRestartPod}`** restart **{$maxRestartCount} ครั้ง** จาก restart ทั้งหมด (คิดเป็น **" . round($hotPodShare) . "%**) — pod ตัวอื่นแทบไม่โดน. เป็น pattern ของ pod ที่ state ค้าง / deadlock / connection pool exhausted. **ควร kill pod นี้ทิ้ง** ให้ Kubernetes สร้างใหม่";
} elseif ($totalSelfErrRate >= 1 && $memFailcnt >= 100000) {
    // Overload signal: internal exhaustion + memory pressure without OOM.
    $verdict = 'internal-overload';
    $summary = "**app ประมวลผลไม่ทัน** — service ตอบ 5xx ให้ caller **{$totalSelfErrRate}/s** · kernel แจ้ง memory failcnt **" . number_format($memFailcnt) . " ครั้ง** (memory เครียดแม้ working_set peak แค่ {$maxMemPct}%) · " . ($maxCpuPct >= 80 ? "CPU peak {$maxCpuPct}%" : "") . ". Pattern คือ thread pool หรือ DB connection pool ท่วม → request ค้าง → GC/allocation churn → restart. **ควร tune thread pool + connection pool + timeout**";
} elseif ($totalSelfErrRate >= 1) {
    $verdict = 'internal-overload';
    $summary = "**app ทำงานไม่ทัน** — service ตอบ 5xx ให้ caller **{$totalSelfErrRate}/s** ก่อน restart · เข้ากับ pattern thread pool ท่วม / DB pool หมด / GC pause นาน. เปิด application log + APM ดูว่า request ค้างที่ไหน";
} elseif ($totalDs5xxRate >= 1 && $primaryReason === 'Completed' && $coordSpanSec !== null && $coordSpanSec <= 120) {
    $verdict = 'downstream-failure';
    $topDown = _spHostToService($downstreamErrList[0]['target'] ?? '');
    $summary = "**downstream ล่มแล้วลามมา** — pod ปิดตัวเองเรียบร้อย แต่ตอนนั้น service **`{$topDown}`** ที่เราเรียกใช้อยู่ตอบ 5xx กลับมา **{$totalDs5xxRate} req/s**. health check ของเราน่าจะ timeout รอ dependency ตัวนี้. **ต้องไปแก้ที่ downstream ไม่ใช่ service นี้**";
} elseif ($hpaScaleEvent && $hpaMax > $hpaMin && ($totalSelfErrRate > 0 || $maxCpuPct >= 80)) {
    // Traffic spike pattern — HPA activity + overload signals without a
    // single pod dominating.
    $verdict = 'traffic-spike';
    $summary = "**มี traffic พุ่ง HPA ต้อง scale up** — replica เพิ่ม **{$hpaMin}→{$hpaMax} pod** · " . ($totalSelfErrRate > 0 ? "pod ที่มีอยู่รับไม่ไหว ตอบ 5xx {$totalSelfErrRate}/s " : "") . ($maxCpuPct >= 80 ? "CPU peak {$maxCpuPct}%" : "") . ". restart อาจเกิดตอน pod เก่าโดน overload ระหว่างที่ pod ใหม่ยังไม่พร้อม. เช็คว่า HPA settings + resource request เหมาะสมมั้ย";
} elseif ($primaryReason === 'Completed' && $coordSpanSec !== null && $coordSpanSec <= 120) {
    $verdict = 'external-sigterm';
    $summary = "**มีคน/สคริปต์สั่ง restart** — pod **{$affectedCount} ตัว** restart พร้อมกันภายใน **{$coordSpanSec} วินาที** · ทุกตัวปิดตัวเรียบร้อย exit 0 · ทรัพยากรปกติ · ไม่มี downstream error. เป็นได้ 2 ทาง: (1) มีคนใช้ `kubectl exec` / delete pod / rollout กด restart, (2) health check ล้มพร้อมกันเพราะ dependency ที่ทุก pod ใช้ร่วมกัน hiccup ชั่วขณะ";
} elseif ($primaryReason === 'Completed') {
    $verdict = 'individual-restart';
    $summary = "**pod แต่ละตัว restart แยกกัน** — pod **{$affectedCount} ตัว** ปิดตัวเองเรียบร้อย (exit 0) แต่กระจายเวลาห่างกัน. น่าจะเป็น per-pod trigger เช่น memory checkpoint / connection ครบอายุ / batch job cycle";
} else {
    $summary = "**สรุปไม่ได้แน่ชัด** — หลักฐานที่รวบรวมยังไม่พอ. ดู cascade + top candidates ด้านล่างประกอบ";
}

// ── Multi-hypothesis ranking (v3) ────────────────────────────────────────
// Instead of returning ONE verdict, score every plausible cause 0-100 based
// on the evidence collected above. Frontend renders these as a ranked list
// so the user can see 2nd/3rd most likely causes too.
$candidates = [];
$addCand = function(string $key, string $label, int $score, string $reason, array $evidence = []) use (&$candidates) {
    if ($score <= 0) return;
    $candidates[] = [
        'key'      => $key,
        'label'    => $label,
        'score'    => min(100, max(0, $score)),
        'reason'   => $reason,
        'evidence' => $evidence,
    ];
};

if ($affectedCount > 0) {
    // สมมติฐาน: memory เต็ม
    // failcnt weight boosted in v4 — a large failcnt (≥100k) is a strong
    // signal of chronic memory pressure even without OOMKilled, because it
    // means the kernel was constantly on the edge of firing OOM.
    $oomScore = 0;
    if ($reasonCounts['OOMKilled'] > 0)     $oomScore = 95;
    elseif ($memFailcnt >= 100000)          $oomScore = 75;   // heavy chronic pressure
    elseif ($memFailcnt >= 10000)           $oomScore = 55;
    elseif ($maxMemPct >= 95)               $oomScore = 60;
    elseif ($maxMemPct >= 85)               $oomScore = 40;
    elseif ($memFailcnt >= 1000)            $oomScore = 35;
    elseif ($memFailcnt > 0)                $oomScore = 20;
    $oomReason = '';
    if ($reasonCounts['OOMKilled'] > 0) {
        $oomReason = "พบ **{$reasonCounts['OOMKilled']} pod โดน OOM-Killed** ตรงๆ + memory peak แตะ {$maxMemPct}% ของ limit";
    } elseif ($memFailcnt >= 100000) {
        $oomReason = "**kernel แจ้ง memory allocation fail {$memFailcnt} ครั้ง** — เยอะมาก! แสดงว่า pod กำลังบีบ memory ตลอดเวลา แม้ working_set peak แค่ {$maxMemPct}% (อาจเป็น GC churn / off-heap allocation / native memory leak)";
    } elseif ($memFailcnt >= 10000) {
        $oomReason = "kernel แจ้ง allocation fail {$memFailcnt} ครั้ง (memory peak {$maxMemPct}%) — memory มีความเครียดสูง ไม่ใกล้เต็มแต่ pattern ผิดปกติ";
    } else {
        $oomReason = "memory peak {$maxMemPct}% + failcnt {$memFailcnt} — ยังไม่ใกล้ขีดจำกัด";
    }
    $addCand('oom', 'memory มีความเครียด / เต็ม', $oomScore, $oomReason,
        ["OOMKilled × {$reasonCounts['OOMKilled']}", "memPeak={$maxMemPct}%", "failcnt=" . number_format($memFailcnt)]);

    // สมมติฐาน: pod ตัวเดียวพังซ้ำๆ (hot pod / crash loop)
    $hotScore = 0;
    if ($isHotPod && $maxRestartCount >= 10) $hotScore = 85;
    elseif ($isHotPod)                        $hotScore = 70;
    // Boost if hot pod also has waiting-state signal
    if ($isHotPod && isset($waitingReasons['CrashLoopBackOff'])) $hotScore += 10;
    // Boost if hot pod has self-5xx (thread pool stuck)
    if ($isHotPod && $totalSelfErrRate > 0) $hotScore += 8;
    $addCand('hot-pod', 'pod ตัวเดียวพังซ้ำๆ (hot pod / crash loop เฉพาะตัว)', $hotScore,
        $isHotPod
            ? "pod **`{$maxRestartPod}`** restart **{$maxRestartCount} ครั้ง** (คิดเป็น **" . round($hotPodShare) . "%** ของ restart ทั้งหมด) — pod ตัวอื่นแทบไม่โดน. เป็น pattern ของ pod ที่ state ค้าง / connection pool exhausted / deadlock / มี request หนักติดอยู่. **ควร kill pod นี้ทิ้งแล้วให้ Kubernetes สร้างใหม่**"
            : "restart กระจายไปหลาย pod — ไม่ใช่ pattern hot pod",
        $isHotPod ? ["pod={$maxRestartPod}", "restarts={$maxRestartCount}/{$totalRestarts}", "share=" . round($hotPodShare) . "%"] : []);

    // สมมติฐาน: app โดน overload (thread pool / DB pool / GC ไม่ทัน)
    // ตัว signal คือ service ตัวเองส่ง 5xx (500/503) ให้ caller ก่อน restart
    $overloadScore = 0;
    if ($totalSelfErrRate >= 1)                 $overloadScore = 78;
    elseif ($totalSelfErrRate >= 0.1)           $overloadScore = 55;
    elseif ($totalSelfErrRate > 0)              $overloadScore = 30;
    // Boost signals
    if ($overloadScore > 0 && $memFailcnt >= 100000) $overloadScore += 10;   // memory + self-5xx = overload
    if ($overloadScore > 0 && $maxCpuPct >= 85)      $overloadScore += 8;    // CPU spiked
    if ($overloadScore > 0 && $hpaScaleEvent)        $overloadScore += 8;    // HPA already scaling
    $addCand('internal-overload', 'app ประมวลผลไม่ทัน (thread pool / DB pool / GC pause)', $overloadScore,
        $totalSelfErrRate > 0
            ? "service ตอบ **5xx ให้ caller {$totalSelfErrRate} req/s** ก่อน restart — แปลว่า app ข้างในทำงานไม่ทัน (thread pool ท่วม, DB connection หมด, GC pause นาน). Pattern เข้ากับ" . ($memFailcnt >= 100000 ? " memory pressure ({$memFailcnt} failcnt) + " : " ") . ($maxCpuPct >= 85 ? "CPU spike {$maxCpuPct}%" : "") . ($hpaScaleEvent ? " + HPA พยายาม scale up {$hpaMin}→{$hpaMax}" : "")
            : "service ไม่ได้ส่ง 5xx กลับให้ใคร — ไม่ใช่ overload",
        $totalSelfErrRate > 0 ? ["self5xx={$totalSelfErrRate}/s", "memFailcnt=" . number_format($memFailcnt), "cpuPeak={$maxCpuPct}%"] : []);

    // สมมติฐาน: traffic ทะลัก HPA ต้อง scale up
    $trafficScore = 0;
    if ($hpaScaleEvent && $hpaMax > $hpaMin) $trafficScore = 40;
    if ($trafficScore > 0 && $totalSelfErrRate > 0)  $trafficScore += 25;   // overloading + scaling = classic traffic spike
    if ($trafficScore > 0 && $maxCpuPct >= 85)       $trafficScore += 15;
    if ($trafficScore > 0 && $memFailcnt >= 100000)  $trafficScore += 10;
    $addCand('traffic-spike', 'traffic พุ่ง HPA ต้อง scale up ตาม', $trafficScore,
        $hpaScaleEvent
            ? "HPA scale **{$hpaMin} → {$hpaMax} pod** ในช่วงนี้ — น่าจะมี traffic เพิ่มพุ่งขึ้น pod เดิมรับไม่ไหว. " . ($totalSelfErrRate > 0 ? "pod ที่มีอยู่ตอบ 5xx {$totalSelfErrRate}/s ระหว่างที่ scale up ยังไม่พร้อม → restart" : "")
            : "จำนวน replica ไม่เปลี่ยนในช่วงนี้",
        $hpaScaleEvent ? ["hpa {$hpaMin}→{$hpaMax}", "self5xx={$totalSelfErrRate}/s", "cpuPeak={$maxCpuPct}%"] : []);

    // สมมติฐาน: app พังเอง
    $crashScore = 0;
    if ($reasonCounts['Error'] > 0)                     $crashScore = 90 - ($reasonCounts['Completed'] * 5);
    if (isset($waitingReasons['CrashLoopBackOff']))     $crashScore = max($crashScore, 92);
    if ($uptimeStats && $uptimeStats['avgSec'] < 300)   $crashScore += 15;
    $addCand('app-crash', 'app พังเอง (exception ภายใน)', $crashScore,
        isset($waitingReasons['CrashLoopBackOff'])
            ? "พบ **CrashLoopBackOff** — pod ตายซ้ำๆ ตั้งแต่ start"
            : "**{$reasonCounts['Error']} pod** exit ด้วย error code · ต้องดู log ของ pod เหล่านั้น",
        ["exitError × {$reasonCounts['Error']}", "waiting=" . implode(',', array_keys($waitingReasons))]);

    // สมมติฐาน: downstream ล่ม
    $downScore = 0;
    if ($totalDs5xxRate >= 5)                           $downScore = 85;
    elseif ($totalDs5xxRate >= 1)                       $downScore = 60;
    elseif ($totalDs5xxRate > 0)                        $downScore = 30;
    if ($primaryReason === 'Completed' && $totalDs5xxRate > 0) $downScore += 10;
    $addCand('downstream-failure', 'ระบบที่เราเรียกใช้พัง แล้วเราตายตาม', $downScore,
        $totalDs5xxRate > 0
            ? "downstream ตอบ **5xx {$totalDs5xxRate} req/s** จาก " . count($downstreamErrList) . " target — health check ของเราน่าจะ timeout รอ dependency"
            : "downstream ทุกตัวตอบปกติ ไม่มี 5xx",
        ["downstream 5xx {$totalDs5xxRate}/s", 'targets=' . count($downstreamErrList)]);

    // สมมติฐาน: มีคน/สคริปต์สั่ง restart
    $sigtermScore = 0;
    if ($primaryReason === 'Completed' && $coordSpanSec !== null && $coordSpanSec <= 120) $sigtermScore = 70;
    if ($sigtermScore > 0 && $maxMemPct < 80 && $cpuThrottlePct < 5) $sigtermScore += 15;
    if ($sigtermScore > 0 && $totalDs5xxRate < 1)                   $sigtermScore += 10;
    if ($mixedNodes > 0)                                            $sigtermScore += 5;
    $addCand('external-sigterm', 'มีคนหรือสคริปต์สั่ง restart (kubectl / liveness / rollout)', $sigtermScore,
        $sigtermScore > 0
            ? "**{$affectedCount} pod ปิดตัวพร้อมกันภายใน {$coordSpanSec} วิ** · ทุกตัว exit 0 · ทรัพยากรปกติ — pattern เข้ากับการโดน SIGTERM จากภายนอก"
            : "ไม่ตรงกับ pattern (การ restart ไม่ได้เกิดพร้อมกัน หรือมี resource pressure)",
        ["coordSpan={$coordSpanSec}s", "pods={$affectedCount}", "memPeak={$maxMemPct}%"]);

    // สมมติฐาน: server (node) มีปัญหา
    $nodeScore = 0;
    if ($freshNodesHostingUs > 0)  $nodeScore = 70;
    if ($mixedNodes === 0 && count($restartedNodes) < $affectedCount) $nodeScore = max($nodeScore, 45);
    if ($mixedNodes > 0)           $nodeScore = 5;
    $addCand('node-event', 'server (node) ที่ pod อยู่โดนล้ม/ย้าย', $nodeScore,
        $freshNodesHostingUs > 0
            ? "**{$freshNodesHostingUs} node** ที่ host pod ที่ตาย เพิ่งถูกสร้างใหม่ในช่วงนี้ — น่าจะโดน Karpenter consolidation หรือ node eviction"
            : ($mixedNodes > 0
                ? "pod ที่ตายและ pod ที่ยังอยู่ ใช้ node ร่วมกัน {$mixedNodes} node → **ตัด node event ออกได้**"
                : "ไม่มีสัญญาณ node ใหม่ในช่วงนี้"),
        ["freshNodes={$freshNodesHostingUs}", "mixedNodes={$mixedNodes}"]);

    // สมมติฐาน: CPU ไม่พอ health check ล้ม
    $cpuScore = 0;
    if ($cpuThrottlePct >= 10)  $cpuScore = 75;
    elseif ($cpuThrottlePct >= 5) $cpuScore = 45;
    elseif ($maxCpuPct >= 95)    $cpuScore = 30;
    $addCand('cpu-starvation', 'CPU โดนจำกัดจน health check ตอบไม่ทัน', $cpuScore,
        $cpuThrottlePct >= 5
            ? "CPU โดน throttle **{$cpuThrottlePct}% ของเวลา** ({$cpuThrottleSec} วิรวม) — pod ตอบ probe ช้าจนถูกเข้าใจว่าตาย"
            : "CPU throttle ต่ำ ({$cpuThrottlePct}%) — ไม่น่าเป็นสาเหตุ",
        ["throttle={$cpuThrottlePct}%", "cpuPeak={$maxCpuPct}%"]);

    // Sort by score desc, keep top 5.
    usort($candidates, fn($a, $b) => $b['score'] <=> $a['score']);
    $candidates = array_slice($candidates, 0, 5);
}

// ── Evidence bundle (v4) ─────────────────────────────────────────────────
// For every headline stat + verdict claim, attach the raw PromQL that
// produced it + the computed value + up to N sample data points.
// Frontend renders as expandable "หลักฐานทั้งหมด" so users can VERIFY
// every number before trusting the verdict.
$fmtBytesShort = function ($n) {
    if ($n <= 0) return '0';
    $units = ['B','KB','MB','GB','TB']; $i = 0; $v = $n;
    while ($v >= 1024 && $i < count($units) - 1) { $v /= 1024; $i++; }
    return round($v, $v >= 100 ? 0 : 1) . ' ' . $units[$i];
};
$evidence = [
    'restartCount' => [
        'label'   => 'จำนวน restart รวม',
        'value'   => (string)$totalRestarts,
        'unit'    => 'ครั้ง',
        'promql'  => $instant['restartsTotal'],
        'samples' => array_map(fn($p) => [
            'pod'     => $p['pod'],
            'restart' => $p['count'],
            'reason'  => $p['reason'],
            'time'    => $p['restartedAtUnix'] ? date('Y-m-d H:i:s', $p['restartedAtUnix']) : '—',
        ], $perPod),
    ],
    'memPeak' => [
        'label'   => 'Memory peak (% of limit)',
        'value'   => $maxMemPct . '%',
        'unit'    => '% of limit',
        'promql'  => "max_over_time(container_memory_working_set_bytes{pod=~\"{$podRe}\"}[{$rangeExpr}])\n÷ kube_pod_container_resource_limits{...,resource=\"memory\"}\n× 100",
        'samples' => array_map(fn($pod, $data) => [
            'pod'   => $pod,
            'used'  => $fmtBytesShort($data['used'] ?? 0),
            'limit' => $fmtBytesShort($data['limit'] ?? 0),
            'pct'   => round($data['pct'] ?? 0, 1) . '%',
        ], array_keys($memPct), $memPct),
    ],
    'memFailcnt' => [
        'label'   => 'Kernel memory allocation failures (failcnt)',
        'value'   => number_format($memFailcnt),
        'unit'    => 'events',
        'promql'  => $instant['memFailcnt'],
        'samples' => [['metric' => 'container_memory_failures_total', 'sum' => number_format($memFailcnt), 'note' => $memFailcnt >= 100000 ? 'สูงมาก — memory pressure chronic' : ($memFailcnt >= 10000 ? 'ปานกลาง' : 'ปกติ')]],
    ],
    'cpuPeak' => [
        'label'   => 'CPU peak + throttling',
        'value'   => "peak {$maxCpuPct}% · throttled {$cpuThrottlePct}%",
        'unit'    => '% of periods',
        'promql'  => "max_over_time(rate(container_cpu_usage_seconds_total[2m])[{$rangeExpr}:]) ÷ cpu_limit × 100\n· cfs_throttled_periods ÷ cfs_periods × 100",
        'samples' => [
            ['metric' => 'CPU peak',       'value' => $maxCpuPct . '%'],
            ['metric' => 'Throttled time', 'value' => $cpuThrottleSec . 's'],
            ['metric' => 'Throttled %',    'value' => $cpuThrottlePct . '% of CFS periods'],
        ],
    ],
    'network' => [
        'label'   => 'Network health (errors + drops)',
        'value'   => 'err=' . ($netTotals['rxErr'] + $netTotals['txErr']) . ' · drops=' . ($netTotals['rxDrop'] + $netTotals['txDrop']),
        'unit'    => 'packets/events',
        'promql'  => 'sum(increase(container_network_{receive,transmit}_{errors,packets_dropped}_total[range]))',
        'samples' => [
            ['metric' => 'RX errors',  'value' => $netTotals['rxErr']],
            ['metric' => 'TX errors',  'value' => $netTotals['txErr']],
            ['metric' => 'RX dropped', 'value' => $netTotals['rxDrop']],
            ['metric' => 'TX dropped', 'value' => $netTotals['txDrop']],
        ],
    ],
    'hotPod' => [
        'label'   => 'Hot pod detection',
        'value'   => $isHotPod ? "{$maxRestartPod} · {$maxRestartCount}×" : 'ไม่พบ (restart กระจาย)',
        'unit'    => 'restarts × pod',
        'promql'  => "sum by (pod) (increase(kube_pod_container_status_restarts_total{pod=~\"{$podRe}\"}[{$rangeExpr}])) > 0",
        'samples' => array_map(fn($p) => [
            'pod'      => $p['pod'],
            'restart'  => $p['count'],
            'shareOf'  => $totalRestarts > 0 ? round($p['count'] / $totalRestarts * 100, 1) . '%' : '—',
            'reason'   => $p['reason'],
        ], $perPod),
    ],
    'selfErr' => [
        'label'   => 'Self-served 5xx (service ตอบ error ให้ caller)',
        'value'   => $totalSelfErrRate . ' req/s',
        'unit'    => 'req/s',
        'promql'  => "topk(6, sum by (uri, status) (rate(http_server_requests_seconds_count{app_name=\"{$service}\",status=~\"5..\"}[{$rangeExpr}])) > 0)",
        'samples' => array_map(fn($e) => [
            'status' => $e['status'],
            'uri'    => $e['uri'],
            'rate'   => $e['rate'] . ' req/s',
        ], $selfHttpErrs),
    ],
    'downstreamErr' => [
        'label'   => 'Downstream 5xx (ระบบที่เราเรียก ตอบ error กลับ)',
        'value'   => $totalDs5xxRate . ' req/s',
        'unit'    => 'req/s',
        'promql'  => "topk(6, sum by (client_name, status) (rate(http_client_requests_seconds_count{app_name=\"{$service}\",status=~\"5..\"}[{$rangeExpr}])) > 0)",
        'samples' => array_map(fn($r) => [
            'target' => $r['target'],
            'rate'   => $r['rate5xx'] . ' req/s',
            'lat'    => $r['latencyPeakMs'] !== null ? $r['latencyPeakMs'] . ' ms' : '—',
        ], $downstreamErrList),
    ],
    'hpa' => [
        'label'   => 'HPA / Deployment replica count',
        'value'   => "min={$hpaMin} · max={$hpaMax}",
        'unit'    => 'replicas',
        'promql'  => "min_over_time(kube_deployment_status_replicas{deployment=~\"{$svcEsc}.*\"}[{$rangeExpr}])\nmax_over_time(kube_deployment_status_replicas{deployment=~\"{$svcEsc}.*\"}[{$rangeExpr}])",
        'samples' => [
            ['metric' => 'Min replicas in window', 'value' => $hpaMin],
            ['metric' => 'Max replicas in window', 'value' => $hpaMax],
            ['metric' => 'Scale event (Δ ≥ 2)',    'value' => $hpaScaleEvent ? 'YES' : 'no'],
        ],
    ],
    'nodes' => [
        'label'   => 'Node placement (restarted pods)',
        'value'   => count($restartedNodes) . ' node · mixed=' . $mixedNodes,
        'unit'    => 'nodes',
        'promql'  => "kube_pod_info{pod=~\"{$podRe}\"} · time() - kube_node_created{}",
        'samples' => array_map(fn($node, $cnt) => [
            'node'          => $node,
            'restartedPods' => $cnt,
            'hasSurvivor'   => isset($siblingNodes[$node]) ? 'yes (rules out node event)' : 'no',
            'isFresh'       => isset($freshNodes[$node]) ? 'YES (age ' . $freshNodes[$node] . 's — Karpenter?)' : 'no',
        ], array_keys($restartedNodes), $restartedNodes),
    ],
    'coord' => [
        'label'   => 'Coordinated timing (restart spread)',
        'value'   => $coordSpanSec !== null ? $coordSpanSec . 's' : '—',
        'unit'    => 'seconds',
        'promql'  => "max(container_start_time_seconds{pod=~\"{$podRe}\"}) - min(container_start_time_seconds{pod=~\"{$podRe}\"})  (recent restarts only)",
        'samples' => array_map(fn($p) => [
            'pod'       => $p['pod'],
            'startedAt' => $p['restartedAtUnix'] ? date('H:i:s', $p['restartedAtUnix']) : '—',
        ], $perPod),
    ],
];
// JVM only if we have it.
if ($appMetrics) {
    $evidence['jvm'] = [
        'label'   => 'JVM self-metrics',
        'value'   => "heap={$appMetrics['heapPct']}% · threads={$appMetrics['liveThreads']} · gc={$appMetrics['gcSecondsInWindow']}s",
        'unit'    => 'various',
        'promql'  => "avg(jvm_memory_used_bytes{app_name=\"{$service}\",area=\"heap\"}) ÷ jvm_memory_max_bytes\nmax(jvm_threads_live_threads)\nsum(increase(jvm_gc_pause_seconds_sum[{$rangeExpr}]))",
        'samples' => [
            ['metric' => 'Heap % of max',      'value' => $appMetrics['heapPct'] . '%'],
            ['metric' => 'Live threads',       'value' => $appMetrics['liveThreads']],
            ['metric' => 'GC pause total (s)', 'value' => $appMetrics['gcSecondsInWindow']],
        ],
    ];
}

// Wire cascade steps to their supporting evidence keys. Frontend uses these
// to show "▾ ดูหลักฐาน" toggle per step.
$stepEvidenceMap = [
    'trigger'        => ['restartCount', 'hotPod', 'coord'],
    'memory'         => ['memPeak', 'memFailcnt'],
    'cpu'            => ['cpuPeak'],
    'crash'          => ['restartCount'],
    'network'        => ['network'],
    'waiting'        => ['restartCount'],
    'coordinated'    => ['coord', 'hotPod'],
    'node-event'     => ['nodes'],
    'downstream-5xx' => ['downstreamErr'],
    'self-5xx'       => ['selfErr'],
    'jvm'            => ['jvm'],
];
foreach ($cascade as &$step) {
    $step['evidenceRefs'] = $stepEvidenceMap[$step['id']] ?? [];
}
unset($step);

$out = [
    'service'       => $service,
    'range'         => $range,
    'rangeSec'      => $rangeSec,
    'namespace'     => $perPod[0]['namespace'] ?? null,
    'fetchedAt'     => date('c'),
    'fromCache'     => false,
    // Headline stats
    'restartCount'  => $totalRestarts,
    'affectedPods'  => $perPod,
    'reasonCounts'  => $reasonCounts,
    'primaryReason' => $primaryReason,
    'coordSpanSec'  => $coordSpanSec,
    'coordFirstAt'  => $coordFirstAt,
    'memPeakPct'    => $maxMemPct,
    'memFailcnt'    => $memFailcnt,
    'cpuPeakPct'    => $maxCpuPct,
    'cpuThrottleSec'=> $cpuThrottleSec,
    'cpuThrottlePct'=> $cpuThrottlePct,
    'netTotals'     => $netTotals,
    'waitingReasons'=> $waitingReasons,
    'restartedNodes'=> $restartedNodes,
    'siblingNodes'  => $siblingNodes,
    'mixedNodes'    => $mixedNodes,
    // Downstream + app health
    'downstreamErrors' => $downstreamErrList,
    'downstreamErrRate'=> $totalDs5xxRate,
    'selfHttpErrors'   => $selfHttpErrs,
    'appMetrics'       => $appMetrics,
    // Charts
    'timeline'      => $timeline,
    // v3 deep signals
    'uptimeStats'      => $uptimeStats,
    'readyPods'        => $readyPods,
    'totalPodsNow'     => $totalPods,
    'notReadyPods'     => $notReadyPods,
    'diskWriteBps'     => (int)round($diskWriteBps),
    'diskPressure'     => $diskPressure,
    'hpaMin'           => $hpaMin,
    'hpaMax'           => $hpaMax,
    'hpaScaleEvent'    => $hpaScaleEvent,
    'freshNodes'       => $freshNodes,
    'freshNodesHostingUs' => $freshNodesHostingUs,
    // v4 signals
    'hotPod'           => $isHotPod ? $maxRestartPod : null,
    'hotPodRestarts'   => $maxRestartCount,
    'hotPodShare'      => round($hotPodShare, 1),
    'isHotPod'         => $isHotPod,
    'selfErrRateTotal' => $totalSelfErrRate,
    // v4 evidence bundle — raw PromQL + samples per metric
    'evidence'         => $evidence,
    'isCustom'         => $isCustom,
    'startUnix'        => $start,
    'endUnix'          => $end,
    // Narrative + verdict
    'cascade'          => $cascade,
    'finalVerdict'     => $verdict,
    'summary'          => $summary,
    'candidates'       => $candidates,
];

$dir = dirname($cachePath);
if (!is_dir($dir)) @mkdir($dir, 0775, true);
@file_put_contents($cachePath, json_encode($out));
respondOk($out);
