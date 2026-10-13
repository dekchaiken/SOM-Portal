<?php
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') respondError('Method not allowed', 405);

$limit  = min(1000, max(1, (int)($_GET['limit']  ?? 20)));
$offset = max(0, (int)($_GET['offset'] ?? 0));

// Read activity log and filter to current user only.
// Per-team log dir: SM/unauthenticated → global LOG_DIR, others → data/{team}/logs/
// (mirrors _appendLog() in helpers.php so user sees the log written for their team)
$team    = $GLOBALS['_current_team'] ?? null;
$logDir  = (!$team || $team === 'sm') ? LOG_DIR : DATA_DIR . $team . '/logs/';
$logPath = $logDir . 'activity.json';
if (!file_exists($logPath)) { respondOk(['items' => [], 'total' => 0]); }

$all  = json_decode(file_get_contents($logPath), true) ?? [];
$mine = array_values(array_filter($all, fn($e) => ($e['user_id'] ?? '') === $payload['sub']));

$total = count($mine);
// Normalise field names: add created_at alias for ts so the frontend can use either
$items = array_map(function($e) {
    $e['created_at'] = $e['ts'] ?? '';
    return $e;
}, array_slice($mine, $offset, $limit));

respondOk(['items' => $items, 'total' => $total]);
