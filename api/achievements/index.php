<?php
/**
 * Achievements — aggregates course completions + exam passes for a user.
 *
 * GET /api/achievements/index.php             → my achievements
 * GET /api/achievements/index.php?user_id=X   → admin: another user's achievements
 *
 * Returns:
 * {
 *   stats: { courses_completed, courses_total, exams_passed, exams_taken, total_points },
 *   courses: [
 *     { id, title, icon, cover_color, percent, phases_passed, phases_total,
 *       completed: bool, completed_at, badge: 'gold'|'silver'|'bronze'|null }
 *   ],
 *   exams: [
 *     { id, title, icon, cover_color, best_score, pass_score, attempts,
 *       passed: bool, passed_at, badge: 'gold'|'silver'|'bronze'|null }
 *   ],
 *   onboarding: { finished: bool, finished_at, percent }
 * }
 */
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/../courses/_lib.php';
require_once __DIR__ . '/../exams/_lib.php';
require_once __DIR__ . '/../onboarding/_lib.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];
if ($method !== 'GET') respondError('Method not allowed', 405);

$targetUid = $_GET['user_id'] ?? '';
$uid = $targetUid ?: $payload['sub'];

// ─── Courses ─────────────────────────────────────────────────────
// Phases live in per-course dirs (data/{team}/courses/<cid>/phases.json).
// The old monolithic phases.json is stale — using it makes newly-added
// courses look empty (row skipped) and courses whose phase list shrank
// still show the higher old count. coursesReadAllPhases() walks every
// reachable course folder (local + shared) so counts stay in sync.
$allCourses = coursesReadJson('courses.json');
$allPhases  = coursesSortPhases(coursesReadAllPhases());
$progress   = coursesReadJson('progress.json');
usort($allCourses, fn($a, $b) => (int)($a['order'] ?? 0) - (int)($b['order'] ?? 0));

$courseRows = [];
$coursesCompleted = 0;
foreach ($allCourses as $c) {
    if (!($c['published'] ?? false) && !$targetUid) continue;
    $cp = array_values(array_filter($allPhases, fn($p) => ($p['course_id'] ?? '') === $c['id']));
    if (!$cp) continue;
    $passed = 0; $latestCompleted = null;
    foreach ($cp as $p) {
        $s = coursesPhaseStatus($uid, $p, $cp, $progress);
        if ($s === 'passed') {
            $passed++;
            // pluck completed_at if available
            foreach ($progress as $pr) {
                if ($pr['user_id'] !== $uid || $pr['phase_id'] !== $p['id']) continue;
                $cAt = $pr['completed_at'] ?? null;
                if ($cAt && (!$latestCompleted || strcmp($cAt, $latestCompleted) > 0)) $latestCompleted = $cAt;
            }
        }
    }
    $total = count($cp);
    $percent = $total ? (int)round($passed / $total * 100) : 0;
    $completed = ($total > 0 && $passed === $total);
    if ($completed) $coursesCompleted++;

    // Compute badge for this course (based on best phase score average)
    $sumScore = 0; $scored = 0;
    foreach ($cp as $p) {
        foreach ($progress as $pr) {
            if ($pr['user_id'] === $uid && $pr['phase_id'] === $p['id']) {
                $sumScore += (int)($pr['score'] ?? 0); $scored++;
            }
        }
    }
    $avgScore = $scored ? (int)round($sumScore / $scored) : 0;
    $badge = null;
    if ($completed) {
        if ($avgScore >= 95)      $badge = 'gold';
        elseif ($avgScore >= 85)  $badge = 'silver';
        else                       $badge = 'bronze';
    }

    $courseRows[] = [
        'id'             => $c['id'],
        'title'          => $c['title'],
        'icon'           => $c['icon'] ?? '📘',
        'cover_color'    => $c['cover_color'] ?? '#f26419',
        'phases_total'   => $total,
        'phases_passed'  => $passed,
        'percent'        => $percent,
        'completed'      => $completed,
        'completed_at'   => $latestCompleted,
        'avg_score'      => $avgScore,
        'badge'          => $badge,
    ];
}

// ─── Exams ───────────────────────────────────────────────────────
$allExams = examsReadJson('exams.json');
$attempts = examsReadJson('attempts.json');

$examRows = [];
$examsPassed = 0;
$examsTaken  = 0;
foreach ($allExams as $e) {
    if (($e['status'] ?? 'draft') !== 'published' && !$targetUid) continue;
    $myAttempts = array_values(array_filter($attempts, fn($a) =>
        ($a['user_id'] ?? '') === $uid
        && ($a['exam_id'] ?? '') === $e['id']
        && ($a['status']  ?? '') === 'submitted'));
    if (!$myAttempts) continue; // hide exams the user hasn't taken

    $examsTaken++;
    $best = 0; $passedAt = null;
    foreach ($myAttempts as $a) {
        $score = (int)($a['score'] ?? 0);
        if ($score > $best) $best = $score;
        if (!empty($a['passed']) && (!$passedAt || strcmp($a['submitted_at'] ?? '', $passedAt) > 0)) {
            $passedAt = $a['submitted_at'] ?? null;
        }
    }
    $passScore = (int)($e['pass_score'] ?? 70);
    $passed = $best >= $passScore;
    if ($passed) $examsPassed++;

    $badge = null;
    if ($passed) {
        if ($best >= 95)      $badge = 'gold';
        elseif ($best >= 85)  $badge = 'silver';
        else                   $badge = 'bronze';
    }

    $examRows[] = [
        'id'           => $e['id'],
        'title'        => $e['title'],
        'icon'         => $e['icon'] ?? '📝',
        'cover_color'  => $e['cover_color'] ?? '#f26419',
        'best_score'   => $best,
        'pass_score'   => $passScore,
        'attempts'     => count($myAttempts),
        'passed'       => $passed,
        'passed_at'    => $passedAt,
        'badge'        => $badge,
    ];
}

// Sort exams: passed first, then by best_score desc
usort($examRows, function ($a, $b) {
    if ($a['passed'] !== $b['passed']) return $b['passed'] - $a['passed'];
    return $b['best_score'] - $a['best_score'];
});

// ─── Onboarding ──────────────────────────────────────────────────
$obConfig   = onboardingGetConfig();
$obProgress = onboardingGetProgress($uid);
$obCompleted = onboardingNormalizeCompletedTasks($obProgress['completed_tasks'] ?? []);
$obTotal = onboardingTotalTasks($obConfig['chapters'] ?? []);
$obDone  = onboardingDoneTasks($obConfig['chapters'] ?? [], $obCompleted);
$obPercent = $obTotal ? (int)round($obDone / $obTotal * 100) : 0;

// ─── Total points (gamification) ─────────────────────────────────
//   onboarding   = 100
//   per course   = 50 + bronze(0) / silver(20) / gold(50) bonus
//   per exam     = 30 + bronze(0) / silver(15) / gold(40) bonus
$points = 0;
if (!empty($obProgress['finished_at'])) $points += 100;
foreach ($courseRows as $c) {
    if ($c['completed']) {
        $points += 50;
        if ($c['badge'] === 'silver') $points += 20;
        if ($c['badge'] === 'gold')   $points += 50;
    }
}
foreach ($examRows as $e) {
    if ($e['passed']) {
        $points += 30;
        if ($e['badge'] === 'silver') $points += 15;
        if ($e['badge'] === 'gold')   $points += 40;
    }
}

respondOk([
    'stats' => [
        'courses_completed' => $coursesCompleted,
        'courses_total'     => count($courseRows),
        'exams_passed'      => $examsPassed,
        'exams_taken'       => $examsTaken,
        'total_points'      => $points,
        'onboarding_done'   => !empty($obProgress['finished_at']),
    ],
    'courses'    => $courseRows,
    'exams'      => $examRows,
    'onboarding' => [
        'finished'    => !empty($obProgress['finished_at']),
        'finished_at' => $obProgress['finished_at'] ?? null,
        'percent'     => $obPercent,
        'done'        => $obDone,
        'total'       => $obTotal,
    ],
]);
