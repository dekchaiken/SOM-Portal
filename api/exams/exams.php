<?php
/**
 * Exams — admin CRUD + list (user)
 *
 * GET    /api/exams/exams.php                        → list exams
 *         user (non-admin): only published, with my_attempts/my_best_score
 *         admin: full list incl. drafts
 * GET    /api/exams/exams.php?id=...                 → get one (admin sees full; user sees sanitized)
 * POST   /api/exams/exams.php                        → create (admin)
 * PUT    /api/exams/exams.php?id=...                 → update (admin)
 * DELETE /api/exams/exams.php?id=...                 → delete (admin)
 *
 * GET    /api/exams/exams.php?action=preset&name=basic|standard|strict
 *                                                    → return canonical preset config
 */
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/_lib.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];
$id      = $_GET['id']     ?? '';
$action  = $_GET['action'] ?? '';
$isAdmin = in_array($payload['role'], ADMIN_ROLES);
// Oversight roles read the full catalog (incl. drafts) + per-exam attempt
// counts, but never mutate. Extends $isAdmin's read scope only.
$canReadReports = $isAdmin || in_array($payload['role'], REPORT_READ_ROLES, true);

// ─── Public preset reference ──────────────────────────────────────
if ($method === 'GET' && $action === 'preset') {
    $name = $_GET['name'] ?? 'basic';
    if (!in_array($name, ['basic', 'standard', 'strict', 'custom'], true)) {
        respondError('Unknown preset', 400);
    }
    respondOk([
        'preset' => $name,
        'config' => $name === 'custom' ? examsDefaultConfig() : examsPresetConfig($name),
    ]);
}

if ($method === 'GET') {
    $currentTeamCtx = $GLOBALS['_current_team'] ?? null;

    // Global-read roles with "All Teams" selected ($currentTeamCtx=null) get
    // an aggregated view: every team's exam catalog + attempts are merged so
    // oversight can list team-local exams from all teams and see accurate
    // system-wide attempt counts. Otherwise, the existing per-team behavior
    // stands (each team sees own exams + shared exams from other teams).
    $aggregateAll = $currentTeamCtx === null
                 && in_array($payload['role'] ?? '', GLOBAL_READ_ROLES, true);

    if ($aggregateAll) {
        $exams    = [];
        $attempts = [];
        $seenIds  = [];
        $prevTeam = $GLOBALS['_current_team'];
        foreach (readJson('teams.json') as $t) {
            if (empty($t['active']) || empty($t['slug'])) continue;
            $GLOBALS['_current_team'] = $t['slug'];
            foreach (examsReadJson('exams.json') as $e) {
                $eid = $e['id'] ?? '';
                if (!$eid || isset($seenIds[$eid])) continue;
                $seenIds[$eid] = true;
                $e['owner_team'] = $e['owner_team'] ?? $t['slug'];
                $exams[] = $e;
            }
            foreach (examsReadJson('attempts.json') as $a) {
                $a['_team'] = $t['slug'];
                $attempts[] = $a;
            }
        }
        $GLOBALS['_current_team'] = $prevTeam;
    } else {
        $exams = examsReadJson('exams.json');

        // Merge shared exams owned by OTHER teams (local wins on id collision).
        // Attempts stay team-scoped (examsReadJson('attempts.json') below reads
        // this team's own attempts file), so users' history remains theirs even
        // for shared exams.
        $localIdsCtx = array_flip(array_column($exams, 'id'));
        foreach (examsReadSharedCatalog() as $eid => $sharedEntry) {
            if (($sharedEntry['owner_team'] ?? '') === $currentTeamCtx) continue;
            if (isset($localIdsCtx[$eid])) continue;
            $exams[] = $sharedEntry;
        }

        $attempts = examsReadJson('attempts.json');
    }

    if ($id) {
        $exam = null;
        foreach ($exams as $e) if (($e['id'] ?? '') === $id) { $exam = $e; break; }
        if (!$exam) respondError('Exam not found', 404);
        // Index no longer carries questions — load from per-exam folder
        if (empty($exam['questions'])) {
            $exam['questions'] = examsReadExamFile($id, 'questions.json');
        }
        $exam['course_prerequisites'] = $exam['course_prerequisites'] ?? [];

        if ($isAdmin) {
            // Include course-lock info so admin sees the same gate as regular users
            // (attempts.php enforces course prereq for admin too — surface it in UI)
            $lock = examsCourseLockState($payload['sub'], $exam['course_prerequisites']);
            $exam['my_course_locked']    = $lock['locked'];
            $exam['unmet_course_prereqs'] = $lock['unmet'];
            respondOk($exam);
        }

        if (($exam['status'] ?? 'draft') !== 'published') respondError('Exam not available', 403);

        // Sanitize for user view: hide answers, hide question pool entirely
        // (the actual quiz body is delivered only after start-attempt)
        $safe = $exam;
        unset($safe['questions']);
        unset($safe['config']['anomaly_detection']['similarity_threshold']);
        $myAttempts = array_values(array_filter($attempts, fn($a) =>
            ($a['user_id'] ?? '') === $payload['sub']
            && ($a['exam_id'] ?? '') === $id
            && ($a['status'] ?? '') === 'submitted'));
        $bestScore = 0;
        foreach ($myAttempts as $a) $bestScore = max($bestScore, (int)($a['score'] ?? 0));
        $safe['my_attempts']   = count($myAttempts);
        $safe['my_best_score'] = $bestScore;
        $safe['my_passed']     = $bestScore >= (int)($exam['pass_score'] ?? 70) && count($myAttempts) > 0;
        $safe['questions_count'] = count($exam['questions'] ?? []);
        $safe['pool_enabled']    = !empty($exam['config']['pool']['enabled']);
        $safe['pool_total_show'] = (int)($exam['config']['pool']['total_show'] ?? 0);
        $lock = examsCourseLockState($payload['sub'], $safe['course_prerequisites']);
        $safe['my_course_locked']    = $lock['locked'];
        $safe['unmet_course_prereqs'] = $lock['unmet'];
        respondOk($safe);
    }

    // List
    $out = [];
    // Load course/phase/progress once for batch course-lock annotation
    $courseCache = examsLoadCourseProgressCache();
    foreach ($exams as $e) {
        if (!$canReadReports && ($e['status'] ?? 'draft') !== 'published') continue;
        $coursePrereqs = $e['course_prerequisites'] ?? [];
        $row = [
            'id'                  => $e['id'],
            'title'               => $e['title']        ?? '',
            'subtitle'            => $e['subtitle']     ?? '',
            'description'         => $e['description']  ?? '',
            'icon'                => $e['icon']         ?? '📝',
            'cover_color'         => $e['cover_color']  ?? '#f26419',
            'status'              => $e['status']       ?? 'draft',
            'preset'              => $e['preset']       ?? 'basic',
            'pass_score'          => (int)($e['pass_score'] ?? 70),
            'flags'               => $e['flags']        ?? new stdClass(),
            'max_attempts'        => (int)($e['config']['attempts']['max'] ?? 1),
            'course_prerequisites'=> $coursePrereqs,
            'is_popular'          => !empty($e['is_popular']),
            // Index no longer carries questions inline — count from per-exam folder
            'questions_count'     => count($e['questions'] ?? examsReadExamFile($e['id'], 'questions.json')),
            'pool_enabled'        => !empty($e['config']['pool']['enabled']),
            'pool_total_show'     => (int)($e['config']['pool']['total_show'] ?? 0),
            'created_at'          => $e['created_at']   ?? '',
            'updated_at'          => $e['updated_at']   ?? '',
        ];
        $lock = examsCourseLockState($payload['sub'], $coursePrereqs, $courseCache);
        $row['my_course_locked']     = $lock['locked'];
        $row['unmet_course_prereqs'] = $lock['unmet'];
        // Personal stats — surface for everyone (admin also wants to see
        // "Best 80%" on their own cards when they've tested an exam)
        $myA = 0; $best = 0;
        foreach ($attempts as $a) {
            if (($a['user_id'] ?? '') !== $payload['sub']) continue;
            if (($a['exam_id'] ?? '') !== $e['id'])        continue;
            if (($a['status']  ?? '') !== 'submitted')     continue;
            $myA++;
            $best = max($best, (int)($a['score'] ?? 0));
        }
        $row['my_attempts']   = $myA;
        $row['my_best_score'] = $best;
        $row['my_passed']     = $myA > 0 && $best >= (int)($e['pass_score'] ?? 70);

        if (!empty($e['config']['exam_window']['enabled'])) {
            $row['exam_window'] = $e['config']['exam_window'];
        }

        if ($canReadReports) {
            // Admin/oversight overview — system-wide attempt counts
            $sub = 0; $ip = 0;
            foreach ($attempts as $a) {
                if (($a['exam_id'] ?? '') !== $e['id']) continue;
                if (($a['status'] ?? '') === 'submitted')   $sub++;
                if (($a['status'] ?? '') === 'in_progress') $ip++;
            }
            $row['attempts_submitted']   = $sub;
            $row['attempts_in_progress'] = $ip;
            // Always include exam_window for admin (for window picker)
            $row['exam_window'] = $e['config']['exam_window'] ?? null;
        }
        $out[] = $row;
    }
    respondOk($out);
}

// ─── Admin-only mutations from here on ────────────────────────────
requireRole($payload, ADMIN_ROLES);

if ($method === 'POST') {
    requireCsrf();
    $body = getBody();
    $title = trim($body['title'] ?? '');
    if (!$title) respondError('title is required');

    $preset = $body['preset'] ?? 'basic';
    if (!in_array($preset, ['basic','standard','strict','custom'], true)) $preset = 'custom';

    $cfg = examsMergeConfig(
        examsPresetConfig($preset === 'custom' ? 'basic' : $preset),
        is_array($body['config'] ?? null) ? $body['config'] : []
    );
    $questions = is_array($body['questions'] ?? null) ? $body['questions'] : [];

    [$ok, $err] = examsValidateConfig($cfg, count($questions));
    if (!$ok) respondError($err);

    // Assign IDs to new questions
    foreach ($questions as &$q) {
        if (empty($q['id'])) $q['id'] = genId('q');
    }
    unset($q);

    $newId = genId('exam');
    $shared = (bool)($body['shared'] ?? false);
    $prereqs = array_values(array_filter(
        (array)($body['course_prerequisites'] ?? []),
        fn($x) => is_string($x) && $x !== ''
    ));
    if ($shared) examsValidateSharedTransition($newId, true, $prereqs);
    $exam = [
        'id'           => $newId,
        'title'        => $title,
        'subtitle'     => trim($body['subtitle']    ?? ''),
        'description'  => trim($body['description'] ?? ''),
        'icon'         => $body['icon']         ?? '📝',
        'cover_color'  => $body['cover_color']  ?? '#f26419',
        'status'       => in_array($body['status'] ?? 'draft', ['draft','published','archived'], true)
                           ? $body['status'] : 'draft',
        'preset'       => $preset,
        'pass_score'   => max(0, min(100, (int)($body['pass_score'] ?? 70))),
        'course_prerequisites' => $prereqs,
        'is_popular'   => (bool)($body['is_popular'] ?? false),
        'shared'       => $shared,
        'owner_team'   => $GLOBALS['_current_team'] ?? null,
        'config'       => $cfg,
        'created_by'   => $payload['sub'],
        'created_at'   => date('c'),
        'updated_at'   => date('c'),
    ];

    // Persist questions to per-exam folder, keep index entry slim
    examsEnsureExamDir($newId);
    examsWriteExamFile($newId, 'questions.json', $questions);

    $all = examsReadJson('exams.json');
    $all[] = $exam;
    examsWriteJson('exams.json', $all);
    logActivity('exam_create', ['id' => $newId, 'title' => $title, 'questions' => count($questions), 'shared' => $shared], $payload['sub'], $payload['name']);
    if ($shared) {
        logActivity('exam_share_enabled', ['id' => $newId, 'title' => $title], $payload['sub'], $payload['name']);
    }

    // Audit log inside the exam folder too
    examsAppendEvent($newId, [
        'type' => 'exam_create',
        'label' => 'สร้างข้อสอบ',
        'user_id' => $payload['sub'],
        'user_name' => $payload['name'] ?? '',
        'data' => ['title' => $title, 'questions' => count($questions), 'preset' => $preset],
    ]);

    // Return full exam (with questions) to admin UI
    $exam['questions'] = $questions;
    respondOk($exam, 'Exam created');
}

if ($method === 'PUT') {
    requireCsrf();
    if (!$id) respondError('Exam ID required');
    $body = getBody();

    // Reject cross-team edits BEFORE loading — mirrors the courses.php PUT.
    examsRequireOwnerForShared($id, $payload);

    $all = examsReadJson('exams.json');
    $idx = -1;
    foreach ($all as $i => $e) if (($e['id'] ?? '') === $id) { $idx = $i; break; }
    if ($idx < 0) respondError('Exam not found', 404);

    $exam = $all[$idx];
    $wasShared = (bool)($exam['shared'] ?? false);
    $becameShared = null; // null = untouched, true = enabled, false = disabled
    $assign = ['title','subtitle','description','icon','cover_color','status','preset'];
    foreach ($assign as $k) if (array_key_exists($k, $body)) $exam[$k] = $body[$k];
    if (isset($body['pass_score']))
        $exam['pass_score'] = max(0, min(100, (int)$body['pass_score']));
    if (array_key_exists('course_prerequisites', $body)) {
        $exam['course_prerequisites'] = array_values(array_filter(
            (array)$body['course_prerequisites'],
            fn($x) => is_string($x) && $x !== ''
        ));
    }
    if (array_key_exists('is_popular', $body)) {
        $exam['is_popular'] = (bool)$body['is_popular'];
    }
    if (array_key_exists('shared', $body)) {
        $newShared = (bool)$body['shared'];
        if ($newShared !== $wasShared) $becameShared = $newShared;
        if ($newShared) {
            examsValidateSharedTransition($id, true, $exam['course_prerequisites'] ?? []);
        }
        $exam['shared'] = $newShared;
    }
    $exam['owner_team'] = $exam['owner_team'] ?? ($GLOBALS['_current_team'] ?? null);
    if (!in_array($exam['status'] ?? 'draft', ['draft','published','archived'], true))
        $exam['status'] = 'draft';

    $questionsTouched = false;
    if (isset($body['questions']) && is_array($body['questions'])) {
        foreach ($body['questions'] as &$q) {
            if (empty($q['id'])) $q['id'] = genId('q');
        }
        unset($q);
        examsWriteExamFile($id, 'questions.json', $body['questions']);
        $questionsTouched = true;
    }
    if (isset($body['config']) && is_array($body['config'])) {
        $base = examsPresetConfig(($exam['preset'] ?? 'basic') === 'custom' ? 'basic' : ($exam['preset'] ?? 'basic'));
        $exam['config'] = examsMergeConfig($base, $body['config']);
    }

    // Validate against current pool (per-folder)
    $currentQs = examsReadExamFile($id, 'questions.json');
    [$ok, $err] = examsValidateConfig($exam['config'], count($currentQs));
    if (!$ok) respondError($err);

    // Make sure no inline questions sneak back into index
    unset($exam['questions']);
    $exam['updated_at'] = date('c');
    $all[$idx] = $exam;
    examsWriteJson('exams.json', $all);

    logActivity('exam_update', ['id' => $id, 'questions_touched' => $questionsTouched], $payload['sub'], $payload['name']);
    if ($becameShared === true) {
        logActivity('exam_share_enabled', ['id' => $id], $payload['sub'], $payload['name']);
    } elseif ($becameShared === false) {
        logActivity('exam_share_disabled', ['id' => $id], $payload['sub'], $payload['name']);
    }
    examsAppendEvent($id, [
        'type' => 'exam_update',
        'label' => 'แก้ไขข้อสอบ',
        'user_id' => $payload['sub'],
        'user_name' => $payload['name'] ?? '',
        'data' => ['questions_touched' => $questionsTouched, 'questions_count' => count($currentQs)],
    ]);

    $exam['questions'] = $currentQs;
    respondOk($exam, 'Exam updated');
}

if ($method === 'DELETE') {
    requireCsrf();
    if (!$id) respondError('Exam ID required');

    // Only the owning team can delete a shared exam.
    examsRequireOwnerForShared($id, $payload);

    $all = examsReadJson('exams.json');
    $filtered = array_values(array_filter($all, fn($e) => ($e['id'] ?? '') !== $id));
    if (count($filtered) === count($all)) respondError('Exam not found', 404);
    examsWriteJson('exams.json', $filtered);

    // Drop the per-exam folder (questions + events)
    examsRemoveExamDir($id);

    logActivity('exam_delete', ['id' => $id], $payload['sub'], $payload['name']);
    respondOk(null, 'Exam deleted');
}

respondError('Method not allowed', 405);
