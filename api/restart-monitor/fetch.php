<?php
/**
 * POST /api/restart-monitor/fetch.php[?runway=EKS%20TMN][&date=YYYY-MM-DD][&force=1][&skip_notify=1]
 *
 * Browser-triggered endpoint. Delegates the actual fetch pipeline to
 * _fetch_lib.php so the CLI backfill script (backfill.php) can reuse it.
 *
 * Params (all optional):
 *  - runway=NAME            fetch just this one runway (default: all in grafana-runways.json)
 *  - date=YYYY-MM-DD        anchor at this date's 09:00 ICT (default: today)
 *  - force=1                overwrite existing raw file (default: skip if exists)
 *  - skip_notify=1          write files but don't send Chat/email (default: notify)
 *
 * Writes raw+daily JSON under data/{team}/grafana-monitoring/{raw,daily}/{slug}/.
 * Severity is enriched via service-severity.json (priority + severity per pod)
 * so the file is ready for both the UI list and the Analyzed pipeline.
 */

require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/../service-severity/_lookup.php';
require_once __DIR__ . '/_fetch_lib.php';

$payload = requireAuth();
requireRole($payload, ALL_STAFF_ROLES);
// Writes to SM-shared data/sm/grafana-monitoring/raw/ — non-SM teams (including
// super_admin viewing-as another team) get 403. The scheduled RestartFetchScheduler
// runs against the SM context.
requireSmForShared();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') respondError('Method not allowed', 405);

set_time_limit(300);
ini_set('memory_limit', '512M');
ignore_user_abort(true);

$tz = new DateTimeZone('Asia/Bangkok');

// ── Resolve anchor date ──────────────────────────────────────────────────
$dateStr = trim((string)($_GET['date'] ?? ''));
if ($dateStr !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $dateStr)) {
    respondError('Invalid date format. Use YYYY-MM-DD', 400);
}
try {
    $anchorDt = $dateStr !== ''
        ? (new DateTime($dateStr, $tz))->setTime(9, 0, 0)
        : (new DateTime('now', $tz))->setTime(9, 0, 0);
} catch (Exception $e) {
    respondError('Invalid date: ' . $e->getMessage(), 400);
}

$force       = !empty($_GET['force'])       || !empty($_POST['force']);
$sendNotify  = empty($_GET['skip_notify'])  && empty($_POST['skip_notify']);
$wantRunway  = trim((string)($_GET['runway'] ?? ''));

// ── Load runway config (team-scoped) ──────────────────────────────────────
$cfg = readJson('grafana-runways.json');
if (empty($cfg)) respondError('grafana-runways.json missing for this team', 500);
$runways = $cfg['runways'] ?? [];
if ($wantRunway !== '') {
    $runways = array_values(array_filter($runways, fn($r) => ($r['name'] ?? '') === $wantRunway));
    if (!$runways) respondError("Unknown runway '{$wantRunway}'", 400);
}

$svcMap    = loadServiceSeverityMap();
$userLabel = $payload['username'] ?? 'unknown';

$results = [];
foreach ($runways as $rw) {
    $results[] = rmFetchOneRunwayDate(
        $rw, $anchorDt, $tz, $svcMap, $force, $sendNotify, $userLabel, 'browser'
    );
}

respondOk([
    'date'       => $anchorDt->format('Y-m-d'),
    'anchoredAt' => $anchorDt->format(DateTime::ATOM),
    'results'    => $results,
]);
