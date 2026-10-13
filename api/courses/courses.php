<?php
/**
 * GET    /api/courses/courses.php              → list courses (with user's progress per course)
 * GET    /api/courses/courses.php?id=...       → single course details
 * POST   /api/courses/courses.php              → create (admin)
 * PUT    /api/courses/courses.php?id=...       → update (admin)
 * DELETE /api/courses/courses.php?id=...       → delete course + its phases/lessons/quizzes/progress (admin)
 */
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/_lib.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];
$id      = $_GET['id'] ?? '';

if ($method === 'GET') {
    // ── super_viewer in "All Teams" mode: merge published courses across teams ──
    // Only kicks in when no X-Admin-Team is set (view-as=All). If super_viewer
    // has picked a team via the switcher, the normal team-scoped path runs.
    $isSuperViewer = ($payload['role'] ?? '') === 'super_viewer';
    $noViewAs      = empty($GLOBALS['_current_team']);
    if ($isSuperViewer && $noViewAs && !$id) {
        $teams   = readJson('teams.json');
        $merged  = [];
        $prevCtx = $GLOBALS['_current_team'] ?? null;
        foreach ($teams as $t) {
            if (empty($t['active'])) continue;
            $GLOBALS['_current_team'] = $t['slug'];
            foreach (coursesReadJson('courses.json') as $c) {
                if (empty($c['published'])) continue; // read-only oversight sees published only
                $c['team']       = $t['slug'];
                $c['team_name']  = $t['name']  ?? $t['slug'];
                $c['team_color'] = $t['color'] ?? '#6366F1';
                // super_viewer has no progress — stub the "my_*" fields the UI expects
                $c['phases_count']  = 0;
                $c['my_passed']     = 0;
                $c['my_percent']    = 0;
                $c['my_current']    = null;
                $c['my_locked']     = false;
                $c['unmet_prereqs'] = [];
                $c['my_status']     = 'not_started';
                $merged[] = $c;
            }
        }
        $GLOBALS['_current_team'] = $prevCtx;
        usort($merged, fn($a, $b) => strcmp($a['team'], $b['team']) ?: (int)($a['order'] ?? 0) - (int)($b['order'] ?? 0));
        respondOk($merged);
    }

    $localCourses = coursesReadJson('courses.json');

    // Merge shared courses owned by OTHER teams. Local wins on ID collision —
    // if the current team happens to have its own course with the same id as a
    // shared one, keep the local; the shared entry is dropped from the list
    // (admin can still see the collision by fetching the shared entry by id).
    $currentTeam = $GLOBALS['_current_team'] ?? null;
    $localIds    = array_flip(array_column($localCourses, 'id'));
    $mergedShared = [];
    foreach (coursesReadSharedCatalog() as $cid => $sharedEntry) {
        if (($sharedEntry['owner_team'] ?? '') === $currentTeam) continue; // already in local
        if (isset($localIds[$cid])) continue;                              // local wins
        $mergedShared[] = $sharedEntry;
    }
    $courses = array_merge($localCourses, $mergedShared);
    // Sort by order
    usort($courses, fn($a, $b) => (int)($a['order'] ?? 0) - (int)($b['order'] ?? 0));

    $phases   = coursesSortPhases(coursesReadAllPhases());
    $progress = coursesReadJson('progress.json');
    $isAdmin  = in_array($payload['role'], ADMIN_ROLES);

    $annotate = function ($course) use ($payload, $phases, $progress, $isAdmin, $courses) {
        $courseId = $course['id'];
        $coursePhases = array_values(array_filter($phases, fn($p) => ($p['course_id'] ?? '') === $courseId));
        $totalPhases = count($coursePhases);

        // Compute user's status across this course's phases
        $passed = 0; $current = null;
        foreach ($coursePhases as $p) {
            $s = coursesPhaseStatus($payload['sub'], $p, $coursePhases, $progress);
            if ($s === 'passed') $passed++;
            elseif (!$current && ($s === 'unlocked' || $s === 'in_progress')) $current = $p;
        }
        $percent = $totalPhases ? (int)round($passed / $totalPhases * 100) : 0;

        // Compute prerequisite lock state
        $lockState = coursesCourseLockState($payload['sub'], $course, $courses, $phases, $progress);

        $course['prerequisites']    = $course['prerequisites'] ?? [];
        $course['phases_count']     = $totalPhases;
        $course['my_passed']        = $passed;
        $course['my_percent']       = $percent;
        $course['my_current']       = $current ? ['id'=>$current['id'], 'title'=>$current['title'], 'order'=>$current['order']] : null;
        $course['my_locked']        = $lockState['locked'];
        $course['unmet_prereqs']    = $lockState['unmet'];
        $course['my_status']        = $lockState['locked']
            ? 'locked'
            : ($passed === $totalPhases && $totalPhases > 0 ? 'completed' : ($passed > 0 ? 'in_progress' : 'not_started'));
        return $course;
    };

    if ($id) {
        $c = null;
        foreach ($courses as $x) if ($x['id'] === $id) { $c = $x; break; }
        if (!$c) respondError('Course not found', 404);
        respondOk($annotate($c));
    }

    // Non-admins see only published
    if (!$isAdmin) {
        $courses = array_values(array_filter($courses, fn($c) => !empty($c['published'])));
    }
    $out = array_map($annotate, $courses);
    respondOk(array_values($out));
}

// Mutations admin-only
requireRole($payload, ADMIN_ROLES);

if ($method === 'POST') {
    requireCsrf();
    $body = getBody();
    $title = trim($body['title'] ?? '');
    if (!$title) respondError('Title is required');

    $courses = coursesReadJson('courses.json');
    $maxOrder = 0;
    foreach ($courses as $c) $maxOrder = max($maxOrder, (int)($c['order'] ?? 0));

    $shared = (bool)($body['shared'] ?? false);
    $newId  = genId('course');
    $prereqs = array_values(array_filter((array)($body['prerequisites'] ?? []), fn($x) => is_string($x) && $x !== ''));
    if ($shared) coursesValidateSharedTransition($newId, true, $prereqs);

    $course = [
        'id'            => $newId,
        'order'         => (int)($body['order'] ?? ($maxOrder + 1)),
        'title'         => $title,
        'subtitle'      => trim($body['subtitle'] ?? ''),
        'description'   => trim($body['description'] ?? ''),
        'icon'          => trim($body['icon'] ?? '📘'),
        'cover_color'   => trim($body['cover_color'] ?? '#f26419'),
        'prerequisites' => $prereqs,
        'published'     => (bool)($body['published'] ?? true),
        'is_popular'    => (bool)($body['is_popular'] ?? false),
        'shared'        => $shared,
        'owner_team'    => $GLOBALS['_current_team'] ?? null,
        'created_at'    => date('c'),
        'created_by'    => $payload['sub'],
    ];
    $courses[] = $course;
    coursesWriteJson('courses.json', $courses);
    coursesEnsureCourseDir($course['id']);
    logActivity('course_create', ['id' => $course['id'], 'title' => $title, 'shared' => $shared], $payload['sub'], $payload['name']);
    if ($shared) {
        logActivity('course_share_enabled', ['id' => $course['id'], 'title' => $title], $payload['sub'], $payload['name']);
    }
    respondOk($course, 'Course created');
}

if ($method === 'PUT') {
    requireCsrf();
    if (!$id) respondError('Course ID required');
    $body = getBody();

    // Reject cross-team edits BEFORE loading. If the course is currently
    // shared and this caller isn't the owner team, this respondError's 403.
    coursesRequireOwnerForShared($id, $payload);

    $courses = coursesReadJson('courses.json');
    $found = false;
    $wasShared = false;
    $becameShared = null; // null = untouched, true = enabled, false = disabled
    foreach ($courses as &$c) {
        if ($c['id'] === $id) {
            $wasShared = (bool)($c['shared'] ?? false);

            foreach (['title','subtitle','description','icon','cover_color'] as $k) {
                if (isset($body[$k])) $c[$k] = trim($body[$k]);
            }
            if (isset($body['order']))     $c['order']     = (int)$body['order'];
            if (isset($body['published'])) $c['published'] = (bool)$body['published'];
            if (isset($body['is_popular'])) $c['is_popular'] = (bool)$body['is_popular'];
            if (array_key_exists('prerequisites', $body)) {
                // Prevent self-reference
                $c['prerequisites'] = array_values(array_filter(
                    (array)$body['prerequisites'],
                    fn($x) => is_string($x) && $x !== '' && $x !== $id
                ));
            }
            if (array_key_exists('shared', $body)) {
                $newShared = (bool)$body['shared'];
                if ($newShared !== $wasShared) $becameShared = $newShared;
                // Only re-validate when result is shared:true — dropping the
                // shared flag is always safe.
                if ($newShared) {
                    coursesValidateSharedTransition($id, true, $c['prerequisites'] ?? []);
                }
                $c['shared'] = $newShared;
            }
            // Enforce owner_team invariant — always the current team
            $c['owner_team'] = $c['owner_team'] ?? ($GLOBALS['_current_team'] ?? null);
            $found = true;
            break;
        }
    }
    unset($c);
    if (!$found) respondError('Course not found', 404);
    coursesWriteJson('courses.json', $courses);
    logActivity('course_update', ['id' => $id], $payload['sub'], $payload['name']);
    if ($becameShared === true) {
        logActivity('course_share_enabled', ['id' => $id], $payload['sub'], $payload['name']);
    } elseif ($becameShared === false) {
        logActivity('course_share_disabled', ['id' => $id], $payload['sub'], $payload['name']);
    }
    respondOk(null, 'Course updated');
}

if ($method === 'DELETE') {
    requireCsrf();
    if (!$id) respondError('Course ID required');

    // Only the owner team can delete a shared course — everyone else 403.
    coursesRequireOwnerForShared($id, $payload);

    $courses = coursesReadJson('courses.json');
    $filtered = array_values(array_filter($courses, fn($c) => $c['id'] !== $id));
    if (count($filtered) === count($courses)) respondError('Course not found', 404);
    coursesWriteJson('courses.json', $filtered);

    // Collect phase IDs from the course folder before deleting it (for progress cleanup)
    $removedPhaseIds = array_map(fn($p) => $p['id'], coursesReadCourseFile($id, 'phases.json'));

    // Drop the course folder (phases.json / lessons.json / quizzes.json all gone in one step)
    coursesRemoveCourseDir($id);

    // Prune cross-course progress.json
    if (!empty($removedPhaseIds)) {
        $progress = coursesReadJson('progress.json');
        $progress = array_values(array_filter($progress, fn($pr) => !in_array($pr['phase_id'] ?? '', $removedPhaseIds)));
        coursesWriteJson('progress.json', $progress);
    }

    logActivity('course_delete', ['id' => $id], $payload['sub'], $payload['name']);
    respondOk(null, 'Course deleted');
}

respondError('Method not allowed', 405);
