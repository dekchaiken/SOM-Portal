<?php
// Catch fatal errors before any output and return JSON
header('Content-Type: application/json; charset=UTF-8');
register_shutdown_function(function () {
    $err = error_get_last();
    if ($err && in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR])) {
        if (!headers_sent()) http_response_code(500);
        echo json_encode([
            'success' => false,
            'message' => 'PHP Fatal Error: ' . $err['message'],
            'file'    => basename($err['file']) . ':' . $err['line']
        ]);
    }
});

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/security/FileScanner.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respondError('Method not allowed', 405);
}

$payload = requireAuth();
requireCsrf();
apiRateLimit($payload['sub'], 'upload');

if (!isset($_FILES['image'])) {
    respondError('No file uploaded (field name must be "image")');
}

$file = $_FILES['image'];

// PHP upload error codes
$uploadErrors = [
    UPLOAD_ERR_INI_SIZE   => 'File exceeds upload_max_filesize in php.ini',
    UPLOAD_ERR_FORM_SIZE  => 'File exceeds MAX_FILE_SIZE in form',
    UPLOAD_ERR_PARTIAL    => 'File was only partially uploaded',
    UPLOAD_ERR_NO_FILE    => 'No file was uploaded',
    UPLOAD_ERR_NO_TMP_DIR => 'Missing PHP temp folder',
    UPLOAD_ERR_CANT_WRITE => 'Failed to write to disk',
    UPLOAD_ERR_EXTENSION  => 'Upload blocked by PHP extension',
];

if ($file['error'] !== UPLOAD_ERR_OK) {
    $msg = $uploadErrors[$file['error']] ?? 'Unknown upload error: ' . $file['error'];
    respondError($msg);
}

if ($file['size'] > MAX_UPLOAD_SIZE) {
    respondError('File too large (max 5MB). Got: ' . round($file['size'] / 1024 / 1024, 2) . 'MB');
}

// ── MIME type detection (with fallback) ──────────────────
$mime = null;

// Method 1: finfo (preferred)
if (function_exists('finfo_open')) {
    $finfo = finfo_open(FILEINFO_MIME_TYPE);
    if ($finfo) {
        $mime = finfo_file($finfo, $file['tmp_name']);
        finfo_close($finfo);
    }
}

// Method 2: mime_content_type fallback
if (!$mime && function_exists('mime_content_type')) {
    $mime = mime_content_type($file['tmp_name']);
}

// Method 3: magic bytes (reads file header — works on temp files with no extension)
if (!$mime) {
    $fp = @fopen($file['tmp_name'], 'rb');
    if ($fp) {
        $bytes = fread($fp, 12);
        fclose($fp);
        $hex = strtoupper(bin2hex($bytes));
        if (str_starts_with($hex, 'FFD8FF'))   $mime = 'image/jpeg';
        elseif (str_starts_with($hex, '89504E47')) $mime = 'image/png';
        elseif (str_starts_with($hex, '47494638')) $mime = 'image/gif';
        elseif (str_starts_with($hex, '52494646') && substr($hex, 16, 8) === '57454250') $mime = 'image/webp';
    }
}

// Method 4: extension-based fallback (original filename from client)
if (!$mime) {
    $ext_map = [
        'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg',
        'png' => 'image/png', 'gif' => 'image/gif', 'webp' => 'image/webp'
    ];
    $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
    $mime = $ext_map[$ext] ?? 'application/octet-stream';
}

if (!in_array($mime, ALLOWED_IMAGE_TYPES)) {
    respondError('Invalid file type: ' . $mime . '. Allowed: jpg, png, gif, webp');
}

// ── Security scan with FileScanner ───────────────────────
$scanner = new FileScanner();
$scanResult = $scanner->scanFile($file['tmp_name']);

if (!$scanResult['safe']) {
    logSecurity('file_upload_threat_detected', [
        'filename' => $file['name'],
        'threats' => $scanResult['threats'],
        'mime' => $mime,
    ], $payload['sub'], $payload['name']);
    respondError('File upload rejected: security threat detected', 400);
}

// Validate as image
if (!$scanner->isValidImage($file['tmp_name'])) {
    respondError('File is not a valid image', 400);
}

// ── Resolve destination directory by scope ────────────────
// Scope decides which folder the file lands in — separates board attachments
// from exam question images so admin cleanup / audit is easier. Defaults to
// board to preserve existing callers.
$scopeMap = [
    'board'        => 'board/',
    'exam-images'  => 'exam-images/',
    // MA Test screenshots are grouped by month (uploads/ma-test/YYYY-MM/) —
    // resolved below because we need the current month.
    'ma-test'      => 'ma-test/',
];
$scope = $_POST['scope'] ?? $_GET['scope'] ?? 'board';
if (!isset($scopeMap[$scope])) {
    respondError('Invalid upload scope: ' . $scope, 400);
}
// Only admins may upload exam question images — anti-abuse.
if ($scope === 'exam-images' && !in_array($payload['role'] ?? '', ADMIN_ROLES, true)) {
    respondError('Admin only for this scope', 403);
}
// MA Test screenshots — SM team members only. Bucket by month so cleanup is
// straightforward.
if ($scope === 'ma-test') {
    $team = $GLOBALS['_current_team'] ?? null;
    if ($team !== 'sm') respondError('MA Test uploads are SM-only', 403);
    $monthBucket = $_POST['month'] ?? $_GET['month'] ?? date('Y-m');
    if (!preg_match('/^\d{4}-\d{2}$/', $monthBucket)) $monthBucket = date('Y-m');
    $scopeMap['ma-test'] = 'ma-test/' . $monthBucket . '/';
}

$subdir = $scopeMap[$scope];
$destDir = UPLOADS_DIR . $subdir;
if (!is_dir($destDir)) {
    if (!mkdir($destDir, 0755, true)) {
        respondError('Cannot create upload directory. Check server permissions.', 500);
    }
}
if (!is_writable($destDir)) {
    respondError('Upload directory is not writable: ' . $destDir, 500);
}

// ── Save file with safe filename ────────────────────────
$filename = $scanner->generateSafeFilename($file['name']);
$dest     = $destDir . $filename;

if (!move_uploaded_file($file['tmp_name'], $dest)) {
    respondError('Failed to move uploaded file. Check PHP temp and upload directory permissions.', 500);
}

// Build absolute URL so it works regardless of sub-directory depth
// SCRIPT_NAME = /centralize-som/api/upload.php  →  base = /centralize-som
$basePath = preg_replace('#/api/[^/]+\.php$#', '', $_SERVER['SCRIPT_NAME']);
$url = $basePath . '/uploads/' . $subdir . $filename;
logActivity('file_upload', ['scope' => $scope, 'filename' => $filename, 'size' => $file['size'], 'mime' => $mime], $payload['sub'], $payload['name']);
respondOk(['url' => $url, 'filename' => $filename, 'scope' => $scope], 'Upload successful');
