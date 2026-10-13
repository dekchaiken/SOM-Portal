<?php
// ─── Team Config — SM / TS team member mapping ────────────────────────────
// GET  → return { SM: [emails], TS: [emails], updated_at }
//        Any authenticated staff can read (used by analytics dashboard)
// PUT  → replace SM / TS arrays (admin only)
require_once __DIR__ . '/../helpers.php';

$user   = requireAuth();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    requireRole($user, ALL_STAFF_ROLES);
    $cfg = readJson('team-config.json');
    if (empty($cfg)) $cfg = ['SM' => [], 'TS' => [], 'updated_at' => 0];
    respondOk($cfg);
}

if ($method === 'PUT' || $method === 'PATCH') {
    requireRole($user, ADMIN_ROLES);
    $body = getBody();
    $sm = isset($body['SM']) && is_array($body['SM']) ? $body['SM'] : [];
    $ts = isset($body['TS']) && is_array($body['TS']) ? $body['TS'] : [];

    // Normalize: lowercase, trim, unique, non-empty
    $norm = function(array $arr): array {
        $out = [];
        foreach ($arr as $v) {
            if (!is_string($v)) continue;
            $v = strtolower(trim($v));
            if ($v !== '') $out[] = $v;
        }
        return array_values(array_unique($out));
    };

    $next = [
        'SM'         => $norm($sm),
        'TS'         => $norm($ts),
        'updated_at' => time(),
    ];
    writeJson('team-config.json', $next);
    logActivity('team_config_update', [
        'sm_count' => count($next['SM']),
        'ts_count' => count($next['TS']),
    ], $user['sub'] ?? null, $user['name'] ?? null);
    respondOk($next, 'Team config saved');
}

respondError('Method not allowed', 405);
