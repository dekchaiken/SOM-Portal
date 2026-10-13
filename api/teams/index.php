<?php
// ─── Teams API ────────────────────────────────────────────────────────────────
// GET    /api/teams/     → list teams (all users can call; sm_admin sees own team only)
// POST   /api/teams/     → create team (super_admin only)
// PATCH  /api/teams/?id= → update team name/color/description (super_admin only)
// DELETE /api/teams/?id= → deactivate team (super_admin only; soft-delete)
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];

// initTeamDirectory() now lives in helpers.php (shared, CLI-safe) alongside
// _provisionFeatureFiles() and featureDataFiles() — the canonical scaffolding
// entry point used both by team creation and by the backfill migration script.

// ─── GET — list teams ─────────────────────────────────────────────────────────
if ($method === 'GET') {
    $teams = readJson('teams.json'); // global

    // Global-read roles (super_admin, super_viewer) see all teams — they need
    // the full list to populate the "view-as" team switcher.
    if (!in_array($payload['role'], ['super_admin', 'super_viewer'], true)) {
        // Regular users see only their own team
        $myTeam = $payload['team'] ?? null;
        $teams  = array_values(array_filter($teams, fn($t) => $t['slug'] === $myTeam));
    }

    respondOk($teams);
}

// ─── POST — create team (super_admin only) ────────────────────────────────────
if ($method === 'POST') {
    requireCsrf();
    requireRole($payload, ['super_admin']);

    $body = getBody();
    $slug = strtolower(trim($body['slug'] ?? ''));
    $name = trim($body['name'] ?? '');

    if (!$slug)                                     respondError('slug is required');
    if (!preg_match('/^[a-z0-9_-]+$/', $slug))     respondError('slug must be lowercase alphanumeric/dash/underscore');
    if (strlen($slug) > 32)                         respondError('slug max 32 chars');
    if (!$name)                                     respondError('name is required');

    // Ensure slug is unique
    $teams = readJson('teams.json');
    foreach ($teams as $t) {
        if (($t['slug'] ?? '') === $slug) respondError("Team slug '{$slug}' already exists", 409);
    }

    // Scaffold directory
    initTeamDirectory($slug);

    $team = [
        'id'          => genId('tm'),
        'slug'        => $slug,
        'name'        => $name,
        'description' => trim($body['description'] ?? ''),
        'color'       => $body['color'] ?? '#6366F1',
        'features'    => [
            'dashboard', 'board', 'team-docs', 'sabai', 'schedule', 'learning',
        ],
        'active'      => true,
        'created_at'  => date('c'),
        'created_by'  => $payload['sub'],
    ];

    $teams[] = $team;
    writeJson('teams.json', $teams); // global

    logActivity('team_created', ['slug' => $slug, 'name' => $name], $payload['sub'], $payload['name'] ?? '');
    respondOk($team, "Team '{$name}' created");
}

// ─── PATCH — update team metadata + features (super_admin only) ───────────────
if ($method === 'PATCH') {
    requireCsrf();
    requireRole($payload, ['super_admin']);

    $id   = $_GET['id'] ?? '';
    $body = getBody();
    if (!$id) respondError('Team ID required');

    $teams    = readJson('teams.json');
    $found    = false;
    $teamSlug = null;
    foreach ($teams as &$t) {
        if ($t['id'] !== $id) continue;
        if (isset($body['name']))         $t['name']         = trim($body['name']);
        if (isset($body['description']))  $t['description']  = trim($body['description']);
        if (isset($body['color']))        $t['color']        = $body['color'];
        if (isset($body['active']))       $t['active']       = (bool)$body['active'];

        // ── Feature access updates (super_admin grant/revoke) ────────────────
        if (isset($body['features']) && is_array($body['features'])) {
            $oldFeatures = $t['features'] ?? [];
            $newFeatures = array_values(array_unique($body['features']));
            $added       = array_diff($newFeatures, $oldFeatures);
            $t['features'] = $newFeatures;
            $teamSlug = $t['slug'];
            foreach ($added as $fk) {
                _provisionFeatureFiles($fk, $t['slug']);
            }
        }
        if (isset($body['feature_pages']) && is_array($body['feature_pages'])) {
            // Force object so JSON serializes as {} not [] when empty
            // (otherwise the frontend receives an array and JSON.stringify drops
            // any string-keyed grants added later — losing page grants on save).
            $t['feature_pages'] = empty($body['feature_pages'])
                ? new stdClass()
                : $body['feature_pages'];
        }
        // ── Page access modes (read vs full per page) ────────────────────────
        if (isset($body['page_modes'])) {
            $pm = is_array($body['page_modes']) ? $body['page_modes'] : [];
            $t['page_modes'] = empty($pm) ? new stdClass() : $pm;
        }

        $found = true;
        break;
    }
    unset($t);

    if (!$found) respondError('Team not found', 404);
    writeJson('teams.json', $teams);
    logActivity('team_permissions_updated', [
        'team_id' => $id,
        'fields'  => array_keys($body),
    ], $payload['sub'], $payload['name'] ?? '');
    respondOk(null, 'Team updated');
}

// _provisionFeatureFiles() now lives in helpers.php (shared, testable from CLI)
// alongside featureDataFiles() — the canonical map both this file and
// /api/teams/copy-config.php read from.

// ─── DELETE — deactivate (soft) OR hard-delete team (super_admin only) ─────────
// ?force=true → permanently remove from teams.json (no recovery)
if ($method === 'DELETE') {
    requireCsrf();
    requireRole($payload, ['super_admin']);

    $id    = $_GET['id'] ?? '';
    $force = filter_var($_GET['force'] ?? false, FILTER_VALIDATE_BOOLEAN);
    if (!$id) respondError('Team ID required');

    $teams = readJson('teams.json');
    $found = false;
    $slug  = null;

    if ($force) {
        // Hard delete — remove entirely
        $filtered = array_values(array_filter($teams, function ($t) use ($id, &$found, &$slug) {
            if ($t['id'] === $id) {
                $found = true;
                $slug  = $t['slug'];
                return false;
            }
            return true;
        }));
        if (!$found) respondError('Team not found', 404);

        // Safety: prevent deleting SM team (primary team) via hard delete
        if ($slug === 'sm') respondError('Cannot hard-delete the primary SM team', 403);

        writeJson('teams.json', $filtered);
        logActivity('team_deleted', ['team_id' => $id, 'slug' => $slug], $payload['sub'], $payload['name'] ?? '');
        respondOk(null, "Team '{$slug}' permanently deleted");
    } else {
        // Soft delete — set active=false
        foreach ($teams as &$t) {
            if ($t['id'] !== $id) continue;
            $t['active'] = false;
            $found = true;
            $slug  = $t['slug'];
            break;
        }
        unset($t);
        if (!$found) respondError('Team not found', 404);
        writeJson('teams.json', $teams);
        logActivity('team_deactivated', ['team_id' => $id, 'slug' => $slug], $payload['sub'], $payload['name'] ?? '');
        respondOk(null, 'Team deactivated');
    }
}

respondError('Method not allowed', 405);
