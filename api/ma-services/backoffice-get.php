<?php
// ══════════════════════════════════════════════════════════════════
//  MA Services — Backoffice Use Case Full Fetch
//  GET ?use_case_id=X → returns single use case + resolved properties
//  Resolves each property_id in ma_enable_properties / ma_message_*_properties
//  against /application/list so the Edit UI can render application_name +
//  property_key + property_value without a second round-trip per row.
// ══════════════════════════════════════════════════════════════════

require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/../ma-status/_backoffice.php';

$payload = requireAuth();
requireSmForShared();

header('Content-Type: application/json');

$useCaseId = isset($_GET['use_case_id']) ? (int)$_GET['use_case_id'] : 0;
if ($useCaseId <= 0) respondError('Missing use_case_id');

$basePath = '/acm-backoffice-api-gateway/ops-service-maintenance-server';

// Fetch the use case list (search endpoint returns everything we need).
$searchRes = backofficeCall('GET', "$basePath/config/use-cases/search?pageSize=500");
if (!$searchRes['ok']) respondError('Search failed: ' . ($searchRes['error'] ?? 'unknown'), 502);

$useCase = null;
foreach (($searchRes['data']['content'] ?? []) as $uc) {
    if ((int)($uc['use_case_id'] ?? 0) === $useCaseId) { $useCase = $uc; break; }
}
if (!$useCase) respondError('use_case_id=' . $useCaseId . ' not found', 404);

// Fetch application list to resolve property_id → application + key + value.
$appRes = backofficeCall('GET', "$basePath/application/list");
$propMap = [];    // property_id => [application_name, property_key, property_value]
$appList = [];    // [ {application_name, properties: [...]} ] — for picker dropdown
if ($appRes['ok']) {
    $contents = $appRes['data']['data']['contents'] ?? [];
    foreach ($contents as $app) {
        $appName = (string)($app['application_name'] ?? '');
        $props   = [];
        foreach (($app['properties'] ?? []) as $p) {
            $pid = (int)($p['property_id'] ?? 0);
            if (!$pid) continue;
            $entry = [
                'property_id'     => $pid,
                'application'     => $appName,
                'property_key'    => (string)($p['property_key'] ?? ''),
                'property_value'  => (string)($p['property_value'] ?? ''),
                'property_group'  => (string)($p['property_group'] ?? ''),
            ];
            $propMap[$pid] = $entry;
            $props[] = $entry;
        }
        $appList[] = ['application_name' => $appName, 'properties' => $props];
    }
}

// Helper: resolve the {property_id} list on the use case into full objects.
$resolve = function (array $arr) use ($propMap) {
    $out = [];
    foreach ($arr as $item) {
        $pid = (int)($item['property_id'] ?? 0);
        if (!$pid) continue;
        $out[] = $propMap[$pid] ?? [
            'property_id'    => $pid,
            'application'    => '(unknown)',
            'property_key'   => '(unknown)',
            'property_value' => '',
        ];
    }
    return $out;
};

respondOk([
    'use_case_id'          => $useCaseId,
    'use_case_name'        => (string)($useCase['use_case_name'] ?? ''),
    'use_case_type'        => (string)($useCase['use_case_type'] ?? 'use_case'),
    'ma_enable'            => (bool)($useCase['ma_enable'] ?? false),
    'ma_message_th'        => (string)($useCase['ma_message_th'] ?? ''),
    'ma_message_en'        => (string)($useCase['ma_message_en'] ?? ''),
    'updated_at'           => (string)($useCase['updated_at'] ?? ''),
    'updated_by'           => (string)($useCase['updated_by'] ?? ''),
    'ma_enable_properties'      => $resolve($useCase['ma_enable_properties'] ?? []),
    'ma_message_th_properties'  => $resolve($useCase['ma_message_th_properties'] ?? []),
    'ma_message_en_properties'  => $resolve($useCase['ma_message_en_properties'] ?? []),
    'application_list'          => $appList,   // for the "add property" picker
]);
