<?php
/**
 * MA Services - Activity Log
 * Log all create, update, delete actions
 */

require_once __DIR__ . '/../helpers.php';
requireAuth();
requireSmForShared();

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

try {
    $logFile = teamDataPath('ma-services-log.json');
    
    // Read existing logs
    $logs = [];
    if (file_exists($logFile)) {
        $jsonData = file_get_contents($logFile);
        $data = json_decode($jsonData, true);
        $logs = $data['logs'] ?? [];
    }
    
    // Get request data
    $input = json_decode(file_get_contents('php://input'), true);
    
    if (!$input) {
        echo json_encode([
            'success' => false,
            'message' => 'Invalid input'
        ]);
        exit;
    }
    
    // Get user info from session
    $user = $_SESSION['user'] ?? null;
    $username = $user['username'] ?? 'Unknown';
    $userId = $user['id'] ?? null;
    
    // Create log entry
    $logEntry = [
        'id' => count($logs) + 1,
        'timestamp' => date('Y-m-d H:i:s'),
        'user_id' => $userId,
        'username' => $username,
        'action' => $input['action'] ?? 'unknown', // 'create', 'update', 'delete'
        'type' => $input['type'] ?? 'usecase', // 'usecase' or 'cutoff'
        'item_id' => $input['item_id'] ?? null,
        'item_name' => $input['item_name'] ?? '',
        'details' => $input['details'] ?? '',
        'ip_address' => $_SERVER['REMOTE_ADDR'] ?? 'unknown'
    ];
    
    // Add to logs array
    array_unshift($logs, $logEntry); // Add to beginning
    
    // Keep only last 1000 logs
    if (count($logs) > 1000) {
        $logs = array_slice($logs, 0, 1000);
    }
    
    // Save logs
    $data = ['logs' => $logs];
    file_put_contents($logFile, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    
    echo json_encode([
        'success' => true,
        'message' => 'Log recorded'
    ]);
    
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => 'Server error: ' . $e->getMessage()
    ]);
}
