<?php
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];
$isAdmin = in_array($payload['role'] ?? '', LEAD_ROLES);

// ── GET — anyone authenticated can read holidays ──────────────────────────────
if ($method === 'GET') {
    $all  = readJson('holidays.json') ?: [];
    $year = isset($_GET['year']) ? (int)$_GET['year'] : null;

    if ($year) {
        $prefix = sprintf('%04d-', $year);
        $all = array_values(array_filter($all, fn($h) => strncmp($h['date'] ?? '', $prefix, 5) === 0));
    }

    usort($all, fn($a, $b) => strcmp($a['date'], $b['date']));
    respondOk($all);
}

if (!$isAdmin) {
    respondError('Unauthorized', 403);
}

// ── POST — add a holiday ──────────────────────────────────────────────────────
if ($method === 'POST') {
    requireCsrf();
    $body = json_decode(file_get_contents('php://input'), true) ?: [];
    $date = trim($body['date'] ?? '');
    $name = trim($body['name'] ?? '');

    if (!$date || !$name) respondError('date and name required');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) respondError('Invalid date format (YYYY-MM-DD)');

    $all = readJson('holidays.json') ?: [];

    // Check duplicate date
    foreach ($all as $h) {
        if ($h['date'] === $date) respondError('วันนี้มีวันหยุดอยู่แล้ว');
    }

    $new = ['id' => genId('hol'), 'date' => $date, 'name' => $name];
    $all[] = $new;
    usort($all, fn($a, $b) => strcmp($a['date'], $b['date']));
    writeJson('holidays.json', $all);
    logActivity('holiday_add', ['date' => $date, 'name' => $name], $payload['sub'], $payload['name']);
    respondOk($new, 'เพิ่มวันหยุดแล้ว');
}

// ── PUT — update a holiday ────────────────────────────────────────────────────
if ($method === 'PUT') {
    requireCsrf();
    $id   = $_GET['id'] ?? '';
    $body = json_decode(file_get_contents('php://input'), true) ?: [];
    $date = trim($body['date'] ?? '');
    $name = trim($body['name'] ?? '');

    if (!$id) respondError('id required');
    if (!$date || !$name) respondError('date and name required');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) respondError('Invalid date format (YYYY-MM-DD)');

    $all   = readJson('holidays.json') ?: [];
    $found = false;
    foreach ($all as &$h) {
        if ($h['id'] === $id) {
            // Check duplicate date (excluding self)
            foreach ($all as $other) {
                if ($other['id'] !== $id && $other['date'] === $date) {
                    respondError('วันนี้มีวันหยุดอยู่แล้ว');
                }
            }
            $h['date'] = $date;
            $h['name'] = $name;
            $found = true;
            break;
        }
    }
    unset($h);

    if (!$found) respondError('Holiday not found', 404);

    usort($all, fn($a, $b) => strcmp($a['date'], $b['date']));
    writeJson('holidays.json', $all);
    logActivity('holiday_update', ['id' => $id, 'date' => $date, 'name' => $name], $payload['sub'], $payload['name']);
    respondOk(null, 'แก้ไขวันหยุดแล้ว');
}

// ── DELETE — remove a holiday ─────────────────────────────────────────────────
if ($method === 'DELETE') {
    requireCsrf();
    $id = $_GET['id'] ?? '';
    if (!$id) respondError('id required');

    $all    = readJson('holidays.json') ?: [];
    $before = count($all);
    $all    = array_values(array_filter($all, fn($h) => $h['id'] !== $id));

    if (count($all) === $before) respondError('Holiday not found', 404);

    writeJson('holidays.json', $all);
    logActivity('holiday_delete', ['id' => $id], $payload['sub'], $payload['name']);
    respondOk(null, 'ลบวันหยุดแล้ว');
}

respondError('Method not allowed', 405);
