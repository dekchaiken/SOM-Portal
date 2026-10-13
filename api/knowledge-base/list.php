<?php
/* ══════════════════════════════════════════════════
   list.php  |  Get all categories and entries
   ══════════════════════════════════════════════════ */

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../helpers.php';

// Verify auth
$user = requireAuth();

$dataFile = teamDataPath('knowledge-base.json');

// Load data
if (file_exists($dataFile)) {
    $raw = file_get_contents($dataFile);
    $data = json_decode($raw, true);
    
    // Debug log
    error_log('[KB] File exists: ' . $dataFile);
    error_log('[KB] File size: ' . strlen($raw));
    error_log('[KB] Categories count: ' . count($data['categories'] ?? []));
    error_log('[KB] Entries keys: ' . implode(', ', array_keys($data['entries'] ?? [])));
    error_log('[KB] Block-biz-rule count: ' . count($data['entries']['block-biz-rule'] ?? []));
} else {
    error_log('[KB] File NOT found: ' . $dataFile);
    $data = [
        'categories' => [],
        'entries' => []
    ];
}

// Log access
logActivity('knowledge_base_view', [
    'categories_count' => count($data['categories'] ?? []),
    'entries_count' => array_sum(array_map('count', $data['entries'] ?? []))
], $user['sub'], $user['name'] ?? '');

respondOk([
    'categories' => $data['categories'] ?? [],
    'entries' => $data['entries'] ?? []
]);
