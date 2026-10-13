<?php
/**
 * DNS + upstream diagnostic (admin-only).
 *
 *   GET  ?                          → dump override map + jenkins_servers + cooldown state
 *   GET  ?probe=1                   → also probe every Jenkins server (DNS + TCP + curl)
 *   POST ?action=clear-cooldown              → wipe host-cooldown.json
 *   POST ?action=clear-cooldown&host=<h>     → clear one host's cooldown entry
 *   POST ?action=clear-override-cache        → drop the in-memory _dnsOverrideMap cache
 *
 * Built for the SOM server being unreachable via SSH — everything an admin
 * would `dig` / `curl -v` / `tcpdump` for is served through this endpoint so
 * DNS/network issues after a DRP can be triaged from the browser.
 */
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
requireRole($payload, ADMIN_ROLES);

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

// ── Actions (POST — mutate) ─────────────────────────────────────────────────
if ($method === 'POST') {
    requireCsrf();
    if ($action === 'clear-cooldown') {
        $host = strtolower(trim($_GET['host'] ?? ''));
        if ($host === '') {
            @unlink(DATA_DIR . HOST_COOLDOWN_FILE);
            unset($GLOBALS['_host_cooldown_cache']);
            logActivity('dns_diag_clear_cooldown', ['host' => 'ALL'], $payload['sub'], $payload['name']);
            respondOk(['cleared' => 'all']);
        }
        hostCooldownClear($host);
        logActivity('dns_diag_clear_cooldown', ['host' => $host], $payload['sub'], $payload['name']);
        respondOk(['cleared' => $host]);
    }
    if ($action === 'clear-override-cache') {
        unset($GLOBALS['_dns_override_cache']);
        respondOk(['cleared' => 'override_map_cache']);
    }
    respondError('Unknown POST action', 400);
}

// ── Inspect (GET) ───────────────────────────────────────────────────────────
if ($method !== 'GET') respondError('Method not allowed', 405);

// Force fresh reads so we see what curl helpers will see on THIS request.
unset($GLOBALS['_dns_override_cache'], $GLOBALS['_host_cooldown_cache']);

$overrideMap    = _dnsOverrideMap();
$cooldownData   = _hostCooldownData();
$jenkinsServers = readJson('jenkins_servers.json');

$serverList = [];
foreach ($jenkinsServers as $s) {
    $host = hostFromUrl($s['base_url'] ?? '');
    $serverList[] = [
        'id'                => $s['id']        ?? '',
        'display'           => $s['display']   ?? '',
        'base_url'          => $s['base_url']  ?? '',
        'host'              => $host,
        'ip_override_saved' => $s['ip_override'] ?? '',
        'in_effective_map'  => $overrideMap[$host] ?? null,
        'in_cooldown'       => isset($cooldownData[$host]),
    ];
}

$probes = [];
if (!empty($_GET['probe'])) {
    // Total budget for probing all servers — keep well under PHP 60s ceiling.
    @set_time_limit(45);
    $budgetSec = 30;
    $started   = microtime(true);

    foreach ($serverList as $s) {
        if ((microtime(true) - $started) > $budgetSec) {
            $probes[] = ['display' => $s['display'], 'skipped' => 'time budget exhausted'];
            continue;
        }
        $host = $s['host'];
        if ($host === '') continue;

        // gethostbyname blocks — usually returns the input string on failure.
        $t0    = microtime(true);
        $dnsIp = @gethostbyname($host);
        $dnsMs = (int)((microtime(true) - $t0) * 1000);
        if ($dnsIp === $host) $dnsIp = null;

        $overrideIp = $overrideMap[$host] ?? null;
        $targetIp   = $overrideIp ?: $dnsIp;

        // Raw TCP:443 reachability — proves whether the network path even exists.
        $tcpMs = null; $tcpErr = null;
        if ($targetIp) {
            $t0   = microtime(true);
            $conn = @stream_socket_client("tcp://{$targetIp}:443", $errno, $errstr, 3);
            $tcpMs = (int)((microtime(true) - $t0) * 1000);
            if (!$conn) $tcpErr = "$errstr (errno $errno)";
            else @fclose($conn);
        }

        // Full curl HEAD through applyDnsOverrides — mirrors what jenkinsRequest() does.
        $url = rtrim($s['base_url'], '/') . '/api/json';
        $ch  = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 8,
            CURLOPT_CONNECTTIMEOUT => 3,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => false,
            CURLOPT_NOBODY         => true,
        ]);
        applyDnsOverrides($ch, $url);
        $t0 = microtime(true);
        @curl_exec($ch);
        $curlMs   = (int)((microtime(true) - $t0) * 1000);
        $curlErr  = curl_error($ch);
        $curlCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        // Interpret the result so the reader doesn't have to guess.
        $verdict = 'UNKNOWN';
        if ($curlCode > 0)                                        $verdict = "REACHABLE (HTTP {$curlCode})";
        elseif ($curlErr && str_contains($curlErr, 'Resolving'))  $verdict = 'DNS_FAIL — override NOT applied';
        elseif ($curlErr && str_contains($curlErr, 'Connection')) $verdict = 'NETWORK_UNREACHABLE — override applied but route/firewall blocks';
        elseif ($curlErr && str_contains($curlErr, 'refused'))    $verdict = 'CONNECTION_REFUSED — IP wrong or Jenkins down on that IP';
        elseif ($curlErr)                                         $verdict = "OTHER: {$curlErr}";

        $probes[] = [
            'display'       => $s['display'],
            'host'          => $host,
            'dns_lookup_ip' => $dnsIp,
            'dns_lookup_ms' => $dnsMs,
            'override_ip'   => $overrideIp,
            'target_ip'     => $targetIp,
            'tcp_443_ms'    => $tcpMs,
            'tcp_error'     => $tcpErr,
            'curl_status'   => $curlCode,
            'curl_ms'       => $curlMs,
            'curl_error'    => $curlErr,
            'verdict'       => $verdict,
        ];
    }
}

respondOk([
    'code_version'    => 'dns-diag v1 · helpers.php-multiteam-aware',
    'php_opcache'     => function_exists('opcache_get_status') ? (bool)@opcache_get_status(false) : false,
    'team_context'    => $GLOBALS['_current_team'] ?? null,
    'override_map'    => $overrideMap,
    'jenkins_servers' => $serverList,
    'cooldown'        => $cooldownData,
    'probes'          => $probes,
    'hints'           => [
        'ip_override missing?'      => 'jenkins_servers[].ip_override_saved is empty → save via admin/jenkins-servers.html',
        'ip saved but not in map?'  => 'means helpers.php _dnsOverrideMap() is stale — reload PHP-FPM or hit ?action=clear-override-cache',
        'in_cooldown = true?'       => 'POST ?action=clear-cooldown&host=... to wipe',
        'verdict = DNS_FAIL?'       => 'override not applied — deploy issue (helpers.php old) or opcache',
        'verdict = NETWORK_UNREACHABLE?' => 'code is fine, ops must open firewall/routing to that IP',
    ],
    'usage' => [
        'inspect'          => 'GET (this)',
        'inspect + probe'  => 'GET ?probe=1',
        'clear all cooldown'  => 'POST ?action=clear-cooldown',
        'clear one host'   => 'POST ?action=clear-cooldown&host=jenkins-batch-eks-cicd.private-a-cloud1p.ascendmoney.io',
        'drop map cache'   => 'POST ?action=clear-override-cache',
    ],
]);
