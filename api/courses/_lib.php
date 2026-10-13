<?php
/**
 * Courses — shared helpers
 *
 * Storage layout:
 *   data/courses/courses.json              ← course index (id, title, prereqs, ...)
 *   data/courses/progress.json             ← per-user × phase progress (cross-course)
 *   data/courses/<course_id>/phases.json   ← phases belonging to that course
 *   data/courses/<course_id>/lessons.json  ← lessons of all phases in that course
 *   data/courses/<course_id>/quizzes.json  ← quizzes of all phases in that course
 */

// ── Team-scoped root: data/{team}/courses/ ───────────────────────────────
// If no team context is set, route to a sentinel path that never holds data —
// prevents cross-team leaks (previously fell back to 'sm', which leaked SM's
// courses to any request whose JWT was missing the 'team' claim).
function _coursesRoot(): string {
    $team = $GLOBALS['_current_team'] ?? null;
    if ($team === '' || $team === null) $team = '__no_team__';
    return DATA_DIR . $team . '/courses/';
}

// ── Root-level files (courses.json, progress.json) ───────────────────────
function coursesReadJson(string $file): array {
    $path = _coursesRoot() . $file;
    if (!file_exists($path)) return [];
    $json = file_get_contents($path);
    return json_decode($json, true) ?? [];
}

function coursesWriteJson(string $file, array $data): bool {
    $dir = _coursesRoot();
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    $path = $dir . $file;
    $fp = fopen($path, 'c+');
    if (!$fp) return false;
    if (flock($fp, LOCK_EX)) {
        ftruncate($fp, 0);
        rewind($fp);
        fwrite($fp, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        flock($fp, LOCK_UN);
    }
    fclose($fp);
    return true;
}

// ── Cross-team shared catalog ────────────────────────────────────────────
// A course entry is "shared" when its owning team flipped shared:true in its
// own courses.json. Any team can then see it in their list — but only the
// owning team's admin can edit the course structure (see write guards in the
// endpoint files). Helpers here read across every active team without
// mutating $GLOBALS['_current_team'], so the caller's team context is safe.
//
// Result of coursesReadSharedCatalog() is memoised per request — the endpoint
// files that need routing (coursesCourseDir, coursesFindCourseIdByPhase, …)
// can call it many times without re-scanning the filesystem.
function coursesReadSharedCatalog(): array {
    static $cache = null;
    if ($cache !== null) return $cache;
    $out = [];
    $teams = readJson('teams.json'); // global file — no team scoping
    foreach ($teams as $t) {
        $slug = $t['slug'] ?? '';
        if (!$slug || empty($t['active'])) continue;
        $path = DATA_DIR . $slug . '/courses/courses.json';
        if (!file_exists($path)) continue;
        $rows = json_decode((string)file_get_contents($path), true);
        if (!is_array($rows)) continue;
        foreach ($rows as $c) {
            if (empty($c['shared'])) continue;
            // Defensive: ensure owner_team is set (migration guarantees this,
            // but a hand-edited file might not) — fall back to folder location.
            if (empty($c['owner_team'])) $c['owner_team'] = $slug;
            $out[$c['id'] ?? ''] = $c;
        }
    }
    unset($out['']);
    $cache = $out;
    return $cache;
}

function coursesIsShared(string $courseId): bool {
    return isset(coursesReadSharedCatalog()[$courseId]);
}

/** Returns the owning team slug for a shared course, or null if not shared. */
function coursesGetOwnerTeam(string $courseId): ?string {
    $catalog = coursesReadSharedCatalog();
    return $catalog[$courseId]['owner_team'] ?? null;
}

// ── Write guards ────────────────────────────────────────────────────────
// Semantics mirror requireSmForShared() in helpers.php: a null current team
// (super_admin without a view-as context) is allowed through — they still
// need to hit the caller's team folder to write anything meaningful, so this
// is mostly a diagnostic case, not an escape hatch.
function coursesRequireOwnerForShared(string $courseId, array $payload): void {
    if (!coursesIsShared($courseId)) return;
    $owner = coursesGetOwnerTeam($courseId);
    $team  = $GLOBALS['_current_team'] ?? null;
    if ($team && $owner && $team !== $owner) {
        respondError(
            'Shared course "' . $courseId . '" is managed by team "' . $owner
            . '" — team "' . $team . '" cannot edit',
            403
        );
    }
}

/**
 * Validate that a course entry is legal in its post-write state. Called on
 * POST and on PUT when the `shared` flag is present in the request body.
 *   • Cross-team ID collision — two teams cannot share the same course id.
 *   • Shared-only prereqs — a shared course may only depend on other shared
 *     courses (see [[project-shared-courses-plan]] rule 3).
 * $prereqs may be null (caller doesn't touch the field).
 */
function coursesValidateSharedTransition(string $courseId, bool $newShared, ?array $prereqs): void {
    if (!$newShared) return; // becoming non-shared is always safe

    // Collision: any OTHER team already sharing this id?
    $callerTeam = $GLOBALS['_current_team'] ?? null;
    foreach (coursesReadSharedCatalog() as $cid => $entry) {
        if ($cid !== $courseId) continue;
        $owner = $entry['owner_team'] ?? '';
        if ($owner && $owner !== $callerTeam) {
            respondError(
                'Course id "' . $courseId . '" is already shared by team "'
                . $owner . '" — cannot share the same id from two teams',
                409
            );
        }
    }

    // Prereqs: must all be shared themselves.
    if ($prereqs !== null) {
        $catalog = coursesReadSharedCatalog();
        // Include the caller's own about-to-be-shared course (not in catalog yet)
        $catalog[$courseId] = true;
        foreach ($prereqs as $pid) {
            if (!is_string($pid) || $pid === '') continue;
            if ($pid === $courseId) continue; // self-ref filtered elsewhere
            if (!isset($catalog[$pid])) {
                respondError(
                    'Shared course cannot depend on non-shared course "' . $pid
                    . '" — mark the prerequisite as shared first or remove it',
                    400
                );
            }
        }
    }
}

// ── Per-course folder helpers ─────────────────────────────────────────────
// Shared courses live in the owner team's folder — every reader/writer routes
// through here, so we only need one branch. Local (non-shared) course? Return
// the current team's path. Shared course? Return the owner team's path.
// coursesReadSharedCatalog() is memoised, so the extra lookup is essentially
// free after the first call in a request.
function coursesCourseDir(string $courseId): string {
    $owner = coursesGetOwnerTeam($courseId);
    if ($owner !== null) {
        return DATA_DIR . $owner . '/courses/' . $courseId . '/';
    }
    return _coursesRoot() . $courseId . '/';
}

function coursesEnsureCourseDir(string $courseId): void {
    $dir = coursesCourseDir($courseId);
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    foreach (['phases.json', 'lessons.json', 'quizzes.json'] as $f) {
        $p = $dir . $f;
        if (!file_exists($p)) file_put_contents($p, "[]\n");
    }
}

function coursesReadCourseFile(string $courseId, string $file): array {
    $path = coursesCourseDir($courseId) . $file;
    if (!file_exists($path)) return [];
    $json = file_get_contents($path);
    return json_decode($json, true) ?? [];
}

function coursesWriteCourseFile(string $courseId, string $file, array $data): bool {
    coursesEnsureCourseDir($courseId);
    $path = coursesCourseDir($courseId) . $file;
    $fp = fopen($path, 'c+');
    if (!$fp) return false;
    if (flock($fp, LOCK_EX)) {
        ftruncate($fp, 0);
        rewind($fp);
        fwrite($fp, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        flock($fp, LOCK_UN);
    }
    fclose($fp);
    return true;
}

function coursesRemoveCourseDir(string $courseId): void {
    $dir = coursesCourseDir($courseId);
    if (!is_dir($dir)) return;
    // Only delete known files + the empty dir — never recurse into unknown paths
    foreach (['phases.json', 'lessons.json', 'quizzes.json'] as $f) {
        $p = $dir . $f;
        if (file_exists($p)) @unlink($p);
    }
    @rmdir($dir);
}

/** List all course IDs that have a folder on disk. */
function coursesListCourseDirs(): array {
    $base = _coursesRoot();
    if (!is_dir($base)) return [];
    $out = [];
    foreach (scandir($base) as $entry) {
        if ($entry === '.' || $entry === '..') continue;
        if (!is_dir($base . $entry)) continue;
        $out[] = $entry;
    }
    return $out;
}

/**
 * Course IDs to walk when aggregating across the whole "reachable" catalog
 * from the current team's viewpoint: local dirs + any shared course from
 * other teams. If a shared ID collides with a local dir, local wins and the
 * shared one is skipped (the shared entry is shadowed — see courses.php).
 */
function _coursesReachableIds(): array {
    $ids = coursesListCourseDirs();
    $localSet = array_flip($ids);
    foreach (coursesReadSharedCatalog() as $cid => $entry) {
        if ($cid === '') continue;
        if (isset($localSet[$cid])) continue; // local wins
        $ids[] = $cid;
    }
    return $ids;
}

/** Aggregate all phases across every reachable course folder (local + shared). */
function coursesReadAllPhases(): array {
    $out = [];
    foreach (_coursesReachableIds() as $cid) {
        foreach (coursesReadCourseFile($cid, 'phases.json') as $row) {
            // Defensive: ensure course_id matches folder
            $row['course_id'] = $row['course_id'] ?? $cid;
            $out[] = $row;
        }
    }
    return $out;
}

/** Aggregate all lessons across every reachable course folder (local + shared). */
function coursesReadAllLessons(): array {
    $out = [];
    foreach (_coursesReachableIds() as $cid) {
        foreach (coursesReadCourseFile($cid, 'lessons.json') as $row) $out[] = $row;
    }
    return $out;
}

/** Aggregate all quizzes across every reachable course folder (local + shared). */
function coursesReadAllQuizzes(): array {
    $out = [];
    foreach (_coursesReachableIds() as $cid) {
        foreach (coursesReadCourseFile($cid, 'quizzes.json') as $row) $out[] = $row;
    }
    return $out;
}

/** Find which course a phase belongs to. Scans local dirs then reachable
 *  shared courses. Returns null if not found. */
function coursesFindCourseIdByPhase(string $phaseId): ?string {
    foreach (_coursesReachableIds() as $cid) {
        foreach (coursesReadCourseFile($cid, 'phases.json') as $p) {
            if (($p['id'] ?? '') === $phaseId) return $cid;
        }
    }
    return null;
}

/** Sort phases by 'order' ascending */
function coursesSortPhases(array $phases): array {
    usort($phases, fn($a, $b) => (int)($a['order'] ?? 0) - (int)($b['order'] ?? 0));
    return array_values($phases);
}

/** Sort lessons by 'order' ascending */
function coursesSortLessons(array $lessons): array {
    usort($lessons, fn($a, $b) => (int)($a['order'] ?? 0) - (int)($b['order'] ?? 0));
    return array_values($lessons);
}

/** Get progress record for a given user + phase */
function coursesGetProgress(string $userId, string $phaseId): ?array {
    $all = coursesReadJson('progress.json');
    foreach ($all as $p) {
        if (($p['user_id'] ?? '') === $userId && ($p['phase_id'] ?? '') === $phaseId) {
            return $p;
        }
    }
    return null;
}

/** Upsert progress */
function coursesUpsertProgress(string $userId, string $phaseId, array $patch): array {
    $all = coursesReadJson('progress.json');
    $found = false;
    foreach ($all as &$p) {
        if (($p['user_id'] ?? '') === $userId && ($p['phase_id'] ?? '') === $phaseId) {
            foreach ($patch as $k => $v) $p[$k] = $v;
            $p['updated_at'] = date('c');
            $found = true;
            $result = $p;
            break;
        }
    }
    unset($p);
    if (!$found) {
        $result = array_merge([
            'id'           => genId('prog'),
            'user_id'      => $userId,
            'phase_id'     => $phaseId,
            'status'       => 'in_progress',
            'score'        => 0,
            'attempts'     => 0,
            'completed_at' => null,
            'created_at'   => date('c'),
            'updated_at'   => date('c'),
        ], $patch);
        $all[] = $result;
    }
    coursesWriteJson('progress.json', $all);
    return $result;
}

/**
 * Determine whether a user has completed all phases of a given course.
 * Empty course (no phases) returns false (nothing to complete).
 */
function coursesIsCourseCompleted(string $userId, string $courseId, array $allPhases, array $allProgress): bool {
    $phases = array_values(array_filter($allPhases, fn($p) => ($p['course_id'] ?? '') === $courseId));
    if (!$phases) return false;
    foreach ($phases as $p) {
        $status = coursesPhaseStatus($userId, $p, $phases, $allProgress);
        if ($status !== 'passed') return false;
    }
    return true;
}

/**
 * Compute lock state for a course for a user.
 * Returns ['locked' => bool, 'unmet' => [course_id, ...]]
 */
function coursesCourseLockState(string $userId, array $course, array $allCourses, array $allPhases, array $allProgress): array {
    $prereqs = $course['prerequisites'] ?? [];
    if (!is_array($prereqs) || !$prereqs) return ['locked' => false, 'unmet' => []];

    $unmet = [];
    foreach ($prereqs as $pid) {
        if (!coursesIsCourseCompleted($userId, $pid, $allPhases, $allProgress)) {
            // find the course title if available
            $title = $pid;
            foreach ($allCourses as $c) if (($c['id'] ?? '') === $pid) { $title = $c['title']; break; }
            $unmet[] = ['id' => $pid, 'title' => $title];
        }
    }
    return ['locked' => !empty($unmet), 'unmet' => $unmet];
}

/**
 * Determine lock state for a phase for a given user.
 * A phase is "unlocked" when the previous phase (by order, WITHIN THE SAME COURSE) is passed.
 * First phase (order = 1) is always unlocked.
 * Returns: 'locked' | 'unlocked' | 'in_progress' | 'passed'
 *
 * $sortedPhases should already be filtered to the same course as $phase.
 */
function coursesPhaseStatus(string $userId, array $phase, array $sortedPhases, array $allProgress): string {
    // Find my progress for this phase
    $mine = null;
    foreach ($allProgress as $p) {
        if ($p['user_id'] === $userId && $p['phase_id'] === $phase['id']) {
            $mine = $p;
            break;
        }
    }
    if ($mine && ($mine['status'] ?? '') === 'passed') return 'passed';

    // Filter to same course — defensive in case caller passed all phases
    $courseId = $phase['course_id'] ?? '';
    if ($courseId !== '') {
        $sortedPhases = array_values(array_filter($sortedPhases, fn($x) => ($x['course_id'] ?? '') === $courseId));
    }

    // First phase in course always unlocked
    $order = (int)($phase['order'] ?? 0);
    if ($order <= 1) {
        return $mine ? ($mine['status'] ?? 'unlocked') : 'unlocked';
    }

    // Check previous phase status (in same course)
    $prev = null;
    foreach ($sortedPhases as $p) {
        if ((int)$p['order'] === $order - 1) { $prev = $p; break; }
    }
    if (!$prev) return $mine ? ($mine['status'] ?? 'unlocked') : 'unlocked';

    $prevPassed = false;
    foreach ($allProgress as $pp) {
        if ($pp['user_id'] === $userId && $pp['phase_id'] === $prev['id'] && ($pp['status'] ?? '') === 'passed') {
            $prevPassed = true;
            break;
        }
    }
    if (!$prevPassed) return 'locked';

    return $mine ? ($mine['status'] ?? 'unlocked') : 'unlocked';
}

/**
 * Score a quiz submission.
 * Question types:
 *   - single     : answer = int index of correct choice
 *   - multi      : answer = int[] indices (all must match)
 *   - truefalse  : answer = bool
 *   - short      : answer = string (or array of accepted strings)
 *                  q.match_mode = 'exact' | 'contains' | 'regex' (default: exact)
 *                  q.case_sensitive = bool (default: false)
 * $answers = { qId: answer_value }
 * Returns [percent (int 0-100), details]
 */
function coursesScoreQuiz(array $questions, array $answers): array {
    $total = count($questions);
    if ($total === 0) return [0, []];
    $correctCount = 0;
    $details = [];
    foreach ($questions as $q) {
        $qid   = $q['id'] ?? '';
        $type  = $q['type'] ?? 'single';
        $right = $q['answer'] ?? null;
        $user  = $answers[$qid] ?? null;
        $isCorrect = false;

        if ($type === 'single') {
            $isCorrect = ($user !== null && (int)$user === (int)$right);
        } elseif ($type === 'truefalse') {
            $isCorrect = ((bool)$user === (bool)$right);
        } elseif ($type === 'multi') {
            $u = is_array($user) ? array_map('intval', $user) : [];
            $r = is_array($right) ? array_map('intval', $right) : [];
            sort($u); sort($r);
            $isCorrect = ($u === $r);
        } elseif ($type === 'short') {
            $userStr = is_string($user) ? trim($user) : '';
            $accepted = is_array($right) ? $right : [(string)$right];
            $mode = $q['match_mode'] ?? 'exact';
            $cs   = !empty($q['case_sensitive']);
            foreach ($accepted as $a) {
                $aStr = trim((string)$a);
                if ($userStr === '' || $aStr === '') continue;
                $u2 = $cs ? $userStr : mb_strtolower($userStr);
                $a2 = $cs ? $aStr    : mb_strtolower($aStr);
                if ($mode === 'contains') {
                    if (mb_strpos($u2, $a2) !== false) { $isCorrect = true; break; }
                } elseif ($mode === 'regex') {
                    $flags = $cs ? '' : 'i';
                    if (@preg_match('/' . str_replace('/', '\\/', $aStr) . '/' . $flags, $userStr)) { $isCorrect = true; break; }
                } else { // exact
                    if ($u2 === $a2) { $isCorrect = true; break; }
                }
            }
        }
        if ($isCorrect) $correctCount++;
        $details[] = [
            'q_id'          => $qid,
            'correct'       => $isCorrect,
            'user_answer'   => $user,
            'correct_answer'=> $right,
            'explain'       => $q['explain'] ?? '',
        ];
    }
    $percent = (int)round(($correctCount / $total) * 100);
    return [$percent, $details];
}
