<?php
/**
 * Debug API: NANO MA_PAGE Jenkins Inspector
 * DELETE after done debugging.
 */
require_once __DIR__ . '/helpers.php';
$payload = requireAuth();
requireRole($payload, ['sm_admin', 'dev_sm', 'super_admin']);

$servers = readJson('jenkins_servers.json');
$srv = null;
foreach ($servers as $s) {
    if (($s['display'] ?? '') === 'NANO-internal') { $srv = $s; break; }
}
if (!$srv) respondError('NANO-internal server not found', 404);

$base   = rtrim($srv['base_url'], '/');
$user   = $srv['auth_user']  ?? '';
$token  = $srv['auth_token'] ?? '';
$cookie = $srv['auth_cookie'] ?? '';
$mode   = $srv['auth_mode']  ?? 'token';

function nano_curl(string $url, string $user, string $token, string $cookie, string $mode): array {
    $ch = curl_init($url);
    $headers = ['Accept: application/json'];
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 12,
        CURLOPT_CONNECTTIMEOUT => 5,   CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false, CURLOPT_FOLLOWLOCATION => true,
    ]);
    if ($mode === 'token' && $token)
        $headers[] = 'Authorization: Basic ' . base64_encode("$user:$token");
    if ($cookie)
        curl_setopt($ch, CURLOPT_COOKIE, $cookie);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);
    return [$body, $code, $err];
}

$jobPath = '/job/MA_PAGE';

// Request 1: param definitions
$u1 = $base . $jobPath . '/api/json?tree=name,nextBuildNumber,property[parameterDefinitions[name,_class,description,defaultParameterValue[value],choices]]';
[$b1, $c1, $e1] = nano_curl($u1, $user, $token, $cookie, $mode);
$job = ($c1 === 200) ? (json_decode($b1, true) ?? []) : [];

// Request 2: last 20 builds
$u2 = $base . $jobPath . '/api/json?tree=builds[number,timestamp,result,actions[parameters[name,value],causes[shortDescription,userId,userName]]]{0,20}';
[$b2, $c2, $e2] = nano_curl($u2, $user, $token, $cookie, $mode);
$hist = ($c2 === 200) ? (json_decode($b2, true) ?? []) : [];

// Request 3: lastBuild raw
$u3 = $base . $jobPath . '/lastBuild/api/json?tree=number,result,timestamp,url,actions[parameters[name,value],causes[shortDescription,userId,userName]]';
[$b3, $c3, $e3] = nano_curl($u3, $user, $token, $cookie, $mode);
$last = ($c3 === 200) ? (json_decode($b3, true) ?? []) : [];

// Extract param definitions
$paramDefs = [];
foreach (($job['property'] ?? []) as $prop) {
    foreach (($prop['parameterDefinitions'] ?? []) as $p) $paramDefs[] = $p;
}

// Parse builds
$builds = [];
foreach (($hist['builds'] ?? []) as $b) {
    $params = []; $trigger = null;
    foreach (($b['actions'] ?? []) as $a) {
        foreach (($a['parameters'] ?? []) as $p) {
            if (isset($p['name'])) $params[$p['name']] = $p['value'] ?? '';
        }
        foreach (($a['causes'] ?? []) as $c) {
            if (!$trigger) {
                $trigger = $c['userName'] ?? $c['userId'] ?? null;
                if (!$trigger && preg_match('/Started by user (.+)$/i', $c['shortDescription'] ?? '', $cm))
                    $trigger = trim($cm[1]);
            }
        }
    }
    $builds[] = [
        'number'     => $b['number'],
        'result'     => $b['result'] ?? 'RUNNING',
        'timestamp'  => $b['timestamp'],
        'trigger'    => $trigger,
        'params'     => $params,
    ];
}

respondOk([
    'server'     => ['display' => $srv['display'], 'base_url' => $base, 'mode' => $mode, 'user' => $user],
    'job'        => ['name' => $job['name'] ?? null, 'next_build' => $job['nextBuildNumber'] ?? null],
    'param_defs' => $paramDefs,
    'builds'     => $builds,
    'last_raw'   => $last,
    'http'       => ['job' => $c1, 'hist' => $c2, 'last' => $c3],
    'errors'     => array_filter(['job' => $e1, 'hist' => $e2, 'last' => $e3]),
]);
