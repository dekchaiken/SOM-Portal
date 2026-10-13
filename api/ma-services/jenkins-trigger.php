<?php
// ══════════════════════════════════════════════════════════════════
//  MA Services — Jenkins Build Trigger
//  POST { service_id, params: {name: value, ...} }
//  Returns: { queue_url: '/queue/item/1234/', server_base: '…', job_path: '…' }
//  Frontend polls jenkins-status.php with those values.
//  All triggers logged to activity.json with real SOM user.
// ══════════════════════════════════════════════════════════════════

require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/../jenkins_helpers.php';

$payload = requireAuth();
requireSmForShared();

header('Content-Type: application/json');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') respondError('Method not allowed', 405);

$input     = json_decode(file_get_contents('php://input'), true) ?: [];
$serviceId = isset($input['service_id']) ? (int)$input['service_id'] : 0;
$params    = is_array($input['params'] ?? null) ? $input['params'] : [];

if ($serviceId <= 0) respondError('Missing service_id');

$dataFile = teamDataPath('ma-services.json');
if (!file_exists($dataFile)) respondError('ma-services.json not found', 500);
$data = json_decode(file_get_contents($dataFile), true);
$svc  = null; $idx = -1;
foreach (($data['services'] ?? []) as $i => $s) {
    if ((int)($s['id'] ?? 0) === $serviceId) { $svc = $s; $idx = $i; break; }
}
if (!$svc)                                  respondError('Service not found', 404);
if (($svc['tool_type'] ?? '') !== 'Jenkins') respondError('Service tool_type is not Jenkins');

$serverId = trim((string)($svc['jenkins_server_id'] ?? ''));
$jobPath  = '/' . ltrim(trim((string)($svc['jenkins_job_path'] ?? '')), '/');
if (!$serverId) respondError('jenkins_server_id not set on this service');
if (!preg_match('#^(/job/[A-Za-z0-9_.%+\-]+)+$#', $jobPath)) respondError('Invalid jenkins_job_path');

// Per-user 3-second anti-double-click
$rlFile = 'ma-jenkins-rl.json';
$rl     = readJson($rlFile);
$uid    = (string)($payload['sub'] ?? '');
$now    = time();
if ($uid && !empty($rl[$uid]) && ($now - (int)$rl[$uid]) < 3) {
    respondError('Too fast — wait a moment', 429);
}
$rl[$uid] = $now;
foreach ($rl as $k => $ts) if (($now - (int)$ts) > 3600) unset($rl[$k]);
writeJson($rlFile, $rl);

$servers = jenkinsServers();
if (!isset($servers[$serverId])) respondError('Unknown jenkins_server_id', 404);
$server  = $servers[$serverId];
$base    = rtrim($server['base_url'], '/');

// Crumb (some Jenkins require CSRF crumb on POST)
$crumb  = jenkinsCrumbHeader($server);
$headers = $crumb ? [$crumb] : [];

// Build URL — /buildWithParameters if params, /build otherwise
$hasParams = !empty($params);
$buildUrl  = $base . $jobPath . ($hasParams ? '/buildWithParameters' : '/build');
if ($hasParams) $headers[] = 'Content-Type: application/x-www-form-urlencoded';
$postBody = $hasParams ? http_build_query($params) : '';

$res = jenkinsRequestFull($server, $buildUrl, 'POST', $postBody, $headers);

$activityDetail = [
    'service_id'  => $serviceId,
    'service_name'=> $svc['service_name'] ?? '',
    'server'      => $serverId,
    'job_path'    => $jobPath,
    'params'      => $params,
    'code'        => $res['code'],
];

if ($res['err'])                                 { logActivity('ma_jenkins_trigger', $activityDetail + ['result'=>'error', 'error'=>$res['err']], $uid, $payload['name'] ?? ''); respondError('Jenkins error: ' . $res['err'], 502); }
if ($res['code'] === 401)                        { logActivity('ma_jenkins_trigger', $activityDetail + ['result'=>'error', 'error'=>'401 auth'], $uid, $payload['name'] ?? ''); respondError('Jenkins auth failed', 422); }
if ($res['code'] === 404)                        { logActivity('ma_jenkins_trigger', $activityDetail + ['result'=>'error', 'error'=>'404'], $uid, $payload['name'] ?? ''); respondError('Job not found', 404); }
if (!in_array($res['code'], [200, 201, 302]))    { logActivity('ma_jenkins_trigger', $activityDetail + ['result'=>'error'], $uid, $payload['name'] ?? ''); respondError('Jenkins HTTP ' . $res['code'], 502); }

// Queue URL — Jenkins returns the queue-item URL in the Location header.
$queueUrl = $res['headers']['location'] ?? '';
$queuePath = '';
if ($queueUrl) {
    // Strip the base_url prefix so the frontend only sees the path — polling
    // endpoint re-attaches it.
    $queuePath = preg_replace('#^https?://[^/]+#', '', $queueUrl);
    $queuePath = rtrim($queuePath, '/');
}

logActivity('ma_jenkins_trigger', $activityDetail + ['result'=>'ok', 'queue'=>$queuePath], $uid, $payload['name'] ?? '');

// Persist last-triggered stamp on the record.
$data['services'][$idx]['last_jenkins_by']      = $uid;
$data['services'][$idx]['last_jenkins_by_name'] = (string)($payload['name'] ?? $payload['username'] ?? '');
$data['services'][$idx]['last_jenkins_at']      = $now;
$data['services'][$idx]['last_jenkins_params']  = $params;
$data['services'][$idx]['updated_at']           = date('Y-m-d H:i:s');
file_put_contents($dataFile, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));

respondOk([
    'queue_path' => $queuePath,          // e.g. "/queue/item/1234"
    'server'     => $serverId,           // for status polling
    'job_path'   => $jobPath,
], 'Build queued successfully');
