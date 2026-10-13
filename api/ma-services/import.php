<?php
/**
 * MA Services - Import API
 * POST import multiple services from CSV
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

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode([
        'success' => false,
        'message' => 'Method not allowed'
    ]);
    exit;
}

try {
    $input = json_decode(file_get_contents('php://input'), true);
    
    if (!$input || !isset($input['services']) || !is_array($input['services'])) {
        echo json_encode([
            'success' => false,
            'message' => 'Invalid input or missing services array'
        ]);
        exit;
    }
    
    $services = $input['services'];
    
    if (count($services) === 0) {
        echo json_encode([
            'success' => false,
            'message' => 'No services to import'
        ]);
        exit;
    }
    
    $dataFile = teamDataPath('ma-services.json');
    
    // Preserve next_id from payload or calculate from max existing id
    $nextId = isset($input['next_id']) && is_int($input['next_id'])
        ? $input['next_id']
        : (max(array_column($services, 'id')) + 1);

    // Create new data structure
    $data = [
        'services' => $services,
        'next_id' => $nextId
    ];
    
    // Save to file
    if (file_put_contents($dataFile, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE))) {
        echo json_encode([
            'success' => true,
            'message' => 'Import successful',
            'count' => count($services)
        ]);
    } else {
        echo json_encode([
            'success' => false,
            'message' => 'Failed to save data'
        ]);
    }
    
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => 'Server error: ' . $e->getMessage()
    ]);
}
