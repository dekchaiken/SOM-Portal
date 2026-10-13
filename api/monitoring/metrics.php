<?php
/**
 * Metrics Endpoint
 * 
 * Returns performance metrics in Prometheus format
 * Requires admin authentication
 */

require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/PerformanceMonitor.php';

$payload = requireAuth();
requireRole($payload, ADMIN_ROLES);

$monitor = PerformanceMonitor::getInstance();

header('Content-Type: text/plain; charset=utf-8');
echo $monitor->getMetrics();
