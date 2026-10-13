<?php
/**
 * Sync incidents from Jira for the given week.
 *   GET /api/weekly-report/sync-jira-incidents.php?week=week-YYYY-MM-DD
 *
 * Auth: requires a logged-in user.
 * Data: JQL template from data/{team}/weekly-report-jira.json → 'incidents'.
 *       Defaults reproduce the previous hardcoded SM behaviour (project TJCR,
 *       Ticket category = Incidents, filter by created).
 *
 * Response shape differs from ma/dev: uses field names {title, severity,
 * detected, date} that the weekly-report incidents panel expects.
 * Severity is pulled from customfield_17031 (TH Severity) and "detected by
 * SM" from customfield_17016 (Detected by).
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

    $cfg   = wr_load_jira_config()['incidents'];
    $built = wr_build_jql($cfg['jql_template'], $weekDate);

    // Incidents needs the two custom fields for severity + detected-by-SM.
    $fields = $cfg['fields'] ?? 'summary,created,customfield_17031,customfield_17016';
    if (strpos($fields, 'customfield_17031') === false) $fields .= ',customfield_17031';
    if (strpos($fields, 'customfield_17016') === false) $fields .= ',customfield_17016';

    $data = wr_jira_search($built['jql'], $fields, 100);

    $incidents = [];
    foreach ($data['issues'] as $issue) {
        $key    = $issue['key']    ?? '';
        $f      = $issue['fields'] ?? [];

        // TH Severity → "1" / "2" / "3"
        $severity = '3';
        $sevVal   = $f['customfield_17031']['value'] ?? '';
        if ($sevVal !== '' && preg_match('/(\d)/', $sevVal, $m)) $severity = $m[1];

        // Detected by "SM" / "Service Monitoring" → "Y"
        $detected = 'N';
        $detVal   = $f['customfield_17016']['value'] ?? '';
        if ($detVal !== '' &&
            (stripos($detVal, 'SM') !== false || stripos($detVal, 'Service Monitoring') !== false)) {
            $detected = 'Y';
        }

        $incidents[] = [
            'ticketId'  => $key,
            'ticketUrl' => JIRA_BASE_URL . '/browse/' . $key,
            'title'     => $f['summary'] ?? '',
            'severity'  => $severity,
            'detected'  => $detected,
            'date'      => substr((string)($f['created'] ?? ''), 0, 10),
        ];
    }

    echo json_encode([
        'ok'   => true,
        'data' => [
            'incidents' => $incidents,
            'count'     => count($incidents),
            'week'      => $week,
            'dateRange' => ['start' => $built['start'], 'end' => $built['end']],
        ],
    ]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()]);
}
