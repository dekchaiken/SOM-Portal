<?php
/**
 * POST /api/service-performance/refresh.php[?runway=<slug>|all]
 *
 * Force re-fetch of one runway (or all). Bypasses the 60s cache and rewrites
 * the snapshot file. Rate-limited so a browser can't hammer Grafana.
 *
 * Auth: lead+ AND SM team (cache file is SM-shared — non-SM writes are 403).
 */
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/_lib.php';

ini_set('memory_limit', '512M');
set_time_limit(180);
register_shutdown_function(function() {
    $err = error_get_last();
    if ($err && in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR], true)) {
        if (!headers_sent()) { http_response_code(500); header('Content-Type: application/json'); }
        echo json_encode(['success' => false, 'message' => 'PHP fatal: ' . $err['message'] . ' @ ' . basename($err['file']) . ':' . $err['line']]);
    }
});

$payload = requireAuth();
requireRole($payload, LEAD_ROLES);
requireSmForShared();
requireCsrf();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') respondError('Method not allowed', 405);
apiRateLimit($payload['sub'] ?? 'anon', 'service-performance-refresh');

$cfg = spLoadConfig();
if (!$cfg['sources']) respondError('service-performance-sources.json is empty', 500);

$want = trim((string)($_GET['runway'] ?? 'all'));
$sources = array_values(array_filter($cfg['sources'], fn($s) => ($s['enabled'] ?? true) !== false));
if ($want !== '' && $want !== 'all') {
    $sources = array_values(array_filter($sources, fn($s) => ($s['slug'] ?? '') === $want));
    if (!$sources) respondError("Unknown or disabled runway '{$want}'", 404);
}

set_time_limit(90);
$results = [];
foreach ($sources as $src) {
    try {
        $snap = spGetSource($src, (int)$cfg['cacheTtlSeconds'], true);
        $results[] = ['slug' => $src['slug'], 'ok' => true, 'services' => $snap['totals']['services'] ?? 0, 'pods' => $snap['totals']['pods'] ?? 0];
    } catch (Throwable $e) {
        $results[] = ['slug' => $src['slug'], 'ok' => false, 'error' => $e->getMessage()];
    }
}

logActivity('service_performance_refresh', ['runway' => $want, 'count' => count($results)]);
respondOk(['results' => $results]);
