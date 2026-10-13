<?php
/**
 * Fetch Incidents from Jira for Current Week
 * GET /api/weekly-report/fetch-jira-incidents.php?week=2026-04-21
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

// Jira Configuration
$jiraUrl = 'https://jira.ascendcorp.com';
$jiraToken = 'ATATT3xFfGF0jGLPH1w6VvzWdH0Vd1kSvo-WILD_hAZqQGzlrMiEjg-bJkrMlVnRb2WtT8V2YozL4cHDt3YYujBA_qfINjDnq0UoiOW2Aeoq-2EQQytxhA_yEbA-W9PV1ljJoBv4Qh5h1uaB8lD7nMxXcOsRSbIXBHWBx4x2rNcoapXwZ3k7am8=F004CB85';

try {
    // Get week parameter (format: YYYY-MM-DD for Tuesday)
    $week = $_GET['week'] ?? date('Y-m-d');
    
    // Calculate week range (Tuesday to Monday)
    $weekStart = new DateTime($week);
    $weekEnd = clone $weekStart;
    $weekEnd->modify('+6 days');
    
    $startDate = $weekStart->format('Y-m-d');
    $endDate = $weekEnd->format('Y-m-d');
    
    // Build JQL query
    $jql = sprintf(
        '"Ticket category" = Incidents AND project = TJCR AND issuetype in ("Sub-incidents", "TH incident") AND created >= "%s" AND created <= "%s 23:59"',
        $startDate,
        $endDate
    );
    
    // Jira API request
    $url = $jiraUrl . '/rest/api/2/search?' . http_build_query([
        'jql' => $jql,
        'fields' => 'summary,created,customfield_10500,customfield_10501', // Adjust field IDs
        'maxResults' => 100
    ]);
    
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [
            'Authorization: Bearer ' . $jiraToken,
            'Content-Type: application/json',
            'Accept: application/json'
        ],
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_TIMEOUT => 30
    ]);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);
    
    if ($error) {
        throw new Exception('Curl error: ' . $error);
    }
    
    if ($httpCode !== 200) {
        throw new Exception('Jira API error: HTTP ' . $httpCode);
    }
    
    $data = json_decode($response, true);
    
    if (!$data || !isset($data['issues'])) {
        throw new Exception('Invalid Jira response');
    }
    
    // Transform data
    $incidents = [];
    foreach ($data['issues'] as $issue) {
        $key = $issue['key'];
        $fields = $issue['fields'];
        
        // Extract custom fields (adjust field IDs based on your Jira instance)
        $severity = $fields['customfield_10500']['value'] ?? '3'; // TH Severity
        $detectedBy = $fields['customfield_10501']['value'] ?? 'Unknown'; // Detected by
        
        // Map severity to number
        $severityMap = [
            'Severity 1' => '1',
            'Severity 2' => '2',
            'Severity 3' => '3',
            '1' => '1',
            '2' => '2',
            '3' => '3'
        ];
        $severityNum = $severityMap[$severity] ?? '3';
        
        // Check if detected by SM
        $detectedBySM = stripos($detectedBy, 'SM') !== false || 
                        stripos($detectedBy, 'System Monitoring') !== false ? 'Y' : 'N';
        
        $incidents[] = [
            'ticketId' => $key,
            'ticketUrl' => $jiraUrl . '/browse/' . $key,
            'title' => $fields['summary'] ?? 'No title',
            'severity' => $severityNum,
            'detected' => $detectedBySM,
            'detectedBy' => $detectedBy,
            'date' => substr($fields['created'], 0, 10)
        ];
    }
    
    echo json_encode([
        'ok' => true,
        'data' => [
            'weekStart' => $startDate,
            'weekEnd' => $endDate,
            'total' => count($incidents),
            'incidents' => $incidents
        ]
    ]);
    
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'error' => $e->getMessage()
    ]);
}
