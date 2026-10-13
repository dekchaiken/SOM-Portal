<?php
/**
 * send-grafana-paused.php
 * POST { id }            → send the Grafana paused-alerts digest to Google Chat (dedup per day)
 * POST { id, test:true } → test send (skips dedup, allows webhook_url override)
 *
 * A `grafana_paused` schedule (managed in admin/scheduled-noti.html) is fired by
 * noti-scheduler.js when its time matches — same browser-triggered mechanism as
 * shift_summary. Content is built live here from Grafana, so the schedule stores
 * no message. Dedup mirrors send-shift-summary.php (one send per schedule per day).
 */
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/../grafana-alerts/_fetch.php';
require_once __DIR__ . '/../grafana-alerts/_notify.php';

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
if (($sch['type'] ?? '') !== 'grafana_paused') respondError('Not a grafana_paused schedule', 400);

if ($isTest && !empty($body['webhook_url'])) {
    $webhooks = [trim($body['webhook_url'])];
} else {
    $webhooks = !empty($sch['google_chat_webhooks']) ? $sch['google_chat_webhooks']
              : (!empty($sch['google_chat_webhook'])  ? [$sch['google_chat_webhook']] : []);
    $webhooks = array_values(array_filter(array_map('trim', $webhooks)));
}
if (empty($webhooks)) respondError('ยังไม่ได้ตั้งค่า Webhook URL — กรอก URL แล้วบันทึกก่อน', 400);

// ── Dedup (same lock/log as send-shift-summary.php) ─────────────────
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

// ── Fetch live paused alerts ────────────────────────────────────────
set_time_limit(60);
try {
    $data = gaFetchPausedAlerts();
} catch (RuntimeException $e) {
    respondError($e->getMessage(), 500);
}

// ── Send the digest card to every configured webhook ────────────────
$errors  = [];
$success = false;
$lastCode = 200;
foreach ($webhooks as $webhookUrl) {
    $r = gaSendChatCard($webhookUrl, $data, $today);
    if ($r['sent'] ?? false) {
        $success  = true;
        $lastCode = $r['httpCode'] ?? 200;
    } else {
        $errors[] = $r['reason'] ?? 'unknown';
    }
}

if (!$success && !empty($errors)) {
    // Roll back the pending reservation so a later retry today can still fire.
    if (!$isTest) {
        $lf = fopen($lockFile, 'c+');
        if ($lf) {
            flock($lf, LOCK_EX);
            $log2 = file_exists($logFile) ? (json_decode(file_get_contents($logFile), true) ?? []) : [];
            unset($log2[$sentKey]);
            file_put_contents($logFile, json_encode($log2, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
            flock($lf, LOCK_UN); fclose($lf);
        }
    }
    respondError(implode(' | ', $errors), 502);
}

// ── Update dedup log with final status ─────────────────────────────
if (!$isTest) {
    $lf = fopen($lockFile, 'c+');
    if ($lf) {
        flock($lf, LOCK_EX);
        $log2 = file_exists($logFile) ? (json_decode(file_get_contents($logFile), true) ?? []) : [];
        $log2[$sentKey] = ['sent_at' => date('c'), 'status' => $success ? 'sent' : 'failed', 'code' => $lastCode];
        file_put_contents($logFile, json_encode($log2, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        flock($lf, LOCK_UN); fclose($lf);
    }
}

logActivity($isTest ? 'grafana_paused_chat_test' : 'grafana_paused_chat_sent', [
    'noti_id' => $id,
    'time'    => $sch['time'] ?? '',
    'total'   => (int)($data['total'] ?? 0),
    'test'    => $isTest,
], $payload['sub'], $payload['name'] ?? '');

respondOk(['sent' => true, 'test' => $isTest, 'total' => (int)($data['total'] ?? 0)]);
