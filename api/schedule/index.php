<?php
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/../cache/CacheManager.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];

$cache = new CacheManager();

// ── GET — fetch schedule for a month ─────────────────────────────────────────
if ($method === 'GET') {
    $year  = (int)($_GET['year']  ?? date('Y'));
    $month = (int)($_GET['month'] ?? date('m'));

    // Don't cache - need real-time updates
    $all    = readJson('schedule.json') ?: [];
    $prefix = sprintf('%04d-%02d', $year, $month);

    $result = [];
    foreach ($all as $date => $entry) {
        if (strncmp($date, $prefix, 7) === 0) {
            $result[$date] = $entry;
        }
    }

    respondOk($result);
}

// ── POST — set a single slot for a date ──────────────────────────────────────
if ($method === 'POST') {
    requireCsrf();
    requireRole($payload, LEAD_ROLES);
    $body = json_decode(file_get_contents('php://input'), true) ?: [];

    $date = $body['date'] ?? '';
    $slot = $body['slot'] ?? '';
    $val  = $body['value'] ?? null;

    if (!$date || !$slot) respondError('date and slot required');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) respondError('Invalid date format');

    $valid_slots = ['shift1_tdpk', 'shift1_wah', 'shift1_oncall',
                    'shift2_wah',  'shift2_oncall',
                    'vacation', 'sick', 'business_leave', 'events'];
    if (!in_array($slot, $valid_slots)) respondError('Invalid slot');

    $all = readJson('schedule.json') ?: [];
    if (!isset($all[$date])) $all[$date] = [];

    $prev_val = $all[$date][$slot] ?? null;
    $is_clear = ($val === null || $val === '' || (is_array($val) && empty($val)));

    // Empty value = remove slot
    if ($is_clear) {
        unset($all[$date][$slot]);
        if (empty($all[$date])) unset($all[$date]);
    } else {
        $all[$date][$slot] = $val;
    }

    writeJson('schedule.json', $all);

    // ── Build detailed log ────────────────────────────────────────────────────
    $users   = readJson('users.json') ?: [];
    $userMap = [];
    foreach ($users as $u) { $userMap[$u['id']] = $u['name'] ?? $u['id']; }

    $action_type = $is_clear ? 'clear' : ($prev_val === null ? 'add' : 'update');

    if ($slot === 'events') {
        $new_arr = $is_clear ? [] : (array)$val;
        $old_arr = (array)($prev_val ?? []);
        $added   = array_values(array_diff($new_arr, $old_arr));
        $removed = array_values(array_diff($old_arr, $new_arr));
    } else {
        $new_ids = $is_clear ? [] : (is_array($val) ? $val : ($val !== '' ? [$val] : []));
        $old_ids = $prev_val === null ? [] : (is_array($prev_val) ? $prev_val : ($prev_val !== '' ? [$prev_val] : []));
        $added   = array_map(fn($id) => ['id' => $id, 'name' => $userMap[$id] ?? $id],
                             array_values(array_diff($new_ids, $old_ids)));
        $removed = array_map(fn($id) => ['id' => $id, 'name' => $userMap[$id] ?? $id],
                             array_values(array_diff($old_ids, $new_ids)));
    }

    logActivity('schedule_update', [
        'date'    => $date,
        'slot'    => $slot,
        'action'  => $action_type,
        'added'   => $added,
        'removed' => $removed,
    ], $payload['sub'], $payload['name']);

    respondOk(null, 'Saved');
}

// ── DELETE — clear entire day ─────────────────────────────────────────────────
if ($method === 'DELETE') {
    requireCsrf();
    requireRole($payload, LEAD_ROLES);
    $date = $_GET['date'] ?? '';
    if (!$date) respondError('date required');

    $all     = readJson('schedule.json') ?: [];
    $cleared = $all[$date] ?? [];
    unset($all[$date]);
    writeJson('schedule.json', $all);

    $users   = readJson('users.json') ?: [];
    $userMap = [];
    foreach ($users as $u) { $userMap[$u['id']] = $u['name'] ?? $u['id']; }

    $cleared_detail = [];
    foreach ($cleared as $s => $v) {
        if ($s === 'events') {
            $cleared_detail[$s] = array_values(array_filter((array)$v));
        } else {
            $ids = array_filter(is_array($v) ? $v : [$v]);
            $cleared_detail[$s] = array_values(array_map(
                fn($id) => ['id' => $id, 'name' => $userMap[$id] ?? $id], $ids
            ));
        }
    }

    logActivity('schedule_clear_day', ['date' => $date, 'cleared' => $cleared_detail], $payload['sub'], $payload['name']);
    respondOk(null, 'Cleared');
}

respondError('Method not allowed', 405);
