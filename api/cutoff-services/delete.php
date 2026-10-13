<?php
/**
 * Cut-off Services - Delete API
 * POST delete cut-off service
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
    
    // Find and delete cut-off
    $found = false;
    $data['cutoffs'] = array_filter($data['cutoffs'], function($cutoff) use ($input, &$found) {
        if ($cutoff['id'] == $input['id']) {
            $found = true;
            return false;
        }
        return true;
    });
    
    // Re-index array
    $data['cutoffs'] = array_values($data['cutoffs']);
    
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
            'message' => 'Cut-off deleted successfully'
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
