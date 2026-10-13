<?php
/**
 * Get week data (creates template if not exists)
 * GET /api/weekly-report/get.php?week=week-YYYY-MM-DD
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

$dataDir = '../../data/weekly-report/';
$week = $_GET['week'] ?? '';

// Validate week format
if (!preg_match('/^week-\d{4}-\d{2}-\d{2}$/', $week)) {
    http_response_code(400);
    echo json_encode([
        'ok' => false,
        'error' => 'Invalid week format. Expected: week-YYYY-MM-DD'
    ]);
    exit;
}

$filename = $dataDir . $week . '.json';

try {
    // Ensure data directory exists
    if (!is_dir($dataDir)) {
        mkdir($dataDir, 0755, true);
    }
    
    // If file doesn't exist, create template
    if (!file_exists($filename)) {
        $weekDate = str_replace('week-', '', $week);
        $template = [
            'weekStart' => $weekDate,
            'generatedAt' => date('c'),
            'announcement' => [],
            'incidents' => [],
            'batch' => [
                'event' => [],
                'pending' => []
            ],
            'support' => [
                'ma' => [],
                'dev' => []
            ],
            'updates' => [
                'alert' => [],
                'handover' => [],
                'other' => []
            ],
            'improvements' => [
                'improve' => [],
                'project' => []
            ],
            'updatedAt' => date('c')
        ];
        
        file_put_contents($filename, json_encode($template, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    }
    
    // Read and return data
    $content = file_get_contents($filename);
    $data = json_decode($content, true);
    
    if ($data === null) {
        throw new Exception('Failed to parse JSON data');
    }
    
    echo json_encode([
        'ok' => true,
        'data' => $data
    ]);
    
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'error' => $e->getMessage()
    ]);
}
