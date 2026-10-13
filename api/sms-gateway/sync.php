<?php
require_once __DIR__ . '/lib.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') respondError('Method not allowed', 405);

$payload = requireAuth();
requireCsrf();

$project = strtolower(trim($_GET['project'] ?? ''));
if (!in_array($project, SMSGW_VALID_PROJECTS, true)) respondError('Invalid project. Use tmn, nano or welth');

set_time_limit(180);

$result = smsgwSyncProject($project, $payload);

if (!$result['ok']) {
    $code = str_starts_with($result['error'] ?? '', 'Jenkins token') ? 500 : 502;
    respondError($result['error'] ?? 'Sync failed', $code);
}

$msg = $result['added']
    ? 'เพิ่ม ' . $result['added'] . ' build ใหม่แล้ว'
    : 'ไม่มี build ใหม่';
respondOk(['added' => $result['added'], 'records' => $result['records']], $msg);
