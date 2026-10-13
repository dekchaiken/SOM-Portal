<?php
/**
 * rundeck-proxy.php
 * Proxy for Rundeck API with session-based authentication
 */
require_once __DIR__ . '/helpers.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin) {
    header("Access-Control-Allow-Origin: $origin");
    header('Access-Control-Allow-Credentials: true');
    header('Access-Control-Allow-Headers: Content-Type, X-Rundeck-User, X-Rundeck-Pass');
}
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$authPayload = requireAuth();

// Get action
$action = $_GET['action'] ?? '';
if (!$action) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing action parameter']);
    exit;
}

// Get credentials from headers or use defaults
$username = $_SERVER['HTTP_X_RUNDECK_USER'] ?? 'warapon.lea';
$password = $_SERVER['HTTP_X_RUNDECK_PASS'] ?? 'Passw0rd#Passw0rd#';

// Rundeck configuration
$rundeckBase = 'https://th-ops-rundeck.mgt.ascendmoney.io';
$jobId = 'b87c7df1-2ec1-4480-9fe6-22a07f31ad02';
$project = 'SM';

// Migrate job configuration
$migrateJobId = '2ed9edbd-83c6-4030-ade7-2f8d8b45835f';
$migrateUser  = 'warapon.lea';
$migratePass  = 'Passw0rd#Passw0rd#';

// Cookie jar for session management
$src = $_GET['src'] ?? '';
if ($src === 'migrate') {
    $cookieFile = sys_get_temp_dir() . '/rundeck_cookies_migrate_' . md5($migrateUser) . '.txt';
} else {
    $cookieFile = sys_get_temp_dir() . '/rundeck_cookies_' . md5($username) . '.txt';
}

error_log("Rundeck Proxy: action=$action, username=$username");

/**
 * Login to Rundeck and get session cookie
 */
function rundeckLogin($rundeckBase, $username, $password, $cookieFile) {
    $loginUrl = "$rundeckBase/j_security_check";

    $postData = http_build_query([
        'j_username' => $username,
        'j_password' => $password
    ]);

    $ch = curl_init($loginUrl);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $postData,
        CURLOPT_COOKIEJAR      => $cookieFile,
        CURLOPT_COOKIEFILE     => $cookieFile,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_HTTPHEADER     => ['Content-Type: application/x-www-form-urlencoded'],
    ]);

    $response  = curl_exec($ch);
    $status    = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $finalUrl  = curl_getinfo($ch, CURLINFO_EFFECTIVE_URL);
    $error     = curl_error($ch);
    curl_close($ch);

    error_log("Rundeck Login: status=$status finalUrl=$finalUrl");

    if ($error) {
        return ['success' => false, 'error' => 'Login connection error: ' . $error];
    }
    if ($status >= 400) {
        return ['success' => false, 'error' => "Login failed (HTTP $status)"];
    }
    // Rundeck redirects back to /user/login on bad credentials
    if (strpos($finalUrl, '/user/login') !== false) {
        return ['success' => false, 'error' => 'Login failed: invalid credentials (redirected to login page)'];
    }

    return ['success' => true];
}

/**
 * Run Rundeck job via session cookie
 */
function rundeckRunJob($rundeckBase, $jobId, $cookieFile, $options = []) {
    $runUrl = "$rundeckBase/api/43/job/$jobId/run";
    $body   = json_encode(['options' => (object)$options]);

    error_log("Rundeck Run Job: URL=$runUrl body=$body");

    $ch = curl_init($runUrl);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $body,
        CURLOPT_COOKIEFILE     => $cookieFile,
        CURLOPT_COOKIEJAR      => $cookieFile,
        CURLOPT_HTTPHEADER     => [
            'Accept: application/json',
            'Content-Type: application/json',
            'X-Rundeck-Ajax: true',
        ],
        CURLOPT_TIMEOUT => 30,
    ]);
    
    $response = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);
    
    error_log("Rundeck Run Job: status=$status");
    
    if ($error) {
        return ['success' => false, 'error' => 'Job execution error: ' . $error];
    }
    
    if ($status >= 400) {
        $decoded = json_decode($response, true);
        $detail  = $decoded['message'] ?? $decoded['error'] ?? substr($response, 0, 300);
        return ['success' => false, 'error' => "Job execution failed (HTTP $status): $detail", 'response' => $response];
    }
    
    $data = json_decode($response, true);
    return ['success' => true, 'data' => $data];
}

/**
 * Get execution output
 */
function rundeckGetOutput($rundeckBase, $executionId, $cookieFile) {
    $outputUrl = "$rundeckBase/api/43/execution/$executionId/output?offset=0&maxlines=1000";
    $ch = curl_init($outputUrl);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_COOKIEFILE     => $cookieFile,
        CURLOPT_HTTPHEADER     => ['Accept: application/json', 'X-Rundeck-Ajax: true'],
        CURLOPT_TIMEOUT        => 30,
    ]);
    
    $response = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);
    
    error_log("Rundeck Get Output: status=$status");
    
    if ($error) {
        return ['success' => false, 'error' => 'Output fetch error: ' . $error];
    }
    
    if ($status >= 400) {
        return ['success' => false, 'error' => 'Output fetch failed with status ' . $status];
    }
    
    $data = json_decode($response, true);
    return ['success' => true, 'data' => $data];
}

/**
 * Get execution status
 */
function rundeckGetExecution($rundeckBase, $executionId, $cookieFile) {
    $execUrl = "$rundeckBase/api/43/execution/$executionId";
    $ch = curl_init($execUrl);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_COOKIEFILE     => $cookieFile,
        CURLOPT_HTTPHEADER     => ['Accept: application/json'],
        CURLOPT_TIMEOUT        => 30,
    ]);
    
    $response = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    if ($status >= 400) {
        return ['success' => false, 'error' => 'Execution status fetch failed'];
    }
    
    $data = json_decode($response, true);
    return ['success' => true, 'data' => $data];
}

// Handle actions
switch ($action) {
    case 'run':
        // Reuse the migrate session (same server + credentials) — most reliable
        $sftpCookieFile = sys_get_temp_dir() . '/rundeck_cookies_migrate_' . md5($migrateUser) . '.txt';
        $loginResult = rundeckLogin($rundeckBase, $migrateUser, $migratePass, $sftpCookieFile);
        if (!$loginResult['success']) {
            http_response_code(401);
            echo json_encode($loginResult);
            exit;
        }
        $runResult = rundeckRunJob($rundeckBase, $jobId, $sftpCookieFile, [
            'sftp_partner_name' => 'CIMB',
            'logdate'           => date('Y.m'),
        ]);
        if (!$runResult['success']) {
            http_response_code(500);
            echo json_encode($runResult);
            exit;
        }
        logActivity('sftp_checker_run', [
            'execution_id' => $runResult['data']['id'] ?? '',
            'partner'      => 'CIMB',
        ], $authPayload['sub'] ?? '', $authPayload['name'] ?? '');
        echo json_encode($runResult);
        break;
        
    case 'output':
        $executionId = $_GET['executionId'] ?? '';
        if (!$executionId) {
            http_response_code(400);
            echo json_encode(['error' => 'Missing executionId parameter']);
            exit;
        }
        $pollCookie = sys_get_temp_dir() . '/rundeck_cookies_migrate_' . md5($migrateUser) . '.txt';
        if ($src === 'migrate') {
            rundeckLogin($rundeckBase, $migrateUser, $migratePass, $pollCookie);
        } else {
            rundeckLogin($rundeckBase, $migrateUser, $migratePass, $pollCookie);
        }
        $outputResult = rundeckGetOutput($rundeckBase, $executionId, $pollCookie);
        if (!$outputResult['success']) {
            http_response_code(500);
            echo json_encode($outputResult);
            exit;
        }
        echo json_encode($outputResult);
        break;

    case 'status':
        $executionId = $_GET['executionId'] ?? '';
        if (!$executionId) {
            http_response_code(400);
            echo json_encode(['error' => 'Missing executionId parameter']);
            exit;
        }
        $pollCookie = sys_get_temp_dir() . '/rundeck_cookies_migrate_' . md5($migrateUser) . '.txt';
        rundeckLogin($rundeckBase, $migrateUser, $migratePass, $pollCookie);
        $statusResult = rundeckGetExecution($rundeckBase, $executionId, $pollCookie);
        if (!$statusResult['success']) {
            http_response_code(500);
            echo json_encode($statusResult);
            exit;
        }
        echo json_encode($statusResult);
        break;
        
    case 'run_migrate':
        $tmnID   = $_GET['tmnID']   ?? '';
        $contact = $_GET['contact'] ?? '';
        if (!$tmnID || !$contact) {
            http_response_code(400);
            echo json_encode(['error' => 'Missing tmnID or contact parameter']);
            exit;
        }
        $migrateCookieFile = sys_get_temp_dir() . '/rundeck_cookies_migrate_' . md5($migrateUser) . '.txt';
        $loginResult = rundeckLogin($rundeckBase, $migrateUser, $migratePass, $migrateCookieFile);
        if (!$loginResult['success']) {
            http_response_code(401);
            echo json_encode($loginResult);
            exit;
        }
        $runResult = rundeckRunJob($rundeckBase, $migrateJobId, $migrateCookieFile, [
            'tmnID'   => $tmnID,
            'Contact' => $contact,
        ]);
        if (!$runResult['success']) {
            http_response_code(500);
            echo json_encode($runResult);
            exit;
        }
        logActivity('migrate_user_run', [
            'tmnID'        => $tmnID,
            'contact'      => $contact,
            'execution_id' => $runResult['data']['id'] ?? '',
        ], $authPayload['sub'] ?? '', $authPayload['name'] ?? '');
        echo json_encode($runResult);
        break;

    default:
        http_response_code(400);
        echo json_encode(['error' => 'Invalid action: ' . $action]);
        break;
}
