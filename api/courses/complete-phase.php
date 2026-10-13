<?php
/**
 * POST /api/courses/complete-phase.php
 *   body: { phase_id }
 *
 * Mark a phase as `passed` by user action (button click at end of last lesson).
 * Only allowed for phases that have NO quiz — quiz-bearing phases must be
 * completed via /courses/quizzes.php?action=submit.
 *
 * Enforces:
 *   - Auth (any role)
 *   - Phase exists
 *   - Course prerequisite lock not blocking
 *   - Phase lock not blocking
 *   - Phase has no quiz
 */
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/_lib.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];

if ($method !== 'POST') respondError('Method not allowed', 405);
requireCsrf();

$body = getBody();
$pid  = trim($body['phase_id'] ?? '');
if (!$pid) respondError('phase_id is required');

$cid = coursesFindCourseIdByPhase($pid);
if (!$cid) respondError('Phase not found', 404);

$phases = coursesSortPhases(coursesReadAllPhases());
$phase = null;
foreach ($phases as $p) if ($p['id'] === $pid) { $phase = $p; break; }
if (!$phase) respondError('Phase not found', 404);

$isAdmin = in_array($payload['role'], ADMIN_ROLES);

// Course prerequisite lock (non-admin)
if (!$isAdmin) {
    $allCourses = coursesReadJson('courses.json');
    $course = null;
    foreach ($allCourses as $c) if (($c['id'] ?? '') === $cid) { $course = $c; break; }
    if ($course) {
        $lock = coursesCourseLockState($payload['sub'], $course, $allCourses, $phases, coursesReadJson('progress.json'));
        if ($lock['locked']) {
            $titles = array_map(fn($u) => $u['title'], $lock['unmet']);
            respondError('Course locked — ต้องเรียน "' . implode('", "', $titles) . '" ให้จบก่อน', 403);
        }
    }
}

// Phase lock check (non-admin)
$progressAll = coursesReadJson('progress.json');
if (!$isAdmin) {
    $status = coursesPhaseStatus($payload['sub'], $phase, $phases, $progressAll);
    if ($status === 'locked') respondError('Phase is locked', 403);
}

// Guard: quiz-bearing phases must use quiz submit, not this button
$quizzes = coursesReadCourseFile($cid, 'quizzes.json');
foreach ($quizzes as $q) {
    if (($q['phase_id'] ?? '') === $pid && !empty($q['questions'])) {
        respondError('Phase มีแบบฝึกหัด — ต้องส่งคำตอบ quiz ก่อน', 400);
    }
}

// Upsert progress — mark passed
$existing = coursesGetProgress($payload['sub'], $pid);
$attempts = (int)($existing['attempts'] ?? 0) + 1;

$patch = [
    'status'       => 'passed',
    'score'        => 100,
    'last_score'   => 100,
    'attempts'     => $attempts,
    'completed_at' => date('c'),
];
coursesUpsertProgress($payload['sub'], $pid, $patch);

$courseTitle = '';
foreach (coursesReadJson('courses.json') as $c) {
    if (($c['id'] ?? '') === $cid) { $courseTitle = $c['title'] ?? ''; break; }
}

logActivity(
    'course_phase_completed_by_button',
    [
        'phase_id'     => $pid,
        'phase_title'  => $phase['title'] ?? '',
        'phase_order'  => $phase['order'] ?? null,
        'course_id'    => $cid,
        'course_title' => $courseTitle,
    ],
    $payload['sub'], $payload['name']
);

respondOk([
    'phase_id' => $pid,
    'status'   => 'passed',
    'attempts' => $attempts,
], 'จบ Phase เรียบร้อย');
