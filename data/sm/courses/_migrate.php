<?php
/**
 * One-shot migration: split monolithic phases/lessons/quizzes JSON
 * into per-course subfolders.
 *
 * Run from CLI:   php data/courses/_migrate.php
 * Run via web:    /data/courses/_migrate.php?confirm=yes  (CLI is preferred)
 *
 * Idempotent: re-running on already-migrated data is a no-op (the source
 * files have been renamed to *.bak, so nothing happens).
 */

if (PHP_SAPI !== 'cli') {
    // Web-mode guard — require ?confirm=yes so it can't be hit accidentally.
    if (($_GET['confirm'] ?? '') !== 'yes') {
        http_response_code(400);
        echo "Add ?confirm=yes to run. Better: run from CLI: php data/courses/_migrate.php\n";
        exit;
    }
    header('Content-Type: text/plain; charset=utf-8');
}

$baseDir = __DIR__ . '/';
$readJson = function (string $name) use ($baseDir): array {
    $path = $baseDir . $name;
    if (!file_exists($path)) return [];
    return json_decode((string)file_get_contents($path), true) ?? [];
};
$writeJson = function (string $path, array $data): void {
    $dir = dirname($path);
    if (!is_dir($dir)) mkdir($dir, 0755, true);
    file_put_contents($path, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
};
$log = function (string $msg): void { echo $msg . "\n"; };

$phasesPath  = $baseDir . 'phases.json';
$lessonsPath = $baseDir . 'lessons.json';
$quizzesPath = $baseDir . 'quizzes.json';

if (!file_exists($phasesPath) && !file_exists($lessonsPath) && !file_exists($quizzesPath)) {
    $log('Nothing to migrate — source files already gone (probably done).');
    exit;
}

$courses = $readJson('courses.json');
if (!$courses) {
    $log('ERROR: courses.json is empty or missing. Aborting.');
    exit(1);
}

$phases  = $readJson('phases.json');
$lessons = $readJson('lessons.json');
$quizzes = $readJson('quizzes.json');

$log('Loaded: ' . count($courses) . ' courses, ' . count($phases) . ' phases, ' .
     count($lessons) . ' lessons, ' . count($quizzes) . ' quizzes.');

// Build phase_id → course_id lookup so we can route lessons/quizzes.
$phaseToCourse = [];
foreach ($phases as $p) {
    if (!empty($p['id']) && !empty($p['course_id'])) {
        $phaseToCourse[$p['id']] = $p['course_id'];
    }
}

// Group phases by course
$byCoursePhases  = [];
$byCourseLessons = [];
$byCourseQuizzes = [];
$orphans = ['lessons' => 0, 'quizzes' => 0, 'phases' => 0];

foreach ($phases as $p) {
    $cid = $p['course_id'] ?? '';
    if (!$cid) { $orphans['phases']++; continue; }
    $byCoursePhases[$cid][] = $p;
}
foreach ($lessons as $l) {
    $pid = $l['phase_id'] ?? '';
    $cid = $phaseToCourse[$pid] ?? '';
    if (!$cid) { $orphans['lessons']++; continue; }
    $byCourseLessons[$cid][] = $l;
}
foreach ($quizzes as $q) {
    $pid = $q['phase_id'] ?? '';
    $cid = $phaseToCourse[$pid] ?? '';
    if (!$cid) { $orphans['quizzes']++; continue; }
    $byCourseQuizzes[$cid][] = $q;
}

// Write per-course folders for every course (even if empty — keeps shape consistent).
foreach ($courses as $c) {
    $cid = $c['id'] ?? '';
    if (!$cid) continue;
    $dir = $baseDir . $cid . '/';
    if (!is_dir($dir)) mkdir($dir, 0755, true);
    $writeJson($dir . 'phases.json',  $byCoursePhases[$cid]  ?? []);
    $writeJson($dir . 'lessons.json', $byCourseLessons[$cid] ?? []);
    $writeJson($dir . 'quizzes.json', $byCourseQuizzes[$cid] ?? []);
    $log(sprintf('  → %s/  (%d phases, %d lessons, %d quizzes)',
        $cid,
        count($byCoursePhases[$cid]  ?? []),
        count($byCourseLessons[$cid] ?? []),
        count($byCourseQuizzes[$cid] ?? [])
    ));
}

if (array_sum($orphans) > 0) {
    $log('WARNING — orphan records skipped (no matching course): ' .
         json_encode($orphans));
}

// Back up + remove the source files
foreach (['phases.json', 'lessons.json', 'quizzes.json'] as $f) {
    $src = $baseDir . $f;
    if (file_exists($src)) {
        $bak = $src . '.bak';
        if (file_exists($bak)) @unlink($bak);
        rename($src, $bak);
        $log("Renamed $f → $f.bak");
    }
}

$log('Done.');
