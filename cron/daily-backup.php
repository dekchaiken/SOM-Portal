#!/usr/bin/env php
<?php
/**
 * Daily Backup Cron Job
 * 
 * Run daily at 2 AM:
 * 0 2 * * * /usr/bin/php /path/to/centralize-som/cron/daily-backup.php
 */

require_once __DIR__ . '/../api/config.php';
require_once __DIR__ . '/../api/backup/BackupService.php';

echo "[" . date('Y-m-d H:i:s') . "] Starting daily backup...\n";

try {
    $backup = new BackupService();
    $result = $backup->createBackup();
    
    if ($result['success']) {
        echo "[" . date('Y-m-d H:i:s') . "] Backup created successfully: {$result['backup_id']}\n";
        echo "  Size: " . round($result['size'] / 1024 / 1024, 2) . " MB\n";
        echo "  Duration: {$result['duration']} seconds\n";
        echo "  Verified: " . ($result['verified'] ? 'Yes' : 'No') . "\n";
        
        // Cleanup old backups
        $deleted = $backup->cleanupOldBackups();
        echo "[" . date('Y-m-d H:i:s') . "] Cleaned up {$deleted} old backups\n";
        
        exit(0);
    } else {
        echo "[" . date('Y-m-d H:i:s') . "] Backup failed: {$result['error']}\n";
        exit(1);
    }
} catch (Exception $e) {
    echo "[" . date('Y-m-d H:i:s') . "] Error: " . $e->getMessage() . "\n";
    exit(1);
}
