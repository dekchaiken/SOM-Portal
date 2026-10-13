<?php
/**
 * List Backups API
 * Returns list of all backups
 */

require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/BackupService.php';

$payload = requireAuth();
requireRole($payload, ADMIN_ROLES);

$backup = new BackupService();
$backups = $backup->listBackups();

respondOk($backups, 'Backups retrieved');
