<?php
/**
 * GET    /api/courses/lessons.php?phase_id=...  → list lessons of a phase
 *                                                  (for users: enforce phase is unlocked)
 * POST   /api/courses/lessons.php               → create lesson (admin)
 * PUT    /api/courses/lessons.php?id=...        → update lesson (admin)
 * DELETE /api/courses/lessons.php?id=...        → delete lesson (admin)
 */
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/_lib.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];
$id      = $_GET['id'] ?? '';
$phaseId = $_GET['phase_id'] ?? '';

if ($method === 'GET') {
    if ($phaseId) {
        $cid = coursesFindCourseIdByPhase($phaseId);
        if (!$cid) respondError('Phase not found', 404);

        // Enforce lock for non-admins
        $isAdmin = in_array($payload['role'], ADMIN_ROLES);
        if (!$isAdmin) {
            $allPhases  = coursesSortPhases(coursesReadAllPhases());
            $progress   = coursesReadJson('progress.json');
            $allCourses = coursesReadJson('courses.json');
            $phase = null;
            foreach ($allPhases as $p) if ($p['id'] === $phaseId) { $phase = $p; break; }
            if (!$phase) respondError('Phase not found', 404);

            // Course-level prerequisite lock
            $course = null;
            foreach ($allCourses as $c) if (($c['id'] ?? '') === $cid) { $course = $c; break; }
            if ($course) {
                $lock = coursesCourseLockState($payload['sub'], $course, $allCourses, $allPhases, $progress);
                if ($lock['locked']) {
                    $titles = array_map(fn($u) => $u['title'], $lock['unmet']);
                    respondError('Course locked — ต้องเรียน "' . implode('", "', $titles) . '" ให้จบก่อน', 403);
                }
            }

            $status = coursesPhaseStatus($payload['sub'], $phase, $allPhases, $progress);
            if ($status === 'locked') respondError('Phase is locked', 403);

            // Mark as in_progress if currently unlocked
            if ($status === 'unlocked') {
                coursesUpsertProgress($payload['sub'], $phaseId, ['status' => 'in_progress']);
            }
        }
        $lessons = coursesReadCourseFile($cid, 'lessons.json');
        $lessons = array_values(array_filter($lessons, fn($l) => ($l['phase_id'] ?? '') === $phaseId));
    } else {
        $lessons = coursesReadAllLessons();
    }
    $lessons = coursesSortLessons($lessons);
    respondOk($lessons);
}

// Mutations: admin only
requireRole($payload, ADMIN_ROLES);

if ($method === 'POST') {
    requireCsrf();
    $body = getBody();
    $pid  = trim($body['phase_id'] ?? '');
    $title = trim($body['title'] ?? '');
    if (!$pid)   respondError('phase_id is required');
    if (!$title) respondError('title is required');

    $cid = coursesFindCourseIdByPhase($pid);
    if (!$cid) respondError('Phase not found', 404);

    coursesRequireOwnerForShared($cid, $payload);

    $lessons = coursesReadCourseFile($cid, 'lessons.json');
    $maxOrder = 0;
    foreach ($lessons as $l) {
        if (($l['phase_id'] ?? '') === $pid) {
            $maxOrder = max($maxOrder, (int)($l['order'] ?? 0));
        }
    }
    $lesson = [
        'id'           => genId('lesson'),
        'phase_id'     => $pid,
        'order'        => (int)($body['order'] ?? ($maxOrder + 1)),
        'title'        => $title,
        'content_html' => (string)($body['content_html'] ?? ''),
        'created_at'   => date('c'),
        'created_by'   => $payload['sub'],
    ];
    $lessons[] = $lesson;
    coursesWriteCourseFile($cid, 'lessons.json', $lessons);
    logActivity('course_lesson_create', ['id' => $lesson['id'], 'phase_id' => $pid], $payload['sub'], $payload['name']);
    respondOk($lesson, 'Lesson created');
}

if ($method === 'PUT') {
    requireCsrf();
    if (!$id) respondError('Lesson ID required');
    $body = getBody();

    // Find which course folder holds this lesson (local + shared courses)
    $foundCid = null;
    $lessons = [];
    foreach (_coursesReachableIds() as $cidScan) {
        $rows = coursesReadCourseFile($cidScan, 'lessons.json');
        foreach ($rows as $r) {
            if (($r['id'] ?? '') === $id) { $foundCid = $cidScan; $lessons = $rows; break 2; }
        }
    }
    if (!$foundCid) respondError('Lesson not found', 404);

    coursesRequireOwnerForShared($foundCid, $payload);

    $updated = null;
    foreach ($lessons as &$l) {
        if ($l['id'] === $id) {
            if (isset($body['title']))        $l['title']        = trim($body['title']);
            if (isset($body['content_html'])) $l['content_html'] = (string)$body['content_html'];
            if (isset($body['order']))        $l['order']        = (int)$body['order'];
            if (isset($body['phase_id']))     $l['phase_id']     = trim($body['phase_id']);
            $updated = $l;
            break;
        }
    }
    unset($l);

    // If phase_id changed to a phase in a different course, move the lesson
    $newPid = $updated['phase_id'] ?? '';
    $newCid = $newPid ? coursesFindCourseIdByPhase($newPid) : $foundCid;
    if ($newCid && $newCid !== $foundCid) {
        coursesRequireOwnerForShared($newCid, $payload);
        $lessons = array_values(array_filter($lessons, fn($l) => $l['id'] !== $id));
        coursesWriteCourseFile($foundCid, 'lessons.json', $lessons);
        $dest = coursesReadCourseFile($newCid, 'lessons.json');
        $dest[] = $updated;
        coursesWriteCourseFile($newCid, 'lessons.json', $dest);
    } else {
        coursesWriteCourseFile($foundCid, 'lessons.json', $lessons);
    }

    logActivity('course_lesson_update', ['id' => $id], $payload['sub'], $payload['name']);
    respondOk(null, 'Lesson updated');
}

if ($method === 'DELETE') {
    requireCsrf();
    if (!$id) respondError('Lesson ID required');

    // First locate the containing course (local + shared), THEN guard, THEN
    // write. Guarding after write would leak: a non-owner request would trip
    // 403 but the lesson would already be gone from the shared folder.
    $foundCid = null;
    $originalRows = [];
    foreach (_coursesReachableIds() as $cidScan) {
        $rows = coursesReadCourseFile($cidScan, 'lessons.json');
        foreach ($rows as $r) {
            if (($r['id'] ?? '') === $id) { $foundCid = $cidScan; $originalRows = $rows; break 2; }
        }
    }
    if (!$foundCid) respondError('Lesson not found', 404);

    coursesRequireOwnerForShared($foundCid, $payload);

    $filtered = array_values(array_filter($originalRows, fn($l) => $l['id'] !== $id));
    coursesWriteCourseFile($foundCid, 'lessons.json', $filtered);

    logActivity('course_lesson_delete', ['id' => $id], $payload['sub'], $payload['name']);
    respondOk(null, 'Lesson deleted');
}

respondError('Method not allowed', 405);
