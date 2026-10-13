<?php
// ─── Alert Monitor — available months (for year selector) ─────────────────────
// GET → returns { years: [{year, months: [{month, count, updated_at}]}], ... }
// so the dashboard can dynamically list only the years that actually have data.
require_once __DIR__ . '/../helpers.php';
requireAuth();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    respondError('Method not allowed', 405);
}

$dir = teamDataPath('alerts/');
$byYear = [];
if (is_dir($dir)) {
    foreach (glob($dir . '*.json') as $f) {
        $name = basename($f, '.json');
        if (!preg_match('/^(\d{4})-(\d{2})$/', $name, $m)) continue;
        $year  = $m[1];
        $data  = json_decode(file_get_contents($f), true) ?? [];
        $count = (int)($data['count'] ?? count($data['alerts'] ?? []));
        if (!isset($byYear[$year])) $byYear[$year] = [];
        $byYear[$year][] = [
            'month'      => $name,
            'count'      => $count,
            'updated_at' => (int)($data['updated_at'] ?? 0),
        ];
    }
}

// Sort within each year ASC by month, and years DESC (newest first)
ksort($byYear);
$years = [];
foreach (array_reverse($byYear, true) as $y => $months) {
    usort($months, fn($a, $b) => strcmp($a['month'], $b['month']));
    $years[] = [
        'year'         => $y,
        'months'       => $months,
        'total'        => array_sum(array_column($months, 'count')),
        'month_count'  => count($months),
    ];
}

respondOk([
    'years'          => $years,
    'current_year'   => (int)date('Y'),
    'current_month'  => date('Y-m'),
]);
