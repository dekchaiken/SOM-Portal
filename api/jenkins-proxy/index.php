<?php
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/../jenkins_helpers.php';

$payload = requireAuth(); // Must be logged in to use proxy

$servers = jenkinsServers();

$method = $_SERVER['REQUEST_METHOD'];

// ── GET ?list=1 — return server list (display names only) ────────────────────
if ($method === 'GET' && isset($_GET['list'])) {
    $list = [];
    foreach ($servers as $id => $s) {
        $list[] = ['id' => $id, 'display' => $s['display'], 'base_url' => $s['base_url'], 'job_rules' => $s['job_rules'] ?? []];
    }
    respondOk($list);
}

// ── GET ?server=X&path=... — proxy Jenkins JSON API ──────────────────────────
if ($method === 'GET') {
    $serverId = trim($_GET['server'] ?? '');
    if (!$serverId || !isset($servers[$serverId])) respondError('Unknown server', 404);

    $path = '/' . ltrim(trim($_GET['path'] ?? '/api/json'), '/');

    // Security: only allow read-only Jenkins JSON API paths
    if (!str_ends_with($path, '/api/json')) {
        respondError('Only /api/json paths are allowed', 403);
    }
    if (preg_match('/\.\.|[<>"\'\s]/', $path)) {
        respondError('Invalid path characters', 400);
    }

    $qp = [];
    if (!empty($_GET['tree']))  $qp['tree']  = $_GET['tree'];
    if (!empty($_GET['depth'])) $qp['depth'] = (int)$_GET['depth'];
    $qs = $qp ? '?' . http_build_query($qp) : '';

    $server = $servers[$serverId];
    $url    = rtrim($server['base_url'], '/') . $path . $qs;

    [$body, $httpCode, $curlErr] = jenkinsRequest($server, $url);

    if ($curlErr)          respondError('Cannot reach Jenkins: ' . $curlErr, 502);
    if ($httpCode === 401) respondError('Jenkins rejected credentials — token may be invalid or expired', 422);
    if ($httpCode === 403) respondError('Jenkins access denied — cookie/session may have expired', 422);
    if ($httpCode === 404) respondError('Jenkins path not found (404)', 404);
    if ($httpCode !== 200) respondError("Jenkins returned HTTP {$httpCode}", 502);

    $data = json_decode($body, true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        respondError('Jenkins returned invalid JSON — may be a login redirect page', 502);
    }
    respondOk($data);
}

// ── POST ?action=build — trigger a Jenkins build ──────────────────────────────
if ($method === 'POST') {
    $action = trim($_GET['action'] ?? '');
    if ($action !== 'build') respondError('Unknown POST action', 400);

    $body     = getBody();
    $serverId = trim($body['server'] ?? '');
    $jobPath  = trim($body['path']   ?? '');
    $params   = $body['params'] ?? null;   // optional key-value array for parameterized builds

    if (!$serverId || !isset($servers[$serverId])) respondError('Unknown server', 404);

    // Security: job path must only contain /job/ segments with safe characters
    if (empty($jobPath) || !preg_match('#^(/job/[A-Za-z0-9_.%+\-]+)+$#', $jobPath)) {
        respondError('Invalid job path', 400);
    }

    $server = $servers[$serverId];
    $base   = rtrim($server['base_url'], '/');

    // 1. Try to get CSRF crumb (Jenkins may or may not require it)
    [$crumbBody, $crumbCode] = jenkinsRequest($server, $base . '/crumbIssuer/api/json');
    $crumbHeaders = [];
    if ($crumbCode === 200) {
        $crumbData = json_decode($crumbBody, true);
        if (!empty($crumbData['crumbRequestField']) && !empty($crumbData['crumb'])) {
            $crumbHeaders[] = $crumbData['crumbRequestField'] . ': ' . $crumbData['crumb'];
        }
    }

    // 2. POST to /buildWithParameters (if params given) or /build
    $hasParams = !empty($params) && is_array($params);
    $buildUrl  = $base . $jobPath . ($hasParams ? '/buildWithParameters' : '/build');
    $postBody  = $hasParams ? http_build_query($params) : '';
    $buildHdrs = $crumbHeaders;
    if ($hasParams) {
        $buildHdrs[] = 'Content-Type: application/x-www-form-urlencoded';
    }
    [, $buildCode, $buildErr] = jenkinsRequest($server, $buildUrl, 'POST', $postBody, $buildHdrs);

    if ($buildErr)           respondError('Cannot reach Jenkins: ' . $buildErr, 502);
    if ($buildCode === 401)  respondError('Jenkins rejected credentials — check token/cookie', 422);
    if ($buildCode === 403)  respondError('Access denied — insufficient Jenkins permissions', 422);
    if ($buildCode === 404)  respondError('Job not found', 404);
    // Jenkins returns 201 Created on success, 200 or 302 also acceptable
    if (!in_array($buildCode, [200, 201, 302])) {
        respondError("Jenkins returned HTTP {$buildCode}", 502);
    }

    logActivity('jenkins_build_trigger', ['server' => $serverId, 'job' => $jobPath], $payload['sub'], $payload['name']);
    respondOk(['queued' => true], 'Build queued successfully');
}

respondError('Method not allowed', 405);
