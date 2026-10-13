<?php
// ─── Jenkins Build Launcher API ───────────────────────────────────────────────
// Config-driven Jenkins trigger + maker/checker approval, scoped per team.
// Tool definitions live in data/{team}/jenkins-build-tools.json and reference
// Jenkins servers from the team's jenkins_servers.json (via jenkins_config.php).
//
// GET   /api/jenkins-build/                    → list tools (+ server display names)
// GET   /api/jenkins-build/?history=1          → build history (team-scoped, auto-syncs live builds)
// GET   /api/jenkins-build/?approvals=1        → pending approval queue (team-scoped)
// GET   /api/jenkins-build/?action=status&tool_id=X&queue_id=Y  → poll Jenkins status
// POST  /api/jenkins-build/  { action:'submit', tool_id, params }   → validate → trigger or queue
// POST  /api/jenkins-build/  { action:'approve'|'reject', approval_id } → checker decision
//
// Access model:
//   • Team feature 'jenkins-build' (teams.json) — super_admin bypasses.
//   • external role additionally needs page permission 'jenkins-build' (maker)
//     or 'jenkins-build-approve' (checker) in users.json.
//   • POST build trigger re-checks the external allowlist (job must be in the
//     team's jenkins-build-tools.json) — same rule as jenkins-proxy.
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];

// super_admin / super_viewer in "All Teams" mode: fall back to the first team
// that has tools (data/wealth/) so the page isn't empty.
teamContextFallbackForGlobalRole($payload, 'jenkins-build-tools.json');

// ── Gates ─────────────────────────────────────────────────────────────────────
requireTeamFeature($payload, 'jenkins-build');

// External users need at least one of the two page permissions. A checker that
// only holds 'jenkins-build-approve' must still be able to open the page.
if (($payload['role'] ?? '') === 'external') {
    $jbPerms = [];
    foreach (readJson('users.json') as $_u) {
        if (($_u['id'] ?? '') === $payload['sub']) {
            $jbPerms = $_u['permissions'] ?? [];
            break;
        }
    }
    if (!in_array('jenkins-build', $jbPerms, true) && !in_array('jenkins-build-approve', $jbPerms, true)) {
        logSecurity('forbidden_page', ['page' => 'jenkins-build', 'user_role' => 'external'], $payload['sub'], $payload['name'] ?? '');
        respondError('Forbidden: no permission for this page', 403);
    }
}

// ── Load team context ────────────────────────────────────────────────────────
$tools   = readJson('jenkins-build-tools.json');
$servers = require __DIR__ . '/../jenkins_config.php'; // keyed by server id

// ── Shared cURL helper (mirrors jenkins-proxy's jenkinsRequest) ──────────────
function jb_jenkinsRequest(array $server, string $url, string $method = 'GET', $postFields = null, array $extraHeaders = [], ?array &$respHeaders = null): array {
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
        CURLOPT_USERAGENT      => 'CentralizeSOM/1.0 Jenkins-Build',
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
            '[jenkins-build] curl_fail url=%s method=%s http_code=%d errno=%d err=%s primary_ip=%s connect_time=%.3f total_time=%.3f',
            $url, $method, $code, $errno, ($err ?: '(empty)'),
            $info['primary_ip'] ?? '', (float)($info['connect_time'] ?? 0),
            (float)($info['total_time'] ?? 0)
        ));
        hostCooldownMark($host, $err !== '' ? $err : ($errno ? "curl errno {$errno}" : "HTTP {$code}"));
    }
    if ($err === '' && $errno !== 0) $err = 'curl errno ' . $errno;
    return [$body, $code, $err];
}

// ── Permission helpers ───────────────────────────────────────────────────────
// Maker/checker split for external users. Mirrors the original wealth-portal
// role model: `maker` submits requests (goes to pending approval), `checker`
// can ONLY review/approve — it cannot create build requests itself.
// Source of truth is the user's `jb_role` field ('maker'|'checker'); falling
// back to the legacy 'jenkins-build-approve' permission so existing users keep
// working until re-labelled in Admin → Users.
function jb_userRole(array $payload): string {
    if (($payload['role'] ?? '') !== 'external') return 'internal';
    foreach (readJson('users.json') as $_u) {
        if (($_u['id'] ?? '') === $payload['sub']) {
            $r = $_u['jb_role'] ?? '';
            if (in_array($r, ['checker', 'maker', 'admin'], true)) return $r;
            // Legacy: explicit approve permission implies checker.
            if (in_array('jenkins-build-approve', $_u['permissions'] ?? [], true)) return 'checker';
            return 'maker';
        }
    }
    return 'maker';
}

function jb_canApprove(array $payload): bool {
    if (in_array($payload['role'] ?? '', ['super_admin', 'sm_admin', 'dev_sm', 'sm_lead'], true)) return true;
    if (($payload['role'] ?? '') !== 'external') return false;
    return in_array(jb_userRole($payload), ['checker', 'admin'], true);
}

function jb_canSubmit(array $payload): bool {
    if (($payload['role'] ?? '') !== 'external') return true; // internal roles
    return jb_userRole($payload) !== 'checker'; // checker cannot create requests (admin can)
}

function jb_findTool(array $tools, string $id): ?array {
    foreach ($tools as $t) {
        if (($t['id'] ?? '') === $id) return $t;
    }
    return null;
}

// ── Param validation against the tool's schema ───────────────────────────────
// Returns [ $cleanParams, $errors[] ]. `auto_params` (e.g. updated_by=username)
// are injected server-side and can't be spoofed by the client.
function jb_validateParams(array $tool, array $in, array $payload): array {
    $out    = [];
    $errors = [];
    foreach (($tool['params'] ?? []) as $p) {
        $key = trim((string)($p['key'] ?? ''));
        if ($key === '') continue;
        $label = $p['label'] ?? $key;
        $val   = trim((string)($in[$key] ?? ''));
        if (!empty($p['required']) && $val === '') { $errors[] = "{$label} จำเป็นต้องกรอก"; continue; }
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

// ── Jenkins trigger + status polling ─────────────────────────────────────────
function jb_triggerBuild(array $server, string $jobPath, array $params): array {
    $base = rtrim($server['base_url'], '/');

    // 1. CSRF crumb (optional on Jenkins)
    [$crumbBody, $crumbCode] = jb_jenkinsRequest($server, $base . '/crumbIssuer/api/json');
    $crumbHeaders = [];
    if ($crumbCode === 200) {
        $crumbData = json_decode($crumbBody, true);
        if (!empty($crumbData['crumbRequestField']) && !empty($crumbData['crumb'])) {
            $crumbHeaders[] = $crumbData['crumbRequestField'] . ': ' . $crumbData['crumb'];
        }
    }

    // 2. POST /buildWithParameters (or /build when no params) — encode each path
    // segment, decoding first so pre-encoded paths (e.g. Wealth%20-...) aren't double-encoded.
    $encPath   = '/' . implode('/', array_map(
        fn($s) => rawurlencode(rawurldecode($s)),
        explode('/', trim($jobPath, '/'))
    ));
    $hasParams = !empty($params) && is_array($params);
    $buildUrl  = $base . $encPath . ($hasParams ? '/buildWithParameters' : '/build');
    $postBody  = $hasParams ? http_build_query($params) : '';
    $buildHdrs = $crumbHeaders;
    if ($hasParams) $buildHdrs[] = 'Content-Type: application/x-www-form-urlencoded';

    $respHeaders = [];
    [, $code, $err] = jb_jenkinsRequest($server, $buildUrl, 'POST', $postBody, $buildHdrs, $respHeaders);

    // Jenkins returns 400 when the job is parameterized but we called /build.
    if ($code === 400 && !$hasParams) {
        $respHeaders = [];
        $wpHdrs      = array_merge($crumbHeaders, ['Content-Type: application/x-www-form-urlencoded']);
        [, $code, $err] = jb_jenkinsRequest($server, $base . $encPath . '/buildWithParameters', 'POST', 'json={}', $wpHdrs, $respHeaders);
    }

    if ($err !== '' || $code === 0)           return ['ok' => false, 'error' => 'Cannot reach Jenkins: ' . $err];
    if ($code === 401)                        return ['ok' => false, 'error' => 'Jenkins rejected credentials — token may be invalid or expired'];
    if ($code === 403)                        return ['ok' => false, 'error' => 'Access denied — insufficient Jenkins permissions'];
    if ($code === 404)                        return ['ok' => false, 'error' => 'Job not found'];
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

function jb_pollStatus(array $server, string $queueId): array {
    if ($queueId === '') return ['status' => 'Unknown', 'progress' => 0, 'result' => null];
    $base = rtrim($server['base_url'], '/');

    // 1. Queue item → executable (build started)
    [$body, $code] = jb_jenkinsRequest($server, $base . "/queue/item/{$queueId}/api/json");
    if ($code === 200) {
        $data = json_decode($body, true);
        if (!empty($data['executable']['url'])) {
            $buildUrl = rtrim($data['executable']['url'], '/') . '/api/json';
            [$bBody, $bCode] = jb_jenkinsRequest($server, $buildUrl);
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

function jb_historyStatus(string $status): string {
    $s = strtolower($status);
    if ($s === 'success')         return 'success';
    if ($s === 'failure')         return 'failure';
    if ($s === 'aborted')         return 'aborted';
    if (in_array($s, ['building', 'in queue', 'queued', 'pending'], true)) return $s === 'pending' ? 'queued' : $s;
    return 'unknown';
}

// ── GET ───────────────────────────────────────────────────────────────────────
if ($method === 'GET') {
    // Job health check — for the Jenkins Status card (mirrors so-jenkins/jenkins-portal)
    if (isset($_GET['status']) && $_GET['status'] !== '0') {
        $toolId  = trim($_GET['tool_id'] ?? '');
        $tool    = $toolId ? jb_findTool($tools, $toolId) : ($tools[0] ?? null);
        if (!$tool) respondOk(['reachable' => false, 'message' => 'No tool configured']);
        $serverId = $tool['server_id'] ?? '';
        if (!$serverId || !isset($servers[$serverId])) respondOk(['reachable' => false, 'message' => 'Server not configured']);
        $server = $servers[$serverId];
        $base   = rtrim($server['base_url'], '/');
        $enc    = implode('/', array_map(
            fn($s) => rawurlencode(rawurldecode($s)),
            explode('/', trim($tool['job_path'] ?? '', '/'))
        ));
        [$body, $code, $err] = jb_jenkinsRequest($server, $base . '/' . $enc . '/api/json?tree=lastBuild[number,timestamp,result]');
        if ($code !== 200) respondOk(['reachable' => false, 'message' => $err ?: "HTTP {$code}"]);
        $data = json_decode($body, true);
        $last = $data['lastBuild'] ?? null;
        respondOk([
            'reachable'  => true,
            'last_build' => $last ? ['number' => $last['number'] ?? null, 'result' => $last['result'] ?? null] : null,
        ]);
    }

    // Poll a specific queue item
    if (isset($_GET['action']) && $_GET['action'] === 'status') {
        $toolId  = trim($_GET['tool_id'] ?? '');
        $queueId = trim($_GET['queue_id'] ?? '');
        $tool = jb_findTool($tools, $toolId);
        if (!$tool) respondError('Unknown tool', 404);
        $serverId = trim($tool['server_id'] ?? '');
        if (!$serverId || !isset($servers[$serverId])) respondError('Tool server not configured', 404);
        respondOk(jb_pollStatus($servers[$serverId], $queueId));
    }

    if (isset($_GET['history']) && $_GET['history'] !== '0') {
        // Auto-sync live builds (queued / building / in queue) so the page
        // shows fresh statuses without the client polling every row.
        $history = readJson('jenkins-build-history.json');
        $now     = time();
        $changed = false;
        foreach ($history as &$h) {
            $curStatus = jb_historyStatus($h['status'] ?? '');
            if (!in_array($curStatus, ['queued', 'building', 'in queue'], true)) continue;
            $tool     = jb_findTool($tools, $h['tool_id'] ?? '');
            $serverId = $tool['server_id'] ?? '';
            if (!$tool || !$serverId || !isset($servers[$serverId])) continue;
            $server = $servers[$serverId];
            $base   = rtrim($server['base_url'], '/');
            $st     = null;

            if (!empty($h['build_number'])) {
                // Build left queue — query by build number directly (works regardless
                // of age or whether the Jenkins queue item has since expired).
                $encPath = '/' . implode('/', array_map(
                    fn($s) => rawurlencode(rawurldecode($s)),
                    explode('/', trim($tool['job_path'] ?? '', '/'))
                ));
                [$bBody, $bCode] = jb_jenkinsRequest($server, $base . $encPath . '/' . (int)$h['build_number'] . '/api/json');
                if ($bCode === 200) {
                    $b = json_decode($bBody, true);
                    $st = empty($b['building'])
                        ? ['status' => 'Finished', 'result' => $b['result'] ?? 'UNKNOWN',
                           'number' => $b['number'] ?? null, 'duration' => isset($b['duration']) ? (int)$b['duration'] : null]
                        : ['status' => 'Building',  'result' => null, 'number' => $b['number'] ?? null, 'duration' => null];
                }
            } elseif (!empty($h['queue_id'])) {
                // No build number yet — use queue poll (skip if older than 1 h).
                $ts = strtotime($h['ts'] ?? '0') ?: 0;
                if ($now - $ts > 3600) continue;
                $st = jb_pollStatus($server, $h['queue_id']);
            }

            if ($st === null) continue;
            $newStatus = null;
            if ($st['status'] === 'Finished') {
                $newStatus = jb_historyStatus($st['result'] ?? 'UNKNOWN');
                $h['build_number'] = $st['number'] ?? ($h['build_number'] ?? null);
                $h['result']       = $st['result'] ?? null;
                if (!empty($st['duration'])) $h['duration'] = (int)$st['duration'];
            } elseif ($st['status'] === 'Building' || $st['status'] === 'In Queue') {
                $newStatus = jb_historyStatus($st['status']);
            }
            if ($newStatus !== null && $newStatus !== $curStatus) {
                $h['status'] = $newStatus;
                $changed = true;
            }
        }
        unset($h);
        if ($changed) writeJson('jenkins-build-history.json', $history);
        respondOk(array_slice($history, 0, 50));
    }

    if (isset($_GET['approvals']) && $_GET['approvals'] !== '0') {
        respondOk(readJson('jenkins-build-approvals.json'));
    }

    // Default: list tools (+ display names for the configured servers)
    $serverList = [];
    foreach ($servers as $id => $s) {
        $serverList[$id] = ['display' => $s['display'] ?? $id, 'base_url' => $s['base_url'] ?? ''];
    }
    respondOk([
        'tools'   => $tools,
        'servers' => $serverList,
        'can_approve' => jb_canApprove($payload),
        'jb_role'     => jb_userRole($payload), // 'maker' | 'checker' | 'internal'
    ]);
}

// ── POST ──────────────────────────────────────────────────────────────────────
if ($method === 'POST') {
    requireCsrf();
    $body   = getBody();
    $action = trim($body['action'] ?? '');

    // ── submit — validate, then trigger or queue for approval ────────────────
    if ($action === 'submit') {
        if (!jb_canSubmit($payload)) {
            logSecurity('jenkins_build_checker_submit_blocked', ['tool' => $body['tool_id'] ?? ''], $payload['sub'], $payload['name'] ?? '');
            respondError('Checker ไม่สามารถสร้างรายการได้ — ตรวจสอบและอนุมัติได้อย่างเดียว', 403);
        }
        $toolId = trim($body['tool_id'] ?? '');
        $tool   = jb_findTool($tools, $toolId);
        if (!$tool) respondError('Unknown tool', 404);

        $serverId = trim($tool['server_id'] ?? '');
        if (!$serverId || !isset($servers[$serverId])) respondError('Tool server not configured — ติดต่อ Admin', 404);

        [$params, $errors] = jb_validateParams($tool, $body['params'] ?? [], $payload);
        if ($errors) respondError(implode(' · ', $errors), 422);

        $needsApproval = !empty($tool['approval']['enabled']) && !jb_canApprove($payload);

        if ($needsApproval) {
            // Maker flow — save to pending queue
            $approvals = readJson('jenkins-build-approvals.json');
            $approval = [
                'id'             => genId('apv'),
                'tool_id'        => $toolId,
                'tool_name'      => $tool['name'] ?? $toolId,
                'params'         => $params,
                'submitted_by'   => $payload['sub'],
                'submitted_name' => $payload['name'] ?? $payload['username'] ?? '',
                'submitted_at'   => date('c'),
                'status'         => 'pending',
                'decided_by'     => null,
                'decided_at'     => null,
            ];
            array_unshift($approvals, $approval);
            writeJson('jenkins-build-approvals.json', $approvals);
            logActivity('jenkins_build_submit', ['tool' => $toolId, 'approval' => $approval['id'], 'approval_required' => true], $payload['sub'], $payload['name'] ?? '');
            respondOk([
                'status'      => 'pending_approval',
                'approval_id' => $approval['id'],
                'message'     => 'ส่งรายการเรียบร้อย กรุณารอ Checker อนุมัติ',
            ], 'Submitted for approval');
        }

        // Direct trigger (approval disabled, or caller is an approver)
        $res = jb_triggerBuild($servers[$serverId], $tool['job_path'], $params);
        if (!$res['ok']) respondError($res['error'], 502);

        $entry = [
            'id'           => genId('build'),
            'ts'           => date('c'),
            'tool_id'      => $toolId,
            'tool_name'    => $tool['name'] ?? $toolId,
            'user_id'      => $payload['sub'],
            'user_name'    => $payload['name'] ?? $payload['username'] ?? '',
            'params'       => $params,
            'status'       => 'queued',
            'queue_id'     => $res['queue_id'],
            'queue_url'    => $res['queue_url'],
            'build_number' => null,
            'result'       => null,
            'approved_by'  => null,
            'rejected_by'  => null,
        ];
        $history = readJson('jenkins-build-history.json');
        array_unshift($history, $entry);
        writeJson('jenkins-build-history.json', array_slice($history, 0, 200));
        logActivity('jenkins_build_trigger', ['tool' => $toolId, 'job' => $tool['job_path'], 'queue_id' => $res['queue_id']], $payload['sub'], $payload['name'] ?? '');
        respondOk([
            'status'   => 'queued',
            'queue_id' => $res['queue_id'],
            'queue_url'=> $res['queue_url'],
        ], 'Build queued successfully');
    }

    // ── approve / reject — checker decision on a pending submission ──────────
    if (in_array($action, ['approve', 'reject'], true)) {
        if (!jb_canApprove($payload)) respondError('Forbidden: คุณไม่มีสิทธิ์อนุมัติ', 403);

        $approvalId = trim($body['approval_id'] ?? '');
        $approvals  = readJson('jenkins-build-approvals.json');
        $idx        = -1;
        foreach ($approvals as $i => $a) {
            if (($a['id'] ?? '') === $approvalId) { $idx = $i; break; }
        }
        if ($idx === -1) respondError('ไม่พบรายการที่รออนุมัตินี้', 404);
        $approval = $approvals[$idx];
        if (($approval['status'] ?? '') !== 'pending') respondError('รายการนี้ถูกตัดสินไปแล้ว', 409);

        $tool = jb_findTool($tools, $approval['tool_id'] ?? '');
        if (!$tool) respondError('Unknown tool', 404);
        $serverId = trim($tool['server_id'] ?? '');
        if (!$serverId || !isset($servers[$serverId])) respondError('Tool server not configured', 404);

        $history = readJson('jenkins-build-history.json');

        if ($action === 'reject') {
            $approvals[$idx]['status']      = 'rejected';
            $approvals[$idx]['decided_by']  = $payload['name'] ?? $payload['username'] ?? '';
            $approvals[$idx]['decided_at']  = date('c');
            writeJson('jenkins-build-approvals.json', $approvals);
            array_unshift($history, [
                'id'          => genId('build'),
                'ts'          => date('c'),
                'tool_id'     => $tool['id'] ?? '',
                'tool_name'   => $tool['name'] ?? '',
                'user_id'     => $approval['submitted_by'],
                'user_name'   => $approval['submitted_name'],
                'params'      => $approval['params'],
                'status'      => 'rejected',
                'queue_id'    => '',
                'queue_url'   => '',
                'build_number'=> null,
                'result'      => null,
                'approved_by' => null,
                'rejected_by' => $payload['name'] ?? $payload['username'] ?? '',
            ]);
            writeJson('jenkins-build-history.json', array_slice($history, 0, 200));
            logActivity('jenkins_build_reject', ['tool' => $tool['id'] ?? '', 'approval' => $approvalId], $payload['sub'], $payload['name'] ?? '');
            respondOk(['status' => 'rejected'], 'ปฏิเสธรายการเรียบร้อย');
        }

        // approve → trigger the build
        $res = jb_triggerBuild($servers[$serverId], $tool['job_path'], $approval['params']);
        if (!$res['ok']) respondError($res['error'], 502);

        $approvals[$idx]['status']      = 'approved';
        $approvals[$idx]['decided_by']  = $payload['name'] ?? $payload['username'] ?? '';
        $approvals[$idx]['decided_at']  = date('c');
        writeJson('jenkins-build-approvals.json', $approvals);

        array_unshift($history, [
            'id'           => genId('build'),
            'ts'           => date('c'),
            'tool_id'      => $tool['id'] ?? '',
            'tool_name'    => $tool['name'] ?? '',
            'user_id'      => $approval['submitted_by'],
            'user_name'    => $approval['submitted_name'],
            'params'       => $approval['params'],
            'status'       => 'queued',
            'queue_id'     => $res['queue_id'],
            'queue_url'    => $res['queue_url'],
            'build_number' => null,
            'result'       => null,
            'approved_by'  => $payload['name'] ?? $payload['username'] ?? '',
            'rejected_by'  => null,
        ]);
        writeJson('jenkins-build-history.json', array_slice($history, 0, 200));
        logActivity('jenkins_build_approve', ['tool' => $tool['id'] ?? '', 'approval' => $approvalId, 'queue_id' => $res['queue_id']], $payload['sub'], $payload['name'] ?? '');
        respondOk([
            'status'   => 'queued',
            'queue_id' => $res['queue_id'],
            'queue_url'=> $res['queue_url'],
        ], 'อนุมัติและเริ่ม Build เรียบร้อย');
    }

    respondError('Unknown POST action', 400);
}

respondError('Method not allowed', 405);
