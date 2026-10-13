<?php
require_once __DIR__ . '/../helpers.php';

$payload  = requireAuth();
$method   = $_SERVER['REQUEST_METHOD'];
$uid      = $payload['sub'];
$isAdmin  = in_array($payload['role'] ?? '', ADMIN_ROLES);

// ── GET ───────────────────────────────────────────────────────────────────────
if ($method === 'GET') {
    $year  = (int)($_GET['year']  ?? date('Y'));
    $month = isset($_GET['month']) ? (int)$_GET['month'] : null;
    $all   = readJson('holiday-plans.json') ?: [];

    $result = [];
    foreach ($all as $userId => $years) {
        $userYear = $years[(string)$year] ?? [];
        $result[$userId] = $month !== null
            ? ($userYear[(string)$month] ?? [])
            : array_values(array_unique(array_merge(...array_values($userYear) ?: [[]])));
    }
    respondOk(['year' => $year, 'month' => $month, 'plans' => $result]);
}

// ── POST — save plan ──────────────────────────────────────────────────────────
if ($method === 'POST') {
    $body  = json_decode(file_get_contents('php://input'), true) ?: [];
    $year  = (int)($body['year']  ?? date('Y'));
    $month = (int)($body['month'] ?? date('n'));
    $dates = array_values(array_filter((array)($body['dates'] ?? []),
        fn($d) => preg_match('/^\d{4}-\d{2}-\d{2}$/', $d)));
    sort($dates);

    $targetId = ($isAdmin && !empty($body['user_id'])) ? $body['user_id'] : $uid;

    $all = readJson('holiday-plans.json') ?: [];
    if (!isset($all[$targetId]))                $all[$targetId] = [];
    if (!isset($all[$targetId][(string)$year])) $all[$targetId][(string)$year] = [];
    $all[$targetId][(string)$year][(string)$month] = $dates;

    if (!writeJson('holiday-plans.json', $all)) respondError('Failed to save', 500);
    respondOk(['user_id' => $targetId, 'year' => $year, 'month' => $month, 'dates' => $dates]);
}

// ── DELETE — clear month ──────────────────────────────────────────────────────
if ($method === 'DELETE') {
    $year     = (int)($_GET['year']  ?? date('Y'));
    $month    = (int)($_GET['month'] ?? date('n'));
    $targetId = ($isAdmin && !empty($_GET['user_id'])) ? $_GET['user_id'] : $uid;

    $all = readJson('holiday-plans.json') ?: [];
    unset($all[$targetId][(string)$year][(string)$month]);
    if (empty($all[$targetId][(string)$year]))  unset($all[$targetId][(string)$year]);
    if (empty($all[$targetId]))                 unset($all[$targetId]);

    if (!writeJson('holiday-plans.json', $all)) respondError('Failed to save', 500);
    respondOk(['cleared' => true]);
}

respondError('Method not allowed', 405);
?>
