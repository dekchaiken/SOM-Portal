#!/usr/bin/env php
<?php
ini_set('memory_limit', '512M');
/**
 * cron/restart-monitor-fetch.php
 *
 * Fetches pod-restart data from Prometheus via Grafana API for a given runway,
 * builds a raw (no AI) daily snapshot, and writes it to
 * data/grafana-monitoring/raw/{slug}/YYYY-MM-DD.json.
 *
 * Usage:
 *   RUNWAY="EKS TMN"  ANCHOR_TS=$(...) php cron/restart-monitor-fetch.php
 *   RUNWAY="EKS NANO" ANCHOR_TS=$(...) php cron/restart-monitor-fetch.php
 *
 * If RUNWAY is omitted, defaults to "EKS TMN" (backward-compat with old scripts).
 *
 * Runway config: data/grafana-runways.json (grafanaUrl, tokenEnv, orgId,
 * dsUid, cluster, namespaceRegex, namespaceExclude, podExclude).
 */

define('SCRIPT_START', microtime(true));

require_once __DIR__ . '/../api/config.php';
require_once __DIR__ . '/../api/service-severity/_lookup.php';

// ── Load runway config ────────────────────────────────────────────────────
$wantRunway = getenv('RUNWAY') ?: 'EKS TMN';
$runwaysFile = DATA_DIR . 'grafana-runways.json';
if (!file_exists($runwaysFile)) {
    fwrite(STDERR, "[ERROR] grafana-runways.json not found at {$runwaysFile}\n");
    exit(1);
}
$runwayCfg = null;
$allRunways = json_decode(file_get_contents($runwaysFile), true) ?: [];
foreach ($allRunways['runways'] ?? [] as $rw) {
    if (($rw['name'] ?? '') === $wantRunway) { $runwayCfg = $rw; break; }
}
if (!$runwayCfg) {
    fwrite(STDERR, "[ERROR] runway '{$wantRunway}' not found in grafana-runways.json\n");
    exit(1);
}

$runwayName  = $runwayCfg['name'];
$runwaySlug  = $runwayCfg['slug'];
$grafanaUrl  = rtrim($runwayCfg['grafanaUrl'], '/');
$grafanaTok  = getenv($runwayCfg['tokenEnv'] ?? '') ?: '';
$orgId       = (string)($runwayCfg['orgId'] ?? '');
$dsUid       = $runwayCfg['dsUid'] ?? '';
$cluster     = $runwayCfg['cluster'] ?? '';
$nsRegex     = $runwayCfg['namespaceRegex']   ?? '.+';
$nsExclude   = $runwayCfg['namespaceExclude'] ?? '';
$podExclude  = $runwayCfg['podExclude']       ?? '';

if (!$grafanaTok) {
    fwrite(STDERR, "[ERROR] {$runwayCfg['tokenEnv']} not set in .env — aborting.\n");
    exit(1);
}

$tz        = new DateTimeZone('Asia/Bangkok');
$anchorEnv = getenv('ANCHOR_TS');
$now       = $anchorEnv ? (new DateTime('@' . (int)$anchorEnv))->setTimezone($tz)
                        : new DateTime('now', $tz);
$dateStr   = $now->format('Y-m-d');
$nowTs     = $now->getTimestamp();

echo '[' . date('Y-m-d H:i:s') . "] Starting restart-monitor raw fetch — runway={$runwayName} date={$dateStr}\n";
echo "  Grafana={$grafanaUrl}  cluster={$cluster}  ns=~{$nsRegex}\n";

// Build label selectors — cluster is optional (some runways like OCP run on
// single-cluster Prometheus and don't have a `cluster` label)
$parts = [];
if ($cluster !== '') $parts[] = "cluster=\"{$cluster}\"";
$parts[] = "namespace=~\"{$nsRegex}\"";
if ($nsExclude)  $parts[] = "namespace!~\"{$nsExclude}\"";
if ($podExclude) $parts[] = "pod!~\"{$podExclude}\"";
$baseSelector   = implode(',', $parts);
$baseSelectorKs = $baseSelector . ',job="kubernetes-state"';

// ── Prometheus instant query via Grafana datasource proxy ─────────────────
function promQuery(string $url, string $token, string $orgId, string $dsUid, string $query, int $ts): array {
    $endpoint = $url . '/api/datasources/proxy/uid/' . $dsUid . '/api/v1/query';
    $ch = curl_init($endpoint);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => http_build_query(['query' => $query, 'time' => $ts]),
        CURLOPT_HTTPHEADER     => [
            'Authorization: Bearer ' . $token,
            'X-Grafana-Org-Id: '     . $orgId,
            'Content-Type: application/x-www-form-urlencoded',
        ],
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_SSL_VERIFYPEER => false,
    ]);
    $body = curl_exec($ch);
    $err  = curl_error($ch);
    curl_close($ch);

    if ($err) { echo "  [WARN] curl: {$err}\n"; return []; }
    $d = json_decode($body, true);
    if (($d['status'] ?? '') !== 'success') {
        echo '  [WARN] Prometheus: ' . ($d['error'] ?? substr((string)$body, 0, 200)) . "\n";
        return [];
    }
    return $d['data']['result'] ?? [];
}

function mk(array $m): string {
    return ($m['pod'] ?? '') . '|' . ($m['container'] ?? '') . '|' . ($m['namespace'] ?? '');
}

// ── 7 Prometheus queries (with retry) ──────────────────────────────────────
// Thanos/Prometheus occasionally returns all-empty for a single runway on a
// transient blip (seen on EKS NANO 2026-07-04/07-08/07-10 while EKS TMN in the
// same run succeeded). Retry the full set of 7 queries a couple of times
// before giving up, rather than aborting on the first empty response.
$pq = fn($q) => promQuery($grafanaUrl, $grafanaTok, $orgId, $dsUid, $q, $nowTs);

$maxAttempts = 3;
$totalSeries = 0;
for ($attempt = 1; $attempt <= $maxAttempts; $attempt++) {
    if ($attempt > 1) {
        echo "  [retry {$attempt}/{$maxAttempts}] all queries were empty, retrying in 10s...\n";
        sleep(10);
    }

    // All non-restart metrics use last_over_time(...[24h]) so we still get values
    // for pods that were restarted within the window but have since been deleted
    // (kube-state-metrics drops series once the pod is gone — instant query misses them).
    echo "  [1/7] Restart counts...\n";
    $qRestarts = $pq("increase(kube_pod_container_status_restarts_total{{$baseSelectorKs}}[24h]) > 0");

    echo "  [2/7] Last terminated timestamps...\n";
    $qTimes    = $pq("last_over_time(kube_pod_container_status_last_terminated_timestamp{{$baseSelector}}[24h])");

    echo "  [3/7] Termination reasons...\n";
    $qReasons  = $pq("last_over_time(kube_pod_container_status_last_terminated_reason{{$baseSelector}}[24h]) > 0");

    echo "  [4/7] Memory usage...\n";
    $qMemUsed  = $pq("last_over_time(container_memory_working_set_bytes{{$baseSelector},container!=\"\",container!=\"POD\"}[24h])");

    echo "  [5/7] Memory limits...\n";
    $qMemLimit = $pq("last_over_time(kube_pod_container_resource_limits{{$baseSelector},resource=\"memory\",container!=\"\"}[24h])");

    echo "  [6/7] CPU usage...\n";
    $qCpuUsed  = $pq("last_over_time(rate(container_cpu_usage_seconds_total{{$baseSelector},container!=\"\",container!=\"POD\"}[5m])[24h:30m])");

    echo "  [7/7] CPU limits...\n";
    $qCpuLimit = $pq("last_over_time(kube_pod_container_resource_limits{{$baseSelector},resource=\"cpu\",container!=\"\"}[24h])");

    $totalSeries = count($qRestarts) + count($qTimes) + count($qReasons)
                 + count($qMemUsed)  + count($qMemLimit) + count($qCpuUsed) + count($qCpuLimit);
    if ($totalSeries > 0) break;
}

// ── Safety guard: if ALL 7 queries returned empty after every retry, the
// connection to Grafana likely failed (network/SSL/auth). Refuse to write
// the file — better to keep stale data than overwrite real data with zeros.
if ($totalSeries === 0) {
    fwrite(STDERR, "[ABORT] All Prometheus queries returned empty after {$maxAttempts} attempts — "
                 . "likely network/auth issue. Not writing raw/{$runwaySlug}/{$dateStr}.json "
                 . "(existing file preserved).\n");
    exit(2);
}

// ── Build lookup maps (first-wins for duplicates from multi-cadvisor) ──────
$mapRestarts = $mapTimes = $mapReasons = $mapMemUsed = $mapMemLimit = $mapCpuUsed = $mapCpuLimit = [];

foreach ($qRestarts as $r) {
    $k = mk($r['metric']);
    $v = (float)($r['value'][1] ?? 0);
    $mapRestarts[$k] = max($mapRestarts[$k] ?? 0, $v);
}
foreach ($qTimes    as $r) { $k = mk($r['metric']); if (!isset($mapTimes[$k]))    $mapTimes[$k]    = (float)($r['value'][1] ?? 0); }
foreach ($qReasons  as $r) { $k = mk($r['metric']); if (!isset($mapReasons[$k]))  $mapReasons[$k]  = $r['metric']['reason'] ?? null; }
foreach ($qMemUsed  as $r) { $k = mk($r['metric']); if (!isset($mapMemUsed[$k]))  $mapMemUsed[$k]  = (float)($r['value'][1] ?? 0); }
foreach ($qMemLimit as $r) { $k = mk($r['metric']); if (!isset($mapMemLimit[$k])) $mapMemLimit[$k] = (float)($r['value'][1] ?? 0); }
foreach ($qCpuUsed  as $r) { $k = mk($r['metric']); if (!isset($mapCpuUsed[$k]))  $mapCpuUsed[$k]  = (float)($r['value'][1] ?? 0); }
foreach ($qCpuLimit as $r) { $k = mk($r['metric']); if (!isset($mapCpuLimit[$k])) $mapCpuLimit[$k] = (float)($r['value'][1] ?? 0); }

// ── Load service priority map ─────────────────────────────────────────────
$svcMap = loadServiceSeverityMap();

// ── Correlate into pod records ─────────────────────────────────────────────
$pods = [];
foreach ($mapRestarts as $key => $rawCount) {
    $count = (int)round($rawCount);
    if ($count < 1) continue;

    [$pod, $container, $namespace] = array_pad(explode('|', $key, 3), 3, '');

    $timeUnix    = (isset($mapTimes[$key]) && $mapTimes[$key] > 0) ? (int)$mapTimes[$key] : null;
    $restartedAt = $timeUnix
        ? (new DateTime('@' . $timeUnix))->setTimezone($tz)->format(DateTime::ATOM)
        : null;

    $memUsedBytes  = isset($mapMemUsed[$key])  ? (int)$mapMemUsed[$key]  : null;
    $memLimitBytes = isset($mapMemLimit[$key]) ? (int)$mapMemLimit[$key] : null;
    $memRatio      = ($memUsedBytes !== null && $memLimitBytes && $memLimitBytes > 0)
        ? round($memUsedBytes / $memLimitBytes, 4) : null;

    $cpuCores      = isset($mapCpuUsed[$key])  ? round($mapCpuUsed[$key], 6)  : null;
    $cpuLimitCores = isset($mapCpuLimit[$key]) ? round($mapCpuLimit[$key], 4) : null;
    $cpuRatio      = ($cpuCores !== null && $cpuLimitCores && $cpuLimitCores > 0)
        ? round($cpuCores / $cpuLimitCores, 4) : null;

    $svcLookup = lookupServicePriority($pod, $svcMap);

    $pods[] = [
        'pod'               => $pod,
        'container'         => $container,
        'namespace'         => $namespace,
        'restartCount'      => $count,
        'terminationReason' => $mapReasons[$key] ?? null,
        'restartedAt'       => $restartedAt,
        'restartedAtUnix'   => $timeUnix,
        'memoryUsedBytes'   => $memUsedBytes,
        'memoryLimitBytes'  => $memLimitBytes,
        'memoryUsageRatio'  => $memRatio,
        'cpuUsedCores'      => $cpuCores,
        'cpuLimitCores'     => $cpuLimitCores,
        'cpuUsageRatio'     => $cpuRatio,
        'priority'          => $svcLookup['priority'],
        'severity'          => $svcLookup['severity'],
    ];
}

usort($pods, function ($a, $b) {
    return $b['restartCount'] !== $a['restartCount']
        ? $b['restartCount'] - $a['restartCount']
        : strcmp($a['pod'], $b['pod']);
});

$reasonSummary   = [];
$severitySummary = ['critical' => 0, 'warning' => 0, 'info' => 0];
foreach ($pods as $p) {
    $r = $p['terminationReason'] ?? 'Unknown';
    $reasonSummary[$r] = ($reasonSummary[$r] ?? 0) + 1;
    $s = $p['severity'] ?? 'info';
    $severitySummary[$s] = ($severitySummary[$s] ?? 0) + 1;
}
arsort($reasonSummary);

$output = [
    'date'           => $dateStr,
    'generatedAt'    => $now->format(DateTime::ATOM),
    'source'         => 'cron',
    'runway'         => $runwayName,
    'cluster'        => $cluster,
    'scanWindowHours'=> 24,
    'totalPods'      => count($pods),
    'totalRestarts'  => array_sum(array_column($pods, 'restartCount')),
    'severitySummary'=> $severitySummary,
    'reasonSummary'  => $reasonSummary,
    'pods'           => $pods,
];

$rawDir = DATA_DIR . 'grafana-monitoring/raw/' . $runwaySlug . '/';
if (!is_dir($rawDir) && !@mkdir($rawDir, 0775, true)) {
    echo "[ERROR] Failed to create directory: {$rawDir}\n";
    exit(1);
}

$file = $rawDir . $dateStr . '.json';
$json = json_encode($output, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

$tmp = $file . '.tmp.' . bin2hex(random_bytes(4));
if (file_put_contents($tmp, $json) === false || !rename($tmp, $file)) {
    @unlink($tmp);
    echo "[ERROR] Failed to write: {$file}\n";
    exit(1);
}

// ── Optionally also write daily/{slug}/{date}.json (Analyzed tab) ───────────
// WRITE_DAILY=1 → write the analyzed/daily file with the same severity-enriched
// content plus scanRangeStart/scanRangeEnd metadata. This makes the cron flow
// fully self-contained (no need for routine + upload.php round-trip).
$dailyFile = null;
$dailyOutput = null;
if (getenv('WRITE_DAILY')) {
    $end = clone $now;
    $start = (clone $end)->modify('-24 hours');
    $dailyOutput = $output;
    $dailyOutput['source']          = 'cron-auto';
    $dailyOutput['scanRangeStart']  = $start->format(DateTime::ATOM);
    $dailyOutput['scanRangeEnd']    = $end->format(DateTime::ATOM);
    $dailyOutput['grafanaUrl']      = $grafanaUrl;
    $dailyOutput['datasourceUid']   = $dsUid;
    $dailyOutput['datasourceOrgId'] = (int)$orgId;

    $dailyDir = DATA_DIR . 'grafana-monitoring/daily/' . $runwaySlug . '/';
    if (!is_dir($dailyDir)) @mkdir($dailyDir, 0775, true);
    $dailyFile = $dailyDir . $dateStr . '.json';
    $dailyJson = json_encode($dailyOutput, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $tmp2 = $dailyFile . '.tmp.' . bin2hex(random_bytes(4));
    if (file_put_contents($tmp2, $dailyJson) === false || !rename($tmp2, $dailyFile)) {
        @unlink($tmp2);
        echo "[WARN] Failed to write daily: {$dailyFile}\n";
    } else {
        echo "  Daily: {$dailyFile}\n";
    }
}

// ── Optionally send Chat + Email notification ─────────────────────────────
// SEND_NOTI=1 → trigger sendRestartMonitorNotifications for this runway's report.
// Uses the daily payload (with scanRange metadata) when available, else falls
// back to the raw payload. Idempotent: _notify.php checks notify-history.json.
if (getenv('SEND_NOTI') && $dailyOutput) {
    require_once __DIR__ . '/../api/helpers.php';
    require_once __DIR__ . '/../api/restart-monitor/_notify.php';
    $r = sendRestartMonitorNotifications($dailyOutput);
    $chat  = ($r['chat']['sent']  ?? false) ? 'sent' : ('skip — ' . ($r['chat']['reason']  ?? '?'));
    $email = ($r['email']['sent'] ?? false) ? 'sent' : ('skip — ' . ($r['email']['reason'] ?? '?'));
    echo "  Noti: chat={$chat} · email={$email}\n";
}

$elapsed = round(microtime(true) - SCRIPT_START, 2);
echo '[' . date('Y-m-d H:i:s') . "] Done [{$runwayName}]: {$file}\n";
echo '  Pods: ' . count($pods) . ' · Total restarts: ' . $output['totalRestarts'] . " · {$elapsed}s\n";
exit(0);
