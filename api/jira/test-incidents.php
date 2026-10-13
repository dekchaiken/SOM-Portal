<?php
// Simple test
error_reporting(E_ALL);
ini_set('display_errors', 1);
ini_set('max_execution_time', 60);

header('Content-Type: application/json');

echo json_encode([
    'success' => true,
    'message' => 'Test OK',
    'php_version' => phpversion(),
    'curl_available' => function_exists('curl_init')
]);
