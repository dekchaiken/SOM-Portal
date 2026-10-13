<?php
/**
 * GET /api/downstream-health/breakdown.php?service=<name>&range=<15m|1h|3h|6h|24h>
 *
 * For a given service, return the outbound (downstream) error breakdown
 * grouped by (endpoint, status). Endpoint = whichever label the metric
 * uses: `path` (Truemoney true-gateway) or `uri` (vanilla Micrometer).
 *
 * SM-only. Caches per (service, range) at DH_CACHE_TTL — hot page during
 * incidents, don't slam Thanos.
 */
require_once __DIR__ . '/_lib.php';

ini_set('memory_limit', '256M');
set_time_limit(60);

$payload = requireAuth();
requireSmTeamOnly('Downstream Health');
if ($_SERVER['REQUEST_METHOD'] !== 'GET') respondError('Method not allowed', 405);

$service = trim((string)($_GET['service'] ?? ''));
if ($service === '' || !preg_match('/^[a-zA-Z0-9._-]+$/', $service)) {
    respondError('service is required', 400);
}
// Absolute range mode (SP2 Custom picker): ?start=<unix>&end=<unix>.
// Falls back to relative ?range=1h when either is missing/invalid.
$startTs = (int)($_GET['start'] ?? 0);
$endTs   = (int)($_GET['end']   ?? 0);
$usingAbs = ($startTs > 0 && $endTs > $startTs);
if ($usingAbs) {
    $rangeSec = $endTs - $startTs;
    // Snap PromQL range string to a human unit so `[range]` in the increase()
    // is legal (Prometheus doesn't accept fractional units in query syntax).
    $promRange = ($rangeSec % 3600 === 0) ? ($rangeSec/3600) . 'h'
              : (($rangeSec % 60 === 0)   ? ($rangeSec/60)   . 'm'
                                          : $rangeSec . 's');
    $evalTime = $endTs;
} else {
    [$rangeSec, $promRange] = dhParseRange((string)($_GET['range'] ?? '1h'));
    $evalTime = 0;
}

// Absolute-range queries carry the window in the cache key so historical
// snapshots don't overwrite each other (or the live view).
$cacheKey = $usingAbs
    ? "breakdown_{$service}_abs_{$startTs}_{$endTs}"
    : "breakdown_{$service}_{$promRange}";
if ($c = dhReadCache($cacheKey, DH_CACHE_TTL)) respondOk($c);

// Reuse begin-grafana's source detection: probes every source with the
// service's app label to find where its metrics live + which cluster.
[$src, $cluster, $appLabel, $probes] = bgDetectSource($service);
if (!$src) {
    respondOk([
        'service' => $service,
        'range'   => $promRange,
        'found'   => false,
        'reason'  => 'no source emits http_server / http_client metrics for this service',
        'probes'  => $probes,
    ]);
}
$jvmSrc = $src;
$jvmSrc['dsUid'] = (string)$src['jvmDsUid'];

$data = dhBreakdown($jvmSrc, $service, $appLabel, $cluster, $promRange, $evalTime);

$payload = [
    'service'   => $service,
    'range'     => $promRange,
    'rangeSec'  => $rangeSec,
    'startTime' => $usingAbs ? $startTs : null,
    'endTime'   => $usingAbs ? $endTs   : null,
    'found'     => !empty($data['found']),
    'source'    => [
        'slug'    => (string)($src['slug'] ?? ''),
        'name'    => (string)($src['name'] ?? ''),
        'cluster' => $cluster,
        'appLabel'=> $appLabel,
    ],
    'endpoints' => $data['endpoints'] ?? [],
    'rows'      => $data['rows']      ?? [],
    'error'     => $data['error']     ?? null,
    'fetchedAt' => date('c'),
];
dhWriteCache($cacheKey, $payload);
respondOk($payload);
