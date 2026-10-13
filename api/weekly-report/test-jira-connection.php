<?php
/**
 * Test Jira Connection and cURL Setup
 * GET /api/weekly-report/test-jira-connection.php
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

$jiraUrl = 'https://truemoney.atlassian.net';
$jiraEmail = 'warapon.lea@ascendcorp.com';
$jiraApiToken = 'ATATT3xFfGF0jGLPH1w6VvzWdH0Vd1kSvo-WILD_hAZqQGzlrMiEjg-bJkrMlVnRb2WtT8V2YozL4cHDt3YYujBA_qfINjDnq0UoiOW2Aeoq-2EQQytxhA_yEbA-W9PV1ljJoBv4Qh5h1uaB8lD7nMxXcOsRSbIXBHWBx4x2rNcoapXwZ3k7am8=F004CB85';

$diagnostics = [];

// 1. Check PHP version
$diagnostics['php_version'] = phpversion();

// 2. Check if cURL is installed
$diagnostics['curl_installed'] = function_exists('curl_init');

if ($diagnostics['curl_installed']) {
    $diagnostics['curl_version'] = curl_version();
}

// 3. Check if we can resolve DNS
$diagnostics['dns_lookup'] = gethostbyname('truemoney.atlassian.net');

// 4. Try a simple cURL request
if ($diagnostics['curl_installed']) {
    try {
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $jiraUrl . '/rest/api/3/myself');
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 10);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
        
        // Disable SSL verification for local development
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
        curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
        
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'Authorization: Basic ' . base64_encode($jiraEmail . ':' . $jiraApiToken),
            'Accept: application/json'
        ]);
        
        $response = curl_exec($ch);
        $curlError = curl_error($ch);
        $curlErrno = curl_errno($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlInfo = curl_getinfo($ch);
        curl_close($ch);
        
        $diagnostics['curl_test'] = [
            'http_code' => $httpCode,
            'curl_errno' => $curlErrno,
            'curl_error' => $curlError,
            'response_size' => strlen($response),
            'total_time' => $curlInfo['total_time'] ?? 0,
            'connect_time' => $curlInfo['connect_time'] ?? 0,
            'success' => ($httpCode === 200 && $curlErrno === 0)
        ];
        
        if ($httpCode === 200) {
            $data = json_decode($response, true);
            $diagnostics['jira_user'] = [
                'accountId' => $data['accountId'] ?? 'unknown',
                'displayName' => $data['displayName'] ?? 'unknown',
                'emailAddress' => $data['emailAddress'] ?? 'unknown'
            ];
        } else {
            $diagnostics['response_preview'] = substr($response, 0, 500);
        }
        
    } catch (Exception $e) {
        $diagnostics['curl_test_error'] = $e->getMessage();
    }
}

// 5. Check SSL/TLS support
$diagnostics['openssl_version'] = OPENSSL_VERSION_TEXT ?? 'Not available';

// 6. Check allow_url_fopen
$diagnostics['allow_url_fopen'] = ini_get('allow_url_fopen');

// 7. Check if we're behind a proxy
$diagnostics['http_proxy'] = getenv('HTTP_PROXY') ?: getenv('http_proxy') ?: 'none';
$diagnostics['https_proxy'] = getenv('HTTPS_PROXY') ?: getenv('https_proxy') ?: 'none';

echo json_encode([
    'ok' => true,
    'diagnostics' => $diagnostics,
    'recommendation' => getDiagnosticRecommendation($diagnostics)
], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);

function getDiagnosticRecommendation($diag) {
    if (!$diag['curl_installed']) {
        return 'cURL is not installed. Install php-curl extension.';
    }
    
    if (isset($diag['curl_test']['curl_errno']) && $diag['curl_test']['curl_errno'] !== 0) {
        $errno = $diag['curl_test']['curl_errno'];
        $error = $diag['curl_test']['curl_error'];
        
        if ($errno === 6) {
            return 'DNS resolution failed. Check network connectivity or DNS settings.';
        } elseif ($errno === 7) {
            return 'Connection failed. Check firewall or network settings.';
        } elseif ($errno === 28) {
            return 'Connection timeout. Check network speed or firewall.';
        } elseif ($errno === 35 || $errno === 60) {
            return 'SSL/TLS error. Try updating CA certificates or temporarily disable SSL verification for testing.';
        } else {
            return "cURL error {$errno}: {$error}";
        }
    }
    
    if (isset($diag['curl_test']['http_code']) && $diag['curl_test']['http_code'] === 401) {
        return 'Authentication failed. Check Jira email and API token.';
    }
    
    if (isset($diag['curl_test']['http_code']) && $diag['curl_test']['http_code'] === 403) {
        return 'Access forbidden. Check Jira permissions.';
    }
    
    if (isset($diag['curl_test']['success']) && $diag['curl_test']['success']) {
        return 'Connection successful! Jira API is working correctly.';
    }
    
    return 'Unknown issue. Check diagnostics details above.';
}
