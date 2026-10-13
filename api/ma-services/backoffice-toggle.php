<?php
// ══════════════════════════════════════════════════════════════════
//  MA Services — Backoffice Toggle
//  Enable / disable MA on the Admin Portal for a single ma-service.
//  Uses the shared SM Keycloak service account (see _backoffice.php).
//  Every toggle attempt (success or fail) writes to activity.json so
//  SM can trace which real user pressed the button — Admin Portal's
//  own audit log will only show the shared account.
//
//  POST body: { id: int, action: 'enable'|'disable', reason: string }
// ══════════════════════════════════════════════════════════════════

require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/../ma-status/_backoffice.php';

$payload = requireAuth();
requireSmForShared(); // SM team only — non-SM viewers get 403 here

header('Content-Type: application/json');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    respondError('Method not allowed', 405);
}

$input = json_decode(file_get_contents('php://input'), true) ?: [];
$id     = isset($input['id']) ? (int)$input['id'] : 0;
$action = strtolower(trim((string)($input['action'] ?? '')));
$reason = trim((string)($input['reason'] ?? ''));   // optional, no length gate

if ($id <= 0)                                  respondError('Missing or invalid id');
if (!in_array($action, ['enable','disable']))  respondError("action must be 'enable' or 'disable'");
if (mb_strlen($reason) > 500)                  respondError('Reason too long (max 500 chars)');

// ── Soft anti-double-click gate (per user, 3 sec) ───────────────────
$rlFile = 'ma-toggle-rl.json';
$rl     = readJson($rlFile);
$uid    = (string)($payload['sub'] ?? '');
$now    = time();
if ($uid && !empty($rl[$uid]) && ($now - (int)$rl[$uid]) < 3) {
    respondError('Too fast — wait a moment before toggling again', 429);
}
$rl[$uid] = $now;
// GC entries older than 1h
foreach ($rl as $k => $ts) if (($now - (int)$ts) > 3600) unset($rl[$k]);
writeJson($rlFile, $rl);

// ── Locate the service ─────────────────────────────────────────────
$dataFile = teamDataPath('ma-services.json');
if (!file_exists($dataFile)) respondError('Data file not found', 500);
$data = json_decode(file_get_contents($dataFile), true);
if (!is_array($data) || empty($data['services'])) respondError('Data file corrupt', 500);

$idx = -1;
foreach ($data['services'] as $i => $svc) {
    if ((int)($svc['id'] ?? 0) === $id) { $idx = $i; break; }
}
if ($idx < 0) respondError('Service not found', 404);

$svc     = $data['services'][$idx];
$useCase = (int)($svc['backoffice_use_case_id'] ?? 0);
// Frontend may pass a resolved use_case_id (from fuzzy name match) when the
// record has none set — accept it and persist so subsequent calls are explicit.
$clientUseCase = isset($input['use_case_id']) ? (int)$input['use_case_id'] : 0;
if ($useCase <= 0 && $clientUseCase > 0) $useCase = $clientUseCase;
if ($useCase <= 0) respondError('Service is not linked to an Admin Portal use_case_id');

// ── Call Admin Portal ──────────────────────────────────────────────
// Admin Portal write contract (discovered via devtools capture):
//   PUT /…/config/use-cases/{id}
//   Body: { useCaseName, useCaseType, maEnable, updatedBy, maEnablePropertyIds }
// Fields are camelCase (NOT the snake_case that /search returns).
// Read-modify-write: pull current object to get name/type/propertyIds, then
// flip maEnable and PUT the 5 required fields back.
$enable = ($action === 'enable');
$basePath = '/acm-backoffice-api-gateway/ops-service-maintenance-server/config/use-cases';

// Step 1 — fetch current object via /search (single-object GET hits a
// different service — Spring Cloud Config — that doesn't have use-case data).
// Search response is snake_case and includes all fields including
// ma_enable_property_ids that the write endpoint requires.
$current = null;
$listRes = backofficeCall('GET', "$basePath/search?pageSize=500");
if ($listRes['ok'] && is_array($listRes['data'])) {
    foreach (($listRes['data']['content'] ?? []) as $row) {
        if ((int)($row['use_case_id'] ?? 0) === $useCase) { $current = $row; break; }
    }
}
if (!$current) {
    respondError('Admin Portal: use_case_id=' . $useCase . ' not found in /search', 404);
}

// Step 2 — build PUT body with exact schema Admin Portal expects.
// Discovered from RPA workflow: search response includes ma_enable_properties,
// ma_message_th_properties, ma_message_en_properties arrays (each item has
// property_id). PUT requires all 9 fields; missing messages get wiped to null.
$updatedBy = (string)($payload['email']
             ?? $payload['username']
             ?? $payload['name']
             ?? 'som-portal');

// Extract property_id arrays from the nested property objects.
$enablePropIds = [];
foreach (($current['ma_enable_properties'] ?? []) as $p) {
    if (isset($p['property_id'])) $enablePropIds[] = (int)$p['property_id'];
}
$msgThPropIds = [];
foreach (($current['ma_message_th_properties'] ?? []) as $p) {
    if (isset($p['property_id'])) $msgThPropIds[] = (int)$p['property_id'];
}
$msgEnPropIds = [];
foreach (($current['ma_message_en_properties'] ?? []) as $p) {
    if (isset($p['property_id'])) $msgEnPropIds[] = (int)$p['property_id'];
}

// Preserve current message text — DO NOT wipe. Use whatever the record has;
// only overwrite if caller explicitly provides new messages (future extension).
$currentMsgTh = (string)($current['ma_message_th'] ?? $current['maMessageTh'] ?? '');
$currentMsgEn = (string)($current['ma_message_en'] ?? $current['maMessageEn'] ?? '');

$writeBody = [
    'useCaseName'            => (string)($current['use_case_name'] ?? ''),
    'useCaseType'            => (string)($current['use_case_type'] ?? 'use_case'),
    'maEnable'               => $enable,
    'maMessageTh'            => $currentMsgTh,
    'maMessageEn'            => $currentMsgEn,
    'updatedBy'              => $updatedBy,
    'maEnablePropertyIds'    => $enablePropIds,
    'maMessageThPropertyIds' => $msgThPropIds,
    'maMessageEnPropertyIds' => $msgEnPropIds,
];

$writePath = "$basePath/$useCase";
$res = backofficeCall('PUT', $writePath, $writeBody, 20);

// If Admin Portal rejects with 4xx, surface what we sent so we can compare
// against the working devtools capture. Rich detail only on failure path.
if (!$res['ok'] && $res['code'] >= 400 && $res['code'] < 500) {
    $dbg = [
        'sent_body'        => $writeBody,
        'sent_body_len'    => strlen(json_encode($writeBody)),
        'current_keys'     => is_array($current) ? array_keys($current) : [],
        'current_sample'   => is_array($current) ? array_intersect_key($current, array_flip([
            'useCaseName','useCaseType','maEnable','updatedBy','maEnablePropertyIds',
            'use_case_name','use_case_type','ma_enable','ma_enable_property_ids','updated_by',
        ])) : [],
        'upstream_error'   => $res['error'],
    ];
    logSecurity('ma_backoffice_toggle_400', $dbg, $payload['sub'] ?? '', $payload['name'] ?? '');
    $res['error'] .= ' | debug: ' . json_encode($dbg, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

// Collect property detail from the fetched use-case for the log.
$logEnableProps = [];
foreach (($current['ma_enable_properties'] ?? []) as $p) {
    $key = (string)($p['property_key'] ?? '');
    $val = (string)($p['property_value'] ?? '');
    if ($key !== '') $logEnableProps[] = $key . ' = ' . $val;
}
$logMsgThProps = [];
foreach (($current['ma_message_th_properties'] ?? []) as $p) {
    $key = (string)($p['property_key'] ?? '');
    if ($key !== '') $logMsgThProps[] = $key;
}
$logMsgEnProps = [];
foreach (($current['ma_message_en_properties'] ?? []) as $p) {
    $key = (string)($p['property_key'] ?? '');
    if ($key !== '') $logMsgEnProps[] = $key;
}

$activityDetail = [
    'service_id'         => $id,
    'service_name'       => (string)($svc['service_name'] ?? ''),
    'use_case_id'        => $useCase,
    'use_case_name'      => (string)($current['use_case_name'] ?? ''),
    'use_case_type'      => (string)($current['use_case_type'] ?? 'use_case'),
    'action'             => $action,
    'ma_status'          => $enable ? 'MAINTENANCE' : 'AVAILABLE',
    'ma_message_th'      => (string)($current['ma_message_th'] ?? $current['maMessageTh'] ?? ''),
    'ma_message_en'      => (string)($current['ma_message_en'] ?? $current['maMessageEn'] ?? ''),
    'enable_properties'  => $logEnableProps,
    'msg_th_properties'  => $logMsgThProps,
    'msg_en_properties'  => $logMsgEnProps,
    'reason'             => $reason,
    'result'             => $res['ok'] ? 'ok' : 'error',
    'upstream_code'      => (int)($res['code'] ?? 0),
    'upstream_error'     => $res['error'] ?? null,
];
logActivity('ma_backoffice_toggle', $activityDetail, $payload['sub'] ?? '', $payload['name'] ?? '');

if (!$res['ok']) {
    logSecurity('ma_backoffice_toggle_failed', $activityDetail, $payload['sub'] ?? '', $payload['name'] ?? '');
    respondError('Admin Portal error: ' . ($res['error'] ?? 'unknown'), 502);
}

// ── Persist "last toggled" stamp on the local record ───────────────
// Also persist the resolved use_case_id if it wasn't set before — so the
// record stops relying on fuzzy name matching after the first successful call.
if (empty($svc['backoffice_use_case_id']) && $useCase > 0) {
    $data['services'][$idx]['backoffice_use_case_id'] = $useCase;
}
$data['services'][$idx]['last_toggled_action']  = $action;
$data['services'][$idx]['last_toggled_by']      = (string)($payload['sub'] ?? '');
$data['services'][$idx]['last_toggled_by_name'] = (string)($payload['name'] ?? $payload['username'] ?? '');
$data['services'][$idx]['last_toggled_reason']  = $reason;
$data['services'][$idx]['last_toggled_at']      = $now;
$data['services'][$idx]['updated_at']           = date('Y-m-d H:i:s');

if (file_put_contents($dataFile, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)) === false) {
    // Upstream succeeded but we couldn't persist locally — surface but don't fail hard.
    logSecurity('ma_backoffice_toggle_persist_failed', $activityDetail, $payload['sub'] ?? '', $payload['name'] ?? '');
}

// Invalidate ma-status server cache so the UI reflects the new state instantly.
@unlink(teamDataPath('ma-status-cache.json'));

respondOk([
    'service_id'   => $id,
    'use_case_id'  => $useCase,
    'action'       => $action,
    'ma_enable'    => $enable,
    'last_toggled' => [
        'by'      => $data['services'][$idx]['last_toggled_by_name'],
        'at'      => $now,
        'reason'  => $reason,
    ],
], $enable ? 'MA enabled (site is now in maintenance)' : 'MA disabled (site is back up)');
