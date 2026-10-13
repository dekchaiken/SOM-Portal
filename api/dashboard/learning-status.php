<?php
/**
 * GET /api/dashboard/learning-status.php
 *
 * Aggregates onboarding + courses progress + recommended next action for the
 * dashboard hero "learning widget". External users are excluded.
 */
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/../onboarding/_lib.php';
require_once __DIR__ . '/../courses/_lib.php';

$payload = requireAuth();
$uid     = $payload['sub'];
$role    = $payload['role'] ?? '';

if ($role === 'external') {
    respondOk(['enabled' => false]);
}

// ── Onboarding ──────────────────────────────────────────────────────────
$onbConfig   = onboardingGetConfig();
$chapters    = $onbConfig['chapters'] ?? [];
$onbProgress = onboardingGetProgress($uid);
$completed   = onboardingNormalizeCompletedTasks($onbProgress['completed_tasks'] ?? []);
$quizzes     = onboardingNormalizeQuizzes($onbProgress['quizzes'] ?? []);
$examResults = onboardingNormalizeExamResults($onbProgress['exam_results'] ?? []);

$onbTotal   = onboardingTotalTasks($chapters);
$onbDone    = onboardingDoneTasks($chapters, $completed);
$onbPercent = $onbTotal ? (int)round($onbDone / $onbTotal * 100) : 0;
$onbAllDone = onboardingIsAllDone($chapters, $completed, $quizzes, $examResults);
$onbFinishedAt = $onbProgress['finished_at'] ?? null;
$onbIsDone  = !empty($onbFinishedAt) || $onbAllDone;

// Identify first incomplete chapter (for "continue" CTA)
$nextChapter = null;
foreach ($chapters as $ch) {
    if (!onboardingIsChapterDone($ch, $completed, $quizzes, $examResults)) {
        $nextChapter = [
            'id'    => $ch['id'],
            'title' => $ch['title'] ?? '',
            'label' => $ch['label'] ?? '',
        ];
        break;
    }
}

$onboarding = [
    'percent'      => $onbPercent,
    'done_tasks'   => $onbDone,
    'total_tasks'  => $onbTotal,
    'is_done'      => $onbIsDone,
    'is_started'   => $onbDone > 0,
    'next_chapter' => $nextChapter,
];

// ── Courses ─────────────────────────────────────────────────────────────
// Use coursesReadJson / coursesReadAllPhases — handles the per-course folder
// storage layout (data/courses/<course_id>/phases.json) introduced in the migration.
$coursesAll = coursesReadJson('courses.json');
$phases     = coursesReadAllPhases();
$courseProg = coursesReadJson('progress.json');

// Sort all by order (used for both published + upcoming draft "coming soon" list)
usort($coursesAll, fn($a, $b) => (int)($a['order'] ?? 0) - (int)($b['order'] ?? 0));

// Published only — drives progress + next_action logic
$courses     = array_values(array_filter($coursesAll, fn($c) => !empty($c['published'])));
$coursesDraft = array_values(array_filter($coursesAll, fn($c) => empty($c['published'])));

// Build set of passed phase IDs for this user
$myPassedPhases = [];
foreach ($courseProg as $p) {
    if (($p['user_id'] ?? '') === $uid && ($p['status'] ?? '') === 'passed') {
        $myPassedPhases[$p['phase_id'] ?? ''] = true;
    }
}

// Compute completion per course (used to evaluate prerequisites)
$courseCompletion = [];
foreach ($courses as $c) {
    $cid = $c['id'];
    $cPhases = array_values(array_filter($phases, fn($p) => ($p['course_id'] ?? '') === $cid));
    $total = count($cPhases);
    $passed = 0;
    foreach ($cPhases as $p) {
        if (!empty($myPassedPhases[$p['id'] ?? ''])) $passed++;
    }
    $courseCompletion[$cid] = [
        'total'  => $total,
        'passed' => $passed,
        'is_complete' => $total > 0 && $passed === $total,
    ];
}

$coursesOut = [];
foreach ($courses as $c) {
    $cid = $c['id'];
    $stat = $courseCompletion[$cid];
    $prereqs = $c['prerequisites'] ?? [];
    $unmet = [];
    foreach ($prereqs as $pr) {
        if (empty($courseCompletion[$pr]['is_complete'])) $unmet[] = $pr;
    }
    $locked = !empty($unmet);
    $percent = $stat['total'] ? (int)round($stat['passed'] / $stat['total'] * 100) : 0;
    $status = $locked ? 'locked'
        : ($stat['is_complete'] ? 'completed'
        : ($stat['passed'] > 0 ? 'in_progress' : 'not_started'));

    $coursesOut[] = [
        'id'             => $cid,
        'title'          => $c['title']    ?? '',
        'subtitle'       => $c['subtitle'] ?? '',
        'icon'           => $c['icon']     ?? '📘',
        'cover_color'    => $c['cover_color'] ?? '#f26419',
        'percent'        => $percent,
        'passed_phases'  => $stat['passed'],
        'total_phases'   => $stat['total'],
        'status'         => $status,
        'locked'         => $locked,
        'unmet_prereqs'  => $unmet,
    ];
}

// ── Next action ─────────────────────────────────────────────────────────
$inProgress  = array_values(array_filter($coursesOut, fn($c) => $c['status'] === 'in_progress'));
$startable   = array_values(array_filter($coursesOut, fn($c) => $c['status'] === 'not_started' && !$c['locked']));
$allDone     = $onbIsDone
    && !empty($coursesOut)
    && !array_filter($coursesOut, fn($c) => $c['status'] !== 'completed');

$nextAction = null;
if (!$onboarding['is_started']) {
    $nextAction = [
        'kind'         => 'welcome',
        'target_url'   => './onboarding.html',
        'mascot_mood'  => 'wave',
        'title'        => 'สวัสดีครับ ยินดีต้อนรับเข้าทีม! 🎉',
        'message'      => 'เริ่มต้นที่ Team Onboarding กันก่อนนะ จะได้ปลดล็อกคอร์สเรียนอื่นๆ',
        'cta_label'    => 'เริ่มเลย',
    ];
} elseif (!$onboarding['is_done']) {
    $remain = max(0, 100 - $onbPercent);
    $nextAction = [
        'kind'         => 'finish_onboarding',
        'target_url'   => './onboarding.html',
        'mascot_mood'  => 'cheer',
        'title'        => 'เหลืออีกแค่ ' . $remain . '% เท่านั้นเอง! 💪',
        'message'      => $nextChapter
            ? 'ทำต่อที่ ' . ($nextChapter['label'] ? $nextChapter['label'] . ' — ' : '') . $nextChapter['title']
            : 'กลับไปทำ onboarding ต่อกัน',
        'cta_label'    => 'ทำต่อ',
    ];
} elseif (!empty($inProgress)) {
    $top = $inProgress[0];
    $nextAction = [
        'kind'         => 'continue_course',
        'target_url'   => './learn-course.html?id=' . urlencode($top['id']),
        'target_id'    => $top['id'],
        'mascot_mood'  => 'cheer',
        'title'        => 'มาเรียนต่อกันเถอะ! 📚',
        'message'      => $top['title'] . ' — เรียนไปแล้ว ' . $top['percent'] . '%',
        'cta_label'    => 'เรียนต่อ',
    ];
} elseif (!empty($startable)) {
    $top = $startable[0];
    $nextAction = [
        'kind'         => 'start_course',
        'target_url'   => './learn-course.html?id=' . urlencode($top['id']),
        'target_id'    => $top['id'],
        'mascot_mood'  => 'wave',
        'title'        => 'พร้อมต่อยอดยัง? ✨',
        'message'      => 'ลองเริ่มที่คอร์ส "' . $top['title'] . '" ดูสิ',
        'cta_label'    => 'เริ่มคอร์ส',
    ];
} elseif ($allDone) {
    $nextAction = [
        'kind'         => 'all_done',
        'target_url'   => './learn.html',
        'mascot_mood'  => 'celebrate',
        'title'        => 'เก่งมาก! เรียนครบทุกคอร์สแล้ว 🏆',
        'message'      => 'รอคอร์สใหม่ๆ ที่กำลังจะมาถึงได้เลย',
        'cta_label'    => 'ดูคอร์สทั้งหมด',
    ];
} else {
    $nextAction = [
        'kind'         => 'browse',
        'target_url'   => './learn.html',
        'mascot_mood'  => 'wave',
        'title'        => 'ยังไม่มีคอร์สที่เปิดให้เรียนตอนนี้',
        'message'      => 'แวะดูหน้า Learning ไว้ก่อนได้นะ',
        'cta_label'    => 'ไปหน้า Learning',
    ];
}

// Append draft (unpublished) courses as "coming_soon" cards — pure visual roadmap
// hints for the dashboard hero. They don't affect progress/next_action.
foreach ($coursesDraft as $c) {
    $coursesOut[] = [
        'id'             => $c['id'],
        'title'          => $c['title']    ?? '',
        'subtitle'       => $c['subtitle'] ?? '',
        'icon'           => $c['icon']     ?? '📘',
        'cover_color'    => $c['cover_color'] ?? '#f26419',
        'percent'        => 0,
        'passed_phases'  => 0,
        'total_phases'   => 0,
        'status'         => 'coming_soon',
        'locked'         => true,
        'unmet_prereqs'  => [],
    ];
}

respondOk([
    'enabled'     => true,
    'onboarding'  => $onboarding,
    'courses'     => $coursesOut,
    'next_action' => $nextAction,
]);
