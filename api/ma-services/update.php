<?php
/**
 * MA Services - Update API
 * POST update existing MA service
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
    
    // Find and update service
    $found = false;
    foreach ($data['services'] as &$service) {
        if ($service['id'] == $input['id']) {
            $service['service_name'] = $input['service_name'] ?? $service['service_name'];
            $service['service_type'] = $input['service_type'] ?? $service['service_type'];
            $service['tool_type'] = $input['tool_type'] ?? $service['tool_type'];
            $service['can_change_text'] = $input['can_change_text'] ?? $service['can_change_text'];
            $service['remark'] = $input['remark'] ?? $service['remark'];
            $service['link_manual'] = $input['link_manual'] ?? $service['link_manual'];
            $service['direct_link'] = $input['direct_link'] ?? $service['direct_link'];
            $service['custom_url'] = $input['custom_url'] ?? $service['custom_url'];
            $service['grafana_link'] = $input['grafana_link'] ?? ($service['grafana_link'] ?? '');
            $service['opensearch_url'] = $input['opensearch_url'] ?? ($service['opensearch_url'] ?? '');
            $service['images'] = $input['images'] ?? ($service['images'] ?? []);
            if (array_key_exists('backoffice_use_case_id', $input)) {
                $v = $input['backoffice_use_case_id'];
                $service['backoffice_use_case_id'] = ($v !== '' && $v !== null && (int)$v > 0) ? (int)$v : null;
            }
            if (array_key_exists('jenkins_server_id', $input)) {
                $service['jenkins_server_id'] = trim((string)$input['jenkins_server_id']);
            }
            if (array_key_exists('jenkins_job_path', $input)) {
                $service['jenkins_job_path'] = trim((string)$input['jenkins_job_path']);
            }
            $service['updated_at'] = date('Y-m-d H:i:s');
            $found = true;
            break;
        }
    }
    
    if (!$found) {
        echo json_encode([
            'success' => false,
            'message' => 'Service not found'
        ]);
        exit;
    }
    
    // Save to file
    if (file_put_contents($dataFile, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE))) {
        // Bust ma-status cache so the new link/state shows on next open
        // (esp. for backoffice_use_case_id / jenkins_* fields).
        @unlink(teamDataPath('ma-status-cache.json'));
        echo json_encode([
            'success' => true,
            'message' => 'Service updated successfully'
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
