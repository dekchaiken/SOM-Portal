<?php
/**
 * GET    /api/courses/quizzes.php?phase_id=...  → get quiz for a phase
 *                                                  (user: no 'answer' field revealed unless passed)
 * POST   /api/courses/quizzes.php               → create/update quiz for a phase (admin)
 * DELETE /api/courses/quizzes.php?id=...        → delete quiz (admin)
 *
 * POST   /api/courses/quizzes.php?action=submit → submit answers, score, update progress
 *         body: { phase_id, answers: { q_id: value, ... } }
 */
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/_lib.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];
$id      = $_GET['id'] ?? '';
$phaseId = $_GET['phase_id'] ?? '';
$action  = $_GET['action'] ?? '';

if ($method === 'GET') {
    if ($phaseId) {
        $cid = coursesFindCourseIdByPhase($phaseId);
        if (!$cid) respondError('Phase not found', 404);

        $quizzes = coursesReadCourseFile($cid, 'quizzes.json');
        $quiz = null;
        foreach ($quizzes as $q) {
            if (($q['phase_id'] ?? '') === $phaseId) { $quiz = $q; break; }
        }
        if (!$quiz) respondError('Quiz not found', 404);

        // Enforce phase lock + course prereq lock for non-admins, hide 'answer' field
        $isAdmin = in_array($payload['role'], ADMIN_ROLES);
        if (!$isAdmin) {
            $phases     = coursesSortPhases(coursesReadAllPhases());
            $progress   = coursesReadJson('progress.json');
            $allCourses = coursesReadJson('courses.json');
            $phase = null;
            foreach ($phases as $p) if ($p['id'] === $phaseId) { $phase = $p; break; }
            if (!$phase) respondError('Phase not found', 404);

            $course = null;
            foreach ($allCourses as $c) if (($c['id'] ?? '') === $cid) { $course = $c; break; }
            if ($course) {
                $lock = coursesCourseLockState($payload['sub'], $course, $allCourses, $phases, $progress);
                if ($lock['locked']) {
                    $titles = array_map(fn($u) => $u['title'], $lock['unmet']);
                    respondError('Course locked — ต้องเรียน "' . implode('", "', $titles) . '" ให้จบก่อน', 403);
                }
            }

            $status = coursesPhaseStatus($payload['sub'], $phase, $phases, $progress);
            if ($status === 'locked') respondError('Phase is locked', 403);

            // Strip answers from questions
            $sanitized = $quiz;
            $sanitized['questions'] = array_map(function ($q) {
                unset($q['answer']);
                unset($q['explain']);
                unset($q['match_mode']);
                unset($q['case_sensitive']);
                return $q;
            }, $quiz['questions'] ?? []);
            respondOk($sanitized);
        }
        respondOk($quiz);
    }
    respondOk(coursesReadAllQuizzes());
}

// Submit quiz answers (authenticated users)
if ($method === 'POST' && $action === 'submit') {
    requireCsrf();
    $body = getBody();
    $pid  = trim($body['phase_id'] ?? '');
    $answers = $body['answers'] ?? [];
    if (!$pid) respondError('phase_id is required');
    if (!is_array($answers)) respondError('answers must be an object');

    // Find quiz + phase
    $cid = coursesFindCourseIdByPhase($pid);
    if (!$cid) respondError('Phase not found', 404);

    $quizzes = coursesReadCourseFile($cid, 'quizzes.json');
    $quiz = null;
    foreach ($quizzes as $q) {
        if (($q['phase_id'] ?? '') === $pid) { $quiz = $q; break; }
    }
    if (!$quiz) respondError('Quiz not found for this phase', 404);

    $phases = coursesSortPhases(coursesReadAllPhases());
    $phase = null;
    foreach ($phases as $p) if ($p['id'] === $pid) { $phase = $p; break; }
    if (!$phase) respondError('Phase not found', 404);

    // Ensure course prerequisite not blocking (non-admins)
    $isAdmin = in_array($payload['role'], ADMIN_ROLES);
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

    // Ensure phase is unlocked for this user
    $progressAll = coursesReadJson('progress.json');
    $status = coursesPhaseStatus($payload['sub'], $phase, $phases, $progressAll);
    if ($status === 'locked') respondError('Phase is locked', 403);

    // Score
    [$percent, $details] = coursesScoreQuiz($quiz['questions'] ?? [], $answers);
    $passScore = (int)($phase['pass_score'] ?? 70);
    $passed = $percent >= $passScore;

    $existing = coursesGetProgress($payload['sub'], $pid);
    $attempts = (int)($existing['attempts'] ?? 0) + 1;
    $bestScore = max((int)($existing['score'] ?? 0), $percent);

    $patch = [
        'score'    => $bestScore,
        'attempts' => $attempts,
        'last_score' => $percent,
    ];
    if ($passed) {
        $patch['status'] = 'passed';
        $patch['completed_at'] = date('c');
    } else {
        $patch['status'] = 'in_progress';
    }
    coursesUpsertProgress($payload['sub'], $pid, $patch);

    // Resolve course title for richer activity log
    $courseTitle = '';
    foreach (coursesReadJson('courses.json') as $c) {
        if (($c['id'] ?? '') === $cid) { $courseTitle = $c['title'] ?? ''; break; }
    }

    logActivity(
        $passed ? 'course_phase_passed' : 'course_phase_attempt',
        [
            'phase_id'     => $pid,
            'phase_title'  => $phase['title'] ?? '',
            'phase_order'  => $phase['order'] ?? null,
            'course_id'    => $cid,
            'course_title' => $courseTitle,
            'score'        => $percent,
            'attempts'     => $attempts,
        ],
        $payload['sub'], $payload['name']
    );

    // Do NOT reveal correct answers — only return correctness flag per question
    // (so user must re-think on retry rather than copying the answer key)
    $correctCount = 0;
    $safeDetails = array_map(function ($d) use (&$correctCount) {
        if (!empty($d['correct'])) $correctCount++;
        return [
            'q_id'    => $d['q_id'] ?? '',
            'correct' => !empty($d['correct']),
        ];
    }, $details);

    respondOk([
        'score'         => $percent,
        'best_score'    => $bestScore,
        'pass_score'    => $passScore,
        'passed'        => $passed,
        'attempts'      => $attempts,
        'correct_count' => $correctCount,
        'total_count'   => count($details),
        'summary'       => $safeDetails,
    ], $passed ? 'Passed!' : 'Not yet — try again');
}

// Admin-only mutations
requireRole($payload, ADMIN_ROLES);

if ($method === 'POST') {
    requireCsrf();
    $body = getBody();
    $pid   = trim($body['phase_id'] ?? '');
    $title = trim($body['title'] ?? 'Quiz');
    $questions = $body['questions'] ?? [];
    if (!$pid) respondError('phase_id is required');
    if (!is_array($questions)) respondError('questions must be an array');

    $cid = coursesFindCourseIdByPhase($pid);
    if (!$cid) respondError('Phase not found', 404);

    // Admin quiz save — block if this cid is a shared course and caller isn't
    // the owning team. User quiz submission (?action=submit above) doesn't
    // pass through this check, so cross-team users can still attempt.
    coursesRequireOwnerForShared($cid, $payload);

    $quizzes = coursesReadCourseFile($cid, 'quizzes.json');

    // One quiz per phase — replace if exists
    $replaced = false;
    foreach ($quizzes as &$q) {
        if (($q['phase_id'] ?? '') === $pid) {
            $q['title']       = $title;
            $q['description'] = trim($body['description'] ?? '');
            $q['questions']   = $questions;
            $q['updated_at']  = date('c');
            $replaced = true;
            $saved = $q;
            break;
        }
    }
    unset($q);
    if (!$replaced) {
        $saved = [
            'id'          => genId('quiz'),
            'phase_id'    => $pid,
            'title'       => $title,
            'description' => trim($body['description'] ?? ''),
            'questions'   => $questions,
            'created_at'  => date('c'),
        ];
        $quizzes[] = $saved;
    }
    coursesWriteCourseFile($cid, 'quizzes.json', $quizzes);
    logActivity('course_quiz_save', ['phase_id' => $pid, 'count' => count($questions)], $payload['sub'], $payload['name']);
    respondOk($saved, 'Quiz saved');
}

if ($method === 'DELETE') {
    requireCsrf();
    if (!$id) respondError('Quiz ID required');

    // Locate first (across local + shared), guard, then write — order matters
    // so a non-owner request doesn't get the delete through before the 403.
    $foundCid = null;
    $originalRows = [];
    foreach (_coursesReachableIds() as $cidScan) {
        $rows = coursesReadCourseFile($cidScan, 'quizzes.json');
        foreach ($rows as $r) {
            if (($r['id'] ?? '') === $id) { $foundCid = $cidScan; $originalRows = $rows; break 2; }
        }
    }
    if (!$foundCid) respondError('Quiz not found', 404);

    coursesRequireOwnerForShared($foundCid, $payload);

    $filtered = array_values(array_filter($originalRows, fn($q) => $q['id'] !== $id));
    coursesWriteCourseFile($foundCid, 'quizzes.json', $filtered);
    logActivity('course_quiz_delete', ['id' => $id], $payload['sub'], $payload['name']);
    respondOk(null, 'Quiz deleted');
}

respondError('Method not allowed', 405);
