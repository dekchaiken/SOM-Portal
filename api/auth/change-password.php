<?php
require_once __DIR__ . '/../helpers.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respondError('Method not allowed', 405);
}

// super_viewer must be able to change its own password even though it's read-only.
$payload = requireAuth(true, true);
$body = getBody();

$old_password = $body['old_password'] ?? '';
$new_password = $body['new_password'] ?? '';
$confirm      = $body['confirm_password'] ?? '';

if (!$new_password || mb_strlen($new_password) < 8) {
    respondError('New password must be at least 8 characters');
}
if ($new_password !== $confirm) {
    respondError('Passwords do not match');
}

$users = readJson('users.json');
$found = false;
foreach ($users as &$u) {
    if ($u['id'] !== $payload['sub']) continue;

    // Require old password unless it's a first-login or admin-forced reset
    if (!$u['first_login'] && !$u['must_reset_password']) {
        if (!$old_password) respondError('Current password is required');
        if (!verifyPassword($old_password, $u['password'])) {
            respondError('Current password is incorrect', 401);
        }
    }

    // ── Cannot reuse current password ──
    if (verifyPassword($new_password, $u['password'])) {
        respondError('New password cannot be the same as your current password');
    }

    // ── Cannot reuse recent passwords (history) ──
    $history = $u['password_history'] ?? [];
    foreach ($history as $oldHash) {
        if (verifyPassword($new_password, $oldHash)) {
            $cnt = PW_HIST_COUNT;
            respondError("Cannot reuse one of your last {$cnt} passwords. Please choose a different password.");
        }
    }

    // ── Update password + history + timestamps ──
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

if (!$found) respondError('User not found', 404);

writeJson('users.json', $users);
logActivity('password_change', [
    'first_login_reset' => (bool)($payload['first_login'] ?? false),
    'expired_reset'     => (bool)($payload['password_expired'] ?? false),
], $payload['sub'], $payload['name'] ?? '');

// Issue fresh token with cleared flags
$userObj = null;
foreach ($users as $u) {
    if ($u['id'] === $payload['sub']) { $userObj = $u; break; }
}

$token = jwt_create([
    'sub'                 => $userObj['id'],
    'username'            => $userObj['username'],
    'name'                => $userObj['name'],
    'role'                => $userObj['role'],
    'first_login'         => false,
    'password_expired'    => false,
    'must_reset_password' => false,
]);

respondOk(['token' => $token], 'Password changed successfully');
