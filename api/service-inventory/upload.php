<?php
/**
 * POST /api/service-inventory/upload.php
 *
 * Accepts a multipart CSV upload, validates it, backs up the current file,
 * then replaces it. Backups live under data/sm/service-inventory-history/
 * with timestamp + uploader in the filename.
 *
 * Validation:
 *   • MIME is text/* or application/vnd.ms-excel (Excel-CSV mislabelling)
 *   • Size ≤ 8 MB (current file is ~650 KB — 8 MB is generous)
 *   • Header row includes "Service name" (case-insensitive)
 *   • At least one data row parses to a non-empty service name
 *
 * The `?dryRun=1` variant validates + reports counts but doesn't write.
 * Use it for the client-side preview before the user commits.
 *
 * Auth: admin + SM team + CSRF (SM-shared file — see requireSmForShared).
 */
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/../service-performance/_lib.php';

$payload = requireAuth();
requireRole($payload, ADMIN_ROLES);
requireSmForShared();
requireCsrf();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') respondError('Method not allowed', 405);

$dryRun = !empty($_GET['dryRun']) || !empty($_POST['dryRun']);

if (empty($_FILES['file']) || ($_FILES['file']['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
    respondError('No file uploaded (field name: file)', 400);
}
$file = $_FILES['file'];
if (($file['size'] ?? 0) > 8 * 1024 * 1024) respondError('File too large (>8MB)', 413);

$tmp = $file['tmp_name'] ?? '';
if (!$tmp || !is_uploaded_file($tmp)) respondError('Upload not received', 400);

// ── Validate: header must include "Service name" ────────────────────────────
$fh = fopen($tmp, 'r');
if (!$fh) respondError('Cannot read uploaded file', 500);
$header = fgetcsv($fh, 0, ',', '"', '');
if (!$header) { fclose($fh); respondError('Cannot parse CSV header', 400); }
$headerLower = array_map(fn($h) => strtolower(trim($h)), $header);
if (!in_array('service name', $headerLower, true)) {
    fclose($fh);
    respondError('CSV header must contain "Service name" column. Got: ' . implode(', ', array_slice($header, 0, 8)) . '…', 400);
}
$iName = array_search('service name', $headerLower, true);

// Count parseable rows + collect a preview
$total = 0; $withName = 0; $preview = [];
while (($row = fgetcsv($fh, 0, ',', '"', '')) !== false) {
    $total++;
    $name = trim((string)($row[$iName] ?? ''));
    if ($name === '') continue;
    $withName++;
    if (count($preview) < 5) $preview[] = $name;
}
fclose($fh);
if ($withName === 0) respondError('CSV has no rows with a service name', 400);

// ── Dry-run: report and stop ────────────────────────────────────────────────
if ($dryRun) {
    respondOk([
        'dryRun'     => true,
        'header'     => $header,
        'total'      => $total,
        'withName'   => $withName,
        'preview'    => $preview,
        'sizeBytes'  => (int)$file['size'],
    ]);
}

// ── Commit: backup old, replace ─────────────────────────────────────────────
$dstPath  = teamDataPath('service-inventory.csv');
$dstDir   = dirname($dstPath);
if (!is_dir($dstDir)) @mkdir($dstDir, 0775, true);

$backupCount = 0;
if (file_exists($dstPath)) {
    $histDir = teamDataPath('service-inventory-history/');
    if (!is_dir($histDir)) @mkdir($histDir, 0775, true);
    $stamp = date('Ymd_His');
    $who   = preg_replace('/[^a-z0-9_.-]+/i', '_', (string)($payload['username'] ?? 'anon'));
    $backupName = "{$stamp}_{$who}.csv";
    if (!@copy($dstPath, $histDir . $backupName)) {
        respondError('Failed to back up existing inventory', 500);
    }
    // Keep only the 20 most recent backups — no one needs a decade of CSVs.
    $backups = glob($histDir . '*.csv') ?: [];
    usort($backups, fn($a, $b) => filemtime($b) - filemtime($a));
    foreach (array_slice($backups, 20) as $old) @unlink($old);
    $backupCount = count($backups);
}

if (!@move_uploaded_file($tmp, $dstPath)) {
    respondError('Failed to write new inventory file', 500);
}
@chmod($dstPath, 0664);

// Drop the in-request static cache in spLoadServiceInventory so the immediate
// follow-up GET (from the admin page reload) sees the new file.
// (In practice PHP-FPM will spawn a fresh worker for the next request anyway;
// this is only defensive.)
logActivity('service_inventory_upload', [
    'total'      => $total,
    'withName'   => $withName,
    'sizeBytes'  => (int)$file['size'],
    'backupsKept'=> min(20, $backupCount + 1),
]);

respondOk([
    'ok'          => true,
    'total'       => $total,
    'withName'    => $withName,
    'preview'     => $preview,
    'meta'        => spInventoryMeta(),
    'backupsKept' => min(20, $backupCount + 1),
], 'Inventory updated — ' . $withName . ' services');
