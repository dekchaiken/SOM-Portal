<?php
/**
 * Import Cut-off Services from sm-ma SQLite database
 * Run this once to import data
 */

$dbPath = '/Users/warapon.lea/Downloads/otherteam/sm-ma/ma_services.db';
$jsonPath = __DIR__ . '/../../data/cutoff-services.json';

try {
    // Connect to SQLite
    $db = new SQLite3($dbPath);
    
    // Query all cutoff services
    $result = $db->query('SELECT * FROM cutoff_services ORDER BY id ASC');
    
    $cutoffs = [];
    $id = 1;
    
    while ($row = $result->fetchArray(SQLITE3_ASSOC)) {
        $cutoffs[] = [
            'id' => $id++,
            'site_type' => $row['site_type'] ?? '',
            'service_name' => $row['service_name'] ?? '',
            'bank_name' => $row['bank_name'] ?? '',
            'comcode' => $row['comcode'] ?? '',
            'cutoff_time' => $row['cutoff_time'] ?? '',
            'cutoff_day' => $row['cutoff_day'] ?? '',
            'service_group' => $row['service_group'] ?? '',
            'channel' => $row['channel'] ?? '',
            'ma_page' => $row['ma_page'] ?? '',
            'tmn_certificate' => $row['tmn_certificate'] ?? '',
            'bank_certificate' => $row['bank_certificate'] ?? '',
            'remark' => $row['remark'] ?? '',
            'created_at' => $row['created_at'] ?? date('Y-m-d H:i:s'),
            'updated_at' => $row['updated_at'] ?? date('Y-m-d H:i:s')
        ];
    }
    
    $db->close();
    
    // Save to JSON
    $data = [
        'cutoffs' => $cutoffs,
        'next_id' => count($cutoffs) + 1
    ];
    
    file_put_contents($jsonPath, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    
    echo "✅ Import successful!\n";
    echo "Total records: " . count($cutoffs) . "\n";
    echo "TMN: " . count(array_filter($cutoffs, fn($c) => $c['site_type'] === 'TMN')) . "\n";
    echo "Nano: " . count(array_filter($cutoffs, fn($c) => $c['site_type'] === 'Nano')) . "\n";
    echo "Bank: " . count(array_filter($cutoffs, fn($c) => $c['site_type'] === 'Bank')) . "\n";
    
} catch (Exception $e) {
    echo "❌ Error: " . $e->getMessage() . "\n";
}
