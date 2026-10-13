#!/usr/bin/env php
<?php
/**
 * Log Rotation Cron Job
 * 
 * Run daily at midnight:
 * 0 0 * * * /usr/bin/php /path/to/centralize-som/cron/log-rotation.php
 */

require_once __DIR__ . '/../api/config.php';
require_once __DIR__ . '/../api/logging/LogRotator.php';

echo "[" . date('Y-m-d H:i:s') . "] Starting log rotation...\n";

try {
    $rotator = new LogRotator();
    $logs = ['activity.json', 'security.json'];
    $rotated = 0;
    
    foreach ($logs as $log) {
        if ($rotator->rotateIfNeeded($log)) {
            echo "[" . date('Y-m-d H:i:s') . "] Rotated: {$log}\n";
            $rotated++;
        }
    }
    
    echo "[" . date('Y-m-d H:i:s') . "] Rotated {$rotated} log files\n";
    
    // Cleanup old logs
    $deleted = $rotator->cleanupOldLogs();
    echo "[" . date('Y-m-d H:i:s') . "] Deleted {$deleted} old log files\n";
    
    exit(0);
} catch (Exception $e) {
    echo "[" . date('Y-m-d H:i:s') . "] Error: " . $e->getMessage() . "\n";
    exit(1);
}
