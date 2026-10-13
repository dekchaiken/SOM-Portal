<?php
/**
 * Clear Cache API
 * Clears all cached data
 */

require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/CacheManager.php';

$payload = requireAuth();
requireCsrf();
requireRole($payload, ADMIN_ROLES);

$cache = new CacheManager();
$success = $cache->clear();

if ($success) {
    logActivity('cache_cleared', [], $payload['sub'], $payload['name']);
    respondOk(null, 'Cache cleared successfully');
} else {
    respondError('Failed to clear cache', 500);
}
