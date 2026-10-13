<?php
/**
 * GET    /api/courses/progress.php                        → current user's summary (all courses)
 * GET    /api/courses/progress.php?scope=all              → all users summary (admin only)
 * GET    /api/courses/progress.php?scope=all&course_id=X  → all users for specific course (admin)
 * GET    /api/courses/progress.php?user_id=X              → drill-down one user (admin)
 * DELETE /api/courses/progress.php?user_id=X              → reset progress for one user (admin)
 *                                  &course_id=Y           → only that course
 * DELETE /api/courses/progress.php?scope=all              → wipe ALL progress (admin)
 *                                  &course_id=Y           → only that course (all users)
 */
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/_lib.php';

$payload    = requireAuth();
$method     = $_SERVER['REQUEST_METHOD'];
$scope      = $_GET['scope'] ?? 'me';
$userIdQ    = $_GET['user_id'] ?? '';
$courseIdQ  = $_GET['course_id'] ?? '';

// ─── Reset (admin only) ─────────────────────────────────────
if ($method === 'DELETE') {
    requireRole($payload, ADMIN_ROLES);
    requireCsrf();

    $allProg   = coursesReadJson('progress.json');
    $allPhases = coursesSortPhases(coursesReadAllPhases());

    // Determine which phase IDs are in scope (if course_id filter)
    $phaseIds = null;
    if ($courseIdQ) {
        $phaseIds = array_map(fn($p) => $p['id'],
            array_filter($allPhases, fn($p) => ($p['course_id'] ?? '') === $courseIdQ));
    }

    // Determine target user(s)
    if (!$userIdQ && $scope !== 'all') {
        respondError('Provide user_id or scope=all');
    }

    // Defensive: reject cross-team resets. progress.json is already team-
    // scoped so nothing would actually be removed, but returning 404 keeps
    // the API honest and avoids leaking user existence via activity logs.
    if ($userIdQ) {
        $currentTeam = $GLOBALS['_current_team'] ?? null;
        $target = null;
        foreach (readJson('users.json') as $u) {
            if (($u['id'] ?? '') === $userIdQ) { $target = $u; break; }
        }
        if (!$target) respondError('User not found', 404);
        if ($currentTeam !== null && ($target['team'] ?? '') !== $currentTeam) {
            respondError('User not found', 404);
        }
    }

    $kept = [];
    $removed = 0;
    foreach ($allProg as $row) {
        $hitUser   = $userIdQ ? (($row['user_id'] ?? '') === $userIdQ) : true;
        $hitCourse = $phaseIds === null ? true : in_array($row['phase_id'] ?? '', $phaseIds, true);
        if ($hitUser && $hitCourse) { $removed++; continue; }
        $kept[] = $row;
    }
    coursesWriteJson('progress.json', $kept);

    logActivity('course_progress_reset', [
        'target_user' => $userIdQ ?: '(all)',
        'course_id'   => $courseIdQ ?: '(all)',
        'removed'     => $removed,
    ], $payload['sub'], $payload['name']);

    respondOk(['removed' => $removed], "Reset $removed progress record(s)");
}

if ($method !== 'GET') respondError('Method not allowed', 405);

$currentTeamCtx = $GLOBALS['_current_team'] ?? null;

// When a global-read role (super_admin/super_viewer) has selected "All Teams"
// ($currentTeam === null), aggregate courses/phases/progress across every
// active team so the oversight report reflects the whole company. Otherwise
// read only the current team's data (existing per-team behavior preserved).
// Note: course_id / phase_id collisions across teams keep the first-team's
// row (deterministic by teams.json order) — IDs are random via genId(), so
// real collisions are astronomically unlikely.
$aggregateAll = $currentTeamCtx === null
             && in_array($payload['role'] ?? '', GLOBAL_READ_ROLES, true);

if ($aggregateAll) {
    $prevTeam = $GLOBALS['_current_team'];
    $mergedProgress = [];
    $mergedPhases   = [];
    $mergedCourses  = [];
    foreach (readJson('teams.json') as $t) {
        if (empty($t['active']) || empty($t['slug'])) continue;
        $GLOBALS['_current_team'] = $t['slug'];
        foreach (coursesReadJson('progress.json') as $pr) {
            $pr['_team'] = $t['slug'];
            $mergedProgress[] = $pr;
        }
        foreach (coursesSortPhases(coursesReadAllPhases()) as $ph) {
            if (!isset($mergedPhases[$ph['id']])) $mergedPhases[$ph['id']] = $ph;
        }
        foreach (coursesReadJson('courses.json') as $c) {
            if (!isset($mergedCourses[$c['id']])) $mergedCourses[$c['id']] = $c;
        }
    }
    $GLOBALS['_current_team'] = $prevTeam;
    $allPhases = array_values($mergedPhases);
    $progress  = $mergedProgress;
    $courses   = array_values($mergedCourses);
} else {
    $allPhases = coursesSortPhases(coursesReadAllPhases());
    $progress  = coursesReadJson('progress.json');
    $courses   = coursesReadJson('courses.json');
}
usort($courses, fn($a, $b) => (int)($a['order'] ?? 0) - (int)($b['order'] ?? 0));

// Helper: filter phases by course
$phasesOfCourse = function ($cid) use (&$allPhases) {
    return array_values(array_filter($allPhases, fn($p) => ($p['course_id'] ?? '') === $cid));
};

// ─── Drill-down: single user across all courses ─────────────
if ($userIdQ) {
    requireRole($payload, REPORT_READ_ROLES);
    $users = readJson('users.json'); // global file — must scope by team
    $user = null;
    foreach ($users as $u) if ($u['id'] === $userIdQ) { $user = $u; break; }
    if (!$user) respondError('User not found', 404);
    // Prevent cross-team drill-down: users.json is global, so an admin from
    // team A could otherwise probe user_ids belonging to team B.
    if ($currentTeamCtx !== null && ($user['team'] ?? '') !== $currentTeamCtx) {
        respondError('User not found', 404);
    }

    // In All-Teams drill-down (global-read + null ctx), reload from the target
    // user's team so we pull that team's per-user progress rows (the merged
    // aggregate above already has them, but re-reading with a specific team
    // avoids ambiguity if two teams have colliding phase_ids).
    if ($aggregateAll && !empty($user['team'])) {
        $GLOBALS['_current_team'] = $user['team'];
        $allPhases = coursesSortPhases(coursesReadAllPhases());
        $progress  = coursesReadJson('progress.json');
        $courses   = coursesReadJson('courses.json');
        usort($courses, fn($a, $b) => (int)($a['order'] ?? 0) - (int)($b['order'] ?? 0));
    }

    $perCourse = [];
    foreach ($courses as $c) {
        $cp = $phasesOfCourse($c['id']);
        $phaseRows = [];
        $passed = 0;
        foreach ($cp as $p) {
            $s = coursesPhaseStatus($userIdQ, $p, $cp, $progress);
            if ($s === 'passed') $passed++;
            $mine = null;
            foreach ($progress as $pr) {
                if ($pr['user_id'] === $userIdQ && $pr['phase_id'] === $p['id']) { $mine = $pr; break; }
            }
            $phaseRows[] = [
                'phase_id'     => $p['id'],
                'order'        => $p['order'],
                'title'        => $p['title'],
                'icon'         => $p['icon'] ?? '',
                'pass_score'   => $p['pass_score'] ?? 70,
                'status'       => $s,
                'score'        => $mine['score'] ?? null,
                'last_score'   => $mine['last_score'] ?? null,
                'attempts'     => $mine['attempts'] ?? 0,
                'completed_at' => $mine['completed_at'] ?? null,
                'updated_at'   => $mine['updated_at'] ?? null,
            ];
        }
        $total = count($cp);
        $perCourse[] = [
            'course_id'     => $c['id'],
            'course_title'  => $c['title'],
            'course_icon'   => $c['icon'] ?? '📘',
            'phases_total'  => $total,
            'phases_passed' => $passed,
            'percent'       => $total ? (int)round($passed / $total * 100) : 0,
            'phases'        => $phaseRows,
        ];
    }

    respondOk([
        'user' => [
            'id'       => $user['id'],
            'name'     => $user['name'] ?? '',
            'username' => $user['username'] ?? '',
            'role'     => $user['role'] ?? '',
            'email'    => $user['email'] ?? '',
            'team'     => $user['team'] ?? '',
        ],
        'courses' => $perCourse,
    ]);
}

// ─── All users summary ──────────────────────────────────────
if ($scope === 'all') {
    requireRole($payload, REPORT_READ_ROLES);
    $allUsers = readJson('users.json'); // global file — must scope by team
    // Filter to current team members. progress.json is already team-scoped
    // via coursesReadJson(), but users.json isn't — without this filter, an
    // admin from team A sees every user in the system in the progress table.
    // In All-Teams mode (global-read + null ctx), include every user WITH a
    // team assignment — excludes super_admin/super_viewer (no team) and any
    // orphaned records so oversight rows correspond to real team members.
    $users = array_values(array_filter($allUsers, fn($u) =>
        $currentTeamCtx === null
            ? !empty($u['team'])
            : ($u['team'] ?? '') === $currentTeamCtx
    ));

    // If course_id filter, scope to that course
    $scopedCourses = $courseIdQ
        ? array_values(array_filter($courses, fn($c) => $c['id'] === $courseIdQ))
        : $courses;

    $out = [];
    foreach ($users as $u) {
        $uid = $u['id'];
        $coursesSummary = [];
        $overallPassed = 0; $overallTotal = 0;
        $lastActive = null;
        $totalAttempts = 0;

        foreach ($scopedCourses as $c) {
            $cp = $phasesOfCourse($c['id']);
            $p = 0;
            foreach ($cp as $ph) {
                if (coursesPhaseStatus($uid, $ph, $cp, $progress) === 'passed') $p++;
            }
            $overallPassed += $p;
            $overallTotal  += count($cp);
            $coursesSummary[] = [
                'course_id'     => $c['id'],
                'course_title'  => $c['title'],
                'phases_passed' => $p,
                'phases_total'  => count($cp),
                'percent'       => count($cp) ? (int)round($p / count($cp) * 100) : 0,
            ];
        }

        // Compute lastActive + totalAttempts from this user's progress rows
        foreach ($progress as $pr) {
            if ($pr['user_id'] !== $uid) continue;
            $totalAttempts += (int)($pr['attempts'] ?? 0);
            $ts = $pr['updated_at'] ?? $pr['created_at'] ?? null;
            if ($ts && (!$lastActive || strcmp($ts, $lastActive) > 0)) $lastActive = $ts;
        }

        $percent = $overallTotal ? (int)round($overallPassed / $overallTotal * 100) : 0;
        // status bucket
        if ($overallTotal === 0) $bucket = 'no_course';
        elseif ($overallPassed === 0 && $totalAttempts === 0) $bucket = 'not_started';
        elseif ($overallPassed >= $overallTotal) $bucket = 'completed';
        else $bucket = 'in_progress';

        $out[] = [
            'user_id'         => $uid,
            'name'            => $u['name'] ?? '',
            'username'        => $u['username'] ?? '',
            'role'            => $u['role'] ?? '',
            'email'           => $u['email'] ?? '',
            'team'            => $u['team'] ?? '',
            'phases_total'    => $overallTotal,
            'phases_passed'   => $overallPassed,
            'percent'         => $percent,
            'total_attempts'  => $totalAttempts,
            'last_active'     => $lastActive,
            'status_bucket'   => $bucket,
            'courses'         => $coursesSummary,
        ];
    }

    // Aggregate stats
    $total = count($out);
    $stats = [
        'users_total'        => $total,
        'users_completed'    => count(array_filter($out, fn($x) => $x['status_bucket'] === 'completed')),
        'users_in_progress'  => count(array_filter($out, fn($x) => $x['status_bucket'] === 'in_progress')),
        'users_not_started'  => count(array_filter($out, fn($x) => $x['status_bucket'] === 'not_started')),
        'avg_percent'        => $total ? (int)round(array_sum(array_column($out, 'percent')) / $total) : 0,
    ];
    respondOk(['stats' => $stats, 'users' => $out]);
}

// ─── Scope=me ───────────────────────────────────────────────
$uid = $payload['sub'];
$mine = array_values(array_filter($progress, fn($p) => $p['user_id'] === $uid));

$passed = 0; $total = 0;
$statusMap = [];
foreach ($allPhases as $p) {
    $s = coursesPhaseStatus($uid, $p, $phasesOfCourse($p['course_id'] ?? ''), $progress);
    $statusMap[$p['id']] = $s;
    if ($s === 'passed') $passed++;
    $total++;
}
$percent = $total ? (int)round($passed / $total * 100) : 0;

// Find current phase (first non-passed across all courses)
$currentPhase = null;
foreach ($allPhases as $p) {
    if ($statusMap[$p['id']] !== 'passed') { $currentPhase = $p; break; }
}

respondOk([
    'phases_total'  => $total,
    'phases_passed' => $passed,
    'percent'       => $percent,
    'current_phase' => $currentPhase,
    'progress'      => $mine,
    'status_map'    => $statusMap,
]);
