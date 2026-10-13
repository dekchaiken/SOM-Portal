<?php
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];

if ($method !== 'GET') {
    respondError('Method not allowed', 405);
}

// GET /api/my-team/ — returns team members with schedule_include=true.
// Visible to any authenticated user of the team. Excludes external role.
//
// Team resolution:
//   - regular users: locked to own $payload['team']
//   - super_admin / super_viewer: ?team=<slug> or X-Admin-Team header selects
//     a team; if neither is set, ALL teams are returned (unified roster).
$isGlobalRole = in_array($payload['role'], ['super_admin','super_viewer'], true);
$viewTeam     = null;   // null = all teams (super_admin unfiltered)

if ($isGlobalRole) {
    $ctxTeam = getRequestHeader('X-Admin-Team');
    $ctxTeam = ($ctxTeam && preg_match('/^[a-z0-9_-]+$/', $ctxTeam)) ? $ctxTeam : null;
    $paramTeam = isset($_GET['team']) ? trim((string)$_GET['team']) : '';
    // Empty / "all" means unfiltered
    if ($paramTeam !== '' && $paramTeam !== 'all') {
        $viewTeam = $paramTeam;
    } elseif ($ctxTeam) {
        $viewTeam = $ctxTeam;
    }
    // else: leave $viewTeam = null → all teams
} else {
    $viewTeam = $payload['team'] ?? null;
    if (!$viewTeam) respondError('No team context', 400);
}

$allUsers = readJson('users.json'); // global root file — filter by team field
// Exclude platform-level oversight roles (super_admin / super_viewer) — they
// aren't team members, they oversee. External users are already off-roster.
$offRoster = ['external', 'super_admin', 'super_viewer'];
$members  = array_values(array_filter($allUsers, function ($u) use ($viewTeam, $offRoster) {
    if (in_array($u['role'] ?? '', $offRoster, true)) return false;
    if (empty($u['team'] ?? '')) return false;
    if ($viewTeam !== null && ($u['team'] ?? '') !== $viewTeam) return false;
    return (bool)($u['schedule_include'] ?? true);
}));

$safe = array_map(fn ($u) => [
    'id'         => $u['id'],
    'name'       => $u['name'],
    'nickname'   => $u['nickname']   ?? '',
    'username'   => $u['username'],
    'email'      => $u['email']      ?? '',
    'role'       => $u['role'],
    'team'       => $u['team']       ?? '',
    'avatar_url' => $u['avatar_url'] ?? '',
    'name_th'    => $u['name_th']    ?? '',
    'emp_id'     => $u['emp_id']     ?? '',
    'phone'      => $u['phone']      ?? '',
    'tmn_id'     => $u['tmn_id']     ?? '',
    'net_home'   => $u['net_home']   ?? '',
    'net_mobile' => $u['net_mobile'] ?? '',
], $members);

respondOk([
    'team'      => $viewTeam,    // null when viewing all teams
    'all_teams' => ($viewTeam === null),
    'members'   => $safe,
    'me'        => $payload['sub'],
    'my_role'   => $payload['role'] ?? '',
]);
