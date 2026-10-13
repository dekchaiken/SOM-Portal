<?php
/**
 * Test that initTeamDirectory() scaffolds a new team correctly.
 * Uses throwaway slug 'zinit' and cleans up.
 */

if (PHP_SAPI !== 'cli') { http_response_code(403); echo "CLI only\n"; exit(1); }
require_once __DIR__ . '/../helpers.php';

$RED = "\033[31m"; $GRN = "\033[32m"; $YEL = "\033[33m"; $RST = "\033[0m";
$fail = 0; $pass = 0;
function ok($m)   { global $pass, $GRN, $RST; $pass++; echo "  {$GRN}✓{$RST} $m\n"; }
function bad($m)  { global $fail, $RED, $RST; $fail++; echo "  {$RED}✗{$RST} $m\n"; }
function head($m) { global $YEL, $RST; echo "\n{$YEL}▶ $m{$RST}\n"; }

$TEST_TEAM = 'zinit';
$TEST_DIR  = DATA_DIR . $TEST_TEAM . '/';

$cleanup = function () use ($TEST_DIR) {
    if (!is_dir($TEST_DIR)) return;
    $it = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($TEST_DIR, RecursiveDirectoryIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST
    );
    foreach ($it as $f) $f->isDir() ? @rmdir($f->getRealPath()) : @unlink($f->getRealPath());
    @rmdir($TEST_DIR);
};
register_shutdown_function($cleanup);
$cleanup();

// ── Run init ─────────────────────────────────────────────────────────────
head("Test 1: initTeamDirectory('$TEST_TEAM') creates all operational files");
initTeamDirectory($TEST_TEAM);

foreach (teamOperationalFiles() as $f) {
    if (file_exists($TEST_DIR . $f)) ok("  op file $f");
    else                             bad("  op file $f MISSING");
}

// ── Default-feature config files must exist ──────────────────────────────
head("Test 2: All default-feature config files exist");
foreach (defaultFeatures() as $feat) {
    foreach (featureDataFiles()[$feat] ?? [] as $f) {
        if (file_exists($TEST_DIR . $f)) ok("  [$feat] $f");
        else                             bad("  [$feat] $f MISSING");
    }
}

// ── Specific spot-checks for the previously-missing files ────────────────
head("Test 3: The previously-missing files are now created");
foreach (['schedule.json', 'holiday-plans.json', 'user-colors.json'] as $f) {
    if (file_exists($TEST_DIR . $f)) ok("  $f now exists (was missing before fix)");
    else                             bad("  $f still missing!");
}

// ── Logs dir + activity/security ─────────────────────────────────────────
head("Test 4: Logs directory + activity/security files");
foreach (['logs/', 'logs/activity.json', 'logs/security.json'] as $p) {
    $full = $TEST_DIR . $p;
    if (substr($p, -1) === '/') {
        if (is_dir($full)) ok("  $p exists");
        else               bad("  $p missing");
    } else {
        if (file_exists($full)) ok("  $p exists");
        else                    bad("  $p missing");
    }
}

// ── menu-permissions ─────────────────────────────────────────────────────
head("Test 5: Default menu-permissions.json created with correct shape");
$mp = json_decode(file_get_contents($TEST_DIR . 'menu-permissions.json'), true);
if ($mp && isset($mp['roles']['sm_admin']) && $mp['roles']['sm_admin'] === '*')
     ok("  menu-permissions.json has default 'sm_admin' => '*'");
else bad("  menu-permissions.json wrong shape: " . json_encode($mp));

if (isset($mp['always_visible']) && in_array('profile', $mp['always_visible']))
     ok("  always_visible includes 'profile'");
else bad("  always_visible missing 'profile'");

// ── Idempotency: re-run should not overwrite ─────────────────────────────
head("Test 6: Idempotent — re-run doesn't clobber existing content");
// Write some sentinel content
file_put_contents($TEST_DIR . 'schedule.json', json_encode(['sentinel' => 'keep-me']));
initTeamDirectory($TEST_TEAM);
$after = json_decode(file_get_contents($TEST_DIR . 'schedule.json'), true);
if (($after['sentinel'] ?? '') === 'keep-me') ok("  schedule.json content preserved on re-run");
else                                          bad("  schedule.json was overwritten! content: " . json_encode($after));

// ── Summary ──────────────────────────────────────────────────────────────
echo "\n═══════════════════════════════════════════════════════\n";
if ($fail === 0) {
    echo "{$GRN}ALL PASSED{$RST}  ($pass checks)\n";
    exit(0);
} else {
    echo "{$RED}FAILED{$RST}  $fail failures / $pass pass\n";
    exit(1);
}
