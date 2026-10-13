<?php
// ══════════════════════════════════════════════════════════════════
//  MA Services — Jenkins Parameter Discovery
//  GET ?service_id=X → returns the parameterDefinitions of the job
//  linked on this ma-service so the UI can render a dynamic form.
// ══════════════════════════════════════════════════════════════════

require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/../jenkins_helpers.php';

$payload = requireAuth();
requireSmForShared();

header('Content-Type: application/json');

$serviceId = isset($_GET['service_id']) ? (int)$_GET['service_id'] : 0;
if ($serviceId <= 0) respondError('Missing service_id');

$dataFile = teamDataPath('ma-services.json');
if (!file_exists($dataFile)) respondError('ma-services.json not found', 500);
$data = json_decode(file_get_contents($dataFile), true);
$svc = null;
foreach (($data['services'] ?? []) as $s) if ((int)($s['id'] ?? 0) === $serviceId) { $svc = $s; break; }
if (!$svc)                                  respondError('Service not found', 404);
if (($svc['tool_type'] ?? '') !== 'Jenkins') respondError('Service tool_type is not Jenkins');

$serverId = trim((string)($svc['jenkins_server_id'] ?? ''));
$jobPath  = '/' . ltrim(trim((string)($svc['jenkins_job_path'] ?? '')), '/');
if (!$serverId) respondError('jenkins_server_id not set on this service');
if (!preg_match('#^(/job/[A-Za-z0-9_.%+\-]+)+$#', $jobPath)) respondError('Invalid jenkins_job_path');

$servers = jenkinsServers();
if (!isset($servers[$serverId])) respondError('Unknown jenkins_server_id', 404);
$server = $servers[$serverId];

$url = rtrim($server['base_url'], '/') . $jobPath
     . '/api/json?tree=name,description,property[parameterDefinitions[name,type,description,defaultParameterValue[value],choices]]';

$res = jenkinsRequestFull($server, $url);
if ($res['err'])           respondError('Jenkins error: ' . $res['err'], 502);
if ($res['code'] === 401)  respondError('Jenkins auth failed', 422);
if ($res['code'] === 404)  respondError('Job not found', 404);
if ($res['code'] !== 200)  respondError('Jenkins HTTP ' . $res['code'], 502);

$d = json_decode($res['body'], true);
if (!is_array($d)) respondError('Jenkins returned invalid JSON', 502);

$params = [];
foreach (($d['property'] ?? []) as $prop) {
    foreach (($prop['parameterDefinitions'] ?? []) as $p) {
        $params[] = [
            'name'        => $p['name'] ?? '',
            'type'        => $p['type'] ?? 'StringParameterDefinition',
            'description' => $p['description'] ?? '',
            'default'     => $p['defaultParameterValue']['value'] ?? '',
            'choices'     => $p['choices'] ?? null,   // null for non-choice types
        ];
    }
}

respondOk([
    'job_name'    => $d['name'] ?? '',
    'description' => $d['description'] ?? '',
    'params'      => $params,
]);
