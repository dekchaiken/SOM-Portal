<?php
// OpenSearch endpoint config — SM-only feature. Admins register one or more
// OpenSearch clusters (base_url + basic-auth creds + default index pattern),
// and the log-viewer modal in service-performance.html reads through
// /api/opensearch-proxy/ against the endpoint the user picks.
//
// Storage: data/sm/opensearch_config.json (SM-only feature, so not shared).
require_once __DIR__ . '/../helpers.php';

const OS_CONFIG_FILE = 'opensearch_config.json';

$payload = requireAuth();
requireSmTeamOnly('OpenSearch log viewer');
requireRole($payload, ADMIN_ROLES);

function _osConfigLoad(): array {
    $cfg = readJson(OS_CONFIG_FILE);
    if (!isset($cfg['endpoints']) || !is_array($cfg['endpoints'])) $cfg['endpoints'] = [];
    if (!isset($cfg['defaults']) || !is_array($cfg['defaults'])) {
        $cfg['defaults'] = ['size' => 200, 'max_size' => 1000, 'default_time_range_min' => 15];
    }
    return $cfg;
}

function _osConfigSave(array $cfg): void {
    writeJson(OS_CONFIG_FILE, $cfg);
}

// Redact password in list responses so it never lands in browser memory.
function _osRedactPassword(array $ep): array {
    $ep['password_set'] = !empty($ep['password']);
    unset($ep['password']);
    return $ep;
}

// Normalize a user-typed base URL to just scheme://host[:port]. Users often
// paste a Dashboards page URL like ".../app/login?nextUrl=%2F" which then
// gets `/_search` appended and returns HTML — this strips the path/query so
// what lands in the file is the REST API root every time.
function _osNormalizeBaseUrl(string $url): string {
    $url = trim($url);
    if ($url === '') return '';
    $u = parse_url($url);
    if (!$u || empty($u['host'])) return rtrim($url, '/'); // fall back — validated later
    $scheme = $u['scheme'] ?? 'https';
    $host   = $u['host'];
    $port   = isset($u['port']) ? ':' . $u['port'] : '';
    return "{$scheme}://{$host}{$port}";
}

// If the upstream body starts with < it's almost certainly HTML (login page,
// error page, Dashboards SPA) rather than the JSON we asked for. Return a
// caller-facing message that explains the likely cause.
function _osIsHtml(string $body): bool {
    $t = ltrim($body);
    return $t !== '' && ($t[0] === '<');
}

$method = $_SERVER['REQUEST_METHOD'];
$action = trim($_GET['action'] ?? '');

// ── POST ?action=test — test connection to an endpoint (unsaved or saved) ────
if ($method === 'POST' && $action === 'test') {
    requireCsrf();
    $body = getBody();

    // Test can operate on a saved endpoint (by id) OR ad-hoc payload (during
    // the "add new" flow so admins can validate before saving).
    $endpoint = null;
    if (!empty($body['id'])) {
        $cfg = _osConfigLoad();
        foreach ($cfg['endpoints'] as $e) {
            if (($e['id'] ?? '') === $body['id']) { $endpoint = $e; break; }
        }
        if (!$endpoint) respondError('Endpoint not found', 404);
    } else {
        $endpoint = [
            'base_url'              => _osNormalizeBaseUrl((string)($body['base_url'] ?? '')),
            'username'              => trim($body['username'] ?? ''),
            'password'              => (string)($body['password'] ?? ''),
            'auth_mode'             => in_array($body['auth_mode'] ?? '', ['basic','dashboards'], true) ? $body['auth_mode'] : 'basic',
            'osd_version'           => trim($body['osd_version'] ?? '2.7.0'),
            'default_index_pattern' => trim($body['default_index_pattern'] ?? ''),
        ];
        if (!$endpoint['base_url']) respondError('base_url is required');
    }

    $mode = $endpoint['auth_mode'] ?? 'basic';
    $baseUrl = rtrim($endpoint['base_url'], '/');
    $host = hostFromUrl($baseUrl);
    if ($cd = hostCooldownActive($host)) {
        respondError('Host in cooldown after recent failure: ' . $cd['reason'], 503);
    }

    $t0 = microtime(true);

    if ($mode === 'dashboards') {
        // Dashboards proxy mode: login → tiny search on the default index.
        $osdVer = trim($endpoint['osd_version'] ?? '2.7.0');
        $login  = _osDashLoginProbe($baseUrl, $endpoint['username'] ?? '', $endpoint['password'] ?? '', $osdVer);
        if (!$login['ok']) {
            hostCooldownMark($host, $login['error']);
            respondError('Dashboards login failed: ' . $login['error'], 422);
        }
        $index = $endpoint['default_index_pattern'] ?? '';
        if ($index === '') respondError('default_index_pattern is required for the Dashboards test probe');
        $probeBody = ['params' => ['index' => $index, 'body' => ['size' => 0, 'query' => ['match_all' => new stdClass()]]]];
        $ch = curl_init($baseUrl . '/internal/search/opensearch');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15, CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_SSL_VERIFYPEER => false, CURLOPT_SSL_VERIFYHOST => false,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => json_encode($probeBody, JSON_UNESCAPED_UNICODE),
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'Accept: */*',
                'osd-xsrf: osd-fetch',
                'osd-version: ' . $osdVer,
                'Cookie: ' . $login['cookie_header'],
            ],
            CURLOPT_USERAGENT => 'CentralizeSOM/1.0 OpenSearch-Dashboards',
        ]);
        $bodyResp = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err  = curl_error($ch);
        curl_close($ch);

        if ($err !== '' || $code === 0 || $code >= 500) hostCooldownMark($host, $err ?: "HTTP {$code}");
        if ($err !== '')   respondError('Cannot reach Dashboards search: ' . $err, 502);
        if ($code === 401) respondError('Dashboards search rejected — session cookie invalid', 422);
        if ($code === 403) respondError('Dashboards search denied (missing osd-xsrf?)', 422);
        if ($code !== 200) respondError("Dashboards search HTTP {$code}: " . mb_substr((string)$bodyResp, 0, 160), 502);
        if (_osIsHtml((string)$bodyResp)) respondError('Got HTML response — check Base URL / osd-version', 502);

        $data = json_decode($bodyResp, true);
        if (!is_array($data)) respondError('Non-JSON body from Dashboards proxy', 502);
        $raw = $data['rawResponse'] ?? $data;
        $total = $raw['hits']['total']['value'] ?? ($raw['hits']['total'] ?? null);

        respondOk([
            'ok'          => true,
            'mode'        => 'dashboards',
            'cluster_name'=> null,
            'status'      => 'reachable',
            'total_docs'  => is_numeric($total) ? (int)$total : null,
            'took_ms'     => (int)($raw['took'] ?? 0),
            'latency_ms'  => (int)round((microtime(true) - $t0) * 1000),
            'index'       => $index,
        ], 'Dashboards proxy reachable · index has ' . ($total ?? '?') . ' docs');
    }

    // ── basic mode: direct REST probe on /_cluster/health ────────────────────
    $url = $baseUrl . '/_cluster/health';
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_CONNECTTIMEOUT => 4,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HTTPHEADER     => ['Accept: application/json'],
        CURLOPT_USERPWD        => $endpoint['username'] . ':' . $endpoint['password'],
        CURLOPT_HTTPAUTH       => CURLAUTH_BASIC,
        CURLOPT_USERAGENT      => 'CentralizeSOM/1.0 OpenSearch-Config',
    ]);
    $bodyResp = curl_exec($ch);
    $code     = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err      = curl_error($ch);
    $ms       = (int)round((microtime(true) - $t0) * 1000);
    curl_close($ch);

    if ($err !== '' || $code === 0 || $code >= 500) {
        hostCooldownMark($host, $err !== '' ? $err : "HTTP {$code}");
    }

    if ($err !== '')  respondError('Cannot reach OpenSearch: ' . $err, 502);
    if ($code === 401) respondError('OpenSearch rejected credentials (401)', 422);
    if ($code === 403) respondError('OpenSearch access denied (403)', 422);
    if ($code !== 200) respondError("OpenSearch returned HTTP {$code} — REST API not exposed at this URL. Try switching Auth Mode to 'Dashboards proxy' if this host runs OpenSearch Dashboards.", 502);

    if (_osIsHtml((string)$bodyResp)) {
        respondError('Got an HTML page instead of JSON — Base URL is probably a Dashboards page, not the REST API. Use just the host (e.g. https://opensearch.your-host.io) with no /app/... path. If Dashboards and the REST API are on different hosts, ask your OpenSearch admin for the REST API URL.', 502);
    }
    $health = json_decode($bodyResp, true);
    if (!is_array($health)) respondError('OpenSearch returned non-JSON body (first 120 chars: ' . mb_substr((string)$bodyResp, 0, 120) . ')', 502);

    respondOk([
        'ok'             => true,
        'mode'           => 'basic',
        'cluster_name'   => $health['cluster_name']   ?? null,
        'status'         => $health['status']         ?? null,
        'number_of_nodes'=> $health['number_of_nodes']?? null,
        'latency_ms'     => $ms,
    ], 'OpenSearch reachable');
}

// Small login probe used by config test only (production queries use the
// full session-cached login in opensearch-proxy). Kept here so admins can
// validate credentials without depending on the proxy file.
function _osDashLoginProbe(string $baseUrl, string $user, string $pass, string $osdVersion): array {
    $cookies = [];
    $ch = curl_init(rtrim($baseUrl, '/') . '/auth/login');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode(['username' => $user, 'password' => $pass]),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_USERAGENT => 'CentralizeSOM/1.0 OpenSearch-Dashboards',
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'Accept: */*',
            'osd-xsrf: true',
            'osd-version: ' . $osdVersion,
        ],
        CURLOPT_HEADERFUNCTION => function ($ch, $line) use (&$cookies) {
            if (preg_match('/^Set-Cookie:\s*([^;]+)/i', $line, $m)) $cookies[] = trim($m[1]);
            return strlen($line);
        },
    ]);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);

    if ($err !== '')  return ['ok' => false, 'error' => $err];
    if ($code === 401) return ['ok' => false, 'error' => 'Invalid username or password'];
    if ($code === 404) return ['ok' => false, 'error' => 'Login endpoint /auth/login not found — check Base URL and that Security plugin uses basic auth'];
    if ($code < 200 || $code >= 300) return ['ok' => false, 'error' => "Login HTTP {$code}: " . mb_substr((string)$body, 0, 120)];
    if (!$cookies)     return ['ok' => false, 'error' => 'Login succeeded but no Set-Cookie header returned'];
    return ['ok' => true, 'cookies' => $cookies, 'cookie_header' => implode('; ', $cookies)];
}

// ── GET — list all endpoints (creds redacted) ─────────────────────────────────
if ($method === 'GET') {
    $cfg = _osConfigLoad();
    $out = array_map('_osRedactPassword', $cfg['endpoints']);
    usort($out, fn($a, $b) => ($a['order'] ?? 99) <=> ($b['order'] ?? 99));
    respondOk([
        'endpoints' => $out,
        'defaults'  => $cfg['defaults'],
    ]);
}

// ── POST — create endpoint ────────────────────────────────────────────────────
if ($method === 'POST') {
    requireCsrf();
    $body = getBody();

    $name           = trim($body['name']           ?? '');
    $base_url       = trim($body['base_url']       ?? '');
    $username       = trim($body['username']       ?? '');
    $password       = (string)($body['password']   ?? '');
    $default_index  = trim($body['default_index_pattern'] ?? '');
    $dashboards_url = trim($body['dashboards_url'] ?? ''); // optional — for "Open in OpenSearch" deeplink
    $enabled        = ($body['enabled'] ?? true) !== false;
    $order          = isset($body['order']) ? (int)$body['order'] : 99;
    $auth_mode      = in_array($body['auth_mode'] ?? '', ['basic', 'dashboards'], true) ? $body['auth_mode'] : 'basic';
    $osd_version    = trim($body['osd_version'] ?? '2.7.0');

    if (!$name)          respondError('name is required');
    if (!$base_url)      respondError('base_url is required');
    if (!$default_index) respondError('default_index_pattern is required');

    // Optional: extra index patterns list (e.g. per-env)
    $indices = $body['index_patterns'] ?? [];
    if (!is_array($indices)) $indices = [];
    $indices = array_values(array_filter(array_map('trim', $indices), fn($v) => $v !== ''));
    // Ensure the default pattern is present in the list
    if (!in_array($default_index, $indices, true)) array_unshift($indices, $default_index);

    $cfg = _osConfigLoad();
    $new = [
        'id'                    => genId('os'),
        'name'                  => $name,
        'base_url'              => _osNormalizeBaseUrl($base_url),
        'username'              => $username,
        'password'              => $password,
        'auth_mode'             => $auth_mode,
        'osd_version'           => $osd_version,
        'default_index_pattern' => $default_index,
        'index_patterns'        => $indices,
        'dashboards_url'        => rtrim($dashboards_url, '/'),
        'enabled'               => $enabled,
        'order'                 => $order,
    ];
    $cfg['endpoints'][] = $new;
    _osConfigSave($cfg);

    hostCooldownClear(strtolower((string)(parse_url($new['base_url'], PHP_URL_HOST) ?: '')));

    logActivity('opensearch_config_create', ['id' => $new['id'], 'name' => $name], $payload['sub'], $payload['name']);
    respondOk(_osRedactPassword($new), 'OpenSearch endpoint added');
}

// ── PUT ?id=xxx — update endpoint ────────────────────────────────────────────
if ($method === 'PUT') {
    requireCsrf();
    $id = $_GET['id'] ?? '';
    if (!$id) respondError('id is required');

    $body = getBody();
    $cfg  = _osConfigLoad();
    $found = false;
    $touchedHost = '';

    foreach ($cfg['endpoints'] as &$e) {
        if (($e['id'] ?? '') !== $id) continue;
        if (isset($body['name']))         $e['name']         = trim($body['name']);
        if (isset($body['base_url']))     $e['base_url']     = _osNormalizeBaseUrl((string)$body['base_url']);
        if (isset($body['username']))     $e['username']     = trim($body['username']);
        // Only overwrite password when caller sends a non-empty value — an
        // empty string means "leave the existing password alone".
        if (array_key_exists('password', $body) && (string)$body['password'] !== '') {
            $e['password'] = (string)$body['password'];
        }
        if (isset($body['default_index_pattern'])) $e['default_index_pattern'] = trim($body['default_index_pattern']);
        if (isset($body['dashboards_url']))        $e['dashboards_url']        = rtrim(trim($body['dashboards_url']), '/');
        if (isset($body['enabled']))               $e['enabled']               = (bool)$body['enabled'];
        if (isset($body['order']))                 $e['order']                 = (int)$body['order'];
        if (isset($body['auth_mode']) && in_array($body['auth_mode'], ['basic', 'dashboards'], true)) {
            $e['auth_mode'] = $body['auth_mode'];
        }
        if (isset($body['osd_version']))           $e['osd_version']           = trim((string)$body['osd_version']);
        if (isset($body['index_patterns']) && is_array($body['index_patterns'])) {
            $ips = array_values(array_filter(array_map('trim', $body['index_patterns']), fn($v) => $v !== ''));
            $def = $e['default_index_pattern'] ?? '';
            if ($def && !in_array($def, $ips, true)) array_unshift($ips, $def);
            $e['index_patterns'] = $ips;
        }
        $touchedHost = strtolower((string)(parse_url($e['base_url'] ?? '', PHP_URL_HOST) ?: ''));
        $found = true;
        break;
    }
    unset($e);

    if (!$found) respondError('Endpoint not found', 404);
    _osConfigSave($cfg);
    if ($touchedHost !== '') hostCooldownClear($touchedHost);

    logActivity('opensearch_config_update', ['id' => $id], $payload['sub'], $payload['name']);
    respondOk(null, 'Updated');
}

// ── DELETE ?id=xxx ────────────────────────────────────────────────────────────
if ($method === 'DELETE') {
    requireCsrf();
    $id = $_GET['id'] ?? '';
    if (!$id) respondError('id is required');

    $cfg      = _osConfigLoad();
    $filtered = array_values(array_filter($cfg['endpoints'], fn($e) => ($e['id'] ?? '') !== $id));
    if (count($filtered) === count($cfg['endpoints'])) respondError('Endpoint not found', 404);
    $cfg['endpoints'] = $filtered;
    _osConfigSave($cfg);

    logActivity('opensearch_config_delete', ['id' => $id], $payload['sub'], $payload['name']);
    respondOk(null, 'Deleted');
}

// ── PATCH — update defaults (size / max_size / default_time_range_min) ───────
if ($method === 'PATCH') {
    requireCsrf();
    $body = getBody();
    $cfg  = _osConfigLoad();
    if (isset($body['size']))                   $cfg['defaults']['size']                   = max(10, min(2000, (int)$body['size']));
    if (isset($body['max_size']))               $cfg['defaults']['max_size']               = max(50, min(5000, (int)$body['max_size']));
    if (isset($body['default_time_range_min'])) $cfg['defaults']['default_time_range_min'] = max(1, min(1440, (int)$body['default_time_range_min']));
    _osConfigSave($cfg);
    logActivity('opensearch_config_defaults_update', $cfg['defaults'], $payload['sub'], $payload['name']);
    respondOk($cfg['defaults'], 'Defaults updated');
}

respondError('Method not allowed', 405);
