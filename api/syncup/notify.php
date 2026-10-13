<?php
/**
 * syncup/notify.php
 * POST { shift: 'morning'|'evening', test?: true }
 *   → send Google Chat announcement card (dedup: once per shift per day)
 *   → return popup data for the browser to show
 *
 * Called by SyncupScheduler in the browser at the scheduled time.
 * ThreadKey pattern: syncup-{YYYY-MM-DD}-{shift}
 * Upload replies will use the same threadKey → automatic threading.
 */
require_once __DIR__ . '/../helpers.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') respondError('POST required', 405);
$payload = requireAuth();
$body    = getBody();

$shift  = trim($body['shift'] ?? '');
$isTest = !empty($body['test']);

if (!in_array($shift, ['morning', 'evening'])) respondError('shift must be morning or evening', 400);

$today    = date('Y-m-d');
$cfg      = readJson('syncup-config.json');
$shiftCfg = $cfg[$shift] ?? [];
$webhooks = array_values(array_filter(array_map('trim', $shiftCfg['google_chat_webhooks'] ?? [])));

$popupMsg = trim($shiftCfg['popup_message'] ?? '');
if (!$popupMsg) {
    $popupMsg = $shift === 'morning'
        ? "Daily Sync-up เช้า 🌅\nกรุณาอัปโหลดรูปสรุป Sync-up กะเช้า"
        : "Daily Sync-up เย็น 🌙\nกรุณาอัปโหลดรูปสรุป Sync-up กะเย็น";
}

// ── Dedup (skip if already announced today) ──────────────────────────────
$logFile  = teamDataPath('syncup-notify-log.json');
$lockFile = teamDataPath('syncup-notify.lock');
$logDir = dirname($logFile);
if (!is_dir($logDir)) @mkdir($logDir, 0755, true);
$sentKey  = $shift . '_' . $today;

if (!$isTest && !empty($webhooks)) {
    $lockFp = fopen($lockFile, 'c+');
    if ($lockFp) {
        flock($lockFp, LOCK_EX);
        $log = file_exists($logFile) ? (json_decode(file_get_contents($logFile), true) ?? []) : [];

        $existing = $log[$sentKey]['status'] ?? '';
        if (in_array($existing, ['sent', 'pending'])) {
            flock($lockFp, LOCK_UN);
            fclose($lockFp);
            respondOk([
                'shift'   => $shift,
                'skipped' => true,
                'reason'  => $existing === 'pending' ? 'already_sending' : 'already_sent_today',
                'popup'   => true,
                'message' => $popupMsg,
            ]);
        }

        $log[$sentKey] = ['sent_at' => date('c'), 'status' => 'pending'];
        // Prune entries older than 90 days
        $cutoff = date('Y-m-d', strtotime('-90 days'));
        foreach (array_keys($log) as $k) {
            // key format: "morning_YYYY-MM-DD" or "evening_YYYY-MM-DD"
            $datePart = substr($k, -10);
            if ($datePart < $cutoff) unset($log[$k]);
        }
        file_put_contents($logFile, json_encode($log, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        flock($lockFp, LOCK_UN);
        fclose($lockFp);
    }
}

// ── Send Google Chat announcement ────────────────────────────────────────
$chatErrors = [];
$chatSent   = false;

if (!empty($webhooks)) {
    $shiftLabel = $shift === 'morning' ? '🌅 Sync-up เช้า' : '🌙 Sync-up เย็น';
    $timeLabel  = $shiftCfg['time'] ?? ($shift === 'morning' ? '08:45' : '20:45');
    $dateLabel  = date('d/m/Y');
    $threadKey  = ($isTest ? 'test-' : '') . 'syncup-' . $today . '-' . $shift;
    $replyOpt   = 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD';

    $msgHtml = nl2br(htmlspecialchars($popupMsg, ENT_QUOTES | ENT_HTML5, 'UTF-8'));

    // Derive upload page URL from the request
    // Use port 443 as the only signal for https — avoids false-positive on MAMP/IIS
    $host      = $_SERVER['HTTP_HOST'] ?? 'localhost';
    $hostParts = explode(':', $host);
    $hostPort  = isset($hostParts[1]) ? (int)$hostParts[1] : (int)($_SERVER['SERVER_PORT'] ?? 80);
    $scheme    = ($hostPort === 443) ? 'https' : 'http';
    $apiPath  = strtok($_SERVER['REQUEST_URI'] ?? '/api/syncup/notify.php', '?');
    $baseUrl  = rtrim($scheme . '://' . $host . preg_replace('#/api/syncup/.*#', '', $apiPath), '/');
    $uploadUrl = $baseUrl . '/syncup.html?shift=' . $shift;

    $card = [
        'cardsV2' => [[
            'cardId' => 'syncup-noti-' . $today . '-' . $shift . ($isTest ? '-test' : ''),
            'card'   => [
                'header' => [
                    'title'    => ($isTest ? '[TEST] ' : '') . "📸 {$shiftLabel}",
                    'subtitle' => "กรุณาอัปโหลดรูป Sync-up · {$dateLabel}",
                    'imageUrl' => 'https://fonts.gstatic.com/s/i/googlematerialicons/add_a_photo/v14/web_48dp/1x/baseline_add_a_photo_black_48dp.png',
                    'imageType'=> 'CIRCLE',
                ],
                'sections' => [[
                    'widgets' => [
                        ['textParagraph' => ['text' => $msgHtml]],
                        ['buttonList' => [
                            'buttons' => [[
                                'text'    => "📤 อัปโหลด Sync-up",
                                'onClick' => ['openLink' => ['url' => $uploadUrl]],
                                'color'   => [
                                    'red'   => 0.949,
                                    'green' => 0.392,
                                    'blue'  => 0.098,
                                    'alpha' => 1.0,
                                ],
                            ]],
                        ]],
                        ['decoratedText' => [
                            'startIcon' => ['knownIcon' => 'CLOCK'],
                            'text'      => "<font color=\"#94a3b8\">SOM-Portal &nbsp;·&nbsp; {$dateLabel} &nbsp;·&nbsp; ⏰ {$timeLabel} น."
                                         . ($isTest ? ' &nbsp;<b>[TEST]</b>' : '') . '</font>',
                            'wrapText'  => false,
                        ]],
                    ],
                ]],
            ],
        ]],
    ];

    $cardJson    = json_encode($card, JSON_UNESCAPED_UNICODE);
    $threadNames = [];

    foreach ($webhooks as $webhookUrl) {
        $sep = str_contains($webhookUrl, '?') ? '&' : '?';
        $url = $webhookUrl . $sep
             . 'threadKey='           . urlencode($threadKey)
             . '&messageReplyOption=' . $replyOpt;

        $ch = curl_init($url);
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
            $chatErrors[] = 'cURL: ' . $curlErr;
            logIntegrationError('google-chat-webhook', $webhookUrl, $curlErr, ['source' => 'syncup']);
        } elseif ($code !== 200) {
            $decoded      = json_decode($resp, true);
            $chatErrors[] = "HTTP {$code}: " . ($decoded['error']['message'] ?? substr($resp, 0, 200));
            logIntegrationError('google-chat-webhook', $webhookUrl, "HTTP {$code}", [
                'http_code' => $code,
                'source'    => 'syncup',
                'body'      => substr((string)$resp, 0, 200),
            ]);
        } else {
            $chatSent = true;
            $parsed   = json_decode($resp, true);
            if (!empty($parsed['thread']['name'])) {
                $threadNames[md5($webhookUrl)] = $parsed['thread']['name'];
            }
        }
    }

    // Update dedup log with final status
    if (!$isTest) {
        $lf = fopen($lockFile, 'c+');
        if ($lf) {
            flock($lf, LOCK_EX);
            $log2 = file_exists($logFile) ? (json_decode(file_get_contents($logFile), true) ?? []) : [];
            $log2[$sentKey] = [
                'sent_at'      => date('c'),
                'status'       => $chatSent ? 'sent' : 'failed',
                'thread_names' => $threadNames,
            ];
            file_put_contents($logFile, json_encode($log2, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
            flock($lf, LOCK_UN);
            fclose($lf);
        }
    }
}

// ── Activity log ─────────────────────────────────────────────────────────
if (!$isTest) {
    logActivity('syncup_notify_sent', [
        'shift'     => $shift,
        'date'      => $today,
        'chat_sent' => $chatSent,
    ], $payload['sub'], $payload['name'] ?? '');
}

respondOk([
    'shift'       => $shift,
    'skipped'     => false,
    'popup'       => true,
    'message'     => $popupMsg,
    'chat_sent'   => $chatSent,
    'chat_errors' => $chatErrors,
    'test'        => $isTest,
]);
