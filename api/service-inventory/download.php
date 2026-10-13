<?php
/**
 * GET /api/service-inventory/download.php
 * → stream the CURRENT service-inventory.csv as an attachment.
 *
 * Any authenticated staff can download (SM-shared read-open pattern).
 */
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/../service-performance/_lib.php';

$payload = requireAuth();
requireRole($payload, ALL_STAFF_ROLES);

if ($_SERVER['REQUEST_METHOD'] !== 'GET') respondError('Method not allowed', 405);

$path = teamDataPath('service-inventory.csv');
if (!file_exists($path)) respondError('inventory not found', 404);

$stamp = date('Ymd');
header('Content-Type: text/csv; charset=utf-8');
header('Content-Disposition: attachment; filename="service-inventory-' . $stamp . '.csv"');
header('Content-Length: ' . filesize($path));
readfile($path);
