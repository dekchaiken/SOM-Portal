<?php
/**
 * Cache Statistics API
 * Returns cache performance metrics
 */

require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/CacheManager.php';

$payload = requireAuth();
requireRole($payload, ADMIN_ROLES);

$cache = new CacheManager();
$stats = $cache->getStats();

respondOk($stats, 'Cache statistics retrieved');
