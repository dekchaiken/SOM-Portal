#!/usr/bin/env php
<?php
/**
 * cron/backfill-severity.php
 *
 * One-shot backfill: re-applies service-severity.json mapping to all existing
 * daily/ and raw/ JSON snapshots so old data shows correct severity in the UI.
 *
 * Idempotent — safe to re-run. Overwrites `priority`/`severity` on every pod
 * and recomputes `severitySummary` from the mapping (authoritative).
 *
 * Usage:
 *   php cron/backfill-severity.php           # backfill both dirs
 *   php cron/backfill-severity.php daily     # daily only
 *   php cron/backfill-severity.php raw       # raw only
 *   php cron/backfill-severity.php --dry-run # report changes, write nothing
 */

require_once __DIR__ . '/../api/config.php';
require_once __DIR__ . '/../api/service-severity/_lookup.php';

$args   = array_slice($argv, 1);
$dryRun = in_array('--dry-run', $args, true);
$which  = array_values(array_filter($args, fn($a) => $a !== '--dry-run'));
$dirs   = match ($which[0] ?? '') {
    'daily' => ['daily'],
    'raw'   => ['raw'],
    default => ['daily', 'raw'],
};

$svcMap = loadServiceSeverityMap();
if (!$svcMap) {
    fwrite(STDERR, "[ERROR] service-severity.json is empty or missing\n");
    exit(1);
}
echo 'Loaded ' . count($svcMap) . " services from service-severity.json\n";
echo ($dryRun ? '[DRY RUN] ' : '') . 'Backfilling: ' . implode(', ', $dirs) . "\n\n";

$totals = ['files' => 0, 'pods' => 0, 'unmapped' => 0, 'errors' => 0];

foreach ($dirs as $dir) {
    $path = DATA_DIR . 'grafana-monitoring/' . $dir . '/';
    if (!is_dir($path)) {
        echo "  [skip] {$path} does not exist\n";
        continue;
    }

    $files = glob($path . '*.json') ?: [];
    sort($files);
    echo "── {$dir}/ — " . count($files) . " files ──\n";

    foreach ($files as $file) {
        $base = basename($file, '.json');
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $base)) continue;

        $raw = file_get_contents($file);
        $data = json_decode($raw, true);
        if (!is_array($data) || !is_array($data['pods'] ?? null)) {
            echo "  [skip] {$base}: invalid JSON\n";
            $totals['errors']++;
            continue;
        }

        $severitySummary = ['critical' => 0, 'warning' => 0, 'info' => 0];
        $unmapped = [];
        $changed  = 0;

        foreach ($data['pods'] as $i => $pod) {
            $podName = $pod['pod'] ?? '';
            $lookup  = lookupServicePriority($podName, $svcMap);
            $newPriority = $lookup['priority'];
            $newSeverity = $lookup['severity'];

            $oldPriority = $data['pods'][$i]['priority'] ?? null;
            $oldSeverity = $data['pods'][$i]['severity'] ?? null;
            if ($oldPriority !== $newPriority || $oldSeverity !== $newSeverity) $changed++;

            $data['pods'][$i]['priority'] = $newPriority;
            $data['pods'][$i]['severity'] = $newSeverity;

            $severitySummary[$newSeverity] = ($severitySummary[$newSeverity] ?? 0) + 1;
            if (!$lookup['matched']) $unmapped[] = $podName;
        }

        $data['severitySummary'] = $severitySummary;

        $totals['files']++;
        $totals['pods']     += count($data['pods']);
        $totals['unmapped'] += count($unmapped);

        printf(
            "  %s  pods=%2d  crit=%-2d warn=%-2d info=%-2d  changed=%-2d unmapped=%d%s\n",
            $base,
            count($data['pods']),
            $severitySummary['critical'],
            $severitySummary['warning'],
            $severitySummary['info'],
            $changed,
            count($unmapped),
            $unmapped ? '  ['.implode(', ', array_slice($unmapped, 0, 3)).(count($unmapped)>3?', …':'').']' : ''
        );

        if ($dryRun) continue;

        $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $tmp  = $file . '.tmp.' . bin2hex(random_bytes(4));
        if (file_put_contents($tmp, $json) === false || !rename($tmp, $file)) {
            @unlink($tmp);
            echo "  [ERROR] failed to write {$base}\n";
            $totals['errors']++;
        }
    }
    echo "\n";
}

echo "── Summary ──\n";
echo "Files processed: {$totals['files']}\n";
echo "Pods enriched:   {$totals['pods']}\n";
echo "Unmapped pods:   {$totals['unmapped']} (defaulted to severity=info)\n";
echo "Errors:          {$totals['errors']}\n";
exit($totals['errors'] > 0 ? 1 : 0);
