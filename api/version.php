<?php
// ═══════════════════════════════════════════════════════════════
//  version.php — Deploy-detection endpoint
//  ───────────────────────────────────────────────────────────────
//  Public (no auth) — clients poll this every ~90s to detect that
//  new JS/CSS/HTML has been deployed. If the returned `version`
//  hash differs from what the browser cached at page-load time,
//  the front-end shows a "reload for updates" toast.
//
//  Hash is derived from the mtime of core assets. Adding/updating
//  ANY tracked file (a bundle deploy) flips the hash.
// ═══════════════════════════════════════════════════════════════

// Always fresh (never cache the freshness-checker itself!)
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('Expires: 0');

$rootDir = dirname(__DIR__);

// Core assets — if any of these change, we consider it a "new deploy".
// Layouts + shared JS + shared CSS cover ~everything that would need
// a browser refresh. HTML pages themselves are covered by no-cache
// headers so they refresh naturally on next navigation.
$tracked = [
    'assets/js/theme.js',
    'assets/js/layout.js',
    'assets/js/api.js',
    'assets/js/auth.js',
    'assets/js/utils.js',
    'assets/js/skeletons.js',
    'assets/js/analytics.js',
    'assets/js/analytics-features.js',
    'assets/js/maintenance.js',
    'assets/css/style.css',
    'assets/css/dark.css',
    'assets/css/ui-themes.css',
];

$parts  = [];
$latest = 0;
foreach ($tracked as $rel) {
    $abs = $rootDir . '/' . $rel;
    if (is_file($abs)) {
        $mt      = filemtime($abs);
        $parts[] = $rel . ':' . $mt;
        if ($mt > $latest) $latest = $mt;
    }
}

// Short hash (12 chars) is plenty for change detection
$version = substr(sha1(implode('|', $parts)), 0, 12);

echo json_encode([
    'ok'         => true,
    'version'    => $version,
    'updated_at' => $latest,
    'file_count' => count($parts),
]);
