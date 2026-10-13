<?php
/**
 * Analytics Cleanup API
 * Clean up old analytics data
 */

require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/AnalyticsTracker.php';
require_once __DIR__ . '/../logging/LogRotator.php';

$payload = requireAuth();
requireCsrf();
requireRole($payload, ADMIN_ROLES);

$tracker = new AnalyticsTracker();
$rotator = new LogRotator();

$analyticsDeleted = $tracker->cleanupOldEvents();
$logsDeleted = $rotator->cleanupOldLogs();

logActivity('cleanup_completed', [
    'analytics_deleted' => $analyticsDeleted,
    'logs_deleted' => $logsDeleted,
], $payload['sub'], $payload['name']);

respondOk([
    'analytics_deleted' => $analyticsDeleted,
    'logs_deleted' => $logsDeleted,
], 'Cleanup completed');
