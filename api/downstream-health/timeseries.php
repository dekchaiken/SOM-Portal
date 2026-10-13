<?php
/**
 * GET /api/downstream-health/timeseries.php?service=<name>&endpoint=<path>&range=<1h|...>
 *
 * Time-series for one (service, endpoint) — grouped by status. Used by
 * the frontend to render a per-status stacked-area chart when a row is
 * expanded in the breakdown table.
 *
 * SM-only. Same cache TTL as breakdown.
 */
require_once __DIR__ . '/_lib.php';

ini_set('memory_limit', '256M');
set_time_limit(60);

$payload = requireAuth();
requireSmTeamOnly('Downstream Health');
if ($_SERVER['REQUEST_METHOD'] !== 'GET') respondError('Method not allowed', 405);

$service = trim((string)($_GET['service']  ?? ''));
$endpoint= trim((string)($_GET['endpoint'] ?? ''));
if ($service === ''  || !preg_match('/^[a-zA-Z0-9._-]+$/', $service)) respondError('service is required', 400);
if ($endpoint === '') respondError('endpoint is required', 400);

$startTs = (int)($_GET['start'] ?? 0);
$endTs   = (int)($_GET['end']   ?? 0);
$usingAbs = ($startTs > 0 && $endTs > $startTs);
if ($usingAbs) {
    $rangeSec = $endTs - $startTs;
    $promRange = ($rangeSec % 3600 === 0) ? ($rangeSec/3600) . 'h'
              : (($rangeSec % 60 === 0)   ? ($rangeSec/60)   . 'm'
                                          : $rangeSec . 's');
} else {
    [$rangeSec, $promRange] = dhParseRange((string)($_GET['range'] ?? '1h'));
}

$cacheKey = $usingAbs
    ? "ts_{$service}_" . substr(md5($endpoint), 0, 12) . "_abs_{$startTs}_{$endTs}"
    : "ts_{$service}_" . substr(md5($endpoint), 0, 12) . "_{$promRange}";
if ($c = dhReadCache($cacheKey, DH_CACHE_TTL)) respondOk($c);

[$src, $cluster, $appLabel, ] = bgDetectSource($service);
if (!$src) respondError('no source for service', 404);
$jvmSrc = $src;
$jvmSrc['dsUid'] = (string)$src['jvmDsUid'];

$data = dhTimeseries($jvmSrc, $service, $appLabel, $cluster, $endpoint, $rangeSec, $usingAbs ? $startTs : 0, $usingAbs ? $endTs : 0);
$payload = [
    'service'  => $service,
    'endpoint' => $endpoint,
    'range'    => $promRange,
    'rangeSec' => $rangeSec,
    'startTime'=> $usingAbs ? $startTs : null,
    'endTime'  => $usingAbs ? $endTs   : null,
    'series'   => $data['series'] ?? [],
    'start'    => $data['start']  ?? 0,
    'end'      => $data['end']    ?? 0,
    'step'     => $data['step']   ?? 0,
    'error'    => $data['error']  ?? null,
    'fetchedAt'=> date('c'),
];
dhWriteCache($cacheKey, $payload);
respondOk($payload);
