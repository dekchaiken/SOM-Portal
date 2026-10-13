<?php
/**
 * GET /api/service-inventory/index.php
 *
 * Returns the full parsed inventory (all rows + all columns) + file metadata
 * for admin/service-inventory.html. Read is open to all staff since the CSV
 * is SM-shared (curated by SM, viewed by every team). Writes are locked
 * down in upload.php / restore.php with requireSmForShared() + admin role.
 *
 * Optional filters:
 *   ?q=<substring>   — case-insensitive filter on service/bu/team
 *   ?runway=<val>    — exact-match on the Runway column (EKS/OCP/…)
 *   ?limit=<n>       — cap rows returned (default 5000, hard max 10000)
 */
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/../service-performance/_lib.php';

$payload = requireAuth();
requireRole($payload, ALL_STAFF_ROLES);

if ($_SERVER['REQUEST_METHOD'] !== 'GET') respondError('Method not allowed', 405);

$q      = trim((string)($_GET['q']      ?? ''));
$runway = trim((string)($_GET['runway'] ?? ''));
$limit  = min(10000, max(1, (int)($_GET['limit'] ?? 5000)));

$inv  = spLoadServiceInventory();
$rows = array_values($inv);

if ($q !== '') {
    $qL = strtolower($q);
    $rows = array_values(array_filter($rows, function($r) use ($qL) {
        return str_contains(strtolower($r['service'] ?? ''), $qL)
            || str_contains(strtolower($r['bu']      ?? ''), $qL)
            || str_contains(strtolower($r['team']    ?? ''), $qL);
    }));
}
if ($runway !== '') {
    $rows = array_values(array_filter($rows, fn($r) => strcasecmp($r['runway'] ?? '', $runway) === 0));
}

$total = count($rows);
$rows  = array_slice($rows, 0, $limit);

respondOk([
    'rows'  => $rows,
    'total' => $total,
    'meta'  => spInventoryMeta(),
]);
