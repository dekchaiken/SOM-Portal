<?php
require_once __DIR__ . '/../helpers.php';

// super_viewer must be able to update its own profile (name/avatar) even though it's read-only.
$payload = requireAuth(false, true);
$method  = $_SERVER['REQUEST_METHOD'];

// PATCH /api/auth/profile — update own profile (name, avatar_url)
if ($method === 'PATCH') {
    $body   = getBody();
    $users  = readJson('users.json');
    $found  = false;

    foreach ($users as &$u) {
        if ($u['id'] !== $payload['sub']) continue;

        if (isset($body['name'])) {
            $name = trim($body['name']);
            if (strlen($name) < 1 || strlen($name) > 60) respondError('Name must be 1–60 characters');
            $u['name'] = $name;
        }

        if (isset($body['nickname'])) {
            $nn = trim($body['nickname']);
            if (strlen($nn) > 30) respondError('Nickname must be 30 characters or less');
            $u['nickname'] = $nn;
        }

        if (array_key_exists('avatar_url', $body)) {
            $avatar = $body['avatar_url'] ?? '';
            if ($avatar !== '' && !preg_match('/^(data:image\/(png|jpeg|gif|webp);base64,|https?:\/\/)/', $avatar)) {
                respondError('Invalid avatar format. Use data URI or https URL.');
            }
            if (strlen($avatar) > 280000) respondError('Avatar too large (max ~200 KB)');
            $u['avatar_url'] = $avatar;
        }

        // Contact + identity fields — user can set on own record
        $contactCaps = ['name_th'=>80, 'emp_id'=>20, 'phone'=>20, 'tmn_id'=>20, 'net_home'=>100, 'net_mobile'=>50];
        foreach ($contactCaps as $ck => $cmax) {
            if (isset($body[$ck])) {
                $cv = trim((string)$body[$ck]);
                if (mb_strlen($cv) > $cmax) respondError(ucfirst(str_replace('_',' ',$ck)) . " too long (max $cmax chars)");
                $u[$ck] = $cv;
            }
        }

        if (isset($body['email'])) {
            $email = trim($body['email']);
            if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
                respondError('Invalid email format');
            }
            if ($email !== '') {
                foreach ($users as $other) {
                    if ($other['id'] !== $payload['sub']
                        && strtolower($other['email'] ?? '') === strtolower($email)) {
                        respondError('Email already in use');
                    }
                }
            }
            $u['email'] = $email;
        }

        $found = true;
        break;
    }
    unset($u);

    if (!$found) respondError('User not found', 404);
    writeJson('users.json', $users);
    logActivity('profile_update', ['changed' => array_keys(array_filter([
        'name'     => isset($body['name']),
        'nickname' => isset($body['nickname']),
        'avatar'   => array_key_exists('avatar_url', $body),
        'email'    => isset($body['email']),
    ]))], $payload['sub'], $payload['name'] ?? '');

    // Re-read to return clean data
    foreach (readJson('users.json') as $u) {
        if ($u['id'] === $payload['sub']) {
            respondOk([
                'id'         => $u['id'],
                'name'       => $u['name'],
                'nickname'   => $u['nickname'] ?? '',
                'username'   => $u['username'],
                'email'      => $u['email'] ?? '',
                'role'       => $u['role'],
                'avatar_url' => $u['avatar_url'] ?? '',
                'name_th'    => $u['name_th']    ?? '',
                'emp_id'     => $u['emp_id']     ?? '',
                'phone'      => $u['phone']      ?? '',
                'tmn_id'     => $u['tmn_id']     ?? '',
                'net_home'   => $u['net_home']   ?? '',
                'net_mobile' => $u['net_mobile'] ?? ''
            ], 'Profile updated');
        }
    }
}

// GET /api/auth/profile — return current user's full profile
if ($method === 'GET') {
    foreach (readJson('users.json') as $u) {
        if ($u['id'] === $payload['sub']) {
            respondOk([
                'id'         => $u['id'],
                'name'       => $u['name'],
                'nickname'   => $u['nickname'] ?? '',
                'username'   => $u['username'],
                'email'      => $u['email'] ?? '',
                'role'       => $u['role'],
                'avatar_url' => $u['avatar_url'] ?? '',
                'name_th'    => $u['name_th']    ?? '',
                'emp_id'     => $u['emp_id']     ?? '',
                'phone'      => $u['phone']      ?? '',
                'tmn_id'     => $u['tmn_id']     ?? '',
                'net_home'   => $u['net_home']   ?? '',
                'net_mobile' => $u['net_mobile'] ?? ''
            ]);
        }
    }
    respondError('User not found', 404);
}

respondError('Method not allowed', 405);
