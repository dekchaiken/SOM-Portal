<?php
// GenZ Team — SM-only role marker managed by sm_admin.
// `is_genz` is a boolean flag stamped on sm_user records inside the SM team.
// It grants a special hub page + UI badge/theme but does NOT change access.
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];

// Hard-lock to SM team. GenZ is an SM-only concept.
$actorTeam = $payload['team'] ?? null;
if ($actorTeam !== 'sm') {
    respondError('GenZ Team is available for SM team only', 403);
}

if ($method === 'GET') {
    // Any authenticated SM member can read the list (for hub roster).
    $allUsers = readJson('users.json');
    $sm = array_values(array_filter($allUsers, fn($u) => ($u['team'] ?? '') === 'sm'));
    $out = array_map(fn($u) => [
        'id'       => $u['id'],
        'name'     => $u['name'],
        'nickname' => $u['nickname'] ?? '',
        'username' => $u['username'],
        'role'     => $u['role'],
        'avatar_url' => $u['avatar_url'] ?? null,
        'is_genz'  => (bool)($u['is_genz'] ?? false),
    ], $sm);
    respondOk($out);
}

if ($method === 'PATCH') {
    requireCsrf();
    requireRole($payload, ['sm_admin', 'dev_sm']);
    $id = $_GET['id'] ?? '';
    if (!$id) respondError('User ID required');

    $body   = getBody();
    $flag   = (bool)($body['is_genz'] ?? false);
    $users  = readJson('users.json');
    $found  = false;
    $target = null;

    foreach ($users as &$u) {
        if ($u['id'] === $id) {
            if (($u['team'] ?? '') !== 'sm') respondError('User is not in SM team', 400);
            $u['is_genz'] = $flag;
            $found  = true;
            $target = $u;
            break;
        }
    }
    unset($u);

    if (!$found) respondError('User not found', 404);
    writeJson('users.json', $users);
    logActivity('genz_team_toggle', [
        'target_id' => $id,
        'username'  => $target['username'] ?? '',
        'is_genz'   => $flag,
    ], $payload['sub'], $payload['name'] ?? '');

    respondOk(['id' => $id, 'is_genz' => $flag], $flag ? 'Added to GenZ Team' : 'Removed from GenZ Team');
}

respondError('Method not allowed', 405);
