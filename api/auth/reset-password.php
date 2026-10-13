<?php
/**
 * Public password-reset endpoint (no auth required — token IS the auth).
 *
 *   GET  /api/auth/reset-password.php?token=xxx
 *        → { valid:bool, expires_at?, user_name_masked?, username_masked? }
 *
 *   POST /api/auth/reset-password.php
 *        body: { token, new_password, confirm_password }
 *        → { success, message }
 *
 * Token must be obtained out-of-band (via email) — see api/mail/_templates.php.
 */
require_once __DIR__ . '/../helpers.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// ─── GET: verify a token is still valid (used by reset-password.html on load) ─
if ($method === 'GET') {
    $token  = trim($_GET['token'] ?? '');
    $userId = verifyResetToken($token);

    if (!$userId) {
        respondOk(['valid' => false]);
    }

    $users = readJson('users.json');
    $user  = null;
    foreach ($users as $u) {
        if ($u['id'] === $userId) { $user = $u; break; }
    }
    if (!$user) respondOk(['valid' => false]);

    // Find expires_at for response
    $store     = readJson(RESET_TOKEN_FILE);
    $expiresAt = null;
    foreach ($store as $t) {
        if (hash_equals($t['token'], $token)) { $expiresAt = $t['expires_at']; break; }
    }

    // Mask name + username — e.g. "Warapon L." / "wa***on"
    $maskName = function (string $name): string {
        $parts = preg_split('/\s+/', trim($name), -1, PREG_SPLIT_NO_EMPTY);
        if (!$parts) return '';
        $first = $parts[0];
        $rest  = count($parts) > 1 ? ' ' . mb_substr($parts[count($parts) - 1], 0, 1) . '.' : '';
        return $first . $rest;
    };
    $maskUser = function (string $u): string {
        $len = mb_strlen($u);
        if ($len <= 3) return str_repeat('*', $len);
        return mb_substr($u, 0, 2) . str_repeat('*', max(1, $len - 4)) . mb_substr($u, -2);
    };

    respondOk([
        'valid'             => true,
        'expires_at'        => $expiresAt,
        'user_name_masked'  => $maskName($user['name'] ?? ''),
        'username_masked'   => $maskUser($user['username'] ?? ''),
    ]);
}

// ─── POST: consume token and set the new password ────────────────────────────
if ($method !== 'POST') {
    respondError('Method not allowed', 405);
}

$body            = getBody();
$token           = trim($body['token']            ?? '');
$new_password    = (string)($body['new_password']    ?? '');
$confirm_password= (string)($body['confirm_password']?? '');

if (!$token) respondError('Token is required');
if (!$new_password || mb_strlen($new_password) < 8) {
    respondError('New password must be at least 8 characters');
}
if ($new_password !== $confirm_password) {
    respondError('Passwords do not match');
}

// Atomically consume the token (single-use)
$userId = consumeResetToken($token);
if (!$userId) {
    logSecurity('reset_token_invalid', ['token_prefix' => substr($token, 0, 8)]);
    respondError('ลิงก์รีเซ็ตรหัสผ่านนี้หมดอายุหรือถูกใช้งานไปแล้ว กรุณาขอลิงก์ใหม่', 400);
}

$users = readJson('users.json');
$found = false;
foreach ($users as &$u) {
    if ($u['id'] !== $userId) continue;

    // Cannot reuse current password
    if (verifyPassword($new_password, $u['password'])) {
        respondError('New password cannot be the same as your current password');
    }

    // Cannot reuse recent passwords (history)
    $history = $u['password_history'] ?? [];
    foreach ($history as $oldHash) {
        if (verifyPassword($new_password, $oldHash)) {
            $cnt = PW_HIST_COUNT;
            respondError("Cannot reuse one of your last {$cnt} passwords. Please choose a different password.");
        }
    }

    $newHistory = array_slice(array_merge([$u['password']], $history), 0, PW_HIST_COUNT);
    $u['password_history']    = $newHistory;
    $u['password']            = hashPassword($new_password);
    $u['password_changed_at'] = date('c');
    $u['first_login']         = false;
    $u['password_expired']    = false;
    $u['must_reset_password'] = false;
    $found = true;
    break;
}
unset($u);

if (!$found) {
    logSecurity('reset_token_orphan', ['user_id' => $userId]);
    respondError('User account no longer exists', 404);
}

writeJson('users.json', $users);
logActivity('password_reset_via_token', ['user_id' => $userId], $userId, '');
logSecurity('password_reset_completed', ['user_id' => $userId], $userId, '');

respondOk(null, 'รีเซ็ตรหัสผ่านสำเร็จ');
