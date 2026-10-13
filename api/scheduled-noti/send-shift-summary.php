<?php
/**
 * send-shift-summary.php
 * POST { id }            → send shift handover card to Google Chat (dedup per day)
 * POST { id, test:true } → test send (skips dedup, allows webhook_url override)
 */
require_once __DIR__ . '/../helpers.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') respondError('POST required', 405);
$payload = requireAuth();
$body    = getBody();

$id     = $body['id']   ?? '';
$isTest = !empty($body['test']);
if (!$id) respondError('id required', 400);

// ── Load schedule config ────────────────────────────────────────────
$schedules = readJson('scheduled-noti.json');
$sch = null;
foreach ($schedules as $s) {
    if ($s['id'] === $id) { $sch = $s; break; }
}
if (!$sch) respondError('Schedule not found', 404);
if (($sch['type'] ?? '') !== 'shift_summary') respondError('Not a shift_summary schedule', 400);

if ($isTest && !empty($body['webhook_url'])) {
    $webhooks = [trim($body['webhook_url'])];
} else {
    $webhooks = !empty($sch['google_chat_webhooks']) ? $sch['google_chat_webhooks']
              : (!empty($sch['google_chat_webhook'])  ? [$sch['google_chat_webhook']] : []);
    $webhooks = array_values(array_filter(array_map('trim', $webhooks)));
}
if (empty($webhooks)) respondError('ยังไม่ได้ตั้งค่า Webhook URL', 400);

// ── Dedup (same as send-chat.php) ───────────────────────────────────
$logFile  = teamDataPath('noti-chat-log.json');
$lockFile = teamDataPath('noti-chat-log.lock');
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
        flock($lockFp, LOCK_UN); fclose($lockFp);
        $reason = $existingStatus === 'pending' ? 'already_sending' : 'already_sent_today';
        respondOk(['skipped' => true, 'reason' => $reason, 'sent_at' => $log[$sentKey]['sent_at']]);
    }

    $log[$sentKey] = ['sent_at' => date('c'), 'status' => 'pending'];
    $cutoff = date('Y-m-d', strtotime('-90 days'));
    foreach (array_keys($log) as $k) {
        if (substr($k, -10) < $cutoff) unset($log[$k]);
    }
    file_put_contents($logFile, json_encode($log, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    flock($lockFp, LOCK_UN); fclose($lockFp);
}

// ── Load data ───────────────────────────────────────────────────────
$scheduleData = readJson('schedule.json') ?: [];
$tomorrow     = date('Y-m-d', strtotime('+1 day'));
$todayData    = $scheduleData[$today]    ?? [];
$tomorrowData = $scheduleData[$tomorrow] ?? [];

// Build user ID → "username (nickname)" map
$userMap = [];
foreach (readJson('users.json') ?: [] as $u) {
    $username = trim($u['username'] ?? '');
    $nickname = trim($u['nickname'] ?? '');
    if ($username === '' && $nickname === '') {
        // fallback to name (strip leading '+ ' from legacy imports)
        $userMap[$u['id']] = trim(ltrim($u['name'] ?? '', '+'));
    } elseif ($username === '') {
        $userMap[$u['id']] = $nickname;
    } elseif ($nickname === '') {
        $userMap[$u['id']] = $username;
    } else {
        $userMap[$u['id']] = $username . ' (' . $nickname . ')';
    }
}

// Slot display metadata
$SLOT_META = [
    'shift1_tdpk'   => ['label' => 'TDPK Team',     'oncall' => false],
    'shift1_wah'    => ['label' => 'W@H Team',       'oncall' => false],
    'shift1_oncall' => ['label' => 'Oncall Support', 'oncall' => true],
    'shift2_wah'    => ['label' => 'W@H Team',       'oncall' => false],
    'shift2_oncall' => ['label' => 'Oncall Support', 'oncall' => true],
    'vacation'      => ['label' => 'Vacation',       'oncall' => false],
    'sick'          => ['label' => 'Sick Leave',     'oncall' => false],
];

// ── Helpers ─────────────────────────────────────────────────────────
function resolveNames($val, array $map): array {
    if (empty($val)) return [];
    $ids = is_array($val) ? $val : [$val];
    return array_values(array_filter(array_map(fn($id) => $map[$id] ?? null, $ids)));
}

function thDate(string $ymd): string {
    static $m = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    $d = new DateTime($ymd);
    return $d->format('j') . ' ' . $m[(int)$d->format('n') - 1] . ' ' . ((int)$d->format('Y') + 543);
}

// Build widgets using textParagraph only — no icons, uniform spacing
function buildWidgets(array $slotKeys, array $dateData, array $userMap, array $meta): array {
    $widgets = [];
    foreach ($slotKeys as $slot) {
        $names = resolveNames($dateData[$slot] ?? null, $userMap);
        if (empty($names)) continue;
        $m = $meta[$slot] ?? ['label' => $slot, 'oncall' => false];

        $label     = htmlspecialchars($m['label']);
        $nameLines = implode('<br>', array_map('htmlspecialchars', $names));

        $widgets[] = ['textParagraph' => [
            'text' => "<b>{$label}</b><br>{$nameLines}",
        ]];
    }
    return $widgets;
}

// Section header — plain text, no emoji
function shiftHeader(string $prefix, string $date, array $slotKeys): string {
    $hasShift2 = count(array_filter($slotKeys, fn($k) => strpos($k, 'shift2') === 0)) > 0;
    $hasShift1 = count(array_filter($slotKeys, fn($k) => strpos($k, 'shift1') === 0)) > 0;
    $label = thDate($date);
    if ($hasShift2 && !$hasShift1) return "{$prefix} — {$label}  ·  SHIFT#2  ·  21:00 – 09:00";
    if ($hasShift1 && !$hasShift2) return "{$prefix} — {$label}  ·  SHIFT#1  ·  09:00 – 21:00";
    return "{$prefix} — {$label}";
}

// ── Build card sections ─────────────────────────────────────────────
// Canonical display order — TDPK before W@H regardless of storage order
$SLOT_ORDER = ['shift1_tdpk','shift1_wah','shift1_oncall','shift2_tdpk','shift2_wah','shift2_oncall','vacation','sick'];
$sortSlots  = fn($arr) => array_values(array_intersect($SLOT_ORDER, $arr));

$shiftsToday    = $sortSlots($sch['shifts_today']    ?? []);
$shiftsTomorrow = $sortSlots($sch['shifts_tomorrow'] ?? []);
$sections       = [];

$todayWidgets = buildWidgets($shiftsToday, $todayData, $userMap, $SLOT_META);
if (!empty($todayWidgets)) {
    $sections[] = [
        'header'      => shiftHeader('🌙 TONIGHT', $today, $shiftsToday),
        'widgets'     => $todayWidgets,
        'collapsible' => false,
    ];
}

$tomorrowWidgets = buildWidgets($shiftsTomorrow, $tomorrowData, $userMap, $SLOT_META);
if (!empty($tomorrowWidgets)) {
    $sections[] = [
        'header'      => shiftHeader('☀️ TOMORROW', $tomorrow, $shiftsTomorrow),
        'widgets'     => $tomorrowWidgets,
        'collapsible' => false,
    ];
}

if (empty($sections)) {
    $sections[] = ['widgets' => [['textParagraph' => [
        'text' => '<font color="#94a3b8">ไม่พบข้อมูล shift สำหรับวันที่กำหนด</font>',
    ]]]];
}

// Footer — clock icon + source info
$sections[] = ['widgets' => [['decoratedText' => [
    'startIcon' => ['knownIcon' => 'CLOCK'],
    'text'      => '<font color="#94a3b8">SOM-Portal &nbsp;·&nbsp; '
                 . thDate($today) . ' &nbsp;·&nbsp; ' . ($sch['time'] ?? '') . ' น.'
                 . ($isTest ? ' &nbsp;<b>[TEST]</b>' : '') . '</font>',
    'wrapText'  => false,
]]]];

$card = [
    'cardsV2' => [[
        'cardId' => 'shift-summary-' . $id . ($isTest ? '-test' : ''),
        'card'   => [
            'header' => [
                'title'    => $isTest ? '[TEST] SM Shift Handover' : 'SM Shift Handover',
                'subtitle' => thDate($today) . ' · ' . ($sch['time'] ?? '') . ' น.',
            ],
            'sections' => $sections,
        ],
    ]],
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
    } elseif ($code !== 200) {
        $decoded  = json_decode($resp, true);
        $msg      = $decoded['error']['message'] ?? $decoded['error']['status'] ?? substr($resp, 0, 200);
        $errors[] = "HTTP {$code}: {$msg}";
    } else {
        $success = true;
    }
}

if (!$success && !empty($errors)) {
    respondError(implode(' | ', $errors), 502);
}

// ── Update dedup log ────────────────────────────────────────────────
if (!$isTest) {
    $lf = fopen($lockFile, 'c+');
    if ($lf) {
        flock($lf, LOCK_EX);
        $log2 = file_exists($logFile) ? (json_decode(file_get_contents($logFile), true) ?? []) : [];
        $log2[$sentKey] = ['sent_at' => date('c'), 'status' => $success ? 'sent' : 'failed', 'code' => $code];
        file_put_contents($logFile, json_encode($log2, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        flock($lf, LOCK_UN); fclose($lf);
    }
}

logActivity($isTest ? 'shift_summary_chat_test' : 'shift_summary_chat_sent', [
    'noti_id' => $id,
    'time'    => $sch['time'] ?? '',
    'test'    => $isTest,
], $payload['sub'], $payload['name'] ?? '');

respondOk(['sent' => true, 'test' => $isTest]);
