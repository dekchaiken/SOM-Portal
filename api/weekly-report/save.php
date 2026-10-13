<?php
/**
 * Save entry data with atomic write + file lock
 * POST /api/weekly-report/save.php
 * Body: { week, section, subType?, data }
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

$dataDir = '../../data/weekly-report/';

// Get POST data
$input = json_decode(file_get_contents('php://input'), true);

if (!$input) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Invalid JSON input']);
    exit;
}

// Validate required fields
$week = $input['week'] ?? '';
$section = $input['section'] ?? '';
$data = $input['data'] ?? null;
$subType = $input['subType'] ?? null;

if (empty($week) || empty($section) || $data === null) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Missing required fields: week, section, data']);
    exit;
}

// Validate week format
if (!preg_match('/^week-(\d{4}-\d{2}-\d{2})$/', $week, $wm)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Invalid week format']);
    exit;
}

// Week must start on Tuesday (matches assets/js/weekly-report/date-utils.js)
$ts = strtotime($wm[1]);
if ($ts === false || date('Y-m-d', $ts) !== $wm[1] || (int)date('N', $ts) !== 2) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Week must start on a Tuesday']);
    exit;
}

$filename = $dataDir . $week . '.json';

try {
    // Ensure data directory exists
    if (!is_dir($dataDir)) {
        mkdir($dataDir, 0755, true);
    }

    // Atomic write with file lock
    $fp = fopen($filename, 'c+');
    if (!$fp) {
        throw new Exception('Failed to open file');
    }

    // Acquire exclusive lock
    if (!flock($fp, LOCK_EX)) {
        fclose($fp);
        throw new Exception('Failed to acquire lock');
    }

    // Read current data
    $fileSize = filesize($filename);
    $currentData = [];

    if ($fileSize > 0) {
        $content = fread($fp, $fileSize);
        $currentData = json_decode($content, true) ?? [];
    }

    // Initialize structure if empty
    if (empty($currentData)) {
        $weekDate = str_replace('week-', '', $week);
        $currentData = [
            'weekStart' => $weekDate,
            'generatedAt' => date('c'),
            'announcement' => [],
            'incidents' => [],
            'batch' => ['event' => [], 'pending' => []],
            'support' => ['ma' => [], 'dev' => []],
            'updates' => ['alert' => [], 'handover' => [], 'other' => []],
            'improvements' => ['improve' => [], 'project' => []],
            'updatedAt' => date('c')
        ];
    }

    // Update data based on section
    switch ($section) {
        case 'announcement':
            $currentData['announcement'] = $data;
            break;
            
        case 'incidents':
            $currentData['incidents'] = $data;
            break;
            
        case 'batch':
            if ($subType) {
                $currentData['batch'][$subType] = $data;
            } else {
                $currentData['batch'] = $data;
            }
            break;
            
        case 'support':
            if ($subType) {
                $currentData['support'][$subType] = $data;
            } else {
                $currentData['support'] = $data;
            }
            break;
            
        case 'updates':
            if ($subType) {
                $currentData['updates'][$subType] = $data;
            } else {
                $currentData['updates'] = $data;
            }
            break;
            
        case 'improvements':
            if ($subType) {
                $currentData['improvements'][$subType] = $data;
            } else {
                $currentData['improvements'] = $data;
            }
            break;
            
        default:
            flock($fp, LOCK_UN);
            fclose($fp);
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Invalid section']);
            exit;
    }

    // Update timestamp
    $currentData['updatedAt'] = date('c');

    // Write data
    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, json_encode($currentData, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));

    // Release lock and close
    flock($fp, LOCK_UN);
    fclose($fp);

    echo json_encode([
        'ok' => true,
        'data' => [
            'message' => 'Data saved successfully',
            'updatedAt' => $currentData['updatedAt']
        ]
    ]);
    
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'error' => $e->getMessage()
    ]);
}
