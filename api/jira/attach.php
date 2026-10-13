<?php
/**
 * Upload an attachment to a Jira issue.
 * POST /api/jira/attach.php  (multipart/form-data)
 *   Form fields:
 *     - key:  "SMC-123"
 *     - file: <binary>  (input name MUST be "file")
 *
 * Jira requires the X-Atlassian-Token: no-check header (CSRF bypass for attachments)
 * and field name "file" in multipart.
 */
require_once __DIR__ . '/../helpers.php';

try {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') respondError('Method not allowed', 405);

    $payload = requireAuth();
    requireRole($payload, ALL_STAFF_ROLES);

    if (!jiraCredsReady()) respondError('Jira credentials not configured', 500);

    $key = trim($_POST['key'] ?? '');
    if (!$key || !preg_match('/^[A-Z]+-\d+$/', $key)) respondError('Invalid key', 400);

    if (empty($_FILES['file']) || ($_FILES['file']['error'] ?? -1) !== UPLOAD_ERR_OK) {
        $errCode = $_FILES['file']['error'] ?? 'missing';
        respondError("File upload error (code: {$errCode})", 400);
    }

    $tmpPath = $_FILES['file']['tmp_name'];
    $name    = $_FILES['file']['name'] ?: 'upload.bin';
    $mime    = $_FILES['file']['type'] ?: 'application/octet-stream';
    $size    = $_FILES['file']['size'] ?: 0;

    // Sanity cap: 10 MB
    if ($size > 10 * 1024 * 1024) respondError('File too large (max 10 MB)', 400);

    $cfile = new CURLFile($tmpPath, $mime, $name);

    $ch = curl_init(JIRA_BASE_URL . '/rest/api/3/issue/' . urlencode($key) . '/attachments');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => ['file' => $cfile],
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => 0,
        CURLOPT_HTTPHEADER     => [
            'Authorization: Basic ' . base64_encode(jiraEmail() . ':' . jiraToken()),
            'X-Atlassian-Token: no-check',   // required by Jira for attachment upload
            'Accept: application/json',
        ],
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);

    if ($err)            respondError('Cannot reach Jira: ' . $err, 502);
    if ($code !== 200) {
        $data = json_decode($resp, true);
        $msg  = $data['errorMessages'][0] ?? "HTTP {$code}";
        respondError("Jira: {$msg}", 502);
    }

    // Jira returns an array of uploaded attachments
    $arr = json_decode($resp, true);
    $att = $arr[0] ?? null;
    if (!$att) respondError('Unexpected Jira response', 502);

    logActivity('jira_attach', ['key' => $key, 'filename' => $name, 'size' => $size], $payload['sub'], $payload['name'] ?? '');

    respondOk([
        'id'       => $att['id'],
        'filename' => $att['filename'],
        'mime'     => $att['mimeType'] ?? '',
        'size'     => $att['size']     ?? 0,
        'url'      => $att['content']  ?? '',
        'thumb'    => $att['thumbnail'] ?? '',
    ]);

} catch (\Throwable $e) {
    respondError('Server error: ' . $e->getMessage(), 500);
}
