<?php
// GET/POST /api/alerts/notify-config.php
// Manages Google Chat webhook URLs by channel name. Named channels let
// alerts pick where to send ("sm-alerts" vs "sm-critical" etc.) without
// hardcoding URLs into rule storage.
//
// Response shape (GET): { channels: { <name>: { webhook_url, note } } }
// Webhook URL is redacted for non-SM readers to prevent leaks.
require_once __DIR__ . '/_lib.php';
$user = requireAuth();

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    requireSmForShared();
    $body = json_decode(file_get_contents('php://input'), true);
    if (!is_array($body) || !is_array($body['channels'] ?? null)) respondError('channels object required', 400);
    // Sanity check each channel — reject bogus URLs early instead of at
    // send time when the notification silently fails.
    foreach ($body['channels'] as $name => $ch) {
        if (!is_array($ch))                                           respondError("channel $name must be object", 400);
        $url = trim((string)($ch['webhook_url'] ?? ''));
        if ($url !== '' && !preg_match('#^https://chat\.googleapis\.com/#', $url)) {
            respondError("channel $name: webhook_url ต้องเป็น Google Chat URL (chat.googleapis.com)", 400);
        }
    }
    alertsSaveNotifyConfig(['channels' => $body['channels']]);
    respondOk(['saved' => true]);
    return;
}

// GET — return config. Redact webhook URL for non-SM viewers so shared
// webhooks aren't leaked into the browser of a viewer role.
$cfg  = alertsLoadNotifyConfig();
$isSm = ($user['team'] ?? '') === 'sm' || in_array($user['role'] ?? '', ['super_admin'], true);
if (!$isSm) {
    foreach ($cfg['channels'] as $name => &$ch) {
        if (!empty($ch['webhook_url'])) $ch['webhook_url'] = '[redacted]';
    }
    unset($ch);
}
respondOk($cfg);
