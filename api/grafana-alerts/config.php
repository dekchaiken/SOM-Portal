<?php
/**
 * /api/grafana-alerts/config.php — Admin config for the Grafana paused-alerts
 * daily digest (admin/grafana-alerts-config.html).
 *
 * Storage: data/sm/grafana-alerts-config.json
 *   { "webhookUrl": "...", "enabled": true, "notifyHour": 9,
 *     "updatedAt": "...", "updatedBy": "..." }
 *
 * Routes:
 *   GET   /                 → current config (webhook masked) + source list
 *   PUT   /                 → save { webhookUrl?, enabled?, notifyHour? }  (admin)
 *   POST  /?action=test     → send a live test digest to the saved webhook  (admin)
 *
 * All admin writes require CSRF.
 */

require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/_fetch.php';
require_once __DIR__ . '/_notify.php';

// Mask a webhook URL for display without exposing key/token query params.
function gaMaskWebhook(string $url): string {
    if ($url === '') return '';
    $parts = parse_url($url);
    if (!$parts || empty($parts['host'])) return '***';
    $scheme = $parts['scheme'] ?? 'https';
    $host   = $parts['host'];
    $path   = $parts['path'] ?? '';
    if (strlen($path) > 24) $path = substr($path, 0, 18) . '…';
    return "{$scheme}://{$host}{$path}?…";
}

// ── GET: current config + sources ────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $payload = requireAuth();
    requireRole($payload, ADMIN_ROLES);

    $cfg     = gaLoadNotifyConfig();
    $sources = gaLoadSources();

    $srcRows = array_map(fn($s) => [
        'name'  => $s['name']  ?? '',
        'slug'  => $s['slug']  ?? '',
        'orgId' => (int)($s['orgId'] ?? 0),
        'color' => $s['color'] ?? '',
    ], $sources);

    respondOk([
        'enabled'     => $cfg['enabled'],
        'notifyHour'  => $cfg['notifyHour'],
        'hasWebhook'  => $cfg['webhookUrl'] !== '',
        'maskedUrl'   => gaMaskWebhook($cfg['webhookUrl']),
        'updatedAt'   => $cfg['updatedAt'],
        'updatedBy'   => $cfg['updatedBy'],
        'sources'     => $srcRows,
    ]);
}

// ── PUT: save config ─────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'PUT') {
    $payload = requireAuth();
    requireRole($payload, ADMIN_ROLES);
    requireCsrf();

    $body = getBody();
    $store = readJson(GA_CONFIG_FILE);
    if (!is_array($store)) $store = [];

    // webhookUrl: only overwrite when a non-empty value is supplied (so the admin
    // can toggle enabled/hour without re-pasting the secret). Empty string clears it.
    if (array_key_exists('webhookUrl', $body)) {
        $url = trim((string)$body['webhookUrl']);
        if ($url !== '' && !filter_var($url, FILTER_VALIDATE_URL)) {
            respondError('webhookUrl must be a valid URL', 400);
        }
        $store['webhookUrl'] = $url;
    }

    if (array_key_exists('enabled', $body)) {
        $store['enabled'] = (bool)$body['enabled'];
    }

    if (array_key_exists('notifyHour', $body)) {
        $h = (int)$body['notifyHour'];
        if ($h < 0 || $h > 23) respondError('notifyHour must be 0-23', 400);
        $store['notifyHour'] = $h;
    }

    $store['updatedAt'] = date('c');
    $store['updatedBy'] = $payload['username'] ?? 'unknown';

    if (!writeJson(GA_CONFIG_FILE, $store)) respondError('Failed to write config', 500);

    logActivity('grafana_alerts_config_save', [
        'enabled'    => $store['enabled']    ?? null,
        'notifyHour' => $store['notifyHour'] ?? null,
        'hasWebhook' => !empty($store['webhookUrl']),
    ]);

    $cfg = gaLoadNotifyConfig();
    respondOk([
        'enabled'    => $cfg['enabled'],
        'notifyHour' => $cfg['notifyHour'],
        'hasWebhook' => $cfg['webhookUrl'] !== '',
        'maskedUrl'  => gaMaskWebhook($cfg['webhookUrl']),
    ], 'Saved');
}

// ── POST: test-send a live digest ────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $payload = requireAuth();
    requireRole($payload, ADMIN_ROLES);
    requireCsrf();

    if (($_GET['action'] ?? '') !== 'test') respondError('Unknown action', 400);

    $cfg = gaLoadNotifyConfig();
    if ($cfg['webhookUrl'] === '') {
        respondError('No webhook URL configured — save one first', 400);
    }

    set_time_limit(60);
    try {
        $data = gaFetchPausedAlerts();
    } catch (RuntimeException $e) {
        respondError($e->getMessage(), 500);
    }

    // gaSendChatCard bypasses the once-per-day history guard so tests always send.
    $result = gaSendChatCard($cfg['webhookUrl'], $data);

    logActivity('grafana_alerts_test_send', [
        'total' => (int)($data['total'] ?? 0),
        'sent'  => $result['sent'] ?? false,
    ]);

    if (!($result['sent'] ?? false)) {
        respondError('Test send failed: ' . ($result['reason'] ?? 'unknown'), 502);
    }
    respondOk([
        'total'    => (int)($data['total'] ?? 0),
        'httpCode' => $result['httpCode'] ?? 200,
    ], 'Test digest sent');
}

respondError('Method not allowed', 405);
