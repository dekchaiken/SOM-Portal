<?php
/**
 * migrate-monthly.php
 * Run ONCE via CLI: php api/migrate-monthly.php
 * Splits test-records.json and batch-records.json into monthly files.
 * Original files are renamed to *.bak (not deleted).
 */

$dataDir = __DIR__ . '/../data/';

function migrateFile(string $dataDir, string $filename, string $prefix): void {
    $file = $dataDir . $filename;

    if (!file_exists($file)) {
        echo "  SKIP: $filename not found\n";
        return;
    }

    $records = json_decode(file_get_contents($file), true) ?? [];
    if (empty($records)) {
        echo "  SKIP: $filename is empty\n";
        return;
    }

    // Group by YYYY-MM from timestamp
    $byMonth = [];
    foreach ($records as $r) {
        $ts    = $r['timestamp'] ?? date('c');
        $month = substr($ts, 0, 7); // "2026-06"
        if (!preg_match('/^\d{4}-\d{2}$/', $month)) $month = date('Y-m');
        $byMonth[$month][] = $r;
    }

    ksort($byMonth);

    foreach ($byMonth as $month => $recs) {
        $out = $dataDir . $prefix . '-' . $month . '.json';
        file_put_contents($out, json_encode(array_values($recs), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        echo "  Written: " . basename($out) . " (" . count($recs) . " records)\n";
    }

    // Backup original
    rename($file, $file . '.bak');
    echo "  Backed up: $filename → $filename.bak\n";
}

echo "=== Migrating test-records ===\n";
migrateFile($dataDir, 'test-records.json', 'test-records');

echo "\n=== Migrating batch-records ===\n";
migrateFile($dataDir, 'batch-records.json', 'batch-records');

echo "\nDone!\n";
