<?php
/**
 * Public client-error logger — accepts errors from unauthenticated pages
 * (login.html, forgot-password.html, reset-password.html, or any page where
 * the token has expired). Every entry lands in client-errors.json tagged as
 * user_id = 'anonymous'.
 *
 * Public endpoint → aggressively rate-limited by IP and hard-truncated to
 * keep it from becoming a spam / disk-fill vector.
 */
require_once __DIR__ . '/../helpers.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respondError('Method not allowed', 405);
}

$ip = _getClientIp();

// ── IP rate limit: 5 posts / 60s per IP ───────────────────────────────────
// Uses a tiny JSON keyed by IP; entries older than the window are pruned.
// Global (not per-team) since these come in without a team context.
const CE_PUB_MAX_PER_MIN = 5;
const CE_PUB_WINDOW      = 60;

$rateFile = DATA_DIR . 'client_error_rate.json';
$now      = time();
$fp       = fopen($rateFile, 'c+');
if ($fp && flock($fp, LOCK_EX)) {
    $raw   = stream_get_contents($fp);
    $rates = ($raw && $raw[0] === '{') ? (json_decode($raw, true) ?? []) : [];

    // Prune expired windows (keep file small)
    foreach ($rates as $k => $v) {
        if (($v['resetAt'] ?? 0) < $now) unset($rates[$k]);
    }

    $entry = $rates[$ip] ?? ['count' => 0, 'resetAt' => $now + CE_PUB_WINDOW];
    if ($entry['resetAt'] < $now) {
        $entry = ['count' => 0, 'resetAt' => $now + CE_PUB_WINDOW];
    }
    $entry['count']++;
    $rates[$ip] = $entry;

    ftruncate($fp, 0); rewind($fp);
    fwrite($fp, json_encode($rates));
    flock($fp, LOCK_UN);
    fclose($fp);

    if ($entry['count'] > CE_PUB_MAX_PER_MIN) {
        // Silently drop — return 200 so attacker can't detect rate limit
        respondOk(null, 'rate_limited');
    }
}

$body = json_decode(file_get_contents('php://input'), true) ?? [];

$type    = $body['type']    ?? 'js_error';
$message = trim($body['message'] ?? '');
$page    = trim($body['page']    ?? '');
$detail  = $body['detail']  ?? [];
$stack   = trim($body['stack']   ?? '');

$valid_types = ['js_error', 'api_error', 'unhandled_rejection'];
if (!in_array($type, $valid_types)) $type = 'js_error';

if (!$message) { respondOk(null, 'skipped'); }

// Hard truncation (tighter than the authenticated endpoint — public data)
if (strlen($message) > 200) $message = substr($message, 0, 200) . '…';
if (strlen($stack)   > 1000) $stack  = substr($stack,   0, 1000) . '…';
if (strlen($page)    > 200) $page   = substr($page,    0, 200);
if (is_array($detail)) {
    // Strip any keys we don't want persisting; keep it small
    $detail = array_slice($detail, 0, 6, true);
}

_appendLog('client-errors.json', [
    'id'        => genId('ce'),
    'ts'        => date('c'),
    'type'      => $type,
    'user_id'   => 'anonymous',
    'user_name' => 'anonymous',
    'ip'        => $ip,
    'ua'        => _getShortUA(),
    'page'      => $page,
    'message'   => $message,
    'stack'     => $stack ?: null,
    'detail'    => $detail ?: null,
], 3000);

respondOk(null, 'logged');
