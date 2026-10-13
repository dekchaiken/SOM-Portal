<?php
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];
$project = strtolower(trim($_GET['project'] ?? ''));
$id      = trim($_GET['id'] ?? '');

$valid_projects = ['tmn', 'nano', 'welth'];

// GET — list records
if ($method === 'GET') {
    if (!in_array($project, $valid_projects)) respondError('Invalid project. Use tmn, nano or welth');

    $records = readJson("sms_gateway_{$project}.json");
    usort($records, fn($a, $b) => strcmp($b['switch_start'] ?? '', $a['switch_start'] ?? ''));
    respondOk(array_values($records));
}

// PATCH — update remark only
if ($method === 'PATCH') {
    requireCsrf();
    if (!$id)                                 respondError('ID required');
    if (!in_array($project, $valid_projects)) respondError('Invalid project');

    $body    = getBody();
    $remark  = trim($body['remark'] ?? '');
    $file    = "sms_gateway_{$project}.json";
    $records = readJson($file);
    $found   = false;

    foreach ($records as &$r) {
        if ($r['id'] === $id) {
            $r['remark']     = $remark;
            $r['updated_at'] = date('c');
            $r['updated_by'] = $payload['sub'];
            $found = true;
            break;
        }
    }
    unset($r);

    if (!$found) respondError('Record not found', 404);
    writeJson($file, $records);
    logActivity('sms_gateway_remark', ['id' => $id, 'project' => $project], $payload['sub'], $payload['name']);
    respondOk(null, 'Remark updated');
}

respondError('Method not allowed', 405);
