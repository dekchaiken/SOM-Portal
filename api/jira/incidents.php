<?php
/**
 * Get All Incidents from Jira
 * GET /api/jira/incidents.php
 */

error_reporting(0);
ini_set('display_errors', 0);
ini_set('max_execution_time', 60);

header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    echo json_encode(['success' => false, 'message' => 'Method not allowed']);
    exit;
}

$jiraUrl = 'https://truemoney.atlassian.net';
$jiraEmail = 'warapon.lea@ascendcorp.com';
$jiraApiToken = 'ATATT3xFfGF0jGLPH1w6VvzWdH0Vd1kSvo-WILD_hAZqQGzlrMiEjg-bJkrMlVnRb2WtT8V2YozL4cHDt3YYujBA_qfINjDnq0UoiOW2Aeoq-2EQQytxhA_yEbA-W9PV1ljJoBv4Qh5h1uaB8lD7nMxXcOsRSbIXBHWBx4x2rNcoapXwZ3k7am8=F004CB85';

try {
    // Get parameters
    $maxResults = isset($_GET['maxResults']) ? min((int)$_GET['maxResults'], 1000) : 100;
    $fromDate = $_GET['fromDate'] ?? '';
    $toDate = $_GET['toDate'] ?? '';
    $days = $_GET['days'] ?? '';
    $search = trim((string)($_GET['search'] ?? ''));

    // Build JQL query
    $jql = '"Ticket category" = Incidents AND project = TJCR AND issuetype in ("Sub-incidents", "TH incident")';

    if ($search !== '') {
        // Full-text search across summary/description; ignore date filter so
        // users can find historical incidents from any year.
        // Search only in summary (ticket title) with wildcard prefix matching.
        // Using `text ~` would also search description/comments and return
        // false-positive matches (e.g. tickets that merely mention the keyword
        // in a comment). `summary ~` keeps results relevant to the ticket title.
        $escaped = str_replace(['"', '*', '?'], ['\\"', '\\*', '\\?'], $search);
        $jql .= ' AND summary ~ "' . $escaped . '*"';
    } else {
        // Only apply date filter when NOT searching
        if ($days && $days !== 'all') {
            $daysAgo = date('Y-m-d', strtotime("-{$days} days"));
            $jql .= ' AND created >= "' . $daysAgo . '"';
        } elseif ($fromDate || $toDate) {
            if ($fromDate) {
                $jql .= ' AND created >= "' . $fromDate . '"';
            }
            if ($toDate) {
                $jql .= ' AND created <= "' . $toDate . ' 23:59"';
            }
        }
    }

    $jql .= ' ORDER BY created DESC';
    
    $apiUrl = $jiraUrl . '/rest/api/3/search/jql';
    $queryParams = http_build_query([
        'jql' => $jql,
        'maxResults' => $maxResults,
        'fields' => 'summary,created,status,assignee,customfield_17031,customfield_17016'
    ]);
    
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $apiUrl . '?' . $queryParams);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 30);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Authorization: Basic ' . base64_encode($jiraEmail . ':' . $jiraApiToken),
        'Accept: application/json',
        'Content-Type: application/json'
    ]);
    
    $response = curl_exec($ch);
    $curlError = curl_error($ch);
    $curlErrno = curl_errno($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    if ($curlErrno !== 0) {
        throw new Exception('cURL Error: ' . $curlError);
    }
    
    if ($httpCode !== 200) {
        throw new Exception('Jira API failed: HTTP ' . $httpCode);
    }
    
    $data = json_decode($response, true);
    
    if (!$data || !isset($data['issues'])) {
        throw new Exception('Invalid Jira response');
    }
    
    $incidents = [];
    foreach ($data['issues'] as $issue) {
        $key = $issue['key'];
        $fields = $issue['fields'];
        
        // Severity
        $severity = '3';
        $severityLabel = 'Low';
        if (isset($fields['customfield_17031']['value'])) {
            $sevVal = $fields['customfield_17031']['value'];
            if (preg_match('/(\d)/', $sevVal, $m)) {
                $severity = $m[1];
                $severityLabel = $severity === '1' ? 'Critical' : ($severity === '2' ? 'High' : 'Low');
            }
        }
        
        // Detected By
        $detectedBy = 'Unknown';
        if (isset($fields['customfield_17016']['value'])) {
            $detectedBy = $fields['customfield_17016']['value'];
        }
        
        // Status
        $status = $fields['status']['name'] ?? 'Unknown';
        
        // Assignee
        $assignee = 'Unassigned';
        if (isset($fields['assignee']['displayName'])) {
            $assignee = $fields['assignee']['displayName'];
        }
        
        $incidents[] = [
            'key' => $key,
            'url' => $jiraUrl . '/browse/' . $key,
            'summary' => $fields['summary'],
            'severity' => $severity,
            'severityLabel' => $severityLabel,
            'detectedBy' => $detectedBy,
            'status' => $status,
            'statusCategory' => $fields['status']['statusCategory']['key'] ?? 'new',
            'assignee' => $assignee,
            'description' => '',
            'created' => $fields['created'],
            'createdDate' => substr($fields['created'], 0, 10)
        ];
    }
    
    echo json_encode([
        'success' => true,
        'data' => [
            'incidents' => $incidents,
            'total' => count($incidents)
        ]
    ]);
    
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => $e->getMessage()
    ]);
}
