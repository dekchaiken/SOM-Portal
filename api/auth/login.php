<?php
require_once __DIR__ . '/../helpers.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respondError('Method not allowed', 405);
}

$body        = getBody();
$username    = trim($body['username'] ?? '');
$password    = $body['password'] ?? '';
$remember_me = !empty($body['remember_me']);

if (!$username || !$password) {
    respondError('Username and password are required');
}

// ── Rate limit check (blocks specific username that has too many failures) ──
rl_check($username);

$users = readJson('users.json');
$user = null;
foreach ($users as $u) {
    if (strtolower($u['username']) === strtolower($username)) {
        $user = $u;
        break;
    }
}

if (!$user || !verifyPassword($password, $user['password'])) {
    rl_fail($username);
    logSecurity('login_failed', [
        'username_tried' => $username,
        'user_exists' => (bool)$user,
        'reason' => !$user ? 'user_not_found' : 'invalid_password'
    ], $user['id'] ?? null, $user['name'] ?? null);
    respondError('Invalid username or password', 401);
}

// ── Login success ──
rl_success($username);

// Log security event
logSecurity('login_success', [
    'username' => $user['username'],
    'role' => $user['role'],
], $user['id'], $user['name']);

// ── Check password expiry ──
$passwordExpired = false;
$changedAt = $user['password_changed_at'] ?? $user['created_at'] ?? date('c');
if (!$user['first_login']) {
    $daysSince  = (time() - strtotime($changedAt)) / 86400;
    $passwordExpired = $daysSince >= PW_EXPIRY_DAYS;
}
$pwExpiresAt = $user['first_login'] ? 0 : (strtotime($changedAt) + (PW_EXPIRY_DAYS * 86400));

// ── Check must_reset_password (admin-forced reset) ──
$mustReset = (bool)($user['must_reset_password'] ?? false);

// Persist flags if newly set
$flagsChanged = false;
if ($passwordExpired && empty($user['password_expired'])) $flagsChanged = true;
if ($flagsChanged) {
    $allUsers = readJson('users.json');
    foreach ($allUsers as &$u) {
        if ($u['id'] === $user['id']) {
            $u['password_expired'] = true;
            break;
        }
    }
    unset($u);
    writeJson('users.json', $allUsers);
}

logActivity('login', [
    'username'     => $user['username'],
    'role'         => $user['role'],
    'pw_expired'   => $passwordExpired,
    'must_reset'   => $mustReset,
], $user['id'], $user['name']);

// Remember me → extend JWT to configured days, otherwise use system setting
$expiry = $remember_me ? (REMEMBER_ME_DAYS * 86400) : JWT_EXPIRY;

$token = jwt_create([
    'sub'                  => $user['id'],
    'username'             => $user['username'],
    'name'                 => $user['name'],
    'role'                 => $user['role'],
    'team'                 => $user['team'] ?? null,
    'dev_subteam'          => ($user['role'] === 'dev_user') ? ($user['dev_subteam'] ?? null) : null,
    'first_login'          => (bool)$user['first_login'],
    'password_expired'     => $passwordExpired,
    'pw_expires_at'        => $pwExpiresAt,
    'must_reset_password'  => $mustReset,
    'remember_me'          => $remember_me,
    'permissions'          => ($user['role'] === 'external') ? ($user['permissions'] ?? []) : [],
], $expiry);

// Generate CSRF token for authenticated session
require_once __DIR__ . '/../security/CsrfProtector.php';
$csrf = new CsrfProtector();
$csrfToken = $csrf->generateToken();

// ── Resolve team features + page grants + page modes ──────────────────────────
$teamFeatures     = [];
$teamFeaturePages = [];
$teamPageModes    = [];
// super_admin and super_viewer both see every feature globally (null = no scoping).
// When they pick a view-as team in the UI, per-team features are previewed
// client-side from the teams.json cache.
if (in_array($user['role'], ['super_admin', 'super_viewer'], true)) {
    $teamFeatures = null;
} elseif (!empty($user['team'])) {
    $teams = readJson('teams.json');
    foreach ($teams as $t) {
        if (($t['slug'] ?? '') === $user['team']) {
            $teamFeatures     = $t['features']      ?? [];
            $teamFeaturePages = $t['feature_pages'] ?? [];
            $teamPageModes    = $t['page_modes']    ?? []; // 'ma-services' => 'read'|'full'
            break;
        }
    }
}

respondOk([
    'token'      => $token,
    'csrf_token' => $csrfToken,
    'user'       => [
        'id'                   => $user['id'],
        'name'                 => $user['name'],
        'username'             => $user['username'],
        'role'                 => $user['role'],
        'team'                 => $user['team'] ?? null,
        'team_features'        => $teamFeatures,
        'team_feature_pages'   => $teamFeaturePages,
        'team_page_modes'      => $teamPageModes,
        'first_login'          => (bool)$user['first_login'],
        'password_expired'     => $passwordExpired,
        'must_reset_password'  => $mustReset,
        'avatar_url'           => $user['avatar_url'] ?? '',
        'permissions'          => ($user['role'] === 'external') ? ($user['permissions'] ?? []) : [],
        'is_genz'              => (bool)($user['is_genz'] ?? false),
    ],
], 'Login successful');
