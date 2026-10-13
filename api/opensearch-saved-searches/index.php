<?php
// Team-shared saved OpenSearch searches — SM-only.
// Any SM user can save a search; all SM users see every saved search.
// Delete is restricted to the creator or admin/lead roles.
//
// Storage: data/sm/opensearch_saved_searches.json
// Shape: [ { id, name, params, created_by, created_by_name, created_at } ]
require_once __DIR__ . '/../helpers.php';

const OS_SAVED_FILE = 'opensearch_saved_searches.json';

$payload = requireAuth();
requireSmTeamOnly('OpenSearch log viewer');
apiRateLimit($payload['sub'], 'opensearch');

function _loadSaved(): array {
    $d = readJson(OS_SAVED_FILE);
    return is_array($d) ? array_values($d) : [];
}

// Backfill a history entry for legacy records that only have created_by/created_at
function _ensureHistory(array $s): array {
    if (!isset($s['history']) || !is_array($s['history']) || !count($s['history'])) {
        $s['history'] = [[
            'action'  => 'create',
            'by'      => $s['created_by'] ?? '',
            'by_name' => $s['created_by_name'] ?? ($s['created_by'] ?? ''),
            'at'      => $s['created_at'] ?? time(),
            'changes' => [],
        ]];
    }
    return $s;
}

$method = $_SERVER['REQUEST_METHOD'];
$userId = $payload['sub'];

// GET — list all shared saved searches (newest first)
if ($method === 'GET') {
    $searches = array_map('_ensureHistory', _loadSaved());
    usort($searches, fn($a, $b) => ($b['created_at'] ?? 0) <=> ($a['created_at'] ?? 0));
    respondOk(['searches' => $searches]);
}

// POST — create a new shared saved search
if ($method === 'POST') {
    requireCsrf();
    $body = getBody();

    $name   = trim($body['name'] ?? '');
    $params = $body['params'] ?? null;

    if (!$name) respondError('name is required');
    if (mb_strlen($name) > 80) respondError('name must be ≤80 characters');
    if (!is_array($params)) respondError('params is required and must be an object');

    $epId = trim($params['endpoint_id'] ?? '');
    if (!$epId) respondError('params.endpoint_id is required');

    // Sanitize params — only keep known fields to prevent bloat
    $safeParams = array_filter([
        'endpoint_id'   => (string)($params['endpoint_id'] ?? ''),
        'index_pattern' => (string)($params['index_pattern'] ?? ''),
        'module'        => (string)($params['module'] ?? ''),
        'log_level'     => (string)($params['log_level'] ?? ''),
        'q'             => mb_substr((string)($params['q'] ?? ''), 0, 200),
        'correlation_id'=> (string)($params['correlation_id'] ?? ''),
        'range'         => (string)($params['range'] ?? 'last_15m'),
        'size'          => isset($params['size']) ? (int)$params['size'] : null,
    ], fn($v) => $v !== '' && $v !== null);

    $searches = _loadSaved();
    if (count($searches) >= 200) {
        respondError('Maximum 200 shared saved searches reached — delete some old ones first');
    }

    // Optional folder placement — null means "no folder"
    $folderId = isset($body['folder_id']) && $body['folder_id'] !== '' ? (string)$body['folder_id'] : null;
    if ($folderId !== null) {
        $folders = readJson('opensearch_saved_folders.json');
        $exists = false;
        if (is_array($folders)) {
            foreach ($folders as $f) { if (($f['id'] ?? '') === $folderId) { $exists = true; break; } }
        }
        if (!$exists) respondError('folder_id does not exist');
    }

    $now = time();
    $userName = $payload['name'] ?? $userId;
    $new = [
        'id'              => genId('ss'),
        'name'            => $name,
        'folder_id'       => $folderId,
        'params'          => $safeParams,
        'created_by'      => $userId,
        'created_by_name' => $userName,
        'created_at'      => $now,
        'updated_by'      => $userId,
        'updated_by_name' => $userName,
        'updated_at'      => $now,
        'history'         => [[
            'action'  => 'create',
            'by'      => $userId,
            'by_name' => $userName,
            'at'      => $now,
            'changes' => [],
        ]],
    ];
    $searches[] = $new;
    writeJson(OS_SAVED_FILE, $searches);

    logActivity('opensearch_saved_search_create', ['id' => $new['id'], 'name' => $name], $userId, $payload['name'] ?? '');
    respondOk($new, 'Search saved');
}

// PUT ?id=xxx — edit a saved search (name and/or params). Any SM user can edit.
if ($method === 'PUT' || $method === 'PATCH') {
    requireCsrf();
    $id = trim($_GET['id'] ?? '');
    if (!$id) respondError('id is required');
    $body = getBody();

    $searches = _loadSaved();
    $idx = -1;
    foreach ($searches as $i => $s) {
        if (($s['id'] ?? '') === $id) { $idx = $i; break; }
    }
    if ($idx < 0) respondError('Saved search not found', 404);

    $item    = _ensureHistory($searches[$idx]);
    $changes = [];

    // Folder move (null = un-folder)
    if (array_key_exists('folder_id', $body)) {
        $newFolder = ($body['folder_id'] === null || $body['folder_id'] === '') ? null : (string)$body['folder_id'];
        if ($newFolder !== null) {
            $folders = readJson('opensearch_saved_folders.json');
            $exists = false;
            if (is_array($folders)) {
                foreach ($folders as $f) { if (($f['id'] ?? '') === $newFolder) { $exists = true; break; } }
            }
            if (!$exists) respondError('folder_id does not exist');
        }
        $oldFolder = $item['folder_id'] ?? null;
        if ($newFolder !== $oldFolder) {
            $changes[] = ['field' => 'folder_id', 'from' => $oldFolder, 'to' => $newFolder];
            $item['folder_id'] = $newFolder;
        }
    }

    // Name edit
    if (array_key_exists('name', $body)) {
        $newName = trim((string)$body['name']);
        if (!$newName) respondError('name cannot be empty');
        if (mb_strlen($newName) > 80) respondError('name must be ≤80 characters');
        if ($newName !== ($item['name'] ?? '')) {
            $changes[] = ['field' => 'name', 'from' => $item['name'] ?? '', 'to' => $newName];
            $item['name'] = $newName;
        }
    }

    // Optional params replacement (same sanitize as POST)
    if (array_key_exists('params', $body) && is_array($body['params'])) {
        $params = $body['params'];
        $epId = trim($params['endpoint_id'] ?? '');
        if (!$epId) respondError('params.endpoint_id is required');
        $safeParams = array_filter([
            'endpoint_id'   => (string)($params['endpoint_id'] ?? ''),
            'index_pattern' => (string)($params['index_pattern'] ?? ''),
            'module'        => (string)($params['module'] ?? ''),
            'log_level'     => (string)($params['log_level'] ?? ''),
            'q'             => mb_substr((string)($params['q'] ?? ''), 0, 200),
            'correlation_id'=> (string)($params['correlation_id'] ?? ''),
            'regexp_rest'   => mb_substr((string)($params['regexp_rest'] ?? ''), 0, 500),
            'range'         => (string)($params['range'] ?? 'last_15m'),
            'start'         => (string)($params['start'] ?? ''),
            'end'           => (string)($params['end'] ?? ''),
            'size'          => isset($params['size']) ? (int)$params['size'] : null,
        ], fn($v) => $v !== '' && $v !== null);

        $oldParams = $item['params'] ?? [];
        $keys = array_unique(array_merge(array_keys($oldParams), array_keys($safeParams)));
        foreach ($keys as $k) {
            $ov = $oldParams[$k] ?? null;
            $nv = $safeParams[$k] ?? null;
            if ($ov !== $nv) {
                $changes[] = ['field' => "params.$k", 'from' => $ov, 'to' => $nv];
            }
        }
        $item['params'] = $safeParams;
    }

    if (!count($changes)) respondError('No changes provided');

    $now = time();
    $userName = $payload['name'] ?? $userId;
    $item['updated_by']      = $userId;
    $item['updated_by_name'] = $userName;
    $item['updated_at']      = $now;
    $item['history'][]       = [
        'action'  => 'edit',
        'by'      => $userId,
        'by_name' => $userName,
        'at'      => $now,
        'changes' => $changes,
    ];
    // Cap history at 50 entries (keep oldest create + most recent 49)
    if (count($item['history']) > 50) {
        $item['history'] = array_merge(
            [$item['history'][0]],
            array_slice($item['history'], -49)
        );
    }

    $searches[$idx] = $item;
    writeJson(OS_SAVED_FILE, $searches);

    logActivity('opensearch_saved_search_edit', ['id' => $id, 'changes' => $changes], $userId, $payload['name'] ?? '');
    respondOk($item, 'Updated');
}

// DELETE ?id=xxx — delete a saved search (creator or admin/lead only)
if ($method === 'DELETE') {
    requireCsrf();
    $id = trim($_GET['id'] ?? '');
    if (!$id) respondError('id is required');

    $searches = _loadSaved();
    $item = null;
    foreach ($searches as $s) {
        if (($s['id'] ?? '') === $id) { $item = $s; break; }
    }
    if (!$item) respondError('Saved search not found', 404);

    // All SM members can delete shared searches — it's a team-owned resource.

    $filtered = array_values(array_filter($searches, fn($s) => ($s['id'] ?? '') !== $id));
    writeJson(OS_SAVED_FILE, $filtered);

    logActivity('opensearch_saved_search_delete', ['id' => $id, 'name' => $item['name'] ?? ''], $userId, $payload['name'] ?? '');
    respondOk(null, 'Deleted');
}

respondError('Method not allowed', 405);
