<?php
/**
 * Delete week data
 * POST /api/weekly-report/delete.php
 * Body: { week }
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'Method not allowed']);
    exit;
}

$dataDir = '../../data/weekly-report/';

// Get POST data
$input = json_decode(file_get_contents('php://input'), true);

if (!$input) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Invalid JSON input']);
    exit;
}

$week = $input['week'] ?? '';

if (empty($week)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Missing required field: week']);
    exit;
}

// Validate week format
if (!preg_match('/^week-\d{4}-\d{2}-\d{2}$/', $week)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Invalid week format']);
    exit;
}

$filename = $dataDir . $week . '.json';

try {
    if (!file_exists($filename)) {
        http_response_code(404);
        echo json_encode(['ok' => false, 'error' => 'Week data not found']);
        exit;
    }

    // Delete file
    if (!unlink($filename)) {
        throw new Exception('Failed to delete file');
    }

    echo json_encode([
        'ok' => true,
        'data' => [
            'message' => 'Week data deleted successfully',
            'week' => $week
        ]
    ]);
    
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'error' => $e->getMessage()
    ]);
}
