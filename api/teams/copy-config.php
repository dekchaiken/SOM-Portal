<?php
/**
 * teams/copy-config.php
 * POST → seed a team's config files for a given feature by copying from SM.
 *
 * Request body: { team_slug: "ss", feature: "ma-services", overwrite?: bool }
 *
 * Used by super-team-permissions.html — lets super_admin choose whether a
 * newly-granted feature starts with empty files (the default provisioning
 * behaviour) or a snapshot copy of SM's current config for that feature.
 * Copies are one-time; the target team can edit independently afterward.
 *
 * Auth: super_admin only. CSRF-protected.
 */
require_once __DIR__ . '/../helpers.php';

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') respondError('POST required', 405);

$payload = requireAuth();
requireRole($payload, ['super_admin']);
requireCsrf();

$body       = getBody();
$targetSlug = trim((string)($body['team_slug'] ?? ''));
$featureKey = trim((string)($body['feature']   ?? ''));
$overwrite  = !empty($body['overwrite']);

if (!preg_match('/^[a-z0-9_-]+$/', $targetSlug)) respondError('Invalid team slug');
if ($targetSlug === 'sm')                        respondError('SM is the source team — nothing to copy');

// File map comes from featureDataFiles() in helpers.php — canonical source of
// truth shared with _provisionFeatureFiles() in /api/teams/index.php.
$FEATURE_FILES = featureDataFiles();

$files = $FEATURE_FILES[$featureKey] ?? null;
if ($files === null) respondError("Unknown feature: {$featureKey}");
if (!count($files))  respondOk(['copied' => [], 'skipped' => []], 'Feature has no config files (nothing to copy)');

$srcDir = DATA_DIR . 'sm/';
$dstDir = DATA_DIR . $targetSlug . '/';
if (!is_dir($dstDir) && !@mkdir($dstDir, 0755, true)) {
    respondError('Failed to create team data directory', 500);
}

$copied  = [];
$skipped = [];
foreach ($files as $file) {
    $src = $srcDir . $file;
    $dst = $dstDir . $file;
    if (!file_exists($src)) { $skipped[] = ['file' => $file, 'reason' => 'source_missing']; continue; }

    // If destination already has non-trivial content and we weren't asked to
    // overwrite, skip — protects against accidental data loss on re-copy.
    if (!$overwrite && file_exists($dst)) {
        $existing = json_decode(@file_get_contents($dst), true);
        $hasData = is_array($existing) && !empty($existing);
        if ($hasData) { $skipped[] = ['file' => $file, 'reason' => 'dst_not_empty']; continue; }
    }

    if (!@copy($src, $dst)) { $skipped[] = ['file' => $file, 'reason' => 'copy_failed']; continue; }
    $copied[] = $file;
}

logActivity('feature_config_copied', [
    'target_team' => $targetSlug,
    'feature'     => $featureKey,
    'copied'      => $copied,
    'skipped'     => array_map(fn($s) => $s['file'], $skipped),
    'overwrite'   => $overwrite,
], $payload['sub'], $payload['name'] ?? '');

respondOk([
    'copied'  => $copied,
    'skipped' => $skipped,
    'feature' => $featureKey,
    'team'    => $targetSlug,
], 'Config copy complete');
