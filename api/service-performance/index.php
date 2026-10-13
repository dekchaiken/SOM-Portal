<?php
/**
 * GET /api/service-performance[?runway=all|<slug>]
 *
 * Returns cached CPU/MEM/Pod snapshots for the configured runways.
 * - Cache TTL comes from data/sm/service-performance-sources.json (default 60s).
 * - When a runway's cache is stale it's re-fetched inline; other runways continue
 *   to return their cached value so a single slow source can't stall the page.
 *
 * Auth: any authenticated staff. Non-SM teams still see SM's cache (SM-shared).
 */
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/_lib.php';

// Prometheus-heavy endpoint: raise the ceiling upfront (default 128M/30s can
// OOM/timeout on the first cold-fill when Thanos returns thousands of series,
// producing an empty 500 that clients see as "Network error").
ini_set('memory_limit', '512M');
set_time_limit(180);

// Last-resort guard: convert fatal errors into a JSON payload so the client
// at least gets an actionable message instead of an empty response body.
register_shutdown_function(function() {
    $err = error_get_last();
    if ($err && in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR], true)) {
        if (!headers_sent()) {
            http_response_code(500);
            header('Content-Type: application/json');
        }
        echo json_encode([
            'success' => false,
            'message' => 'PHP fatal: ' . $err['message'] . ' @ ' . basename($err['file']) . ':' . $err['line'],
        ]);
    }
});

$payload = requireAuth();
requireRole($payload, ALL_STAFF_ROLES);

if ($_SERVER['REQUEST_METHOD'] !== 'GET') respondError('Method not allowed', 405);

$cfg = spLoadConfig();
if (!$cfg['sources']) respondError('service-performance-sources.json is empty', 500);

$want = trim((string)($_GET['runway'] ?? 'all'));
$ttl  = (int)$cfg['cacheTtlSeconds'];

$sources = array_values(array_filter($cfg['sources'], fn($s) => ($s['enabled'] ?? true) !== false));
if ($want !== '' && $want !== 'all') {
    $sources = array_values(array_filter($sources, fn($s) => ($s['slug'] ?? '') === $want));
    if (!$sources) respondError("Unknown or disabled runway '{$want}'", 404);
}

// Default view = only services in the Service Inventory CSV. Client can pass
// ?showAll=1 to include everything (ephemeral job pods etc.) — this doesn't
// re-fetch, just doesn't apply the read-time filter.
$showAll = !empty($_GET['showAll']) || !empty($_GET['show_all']);

$results = [];
$hasInventory = false;
$totalUnfiltered = 0;   // service count before the inventory filter is applied
foreach ($sources as $src) {
    try {
        $snap = spGetSource($src, $ttl, false);
    } catch (Throwable $e) {
        $snap = array_merge(spSourcePublic($src), [
            'services' => [], 'totals' => ['services'=>0,'pods'=>0,'cpuHotspots'=>0,'memHotspots'=>0],
            'fetchedAt' => date('c'), 'error' => $e->getMessage(), 'fromCache' => false,
            'hasInventory' => false,
        ]);
    }
    $totalUnfiltered += (int)($snap['totals']['services'] ?? 0);
    if (!empty($snap['hasInventory'])) $hasInventory = true;
    $results[] = spApplyInventoryFilter($snap, $showAll);
}

// Debug snapshot — surfaced in the UI (and browser devtools) so ops can tell
// at a glance whether the CSV filter is active without digging in server logs.
$invLen = count(spLoadServiceInventory());
$invPath = (string)($cfg['serviceInventoryCsvPath'] ?? '');
if ($invPath !== '' && $invPath[0] !== '/') $invPath = dirname(__DIR__, 2) . '/' . $invPath;

respondOk([
    'runways'         => $results,
    'sheetEmbedUrl'   => $cfg['sheetEmbedUrl'],
    'sheetOpenUrl'    => (string)($cfg['sheetOpenUrl'] ?? $cfg['sheetEmbedUrl']),
    'cacheTtlSeconds' => $ttl,
    'sources'         => array_map('spSourcePublic', $cfg['sources']),
    'hasInventory'    => $hasInventory,
    'showAll'         => $showAll,
    'unfilteredTotal' => $totalUnfiltered,
    'debug' => [
        'inventoryEntries' => $invLen,
        'inventoryPath'    => $invPath,
        'inventoryReadable'=> $invPath !== '' && is_readable($invPath),
        'filterActive'     => $hasInventory && !$showAll,
    ],
]);
