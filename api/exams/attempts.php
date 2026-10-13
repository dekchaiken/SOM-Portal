<?php
/**
 * Exam attempts — start, fetch, submit, log events
 *
 * POST /api/exams/attempts.php?action=start    body: { exam_id }
 *      → creates an in_progress attempt; returns sanitized question set + choice order
 * GET  /api/exams/attempts.php?id=...          → fetch one attempt (owner or admin)
 * GET  /api/exams/attempts.php?exam_id=...     → admin: list attempts for an exam
 * GET  /api/exams/attempts.php?action=mine&exam_id=... → list my attempts for an exam
 * POST /api/exams/attempts.php?action=submit   body: { attempt_id, answers, auto?, violations? }
 * POST /api/exams/attempts.php?action=event    body: { attempt_id, type, meta? }
 *      → log security event (tab_switch / blur / fullscreen_exit / paste / ...)
 * POST /api/exams/attempts.php?action=heartbeat body: { attempt_id }
 *      → keepalive; allows server-side time enforcement
 */
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/_lib.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];
$action  = $_GET['action'] ?? '';
$id      = $_GET['id']     ?? '';
$examId  = $_GET['exam_id'] ?? '';
$isAdmin = in_array($payload['role'], ADMIN_ROLES);
$uid     = $payload['sub'];

// ─────────────────────────────────────────────────────────────────
// START a new attempt
// ─────────────────────────────────────────────────────────────────
if ($method === 'POST' && $action === 'start') {
    requireCsrf();
    $body = getBody();
    $eid  = trim($body['exam_id'] ?? '');
    if (!$eid) respondError('exam_id is required');

    $exam = examsGet($eid);
    if (!$exam) respondError('Exam not found', 404);
    if (($exam['status'] ?? 'draft') !== 'published' && !$isAdmin) {
        respondError('Exam not available', 403);
    }

    $cfg = examsMergeConfig(examsDefaultConfig(), $exam['config'] ?? []);

    // Course prerequisite check — applies to everyone, admins included
    $lock = examsCourseLockState($uid, $exam['course_prerequisites'] ?? []);
    if ($lock['locked']) {
        $titles = array_map(fn($u) => $u['title'], $lock['unmet']);
        respondError('ต้องเรียนคอร์ส "' . implode('", "', $titles) . '" ให้จบก่อนจึงจะทำข้อสอบได้', 403);
    }

    // Window check
    [$wOk, $wErr] = examsWindowOpen($cfg);
    if (!$wOk && !$isAdmin) respondError($wErr, 403);

    // Resume if there is already an in-progress attempt
    $active = examsActiveAttempt($uid, $eid);
    if ($active) {
        // Verify time hasn't already expired server-side
        if (!empty($cfg['time_limit']['enabled'])
            && in_array($cfg['time_limit']['mode'] ?? 'total', ['total','both'], true)) {
            $started = strtotime($active['started_at'] ?? '') ?: time();
            $deadline = $started + ((int)$cfg['time_limit']['total_minutes'] * 60);
            if (time() > $deadline) {
                // expired; auto-submit silently with current answers
                examsAutoSubmit($active, $exam, $cfg);
                $active['status'] = 'submitted';
            }
        }
        if (($active['status'] ?? '') === 'in_progress') {
            respondOk(examsBuildAttemptView($active, $exam, $cfg, $isAdmin), 'Resumed in-progress attempt');
        }
    }

    // Attempt-count gate
    if (!empty($cfg['attempts']['enabled'])) {
        $max = (int)($cfg['attempts']['max'] ?? 1);
        if ($max > 0) {
            $count = examsUserAttemptCount($uid, $eid);
            if ($count >= $max) respondError('คุณทำข้อสอบครบจำนวนครั้งสูงสุดแล้ว ('.$max.' ครั้ง)', 403);
        }
        // Cooldown
        $cool = (int)($cfg['attempts']['cooldown_minutes'] ?? 0);
        if ($cool > 0) {
            $last = 0;
            foreach (examsReadJson('attempts.json') as $a) {
                if (($a['user_id'] ?? '') !== $uid) continue;
                if (($a['exam_id'] ?? '') !== $eid) continue;
                if (($a['status']  ?? '') !== 'submitted') continue;
                $t = strtotime($a['submitted_at'] ?? '') ?: 0;
                if ($t > $last) $last = $t;
            }
            if ($last && (time() - $last) < $cool * 60) {
                $remain = (int)ceil(($cool * 60 - (time() - $last)) / 60);
                respondError("ต้องรออีก $remain นาทีก่อนทำใหม่", 403);
            }
        }
    }

    // Build the per-attempt pool snapshot
    $pool = examsBuildAttemptPool($exam, $cfg);
    if (!empty($cfg['shuffle_questions']['enabled'])) shuffle($pool);

    $qids = array_map(fn($q) => $q['id'] ?? '', $pool);
    $choiceOrders = examsBuildChoiceOrders($pool, !empty($cfg['shuffle_choices']['enabled']));

    $attempt = [
        'id'            => genId('att'),
        'exam_id'       => $eid,
        'user_id'       => $uid,
        'user_name'     => $payload['name'] ?? '',
        'question_ids'  => $qids,
        'choice_orders' => (object)$choiceOrders,
        'answers'       => (object)[],
        'score'         => 0,
        'passed'        => false,
        'status'        => 'in_progress',
        'started_at'    => date('c'),
        'submitted_at'  => null,
        'auto_submitted'=> false,
        'violations'    => (object)[
            'tab_switch'      => 0,
            'blur'            => 0,
            'fullscreen_exit' => 0,
            'paste'           => 0,
            'copy'            => 0,
        ],
        // Detailed event log moved to data/exams/<exam_id>/events.json (no inline log)
    ];

    $all = examsReadJson('attempts.json');
    $all[] = $attempt;
    examsWriteJson('attempts.json', $all);
    logActivity('exam_attempt_start',
        ['exam_id' => $eid, 'exam_title' => $exam['title'] ?? '', 'attempt_id' => $attempt['id']],
        $uid, $payload['name']);

    // Audit event in per-exam log
    examsAppendEvent($eid, [
        'type' => 'attempt_start',
        'label' => 'เริ่มทำข้อสอบ',
        'attempt_id' => $attempt['id'],
        'user_id' => $uid,
        'user_name' => $payload['name'] ?? '',
        'data' => [
            'questions_picked' => count($qids),
            'shuffle_questions' => !empty($cfg['shuffle_questions']['enabled']),
            'shuffle_choices'   => !empty($cfg['shuffle_choices']['enabled']),
            'time_limit_min'    => !empty($cfg['time_limit']['enabled']) ? (int)$cfg['time_limit']['total_minutes'] : null,
        ],
    ]);

    // If exam has a policy with required consent, expect the client to have ticked it.
    // We log the consent here since the user can't reach this endpoint without going past the UI gate.
    if (!empty($cfg['policy']['enabled']) && !empty($cfg['policy']['require_consent'])) {
        examsAppendEvent($eid, [
            'type' => 'policy_consent',
            'label' => 'ยินยอมตามเงื่อนไข',
            'attempt_id' => $attempt['id'],
            'user_id' => $uid,
            'user_name' => $payload['name'] ?? '',
            'data' => [
                'policy_title' => $cfg['policy']['title'] ?? '',
                'consent_label' => $cfg['policy']['consent_label'] ?? '',
            ],
        ]);
    }

    respondOk(examsBuildAttemptView($attempt, $exam, $cfg, $isAdmin), 'Attempt started');
}

// ─────────────────────────────────────────────────────────────────
// GET — fetch attempt (resume), list, or audit-event timeline
// ─────────────────────────────────────────────────────────────────
if ($method === 'GET' && $action === 'events') {
    // Admin or owner can fetch the audit timeline for an attempt
    $aid = $id ?: trim($_GET['attempt_id'] ?? '');
    if (!$aid) respondError('attempt_id required');
    $att = null;
    foreach (examsReadJson('attempts.json') as $a) if (($a['id'] ?? '') === $aid) { $att = $a; break; }
    if (!$att) respondError('Attempt not found', 404);
    if (!$isAdmin && ($att['user_id'] ?? '') !== $uid) respondError('Forbidden', 403);

    $eid = $att['exam_id'] ?? '';
    $all = examsReadExamFile($eid, 'events.json');
    $out = array_values(array_filter($all, fn($e) => ($e['attempt_id'] ?? '') === $aid));
    // Sort oldest → newest for timeline display
    usort($out, fn($a, $b) => strcmp($a['ts'] ?? '', $b['ts'] ?? ''));
    respondOk([
        'attempt' => [
            'id'             => $att['id'],
            'exam_id'        => $eid,
            'user_id'        => $att['user_id'] ?? '',
            'user_name'      => $att['user_name'] ?? '',
            'status'         => $att['status'] ?? '',
            'score'          => (int)($att['score'] ?? 0),
            'passed'         => !empty($att['passed']),
            'started_at'    => $att['started_at']   ?? null,
            'submitted_at'  => $att['submitted_at'] ?? null,
            'auto_submitted'=> !empty($att['auto_submitted']),
            'violations'    => $att['violations']   ?? (object)[],
        ],
        'events' => $out,
        'total'  => count($out),
    ]);
}

if ($method === 'GET') {
    if ($action === 'mine' && $examId) {
        $out = [];
        foreach (examsReadJson('attempts.json') as $a) {
            if (($a['user_id'] ?? '') !== $uid) continue;
            if (($a['exam_id'] ?? '') !== $examId) continue;
            $out[] = [
                'id'           => $a['id'],
                'status'       => $a['status'] ?? '',
                'score'        => (int)($a['score'] ?? 0),
                'passed'       => !empty($a['passed']),
                'started_at'   => $a['started_at']   ?? null,
                'submitted_at' => $a['submitted_at'] ?? null,
                'auto_submitted'=> !empty($a['auto_submitted']),
            ];
        }
        usort($out, fn($a,$b) => strcmp($b['started_at'] ?? '', $a['started_at'] ?? ''));
        respondOk($out);
    }

    if ($id) {
        $att = null;
        foreach (examsReadJson('attempts.json') as $a) if (($a['id'] ?? '') === $id) { $att = $a; break; }
        if (!$att) respondError('Attempt not found', 404);
        if (!$isAdmin && ($att['user_id'] ?? '') !== $uid) respondError('Forbidden', 403);
        $exam = examsGet($att['exam_id'] ?? '');
        if (!$exam) respondError('Exam missing', 404);
        $cfg  = examsMergeConfig(examsDefaultConfig(), $exam['config'] ?? []);
        respondOk(examsBuildAttemptView($att, $exam, $cfg, $isAdmin));
    }

    // Admin listing for an exam
    requireRole($payload, ADMIN_ROLES);
    if (!$examId) respondError('exam_id required');
    $rows = [];
    foreach (examsReadJson('attempts.json') as $a) {
        if (($a['exam_id'] ?? '') !== $examId) continue;
        $rows[] = [
            'id'           => $a['id'],
            'user_id'      => $a['user_id'] ?? '',
            'user_name'    => $a['user_name'] ?? '',
            'status'       => $a['status'] ?? '',
            'score'        => (int)($a['score'] ?? 0),
            'passed'       => !empty($a['passed']),
            'started_at'   => $a['started_at']   ?? null,
            'submitted_at' => $a['submitted_at'] ?? null,
            'auto_submitted'=> !empty($a['auto_submitted']),
            'violations'   => $a['violations']   ?? (object)[],
            'question_count'=> count($a['question_ids'] ?? []),
        ];
    }
    usort($rows, fn($a,$b) => strcmp($b['started_at'] ?? '', $a['started_at'] ?? ''));
    respondOk($rows);
}

// ─────────────────────────────────────────────────────────────────
// POST event — security log
// ─────────────────────────────────────────────────────────────────
if ($method === 'POST' && $action === 'event') {
    requireCsrf();
    $body = getBody();
    $aid  = trim($body['attempt_id'] ?? '');
    $type = trim($body['type'] ?? '');
    $meta = is_array($body['meta'] ?? null) ? $body['meta'] : [];
    if (!$aid || !$type) respondError('attempt_id & type required');
    $allowedTypes = [
        'tab_switch','blur','focus','fullscreen_exit','paste','copy','devtools','rejoin',
        'answer_change','flag','unflag','view_question','time_warning',
        // Per-question tab-switch skip: fired when a user hits the per-question
        // tab_detection quota — the client marks the question as locked/skipped.
        'question_skipped',
    ];
    if (!in_array($type, $allowedTypes, true)) {
        respondError('Unknown event type', 400);
    }

    $all = examsReadJson('attempts.json');
    $idx = -1;
    foreach ($all as $i => $a) if (($a['id'] ?? '') === $aid) { $idx = $i; break; }
    if ($idx < 0) respondError('Attempt not found', 404);
    if (($all[$idx]['user_id'] ?? '') !== $uid) respondError('Forbidden', 403);
    if (($all[$idx]['status'] ?? '') !== 'in_progress') respondError('Attempt already submitted', 400);

    $eid = $all[$idx]['exam_id'] ?? '';

    // Increment violation counter (security events only)
    $v = (array)($all[$idx]['violations'] ?? []);
    if (in_array($type, ['tab_switch','blur','fullscreen_exit','paste','copy'], true)) {
        $v[$type] = (int)($v[$type] ?? 0) + 1;
        $all[$idx]['violations'] = (object)$v;
        examsWriteJson('attempts.json', $all);
    }

    // Human-readable label for the audit log
    $labels = [
        'tab_switch'      => 'สลับไปแท็บอื่น',
        'blur'            => 'หน้าต่างเสียโฟกัส',
        'focus'           => 'กลับเข้าหน้าจอ',
        'fullscreen_exit' => 'ออกจาก fullscreen',
        'paste'           => 'พยายามวาง (paste)',
        'copy'            => 'พยายาม copy / คลิกขวา',
        'devtools'        => 'เปิด DevTools',
        'rejoin'          => 'กลับเข้าสอบ',
        'answer_change'   => 'แก้ไขคำตอบ',
        'flag'            => 'ปักธงคำถาม',
        'unflag'          => 'ยกเลิกการปักธง',
        'view_question'   => 'เปิดดูคำถาม',
        'time_warning'    => 'เตือนใกล้หมดเวลา',
        'question_skipped'=> 'ข้ามข้อ (สลับแท็บเกินโควตาต่อข้อ)',
    ];

    examsAppendEvent($eid, [
        'type' => $type,
        'label' => $labels[$type] ?? $type,
        'attempt_id' => $aid,
        'user_id' => $uid,
        'user_name' => $payload['name'] ?? ($all[$idx]['user_name'] ?? ''),
        'violation_count' => isset($v[$type]) ? (int)$v[$type] : null,
        'data' => $meta,
    ]);

    respondOk(['violations' => $all[$idx]['violations']]);
}

// ─────────────────────────────────────────────────────────────────
// POST heartbeat — server-side time enforcement
// ─────────────────────────────────────────────────────────────────
if ($method === 'POST' && $action === 'heartbeat') {
    requireCsrf();
    $body = getBody();
    $aid  = trim($body['attempt_id'] ?? '');
    if (!$aid) respondError('attempt_id required');

    $all = examsReadJson('attempts.json');
    $idx = -1;
    foreach ($all as $i => $a) if (($a['id'] ?? '') === $aid) { $idx = $i; break; }
    if ($idx < 0) respondError('Attempt not found', 404);
    if (($all[$idx]['user_id'] ?? '') !== $uid) respondError('Forbidden', 403);

    $att = $all[$idx];
    if (($att['status'] ?? '') !== 'in_progress') {
        respondOk(['expired' => false, 'status' => $att['status']]);
    }
    $exam = examsGet($att['exam_id'] ?? '');
    if (!$exam) respondError('Exam missing', 404);
    $cfg  = examsMergeConfig(examsDefaultConfig(), $exam['config'] ?? []);

    $remaining = null;
    if (!empty($cfg['time_limit']['enabled'])
        && in_array($cfg['time_limit']['mode'] ?? 'total', ['total','both'], true)) {
        $started  = strtotime($att['started_at'] ?? '') ?: time();
        $deadline = $started + ((int)$cfg['time_limit']['total_minutes'] * 60);
        $remaining = max(0, $deadline - time());
        if ($remaining === 0) {
            // Auto-submit
            examsAutoSubmit($att, $exam, $cfg);
            respondOk(['expired' => true, 'remaining' => 0]);
        }
    }
    respondOk(['expired' => false, 'remaining' => $remaining]);
}

// ─────────────────────────────────────────────────────────────────
// POST submit
// ─────────────────────────────────────────────────────────────────
if ($method === 'POST' && $action === 'submit') {
    requireCsrf();
    $body = getBody();
    $aid  = trim($body['attempt_id'] ?? '');
    if (!$aid) respondError('attempt_id required');
    $userAnswers = is_array($body['answers'] ?? null) ? $body['answers'] : [];
    $auto        = !empty($body['auto']);

    $all = examsReadJson('attempts.json');
    $idx = -1;
    foreach ($all as $i => $a) if (($a['id'] ?? '') === $aid) { $idx = $i; break; }
    if ($idx < 0) respondError('Attempt not found', 404);
    if (($all[$idx]['user_id'] ?? '') !== $uid) respondError('Forbidden', 403);
    if (($all[$idx]['status'] ?? '') !== 'in_progress') respondError('Attempt already submitted', 400);

    $att  = $all[$idx];
    $exam = examsGet($att['exam_id'] ?? '');
    if (!$exam) respondError('Exam missing', 404);
    $cfg  = examsMergeConfig(examsDefaultConfig(), $exam['config'] ?? []);

    // Score
    [$percent, $details] = examsScoreAttempt($att, $exam, $userAnswers);

    // Penalty mode for tab/fullscreen violations
    $finalPercent = $percent;
    $penaltyApplied = 0;
    foreach (['tab_detection','fullscreen_lock'] as $key) {
        if (!empty($cfg[$key]['enabled'])
            && ($cfg[$key]['action'] ?? 'log') === 'penalty') {
            $maxV = (int)($cfg[$key]['max_violations'] ?? 0);
            $vKey = $key === 'tab_detection' ? 'tab_switch' : 'fullscreen_exit';
            $v    = (int)((array)($att['violations'] ?? []))[$vKey] ?? 0;
            if ($maxV > 0 && $v > $maxV) {
                $pp = (int)($cfg[$key]['penalty_pct'] ?? 0);
                $penaltyApplied += $pp;
            }
        }
    }
    if ($penaltyApplied > 0) {
        $finalPercent = max(0, $percent - $penaltyApplied);
    }

    $passScore = (int)($exam['pass_score'] ?? 70);
    $passed    = $finalPercent >= $passScore;

    $att['answers']        = (object)$userAnswers;
    $att['score']          = $finalPercent;
    $att['raw_score']      = $percent;
    $att['penalty']        = $penaltyApplied;
    $att['passed']         = $passed;
    $att['status']         = 'submitted';
    $att['submitted_at']   = date('c');
    $att['auto_submitted'] = $auto;

    $all[$idx] = $att;
    examsWriteJson('attempts.json', $all);

    logActivity(
        $passed ? 'exam_attempt_passed' : 'exam_attempt_failed',
        [
            'exam_id'    => $exam['id'],
            'exam_title' => $exam['title'] ?? '',
            'attempt_id' => $att['id'],
            'score'      => $finalPercent,
            'auto'       => $auto,
            'penalty'    => $penaltyApplied,
        ],
        $uid, $payload['name']
    );

    // Calculate duration
    $startedTs   = strtotime($att['started_at']  ?? '') ?: 0;
    $submittedTs = strtotime($att['submitted_at']?? '') ?: time();
    $durationSec = max(0, $submittedTs - $startedTs);

    examsAppendEvent($exam['id'], [
        'type' => $auto ? 'attempt_auto_submit' : 'attempt_submit',
        'label' => $auto ? 'ระบบบังคับส่ง (auto)' : 'ส่งคำตอบ',
        'attempt_id' => $att['id'],
        'user_id' => $uid,
        'user_name' => $payload['name'] ?? '',
        'data' => [
            'score'         => $finalPercent,
            'raw_score'     => $percent,
            'penalty'       => $penaltyApplied,
            'passed'        => $passed,
            'pass_score'    => $passScore,
            'duration_sec'  => $durationSec,
            'correct_count' => count(array_filter($details, fn($d) => $d['correct'])),
            'total_count'   => count($details),
            'violations'    => $att['violations'] ?? new stdClass(),
        ],
    ]);

    // Result visibility
    $showMode = $cfg['show_results']['mode'] ?? 'after_submit';
    $resp = [
        'attempt_id' => $att['id'],
        'score'      => $finalPercent,
        'raw_score'  => $percent,
        'penalty'    => $penaltyApplied,
        'pass_score' => $passScore,
        'passed'     => $passed,
        'auto'       => $auto,
        'show_mode'  => $showMode,
    ];
    if ($showMode === 'after_submit') {
        $resp['summary'] = array_map(function ($d) use ($cfg) {
            $row = ['q_id' => $d['q_id'], 'correct' => $d['correct']];
            if (!empty($cfg['show_results']['show_answers']))  $row['correct_answer'] = $d['correct_answer'];
            if (!empty($cfg['show_results']['show_explains'])) $row['explain']        = $d['explain'];
            return $row;
        }, $details);
        $resp['correct_count'] = count(array_filter($details, fn($d) => $d['correct']));
        $resp['total_count']   = count($details);
    } elseif ($showMode === 'never') {
        $resp['hidden'] = true;
        unset($resp['score'], $resp['raw_score'], $resp['penalty'], $resp['passed']);
    }
    respondOk($resp, $passed ? 'Passed!' : 'Submitted');
}

// ─────────────────────────────────────────────────────────────────
// DELETE — admin reset attempts
//   ?id=ATTEMPT          → delete one attempt
//   ?exam_id=X           → delete ALL attempts for an exam
//   ?exam_id=X&user_id=Y → delete attempts for one user in one exam
// ─────────────────────────────────────────────────────────────────
if ($method === 'DELETE') {
    requireRole($payload, ADMIN_ROLES);
    requireCsrf();
    $userIdQ = $_GET['user_id'] ?? '';

    $all = examsReadJson('attempts.json');
    $kept = [];
    $removed = 0;

    foreach ($all as $a) {
        $hitId    = $id      ? (($a['id'] ?? '') === $id) : true;
        $hitExam  = $examId  ? (($a['exam_id'] ?? '') === $examId) : true;
        $hitUser  = $userIdQ ? (($a['user_id'] ?? '') === $userIdQ) : true;

        // Need at least one of these filters to avoid wiping everything by accident
        if (!$id && !$examId && !$userIdQ) {
            respondError('Provide id, exam_id or user_id');
        }

        if ($hitId && $hitExam && $hitUser) { $removed++; continue; }
        $kept[] = $a;
    }
    examsWriteJson('attempts.json', $kept);

    logActivity('exam_attempts_reset', [
        'attempt_id' => $id      ?: '(any)',
        'exam_id'    => $examId  ?: '(any)',
        'user_id'    => $userIdQ ?: '(any)',
        'removed'    => $removed,
    ], $payload['sub'], $payload['name']);

    // Audit log inside the exam folder (if scoped to one exam)
    if ($examId) {
        examsAppendEvent($examId, [
            'type' => 'admin_reset',
            'label' => 'Admin รีเซ็ตการสอบ',
            'user_id' => $payload['sub'],
            'user_name' => $payload['name'] ?? '',
            'data' => [
                'attempt_id'  => $id      ?: '(any)',
                'target_user' => $userIdQ ?: '(any)',
                'removed'     => $removed,
            ],
        ]);
    }

    respondOk(['removed' => $removed], "Reset $removed attempt(s)");
}

respondError('Method not allowed', 405);

// ═════════════════════════════════════════════════════════════════
// Helpers (file-local)
// ═════════════════════════════════════════════════════════════════
function examsBuildAttemptView(array $att, array $exam, array $cfg, bool $isAdmin): array {
    // For an in-progress attempt: send sanitized questions in attempt order
    $byId = [];
    foreach ($exam['questions'] ?? [] as $q) $byId[$q['id'] ?? ''] = $q;

    $orders = (array)($att['choice_orders'] ?? []);
    $qsOut = [];
    foreach ($att['question_ids'] ?? [] as $qid) {
        $q = $byId[$qid] ?? null;
        if (!$q) continue;
        $shuffled = examsApplyChoiceOrder($q, $orders[$qid] ?? []);
        $qsOut[] = examsSanitizeQuestion($shuffled);
    }

    $remaining = null;
    if (!empty($cfg['time_limit']['enabled'])
        && in_array($cfg['time_limit']['mode'] ?? 'total', ['total','both'], true)
        && ($att['status'] ?? '') === 'in_progress') {
        $started = strtotime($att['started_at'] ?? '') ?: time();
        $deadline = $started + ((int)$cfg['time_limit']['total_minutes'] * 60);
        $remaining = max(0, $deadline - time());
    }

    return [
        'id'             => $att['id'],
        'exam_id'        => $att['exam_id'],
        'exam_title'     => $exam['title'] ?? '',
        'pass_score'     => (int)($exam['pass_score'] ?? 70),
        'status'         => $att['status'] ?? '',
        'started_at'     => $att['started_at']   ?? null,
        'submitted_at'   => $att['submitted_at'] ?? null,
        'questions'      => $qsOut,
        'answers'        => $att['answers']     ?? (object)[],
        'violations'     => $att['violations']  ?? (object)[],
        'remaining_sec'  => $remaining,
        'config'         => examsClientConfig($cfg),
        'score'          => (int)($att['score'] ?? 0),
        'passed'         => !empty($att['passed']),
        'auto_submitted' => !empty($att['auto_submitted']),
    ];
}

/** Public-safe view of config (no admin-only thresholds). */
function examsClientConfig(array $cfg): array {
    return [
        'one_at_a_time'      => $cfg['one_at_a_time']      ?? [],
        'tab_detection'      => $cfg['tab_detection']      ?? [],
        'watermark'          => $cfg['watermark']          ?? [],
        'fullscreen_lock'    => $cfg['fullscreen_lock']    ?? [],
        'disable_copy_paste' => $cfg['disable_copy_paste'] ?? [],
        'time_limit'         => $cfg['time_limit']         ?? [],
        'lazy_fetch'         => $cfg['lazy_fetch']         ?? [],
        'show_results'       => $cfg['show_results']       ?? [],
    ];
}

function examsScoreAttempt(array $att, array $exam, array $userAnswers): array {
    $byId = [];
    foreach ($exam['questions'] ?? [] as $q) $byId[$q['id'] ?? ''] = $q;
    $orders = (array)($att['choice_orders'] ?? []);

    $details = [];
    $correctCount = 0;
    $total = count($att['question_ids'] ?? []);
    foreach ($att['question_ids'] ?? [] as $qid) {
        $q = $byId[$qid] ?? null;
        if (!$q) {
            $details[] = ['q_id' => $qid, 'correct' => false, 'correct_answer' => null, 'explain' => ''];
            continue;
        }
        $userAns = $userAnswers[$qid] ?? null;
        // Map user's shuffled-index answer back to the original index
        $userAns = examsUnmapAnswer($q['type'] ?? 'single', $userAns, $orders[$qid] ?? []);
        $ok = examsCheckAnswer($q, $userAns);
        if ($ok) $correctCount++;
        $details[] = [
            'q_id'           => $qid,
            'correct'        => $ok,
            'user_answer'    => $userAns,
            'correct_answer' => $q['answer'] ?? null,
            'explain'        => $q['explain'] ?? '',
        ];
    }
    $percent = $total ? (int)round(($correctCount / $total) * 100) : 0;
    return [$percent, $details];
}

function examsAutoSubmit(array $att, array $exam, array $cfg): void {
    $all = examsReadJson('attempts.json');
    $finalPercent = 0;
    $passScore    = (int)($exam['pass_score'] ?? 70);
    foreach ($all as &$a) {
        if (($a['id'] ?? '') === ($att['id'] ?? '')) {
            $userAns = (array)($a['answers'] ?? []);
            [$percent, ] = examsScoreAttempt($a, $exam, $userAns);
            $a['score']          = $percent;
            $a['raw_score']      = $percent;
            $a['penalty']        = 0;
            $a['passed']         = $percent >= $passScore;
            $a['status']         = 'submitted';
            $a['submitted_at']   = date('c');
            $a['auto_submitted'] = true;
            $finalPercent        = $percent;
            break;
        }
    }
    unset($a);
    examsWriteJson('attempts.json', $all);

    // Audit log — server-driven auto-submit (timer expired)
    $startedTs   = strtotime($att['started_at'] ?? '') ?: 0;
    $durationSec = max(0, time() - $startedTs);
    examsAppendEvent($exam['id'] ?? '', [
        'type' => 'attempt_auto_submit',
        'label' => 'ระบบบังคับส่ง (หมดเวลา)',
        'attempt_id' => $att['id'] ?? '',
        'user_id' => $att['user_id'] ?? '',
        'user_name' => $att['user_name'] ?? '',
        'data' => [
            'score'        => $finalPercent,
            'passed'       => $finalPercent >= $passScore,
            'pass_score'   => $passScore,
            'duration_sec' => $durationSec,
            'reason'       => 'time_expired',
        ],
    ]);
}
