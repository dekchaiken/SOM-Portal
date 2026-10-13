<?php
/**
 * Exam Reminder — send a Google Chat card listing users who haven't
 * taken the exam yet. Admin-only. Manual trigger (no cron in Phase 1).
 *
 *   GET  /api/exams/reminder.php?exam_id=...&action=preview
 *        → { card, resolved_names, resolved_count, webhook_count }
 *
 *   POST /api/exams/reminder.php?action=send
 *        body: {
 *          exam_id:            string,
 *          target:             'not_attempted' | 'custom',
 *          user_ids?:          string[],       // required when target='custom'
 *          extra_message?:     string,
 *          deadline?:          string,          // free-form Thai date label
 *          chat_webhook_urls?: string[],        // overrides default in system-settings
 *        }
 *        → { sent, failed, errors[], resolved_names[], webhook_count }
 */

require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/../email-noti/_chat_cards.php';

$payload = requireAuth();
requireRole($payload, ADMIN_ROLES);

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

// Shape a user record into the trimmed form the UI expects for chip rendering.
function _reminderUserShape(array $u): array
{
    return [
        'user_id'    => $u['id'],
        'name'       => $u['name']       ?? '',
        'nickname'   => $u['nickname']   ?? '',
        'email'      => $u['email']      ?? '',
        'avatar_url' => $u['avatar_url'] ?? null,
        'role'       => $u['role']       ?? 'sm_user',
    ];
}

// Compute the two candidate lists for reminders. Both are derived from the
// same eligible-user set + attempt records so a user always lands in exactly
// one bucket (not_attempted XOR failed) — no double-reminder risk.
//
// Returns [
//   'exam'              => array,
//   'eligible'          => [user_id => user, ...],   // full team-eligible pool
//   'attempt_state'     => [user_id => ['submitted','passed','in_progress']],
//   'not_attempted'     => [user_id => user, ...],   // never even started
//   'failed'            => [user_id => user, ...],   // submitted, no pass yet
// ]
function _reminderBuildLists(string $examId): array
{
    $exam = examsGet($examId);
    if (!$exam) respondError('Exam not found', 404);

    $currentTeam = $GLOBALS['_current_team'] ?? null;
    $allUsers    = readJson('users.json');

    // Per-user rollup of attempts for this exam.
    $attemptState = [];
    foreach (examsReadJson('attempts.json') as $a) {
        if (($a['exam_id'] ?? '') !== $examId) continue;
        $uid = $a['user_id'] ?? '';
        if (!$uid) continue;
        if (!isset($attemptState[$uid])) {
            $attemptState[$uid] = ['submitted' => false, 'passed' => false, 'in_progress' => false];
        }
        $status = $a['status'] ?? '';
        if ($status === 'submitted') {
            $attemptState[$uid]['submitted'] = true;
            if (!empty($a['passed'])) $attemptState[$uid]['passed'] = true;
        } elseif ($status === 'in_progress') {
            $attemptState[$uid]['in_progress'] = true;
        }
    }

    // Filter to eligible users of this team.
    $eligible = [];
    foreach ($allUsers as $u) {
        if ($currentTeam !== null && ($u['team'] ?? '') !== $currentTeam) continue;
        if (($u['role'] ?? '') === 'external') continue;
        if (isset($u['exam_include']) && $u['exam_include'] === false) continue;
        $eligible[$u['id']] = $u;
    }

    $notAttempted = [];
    $failed       = [];
    foreach ($eligible as $uid => $u) {
        $s = $attemptState[$uid] ?? null;
        if (!$s || !$s['submitted']) {
            // Never submitted (either no attempt at all OR only in_progress).
            // Only bucket users with zero attempts here — those with an
            // in_progress attempt shouldn't be reminded to "start" the exam.
            if (!$s) $notAttempted[$uid] = $u;
            continue;
        }
        if ($s['submitted'] && !$s['passed']) {
            $failed[$uid] = $u;
        }
    }

    return [
        'exam'          => $exam,
        'eligible'      => $eligible,
        'attempt_state' => $attemptState,
        'not_attempted' => $notAttempted,
        'failed'        => $failed,
    ];
}

// ─── Resolve target list for a specific reminder request ──────────────
function _reminderContext(string $examId, string $target, array $customIds): array
{
    $lists = _reminderBuildLists($examId);

    if ($target === 'not_attempted') {
        $targets = array_values($lists['not_attempted']);
    } elseif ($target === 'failed') {
        $targets = array_values($lists['failed']);
    } elseif ($target === 'custom') {
        $targets = [];
        // Custom picker sources from the union of both reminder buckets —
        // sending to already-passed users doesn't make sense.
        $candidates = $lists['not_attempted'] + $lists['failed'];
        foreach ($customIds as $uid) {
            if (isset($candidates[$uid])) $targets[] = $candidates[$uid];
        }
    } else {
        respondError("Invalid target — must be 'not_attempted', 'failed', or 'custom'", 400);
    }

    usort($targets, fn($a, $b) => strcasecmp($a['name'] ?? '', $b['name'] ?? ''));

    return [
        'exam'           => $lists['exam'],
        'targets'        => $targets,
        'eligible_count' => count($lists['eligible']),
        'lists'          => $lists,
    ];
}

// Deep-link to the user-facing exam page — same URL email-noti/index.php
// uses so admins can preview the exact link recipients will see.
function _reminderExamUrl(string $examId): string
{
    return APP_BASE_URL . '/exam.html?id=' . rawurlencode($examId);
}

// Human-readable topLabel for the target audience block in the chat card.
function _reminderTargetLabel(string $target): string
{
    if ($target === 'failed')        return 'ทำแล้วแต่ยังไม่ผ่าน';
    if ($target === 'custom')        return 'ผู้รับ reminder';
    return 'ยังไม่ได้ทำข้อสอบ';
}

// ─── GET preview ──────────────────────────────────────────────────────
if ($method === 'GET' && $action === 'preview') {
    $examId  = trim($_GET['exam_id'] ?? '');
    if (!$examId) respondError('exam_id required', 400);
    $target  = $_GET['target'] ?? 'not_attempted';
    $customIds = [];
    if ($target === 'custom') {
        $customIds = array_values(array_filter(explode(',', $_GET['user_ids'] ?? '')));
    }

    $ctx     = _reminderContext($examId, $target, $customIds);
    $names   = array_map(fn($u) => $u['name'] ?? $u['username'] ?? '?', $ctx['targets']);
    $examUrl = _reminderExamUrl($examId);
    $card = buildExamReminderChatCard(
        $ctx['exam'],
        $names,
        trim($_GET['extra_message'] ?? ''),
        trim($_GET['deadline'] ?? ''),
        15,
        $examUrl,
        _reminderTargetLabel($target)
    );

    $s = readJson('system-settings.json');
    $defaultWebhooks = array_values((array)($s['exam_reminder_chat_webhooks'] ?? []));

    // Return trimmed candidate lists so the modal can populate both tabs
    // (not-attempted + failed) with a single round-trip.
    $notAttemptedList = array_values(array_map('_reminderUserShape', $ctx['lists']['not_attempted']));
    $failedList       = array_values(array_map('_reminderUserShape', $ctx['lists']['failed']));

    respondOk([
        'card'                 => $card,
        'resolved_names'       => $names,
        'resolved_count'       => count($names),
        'eligible_count'       => $ctx['eligible_count'],
        'default_webhooks'     => $defaultWebhooks,
        'exam_url'             => $examUrl,
        'not_attempted_list'   => $notAttemptedList,
        'failed_list'          => $failedList,
        'not_attempted_count'  => count($notAttemptedList),
        'failed_count'         => count($failedList),
    ]);
}

// ─── POST send ────────────────────────────────────────────────────────
if ($method === 'POST' && $action === 'send') {
    requireCsrf();
    $body = getBody();

    $examId  = trim($body['exam_id'] ?? '');
    if (!$examId) respondError('exam_id required', 400);
    $target = $body['target'] ?? 'not_attempted';
    $customIds = array_values(array_filter((array)($body['user_ids'] ?? []), 'is_string'));

    $ctx    = _reminderContext($examId, $target, $customIds);
    $names  = array_map(fn($u) => $u['name'] ?? $u['username'] ?? '?', $ctx['targets']);

    if (empty($names)) {
        respondError('ไม่มีผู้รับ reminder — ทุกคนอาจทำข้อสอบครบแล้ว หรือ user_ids ไม่ตรงกับ eligible list', 400);
    }

    // Resolve webhook list: caller-supplied > system-settings default
    $webhooks = array_values(array_filter(array_map('trim',
        (array)($body['chat_webhook_urls'] ?? []))));
    if (empty($webhooks)) {
        $s = readJson('system-settings.json');
        $webhooks = array_values((array)($s['exam_reminder_chat_webhooks'] ?? []));
    }
    if (empty($webhooks)) {
        respondError('ยังไม่ได้ตั้งค่า Google Chat webhook — ตั้งใน System Settings หรือ override ตอนส่ง', 400);
    }

    $examUrl = _reminderExamUrl($examId);
    $card = buildExamReminderChatCard(
        $ctx['exam'],
        $names,
        trim($body['extra_message'] ?? ''),
        trim($body['deadline'] ?? ''),
        15,
        $examUrl,
        _reminderTargetLabel($target)
    );
    $result = sendGoogleChatCard($webhooks, $card, 'exam-reminder');

    logActivity('exam_reminder_sent', [
        'exam_id'      => $examId,
        'exam_title'   => $ctx['exam']['title'] ?? '',
        'target'       => $target,
        'name_count'   => count($names),
        'webhook_count'=> count($webhooks),
        'sent'         => $result['sent'],
        'failed'       => $result['failed'],
    ], $payload['sub'], $payload['name']);

    respondOk([
        'sent'           => $result['sent'],
        'failed'         => $result['failed'],
        'errors'         => $result['errors'],
        'resolved_names' => $names,
        'webhook_count'  => count($webhooks),
    ], $result['success']
        ? "ส่ง reminder เข้า Google Chat สำเร็จ ({$result['sent']}/" . count($webhooks) . ' webhook)'
        : 'ส่ง reminder ไม่สำเร็จ — ' . implode(' | ', $result['errors']));
}

respondError('Invalid action or method', 400);
