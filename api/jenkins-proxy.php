<?php
/**
 * jenkins-proxy.php
 * Proxy for Jenkins API to avoid CORS issues
 */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin) {
    header("Access-Control-Allow-Origin: $origin");
    header('Access-Control-Allow-Credentials: true');
    header('Access-Control-Allow-Headers: Content-Type, X-Jenkins-Token, X-Jenkins-User');
}
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

$url = $_GET['url'] ?? '';
if (!$url) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing url parameter']);
    exit;
}

// Get Jenkins token and username from headers or use defaults
$token = $_SERVER['HTTP_X_JENKINS_TOKEN'] ?? '115bed079dac44a59cbea48f9566f20651';
$username = $_SERVER['HTTP_X_JENKINS_USER'] ?? 'warapon.lea';

// Jenkins authentication - username:token format
$auth = base64_encode($username . ':' . $token);

// Debug logging
error_log("Jenkins Proxy: username=$username, token_length=" . strlen($token));
error_log("Jenkins Proxy: Auth header length=" . strlen($auth));
error_log("Jenkins Proxy: URL=$url");

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_SSL_VERIFYHOST => false,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_HTTPHEADER => [
        'Authorization: Basic ' . $auth,
        'Accept: application/json',
        'Content-Type: application/json',
    ],
    CURLOPT_TIMEOUT => 30,
    CURLOPT_VERBOSE => false,
]);

$response = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$error = curl_error($ch);
curl_close($ch);

// Debug logging
error_log("Jenkins Proxy: HTTP Status=$status");
error_log("Jenkins Proxy: Response length=" . strlen($response));
if ($error) {
    error_log("Jenkins Proxy: cURL Error=$error");
}

if ($error) {
    http_response_code(502);
    echo json_encode(['error' => 'Jenkins connection error: ' . $error]);
    exit;
}

if ($status === 401) {
    error_log("Jenkins Proxy: 401 Unauthorized - Check username/token");
    http_response_code(401);
    echo json_encode([
        'error' => 'Jenkins authentication failed',
        'hint' => 'Check if username and API token are correct',
        'username' => $username,
        'token_length' => strlen($token)
    ]);
    exit;
}

http_response_code($status);
echo $response;
