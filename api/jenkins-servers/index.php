<?php
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
requireRole($payload, ADMIN_ROLES); // Admin only

$method = $_SERVER['REQUEST_METHOD'];

// ── GET — list all servers (with credentials, admin only) ─────────────────────
if ($method === 'GET') {
    $servers = readJson('jenkins_servers.json');
    usort($servers, fn($a, $b) => ($a['order'] ?? 99) <=> ($b['order'] ?? 99));
    respondOk($servers);
}

// ── POST — create server ───────────────────────────────────────────────────────
if ($method === 'POST') {
    requirePageMode($payload, 'jenkins-servers');
    requireCsrf();
    $body = getBody();

    $display    = trim($body['display']     ?? '');
    $base_url   = trim($body['base_url']    ?? '');
    $auth_mode  = in_array($body['auth_mode'] ?? '', ['token','cookie']) ? $body['auth_mode'] : 'token';
    $auth_user  = trim($body['auth_user']   ?? '');
    $auth_token = trim($body['auth_token']  ?? '');
    $auth_cookie= trim($body['auth_cookie'] ?? '');
    $enabled    = ($body['enabled'] ?? true) !== false;
    $order      = isset($body['order']) ? (int)$body['order'] : 99;

    if (!$display)  respondError('Display name is required');
    if (!$base_url) respondError('Base URL is required');

    $servers = readJson('jenkins_servers.json');

    $raw_rules = $body['job_rules'] ?? [];
    $job_rules = is_array($raw_rules) ? array_values(array_filter($raw_rules, fn($r) =>
        isset($r['pattern'], $r['type']) && in_array($r['type'], ['ignore','remark'])
    )) : [];

    // Optional IP override — bypasses system DNS via CURLOPT_RESOLVE. Basic
    // shape check only; helpers.php ignores empty values so bad input just
    // means the override is silently skipped.
    $ip_override = trim($body['ip_override'] ?? '');
    if ($ip_override !== '' && !filter_var($ip_override, FILTER_VALIDATE_IP)) {
        respondError('IP Override must be a valid IPv4/IPv6 address');
    }

    $new = [
        'id'          => genId('jsrv'),
        'display'     => $display,
        'base_url'    => rtrim($base_url, '/'),
        'auth_mode'   => $auth_mode,
        'auth_user'   => $auth_user,
        'auth_token'  => $auth_token,
        'auth_cookie' => $auth_cookie,
        'enabled'     => $enabled,
        'order'       => $order ?: (count($servers) + 1),
        'job_rules'   => $job_rules,
        'ip_override' => $ip_override,
    ];

    $servers[] = $new;
    writeJson('jenkins_servers.json', $servers);

    // Wipe any stale cooldown for this host so the fresh IP override probes
    // immediately instead of waiting up to 30s for the old failure to expire.
    if ($ip_override !== '') {
        hostCooldownClear(strtolower((string)(parse_url($new['base_url'], PHP_URL_HOST) ?: '')));
    }

    logActivity('jenkins_server_create', ['id' => $new['id'], 'display' => $display], $payload['sub'], $payload['name']);
    respondOk($new, 'Jenkins server added');
}

// ── PUT ?id=xxx — update server ───────────────────────────────────────────────
if ($method === 'PUT') {
    requirePageMode($payload, 'jenkins-servers');
    requireCsrf();
    $id = $_GET['id'] ?? '';
    if (!$id) respondError('Server ID required');

    $body    = getBody();
    $servers = readJson('jenkins_servers.json');
    $found   = false;

    // Validate ip_override up front so we don't half-apply other fields.
    if (isset($body['ip_override'])) {
        $ipVal = trim((string)$body['ip_override']);
        if ($ipVal !== '' && !filter_var($ipVal, FILTER_VALIDATE_IP)) {
            respondError('IP Override must be a valid IPv4/IPv6 address');
        }
    }

    $touchedHost = '';
    foreach ($servers as &$s) {
        if ($s['id'] !== $id) continue;
        if (isset($body['display']))     $s['display']     = trim($body['display']);
        if (isset($body['base_url']))    $s['base_url']    = rtrim(trim($body['base_url']), '/');
        if (isset($body['auth_mode']) && in_array($body['auth_mode'], ['token','cookie']))
                                         $s['auth_mode']   = $body['auth_mode'];
        if (isset($body['auth_user']))   $s['auth_user']   = trim($body['auth_user']);
        if (isset($body['auth_token']))  $s['auth_token']  = trim($body['auth_token']);
        if (isset($body['auth_cookie'])) $s['auth_cookie'] = trim($body['auth_cookie']);
        if (isset($body['enabled']))     $s['enabled']     = (bool)$body['enabled'];
        if (isset($body['order']))       $s['order']       = (int)$body['order'];
        if (isset($body['ip_override'])) $s['ip_override'] = trim((string)$body['ip_override']);
        if (isset($body['job_rules']) && is_array($body['job_rules'])) {
            $s['job_rules'] = array_values(array_filter($body['job_rules'], fn($r) =>
                isset($r['pattern'], $r['type']) && in_array($r['type'], ['ignore','remark'])
            ));
        }
        $touchedHost = strtolower((string)(parse_url($s['base_url'] ?? '', PHP_URL_HOST) ?: ''));
        $found = true;
        break;
    }
    unset($s);

    if (!$found) respondError('Server not found', 404);
    writeJson('jenkins_servers.json', $servers);

    // Clear the host's cooldown so the next request probes with the (possibly
    // updated) override immediately instead of waiting out the last failure.
    if ($touchedHost !== '') hostCooldownClear($touchedHost);

    logActivity('jenkins_server_update', ['id' => $id], $payload['sub'], $payload['name']);
    respondOk(null, 'Updated');
}

// ── DELETE ?id=xxx ─────────────────────────────────────────────────────────────
if ($method === 'DELETE') {
    requirePageMode($payload, 'jenkins-servers');
    requireCsrf();
    $id = $_GET['id'] ?? '';
    if (!$id) respondError('Server ID required');

    $servers  = readJson('jenkins_servers.json');
    $filtered = array_values(array_filter($servers, fn($s) => $s['id'] !== $id));

    if (count($filtered) === count($servers)) respondError('Server not found', 404);
    writeJson('jenkins_servers.json', $filtered);
    logActivity('jenkins_server_delete', ['id' => $id], $payload['sub'], $payload['name']);
    respondOk(null, 'Deleted');
}

respondError('Method not allowed', 405);
