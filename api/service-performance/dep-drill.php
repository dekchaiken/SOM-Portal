<?php
/**
 * GET /api/service-performance/dep-drill.php?kind=<downstream|upstream>&target=<svc>[&caller=<svc>]
 *
 * Per-URI drill-down for one edge of the Dependencies graph. Two modes:
 *
 *   • kind=upstream  &caller=<X>  &target=<Y>
 *       Returns the URIs of Y that X hits (i.e. X's own http_client / SCG
 *       traffic filtered to routes reaching Y). Answers: "which endpoints on
 *       mobile-auth-service is tmn-mobile-gateway calling?"
 *
 *   • kind=downstream &caller=<X> &target=<Y>
 *       Same shape, viewed from the OTHER side — X calls Y. In practice the
 *       downstream side already ships this in detail.php's response so the
 *       frontend can filter locally; this endpoint exists so drill logic is
 *       symmetric (and so we can re-query fresh data if the client wants it).
 *
 * Returns:
 *   {
 *     ok: true,
 *     data: {
 *       kind: "upstream"|"downstream",
 *       caller: "…", target: "…",
 *       rows: [
 *         { method, uri, source: "http"|"scg",
 *           rateTotal, rate2xx, rate4xx, rate5xx, rateOther,
 *           statusBreakdown: [{status:"200", rate:1.2}, ...],
 *           latencyMs
 *         }, …
 *       ]
 *     }
 *   }
 */
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/_lib.php';

ini_set('memory_limit', '256M');
set_time_limit(30);

$payload = requireAuth();
requireRole($payload, ALL_STAFF_ROLES);
if ($_SERVER['REQUEST_METHOD'] !== 'GET') respondError('Method not allowed', 405);

$kind   = trim((string)($_GET['kind']   ?? ''));
$caller = trim((string)($_GET['caller'] ?? ''));
$target = trim((string)($_GET['target'] ?? ''));

if (!in_array($kind, ['upstream', 'downstream'], true)) {
    respondError('kind must be "upstream" or "downstream"', 400);
}
if ($caller === '' || !preg_match('/^[a-z0-9._-]+$/i', $caller)) {
    respondError('caller is required (letters/digits/._-)', 400);
}
if ($target === '' || !preg_match('/^[a-z0-9._-]+$/i', $target)) {
    respondError('target is required (letters/digits/._-)', 400);
}

// Reuse detail.php's runway auto-detection to pick a JVM datasource. Since
// http_client / SCG metrics live on the jvmDsUid across all sources, we grab
// the first enabled source that has jvmDsUid set — sufficient because Prom
// federates all clusters into the same Thanos store.
$cfg = spLoadConfig();
$jvmSrc = null;
foreach ($cfg['sources'] as $s) {
    if (($s['enabled'] ?? true) === false) continue;
    if (!empty($s['jvmDsUid'])) {
        $jvmSrc = $s;
        $jvmSrc['dsUid'] = $s['jvmDsUid'];
        break;
    }
}
if (!$jvmSrc) respondError('no source with jvmDsUid configured', 500);

// 60s cache — per (kind, caller, target). Same TTL as detail.php so drill
// numbers stay in sync with the graph node they were clicked from.
$cacheKey  = preg_replace('/[^a-z0-9._-]+/i', '_',
    "drill_{$kind}_{$caller}__{$target}");
$cachePath = teamDataPath('service-performance/cache/drill/' . $cacheKey . '.json');
if (file_exists($cachePath) && (time() - (int)filemtime($cachePath)) <= 60) {
    $c = json_decode((string)file_get_contents($cachePath), true);
    if (is_array($c)) { $c['fromCache'] = true; respondOk($c); }
}

$targetEsc = _spPromEscape($target);
// PromQL string escape rule: bare `\.` is rejected — needs `\\.` on wire.
// PHP double-quoted `"\\\\"` = `\\` (2 chars), then literal `.`.
$clientPat = "^{$targetEsc}\$|^{$targetEsc}\\\\..*";
$scgPat    = ".*//{$targetEsc}\\\\..*";

// The `caller=<X>` scoping restricts BOTH queries to a single upstream service
// so the drill shows "just X→Y traffic". For downstream we scope by caller too
// so a `mobile-auth-service` → `acm-kyc` drill isn't polluted by other clients
// of `acm-kyc`.
$callerSel = "app_name=\"{$caller}\"";

// Http client — try snake_case + camelCase since Micrometer versions differ.
// SCG — routeUri filter is more expensive so we constrain it via caller too.
$queries = [
    'httpSnakeCount'   => "sum by (method, uri, status, outcome) (rate(http_client_requests_seconds_count{{$callerSel},client_name=~\"{$clientPat}\"}[5m]))",
    'httpCamelCount'   => "sum by (method, uri, status, outcome) (rate(http_client_requests_seconds_count{{$callerSel},clientName=~\"{$clientPat}\"}[5m]))",
    'scgCount'         => "sum by (httpMethod, routeUri, httpStatusCode) (rate(spring_cloud_gateway_requests_seconds_count{{$callerSel},routeUri=~\"{$scgPat}\"}[5m]))",
    'httpSnakeLatency' => "sum by (method, uri) (rate(http_client_requests_seconds_sum{{$callerSel},client_name=~\"{$clientPat}\"}[5m])) / (sum by (method, uri) (rate(http_client_requests_seconds_count{{$callerSel},client_name=~\"{$clientPat}\"}[5m])) > 0) * 1000",
    'httpCamelLatency' => "sum by (method, uri) (rate(http_client_requests_seconds_sum{{$callerSel},clientName=~\"{$clientPat}\"}[5m]))  / (sum by (method, uri) (rate(http_client_requests_seconds_count{{$callerSel},clientName=~\"{$clientPat}\"}[5m])) > 0) * 1000",
    'scgLatency'       => "sum by (httpMethod, routeUri) (rate(spring_cloud_gateway_requests_seconds_sum{{$callerSel},routeUri=~\"{$scgPat}\"}[5m])) / (sum by (httpMethod, routeUri) (rate(spring_cloud_gateway_requests_seconds_count{{$callerSel},routeUri=~\"{$scgPat}\"}[5m])) > 0) * 1000",
    // Real per-scrape max from Micrometer `_max` gauges. Same story as the
    // Avg latency chart — the ratio-based `latency` above is workload avg
    // (smooth); `_max` captures the single slowest request per scrape
    // (surfaces 5-30s outliers the avg hides). Both snake + camel label
    // variants queried since Micrometer versions differ.
    'httpSnakeLatencyMax' => "max by (method, uri) (http_client_requests_seconds_max{{$callerSel},client_name=~\"{$clientPat}\"}) * 1000",
    'httpCamelLatencyMax' => "max by (method, uri) (http_client_requests_seconds_max{{$callerSel},clientName=~\"{$clientPat}\"}) * 1000",
    'scgLatencyMax'       => "max by (httpMethod, routeUri) (spring_cloud_gateway_requests_seconds_max{{$callerSel},routeUri=~\"{$scgPat}\"}) * 1000",
];
try {
    $res = spQueryPromQL($jvmSrc, $queries);
} catch (Throwable $e) {
    respondError('query failed: ' . $e->getMessage(), 502);
}

// ── Aggregate rows keyed by (method, uri) ────────────────────────────────────
$rowMap = [];
$upsert = function (string $method, string $uri, string $source) use (&$rowMap) {
    $key = $source . '|' . $method . '|' . $uri;
    if (!isset($rowMap[$key])) {
        $rowMap[$key] = [
            'source'          => $source,
            'method'          => $method,
            'uri'             => $uri,
            'rateTotal'       => 0.0,
            'rate2xx'         => 0.0,
            'rate4xx'         => 0.0,
            'rate5xx'         => 0.0,
            'rateOther'       => 0.0,
            'latencyMs'       => null,
            'latencyMaxMs'    => null,  // real per-scrape worst request
            'statusBreakdown' => [],  // {status: rate}
        ];
    }
    return $key;
};

// HTTP client series (both label variants land in the same table).
foreach (['httpSnakeCount', 'httpCamelCount'] as $qk) {
    foreach ($res[$qk] ?? [] as $r) {
        $m       = $r['metric'] ?? [];
        $method  = (string)($m['method'] ?? '');
        $uri     = (string)($m['uri']    ?? '');
        if ($uri === '') continue;
        $statusS = (string)($m['status'] ?? '');
        $status  = (int)$statusS;
        $val     = (float)($r['value'][1] ?? 0);
        $key     = $upsert($method, $uri, 'http');
        $rowMap[$key]['rateTotal'] += $val;
        if      ($status >= 200 && $status < 300) $rowMap[$key]['rate2xx']   += $val;
        elseif ($status >= 400 && $status < 500) $rowMap[$key]['rate4xx']   += $val;
        elseif ($status >= 500 && $status < 600) $rowMap[$key]['rate5xx']   += $val;
        else                                     $rowMap[$key]['rateOther'] += $val;
        if ($statusS !== '') {
            $rowMap[$key]['statusBreakdown'][$statusS] = ($rowMap[$key]['statusBreakdown'][$statusS] ?? 0.0) + $val;
        }
    }
}

// SCG series — different label names (httpMethod / routeUri / httpStatusCode).
foreach ($res['scgCount'] ?? [] as $r) {
    $m       = $r['metric'] ?? [];
    $method  = (string)($m['httpMethod']     ?? '');
    $uri     = (string)($m['routeUri']       ?? '');
    if ($uri === '') continue;
    $statusS = (string)($m['httpStatusCode'] ?? '');
    $status  = (int)$statusS;
    $val     = (float)($r['value'][1] ?? 0);
    $key     = $upsert($method, $uri, 'scg');
    $rowMap[$key]['rateTotal'] += $val;
    if      ($status >= 200 && $status < 300) $rowMap[$key]['rate2xx']   += $val;
    elseif ($status >= 400 && $status < 500) $rowMap[$key]['rate4xx']   += $val;
    elseif ($status >= 500 && $status < 600) $rowMap[$key]['rate5xx']   += $val;
    else                                     $rowMap[$key]['rateOther'] += $val;
    if ($statusS !== '') {
        $rowMap[$key]['statusBreakdown'][$statusS] = ($rowMap[$key]['statusBreakdown'][$statusS] ?? 0.0) + $val;
    }
}

// Latencies — assigned to matching rows keyed by (method, uri).
foreach (['httpSnakeLatency', 'httpCamelLatency'] as $qk) {
    foreach ($res[$qk] ?? [] as $r) {
        $m      = $r['metric'] ?? [];
        $method = (string)($m['method'] ?? '');
        $uri    = (string)($m['uri']    ?? '');
        $val    = (float)($r['value'][1] ?? 0);
        if ($val <= 0) continue;
        $key = 'http|' . $method . '|' . $uri;
        if (isset($rowMap[$key])) {
            if ($rowMap[$key]['latencyMs'] === null || $val > $rowMap[$key]['latencyMs']) {
                $rowMap[$key]['latencyMs'] = $val;
            }
        }
    }
}
foreach ($res['scgLatency'] ?? [] as $r) {
    $m      = $r['metric'] ?? [];
    $method = (string)($m['httpMethod'] ?? '');
    $uri    = (string)($m['routeUri']   ?? '');
    $val    = (float)($r['value'][1] ?? 0);
    if ($val <= 0) continue;
    $key = 'scg|' . $method . '|' . $uri;
    if (isset($rowMap[$key])) {
        $rowMap[$key]['latencyMs'] = $val;
    }
}

// Attach `_max` real-worst-request timings — same key convention.
foreach (['httpSnakeLatencyMax', 'httpCamelLatencyMax'] as $qk) {
    foreach ($res[$qk] ?? [] as $r) {
        $m      = $r['metric'] ?? [];
        $method = (string)($m['method'] ?? '');
        $uri    = (string)($m['uri']    ?? '');
        $val    = (float)($r['value'][1] ?? 0);
        if ($val <= 0) continue;
        $key = 'http|' . $method . '|' . $uri;
        if (isset($rowMap[$key])) {
            // Take the higher of the two label variants — some pods emit
            // snake_case, others camelCase; we want the worst observation.
            if ($rowMap[$key]['latencyMaxMs'] === null || $val > $rowMap[$key]['latencyMaxMs']) {
                $rowMap[$key]['latencyMaxMs'] = $val;
            }
        }
    }
}
foreach ($res['scgLatencyMax'] ?? [] as $r) {
    $m      = $r['metric'] ?? [];
    $method = (string)($m['httpMethod'] ?? '');
    $uri    = (string)($m['routeUri']   ?? '');
    $val    = (float)($r['value'][1] ?? 0);
    if ($val <= 0) continue;
    $key = 'scg|' . $method . '|' . $uri;
    if (isset($rowMap[$key])) $rowMap[$key]['latencyMaxMs'] = $val;
}

// Sort by total rate desc + round + convert statusBreakdown to array.
$rows = array_values($rowMap);
usort($rows, fn($a, $b) => $b['rateTotal'] <=> $a['rateTotal']);
foreach ($rows as &$row) {
    $row['rateTotal'] = round($row['rateTotal'], 3);
    $row['rate2xx']   = round($row['rate2xx'],   3);
    $row['rate4xx']   = round($row['rate4xx'],   3);
    $row['rate5xx']   = round($row['rate5xx'],   3);
    $row['rateOther'] = round($row['rateOther'], 3);
    if ($row['latencyMs']    !== null) $row['latencyMs']    = round($row['latencyMs'],    1);
    if ($row['latencyMaxMs'] !== null) $row['latencyMaxMs'] = round($row['latencyMaxMs'], 1);
    $sb = [];
    foreach ($row['statusBreakdown'] as $code => $rate) {
        $sb[] = ['status' => (string)$code, 'rate' => round($rate, 3)];
    }
    usort($sb, fn($a, $b) => $b['rate'] <=> $a['rate']);
    $row['statusBreakdown'] = $sb;
}
unset($row);

$out = [
    'kind'      => $kind,
    'caller'    => $caller,
    'target'    => $target,
    'rows'      => $rows,
    'fromCache' => false,
    'fetchedAt' => date('c'),
];

$dir = dirname($cachePath);
if (!is_dir($dir)) @mkdir($dir, 0775, true);
@file_put_contents($cachePath, json_encode($out));

respondOk($out);
