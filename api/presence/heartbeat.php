<?php
require_once __DIR__ . '/../helpers.php';

// super_viewer heartbeats to stay online — allow write despite read-only role.
$payload = requireAuth(false, true);
if ($_SERVER['REQUEST_METHOD'] !== 'POST') respondError('Method not allowed', 405);
requireCsrf();

$body = getBody();
$page = trim($body['page'] ?? '');
if ($page === '') $page = 'unknown';
// keep it short — sanity limit
if (strlen($page) > 60) $page = substr($page, 0, 60);

$uid = $payload['sub'];

// Enrich with user profile fields for the office view
$users     = readJson('users.json');
$nickname  = '';
$avatar    = null;
foreach ($users as $u) {
    if (($u['id'] ?? '') === $uid) {
        $nickname = $u['nickname']   ?? '';
        $avatar   = $u['avatar_url'] ?? null;
        break;
    }
}

$presence = readJson('presence.json');
if (!is_array($presence)) $presence = [];

$now = time();
// prune stale (> 5 min) opportunistically
foreach ($presence as $k => $entry) {
    if (($entry['ts'] ?? 0) < $now - 300) unset($presence[$k]);
}

$presence[$uid] = [
    'user_id'    => $uid,
    'name'       => $payload['name']     ?? '',
    'nickname'   => $nickname,
    'role'       => $payload['role']     ?? '',
    'avatar_url' => $avatar,
    'page'       => $page,
    'ts'         => $now,
];

writeJson('presence.json', $presence);
respondOk(['ts' => $now]);
