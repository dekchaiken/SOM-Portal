<?php
/**
 * Delete Backup API
 * Delete a specific backup
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

$backup = new BackupService();
$success = $backup->deleteBackup($backupId);

if ($success) {
    logActivity('backup_deleted', ['backup_id' => $backupId], $payload['sub'], $payload['name']);
    respondOk(null, 'Backup deleted successfully');
} else {
    respondError('Failed to delete backup', 500);
}
