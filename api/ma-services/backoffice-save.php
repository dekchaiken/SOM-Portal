<?php
// ══════════════════════════════════════════════════════════════════
//  MA Services — Backoffice Full Save (from Edit modal)
//  POST {
//    service_id: int,               // local ma-service id (for logging)
//    use_case_id: int,              // Admin Portal id
//    use_case_name: string,
//    use_case_type: 'use_case'|'client',
//    ma_enable: bool,
//    ma_message_th: string,
//    ma_message_en: string,
//    ma_enable_property_ids:      [ids],
//    ma_message_th_property_ids:  [ids],
//    ma_message_en_property_ids:  [ids],
//  }
//  Writes to Admin Portal via PUT /use-cases/{id} with camelCase body.
//  Every attempt logged to activity.json + persists last_toggled_* stamp.
// ══════════════════════════════════════════════════════════════════

require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/../ma-status/_backoffice.php';

$payload = requireAuth();
requireSmForShared();

header('Content-Type: application/json');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') respondError('Method not allowed', 405);

$input = json_decode(file_get_contents('php://input'), true) ?: [];

$serviceId    = isset($input['service_id']) ? (int)$input['service_id'] : 0;
$useCaseId    = isset($input['use_case_id']) ? (int)$input['use_case_id'] : 0;
$useCaseName  = trim((string)($input['use_case_name'] ?? ''));
$useCaseType  = trim((string)($input['use_case_type'] ?? 'use_case'));
$maEnable     = !empty($input['ma_enable']);
$msgTh        = (string)($input['ma_message_th'] ?? '');
$msgEn        = (string)($input['ma_message_en'] ?? '');
$enableIds    = is_array($input['ma_enable_property_ids']      ?? null) ? $input['ma_enable_property_ids']      : [];
$msgThIds     = is_array($input['ma_message_th_property_ids']  ?? null) ? $input['ma_message_th_property_ids']  : [];
$msgEnIds     = is_array($input['ma_message_en_property_ids']  ?? null) ? $input['ma_message_en_property_ids']  : [];

if ($useCaseId <= 0)     respondError('Missing use_case_id');
if ($useCaseName === '') respondError('use_case_name is required');
if (mb_strlen($msgTh) > 2000 || mb_strlen($msgEn) > 2000) respondError('Message too long');

// Anti-double-click gate
$rlFile = 'ma-toggle-rl.json';
$rl     = readJson($rlFile);
$uid    = (string)($payload['sub'] ?? '');
$now    = time();
if ($uid && !empty($rl[$uid]) && ($now - (int)$rl[$uid]) < 3) {
    respondError('Too fast — wait a moment before saving again', 429);
}
$rl[$uid] = $now;
foreach ($rl as $k => $ts) if (($now - (int)$ts) > 3600) unset($rl[$k]);
writeJson($rlFile, $rl);

$updatedBy = (string)($payload['email']
             ?? $payload['username']
             ?? $payload['name']
             ?? 'som-portal');

$writeBody = [
    'useCaseName'            => $useCaseName,
    'useCaseType'            => ($useCaseType !== '' ? $useCaseType : 'use_case'),
    'maEnable'               => (bool)$maEnable,
    'maMessageTh'            => $msgTh,
    'maMessageEn'            => $msgEn,
    'updatedBy'              => $updatedBy,
    'maEnablePropertyIds'    => array_values(array_map('intval', $enableIds)),
    'maMessageThPropertyIds' => array_values(array_map('intval', $msgThIds)),
    'maMessageEnPropertyIds' => array_values(array_map('intval', $msgEnIds)),
];

$writePath = "/acm-backoffice-api-gateway/ops-service-maintenance-server/config/use-cases/$useCaseId";
$res = backofficeCall('PUT', $writePath, $writeBody, 20);

$activityDetail = [
    'service_id'    => $serviceId,
    'use_case_id'   => $useCaseId,
    'use_case_name' => $useCaseName,
    'use_case_type' => $useCaseType,
    'ma_status'     => $maEnable ? 'MAINTENANCE' : 'AVAILABLE',
    'ma_enable'     => $maEnable,
    'ma_message_th' => $msgTh,
    'ma_message_en' => $msgEn,
    'enable_property_ids'    => array_values(array_map('intval', $enableIds)),
    'msg_th_property_ids'    => array_values(array_map('intval', $msgThIds)),
    'msg_en_property_ids'    => array_values(array_map('intval', $msgEnIds)),
    'result'        => $res['ok'] ? 'ok' : 'error',
    'upstream_code' => (int)($res['code'] ?? 0),
    'upstream_error'=> $res['error'] ?? null,
];
logActivity('ma_backoffice_save', $activityDetail, $uid, $payload['name'] ?? '');

if (!$res['ok']) {
    logSecurity('ma_backoffice_save_failed', $activityDetail, $uid, $payload['name'] ?? '');
    respondError('Admin Portal error: ' . ($res['error'] ?? 'unknown'), 502);
}

// Persist last-toggled stamp on the local record if service_id was provided.
if ($serviceId > 0) {
    $dataFile = teamDataPath('ma-services.json');
    if (file_exists($dataFile)) {
        $data = json_decode(file_get_contents($dataFile), true);
        if (is_array($data) && !empty($data['services'])) {
            foreach ($data['services'] as $i => $svc) {
                if ((int)($svc['id'] ?? 0) !== $serviceId) continue;
                if (empty($svc['backoffice_use_case_id'])) {
                    $data['services'][$i]['backoffice_use_case_id'] = $useCaseId;
                }
                $data['services'][$i]['last_toggled_action']  = $maEnable ? 'enable' : 'disable';
                $data['services'][$i]['last_toggled_by']      = $uid;
                $data['services'][$i]['last_toggled_by_name'] = (string)($payload['name'] ?? $payload['username'] ?? '');
                $data['services'][$i]['last_toggled_at']      = $now;
                $data['services'][$i]['last_toggled_reason']  = 'edited via full modal';
                $data['services'][$i]['updated_at']           = date('Y-m-d H:i:s');
                break;
            }
            file_put_contents($dataFile, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        }
    }
}

@unlink(teamDataPath('ma-status-cache.json'));

respondOk([
    'use_case_id' => $useCaseId,
    'ma_enable'   => $maEnable,
], 'Saved to Admin Portal successfully');
