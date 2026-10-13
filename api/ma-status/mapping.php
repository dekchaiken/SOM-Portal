<?php
// ══════════════════════════════════════════════════════════════════
//  Admin: link (or unlink) a ma-services row to a backoffice use_case_id.
//    POST { service_id: "srv_xxx", use_case_id: 1234 }   → link
//    POST { service_id: "srv_xxx", use_case_id: null }   → unlink
//  ma-services.json is SM-shared → requireSmForShared() gates writes.
// ══════════════════════════════════════════════════════════════════

require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
requireRole($payload, ADMIN_ROLES);
requireSmForShared();

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') respondError('Method not allowed', 405);

$body      = getBody();
$serviceId = trim((string)($body['service_id'] ?? ''));
if ($serviceId === '') respondError('service_id required', 400);

$useCaseId = $body['use_case_id'] ?? null;
if ($useCaseId !== null) {
    $useCaseId = (int)$useCaseId;
    if ($useCaseId <= 0) respondError('use_case_id must be a positive integer or null', 400);
}

$file  = readJson('ma-services.json');
$rows  = $file['services'] ?? [];
$found = false;
// ma-services.json stores id as int; requests come in as string — compare as strings.
foreach ($rows as &$r) {
    if ((string)($r['id'] ?? '') === $serviceId) {
        if ($useCaseId === null) unset($r['backoffice_use_case_id']);
        else                     $r['backoffice_use_case_id'] = $useCaseId;
        $r['updated_at'] = date('c');
        $found = true;
        break;
    }
}
unset($r);
if (!$found) respondError('service_id not found in ma-services.json', 404);

if (isset($file['services'])) $file['services'] = $rows;
else                          $file = $rows;
writeJson('ma-services.json', $file);

// Invalidate the aggregator cache so the mapping shows up on next fetch
writeJson('ma-status-cache.json', []);

logActivity('ma_status_mapping', ['service_id' => $serviceId, 'use_case_id' => $useCaseId]);
respondOk(['service_id' => $serviceId, 'use_case_id' => $useCaseId]);
