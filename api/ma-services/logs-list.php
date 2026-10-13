<?php
/**
 * MA Services - Get Activity Logs
 * GET all activity logs
 */

require_once __DIR__ . '/../helpers.php';
requireAuth();

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

try {
    $logFile = teamDataPath('ma-services-log.json');
    
    if (!file_exists($logFile)) {
        echo json_encode([
            'success' => true,
            'data' => [],
            'count' => 0
        ]);
        exit;
    }
    
    $jsonData = file_get_contents($logFile);
    $data = json_decode($jsonData, true);
    
    if ($data === null) {
        echo json_encode([
            'success' => false,
            'message' => 'Invalid JSON data'
        ]);
        exit;
    }
    
    $logs = $data['logs'] ?? [];
    
    // Optional filters
    $type = $_GET['type'] ?? null;
    $action = $_GET['action'] ?? null;
    $limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 100;
    
    // Apply filters
    if ($type) {
        $logs = array_filter($logs, function($log) use ($type) {
            return $log['type'] === $type;
        });
    }
    
    if ($action) {
        $logs = array_filter($logs, function($log) use ($action) {
            return $log['action'] === $action;
        });
    }
    
    // Limit results
    $logs = array_slice(array_values($logs), 0, $limit);
    
    echo json_encode([
        'success' => true,
        'data' => $logs,
        'count' => count($logs)
    ]);
    
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => 'Server error: ' . $e->getMessage()
    ]);
}
