<?php
// GET /api/alerts/list.php[?service=X]
// Returns all alert rules for the current team, optionally filtered to a
// single service. Each rule is enriched with the latest state from
// state.json so the UI can show ok/pending/firing chips without a second
// request. Team-shared: every SM user sees the same rules.
require_once __DIR__ . '/_lib.php';
requireAuth();

$svc = trim((string)($_GET['service'] ?? ''));

$rules = alertsLoadRules();
$state = alertsLoadState();
$out = [];
foreach ($rules as $r) {
    if ($svc !== '' && ($r['service'] ?? '') !== $svc) continue;
    $st = $state[$r['id']] ?? [];
    $out[] = $r + [
        'state'       => $st['state']       ?? 'ok',
        'sinceTs'     => $st['sinceTs']     ?? 0,
        'lastCheck'   => $st['lastCheck']   ?? 0,
        'lastFireTs'  => $st['lastFireTs']  ?? 0,
        'lastValue'   => $st['lastValue']   ?? null,
        'notifyOk'    => $st['notifyOk']    ?? null,
        'notifyError' => $st['notifyError'] ?? null,
    ];
}

respondOk([
    'rules'   => $out,
    'metrics' => alertMetricsCatalog(),
]);
