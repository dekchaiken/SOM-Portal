<?php
/**
 * GET  /api/onboarding/admin.php                      → list all users + their onboarding progress
 * GET  /api/onboarding/admin.php?user_id=             → one user's quiz answers (not notebook)
 * POST /api/onboarding/admin.php?action=reset&user_id → reset one user's progress
 *
 * Notebook is NEVER returned — privacy by design.
 * Quiz answers ARE returned — they are explicitly submitted for admin review.
 */
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/_lib.php';

$payload = requireAuth();
requireRole($payload, ADMIN_ROLES);
$method  = $_SERVER['REQUEST_METHOD'];

$config   = onboardingGetConfig();
$chapters = $config['chapters'] ?? [];

if ($method === 'GET') {
    // ── Single user detail (quiz answers) ────────────────────────────
    $userIdQ = trim($_GET['user_id'] ?? '');
    if ($userIdQ) {
        $rows  = onboardingReadJson('progress.json');
        if (!is_array($rows)) $rows = [];
        $prog  = null;
        foreach ($rows as $r) if (($r['user_id'] ?? '') === $userIdQ) { $prog = $r; break; }
        if (!$prog) respondOk(['user_id' => $userIdQ, 'quizzes' => (object)[], 'completed_tasks' => (object)[]]);

        $completed   = onboardingNormalizeCompletedTasks($prog['completed_tasks'] ?? []);
        $quizzes     = onboardingNormalizeQuizzes($prog['quizzes'] ?? []);
        $examResults = onboardingNormalizeExamResults($prog['exam_results'] ?? []);

        $chapterDetail = [];
        foreach ($chapters as $ch) {
            $chId  = $ch['id'];
            $qAns  = $quizzes[$chId] ?? [];
            $qBlocks = array_filter($ch['blocks'] ?? [], fn($b) => ($b['type'] ?? '') === 'quiz');
            $questions = [];
            foreach ($qBlocks as $qb) {
                $bid = $qb['id'] ?? '';
                foreach ($qb['questions'] ?? [] as $q) {
                    // Composite key per block; fall back to plain id for legacy data
                    $answer = $qAns[$bid . '::' . $q['id']] ?? $qAns[$q['id']] ?? '';
                    $questions[] = [
                        'id'     => $q['id'],
                        'text'   => $q['text'],
                        'answer' => $answer,
                    ];
                }
            }
            $examResult = null;
        if (onboardingHasScoredQuiz($ch)) {
            $er = $examResults[$chId] ?? null;
            if ($er) $examResult = [
                'attempts'        => $er['attempts'],
                'best_score'      => $er['best_score'],
                'last_score'      => $er['last_score'],
                'passed'          => $er['passed'],
                'last_attempt_at' => $er['last_attempt_at'],
                'history'         => $er['history'] ?? [],
            ];
        }
        $chapterDetail[] = [
                'id'          => $chId,
                'title'       => $ch['title'] ?? '',
                'questions'   => $questions,
                'done_count'  => count(array_intersect(
                    array_column($ch['tasks'] ?? [], 'id'),
                    $completed[$chId] ?? []
                )),
                'task_count'  => count($ch['tasks'] ?? []),
                'exam_result' => $examResult,
            ];
        }

        respondOk([
            'user_id'  => $userIdQ,
            'quizzes'  => (object)$quizzes,
            'chapters' => $chapterDetail,
        ]);
    }

    $users = readJson('users.json');
    $rows  = onboardingReadJson('progress.json');
    if (!is_array($rows)) $rows = [];

    $byUser = [];
    foreach ($rows as $r) $byUser[$r['user_id'] ?? ''] = $r;

    $totalTasks = onboardingTotalTasks($chapters);
    $out        = [];
    $finishedCount = 0;
    $inProgressCount = 0;
    $notStartedCount = 0;

    foreach ($users as $u) {
        $uid  = $u['id'];
        $prog = $byUser[$uid] ?? null;
        $completed    = $prog ? onboardingNormalizeCompletedTasks($prog['completed_tasks'] ?? []) : [];
        $quizzesU     = $prog ? onboardingNormalizeQuizzes($prog['quizzes'] ?? []) : [];
        $examResultsU = $prog ? onboardingNormalizeExamResults($prog['exam_results'] ?? []) : [];
        $done = onboardingDoneTasks($chapters, $completed);
        $percent = $totalTasks ? (int)round($done / $totalTasks * 100) : 0;
        $finishedAt = $prog['finished_at'] ?? null;

        $bucket = $finishedAt ? 'finished' : ($done > 0 ? 'in_progress' : 'not_started');
        if ($bucket === 'finished')   $finishedCount++;
        if ($bucket === 'in_progress') $inProgressCount++;
        if ($bucket === 'not_started') $notStartedCount++;

        // Per-chapter progress (no notebook)
        $chState = [];
        foreach ($chapters as $ch) {
            $entry = [
                'id'          => $ch['id'],
                'title'       => $ch['title'] ?? '',
                'task_count'  => count($ch['tasks'] ?? []),
                'done_count'  => count(array_intersect(
                    array_column($ch['tasks'] ?? [], 'id'),
                    $completed[$ch['id']] ?? []
                )),
                'completed'   => onboardingIsChapterDone($ch, $completed, $quizzesU, $examResultsU),
            ];
            if (onboardingHasScoredQuiz($ch)) {
                $er = $examResultsU[$ch['id']] ?? null;
                $entry['exam_result'] = $er ? [
                    'attempts'   => $er['attempts'],
                    'best_score' => $er['best_score'],
                    'passed'     => $er['passed'],
                ] : null;
            }
            $chState[] = $entry;
        }

        $out[] = [
            'user_id'      => $uid,
            'name'         => $u['name']     ?? '',
            'username'     => $u['username'] ?? '',
            'email'        => $u['email']    ?? '',
            'role'         => $u['role']     ?? '',
            'percent'      => $percent,
            'done_tasks'   => $done,
            'total_tasks'  => $totalTasks,
            'finished_at'  => $finishedAt,
            'updated_at'   => $prog['updated_at'] ?? null,
            'status'       => $bucket,
            'chapters'     => $chState,
        ];
    }

    respondOk([
        'stats' => [
            'total_users'  => count($users),
            'finished'     => $finishedCount,
            'in_progress'  => $inProgressCount,
            'not_started'  => $notStartedCount,
            'total_tasks'  => $totalTasks,
        ],
        'users' => $out,
    ]);
}

if ($method === 'POST') {
    requireCsrf();
    $action  = $_GET['action'] ?? '';
    $userQ   = trim($_GET['user_id'] ?? '');

    if ($action === 'reset') {
        if (!$userQ) respondError('user_id required');
        $all = onboardingReadJson('progress.json') ?: [];
        $filtered = array_values(array_filter($all, fn($r) => ($r['user_id'] ?? '') !== $userQ));
        onboardingWriteJson('progress.json', $filtered);
        logActivity('onboarding_admin_reset', ['target_user' => $userQ], $payload['sub'], $payload['name']);
        respondOk(null, 'Reset done');
    }

    respondError('Unknown action', 400);
}

respondError('Method not allowed', 405);
