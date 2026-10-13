<?php
/**
 * List all available weeks
 * GET /api/weekly-report/list.php
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

$dataDir = '../../data/weekly-report/';

try {
    $weeks = [];
    
    if (is_dir($dataDir)) {
        $files = scandir($dataDir);
        foreach ($files as $file) {
            if (preg_match('/^(week-\d{4}-\d{2}-\d{2})\.json$/', $file, $matches)) {
                $weeks[] = $matches[1]; // week-YYYY-MM-DD (without .json)
            }
        }
    }
    
    // Sort descending (newest first)
    rsort($weeks);
    
    echo json_encode([
        'ok' => true,
        'weeks' => $weeks,
        'count' => count($weeks)
    ]);
    
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'error' => $e->getMessage()
    ]);
}
