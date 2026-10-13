<?php
/**
 * Health Check Endpoint
 * 
 * Returns system health status
 * Checks:
 * - Filesystem (writable)
 * - Cache availability
 * - Disk space
 * - Memory usage
 */

require_once __DIR__ . '/../config.php';

$checks = [];
$overallStatus = 'healthy';

// Check filesystem
$dataDir = DATA_DIR;
$checks['filesystem'] = [
    'status' => 'ok',
    'writable' => is_writable($dataDir),
];

if (!$checks['filesystem']['writable']) {
    $checks['filesystem']['status'] = 'error';
    $overallStatus = 'unhealthy';
}

// Check cache
$apcuAvailable = extension_loaded('apcu') && ini_get('apc.enabled');
$checks['cache'] = [
    'status' => 'ok',
    'type' => $apcuAvailable ? 'apcu' : 'file',
    'available' => true,
];

// Check disk space
$diskFree = disk_free_space($dataDir);
$diskTotal = disk_total_space($dataDir);
$diskUsagePercent = (($diskTotal - $diskFree) / $diskTotal) * 100;

$checks['disk_space'] = [
    'status' => 'ok',
    'free_gb' => round($diskFree / 1024 / 1024 / 1024, 2),
    'total_gb' => round($diskTotal / 1024 / 1024 / 1024, 2),
    'usage_percent' => round($diskUsagePercent, 2),
];

if ($diskUsagePercent > 90) {
    $checks['disk_space']['status'] = 'warning';
    $overallStatus = 'degraded';
}

if ($diskUsagePercent > 95) {
    $checks['disk_space']['status'] = 'error';
    $overallStatus = 'unhealthy';
}

// Check memory
$memoryUsage = memory_get_usage(true);
$memoryLimit = ini_get('memory_limit');

// Parse memory limit
function parseMemoryLimit($limit) {
    if ($limit === '-1') return PHP_INT_MAX;
    $limit = trim($limit);
    $last = strtolower($limit[strlen($limit) - 1]);
    $value = (int)$limit;
    
    switch ($last) {
        case 'g': $value *= 1024;
        case 'm': $value *= 1024;
        case 'k': $value *= 1024;
    }
    
    return $value;
}

$memoryLimitBytes = parseMemoryLimit($memoryLimit);

$checks['memory'] = [
    'status' => 'ok',
    'usage_mb' => round($memoryUsage / 1024 / 1024, 2),
    'limit_mb' => $memoryLimitBytes === PHP_INT_MAX ? 'unlimited' : round($memoryLimitBytes / 1024 / 1024, 2),
];

if ($memoryLimitBytes !== PHP_INT_MAX && $memoryUsage > $memoryLimitBytes * 0.9) {
    $checks['memory']['status'] = 'warning';
    $overallStatus = 'degraded';
}

// Response
header('Content-Type: application/json; charset=utf-8');
http_response_code($overallStatus === 'healthy' ? 200 : 503);

echo json_encode([
    'status' => $overallStatus,
    'timestamp' => date('c'),
    'checks' => $checks,
], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);

