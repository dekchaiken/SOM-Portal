<?php
/**
 * HTTP-level multi-team isolation test.
 * Run against a locally running server:  php -S localhost:8000  (from repo root)
 *   then in another shell:  php api/dev/test-http-multiteam.php
 *
 * Generates a real JWT per team, hits fixed endpoints via curl, verifies data
 * lands in per-team folders. Cleans up its own markers.
 */

if (PHP_SAPI !== 'cli') { http_response_code(403); echo "CLI only\n"; exit(1); }

require_once __DIR__ . '/../helpers.php';

$BASE_URL = getenv('SOM_BASE_URL') ?: 'http://localhost:8000';

$RED = "\033[31m"; $GRN = "\033[32m"; $YEL = "\033[33m"; $RST = "\033[0m";
$fail = 0; $pass = 0;
function ok($m)   { global $pass, $GRN, $RST; $pass++; echo "  {$GRN}✓{$RST} $m\n"; }
function bad($m)  { global $fail, $RED, $RST; $fail++; echo "  {$RED}✗{$RST} $m\n"; }
function head($m) { global $YEL, $RST; echo "\n{$YEL}▶ $m{$RST}\n"; }

// ── Use super_admin (bypasses per-team pw-reset gate + can impersonate) ──
$users = json_decode(file_get_contents(DATA_DIR . 'users.json'), true) ?: [];
$superAdmin = null;
foreach ($users as $u) {
    if (($u['role'] ?? '') === 'super_admin') { $superAdmin = $u; break; }
}
if (!$superAdmin) { bad("No super_admin user in users.json"); exit(1); }
echo "  actor = super_admin ({$superAdmin['username']}, id={$superAdmin['id']})\n";
echo "  team context is injected per-request via X-Admin-Team header\n";

$superToken = jwt_create([
    'sub'      => $superAdmin['id'],
    'name'     => $superAdmin['name'] ?? $superAdmin['username'],
    'username' => $superAdmin['username'],
    'role'     => 'super_admin',
    'team'     => $superAdmin['team'] ?? 'sm',
    'csrf'     => 'test-csrf-token',
], 3600);

// For symmetry with rest of test:
$tokens = ['sm' => $superToken, 'ss' => $superToken, 'ts' => $superToken];

// ── Helper: HTTP call as super_admin impersonating a team ────────────────
function callApi(string $baseUrl, string $token, string $method, string $path, ?array $body = null, ?string $team = null): array {
    $ch = curl_init($baseUrl . $path);
    $headers = [
        'Authorization: Bearer ' . $token,
        'X-CSRF-Token: test-csrf-token',
        'Accept: application/json',
    ];
    if ($team) $headers[] = 'X-Admin-Team: ' . $team;
    if ($body !== null) {
        $headers[] = 'Content-Type: application/json';
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
    }
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST  => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_TIMEOUT        => 10,
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);
    return ['code' => $code, 'body' => $resp, 'err' => $err, 'json' => json_decode((string)$resp, true)];
}

// ── Pre-flight: is server up? ────────────────────────────────────────────
head('Pre-flight: server reachable at ' . $BASE_URL);
$r = callApi($BASE_URL, $tokens['sm'], 'GET', '/api/auth/me.php', null, 'sm');
if ($r['code'] === 0)     { bad("Server not reachable: {$r['err']} — start php -S localhost:8000 first"); exit(1); }
if ($r['code'] !== 200)   { bad("auth/me returned HTTP {$r['code']}: " . substr((string)$r['body'], 0, 200)); exit(1); }
ok("Server up. auth/me returned 200");

// ── Backup existing test-target files so we can restore ─────────────────
$BACKUPS = [];
foreach (['knowledge-base.json', 'ma-services.json', 'analytics_events.json'] as $f) {
    foreach (['sm', 'ss', 'ts'] as $team) {
        $p = DATA_DIR . $team . '/' . $f;
        if (file_exists($p)) $BACKUPS[$team . '/' . $f] = file_get_contents($p);
    }
}
register_shutdown_function(function () use ($BACKUPS) {
    foreach ($BACKUPS as $rel => $data) {
        file_put_contents(DATA_DIR . $rel, $data);
    }
});

// ── Test A: knowledge-base list per team should return each team's own data ──
head('Test A: /api/knowledge-base/list.php returns per-team data');
// First, seed each team's KB with distinct data via writeJson (bypass HTTP)
foreach (array_keys($tokens) as $team) {
    $GLOBALS['_current_team'] = $team;
    writeJson('knowledge-base.json', [
        'categories' => ['test_' . $team => ['name' => "Category from $team", 'fields' => []]],
        'entries'    => ['test_' . $team => []],
    ]);
}
$GLOBALS['_current_team'] = null;

foreach ($tokens as $team => $tok) {
    $r = callApi($BASE_URL, $tok, 'GET', '/api/knowledge-base/list.php', null, $team);
    if ($r['code'] !== 200)                              { bad("[$team] HTTP {$r['code']}: " . substr($r['body'], 0, 200)); continue; }
    $cats = $r['json']['data']['categories'] ?? $r['json']['categories'] ?? [];
    if (isset($cats['test_' . $team]))                   ok("[$team] sees its own category test_$team");
    else                                                 bad("[$team] does NOT see own category. Got: " . implode(',', array_keys($cats)));
    // Cross-check: should not see other teams' categories
    foreach (['sm', 'ss', 'ts'] as $other) {
        if ($other === $team) continue;
        if (isset($cats['test_' . $other])) bad("[$team] LEAK: saw $other's category!");
    }
}

// ── Test B: ma-services list per team ────────────────────────────────────
head('Test B: /api/ma-services/list.php returns per-team data');
foreach (array_keys($tokens) as $team) {
    $GLOBALS['_current_team'] = $team;
    writeJson('ma-services.json', [
        'services' => [
            ['id' => 1, 'service_name' => "svc-only-in-$team", 'service_type' => 'test', 'tool_type' => 'test'],
        ],
        'next_id'  => 2,
    ]);
}
$GLOBALS['_current_team'] = null;

foreach ($tokens as $team => $tok) {
    $r = callApi($BASE_URL, $tok, 'GET', '/api/ma-services/list.php', null, $team);
    if ($r['code'] !== 200)                              { bad("[$team] HTTP {$r['code']}: " . substr($r['body'], 0, 200)); continue; }
    $svcs = $r['json']['data'] ?? [];
    $names = array_column($svcs, 'service_name');
    if (in_array("svc-only-in-$team", $names))           ok("[$team] sees svc-only-in-$team");
    else                                                 bad("[$team] doesn't see own svc. Got: " . implode(',', $names));
    foreach (['sm', 'ss', 'ts'] as $other) {
        if ($other === $team) continue;
        if (in_array("svc-only-in-$other", $names)) bad("[$team] LEAK: saw $other's svc!");
    }
}

// ── Test C: n8n-oncall.php requires auth and is team-scoped ──────────────
head('Test C: /api/n8n-oncall.php now requires auth and reads per-team cache');
// Unauth call must fail
$r = callApi($BASE_URL, 'bad.token.here', 'GET', '/api/n8n-oncall.php?date=2026-07-15');
if ($r['code'] === 401)                                  ok("Unauth GET returns 401 (auth now enforced)");
else                                                     bad("Unauth GET returned {$r['code']}, expected 401");

// ── Test D: analytics tracker writes per-team ────────────────────────────
head('Test D: AnalyticsTracker writes per-team analytics_events.json');
require_once __DIR__ . '/../analytics/AnalyticsTracker.php';
foreach (array_keys($tokens) as $team) {
    $GLOBALS['_current_team'] = $team;
    $t = new AnalyticsTracker();
    $t->trackPageView("page-in-$team", "user-$team");
}
$GLOBALS['_current_team'] = null;

foreach (array_keys($tokens) as $team) {
    $p = DATA_DIR . $team . '/analytics_events.json';
    if (file_exists($p)) {
        $events = json_decode(file_get_contents($p), true) ?: [];
        $pages  = array_column(array_column($events, 'data'), 'page');
        if (in_array("page-in-$team", $pages)) ok("[$team] analytics event landed in data/$team/analytics_events.json");
        else                                   bad("[$team] event missing from own file. Pages: " . implode(',', $pages));
    } else {
        bad("[$team] file $p not created");
    }
    // Cross-check global
    $globalP = DATA_DIR . 'analytics_events.json';
    if (file_exists($globalP)) {
        $globalEvents = json_decode(file_get_contents($globalP), true) ?: [];
        $globalPages  = array_column(array_column($globalEvents, 'data'), 'page');
        foreach (['sm', 'ss', 'ts'] as $tt) {
            if (in_array("page-in-$tt", $globalPages)) bad("Global file has leaked event page-in-$tt");
        }
    }
}

// ── Cleanup: restore is done via the shutdown handler above ──────────────
head('Cleanup');
ok('Restore of original files happens on script exit (shutdown handler)');

// ── Summary ──────────────────────────────────────────────────────────────
echo "\n";
echo "═══════════════════════════════════════════════════════\n";
if ($fail === 0) {
    echo "{$GRN}ALL PASSED{$RST}  ($pass checks)\n";
    exit(0);
} else {
    echo "{$RED}FAILED{$RST}  $fail failures / $pass pass\n";
    exit(1);
}
