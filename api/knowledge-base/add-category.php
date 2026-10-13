<?php
/* ══════════════════════════════════════════════════
   add-category.php  |  Add new category
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
$name = $input['name'] ?? '';
$fields = $input['fields'] ?? [];

if (!$categoryId || !$name || empty($fields)) {
    respondError('Invalid input', 400);
}

$dataFile = teamDataPath('knowledge-base.json');

// Load existing data
if (file_exists($dataFile)) {
    $kb = json_decode(file_get_contents($dataFile), true);
} else {
    $kb = ['categories' => [], 'entries' => []];
}

// Check if category already exists
if (isset($kb['categories'][$categoryId])) {
    respondError('Category already exists', 400);
}

// Add category
$kb['categories'][$categoryId] = [
    'name' => $name,
    'fields' => $fields,
    'created_at' => date('Y-m-d H:i:s'),
    'created_by' => $user['sub']
];

// Initialize entries array
$kb['entries'][$categoryId] = [];

// Save
if (!file_put_contents($dataFile, json_encode($kb, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE))) {
    respondError('Failed to save', 500);
}

// Log
logActivity('knowledge_base_add_category', [
    'category_id' => $categoryId,
    'name' => $name
], $user['sub'], $user['name'] ?? '');

respondOk(null, 'Category added');
