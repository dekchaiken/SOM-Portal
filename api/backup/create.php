<?php
/**
 * Create Backup API
 * Manually trigger backup creation
 */

require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/BackupService.php';

$payload = requireAuth();
requireCsrf();
requireRole($payload, ADMIN_ROLES);

// Set longer execution time for backup
set_time_limit(300); // 5 minutes

$backup = new BackupService();
$result = $backup->createBackup();

if ($result['success']) {
    respondOk($result, 'Backup created successfully');
} else {
    respondError($result['error'] ?? 'Backup failed', 500);
}
