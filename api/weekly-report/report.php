<?php
/**
 * Generate monthly/yearly reports
 * GET /api/weekly-report/report.php?type=monthly&year=2026&month=04
 * GET /api/weekly-report/report.php?type=yearly&year=2026
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

$dataDir = '../../data/weekly-report/';

$type = $_GET['type'] ?? 'monthly';
$year = $_GET['year'] ?? date('Y');
$month = $_GET['month'] ?? date('m');

try {
    // Get all week files
    $files = glob($dataDir . 'week-*.json');
    
    if ($files === false) {
        throw new Exception('Failed to read directory');
    }

    $weeks = [];
    
    foreach ($files as $file) {
        $basename = basename($file, '.json');
        $dateStr = str_replace('week-', '', $basename);
        
        // Parse date
        $weekDate = DateTime::createFromFormat('Y-m-d', $dateStr);
        if (!$weekDate) continue;
        
        // Filter by type
        if ($type === 'monthly') {
            if ($weekDate->format('Y') != $year || $weekDate->format('m') != $month) {
                continue;
            }
        } elseif ($type === 'yearly') {
            if ($weekDate->format('Y') != $year) {
                continue;
            }
        }
        
        // Read file
        $content = file_get_contents($file);
        if ($content === false) continue;
        
        $data = json_decode($content, true);
        if (!$data) continue;
        
        $weeks[] = [
            'week' => $basename,
            'weekStart' => $data['weekStart'] ?? $dateStr,
            'data' => $data
        ];
    }
    
    // Sort by date descending
    usort($weeks, function($a, $b) {
        return strcmp($b['weekStart'], $a['weekStart']);
    });
    
    // Calculate summary statistics
    $summary = [
        'totalWeeks' => count($weeks),
        'totalIncidents' => 0,
        'totalBatchEvents' => 0,
        'totalBatchPending' => 0,
        'totalSupportMA' => 0,
        'totalSupportDev' => 0,
        'totalUpdatesAlert' => 0,
        'totalUpdatesHandover' => 0,
        'totalUpdatesOther' => 0,
        'totalImprovements' => 0,
        'totalProjects' => 0,
        'incidentsBySeverity' => ['1' => 0, '2' => 0, '3' => 0],
        'incidentsDetectedBySM' => 0,
        'incidentsNotDetected' => 0
    ];
    
    foreach ($weeks as $week) {
        $data = $week['data'];
        
        // Incidents
        $incidents = $data['incidents'] ?? [];
        $summary['totalIncidents'] += count($incidents);
        
        foreach ($incidents as $inc) {
            $sev = $inc['severity'] ?? '3';
            if (isset($summary['incidentsBySeverity'][$sev])) {
                $summary['incidentsBySeverity'][$sev]++;
            }
            
            if (($inc['detected'] ?? 'N') === 'Y') {
                $summary['incidentsDetectedBySM']++;
            } else {
                $summary['incidentsNotDetected']++;
            }
        }
        
        // Batch
        $summary['totalBatchEvents'] += count($data['batch']['event'] ?? []);
        $summary['totalBatchPending'] += count($data['batch']['pending'] ?? []);
        
        // Support
        $summary['totalSupportMA'] += count($data['support']['ma'] ?? []);
        $summary['totalSupportDev'] += count($data['support']['dev'] ?? []);
        
        // Updates
        $summary['totalUpdatesAlert'] += count($data['updates']['alert'] ?? []);
        $summary['totalUpdatesHandover'] += count($data['updates']['handover'] ?? []);
        $summary['totalUpdatesOther'] += count($data['updates']['other'] ?? []);
        
        // Improvements
        $summary['totalImprovements'] += count($data['improvements']['improve'] ?? []);
        $summary['totalProjects'] += count($data['improvements']['project'] ?? []);
    }
    
    // Calculate detection rate
    $totalIncidents = $summary['totalIncidents'];
    $summary['detectionRate'] = $totalIncidents > 0 
        ? round(($summary['incidentsDetectedBySM'] / $totalIncidents) * 100, 2) 
        : 0;
    
    echo json_encode([
        'ok' => true,
        'data' => [
            'type' => $type,
            'year' => $year,
            'month' => $type === 'monthly' ? $month : null,
            'weeks' => $weeks,
            'summary' => $summary
        ]
    ]);
    
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'error' => $e->getMessage()
    ]);
}
