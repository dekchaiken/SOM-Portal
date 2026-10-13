<?php
/**
 * n8n-oncall-config.php
 * GET  → return current n8n webhook URL config
 * POST { webhook_url } → save URL
 *
 * The config is global (see _isGlobalFile() in helpers.php) because the
 * webhook URL points to a single n8n workflow that serves every team's
 * dashboard. Mirrors the shape of n8n-severity-config.php.
 */
require_once __DIR__ . '/helpers.php';

$payload = requireAuth();

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $cfg = readJson('n8n_oncall_config.json');
    if (empty($cfg)) {
        writeJson('n8n_oncall_config.json', ['webhook_url' => '']);
        respondOk(['webhook_url' => ''], 'No config yet');
    }
    respondOk($cfg);
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    requireRole($payload, ADMIN_ROLES);
    requireCsrf();
    $body = getBody();
    $url  = trim($body['webhook_url'] ?? '');

    if (!$url) respondError('webhook_url required', 400);
    if (!filter_var($url, FILTER_VALIDATE_URL)) {
        respondError('webhook_url ต้องเป็น URL ที่ถูกต้อง', 400);
    }

    writeJson('n8n_oncall_config.json', [
        'webhook_url' => $url,
        'updated_at'  => date('Y-m-d H:i:s'),
        'updated_by'  => $payload['username'] ?? 'unknown',
    ]);
    logActivity('n8n_oncall_config_save', ['url' => $url]);
    respondOk(['webhook_url' => $url], 'บันทึกสำเร็จ');
}

respondError('Method not allowed', 405);
