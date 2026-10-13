<?php
// POST /api/alerts/test.php  body: { id }
// Fires a distinctly-labelled "TEST" Google Chat card for one rule so
// the user can verify their webhook URL works WITHOUT waiting for
// tick.php to detect a real threshold breach. Returns diagnostics
// (HTTP code + response body) so bad webhook URLs are visible to the
// user, not just error_log.
require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_notify.php';
requireAuth();
requireSmForShared();

$body = json_decode(file_get_contents('php://input'), true) ?: [];
$id = trim((string)($body['id'] ?? ''));
if ($id === '') respondError('id required', 400);

$rules   = alertsLoadRules();
$catalog = alertMetricsCatalog();
$rule = null;
foreach ($rules as $r) if (($r['id'] ?? '') === $id) { $rule = $r; break; }
if (!$rule) respondError('rule not found', 404);

$m = $catalog[$rule['metric']] ?? null;
if (!$m) respondError('metric unknown: ' . $rule['metric'], 400);

// Build the same-shape card as a real fire — but tagged 'test' so the
// header renders in blue with a science-flask icon and the banner text
// makes it clear this is a manual verification, not a real breach.
$card   = alertsBuildCard($rule, $m, null, 'test');
$result = alertsSendCard($rule, $card);

// Extra channel info for the UI toast so a "no webhook" fail hints at
// which channel to configure.
respondOk([
    'ok'           => $result['ok'],
    'reason'       => $result['ok'] ? 'sent' : ($result['error'] ?? 'failed'),
    'channelKey'   => $rule['channel'] ?? 'default',
    'httpCode'     => $result['httpCode'],
    'responseBody' => $result['responseBody'],
]);
