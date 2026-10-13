<?php
/**
 * Get SMC cases (Monitoring + Batchfile) — for the Send Email page case picker.
 * GET /api/jira/smc-cases.php?date=YYYY-MM-DD     ← default = today
 * GET /api/jira/smc-cases.php?days=7              ← last N days (alt to date)
 *
 * Equivalent JQL:
 *   project = SMC AND issuetype IN (Monitoring, Batchfile) ORDER BY created DESC
 */
require_once __DIR__ . '/../helpers.php';

try {
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') respondError('Method not allowed', 405);

    $payload = requireAuth();
    requireRole($payload, ALL_STAFF_ROLES);

    if (!jiraCredsReady()) {
        respondError('Jira credentials not configured (.env JIRA_EMAIL / JIRA_TOKEN)', 500);
    }

    $date = trim($_GET['date'] ?? '');
    $days = (int)($_GET['days'] ?? 0);
    $max  = min((int)($_GET['maxResults'] ?? 100), 200);

    // Build JQL — quote multi-word issue types to be safe
    $jql = 'project = SMC AND issuetype in ("Monitoring", "Batchfile")';
    if ($date && preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
        $jql .= " AND created >= \"{$date}\" AND created <= \"{$date} 23:59\"";
    } elseif ($days > 0) {
        $from = date('Y-m-d', strtotime("-{$days} days"));
        $jql .= " AND created >= \"{$from}\"";
    } else {
        $today = date('Y-m-d');
        $jql .= " AND created >= \"{$today}\" AND created <= \"{$today} 23:59\"";
    }
    $jql .= ' ORDER BY created DESC';

    $url = JIRA_BASE_URL . '/rest/api/3/search/jql?' . http_build_query([
        'jql'        => $jql,
        'maxResults' => $max,
        'fields'     => 'summary,created,status,assignee,issuetype,priority',
    ]);

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 25,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => 0,
        CURLOPT_HTTPHEADER     => [
            'Authorization: Basic ' . base64_encode(jiraEmail() . ':' . jiraToken()),
            'Accept: application/json',
        ],
    ]);

    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);

    if ($err)          respondError('Cannot reach Jira: ' . $err, 502);
    if ($code !== 200) {
        // Surface Jira's error message so we can debug
        $errBody  = json_decode($resp, true);
        $errMsg   = $errBody['errorMessages'][0] ?? $errBody['message'] ?? substr((string)$resp, 0, 400);
        respondError("Jira HTTP {$code}: {$errMsg}", 502);
    }

    $data = json_decode($resp, true);
    if (!$data || !isset($data['issues'])) {
        respondError('Invalid Jira response: ' . substr((string)$resp, 0, 200), 502);
    }

    $cases = [];
    foreach ($data['issues'] as $issue) {
        $f = $issue['fields'] ?? [];
        $cases[] = [
            'key'       => $issue['key'],
            'summary'   => $f['summary']                    ?? '',
            'created'   => $f['created']                    ?? '',
            'status'    => $f['status']['name']             ?? 'Unknown',
            'statusCat' => $f['status']['statusCategory']['key'] ?? 'new',
            'issuetype' => $f['issuetype']['name']          ?? '',
            'priority'  => $f['priority']['name']           ?? '',
            'assignee'  => $f['assignee']['displayName']    ?? 'Unassigned',
            'url'       => JIRA_BASE_URL . '/browse/' . $issue['key'],
        ];
    }

    respondOk([
        'jql'   => $jql,
        'total' => count($cases),
        'cases' => $cases,
    ]);

} catch (\Throwable $e) {
    respondError('Server error: ' . $e->getMessage() . ' @ ' . basename($e->getFile()) . ':' . $e->getLine(), 500);
}
