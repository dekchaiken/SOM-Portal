<?php
/**
 * Cut-off Services Types API
 * GET, POST, DELETE site types
 */

require_once __DIR__ . '/../helpers.php';
requireAuth();

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$typesFile   = teamDataPath('ma-types.json');
$cutoffsFile = teamDataPath('cutoff-services.json');

// GET is view-only for all teams; POST/PUT/DELETE are SM-only.
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    requireSmForShared();
}

// GET - List all site types
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    try {
        $typesData = json_decode(file_get_contents($typesFile), true);
        $cutoffsData = json_decode(file_get_contents($cutoffsFile), true);
        
        $types = $typesData['site_types'] ?? [];
        $cutoffs = $cutoffsData['cutoffs'] ?? [];
        
        // Count cutoffs for each type
        foreach ($types as &$type) {
            $type['count'] = count(array_filter($cutoffs, fn($c) => $c['site_type'] === $type['name']));
        }
        
        echo json_encode([
            'success' => true,
            'data' => $types
        ]);
    } catch (Exception $e) {
        echo json_encode([
            'success' => false,
            'message' => $e->getMessage()
        ]);
    }
    exit;
}

// POST - Add new site type
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    try {
        $input = json_decode(file_get_contents('php://input'), true);
        
        if (!isset($input['name'])) {
            echo json_encode(['success' => false, 'message' => 'Name is required']);
            exit;
        }
        
        $typesData = json_decode(file_get_contents($typesFile), true);
        
        // Check if exists
        foreach ($typesData['site_types'] as $type) {
            if ($type['name'] === $input['name']) {
                echo json_encode(['success' => false, 'message' => 'Type already exists']);
                exit;
            }
        }
        
        $typesData['site_types'][] = [
            'name'        => $input['name'],
            'description' => $input['description'] ?? '',
            'color'       => $input['color'] ?? 'gray',
        ];
        
        file_put_contents($typesFile, json_encode($typesData, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        
        echo json_encode(['success' => true]);
    } catch (Exception $e) {
        echo json_encode(['success' => false, 'message' => $e->getMessage()]);
    }
    exit;
}

// PUT - Update site type
if ($_SERVER['REQUEST_METHOD'] === 'PUT') {
    try {
        $input   = json_decode(file_get_contents('php://input'), true);
        $oldName = trim($input['old_name'] ?? '');
        $newName = trim($input['name'] ?? '');
        $desc    = trim($input['description'] ?? '');

        if (!$oldName || !$newName) {
            echo json_encode(['success' => false, 'message' => 'old_name and name are required']);
            exit;
        }

        $typesData = json_decode(file_get_contents($typesFile), true);

        if ($oldName !== $newName) {
            foreach ($typesData['site_types'] as $t) {
                if ($t['name'] === $newName) {
                    echo json_encode(['success' => false, 'message' => 'Type name already exists']);
                    exit;
                }
            }
        }

        $found = false;
        foreach ($typesData['site_types'] as &$t) {
            if ($t['name'] === $oldName) {
                $t['name']        = $newName;
                $t['description'] = $desc;
                if (isset($input['color'])) $t['color'] = $input['color'];
                $found = true;
                break;
            }
        }
        unset($t);

        if (!$found) {
            echo json_encode(['success' => false, 'message' => 'Type not found']);
            exit;
        }

        file_put_contents($typesFile, json_encode($typesData, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        
        // Update all cutoffs that use this type
        if ($oldName !== $newName) {
            $cutoffsData = json_decode(file_get_contents($cutoffsFile), true);
            $updatedCount = 0;
            
            foreach ($cutoffsData['cutoffs'] as &$cutoff) {
                if ($cutoff['site_type'] === $oldName) {
                    $cutoff['site_type'] = $newName;
                    $updatedCount++;
                }
            }
            unset($cutoff);
            
            if ($updatedCount > 0) {
                file_put_contents($cutoffsFile, json_encode($cutoffsData, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
            }
            
            echo json_encode(['success' => true, 'updated_cutoffs' => $updatedCount]);
        } else {
            echo json_encode(['success' => true]);
        }
    } catch (Exception $e) {
        echo json_encode(['success' => false, 'message' => $e->getMessage()]);
    }
    exit;
}

// DELETE - Remove site type
if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    try {
        $name = $_GET['name'] ?? '';
        
        if (!$name) {
            echo json_encode(['success' => false, 'message' => 'Name is required']);
            exit;
        }
        
        $typesData = json_decode(file_get_contents($typesFile), true);
        
        $typesData['site_types'] = array_values(array_filter(
            $typesData['site_types'],
            fn($t) => $t['name'] !== $name
        ));
        
        file_put_contents($typesFile, json_encode($typesData, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        
        echo json_encode(['success' => true]);
    } catch (Exception $e) {
        echo json_encode(['success' => false, 'message' => $e->getMessage()]);
    }
    exit;
}
