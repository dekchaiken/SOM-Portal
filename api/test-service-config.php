<?php
/**
 * test-service-config.php
 * ─────────────────────────────────────────────────
 * GET  ?action=get-groups           → service groups (all auth users)
 * GET  ?action=get-reconcile-status → {configured:bool} (admin)
 * POST ?action=save-groups          → save groups (admin)
 * POST ?action=save-reconcile       → save reconcile creds (admin)
 */
require_once __DIR__ . '/helpers.php';

$action  = $_GET['action'] ?? '';
$payload = requireAuth();

// ── get-groups: any authenticated user ────────────────────────
if ($action === 'get-groups') {
    $config = readJson('test-service-config.json');
    respondOk($config['groups'] ?? []);
}

// ── get-reconcile-credentials: any authenticated user ─────────
if ($action === 'get-reconcile-credentials') {
    $cfg = readJson('reconcile-config.json');
    if (empty($cfg['username']) || empty($cfg['password'])) {
        respondError('Reconcile credentials not configured by admin', 400);
    }
    respondOk([
        'username' => $cfg['username'],
        'password' => $cfg['password'],
    ]);
}

// ── get-all-settings: any authenticated user ──────────────────
if ($action === 'get-all-settings') {
    $config = readJson('test-service-config.json');
    respondOk([
        'step1' => $config['step1_settings'] ?? [],
        'step2' => $config['step2_settings'] ?? [],
        'step3' => $config['step3_settings'] ?? [],
    ]);
}

// ── Admin-only below ──────────────────────────────────────────
requireRole($payload, ADMIN_ROLES);

// ── get-reconcile-status ──────────────────────────────────────
if ($action === 'get-reconcile-status') {
    $cfg = readJson('reconcile-config.json');
    respondOk([
        'configured' => !empty($cfg['username']) && !empty($cfg['password']),
        'username'   => $cfg['username'] ?? '',
    ]);
}

// ── save-groups ───────────────────────────────────────────────
if ($action === 'save-groups') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') respondError('POST required', 405);
    $body = getBody();
    if (!isset($body['groups']) || !is_array($body['groups'])) {
        respondError('groups array required', 400);
    }

    $groups = [];
    foreach ($body['groups'] as $g) {
        $id    = preg_replace('/[^a-z0-9_]/', '_', strtolower(trim($g['id'] ?? '')));
        $name  = trim($g['name'] ?? '');
        if (!$id || !$name) continue;
        $children = array_values(array_filter(array_map('trim', $g['children'] ?? [])));
        $brand = in_array($g['brand'] ?? '', ['tmn', 'vb']) ? $g['brand'] : 'tmn';
        $groups[] = compact('id', 'name', 'children', 'brand');
    }

    $config = readJson('test-service-config.json');
    $config['groups']     = $groups;
    $config['updated_at'] = date('c');
    $config['updated_by'] = $payload['name'] ?? $payload['sub'];
    writeJson('test-service-config.json', $config);

    logActivity('test_service_groups_saved', [
        'group_count' => count($groups),
    ], $payload['sub'], $payload['name'] ?? '');

    respondOk(['group_count' => count($groups)]);
}

// ── save-reconcile ────────────────────────────────────────────
if ($action === 'save-reconcile') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') respondError('POST required', 405);
    $body = getBody();
    if (empty($body['username']) || empty($body['password'])) {
        respondError('username and password required', 400);
    }

    writeJson('reconcile-config.json', [
        'username' => trim($body['username']),
        'password' => $body['password'],
    ]);

    logActivity('reconcile_credentials_saved', [
        'username' => trim($body['username']),
    ], $payload['sub'], $payload['name'] ?? '');

    respondOk();
}

// ── get-all-settings (admin): moved above for all users ───────
// (already defined above as non-admin endpoint)

// ── save-step1-settings ───────────────────────────────────────
if ($action === 'save-step1-settings') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') respondError('POST required', 405);
    $body = getBody();
    
    $config = readJson('test-service-config.json');
    $config['step1_settings'] = $body;
    $config['updated_at'] = date('c');
    $config['updated_by'] = $payload['name'] ?? $payload['sub'];
    writeJson('test-service-config.json', $config);

    logActivity('step1_settings_saved', [], $payload['sub'], $payload['name'] ?? '');
    respondOk();
}

// ── save-step2-settings ───────────────────────────────────────
if ($action === 'save-step2-settings') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') respondError('POST required', 405);
    $body = getBody();
    
    $config = readJson('test-service-config.json');
    $config['step2_settings'] = $body;
    $config['updated_at'] = date('c');
    $config['updated_by'] = $payload['name'] ?? $payload['sub'];
    writeJson('test-service-config.json', $config);

    logActivity('step2_settings_saved', [], $payload['sub'], $payload['name'] ?? '');
    respondOk();
}

// ── save-step3-settings ───────────────────────────────────────
if ($action === 'save-step3-settings') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') respondError('POST required', 405);
    $body = getBody();
    
    $config = readJson('test-service-config.json');
    $config['step3_settings'] = $body;
    $config['updated_at'] = date('c');
    $config['updated_by'] = $payload['name'] ?? $payload['sub'];
    writeJson('test-service-config.json', $config);

    logActivity('step3_settings_saved', [], $payload['sub'], $payload['name'] ?? '');
    respondOk();
}

respondError('Invalid action', 400);
