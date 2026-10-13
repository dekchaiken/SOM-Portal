<?php
/**
 * MA Services - Create API
 * POST create new MA service
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
    $required = ['service_name', 'service_type', 'tool_type'];
    foreach ($required as $field) {
        if (empty($input[$field])) {
            echo json_encode([
                'success' => false,
                'message' => "Missing required field: $field"
            ]);
            exit;
        }
    }
    
    $dataFile = teamDataPath('ma-services.json');
    
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
    
    // Create new service
    $newService = [
        'id' => $data['next_id'],
        'service_name' => $input['service_name'],
        'service_type' => $input['service_type'],
        'tool_type' => $input['tool_type'],
        'can_change_text' => $input['can_change_text'] ?? '',
        'remark' => $input['remark'] ?? '',
        'link_manual' => $input['link_manual'] ?? '',
        'direct_link' => $input['direct_link'] ?? '',
        'custom_url' => $input['custom_url'] ?? '',
        'grafana_link' => $input['grafana_link'] ?? '',
        'opensearch_url' => $input['opensearch_url'] ?? '',
        'images' => $input['images'] ?? [],
        'backoffice_use_case_id' => (isset($input['backoffice_use_case_id']) && $input['backoffice_use_case_id'] !== '' && (int)$input['backoffice_use_case_id'] > 0)
            ? (int)$input['backoffice_use_case_id']
            : null,
        'jenkins_server_id' => isset($input['jenkins_server_id']) ? trim((string)$input['jenkins_server_id']) : '',
        'jenkins_job_path'  => isset($input['jenkins_job_path'])  ? trim((string)$input['jenkins_job_path'])  : '',
        'created_at' => date('Y-m-d H:i:s'),
        'updated_at' => date('Y-m-d H:i:s')
    ];
    
    $data['services'][] = $newService;
    $data['next_id']++;
    
    // Save to file
    if (file_put_contents($dataFile, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE))) {
        @unlink(teamDataPath('ma-status-cache.json'));
        echo json_encode([
            'success' => true,
            'message' => 'Service created successfully',
            'id' => $newService['id'],
            'data' => $newService
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
