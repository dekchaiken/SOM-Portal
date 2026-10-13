<?php
/**
 * GET  /api/dev-subteams/ → list dev sub-teams (any authenticated user)
 * POST /api/dev-subteams/ → add sub-team    (sm_admin / dev_sm / super_admin)
 * PUT  /api/dev-subteams/ → replace full list (sm_admin / dev_sm / super_admin)
 * DELETE /api/dev-subteams/?name= → remove sub-team (sm_admin / dev_sm / super_admin)
 */
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];

// Sub-teams live in the dev team's data directory
$GLOBALS['_current_team'] = 'dev';

if ($method === 'GET') {
    $list = readJson('subteams.json');
    if (!is_array($list)) $list = [];
    sort($list);
    respondOk($list);
}

requireRole($payload, ADMIN_ROLES);
requireCsrf();

if ($method === 'POST') {
    $body = getBody();
    $name = trim($body['name'] ?? '');
    if (!$name) respondError('name is required');
    if (mb_strlen($name) > 60) respondError('name too long (max 60 chars)');

    $list = readJson('subteams.json');
    if (!is_array($list)) $list = [];
    if (in_array($name, $list, true)) respondError("'{$name}' already exists", 409);

    $list[] = $name;
    sort($list);
    writeJson('subteams.json', $list);
    logActivity('dev_subteam_add', ['name' => $name], $payload['sub'], $payload['name'] ?? '');
    respondOk($list, "Sub-team '{$name}' added");
}

if ($method === 'PUT') {
    $body = getBody();
    $list = $body['list'] ?? [];
    if (!is_array($list)) respondError('list must be an array');
    $clean = array_values(array_unique(array_filter(array_map('trim', $list), fn($s) => $s !== '' && mb_strlen($s) <= 60)));
    sort($clean);
    writeJson('subteams.json', $clean);
    logActivity('dev_subteam_replace', ['count' => count($clean)], $payload['sub'], $payload['name'] ?? '');
    respondOk($clean, 'Sub-team list updated');
}

if ($method === 'DELETE') {
    $name = trim($_GET['name'] ?? '');
    if (!$name) respondError('name is required');

    $list = readJson('subteams.json');
    if (!is_array($list)) $list = [];
    if (!in_array($name, $list, true)) respondError("'{$name}' not found", 404);

    $list = array_values(array_filter($list, fn($s) => $s !== $name));
    writeJson('subteams.json', $list);
    logActivity('dev_subteam_remove', ['name' => $name], $payload['sub'], $payload['name'] ?? '');
    respondOk($list, "Sub-team '{$name}' removed");
}

respondError('Method not allowed', 405);
