<?php
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/../cache/CacheManager.php';
require_once __DIR__ . '/../mail/_mailer.php';
require_once __DIR__ . '/../mail/_templates.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];

$cache = new CacheManager();

// Mask an email address for display: warapon@ascendcorp.com → w*****n@ascendcorp.com
function _maskEmailForDisplay(string $email): string {
    $at = strrpos($email, '@');
    if ($at === false || $at < 1) return $email;
    $local  = substr($email, 0, $at);
    $domain = substr($email, $at);
    $len    = mb_strlen($local);
    if ($len <= 2) return str_repeat('*', $len) . $domain;
    return mb_substr($local, 0, 1) . str_repeat('*', max(1, $len - 2)) . mb_substr($local, -1) . $domain;
}

// GET /api/users/ — list users
// super_admin/super_viewer: all users, or filter by ?team= OR X-Admin-Team context header
// sm_admin/dev_sm: users of own team only
// sm_user/sm_lead/external: limited fields for schedule display (own team only)
if ($method === 'GET') {
    $allUsers = readJson('users.json'); // global file — always root

    if (in_array($payload['role'], ['super_admin', 'super_viewer'], true)) {
        // Filter priority: explicit ?team= param → X-Admin-Team header context → none (all).
        // NOTE: do NOT fall back to $GLOBALS['_current_team'] — for a super_admin that
        // global is pre-seeded with their OWN JWT team, which would silently filter the
        // "all teams" listing to just their own team (breaks per-team user counts and the
        // "All teams" view). Only an explicit ?team= or X-Admin-Team header should narrow.
        $ctxTeam = getRequestHeader('X-Admin-Team');
        $ctxTeam = ($ctxTeam && preg_match('/^[a-z0-9_-]+$/', $ctxTeam)) ? $ctxTeam : null;
        $filterTeam = $_GET['team'] ?? $ctxTeam ?? null;
        $users = $filterTeam
            ? array_values(array_filter($allUsers, fn($u) => ($u['team'] ?? '') === $filterTeam))
            : $allUsers;

        $safe = array_map(fn($u) => [
            'id'                   => $u['id'],
            'name'                 => $u['name'],
            'nickname'             => $u['nickname'] ?? '',
            'username'             => $u['username'],
            'email'                => $u['email'] ?? '',
            'role'                 => $u['role'],
            'team'                 => $u['team'] ?? null,
            'avatar_url'           => $u['avatar_url'] ?? null,
            'first_login'          => (bool)($u['first_login'] ?? false),
            'password_expired'     => (bool)($u['password_expired'] ?? false),
            'must_reset_password'  => (bool)($u['must_reset_password'] ?? false),
            'created_at'           => $u['created_at'] ?? '',
            'password_changed_at'  => $u['password_changed_at'] ?? '',
            'permissions'          => $u['permissions'] ?? [],
            'schedule_include'     => (bool)($u['schedule_include'] ?? true),
            'course_include'       => (bool)($u['course_include'] ?? true),
            'exam_include'         => (bool)($u['exam_include'] ?? true),
            'name_th'              => $u['name_th']    ?? '',
            'emp_id'               => $u['emp_id']     ?? '',
            'phone'                => $u['phone']      ?? '',
            'tmn_id'               => $u['tmn_id']     ?? '',
            'net_home'             => $u['net_home']   ?? '',
            'net_mobile'           => $u['net_mobile'] ?? '',
            'dev_subteam'          => $u['dev_subteam'] ?? null,
            'extra_pages'          => $u['extra_pages'] ?? [],
        ], $users);
        respondOk(array_values($safe));
    }

    // sm_admin / dev_sm: see full details for own team, PLUS the shared 'dev' team
    if (in_array($payload['role'], ['sm_admin', 'dev_sm'])) {
        $myTeam     = $payload['team'] ?? null;
        $filterTeam = $_GET['team'] ?? null;
        // Allow viewing the dev team specifically (shared cross-team external dev users)
        if ($filterTeam === 'dev') {
            $users = array_values(array_filter($allUsers, fn($u) => ($u['team'] ?? '') === 'dev'));
        } else {
            $users = array_values(array_filter($allUsers, fn($u) => ($u['team'] ?? '') === $myTeam));
        }
        $safe = array_map(fn($u) => [
            'id'                   => $u['id'],
            'name'                 => $u['name'],
            'nickname'             => $u['nickname'] ?? '',
            'username'             => $u['username'],
            'email'                => $u['email'] ?? '',
            'role'                 => $u['role'],
            'team'                 => $u['team'] ?? null,
            'avatar_url'           => $u['avatar_url'] ?? null,
            'first_login'          => (bool)($u['first_login'] ?? false),
            'password_expired'     => (bool)($u['password_expired'] ?? false),
            'must_reset_password'  => (bool)($u['must_reset_password'] ?? false),
            'created_at'           => $u['created_at'] ?? '',
            'password_changed_at'  => $u['password_changed_at'] ?? '',
            'permissions'          => $u['permissions'] ?? [],
            'schedule_include'     => (bool)($u['schedule_include'] ?? true),
            'course_include'       => (bool)($u['course_include'] ?? true),
            'exam_include'         => (bool)($u['exam_include'] ?? true),
            'name_th'              => $u['name_th']    ?? '',
            'emp_id'               => $u['emp_id']     ?? '',
            'phone'                => $u['phone']      ?? '',
            'tmn_id'               => $u['tmn_id']     ?? '',
            'net_home'             => $u['net_home']   ?? '',
            'net_mobile'           => $u['net_mobile'] ?? '',
            'dev_subteam'          => $u['dev_subteam'] ?? null,
        ], $users);
        respondOk($safe);
    }

    // sm_user / sm_lead / external: limited fields, own team, for schedule display
    if (in_array($payload['role'], ['sm_user', 'sm_lead', 'external'])) {
        $myTeam = $payload['team'] ?? null;
        $scheduleUsers = array_values(array_filter($allUsers, function($u) use ($myTeam) {
            if ($u['role'] === 'external') return false;
            if (($u['team'] ?? '') !== $myTeam) return false;
            return (bool)($u['schedule_include'] ?? true);
        }));
        $safe = array_map(fn($u) => [
            'id'       => $u['id'],
            'name'     => $u['name'],
            'nickname' => $u['nickname'] ?? '',
            'role'     => $u['role'],
        ], $scheduleUsers);
        respondOk(array_values($safe));
    }

    respondError('Forbidden: insufficient permissions', 403);
}

// POST /api/users/ — create user (admin only)
if ($method === 'POST') {
    requireCsrf();
    requireRole($payload, ADMIN_ROLES);
    $body = getBody();
    $name     = trim($body['name'] ?? '');
    $username = trim($body['username'] ?? '');
    $email    = trim($body['email'] ?? '');
    $role     = $body['role'] ?? 'sm_user';

    if (!$name || !$username) {
        respondError('Name and username are required');
    }
    if (!$email || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        respondError('A valid email is required — the temporary password will be sent to this address');
    }
    if (!in_array($role, ['sm_user', 'sm_lead', 'sm_admin', 'dev_sm', 'external', 'super_viewer', 'dev_user'])) {
        respondError('Invalid role');
    }
    // Non-super_admin (sm_admin/dev_sm) can only assign User, Admin, or Dev User roles
    if ($payload['role'] !== 'super_admin' && !in_array($role, ['sm_user', 'sm_admin', 'dev_user'])) {
        respondError('You can only assign the User, Admin, or Dev User role', 403);
    }
    // super_viewer is a platform-level oversight role — only super_admin can create.
    if ($role === 'super_viewer' && $payload['role'] !== 'super_admin') {
        respondError('Only super_admin can create super_viewer users', 403);
    }

    $users = readJson('users.json');
    foreach ($users as $u) {
        if (strtolower($u['username']) === strtolower($username)) {
            respondError('Username already exists');
        }
    }

    // Generate temp password: SOM_ + 6 random alphanumeric
    $chars    = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    $tempPw   = 'SOM_' . implode('', array_map(fn($i) => $chars[random_int(0, strlen($chars)-1)], range(0,5)));

    // Resolve team: super_admin can specify any team; sm_admin is locked to own team,
    // except when creating dev_user — those always go to the 'dev' team.
    // Platform-level oversight roles (super_viewer) have no team — they see everything.
    if ($role === 'super_viewer') {
        $teamSlug = null;
    } elseif ($role === 'dev_user') {
        $teamSlug = 'dev'; // dev_user always belongs to the dev team
    } elseif ($payload['role'] === 'super_admin') {
        $teamSlug = trim($body['team'] ?? '');
        if (!$teamSlug) respondError('team is required when creating users as super_admin');
        // Validate team exists and is active
        $teams = readJson('teams.json');
        $validTeam = array_filter($teams, fn($t) => ($t['slug'] ?? '') === $teamSlug && !empty($t['active']));
        if (empty($validTeam)) respondError("Team '{$teamSlug}' not found or inactive", 400);
    } else {
        $teamSlug = $payload['team'] ?? 'sm'; // sm_admin always creates in own team
    }

    $nickname = trim($body['nickname'] ?? '');
    $newUser = [
        'id'                  => genId('usr'),
        'name'                => $name,
        'nickname'            => $nickname,
        'username'            => $username,
        'email'               => $email,
        'role'                => $role,
        'team'                => $teamSlug,
        'password'            => hashPassword($tempPw),
        'password_history'    => [],
        'password_changed_at' => date('c'),
        'first_login'         => true,
        'created_at'          => date('c'),
        'created_by'          => $payload['sub'],
        'permissions'         => ($role === 'external') ? array_values(array_filter((array)($body['permissions'] ?? []), 'is_string')) : [],
        'schedule_include'    => ($role === 'external' || $role === 'dev_user') ? false : (bool)($body['schedule_include'] ?? true),
        'course_include'      => ($role === 'external' || $role === 'dev_user') ? false : (bool)($body['course_include']   ?? true),
        'exam_include'        => ($role === 'external' || $role === 'dev_user') ? false : (bool)($body['exam_include']     ?? true),
        'dev_subteam'         => ($role === 'dev_user') ? trim((string)($body['dev_subteam'] ?? '')) : null,
        'name_th'             => trim((string)($body['name_th']    ?? '')),
        'emp_id'              => trim((string)($body['emp_id']     ?? '')),
        'phone'               => trim((string)($body['phone']      ?? '')),
        'tmn_id'              => trim((string)($body['tmn_id']     ?? '')),
        'net_home'            => trim((string)($body['net_home']   ?? '')),
        'net_mobile'          => trim((string)($body['net_mobile'] ?? '')),
    ];

    // Build welcome email BEFORE writing user, so a SMTP failure aborts cleanly.
    $loginUrl = APP_BASE_URL . '/index.html';
    $welcome  = buildWelcomeEmail($name, $username, $tempPw, $loginUrl);
    $mailRes  = sendMailInternal($email, $welcome['subject'], $welcome['html'], [
        'sent_by'      => $payload['sub'],
        'sent_by_name' => $payload['name'] ?? '',
        'log_type'     => 'user_welcome',
        'log_meta'     => ['username' => $username, 'role' => $role],
    ]);
    if (!$mailRes['ok']) {
        logSecurity('user_create_email_failed', [
            'username' => $username,
            'email'    => $email,
            'error'    => $mailRes['error'],
        ], $payload['sub'], $payload['name'] ?? '');
        $notConfigured = strpos($mailRes['error'] ?? '', 'not configured') !== false;
        respond([
            'success' => false,
            'code'    => $notConfigured ? 'SMTP_NOT_CONFIGURED' : 'SMTP_SEND_FAILED',
            'message' => $notConfigured
                ? 'ยังไม่ได้ตั้งค่า SMTP ของทีมนี้ — ต้องตั้งค่า Mail Config ก่อนจึงจะสร้าง user ได้ (แต่ละทีมใช้เมลของตัวเอง)'
                : ('ส่งอีเมลต้อนรับไม่สำเร็จ — กรุณาตรวจสอบการตั้งค่า SMTP: ' . $mailRes['error']),
        ], $notConfigured ? 400 : 500);
    }

    $users[] = $newUser;
    writeJson('users.json', $users);
    logActivity('user_create', [
        'target_id' => $newUser['id'],
        'username'  => $username,
        'role'      => $role,
        'sent_to'   => _maskEmailForDisplay($email),
    ], $payload['sub'], $payload['name']);

    respondOk([
        'id'       => $newUser['id'],
        'name'     => $newUser['name'],
        'username' => $newUser['username'],
        'role'     => $newUser['role'],
        'sent_to'  => _maskEmailForDisplay($email),
    ], 'User created — temporary password sent to ' . _maskEmailForDisplay($email));
}

// PUT /api/users/?id=xxx — update user (admin only)
if ($method === 'PUT') {
    requireCsrf();
    requireRole($payload, ADMIN_ROLES);
    $id = $_GET['id'] ?? '';
    if (!$id) respondError('User ID required');

    $body = getBody();
    $users = readJson('users.json');
    $found = false;

    foreach ($users as &$u) {
        if ($u['id'] === $id) {
            if (isset($body['name']))     $u['name']     = trim($body['name']);
            if (isset($body['nickname'])) $u['nickname'] = trim($body['nickname']);
            if (isset($body['email']))    $u['email']    = trim($body['email']);
            if (array_key_exists('avatar_url', $body)) {
                $avatar = $body['avatar_url'] ?? '';
                if ($avatar !== '' && !preg_match('/^(data:image\/(png|jpeg|gif|webp);base64,|https?:\/\/)/', $avatar)) {
                    respondError('Invalid avatar format. Use data URI or https URL.');
                }
                if (strlen($avatar) > 280000) respondError('Avatar too large (max ~200 KB)');
                $u['avatar_url'] = $avatar;
            }
            if (isset($body['role']) && in_array($body['role'], ['sm_user', 'sm_lead', 'sm_admin', 'dev_sm', 'external', 'dev_user'])) {
                // Prevent demoting self
                if ($u['id'] === $payload['sub'] && !in_array($body['role'], ADMIN_ROLES)) {
                    respondError('Cannot change your own role');
                }
                // Non-super_admin can only assign User, Admin, or Dev User
                if ($payload['role'] !== 'super_admin' && !in_array($body['role'], ['sm_user', 'sm_admin', 'dev_user'])) {
                    respondError('You can only assign the User, Admin, or Dev User role', 403);
                }
                $u['role'] = $body['role'];
                // Sync team when changing to/from dev_user
                if ($body['role'] === 'dev_user') $u['team'] = 'dev';
            }
            // dev_subteam — only meaningful for dev_user
            if (isset($body['dev_subteam'])) {
                $u['dev_subteam'] = ($u['role'] === 'dev_user') ? trim((string)$body['dev_subteam']) : null;
            }
            // External user permissions
            if (isset($body['permissions']) && $u['role'] === 'external') {
                $u['permissions'] = array_values(array_filter((array)$body['permissions'], 'is_string'));
            }
            // Schedule / course / exam inclusion toggles (non-external users only)
            if (isset($body['schedule_include']) && $u['role'] !== 'external') {
                $u['schedule_include'] = (bool)$body['schedule_include'];
            }
            if (isset($body['course_include']) && $u['role'] !== 'external') {
                $u['course_include'] = (bool)$body['course_include'];
            }
            if (isset($body['exam_include']) && $u['role'] !== 'external') {
                $u['exam_include'] = (bool)$body['exam_include'];
            }
            // Contact + identity fields (admin can set on any user)
            $contactCaps = ['name_th'=>80, 'emp_id'=>20, 'phone'=>20, 'tmn_id'=>20, 'net_home'=>100, 'net_mobile'=>50];
            foreach ($contactCaps as $ck => $cmax) {
                if (isset($body[$ck])) {
                    $cv = trim((string)$body[$ck]);
                    if (mb_strlen($cv) > $cmax) respondError(ucfirst(str_replace('_',' ',$ck)) . " too long (max $cmax chars)");
                    $u[$ck] = $cv;
                }
            }
            // Extra pages: cross-team page access per user (super_admin only)
            if (isset($body['extra_pages']) && $payload['role'] === 'super_admin') {
                $eps = [];
                foreach ((array)$body['extra_pages'] as $ep) {
                    $page    = trim((string)($ep['page']        ?? ''));
                    $srcTeam = trim((string)($ep['source_team'] ?? ''));
                    if ($page && $srcTeam && preg_match('/^[a-z0-9_-]+$/', $srcTeam)) {
                        $eps[] = ['page' => $page, 'source_team' => $srcTeam];
                    }
                }
                $u['extra_pages'] = $eps;
            }
            // Force password reset flag (admin can set/clear)
            if (isset($body['must_reset_password'])) {
                $u['must_reset_password'] = (bool)$body['must_reset_password'];
                if ($u['must_reset_password']) {
                    logActivity('user_force_password_reset', [
                        'target_id'   => $id,
                        'target_name' => $u['name'],
                    ], $payload['sub'], $payload['name']);
                }
            }
            $found = true;
            break;
        }
    }
    unset($u);

    if (!$found) respondError('User not found', 404);
    writeJson('users.json', $users);
    logActivity('user_update', ['target_id' => $id, 'changed' => array_keys(array_intersect_key($body, array_flip(['name','email','role'])))], $payload['sub'], $payload['name']);
    
    // Invalidate users cache
    $cache->invalidatePattern('users_list_');
    
    respondOk(null, 'User updated');
}

// DELETE /api/users/?id=xxx — delete user (admin only)
if ($method === 'DELETE') {
    requireCsrf();
    requireRole($payload, ADMIN_ROLES);
    $id = $_GET['id'] ?? '';
    if (!$id) respondError('User ID required');
    if ($id === $payload['sub']) respondError('Cannot delete your own account');

    $users = readJson('users.json');
    $filtered = array_values(array_filter($users, fn($u) => $u['id'] !== $id));
    if (count($filtered) === count($users)) respondError('User not found', 404);

    $deletedUser = current(array_filter($users, fn($u) => $u['id'] === $id));
    writeJson('users.json', $filtered);
    logActivity('user_delete', ['target_id' => $id, 'username' => $deletedUser['username'] ?? ''], $payload['sub'], $payload['name']);
    
    // Invalidate users cache
    $cache->invalidatePattern('users_list_');
    
    respondOk(null, 'User deleted');
}

// PATCH /api/users/?id=xxx — admin-triggered password reset (sends email link, 24h expiry)
if ($method === 'PATCH') {
    requireCsrf();
    requireRole($payload, ADMIN_ROLES);
    $id = $_GET['id'] ?? '';
    if (!$id) respondError('User ID required');

    // Find target user — do NOT modify the user record. We only create a token
    // and send an email. The user's existing password remains valid until they
    // click the link and submit a new one.
    $users      = readJson('users.json');
    $targetUser = null;
    foreach ($users as $u) {
        if ($u['id'] === $id) { $targetUser = $u; break; }
    }
    if (!$targetUser) respondError('User not found', 404);

    $email = trim($targetUser['email'] ?? '');
    if (!$email || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        respondError('User does not have a valid email address — cannot send reset link. Edit the user to add an email first.', 400);
    }

    $tokenEntry = createResetToken($id, 24);
    $resetUrl   = APP_BASE_URL . '/reset-password.html?token=' . $tokenEntry['token'];

    $mail = buildResetPasswordEmail(
        $targetUser['name'] ?? $targetUser['username'],
        $resetUrl,
        $tokenEntry['expires_at'],
        'admin'
    );
    $mailRes = sendMailInternal($email, $mail['subject'], $mail['html'], [
        'sent_by'      => $payload['sub'],
        'sent_by_name' => $payload['name'] ?? '',
        'log_type'     => 'password_reset',
        'log_meta'     => ['target_user_id' => $id, 'username' => $targetUser['username'] ?? '', 'reason' => 'admin'],
    ]);
    if (!$mailRes['ok']) {
        logSecurity('reset_email_failed', [
            'target_user_id' => $id,
            'email'          => $email,
            'error'          => $mailRes['error'],
        ], $payload['sub'], $payload['name'] ?? '');
        $notConfigured = strpos($mailRes['error'] ?? '', 'not configured') !== false;
        respond([
            'success' => false,
            'code'    => $notConfigured ? 'SMTP_NOT_CONFIGURED' : 'SMTP_SEND_FAILED',
            'message' => $notConfigured
                ? 'ยังไม่ได้ตั้งค่า SMTP ของทีมนี้ — ต้องตั้งค่า Mail Config ก่อนจึงจะส่งลิงก์รีเซ็ตรหัสผ่านได้'
                : ('ส่งอีเมลรีเซ็ตรหัสผ่านไม่สำเร็จ — กรุณาตรวจสอบการตั้งค่า SMTP: ' . $mailRes['error']),
        ], $notConfigured ? 400 : 500);
    }

    logActivity('user_reset_password', [
        'target_id' => $id,
        'username'  => $targetUser['username'] ?? '',
        'method'    => 'email',
        'sent_to'   => _maskEmailForDisplay($email),
    ], $payload['sub'], $payload['name']);

    respondOk([
        'sent_to'    => _maskEmailForDisplay($email),
        'expires_at' => $tokenEntry['expires_at'],
    ], 'ส่งลิงก์รีเซ็ตรหัสผ่านไปที่ ' . _maskEmailForDisplay($email) . ' แล้ว (ลิงก์มีอายุ 24 ชม.)');
}

respondError('Method not allowed', 405);
