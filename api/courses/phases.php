<?php
/**
 * GET    /api/courses/phases.php             → list phases with per-user status
 * POST   /api/courses/phases.php             → create phase (admin)
 * PUT    /api/courses/phases.php?id=...      → update phase (admin)
 * DELETE /api/courses/phases.php?id=...      → delete phase + its lessons + quiz (admin)
 */
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/_lib.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];
$id      = $_GET['id'] ?? '';
$courseId = $_GET['course_id'] ?? '';

if ($method === 'GET') {
    // If filtered by course_id, only read that course's folder; otherwise aggregate.
    $allPhases = $courseId
        ? coursesSortPhases(coursesReadCourseFile($courseId, 'phases.json'))
        : coursesSortPhases(coursesReadAllPhases());
    $progress  = coursesReadJson('progress.json');
    $allCourses = coursesReadJson('courses.json');
    $userId    = $payload['sub'];
    $isAdmin   = in_array($payload['role'], ADMIN_ROLES);

    // Enforce course prerequisite lock for non-admins when filtered by course_id
    // Lock check needs ALL phases (to score prereq courses), so read aggregate even when filtered.
    if ($courseId && !$isAdmin) {
        $course = null;
        foreach ($allCourses as $c) if (($c['id'] ?? '') === $courseId) { $course = $c; break; }
        if ($course) {
            $aggregateForLock = coursesSortPhases(coursesReadAllPhases());
            $lock = coursesCourseLockState($userId, $course, $allCourses, $aggregateForLock, $progress);
            if ($lock['locked']) {
                $titles = array_map(fn($u) => $u['title'], $lock['unmet']);
                respondError('Course locked — ต้องเรียน "' . implode('", "', $titles) . '" ให้จบก่อน', 403);
            }
        }
    }

    // $allPhases is already scoped to course_id when set (read from that folder above)
    $phases = $allPhases;

    $out = [];
    foreach ($phases as $p) {
        // Scope lock computation to same-course phases only
        $scope = $courseId ? $phases : array_values(array_filter($allPhases, fn($x) => ($x['course_id'] ?? '') === ($p['course_id'] ?? '')));
        $status = coursesPhaseStatus($userId, $p, $scope, $progress);
        // Find my row
        $mine = null;
        foreach ($progress as $pr) {
            if ($pr['user_id'] === $userId && $pr['phase_id'] === $p['id']) { $mine = $pr; break; }
        }
        $out[] = array_merge($p, [
            'my_status'       => $status,
            'my_score'        => $mine['score'] ?? null,
            'my_attempts'     => $mine['attempts'] ?? 0,
            'my_completed_at' => $mine['completed_at'] ?? null,
        ]);
    }
    respondOk($out);
}

// Admin-only mutations
requireRole($payload, ADMIN_ROLES);

if ($method === 'POST') {
    requireCsrf();
    $body = getBody();
    $title = trim($body['title'] ?? '');
    $cid   = trim($body['course_id'] ?? '');
    if (!$title) respondError('Title is required');
    if (!$cid)   respondError('course_id is required');

    // Only owner team can add phases to a shared course
    coursesRequireOwnerForShared($cid, $payload);

    $phases = coursesReadCourseFile($cid, 'phases.json');
    $maxOrder = 0;
    foreach ($phases as $p) {
        $maxOrder = max($maxOrder, (int)($p['order'] ?? 0));
    }

    $phase = [
        'id'                => genId('phase'),
        'course_id'         => $cid,
        'order'             => (int)($body['order'] ?? ($maxOrder + 1)),
        'title'             => $title,
        'subtitle'          => trim($body['subtitle'] ?? ''),
        'description'       => trim($body['description'] ?? ''),
        'icon'              => trim($body['icon'] ?? '📘'),
        'pass_score'        => (int)($body['pass_score'] ?? 70),
        'estimated_minutes' => (int)($body['estimated_minutes'] ?? 20),
        'created_at'        => date('c'),
        'created_by'        => $payload['sub'],
    ];
    $phases[] = $phase;
    coursesWriteCourseFile($cid, 'phases.json', $phases);
    logActivity('course_phase_create', ['id' => $phase['id'], 'title' => $title], $payload['sub'], $payload['name']);
    respondOk($phase, 'Phase created');
}

if ($method === 'PUT') {
    requireCsrf();
    if (!$id) respondError('Phase ID required');
    $body = getBody();

    $originalCid = coursesFindCourseIdByPhase($id);
    if (!$originalCid) respondError('Phase not found', 404);

    // Guard the source course. If the phase moves, we also guard the target
    // below once we know newCid.
    coursesRequireOwnerForShared($originalCid, $payload);

    $phases = coursesReadCourseFile($originalCid, 'phases.json');
    $updated = null;
    foreach ($phases as &$p) {
        if ($p['id'] === $id) {
            foreach (['title','subtitle','description','icon','course_id'] as $k) {
                if (isset($body[$k])) $p[$k] = trim($body[$k]);
            }
            foreach (['order','pass_score','estimated_minutes'] as $k) {
                if (isset($body[$k])) $p[$k] = (int)$body[$k];
            }
            $updated = $p;
            break;
        }
    }
    unset($p);
    if (!$updated) respondError('Phase not found', 404);

    $newCid = $updated['course_id'] ?? $originalCid;
    if ($newCid !== $originalCid) {
        // Also guard the destination when moving into a different course
        coursesRequireOwnerForShared($newCid, $payload);
        // Move: remove from old course folder, append to new + also move lessons/quizzes for this phase
        $phases = array_values(array_filter($phases, fn($p) => $p['id'] !== $id));
        coursesWriteCourseFile($originalCid, 'phases.json', $phases);

        $newPhases = coursesReadCourseFile($newCid, 'phases.json');
        $newPhases[] = $updated;
        coursesWriteCourseFile($newCid, 'phases.json', $newPhases);

        foreach (['lessons.json', 'quizzes.json'] as $f) {
            $oldRows = coursesReadCourseFile($originalCid, $f);
            $moved   = array_values(array_filter($oldRows, fn($r) => ($r['phase_id'] ?? '') === $id));
            $kept    = array_values(array_filter($oldRows, fn($r) => ($r['phase_id'] ?? '') !== $id));
            coursesWriteCourseFile($originalCid, $f, $kept);
            if ($moved) {
                $newRows = coursesReadCourseFile($newCid, $f);
                coursesWriteCourseFile($newCid, $f, array_merge($newRows, $moved));
            }
        }
    } else {
        coursesWriteCourseFile($originalCid, 'phases.json', $phases);
    }

    logActivity('course_phase_update', ['id' => $id], $payload['sub'], $payload['name']);
    respondOk(null, 'Phase updated');
}

if ($method === 'DELETE') {
    requireCsrf();
    if (!$id) respondError('Phase ID required');

    $cid = coursesFindCourseIdByPhase($id);
    if (!$cid) respondError('Phase not found', 404);

    coursesRequireOwnerForShared($cid, $payload);

    $phases   = coursesReadCourseFile($cid, 'phases.json');
    $filtered = array_values(array_filter($phases, fn($p) => $p['id'] !== $id));
    coursesWriteCourseFile($cid, 'phases.json', $filtered);

    // Cascade: remove lessons + quizzes in same course folder
    $lessons = coursesReadCourseFile($cid, 'lessons.json');
    $lessons = array_values(array_filter($lessons, fn($l) => ($l['phase_id'] ?? '') !== $id));
    coursesWriteCourseFile($cid, 'lessons.json', $lessons);

    $quizzes = coursesReadCourseFile($cid, 'quizzes.json');
    $quizzes = array_values(array_filter($quizzes, fn($q) => ($q['phase_id'] ?? '') !== $id));
    coursesWriteCourseFile($cid, 'quizzes.json', $quizzes);

    // Progress is cross-course → root file
    $progress = coursesReadJson('progress.json');
    $progress = array_values(array_filter($progress, fn($pr) => ($pr['phase_id'] ?? '') !== $id));
    coursesWriteJson('progress.json', $progress);

    logActivity('course_phase_delete', ['id' => $id], $payload['sub'], $payload['name']);
    respondOk(null, 'Phase deleted');
}

respondError('Method not allowed', 405);
