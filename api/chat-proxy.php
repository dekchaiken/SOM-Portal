<?php
/**
 * chat-proxy.php
 * Server-side proxy for Google Chat webhooks (bypasses browser CSP restrictions)
 * POST { webhook: string, message: string }
 */
require_once __DIR__ . '/helpers.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') respondError('POST required', 405);
requireAuth();

$body    = getBody();
$webhook = trim($body['webhook'] ?? '');
$message = trim($body['message'] ?? '');

if (!$webhook) respondError('webhook URL required', 400);
if (!$message) respondError('message required', 400);
if (!preg_match('#^https://chat\.googleapis\.com/#', $webhook))
    respondError('Invalid webhook URL — must start with https://chat.googleapis.com/', 400);

$ch = curl_init($webhook);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => json_encode(['text' => $message]),
    CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_TIMEOUT        => 15,
]);
$resp   = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$err    = curl_error($ch);
curl_close($ch);

if ($err) respondError('Chat request failed: ' . $err, 502);
if ($status < 200 || $status >= 300)
    respondError('Chat webhook returned HTTP ' . $status, 502);

respondOk(['sent' => true], 'Chat message sent');
