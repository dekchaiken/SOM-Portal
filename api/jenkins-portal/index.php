<?php
// ─── Jenkins Portal (Unbind Trigger) API ─────────────────────────────────────
// Config-driven Jenkins trigger for the "Unbind Google-Huawei-Amazon" job,
// scoped per team (team slug: jenkins). Migrated from the standalone
// jenkins-portal app: applications list, build history, sessions + build logs
// all live under data/{team}/.
//
// GET   /api/jenkins-portal/                  → config (tools, apps, stats, can_admin)
// GET   /api/jenkins-portal/?history=1        → build history (team-scoped, auto-syncs live builds)
// GET   /api/jenkins-portal/?logs=1           → raw build logs (admin)
// GET   /api/jenkins-portal/?sessions=1       → login sessions (admin)
// GET   /api/jenkins-portal/?users=1          → jenkins-portal users (admin, team-scoped)
// GET   /api/jenkins-portal/?status=1         → live Jenkins job status (last build, reachable)
// GET   /api/jenkins-portal/?action=status&queue_id=X → poll a triggered build
// POST  /api/jenkins-portal/ { action:'trigger', tool_id, params } → validate → trigger
// POST  /api/jenkins-portal/ { action:'add_app'|'update_app'|'delete_app', ... } → apps CRUD (admin)
// POST  /api/jenkins-portal/ { action:'create_user'|'update_user'|'delete_user'|'reset_password'|'unlock_user', ... } → users CRUD (admin, jenkins team only)
// POST  /api/jenkins-portal/ { action:'clear_history' } → wipe build history (admin)
// POST  /api/jenkins-portal/ { action:'clear_logs' } → wipe legacy logs file (admin, deprecated)
//
// Access model:
//   • Team feature 'jenkins-portal' (teams.json) — super_admin bypasses.
//   • external role additionally needs a jenkins-portal page permission
//     ('jenkins-portal' | 'jenkins-portal-logs' | 'jenkins-portal-admin').
//   • Admin actions require jp_role === 'admin' (jenkins-portal's own role) or super_admin.
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];

// Per-user cross-team override: switch _current_team to source_team before any
// feature/data check so a user from another team can access this page's data.
applyExtraPageTeam($payload, 'jenkins-portal');

// super_admin / super_viewer in "All Teams" mode: fall back to the first team
// that has tools (data/jenkins/) so the page isn't empty.
teamContextFallbackForGlobalRole($payload, 'jenkins-portal-tools.json');

// ── Gates ─────────────────────────────────────────────────────────────────────
requireTeamFeature($payload, 'jenkins-portal');

if (($payload['role'] ?? '') === 'external') {
    $jpPerms = [];
    foreach (readJson('users.json') as $_u) {
        if (($_u['id'] ?? '') === $payload['sub']) {
            $jpPerms = $_u['permissions'] ?? [];
            break;
        }
    }
    if (!in_array('jenkins-portal', $jpPerms, true)) {
        logSecurity('forbidden_page', ['page' => 'jenkins-portal', 'user_role' => 'external'], $payload['sub'], $payload['name'] ?? '');
        respondError('Forbidden: no permission for this page', 403);
    }
}

// ── Team context ──────────────────────────────────────────────────────────────
$tools    = readJson('jenkins-portal-tools.json');
$servers  = require __DIR__ . '/../jenkins_config.php'; // keyed by server id

// ── Shared cURL helper (mirrors jenkins-build's jb_jenkinsRequest) ───────────
function jp_jenkinsRequest(array $server, string $url, string $method = 'GET', $postFields = null, array $extraHeaders = [], ?array &$respHeaders = null): array {
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
        CURLOPT_USERAGENT      => 'CentralizeSOM/1.0 Jenkins-Portal',
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
    $body    = curl_exec($ch);
    $info    = curl_getinfo($ch);
    $code    = (int)($info['http_code'] ?? 0);
    $errno   = curl_errno($ch);
    $err     = curl_error($ch);
    curl_close($ch);
    if (is_array($respHeaders)) $respHeaders = $hdrs;
    // Diagnostic: log full curl outcome when it fails so we can see WHY.
    // Remove once jenkins-ops trigger is stable.
    if ($err !== '' || $code === 0 || $code >= 500) {
        error_log(sprintf(
            '[jenkins-portal] curl_fail url=%s method=%s http_code=%d errno=%d err=%s primary_ip=%s connect_time=%.3f total_time=%.3f body_size=%d',
            $url, $method, $code, $errno, ($err ?: '(empty)'),
            $info['primary_ip'] ?? '', (float)($info['connect_time'] ?? 0),
            (float)($info['total_time'] ?? 0), (int)($info['size_download'] ?? 0)
        ));
        hostCooldownMark($host, $err !== '' ? $err : ($errno ? "curl errno {$errno}" : "HTTP {$code}"));
    }
    // If curl had a genuine error but curl_error() came back empty (some libcurl
    // builds do this on connect failures), surface the errno so the UI shows
    // something useful instead of a blank "Cannot reach Jenkins:".
    if ($err === '' && $errno !== 0) {
        $err = 'curl errno ' . $errno;
    }
    return [$body, $code, $err];
}

// ── Role helpers ──────────────────────────────────────────────────────────────
// jenkins-portal has its own user/admin roles (jp_role). Management (apps, users,
// sessions, clear logs) is admin-only and scoped to the jenkins team.
function jp_isAdmin(array $payload): bool {
    if (($payload['role'] ?? '') === 'super_admin') return true;
    if (($payload['role'] ?? '') !== 'external') return false;
    foreach (readJson('users.json') as $_u) {
        if (($_u['id'] ?? '') === $payload['sub']) {
            return ($_u['jp_role'] ?? '') === 'admin';
        }
    }
    return false;
}

function jp_findTool(array $tools, string $id): ?array {
    foreach ($tools as $t) {
        if (($t['id'] ?? '') === $id) return $t;
    }
    return null;
}

function jp_apps(): array {
    $apps = readJson('jenkins-portal-apps.json');
    return is_array($apps) ? $apps : [];
}

function jp_enabledAppNames(): array {
    $out = [];
    foreach (jp_apps() as $a) {
        if (!isset($a['enabled']) || $a['enabled'] === true) $out[] = $a['name'];
    }
    return $out;
}

// ── Param validation against the tool's schema ───────────────────────────────
// Options-type params (e.g. the Application dropdown) are validated against the
// team's applications list; `job_param` maps a form key to the Jenkins parameter
// name (e.g. tmnId → tmn). Returns [ $cleanParams, $errors[] ].
function jp_validateParams(array $tool, array $in, array $payload): array {
    $out    = [];
    $errors = [];
    foreach (($tool['params'] ?? []) as $p) {
        $key = trim((string)($p['key'] ?? ''));
        if ($key === '') continue;
        $label = $p['label'] ?? $key;
        $type  = $p['type'] ?? 'text';
        $val   = trim((string)($in[$key] ?? ''));
        if (!empty($p['required']) && $val === '') { $errors[] = "{$label} จำเป็นต้องกรอก"; continue; }
        if ($type === 'options' && $val !== '') {
            $source = $p['source'] ?? '';
            if ($source === 'apps' && !in_array($val, jp_enabledAppNames(), true)) {
                $errors[] = "{$label} ไม่อยู่ในรายการที่เปิดใช้งาน"; continue;
            }
        }
        if ($val !== '' && !empty($p['pattern'])) {
            $pattern = '/' . str_replace('/', '\\/', $p['pattern']) . '/';
            if (@preg_match($pattern, $val) !== 1) { $errors[] = "{$label} รูปแบบไม่ถูกต้อง"; continue; }
        }
        $out[$key] = $val;
    }
    foreach (($tool['auto_params'] ?? []) as $autoKey => $type) {
        if ($type === 'username') $out[$autoKey] = $payload['username'] ?? '';
        elseif ($type === 'name') $out[$autoKey] = $payload['name'] ?? '';
    }
    return [$out, $errors];
}

// Map form params to Jenkins parameter names (job_param override, e.g. tmnId→tmn).
function jp_jobParams(array $tool, array $params): array {
    $out = [];
    foreach (($tool['params'] ?? []) as $p) {
        $key = trim((string)($p['key'] ?? ''));
        if ($key === '' || !isset($params[$key])) continue;
        $out[$p['job_param'] ?? $key] = $params[$key];
    }
    foreach (($tool['auto_params'] ?? []) as $autoKey => $type) {
        if (isset($params[$autoKey])) $out[$autoKey] = $params[$autoKey];
    }
    return $out;
}

// ── Jenkins trigger + status polling ─────────────────────────────────────────
function jp_triggerBuild(array $server, string $jobPath, array $params): array {
    $base = rtrim($server['base_url'], '/');

    // 1. CSRF crumb (optional on Jenkins)
    [$crumbBody, $crumbCode] = jp_jenkinsRequest($server, $base . '/crumbIssuer/api/json');
    $crumbHeaders = [];
    if ($crumbCode === 200) {
        $crumbData = json_decode($crumbBody, true);
        if (!empty($crumbData['crumbRequestField']) && !empty($crumbData['crumb'])) {
            $crumbHeaders[] = $crumbData['crumbRequestField'] . ': ' . $crumbData['crumb'];
        }
    }

    // 2. POST /buildWithParameters — encode each path segment (job names may
    // contain spaces or other reserved chars, e.g. "Unbind Google-Huawei-Amazon").
    // Without this curl aborts with CURLE_URL_MALFORMAT (errno 3).
    $encPath   = '/' . implode('/', array_map('rawurlencode', explode('/', trim($jobPath, '/'))));
    $hasParams = !empty($params) && is_array($params);
    $buildUrl  = $base . $encPath . ($hasParams ? '/buildWithParameters' : '/build');
    $postBody  = $hasParams ? http_build_query($params) : '';
    $buildHdrs = $crumbHeaders;
    if ($hasParams) $buildHdrs[] = 'Content-Type: application/x-www-form-urlencoded';

    $respHeaders = [];
    [, $code, $err] = jp_jenkinsRequest($server, $buildUrl, 'POST', $postBody, $buildHdrs, $respHeaders);

    if ($err !== '' || $code === 0)        return ['ok' => false, 'error' => 'Cannot reach Jenkins: ' . $err];
    if ($code === 401)                     return ['ok' => false, 'error' => 'Jenkins rejected credentials — token may be invalid or expired'];
    if ($code === 403)                     return ['ok' => false, 'error' => 'Access denied — insufficient Jenkins permissions'];
    if ($code === 404)                     return ['ok' => false, 'error' => 'Job not found'];
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

function jp_pollStatus(array $server, string $queueId): array {
    if ($queueId === '') return ['status' => 'Unknown', 'progress' => 0, 'result' => null];
    $base = rtrim($server['base_url'], '/');

    [$body, $code] = jp_jenkinsRequest($server, $base . "/queue/item/{$queueId}/api/json");
    if ($code === 200) {
        $data = json_decode($body, true);
        if (!empty($data['executable']['url'])) {
            $buildUrl = rtrim($data['executable']['url'], '/') . '/api/json';
            [$bBody, $bCode] = jp_jenkinsRequest($server, $buildUrl);
            if ($bCode === 200) {
                $b = json_decode($bBody, true);
                if (!empty($b['building'])) {
                    return ['status' => 'Building', 'progress' => 50, 'result' => null, 'number' => $b['number'] ?? null];
                }
                return ['status' => 'Finished', 'progress' => 100, 'result' => $b['result'] ?? 'UNKNOWN', 'number' => $b['number'] ?? null];
            }
        }
        return ['status' => 'In Queue', 'progress' => 10, 'result' => null];
    }
    return ['status' => 'Unknown', 'progress' => 0, 'result' => null, 'message' => 'Queue item not found in Jenkins'];
}

// Light job health check (one call, short timeout) — for the status card.
function jp_jobStatus(array $server, string $jobPath): array {
    $base = rtrim($server['base_url'], '/');
    $enc  = implode('/', array_map('rawurlencode', explode('/', trim($jobPath, '/'))));
    [$body, $code] = jp_jenkinsRequest($server, $base . '/' . $enc . '/api/json?tree=lastBuild[number,timestamp,result]');
    if ($code !== 200) {
        return ['reachable' => false, 'message' => "Jenkins HTTP {$code}"];
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

function jp_historyStatus(string $status): string {
    $s = strtolower($status);
    if ($s === 'success')         return 'success';
    if ($s === 'failure')         return 'failure';
    if ($s === 'aborted')         return 'aborted';
    if (in_array($s, ['building', 'in queue', 'queued', 'pending'], true)) return $s === 'pending' ? 'queued' : $s;
    return 'unknown';
}

// ── History stats (status cards) ─────────────────────────────────────────────
function jp_stats(array $history): array {
    $recent = array_slice($history, 0, 50);
    $total  = count($recent);
    $succ   = 0; $fail = 0;
    $lastBuild = null;
    foreach ($recent as $h) {
        $s = jp_historyStatus($h['status'] ?? '');
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
        $tool = jp_findTool($tools, $toolId);
        if (!$tool) respondError('Unknown tool', 404);
        $serverId = trim($tool['server_id'] ?? '');
        if (!$serverId || !isset($servers[$serverId])) respondError('Tool server not configured', 404);
        respondOk(jp_pollStatus($servers[$serverId], $queueId));
    }

    // Live Jenkins job status (status card)
    if (isset($_GET['status']) && $_GET['status'] !== '0') {
        $tool = $tools[0] ?? null;
        if (!$tool) respondOk(['reachable' => false, 'message' => 'No tool configured']);
        $serverId = trim($tool['server_id'] ?? '');
        if (!$serverId || !isset($servers[$serverId])) respondOk(['reachable' => false, 'message' => 'Server not configured']);
        respondOk(jp_jobStatus($servers[$serverId], $tool['job_path'] ?? ''));
    }

    if (isset($_GET['history']) && $_GET['history'] !== '0') {
        // Auto-sync live builds (queued / building) so statuses stay fresh
        $history = readJson('jenkins-portal-history.json');
        $now     = time();
        $changed = false;
        foreach ($history as &$h) {
            if (!in_array(jp_historyStatus($h['status'] ?? ''), ['queued', 'building', 'in queue'], true)) continue;
            $ts = strtotime($h['ts'] ?? '0') ?: 0;
            if ($now - $ts > 3600) continue; // don't chase stale builds
            $tool = jp_findTool($tools, $h['tool_id'] ?? '');
            $serverId = $tool['server_id'] ?? '';
            if (!$tool || !$serverId || !isset($servers[$serverId]) || empty($h['queue_id'])) continue;
            $st = jp_pollStatus($servers[$serverId], $h['queue_id']);
            $newStatus = null;
            if ($st['status'] === 'Finished') {
                $newStatus = jp_historyStatus($st['result'] ?? 'UNKNOWN');
                $h['build_id'] = $st['number'] ?? ($h['build_id'] ?? null);
            } elseif ($st['status'] === 'Building' || $st['status'] === 'In Queue') {
                $newStatus = jp_historyStatus($st['status']);
            }
            if ($newStatus !== null && $newStatus !== jp_historyStatus($h['status'] ?? '')) {
                $h['status'] = $newStatus;
                $changed = true;
            }
        }
        unset($h);
        if ($changed) writeJson('jenkins-portal-history.json', $history);
        respondOk(array_slice($history, 0, 200));
    }

    if (isset($_GET['logs']) && $_GET['logs'] !== '0') {
        // Build logs are viewable by every jenkins-portal user (like the original
        // app); clearing is admin-only.
        $logs = readJson('jenkins-portal-logs.json');
        respondOk(is_array($logs) ? array_slice(array_reverse($logs), 0, 500) : []);
    }

    if (isset($_GET['sessions']) && $_GET['sessions'] !== '0') {
        if (!jp_isAdmin($payload)) respondError('Forbidden: admin only', 403);
        $sessions = readJson('jenkins-portal-sessions.json');
        $list = [];
        if (is_array($sessions)) {
            if (isset($sessions['sessions']) && is_array($sessions['sessions'])) {
                foreach ($sessions['sessions'] as $sid => $s) {
                    $list[] = ['session_id' => $sid] + (is_array($s) ? $s : []);
                }
            } else {
                $list = $sessions;
            }
        }
        respondOk(array_slice(array_reverse($list), 0, 200));
    }

    if (isset($_GET['users']) && $_GET['users'] !== '0') {
        if (!jp_isAdmin($payload)) respondError('Forbidden: admin only', 403);
        $users = [];
        foreach (readJson('users.json') as $u) {
            if (($u['team'] ?? '') !== 'jenkins') continue;
            $row = [
                'id'        => $u['id'],
                'username'  => $u['username'],
                'name'      => $u['name'] ?? '',
                'email'     => $u['email'] ?? '',
                'jp_role'   => $u['jp_role'] ?? 'user',
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

    // Default: config — tools + servers + apps + stats + role
    $history = readJson('jenkins-portal-history.json');
    $serverList = [];
    foreach ($servers as $id => $s) {
        $serverList[$id] = ['display' => $s['display'] ?? $id, 'base_url' => $s['base_url'] ?? ''];
    }
    $apps = jp_apps();
    if (!jp_isAdmin($payload)) {
        $apps = array_values(array_filter($apps, fn($a) => !isset($a['enabled']) || $a['enabled'] === true));
    }
    respondOk([
        'tools'     => $tools,
        'servers'   => $serverList,
        'apps'      => $apps,
        'stats'     => jp_stats(is_array($history) ? $history : []),
        'can_admin' => jp_isAdmin($payload),
    ]);
}

// ── POST ──────────────────────────────────────────────────────────────────────
if ($method === 'POST') {
    requireCsrf();
    $body   = getBody();
    $action = trim($body['action'] ?? '');

    // ── trigger — validate then fire the build ───────────────────────────────
    if ($action === 'trigger') {
        $toolId = trim($body['tool_id'] ?? '');
        $tool   = jp_findTool($tools, $toolId);
        if (!$tool) respondError('Unknown tool', 404);

        $serverId = trim($tool['server_id'] ?? '');
        if (!$serverId || !isset($servers[$serverId])) respondError('Tool server not configured — ติดต่อ Admin', 404);

        [$params, $errors] = jp_validateParams($tool, $body['params'] ?? [], $payload);
        if ($errors) respondError(implode(' · ', $errors), 422);

        $res = jp_triggerBuild($servers[$serverId], $tool['job_path'], jp_jobParams($tool, $params));
        if (!$res['ok']) respondError($res['error'], 502);

        $entry = [
            'id'        => genId('build'),
            'ts'        => date('c'),
            'tool_id'   => $toolId,
            'tool_name' => $tool['name'] ?? $toolId,
            'user_id'   => $payload['sub'],
            'user_name' => $payload['name'] ?? $payload['username'] ?? '',
            'params'    => $params,
            'status'    => 'queued',
            'queue_id'  => $res['queue_id'],
            'queue_url' => $res['queue_url'],
            'build_id'  => null,
            'result'    => null,
            'ip'        => $_SERVER['REMOTE_ADDR'] ?? '',
        ];
        $history = readJson('jenkins-portal-history.json');
        if (!is_array($history)) $history = [];
        array_unshift($history, $entry);
        writeJson('jenkins-portal-history.json', array_slice($history, 0, 200));

        // Note: build audit trail lives in jenkins-portal-history.json only. The
        // separate jenkins-portal-logs.json / build_log.json is deprecated — the
        // ?logs=1 endpoint still serves it for backward compat, but nothing writes.

        logActivity('jenkins_portal_trigger', [
            'tool' => $toolId, 'job' => $tool['job_path'],
            'app' => $params['app'] ?? '', 'queue_id' => $res['queue_id'],
        ], $payload['sub'], $payload['name'] ?? '');
        respondOk([
            'status'   => 'queued',
            'queue_id' => $res['queue_id'],
            'queue_url'=> $res['queue_url'],
        ], 'Build queued successfully');
    }

    // ── Applications CRUD (admin) ────────────────────────────────────────────
    if (in_array($action, ['add_app', 'update_app', 'delete_app'], true)) {
        if (!jp_isAdmin($payload)) respondError('Forbidden: admin access required', 403);

        $apps = jp_apps();
        $name = trim((string)($body['name'] ?? ''));

        if ($action === 'add_app') {
            if ($name === '') respondError('Application name is required', 422);
            foreach ($apps as $a) {
                if (strcasecmp((string)($a['name'] ?? ''), $name) === 0) respondError('Application name already exists', 409);
            }
            $nextId = 1;
            foreach ($apps as $a) $nextId = max($nextId, (int)($a['id'] ?? 0) + 1);
            $apps[] = [
                'id'         => $nextId,
                'name'       => $name,
                'enabled'    => isset($body['enabled']) ? (bool)$body['enabled'] : true,
                'created_at' => date('Y-m-d H:i:s'),
                'created_by' => $payload['username'] ?? '',
            ];
            writeJson('jenkins-portal-apps.json', $apps);
            logActivity('jenkins_portal_app_add', ['name' => $name], $payload['sub'], $payload['name'] ?? '');
            respondOk(null, 'เพิ่ม Application เรียบร้อย');
        }

        if ($action === 'update_app') {
            $id = (int)($body['id'] ?? 0);
            $found = false;
            foreach ($apps as &$a) {
                if ((int)($a['id'] ?? 0) !== $id) continue;
                if ($name !== '') {
                    foreach ($apps as $check) {
                        if ((int)($check['id'] ?? 0) !== $id && strcasecmp((string)($check['name'] ?? ''), $name) === 0) {
                            respondError('Application name already exists', 409);
                        }
                    }
                    $a['name'] = $name;
                }
                if (isset($body['enabled'])) $a['enabled'] = (bool)$body['enabled'];
                $a['updated_at'] = date('Y-m-d H:i:s');
                $a['updated_by'] = $payload['username'] ?? '';
                $found = true;
                break;
            }
            unset($a);
            if (!$found) respondError('Application not found', 404);
            writeJson('jenkins-portal-apps.json', $apps);
            respondOk(null, 'อัปเดต Application เรียบร้อย');
        }

        if ($action === 'delete_app') {
            $id = (int)($body['id'] ?? 0);
            $before = count($apps);
            $apps = array_values(array_filter($apps, fn($a) => (int)($a['id'] ?? 0) !== $id));
            if (count($apps) === $before) respondError('Application not found', 404);
            writeJson('jenkins-portal-apps.json', $apps);
            logActivity('jenkins_portal_app_delete', ['id' => $id], $payload['sub'], $payload['name'] ?? '');
            respondOk(null, 'ลบ Application เรียบร้อย');
        }
    }

    // ── Users CRUD (admin, jenkins team only) ────────────────────────────────
    if (in_array($action, ['create_user', 'update_user', 'delete_user', 'reset_password', 'unlock_user'], true)) {
        if (!jp_isAdmin($payload)) respondError('Forbidden: admin access required', 403);
        $users = readJson('users.json');

        if ($action === 'create_user') {
            $username = trim((string)($body['username'] ?? ''));
            $email    = trim((string)($body['email'] ?? ''));
            $role     = in_array($body['jp_role'] ?? '', ['admin', 'user'], true) ? $body['jp_role'] : 'user';
            if ($username === '' || $email === '') respondError('กรุณากรอก username และ email', 422);
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) respondError('รูปแบบอีเมลไม่ถูกต้อง', 422);
            if (!preg_match('/^[a-zA-Z0-9._-]+$/', $username)) respondError('Username ใช้ได้เฉพาะ a-z, 0-9, . _ -', 422);
            foreach ($users as $u) {
                if (strtolower((string)$u['username']) === strtolower($username)) respondError('ชื่อผู้ใช้นี้มีอยู่แล้ว', 409);
            }
            $tempPw = 'Jp' . substr(bin2hex(random_bytes(4)), 0, 8) . '!';
            $users[] = [
                'id'           => 'usr_jp_' . bin2hex(random_bytes(6)),
                'name'         => $username,
                'nickname'     => '',
                'username'     => $username,
                'email'        => $email,
                'role'         => 'external',
                'team'         => 'jenkins',
                'password'     => hashPassword($tempPw),
                'password_history' => [],
                'password_changed_at' => date('c'),
                'first_login'  => true,
                'must_reset_password' => true,
                'created_at'   => date('c'),
                'created_by'   => $payload['sub'],
                'permissions'  => ['jenkins-portal'],
                'jp_role'      => $role,
                'schedule_include' => false,
                'course_include'   => false,
                'exam_include'     => false,
                'password_expired' => false,
                'status'       => 'active',
            ];
            writeJson('users.json', $users);
            logActivity('jenkins_portal_user_create', ['username' => $username, 'role' => $role], $payload['sub'], $payload['name'] ?? '');
            respondOk(['username' => $username, 'temp_password' => $tempPw], 'สร้างผู้ใช้สำเร็จ — แจ้งรหัสผ่านชั่วคราวให้ผู้ใช้นี้');
        }

        $targetId = (string)($body['user_id'] ?? '');
        $target = null;
        foreach ($users as &$u) {
            if (($u['id'] ?? '') === $targetId && ($u['team'] ?? '') === 'jenkins') { $target = &$u; break; }
        }
        unset($u);
        if (!$target) respondError('ไม่พบผู้ใช้ใน Jenkins Portal', 404);

        if ($action === 'update_user') {
            $username = trim((string)($body['username'] ?? ''));
            $email    = trim((string)($body['email'] ?? ''));
            $role     = $body['jp_role'] ?? null;
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
                $target['jp_role'] = $role;
                $target['permissions'] = ['jenkins-portal'];
                unset($target['menu_permissions']);
            }
            writeJson('users.json', $users);
            logActivity('jenkins_portal_user_update', ['user' => $targetId], $payload['sub'], $payload['name'] ?? '');
            respondOk(null, 'อัปเดตผู้ใช้เรียบร้อย');
        }

        if ($action === 'reset_password') {
            $tempPw = 'Jp' . substr(bin2hex(random_bytes(4)), 0, 8) . '!';
            $target['password'] = hashPassword($tempPw);
            $target['first_login'] = true;
            $target['must_reset_password'] = true;
            $target['password_changed_at'] = date('c');
            writeJson('users.json', $users);
            logActivity('jenkins_portal_user_reset', ['user' => $targetId], $payload['sub'], $payload['name'] ?? '');
            respondOk(['temp_password' => $tempPw], 'รีเซ็ตรหัสผ่านสำเร็จ');
        }

        if ($action === 'unlock_user') {
            if (($target['status'] ?? '') !== 'locked') respondError('บัญชีนี้ไม่ได้ถูกล็อค', 409);
            $target['status'] = 'active';
            unset($target['locked_at'], $target['locked_reason']);
            writeJson('users.json', $users);
            logActivity('jenkins_portal_user_unlock', ['user' => $targetId], $payload['sub'], $payload['name'] ?? '');
            respondOk(null, 'ปลดล็อคบัญชีเรียบร้อย');
        }

        if ($action === 'delete_user') {
            if ($targetId === $payload['sub']) respondError('ไม่สามารถลบบัญชีตัวเองได้', 409);
            $adminCount = 0;
            foreach ($users as $u2) {
                if (($u2['id'] ?? '') !== $targetId && ($u2['team'] ?? '') === 'jenkins' && ($u2['jp_role'] ?? '') === 'admin') $adminCount++;
            }
            if (($target['jp_role'] ?? '') === 'admin' && $adminCount < 1) respondError('ต้องมี Admin อย่างน้อย 1 คน', 409);
            $users = array_values(array_filter($users, fn($u2) => ($u2['id'] ?? '') !== $targetId));
            writeJson('users.json', $users);
            logActivity('jenkins_portal_user_delete', ['user' => $targetId], $payload['sub'], $payload['name'] ?? '');
            respondOk(null, 'ลบผู้ใช้เรียบร้อย');
        }
    }

    // ── Clear build history (admin) — used by the merged History panel ──────
    if ($action === 'clear_history') {
        if (!jp_isAdmin($payload)) respondError('Forbidden: admin access required', 403);
        writeJson('jenkins-portal-history.json', []);
        logActivity('jenkins_portal_history_clear', [], $payload['sub'], $payload['name'] ?? '');
        respondOk(null, 'ล้างประวัติเรียบร้อย');
    }

    // ── Clear build logs (admin, legacy) — kept for backward compat ─────────
    if ($action === 'clear_logs') {
        if (!jp_isAdmin($payload)) respondError('Forbidden: admin access required', 403);
        writeJson('jenkins-portal-logs.json', []);
        logActivity('jenkins_portal_logs_clear', [], $payload['sub'], $payload['name'] ?? '');
        respondOk(null, 'ล้าง Logs เรียบร้อย');
    }

    respondError('Unknown POST action', 400);
}

respondError('Method not allowed', 405);
