<?php
/**
 * batch-records-admin.php
 * GET  ?action=list   [&month=YYYY-MM]  → records for that month
 * GET  ?action=months                   → available months
 * POST ?action=edit   &month=YYYY-MM    → edit record
 * POST ?action=delete &month=YYYY-MM    → delete record
 * POST ?action=clear  [&month=YYYY-MM]  → clear one month or all (admin)
 */
require_once __DIR__ . '/helpers.php';

$action  = $_GET['action'] ?? '';
$month   = $_GET['month']  ?? null;
$payload = requireAuth();

// ── months ────────────────────────────────────────────────────
if ($action === 'months') {
    respondOk(listMonths('batch-records'));
}

// ── list ──────────────────────────────────────────────────────
if ($action === 'list') {
    $file    = monthlyFilename('batch-records', $month);
    $records = readJson($file);
    usort($records, fn($a, $b) => strcmp($b['timestamp'] ?? '', $a['timestamp'] ?? ''));
    respondOk($records);
}

// ── edit ──────────────────────────────────────────────────────
if ($action === 'edit') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') respondError('POST required', 405);
    $body = getBody();
    if (empty($body['id'])) respondError('id required', 400);

    $file    = monthlyFilename('batch-records', $month);
    $records = readJson($file);
    $idx     = null;
    foreach ($records as $i => $r) {
        if ($r['id'] === $body['id']) { $idx = $i; break; }
    }
    if ($idx === null) respondError('Record not found', 404);

    $old     = $records[$idx];
    $changed = [];

    if (isset($body['timestamp']) && $body['timestamp'] !== ($old['timestamp'] ?? '')) {
        $changed['timestamp'] = ['from' => $old['timestamp'] ?? '', 'to' => $body['timestamp']];
        $records[$idx]['timestamp'] = $body['timestamp'];
    }
    if (isset($body['reporter']) && $body['reporter'] !== ($old['reporter'] ?? '')) {
        $changed['reporter'] = ['from' => $old['reporter'] ?? '', 'to' => $body['reporter']];
        $records[$idx]['reporter'] = trim($body['reporter']);
    }
    if (isset($body['jobs'])) {
        $changed['jobs'] = 'updated';
        $records[$idx]['jobs'] = $body['jobs'];
    }

    $records[$idx]['edited_at'] = date('c');
    $records[$idx]['edited_by'] = $payload['name'] ?? $payload['sub'];

    writeJson($file, $records);
    logActivity('batch_record_edited', ['record_id' => $body['id'], 'month' => $month, 'changed' => $changed], $payload['sub'], $payload['name'] ?? '');
    respondOk($records[$idx]);
}

// ── delete ────────────────────────────────────────────────────
if ($action === 'delete') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') respondError('POST required', 405);
    $body = getBody();
    if (empty($body['id'])) respondError('id required', 400);

    $file       = monthlyFilename('batch-records', $month);
    $records    = readJson($file);
    $newRecords = array_values(array_filter($records, fn($r) => $r['id'] !== $body['id']));
    if (count($newRecords) === count($records)) respondError('Record not found', 404);

    writeJson($file, $newRecords);
    logActivity('batch_record_deleted', ['record_id' => $body['id'], 'month' => $month], $payload['sub'], $payload['name'] ?? '');
    respondOk(['deleted' => true]);
}

// ── admin-only below ──────────────────────────────────────────
requireRole($payload, ADMIN_ROLES);

// ── clear ─────────────────────────────────────────────────────
if ($action === 'clear') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') respondError('POST required', 405);

    if ($month) {
        $file  = monthlyFilename('batch-records', $month);
        $count = count(readJson($file));
        writeJson($file, []);
        logActivity('batch_records_cleared', ['month' => $month, 'deleted_count' => $count], $payload['sub'], $payload['name'] ?? '');
        respondOk(['month' => $month, 'deleted_count' => $count]);
    }

    $months = listMonths('batch-records');
    $total  = 0;
    foreach ($months as $m) {
        $f     = monthlyFilename('batch-records', $m);
        $total += count(readJson($f));
        writeJson($f, []);
    }
    logActivity('batch_records_cleared', ['month' => 'all', 'deleted_count' => $total], $payload['sub'], $payload['name'] ?? '');
    respondOk(['month' => 'all', 'deleted_count' => $total]);
}

respondError('Invalid action', 400);
