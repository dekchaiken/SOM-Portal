<?php
/**
 * pw-schedule/notify-text.php
 *
 * POST { message: string, item_id?: string }
 *   → send an arbitrary text message to the Google Chat webhook configured
 *     in data/pw_schedule_config.json (google_chat_webhook).
 *
 * Distinct from notify.php (which sends the full round summary as cards).
 * Used by the "📢 Template" button on pw-schedule.html so the user can
 * publish a hand-edited announcement message to the same room.
 *
 * The item_id is optional and only used for the activity log so we can
 * trace back which PW the announcement was about.
 */

require_once __DIR__ . '/../helpers.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') respondError('POST required', 405);

$payload = requireAuth();
requireCsrf();

$body    = getBody();
$message = trim((string)($body['message'] ?? ''));
$itemId  = trim((string)($body['item_id'] ?? ''));
if ($message === '') respondError('message required', 400);
if (mb_strlen($message) > 4000) respondError('message too long (>4000 chars)', 400);

$cfg     = readJson('pw_schedule_config.json');
$webhook = trim($cfg['google_chat_webhook'] ?? '');
if ($webhook === '') respondError('Google Chat webhook not configured — set it at admin/pw-schedule.html', 400);
if (!preg_match('#^https://chat\.googleapis\.com/#', $webhook)) {
    respondError('Configured webhook is not a chat.googleapis.com URL', 500);
}

$ch = curl_init($webhook);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => json_encode(['text' => $message], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
    CURLOPT_HTTPHEADER     => ['Content-Type: application/json; charset=UTF-8'],
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_TIMEOUT        => 15,
]);
$resp = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$err  = curl_error($ch);
curl_close($ch);

if ($err) {
    logIntegrationError('google-chat-webhook', $webhook, $err, [
        'http_code' => $code,
        'source'    => 'pw-schedule-notify-text',
    ]);
    respondError('Chat request failed: ' . $err, 502);
}
if ($code < 200 || $code >= 300) {
    logIntegrationError('google-chat-webhook', $webhook, "HTTP {$code}", [
        'http_code' => $code,
        'body'      => substr((string)$resp, 0, 200),
        'source'    => 'pw-schedule-notify-text',
    ]);
    respondError('Chat webhook returned HTTP ' . $code, 502);
}

logActivity('pw_notify_text', [
    'item_id' => $itemId,
    'chars'   => mb_strlen($message),
], $payload['sub'], $payload['name'] ?? '');

respondOk(['sent' => true], 'Chat message sent');
