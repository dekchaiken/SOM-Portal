<?php
/**
 * POST   /api/onboarding/upload.php                 → upload PDF (admin)
 *                                                     multipart/form-data: file=<pdf>, label=<optional>
 * GET    /api/onboarding/upload.php                 → list uploaded PDFs (any authed user)
 * DELETE /api/onboarding/upload.php?filename=<name> → remove a PDF (admin)
 */
header('Content-Type: application/json; charset=UTF-8');
register_shutdown_function(function () {
    $err = error_get_last();
    if ($err && in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR])) {
        if (!headers_sent()) http_response_code(500);
        echo json_encode([
            'success' => false,
            'message' => 'PHP Fatal Error: ' . $err['message'],
            'file'    => basename($err['file']) . ':' . $err['line'],
        ]);
    }
});

require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/_lib.php';

define('ONBOARDING_PDF_MAX', 25 * 1024 * 1024); // 25MB

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];

if (!is_dir(ONBOARDING_UPLOADS_DIR)) @mkdir(ONBOARDING_UPLOADS_DIR, 0755, true);

// ── List (any authed user) ──────────────────────
if ($method === 'GET') {
    $basePath = preg_replace('#/api/onboarding/upload\.php$#', '', $_SERVER['SCRIPT_NAME']);
    $files = [];
    if (is_dir(ONBOARDING_UPLOADS_DIR)) {
        foreach (scandir(ONBOARDING_UPLOADS_DIR) as $f) {
            if ($f === '.' || $f === '..') continue;
            $full = ONBOARDING_UPLOADS_DIR . $f;
            if (!is_file($full)) continue;
            if (strtolower(pathinfo($f, PATHINFO_EXTENSION)) !== 'pdf') continue;
            $files[] = [
                'filename'   => $f,
                'url'        => $basePath . '/uploads/onboarding/' . rawurlencode($f),
                'size'       => filesize($full),
                'uploaded_at'=> date('c', filemtime($full)),
            ];
        }
    }
    usort($files, fn($a, $b) => strcmp($b['uploaded_at'], $a['uploaded_at']));
    respondOk($files);
}

// ── Mutations: admin only ──────────────────────
requireRole($payload, ADMIN_ROLES);
requireCsrf();

if ($method === 'POST') {
    if (!isset($_FILES['file'])) respondError('No file uploaded (field name must be "file")');
    $file = $_FILES['file'];

    $uploadErrors = [
        UPLOAD_ERR_INI_SIZE   => 'File exceeds upload_max_filesize in php.ini',
        UPLOAD_ERR_FORM_SIZE  => 'File exceeds MAX_FILE_SIZE',
        UPLOAD_ERR_PARTIAL    => 'File only partially uploaded',
        UPLOAD_ERR_NO_FILE    => 'No file was uploaded',
        UPLOAD_ERR_NO_TMP_DIR => 'Missing PHP temp folder',
        UPLOAD_ERR_CANT_WRITE => 'Failed to write to disk',
        UPLOAD_ERR_EXTENSION  => 'Upload blocked by PHP extension',
    ];
    if ($file['error'] !== UPLOAD_ERR_OK) {
        respondError($uploadErrors[$file['error']] ?? ('Unknown upload error: ' . $file['error']));
    }
    if ($file['size'] > ONBOARDING_PDF_MAX) {
        respondError('File too large (max 25MB). Got: ' . round($file['size'] / 1024 / 1024, 2) . 'MB');
    }

    // MIME detect
    $mime = null;
    if (function_exists('finfo_open')) {
        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        if ($finfo) { $mime = finfo_file($finfo, $file['tmp_name']); finfo_close($finfo); }
    }
    if (!$mime && function_exists('mime_content_type')) $mime = mime_content_type($file['tmp_name']);
    // PDF magic bytes fallback
    if (!$mime) {
        $fp = @fopen($file['tmp_name'], 'rb');
        if ($fp) {
            $bytes = fread($fp, 5); fclose($fp);
            if ($bytes === '%PDF-') $mime = 'application/pdf';
        }
    }
    if ($mime !== 'application/pdf') respondError('Only PDF files are allowed (got: ' . $mime . ')');

    // Validate magic bytes regardless
    $fp = @fopen($file['tmp_name'], 'rb');
    if ($fp) {
        $head = fread($fp, 5); fclose($fp);
        if ($head !== '%PDF-') respondError('File is not a valid PDF');
    }

    // Safe filename: timestamp + sanitized original
    $orig = pathinfo($file['name'], PATHINFO_FILENAME);
    $orig = preg_replace('/[^A-Za-z0-9._\-ก-๙ ]/u', '_', $orig);
    $orig = trim(preg_replace('/\s+/', '_', $orig));
    if ($orig === '') $orig = 'doc';
    $orig = mb_substr($orig, 0, 60);
    $filename = date('Ymd_His') . '_' . $orig . '.pdf';
    $dest = ONBOARDING_UPLOADS_DIR . $filename;

    if (!move_uploaded_file($file['tmp_name'], $dest)) {
        respondError('Failed to move uploaded file', 500);
    }

    $basePath = preg_replace('#/api/onboarding/upload\.php$#', '', $_SERVER['SCRIPT_NAME']);
    $url = $basePath . '/uploads/onboarding/' . rawurlencode($filename);

    logActivity('onboarding_pdf_upload', ['filename' => $filename, 'size' => $file['size']], $payload['sub'], $payload['name']);
    respondOk([
        'filename'   => $filename,
        'url'        => $url,
        'size'       => $file['size'],
        'uploaded_at'=> date('c'),
    ], 'Upload successful');
}

if ($method === 'DELETE') {
    $name = basename(trim($_GET['filename'] ?? ''));
    if ($name === '' || $name === '.' || $name === '..' || strtolower(pathinfo($name, PATHINFO_EXTENSION)) !== 'pdf') {
        respondError('Invalid filename');
    }
    $path = ONBOARDING_UPLOADS_DIR . $name;
    if (!is_file($path)) respondError('File not found', 404);
    if (!@unlink($path)) respondError('Failed to delete file', 500);
    logActivity('onboarding_pdf_delete', ['filename' => $name], $payload['sub'], $payload['name']);
    respondOk(null, 'Deleted');
}

respondError('Method not allowed', 405);
