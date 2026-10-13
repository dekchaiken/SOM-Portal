<?php
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
requireRole($payload, ALL_STAFF_ROLES);

if ($_SERVER['REQUEST_METHOD'] !== 'GET') respondError('Method not allowed', 405);

$fresh     = !empty($_GET['fresh']);
$cacheFile = DATA_DIR . 'health_cache.json';
$cacheTTL  = 60; // seconds

// Return cached result unless ?fresh=1 or cache is stale
if (!$fresh && file_exists($cacheFile)) {
    $cache = json_decode(file_get_contents($cacheFile), true) ?? [];
    if (!empty($cache['cached_at']) && (time() - strtotime($cache['cached_at'])) < $cacheTTL) {
        respondOk($cache['result']);
    }
}

// ── Run health checks ─────────────────────────────────────────────────────────

function curlCheck(string $url, array $headers = [], int $timeout = 5, bool $useCooldown = false): array {
    // When called from a health-check that hits many hosts (e.g. Jenkins fleet),
    // pass $useCooldown=true so a host that just failed doesn't burn the full
    // connect timeout on every dashboard poll. Cooldown TTL (30s) is shorter
    // than health cache TTL (60s), so probes still recover quickly.
    if ($useCooldown) {
        $cd = hostCooldownActive(hostFromUrl($url));
        if ($cd) {
            return ['status' => 'cooldown', 'latency_ms' => 0, 'detail' => $cd['reason']];
        }
    }

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => $timeout,
        CURLOPT_CONNECTTIMEOUT => min($timeout, 3),
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_SSL_VERIFYPEER => false, // internal infra may use self-signed certs
        CURLOPT_SSL_VERIFYHOST => 0,    // internal hostnames may not match cert CN/SAN
    ]);
    applyDnsOverrides($ch, $url);
    $t0   = microtime(true);
    $body = curl_exec($ch);
    $ms   = (int)round((microtime(true) - $t0) * 1000);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);

    if ($err) {
        if ($useCooldown) hostCooldownMark(hostFromUrl($url), $err);
        $isTimeout = str_contains($err, 'timed out') || str_contains($err, 'Connection timed out');
        return ['status' => $isTimeout ? 'timeout' : 'error', 'latency_ms' => $ms, 'detail' => $err];
    }
    if ($code >= 200 && $code < 300) return ['status' => 'ok', 'latency_ms' => $ms];
    if ($useCooldown && $code >= 500) hostCooldownMark(hostFromUrl($url), "HTTP $code");
    return ['status' => 'error', 'latency_ms' => $ms, 'detail' => "HTTP $code"];
}

$services = [];

// ── SMTP (config check only — no connection test) ─────────────────────────────
$mailCfg  = readJson('mail_config.json');
$smtpHost = trim($mailCfg['smtp_host'] ?? '');
$services['smtp'] = [
    'name'   => 'SMTP',
    'status' => $smtpHost ? 'ok' : 'not_configured',
];

// ── Jira ──────────────────────────────────────────────────────────────────────
if (JIRA_BASE_URL && jiraCredsReady()) {
    $encoded = base64_encode(jiraEmail() . ':' . jiraToken());
    $result  = curlCheck(
        JIRA_BASE_URL . '/rest/api/2/myself',
        ['Authorization: Basic ' . $encoded, 'Accept: application/json']
    );
    $services['jira'] = array_merge(['name' => 'Jira'], $result);
} else {
    $services['jira'] = ['name' => 'Jira', 'status' => 'not_configured'];
}

// ── Jenkins servers ───────────────────────────────────────────────────────────
$jenkinsServers = readJson('jenkins_servers.json');
$jenkinsResults = [];
foreach ($jenkinsServers as $srv) {
    if (empty($srv['base_url'])) continue;
    $headers = [];
    if (($srv['auth_mode'] ?? '') === 'token' && !empty($srv['auth_user']) && !empty($srv['auth_token'])) {
        $headers[] = 'Authorization: Basic ' . base64_encode($srv['auth_user'] . ':' . $srv['auth_token']);
    } elseif (!empty($srv['auth_cookie'])) {
        $headers[] = 'Cookie: ' . $srv['auth_cookie'];
    }
    $result = curlCheck(rtrim($srv['base_url'], '/') . '/api/json', $headers, 5, true);
    $jenkinsResults[] = array_merge([
        'id'      => $srv['id'] ?? '',
        'display' => $srv['display'] ?: ($srv['base_url'] ?? ''),
    ], $result);
}
$services['jenkins'] = $jenkinsResults;

// ── Build summary ─────────────────────────────────────────────────────────────
$jErrCount = count(array_filter($jenkinsResults, fn($j) => ($j['status'] ?? '') !== 'ok'));

// Only log for admins to avoid noise from dashboard polling
if (in_array($payload['role'] ?? '', ADMIN_ROLES)) {
    logActivity('health_check', [
        'jira_status'    => $services['jira']['status'] ?? 'unknown',
        'smtp_status'    => $services['smtp']['status'] ?? 'unknown',
        'jenkins_total'  => count($jenkinsResults),
        'jenkins_errors' => $jErrCount,
    ], $payload['sub'], $payload['name']);
}

$result = [
    'checked_at' => date('c'),
    'services'   => $services,
];

// Cache the result
file_put_contents($cacheFile, json_encode([
    'cached_at' => date('c'),
    'result'    => $result,
], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));

respondOk($result);
