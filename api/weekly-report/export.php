<?php
/**
 * Export week data to CSV or JSON
 * GET /api/weekly-report/export.php?week=week-2026-04-22&format=csv
 * GET /api/weekly-report/export.php?type=monthly&year=2026&month=04&format=csv
 */

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

$dataDir = '../../data/weekly-report/';

$format = $_GET['format'] ?? 'json';
$week = $_GET['week'] ?? '';
$type = $_GET['type'] ?? '';
$year = $_GET['year'] ?? date('Y');
$month = $_GET['month'] ?? date('m');

try {
    $data = [];
    
    // Single week export
    if (!empty($week)) {
        if (!preg_match('/^week-\d{4}-\d{2}-\d{2}$/', $week)) {
            throw new Exception('Invalid week format');
        }
        
        $filename = $dataDir . $week . '.json';
        
        if (!file_exists($filename)) {
            throw new Exception('Week data not found');
        }
        
        $content = file_get_contents($filename);
        $weekData = json_decode($content, true);
        
        if (!$weekData) {
            throw new Exception('Invalid week data');
        }
        
        $data = [$weekData];
        $exportName = $week;
    }
    // Multiple weeks export (monthly/yearly)
    else if (!empty($type)) {
        $files = glob($dataDir . 'week-*.json');
        
        if ($files === false) {
            throw new Exception('Failed to read directory');
        }
        
        foreach ($files as $file) {
            $basename = basename($file, '.json');
            $dateStr = str_replace('week-', '', $basename);
            
            $weekDate = DateTime::createFromFormat('Y-m-d', $dateStr);
            if (!$weekDate) continue;
            
            if ($type === 'monthly') {
                if ($weekDate->format('Y') != $year || $weekDate->format('m') != $month) {
                    continue;
                }
            } elseif ($type === 'yearly') {
                if ($weekDate->format('Y') != $year) {
                    continue;
                }
            }
            
            $content = file_get_contents($file);
            $weekData = json_decode($content, true);
            
            if ($weekData) {
                $data[] = $weekData;
            }
        }
        
        $exportName = $type === 'monthly' ? "report-{$year}-{$month}" : "report-{$year}";
    } else {
        throw new Exception('Missing required parameters');
    }
    
    if (empty($data)) {
        throw new Exception('No data to export');
    }
    
    // Export as JSON
    if ($format === 'json') {
        header('Content-Type: application/json');
        header('Content-Disposition: attachment; filename="' . $exportName . '.json"');
        echo json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
        exit;
    }
    
    // Export as CSV
    if ($format === 'csv') {
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="' . $exportName . '.csv"');
        
        $output = fopen('php://output', 'w');
        
        // BOM for UTF-8
        fprintf($output, chr(0xEF).chr(0xBB).chr(0xBF));
        
        // Headers
        fputcsv($output, [
            'Week',
            'Section',
            'Sub-Type',
            'Ticket ID',
            'Title/Name',
            'Description',
            'Severity',
            'Status',
            'Detected',
            'Owner',
            'Date',
            'URL'
        ]);
        
        // Data rows
        foreach ($data as $weekData) {
            $weekStart = $weekData['weekStart'] ?? '';
            
            // Incidents
            foreach ($weekData['incidents'] ?? [] as $item) {
                fputcsv($output, [
                    $weekStart,
                    'Incidents',
                    '',
                    $item['ticketId'] ?? '',
                    $item['title'] ?? '',
                    '',
                    $item['severity'] ?? '',
                    '',
                    $item['detected'] ?? '',
                    '',
                    $item['date'] ?? '',
                    $item['ticketUrl'] ?? ''
                ]);
            }
            
            // Batch
            foreach ($weekData['batch']['event'] ?? [] as $item) {
                fputcsv($output, [
                    $weekStart,
                    'Batch',
                    'Event',
                    '',
                    $item['name'] ?? '',
                    $item['desc'] ?? '',
                    '',
                    $item['status'] ?? '',
                    '',
                    '',
                    $item['date'] ?? '',
                    $item['url'] ?? ''
                ]);
            }
            
            foreach ($weekData['batch']['pending'] ?? [] as $item) {
                fputcsv($output, [
                    $weekStart,
                    'Batch',
                    'Pending',
                    '',
                    $item['name'] ?? '',
                    $item['desc'] ?? '',
                    '',
                    $item['status'] ?? '',
                    '',
                    '',
                    $item['date'] ?? '',
                    $item['url'] ?? ''
                ]);
            }
            
            // Support
            foreach ($weekData['support']['ma'] ?? [] as $item) {
                fputcsv($output, [
                    $weekStart,
                    'Support',
                    'MA',
                    $item['ticketId'] ?? '',
                    '',
                    $item['summary'] ?? '',
                    '',
                    $item['status'] ?? '',
                    '',
                    $item['owner'] ?? '',
                    '',
                    $item['ticketUrl'] ?? ''
                ]);
            }
            
            foreach ($weekData['support']['dev'] ?? [] as $item) {
                fputcsv($output, [
                    $weekStart,
                    'Support',
                    'Dev',
                    $item['ticketId'] ?? '',
                    '',
                    $item['summary'] ?? '',
                    '',
                    $item['status'] ?? '',
                    '',
                    $item['owner'] ?? '',
                    '',
                    $item['ticketUrl'] ?? ''
                ]);
            }
            
            // Updates
            foreach ($weekData['updates']['alert'] ?? [] as $item) {
                fputcsv($output, [
                    $weekStart,
                    'Updates',
                    'Alert',
                    $item['ticketId'] ?? '',
                    $item['name'] ?? '',
                    $item['desc'] ?? '',
                    '',
                    $item['status'] ?? '',
                    '',
                    '',
                    $item['date'] ?? '',
                    $item['url'] ?? ''
                ]);
            }
            
            foreach ($weekData['updates']['handover'] ?? [] as $item) {
                fputcsv($output, [
                    $weekStart,
                    'Updates',
                    'Handover',
                    $item['ticketId'] ?? '',
                    $item['name'] ?? '',
                    $item['desc'] ?? '',
                    '',
                    $item['status'] ?? '',
                    '',
                    '',
                    $item['date'] ?? '',
                    $item['url'] ?? ''
                ]);
            }
            
            foreach ($weekData['updates']['other'] ?? [] as $item) {
                fputcsv($output, [
                    $weekStart,
                    'Updates',
                    'Other',
                    $item['ticketId'] ?? '',
                    $item['name'] ?? '',
                    $item['desc'] ?? '',
                    '',
                    $item['status'] ?? '',
                    '',
                    '',
                    $item['date'] ?? '',
                    $item['url'] ?? ''
                ]);
            }
            
            // Improvements
            foreach ($weekData['improvements']['improve'] ?? [] as $item) {
                fputcsv($output, [
                    $weekStart,
                    'Improvements',
                    'Improve',
                    $item['ticketId'] ?? '',
                    $item['name'] ?? '',
                    $item['desc'] ?? '',
                    '',
                    $item['status'] ?? '',
                    '',
                    '',
                    '',
                    $item['url'] ?? ''
                ]);
            }
            
            foreach ($weekData['improvements']['project'] ?? [] as $item) {
                fputcsv($output, [
                    $weekStart,
                    'Improvements',
                    'Project',
                    $item['ticketId'] ?? '',
                    $item['name'] ?? '',
                    $item['desc'] ?? '',
                    '',
                    $item['status'] ?? '',
                    '',
                    '',
                    '',
                    $item['url'] ?? ''
                ]);
            }
        }
        
        fclose($output);
        exit;
    }
    
    throw new Exception('Invalid format. Use json or csv');
    
} catch (Exception $e) {
    header('Content-Type: application/json');
    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'error' => $e->getMessage()
    ]);
}
