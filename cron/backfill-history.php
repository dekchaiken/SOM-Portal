#!/usr/bin/env php
<?php
/**
 * cron/backfill-history.php
 *
 * Backfill the last N days of raw + daily data for ALL configured runways.
 * For each day:
 *   1. Compute ANCHOR_TS for that day 09:00 Asia/Bangkok
 *   2. Run the fetch script → writes raw/{slug}/{date}.json
 *   3. Build the analyzed payload (with severity from service-severity.json)
 *      and write daily/{slug}/{date}.json directly (bypass upload.php to skip
 *      Chat/Email notifications for historical days).
 *
 * Usage:
 *   php cron/backfill-history.php              # default = last 7 days
 *   php cron/backfill-history.php 14           # last 14 days
 *   php cron/backfill-history.php 7 "EKS NANO" # last 7 days, only NANO
 *   php cron/backfill-history.php --skip-fetch # use existing raw files only
 */

ini_set('memory_limit', '512M');

require_once __DIR__ . '/../api/config.php';
require_once __DIR__ . '/../api/service-severity/_lookup.php';

$argDays      = 7;
$argRunway    = '';
$argSkipFetch = false;
foreach (array_slice($argv, 1) as $a) {
    if ($a === '--skip-fetch') { $argSkipFetch = true; continue; }
    if (is_numeric($a))        { $argDays = (int)$a; continue; }
    $argRunway = $a;
}
$days = max(1, min(30, $argDays));

// Load runway list
$cfg = json_decode(file_get_contents(DATA_DIR . 'grafana-runways.json'), true) ?: [];
$runways = $cfg['runways'] ?? [];
if ($argRunway) {
    $runways = array_filter($runways, fn($r) => ($r['name'] ?? '') === $argRunway);
    if (!$runways) { fwrite(STDERR, "[ERROR] runway '{$argRunway}' not found\n"); exit(1); }
}

echo "Backfilling " . count($runways) . " runway(s) × {$days} day(s)" . ($argSkipFetch ? " (skip fetch — analyze only)" : "") . "\n\n";

$tz = new DateTimeZone('Asia/Bangkok');
$svcMap = loadServiceSeverityMap();
$summary = [];

foreach ($runways as $rw) {
    $runwayName = $rw['name'];
    $slug       = $rw['slug'];
    echo "── {$runwayName} ──\n";

    for ($i = 0; $i < $days; $i++) {
        // Anchor at today-i 09:00 local
        $anchorDt = (new DateTime('now', $tz))
            ->modify('-' . $i . ' days')
            ->setTime(9, 0, 0);
        $anchorTs = $anchorDt->getTimestamp();
        $dateStr  = $anchorDt->format('Y-m-d');
        $rawFile  = DATA_DIR . 'grafana-monitoring/raw/' . $slug . '/' . $dateStr . '.json';

        // ── Fetch raw ────────────────────────────────────────────────────────
        if (!$argSkipFetch) {
            echo "  [{$dateStr}] fetching raw...\n";
            $env = sprintf('RUNWAY=%s ANCHOR_TS=%d', escapeshellarg($runwayName), $anchorTs);
            $cmd = $env . ' php ' . escapeshellarg(__DIR__ . '/restart-monitor-fetch.php');
            $out = []; $rc = 0;
            exec($cmd . ' 2>&1', $out, $rc);
            if ($rc !== 0) {
                echo "    [WARN] fetch failed for {$dateStr}: " . implode(' | ', array_slice($out, -3)) . "\n";
                $summary[] = compact('runwayName','dateStr') + ['status' => 'fetch_failed'];
                continue;
            }
        }

        // ── Build analyzed payload from raw ──────────────────────────────────
        if (!file_exists($rawFile)) {
            echo "    [skip] raw file missing for {$dateStr}\n";
            $summary[] = compact('runwayName','dateStr') + ['status' => 'no_raw'];
            continue;
        }
        $raw = json_decode(file_get_contents($rawFile), true);
        if (!$raw) {
            echo "    [skip] raw file unreadable for {$dateStr}\n";
            $summary[] = compact('runwayName','dateStr') + ['status' => 'raw_bad'];
            continue;
        }

        // Enrich each pod via service-severity.json mapping
        $pods = []; $sev = ['critical'=>0,'warning'=>0,'info'=>0]; $reason = []; $total = 0;
        foreach ($raw['pods'] as $p) {
            $r      = $p['terminationReason'] ?? 'Unknown';
            $rc     = $p['restartCount'] ?? 0;
            $lookup = lookupServicePriority($p['pod'] ?? '', $svcMap);
            $p['priority'] = $lookup['priority'];
            $p['severity'] = $lookup['severity'];
            $sev[$lookup['severity']]++;
            $reason[$r] = ($reason[$r] ?? 0) + 1;
            $total += $rc;
            $pods[] = $p;
        }
        arsort($reason);

        $daily = [
            'date'            => $dateStr,
            'generatedAt'     => $anchorDt->format('c'),
            'scanRangeStart'  => (clone $anchorDt)->modify('-24 hours')->format('c'),
            'scanRangeEnd'    => $anchorDt->format('c'),
            'runway'          => $runwayName,
            'cluster'         => $raw['cluster'],
            'grafanaUrl'      => GRAFANA_URL,
            'datasourceUid'   => GRAFANA_DS_UID,
            'datasourceOrgId' => (int)GRAFANA_ORG_ID,
            'scanWindowHours' => 24,
            'totalRestarts'   => $total,
            'severitySummary' => $sev,
            'reasonSummary'   => $reason,
            'pods'            => $pods,
        ];

        // Write daily/{slug}/{date}.json atomically
        $dailyDir = DATA_DIR . 'grafana-monitoring/daily/' . $slug . '/';
        if (!is_dir($dailyDir)) @mkdir($dailyDir, 0775, true);
        $dailyFile = $dailyDir . $dateStr . '.json';
        $json = json_encode($daily, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $tmp  = $dailyFile . '.tmp.' . bin2hex(random_bytes(4));
        if (file_put_contents($tmp, $json) !== false && rename($tmp, $dailyFile)) {
            printf("    [OK] %s  pods=%-3d total=%-4d crit=%-2d warn=%-2d info=%-3d\n",
                $dateStr, count($pods), $total, $sev['critical'], $sev['warning'], $sev['info']);
            $summary[] = compact('runwayName','dateStr') + ['status' => 'ok', 'pods' => count($pods), 'total' => $total];
        } else {
            @unlink($tmp);
            echo "    [ERROR] failed to write daily for {$dateStr}\n";
            $summary[] = compact('runwayName','dateStr') + ['status' => 'write_failed'];
        }
    }
    echo "\n";
}

// Summary
echo "── Summary ──\n";
$byStatus = [];
foreach ($summary as $s) {
    $byStatus[$s['status']] = ($byStatus[$s['status']] ?? 0) + 1;
}
foreach ($byStatus as $st => $n) echo "  {$st}: {$n}\n";
exit(0);
