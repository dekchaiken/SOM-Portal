<?php
/**
 * POST /api/restart-monitor/upload.php
 *
 * Receives a daily restart-monitor JSON snapshot from the local scheduled task
 * and writes it to data/grafana-monitoring/daily/YYYY-MM-DD.json.
 *
 * Auth: shared secret token via header `X-Restart-Monitor-Token`.
 * Token is stored in .env as RESTART_MONITOR_UPLOAD_TOKEN.
 *
 * NOT protected by JWT — this is a machine-to-machine endpoint.
 */

require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/../service-severity/_lookup.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respondError('Method not allowed', 405);
}

// ── Auth: shared secret ──────────────────────────────────────────────────────
$expected = RESTART_MONITOR_UPLOAD_TOKEN;
if (!$expected) {
    respondError('Upload endpoint not configured: RESTART_MONITOR_UPLOAD_TOKEN missing in .env', 500);
}

$provided =
    $_SERVER['HTTP_X_RESTART_MONITOR_TOKEN']
    ?? ($_SERVER['HTTP_AUTHORIZATION'] ?? '');

// Allow "Bearer xxx" form too
if (stripos($provided, 'bearer ') === 0) {
    $provided = trim(substr($provided, 7));
}

if (!$provided || !hash_equals($expected, $provided)) {
    logSecurity('restart_monitor_upload_unauthorized', [
        'ip'          => $_SERVER['REMOTE_ADDR'] ?? 'unknown',
        'user_agent'  => $_SERVER['HTTP_USER_AGENT'] ?? '',
        'tokenLength' => strlen($provided),
    ]);
    respondError('Unauthorized', 401);
}

// ── Read + validate JSON body ────────────────────────────────────────────────
$rawBody = file_get_contents('php://input');
if (!$rawBody) respondError('Empty request body', 400);

if (strlen($rawBody) > 1024 * 1024) {           // 1 MB cap
    respondError('Payload too large (max 1 MB)', 413);
}

$data = json_decode($rawBody, true);
if (!is_array($data)) respondError('Invalid JSON', 400);

// Required top-level fields
$required = ['date', 'cluster', 'totalRestarts', 'pods'];
foreach ($required as $f) {
    if (!array_key_exists($f, $data)) {
        respondError("Missing required field: $f", 400);
    }
}

// ── Team context (M2M uploads: routine supplies "team" in body; default sm) ──
$GLOBALS['_current_team'] = trim((string)($data['team'] ?? 'sm')) ?: 'sm';

// ── Resolve runway (required for per-runway storage) ─────────────────────────
$runwayName = trim((string)($data['runway'] ?? ''));
$runwaySlug = '';
$rwAll = readJson('grafana-runways.json');
foreach ($rwAll['runways'] ?? [] as $rw) {
    if (($rw['name'] ?? '') === $runwayName) {
        $runwaySlug = $rw['slug'] ?? '';
        break;
    }
}
if (!$runwayName) {
    // Backward-compat: legacy uploads with no runway → assume EKS TMN
    $runwayName = 'EKS TMN';
    $runwaySlug = 'EKS-TMN';
    $data['runway'] = $runwayName;
}
if (!$runwaySlug) {
    respondError("Unknown runway '{$runwayName}' — not configured in grafana-runways.json", 400);
}

// Date format YYYY-MM-DD
$date = $data['date'];
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
    respondError('Invalid date format (expected YYYY-MM-DD)', 400);
}

// Pods must be array
if (!is_array($data['pods'])) {
    respondError('pods must be an array', 400);
}

// Reasonableness checks — totalRestarts is the sum of restartCount across pods, not the pod count
$computedTotal = array_sum(array_column($data['pods'], 'restartCount'));
if ($data['totalRestarts'] !== $computedTotal) {
    // not fatal, but log it
    logActivity('restart_monitor_upload_inconsistent_totals', [
        'date'          => $date,
        'totalRestarts' => $data['totalRestarts'],
        'computed'      => $computedTotal,
        'podsCount'     => count($data['pods']),
    ]);
}

// ── Overlay server-side severity from service-severity.json ─────────────────
// data/service-severity.json (managed via admin/service-severity.html) is the
// authoritative source for pod priority. We overwrite any priority/severity the
// client (routine) sent so the mapping stays consistent across both Analyzed
// and Raw / Auto tabs.
$svcMap            = loadServiceSeverityMap();
$severitySummary   = ['critical' => 0, 'warning' => 0, 'info' => 0];
$unmappedPods      = [];
foreach ($data['pods'] as $i => $pod) {
    $podName = $pod['pod'] ?? '';
    $svcLookup = lookupServicePriority($podName, $svcMap);
    $data['pods'][$i]['priority'] = $svcLookup['priority'];
    $data['pods'][$i]['severity'] = $svcLookup['severity'];
    $severitySummary[$svcLookup['severity']] = ($severitySummary[$svcLookup['severity']] ?? 0) + 1;
    if (!$svcLookup['matched']) $unmappedPods[] = $podName;
}
$data['severitySummary'] = $severitySummary;

// ── Write to disk (per-team, per-runway subfolder) ──────────────────────────
$dailyDir = teamDataPath('grafana-monitoring/daily/' . $runwaySlug . '/');
if (!is_dir($dailyDir)) {
    if (!@mkdir($dailyDir, 0775, true)) {
        respondError('Failed to create folder', 500);
    }
}

$file = $dailyDir . $date . '.json';

// Pretty-print + preserve unicode
$pretty = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
if ($pretty === false) {
    respondError('Failed to re-encode JSON', 500);
}

// Atomic write — write to tmp, then rename
$tmp = $file . '.tmp.' . bin2hex(random_bytes(4));
if (file_put_contents($tmp, $pretty) === false) {
    respondError('Failed to write file', 500);
}
if (!rename($tmp, $file)) {
    @unlink($tmp);
    respondError('Failed to commit file', 500);
}

logActivity('restart_monitor_upload', [
    'date'            => $date,
    'runway'          => $runwayName,
    'cluster'         => $data['cluster'] ?? '',
    'totalRestarts'   => $data['totalRestarts'] ?? 0,
    'size'            => strlen($pretty),
    'severitySummary' => $severitySummary,
    'unmappedCount'   => count($unmappedPods),
    'unmappedSample'  => array_slice($unmappedPods, 0, 5),
]);

// ── Notify (best-effort: Chat + Email) ──────────────────────────────────────
$notify = ['skipped' => true];
$skipNotify  = !empty($_GET['skip_notify'])  || isset($_SERVER['HTTP_X_RESTART_MONITOR_SKIP_NOTIFY']);
$forceNotify = !empty($_GET['force_notify']) || isset($_SERVER['HTTP_X_RESTART_MONITOR_FORCE_NOTIFY']);
if (!$skipNotify) {
    require_once __DIR__ . '/_notify.php';
    try {
        // ?force_notify=1 → clear today's idempotency entry so notify fires again (testing)
        if ($forceNotify) {
            $hf = teamDataPath('grafana-monitoring/notify-history.json');
            if (file_exists($hf)) {
                $h = json_decode(file_get_contents($hf), true) ?? [];
                $h = array_values(array_filter($h, fn($k) => strpos($k, $date . '_') !== 0));
                @file_put_contents($hf, json_encode($h, JSON_PRETTY_PRINT));
            }
        }
        $notify = sendRestartMonitorNotifications($data);
    } catch (Throwable $e) {
        $notify = ['error' => $e->getMessage()];
    }
}

respondOk([
    'date'         => $date,
    'runway'       => $runwayName,
    'savedTo'      => 'data/grafana-monitoring/daily/' . $runwaySlug . '/' . $date . '.json',
    'size'         => strlen($pretty),
    'podsCount'    => count($data['pods']),
    'notifications'=> $notify,
]);
