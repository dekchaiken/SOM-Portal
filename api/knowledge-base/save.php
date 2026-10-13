<?php
/* ══════════════════════════════════════════════════
   save.php  |  Save or update entry
   ══════════════════════════════════════════════════ */

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../helpers.php';

// Verify auth and role
$user = requireAuth();
if (!in_array($user['role'], LEAD_ROLES)) {
    respondError('Permission denied', 403);
}

$input = getBody();
$category = $input['category'] ?? '';
$entryId = $input['entry_id'] ?? null;
$data = $input['data'] ?? [];

if (!$category || empty($data)) {
    respondError('Invalid input', 400);
}

$dataFile = teamDataPath('knowledge-base.json');

// Load existing data
if (file_exists($dataFile)) {
    $kb = json_decode(file_get_contents($dataFile), true);
} else {
    $kb = ['categories' => [], 'entries' => []];
}

// Initialize category entries if not exists
if (!isset($kb['entries'][$category])) {
    $kb['entries'][$category] = [];
}

// Update or create entry
if ($entryId) {
    // Update existing
    $found = false;
    foreach ($kb['entries'][$category] as &$entry) {
        if ($entry['id'] === $entryId) {
            $entry['data'] = $data;
            $entry['updated_at'] = date('Y-m-d H:i:s');
            $entry['updated_by'] = $user['sub'];
            $found = true;
            break;
        }
    }
    if (!$found) {
        respondError('Entry not found', 404);
    }
    $action = 'update';
} else {
    // Create new
    $newEntry = [
        'id' => genId('kb'),
        'data' => $data,
        'created_at' => date('Y-m-d H:i:s'),
        'created_by' => $user['sub'],
        'updated_at' => date('Y-m-d H:i:s'),
        'updated_by' => $user['sub']
    ];
    $kb['entries'][$category][] = $newEntry;
    $action = 'create';
}

// Save
if (!file_put_contents($dataFile, json_encode($kb, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE))) {
    respondError('Failed to save', 500);
}

// Log
logActivity('knowledge_base_' . $action, [
    'category' => $category,
    'entry_id' => $entryId ?? $newEntry['id']
], $user['sub'], $user['name'] ?? '');

respondOk(null, $action === 'create' ? 'Entry created' : 'Entry updated');
