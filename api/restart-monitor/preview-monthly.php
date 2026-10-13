<?php
/**
 * GET /api/restart-monitor/preview-monthly.php?month=YYYY-MM
 *
 * Returns the branded HTML email for the given month (no sending).
 * Used by the 👁 Preview button in restart-monitor.html.
 */

require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/_aggregate.php';
require_once __DIR__ . '/_email.php';
require_once __DIR__ . '/../mail/_branding.php';

$payload = requireAuth();
requireRole($payload, ALL_STAFF_ROLES);

if ($_SERVER['REQUEST_METHOD'] !== 'GET') respondError('Method not allowed', 405);

$month = $_GET['month'] ?? '';
if (!preg_match('/^\d{4}-\d{2}$/', $month)) respondError('Invalid month (expected YYYY-MM)', 400);

$runwayParam = trim((string)($_GET['runway'] ?? 'all'));   // default = combined
// CTA inside emails points to the public read-only page (no SOM login required).
$webUrl      = getenv('RESTART_MONITOR_PUBLIC_URL') ?: 'http://10.164.16.47/SOM-Portal/api/restart-monitor/public-monthly.php';
$cfg         = readJson('mail_config.json');

// Load runway config (team-scoped)
$cfgRw = readJson('grafana-runways.json');
$rwAll = $cfgRw['runways'] ?? [];

// Helper: build a per-runway summary (with delta + cluster + runway annotated)
$buildSummaryForRunway = function (array $rw, string $month) {
    $slug    = $rw['slug'] ?? '';
    $name    = $rw['name'] ?? '';
    $cluster = $rw['cluster'] ?? '';
    // Source = Raw/Auto (see monthly.php comment)
    $dailyDir = teamDataPath('grafana-monitoring/raw/' . $slug . '/');
    $sum = rmAggregateMonth($dailyDir, $month);
    $prev = rmPrevMonth($month);
    $prevLite = rmAggregateMonth($dailyDir, $prev, true);
    $prevTot  = $prevLite['totalRestarts'];
    $sum['previousMonth'] = ['month' => $prev, 'totalRestarts' => $prevTot, 'critical' => $prevLite['severitySummary']['critical'] ?? 0];
    $sum['deltaVsPrev']   = [
        'restarts'    => $sum['totalRestarts'] - $prevTot,
        'restartsPct' => $prevTot > 0 ? round((($sum['totalRestarts'] - $prevTot) / $prevTot) * 100, 1) : null,
    ];
    $sum['runway']  = $name;
    $sum['cluster'] = $cluster;
    return $sum;
};

// ── Combined preview ──────────────────────────────────────────────────────────
if ($runwayParam === 'all') {
    $summaries = [];
    foreach ($rwAll as $rw) {
        $sum = $buildSummaryForRunway($rw, $month);
        if (($sum['daysWithData'] ?? 0) > 0) {
            $summaries[$rw['name']] = $sum;
        }
    }
    if (!$summaries) respondError("No daily data found across any runway for {$month}", 404);

    $subject = "รายงานรายเดือน Restart ทุก Runway — {$month}";
    $inner   = rmBuildCombinedMonthlyEmailHtml($summaries, $month, $webUrl);
    $html    = buildGradientEmail($inner, $subject, $cfg, true);

    header('Content-Type: text/html; charset=UTF-8');
    header('X-Frame-Options: SAMEORIGIN');
    echo $html;
    exit;
}

// ── Single-runway preview ─────────────────────────────────────────────────────
$rw = null;
foreach ($rwAll as $r) if (($r['name'] ?? '') === $runwayParam) { $rw = $r; break; }
if (!$rw) respondError("Unknown runway '{$runwayParam}'", 400);
$summary = $buildSummaryForRunway($rw, $month);
if ($summary['daysWithData'] === 0) respondError("No daily data found for {$month} ({$runwayParam})", 404);

$subject = "รายงานรายเดือน Restart {$runwayParam} — {$month}";
$inner   = rmBuildMonthlyEmailHtml($summary, $webUrl);
$html    = buildGradientEmail($inner, $subject, $cfg, true);

header('Content-Type: text/html; charset=UTF-8');
header('X-Frame-Options: SAMEORIGIN');
echo $html;
exit;
