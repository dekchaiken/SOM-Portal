<?php
require_once __DIR__ . '/../helpers.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    respondError('Method not allowed', 405);
}

$payload = requireAuth(true);

$users = readJson('users.json');
foreach ($users as $u) {
    if ($u['id'] === $payload['sub']) {
        $changedAt = $u['password_changed_at'] ?? $u['created_at'] ?? date('c');
        $pwExpired = !($u['first_login'] ?? false)
            && (time() - strtotime($changedAt)) / 86400 >= PW_EXPIRY_DAYS;
        respondOk([
            'id'                   => $u['id'],
            'name'                 => $u['name'],
            'username'             => $u['username'],
            'email'                => $u['email'] ?? '',
            'role'                 => $u['role'],
            'first_login'          => (bool)($u['first_login'] ?? false),
            'password_expired'     => $pwExpired,
            'must_reset_password'  => (bool)($u['must_reset_password'] ?? false),
            'team'                 => $u['team'] ?? null,
            'dev_subteam'          => ($u['role'] === 'dev_user') ? ($u['dev_subteam'] ?? null) : null,
            'is_genz'              => (bool)($u['is_genz'] ?? false),
            'extra_pages'          => array_values(array_filter(
                array_map(fn($ep) => (isset($ep['page'], $ep['source_team']) && $ep['page'] && $ep['source_team'])
                    ? ['page' => $ep['page'], 'source_team' => $ep['source_team']]
                    : null,
                $u['extra_pages'] ?? []),
                fn($ep) => $ep !== null
            )),
        ]);
    }
}

respondError('User not found', 404);
