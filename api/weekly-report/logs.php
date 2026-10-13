<?php
/**
 * Activity Logs API
 * GET - retrieve logs
 * POST - add log entry
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

$logFile = '../../data/weekly-report/activity-log.json';

try {
    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        // Read logs
        if (!file_exists($logFile)) {
            echo json_encode(['ok' => true, 'logs' => [], 'count' => 0]);
            exit;
        }
        
        $content = file_get_contents($logFile);
        $logs = json_decode($content, true) ?? [];
        
        // Apply filters
        $action = $_GET['action'] ?? null;
        $category = $_GET['category'] ?? null;
        $email = $_GET['email'] ?? null;
        $limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 100;
        
        $filtered = $logs;
        
        if ($action) {
            $filtered = array_filter($filtered, fn($log) => ($log['action'] ?? '') === $action);
        }
        if ($category) {
            $filtered = array_filter($filtered, fn($log) => ($log['category'] ?? '') === $category);
        }
        if ($email) {
            $filtered = array_filter($filtered, fn($log) => stripos($log['email'] ?? '', $email) !== false);
        }
        
        // Sort by timestamp descending
        usort($filtered, fn($a, $b) => strcmp($b['timestamp'], $a['timestamp']));
        
        // Limit results
        $filtered = array_slice($filtered, 0, $limit);
        
        echo json_encode([
            'ok' => true,
            'logs' => array_values($filtered),
            'count' => count($filtered),
            'total' => count($logs)
        ]);
        
    } else if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        // Add log entry
        $input = json_decode(file_get_contents('php://input'), true);
        
        if (!$input) {
            throw new Exception('Invalid JSON input');
        }
        
        // Read existing logs
        $logs = [];
        if (file_exists($logFile)) {
            $content = file_get_contents($logFile);
            $logs = json_decode($content, true) ?? [];
        }
        
        // Create log entry
        $logEntry = [
            'timestamp' => date('c'),
            'email' => $input['email'] ?? 'unknown',
            'action' => $input['action'] ?? 'unknown',
            'category' => $input['category'] ?? '',
            'details' => $input['details'] ?? []
        ];
        
        // Add to logs
        array_unshift($logs, $logEntry);
        
        // Keep only last 1000 entries
        $logs = array_slice($logs, 0, 1000);
        
        // Ensure directory exists
        $dir = dirname($logFile);
        if (!is_dir($dir)) {
            mkdir($dir, 0755, true);
        }
        
        // Write logs
        $written = file_put_contents($logFile, json_encode($logs, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        
        if ($written === false) {
            throw new Exception('Failed to write log file');
        }
        
        echo json_encode([
            'ok' => true,
            'data' => [
                'message' => 'Log entry added',
                'written' => $written,
                'logEntry' => $logEntry
            ]
        ]);
    }
    
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'error' => $e->getMessage()
    ]);
}
