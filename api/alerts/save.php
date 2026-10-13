<?php
// POST /api/alerts/save.php
// Body: full rule object. `id` present → update. Missing → create.
// SM-shared write: gated by requireSmForShared() so viewers can only read.
require_once __DIR__ . '/_lib.php';
$user = requireAuth();
requireSmForShared();

$body = json_decode(file_get_contents('php://input'), true);
if (!is_array($body)) respondError('invalid JSON body', 400);

$err = alertsValidateRule($body);
if ($err) respondError($err, 400);

$rules = alertsLoadRules();

// Normalise the incoming rule — only keep known fields so callers can't
// smuggle extra keys into storage.
$now   = time();
$clean = [
    'id'          => (string)($body['id'] ?? ''),
    'service'     => (string)$body['service'],
    'metric'      => (string)$body['metric'],
    'op'          => (string)$body['op'],
    'threshold'   => (float)$body['threshold'],
    'durationSec' => (int)($body['durationSec'] ?? 60),
    'repeatIntervalSec' => (int)($body['repeatIntervalSec'] ?? 0),
    'cluster'     => (string)($body['cluster']  ?? ''),
    'channel'     => (string)($body['channel']  ?? 'default'),
    'enabled'     => (bool)($body['enabled'] ?? true),
    'note'        => (string)($body['note'] ?? ''),
    // Per-endpoint scoping: optional regex/exact URI pattern. When set,
    // tick.php appends `,uri=~"<pat>"` to the metric's jvmSel so the same
    // metric can be watched per-route (e.g. only /api/withdraw). Applies
    // only to metrics with supportsUri=true in the catalog.
    'uriPattern'  => trim((string)($body['uriPattern'] ?? '')),
    'updatedBy'   => $user['username'] ?? 'unknown',
    'updatedAt'   => date('c', $now),
];

$found = false;
foreach ($rules as &$r) {
    if (($r['id'] ?? '') === $clean['id'] && $clean['id'] !== '') {
        // Preserve original createdBy/At on update.
        $clean['createdBy'] = $r['createdBy'] ?? $clean['updatedBy'];
        $clean['createdAt'] = $r['createdAt'] ?? $clean['updatedAt'];
        $r     = $clean;
        $found = true;
        break;
    }
}
unset($r);

if (!$found) {
    $clean['id']        = alertsNewId();
    $clean['createdBy'] = $clean['updatedBy'];
    $clean['createdAt'] = $clean['updatedAt'];
    $rules[] = $clean;
}

alertsSaveRules($rules);
respondOk(['rule' => $clean, 'created' => !$found]);
