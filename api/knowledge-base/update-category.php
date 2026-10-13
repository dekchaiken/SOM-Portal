<?php
/* ══════════════════════════════════════════════════
   update-category.php  |  Update category fields
   ══════════════════════════════════════════════════ */

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../helpers.php';

// Verify auth and role
$user = requireAuth();
if (!in_array($user['role'], LEAD_ROLES)) {
    respondError('Permission denied', 403);
}

$input = getBody();
$categoryId = $input['category_id'] ?? '';
$fields = $input['fields'] ?? [];

if (!$categoryId || empty($fields)) {
    respondError('Invalid input', 400);
}

$dataFile = teamDataPath('knowledge-base.json');

if (!file_exists($dataFile)) {
    respondError('Data file not found', 404);
}

$kb = json_decode(file_get_contents($dataFile), true);

if (!isset($kb['categories'][$categoryId])) {
    respondError('Category not found', 404);
}

// Update fields
$kb['categories'][$categoryId]['fields'] = $fields;
$kb['categories'][$categoryId]['updated_at'] = date('Y-m-d H:i:s');
$kb['categories'][$categoryId]['updated_by'] = $user['sub'];

// Save
if (!file_put_contents($dataFile, json_encode($kb, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE))) {
    respondError('Failed to save', 500);
}

// Log
logActivity('knowledge_base_update_category', [
    'category_id' => $categoryId
], $user['sub'], $user['name'] ?? '');

respondOk(null, 'Category updated');
