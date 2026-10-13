<?php
/**
 * backfill.php — CLI backfill for missing raw/daily reports.
 *
 * Uses the same pipeline as fetch.php (via _fetch_lib.php) but skips HTTP auth
 * and can anchor at any historical date. Reads runway config from the SM team
 * context (data/sm/grafana-runways.json).
 *
 * Usage:
 *   php api/restart-monitor/backfill.php [flags]
 *
 * Flags:
 *   --runway=NAME|SLUG   Only this runway (e.g. --runway=OCP or --runway="EKS TMN")
 *   --date=YYYY-MM-DD    Only this single date (default: scan current month)
 *   --month=YYYY-MM      Scan a specific month for gaps (default: current month)
 *   --dry-run            List what would be backfilled, don't run
 *   --force              Overwrite existing raw files
 *   --no-notify          Skip Chat + email (recommended for old dates)
 *
 * Auto-scan behaviour: without --date, iterates every day of --month up to today
 * and only runs on days missing raw/{slug}/{date}.json for that runway.
 */

if (php_sapi_name() !== 'cli') {
    fwrite(STDERR, "backfill.php is CLI-only\n");
    exit(1);
}

// Route team-scoped paths (readJson, teamDataPath, LOG_DIR selection) at 'sm'.
// helpers.php's _appendLog + teamDataPath key off $GLOBALS['_current_team'].
$GLOBALS['_current_team'] = 'sm';

require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/../service-severity/_lookup.php';
require_once __DIR__ . '/_fetch_lib.php';

$opts = getopt('', ['runway::', 'date::', 'month::', 'dry-run', 'force', 'no-notify', 'help']);
if (isset($opts['help'])) {
    echo "Usage: php api/restart-monitor/backfill.php [--runway=NAME] [--date=YYYY-MM-DD] [--month=YYYY-MM] [--dry-run] [--force] [--no-notify]\n";
    exit(0);
}

$runwayFilter = trim((string)($opts['runway'] ?? ''));
$dateFilter   = trim((string)($opts['date']   ?? ''));
$monthFilter  = trim((string)($opts['month']  ?? ''));
$dryRun       = array_key_exists('dry-run',   $opts);
$force        = array_key_exists('force',     $opts);
$sendNotify   = !array_key_exists('no-notify', $opts);

$tz     = new DateTimeZone('Asia/Bangkok');
$today  = new DateTime('now', $tz);

// ── Runway roster ────────────────────────────────────────────────────────
$cfg = readJson('grafana-runways.json');
$runways = $cfg['runways'] ?? [];
if (!$runways) { fwrite(STDERR, "grafana-runways.json empty for SM team\n"); exit(1); }
if ($runwayFilter !== '') {
    $runways = array_values(array_filter($runways, fn($r) =>
        strcasecmp($r['name'] ?? '', $runwayFilter) === 0 ||
        strcasecmp($r['slug'] ?? '', $runwayFilter) === 0
    ));
    if (!$runways) { fwrite(STDERR, "No runway matching '{$runwayFilter}'\n"); exit(1); }
}

// ── Dates to consider ────────────────────────────────────────────────────
$dates = [];
if ($dateFilter !== '') {
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $dateFilter)) {
        fwrite(STDERR, "--date must be YYYY-MM-DD\n"); exit(1);
    }
    $dates = [$dateFilter];
} else {
    if ($monthFilter !== '' && !preg_match('/^\d{4}-\d{2}$/', $monthFilter)) {
        fwrite(STDERR, "--month must be YYYY-MM\n"); exit(1);
    }
    $anchorMonth = $monthFilter !== '' ? $monthFilter : $today->format('Y-m');
    try {
        $first = (new DateTime($anchorMonth . '-01', $tz));
    } catch (Exception $e) {
        fwrite(STDERR, "Invalid month: {$anchorMonth}\n"); exit(1);
    }
    $lastDay = min((int)$first->format('t'), $anchorMonth === $today->format('Y-m') ? (int)$today->format('j') : (int)$first->format('t'));
    for ($d = 1; $d <= $lastDay; $d++) {
        $dates[] = sprintf('%s-%02d', $anchorMonth, $d);
    }
}

$svcMap = loadServiceSeverityMap();

echo str_repeat('─', 78) . "\n";
echo sprintf(" Restart-Monitor Backfill · %s\n", $today->format('Y-m-d H:i T'));
echo sprintf(" runways = %s\n", implode(', ', array_map(fn($r) => $r['name'], $runways)));
echo sprintf(" dates   = %s (%d days)\n", $dates[0] . ($dateFilter === '' ? ' → ' . end($dates) : ''), count($dates));
echo sprintf(" mode    = %s%s%s%s\n",
    $dryRun     ? 'DRY-RUN '  : '',
    $force      ? 'FORCE '    : '',
    !$sendNotify ? 'NO-NOTIFY ' : 'NOTIFY ',
    ''
);
echo str_repeat('─', 78) . "\n";

$totals = ['done' => 0, 'already_done' => 0, 'error' => 0, 'skip' => 0, 'locked' => 0, 'dry' => 0];

foreach ($runways as $rw) {
    $slug = $rw['slug'];
    foreach ($dates as $dateStr) {
        // Cheap pre-check without opening the lock
        $rawPath = DATA_DIR . 'sm/grafana-monitoring/raw/' . $slug . '/' . $dateStr . '.json';
        $exists  = file_exists($rawPath);
        if (!$force && $exists) {
            printf("  [SKIP] %-9s %s  (raw exists)\n", $rw['name'], $dateStr);
            $totals['already_done']++;
            continue;
        }
        if ($dryRun) {
            printf("  [DRY ] %-9s %s  (would backfill)\n", $rw['name'], $dateStr);
            $totals['dry']++;
            continue;
        }

        try {
            $anchorDt = (new DateTime($dateStr, $tz))->setTime(9, 0, 0);
            printf("  [RUN ] %-9s %s  ", $rw['name'], $dateStr);
            $start = microtime(true);
            $res = rmFetchOneRunwayDate(
                $rw, $anchorDt, $tz, $svcMap, $force, $sendNotify, 'cli-backfill', 'cli-backfill'
            );
            $dur = round(microtime(true) - $start, 1);
            $status = $res['status'] ?? '?';
            $totals[$status] = ($totals[$status] ?? 0) + 1;

            if ($status === 'done') {
                printf("→ done · pods=%d restarts=%d chat=%s email=%s (%.1fs)\n",
                    $res['totalPods']     ?? 0,
                    $res['totalRestarts'] ?? 0,
                    ($res['chatSent']  ?? false) ? 'yes' : 'no',
                    ($res['emailSent'] ?? false) ? 'yes' : 'no',
                    $dur
                );
            } else {
                printf("→ %s (%s) (%.1fs)\n", $status, $res['reason'] ?? '', $dur);
            }
        } catch (Throwable $e) {
            printf("→ EXCEPTION: %s\n", $e->getMessage());
            $totals['error']++;
        }
    }
}

echo str_repeat('─', 78) . "\n";
echo " Summary: ";
foreach ($totals as $k => $v) if ($v) echo "{$k}={$v} ";
echo "\n";
