<?php
// GET /api/alerts/preview.php
// Returns time-series data for the live preview panel in the New Alert modal.
//
// For byPod metrics (e.g. mem_pod_max): queries Prometheus for per-pod range
// data so the preview shows one line per pod instead of a flat average.
// For scalar metrics: returns a single series (same shape as detail.php but
// re-queried here so the preview can use a different time window).
//
// Query params:
//   service    — required
//   metric     — required (must exist in alertMetricsCatalog)
//   windowMin  — minutes of history (default 60, max 1440)
//   cluster    — optional cluster pin
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/../service-performance/_lib.php';

$user = requireAuth();

$service   = trim((string)($_GET['service']   ?? ''));
$metricKey = trim((string)($_GET['metric']    ?? ''));
$windowMin = max(5, min(1440, (int)($_GET['windowMin'] ?? 60)));
$cluster   = trim((string)($_GET['cluster']   ?? ''));

if ($service === '')   respondError('service required', 400);
if ($metricKey === '') respondError('metric required', 400);

$catalog = alertMetricsCatalog();
$m = $catalog[$metricKey] ?? null;
if (!$m) respondError('unknown metric', 400);

// Resolve which Grafana datasource + namespace to use for this service.
$spCfg   = spLoadConfig();
$sources = $spCfg['sources'] ?? [];
$resolved = _alertsResolveSource($service, $cluster, $sources);
if (!$resolved) respondError('service not found in any configured source', 404);

$src       = $resolved['src'];
$namespace = $resolved['namespace'];
$selCluster = $resolved['cluster'];

// Build label selectors (mirrors tick.php conventions).
$svcRe   = _spPromEscape($service);
$parts   = [];
if ($selCluster !== '') $parts[] = "cluster=\"{$selCluster}\"";
if ($namespace  !== '') $parts[] = "namespace=\"{$namespace}\"";
else                    $parts[] = "namespace=~\"" . (string)($src['namespaceRegex'] ?? '.+') . "\"";
$parts[] = "pod=~\"{$svcRe}.*\"";
$sel     = implode(',', $parts);
$contSel = "container=\"{$service}\"";

$liveQ = strtr($m['liveQuery'], [
    '{{sel}}'     => $sel,
    '{{contSel}}' => $contSel,
    '{{jvmSel}}'  => "app_name=\"{$service}\"" . ($selCluster !== '' ? ",cluster=\"{$selCluster}\"" : ''),
    '{{svc}}'     => $service,
]);

$now   = time();
$start = $now - $windowMin * 60;
// Aim for ~120 data points regardless of window size.
$step  = max(15, (int)round($windowMin * 60 / 120));

$isByPod = !empty($m['byPod']);

try {
    $rangeResults = spQueryPromRange($src, ['live' => $liveQ], $start, $now, $step);
    $podSeries = $rangeResults['live'] ?? [];
} catch (Throwable $e) {
    respondError('Prometheus query failed: ' . $e->getMessage(), 502);
}

// Resolve limit (instant query — same limit applies to all pods in a Deployment).
$limitValue = null;
if (!empty($m['limitQuery'])) {
    $limQ = strtr($m['limitQuery'], [
        '{{sel}}'     => $sel,
        '{{contSel}}' => $contSel,
        '{{jvmSel}}'  => "app_name=\"{$service}\"" . ($selCluster !== '' ? ",cluster=\"{$selCluster}\"" : ''),
        '{{svc}}'     => $service,
    ]);
    try {
        $limRes = spQueryPromQL($src, ['lim' => $limQ]);
        $limRow = $limRes['lim'][0]['value'][1] ?? null;
        if ($limRow !== null) $limitValue = (float)$limRow;
    } catch (Throwable $e) { /* limit stays null */ }
}

// Helper: convert raw value to the display value (apply pct normalisation).
$toDisplay = function(float $raw) use ($m, $limitValue): ?float {
    if ($m['compareAs'] === 'pct' && $limitValue && $limitValue > 0) {
        return ($raw / $limitValue) * 100;
    }
    return $raw;
};

if ($isByPod) {
    // Per-pod: return one series per pod, keyed by pod name.
    $pods = [];
    foreach ($podSeries as $series) {
        $podName = $series['metric']['pod'] ?? ($series['metric']['pod_name'] ?? '?');
        $pts = [];
        foreach ($series['values'] as [$ts, $val]) {
            $v = $toDisplay((float)$val);
            if ($v !== null) $pts[] = [(int)$ts, round($v, 2)];
        }
        if (!$pts) continue;
        $current = $pts[count($pts) - 1][1] ?? null;
        $pods[$podName] = ['series' => $pts, 'current' => $current];
    }
    // Sort pods by current value desc so worst pod is listed first.
    uasort($pods, fn($a, $b) => ($b['current'] ?? 0) <=> ($a['current'] ?? 0));
    respondOk([
        'byPod'      => true,
        'pods'       => $pods,
        'limitValue' => $limitValue,
        'windowMin'  => $windowMin,
        'step'       => $step,
    ]);
} else {
    // Scalar: collapse all matching series to a single series (sum/first).
    // Most scalar queries already return one series; for multi-series (edge
    // case) we take the first one to match tick.php's $scalar() behaviour.
    $pts = [];
    if (!empty($podSeries[0]['values'])) {
        foreach ($podSeries[0]['values'] as [$ts, $val]) {
            $v = $toDisplay((float)$val);
            if ($v !== null) $pts[] = [(int)$ts, round($v, 2)];
        }
    }
    $current = !empty($pts) ? $pts[count($pts) - 1][1] : null;
    respondOk([
        'byPod'      => false,
        'series'     => $pts,
        'current'    => $current,
        'limitValue' => $limitValue,
        'windowMin'  => $windowMin,
        'step'       => $step,
    ]);
}
