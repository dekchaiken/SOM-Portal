<?php
/**
 * GET /api/service-inventory/history.php
 *   → list all archived CSV backups (newest first)
 *
 * GET /api/service-inventory/history.php?download=<filename>
 *   → stream a specific backup as a CSV attachment
 *
 * POST /api/service-inventory/history.php?restore=<filename>
 *   → restore a backup as the current inventory (also archives the CURRENT
 *     file first, so an accidental restore is itself recoverable)
 *
 * Auth: admin + SM team + CSRF (for POST).
 */
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/../service-performance/_lib.php';

$payload = requireAuth();
requireRole($payload, ADMIN_ROLES);

$histDir = teamDataPath('service-inventory-history/');
if (!is_dir($histDir)) @mkdir($histDir, 0775, true);

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// ── POST ?restore=<name>: restore a backup as current ────────────────────────
if ($method === 'POST') {
    requireSmForShared();
    requireCsrf();
    $name = trim((string)($_GET['restore'] ?? ''));
    if ($name === '' || !preg_match('/^[a-z0-9_.-]+\.csv$/i', $name)) respondError('invalid backup name', 400);
    $src = $histDir . $name;
    if (!is_file($src)) respondError('backup not found', 404);

    $dst = teamDataPath('service-inventory.csv');
    // Archive the CURRENT file before overwriting
    if (file_exists($dst)) {
        $stamp = date('Ymd_His');
        $who   = preg_replace('/[^a-z0-9_.-]+/i', '_', (string)($payload['username'] ?? 'anon'));
        @copy($dst, $histDir . "{$stamp}_{$who}_before-restore.csv");
    }
    if (!@copy($src, $dst)) respondError('restore failed', 500);
    @chmod($dst, 0664);
    logActivity('service_inventory_restore', ['from' => $name]);
    respondOk(['meta' => spInventoryMeta()], 'Restored from ' . $name);
}

if ($method !== 'GET') respondError('Method not allowed', 405);

// ── GET ?download=<name>: stream one backup ─────────────────────────────────
$dl = trim((string)($_GET['download'] ?? ''));
if ($dl !== '') {
    if (!preg_match('/^[a-z0-9_.-]+\.csv$/i', $dl)) respondError('invalid filename', 400);
    $path = $histDir . $dl;
    if (!is_file($path)) respondError('backup not found', 404);
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $dl . '"');
    header('Content-Length: ' . filesize($path));
    readfile($path);
    exit;
}

// ── GET: list backups ───────────────────────────────────────────────────────
$files = glob($histDir . '*.csv') ?: [];
usort($files, fn($a, $b) => filemtime($b) - filemtime($a));
$out = [];
foreach ($files as $f) {
    $base = basename($f);
    $out[] = [
        'name'      => $base,
        'sizeBytes' => (int)filesize($f),
        'mtime'     => date('c', (int)filemtime($f)),
    ];
}
respondOk(['backups' => $out, 'meta' => spInventoryMeta()]);
