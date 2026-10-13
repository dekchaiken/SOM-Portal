<?php
/**
 * GET /api/downstream-health/services.php[?q=<prefix>]
 *
 * Autocomplete source: enumerate every `app_name` label value emitting
 * http_client_requests_seconds_count across all configured JVM sources.
 * With `q`, returns only entries whose name contains `q` (case-insensitive).
 *
 * SM-only — same gate as Begin Grafana. Cached under DH_SERVICES_TTL so
 * we don't hammer Thanos on every keystroke.
 */
require_once __DIR__ . '/_lib.php';

ini_set('memory_limit', '256M');
set_time_limit(60);

$payload = requireAuth();
requireSmTeamOnly('Downstream Health');
if ($_SERVER['REQUEST_METHOD'] !== 'GET') respondError('Method not allowed', 405);

$q = strtolower(trim((string)($_GET['q'] ?? '')));

try {
    $data = dhListServices();
} catch (Throwable $e) {
    respondError('Discovery failed: ' . $e->getMessage(), 500);
}

$services = $data['services'] ?? [];
if ($q !== '') {
    $services = array_values(array_filter($services, function($s) use ($q) {
        return strpos(strtolower((string)$s['service']), $q) !== false;
    }));
}

// Cap client-side rendering to something sane; full list stays cached.
$services = array_slice($services, 0, 200);

respondOk([
    'services'   => $services,
    'query'      => $q,
    'fromCache'  => !empty($data['fromCache']),
    'cacheAge'   => $data['_cacheAgeSeconds'] ?? 0,
    'fetchedAt'  => $data['fetchedAt'] ?? date('c'),
    'totalCount' => count($data['services'] ?? []),
]);
