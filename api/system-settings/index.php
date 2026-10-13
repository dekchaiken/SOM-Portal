<?php
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];
$file    = DATA_DIR . 'system-settings.json';

$defaults = [
    'site_name'                       => 'SOM-Portal',
    'site_tagline'                    => 'Service Operations Management',
    'session_timeout_hours'           => 8,
    'remember_me_days'                => 30,
    'password_expiry_days'            => 60,
    'password_history_count'          => 5,
    'max_login_attempts'              => 5,
    'lockout_minutes'                 => 15,
    // API rate limiting
    'api_rate_limit_requests'         => 120,
    'api_rate_limit_window_seconds'   => 60,
    // Soft delete / trash
    'trash_retention_days'            => 30,
    // Content
    'enable_markdown'                 => true,
    // Google Chat webhooks for broadcast + reminder features (arrays of URLs)
    'email_noti_chat_webhooks'        => [],
    'exam_reminder_chat_webhooks'     => [],
];

function getSettings(string $file, array $defaults): array {
    if (!file_exists($file)) return $defaults;
    return array_merge($defaults, json_decode(file_get_contents($file), true) ?? []);
}

// GET — any authenticated user (for site name etc)
if ($method === 'GET') {
    respondOk(getSettings($file, $defaults));
}

// PUT — admin only
if ($method === 'PUT') {
    requireCsrf();
    requireRole($payload, ADMIN_ROLES);
    $body    = getBody();
    $current = getSettings($file, $defaults);

    $stringKeys = ['site_name', 'site_tagline'];
    $intKeys    = ['session_timeout_hours', 'remember_me_days', 'password_expiry_days',
                   'password_history_count', 'max_login_attempts', 'lockout_minutes',
                   'api_rate_limit_requests', 'api_rate_limit_window_seconds',
                   'trash_retention_days'];
    $boolKeys   = ['enable_markdown'];

    foreach ($stringKeys as $k) {
        if (isset($body[$k])) {
            $v = trim((string)$body[$k]);
            if ($v !== '') $current[$k] = $v;
        }
    }
    foreach ($intKeys as $k) {
        if (isset($body[$k])) $current[$k] = max(1, (int)$body[$k]);
    }
    foreach ($boolKeys as $k) {
        if (isset($body[$k])) $current[$k] = (bool)$body[$k];
    }

    // Webhook URL arrays — validated + deduped
    $urlKeys = ['email_noti_chat_webhooks', 'exam_reminder_chat_webhooks'];
    foreach ($urlKeys as $k) {
        if (!isset($body[$k])) continue;
        $urls = (array)$body[$k];
        $clean = [];
        foreach ($urls as $u) {
            $u = trim((string)$u);
            if ($u === '') continue;
            if (!filter_var($u, FILTER_VALIDATE_URL)) continue;
            // Only accept Google Chat webhook hosts
            if (strpos($u, 'chat.googleapis.com') === false) continue;
            $clean[$u] = true; // dedup
        }
        $current[$k] = array_keys($clean);
    }

    // Guard clamps
    $current['session_timeout_hours']         = min(168,  max(1,   $current['session_timeout_hours']));
    $current['remember_me_days']              = min(90,   max(1,   $current['remember_me_days']));
    $current['password_expiry_days']          = min(365,  max(7,   $current['password_expiry_days']));
    $current['password_history_count']        = min(20,   max(1,   $current['password_history_count']));
    $current['max_login_attempts']            = min(20,   max(3,   $current['max_login_attempts']));
    $current['lockout_minutes']               = min(1440, max(5,   $current['lockout_minutes']));
    $current['api_rate_limit_requests']       = min(1000, max(10,  $current['api_rate_limit_requests']));
    $current['api_rate_limit_window_seconds'] = min(3600, max(10,  $current['api_rate_limit_window_seconds']));
    $current['trash_retention_days']          = min(365,  max(1,   $current['trash_retention_days']));

    writeJson('system-settings.json', $current);
    logActivity('settings_update', array_keys($body), $payload['sub'], $payload['name']);
    respondOk($current, 'Settings saved');
}

respondError('Method not allowed', 405);
