<?php
/**
 * backup/index.php
 * GET          → list all backups (admin only)
 * POST         → create new backup zip (admin only)
 * DELETE ?file → delete a backup file (admin only)
 */
require_once __DIR__ . '/../helpers.php';

$method  = $_SERVER['REQUEST_METHOD'];
$payload = requireAuth();
requireRole($payload, ADMIN_ROLES);

define('BACKUP_DIR', DATA_DIR . 'backups/');
define('MAX_BACKUPS', 8);

if (!is_dir(BACKUP_DIR)) {
    mkdir(BACKUP_DIR, 0755, true);
}

// ── GET: list ──────────────────────────────────────────────────────
if ($method === 'GET') {
    $files = glob(BACKUP_DIR . 'backup_*.zip') ?: [];
    usort($files, fn($a, $b) => filemtime($b) - filemtime($a));

    $list = array_map(fn($f) => [
        'file'       => basename($f),
        'size'       => filesize($f),
        'created_at' => date('c', filemtime($f)),
    ], $files);

    respondOk($list);
}

// ── POST: create backup ────────────────────────────────────────────
if ($method === 'POST') {
    if (!class_exists('ZipArchive')) {
        respondError('ZipArchive extension not available on this server', 500);
    }

    $timestamp = date('Y-m-d_His');
    $filename  = "backup_{$timestamp}.zip";
    $zipPath   = BACKUP_DIR . $filename;

    $zip = new ZipArchive();
    if ($zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
        respondError('Cannot create zip file — check permissions on data/backups/', 500);
    }

    $dataReal    = realpath(DATA_DIR);
    $backupReal  = realpath(BACKUP_DIR);
    $uploadsReal = realpath(UPLOADS_DIR);
    $fileCount   = 0;

    // Helper: recursively add a directory into the zip under a given prefix
    $addDir = function (string $dir, string $zipPrefix) use ($zip, $backupReal, &$fileCount, &$addDir) {
        $real = realpath($dir);
        if (!$real || !is_dir($real)) return;

        $iter = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($real, RecursiveDirectoryIterator::SKIP_DOTS),
            RecursiveIteratorIterator::LEAVES_ONLY
        );
        foreach ($iter as $file) {
            $filePath = $file->getRealPath();
            // Skip the backups subdirectory itself
            if ($backupReal && strpos($filePath, $backupReal) === 0) continue;
            $relPath = $zipPrefix . ltrim(substr($filePath, strlen($real)), DIRECTORY_SEPARATOR);
            $zip->addFile($filePath, $relPath);
            $fileCount++;
        }
    };

    // Include data/ (minus backups/) and uploads/
    $addDir(DATA_DIR,    'data/');
    $addDir(UPLOADS_DIR, 'uploads/');

    $zip->close();
    $size = filesize($zipPath);

    // Prune old backups — keep only MAX_BACKUPS newest
    $allBackups = glob(BACKUP_DIR . 'backup_*.zip') ?: [];
    usort($allBackups, fn($a, $b) => filemtime($b) - filemtime($a));
    foreach (array_slice($allBackups, MAX_BACKUPS) as $old) {
        @unlink($old);
    }

    logActivity('backup_created', [
        'file'      => $filename,
        'files'     => $fileCount,
        'size_kb'   => round($size / 1024),
    ], $payload['sub'], $payload['name'] ?? '');

    respondOk([
        'file'       => $filename,
        'size'       => $size,
        'files'      => $fileCount,
        'created_at' => date('c'),
    ]);
}

// ── DELETE: delete a backup ────────────────────────────────────────
if ($method === 'DELETE') {
    $file = $_GET['file'] ?? '';
    if (!$file) respondError('file required', 400);

    // Security: strict pattern — only backup_*.zip allowed
    if (!preg_match('/^backup_[\d_-]+\.zip$/', $file)) {
        respondError('Invalid filename', 400);
    }

    $path = BACKUP_DIR . $file;
    if (!file_exists($path)) respondError('Not found', 404);

    unlink($path);

    logActivity('backup_deleted', ['file' => $file], $payload['sub'], $payload['name'] ?? '');

    respondOk(['deleted' => true]);
}

respondError('Method not allowed', 405);
