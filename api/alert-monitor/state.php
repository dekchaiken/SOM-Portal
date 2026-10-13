<?php
// ─── Alert Monitor sync state (read-only) ─────────────────────────────────────
// Returns last_sync_at, in_progress flag, last error, and recent sync history.
// Used by the dashboard header ("last synced 30s ago") and admin panel.
require_once __DIR__ . '/../helpers.php';
requireAuth();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    respondError('Method not allowed', 405);
}

$state = readJson('alert-monitor-state.json') ?: [];

// Include a small preview of month files present so the admin panel can show
// "12 months cached, 3,421 alerts"
$total = 0;
$months = [];
$dir = teamDataPath('alerts/');
if (is_dir($dir)) {
    foreach (glob($dir . '*.json') as $f) {
        $name = basename($f, '.json');
        $data = json_decode(file_get_contents($f), true) ?? [];
        $c    = (int)($data['count'] ?? count($data['alerts'] ?? []));
        $months[] = ['month' => $name, 'count' => $c, 'updated_at' => (int)($data['updated_at'] ?? 0)];
        $total   += $c;
    }
    usort($months, fn($a, $b) => strcmp($b['month'], $a['month']));
}

respondOk([
    'state'         => $state,
    'total_alerts'  => $total,
    'months_cached' => $months,
]);
