<?php
require_once __DIR__ . '/../helpers.php';
$payload = requireAuth();
requireRole($payload, ADMIN_ROLES);

if ($_SERVER['REQUEST_METHOD'] !== 'GET') respondError('GET required', 405);

$logs = readJson('mail_logs.json');
$logs = array_reverse($logs); // newest first

$search = strtolower(trim($_GET['search'] ?? ''));
$status = $_GET['status'] ?? '';

if ($search) {
    $logs = array_values(array_filter($logs, function ($l) use ($search) {
        return str_contains(strtolower($l['subject']       ?? ''), $search)
            || str_contains(strtolower(implode(',', (array)($l['to'] ?? []))), $search)
            || str_contains(strtolower($l['sent_by_name']  ?? ''), $search);
    }));
}

if ($status) {
    $logs = array_values(array_filter($logs, fn($l) => ($l['status'] ?? '') === $status));
}

$total   = count($logs);
$today   = date('Y-m-d');
$todayCt = count(array_filter($logs, fn($l) => str_starts_with($l['sent_at'] ?? '', $today)));
$failCt  = count(array_filter($logs, fn($l) => ($l['status'] ?? '') === 'failed'));

$limit  = max(1, min(100, (int)($_GET['limit']  ?? 50)));
$offset = max(0, (int)($_GET['offset'] ?? 0));
$page   = array_slice($logs, $offset, $limit);

respondOk([
    'logs'   => $page,
    'total'  => $total,
    'today'  => $todayCt,
    'failed' => $failCt,
    'limit'  => $limit,
    'offset' => $offset,
]);
