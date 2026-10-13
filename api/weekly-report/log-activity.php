<?php
/**
 * Log Weekly Report Activity to Main System Logs
 * POST /api/weekly-report/log-activity.php
 */

require_once '../helpers.php';

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'Method not allowed']);
    exit;
}

try {
    // Require authentication
    $payload = requireAuth();
    
    // Get input
    $input = json_decode(file_get_contents('php://input'), true);
    
    if (!$input) {
        throw new Exception('Invalid JSON input');
    }
    
    $action = $input['action'] ?? 'unknown';
    $category = $input['category'] ?? '';
    $details = $input['details'] ?? [];
    
    // Build action name for main system
    $actionName = 'weekly_report_' . $action;
    
    // Build detail with category
    $detail = [
        'category' => $category,
        'week' => $details['week'] ?? '',
    ];
    
    // Add specific details based on category
    if (isset($details['ticketId'])) {
        $detail['ticket_id'] = $details['ticketId'];
    }
    if (isset($details['name'])) {
        $detail['name'] = $details['name'];
    }
    if (isset($details['subType'])) {
        $detail['sub_type'] = $details['subType'];
    }
    
    // Log to main system
    logActivity($actionName, $detail, $payload['sub'], $payload['name']);
    
    respondOk(['message' => 'Activity logged successfully']);
    
} catch (Exception $e) {
    respondError($e->getMessage(), 500);
}
