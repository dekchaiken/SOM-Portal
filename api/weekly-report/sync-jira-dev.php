<?php
/**
 * Sync closed Support Dev tickets from Jira for the given week.
 *   GET /api/weekly-report/sync-jira-dev.php?week=week-YYYY-MM-DD
 *
 * Auth: requires a logged-in user.
 * Data: JQL template comes from data/{team}/weekly-report-jira.json → 'dev'.
 *       Defaults reproduce the previous hardcoded SM behaviour (Grafana /
 *       Heartbeats / Configuration in project SMC, status = "Close" only).
 */
require_once __DIR__ . '/_jira-config.php';

header('Content-Type: application/json');

try {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
        http_response_code(405);
        echo json_encode(['ok' => false, 'error' => 'Method not allowed']); exit;
    }

    $payload = requireAuth();

    $week = trim($_GET['week'] ?? '');
    if ($week === '') throw new Exception('Week parameter is required');
    $weekDate = str_replace('week-', '', $week);
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $weekDate)) {
        throw new Exception('Invalid week format — expected week-YYYY-MM-DD');
    }

    $cfg   = wr_load_jira_config()['dev'];
    $built = wr_build_jql($cfg['jql_template'], $weekDate);
    $max   = (int)($cfg['max_results'] ?? 100);

    $data  = wr_jira_search($built['jql'], $cfg['fields'], $max);
    $items = array_map(
        fn($iss) => wr_normalise_issue($iss, $cfg['status_label']),
        $data['issues']
    );

    echo json_encode([
        'ok'   => true,
        'data' => [
            'items'     => $items,
            'count'     => count($items),
            'week'      => $week,
            'dateRange' => ['start' => $built['start'], 'end' => $built['end']],
        ],
    ]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()]);
}
