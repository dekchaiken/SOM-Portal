<?php
/**
 * GET /api/begin-grafana/promql.php
 *   ?service=<name>&method=<M>&uri=<U>[&cluster=<clu>]
 *
 * Emit ready-to-paste PromQL query strings for one endpoint + a Grafana
 * Explore deeplink. SM-only. Does NOT hit Grafana — pure builder + fetch
 * of the source's grafanaUrl/dsUid for the deeplink.
 */
require_once __DIR__ . '/_lib.php';

$payload = requireAuth();
requireSmTeamOnly('Begin Grafana');
if ($_SERVER['REQUEST_METHOD'] !== 'GET') respondError('Method not allowed', 405);

$service     = trim((string)($_GET['service'] ?? ''));
$method      = trim((string)($_GET['method']  ?? ''));
$uri         = trim((string)($_GET['uri']     ?? ''));
$wantCluster = trim((string)($_GET['cluster'] ?? ''));

if ($service === '' || !preg_match('/^[a-z0-9._-]+$/i', $service)) respondError('service is required', 400);
if ($method === '' || !preg_match('/^[A-Z]+$/', $method))          respondError('method is required (uppercase)', 400);
if ($uri === '')                                                    respondError('uri is required', 400);

[$src, $cluster, $appLabel, ] = bgDetectSource($service);
if ($wantCluster !== '') $cluster = $wantCluster;

$queries = bgPromqlSnippets($service, $cluster ?? '', $method, $uri, $appLabel ?? 'app_name');

$grafanaUrl = '';
$dsUid = '';
$orgId = 0;
if ($src) {
    $grafanaUrl = rtrim((string)($src['grafanaUrl'] ?? ''), '/');
    $dsUid = (string)($src['jvmDsUid'] ?? '');
    $orgId = (int)($src['orgId'] ?? 0);
}

// Grafana Explore URL — format that works on the SP2 dashboard already.
$explore = null;
if ($grafanaUrl !== '' && $dsUid !== '') {
    $paneKey = 'bg' . substr(bin2hex(random_bytes(2)), 0, 4);
    $pane = [
        $paneKey => [
            'datasource' => $dsUid,
            'queries' => array_map(fn($k, $q) => [
                'refId' => strtoupper(substr($k, 0, 3)),
                'datasource' => ['type' => 'prometheus', 'uid' => $dsUid],
                'expr'  => $q,
            ], array_keys($queries), array_values($queries)),
            'range' => ['from' => 'now-1h', 'to' => 'now'],
        ],
    ];
    $params = [
        'schemaVersion' => 1,
        'panes'         => json_encode($pane, JSON_UNESCAPED_SLASHES),
        'orgId'         => $orgId,
    ];
    $explore = $grafanaUrl . '/explore?' . http_build_query($params);
}

respondOk([
    'service'  => $service,
    'method'   => $method,
    'uri'      => $uri,
    'runway'   => $src ? ['slug' => (string)($src['slug'] ?? ''), 'cluster' => (string)$cluster] : null,
    'queries'  => $queries,
    'grafanaExploreUrl' => $explore,
]);
