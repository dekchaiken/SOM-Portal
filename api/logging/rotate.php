<?php
/**
 * Log Rotation API
 * Manually trigger log rotation
 */

require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/LogRotator.php';

$payload = requireAuth();
requireCsrf();
requireRole($payload, ADMIN_ROLES);

$rotator = new LogRotator();

// Rotate all logs
$rotated = [];
$logs = ['activity.json', 'security.json'];

foreach ($logs as $log) {
    if ($rotator->rotateIfNeeded($log)) {
        $rotated[] = $log;
    }
}

logActivity('logs_rotated', ['rotated' => $rotated], $payload['sub'], $payload['name']);

respondOk([
    'rotated' => $rotated,
    'count' => count($rotated),
], 'Log rotation completed');
