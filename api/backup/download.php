<?php
/**
 * backup/download.php
 * GET ?file=backup_YYYY-MM-DD_HHMMSS.zip → stream zip to browser (admin only)
 */
require_once __DIR__ . '/../helpers.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') respondError('GET required', 405);
$payload = requireAuth();
requireRole($payload, ADMIN_ROLES);

define('BACKUP_DIR', DATA_DIR . 'backups/');

$file = $_GET['file'] ?? '';
if (!$file) respondError('file required', 400);

// Security: strict pattern — only backup_*.zip allowed
if (!preg_match('/^backup_[\d_-]+\.zip$/', $file)) {
    respondError('Invalid filename', 400);
}

$path = BACKUP_DIR . $file;
if (!file_exists($path)) respondError('Not found', 404);

logActivity('backup_downloaded', ['file' => $file], $payload['sub'], $payload['name'] ?? '');

// Override headers set by helpers.php and stream the file
header('Content-Type: application/zip');
header('Content-Disposition: attachment; filename="' . $file . '"');
header('Content-Length: ' . filesize($path));
header('Cache-Control: no-cache');
readfile($path);
exit;
