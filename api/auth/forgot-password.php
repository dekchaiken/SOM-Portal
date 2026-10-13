<?php
/**
 * Public forgot-password endpoint.
 *
 *   POST /api/auth/forgot-password.php
 *        body: { username }
 *        → always { success: true, message: "..." } (same response whether user
 *          exists or not — prevents username enumeration)
 *
 * Rate-limited: 3 requests / 15 min per client IP, file-based.
 * Sends a reset link via email; reset uses the same token system as Phase 1/2.
 */
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/../mail/_mailer.php';
require_once __DIR__ . '/../mail/_templates.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respondError('Method not allowed', 405);
}

// ── Per-IP rate limit: 3 requests / 15 min (separate from login rl) ──────────
const FORGOT_RL_FILE       = 'forgot_rate_limit.json';
const FORGOT_RL_MAX        = 3;
const FORGOT_RL_WINDOW_SEC = 15 * 60;

$ip      = _getClientIp();
$rlKey   = substr(hash('sha256', $ip), 0, 16);
$rlStore = readJson(FORGOT_RL_FILE);
$now     = time();

// GC entries outside two windows
foreach ($rlStore as $k => $v) {
    if (($v['first'] ?? 0) < $now - 2 * FORGOT_RL_WINDOW_SEC) unset($rlStore[$k]);
}

$entry = $rlStore[$rlKey] ?? ['count' => 0, 'first' => $now];
if ($entry['first'] < $now - FORGOT_RL_WINDOW_SEC) {
    $entry = ['count' => 0, 'first' => $now];
}
$entry['count']++;
$rlStore[$rlKey] = $entry;
writeJson(FORGOT_RL_FILE, $rlStore);

if ($entry['count'] > FORGOT_RL_MAX) {
    $retry = max(60, FORGOT_RL_WINDOW_SEC - ($now - $entry['first']));
    logSecurity('forgot_password_rate_limited', ['ip' => $ip, 'count' => $entry['count']]);
    header('Retry-After: ' . $retry);
    respondError('คำขอบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่', 429);
}

// ── Look up user (NEVER reveal existence in response) ────────────────────────
$body     = getBody();
$username = trim((string)($body['username'] ?? ''));

// Same generic success message used in every code path below
$genericMsg = 'หากชื่อผู้ใช้นี้มีอยู่ในระบบ เราได้ส่งลิงก์รีเซ็ตรหัสผ่านไปที่อีเมลของบัญชีนี้แล้ว กรุณาตรวจสอบกล่องอีเมล';

if (!$username || mb_strlen($username) > 64) {
    logSecurity('forgot_password_invalid_input', ['ip' => $ip]);
    respondOk(null, $genericMsg);
}

$users      = readJson('users.json');
$targetUser = null;
foreach ($users as $u) {
    if (strtolower($u['username']) === strtolower($username)) { $targetUser = $u; break; }
}

if (!$targetUser) {
    logSecurity('forgot_password_no_user', ['ip' => $ip, 'username_tried' => $username]);
    respondOk(null, $genericMsg);
}

$email = trim($targetUser['email'] ?? '');
if (!$email || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    logSecurity('forgot_password_no_email', [
        'ip'       => $ip,
        'user_id'  => $targetUser['id'],
        'username' => $targetUser['username'],
    ], $targetUser['id'], $targetUser['name'] ?? '');
    respondOk(null, $genericMsg);
}

// ── Create token + send email (24h expiry, same flow as admin reset) ────────
$tokenEntry = createResetToken($targetUser['id'], 24);
$resetUrl   = APP_BASE_URL . '/reset-password.html?token=' . $tokenEntry['token'];

$mail = buildResetPasswordEmail(
    $targetUser['name'] ?? $targetUser['username'],
    $resetUrl,
    $tokenEntry['expires_at'],
    'forgot'
);
$mailRes = sendMailInternal($email, $mail['subject'], $mail['html'], [
    'sent_by'      => 'system',
    'sent_by_name' => 'forgot-password',
    'log_type'     => 'password_reset',
    'log_meta'     => ['target_user_id' => $targetUser['id'], 'username' => $targetUser['username'], 'reason' => 'forgot', 'ip' => $ip],
]);

if (!$mailRes['ok']) {
    // Don't expose SMTP error to caller — log internally and still respond generic
    logSecurity('forgot_password_email_failed', [
        'ip'       => $ip,
        'user_id'  => $targetUser['id'],
        'username' => $targetUser['username'],
        'error'    => $mailRes['error'],
    ], $targetUser['id'], $targetUser['name'] ?? '');
    respondOk(null, $genericMsg);
}

logSecurity('forgot_password_sent', [
    'ip'       => $ip,
    'user_id'  => $targetUser['id'],
    'username' => $targetUser['username'],
], $targetUser['id'], $targetUser['name'] ?? '');

respondOk(null, $genericMsg);
