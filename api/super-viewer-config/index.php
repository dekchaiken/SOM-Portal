<?php
// Super Viewer Config API
// GET  /api/super-viewer-config/  → read denied pages (any authenticated user)
// PATCH /api/super-viewer-config/ → update denied pages (super_admin only)
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'] ?? 'GET';

$DEFAULTS = [
    'ma-test','inbox','batch-monitor','batch-file-search',
    'monitoring','syncup','uptime','test-service',
    'restart-analyzer','log-explorer','incident-launcher','begin-grafana',
    'genz-hub','genz-notes',
];

if ($method === 'GET') {
    $cfg = readJson('super-viewer-config.json');  // global file
    if (empty($cfg) || !isset($cfg['denied_pages'])) {
        $cfg = ['denied_pages' => $DEFAULTS, 'updated_at' => null, 'updated_by' => null];
    }
    respondOk($cfg);
}

if ($method === 'PATCH') {
    requireRole($payload, ['super_admin']);
    requireCsrf();

    $body = getBody();
    if (!isset($body['denied_pages']) || !is_array($body['denied_pages'])) {
        respondError('denied_pages array required', 400);
    }

    $denied = array_values(array_unique(array_filter(
        array_map(fn($p) => preg_replace('/[^a-z0-9_-]/', '', strtolower($p)), $body['denied_pages'])
    )));

    $cfg = [
        'denied_pages' => $denied,
        'updated_at'   => date('c'),
        'updated_by'   => $payload['name'] ?? $payload['sub'] ?? '',
    ];

    writeJson('super-viewer-config.json', $cfg);
    logActivity('super_viewer_config_update', ['denied_count' => count($denied)], $payload['sub'] ?? '', $payload['name'] ?? '');
    respondOk($cfg, 'Super viewer config updated');
}

http_response_code(405);
echo json_encode(['ok' => false, 'error' => 'Method not allowed']);
