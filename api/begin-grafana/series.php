<?php
/**
 * GET /api/begin-grafana/series.php
 *   ?service=<name>&method=<M>&uri=<U>[&metric=rps|latency|status]
 *   [&window=<min>][&cluster=<clu>]
 *
 * Return time-series for one endpoint. SM-only.
 *   metric=rps      → single line, total RPS
 *   metric=latency  → 3 lines (p50/p95/p99, milliseconds)
 *   metric=status   → stacked by 2xx/3xx/4xx/5xx/other (RPS per bucket)
 */
require_once __DIR__ . '/_lib.php';

$payload = requireAuth();
requireSmTeamOnly('Begin Grafana');
if ($_SERVER['REQUEST_METHOD'] !== 'GET') respondError('Method not allowed', 405);

$service     = trim((string)($_GET['service'] ?? ''));
$method      = trim((string)($_GET['method']  ?? ''));
$uri         = trim((string)($_GET['uri']     ?? ''));
$metric      = trim((string)($_GET['metric']  ?? 'rps'));
$wantCluster = trim((string)($_GET['cluster'] ?? ''));
$windowMin   = min(1440, max(5, (int)($_GET['window'] ?? 30)));

if ($service === '' || !preg_match('/^[a-z0-9._-]+$/i', $service)) respondError('service is required', 400);
if ($method === '' || !preg_match('/^[A-Z]+$/', $method))          respondError('method is required (uppercase)', 400);
if ($uri === '')                                                    respondError('uri is required', 400);
if (!in_array($metric, ['rps', 'latency', 'status'], true))         respondError('metric must be rps|latency|status', 400);
if ($wantCluster !== '' && !preg_match('/^[a-z0-9._-]+$/i', $wantCluster)) respondError('invalid cluster', 400);

[$src, $cluster, $appLabel, ] = bgDetectSource($service);
if (!$src) respondError('no matching JVM datasource for service', 404);
if ($wantCluster !== '') $cluster = $wantCluster;

$jvmSrc = $src;
$jvmSrc['dsUid'] = (string)$src['jvmDsUid'];

$sel  = bgSelector($service, $cluster, $appLabel);
$sel .= ',method="' . bgEscapeLiteral($method) . '",uri="' . bgEscapeLiteral($uri) . '"';

$end   = time();
$start = $end - ($windowMin * 60);
$step  = max(15, (int)round(($end - $start) / 180));

$queries = [];
if ($metric === 'rps') {
    $queries['rps'] = "sum(rate(http_server_requests_seconds_count{{$sel}}[5m]))";
} elseif ($metric === 'latency') {
    $queries['p50'] = "1000 * histogram_quantile(0.50, sum by (le) (rate(http_server_requests_seconds_bucket{{$sel}}[5m])))";
    $queries['p95'] = "1000 * histogram_quantile(0.95, sum by (le) (rate(http_server_requests_seconds_bucket{{$sel}}[5m])))";
    $queries['p99'] = "1000 * histogram_quantile(0.99, sum by (le) (rate(http_server_requests_seconds_bucket{{$sel}}[5m])))";
    $queries['avg'] = "1000 * sum(rate(http_server_requests_seconds_sum{{$sel}}[5m])) / sum(rate(http_server_requests_seconds_count{{$sel}}[5m]))";
} else { // status
    $queries['status'] = "sum by (status) (rate(http_server_requests_seconds_count{{$sel}}[5m]))";
}

try {
    $rng = spQueryPromRange($jvmSrc, $queries, $start, $end, $step);
} catch (Throwable $e) {
    respondError('PromQL range failed: ' . $e->getMessage(), 502);
}

$asSeries = function(array $matrix) {
    if (empty($matrix[0]['values'])) return [];
    return array_map(fn($p) => [(int)$p[0], $p[1] === 'NaN' ? null : (float)$p[1]], $matrix[0]['values']);
};

$series = [];
if ($metric === 'rps') {
    $series[] = ['name' => 'RPS', 'points' => $asSeries($rng['rps'] ?? [])];
} elseif ($metric === 'latency') {
    foreach (['p50', 'p95', 'p99', 'avg'] as $k) {
        $series[] = ['name' => strtoupper($k), 'points' => $asSeries($rng[$k] ?? [])];
    }
} else {
    // Multi-series by status label
    $buckets = ['2xx' => [], '3xx' => [], '4xx' => [], '5xx' => [], 'other' => []];
    $ts = [];  // union of timestamps
    foreach ($rng['status'] ?? [] as $row) {
        $code = (int)($row['metric']['status'] ?? 0);
        $b = $code >= 200 && $code < 300 ? '2xx'
            : ($code >= 300 && $code < 400 ? '3xx'
            : ($code >= 400 && $code < 500 ? '4xx'
            : ($code >= 500 && $code < 600 ? '5xx' : 'other')));
        foreach (($row['values'] ?? []) as $p) {
            $t = (int)$p[0];
            $v = $p[1] === 'NaN' ? 0.0 : (float)$p[1];
            $buckets[$b][$t] = ($buckets[$b][$t] ?? 0.0) + $v;
            $ts[$t] = true;
        }
    }
    ksort($ts);
    foreach ($buckets as $name => $pts) {
        $out = [];
        foreach (array_keys($ts) as $t) $out[] = [$t, isset($pts[$t]) ? round($pts[$t], 4) : 0];
        $series[] = ['name' => $name, 'points' => $out];
    }
}

respondOk([
    'service' => $service,
    'method'  => $method,
    'uri'     => $uri,
    'metric'  => $metric,
    'window'  => ['minutes' => $windowMin, 'startUnix' => $start, 'endUnix' => $end, 'stepSeconds' => $step],
    'runway'  => ['slug' => (string)($src['slug'] ?? ''), 'cluster' => $cluster],
    'series'  => $series,
]);
