<?php
/**
 * One-off migration: backfill missing files for existing teams.
 *
 * For each active team in data/teams.json, ensure:
 *   • all operational files (teamOperationalFiles()) exist
 *   • all default-feature config files exist (via initTeamDirectory)
 *   • config files for every currently-granted requestable feature exist
 *     (via _provisionFeatureFiles for each entry in team.features)
 *
 * Idempotent: file_exists guards mean re-running touches nothing new.
 * Never overwrites existing data.
 *
 * Usage:
 *   php api/dev/migrate-backfill-team-files.php          # dry-run (report only)
 *   php api/dev/migrate-backfill-team-files.php --apply  # actually create files
 */

if (PHP_SAPI !== 'cli') { http_response_code(403); echo "CLI only\n"; exit(1); }

require_once __DIR__ . '/../helpers.php';

$APPLY = in_array('--apply', $argv, true);
$GRN = "\033[32m"; $YEL = "\033[33m"; $CYA = "\033[36m"; $DIM = "\033[2m"; $RST = "\033[0m";

echo "\n{$YEL}▶ Team-files backfill — " . ($APPLY ? "{$GRN}APPLY MODE{$RST}" : "DRY-RUN (add --apply to write)") . "\n\n";

$teams = readJson('teams.json'); // global
if (empty($teams)) { echo "No teams found in data/teams.json\n"; exit(0); }

$totalCreated = 0;
foreach ($teams as $team) {
    $slug   = $team['slug'] ?? '';
    $active = $team['active'] ?? false;
    if (!$slug || !$active) continue;

    echo "{$CYA}[{$slug}]{$RST} " . ($team['name'] ?? '') . "\n";

    // ── Figure out what SHOULD exist ─────────────────────────────────────
    $want = [];
    foreach (teamOperationalFiles() as $f) $want["op:$f"] = $f;
    foreach (defaultFeatures() as $feat) {
        foreach (featureDataFiles()[$feat] ?? [] as $f) $want["default[$feat]:$f"] = $f;
    }
    foreach ($team['features'] ?? [] as $feat) {
        foreach (featureDataFiles()[$feat] ?? [] as $f) $want["granted[$feat]:$f"] = $f;
    }

    // ── Compare against reality ──────────────────────────────────────────
    $missing = [];
    foreach ($want as $label => $file) {
        $p = DATA_DIR . $slug . '/' . $file;
        if (!file_exists($p)) $missing[$label] = $p;
    }

    // Extra checks: logs dir + menu-permissions
    $logsDir = DATA_DIR . $slug . '/logs/';
    if (!is_dir($logsDir))                              $missing['logs-dir'] = $logsDir;
    if (!file_exists($logsDir . 'activity.json'))       $missing['logs/activity.json'] = $logsDir . 'activity.json';
    if (!file_exists($logsDir . 'security.json'))       $missing['logs/security.json'] = $logsDir . 'security.json';
    if (!file_exists(DATA_DIR . $slug . '/menu-permissions.json'))
                                                        $missing['menu-permissions.json'] = DATA_DIR . $slug . '/menu-permissions.json';

    if (empty($missing)) {
        echo "  {$DIM}Nothing missing (already complete){$RST}\n\n";
        continue;
    }

    echo "  Missing " . count($missing) . " file(s):\n";
    foreach ($missing as $label => $p) {
        echo "    · {$DIM}{$label}{$RST} → " . str_replace(DATA_DIR, 'data/', $p) . "\n";
    }

    if ($APPLY) {
        // Just call initTeamDirectory (backfills op + default-feature files
        // + logs + menu-permissions) then loop granted features for the rest.
        initTeamDirectory($slug);
        foreach ($team['features'] ?? [] as $feat) {
            _provisionFeatureFiles($feat, $slug);
        }
        // Verify
        $stillMissing = 0;
        foreach ($missing as $p) {
            if (!file_exists($p) && substr($p, -1) !== '/') $stillMissing++;
        }
        $created = count($missing) - $stillMissing;
        $totalCreated += $created;
        echo "  {$GRN}✓ Created {$created} file(s){$RST}"
             . ($stillMissing ? " ({$stillMissing} still missing — check logs)" : '')
             . "\n";
    }
    echo "\n";
}

echo "═══════════════════════════════════════════════════════\n";
if ($APPLY) echo "{$GRN}Done.{$RST} Total files created: {$totalCreated}\n";
else        echo "Dry-run complete. Add {$YEL}--apply{$RST} to actually create files.\n";
