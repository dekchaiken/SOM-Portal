<?php
/* ══════════════════════════════════════════════════
   delete.php  |  Delete entry
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
$entryId = $input['entry_id'] ?? '';

if (!$category || !$entryId) {
    respondError('Invalid input', 400);
}

$dataFile = teamDataPath('knowledge-base.json');

if (!file_exists($dataFile)) {
    respondError('Data file not found', 404);
}

$kb = json_decode(file_get_contents($dataFile), true);

if (!isset($kb['entries'][$category])) {
    respondError('Category not found', 404);
}

// Find and remove entry
$found = false;
foreach ($kb['entries'][$category] as $idx => $entry) {
    if ($entry['id'] === $entryId) {
        array_splice($kb['entries'][$category], $idx, 1);
        $found = true;
        break;
    }
}

if (!$found) {
    respondError('Entry not found', 404);
}

// Save
if (!file_put_contents($dataFile, json_encode($kb, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE))) {
    respondError('Failed to save', 500);
}

// Log
logActivity('knowledge_base_delete', [
    'category' => $category,
    'entry_id' => $entryId
], $user['sub'], $user['name'] ?? '');

respondOk(null, 'Entry deleted');
