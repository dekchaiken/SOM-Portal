<?php
/**
 * Run health checks for all monitors and store results.
 * Called by the frontend every 1 minute.
 * GET /api/uptime/check.php
 */
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
if ($_SERVER['REQUEST_METHOD'] !== 'GET') respondError('Method not allowed', 405);

define('MAX_HISTORY', 10080); // 7 days × 24h × 60min

$monitors = readJson('uptime_monitors.json') ?: [];
if (empty($monitors)) { respondOk([]); }

$history = readJson('uptime_history.json') ?: [];
$now     = time();
$results = [];

foreach ($monitors as $mon) {
    $id  = $mon['id'];
    $url = $mon['url'];

    // ── cURL HEAD check ──────────────────────────────────────────
    $t0 = microtime(true);
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_NOBODY         => true,   // HEAD request (faster)
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_USERAGENT      => 'SOM-Portal Uptime Monitor/1.0',
    ]);
    curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);

    $latency = (int)((microtime(true) - $t0) * 1000);
    $up      = !$err && $code > 0 && $code < 500;

    // ── Store result: [unix_ts, is_up, latency_ms, http_code] ────
    if (!isset($history[$id])) $history[$id] = [];
    $history[$id][] = [$now, (int)$up, $up ? $latency : 0, $code];

    if (count($history[$id]) > MAX_HISTORY) {
        $history[$id] = array_slice($history[$id], -MAX_HISTORY);
    }

    $results[] = [
        'id'      => $id,
        'name'    => $mon['name'],
        'up'      => $up,
        'latency' => $up ? $latency : 0,
        'code'    => $code,
        'error'   => $err ?: null,
    ];
}

writeJson('uptime_history.json', $history);
respondOk($results);
