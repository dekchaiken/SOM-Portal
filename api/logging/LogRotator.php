<?php
/**
 * Log Rotation Service
 * 
 * Automatically rotates, compresses, and cleans up log files
 * 
 * Features:
 * - Rotate when file > 10MB
 * - Compress old logs with gzip
 * - Retention: 90 days (activity), 365 days (security)
 * - Keep last 10 rotated files per log type
 * 
 * Usage:
 *   $rotator = new LogRotator();
 *   $rotator->rotateIfNeeded('activity.json');
 *   $rotator->cleanupOldLogs();
 */

class LogRotator {
    private const LOG_DIR = __DIR__ . '/../../data/logs/';
    private const MAX_SIZE = 10 * 1024 * 1024; // 10MB
    private const MAX_ROTATED_FILES = 10;
    
    private const RETENTION_DAYS = [
        'activity' => 90,
        'security' => 365,
    ];
    
    /**
     * Rotate log file if needed
     * 
     * @param string $logFile Log filename (e.g., 'activity.json')
     * @return bool True if rotated
     */
    public function rotateIfNeeded(string $logFile): bool {
        $path = self::LOG_DIR . $logFile;
        
        if (!file_exists($path)) {
            return false;
        }
        
        $size = filesize($path);
        if ($size < self::MAX_SIZE) {
            return false;
        }
        
        return $this->rotate($logFile);
    }
    
    /**
     * Rotate log file
     * 
     * @param string $logFile Log filename
     * @return bool True on success
     */
    public function rotate(string $logFile): bool {
        $path = self::LOG_DIR . $logFile;
        
        if (!file_exists($path)) {
            return false;
        }
        
        // Generate rotated filename with timestamp
        $timestamp = date('Ymd_His');
        $rotatedPath = self::LOG_DIR . pathinfo($logFile, PATHINFO_FILENAME) . 
                       '.' . $timestamp . '.' . 
                       pathinfo($logFile, PATHINFO_EXTENSION);
        
        // Rename current log
        if (!rename($path, $rotatedPath)) {
            return false;
        }
        
        // Compress rotated log
        $this->compressLog($rotatedPath);
        
        // Create new empty log
        file_put_contents($path, '[]');
        
        // Cleanup old rotated files
        $this->cleanupRotatedFiles($logFile);
        
        return true;
    }
    
    /**
     * Compress log file with gzip
     * 
     * @param string $logFile Log file path
     * @return bool True on success
     */
    public function compressLog(string $logFile): bool {
        if (!file_exists($logFile)) {
            return false;
        }
        
        // Read file
        $data = file_get_contents($logFile);
        if ($data === false) {
            return false;
        }
        
        // Compress
        $compressed = gzencode($data, 9);
        if ($compressed === false) {
            return false;
        }
        
        // Write compressed file
        $gzPath = $logFile . '.gz';
        if (file_put_contents($gzPath, $compressed) === false) {
            return false;
        }
        
        // Delete original
        unlink($logFile);
        
        return true;
    }
    
    /**
     * Delete logs older than retention period
     * 
     * @return int Number of logs deleted
     */
    public function cleanupOldLogs(): int {
        $deleted = 0;
        
        foreach (self::RETENTION_DAYS as $logType => $retentionDays) {
            $pattern = self::LOG_DIR . $logType . '.*.json.gz';
            $files = glob($pattern);
            
            $cutoffTime = time() - ($retentionDays * 24 * 60 * 60);
            
            foreach ($files as $file) {
                $mtime = filemtime($file);
                if ($mtime < $cutoffTime) {
                    if (unlink($file)) {
                        $deleted++;
                    }
                }
            }
        }
        
        return $deleted;
    }
    
    /**
     * Get log file size
     * 
     * @param string $logFile Log filename
     * @return int Size in bytes
     */
    public function getLogSize(string $logFile): int {
        $path = self::LOG_DIR . $logFile;
        return file_exists($path) ? filesize($path) : 0;
    }
    
    /**
     * List all log files
     * 
     * @return array List of log files with info
     */
    public function listLogs(): array {
        $logs = [];
        
        // Current logs
        $currentLogs = glob(self::LOG_DIR . '*.json');
        foreach ($currentLogs as $file) {
            $logs[] = [
                'filename' => basename($file),
                'path' => $file,
                'size' => filesize($file),
                'modified' => filemtime($file),
                'type' => 'current',
                'compressed' => false,
            ];
        }
        
        // Rotated logs
        $rotatedLogs = glob(self::LOG_DIR . '*.json.gz');
        foreach ($rotatedLogs as $file) {
            $logs[] = [
                'filename' => basename($file),
                'path' => $file,
                'size' => filesize($file),
                'modified' => filemtime($file),
                'type' => 'rotated',
                'compressed' => true,
            ];
        }
        
        // Sort by modified time descending
        usort($logs, function($a, $b) {
            return $b['modified'] - $a['modified'];
        });
        
        return $logs;
    }
    
    /**
     * Cleanup old rotated files (keep only last N)
     * 
     * @param string $logFile Base log filename
     */
    private function cleanupRotatedFiles(string $logFile): void {
        $baseName = pathinfo($logFile, PATHINFO_FILENAME);
        $pattern = self::LOG_DIR . $baseName . '.*.json.gz';
        $files = glob($pattern);
        
        // Sort by modification time descending
        usort($files, function($a, $b) {
            return filemtime($b) - filemtime($a);
        });
        
        // Delete files beyond max count
        for ($i = self::MAX_ROTATED_FILES; $i < count($files); $i++) {
            @unlink($files[$i]);
        }
    }
}

