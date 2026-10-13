<?php
/**
 * GET /api/service-performance/suggestions.php?q=<query>&limit=20
 *
 * Autocomplete backend for the search box. Reads ONLY from the Service
 * Inventory CSV (no Grafana calls) so it responds in <10ms even for
 * broad prefixes. The client picks a suggestion → then detail.php does
 * the one Grafana query needed to render that specific service.
 *
 * Match strategy (prefix first, then substring) so typing "aml" surfaces
 * services starting with aml before ones that merely contain it.
 */
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/_lib.php';

$payload = requireAuth();
requireRole($payload, ALL_STAFF_ROLES);

if ($_SERVER['REQUEST_METHOD'] !== 'GET') respondError('Method not allowed', 405);

$q     = trim((string)($_GET['q']     ?? ''));
$limit = min(50, max(1, (int)($_GET['limit'] ?? 20)));

// Compact debug snapshot so any "0 inventory" state can be diagnosed straight
// from the browser devtools response body — no need to poke server logs.
$__dbg = (function() {
    $cfg   = spLoadConfig();
    $rel   = (string)($cfg['serviceInventoryCsvPath'] ?? '');
    $abs   = $rel === '' ? '' : ($rel[0] === '/' ? $rel : dirname(__DIR__, 2) . '/' . $rel);
    return [
        'configRel'      => $rel,
        'configAbsPath'  => $abs,
        'fileExists'     => $abs !== '' && file_exists($abs),
        'fileReadable'   => $abs !== '' && is_readable($abs),
        'phpUser'        => function_exists('posix_getpwuid') ? (posix_getpwuid(posix_geteuid())['name'] ?? '?') : '?',
        'openBasedir'    => ini_get('open_basedir') ?: null,
    ];
})();

$inv = spLoadServiceInventory();

// Also merge in services from cached runway snapshots. These snapshots are
// already written by SP2's dashboard fetch (60s TTL) so we're piggybacking
// on existing data — no extra Grafana calls. This surfaces services that
// Grafana knows about but that admin hasn't added to the CSV inventory yet.
$snapExtra = (function() use ($inv): array {
    $cfg   = spLoadConfig();
    $extra = [];   // lowercased name → suggestion row
    foreach (($cfg['sources'] ?? []) as $src) {
        $slug = (string)($src['slug'] ?? '');
        if ($slug === '') continue;
        $snap = spReadCache($slug, PHP_INT_MAX);   // stale is fine, we just want names
        if (!$snap || !is_array($snap['services'] ?? null)) continue;
        foreach ($snap['services'] as $s) {
            $name = (string)($s['service'] ?? '');
            if ($name === '') continue;
            $k = strtolower($name);
            if (isset($inv[$k]) || isset($extra[$k])) continue;   // inventory & first-seen win
            $extra[$k] = [
                'service' => $name,
                'runway'  => (string)($src['slug'] ?? ''),
                'source'  => 'grafana',   // frontend badge marker
            ];
        }
    }
    return $extra;
})();

if (!$inv && !$snapExtra) {
    respondOk(['query' => $q, 'suggestions' => [], 'inventoryCount' => 0, 'debug' => $__dbg]);
}

// Empty query = return the first N entries alphabetically. Inventory rows
// come first (they carry richer metadata), then snapshot extras fill any gap.
if ($q === '') {
    $out = [];
    if ($inv) {
        $names = array_keys($inv);
        sort($names);
        foreach (array_slice($names, 0, $limit) as $k) $out[] = $inv[$k];
    }
    if (count($out) < $limit && $snapExtra) {
        $extraKeys = array_keys($snapExtra);
        sort($extraKeys);
        foreach (array_slice($extraKeys, 0, $limit - count($out)) as $k) $out[] = $snapExtra[$k];
    }
    respondOk(['query' => $q, 'suggestions' => $out, 'inventoryCount' => count($inv), 'grafanaOnlyCount' => count($snapExtra)]);
}

$qLower = strtolower($q);
$prefix = [];
$substr = [];
foreach ($inv as $k => $row) {
    if ($k === $qLower)              array_unshift($prefix, $row);   // exact match first
    elseif (str_starts_with($k, $qLower)) $prefix[] = $row;
    elseif (str_contains($k, $qLower))    $substr[] = $row;
    if (count($prefix) + count($substr) >= $limit * 2) break;         // cap scanning cost
}

// Same match strategy against snapshot-only services (appended after inventory
// hits so curated entries always rank higher).
$prefixX = [];
$substrX = [];
foreach ($snapExtra as $k => $row) {
    if ($k === $qLower)              array_unshift($prefixX, $row);
    elseif (str_starts_with($k, $qLower)) $prefixX[] = $row;
    elseif (str_contains($k, $qLower))    $substrX[] = $row;
    if (count($prefixX) + count($substrX) >= $limit * 2) break;
}

$out = array_slice(array_merge($prefix, $substr, $prefixX, $substrX), 0, $limit);
respondOk([
    'query'            => $q,
    'suggestions'      => $out,
    'inventoryCount'   => count($inv),
    'grafanaOnlyCount' => count($snapExtra),
    'debug'            => $__dbg,
]);
