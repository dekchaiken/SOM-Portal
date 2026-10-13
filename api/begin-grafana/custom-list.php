<?php
/**
 * GET /api/begin-grafana/custom-list.php?service=<name>
 *
 * Discover custom "*_total" business-counter metrics whose name starts
 * with the service prefix (dashes → underscores). Returns queries in the
 * "success (200-*) / fail (non-200) grouped by (service, status_code)"
 * shape the SOM team's Grafana panels use.
 */
require_once __DIR__ . '/_lib.php';

$payload = requireAuth();
requireSmTeamOnly('Begin Grafana');
if ($_SERVER['REQUEST_METHOD'] !== 'GET') respondError('Method not allowed', 405);

$service = trim((string)($_GET['service'] ?? ''));
if ($service === '' || !preg_match('/^[a-z0-9._-]+$/i', $service)) {
    respondError('service is required', 400);
}

$cacheKey = "custom_list_{$service}";
if ($c = bgReadCache($cacheKey, BG_CACHE_TTL)) respondOk($c);

[$src, $cluster, $appLabel, ] = bgDetectSource($service);
if (!$src) {
    respondOk([
        'service' => $service,
        'found'   => false,
        'metrics' => [],
        'reason'  => 'no matching source (JVM datasource) for this service',
    ]);
}

$jvmSrc = $src;
$jvmSrc['dsUid'] = (string)$src['jvmDsUid'];

$metrics = bgDiscoverCustomMetrics($jvmSrc, $service, $appLabel, $cluster);
$prefix  = bgMetricPrefix($service);
$baseSel = bgSelector($service, $cluster, $appLabel);

// Build per-metric PromQL snippets + Grafana Explore deeplink.
$grafanaUrl = rtrim((string)($src['grafanaUrl'] ?? ''), '/');
$dsUid      = (string)($src['jvmDsUid'] ?? '');
$orgId      = (int)($src['orgId'] ?? 0);

$rows = [];
foreach ($metrics as $m) {
    // Use the per-metric narrowing selector — some counters DON'T carry
    // app_name, so applying it would return zero. narrowSel='' means the
    // counter is presumed unique enough by name alone.
    $mSel = (string)($m['narrowSel'] ?? '');
    $queries = bgCustomQueries($m['name'], (bool)$m['hasService'], (bool)$m['hasStatusCode'], $mSel);
    // Grafana Explore deeplink with success + fail as two panels
    $explore = null;
    if ($grafanaUrl !== '' && $dsUid !== '') {
        $paneKey = 'bg' . substr(bin2hex(random_bytes(2)), 0, 4);
        $qs = [];
        foreach ($queries as $k => $q) {
            $qs[] = [
                'refId' => strtoupper(substr($k, 0, 3)),
                'datasource' => ['type' => 'prometheus', 'uid' => $dsUid],
                'expr' => $q,
            ];
        }
        $pane = [ $paneKey => [
            'datasource' => $dsUid,
            'queries' => $qs,
            'range'   => ['from' => 'now-1h', 'to' => 'now'],
        ]];
        $explore = $grafanaUrl . '/explore?' . http_build_query([
            'schemaVersion' => 1,
            'panes'         => json_encode($pane, JSON_UNESCAPED_SLASHES),
            'orgId'         => $orgId,
        ]);
    }

    $rows[] = [
        'name'         => $m['name'],
        'hasService'   => (bool)$m['hasService'],
        'hasStatusCode'=> (bool)$m['hasStatusCode'],
        'narrowSel'    => $mSel,
        'sampleLabels' => $m['sampleLabels'],
        'queries'      => $queries,
        'grafanaExploreUrl' => $explore,
    ];
}

$out = [
    'service'   => $service,
    'found'     => !empty($rows),
    'prefix'    => $prefix,
    'appLabel'  => $appLabel,
    'runway'    => ['slug' => (string)($src['slug'] ?? ''), 'cluster' => $cluster],
    'metricCount' => count($rows),
    'metrics'   => $rows,
    'fetchedAt' => date('c'),
    'fromCache' => false,
];
bgWriteCache($cacheKey, $out);
respondOk($out);
