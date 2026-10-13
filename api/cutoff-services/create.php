<?php
/**
 * Cut-off Services - Create API
 * POST create new cut-off service
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
    
    if (!$input) {
        echo json_encode([
            'success' => false,
            'message' => 'Invalid input'
        ]);
        exit;
    }
    
    // Validate required fields
    $required = ['site_type', 'service_name', 'cutoff_time', 'cutoff_day'];
    foreach ($required as $field) {
        if (empty($input[$field])) {
            echo json_encode([
                'success' => false,
                'message' => "Missing required field: $field"
            ]);
            exit;
        }
    }
    
    $dataFile = teamDataPath('cutoff-services.json');
    
    if (!file_exists($dataFile)) {
        echo json_encode([
            'success' => false,
            'message' => 'Data file not found'
        ]);
        exit;
    }
    
    $jsonData = file_get_contents($dataFile);
    $data = json_decode($jsonData, true);
    
    if ($data === null) {
        echo json_encode([
            'success' => false,
            'message' => 'Invalid JSON data'
        ]);
        exit;
    }
    
    // Create new cut-off
    $newCutoff = [
        'id' => $data['next_id'],
        'site_type' => $input['site_type'],
        'service_name' => $input['service_name'],
        'bank_name' => $input['bank_name'] ?? '',
        'comcode' => $input['comcode'] ?? '',
        'cutoff_time' => $input['cutoff_time'],
        'cutoff_day' => $input['cutoff_day'],
        'service_group' => $input['service_group'] ?? '',
        'channel' => $input['channel'] ?? '',
        'ma_page' => $input['ma_page'] ?? '',
        'tmn_certificate' => $input['tmn_certificate'] ?? '',
        'bank_certificate' => $input['bank_certificate'] ?? '',
        'remark' => $input['remark'] ?? '',
        'images' => $input['images'] ?? [],
        'created_at' => date('Y-m-d H:i:s'),
        'updated_at' => date('Y-m-d H:i:s')
    ];
    
    $data['cutoffs'][] = $newCutoff;
    $data['next_id']++;
    
    // Save to file
    if (file_put_contents($dataFile, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE))) {
        echo json_encode([
            'success' => true,
            'message' => 'Cut-off created successfully',
            'id' => $newCutoff['id'],
            'data' => $newCutoff
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
