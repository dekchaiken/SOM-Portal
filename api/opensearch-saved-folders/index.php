<?php
// Team-shared folders for OpenSearch saved searches. SM-only.
// Any SM user can create/rename/delete a folder — same trust model as saved searches.
//
// Storage: data/sm/opensearch_saved_folders.json
// Shape:   [ { id, name, color, created_by, created_by_name, created_at,
//              updated_by, updated_by_name, updated_at } ]
require_once __DIR__ . '/../helpers.php';

const OS_FOLDERS_FILE = 'opensearch_saved_folders.json';
const OS_SAVED_FILE_F = 'opensearch_saved_searches.json';

$payload = requireAuth();
requireSmTeamOnly('OpenSearch log viewer');
apiRateLimit($payload['sub'], 'opensearch');

function _loadFolders(): array {
    $d = readJson(OS_FOLDERS_FILE);
    return is_array($d) ? array_values($d) : [];
}

$method = $_SERVER['REQUEST_METHOD'];
$userId = $payload['sub'];

// GET — list folders, sorted alphabetically (case-insensitive)
if ($method === 'GET') {
    $folders = _loadFolders();
    usort($folders, fn($a, $b) => strcasecmp($a['name'] ?? '', $b['name'] ?? ''));
    respondOk(['folders' => $folders]);
}

// POST — create a folder
if ($method === 'POST') {
    requireCsrf();
    $body  = getBody();
    $name  = trim($body['name'] ?? '');
    $color = trim($body['color'] ?? '');

    if (!$name) respondError('name is required');
    if (mb_strlen($name) > 60) respondError('name must be ≤60 characters');

    $folders = _loadFolders();
    foreach ($folders as $f) {
        if (strcasecmp($f['name'] ?? '', $name) === 0) {
            respondError('A folder with this name already exists');
        }
    }
    if (count($folders) >= 100) respondError('Maximum 100 folders reached');

    $now = time();
    $userName = $payload['name'] ?? $userId;
    $new = [
        'id'              => genId('fld'),
        'name'            => $name,
        'color'           => $color ?: '',
        'created_by'      => $userId,
        'created_by_name' => $userName,
        'created_at'      => $now,
        'updated_by'      => $userId,
        'updated_by_name' => $userName,
        'updated_at'      => $now,
    ];
    $folders[] = $new;
    writeJson(OS_FOLDERS_FILE, $folders);
    logActivity('opensearch_saved_folder_create', ['id' => $new['id'], 'name' => $name], $userId, $payload['name'] ?? '');
    respondOk($new, 'Folder created');
}

// PUT ?id=xxx — rename or recolor
if ($method === 'PUT' || $method === 'PATCH') {
    requireCsrf();
    $id = trim($_GET['id'] ?? '');
    if (!$id) respondError('id is required');
    $body = getBody();

    $folders = _loadFolders();
    $idx = -1;
    foreach ($folders as $i => $f) {
        if (($f['id'] ?? '') === $id) { $idx = $i; break; }
    }
    if ($idx < 0) respondError('Folder not found', 404);

    $item = $folders[$idx];

    if (array_key_exists('name', $body)) {
        $newName = trim((string)$body['name']);
        if (!$newName) respondError('name cannot be empty');
        if (mb_strlen($newName) > 60) respondError('name must be ≤60 characters');
        // Enforce unique name across other folders
        foreach ($folders as $j => $f) {
            if ($j !== $idx && strcasecmp($f['name'] ?? '', $newName) === 0) {
                respondError('A folder with this name already exists');
            }
        }
        $item['name'] = $newName;
    }
    if (array_key_exists('color', $body)) {
        $item['color'] = trim((string)$body['color']);
    }

    $item['updated_by']      = $userId;
    $item['updated_by_name'] = $payload['name'] ?? $userId;
    $item['updated_at']      = time();

    $folders[$idx] = $item;
    writeJson(OS_FOLDERS_FILE, $folders);
    logActivity('opensearch_saved_folder_update', ['id' => $id, 'name' => $item['name']], $userId, $payload['name'] ?? '');
    respondOk($item, 'Folder updated');
}

// DELETE ?id=xxx — remove folder. Saved searches under it are un-foldered (folder_id set to null).
if ($method === 'DELETE') {
    requireCsrf();
    $id = trim($_GET['id'] ?? '');
    if (!$id) respondError('id is required');

    $folders = _loadFolders();
    $item = null;
    $filtered = [];
    foreach ($folders as $f) {
        if (($f['id'] ?? '') === $id) { $item = $f; }
        else { $filtered[] = $f; }
    }
    if (!$item) respondError('Folder not found', 404);
    writeJson(OS_FOLDERS_FILE, $filtered);

    // Un-folder any saved searches that referenced this folder
    $searches = readJson(OS_SAVED_FILE_F);
    if (is_array($searches)) {
        $changed = false;
        foreach ($searches as &$s) {
            if (($s['folder_id'] ?? null) === $id) { $s['folder_id'] = null; $changed = true; }
        }
        unset($s);
        if ($changed) writeJson(OS_SAVED_FILE_F, $searches);
    }

    logActivity('opensearch_saved_folder_delete', ['id' => $id, 'name' => $item['name'] ?? ''], $userId, $payload['name'] ?? '');
    respondOk(null, 'Folder deleted');
}

respondError('Method not allowed', 405);
