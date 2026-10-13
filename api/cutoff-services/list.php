<?php
/**
 * Cut-off Services - List API
 * GET all cut-off services
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
    
    $cutoffs = $data['cutoffs'] ?? [];
    
    // Sort by ID ascending (1, 2, 3...)
    usort($cutoffs, function($a, $b) {
        return $a['id'] - $b['id'];
    });
    
    echo json_encode([
        'success' => true,
        'data' => $cutoffs,
        'count' => count($cutoffs)
    ]);
    
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => 'Server error: ' . $e->getMessage()
    ]);
}
