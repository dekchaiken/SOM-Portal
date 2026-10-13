<?php
/**
 * GET /api/begin-grafana/endpoints.php
 *   ?service=<name>[&window=<min>][&cluster=<clu>]
 *
 * Discover every HTTP endpoint exposed by a Spring/Micrometer service and
 * classify each as healthy / degraded / failing / idle based on 4xx/5xx
 * ratios + p95 latency. SM-only.
 */
require_once __DIR__ . '/_lib.php';

ini_set('memory_limit', '256M');
set_time_limit(45);

$payload = requireAuth();
requireSmTeamOnly('Begin Grafana');
if ($_SERVER['REQUEST_METHOD'] !== 'GET') respondError('Method not allowed', 405);

$service     = trim((string)($_GET['service'] ?? ''));
$wantCluster = trim((string)($_GET['cluster'] ?? ''));
$windowMin   = min(1440, max(5, (int)($_GET['window'] ?? 30)));

if ($service === '' || !preg_match('/^[a-z0-9._-]+$/i', $service)) {
    respondError('service is required (alnum/dot/dash/underscore)', 400);
}
if ($wantCluster !== '' && !preg_match('/^[a-z0-9._-]+$/i', $wantCluster)) {
    respondError('invalid cluster', 400);
}

$cacheKey = "endpoints_{$service}_c{$wantCluster}_w{$windowMin}";
if ($cached = bgReadCache($cacheKey, BG_CACHE_TTL)) respondOk($cached);

// ── Detect source ─────────────────────────────────────────────────────────
[$src, $cluster, $appLabel, $probe] = bgDetectSource($service);
if (!$src) {
    respondOk([
        'service'  => $service,
        'found'    => false,
        'reason'   => 'No JVM datasource returned matching http_server_requests_seconds_count series (tried app_name + appScope on ' . count($probe) . ' sources)',
        'probes'   => $probe,
        'endpoints'=> [],
    ]);
}
if ($wantCluster !== '') $cluster = $wantCluster;

// ── Query per-endpoint breakdown ──────────────────────────────────────────
$jvmSrc = $src;
$jvmSrc['dsUid'] = (string)$src['jvmDsUid'];
$sel = bgSelector($service, $cluster, $appLabel);
$rangeSec = $windowMin * 60;

try {
    $inst = spQueryPromQL($jvmSrc, [
        // rate over the whole window — matches what user sees on the panel:
        // "requests/sec on average across window".
        'byStatus'  => "sum by (method, uri, status) (rate(http_server_requests_seconds_count{{$sel}}[{$rangeSec}s]))",
        'avgLat'    => "1000 * sum by (method, uri) (rate(http_server_requests_seconds_sum{{$sel}}[{$rangeSec}s])) / sum by (method, uri) (rate(http_server_requests_seconds_count{{$sel}}[{$rangeSec}s]))",
        'maxLat'    => "1000 * max by (method, uri) (http_server_requests_seconds_max{{$sel}})",
        'p95Lat'    => "1000 * histogram_quantile(0.95, sum by (method, uri, le) (rate(http_server_requests_seconds_bucket{{$sel}}[{$rangeSec}s])))",
    ]);
} catch (Throwable $e) {
    respondError('PromQL failed: ' . $e->getMessage(), 502);
}

$map = [];
foreach (($inst['byStatus'] ?? []) as $r) {
    $m       = $r['metric'] ?? [];
    $method  = (string)($m['method'] ?? '');
    $uri     = (string)($m['uri']    ?? '');
    $statusS = (string)($m['status'] ?? '');
    if ($uri === '') continue;
    $key = $method . ' ' . $uri;
    $val = (float)($r['value'][1] ?? 0);
    if (!isset($map[$key])) {
        $map[$key] = [
            'method'          => $method,
            'uri'             => $uri,
            'rps'             => 0.0,
            'rate2xx'         => 0.0,
            'rate3xx'         => 0.0,
            'rate4xx'         => 0.0,
            'rate5xx'         => 0.0,
            'rateOther'       => 0.0,
            'statusBreakdown' => [],
            'avgMs'           => null,
            'maxMs'           => null,
            'p95Ms'           => null,
        ];
    }
    $s = (int)$statusS;
    $map[$key]['rps'] += $val;
    if      ($s >= 200 && $s < 300) $map[$key]['rate2xx'] += $val;
    elseif ($s >= 300 && $s < 400) $map[$key]['rate3xx'] += $val;
    elseif ($s >= 400 && $s < 500) $map[$key]['rate4xx'] += $val;
    elseif ($s >= 500 && $s < 600) $map[$key]['rate5xx'] += $val;
    else                            $map[$key]['rateOther'] += $val;
    if ($statusS !== '') {
        $map[$key]['statusBreakdown'][$statusS] =
            ($map[$key]['statusBreakdown'][$statusS] ?? 0.0) + $val;
    }
}
foreach (($inst['avgLat'] ?? []) as $r) {
    $key = ($r['metric']['method'] ?? '') . ' ' . ($r['metric']['uri'] ?? '');
    if (isset($map[$key])) $map[$key]['avgMs'] = (float)($r['value'][1] ?? 0);
}
foreach (($inst['maxLat'] ?? []) as $r) {
    $key = ($r['metric']['method'] ?? '') . ' ' . ($r['metric']['uri'] ?? '');
    if (isset($map[$key])) $map[$key]['maxMs'] = (float)($r['value'][1] ?? 0);
}
foreach (($inst['p95Lat'] ?? []) as $r) {
    $key = ($r['metric']['method'] ?? '') . ' ' . ($r['metric']['uri'] ?? '');
    if (isset($map[$key])) $map[$key]['p95Ms'] = (float)($r['value'][1] ?? 0);
}

// Baseline p95 for verdict = service-wide median of per-endpoint p95.
$p95s = array_values(array_filter(array_map(fn($e) => $e['p95Ms'], $map)));
sort($p95s);
$baseline = null;
if (!empty($p95s)) {
    $baseline = $p95s[intdiv(count($p95s), 2)];
}

$rows = [];
foreach ($map as $e) {
    [$verdict, $reason] = bgVerdict(
        (float)$e['rps'], (float)$e['rate4xx'], (float)$e['rate5xx'],
        $e['p95Ms'], $baseline
    );
    $sb = [];
    foreach ($e['statusBreakdown'] as $code => $rate) {
        $sb[] = ['status' => (string)$code, 'rate' => round((float)$rate, 3)];
    }
    usort($sb, fn($a, $b) => $b['rate'] <=> $a['rate']);
    $rows[] = [
        'method'          => $e['method'],
        'uri'             => $e['uri'],
        'rps'             => round($e['rps'], 3),
        'rate2xx'         => round($e['rate2xx'], 3),
        'rate3xx'         => round($e['rate3xx'], 3),
        'rate4xx'         => round($e['rate4xx'], 3),
        'rate5xx'         => round($e['rate5xx'], 3),
        'rateOther'       => round($e['rateOther'], 3),
        'successRatio'    => $e['rps'] > 0 ? round($e['rate2xx'] / $e['rps'], 4) : null,
        'errorRatio'      => $e['rps'] > 0 ? round($e['rate5xx'] / $e['rps'], 4) : null,
        'avgMs'           => $e['avgMs'] !== null ? round($e['avgMs'], 1) : null,
        'maxMs'           => $e['maxMs'] !== null ? round($e['maxMs'], 1) : null,
        'p95Ms'           => $e['p95Ms'] !== null ? round($e['p95Ms'], 1) : null,
        'statusBreakdown' => $sb,
        'verdict'         => $verdict,
        'verdictReason'   => $reason,
    ];
}

// Sort: failing first, then degraded, then healthy, then idle.
// Within each bucket by rps desc.
$order = ['failing' => 0, 'degraded' => 1, 'healthy' => 2, 'idle' => 3];
usort($rows, function($a, $b) use ($order) {
    $oa = $order[$a['verdict']] ?? 9;
    $ob = $order[$b['verdict']] ?? 9;
    if ($oa !== $ob) return $oa <=> $ob;
    if ($a['rps'] !== $b['rps']) return $b['rps'] <=> $a['rps'];
    return strcmp($a['method'] . $a['uri'], $b['method'] . $b['uri']);
});

$counts = ['healthy' => 0, 'degraded' => 0, 'failing' => 0, 'idle' => 0];
foreach ($rows as $r) $counts[$r['verdict']]++;

$out = [
    'service'   => $service,
    'found'     => true,
    'runway'    => [
        'slug'    => (string)($src['slug'] ?? ''),
        'name'    => (string)($src['name'] ?? ''),
        'cluster' => $cluster,
        'appLabel'=> $appLabel,
    ],
    'window'    => ['minutes' => $windowMin, 'rangeSec' => $rangeSec],
    'baselineP95Ms' => $baseline !== null ? round($baseline, 1) : null,
    'summary'   => [
        'endpointCount' => count($rows),
        'counts'        => $counts,
        'totalRps'      => round(array_sum(array_column($rows, 'rps')), 3),
    ],
    'endpoints' => $rows,
    'fetchedAt' => date('c'),
    'fromCache' => false,
];
bgWriteCache($cacheKey, $out);
respondOk($out);
