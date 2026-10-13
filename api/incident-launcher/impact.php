<?php
/**
 * Comprehensive Incident Impact Analyzer
 *
 * Queries 4 layers of Prometheus metrics to determine full business impact:
 *   Layer 1 — Infrastructure : pod restarts / crashloop
 *   Layer 2 — HTTP errors    : 5xx / 408 per service + URI breakdown
 *   Layer 3 — Performance    : latency spikes vs baseline
 *   Layer 4 — Business       : bank errors, wallet load, VAS/SPI, topup
 *
 * Results are mapped to business service names via data/sm/impact-service-map.json.
 * Unknown services (not in map) are still reported so nothing is missed.
 */

require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/../service-performance/_lib.php';

$payload = requireAuth();
requireRole($payload, ALL_STAFF_ROLES);
if (($payload['team'] ?? '') !== 'sm') respondError('SM team only', 403);
if ($_SERVER['REQUEST_METHOD'] !== 'GET') respondError('Method not allowed', 405);

$from = trim($_GET['from'] ?? '');
$to   = trim($_GET['to']   ?? '');
if (!$from) respondError('from required (ISO datetime)', 400);

$fromTs   = (int)strtotime($from);
$toTs     = $to ? (int)strtotime($to) : time();
$rangeSec = max(120, $toTs - $fromTs);
$r        = $rangeSec; // alias for query strings

// ── Load configs ──────────────────────────────────────────────────────────────
$cfg     = spLoadConfig();
$sources = array_values(array_filter(
    $cfg['sources'] ?? [],
    fn($s) => ($s['enabled'] ?? true) !== false && !empty($s['grafanaUrl']) && !empty($s['dsUid'])
));
if (!$sources) respondError('No enabled Prometheus sources — check service-performance-sources.json', 500);

$svcMap = readJson('impact-service-map.json') ?: [];
$bizMap     = $svcMap['service_map']  ?? [];  // app_name  → {business_services, category, is_gateway}
$bankMap    = $svcMap['bank_map']     ?? [];  // bankCode  → readable name
$nsFilter   = implode('|', $svcMap['prod_namespaces'] ?? ['truemoney.*', 'acm.*', 'truemoney-.*']);
$thresholds = array_merge([
    'restart_min'        => 1,     // minimum restarts to report
    'http_5xx_min'       => 1,     // minimum 5xx count to report
    'latency_spike_ratio'=> 3.0,   // peak/baseline ratio to flag
    'bank_error_min'     => 5,     // minimum bank errors to report
], $svcMap['thresholds'] ?? []);

// ── Helper: build Grafana Explore URL ────────────────────────────────────────
function makeExploreUrl(string $grafanaUrl, int $orgId, string $dsUid, string|array $expr, int $fromTs, int $toTs): string {
    $exprs = is_array($expr) ? $expr : [['expr' => $expr, 'legend' => '__auto']];
    $queries = array_map(fn($q, $i) => [
        'refId'        => chr(65 + $i),
        'datasource'   => ['type' => 'prometheus', 'uid' => $dsUid],
        'expr'         => $q['expr'],
        'range'        => true,
        'instant'      => false,
        'editorMode'   => 'code',
        'legendFormat' => $q['legend'] ?? '__auto',
    ], $exprs, array_keys($exprs));
    $left = json_encode([
        'datasource' => $dsUid,
        'queries'    => $queries,
        'range'      => ['from' => (string)($fromTs * 1000), 'to' => (string)($toTs * 1000)],
    ]);
    return "{$grafanaUrl}/explore?orgId={$orgId}&left=" . rawurlencode($left);
}

// ── Helper: derive service name from pod name ─────────────────────────────────
function podToService(string $pod): string {
    $s = preg_replace('/-[a-z0-9]{5,10}-[a-z0-9]{4,5}$/', '', $pod); // rs+random
    $s = preg_replace('/-[0-9]+$/', '', $s);                           // statefulset index
    return $s;
}

// ── Helper: severity scoring ──────────────────────────────────────────────────
function scoreSeverity(float $errorCount, bool $isGateway = false): string {
    if ($isGateway || $errorCount >= 1000) return 'critical';
    if ($errorCount >= 100)  return 'high';
    if ($errorCount >= 10)   return 'medium';
    return 'low';
}

// ── Collect results per layer across all sources ──────────────────────────────
$infraLayer    = []; // pod restarts
$httpLayer     = []; // 5xx per service
$httpUriLayer  = []; // 5xx per service+uri
$perfLayer     = []; // latency spikes
$bankLayer     = []; // bank_service failures
$walletLayer   = []; // wallet-payment-service failures
$vasLayer      = []; // vas-service / mobile-topup failures
$bizCountLayer = []; // business-level counter metrics

foreach ($sources as $src) {
    $grafanaUrl = rtrim((string)($src['grafanaUrl'] ?? ''), '/');
    $dsUid      = (string)($src['dsUid']      ?? '');
    $jvmDsUid   = (string)($src['jvmDsUid']   ?? $dsUid);
    $orgId      = (int)($src['orgId']          ?? 1);
    $slug       = (string)($src['slug']        ?? '');
    if (!$grafanaUrl || !$dsUid) continue;

    // ── Build all PromQL queries for this source ──────────────────────────
    $queries = [

        // Layer 1: Infrastructure
        'restarts' =>
            "topk(30, sum by (namespace,pod)(increase(kube_pod_container_status_restarts_total"
            . "{namespace=~\"{$nsFilter}\",container!=\"\"}[{$r}s])) > 0)",

        // Layer 2a: HTTP 5xx per service (all clusters)
        'http_5xx' =>
            "topk(30, sum by (app_name)(increase(http_server_requests_seconds_count"
            . "{status=~\"5..\",cluster=~\".*th.*\"}[{$r}s])) > 0)",

        // Layer 2b: HTTP 408 timeouts per service
        'http_408' =>
            "topk(20, sum by (app_name)(increase(http_server_requests_seconds_count"
            . "{status=\"408\",cluster=~\".*th.*\"}[{$r}s])) > 0)",

        // Layer 2c: 5xx breakdown per service + URI (top 40)
        'http_5xx_uri' =>
            "topk(40, sum by (app_name,uri)(increase(http_server_requests_seconds_count"
            . "{status=~\"5..\",cluster=~\".*th.*\"}[{$r}s])) > 0)",

        // Layer 2d: Total requests per service (for error rate %)
        'http_total' =>
            "topk(30, sum by (app_name)(increase(http_server_requests_seconds_count"
            . "{cluster=~\".*th.*\"}[{$r}s])) > 0)",

        // Layer 3: Latency peak during window
        'latency_peak' =>
            "topk(25, max_over_time((sum by (app_name)(rate(http_server_requests_seconds_sum"
            . "{cluster=~\".*th.*\"}[5m])) / sum by (app_name)(rate(http_server_requests_seconds_count"
            . "{cluster=~\".*th.*\"}[5m])))[{$r}s:5m]))",

        // Layer 3b: Current latency baseline (now)
        'latency_now' =>
            "sum by (app_name)(rate(http_server_requests_seconds_sum{cluster=~\".*th.*\"}[5m]))"
            . " / sum by (app_name)(rate(http_server_requests_seconds_count{cluster=~\".*th.*\"}[5m]))",

        // Layer 4a: Bank service errors by bankCode
        'bank_errors' =>
            "topk(15, sum by (bankCode)(increase(bank_service_transaction_total"
            . "{responseCode!~\"0\",cluster=~\".*th.*\"}[{$r}s])) > 0)",

        // Layer 4b: Wallet payment failures per URI
        'wallet_5xx' =>
            "sum by (uri,status)(increase(http_server_requests_seconds_count"
            . "{app_name=\"wallet-payment-service\",status=~\"[45]..\",cluster=~\".*th.*\"}[{$r}s]))",

        // Layer 4c: VAS SPI failures
        'vas_5xx' =>
            "sum by (uri,status)(increase(http_server_requests_seconds_count"
            . "{app_name=\"vas-service\",status=~\"5..\",cluster=~\".*th.*\"}[{$r}s])) > 0",

        // Layer 4d: DTAC + mobile-topup failures (4xx/5xx/408)
        'topup_errors' =>
            "sum by (app_name,uri,status)(increase(http_server_requests_seconds_count"
            . "{app_name=~\"dtac-gateway|mobile-topup\",status=~\"[45]..\",cluster=~\".*th.*\"}[{$r}s])) > 0",

        // Layer 4e: Alipay/merchant gateway errors
        'alipay_5xx' =>
            "sum by (app_name,uri,status)(increase(http_server_requests_seconds_count"
            . "{app_name=~\"acm-unified-alipay-gateway|acm-bbl-gateway|acm-kk-gateway\",status=~\"[45]..\",cluster=~\".*th.*\"}[{$r}s])) > 0",
    ];

    try {
        $res = spQueryPromQL($src, $queries, $toTs);
    } catch (Throwable $e) {
        continue; // skip this source if Prometheus unreachable
    }

    // ── Process Layer 1: Pod restarts ────────────────────────────────────
    foreach ((array)($res['restarts'] ?? []) as $item) {
        $pod  = $item['metric']['pod']       ?? '';
        $ns   = $item['metric']['namespace'] ?? '';
        $cnt  = (float)($item['value'][1]    ?? 0);
        if ($cnt < $thresholds['restart_min'] || !$pod) continue;

        $svc = podToService($pod);
        $key = "{$svc}|{$ns}";
        if (!isset($infraLayer[$key])) {
            $infraLayer[$key] = [
                'service'    => $svc,
                'namespace'  => $ns,
                'runway'     => $slug,
                'restarts'   => 0.0,
                'pods'       => [],
                'exploreUrl' => makeExploreUrl($grafanaUrl, $orgId, $dsUid,
                    "sum by (pod)(increase(kube_pod_container_status_restarts_total"
                    . "{namespace=\"{$ns}\",pod=~\"{$svc}-.*\"}[{$r}s]))",
                    $fromTs, $toTs),
            ];
        }
        $infraLayer[$key]['restarts'] += $cnt;
        $infraLayer[$key]['pods'][]    = ['pod' => $pod, 'restarts' => round($cnt, 1)];
    }

    // ── Process Layer 2a+b: HTTP errors per service ───────────────────────
    $httpTotals = [];
    foreach ((array)($res['http_total'] ?? []) as $item) {
        $app  = $item['metric']['app_name'] ?? '';
        $cnt  = (float)($item['value'][1]  ?? 0);
        if ($app) $httpTotals[$app] = $cnt;
    }
    $http408 = [];
    foreach ((array)($res['http_408'] ?? []) as $item) {
        $app = $item['metric']['app_name'] ?? '';
        $cnt = (float)($item['value'][1]  ?? 0);
        if ($app && $cnt > 0) $http408[$app] = $cnt;
    }
    foreach ((array)($res['http_5xx'] ?? []) as $item) {
        $app  = $item['metric']['app_name'] ?? '';
        $cnt  = (float)($item['value'][1]  ?? 0);
        if ($cnt < $thresholds['http_5xx_min'] || !$app) continue;
        $total    = $httpTotals[$app] ?? 0;
        $errPct   = $total > 0 ? round(($cnt / $total) * 100, 1) : null;
        $timeout  = $http408[$app] ?? 0;
        if (!isset($httpLayer[$app])) {
            $httpLayer[$app] = [
                'app_name'   => $app,
                'http_5xx'   => 0.0,
                'http_408'   => 0.0,
                'error_pct'  => $errPct,
                'top_uris'   => [],
                'runway'     => $slug,
                'exploreUrl' => makeExploreUrl($grafanaUrl, $orgId, $dsUid, [
                    ['expr'   => "sum by (status)(rate(http_server_requests_seconds_count{app_name=\"{$app}\",cluster=~\".*th.*\"}[5m]))",
                     'legend' => '{{status}}'],
                    ['expr'   => "sum(rate(http_server_requests_seconds_sum{app_name=\"{$app}\",cluster=~\".*th.*\"}[5m])) / sum(rate(http_server_requests_seconds_count{app_name=\"{$app}\",cluster=~\".*th.*\"}[5m]))",
                     'legend' => 'avg latency'],
                ], $fromTs, $toTs),
            ];
        }
        $httpLayer[$app]['http_5xx'] += $cnt;
        $httpLayer[$app]['http_408'] += $timeout;
    }

    // ── Process Layer 2c: 5xx per URI ────────────────────────────────────
    foreach ((array)($res['http_5xx_uri'] ?? []) as $item) {
        $app = $item['metric']['app_name'] ?? '';
        $uri = $item['metric']['uri']      ?? '';
        $cnt = (float)($item['value'][1]  ?? 0);
        if ($cnt < 1 || !$app || !$uri) continue;
        if (!isset($httpUriLayer[$app])) $httpUriLayer[$app] = [];
        $httpUriLayer[$app][] = ['uri' => $uri, 'count' => round($cnt, 1)];
    }
    // Sort URIs by error count desc, keep top 5
    foreach ($httpUriLayer as $app => &$uris) {
        usort($uris, fn($a, $b) => $b['count'] <=> $a['count']);
        $uris = array_slice($uris, 0, 5);
    }
    unset($uris);

    // ── Process Layer 3: Latency spike ───────────────────────────────────
    $baselineMap = [];
    foreach ((array)($res['latency_now'] ?? []) as $item) {
        $app = $item['metric']['app_name'] ?? '';
        $val = (float)($item['value'][1]  ?? 0);
        if ($app && $val > 0) $baselineMap[$app] = $val;
    }
    foreach ((array)($res['latency_peak'] ?? []) as $item) {
        $app  = $item['metric']['app_name'] ?? '';
        $peak = (float)($item['value'][1]  ?? 0);
        if (!$app || $peak <= 0) continue;
        $baseline = $baselineMap[$app] ?? 0;
        $ratio    = ($baseline > 0.001) ? round($peak / $baseline, 1) : null;
        if ($ratio && $ratio < $thresholds['latency_spike_ratio']) continue;
        $perfLayer[$app] = [
            'app_name'    => $app,
            'peak_ms'     => round($peak * 1000, 0),
            'baseline_ms' => $baseline > 0 ? round($baseline * 1000, 0) : null,
            'ratio'       => $ratio,
            'exploreUrl'  => makeExploreUrl($grafanaUrl, $orgId, $dsUid,
                "sum(rate(http_server_requests_seconds_sum{app_name=\"{$app}\",cluster=~\".*th.*\"}[5m]))"
                . " / sum(rate(http_server_requests_seconds_count{app_name=\"{$app}\",cluster=~\".*th.*\"}[5m]))",
                $fromTs, $toTs),
        ];
    }

    // ── Process Layer 4a: Bank errors ────────────────────────────────────
    foreach ((array)($res['bank_errors'] ?? []) as $item) {
        $bank = $item['metric']['bankCode'] ?? '';
        $cnt  = (float)($item['value'][1]  ?? 0);
        if ($cnt < $thresholds['bank_error_min'] || !$bank) continue;
        $bankLayer[$bank] = [
            'bankCode'   => $bank,
            'bankName'   => $bankMap[$bank] ?? $bank,
            'errors'     => round($cnt, 0),
            'exploreUrl' => makeExploreUrl($grafanaUrl, $orgId, $dsUid, [
                ['expr' => "sum by (responseCode)(rate(bank_service_transaction_total{bankCode=\"{$bank}\",cluster=~\".*th.*\"}[5m]))",
                 'legend' => '{{responseCode}}'],
            ], $fromTs, $toTs),
        ];
    }

    // ── Process Layer 4b-e: Business service failures ────────────────────
    foreach (['wallet_5xx', 'vas_5xx', 'topup_errors', 'alipay_5xx'] as $qKey) {
        foreach ((array)($res[$qKey] ?? []) as $item) {
            $app    = $item['metric']['app_name'] ?? '';
            $uri    = $item['metric']['uri']      ?? '';
            $status = $item['metric']['status']   ?? '';
            $cnt    = (float)($item['value'][1]   ?? 0);
            if ($cnt < 1) continue;
            $key = "{$app}|{$uri}|{$status}";
            $vasLayer[$key] = [
                'app_name'   => $app,
                'uri'        => $uri,
                'status'     => $status,
                'errors'     => round($cnt, 1),
                'exploreUrl' => makeExploreUrl($grafanaUrl, $orgId, $dsUid, [
                    ['expr' => "sum by (status,uri)(rate(http_server_requests_seconds_count{app_name=\"{$app}\",cluster=~\".*th.*\"}[5m]))",
                     'legend' => '{{status}} {{uri}}'],
                ], $fromTs, $toTs),
            ];
        }
    }
}

// ── Attach URI breakdowns to httpLayer ───────────────────────────────────────
foreach ($httpUriLayer as $app => $uris) {
    if (isset($httpLayer[$app])) $httpLayer[$app]['top_uris'] = $uris;
}

// ── Sort layers by severity ───────────────────────────────────────────────────
usort($infraLayer,  fn($a,$b) => $b['restarts'] <=> $a['restarts']);
usort($httpLayer,   fn($a,$b) => $b['http_5xx']  <=> $a['http_5xx']);
usort($bankLayer,   fn($a,$b) => $b['errors']    <=> $a['errors']);
usort($vasLayer,    fn($a,$b) => $b['errors']    <=> $a['errors']);
usort($perfLayer,   fn($a,$b) => ($b['ratio']??0) <=> ($a['ratio']??0));

// ── Business service mapping ──────────────────────────────────────────────────
// Walk every impacted app_name and annotate with business service names
function mapBusiness(string $appName, array $bizMap): array {
    $entry = $bizMap[$appName] ?? null;
    if (!$entry) {
        // Fuzzy match: check if any key is a substring
        foreach ($bizMap as $pattern => $info) {
            if (str_contains($appName, $pattern) || str_contains($pattern, $appName)) {
                $entry = $info; break;
            }
        }
    }
    return $entry ?? [];
}

$impactedApps  = array_unique(array_merge(
    array_column(array_values($infraLayer), 'service'),
    array_keys($httpLayer),
    array_keys($perfLayer),
    array_column(array_values($vasLayer), 'app_name'),
));
$knownBizImpact   = []; // category → [business_service]
$unknownApps      = []; // not in bizMap
foreach ($impactedApps as $app) {
    $entry = mapBusiness($app, $bizMap);
    if (empty($entry)) { $unknownApps[] = $app; continue; }
    $cat = $entry['category'] ?? 'Other';
    foreach ((array)($entry['business_services'] ?? []) as $biz) {
        $knownBizImpact[$cat][$biz] = true;
    }
    // Gateway flag: mark all features as potentially affected
    if (!empty($entry['is_gateway'])) {
        $knownBizImpact[$cat]['⚠️ All features via this gateway'] = true;
    }
}
// Flatten
$bizImpactList = [];
foreach ($knownBizImpact as $cat => $svcs) {
    $bizImpactList[] = ['category' => $cat, 'services' => array_keys($svcs)];
}

// ── Overall severity ─────────────────────────────────────────────────────────
$total5xx      = array_sum(array_column(array_values($httpLayer), 'http_5xx'));
$totalRestarts = array_sum(array_column(array_values($infraLayer), 'restarts'));
$totalBankErr  = array_sum(array_column(array_values($bankLayer), 'errors'));
$overallSev    = 'low';
if ($totalBankErr > 500 || $total5xx > 500 || !empty(array_filter($impactedApps, fn($a) => ($bizMap[$a]['is_gateway'] ?? false))))
    $overallSev = 'critical';
elseif ($total5xx > 100 || $totalBankErr > 50)
    $overallSev = 'high';
elseif ($total5xx > 10 || $totalRestarts > 3)
    $overallSev = 'medium';

// ── Respond ───────────────────────────────────────────────────────────────────
respond([
    'from'           => $from,
    'to'             => $to ?: date('c'),
    'range_seconds'  => $rangeSec,
    'severity'       => $overallSev,
    'summary' => [
        'total_http_5xx'   => round($total5xx),
        'total_restarts'   => round($totalRestarts),
        'total_bank_errors'=> round($totalBankErr),
        'services_count'   => count($httpLayer),
        'banks_count'      => count($bankLayer),
        'unknown_apps'     => count($unknownApps),
    ],
    'layers' => [
        'infrastructure' => array_values($infraLayer),
        'http_errors'    => array_values($httpLayer),
        'performance'    => array_values($perfLayer),
        'banking'        => array_values($bankLayer),
        'business_ops'   => array_values($vasLayer),
    ],
    'business_impact' => $bizImpactList,
    'unknown_apps'    => $unknownApps,
    'source_count'    => count($sources),
]);
