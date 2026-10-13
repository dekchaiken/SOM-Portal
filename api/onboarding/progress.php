<?php
/**
 * GET  /api/onboarding/progress.php                     → my progress (full)
 * POST /api/onboarding/progress.php?action=toggle_task  → toggle a task { chapter_id, task_id }
 * POST /api/onboarding/progress.php?action=notebook     → save notebook { chapter_id, text }
 * POST /api/onboarding/progress.php?action=quiz         → save quiz answer { chapter_id, question_id, text }
 * POST /api/onboarding/progress.php?action=finish       → mark whole onboarding finished
 * POST /api/onboarding/progress.php?action=unfinish     → (debug) mark unfinished
 */
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/_lib.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];
$action  = $_GET['action'] ?? '';
$uid     = $payload['sub'];

$config   = onboardingGetConfig();
$chapters = $config['chapters'] ?? [];

function buildSummary(array $chapters, array $progress): array {
    $completed   = onboardingNormalizeCompletedTasks($progress['completed_tasks'] ?? []);
    $notebook    = onboardingNormalizeNotebook($progress['notebook'] ?? []);
    $quizzes     = onboardingNormalizeQuizzes($progress['quizzes'] ?? []);
    $examResults = onboardingNormalizeExamResults($progress['exam_results'] ?? []);
    $total     = onboardingTotalTasks($chapters);
    $done      = onboardingDoneTasks($chapters, $completed);
    $percent   = $total ? (int)round($done / $total * 100) : 0;
    $unlock    = onboardingUnlockMap($chapters, $completed, $quizzes, $examResults);
    $all       = onboardingIsAllDone($chapters, $completed, $quizzes, $examResults);

    $chapterState = [];
    foreach ($chapters as $ch) {
        $chId = $ch['id'];
        $chAnswers = $quizzes[$chId] ?? [];
        $quizBlocks = array_filter($ch['blocks'] ?? [], fn($b) => ($b['type'] ?? '') === 'quiz');
        $quizTotal = 0; $quizDone = 0;
        foreach ($quizBlocks as $qb) {
            $bid = $qb['id'] ?? '';
            foreach ($qb['questions'] ?? [] as $q) {
                $quizTotal++;
                $val = $chAnswers[$bid . '::' . $q['id']] ?? $chAnswers[$q['id']] ?? '';
                if (!empty(trim($val))) $quizDone++;
            }
        }
        $entry = [
            'id'          => $chId,
            'order'       => $ch['order'] ?? 0,
            'title'       => $ch['title'] ?? '',
            'label'       => $ch['label'] ?? '',
            'unlocked'    => $unlock[$chId] ?? false,
            'completed'   => onboardingIsChapterDone($ch, $completed, $quizzes, $examResults),
            'task_count'  => count($ch['tasks'] ?? []),
            'done_count'  => count(array_intersect(
                array_column($ch['tasks'] ?? [], 'id'),
                $completed[$chId] ?? []
            )),
            'quiz_total'  => $quizTotal,
            'quiz_done'   => $quizDone,
        ];
        if (onboardingHasScoredQuiz($ch)) {
            $er = $examResults[$chId] ?? null;
            $entry['exam_result'] = $er ? [
                'attempts'        => $er['attempts'],
                'best_score'      => $er['best_score'],
                'last_score'      => $er['last_score'],
                'passed'          => $er['passed'],
                'last_attempt_at' => $er['last_attempt_at'],
            ] : null;
        }
        $chapterState[] = $entry;
    }

    return [
        'user_id'         => $progress['user_id'] ?? '',
        'completed_tasks' => (object)$completed,
        'notebook'        => (object)$notebook,
        'quizzes'         => (object)$quizzes,
        'exam_results'    => (object)array_map(fn($v) => (object)$v, $examResults),
        'finished_at'     => $progress['finished_at'] ?? null,
        'updated_at'      => $progress['updated_at']  ?? null,
        'total_tasks'     => $total,
        'done_tasks'      => $done,
        'percent'         => $percent,
        'all_done'        => $all,
        'chapter_state'   => $chapterState,
    ];
}

if ($method === 'GET') {
    $prog = onboardingGetProgress($uid);
    respondOk(buildSummary($chapters, $prog));
}

if ($method !== 'POST') respondError('Method not allowed', 405);

requireCsrf();
$body = getBody();

$prog        = onboardingGetProgress($uid);
$completed   = onboardingNormalizeCompletedTasks($prog['completed_tasks'] ?? []);
$notebook    = onboardingNormalizeNotebook($prog['notebook'] ?? []);
$quizzes     = onboardingNormalizeQuizzes($prog['quizzes'] ?? []);
$examResults = onboardingNormalizeExamResults($prog['exam_results'] ?? []);

if ($action === 'toggle_task') {
    $chId = trim($body['chapter_id'] ?? '');
    $tId  = trim($body['task_id']    ?? '');
    if (!$chId || !$tId) respondError('chapter_id and task_id required');

    // Validate that chapter/task exist
    $chapter = null;
    foreach ($chapters as $ch) if ($ch['id'] === $chId) { $chapter = $ch; break; }
    if (!$chapter) respondError('Chapter not found', 404);
    $validTasks = array_column($chapter['tasks'] ?? [], 'id');
    if (!in_array($tId, $validTasks, true)) respondError('Task not found', 404);

    $mine = $completed[$chId] ?? [];
    if (in_array($tId, $mine, true)) {
        $mine = array_values(array_filter($mine, fn($x) => $x !== $tId));
    } else {
        $mine[] = $tId;
    }
    $completed[$chId] = array_values(array_unique($mine));

    $patch = ['completed_tasks' => (object)$completed];
    // If all tasks done AND all quizzes answered AND exam passed → mark finished (idempotent)
    if (onboardingIsAllDone($chapters, $completed, $quizzes, $examResults) && empty($prog['finished_at'])) {
        $patch['finished_at'] = date('c');
        logActivity('onboarding_finish', [], $uid, $payload['name']);
    }
    // If any task unchecked after finish → do NOT un-finish (finished_at stays)

    $prog = onboardingUpsertProgress($uid, $patch);
    respondOk(buildSummary($chapters, $prog));
}

if ($action === 'notebook') {
    $chId = trim($body['chapter_id'] ?? '');
    $text = (string)($body['text'] ?? '');
    if (!$chId) respondError('chapter_id required');
    // Cap notebook size to prevent abuse (32KB per chapter)
    if (strlen($text) > 32768) respondError('Notebook too large (max 32KB)', 413);

    $notebook[$chId] = $text;
    $prog = onboardingUpsertProgress($uid, ['notebook' => (object)$notebook]);
    respondOk(buildSummary($chapters, $prog));
}

if ($action === 'quiz') {
    $chId  = trim($body['chapter_id']  ?? '');
    $qId   = trim($body['question_id'] ?? '');
    $text  = (string)($body['text'] ?? '');
    if (!$chId || !$qId) respondError('chapter_id and question_id required');
    if (strlen($text) > 8192) respondError('Answer too large (max 8KB)', 413);

    // Defensive: if a stale browser POSTs the legacy plain question_id (no "::"),
    // look up the first quiz block in this chapter that owns this question id and
    // promote to the composite "blockId::qId" key. Prevents cross-block collision.
    if (strpos($qId, '::') === false) {
        $chapterCfg = null;
        foreach ($chapters as $c) {
            if (($c['id'] ?? '') === $chId) { $chapterCfg = $c; break; }
        }
        if ($chapterCfg) {
            foreach ($chapterCfg['blocks'] ?? [] as $block) {
                if (($block['type'] ?? '') !== 'quiz') continue;
                foreach ($block['questions'] ?? [] as $q) {
                    if (($q['id'] ?? '') === $qId && !empty($block['id'])) {
                        $qId = $block['id'] . '::' . $qId;
                        break 2;
                    }
                }
            }
        }
    }

    if (!isset($quizzes[$chId]) || !is_array($quizzes[$chId])) $quizzes[$chId] = [];
    $quizzes[$chId][$qId] = $text;
    $prog = onboardingUpsertProgress($uid, ['quizzes' => (object)array_map(fn($v) => (object)$v, $quizzes)]);
    respondOk(buildSummary($chapters, $prog));
}

if ($action === 'exam_submit') {
    $chId    = trim($body['chapter_id'] ?? '');
    $answers = $body['answers'] ?? [];
    if (!$chId || !is_array($answers)) respondError('chapter_id and answers required');

    // Find the chapter + its scored_quiz blocks
    $chapter = null;
    foreach ($chapters as $ch) if ($ch['id'] === $chId) { $chapter = $ch; break; }
    if (!$chapter) respondError('Chapter not found', 404);
    if (!onboardingHasScoredQuiz($chapter)) respondError('Chapter has no scored_quiz', 400);

    // Reload full config (with correct_choice_id) for scoring
    $fullConfig = onboardingGetConfig();
    $fullChapter = null;
    foreach ($fullConfig['chapters'] as $ch) if ($ch['id'] === $chId) { $fullChapter = $ch; break; }

    $totalQ = 0; $correctQ = 0;
    $passScore = 80;
    $questionResults = [];
    foreach ($fullChapter['blocks'] ?? [] as $block) {
        if (($block['type'] ?? '') !== 'scored_quiz') continue;
        if (isset($block['pass_score'])) $passScore = (int)$block['pass_score'];
        foreach ($block['questions'] ?? [] as $q) {
            $qId = $q['id'];
            $totalQ++;
            $submitted = trim((string)($answers[$qId] ?? ''));
            $isCorrect = ($submitted === ($q['correct_choice_id'] ?? ''));
            if ($isCorrect) $correctQ++;
            $questionResults[$qId] = [
                'submitted'    => $submitted,
                'correct'      => $isCorrect,
                'correct_id'   => $q['correct_choice_id'] ?? '',
                'explain'      => $q['explain'] ?? '',
            ];
        }
    }
    $score = $totalQ > 0 ? round($correctQ / $totalQ * 100) : 0;
    $passed = $score >= $passScore;

    // Update exam_results
    $prev = $examResults[$chId] ?? ['attempts' => 0, 'best_score' => 0, 'history' => []];
    $history = $prev['history'] ?? [];
    $history[] = ['score' => $score, 'correct' => $correctQ, 'total' => $totalQ, 'at' => date('c')];
    $examResults[$chId] = [
        'attempts'        => ($prev['attempts'] ?? 0) + 1,
        'best_score'      => max($prev['best_score'] ?? 0, $score),
        'last_score'      => $score,
        'passed'          => $passed || ($prev['passed'] ?? false),
        'last_attempt_at' => date('c'),
        'history'         => $history,
    ];

    $patch = ['exam_results' => (object)array_map(fn($v) => (object)$v, $examResults)];
    if (onboardingIsAllDone($chapters, $completed, $quizzes, $examResults) && empty($prog['finished_at'])) {
        $patch['finished_at'] = date('c');
        logActivity('onboarding_finish', [], $uid, $payload['name']);
    }
    $prog = onboardingUpsertProgress($uid, $patch);
    logActivity('onboarding_exam_submit', ['chapter' => $chId, 'score' => $score, 'passed' => $passed], $uid, $payload['name']);
    respondOk(array_merge(buildSummary($chapters, $prog), [
        'exam_score'       => $score,
        'exam_correct'     => $correctQ,
        'exam_total'       => $totalQ,
        'exam_pass_score'  => $passScore,
        'exam_passed'      => $passed,
        'question_results' => (object)$questionResults,
    ]));
}

if ($action === 'finish') {
    if (!onboardingIsAllDone($chapters, $completed, $quizzes, $examResults)) {
        respondError('ยังทำ task ไม่ครบทุกบท', 400);
    }
    $patch = ['finished_at' => $prog['finished_at'] ?: date('c')];
    $prog = onboardingUpsertProgress($uid, $patch);
    logActivity('onboarding_finish', [], $uid, $payload['name']);
    respondOk(buildSummary($chapters, $prog));
}

if ($action === 'unfinish') {
    // Self-reset (for debugging); admin reset lives in admin.php
    $prog = onboardingUpsertProgress($uid, ['finished_at' => null]);
    respondOk(buildSummary($chapters, $prog));
}

respondError('Unknown action', 400);
