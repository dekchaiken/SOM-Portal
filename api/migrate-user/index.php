<?php
// Migrate User — run history reader
// GET /api/migrate-user/?action=history  → last N migrate_user_run entries
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();

// Per-user cross-team override: switch data context before reading logs.
applyExtraPageTeam($payload, 'migrate-user');

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$action = $_GET['action'] ?? 'history';
$limit  = min((int)($_GET['limit'] ?? 50), 200);

if ($action !== 'history') {
    http_response_code(400);
    echo json_encode(['error' => 'Unknown action']);
    exit;
}

// Read team activity log — use effective team context (may be cross-team via extra_pages).
$_teamSlug = $GLOBALS['_current_team'] ?? ($payload['team'] ?? null);
$_logDir   = (!$_teamSlug || $_teamSlug === 'sm') ? LOG_DIR : DATA_DIR . $_teamSlug . '/logs/';
$logPath   = $_logDir . 'activity.json';
$raw     = file_exists($logPath) ? file_get_contents($logPath) : '[]';
$all     = json_decode($raw, true) ?? [];

// Filter to migrate_user_run only
$entries = array_values(array_filter($all, fn($e) => ($e['action'] ?? '') === 'migrate_user_run'));

// Already newest-first (activity.json prepends), slice to limit
$entries = array_slice($entries, 0, $limit);

echo json_encode(['ok' => true, 'data' => $entries]);
