<?php
/* ══════════════════════════════════════════════════
   import.php  |  Import JSON data
   ══════════════════════════════════════════════════ */

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../helpers.php';

// Verify auth and role (admin only)
$user = requireAuth();
if (!in_array($user['role'], ADMIN_ROLES)) {
    respondError('Permission denied - Admin only', 403);
}

$input = getBody();

if (!isset($input['categories']) || !isset($input['entries'])) {
    respondError('Invalid data structure', 400);
}

$dataFile = teamDataPath('knowledge-base.json');

// Backup current data (per-team backups dir)
$backupsDir  = teamDataPath('backups/');
$backupFile  = $backupsDir . 'knowledge-base-' . date('Y-m-d-His') . '.json';
if (file_exists($dataFile)) {
    if (!is_dir($backupsDir)) {
        mkdir($backupsDir, 0755, true);
    }
    copy($dataFile, $backupFile);
}

// Save new data via writeJson (auto team-scoped + flock)
if (!writeJson('knowledge-base.json', $input)) {
    respondError('Failed to save', 500);
}

// Count imported data
$categoriesCount = count($input['categories']);
$entriesCount = array_sum(array_map('count', $input['entries']));

// Log
logActivity('knowledge_base_import', [
    'categories_count' => $categoriesCount,
    'entries_count' => $entriesCount,
    'backup_file' => basename($backupFile)
], $user['sub'], $user['name'] ?? '');

respondOk([
    'categories_imported' => $categoriesCount,
    'entries_imported' => $entriesCount
], 'Data imported successfully');
