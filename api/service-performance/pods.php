<?php
/**
 * GET /api/service-performance/pods.php?runway=<slug>&namespace=<ns>&service=<workload>
 *
 * Lazy-loaded per-pod detail for the drawer. Fires only when a user clicks a
 * service row — much cheaper on Thanos than pulling every pod's data upfront
 * because the query is scoped to `pod=~"<service>-.*"`.
 *
 * Also cached (30s) per (runway/ns/service) key so repeated opens of the same
 * drawer within half a minute don't re-hit Grafana.
 */
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/_lib.php';

ini_set('memory_limit', '256M');
set_time_limit(60);
register_shutdown_function(function() {
    $err = error_get_last();
    if ($err && in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR], true)) {
        if (!headers_sent()) { http_response_code(500); header('Content-Type: application/json'); }
        echo json_encode(['success' => false, 'message' => 'PHP fatal: ' . $err['message'] . ' @ ' . basename($err['file']) . ':' . $err['line']]);
    }
});

$payload = requireAuth();
requireRole($payload, ALL_STAFF_ROLES);

if ($_SERVER['REQUEST_METHOD'] !== 'GET') respondError('Method not allowed', 405);

$runwaySlug = trim((string)($_GET['runway']    ?? ''));
$namespace  = trim((string)($_GET['namespace'] ?? ''));
$service    = trim((string)($_GET['service']   ?? ''));

if ($runwaySlug === '' || $service === '') respondError('runway and service are required', 400);
// namespace can be empty for appScope scheme

// Guard the inputs — only allow k8s-safe characters so a hostile client can't
// smuggle PromQL selectors through the query string.
foreach (['namespace' => $namespace, 'service' => $service, 'runway' => $runwaySlug] as $k => $v) {
    if ($v !== '' && !preg_match('/^[a-z0-9._-]+$/i', $v)) {
        respondError("invalid characters in {$k}", 400);
    }
}

$cfg = spLoadConfig();
$src = null;
foreach ($cfg['sources'] as $s) {
    if (($s['slug'] ?? '') === $runwaySlug && ($s['enabled'] ?? true) !== false) { $src = $s; break; }
}
if (!$src) respondError("Unknown or disabled runway '{$runwaySlug}'", 404);

// ── Cache (30s) ──────────────────────────────────────────────────────────────
$cacheKey  = $runwaySlug . '_' . ($namespace ?: '_') . '_' . $service;
$cachePath = teamDataPath('service-performance/cache/pod-detail/' . preg_replace('/[^a-z0-9._-]+/i', '_', $cacheKey) . '.json');
$cacheTtl  = 30;

if (file_exists($cachePath) && (time() - (int)filemtime($cachePath)) <= $cacheTtl) {
    $cached = json_decode((string)file_get_contents($cachePath), true);
    if (is_array($cached)) {
        $cached['fromCache'] = true;
        respondOk($cached);
    }
}

$result = spFetchWorkloadPods($src, $namespace, $service);
$payload = [
    'runway'    => $runwaySlug,
    'namespace' => $namespace,
    'service'   => $service,
    'pods'      => $result['pods'],
    'error'     => $result['error'],
    'fetchedAt' => date('c'),
    'fromCache' => false,
];

$dir = dirname($cachePath);
if (!is_dir($dir)) @mkdir($dir, 0775, true);
@file_put_contents($cachePath, json_encode($payload));

respondOk($payload);
