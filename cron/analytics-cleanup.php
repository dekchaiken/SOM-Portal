#!/usr/bin/env php
<?php
/**
 * Analytics Cleanup Cron Job
 * 
 * Run weekly on Sunday at 3 AM:
 * 0 3 * * 0 /usr/bin/php /path/to/centralize-som/cron/analytics-cleanup.php
 */

require_once __DIR__ . '/../api/config.php';
require_once __DIR__ . '/../api/analytics/AnalyticsTracker.php';

echo "[" . date('Y-m-d H:i:s') . "] Starting analytics cleanup...\n";

try {
    $tracker = new AnalyticsTracker();
    $deleted = $tracker->cleanupOldEvents();
    
    echo "[" . date('Y-m-d H:i:s') . "] Deleted {$deleted} old analytics events\n";
    
    exit(0);
} catch (Exception $e) {
    echo "[" . date('Y-m-d H:i:s') . "] Error: " . $e->getMessage() . "\n";
    exit(1);
}
