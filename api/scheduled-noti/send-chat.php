<?php
/**
 * send-chat.php
 * POST { id }           → send Google Chat card (deduplicated per day)
 * POST { id, test:true } → send test card (skips dedup + log)
 *
 * Dedup: file lock on noti-chat-log.json → one send per schedule per calendar day
 */
require_once __DIR__ . '/../helpers.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') respondError('POST required', 405);
$payload = requireAuth();
$body    = getBody();

$id      = $body['id']   ?? '';
$isTest  = !empty($body['test']);
if (!$id) respondError('id required', 400);

// ── Load schedule ───────────────────────────────────────────────────
$schedules = readJson('scheduled-noti.json');
$sch = null;
foreach ($schedules as $s) {
    if ($s['id'] === $id) { $sch = $s; break; }
}
if (!$sch) respondError('Schedule not found', 404);

// Resolve webhook list (support legacy single-string field)
if ($isTest && !empty($body['webhook_url'])) {
    $webhooks = [trim($body['webhook_url'])];
} else {
    $webhooks = !empty($sch['google_chat_webhooks']) ? $sch['google_chat_webhooks']
              : (!empty($sch['google_chat_webhook'])  ? [$sch['google_chat_webhook']] : []);
    $webhooks = array_values(array_filter(array_map('trim', $webhooks)));
}
if (empty($webhooks)) respondError('ยังไม่ได้ตั้งค่า Webhook URL — กรอก URL แล้วบันทึกก่อน', 400);

// ── Dedup (skip for test mode) ──────────────────────────────────────
$logFile  = teamDataPath('noti-chat-log.json');
$lockFile = teamDataPath('noti-chat-log.lock');
// Ensure team dir exists (lockfile fopen doesn't auto-create parents)
$logDir = dirname($logFile);
if (!is_dir($logDir)) @mkdir($logDir, 0755, true);
$today    = date('Y-m-d');
$sentKey  = $id . '_' . $today;

if (!$isTest) {
    $lockFp = fopen($lockFile, 'c+');
    if (!$lockFp) respondError('Cannot acquire lock file', 500);
    flock($lockFp, LOCK_EX);

    $log = file_exists($logFile) ? (json_decode(file_get_contents($logFile), true) ?? []) : [];

    $existingStatus = $log[$sentKey]['status'] ?? '';
    if (isset($log[$sentKey]) && in_array($existingStatus, ['sent', 'pending'])) {
        flock($lockFp, LOCK_UN);
        fclose($lockFp);
        $reason = $existingStatus === 'pending' ? 'already_sending' : 'already_sent_today';
        respondOk(['skipped' => true, 'reason' => $reason, 'sent_at' => $log[$sentKey]['sent_at']]);
    }

    // Reserve slot atomically before sending
    $log[$sentKey] = ['sent_at' => date('c'), 'status' => 'pending'];

    // Prune entries older than 90 days
    $cutoff = date('Y-m-d', strtotime('-90 days'));
    foreach (array_keys($log) as $k) {
        if (substr($k, -10) < $cutoff) unset($log[$k]);
    }
    file_put_contents($logFile, json_encode($log, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));

    flock($lockFp, LOCK_UN);
    fclose($lockFp);
}

// ── Build Google Chat Card ──────────────────────────────────────────
$message      = $isTest ? "🧪 ทดสอบการแจ้งเตือน\n\n" . $sch['message'] : $sch['message'];
$time         = $sch['time'];
$hasAction    = !empty($sch['action_label']) && !empty($sch['action_url']);
$dateLabel    = date('d/m/Y');

// Message text — nl2br-style for Google Chat (uses <br> in textParagraph)
$msgHtml = nl2br(htmlspecialchars($message, ENT_QUOTES | ENT_HTML5, 'UTF-8'));

$widgets = [];

// ── Main message widget
$widgets[] = [
    'textParagraph' => ['text' => $msgHtml]
];

// ── Source + time chip (decoratedText)
$widgets[] = [
    'decoratedText' => [
        'startIcon'  => ['knownIcon' => 'CLOCK'],
        'text'       => "<font color=\"#94a3b8\">SOM-Portal &nbsp;·&nbsp; {$dateLabel} &nbsp;·&nbsp; ⏰ {$time} น." . ($isTest ? ' &nbsp;<b>[TEST]</b>' : '') . '</font>',
        'wrapText'   => false,
    ]
];

// ── Action button
if ($hasAction) {
    $widgets[] = [
        'buttonList' => [
            'buttons' => [[
                'text'    => $sch['action_label'],
                'onClick' => ['openLink' => ['url' => $sch['action_url']]],
                'color'   => [
                    'red'   => 0.949,
                    'green' => 0.392,
                    'blue'  => 0.098,
                    'alpha' => 1.0,
                ],
            ]]
        ]
    ];
}

$card = [
    'cardsV2' => [[
        'cardId' => 'sm-noti-' . $id . ($isTest ? '-test' : ''),
        'card'   => [
            'header' => [
                'title'     => $isTest ? '🧪 ทดสอบการแจ้งเตือน' : '🔔 แจ้งเตือนจากระบบ',
                'subtitle'  => 'SOM-Portal Notification',
                'imageUrl'  => 'https://fonts.gstatic.com/s/i/googlematerialicons/notifications_active/v14/web_48dp/1x/baseline_notifications_active_black_48dp.png',
                'imageType' => 'CIRCLE',
            ],
            'sections' => [[
                'widgets' => $widgets,
            ]]
        ]
    ]]
];

// ── Send to all webhooks ────────────────────────────────────────────
$cardJson = json_encode($card, JSON_UNESCAPED_UNICODE);
$errors   = [];
$success  = false;

foreach ($webhooks as $webhookUrl) {
    $ch = curl_init($webhookUrl);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $cardJson,
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_TIMEOUT        => 10,
    ]);
    $resp    = curl_exec($ch);
    $code    = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlErr = curl_error($ch);
    curl_close($ch);

    if ($curlErr) {
        $errors[] = 'cURL: ' . $curlErr;
        logIntegrationError('google-chat-webhook', $webhookUrl, $curlErr, ['source' => 'scheduled-noti']);
    } elseif ($code !== 200) {
        $decoded  = json_decode($resp, true);
        $msg      = $decoded['error']['message'] ?? $decoded['error']['status'] ?? substr($resp, 0, 200);
        $errors[] = "HTTP {$code}: {$msg}";
        logIntegrationError('google-chat-webhook', $webhookUrl, "HTTP {$code}: {$msg}", [
            'http_code' => $code,
            'source'    => 'scheduled-noti',
        ]);
    } else {
        $success = true;
    }
}

if (!$success && !empty($errors)) {
    respondError(implode(' | ', $errors), 502);
}

// ── Update dedup log with final status ─────────────────────────────
if (!$isTest) {
    $lockFp2 = fopen($lockFile, 'c+');
    if ($lockFp2) {
        flock($lockFp2, LOCK_EX);
        $log2 = file_exists($logFile) ? (json_decode(file_get_contents($logFile), true) ?? []) : [];
        $log2[$sentKey] = [
            'sent_at' => date('c'),
            'status'  => $success ? 'sent' : 'failed',
            'code'    => $code,
        ];
        file_put_contents($logFile, json_encode($log2, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        flock($lockFp2, LOCK_UN);
        fclose($lockFp2);
    }
}

// ── Log activity ────────────────────────────────────────────────────
if (!$isTest) {
    logActivity('noti_chat_sent', [
        'noti_id' => $id,
        'time'    => $time,
        'test'    => false,
    ], $payload['sub'], $payload['name'] ?? '');
} else {
    logActivity('noti_chat_test', [
        'noti_id' => $id,
        'time'    => $time,
    ], $payload['sub'], $payload['name'] ?? '');
}

respondOk(['sent' => true, 'test' => $isTest]);
