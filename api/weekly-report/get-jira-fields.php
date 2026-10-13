<?php
/**
 * Get all Jira fields to find "Detected by" field ID
 * GET /api/weekly-report/get-jira-fields.php
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

$jiraUrl = 'https://truemoney.atlassian.net';
$jiraEmail = 'warapon.lea@ascendcorp.com';
$jiraApiToken = 'ATATT3xFfGF0jGLPH1w6VvzWdH0Vd1kSvo-WILD_hAZqQGzlrMiEjg-bJkrMlVnRb2WtT8V2YozL4cHDt3YYujBA_qfINjDnq0UoiOW2Aeoq-2EQQytxhA_yEbA-W9PV1ljJoBv4Qh5h1uaB8lD7nMxXcOsRSbIXBHWBx4x2rNcoapXwZ3k7am8=F004CB85';

try {
    // Get all fields
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $jiraUrl . '/rest/api/3/field');
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Authorization: Basic ' . base64_encode($jiraEmail . ':' . $jiraApiToken),
        'Accept: application/json'
    ]);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    if ($httpCode !== 200) {
        throw new Exception('Failed to get fields: HTTP ' . $httpCode);
    }
    
    $fields = json_decode($response, true);
    
    // Filter for fields containing "detect" in name
    $detectedFields = array_filter($fields, function($field) {
        return stripos($field['name'], 'detect') !== false;
    });
    
    echo json_encode([
        'ok' => true,
        'detected_fields' => array_values($detectedFields),
        'all_custom_fields' => array_values(array_filter($fields, function($field) {
            return str_starts_with($field['id'], 'customfield_');
        }))
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'error' => $e->getMessage()
    ]);
}
