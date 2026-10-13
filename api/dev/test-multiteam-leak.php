<?php
/**
 * Multi-team leak verification (CLI only).
 * Run with: php api/dev/test-multiteam-leak.php
 *
 * Simulates each team context in-process and confirms that every fixed
 * endpoint's data lands in data/{team}/... (not global data/).
 *
 * Cleans up its own markers on exit.
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    echo "CLI only\n";
    exit(1);
}

require_once __DIR__ . '/../helpers.php';

$RED   = "\033[31m"; $GRN = "\033[32m"; $YEL = "\033[33m"; $RST = "\033[0m";
$fail = 0; $pass = 0;
function ok($m)   { global $pass, $GRN, $RST; $pass++; echo "  {$GRN}✓{$RST} $m\n"; }
function bad($m)  { global $fail, $RED, $RST; $fail++; echo "  {$RED}✗{$RST} $m\n"; }
function head($m) { global $YEL, $RST; echo "\n{$YEL}▶ $m{$RST}\n"; }

// ── Marker files this test writes (all get cleaned up at end) ─────────────
$MARKERS = [
    'test-leak-marker.json',
    'knowledge-base.json.leaktest',  // won't touch real file — separate marker
    'analytics_events.json.leaktest',
    'grafana-monitoring/leaktest.json',
];

$TEAMS = ['sm', 'ss', 'ts'];

// ── Test 1: teamDataPath() resolves per-team ──────────────────────────────
head('Test 1: teamDataPath() returns team-scoped path');
foreach ($TEAMS as $t) {
    $GLOBALS['_current_team'] = $t;
    $p = teamDataPath('marker.json');
    $expect = DATA_DIR . $t . '/marker.json';
    if ($p === $expect) ok("[$t]  $p");
    else                bad("[$t]  expected $expect, got $p");
}

// ── Test 2: Global files bypass team scoping ──────────────────────────────
head('Test 2: Global files (users.json etc.) stay global');
foreach ($TEAMS as $t) {
    $GLOBALS['_current_team'] = $t;
    $p = teamDataPath('users.json');
    $expect = DATA_DIR . 'users.json';
    if ($p === $expect) ok("[$t]  users.json → $p");
    else                bad("[$t]  expected $expect, got $p");
}

// ── Test 3: writeJson() lands per-team; readJson() sees own team only ────
head('Test 3: Write & read isolation across teams');
foreach ($TEAMS as $t) {
    $GLOBALS['_current_team'] = $t;
    writeJson('test-leak-marker.json', ['team' => $t, 'msg' => "hello from $t"]);
}
$leaked = false;
foreach ($TEAMS as $t) {
    $GLOBALS['_current_team'] = $t;
    $d = readJson('test-leak-marker.json');
    if (($d['team'] ?? '') === $t) ok("[$t]  reads its own marker (msg: {$d['msg']})");
    else { bad("[$t]  expected team=$t but got team=" . ($d['team'] ?? 'null')); $leaked = true; }

    // Also verify the file exists at team-scoped path
    $p = DATA_DIR . $t . '/test-leak-marker.json';
    if (file_exists($p)) ok("[$t]  file exists at $p");
    else                 bad("[$t]  file missing at $p");
}
if (!$leaked) ok('No cross-team leak detected');

// ── Test 4: Global data/test-leak-marker.json should NOT exist ────────────
head('Test 4: Global data dir stays clean of team markers');
$globalMarker = DATA_DIR . 'test-leak-marker.json';
if (file_exists($globalMarker)) bad("Global marker file leaked at $globalMarker (bad!)");
else                            ok('data/test-leak-marker.json does NOT exist (good)');

// ── Test 5: Endpoint-file specific — knowledge-base.json path ─────────────
head('Test 5: knowledge-base module writes per-team');
foreach ($TEAMS as $t) {
    $GLOBALS['_current_team'] = $t;
    $p = teamDataPath('knowledge-base.json');
    $expect = DATA_DIR . $t . '/knowledge-base.json';
    if ($p === $expect) ok("[$t]  KB path → data/$t/knowledge-base.json");
    else                bad("[$t]  KB path wrong: $p");
}

// ── Test 6: nested paths (grafana-monitoring/raw/{slug}/) route to SM ────
// Restart Monitor data is SM-shared (see smSharedFiles()) — every team's
// reads/writes route to data/sm/grafana-monitoring/, and non-SM writes are
// gated by requireSmForShared() at the endpoint level.
head('Test 6: nested restart-monitor paths route to data/sm/ for every team');
foreach ($TEAMS as $t) {
    $GLOBALS['_current_team'] = $t;
    $p = teamDataPath('grafana-monitoring/raw/EKS-TMN/');
    $expect = DATA_DIR . 'sm/grafana-monitoring/raw/EKS-TMN/';
    if ($p === $expect) ok("[$t]  restart-monitor dir → data/sm/grafana-monitoring/raw/EKS-TMN/");
    else                bad("[$t]  wrong nested path: got $p, expected $expect");
}

// ── Test 7: Writes to the shared subtree all land in data/sm/, not per-team
head('Test 7: Write nested file — routes to data/sm/ (SM-shared)');
// Set SM context — non-SM writes are blocked by requireSmForShared() in prod,
// but this test exercises the raw routing (no HTTP layer).
$GLOBALS['_current_team'] = 'sm';
writeJson('grafana-monitoring/leaktest.json', ['team' => 'sm', 'source' => 'restart-monitor']);
$smNested = DATA_DIR . 'sm/grafana-monitoring/leaktest.json';
if (file_exists($smNested)) ok("[sm]  nested file at data/sm/grafana-monitoring/leaktest.json");
else                        bad("[sm]  nested file missing at $smNested");
foreach (['ss', 'ts'] as $t) {
    $p = DATA_DIR . $t . '/grafana-monitoring/leaktest.json';
    if (!file_exists($p)) ok("[$t]  no per-team leak at data/$t/grafana-monitoring/leaktest.json");
    else                  bad("[$t]  unexpected per-team file: $p");
}
$globalNested = DATA_DIR . 'grafana-monitoring/leaktest.json';
if (file_exists($globalNested)) bad("Global nested marker leaked (bad!)");
else                            ok('No global nested marker written');

// ── Cleanup ────────────────────────────────────────────────────────────────
head('Cleanup: removing test marker files');
foreach ($TEAMS as $t) {
    foreach ($MARKERS as $m) {
        $p = DATA_DIR . $t . '/' . $m;
        if (file_exists($p)) { @unlink($p); }
    }
}
// Belt-and-suspenders: remove any stray global markers (should not exist)
foreach ($MARKERS as $m) {
    $p = DATA_DIR . $m;
    if (file_exists($p)) { @unlink($p); }
}
ok('Cleanup done');

// ── Summary ────────────────────────────────────────────────────────────────
echo "\n";
echo "═══════════════════════════════════════════════════════\n";
if ($fail === 0) {
    echo "{$GRN}ALL PASSED{$RST}  ($pass checks)\n";
    exit(0);
} else {
    echo "{$RED}FAILED{$RST}  $fail failures / $pass pass\n";
    exit(1);
}
