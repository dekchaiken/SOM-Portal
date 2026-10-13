<?php
/**
 * n8n-severity-sync.php
 *
 * POST  → trigger sync: call n8n webhook, apply "sheet wins" to
 *         data/service-severity.json (add/update/delete to match Sheet),
 *         return diff summary.
 *
 * GET   → return last-sync metadata (lastSyncedAt, lastResult).
 *
 * Auth: admin only.
 */
require_once __DIR__ . '/helpers.php';

$payload = requireAuth();
requireRole($payload, ADMIN_ROLES);

// ── GET: return last sync status ──────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $last = readJson('n8n_severity_last_sync.json');
    respondOk(['lastSync' => empty($last) ? null : $last]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') respondError('Method not allowed', 405);

requireCsrf();

// ── Load webhook config ───────────────────────────────────────────────────────
$config = readJson('n8n_severity_config.json');
if (empty($config)) {
    respondError('ยังไม่ได้ตั้งค่า n8n webhook URL — เปิด Sync modal แล้วบันทึก URL ก่อน', 400);
}
$url    = trim($config['webhook_url'] ?? '');
if (!$url) respondError('webhook_url ว่าง — เปิด Sync modal แล้วบันทึก URL ก่อน', 400);

// ── Call n8n webhook (POST — workflow's webhook node is set to POST) ─────────
$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_TIMEOUT        => 60,
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => '{}',
    CURLOPT_HTTPHEADER     => [
        'Accept: application/json',
        'Content-Type: application/json',
    ],
]);
$body   = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$err    = curl_error($ch);
curl_close($ch);

if ($err) {
    logIntegrationError('n8n-severity-webhook', $url, $err, ['http_code' => $status]);
    respondError('n8n webhook error: ' . $err, 502);
}
if ($status !== 200) {
    logIntegrationError('n8n-severity-webhook', $url, "HTTP {$status}", [
        'http_code' => $status,
        'body'      => substr((string)$body, 0, 200),
    ]);
    respondError('n8n webhook returned HTTP ' . $status . ' | ' . substr(strip_tags((string)$body), 0, 120), 502);
}
if ($body === '' || $body === false || $body === null) {
    logIntegrationError('n8n-severity-webhook', $url, 'Empty body', ['http_code' => $status]);
    respondError('n8n returned empty body', 502);
}

$rows = json_decode($body, true);
if (!is_array($rows)) {
    logIntegrationError('n8n-severity-webhook', $url, 'Non-JSON body', ['body' => substr((string)$body, 0, 200)]);
    respondError('n8n returned non-JSON: ' . substr((string)$body, 0, 120), 502);
}

// Unwrap [{json:{...}}] (default n8n output shape)
if (isset($rows[0]['json']) && is_array($rows[0]['json'])) {
    $rows = array_map(fn($r) => $r['json'], $rows);
}
// Unwrap {data:[...]} or {services:[...]}
if (!isset($rows[0])) {
    if (isset($rows['data']))     $rows = $rows['data'];
    elseif (isset($rows['services'])) $rows = $rows['services'];
}
if (!is_array($rows) || !count($rows)) respondError('n8n returned no rows', 502);

// ── Normalize incoming rows ───────────────────────────────────────────────────
// Accept both kebab-case (name, priority, ...) and Sheet headers
// (Service name, Service group, Priority, BU).
$incoming = [];
$skippedInvalid = 0;
$collisions = [];
$defaultedByRunway = [];   // [runway => count]
$defaultedSamples  = [];   // [runway => [name1, name2, ...]] (cap 10 each)
foreach ($rows as $r) {
    if (!is_array($r)) { $skippedInvalid++; continue; }

    $name    = trim((string)($r['name']         ?? $r['Service name']  ?? $r['service_name']  ?? ''));
    $prio    = strtoupper(trim((string)($r['priority']     ?? $r['Priority']      ?? '')));
    $group   = trim((string)($r['serviceGroup'] ?? $r['Service group'] ?? $r['service_group'] ?? ''));
    $bu      = trim((string)($r['bu']           ?? $r['BU']            ?? '')) ?: 'Truemoney';
    $runway  = trim((string)($r['runway']       ?? $r['Runway']        ?? ''));
    $defaulted = !empty($r['priorityDefaulted']);

    if (!$name || !in_array($prio, ['P1', 'P2', 'P3'], true)) { $skippedInvalid++; continue; }
    // Cross-tab name collision (same service appears in multiple runway tabs):
    // last-wins, but log so admin knows.
    if (isset($incoming[$name]) && ($incoming[$name]['runway'] ?? '') !== $runway) {
        $collisions[] = $name . ' (' . ($incoming[$name]['runway'] ?? '?') . ' → ' . $runway . ')';
    }
    $incoming[$name] = ['priority' => $prio, 'serviceGroup' => $group, 'bu' => $bu, 'runway' => $runway];

    if ($defaulted) {
        $rwKey = $runway ?: '(unspecified)';
        $defaultedByRunway[$rwKey] = ($defaultedByRunway[$rwKey] ?? 0) + 1;
        if (!isset($defaultedSamples[$rwKey])) $defaultedSamples[$rwKey] = [];
        if (count($defaultedSamples[$rwKey]) < 10) $defaultedSamples[$rwKey][] = $name;
    }
}
if (!$incoming) respondError('No valid rows from n8n (need name + priority P1/P2/P3)', 502);

// ── Load current and compute diff ─────────────────────────────────────────────
$current  = readJson('service-severity.json');
if (empty($current)) {
    $current = ['services' => [], 'lastUpdated' => null, 'updatedBy' => null, 'count' => 0];
}
$existing = is_array($current['services'] ?? null) ? $current['services'] : [];

$added = $updated = $unchanged = [];
foreach ($incoming as $name => $svc) {
    if (!isset($existing[$name])) {
        $added[] = $name;
    } else {
        $old = $existing[$name];
        if (($old['priority']     ?? '') !== $svc['priority']
            || ($old['serviceGroup'] ?? '') !== $svc['serviceGroup']
            || ($old['bu']           ?? '') !== $svc['bu']
            || ($old['runway']       ?? '') !== $svc['runway']) {
            $updated[] = $name;
        } else {
            $unchanged[] = $name;
        }
    }
}
$deleted = array_values(array_diff(array_keys($existing), array_keys($incoming)));

// ── Apply: sheet is the authority. Overwrite services map entirely. ─────────
ksort($incoming);
$now = (new DateTime('now', new DateTimeZone('Asia/Bangkok')))->format('c');
$newData = [
    'services'    => $incoming,
    'count'       => count($incoming),
    'lastUpdated' => $now,
    'updatedBy'   => 'n8n-sync (' . ($payload['username'] ?? 'unknown') . ')',
];

if (!writeJson('service-severity.json', $newData)) {
    respondError('Failed to save service-severity.json', 500);
}

// ── Persist last-sync metadata ────────────────────────────────────────────────
// Tally per-runway breakdown for the response
$byRunway = [];
foreach ($incoming as $svc) {
    $rw = $svc['runway'] ?: '(unspecified)';
    $byRunway[$rw] = ($byRunway[$rw] ?? 0) + 1;
}
ksort($byRunway);

$summary = [
    'syncedAt'   => $now,
    'syncedBy'   => $payload['username'] ?? 'unknown',
    'sheetTotal' => count($incoming),
    'added'      => count($added),
    'updated'    => count($updated),
    'deleted'    => count($deleted),
    'unchanged'  => count($unchanged),
    'skippedInvalid' => $skippedInvalid,
    'byRunway'   => $byRunway,
    'collisions' => array_slice($collisions, 0, 20),
    'defaulted'  => array_sum($defaultedByRunway),
    'defaultedByRunway' => $defaultedByRunway,
    'defaultedSamples'  => $defaultedSamples,
    // Cap samples to keep file small
    'addedSample'   => array_slice($added,   0, 20),
    'updatedSample' => array_slice($updated, 0, 20),
    'deletedSample' => array_slice($deleted, 0, 20),
];
writeJson('n8n_severity_last_sync.json', $summary);

logActivity('n8n_severity_sync', [
    'added' => $summary['added'], 'updated' => $summary['updated'],
    'deleted' => $summary['deleted'], 'unchanged' => $summary['unchanged'],
    'skippedInvalid' => $skippedInvalid, 'total' => count($incoming),
]);

respondOk($summary, 'Sync จาก Sheet สำเร็จ');
