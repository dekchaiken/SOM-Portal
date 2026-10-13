<?php
/**
 * Restore Backup API
 * Restore system from backup
 */

require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/BackupService.php';

$payload = requireAuth();
requireCsrf();
requireRole($payload, ADMIN_ROLES);

$body = getBody();
$backupId = $body['backup_id'] ?? '';

if (empty($backupId)) {
    respondError('backup_id is required');
}

// Set longer execution time for restore
set_time_limit(300); // 5 minutes

$backup = new BackupService();
$result = $backup->restoreBackup($backupId);

if ($result['success']) {
    respondOk($result, 'Backup restored successfully');
} else {
    respondError($result['error'] ?? 'Restore failed', 500);
}
