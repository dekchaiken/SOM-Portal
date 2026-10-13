<?php
/**
 * GET /api/restart-monitor/monthly.php?action=summary&month=YYYY-MM
 * GET /api/restart-monitor/monthly.php?action=months
 */

require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/_aggregate.php';

$payload = requireAuth();
requireRole($payload, ALL_STAFF_ROLES);

if ($_SERVER['REQUEST_METHOD'] !== 'GET') respondError('Method not allowed', 405);

// Resolve runway → daily folder. Default to EKS TMN for backward compat.
$runwayName = trim((string)($_GET['runway'] ?? 'EKS TMN'));
$runwaySlug = '';
$cfg = readJson('grafana-runways.json');
foreach ($cfg['runways'] ?? [] as $rw) {
    if (($rw['name'] ?? '') === $runwayName) { $runwaySlug = $rw['slug'] ?? ''; break; }
}
if (!$runwaySlug) $runwaySlug = 'EKS-TMN'; // fallback

// Monthly report uses Raw/Auto snapshots (data/{team}/grafana-monitoring/raw/{slug}/)
// — fresher, captured at fetch time, and consistent regardless of whether the
// Analyzed pipeline ran. Aggregator only reads fields that both raw + daily
// have in common (totalRestarts, severitySummary, reasonSummary, pods, date).
$dailyDir = teamDataPath('grafana-monitoring/raw/' . $runwaySlug . '/');
$action   = $_GET['action'] ?? 'summary';

if (!is_dir($dailyDir)) {
    if ($action === 'months') respondOk(['months' => [], 'runway' => $runwayName]);
    respondOk(rmEmptyMonthlySummary($_GET['month'] ?? date('Y-m')) + ['runway' => $runwayName]);
}

if ($action === 'months') {
    $months = [];
    foreach (glob($dailyDir . '*.json') ?: [] as $f) {
        $base = basename($f, '.json');
        if (preg_match('/^(\d{4}-\d{2})-\d{2}$/', $base, $m)) {
            $months[$m[1]] = ($months[$m[1]] ?? 0) + 1;
        }
    }
    krsort($months);
    $out = [];
    foreach ($months as $k => $cnt) $out[] = ['month' => $k, 'days' => $cnt];
    respondOk(['months' => $out, 'runway' => $runwayName]);
}

$month = $_GET['month'] ?? date('Y-m');
if (!preg_match('/^\d{4}-\d{2}$/', $month)) {
    respondError('Invalid month format (expected YYYY-MM)', 400);
}

$summary = rmAggregateMonth($dailyDir, $month);
$prev    = rmPrevMonth($month);
$prevLite = rmAggregateMonth($dailyDir, $prev, true);

$summary['previousMonth'] = [
    'month'         => $prev,
    'totalRestarts' => $prevLite['totalRestarts'],
    'critical'      => $prevLite['severitySummary']['critical'] ?? 0,
];
$prevTotal = $prevLite['totalRestarts'];
$summary['deltaVsPrev'] = [
    'restarts'    => $summary['totalRestarts'] - $prevTotal,
    'restartsPct' => $prevTotal > 0 ? round((($summary['totalRestarts'] - $prevTotal) / $prevTotal) * 100, 1) : null,
];
$summary['runway'] = $runwayName;

respondOk($summary);
