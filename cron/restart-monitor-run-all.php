#!/usr/bin/env php
<?php
/**
 * cron/restart-monitor-run-all.php
 *
 * Daily entry-point for the unix crontab. Replaces the Claude Code routine for
 * autonomous server-side runs.
 *
 * For each runway in data/grafana-runways.json:
 *   1. Fetch raw data from Prometheus (anchored at today 09:00 Asia/Bangkok)
 *   2. Write raw/{slug}/{date}.json   (Raw / Auto tab)
 *   3. Write daily/{slug}/{date}.json (Analyzed tab — same content, +metadata)
 *   4. Send Chat + Email notification via _notify.php (idempotent)
 *
 * Suggested crontab entry (server-side):
 *   0 9 * * * /usr/bin/php /path/to/centralize-som/cron/restart-monitor-run-all.php >> /path/to/centralize-som/data/logs/cron-restart.log 2>&1
 *
 * Usage flags:
 *   --no-noti     skip notifications (useful for backfill / dry-run)
 *   --runway=X    only run a specific runway by name (e.g. "EKS NANO")
 *   --date=YYYY-MM-DD  override the anchor date (default = today)
 */

define('SCRIPT_START', microtime(true));

require_once __DIR__ . '/../api/config.php';

// ── Args ──────────────────────────────────────────────────────────────────
$argSkipNoti = false;
$argRunway   = '';
$argDate     = '';
foreach (array_slice($argv, 1) as $a) {
    if ($a === '--no-noti') { $argSkipNoti = true; continue; }
    if (preg_match('/^--runway=(.+)$/', $a, $m)) { $argRunway = $m[1]; continue; }
    if (preg_match('/^--date=(\d{4}-\d{2}-\d{2})$/', $a, $m)) { $argDate = $m[1]; continue; }
}

// ── Load runway config ────────────────────────────────────────────────────
$cfgFile = DATA_DIR . 'grafana-runways.json';
if (!file_exists($cfgFile)) { fwrite(STDERR, "[ERROR] grafana-runways.json missing\n"); exit(1); }
$cfg = json_decode(file_get_contents($cfgFile), true) ?: [];
$runways = $cfg['runways'] ?? [];
if (!$runways) { fwrite(STDERR, "[ERROR] no runways configured\n"); exit(1); }

if ($argRunway) {
    $runways = array_values(array_filter($runways, fn($r) => ($r['name'] ?? '') === $argRunway));
    if (!$runways) { fwrite(STDERR, "[ERROR] runway '{$argRunway}' not found\n"); exit(1); }
}

// ── Anchor at today 09:00 Asia/Bangkok ────────────────────────────────────
$tz = new DateTimeZone('Asia/Bangkok');
$anchorDt = $argDate
    ? (new DateTime($argDate . ' 09:00:00', $tz))
    : (new DateTime('now', $tz))->setTime(9, 0, 0);
$anchorTs = $anchorDt->getTimestamp();
$dateStr  = $anchorDt->format('Y-m-d');

echo "═══ restart-monitor-run-all ═══\n";
echo "Date: {$dateStr}  Anchor: {$anchorDt->format('c')}\n";
echo "Runways: " . implode(', ', array_column($runways, 'name')) . "\n";
echo "Notify: " . ($argSkipNoti ? 'disabled' : 'enabled') . "\n\n";

// ── Per-runway loop ──────────────────────────────────────────────────────
$fetchScript = __DIR__ . '/restart-monitor-fetch.php';
$results = [];
foreach ($runways as $rw) {
    $name = $rw['name'];
    echo "── {$name} ──\n";

    $envParts = [
        'RUNWAY=' . escapeshellarg($name),
        'ANCHOR_TS=' . $anchorTs,
        'WRITE_DAILY=1',
    ];
    if (!$argSkipNoti) $envParts[] = 'SEND_NOTI=1';
    $cmd = implode(' ', $envParts) . ' php ' . escapeshellarg($fetchScript);

    $out = []; $rc = 0;
    exec($cmd . ' 2>&1', $out, $rc);
    foreach ($out as $line) echo '  ' . $line . "\n";

    $results[] = ['runway' => $name, 'rc' => $rc];
    echo "\n";
}

// ── Summary ───────────────────────────────────────────────────────────────
$elapsed = round(microtime(true) - SCRIPT_START, 2);
$failed  = array_filter($results, fn($r) => $r['rc'] !== 0);
echo "═══ Summary ═══\n";
echo "Total elapsed: {$elapsed}s\n";
foreach ($results as $r) {
    echo "  " . str_pad($r['runway'], 12) . ' → ' . ($r['rc'] === 0 ? 'OK' : 'FAILED (rc=' . $r['rc'] . ')') . "\n";
}
exit($failed ? 1 : 0);
