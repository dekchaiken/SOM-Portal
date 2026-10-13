<?php
// ─── SO Jenkins (CLT RAG Pipeline) API ───────────────────────────────────────
// Jenkins trigger for the "acm-clt-rag-service-run-pipeline" job (Production),
// scoped per team (team slug: sojenkins). Migrated from the standalone
// so-jenkins app: builds history, activity logs + build-user mapping all live
// under data/{team}/.
//
// GET   /api/so-jenkins/                  → config (tools, servers, stats, can_admin)
// GET   /api/so-jenkins/?history=1        → build history (team-scoped, auto-syncs live builds)
// GET   /api/so-jenkins/?logs=1           → activity logs (all team users; clear is admin)
// GET   /api/so-jenkins/?users=1          → so-jenkins users (admin, team-scoped)
// GET   /api/so-jenkins/?status=1         → live Jenkins job status (last build, reachable)
// GET   /api/so-jenkins/?action=status&queue_id=X → poll a triggered build
// POST  /api/so-jenkins/ { action:'trigger' } → fire the build (no parameters)
// POST  /api/so-jenkins/ { action:'create_user'|'update_user'|'delete_user'|'reset_password'|'unlock_user', ... } → users CRUD (admin, sojenkins team only)
// POST  /api/so-jenkins/ { action:'clear_history' } → wipe build history (admin)
// POST  /api/so-jenkins/ { action:'clear_logs' } → wipe legacy activity logs (admin, deprecated)
//
// Access model:
//   • Team feature 'so-jenkins' (teams.json) — super_admin bypasses.
//   • external role additionally needs a 'so-jenkins' page permission.
//   • Admin actions require soj_role === 'admin' (so-jenkins's own role) or super_admin.
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];

// super_admin / super_viewer in "All Teams" mode: fall back to the first team
// that has tools (data/sojenkins/) so the page isn't empty.
teamContextFallbackForGlobalRole($payload, 'so-jenkins-tools.json');

// ── Gates ─────────────────────────────────────────────────────────────────────
requireTeamFeature($payload, 'so-jenkins');

if (($payload['role'] ?? '') === 'external') {
    $sojPerms = [];
    foreach (readJson('users.json') as $_u) {
        if (($_u['id'] ?? '') === $payload['sub']) {
            $sojPerms = $_u['permissions'] ?? [];
            break;
        }
    }
    if (!in_array('so-jenkins', $sojPerms, true)) {
        logSecurity('forbidden_page', ['page' => 'so-jenkins', 'user_role' => 'external'], $payload['sub'], $payload['name'] ?? '');
        respondError('Forbidden: no permission for this page', 403);
    }
}

// ── Team context ──────────────────────────────────────────────────────────────
$tools   = readJson('so-jenkins-tools.json');
$servers = require __DIR__ . '/../jenkins_config.php'; // keyed by server id

// ── Shared cURL helper (mirrors jenkins-portal's jp_jenkinsRequest) ──────────
function soj_jenkinsRequest(array $server, string $url, string $method = 'GET', $postFields = null, array $extraHeaders = [], ?array &$respHeaders = null): array {
    $host = hostFromUrl($url);
    if ($cd = hostCooldownActive($host)) {
        return ['', 0, 'host in cooldown after recent failure: ' . $cd['reason']];
    }
    $auth = $server['auth'];
    $ch   = curl_init($url);
    $hdrs = [];
    if (is_array($respHeaders)) {
        curl_setopt($ch, CURLOPT_HEADERFUNCTION, function ($ch, $line) use (&$hdrs) {
            $hdrs[] = $line;
            return strlen($line);
        });
    }
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS      => 3,
        CURLOPT_USERAGENT      => 'CentralizeSOM/1.0 SO-Jenkins',
    ]);
    $headers = array_merge(['Accept: application/json'], $extraHeaders);
    if ($auth['mode'] === 'token' && !empty($auth['token'])) {
        $headers[] = 'Authorization: Basic ' . base64_encode($auth['user'] . ':' . $auth['token']);
    } elseif ($auth['mode'] === 'cookie' && !empty($auth['cookie'])) {
        curl_setopt($ch, CURLOPT_COOKIE, $auth['cookie']);
    }
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    if ($method === 'POST') {
        curl_setopt($ch, CURLOPT_POST, true);
        if ($postFields !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $postFields);
    }
    applyDnsOverrides($ch, $url);
    $body  = curl_exec($ch);
    $info  = curl_getinfo($ch);
    $code  = (int)($info['http_code'] ?? 0);
    $errno = curl_errno($ch);
    $err   = curl_error($ch);
    curl_close($ch);
    if (is_array($respHeaders)) $respHeaders = $hdrs;
    if ($err !== '' || $code === 0 || $code >= 500) {
        error_log(sprintf(
            '[so-jenkins] curl_fail url=%s method=%s http_code=%d errno=%d err=%s primary_ip=%s connect_time=%.3f total_time=%.3f',
            $url, $method, $code, $errno, ($err ?: '(empty)'),
            $info['primary_ip'] ?? '', (float)($info['connect_time'] ?? 0),
            (float)($info['total_time'] ?? 0)
        ));
        hostCooldownMark($host, $err !== '' ? $err : ($errno ? "curl errno {$errno}" : "HTTP {$code}"));
    }
    if ($err === '' && $errno !== 0) $err = 'curl errno ' . $errno;
    return [$body, $code, $err];
}

// ── Role helpers ──────────────────────────────────────────────────────────────
// so-jenkins has its own user/admin roles (soj_role). Management (users, clear
// logs) is admin-only and scoped to the sojenkins team.
function soj_isAdmin(array $payload): bool {
    if (($payload['role'] ?? '') === 'super_admin') return true;
    if (($payload['role'] ?? '') !== 'external') return false;
    foreach (readJson('users.json') as $_u) {
        if (($_u['id'] ?? '') === $payload['sub']) {
            return ($_u['soj_role'] ?? '') === 'admin';
        }
    }
    return false;
}

function soj_findTool(array $tools, string $id): ?array {
    foreach ($tools as $t) {
        if (($t['id'] ?? '') === $id) return $t;
    }
    return null;
}

// ── Jenkins trigger + status polling (same logic as jenkins-portal) ──────────
function soj_triggerBuild(array $server, string $jobPath): array {
    $base = rtrim($server['base_url'], '/');

    // 1. CSRF crumb (optional on Jenkins)
    [$crumbBody, $crumbCode] = soj_jenkinsRequest($server, $base . '/crumbIssuer/api/json');
    $crumbHeaders = [];
    if ($crumbCode === 200) {
        $crumbData = json_decode($crumbBody, true);
        if (!empty($crumbData['crumbRequestField']) && !empty($crumbData['crumb'])) {
            $crumbHeaders[] = $crumbData['crumbRequestField'] . ': ' . $crumbData['crumb'];
        }
    }

    // 2. POST /build — encode each path segment so job names with spaces don't
    // trip CURLE_URL_MALFORMAT (errno 3).
    $encPath  = '/' . implode('/', array_map('rawurlencode', explode('/', trim($jobPath, '/'))));
    $buildUrl = $base . $encPath . '/build';
    $respHeaders = [];
    [, $code, $err] = soj_jenkinsRequest($server, $buildUrl, 'POST', '', $crumbHeaders, $respHeaders);

    // Jenkins returns 400 when the job is parameterized (even with all-defaults).
    // Fall back to /buildWithParameters with an empty JSON body.
    if ($code === 400) {
        $respHeaders = [];
        $wpHeaders   = array_merge($crumbHeaders, ['Content-Type: application/x-www-form-urlencoded']);
        [, $code, $err] = soj_jenkinsRequest($server, $base . $encPath . '/buildWithParameters', 'POST', 'json={}', $wpHeaders, $respHeaders);
    }

    if ($err !== '' || $code === 0) return ['ok' => false, 'error' => 'Cannot reach Jenkins: ' . $err];
    if ($code === 401)              return ['ok' => false, 'error' => 'Jenkins rejected credentials — token may be invalid or expired'];
    if ($code === 403)              return ['ok' => false, 'error' => 'Access denied — insufficient Jenkins permissions'];
    if ($code === 404)              return ['ok' => false, 'error' => 'Job not found'];
    if (!in_array($code, [200, 201, 302], true)) return ['ok' => false, 'error' => "Jenkins returned HTTP {$code}"];

    $queueUrl = '';
    $queueId  = '';
    foreach ($respHeaders as $_h) {
        if (stripos($_h, 'Location:') !== 0) continue;
        $queueUrl = trim(substr($_h, 9));
        if (preg_match('#/queue/item/(\d+)/?$#', $queueUrl, $_m)) $queueId = $_m[1];
    }
    return ['ok' => true, 'queue_url' => $queueUrl, 'queue_id' => $queueId];
}

function soj_pollStatus(array $server, string $queueId): array {
    if ($queueId === '') return ['status' => 'Unknown', 'progress' => 0, 'result' => null];
    $base = rtrim($server['base_url'], '/');

    [$body, $code] = soj_jenkinsRequest($server, $base . "/queue/item/{$queueId}/api/json");
    if ($code === 200) {
        $data = json_decode($body, true);
        if (!empty($data['executable']['url'])) {
            $buildUrl = rtrim($data['executable']['url'], '/') . '/api/json';
            [$bBody, $bCode] = soj_jenkinsRequest($server, $buildUrl);
            if ($bCode === 200) {
                $b = json_decode($bBody, true);
                if (!empty($b['building'])) {
                    return ['status' => 'Building', 'progress' => 50, 'result' => null, 'number' => $b['number'] ?? null];
                }
                return ['status' => 'Finished', 'progress' => 100, 'result' => $b['result'] ?? 'UNKNOWN', 'number' => $b['number'] ?? null, 'duration' => isset($b['duration']) ? (int)$b['duration'] : null];
            }
        }
        return ['status' => 'In Queue', 'progress' => 10, 'result' => null];
    }
    return ['status' => 'Unknown', 'progress' => 0, 'result' => null, 'message' => 'Queue item not found in Jenkins'];
}

// Light job health check (one call, short timeout) — for the status card.
function soj_jobStatus(array $server, string $jobPath): array {
    $base = rtrim($server['base_url'], '/');
    $enc  = implode('/', array_map('rawurlencode', explode('/', trim($jobPath, '/'))));
    [$body, $code, $err] = soj_jenkinsRequest($server, $base . '/' . $enc . '/api/json?tree=lastBuild[number,timestamp,result]');
    if ($code !== 200) {
        return ['reachable' => false, 'message' => $err !== '' ? $err : "Jenkins HTTP {$code}"];
    }
    $data  = json_decode($body, true);
    $last  = $data['lastBuild'] ?? null;
    return [
        'reachable' => true,
        'last_build' => $last ? [
            'number'    => $last['number'] ?? null,
            'timestamp' => isset($last['timestamp']) ? date('c', (int)($last['timestamp'] / 1000)) : null,
            'result'    => $last['result'] ?? 'UNKNOWN',
        ] : null,
    ];
}

function soj_historyStatus(string $status): string {
    $s = strtolower($status);
    if ($s === 'success')         return 'success';
    if ($s === 'failure')         return 'failure';
    if ($s === 'aborted')         return 'aborted';
    if (in_array($s, ['building', 'in queue', 'queued', 'pending', 'running'], true)) return $s === 'pending' ? 'queued' : ($s === 'running' ? 'building' : $s);
    return 'unknown';
}

// ── History stats (status cards) ─────────────────────────────────────────────
function soj_stats(array $history): array {
    $recent = array_slice($history, 0, 50);
    $total  = count($recent);
    $succ   = 0; $fail = 0;
    $lastBuild = null;
    foreach ($recent as $h) {
        $s = soj_historyStatus($h['status'] ?? '');
        if ($s === 'success') $succ++;
        elseif ($s === 'failure' || $s === 'aborted') $fail++;
        if ($lastBuild === null && !empty($h['build_id'])) $lastBuild = $h['build_id'];
    }
    return [
        'total_entries' => count($history),
        'total'         => $total,
        'success'       => $succ,
        'failure'       => $fail,
        'success_rate'  => $total ? round(($succ / $total) * 100) : null,
        'last_build'    => $lastBuild,
    ];
}

// ── GET ───────────────────────────────────────────────────────────────────────
if ($method === 'GET') {
    // Poll a specific queue item (triggered build)
    if (isset($_GET['action']) && $_GET['action'] === 'status') {
        $queueId = trim($_GET['queue_id'] ?? '');
        $toolId  = trim($_GET['tool_id'] ?? '');
        $tool = soj_findTool($tools, $toolId);
        if (!$tool) respondError('Unknown tool', 404);
        $serverId = trim($tool['server_id'] ?? '');
        if (!$serverId || !isset($servers[$serverId])) respondError('Tool server not configured', 404);
        respondOk(soj_pollStatus($servers[$serverId], $queueId));
    }

    // Live Jenkins job status (status card)
    if (isset($_GET['status']) && $_GET['status'] !== '0') {
        $tool = $tools[0] ?? null;
        if (!$tool) respondOk(['reachable' => false, 'message' => 'No tool configured']);
        $serverId = trim($tool['server_id'] ?? '');
        if (!$serverId || !isset($servers[$serverId])) respondOk(['reachable' => false, 'message' => 'Server not configured']);
        respondOk(soj_jobStatus($servers[$serverId], $tool['job_path'] ?? ''));
    }

    if (isset($_GET['history']) && $_GET['history'] !== '0') {
        // Auto-sync live builds (queued / building) so statuses stay fresh
        $history = readJson('so-jenkins-builds.json');
        $now     = time();
        $changed = false;
        foreach ($history as &$h) {
            $curStatus = soj_historyStatus($h['status'] ?? '');
            if (!in_array($curStatus, ['queued', 'building', 'in queue'], true)) continue;
            $tool     = soj_findTool($tools, $h['tool_id'] ?? '');
            $serverId = $tool['server_id'] ?? '';
            if (!$tool || !$serverId || !isset($servers[$serverId])) continue;
            $server = $servers[$serverId];
            $base   = rtrim($server['base_url'], '/');
            $st     = null;

            if (!empty($h['build_id'])) {
                // Build already left the queue — query by build number directly.
                // This resolves stuck "Building" entries regardless of age or
                // whether the Jenkins queue item has expired.
                $encPath = '/' . implode('/', array_map('rawurlencode', explode('/', trim($tool['job_path'] ?? '', '/'))));
                [$bBody, $bCode] = soj_jenkinsRequest($server, $base . $encPath . '/' . (int)$h['build_id'] . '/api/json');
                if ($bCode === 200) {
                    $b = json_decode($bBody, true);
                    $st = empty($b['building'])
                        ? ['status' => 'Finished', 'result' => $b['result'] ?? 'UNKNOWN',
                           'number' => $b['number'] ?? null, 'duration' => isset($b['duration']) ? (int)$b['duration'] : null]
                        : ['status' => 'Building',  'result' => null, 'number' => $b['number'] ?? null, 'duration' => null];
                }
            } elseif (!empty($h['queue_id'])) {
                // No build number yet — use queue poll (skip if older than 1 h)
                $ts = strtotime($h['ts'] ?? '0') ?: 0;
                if ($now - $ts > 3600) continue;
                $st = soj_pollStatus($server, $h['queue_id']);
            }

            if ($st === null) continue;
            $newStatus = null;
            if ($st['status'] === 'Finished') {
                $newStatus = soj_historyStatus($st['result'] ?? 'UNKNOWN');
                $h['build_id'] = $st['number'] ?? ($h['build_id'] ?? null);
                $h['result']   = $st['result'] ?? null;
                if (!empty($st['duration'])) $h['duration'] = (int)$st['duration'];
            } elseif ($st['status'] === 'Building' || $st['status'] === 'In Queue') {
                $newStatus = soj_historyStatus($st['status']);
            }
            if ($newStatus !== null && $newStatus !== $curStatus) {
                $h['status'] = $newStatus;
                $changed = true;
            }
        }
        unset($h);
        if ($changed) writeJson('so-jenkins-builds.json', $history);
        respondOk(array_slice($history, 0, 200));
    }

    if (isset($_GET['logs']) && $_GET['logs'] !== '0') {
        // Activity logs are viewable by every so-jenkins user (like the original
        // app); clearing is admin-only.
        $logs = readJson('so-jenkins-logs.json');
        respondOk(is_array($logs) ? array_slice($logs, 0, 500) : []);
    }

    if (isset($_GET['users']) && $_GET['users'] !== '0') {
        if (!soj_isAdmin($payload)) respondError('Forbidden: admin only', 403);
        $users = [];
        foreach (readJson('users.json') as $u) {
            if (($u['team'] ?? '') !== 'sojenkins') continue;
            $row = [
                'id'        => $u['id'],
                'username'  => $u['username'],
                'name'      => $u['name'] ?? '',
                'email'     => $u['email'] ?? '',
                'soj_role'  => $u['soj_role'] ?? 'user',
                'status'    => $u['status'] ?? 'active',
                'first_login' => (bool)($u['first_login'] ?? false),
                'last_login'=> $u['last_login'] ?? null,
                'created_at'=> $u['created_at'] ?? null,
            ];
            $users[] = $row;
        }
        usort($users, fn($a, $b) => strcmp($a['username'], $b['username']));
        respondOk(['users' => $users, 'me' => $payload['sub']]);
    }

    // Default: config — tools + servers + stats + role
    $history = readJson('so-jenkins-builds.json');
    $serverList = [];
    foreach ($servers as $id => $s) {
        $serverList[$id] = ['display' => $s['display'] ?? $id, 'base_url' => $s['base_url'] ?? ''];
    }
    respondOk([
        'tools'     => $tools,
        'servers'   => $serverList,
        'stats'     => soj_stats(is_array($history) ? $history : []),
        'can_admin' => soj_isAdmin($payload),
    ]);
}

// ── POST ──────────────────────────────────────────────────────────────────────
if ($method === 'POST') {
    requireCsrf();
    $body   = getBody();
    $action = trim($body['action'] ?? '');

    // ── trigger — fire the build (no parameters) ─────────────────────────────
    if ($action === 'trigger') {
        $toolId = trim($body['tool_id'] ?? '');
        $tool   = soj_findTool($tools, $toolId);
        if (!$tool) respondError('Unknown tool', 404);

        $serverId = trim($tool['server_id'] ?? '');
        if (!$serverId || !isset($servers[$serverId])) respondError('Tool server not configured — ติดต่อ Admin', 404);

        $res = soj_triggerBuild($servers[$serverId], $tool['job_path']);
        if (!$res['ok']) respondError($res['error'], 502);

        $entry = [
            'id'        => genId('build'),
            'ts'        => date('c'),
            'tool_id'   => $toolId,
            'tool_name' => $tool['name'] ?? $toolId,
            'user_id'   => $payload['sub'],
            'user_name' => $payload['name'] ?? $payload['username'] ?? '',
            'username'  => $payload['username'] ?? '',
            'status'    => 'queued',
            'queue_id'  => $res['queue_id'],
            'queue_url' => $res['queue_url'],
            'build_id'  => null,
            'duration'  => null,
            'result'    => null,
            'ip'        => $_SERVER['REMOTE_ADDR'] ?? '',
        ];
        $history = readJson('so-jenkins-builds.json');
        if (!is_array($history)) $history = [];
        array_unshift($history, $entry);
        writeJson('so-jenkins-builds.json', array_slice($history, 0, 200));

        // Note: build audit trail lives in so-jenkins-builds.json only. The separate
        // so-jenkins-logs.json (activity log) is deprecated for build events — the
        // ?logs=1 endpoint still serves it for backward compat, but no writes here.

        logActivity('so_jenkins_trigger', [
            'tool' => $toolId, 'job' => $tool['job_path'], 'queue_id' => $res['queue_id'],
        ], $payload['sub'], $payload['name'] ?? '');
        respondOk([
            'status'   => 'queued',
            'queue_id' => $res['queue_id'],
            'queue_url'=> $res['queue_url'],
        ], 'Build queued successfully');
    }

    // ── Users CRUD (admin, sojenkins team only) ──────────────────────────────
    if (in_array($action, ['create_user', 'update_user', 'delete_user', 'reset_password', 'unlock_user'], true)) {
        if (!soj_isAdmin($payload)) respondError('Forbidden: admin access required', 403);
        $users = readJson('users.json');

        if ($action === 'create_user') {
            $username = trim((string)($body['username'] ?? ''));
            $email    = trim((string)($body['email'] ?? ''));
            $role     = in_array($body['soj_role'] ?? '', ['admin', 'user'], true) ? $body['soj_role'] : 'user';
            if ($username === '' || $email === '') respondError('กรุณากรอก username และ email', 422);
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) respondError('รูปแบบอีเมลไม่ถูกต้อง', 422);
            if (!preg_match('/^[a-zA-Z0-9._-]+$/', $username)) respondError('Username ใช้ได้เฉพาะ a-z, 0-9, . _ -', 422);
            foreach ($users as $u) {
                if (strtolower((string)$u['username']) === strtolower($username)) respondError('ชื่อผู้ใช้นี้มีอยู่แล้ว', 409);
            }
            $tempPw = 'Soj' . substr(bin2hex(random_bytes(4)), 0, 8) . '!';
            $users[] = [
                'id'           => 'usr_soj_' . bin2hex(random_bytes(6)),
                'name'         => $username,
                'nickname'     => '',
                'username'     => $username,
                'email'        => $email,
                'role'         => 'external',
                'team'         => 'sojenkins',
                'password'     => hashPassword($tempPw),
                'password_history' => [],
                'password_changed_at' => date('c'),
                'first_login'  => true,
                'must_reset_password' => true,
                'created_at'   => date('c'),
                'created_by'   => $payload['sub'],
                'permissions'  => ['so-jenkins'],
                'soj_role'     => $role,
                'schedule_include' => false,
                'course_include'   => false,
                'exam_include'     => false,
                'password_expired' => false,
                'status'       => 'active',
            ];
            writeJson('users.json', $users);
            logActivity('so_jenkins_user_create', ['username' => $username, 'role' => $role], $payload['sub'], $payload['name'] ?? '');
            respondOk(['username' => $username, 'temp_password' => $tempPw], 'สร้างผู้ใช้สำเร็จ — แจ้งรหัสผ่านชั่วคราวให้ผู้ใช้นี้');
        }

        $targetId = (string)($body['user_id'] ?? '');
        $target = null;
        foreach ($users as &$u) {
            if (($u['id'] ?? '') === $targetId && ($u['team'] ?? '') === 'sojenkins') { $target = &$u; break; }
        }
        unset($u);
        if (!$target) respondError('ไม่พบผู้ใช้ใน SO Jenkins', 404);

        if ($action === 'update_user') {
            $username = trim((string)($body['username'] ?? ''));
            $email    = trim((string)($body['email'] ?? ''));
            $role     = $body['soj_role'] ?? null;
            if ($username !== '') {
                if (!preg_match('/^[a-zA-Z0-9._-]+$/', $username)) respondError('Username ใช้ได้เฉพาะ a-z, 0-9, . _ -', 422);
                foreach ($users as $u2) {
                    if (($u2['id'] ?? '') !== $targetId && strtolower((string)$u2['username']) === strtolower($username)) {
                        respondError('ชื่อผู้ใช้นี้มีอยู่แล้ว', 409);
                    }
                }
                $target['username'] = $username;
            }
            if ($email !== '') {
                if (!filter_var($email, FILTER_VALIDATE_EMAIL)) respondError('รูปแบบอีเมลไม่ถูกต้อง', 422);
                $target['email'] = $email;
            }
            if ($role !== null && in_array($role, ['admin', 'user'], true)) {
                $target['soj_role'] = $role;
                $target['permissions'] = ['so-jenkins'];
                unset($target['menu_permissions']);
            }
            writeJson('users.json', $users);
            logActivity('so_jenkins_user_update', ['user' => $targetId], $payload['sub'], $payload['name'] ?? '');
            respondOk(null, 'อัปเดตผู้ใช้เรียบร้อย');
        }

        if ($action === 'reset_password') {
            $tempPw = 'Soj' . substr(bin2hex(random_bytes(4)), 0, 8) . '!';
            $target['password'] = hashPassword($tempPw);
            $target['first_login'] = true;
            $target['must_reset_password'] = true;
            $target['password_changed_at'] = date('c');
            writeJson('users.json', $users);
            logActivity('so_jenkins_user_reset', ['user' => $targetId], $payload['sub'], $payload['name'] ?? '');
            respondOk(['temp_password' => $tempPw], 'รีเซ็ตรหัสผ่านสำเร็จ');
        }

        if ($action === 'unlock_user') {
            if (($target['status'] ?? '') !== 'locked') respondError('บัญชีนี้ไม่ได้ถูกล็อค', 409);
            $target['status'] = 'active';
            unset($target['locked_at'], $target['locked_reason']);
            writeJson('users.json', $users);
            logActivity('so_jenkins_user_unlock', ['user' => $targetId], $payload['sub'], $payload['name'] ?? '');
            respondOk(null, 'ปลดล็อคบัญชีเรียบร้อย');
        }

        if ($action === 'delete_user') {
            if ($targetId === $payload['sub']) respondError('ไม่สามารถลบบัญชีตัวเองได้', 409);
            $adminCount = 0;
            foreach ($users as $u2) {
                if (($u2['id'] ?? '') !== $targetId && ($u2['team'] ?? '') === 'sojenkins' && ($u2['soj_role'] ?? '') === 'admin') $adminCount++;
            }
            if (($target['soj_role'] ?? '') === 'admin' && $adminCount < 1) respondError('ต้องมี Admin อย่างน้อย 1 คน', 409);
            $users = array_values(array_filter($users, fn($u2) => ($u2['id'] ?? '') !== $targetId));
            writeJson('users.json', $users);
            logActivity('so_jenkins_user_delete', ['user' => $targetId], $payload['sub'], $payload['name'] ?? '');
            respondOk(null, 'ลบผู้ใช้เรียบร้อย');
        }
    }

    // ── Clear build history (admin) — used by the merged History panel ──────
    if ($action === 'clear_history') {
        if (!soj_isAdmin($payload)) respondError('Forbidden: admin access required', 403);
        writeJson('so-jenkins-builds.json', []);
        logActivity('so_jenkins_history_clear', [], $payload['sub'], $payload['name'] ?? '');
        respondOk(null, 'ล้างประวัติเรียบร้อย');
    }

    // ── Clear activity logs (admin, legacy) — kept for backward compat ──────
    if ($action === 'clear_logs') {
        if (!soj_isAdmin($payload)) respondError('Forbidden: admin access required', 403);
        writeJson('so-jenkins-logs.json', []);
        logActivity('so_jenkins_logs_clear', [], $payload['sub'], $payload['name'] ?? '');
        respondOk(null, 'ล้าง Logs เรียบร้อย');
    }

    respondError('Unknown POST action', 400);
}

respondError('Method not allowed', 405);
