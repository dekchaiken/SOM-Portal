<?php
/**
 * One-off migration: add `shared` + `owner_team` fields to every course/exam.
 *
 * For each active team in data/teams.json, walk:
 *   data/{team}/courses/courses.json — set shared:false, owner_team:{team} where missing
 *   data/{team}/exams/exams.json    — same
 *
 * Idempotent: entries that already have both fields are skipped.
 * Never touches phases/lessons/quizzes/questions/attempts/progress files.
 *
 * Usage:
 *   php api/dev/migrate-add-shared-flag.php          # dry-run (report only)
 *   php api/dev/migrate-add-shared-flag.php --apply  # actually write
 */

if (PHP_SAPI !== 'cli') { http_response_code(403); echo "CLI only\n"; exit(1); }

require_once __DIR__ . '/../helpers.php';

$APPLY = in_array('--apply', $argv, true);
$GRN = "\033[32m"; $YEL = "\033[33m"; $CYA = "\033[36m"; $DIM = "\033[2m"; $RED = "\033[31m"; $RST = "\033[0m";

echo "\n{$YEL}▶ Shared-flag migration — " . ($APPLY ? "{$GRN}APPLY MODE{$RST}" : "DRY-RUN (add --apply to write)") . "\n\n";

$teams = readJson('teams.json');
if (empty($teams)) { echo "No teams found in data/teams.json\n"; exit(0); }

$totalTouched = 0;

foreach ($teams as $team) {
    $slug   = $team['slug'] ?? '';
    $active = $team['active'] ?? false;
    if (!$slug || !$active) continue;

    echo "{$CYA}[{$slug}]{$RST} " . ($team['name'] ?? '') . "\n";

    foreach (['courses' => 'courses', 'exams' => 'exams'] as $subdir => $label) {
        $path = DATA_DIR . $slug . '/' . $subdir . '/' . $label . '.json';
        if (!file_exists($path)) {
            echo "  {$DIM}{$subdir}/{$label}.json — not present, skipped{$RST}\n";
            continue;
        }

        $raw = @file_get_contents($path);
        $rows = json_decode($raw, true);
        if (!is_array($rows)) {
            echo "  {$RED}{$subdir}/{$label}.json — invalid JSON, skipped{$RST}\n";
            continue;
        }

        $changed = 0;
        foreach ($rows as &$row) {
            $touched = false;
            if (!array_key_exists('shared', $row))     { $row['shared']     = false; $touched = true; }
            if (!array_key_exists('owner_team', $row)) { $row['owner_team'] = $slug;  $touched = true; }
            if ($touched) $changed++;
        }
        unset($row);

        if ($changed === 0) {
            echo "  {$DIM}{$subdir}/{$label}.json — " . count($rows) . " entries, already up-to-date{$RST}\n";
            continue;
        }

        echo "  {$subdir}/{$label}.json — {$changed}/" . count($rows) . " entries need fields added\n";
        $totalTouched += $changed;

        if ($APPLY) {
            $ok = @file_put_contents(
                $path,
                json_encode($rows, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)
            );
            if ($ok === false) {
                echo "    {$RED}✗ write failed{$RST}\n";
            } else {
                echo "    {$GRN}✓ wrote " . strlen(json_encode($rows)) . " bytes{$RST}\n";
            }
        }
    }
    echo "\n";
}

echo "{$YEL}Total entries " . ($APPLY ? "updated" : "that would be updated") . ": {$totalTouched}{$RST}\n";
if (!$APPLY && $totalTouched > 0) echo "Re-run with --apply to write.\n";
echo "\n";
