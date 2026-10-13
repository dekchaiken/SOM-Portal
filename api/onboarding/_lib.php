<?php
/**
 * Onboarding — shared helpers
 * Data lives under data/onboarding/*.json
 */

// UPLOADS stays global (shared media) but data goes per-team via teamDataPath().
define('ONBOARDING_UPLOADS_DIR', UPLOADS_DIR . 'onboarding/');

function _onboardingDir(): string {
    return teamDataPath('onboarding/');
}

function onboardingReadJson(string $file) {
    $path = _onboardingDir() . $file;
    if (!file_exists($path)) return null;
    $json = file_get_contents($path);
    return json_decode($json, true);
}

function onboardingWriteJson(string $file, $data): bool {
    $dir = _onboardingDir();
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    $path = $dir . $file;
    $fp = fopen($path, 'c+');
    if (!$fp) return false;
    if (flock($fp, LOCK_EX)) {
        ftruncate($fp, 0);
        rewind($fp);
        fwrite($fp, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        flock($fp, LOCK_UN);
    }
    fclose($fp);
    return true;
}

function onboardingGetConfig(): array {
    $cfg = onboardingReadJson('config.json');
    if (!is_array($cfg)) return ['version' => 1, 'chapters' => [], 'flow_architecture' => null];
    if (!isset($cfg['chapters']) || !is_array($cfg['chapters'])) $cfg['chapters'] = [];
    usort($cfg['chapters'], fn($a, $b) => (int)($a['order'] ?? 0) - (int)($b['order'] ?? 0));
    return $cfg;
}

function onboardingGetProgress(string $userId): array {
    $all = onboardingReadJson('progress.json');
    if (!is_array($all)) $all = [];
    foreach ($all as $row) {
        if (($row['user_id'] ?? '') === $userId) return $row;
    }
    return [
        'user_id'          => $userId,
        'completed_tasks'  => new stdClass(),
        'notebook'         => new stdClass(),
        'finished_at'      => null,
        'created_at'       => date('c'),
        'updated_at'       => date('c'),
    ];
}

function onboardingUpsertProgress(string $userId, array $patch): array {
    $all = onboardingReadJson('progress.json');
    if (!is_array($all)) $all = [];
    $found = false;
    $result = null;
    foreach ($all as &$row) {
        if (($row['user_id'] ?? '') === $userId) {
            foreach ($patch as $k => $v) $row[$k] = $v;
            $row['updated_at'] = date('c');
            $result = $row;
            $found = true;
            break;
        }
    }
    unset($row);
    if (!$found) {
        $result = array_merge([
            'user_id'         => $userId,
            'completed_tasks' => [],
            'notebook'        => [],
            'finished_at'     => null,
            'created_at'      => date('c'),
            'updated_at'      => date('c'),
        ], $patch);
        $all[] = $result;
    }
    onboardingWriteJson('progress.json', $all);
    return $result;
}

/** Convert completed_tasks (may come as object or array) to normalized array form */
function onboardingNormalizeCompletedTasks($raw): array {
    $out = [];
    if (is_array($raw)) {
        foreach ($raw as $k => $v) {
            $out[(string)$k] = array_values(array_unique(array_map('strval', is_array($v) ? $v : [])));
        }
    } elseif (is_object($raw)) {
        foreach ((array)$raw as $k => $v) {
            $out[(string)$k] = array_values(array_unique(array_map('strval', is_array($v) ? $v : [])));
        }
    }
    return $out;
}

function onboardingNormalizeNotebook($raw): array {
    $out = [];
    if (is_array($raw)) {
        foreach ($raw as $k => $v) $out[(string)$k] = (string)$v;
    } elseif (is_object($raw)) {
        foreach ((array)$raw as $k => $v) $out[(string)$k] = (string)$v;
    }
    return $out;
}

/**
 * Normalize quizzes: chapter_id => { question_id => answer_string }
 * quizzes are admin-visible (unlike notebook which is private).
 */
function onboardingNormalizeQuizzes($raw): array {
    $out = [];
    $arr = is_object($raw) ? (array)$raw : (is_array($raw) ? $raw : []);
    foreach ($arr as $chId => $answers) {
        $ans = is_object($answers) ? (array)$answers : (is_array($answers) ? $answers : []);
        $out[(string)$chId] = array_map('strval', $ans);
    }
    return $out;
}

/** Normalize exam_results: chapter_id => { attempts, best_score, last_score, passed, history, last_attempt_at } */
function onboardingNormalizeExamResults($raw): array {
    $out = [];
    $arr = is_object($raw) ? (array)$raw : (is_array($raw) ? $raw : []);
    foreach ($arr as $chId => $r) {
        $r = is_object($r) ? (array)$r : (is_array($r) ? $r : []);
        $out[(string)$chId] = [
            'attempts'        => (int)($r['attempts'] ?? 0),
            'best_score'      => (float)($r['best_score'] ?? 0),
            'last_score'      => (float)($r['last_score'] ?? 0),
            'passed'          => (bool)($r['passed'] ?? false),
            'last_attempt_at' => $r['last_attempt_at'] ?? null,
            'history'         => is_array($r['history'] ?? null) ? $r['history'] : [],
        ];
    }
    return $out;
}

/** Does a chapter have scored_quiz blocks? */
function onboardingHasScoredQuiz(array $chapter): bool {
    foreach ($chapter['blocks'] ?? [] as $b) {
        if (($b['type'] ?? '') === 'scored_quiz') return true;
    }
    return false;
}

/** Count total tasks across all chapters */
function onboardingTotalTasks(array $chapters): int {
    $total = 0;
    foreach ($chapters as $ch) $total += count($ch['tasks'] ?? []);
    return $total;
}

/** Count completed tasks (only ones that still exist in config) */
function onboardingDoneTasks(array $chapters, array $completed): int {
    $done = 0;
    foreach ($chapters as $ch) {
        $chId  = $ch['id'] ?? '';
        $valid = array_column($ch['tasks'] ?? [], 'id');
        $mine  = $completed[$chId] ?? [];
        foreach ($mine as $tid) if (in_array($tid, $valid, true)) $done++;
    }
    return $done;
}

/** Is a chapter fully complete? Tasks AND all quiz questions must be answered. scored_quiz requires passed=true. */
function onboardingIsChapterDone(array $chapter, array $completed, array $quizzes = [], array $examResults = []): bool {
    $chId    = $chapter['id'] ?? '';

    // scored_quiz chapters: done when passed
    if (onboardingHasScoredQuiz($chapter)) {
        return (bool)(($examResults[$chId] ?? [])['passed'] ?? false);
    }

    $taskIds = array_column($chapter['tasks'] ?? [], 'id');
    if ($taskIds) {
        $mine = $completed[$chId] ?? [];
        foreach ($taskIds as $tid) if (!in_array($tid, $mine, true)) return false;
    }
    // Require every quiz question in this chapter to have a non-empty answer.
    // Answers are keyed by composite "blockId::questionId"; fall back to plain questionId
    // for legacy data written before the per-block fix.
    $chAnswers = $quizzes[$chId] ?? [];
    foreach ($chapter['blocks'] ?? [] as $block) {
        if (($block['type'] ?? '') !== 'quiz') continue;
        $bid = $block['id'] ?? '';
        foreach ($block['questions'] ?? [] as $q) {
            $val = $chAnswers[$bid . '::' . $q['id']] ?? $chAnswers[$q['id']] ?? '';
            if (empty(trim($val))) return false;
        }
    }
    return true;
}

/** Build unlock map: chapter_id => bool */
function onboardingUnlockMap(array $chapters, array $completed, array $quizzes = [], array $examResults = []): array {
    $map = [];
    $prevDone = true;
    foreach ($chapters as $ch) {
        $map[$ch['id']] = $prevDone;
        if (!onboardingIsChapterDone($ch, $completed, $quizzes, $examResults)) $prevDone = false;
    }
    return $map;
}

/** Is entire onboarding complete? */
function onboardingIsAllDone(array $chapters, array $completed, array $quizzes = [], array $examResults = []): bool {
    if (!$chapters) return false;
    foreach ($chapters as $ch) {
        if (!onboardingIsChapterDone($ch, $completed, $quizzes, $examResults)) return false;
    }
    return true;
}
