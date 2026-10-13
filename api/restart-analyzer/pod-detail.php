<?php
/**
 * GET /api/restart-analyzer/pod-detail.php?pod=<name>&namespace=<ns>&restartedAt=<unix>&window=<sec>
 *
 * Zoom-in on ONE pod's restart moment: returns its individual mem/cpu
 * timeline in the ~5-min window around the restart. Used by the frontend
 * pod-drill-down panel so the on-call can see EXACTLY what that pod's
 * resource curve looked like right up to its death.
 *
 * Returns:
 *   { mem: [[ts,pct], …], cpu: [[ts,pct], …], memBytes: [[ts,bytes], …],
 *     memLimit: N, cpuLimit: N, restartedAt: N }
 */
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/../service-performance/_lib.php';

ini_set('memory_limit', '128M');
set_time_limit(30);

$payload = requireAuth();
requireRole($payload, ALL_STAFF_ROLES);
if ($_SERVER['REQUEST_METHOD'] !== 'GET') respondError('Method not allowed', 405);

$pod         = trim((string)($_GET['pod']         ?? ''));
$namespace   = trim((string)($_GET['namespace']   ?? ''));
$restartedAt = (int)($_GET['restartedAt'] ?? 0);
$window      = max(120, min(1800, (int)($_GET['window'] ?? 600)));  // default ±5 min, clamp 2 min – 30 min
if ($pod === '' || !preg_match('/^[a-z0-9._-]+$/i', $pod))     respondError('pod required', 400);
if ($namespace !== '' && !preg_match('/^[a-z0-9._-]+$/i', $namespace)) respondError('bad namespace', 400);
if ($restartedAt < 1000000000) respondError('restartedAt (unix seconds) required', 400);

$cfg = spLoadConfig();
$src = null;
foreach ($cfg['sources'] as $s) {
    if (($s['enabled'] ?? true) === false) continue;
    if (!empty($s['dsUid'])) { $src = $s; break; }
}
if (!$src) respondError('no dsUid configured', 500);

// Window centered on the restart moment. Pull FROM 4×window BEFORE the
// restart (to see the lead-up) and 1×window AFTER (to see recovery).
$start = $restartedAt - $window * 4;
$end   = $restartedAt + $window;
$step  = max(10, (int)round(($end - $start) / 120));

$podEsc = _spPromEscape($pod);
$nsFilter = $namespace !== '' ? ",namespace=\"{$namespace}\"" : '';

try {
    $q = spQueryPromRange($src, [
        'memBytes' => "max(container_memory_working_set_bytes{pod=\"{$podEsc}\"{$nsFilter},container!=\"POD\",container!=\"\"})",
        'memLimit' => "max(kube_pod_container_resource_limits{pod=\"{$podEsc}\"{$nsFilter},resource=\"memory\"})",
        'cpuRate'  => "sum(rate(container_cpu_usage_seconds_total{pod=\"{$podEsc}\"{$nsFilter},container!=\"POD\",container!=\"\"}[1m]))",
        'cpuLimit' => "max(kube_pod_container_resource_limits{pod=\"{$podEsc}\"{$nsFilter},resource=\"cpu\"})",
        'throttle' => "sum(rate(container_cpu_cfs_throttled_seconds_total{pod=\"{$podEsc}\"{$nsFilter},container!=\"POD\",container!=\"\"}[1m]))",
    ], $start, $end, $step);
} catch (Throwable $e) {
    respondError('query failed: ' . $e->getMessage(), 502);
}

// Flatten single-series matrix responses.
$asSeries = function (array $mat): array {
    if (empty($mat)) return [];
    $out = [];
    foreach ($mat[0]['values'] ?? [] as $p) $out[] = [(int)$p[0], (float)$p[1]];
    return $out;
};
$memBytes = $asSeries($q['memBytes'] ?? []);
$cpuRate  = $asSeries($q['cpuRate']  ?? []);
$throttle = $asSeries($q['throttle'] ?? []);

// Instant limits (usually stable across window; take the last non-zero).
$lastNonZero = function (array $s): float {
    for ($i = count($s) - 1; $i >= 0; $i--) if ($s[$i][1] > 0) return $s[$i][1];
    return 0;
};
$memLimit = $lastNonZero($asSeries($q['memLimit'] ?? []));
$cpuLimit = $lastNonZero($asSeries($q['cpuLimit'] ?? []));

// Build percent-of-limit series so the frontend can plot on a shared 0-100 axis.
$memPct = $memLimit > 0
    ? array_map(fn($p) => [$p[0], round($p[1] / $memLimit * 100, 2)], $memBytes)
    : [];
$cpuPct = $cpuLimit > 0
    ? array_map(fn($p) => [$p[0], round($p[1] / $cpuLimit * 100, 2)], $cpuRate)
    : [];

respondOk([
    'pod'          => $pod,
    'namespace'    => $namespace,
    'restartedAt'  => $restartedAt,
    'windowSec'    => $window,
    'startUnix'    => $start,
    'endUnix'      => $end,
    'memBytes'     => $memBytes,
    'memPct'       => $memPct,
    'cpuRate'      => $cpuRate,
    'cpuPct'       => $cpuPct,
    'throttleRate' => $throttle,
    'memLimit'     => $memLimit,
    'cpuLimit'     => $cpuLimit,
    'fetchedAt'    => date('c'),
]);
