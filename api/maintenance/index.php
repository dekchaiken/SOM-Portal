<?php
require_once __DIR__ . '/../helpers.php';

$method = $_SERVER['REQUEST_METHOD'];

$empty = [
    'global' => ['active' => false, 'message' => 'ระบบปิดปรับปรุงชั่วคราว', 'eta' => null, 'by_name' => null, 'at' => null],
    'pages'  => (object)[],
    'tools'  => (object)[],
];

// ── GET — public, no auth required (needed for login-page MA check) ───────────
if ($method === 'GET') {
    $ma = readJson('maintenance.json');
    if (!$ma) $ma = $empty;
    respondOk($ma);
}

// ── PUT — super_admin only ────────────────────────────────────────────────────
// Maintenance affects every team on the platform, so writes are locked to the
// platform-level role even though other admin pages allow sm_admin/dev_sm.
if ($method === 'PUT') {
    requireCsrf();
    $payload = requireAuth();
    requireRole($payload, [SUPER_ADMIN_ROLE]);

    $body  = json_decode(file_get_contents('php://input'), true) ?: [];
    $scope = $body['scope'] ?? '';

    $ma = readJson('maintenance.json') ?: $empty;
    if (empty($ma['pages']))  $ma['pages']  = [];
    if (empty($ma['tools']))  $ma['tools']  = [];

    if ($scope === 'global') {
        $active = (bool)($body['active'] ?? false);
        $ma['global']['active']  = $active;
        $ma['global']['message'] = $body['message'] ?? 'ระบบปิดปรับปรุงชั่วคราว';
        $ma['global']['eta']     = $body['eta'] ?: null;
        if ($active) {
            $ma['global']['by_name'] = $payload['name'];
            $ma['global']['at']      = date('c');
        } else {
            $ma['global']['by_name'] = null;
            $ma['global']['at']      = null;
        }
        logActivity('maintenance_global', ['active' => $active], $payload['sub'], $payload['name']);

    } elseif ($scope === 'page') {
        $id = $body['id'] ?? '';
        if (!$id) respondError('Page ID required');
        $ma['pages'][$id] = [
            'active'  => (bool)($body['active'] ?? false),
            'message' => $body['message'] ?? '',
        ];
        logActivity('maintenance_page', ['id' => $id, 'active' => $body['active'] ?? false], $payload['sub'], $payload['name']);

    } elseif ($scope === 'tool') {
        $id = $body['id'] ?? '';
        if (!$id) respondError('Tool ID required');
        $ma['tools'][$id] = [
            'active'  => (bool)($body['active'] ?? false),
            'message' => $body['message'] ?? '',
        ];
        logActivity('maintenance_tool', ['id' => $id, 'active' => $body['active'] ?? false], $payload['sub'], $payload['name']);

    } else {
        respondError('Invalid scope — use global | page | tool');
    }

    writeJson('maintenance.json', $ma);
    respondOk($ma, 'Updated');
}

respondError('Method not allowed', 405);
