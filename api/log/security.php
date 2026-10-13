<?php
/**
 * Security Logs API
 * Returns recent security events
 */

require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
requireRole($payload, ['super_admin']);

$limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 50;

$logs = readJson('logs/security.json');

// Limit results
if (count($logs) > $limit) {
    $logs = array_slice($logs, 0, $limit);
}

respondOk($logs, 'Security logs retrieved');
