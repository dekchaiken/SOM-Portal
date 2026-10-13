<?php
/* ══════════════════════════════════════════════════
   clear-all.php  |  Clear all data
   ══════════════════════════════════════════════════ */

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../helpers.php';

// Verify auth and role (admin only)
$user = requireAuth();
if (!in_array($user['role'], ADMIN_ROLES)) {
    respondError('Permission denied - Admin only', 403);
}

$dataFile   = teamDataPath('knowledge-base.json');
$backupsDir = teamDataPath('backups/');
$backupFile = $backupsDir . 'knowledge-base-cleared-' . date('Y-m-d-His') . '.json';
if (file_exists($dataFile)) {
    if (!is_dir($backupsDir)) {
        mkdir($backupsDir, 0755, true);
    }
    copy($dataFile, $backupFile);
}

// Clear all data
$emptyData = [
    'categories' => [],
    'entries' => []
];

if (!file_put_contents($dataFile, json_encode($emptyData, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE))) {
    respondError('Failed to save', 500);
}

// Log
logActivity('knowledge_base_clear_all', [
    'backup_file' => basename($backupFile)
], $user['sub'], $user['name'] ?? '');

respondOk(null, 'All data cleared');
