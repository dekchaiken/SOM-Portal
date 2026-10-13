<?php
/**
 * Exam report aggregator — admin only.
 *
 * GET /api/exams/report.php?exam_id=...
 *   → {
 *       exam: { id, title, pass_score, questions_count },
 *       overview: { total_attempts, submitted, in_progress, unique_users,
 *                   passed, failed, pass_rate, avg_score, median_score,
 *                   min_score, max_score, avg_duration_sec, total_violations,
 *                   first_attempt_at, last_attempt_at },
 *       distribution: [ { bucket, label, count } ... 5 buckets ],
 *       timeline: [ { date, count } ... last 30 days ],
 *       leaderboard: [ { user_id, user_name, attempts, best_score, latest_score,
 *                       best_passed, total_duration_sec, last_attempted_at, status,
 *                       violations_total } ],
 *       questions: [ { id, prompt, category, type, asked, correct, correct_rate } ]
 *     }
 */

require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/_lib.php';

$payload = requireAuth();
requireRole($payload, REPORT_READ_ROLES);

$examId = trim($_GET['exam_id'] ?? '');
if (!$examId) respondError('exam_id required', 400);

$currentTeamCtx = $GLOBALS['_current_team'] ?? null;
// Aggregate across every active team when a global-read role selected
// "All Teams" — same pattern as courses/progress.php + exams/exams.php list.
$aggregateAll = $currentTeamCtx === null
             && in_array($payload['role'] ?? '', GLOBAL_READ_ROLES, true);

// Resolve the exam. In All-Teams mode a team-local exam won't be found via
// examsGet() (current ctx is null → no exams.json read), so iterate teams
// until we find it. Shared exams are found on the first try via the shared
// catalog inside examsGet().
$exam = examsGet($examId);
if (!$exam && $aggregateAll) {
    $prevTeam = $GLOBALS['_current_team'];
    foreach (readJson('teams.json') as $t) {
        if (empty($t['active']) || empty($t['slug'])) continue;
        $GLOBALS['_current_team'] = $t['slug'];
        $exam = examsGet($examId);
        if ($exam) break;
    }
    $GLOBALS['_current_team'] = $prevTeam;
}
if (!$exam) respondError('Exam not found', 404);

$passScore = (int)($exam['pass_score'] ?? 70);
$questions = $exam['questions'] ?? [];

// Index questions by id for fast lookup
$qById = [];
foreach ($questions as $q) {
    $qid = $q['id'] ?? '';
    if (!$qid) continue;
    $qById[$qid] = $q;
}

// ─── Pull all attempts for this exam ────────────────────────────
// In All-Teams mode collect from every team's attempts.json (each attempt
// is annotated with _team so the leaderboard can badge who's from where).
$attempts = [];
if ($aggregateAll) {
    $prevTeam = $GLOBALS['_current_team'];
    foreach (readJson('teams.json') as $t) {
        if (empty($t['active']) || empty($t['slug'])) continue;
        $GLOBALS['_current_team'] = $t['slug'];
        foreach (examsReadJson('attempts.json') as $a) {
            if (($a['exam_id'] ?? '') !== $examId) continue;
            $a['_team'] = $t['slug'];
            $attempts[] = $a;
        }
    }
    $GLOBALS['_current_team'] = $prevTeam;
} else {
    foreach (examsReadJson('attempts.json') as $a) {
        if (($a['exam_id'] ?? '') !== $examId) continue;
        $attempts[] = $a;
    }
}

$submitted = array_values(array_filter($attempts, fn($a) => ($a['status'] ?? '') === 'submitted'));
$inProgress = array_values(array_filter($attempts, fn($a) => ($a['status'] ?? '') === 'in_progress'));

// ─── Overview metrics ───────────────────────────────────────────
$scores = array_map(fn($a) => (int)($a['score'] ?? 0), $submitted);
sort($scores);
$avgScore = $scores ? round(array_sum($scores) / count($scores), 1) : 0;
$medianScore = 0;
if ($scores) {
    $n = count($scores);
    $medianScore = $n % 2
        ? $scores[(int)floor($n/2)]
        : round(($scores[$n/2 - 1] + $scores[$n/2]) / 2, 1);
}
$minScore = $scores ? $scores[0] : 0;
$maxScore = $scores ? $scores[count($scores) - 1] : 0;
$passed = count(array_filter($submitted, fn($a) => !empty($a['passed'])));
$failed = count($submitted) - $passed;
$passRate = count($submitted) ? round($passed / count($submitted) * 100, 1) : 0;

// Unique participants
$uniqueUserIds = [];
foreach ($attempts as $a) {
    $uid = $a['user_id'] ?? '';
    if ($uid) $uniqueUserIds[$uid] = true;
}

// Average duration (from submitted)
$durations = [];
foreach ($submitted as $a) {
    $s = strtotime($a['started_at']   ?? '');
    $e = strtotime($a['submitted_at'] ?? '');
    if ($s && $e && $e > $s) $durations[] = $e - $s;
}
$avgDuration = $durations ? (int)round(array_sum($durations) / count($durations)) : 0;

// Total violations across all attempts
$totalViolations = 0;
foreach ($attempts as $a) {
    foreach (($a['violations'] ?? []) as $_k => $n) $totalViolations += (int)$n;
}

// First / last activity
$tsList = [];
foreach ($attempts as $a) {
    $t = strtotime($a['started_at'] ?? '');
    if ($t) $tsList[] = $t;
}
$firstAt = $tsList ? min($tsList) : 0;
$lastAt  = $tsList ? max($tsList) : 0;

$overview = [
    'total_attempts'    => count($attempts),
    'submitted'         => count($submitted),
    'in_progress'       => count($inProgress),
    'unique_users'      => count($uniqueUserIds),
    'passed'            => $passed,
    'failed'            => $failed,
    'pass_rate'         => $passRate,
    'avg_score'         => $avgScore,
    'median_score'      => $medianScore,
    'min_score'         => $minScore,
    'max_score'         => $maxScore,
    'avg_duration_sec'  => $avgDuration,
    'total_violations'  => $totalViolations,
    'first_attempt_at'  => $firstAt ? date('c', $firstAt) : null,
    'last_attempt_at'   => $lastAt  ? date('c', $lastAt)  : null,
];

// ─── Score distribution (5 buckets) ─────────────────────────────
$buckets = [
    ['min' => 0,  'max' => 19,  'label' => '0–19%'],
    ['min' => 20, 'max' => 39,  'label' => '20–39%'],
    ['min' => 40, 'max' => 59,  'label' => '40–59%'],
    ['min' => 60, 'max' => 79,  'label' => '60–79%'],
    ['min' => 80, 'max' => 100, 'label' => '80–100%'],
];
$distribution = [];
foreach ($buckets as $i => $b) {
    $cnt = 0;
    foreach ($submitted as $a) {
        $s = (int)($a['score'] ?? 0);
        if ($s >= $b['min'] && $s <= $b['max']) $cnt++;
    }
    $distribution[] = [
        'bucket' => $i,
        'label'  => $b['label'],
        'count'  => $cnt,
    ];
}

// ─── Timeline (last 30 days, by date) ───────────────────────────
$timeline = [];
$today = strtotime(date('Y-m-d'));
for ($i = 29; $i >= 0; $i--) {
    $d = date('Y-m-d', $today - $i * 86400);
    $timeline[$d] = 0;
}
foreach ($submitted as $a) {
    $t = strtotime($a['submitted_at'] ?? '');
    if (!$t) continue;
    $d = date('Y-m-d', $t);
    if (isset($timeline[$d])) $timeline[$d]++;
}
$timelineRows = [];
foreach ($timeline as $d => $c) {
    $timelineRows[] = ['date' => $d, 'count' => $c];
}

// ─── Per-user leaderboard ───────────────────────────────────────
// Pre-index users.json for team + avatar lookup (leaderboard rows carry a
// team badge + profile image so oversight can see who each attempt belongs
// to at a glance).
$userMetaById = [];
foreach (readJson('users.json') as $u) {
    if (empty($u['id'])) continue;
    $userMetaById[$u['id']] = [
        'team'       => $u['team']       ?? '',
        'avatar_url' => $u['avatar_url'] ?? null,
    ];
}
$byUser = [];
foreach ($attempts as $a) {
    $uid = $a['user_id'] ?? '';
    if (!$uid) continue;
    if (!isset($byUser[$uid])) {
        $meta = $userMetaById[$uid] ?? [];
        $byUser[$uid] = [
            'user_id'           => $uid,
            'user_name'         => $a['user_name'] ?? $uid,
            'team'              => $a['_team'] ?? ($meta['team'] ?? ''),
            'avatar_url'        => $meta['avatar_url'] ?? null,
            'attempts'          => 0,
            'submitted_count'   => 0,
            'best_score'        => null,
            'latest_score'      => null,
            'best_passed'       => false,
            'total_duration_sec'=> 0,
            'last_attempted_at' => null,
            'has_in_progress'   => false,
            'violations_total'  => 0,
            '_latest_ts'        => 0,
        ];
    }
    $u = &$byUser[$uid];
    $u['attempts']++;
    if (($a['user_name'] ?? '') !== '') $u['user_name'] = $a['user_name'];
    foreach (($a['violations'] ?? []) as $_k => $n) $u['violations_total'] += (int)$n;

    $startTs = strtotime($a['started_at'] ?? '');
    if ($startTs && $startTs > $u['_latest_ts']) {
        $u['_latest_ts'] = $startTs;
        $u['last_attempted_at'] = date('c', $startTs);
    }

    if (($a['status'] ?? '') === 'in_progress') {
        $u['has_in_progress'] = true;
        continue;
    }
    if (($a['status'] ?? '') === 'submitted') {
        $u['submitted_count']++;
        $score = (int)($a['score'] ?? 0);
        if ($u['best_score'] === null || $score > $u['best_score']) {
            $u['best_score']  = $score;
            $u['best_passed'] = !empty($a['passed']);
        }
        // latest_score = score of the most recent submitted attempt
        $subTs = strtotime($a['submitted_at'] ?? '');
        if ($subTs) {
            if (!isset($u['_latest_submit_ts']) || $subTs >= $u['_latest_submit_ts']) {
                $u['_latest_submit_ts'] = $subTs;
                $u['latest_score']      = $score;
            }
        }
        $s = strtotime($a['started_at']   ?? '');
        $e = strtotime($a['submitted_at'] ?? '');
        if ($s && $e && $e > $s) $u['total_duration_sec'] += ($e - $s);
    }
    unset($u);
}

$leaderboard = [];
foreach ($byUser as $u) {
    unset($u['_latest_ts']);
    if (isset($u['_latest_submit_ts'])) unset($u['_latest_submit_ts']);
    // Status: passed > failed > in_progress > never
    if ($u['best_passed']) $u['status'] = 'passed';
    elseif ($u['submitted_count'] > 0) $u['status'] = 'failed';
    elseif ($u['has_in_progress']) $u['status'] = 'in_progress';
    else $u['status'] = 'never';
    $leaderboard[] = $u;
}
// Sort: passed first (by best_score desc), then failed (by best_score desc),
// then in_progress, then never
usort($leaderboard, function($a, $b) {
    $rank = ['passed' => 0, 'failed' => 1, 'in_progress' => 2, 'never' => 3];
    $ra = $rank[$a['status']] ?? 9;
    $rb = $rank[$b['status']] ?? 9;
    if ($ra !== $rb) return $ra - $rb;
    return ((int)$b['best_score']) - ((int)$a['best_score']);
});

// ─── Per-question analytics ─────────────────────────────────────
// For each question in the pool, count how many submitted attempts
// included it and how many got it right.
$qStats = [];
foreach ($qById as $qid => $q) {
    $qStats[$qid] = [
        'id'           => $qid,
        'prompt'       => mb_substr($q['prompt'] ?? '', 0, 120),
        'category'     => $q['category'] ?? '',
        'type'         => $q['type']     ?? 'single',
        'asked'        => 0,
        'correct'      => 0,
        'correct_rate' => 0,
    ];
}

foreach ($submitted as $a) {
    $qids   = $a['question_ids']  ?? [];
    $orders = $a['choice_orders'] ?? [];
    $ans    = $a['answers']       ?? [];

    foreach ($qids as $qid) {
        if (!isset($qStats[$qid])) continue;
        $qStats[$qid]['asked']++;

        $q     = $qById[$qid];
        $order = $orders[$qid] ?? [];
        // The stored answer is already in user-shuffled space; convert back
        // to original-space index using the same logic as the submit path.
        $userAns = $ans[$qid] ?? null;
        $orig    = examsUnmapAnswer($q['type'] ?? 'single', $userAns, $order);
        if (examsCheckAnswer($q, $orig)) $qStats[$qid]['correct']++;
    }
}
foreach ($qStats as &$s) {
    $s['correct_rate'] = $s['asked'] > 0
        ? round($s['correct'] / $s['asked'] * 100, 1)
        : 0;
}
unset($s);

// Sort: hardest first (lowest correct_rate among asked questions)
$qList = array_values($qStats);
usort($qList, function($a, $b) {
    // Unanswered questions go last
    if ($a['asked'] === 0 && $b['asked'] > 0) return 1;
    if ($b['asked'] === 0 && $a['asked'] > 0) return -1;
    return ((int)$a['correct_rate']) - ((int)$b['correct_rate']);
});

// ─── Not-attempted list ─────────────────────────────────────────
// Eligible users are those in the current team who have exam_include !== false
// AND aren't external. Diff against attempt user_ids to find who never touched
// the exam. Different from leaderboard['status'=>'never'], which only surfaces
// users with an existing attempt record.
$currentTeam = $GLOBALS['_current_team'] ?? null;
$allUsers    = readJson('users.json'); // global file
$attemptedUserIds = [];
foreach ($attempts as $a) {
    $uid = $a['user_id'] ?? '';
    if ($uid) $attemptedUserIds[$uid] = true;
}

$eligibleUsers = [];
$notAttempted  = [];
foreach ($allUsers as $u) {
    if ($currentTeam !== null && ($u['team'] ?? '') !== $currentTeam) continue;
    if (($u['role'] ?? '') === 'external') continue;
    if (isset($u['exam_include']) && $u['exam_include'] === false) continue;
    $eligibleUsers[] = $u;
    if (empty($attemptedUserIds[$u['id']])) {
        $notAttempted[] = [
            'user_id'    => $u['id'],
            'name'       => $u['name']     ?? '',
            'nickname'   => $u['nickname'] ?? '',
            'email'      => $u['email']    ?? '',
            'avatar_url' => $u['avatar_url'] ?? null,
            'role'       => $u['role']     ?? 'sm_user',
            'team'       => $u['team']     ?? '',
        ];
    }
}
usort($notAttempted, fn($a, $b) => strcasecmp($a['name'], $b['name']));

$overview['eligible_users']       = count($eligibleUsers);
$overview['not_attempted_count']  = count($notAttempted);

// ─── Respond ────────────────────────────────────────────────────
respondOk([
    'exam' => [
        'id'              => $exam['id'],
        'title'           => $exam['title']    ?? '',
        'subtitle'        => $exam['subtitle'] ?? '',
        'icon'            => $exam['icon']     ?? '📝',
        'cover_color'     => $exam['cover_color'] ?? '',
        'pass_score'      => $passScore,
        'questions_count' => count($questions),
        'status'          => $exam['status']   ?? 'draft',
        'preset'          => $exam['preset']   ?? '',
    ],
    'overview'      => $overview,
    'distribution'  => $distribution,
    'timeline'      => $timelineRows,
    'leaderboard'   => $leaderboard,
    'not_attempted' => $notAttempted,
    'questions'     => $qList,
    'generated_at'  => date('c'),
]);
