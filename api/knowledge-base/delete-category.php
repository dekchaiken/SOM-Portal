<?php
/* ══════════════════════════════════════════════════
   delete-category.php  |  Delete entire category
   ══════════════════════════════════════════════════ */

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../helpers.php';

// Verify auth and role (admin only)
$user = requireAuth();
if (!in_array($user['role'], ADMIN_ROLES)) {
    respondError('Permission denied - Admin only', 403);
}

$input = getBody();
$categoryId = $input['category_id'] ?? '';

if (!$categoryId) {
    respondError('Invalid input', 400);
}

// Team-scoped: matches every other knowledge-base endpoint (readJson helper).
$dataFile = _teamDataPath('knowledge-base.json', $GLOBALS['_current_team'] ?? null);

if (!file_exists($dataFile)) {
    respondError('Data file not found', 404);
}

$kb = json_decode(file_get_contents($dataFile), true);

if (!isset($kb['categories'][$categoryId])) {
    respondError('Category not found', 404);
}

$categoryName = $kb['categories'][$categoryId]['name'];
$entriesCount = count($kb['entries'][$categoryId] ?? []);

// Delete category and its entries
unset($kb['categories'][$categoryId]);
unset($kb['entries'][$categoryId]);

// Save
if (!file_put_contents($dataFile, json_encode($kb, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE))) {
    respondError('Failed to save', 500);
}

// Log
logActivity('knowledge_base_delete_category', [
    'category_id' => $categoryId,
    'category_name' => $categoryName,
    'entries_deleted' => $entriesCount
], $user['sub'], $user['name'] ?? '');

respondOk(null, 'Category deleted');
