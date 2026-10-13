<?php
/**
 * syncup/upload.php
 * POST multipart:
 *   image  (file)              — compressed image from client
 *   shift  (morning|evening)   — which shift
 *   date   (YYYY-MM-DD, opt)   — defaults to today
 *
 * Flow: validate → save file → update syncup.json → send Google Chat card → log
 */
header('Content-Type: application/json; charset=UTF-8');
register_shutdown_function(function () {
    $err = error_get_last();
    if ($err && in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR])) {
        if (!headers_sent()) http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'PHP Fatal Error: ' . $err['message']]);
    }
});

require_once __DIR__ . '/../helpers.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') respondError('POST required', 405);
$payload = requireAuth();
apiRateLimit($payload['sub'], 'upload');

// ── Input validation ─────────────────────────────────────────────────────
$shift = trim($_POST['shift'] ?? '');
if (!in_array($shift, ['morning', 'evening'])) respondError('shift must be morning or evening', 400);

$date = trim($_POST['date'] ?? date('Y-m-d'));
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) respondError('Invalid date format', 400);

// ── File validation ──────────────────────────────────────────────────────
if (!isset($_FILES['image']) || $_FILES['image']['error'] !== UPLOAD_ERR_OK) {
    $errMap = [
        UPLOAD_ERR_INI_SIZE  => 'File too large (php.ini)',
        UPLOAD_ERR_FORM_SIZE => 'File too large (form)',
        UPLOAD_ERR_PARTIAL   => 'Partial upload',
        UPLOAD_ERR_NO_FILE   => 'No file uploaded',
    ];
    $code = $_FILES['image']['error'] ?? UPLOAD_ERR_NO_FILE;
    respondError($errMap[$code] ?? 'Upload error: ' . $code, 400);
}

$file = $_FILES['image'];

if ($file['size'] > MAX_UPLOAD_SIZE) {
    respondError('File too large (max 5MB). Got: ' . round($file['size'] / 1024 / 1024, 2) . 'MB', 400);
}

// MIME detection — finfo preferred; mime_content_type as secondary; extension as last resort
$mime = null;
if (function_exists('finfo_open')) {
    $fi = finfo_open(FILEINFO_MIME_TYPE);
    if ($fi) { $mime = finfo_file($fi, $file['tmp_name']); finfo_close($fi); }
}
if (!$mime && function_exists('mime_content_type')) {
    $mime = mime_content_type($file['tmp_name']);
}
if (!$mime) {
    // Extension fallback (client-side already compressed to JPEG, but handle all cases)
    $ext  = strtolower(pathinfo($file['name'] ?? '', PATHINFO_EXTENSION));
    $mime = match($ext) {
        'jpg', 'jpeg' => 'image/jpeg',
        'png'         => 'image/png',
        'webp'        => 'image/webp',
        'gif'         => 'image/gif',
        default       => 'application/octet-stream',
    };
}
if (!in_array($mime, ALLOWED_IMAGE_TYPES)) {
    respondError('Invalid file type. Allowed: JPEG, PNG, WebP', 400);
}

// ── Save file ────────────────────────────────────────────────────────────
$syncupDir = UPLOADS_DIR . 'syncup/';
if (!is_dir($syncupDir)) @mkdir($syncupDir, 0755, true);

$ext = match($mime) {
    'image/png'  => 'png',
    'image/webp' => 'webp',
    default      => 'jpg',
};
$filename = "{$date}-{$shift}.{$ext}";
$destPath = $syncupDir . $filename;

// Remove previous file for this slot (may have different extension)
foreach (['jpg', 'png', 'webp'] as $e) {
    $old = $syncupDir . "{$date}-{$shift}.{$e}";
    if ($old !== $destPath && file_exists($old)) @unlink($old);
}

if (!move_uploaded_file($file['tmp_name'], $destPath)) {
    respondError('Failed to save file to disk', 500);
}

// Derive public URL from the request URI
$host      = $_SERVER['HTTP_HOST'] ?? 'localhost';
$hostParts = explode(':', $host);
$hostPort  = isset($hostParts[1]) ? (int)$hostParts[1] : (int)($_SERVER['SERVER_PORT'] ?? 80);
$scheme    = ($hostPort === 443) ? 'https' : 'http';
$apiPath = $_SERVER['REQUEST_URI'] ?? '/api/syncup/upload.php';
$baseUrl = rtrim($scheme . '://' . $host . preg_replace('#/api/syncup/.*#', '', strtok($apiPath, '?')), '/');
$imageUrl = $baseUrl . '/uploads/syncup/' . $filename;

// ── Update syncup.json ───────────────────────────────────────────────────
$uploaderName = $payload['name'] ?? $payload['sub'];
$now          = date('c');

$data = readJson('syncup.json');
$data[$date] = $data[$date] ?? [];
$data[$date][$shift] = [
    'image_path'       => 'uploads/syncup/' . $filename,
    'image_url'        => $imageUrl,
    'uploaded_by_id'   => $payload['sub'],
    'uploaded_by_name' => $uploaderName,
    'uploaded_at'      => $now,
    'file_size_kb'     => round($file['size'] / 1024, 1),
];
writeJson('syncup.json', $data);

// ── Send image card to Google Chat ───────────────────────────────────────
$cfg        = readJson('syncup-config.json');
$shiftCfg   = $cfg[$shift] ?? [];
$webhooks   = array_values(array_filter(array_map('trim', $shiftCfg['google_chat_webhooks'] ?? [])));
$chatErrors = [];
$chatSent   = false;

$notiLogFile  = teamDataPath('syncup-notify-log.json');
$notiLog      = file_exists($notiLogFile) ? (json_decode(file_get_contents($notiLogFile), true) ?? []) : [];
$savedThreads = $notiLog[$shift . '_' . $date]['thread_names'] ?? [];

if (!empty($webhooks)) {
    $shiftLabel = $shift === 'morning' ? '🌅 Sync-up เช้า' : '🌙 Sync-up เย็น';
    $timeLabel  = date('H:i', strtotime($now));
    $dateLabel  = date('d/m/Y', strtotime($date));
    $threadKey  = 'syncup-' . $date . '-' . $shift;
    $replyOpt   = 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD';

    $card = [
        'cardsV2' => [[
            'cardId' => 'syncup-img-' . $date . '-' . $shift,
            'card'   => [
                'header' => [
                    'title'    => "✅ {$shiftLabel}",
                    'subtitle' => "อัปโหลดแล้ว · {$dateLabel}",
                ],
                'sections' => [[
                    'widgets' => [
                        [
                            'buttonList' => [
                                'buttons' => [[
                                    'text'    => "🖼️ ดูรูป Sync-up",
                                    'onClick' => ['openLink' => ['url' => $imageUrl]],
                                ]],
                            ],
                        ],
                        [
                            'decoratedText' => [
                                'startIcon' => ['knownIcon' => 'PERSON'],
                                'text'      => "<font color=\"#94a3b8\">{$uploaderName} &nbsp;·&nbsp; {$timeLabel} น. &nbsp;·&nbsp; SOM-Portal</font>",
                                'wrapText'  => false,
                            ],
                        ],
                    ],
                ]],
            ],
        ]],
    ];

    foreach ($webhooks as $webhookUrl) {
        $msgBody      = $card;
        $storedThread = $savedThreads[md5($webhookUrl)] ?? null;
        if ($storedThread) {
            $msgBody['thread'] = ['name' => $storedThread];
        }
        $bodyJson = json_encode($msgBody, JSON_UNESCAPED_UNICODE);

        $sep = str_contains($webhookUrl, '?') ? '&' : '?';
        $url = $webhookUrl . $sep
             . 'threadKey='           . urlencode($threadKey)
             . '&messageReplyOption=' . $replyOpt;

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $bodyJson,
            CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_TIMEOUT        => 10,
        ]);
        $resp    = curl_exec($ch);
        $code    = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr = curl_error($ch);
        curl_close($ch);

        if ($curlErr) {
            $chatErrors[] = 'cURL: ' . $curlErr;
        } elseif ($code !== 200) {
            $decoded      = json_decode($resp, true);
            $chatErrors[] = "HTTP {$code}: " . ($decoded['error']['message'] ?? substr($resp, 0, 200));
        } else {
            $chatSent = true;
        }
    }
}

// ── Activity log ─────────────────────────────────────────────────────────
logActivity('syncup_uploaded', [
    'date'      => $date,
    'shift'     => $shift,
    'filename'  => $filename,
    'size_kb'   => round($file['size'] / 1024, 1),
    'chat_sent' => $chatSent,
], $payload['sub'], $uploaderName);

respondOk([
    'date'        => $date,
    'shift'       => $shift,
    'image_url'   => $imageUrl,
    'uploaded_at' => $now,
    'chat_sent'   => $chatSent,
    'chat_errors' => $chatErrors,
]);
