<?php
/**
 * Exams — shared helpers
 *
 * Storage layout:
 *   data/exams/exams.json            — exam index (id, title, status, config — NO questions)
 *   data/exams/attempts.json         — cross-exam attempt records
 *   data/exams/<exam_id>/questions.json  — question pool for that exam
 *   data/exams/<exam_id>/events.json     — human-readable audit log for that exam
 */

// Course progress lookup — reused for exam course_prerequisites gating
require_once __DIR__ . '/../courses/_lib.php';

// ── Team-scoped root: data/{team}/exams/ ─────────────────────────────────
// If no team context is set, route to a sentinel path that never holds data —
// same rationale as _coursesRoot(): the old 'sm' fallback leaked SM's exams
// to any request whose JWT was missing the 'team' claim.
function _examsRoot(): string {
    $team = $GLOBALS['_current_team'] ?? null;
    if ($team === '' || $team === null) $team = '__no_team__';
    return DATA_DIR . $team . '/exams/';
}

// ── Root-level helpers (exams.json index, attempts.json) ──
function examsReadJson(string $file): array {
    $path = _examsRoot() . $file;
    if (!file_exists($path)) return [];
    $json = file_get_contents($path);
    return json_decode($json, true) ?? [];
}

function examsWriteJson(string $file, array $data): bool {
    $dir = _examsRoot();
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
// An exam entry is "shared" when its owning team flipped shared:true in its
// own exams.json. Any team can then see it in their list — but only the
// owning team's admin can edit exam config (see write guards in the endpoint
// files). Attempt records still stay per-team (data/{team}/exams/attempts.json)
// because they belong to the person taking the exam, not the exam author.
//
// Result is memoised per request. Mirrors coursesReadSharedCatalog().
function examsReadSharedCatalog(): array {
    static $cache = null;
    if ($cache !== null) return $cache;
    $out = [];
    $teams = readJson('teams.json');
    foreach ($teams as $t) {
        $slug = $t['slug'] ?? '';
        if (!$slug || empty($t['active'])) continue;
        $path = DATA_DIR . $slug . '/exams/exams.json';
        if (!file_exists($path)) continue;
        $rows = json_decode((string)file_get_contents($path), true);
        if (!is_array($rows)) continue;
        foreach ($rows as $e) {
            if (empty($e['shared'])) continue;
            if (empty($e['owner_team'])) $e['owner_team'] = $slug;
            $out[$e['id'] ?? ''] = $e;
        }
    }
    unset($out['']);
    $cache = $out;
    return $cache;
}

function examsIsShared(string $examId): bool {
    return isset(examsReadSharedCatalog()[$examId]);
}

/** Returns the owning team slug for a shared exam, or null if not shared. */
function examsGetOwnerTeam(string $examId): ?string {
    $catalog = examsReadSharedCatalog();
    return $catalog[$examId]['owner_team'] ?? null;
}

// ── Write guards ────────────────────────────────────────────────────────
// Matches coursesRequireOwnerForShared() semantics: only the owning team's
// admins can mutate the exam config. Attempts, events, and reports are still
// team-scoped for readers, so those endpoints do NOT go through this guard.
function examsRequireOwnerForShared(string $examId, array $payload): void {
    if (!examsIsShared($examId)) return;
    $owner = examsGetOwnerTeam($examId);
    $team  = $GLOBALS['_current_team'] ?? null;
    if ($team && $owner && $team !== $owner) {
        respondError(
            'Shared exam "' . $examId . '" is managed by team "' . $owner
            . '" — team "' . $team . '" cannot edit',
            403
        );
    }
}

/**
 * Validate that a shared-exam transition is legal.
 *   • Cross-team ID collision — another team already sharing this eid → 409.
 *   • course_prerequisites must all be shared courses. Rationale: a shared
 *     exam is visible to every team; if the prereq course is local to team A,
 *     users from team B could never unlock the exam.
 * $coursePrereqs may be null when the caller didn't touch the field.
 */
function examsValidateSharedTransition(string $examId, bool $newShared, ?array $coursePrereqs): void {
    if (!$newShared) return; // becoming non-shared is always safe

    // Collision
    $callerTeam = $GLOBALS['_current_team'] ?? null;
    foreach (examsReadSharedCatalog() as $eid => $entry) {
        if ($eid !== $examId) continue;
        $owner = $entry['owner_team'] ?? '';
        if ($owner && $owner !== $callerTeam) {
            respondError(
                'Exam id "' . $examId . '" is already shared by team "'
                . $owner . '" — cannot share the same id from two teams',
                409
            );
        }
    }

    // Course prereqs must all be shared courses (or this exam would lock
    // learners from any team that doesn't have that local course).
    if ($coursePrereqs !== null && $coursePrereqs) {
        $sharedCourses = coursesReadSharedCatalog();
        foreach ($coursePrereqs as $cid) {
            if (!is_string($cid) || $cid === '') continue;
            if (!isset($sharedCourses[$cid])) {
                respondError(
                    'Shared exam cannot depend on non-shared course "' . $cid
                    . '" — mark the prerequisite course as shared first or remove it',
                    400
                );
            }
        }
    }
}

// ── Per-exam folder helpers ──────────────────────────────
// Shared exams live in the owner team's folder — reads (questions), writes
// (question pool edits by owner), and audit-log appends (events.json) all
// go there regardless of which team's user is hitting the endpoint. Attempts
// are tracked separately in _examsRoot()/attempts.json, so learners' attempt
// records stay with their own team.
function examsExamDir(string $examId): string {
    $owner = examsGetOwnerTeam($examId);
    if ($owner !== null) {
        return DATA_DIR . $owner . '/exams/' . $examId . '/';
    }
    return _examsRoot() . $examId . '/';
}

function examsEnsureExamDir(string $examId): void {
    $dir = examsExamDir($examId);
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    foreach (['questions.json', 'events.json'] as $f) {
        $p = $dir . $f;
        if (!file_exists($p)) file_put_contents($p, "[]\n");
    }
}

function examsReadExamFile(string $examId, string $file): array {
    $path = examsExamDir($examId) . $file;
    if (!file_exists($path)) return [];
    return json_decode((string)file_get_contents($path), true) ?? [];
}

function examsWriteExamFile(string $examId, string $file, array $data): bool {
    examsEnsureExamDir($examId);
    $path = examsExamDir($examId) . $file;
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

function examsRemoveExamDir(string $examId): void {
    $dir = examsExamDir($examId);
    if (!is_dir($dir)) return;
    foreach (['questions.json', 'events.json'] as $f) {
        $p = $dir . $f;
        if (file_exists($p)) @unlink($p);
    }
    @rmdir($dir);
}

/**
 * Append one event row to <exam_id>/events.json.
 * Each entry: { ts, type, label, attempt_id?, user_id, user_name, ip, user_agent, data{} }
 * Never auto-rotates; admin can archive manually.
 */
function examsAppendEvent(string $examId, array $event): void {
    examsEnsureExamDir($examId);
    $path = examsExamDir($examId) . 'events.json';
    $fp = fopen($path, 'c+');
    if (!$fp) return;
    if (flock($fp, LOCK_EX)) {
        $raw = stream_get_contents($fp);
        $rows = json_decode($raw, true);
        if (!is_array($rows)) $rows = [];
        // Enrich with request context if missing
        $event['ts']         = $event['ts']         ?? date('c');
        $event['ip']         = $event['ip']         ?? ($_SERVER['REMOTE_ADDR']     ?? '');
        $event['user_agent'] = $event['user_agent'] ?? ($_SERVER['HTTP_USER_AGENT'] ?? '');
        $rows[] = $event;
        ftruncate($fp, 0);
        rewind($fp);
        fwrite($fp, json_encode($rows, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        flock($fp, LOCK_UN);
    }
    fclose($fp);
}

/**
 * Canonical default config for a brand-new exam.
 * Each feature is { enabled: bool, ...settings }.
 * When the admin saves, the incoming config is deep-merged on top of this
 * so unknown / missing keys always fall back to a safe value.
 */
function examsDefaultConfig(): array {
    return [
        // ─── Tier 1 — foundation (always on by default) ─────────────
        'pool' => [
            'enabled'     => true,
            'total_show'  => 20,        // how many to actually show per attempt (0 = all)
            'stratified'  => false,     // if true, draw per category
            'categories'  => [],        // [{ name:'Networking', count:5 }, ...]
        ],
        'shuffle_questions' => ['enabled' => true],
        'shuffle_choices'   => ['enabled' => true],
        'attempts' => [
            'enabled'          => true,
            'max'              => 1,    // 0 = unlimited
            'cooldown_minutes' => 0,
        ],
        'time_limit' => [
            'enabled'              => true,
            'mode'                 => 'total',   // total | per_question | both
            'total_minutes'        => 60,
            'per_question_seconds' => 0,
        ],
        // server_scoring is implicit — answers never leave the server.

        // ─── Tier 2 — deterrents ────────────────────────────────────
        'one_at_a_time' => [
            'enabled'    => false,
            'allow_back' => true,
        ],
        'tab_detection' => [
            'enabled'        => false,
            'max_violations' => 3,
            'action'         => 'log',   // log | warn | penalty | force_submit
            'penalty_pct'    => 10,
        ],
        'watermark' => [
            'enabled' => false,
            'opacity' => 0.15,
            'text'    => '{username} • {email}',
        ],
        'exam_window' => [
            'enabled'      => false,
            'start'        => null,      // ISO 8601
            'end'          => null,
            'synchronized' => false,     // everyone starts at 'start'
        ],
        'lazy_fetch' => ['enabled' => false],

        // ─── Tier 3 — strict ────────────────────────────────────────
        'fullscreen_lock' => [
            'enabled'        => false,
            'max_violations' => 2,
            'action'         => 'log',
        ],
        'disable_copy_paste' => ['enabled' => false],
        'anomaly_detection'  => [
            'enabled'                 => false,
            'speed_threshold_seconds' => 5,
            'similarity_threshold'    => 0.95,
        ],

        // ─── Result visibility ──────────────────────────────────────
        'show_results' => [
            'mode'           => 'after_submit',  // after_submit | after_window | never
            'show_answers'   => false,
            'show_explains'  => false,
        ],

        // ─── Policy / consent (shown above the "Start" button) ─────
        'policy' => [
            'enabled'         => false,
            'title'           => 'ข้อตกลงและคำยินยอม',
            'content'         => '',
            'require_consent' => true,
            'consent_label'   => 'ฉันรับทราบและยินยอมตามเงื่อนไขข้างต้น',
        ],
    ];
}

/** Deep-merge user config on top of defaults. */
function examsMergeConfig(array $defaults, array $user): array {
    foreach ($user as $k => $v) {
        if (is_array($v) && isset($defaults[$k]) && is_array($defaults[$k])) {
            $defaults[$k] = examsMergeConfig($defaults[$k], $v);
        } else {
            $defaults[$k] = $v;
        }
    }
    return $defaults;
}

/** Preset → partial config. Used by admin UI as starting point. */
function examsPresetConfig(string $preset): array {
    $cfg = examsDefaultConfig();
    if ($preset === 'basic') {
        // Tier 1 already on by default — nothing more
        return $cfg;
    }
    if ($preset === 'standard') {
        $cfg['one_at_a_time']['enabled'] = true;
        $cfg['tab_detection']['enabled'] = true;
        $cfg['watermark']['enabled']     = true;
        $cfg['exam_window']['enabled']   = false;  // admin sets manually
        $cfg['lazy_fetch']['enabled']    = true;
        return $cfg;
    }
    if ($preset === 'strict') {
        $cfg['one_at_a_time']['enabled']        = true;
        $cfg['one_at_a_time']['allow_back']     = false;
        $cfg['tab_detection']['enabled']        = true;
        $cfg['tab_detection']['action']         = 'penalty';
        $cfg['watermark']['enabled']            = true;
        $cfg['lazy_fetch']['enabled']           = true;
        $cfg['fullscreen_lock']['enabled']      = true;
        $cfg['disable_copy_paste']['enabled']   = true;
        $cfg['anomaly_detection']['enabled']    = true;
        return $cfg;
    }
    return $cfg;
}

/** Validate config; returns [okBool, errMsg]. Mutates safe defaults. */
function examsValidateConfig(array &$cfg, int $totalQuestions): array {
    if (!empty($cfg['pool']['enabled'])) {
        $show = (int)($cfg['pool']['total_show'] ?? 0);
        if ($show < 0) return [false, 'pool.total_show must be ≥ 0'];
        if ($show > 0 && $totalQuestions > 0 && $show > $totalQuestions) {
            return [false, "ตั้งสุ่ม $show ข้อ แต่คลังมีเพียง $totalQuestions ข้อ"];
        }
        if (!empty($cfg['pool']['stratified'])) {
            $sum = 0;
            foreach ($cfg['pool']['categories'] ?? [] as $c) $sum += (int)($c['count'] ?? 0);
            if ($show > 0 && $sum !== $show) {
                return [false, "ผลรวมของแต่ละหมวด ($sum) ต้องเท่ากับจำนวนข้อที่แสดง ($show)"];
            }
        }
    }
    if (!empty($cfg['time_limit']['enabled'])) {
        $mode = $cfg['time_limit']['mode'] ?? 'total';
        if (!in_array($mode, ['total', 'per_question', 'both'], true)) {
            return [false, 'time_limit.mode invalid'];
        }
        if (in_array($mode, ['total','both']) && (int)$cfg['time_limit']['total_minutes'] <= 0) {
            return [false, 'time_limit.total_minutes must be > 0'];
        }
        if (in_array($mode, ['per_question','both']) && (int)$cfg['time_limit']['per_question_seconds'] <= 0) {
            return [false, 'time_limit.per_question_seconds must be > 0'];
        }
    }
    if (!empty($cfg['exam_window']['enabled'])) {
        $s = $cfg['exam_window']['start'] ?? null;
        $e = $cfg['exam_window']['end']   ?? null;
        if (!$s || !$e) return [false, 'exam_window: ต้องระบุเวลาเริ่มและสิ้นสุด'];
        if (strtotime($e) <= strtotime($s)) return [false, 'exam_window: end must be after start'];
    }
    if (!empty($cfg['anomaly_detection']['enabled']) && empty($cfg['tab_detection']['enabled'])) {
        // soft warning — auto-enable tab detection
        $cfg['tab_detection']['enabled'] = true;
    }
    return [true, ''];
}

/**
 * Get exam by id. Loads index entry from exams.json, then lazily loads
 * questions from <exam_id>/questions.json if not already inline.
 * Backwards-compatible with the old single-file layout: if the index
 * entry already has 'questions', returns it as-is.
 */
function examsGet(string $id): ?array {
    foreach (examsReadJson('exams.json') as $e) {
        if (($e['id'] ?? '') === $id) {
            if (!isset($e['questions']) || !is_array($e['questions']) || !$e['questions']) {
                $e['questions'] = examsReadExamFile($id, 'questions.json');
            }
            return $e;
        }
    }
    // Local miss — check shared catalog (exam owned by another team). Questions
    // are still loaded via examsReadExamFile, which routes to the owner team's
    // folder for shared exams.
    $shared = examsReadSharedCatalog();
    if (isset($shared[$id])) {
        $e = $shared[$id];
        if (!isset($e['questions']) || !is_array($e['questions']) || !$e['questions']) {
            $e['questions'] = examsReadExamFile($id, 'questions.json');
        }
        return $e;
    }
    return null;
}

/** Get exam index entry only — no questions loaded (cheap, for list views). */
function examsGetMeta(string $id): ?array {
    foreach (examsReadJson('exams.json') as $e) {
        if (($e['id'] ?? '') === $id) {
            unset($e['questions']);
            return $e;
        }
    }
    $shared = examsReadSharedCatalog();
    if (isset($shared[$id])) {
        $e = $shared[$id];
        unset($e['questions']);
        return $e;
    }
    return null;
}

/**
 * Exam IDs reachable from the current team's viewpoint: everything in the
 * team's own exams.json plus any shared exam from another team (local wins on
 * id collision). Mirrors _coursesReachableIds() and is here for future scans
 * that need to walk the full catalog (e.g. batch reports).
 */
function _examsReachableIds(): array {
    $out = [];
    foreach (examsReadJson('exams.json') as $e) {
        if (!empty($e['id'])) $out[] = $e['id'];
    }
    $localSet = array_flip($out);
    foreach (examsReadSharedCatalog() as $eid => $entry) {
        if ($eid === '' || isset($localSet[$eid])) continue;
        $out[] = $eid;
    }
    return $out;
}

/** Strip secrets from question (answer, explain) before sending to user. */
function examsSanitizeQuestion(array $q): array {
    unset($q['answer']);
    unset($q['explain']);
    unset($q['match_mode']);
    unset($q['case_sensitive']);
    return $q;
}

/** Build question pool for one attempt according to config. */
function examsBuildAttemptPool(array $exam, array $cfg): array {
    $all = $exam['questions'] ?? [];
    if (!$all) return [];

    if (empty($cfg['pool']['enabled'])) return $all;

    $show = (int)($cfg['pool']['total_show'] ?? 0);
    if ($show <= 0 || $show >= count($all)) return $all;

    if (!empty($cfg['pool']['stratified']) && !empty($cfg['pool']['categories'])) {
        $picked = [];
        foreach ($cfg['pool']['categories'] as $cat) {
            $name  = $cat['name']  ?? '';
            $count = (int)($cat['count'] ?? 0);
            if ($count <= 0) continue;
            $bucket = array_values(array_filter($all, fn($q) => ($q['category'] ?? '') === $name));
            shuffle($bucket);
            $picked = array_merge($picked, array_slice($bucket, 0, $count));
        }
        return $picked;
    }

    // Plain random sampling
    $keys = array_keys($all);
    shuffle($keys);
    $keys = array_slice($keys, 0, $show);
    $out = [];
    foreach ($keys as $k) $out[] = $all[$k];
    return $out;
}

/**
 * Score a single submitted answer.
 * Returns boolean correctness.
 */
function examsCheckAnswer(array $q, $user): bool {
    $type  = $q['type'] ?? 'single';
    $right = $q['answer'] ?? null;
    // Unanswered → always wrong, never count as correct
    if ($user === null) return false;
    if ($type === 'single') {
        return ((int)$user === (int)$right);
    }
    if ($type === 'truefalse') {
        // Must be a real boolean — not null cast to false
        if (!is_bool($user)) return false;
        return ($user === (bool)$right);
    }
    if ($type === 'multi') {
        if (!is_array($user) || count($user) === 0) return false;
        $u = array_map('intval', $user);
        $r = is_array($right) ? array_map('intval', $right) : [];
        sort($u); sort($r);
        return ($u === $r);
    }
    if ($type === 'short') {
        $userStr = is_string($user) ? trim($user) : '';
        if ($userStr === '') return false;
        $accepted = is_array($right) ? $right : [(string)$right];
        $mode = $q['match_mode'] ?? 'exact';
        $cs   = !empty($q['case_sensitive']);
        foreach ($accepted as $a) {
            $aStr = trim((string)$a);
            if ($aStr === '') continue;
            $u2 = $cs ? $userStr : mb_strtolower($userStr);
            $a2 = $cs ? $aStr    : mb_strtolower($aStr);
            if ($mode === 'contains') {
                if (mb_strpos($u2, $a2) !== false) return true;
            } elseif ($mode === 'regex') {
                $flags = $cs ? '' : 'i';
                if (@preg_match('/' . str_replace('/', '\\/', $aStr) . '/' . $flags, $userStr)) return true;
            } else {
                if ($u2 === $a2) return true;
            }
        }
        return false;
    }
    return false;
}

/** Count attempts for (user, exam). */
function examsUserAttemptCount(string $userId, string $examId): int {
    $n = 0;
    foreach (examsReadJson('attempts.json') as $a) {
        if (($a['user_id'] ?? '') === $userId && ($a['exam_id'] ?? '') === $examId
            && ($a['status'] ?? '') === 'submitted') $n++;
    }
    return $n;
}

/** Find user's in-progress attempt (if any). */
function examsActiveAttempt(string $userId, string $examId): ?array {
    foreach (examsReadJson('attempts.json') as $a) {
        if (($a['user_id'] ?? '') === $userId
            && ($a['exam_id'] ?? '') === $examId
            && ($a['status'] ?? '') === 'in_progress') return $a;
    }
    return null;
}

/** Check if exam window is currently open. Returns [okBool, reasonStr]. */
function examsWindowOpen(array $cfg): array {
    if (empty($cfg['exam_window']['enabled'])) return [true, ''];
    $now = time();
    $s = strtotime($cfg['exam_window']['start'] ?? '');
    $e = strtotime($cfg['exam_window']['end']   ?? '');
    if ($s && $now < $s) return [false, 'ยังไม่ถึงเวลาสอบ (เริ่ม ' . date('Y-m-d H:i', $s) . ')'];
    if ($e && $now > $e) return [false, 'หมดเวลาสอบแล้ว (สิ้นสุด ' . date('Y-m-d H:i', $e) . ')'];
    return [true, ''];
}

/** Generate a per-question shuffled choice order map, e.g. q1 → [2,0,1,3]. */
function examsBuildChoiceOrders(array $questions, bool $enabled): array {
    $map = [];
    foreach ($questions as $q) {
        $qid = $q['id'] ?? '';
        if (!$qid) continue;
        if (($q['type'] ?? '') === 'truefalse' || ($q['type'] ?? '') === 'short') continue;
        $n = count($q['choices'] ?? []);
        if ($n <= 1) continue;
        $idx = range(0, $n - 1);
        if ($enabled) shuffle($idx);
        $map[$qid] = $idx;
    }
    return $map;
}

/** Apply a choice-order map: build a shuffled-view question for the user. */
function examsApplyChoiceOrder(array $q, array $order): array {
    if (!$order || empty($q['choices'])) return $q;
    $shuf = [];
    foreach ($order as $origIdx) {
        $shuf[] = $q['choices'][$origIdx] ?? '';
    }
    $q['choices'] = $shuf;
    return $q;
}

/**
 * Compute course-prerequisite lock for an exam.
 * Returns ['locked' => bool, 'unmet' => [['id'=>..., 'title'=>...], ...]].
 *
 * If $cache is provided as ['courses'=>..., 'phases'=>..., 'progress'=>...]
 * the costly file reads are skipped — pass this when annotating a list of
 * exams so we read the courses tree only once.
 */
function examsCourseLockState(string $userId, array $courseIds, ?array $cache = null): array {
    $courseIds = array_values(array_filter(
        $courseIds,
        fn($x) => is_string($x) && $x !== ''
    ));
    if (!$courseIds) return ['locked' => false, 'unmet' => []];

    if ($cache && isset($cache['courses'], $cache['phases'], $cache['progress'])) {
        $allCourses  = $cache['courses'];
        $allPhases   = $cache['phases'];
        $allProgress = $cache['progress'];
    } else {
        $allCourses  = coursesReadJson('courses.json');
        $allPhases   = coursesReadAllPhases();
        $allProgress = coursesReadJson('progress.json');
    }

    $unmet = [];
    foreach ($courseIds as $cid) {
        $title = $cid;
        foreach ($allCourses as $c) if (($c['id'] ?? '') === $cid) { $title = $c['title']; break; }
        if (!coursesIsCourseCompleted($userId, $cid, $allPhases, $allProgress)) {
            $unmet[] = ['id' => $cid, 'title' => $title];
        }
    }
    return ['locked' => !empty($unmet), 'unmet' => $unmet];
}

/** Load courses+phases+progress once for batch exam annotation. */
function examsLoadCourseProgressCache(): array {
    return [
        'courses'  => coursesReadJson('courses.json'),
        'phases'   => coursesReadAllPhases(),
        'progress' => coursesReadJson('progress.json'),
    ];
}

/** Reverse choice order: convert user's shuffled index → original index. */
function examsUnmapAnswer(string $type, $userAns, array $order) {
    // Preserve null/empty — unanswered must stay unanswered so the scorer
    // can reject it instead of (int)null → 0 → "answered choice A".
    if ($userAns === null) return null;
    if (!$order) return $userAns;
    if ($type === 'single') {
        $i = (int)$userAns;
        return $order[$i] ?? $i;
    }
    if ($type === 'multi') {
        if (!is_array($userAns)) return $userAns;
        $out = [];
        foreach ($userAns as $i) $out[] = $order[(int)$i] ?? (int)$i;
        return $out;
    }
    return $userAns;
}
