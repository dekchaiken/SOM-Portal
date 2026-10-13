<?php
/**
 * GET /api/begin-grafana/custom-series.php
 *   ?service=<name>&metric=<full metric name>&mode=success|fail|total[&window=<min>]
 *
 * Fetches range series for one custom business-counter metric grouped by
 * (service, status_code). Powers the Success/Fail stacked-area charts.
 */
require_once __DIR__ . '/_lib.php';

$payload = requireAuth();
requireSmTeamOnly('Begin Grafana');
if ($_SERVER['REQUEST_METHOD'] !== 'GET') respondError('Method not allowed', 405);

$service = trim((string)($_GET['service'] ?? ''));
$metric  = trim((string)($_GET['metric']  ?? ''));
$mode    = trim((string)($_GET['mode']    ?? 'success'));
$window  = min(1440, max(5, (int)($_GET['window'] ?? 30)));

if ($service === '' || !preg_match('/^[a-z0-9._-]+$/i', $service)) respondError('service is required', 400);
if ($metric  === '' || !preg_match('/^[a-zA-Z_:][a-zA-Z0-9_:]*$/', $metric)) respondError('valid metric name required', 400);
if (!in_array($mode, ['success', 'fail', 'total'], true)) respondError('mode must be success|fail|total', 400);

[$src, $cluster, $appLabel, ] = bgDetectSource($service);
if (!$src) respondError('no matching source for service', 404);
$jvmSrc = $src;
$jvmSrc['dsUid'] = (string)$src['jvmDsUid'];

// Client passes back the per-metric narrowSel returned by custom-list so
// each metric uses the correct scope (some carry app_name, some pod, some
// nothing). `scoped=0` is a legacy escape hatch (== empty narrowSel).
$narrowSel = (string)($_GET['narrowSel'] ?? '');
$scoped = ((string)($_GET['scoped'] ?? '1')) !== '0';
if ($narrowSel !== '') $baseSel = $narrowSel;
else if ($scoped)       $baseSel = bgSelector($service, $cluster, $appLabel);
else                    $baseSel = '';
// Reject anything that isn't a plausible Prometheus label matcher list.
if ($baseSel !== '' && !preg_match('/^[a-zA-Z0-9_,="~!\(\)\-\.\*\+\?\|\s]+$/', $baseSel)) {
    respondError('invalid narrowSel', 400);
}
$extra = '';
if ($mode === 'success')  $extra = 'status_code=~"200.*"';
elseif ($mode === 'fail') $extra = 'status_code!~"200.*"';
$parts = [];
if ($baseSel !== '') $parts[] = $baseSel;
if ($extra   !== '') $parts[] = $extra;
$sel = implode(',', $parts);
$expr = $sel === '' ? $metric : ($metric . '{' . $sel . '}');
$q = 'sum by (service, status_code) (rate(' . $expr . '[1m]))';

$end   = time();
$start = $end - ($window * 60);
$step  = max(15, (int)round(($end - $start) / 180));

try {
    $rng = spQueryPromRange($jvmSrc, ['m' => $q], $start, $end, $step);
} catch (Throwable $e) {
    respondError('PromQL range failed: ' . $e->getMessage(), 502);
}

// Build one series per (service|status_code) label combo.
$series = [];
foreach (($rng['m'] ?? []) as $row) {
    $svc  = (string)($row['metric']['service']     ?? '');
    $stat = (string)($row['metric']['status_code'] ?? '');
    $label = trim(($svc !== '' ? $svc : '') . ($svc !== '' && $stat !== '' ? ' · ' : '') . $stat);
    if ($label === '') $label = '(no labels)';
    $pts = [];
    foreach (($row['values'] ?? []) as $p) {
        $pts[] = [(int)$p[0], $p[1] === 'NaN' ? null : (float)$p[1]];
    }
    $series[] = ['name' => $label, 'service' => $svc, 'status_code' => $stat, 'points' => $pts];
}

// Sort by peak value desc so busiest series are stacked first.
usort($series, function($a, $b) {
    $ma = 0; foreach ($a['points'] as $p) if ($p[1] !== null && $p[1] > $ma) $ma = $p[1];
    $mb = 0; foreach ($b['points'] as $p) if ($p[1] !== null && $p[1] > $mb) $mb = $p[1];
    return $mb <=> $ma;
});

respondOk([
    'service' => $service,
    'metric'  => $metric,
    'mode'    => $mode,
    'query'   => $q,
    'window'  => ['minutes' => $window, 'startUnix' => $start, 'endUnix' => $end, 'stepSeconds' => $step],
    'series'  => $series,
]);
