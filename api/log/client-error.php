<?php
require_once __DIR__ . '/../helpers.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respondError('Method not allowed', 405);
}

$payload = requireAuth(true);
$body    = getBody();

$type    = $body['type']    ?? 'js_error';
$message = trim($body['message'] ?? '');
$page    = trim($body['page']    ?? '');
$detail  = $body['detail']  ?? [];
$stack   = trim($body['stack']   ?? '');

$valid_types = ['js_error', 'api_error', 'unhandled_rejection'];
if (!in_array($type, $valid_types)) $type = 'js_error';

if (!$message) { respondOk(null, 'skipped'); }

// Truncate to prevent bloat
if (strlen($stack)   > 3000) $stack   = substr($stack,   0, 3000) . '…';
if (strlen($message) >  500) $message = substr($message, 0,  500) . '…';
if (strlen($page)    >  300) $page    = substr($page,    0,  300);

_appendLog('client-errors.json', [
    'id'        => genId('ce'),
    'ts'        => date('c'),
    'type'      => $type,
    'user_id'   => $payload['sub'],
    'user_name' => $payload['name'] ?? '',
    'ip'        => _getClientIp(),
    'ua'        => _getShortUA(),
    'page'      => $page,
    'message'   => $message,
    'stack'     => $stack ?: null,
    'detail'    => $detail ?: null,
], 3000);

respondOk(null, 'logged');
