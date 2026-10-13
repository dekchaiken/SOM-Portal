<?php
// ─── Sync all 3 projects in a single HTTP request ─────────────────────────
// Used by sms-gateway-switches.html auto-sync on page load. Runs sequentially
// so PHP's built-in dev server (single-threaded) doesn't fight itself.
require_once __DIR__ . '/lib.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') respondError('Method not allowed', 405);

$payload = requireAuth();
requireCsrf();

set_time_limit(300); // up to 5 min total for 3 Jenkins servers

$results = [];
$totalAdded = 0;
$failures   = [];

foreach (SMSGW_VALID_PROJECTS as $project) {
    $r = smsgwSyncProject($project, $payload);
    $results[$project] = [
        'ok'    => $r['ok'],
        'added' => $r['added'],
        'error' => $r['error'],
    ];
    if ($r['ok']) {
        $totalAdded += $r['added'];
    } else {
        $failures[] = strtoupper($project) . ' (' . ($r['error'] ?? 'unknown') . ')';
    }
}

$msg = $failures
    ? 'บาง project ล้มเหลว: ' . implode(', ', $failures)
    : ($totalAdded ? "เพิ่ม {$totalAdded} build ใหม่ทุก project" : 'ไม่มี build ใหม่');

respondOk([
    'total_added' => $totalAdded,
    'results'     => $results,
    'failures'    => $failures,
], $msg);
