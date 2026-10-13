<?php
/**
 * Cache Manager
 * 
 * Provides unified caching interface with multiple backends:
 * - APCu (in-memory, preferred)
 * - File-based (fallback)
 * 
 * Features:
 * - TTL support
 * - Pattern-based invalidation
 * - LRU eviction when storage > 80%
 * - Cache versioning
 * - Statistics tracking
 * 
 * Usage:
 *   $cache = new CacheManager();
 *   $cache->set('key', $value, 300); // 5 min TTL
 *   $value = $cache->get('key');
 *   $cache->invalidatePattern('board:*');
 */

class CacheManager {
    private const FILE_CACHE_DIR = __DIR__ . '/../../data/cache/';
    private const MAX_FILE_CACHE_SIZE = 100 * 1024 * 1024; // 100MB
    private const EVICTION_THRESHOLD = 0.8; // 80%
    
    private bool $apcuAvailable;
    private string $version;
    
    public function __construct() {
        $this->apcuAvailable = extension_loaded('apcu') && ini_get('apc.enabled');
        $this->version = $this->getSystemVersion();
        
        // Ensure cache directory exists
        if (!is_dir(self::FILE_CACHE_DIR)) {
            @mkdir(self::FILE_CACHE_DIR, 0755, true);
        }
    }
    
    /**
     * Get cached value
     * 
     * @param string $key Cache key
     * @return mixed Cached value or null if not found/expired
     */
    public function get(string $key): mixed {
        $versionedKey = $this->versionKey($key);
        
        // Try APCu first
        if ($this->apcuAvailable) {
            $value = apcu_fetch($versionedKey, $success);
            if ($success) {
                $this->incrementStat('hits_apcu');
                return $value;
            }
        }
        
        // Fallback to file cache
        $value = $this->getFromFile($versionedKey);
        if ($value !== null) {
            $this->incrementStat('hits_file');
            return $value;
        }
        
        $this->incrementStat('misses');
        return null;
    }
    
    /**
     * Set cached value with TTL
     * 
     * @param string $key Cache key
     * @param mixed $value Value to cache
     * @param int $ttl Time to live in seconds (default 3600 = 1 hour)
     * @return bool True on success
     */
    public function set(string $key, mixed $value, int $ttl = 3600): bool {
        $versionedKey = $this->versionKey($key);
        $success = false;
        
        // Store in APCu
        if ($this->apcuAvailable) {
            $success = apcu_store($versionedKey, $value, $ttl);
        }
        
        // Store in file cache
        $fileSuccess = $this->setToFile($versionedKey, $value, $ttl);
        
        // Check if eviction needed
        if ($fileSuccess) {
            $this->checkEviction();
        }
        
        return $success || $fileSuccess;
    }
    
    /**
     * Delete cached value
     * 
     * @param string $key Cache key
     * @return bool True on success
     */
    public function delete(string $key): bool {
        $versionedKey = $this->versionKey($key);
        $success = false;
        
        // Delete from APCu
        if ($this->apcuAvailable) {
            $success = apcu_delete($versionedKey);
        }
        
        // Delete from file cache
        $fileSuccess = $this->deleteFromFile($versionedKey);
        
        return $success || $fileSuccess;
    }
    
    /**
     * Clear all cache
     * 
     * @return bool True on success
     */
    public function clear(): bool {
        $success = false;
        
        // Clear APCu
        if ($this->apcuAvailable) {
            $success = apcu_clear_cache();
        }
        
        // Clear file cache
        $files = glob(self::FILE_CACHE_DIR . '*.cache');
        foreach ($files as $file) {
            @unlink($file);
        }
        
        return $success || !empty($files);
    }
    
    /**
     * Invalidate cache by pattern
     * Supports wildcards: board:* matches board:post:123, board:list, etc.
     * 
     * @param string $pattern Pattern with wildcards
     * @return int Number of keys invalidated
     */
    public function invalidatePattern(string $pattern): int {
        $count = 0;
        $regex = $this->patternToRegex($pattern);
        
        // Invalidate APCu
        if ($this->apcuAvailable) {
            $iterator = new APCUIterator($regex);
            foreach ($iterator as $entry) {
                apcu_delete($entry['key']);
                $count++;
            }
        }
        
        // Invalidate file cache
        $files = glob(self::FILE_CACHE_DIR . '*.cache');
        foreach ($files as $file) {
            $key = basename($file, '.cache');
            if (preg_match($regex, $key)) {
                @unlink($file);
                $count++;
            }
        }
        
        return $count;
    }
    
    /**
     * Check if cache key exists and is valid
     * 
     * @param string $key Cache key
     * @return bool True if exists
     */
    public function has(string $key): bool {
        return $this->get($key) !== null;
    }
    
    /**
     * Get cache statistics
     * 
     * @return array Statistics
     */
    public function getStats(): array {
        $stats = [
            'backend' => $this->apcuAvailable ? 'apcu+file' : 'file',
            'version' => $this->version,
            'hits_apcu' => $this->getStat('hits_apcu'),
            'hits_file' => $this->getStat('hits_file'),
            'misses' => $this->getStat('misses'),
            'hit_rate' => 0,
        ];
        
        $totalHits = $stats['hits_apcu'] + $stats['hits_file'];
        $totalRequests = $totalHits + $stats['misses'];
        if ($totalRequests > 0) {
            $stats['hit_rate'] = round(($totalHits / $totalRequests) * 100, 2);
        }
        
        // APCu stats
        if ($this->apcuAvailable) {
            $apcuInfo = apcu_cache_info(true);
            $stats['apcu'] = [
                'num_entries' => $apcuInfo['num_entries'] ?? 0,
                'mem_size' => $apcuInfo['mem_size'] ?? 0,
            ];
        }
        
        // File cache stats
        $files = glob(self::FILE_CACHE_DIR . '*.cache');
        $totalSize = 0;
        foreach ($files as $file) {
            $totalSize += filesize($file);
        }
        $stats['file'] = [
            'num_entries' => count($files),
            'total_size' => $totalSize,
            'max_size' => self::MAX_FILE_CACHE_SIZE,
            'usage_percent' => round(($totalSize / self::MAX_FILE_CACHE_SIZE) * 100, 2),
        ];
        
        return $stats;
    }
    
    // ─── Private Methods ──────────────────────────────────────────────────────
    
    /**
     * Get value from file cache
     */
    private function getFromFile(string $key): mixed {
        $file = $this->getCacheFilePath($key);
        if (!file_exists($file)) {
            return null;
        }
        
        $data = @file_get_contents($file);
        if ($data === false) {
            return null;
        }
        
        $entry = @unserialize($data);
        if ($entry === false || !is_array($entry)) {
            @unlink($file);
            return null;
        }
        
        // Check expiry
        if ($entry['expires'] < time()) {
            @unlink($file);
            return null;
        }
        
        // Update access time for LRU
        touch($file);
        
        return $entry['value'];
    }
    
    /**
     * Set value to file cache
     */
    private function setToFile(string $key, mixed $value, int $ttl): bool {
        $file = $this->getCacheFilePath($key);
        $entry = [
            'key' => $key,
            'value' => $value,
            'created' => time(),
            'expires' => time() + $ttl,
        ];
        
        $data = serialize($entry);
        return @file_put_contents($file, $data, LOCK_EX) !== false;
    }
    
    /**
     * Delete value from file cache
     */
    private function deleteFromFile(string $key): bool {
        $file = $this->getCacheFilePath($key);
        if (file_exists($file)) {
            return @unlink($file);
        }
        return false;
    }
    
    /**
     * Get cache file path
     */
    private function getCacheFilePath(string $key): string {
        $hash = md5($key);
        return self::FILE_CACHE_DIR . $hash . '.cache';
    }
    
    /**
     * Add version to cache key
     */
    private function versionKey(string $key): string {
        return "{$key}:v{$this->version}";
    }
    
    /**
     * Get system version for cache versioning
     */
    private function getSystemVersion(): string {
        // Use file modification time of config.php as version
        $configFile = __DIR__ . '/../config.php';
        if (file_exists($configFile)) {
            return (string)filemtime($configFile);
        }
        return '1';
    }
    
    /**
     * Convert pattern to regex
     */
    private function patternToRegex(string $pattern): string {
        $pattern = preg_quote($pattern, '/');
        $pattern = str_replace('\*', '.*', $pattern);
        return '/^' . $pattern . '/';
    }
    
    /**
     * Check if eviction needed and perform LRU eviction
     */
    private function checkEviction(): void {
        $files = glob(self::FILE_CACHE_DIR . '*.cache');
        $totalSize = 0;
        foreach ($files as $file) {
            $totalSize += filesize($file);
        }
        
        // Check if over threshold
        if ($totalSize < self::MAX_FILE_CACHE_SIZE * self::EVICTION_THRESHOLD) {
            return;
        }
        
        // Sort by access time (LRU)
        usort($files, function($a, $b) {
            return fileatime($a) - fileatime($b);
        });
        
        // Delete oldest 20% of files
        $deleteCount = (int)(count($files) * 0.2);
        for ($i = 0; $i < $deleteCount; $i++) {
            @unlink($files[$i]);
        }
    }
    
    /**
     * Increment statistics counter
     */
    private function incrementStat(string $stat): void {
        $statsFile = self::FILE_CACHE_DIR . '_stats.json';
        $stats = [];
        
        if (file_exists($statsFile)) {
            $data = @file_get_contents($statsFile);
            $stats = $data ? json_decode($data, true) : [];
        }
        
        $stats[$stat] = ($stats[$stat] ?? 0) + 1;
        @file_put_contents($statsFile, json_encode($stats), LOCK_EX);
    }
    
    /**
     * Get statistics counter
     */
    private function getStat(string $stat): int {
        $statsFile = self::FILE_CACHE_DIR . '_stats.json';
        if (!file_exists($statsFile)) {
            return 0;
        }
        
        $data = @file_get_contents($statsFile);
        $stats = $data ? json_decode($data, true) : [];
        return $stats[$stat] ?? 0;
    }
}

