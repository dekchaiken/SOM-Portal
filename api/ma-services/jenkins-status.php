<?php
// ══════════════════════════════════════════════════════════════════
//  MA Services — Jenkins Build Status Poller
//  GET ?server=X&queue=/queue/item/1234    → queued, may return build_number when dequeued
//  GET ?server=X&job=/job/…&build=123      → building/finished + progress %
//
//  Returns unified shape:
//    { phase: 'queued'|'building'|'done',
//      queue: { why, cancelled },
//      build: { number, url, building, duration, estimated, elapsed, percent, result },
//      done:  bool }
// ══════════════════════════════════════════════════════════════════

require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/../jenkins_helpers.php';

$payload = requireAuth();
requireSmForShared();

header('Content-Type: application/json');

$serverId = trim($_GET['server'] ?? '');
$queue    = trim($_GET['queue']  ?? '');
$jobPath  = trim($_GET['job']    ?? '');
$buildNo  = isset($_GET['build']) ? (int)$_GET['build'] : 0;

$servers = jenkinsServers();
if (!$serverId || !isset($servers[$serverId])) respondError('Unknown server', 404);
$server = $servers[$serverId];
$base   = rtrim($server['base_url'], '/');

$out = ['phase' => 'unknown', 'queue' => null, 'build' => null, 'done' => false];

// ── Phase 1: queue (before Jenkins assigns a build number) ─────────
if ($queue && !$buildNo) {
    if (!preg_match('#^/queue/item/\d+/?$#', $queue)) respondError('Invalid queue path');
    $res = jenkinsRequestFull($server, $base . rtrim($queue, '/') . '/api/json');
    if ($res['err'])           respondError('Jenkins error: ' . $res['err'], 502);
    if ($res['code'] === 404)  { $out['phase'] = 'done'; $out['done'] = true; respondOk($out); }
    if ($res['code'] !== 200)  respondError('Jenkins HTTP ' . $res['code'], 502);
    $d = json_decode($res['body'], true) ?: [];
    if (!empty($d['cancelled'])) {
        $out['phase'] = 'done';
        $out['queue'] = ['why' => $d['why'] ?? '', 'cancelled' => true];
        $out['done']  = true;
        respondOk($out);
    }
    if (!empty($d['executable']['number'])) {
        // Dequeued → we have a build number. Fall through to phase 2 using it.
        $buildNo = (int)$d['executable']['number'];
        $exUrl   = (string)($d['executable']['url'] ?? '');
        // Extract job path from the executable URL: <base>/<jobPath>/<buildNo>/
        $rel = preg_replace('#^https?://[^/]+#', '', $exUrl);
        $rel = rtrim($rel, '/');
        // Remove trailing /<buildNo> to get job path
        $jobPath = preg_replace('#/\d+$#', '', $rel);
    } else {
        $out['phase'] = 'queued';
        $out['queue'] = [
            'why'       => (string)($d['why'] ?? 'waiting in queue'),
            'cancelled' => false,
        ];
        respondOk($out);
    }
}

// ── Phase 2: build (job assigned a number) ─────────────────────────
if (!$jobPath || !$buildNo) respondError('Missing job/build after queue resolve');
if (!preg_match('#^(/job/[A-Za-z0-9_.%+\-]+)+$#', $jobPath)) respondError('Invalid job path');

$url = $base . $jobPath . '/' . $buildNo . '/api/json';
$res = jenkinsRequestFull($server, $url);
if ($res['err'])           respondError('Jenkins error: ' . $res['err'], 502);
if ($res['code'] === 404)  respondError('Build not found', 404);
if ($res['code'] !== 200)  respondError('Jenkins HTTP ' . $res['code'], 502);

$d = json_decode($res['body'], true) ?: [];
$building  = !empty($d['building']);
$duration  = (int)($d['duration'] ?? 0);
$estimated = max(1, (int)($d['estimatedDuration'] ?? 0));
$ts        = (int)($d['timestamp'] ?? 0);   // ms
$elapsedMs = $ts > 0 ? max(0, (int)(microtime(true) * 1000) - $ts) : 0;
$percent   = $building
    ? min(99, (int)($elapsedMs / $estimated * 100))
    : 100;
$result    = (string)($d['result'] ?? '');  // '', SUCCESS, FAILURE, ABORTED, UNSTABLE

$out['phase'] = $building ? 'building' : 'done';
$out['done']  = !$building;
$out['build'] = [
    'number'    => $buildNo,
    'url'       => (string)($d['url'] ?? ''),
    'job_path'  => $jobPath,
    'building'  => $building,
    'duration'  => $duration,
    'estimated' => $estimated,
    'elapsed'   => $elapsedMs,
    'percent'   => $percent,
    'result'    => $result,
];
respondOk($out);
