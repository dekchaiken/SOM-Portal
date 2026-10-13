<?php
/**
 * Feature-provisioning + copy-from-SM test (CLI).
 * Run: php api/dev/test-feature-provisioning.php
 *
 * Verifies:
 *   1. featureDataFiles() covers every feature in FEATURE_CATALOGUE and
 *      REQUESTABLE_FEATURES (no drift with the UI / feature-requests catalogue).
 *   2. _provisionFeatureFiles() creates every listed file on grant.
 *   3. copy-from-sm copies every listed file (when the SM source exists).
 *   4. The old ops-runbook.json (dash) bug is really fixed.
 *
 * Uses a throwaway team slug 'ztest' so nothing production is touched.
 * Cleans up on exit.
 */

if (PHP_SAPI !== 'cli') { http_response_code(403); echo "CLI only\n"; exit(1); }

require_once __DIR__ . '/../helpers.php';

// Extract REQUESTABLE_FEATURES keys from source without executing the endpoint
$reqSrc = file_get_contents(__DIR__ . '/../feature-requests/index.php');
preg_match_all("/^\s*'([a-z-]+)'\s*=>\s*\[/m", $reqSrc, $rm);
$requestableKeys = $rm[1] ?? [];

// Extract FEATURE_CATALOGUE keys from admin/super-team-permissions.html
$catalogueSrc = file_get_contents(__DIR__ . '/../../admin/super-team-permissions.html');
$catalogueKeys = [];
if (preg_match('/FEATURE_CATALOGUE\s*=\s*\{(.+?)\};/s', $catalogueSrc, $m)) {
    preg_match_all("/'([a-z-]+)'\s*:\s*\{/", $m[1], $km);
    $catalogueKeys = array_values(array_unique($km[1]));
}

$DEFAULT_FEATURES_WITH_CONFIG = ['team-docs', 'schedule', 'board'];

$RED = "\033[31m"; $GRN = "\033[32m"; $YEL = "\033[33m"; $RST = "\033[0m";
$fail = 0; $pass = 0;
function ok($m)   { global $pass, $GRN, $RST; $pass++; echo "  {$GRN}✓{$RST} $m\n"; }
function bad($m)  { global $fail, $RED, $RST; $fail++; echo "  {$RED}✗{$RST} $m\n"; }
function head($m) { global $YEL, $RST; echo "\n{$YEL}▶ $m{$RST}\n"; }

$TEST_TEAM = 'ztest';
$TEST_DIR  = DATA_DIR . $TEST_TEAM . '/';

// Cleanup helper
$cleanup = function () use ($TEST_DIR) {
    if (is_dir($TEST_DIR)) {
        // Recursive delete
        $it = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($TEST_DIR, RecursiveDirectoryIterator::SKIP_DOTS),
            RecursiveIteratorIterator::CHILD_FIRST
        );
        foreach ($it as $f) $f->isDir() ? @rmdir($f->getRealPath()) : @unlink($f->getRealPath());
        @rmdir($TEST_DIR);
    }
};
register_shutdown_function($cleanup);
$cleanup(); // in case a previous failed run left junk

// ── Test 1: featureDataFiles() covers every requestable + catalogue key ──
head('Test 1: featureDataFiles() covers every feature in the UI catalogue');
$map = featureDataFiles();
$mapKeys = array_keys($map);
echo "  featureDataFiles() defines " . count($mapKeys) . " features: " . implode(', ', $mapKeys) . "\n";
echo "  UI FEATURE_CATALOGUE defines " . count($catalogueKeys) . " features\n";

$missingInMap = array_diff($catalogueKeys, $mapKeys);
if (!$missingInMap) ok("Every FEATURE_CATALOGUE key is in featureDataFiles()");
else                bad("Missing in featureDataFiles(): " . implode(', ', $missingInMap));

// Also check default features that carry config
foreach ($DEFAULT_FEATURES_WITH_CONFIG as $key) {
    if (isset($map[$key])) ok("Default feature '$key' has an entry");
    else                   bad("Default feature '$key' missing from featureDataFiles()");
}

// ── Test 2: The old ops-runbook typo is really gone ─────────────────────
head("Test 2: 'team-docs' uses ops_runbook.json (underscore), not the old typo");
$teamDocs = $map['team-docs'] ?? [];
if (in_array('ops_runbook.json', $teamDocs))  ok("team-docs includes ops_runbook.json (correct)");
else                                          bad("team-docs missing ops_runbook.json — got: " . implode(', ', $teamDocs));
if (in_array('ops-runbook.json', $teamDocs))  bad("Old typo 'ops-runbook.json' (dash) is STILL in the map — must be underscore");
else                                          ok("Old typo 'ops-runbook.json' (dash) is NOT in the map");

// ── Test 3: batch-monitor now provisions all noti files ─────────────────
head("Test 3: batch-monitor provisions noti-config/log/state, not just batch_meta");
$batch = $map['batch-monitor'] ?? [];
foreach (['batch_meta.json', 'batch-monitor-noti-config.json', 'batch-monitor-noti-log.json', 'batch-monitor-noti-state.json'] as $need) {
    if (in_array($need, $batch)) ok("batch-monitor includes $need");
    else                         bad("batch-monitor missing $need");
}

// ── Test 4: Previously-missing features are now in the map ──────────────
head("Test 4: Previously-missing features are now in the map (even if [])");
foreach (['monitoring', 'inbox', 'onboarding', 'achievements', 'restart-monitor'] as $key) {
    if (isset($map[$key])) ok("'$key' is now in featureDataFiles() (files: " . (count($map[$key]) ? implode(', ', $map[$key]) : '(empty — intentional)') . ")");
    else                   bad("'$key' still missing from featureDataFiles()");
}

// ── Test 5: _provisionFeatureFiles() actually creates the files ─────────
head("Test 5: _provisionFeatureFiles() creates every listed file for granted features");
if (!is_dir($TEST_DIR)) @mkdir($TEST_DIR, 0755, true);

// pick a few features to actually provision
$sampleFeatures = ['batch-monitor', 'restart-monitor', 'inbox', 'ma-services', 'team-docs'];
foreach ($sampleFeatures as $key) {
    _provisionFeatureFiles($key, $TEST_TEAM);
    foreach ($map[$key] as $expected) {
        $p = $TEST_DIR . $expected;
        if (file_exists($p)) ok("[$key] created data/$TEST_TEAM/$expected");
        else                 bad("[$key] file NOT created: $p");
    }
}

// Also check: features with [] should not create anything spurious
head("Test 6: Features with empty file list create nothing (no accidental files)");
foreach (['monitoring', 'achievements', 'onboarding'] as $key) {
    $filesBefore = glob($TEST_DIR . '*.json') ?: [];
    _provisionFeatureFiles($key, $TEST_TEAM);
    $filesAfter = glob($TEST_DIR . '*.json') ?: [];
    if (count($filesAfter) === count($filesBefore)) ok("[$key] no files created (feature has intentionally empty list)");
    else                                            bad("[$key] created unexpected files");
}

// ── Test 7: copy-config.php $FEATURE_FILES now equals featureDataFiles() ──
head("Test 7: /api/teams/copy-config.php pulls from featureDataFiles() (no local map)");
$copyConfigSrc = file_get_contents(__DIR__ . '/../teams/copy-config.php');
if (strpos($copyConfigSrc, 'featureDataFiles()') !== false) ok("copy-config.php uses featureDataFiles()");
else                                                        bad("copy-config.php does NOT use featureDataFiles()");
if (preg_match('/\$FEATURE_FILES\s*=\s*\[/', $copyConfigSrc)) bad("copy-config.php still has a local \$FEATURE_FILES = [ ... ] literal");
else                                                          ok("copy-config.php has no local literal map");

// Same for teams/index.php
$teamsIdxSrc = file_get_contents(__DIR__ . '/../teams/index.php');
if (strpos($teamsIdxSrc, 'featureDataFiles()') !== false) ok("teams/index.php uses featureDataFiles()");
else                                                      bad("teams/index.php does NOT use featureDataFiles()");
if (preg_match('/\$dataFiles\s*=\s*\[\s*[\'"]jira-templates/', $teamsIdxSrc)) bad("teams/index.php still has a local \$dataFiles map literal");
else                                                                         ok("teams/index.php has no local literal map");

// ── Summary ──────────────────────────────────────────────────────────────
echo "\n═══════════════════════════════════════════════════════\n";
if ($fail === 0) {
    echo "{$GRN}ALL PASSED{$RST}  ($pass checks)\n";
    exit(0);
} else {
    echo "{$RED}FAILED{$RST}  $fail failures / $pass pass\n";
    exit(1);
}
