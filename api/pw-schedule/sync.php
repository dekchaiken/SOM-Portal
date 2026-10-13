<?php
/**
 * pw-schedule/sync.php
 *
 * Sync PW items from a Google Sheet via an n8n workflow.
 *
 *   POST { round: "YYYY-MM-DD", dry_run?: bool }
 *
 * The PHP backend calls the configured n8n webhook with a shared secret.
 * n8n returns ALL relevant rows from the sheet, mapped to the PW shape:
 *
 *   {
 *     "items": [
 *       {
 *         "type":   "INTERNAL" | "EXTERNAL",
 *         "ref":    "CMT-14207",
 *         "title":  "Ascend BIT - Deploy ...",
 *         "start":  "2026-05-15T10:00:00+07:00",
 *         "end":    "2026-05-15T10:30:00+07:00",
 *         "mop":    "https://...",       // optional
 *         "meet":   "https://...",       // optional
 *         "task":   "...",                // optional
 *         "impact": "No Service Impacted",// optional
 *         "owner":  "...",                // optional
 *         "remark": "...",                // optional
 *         "ticket": "..."                 // optional
 *       }
 *     ]
 *   }
 *
 * Routing — each incoming item is placed into the round its start time falls
 *   into. The boundary is 12:00 Asia/Bangkok: a start at/after 12:00 belongs
 *   to that calendar date's round; before 12:00 it tails the previous date.
 *
 * Dedup — across ALL rounds. If a PW with the same ticket reference token
 *   (CMT-XXXX, TJCR-XXXX, …) already exists anywhere, the incoming row is
 *   SKIPPED (existing items are never modified).
 *
 * The `round` parameter from the request is used only for the activity log
 *   and to decide which round to surface in the response summary.
 */
require_once __DIR__ . '/../helpers.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') respondError('POST required', 405);

$payload = requireAuth();
// Sync from Google Sheet writes into the SM-shared pw_schedule.json.
requireSmForShared();
$body    = getBody();

$round  = trim($body['round'] ?? '');
$dryRun = !empty($body['dry_run']);
if (!$round) respondError('round required', 400);
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $round)) respondError('round must be YYYY-MM-DD', 400);

$config = readJson('pw_schedule_config.json');
$webhook = trim($config['n8n_sync_webhook'] ?? '');
$secret  = trim($config['n8n_sync_secret']  ?? '');
if ($webhook === '') respondError('n8n sync webhook not configured', 400);

// ── Compute the requested round's window for the n8n hint ─────────────
date_default_timezone_set('Asia/Bangkok');
$windowStart = strtotime($round . ' 12:00:00');
$windowEnd   = $windowStart + 86400;

// Compute the round key for an item's start time. Mirrors the rule in
// api/pw-schedule/index.php::pwRoundKeyFromStart — a start ≥ 12:00 belongs
// to that calendar date's round; before 12:00 it tails the previous date.
$roundKeyFromStart = function(string $iso): ?string {
    $ts = strtotime($iso);
    if ($ts === false) return null;
    $h = (int)date('H', $ts);
    if ($h < 12) {
        return date('Y-m-d', $ts - 86400);
    }
    return date('Y-m-d', $ts);
};

// ── Call n8n ──────────────────────────────────────────────────────────
$ch = curl_init($webhook);
$req = [
    'round'        => $round,
    'window_start' => date('c', $windowStart),
    'window_end'   => date('c', $windowEnd),
    'requested_by' => $payload['name'] ?? $payload['sub'],
];
$headers = ['Content-Type: application/json; charset=UTF-8'];
if ($secret !== '') $headers[] = 'X-Sync-Secret: ' . $secret;

curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => json_encode($req, JSON_UNESCAPED_UNICODE),
    CURLOPT_HTTPHEADER     => $headers,
    CURLOPT_SSL_VERIFYPEER => false,
    // Bumped from 30s → 60s: n8n cold-starts and Google Sheets pulls can be
    // slow on first hit of the day, and a timeout there surfaces as
    // "Non-JSON body" downstream which looks like a config bug.
    CURLOPT_TIMEOUT        => 60,
    CURLOPT_CONNECTTIMEOUT => 10,
]);
$resp    = curl_exec($ch);
$code    = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlErr = curl_error($ch);
curl_close($ch);

// Short body preview used across all failure branches so the user can see
// what n8n actually said (usually the exact reason the workflow failed).
$bodyPreview = trim(preg_replace('/\s+/', ' ', substr((string)$resp, 0, 300)));
if ($bodyPreview === '') $bodyPreview = '(empty response)';

if ($curlErr) {
    logIntegrationError('n8n-pw-sync', $webhook, $curlErr, ['http_code' => $code]);
    respondError('cURL error calling n8n: ' . $curlErr, 502);
}
if ($code !== 200) {
    logIntegrationError('n8n-pw-sync', $webhook, "HTTP {$code}", [
        'http_code' => $code,
        'body'      => $bodyPreview,
    ]);
    respondError("n8n returned HTTP {$code} — body: {$bodyPreview}", 502);
}

// Handle empty 200 bodies as a valid no-op. n8n workflows commonly finish
// with no "Respond to Webhook" node (or one that returns nothing), which is
// harmless but was surfacing as a hard 502 on every page load. Non-empty
// non-JSON responses are still treated as errors — those indicate a real
// misconfiguration (HTML error page, workflow crash, etc.).
$respStr = (string)$resp;
if ($respStr === '') {
    logIntegrationError('n8n-pw-sync', $webhook, 'Empty 200 body — treated as no-op', [
        'hint' => 'n8n workflow returned 200 with no body. Add a "Respond to Webhook" node returning { items: [...] } to actually import rows.',
    ]);
    $decoded = ['items' => []];
} else {
    $decoded = json_decode($respStr, true);
    if (!is_array($decoded)) {
        logIntegrationError('n8n-pw-sync', $webhook, 'Non-JSON body', [
            'body' => $bodyPreview,
        ]);
        // Include the body preview in the client-facing error so the admin can
        // paste it into the n8n workflow debugger without hunting through server
        // logs. Common causes: workflow is inactive, Respond node returns HTML,
        // upstream (Google Sheets) auth expired.
        respondError("n8n returned non-JSON body — response was: {$bodyPreview}", 502);
    }
}

// n8n payload may be either { items: [...] } or a top-level array
$incoming = [];
if (isset($decoded['items']) && is_array($decoded['items'])) {
    $incoming = $decoded['items'];
} elseif (array_is_list($decoded)) {
    $incoming = $decoded;
} else {
    respondError('Unexpected n8n response shape (expected items[])', 502);
}

// ── Build dedup index across ALL rounds ───────────────────────────────
$rounds = readJson('pw_schedule.json');
$refTokenRegex = '/\b([A-Z]{2,8})[\s-]?(\d{3,7})\b/';
$existingRefs = [];
foreach ($rounds as $r) {
    foreach (($r['items'] ?? []) as $it) {
        if (preg_match($refTokenRegex, $it['pw_name'] ?? '', $m)) {
            $existingRefs[strtoupper($m[1] . '-' . $m[2])] = true;
        }
        if (!empty($it['ticket']) && preg_match($refTokenRegex, $it['ticket'], $m)) {
            $existingRefs[strtoupper($m[1] . '-' . $m[2])] = true;
        }
    }
}

// Helper to find or create a round bucket and return its index
$findOrCreateRound = function(array &$rounds, string $key): int {
    foreach ($rounds as $i => $r) {
        if (($r['round'] ?? '') === $key) return $i;
    }
    $rounds[] = ['round' => $key, 'created_at' => date('c'), 'items' => []];
    return count($rounds) - 1;
};

// ── Process incoming items ────────────────────────────────────────────
$imported = [];   // [{round, ref, pw_name}]
$skipped  = [];   // [{ref, title, reason}]
$rejected = [];   // [{ref, title, reason}]
$roundsTouched = [];

foreach ($incoming as $row) {
    if (!is_array($row)) { $rejected[] = ['reason' => 'not an object']; continue; }

    $title = trim((string)($row['title']   ?? $row['pw_name']  ?? ''));
    $ref   = strtoupper(trim((string)($row['ref'] ?? $row['reference'] ?? '')));
    $start = trim((string)($row['start'] ?? ''));
    $end   = trim((string)($row['end']   ?? ''));

    if ($title === '' || $start === '' || $end === '') {
        $rejected[] = ['ref' => $ref, 'reason' => 'missing title/start/end'];
        continue;
    }

    $sTs = strtotime($start);
    $eTs = strtotime($end);
    if (!$sTs || !$eTs) {
        $rejected[] = ['ref' => $ref, 'title' => $title, 'reason' => 'invalid datetime'];
        continue;
    }
    if ($eTs <= $sTs) {
        $rejected[] = ['ref' => $ref, 'title' => $title, 'reason' => 'end <= start'];
        continue;
    }

    // Determine which round this item belongs to (by its own start)
    $itemRound = $roundKeyFromStart($start);
    if (!$itemRound) {
        $rejected[] = ['ref' => $ref, 'title' => $title, 'reason' => 'cannot determine round'];
        continue;
    }

    // Build pw_name = "REF Title" (avoid double-prefix)
    if ($ref !== '' && stripos($title, $ref) === false) {
        $pwName = $ref . ' ' . $title;
    } else {
        $pwName = $title;
    }

    // Dedup
    $dedupKey = $ref;
    if ($dedupKey === '' && preg_match($refTokenRegex, $pwName, $m)) {
        $dedupKey = strtoupper($m[1] . '-' . $m[2]);
    }
    if ($dedupKey !== '' && !empty($existingRefs[$dedupKey])) {
        $skipped[] = ['ref' => $dedupKey, 'title' => $title, 'reason' => 'already exists'];
        continue;
    }

    $type = strtoupper(trim((string)($row['type'] ?? 'INTERNAL')));
    if (!in_array($type, ['INTERNAL', 'EXTERNAL'], true)) $type = 'INTERNAL';

    $newItem = [
        'id'          => genId('pw'),
        'completed'   => false,
        'created_at'  => date('c'),
        'created_by'  => 'sync:' . ($payload['name'] ?? $payload['sub']),
        'type'        => $type,
        'pw_name'     => $pwName,
        'start'       => date('c', $sTs),
        'end'         => date('c', $eTs),
        'mop'         => trim((string)($row['mop']    ?? '')),
        'meet'        => trim((string)($row['meet']   ?? '')),
        'task'        => trim((string)($row['task']   ?? '')),
        'impact'      => trim((string)($row['impact'] ?? '')),
        'owner'       => trim((string)($row['owner']  ?? '')),
        'remark'      => trim((string)($row['remark'] ?? '')),
        'ticket'      => trim((string)($row['ticket'] ?? '')),
        'attachments' => [],
        'source'      => 'sheet_sync',
    ];

    if (!$dryRun) {
        $bucketIdx = $findOrCreateRound($rounds, $itemRound);
        $rounds[$bucketIdx]['items'][] = $newItem;
        $roundsTouched[$itemRound] = true;
    }
    if ($dedupKey !== '') $existingRefs[$dedupKey] = true;
    $imported[] = ['round' => $itemRound, 'ref' => $dedupKey, 'pw_name' => $pwName];
}

// ── Persist ───────────────────────────────────────────────────────────
if (!$dryRun && $imported) {
    foreach ($rounds as &$r) {
        if (!empty($roundsTouched[$r['round'] ?? ''])) {
            usort($r['items'], fn($a, $b) => strcmp($a['start'] ?? '', $b['start'] ?? ''));
        }
    }
    unset($r);
    writeJson('pw_schedule.json', $rounds);
}

logActivity('pw_sync', [
    'requested_round' => $round,
    'incoming'        => count($incoming),
    'imported'        => count($imported),
    'skipped'         => count($skipped),
    'rejected'        => count($rejected),
    'rounds_touched'  => array_keys($roundsTouched),
    'dry_run'         => $dryRun,
], $payload['sub'], $payload['name'] ?? '');

respondOk([
    'round'          => $round,
    'dry_run'        => $dryRun,
    'incoming'       => count($incoming),
    'imported'       => $imported,
    'skipped'        => $skipped,
    'rejected'       => $rejected,
    'rounds_touched' => array_keys($roundsTouched),
]);
