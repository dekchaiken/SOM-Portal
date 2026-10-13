<?php
/**
 * One-shot migration: split exams.json into per-exam folders.
 *
 *   data/exams/exams.json  (each entry has questions[] inline)
 *      ↓
 *   data/exams/<exam_id>/questions.json    (the question pool)
 *   data/exams/<exam_id>/events.json       (empty, ready for audit log)
 *   data/exams/exams.json                  (index only — questions removed)
 *
 * Idempotent: re-running on already-migrated data is safe (no-op if
 * questions are already split out).
 */

if (PHP_SAPI !== 'cli' && ($_GET['confirm'] ?? '') !== 'yes') {
    http_response_code(400);
    echo "Add ?confirm=yes to run via web. Prefer CLI: php data/exams/_migrate.php\n";
    exit;
}
if (PHP_SAPI !== 'cli') header('Content-Type: text/plain; charset=utf-8');

$baseDir   = __DIR__ . '/';
$indexPath = $baseDir . 'exams.json';

$log = function (string $m): void { echo $m . "\n"; };

if (!file_exists($indexPath)) {
    $log('ERROR: data/exams/exams.json missing.');
    exit(1);
}

$src = json_decode((string)file_get_contents($indexPath), true);
if (!is_array($src)) {
    $log('ERROR: exams.json is not valid JSON / array.');
    exit(1);
}

$log('Found ' . count($src) . ' exam(s) in index.');

$idxOut = [];
$movedQ = 0;
$alreadySplit = 0;

foreach ($src as $exam) {
    $id = $exam['id'] ?? '';
    if (!$id) { $log('  skip: entry without id'); continue; }

    $dir = $baseDir . $id . '/';
    if (!is_dir($dir)) mkdir($dir, 0755, true);

    // Split question pool
    $qs = $exam['questions'] ?? [];
    $qPath = $dir . 'questions.json';

    if (is_array($qs) && count($qs) > 0) {
        file_put_contents($qPath, json_encode($qs, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        $movedQ += count($qs);
        $log(sprintf('  → %s/questions.json  (%d Q)', $id, count($qs)));
    } elseif (file_exists($qPath)) {
        // Already split
        $existing = json_decode((string)file_get_contents($qPath), true);
        $alreadySplit += is_array($existing) ? count($existing) : 0;
        $log(sprintf('  ↪ %s/questions.json already exists  (%d Q kept)', $id,
            is_array($existing) ? count($existing) : 0));
    } else {
        // No questions anywhere — just create empty file
        file_put_contents($qPath, "[]\n");
        $log(sprintf('  → %s/questions.json  (empty)', $id));
    }

    // Create empty events.json if not yet there
    $ePath = $dir . 'events.json';
    if (!file_exists($ePath)) {
        file_put_contents($ePath, "[]\n");
        $log(sprintf('  → %s/events.json     (new empty audit log)', $id));
    }

    // Strip questions out of the index entry
    unset($exam['questions']);
    $idxOut[] = $exam;
}

// Backup original index then write the slim one
$bak = $indexPath . '.bak';
if (!file_exists($bak)) {
    copy($indexPath, $bak);
    $log("Backed up original → exams.json.bak");
}

file_put_contents(
    $indexPath,
    json_encode($idxOut, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
);
$log('Wrote slim index → exams.json (' . count($idxOut) . ' entries, no questions inline)');

$log("\nSummary:");
$log("  Questions moved to per-folder: $movedQ");
$log("  Questions already split:       $alreadySplit");
$log('Done.');
