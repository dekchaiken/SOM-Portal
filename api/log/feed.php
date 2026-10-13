<?php
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();   // any authenticated role

$limit = min((int)($_GET['limit'] ?? 30), 100);

// Only these actions appear in the dashboard activity feed
$FEED_ACTIONS = [
    'jira_create_ticket',
    'email_sent',
    'inbox_sent',
    'noti_chat_sent',
    'board_create',
    'board_pin',
    'test_service_submitted',
    'batch_report_submitted',
    // Learning — celebrate phase passes (failed attempts intentionally hidden)
    'course_phase_passed',
    // Admin content events (so admin feed shows course authoring)
    'course_create',
    'course_phase_create',
    'course_lesson_create',
    'course_quiz_save',
];

// Per-team activity log: SM/unauthenticated → global LOG_DIR, other teams → data/{team}/logs/
// (mirrors _appendLog() in helpers.php so the feed matches what was written for this team)
$team   = $GLOBALS['_current_team'] ?? null;
$logDir = (!$team || $team === 'sm') ? LOG_DIR : DATA_DIR . $team . '/logs/';
$path   = $logDir . 'activity.json';
if (!file_exists($path)) { respondOk(['items' => []]); }

$logs = json_decode(file_get_contents($path), true) ?? [];

// Filter to feed-relevant actions only, newest-first order is preserved
$items = [];
foreach ($logs as $e) {
    if (!in_array($e['action'] ?? '', $FEED_ACTIONS)) continue;
    $items[] = $e;
    if (count($items) >= $limit) break;
}

respondOk(['items' => $items]);
