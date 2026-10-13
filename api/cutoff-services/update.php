<?php
/**
 * Cut-off Services - Update API
 * POST update existing cut-off service
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
    
    if (!$input || !isset($input['id'])) {
        echo json_encode([
            'success' => false,
            'message' => 'Invalid input or missing ID'
        ]);
        exit;
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
    
    // Find and update cut-off
    $found = false;
    foreach ($data['cutoffs'] as &$cutoff) {
        if ($cutoff['id'] == $input['id']) {
            $cutoff['site_type'] = $input['site_type'] ?? $cutoff['site_type'];
            $cutoff['service_name'] = $input['service_name'] ?? $cutoff['service_name'];
            $cutoff['bank_name'] = $input['bank_name'] ?? $cutoff['bank_name'];
            $cutoff['comcode'] = $input['comcode'] ?? $cutoff['comcode'];
            $cutoff['cutoff_time'] = $input['cutoff_time'] ?? $cutoff['cutoff_time'];
            $cutoff['cutoff_day'] = $input['cutoff_day'] ?? $cutoff['cutoff_day'];
            $cutoff['service_group'] = $input['service_group'] ?? $cutoff['service_group'];
            $cutoff['channel'] = $input['channel'] ?? $cutoff['channel'];
            $cutoff['ma_page'] = $input['ma_page'] ?? $cutoff['ma_page'];
            $cutoff['tmn_certificate'] = $input['tmn_certificate'] ?? $cutoff['tmn_certificate'];
            $cutoff['bank_certificate'] = $input['bank_certificate'] ?? $cutoff['bank_certificate'];
            $cutoff['remark'] = $input['remark'] ?? $cutoff['remark'];
            $cutoff['images'] = $input['images'] ?? ($cutoff['images'] ?? []);
            $cutoff['updated_at'] = date('Y-m-d H:i:s');
            $found = true;
            break;
        }
    }
    
    if (!$found) {
        echo json_encode([
            'success' => false,
            'message' => 'Cut-off not found'
        ]);
        exit;
    }
    
    // Save to file
    if (file_put_contents($dataFile, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE))) {
        echo json_encode([
            'success' => true,
            'message' => 'Cut-off updated successfully'
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
