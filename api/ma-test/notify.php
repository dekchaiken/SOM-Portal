<?php
/**
 * MA Test - Send Google Chat notification (SM-only)
 *
 * POST { webhook_id: string, message: string, kind?: "start"|"end" }
 *   → looks up the webhook URL from data/sm/ma-test-config.json
 *   → forwards the message to chat.googleapis.com via curl
 *
 * Threading:
 *   • kind="start" → generate a new threadKey, save it in the config so a
 *                    later "end" message can reply into the same thread.
 *   • kind="end"   → reuse the saved threadKey for this webhook (if <24h old)
 *                    so the "แจ้งเสร็จ" message threads under "แจ้งเริ่ม".
 *   • kind="" or absent → send as a top-level message (no threading).
 *
 * The webhook URL never leaves the server — non-admin SM members can pick a
 * destination by ID but never see the URL. Admin-only endpoint /config.php
 * manages the webhook list.
 */

require_once __DIR__ . '/../helpers.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') respondError('POST required', 405);

$payload = requireAuth();
requireSmTeamOnly('MA Test');
requireCsrf();

$body       = getBody();
$webhookId  = trim($body['webhook_id'] ?? '');
$message    = trim($body['message']    ?? '');
$kind       = trim($body['kind']       ?? '');
if ($webhookId === '') respondError('webhook_id required');
if ($message === '')   respondError('message required');
if ($kind !== '' && $kind !== 'start' && $kind !== 'end') $kind = '';

$cfg = readJson('ma-test-config.json');
$webhook = null;
foreach (($cfg['webhooks'] ?? []) as $w) {
    if ((string)($w['id'] ?? '') === $webhookId) { $webhook = $w; break; }
}
if (!$webhook || empty($webhook['url'])) respondError('Webhook not found', 404);
if (!preg_match('#^https://chat\.googleapis\.com/#', $webhook['url'])) {
    respondError('Invalid webhook URL on file', 500);
}

// ── Resolve threadKey based on `kind` ─────────────────────────
// Threads survive for THREAD_TTL seconds after the "start" message; after that
// an "end" message falls back to a new top-level message so a stale key from
// last month can't accidentally bury today's summary.
$THREAD_TTL = 86400; // 24h
$threadKey  = '';
$threads    = is_array($cfg['threads'] ?? null) ? $cfg['threads'] : [];

if ($kind === 'start') {
    $threadKey = 'matest_' . $webhookId . '_' . date('Ymd_His') . '_' . bin2hex(random_bytes(3));
    $threads[$webhookId] = [
        'key'        => $threadKey,
        'created_at' => date('Y-m-d H:i:s'),
        'started_by' => $payload['name'] ?? $payload['sub'],
    ];
    $cfg['threads'] = $threads;
    writeJson('ma-test-config.json', $cfg);
} elseif ($kind === 'end') {
    $t = $threads[$webhookId] ?? null;
    if ($t && !empty($t['key']) && !empty($t['created_at'])) {
        $age = time() - strtotime($t['created_at']);
        if ($age >= 0 && $age <= $THREAD_TTL) $threadKey = (string)$t['key'];
    }
}

// Build the request URL — add threading query params only when we have a key.
$targetUrl = $webhook['url'];
if ($threadKey !== '') {
    $sep = (strpos($targetUrl, '?') === false) ? '?' : '&';
    $targetUrl .= $sep
        . 'threadKey=' . rawurlencode($threadKey)
        . '&messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD';
}

$ch = curl_init($targetUrl);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => json_encode(['text' => $message], JSON_UNESCAPED_UNICODE),
    CURLOPT_HTTPHEADER     => ['Content-Type: application/json; charset=UTF-8'],
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_TIMEOUT        => 15,
]);
$resp   = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$err    = curl_error($ch);
curl_close($ch);

if ($err) respondError('Chat request failed: ' . $err, 502);
if ($status < 200 || $status >= 300) respondError('Chat webhook returned HTTP ' . $status, 502);

logActivity('ma_test_notify', [
    'webhook_id'   => $webhookId,
    'webhook_name' => $webhook['name'] ?? '',
    'kind'         => $kind ?: 'plain',
    'threaded'     => $threadKey !== '',
    'chars'        => mb_strlen($message),
], $payload['sub'], $payload['name'] ?? '');

respondOk([
    'sent'         => true,
    'webhook_name' => $webhook['name'] ?? '',
    'threaded'     => $threadKey !== '',
    'kind'         => $kind ?: 'plain',
], 'Chat message sent');
