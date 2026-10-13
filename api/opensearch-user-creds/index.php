<?php
// Per-user OpenSearch credentials — SM-only.
// Stores each user's own OpenSearch username + AES-256-CBC encrypted password
// so the proxy can authenticate as the user rather than a shared admin account.
//
// Storage: data/sm/opensearch_user_creds.json (SM scoped via requireSmTeamOnly)
// Shape: { "<user_id>": { "<endpoint_id>": { username, password_enc, saved_at } } }
//
// Password is encrypted with AES-256-CBC using a key derived from JWT_SECRET.
// The plaintext password never leaves this file after the POST completes.
require_once __DIR__ . '/../helpers.php';

const OS_USER_CREDS_FILE = 'opensearch_user_creds.json';

$payload = requireAuth();
requireSmTeamOnly('OpenSearch log viewer');

function _encOsPass(string $plain): string {
    $key = hash('sha256', JWT_SECRET, true);
    $iv  = random_bytes(16);
    $enc = openssl_encrypt($plain, 'AES-256-CBC', $key, OPENSSL_RAW_DATA, $iv);
    return base64_encode($iv . $enc);
}

function _decOsPass(string $b64): string {
    $key = hash('sha256', JWT_SECRET, true);
    $raw = base64_decode($b64);
    if (strlen($raw) < 17) return '';
    $iv  = substr($raw, 0, 16);
    $ct  = substr($raw, 16);
    return (string)openssl_decrypt($ct, 'AES-256-CBC', $key, OPENSSL_RAW_DATA, $iv);
}

function _loadUserCreds(): array {
    $d = readJson(OS_USER_CREDS_FILE);
    return is_array($d) ? $d : [];
}

function _validEndpointIds(): array {
    $cfg = readJson('opensearch_config.json');
    return array_column($cfg['endpoints'] ?? [], 'id');
}

$method = $_SERVER['REQUEST_METHOD'];
$userId = $payload['sub'];

// GET — list which endpoints this user has credentials for (password never returned)
if ($method === 'GET') {
    $creds   = _loadUserCreds();
    $userCreds = $creds[$userId] ?? [];
    $validIds  = _validEndpointIds();
    $out = [];
    foreach ($validIds as $epId) {
        $out[] = [
            'endpoint_id' => $epId,
            'has_creds'   => isset($userCreds[$epId]),
            'username'    => isset($userCreds[$epId]) ? ($userCreds[$epId]['username'] ?? null) : null,
            'saved_at'    => isset($userCreds[$epId]) ? ($userCreds[$epId]['saved_at'] ?? null) : null,
        ];
    }
    respondOk(['endpoints' => $out]);
}

// POST — save (or update) credentials for a specific endpoint
if ($method === 'POST') {
    requireCsrf();
    $body  = getBody();
    $epId  = trim($body['endpoint_id'] ?? '');
    $user  = trim($body['username']    ?? '');
    $pass  = (string)($body['password'] ?? '');

    if (!$epId) respondError('endpoint_id is required');
    if (!$user) respondError('username is required');
    if (!$pass) respondError('password is required');
    if (mb_strlen($user) > 120) respondError('username must be ≤120 characters');

    $validIds = _validEndpointIds();
    if (!in_array($epId, $validIds, true)) respondError('Unknown endpoint_id', 404);

    $creds = _loadUserCreds();
    if (!is_array($creds[$userId] ?? null)) $creds[$userId] = [];
    $creds[$userId][$epId] = [
        'username'     => $user,
        'password_enc' => _encOsPass($pass),
        'saved_at'     => time(),
    ];
    writeJson(OS_USER_CREDS_FILE, $creds);

    logActivity('opensearch_user_creds_save', ['endpoint_id' => $epId], $userId, $payload['name'] ?? '');
    respondOk(['endpoint_id' => $epId, 'username' => $user], 'Credentials saved');
}

// DELETE ?endpoint_id=xxx — remove saved credentials for an endpoint
if ($method === 'DELETE') {
    requireCsrf();
    $epId = trim($_GET['endpoint_id'] ?? '');
    if (!$epId) respondError('endpoint_id is required');

    $creds = _loadUserCreds();
    if (isset($creds[$userId][$epId])) {
        unset($creds[$userId][$epId]);
        if (empty($creds[$userId])) unset($creds[$userId]);
        writeJson(OS_USER_CREDS_FILE, $creds);
        logActivity('opensearch_user_creds_remove', ['endpoint_id' => $epId], $userId, $payload['name'] ?? '');
    }
    respondOk(null, 'Credentials removed');
}

respondError('Method not allowed', 405);
