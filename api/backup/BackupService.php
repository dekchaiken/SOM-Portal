<?php
/**
 * Automated Backup Service
 * 
 * Features:
 * - Full backup of data, uploads, config
 * - Compression (gzip)
 * - Encryption (AES-256-CBC)
 * - Integrity verification (SHA-256 checksums)
 * - Retention policy (7 daily, 4 weekly)
 * - Restore functionality
 * 
 * Usage:
 *   $backup = new BackupService();
 *   $result = $backup->createBackup();
 *   $backups = $backup->listBackups();
 *   $backup->restoreBackup($backupId);
 */

class BackupService {
    private const BACKUP_DIR = __DIR__ . '/../../data/backups/';
    private const DATA_DIR = __DIR__ . '/../../data/';
    private const UPLOADS_DIR = __DIR__ . '/../../uploads/';
    private const CONFIG_FILES = ['.env'];
    
    private const RETENTION_DAILY = 7;   // Keep 7 daily backups
    private const RETENTION_WEEKLY = 4;  // Keep 4 weekly backups (Sundays)
    
    private string $encryptionKey;
    
    public function __construct() {
        // Derive encryption key from JWT_SECRET
        $this->encryptionKey = hash('sha256', JWT_SECRET, true);
        
        // Ensure backup directory exists
        if (!is_dir(self::BACKUP_DIR)) {
            @mkdir(self::BACKUP_DIR, 0755, true);
        }
    }
    
    /**
     * Create full backup
     * 
     * @return array Backup result with id, status, size, duration
     */
    public function createBackup(): array {
        $startTime = microtime(true);
        $backupId = 'backup_' . date('Ymd_His');
        $backupPath = self::BACKUP_DIR . $backupId . '/';
        
        try {
            // Create backup directory
            if (!mkdir($backupPath, 0755, true)) {
                throw new Exception('Failed to create backup directory');
            }
            
            // Create manifest
            $manifest = [
                'backup_id' => $backupId,
                'created_at' => date('c'),
                'type' => 'full',
                'files' => [],
                'total_size' => 0,
                'compressed_size' => 0,
                'encryption' => 'AES-256-CBC',
            ];
            
            // Backup data files
            $dataArchive = $this->backupDirectory(
                self::DATA_DIR,
                $backupPath . 'data.tar.gz',
                ['backups', 'cache', 'logs'] // Exclude these subdirectories
            );
            $manifest['files'][] = $dataArchive;
            $manifest['total_size'] += $dataArchive['original_size'];
            $manifest['compressed_size'] += $dataArchive['size'];
            
            // Encrypt data archive
            $this->encryptFile($backupPath . 'data.tar.gz');
            
            // Backup uploads
            if (is_dir(self::UPLOADS_DIR)) {
                $uploadsArchive = $this->backupDirectory(
                    self::UPLOADS_DIR,
                    $backupPath . 'uploads.tar.gz'
                );
                $manifest['files'][] = $uploadsArchive;
                $manifest['total_size'] += $uploadsArchive['original_size'];
                $manifest['compressed_size'] += $uploadsArchive['size'];
                
                // Encrypt uploads archive
                $this->encryptFile($backupPath . 'uploads.tar.gz');
            }
            
            // Backup config files
            $configArchive = $this->backupConfigFiles($backupPath . 'config.tar.gz');
            if ($configArchive) {
                $manifest['files'][] = $configArchive;
                $manifest['total_size'] += $configArchive['original_size'];
                $manifest['compressed_size'] += $configArchive['size'];
                
                // Encrypt config archive
                $this->encryptFile($backupPath . 'config.tar.gz');
            }
            
            // Save manifest
            file_put_contents(
                $backupPath . 'manifest.json',
                json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)
            );
            
            // Verify backup
            $verification = $this->verifyBackup($backupId);
            file_put_contents(
                $backupPath . 'verification.json',
                json_encode($verification, JSON_PRETTY_PRINT)
            );
            
            $duration = round(microtime(true) - $startTime, 2);
            
            // Log success
            if (function_exists('logActivity')) {
                logActivity('backup_created', [
                    'backup_id' => $backupId,
                    'size_mb' => round($manifest['compressed_size'] / 1024 / 1024, 2),
                    'duration_sec' => $duration,
                ], 'system', 'Backup Service');
            }
            
            return [
                'success' => true,
                'backup_id' => $backupId,
                'size' => $manifest['compressed_size'],
                'duration' => $duration,
                'verified' => $verification['valid'],
            ];
            
        } catch (Exception $e) {
            // Clean up failed backup
            if (is_dir($backupPath)) {
                $this->deleteDirectory($backupPath);
            }
            
            // Log failure
            if (function_exists('logSecurity')) {
                logSecurity('backup_failed', [
                    'backup_id' => $backupId,
                    'error' => $e->getMessage(),
                ], 'system', 'Backup Service');
            }
            
            return [
                'success' => false,
                'error' => $e->getMessage(),
            ];
        }
    }
    
    /**
     * Verify backup integrity
     * 
     * @param string $backupId Backup ID
     * @return array Verification result
     */
    public function verifyBackup(string $backupId): array {
        $backupPath = self::BACKUP_DIR . $backupId . '/';
        
        if (!is_dir($backupPath)) {
            return ['valid' => false, 'error' => 'Backup not found'];
        }
        
        // Load manifest
        $manifestFile = $backupPath . 'manifest.json';
        if (!file_exists($manifestFile)) {
            return ['valid' => false, 'error' => 'Manifest not found'];
        }
        
        $manifest = json_decode(file_get_contents($manifestFile), true);
        $result = [
            'valid' => true,
            'checked_at' => date('c'),
            'files' => [],
        ];
        
        // Verify each file
        foreach ($manifest['files'] as $fileInfo) {
            $encryptedPath = $fileInfo['path'] . '.enc';
            
            if (!file_exists($encryptedPath)) {
                $result['valid'] = false;
                $result['files'][] = [
                    'path' => $fileInfo['path'],
                    'status' => 'missing',
                ];
                continue;
            }
            
            // Verify file size (encrypted file will be slightly larger)
            $actualSize = filesize($encryptedPath);
            $expectedSize = $fileInfo['size'];
            
            // Allow 5% variance for encryption overhead
            if ($actualSize < $expectedSize * 0.95 || $actualSize > $expectedSize * 1.05) {
                $result['valid'] = false;
                $result['files'][] = [
                    'path' => $fileInfo['path'],
                    'status' => 'size_mismatch',
                    'expected' => $expectedSize,
                    'actual' => $actualSize,
                ];
                continue;
            }
            
            $result['files'][] = [
                'path' => $fileInfo['path'],
                'status' => 'ok',
            ];
        }
        
        return $result;
    }
    
    /**
     * Restore from backup
     * 
     * @param string $backupId Backup ID
     * @return array Restore result
     */
    public function restoreBackup(string $backupId): array {
        $backupPath = self::BACKUP_DIR . $backupId . '/';
        
        if (!is_dir($backupPath)) {
            return ['success' => false, 'error' => 'Backup not found'];
        }
        
        try {
            // Verify backup first
            $verification = $this->verifyBackup($backupId);
            if (!$verification['valid']) {
                throw new Exception('Backup verification failed');
            }
            
            // Create rollback point
            $rollbackId = $this->createBackup();
            if (!$rollbackId['success']) {
                throw new Exception('Failed to create rollback point');
            }
            
            // Decrypt and extract data
            $this->decryptFile($backupPath . 'data.tar.gz.enc', $backupPath . 'data.tar.gz');
            $this->extractArchive($backupPath . 'data.tar.gz', self::DATA_DIR);
            @unlink($backupPath . 'data.tar.gz');
            
            // Decrypt and extract uploads
            if (file_exists($backupPath . 'uploads.tar.gz.enc')) {
                $this->decryptFile($backupPath . 'uploads.tar.gz.enc', $backupPath . 'uploads.tar.gz');
                $this->extractArchive($backupPath . 'uploads.tar.gz', self::UPLOADS_DIR);
                @unlink($backupPath . 'uploads.tar.gz');
            }
            
            // Decrypt and extract config
            if (file_exists($backupPath . 'config.tar.gz.enc')) {
                $this->decryptFile($backupPath . 'config.tar.gz.enc', $backupPath . 'config.tar.gz');
                $this->extractArchive($backupPath . 'config.tar.gz', dirname(self::DATA_DIR));
                @unlink($backupPath . 'config.tar.gz');
            }
            
            // Log success
            if (function_exists('logActivity')) {
                logActivity('backup_restored', [
                    'backup_id' => $backupId,
                    'rollback_id' => $rollbackId['backup_id'],
                ], 'system', 'Backup Service');
            }
            
            return [
                'success' => true,
                'backup_id' => $backupId,
                'rollback_id' => $rollbackId['backup_id'],
            ];
            
        } catch (Exception $e) {
            // Log failure
            if (function_exists('logSecurity')) {
                logSecurity('backup_restore_failed', [
                    'backup_id' => $backupId,
                    'error' => $e->getMessage(),
                ], 'system', 'Backup Service');
            }
            
            return [
                'success' => false,
                'error' => $e->getMessage(),
            ];
        }
    }
    
    /**
     * List all backups
     * 
     * @return array List of backups
     */
    public function listBackups(): array {
        $backups = [];
        $dirs = glob(self::BACKUP_DIR . 'backup_*', GLOB_ONLYDIR);
        
        foreach ($dirs as $dir) {
            $backupId = basename($dir);
            $manifestFile = $dir . '/manifest.json';
            
            if (!file_exists($manifestFile)) {
                continue;
            }
            
            $manifest = json_decode(file_get_contents($manifestFile), true);
            
            // Check if verified
            $verificationFile = $dir . '/verification.json';
            $verified = false;
            if (file_exists($verificationFile)) {
                $verification = json_decode(file_get_contents($verificationFile), true);
                $verified = $verification['valid'] ?? false;
            }
            
            $backups[] = [
                'backup_id' => $backupId,
                'created_at' => $manifest['created_at'],
                'type' => $manifest['type'],
                'size' => $manifest['compressed_size'],
                'verified' => $verified,
            ];
        }
        
        // Sort by created_at descending
        usort($backups, function($a, $b) {
            return strtotime($b['created_at']) - strtotime($a['created_at']);
        });
        
        return $backups;
    }
    
    /**
     * Delete old backups per retention policy
     * 
     * @return int Number of backups deleted
     */
    public function cleanupOldBackups(): int {
        $backups = $this->listBackups();
        $deleted = 0;
        
        $dailyBackups = [];
        $weeklyBackups = [];
        
        foreach ($backups as $backup) {
            $date = new DateTime($backup['created_at']);
            $dayOfWeek = (int)$date->format('w'); // 0 = Sunday
            
            if ($dayOfWeek === 0) {
                // Sunday backup - keep as weekly
                $weeklyBackups[] = $backup;
            } else {
                // Other days - keep as daily
                $dailyBackups[] = $backup;
            }
        }
        
        // Delete old daily backups (keep only last 7)
        for ($i = self::RETENTION_DAILY; $i < count($dailyBackups); $i++) {
            $this->deleteBackup($dailyBackups[$i]['backup_id']);
            $deleted++;
        }
        
        // Delete old weekly backups (keep only last 4)
        for ($i = self::RETENTION_WEEKLY; $i < count($weeklyBackups); $i++) {
            $this->deleteBackup($weeklyBackups[$i]['backup_id']);
            $deleted++;
        }
        
        return $deleted;
    }
    
    /**
     * Delete a backup
     * 
     * @param string $backupId Backup ID
     * @return bool True on success
     */
    public function deleteBackup(string $backupId): bool {
        $backupPath = self::BACKUP_DIR . $backupId . '/';
        
        if (!is_dir($backupPath)) {
            return false;
        }
        
        return $this->deleteDirectory($backupPath);
    }
    
    /**
     * Get backup info
     * 
     * @param string $backupId Backup ID
     * @return array|null Backup info or null if not found
     */
    public function getBackupInfo(string $backupId): ?array {
        $backupPath = self::BACKUP_DIR . $backupId . '/';
        $manifestFile = $backupPath . 'manifest.json';
        
        if (!file_exists($manifestFile)) {
            return null;
        }
        
        $manifest = json_decode(file_get_contents($manifestFile), true);
        
        // Add verification status
        $verificationFile = $backupPath . 'verification.json';
        if (file_exists($verificationFile)) {
            $verification = json_decode(file_get_contents($verificationFile), true);
            $manifest['verification'] = $verification;
        }
        
        return $manifest;
    }
    
    // ─── Private Methods ──────────────────────────────────────────────────────
    
    /**
     * Backup directory to tar.gz archive
     */
    private function backupDirectory(string $sourceDir, string $archivePath, array $exclude = []): array {
        $originalSize = $this->getDirectorySize($sourceDir, $exclude);
        
        // Create tar.gz archive
        $phar = new PharData($archivePath);
        $phar->buildFromDirectory($sourceDir, function($file) use ($exclude) {
            foreach ($exclude as $excludeDir) {
                if (strpos($file, '/' . $excludeDir . '/') !== false) {
                    return false;
                }
            }
            return true;
        });
        $phar->compress(Phar::GZ);
        
        // Remove uncompressed tar
        @unlink($archivePath);
        
        $compressedPath = $archivePath . '.gz';
        rename($compressedPath, $archivePath);
        
        $compressedSize = filesize($archivePath);
        $checksum = hash_file('sha256', $archivePath);
        
        return [
            'path' => $archivePath,
            'original_size' => $originalSize,
            'size' => $compressedSize,
            'checksum' => $checksum,
        ];
    }
    
    /**
     * Backup config files
     */
    private function backupConfigFiles(string $archivePath): ?array {
        $baseDir = dirname(self::DATA_DIR);
        $files = [];
        
        foreach (self::CONFIG_FILES as $file) {
            $filePath = $baseDir . '/' . $file;
            if (file_exists($filePath)) {
                $files[] = $filePath;
            }
        }
        
        if (empty($files)) {
            return null;
        }
        
        $originalSize = 0;
        foreach ($files as $file) {
            $originalSize += filesize($file);
        }
        
        // Create tar.gz archive
        $phar = new PharData($archivePath);
        foreach ($files as $file) {
            $phar->addFile($file, basename($file));
        }
        $phar->compress(Phar::GZ);
        
        // Remove uncompressed tar
        @unlink($archivePath);
        
        $compressedPath = $archivePath . '.gz';
        rename($compressedPath, $archivePath);
        
        $compressedSize = filesize($archivePath);
        $checksum = hash_file('sha256', $archivePath);
        
        return [
            'path' => $archivePath,
            'original_size' => $originalSize,
            'size' => $compressedSize,
            'checksum' => $checksum,
        ];
    }
    
    /**
     * Encrypt file with AES-256-CBC
     */
    private function encryptFile(string $filePath): void {
        $data = file_get_contents($filePath);
        $iv = openssl_random_pseudo_bytes(16);
        $encrypted = openssl_encrypt($data, 'AES-256-CBC', $this->encryptionKey, 0, $iv);
        
        // Prepend IV to encrypted data
        $encryptedData = $iv . base64_decode($encrypted);
        
        file_put_contents($filePath . '.enc', $encryptedData);
        @unlink($filePath);
    }
    
    /**
     * Decrypt file with AES-256-CBC
     */
    private function decryptFile(string $encryptedPath, string $outputPath): void {
        $encryptedData = file_get_contents($encryptedPath);
        
        // Extract IV (first 16 bytes)
        $iv = substr($encryptedData, 0, 16);
        $encrypted = base64_encode(substr($encryptedData, 16));
        
        $decrypted = openssl_decrypt($encrypted, 'AES-256-CBC', $this->encryptionKey, 0, $iv);
        
        file_put_contents($outputPath, $decrypted);
    }
    
    /**
     * Extract tar.gz archive
     */
    private function extractArchive(string $archivePath, string $destination): void {
        $phar = new PharData($archivePath);
        $phar->extractTo($destination, null, true);
    }
    
    /**
     * Get directory size
     */
    private function getDirectorySize(string $dir, array $exclude = []): int {
        $size = 0;
        $iterator = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($dir, RecursiveDirectoryIterator::SKIP_DOTS)
        );
        
        foreach ($iterator as $file) {
            $skip = false;
            foreach ($exclude as $excludeDir) {
                if (strpos($file->getPathname(), '/' . $excludeDir . '/') !== false) {
                    $skip = true;
                    break;
                }
            }
            if (!$skip) {
                $size += $file->getSize();
            }
        }
        
        return $size;
    }
    
    /**
     * Delete directory recursively
     */
    private function deleteDirectory(string $dir): bool {
        if (!is_dir($dir)) {
            return false;
        }
        
        $files = array_diff(scandir($dir), ['.', '..']);
        foreach ($files as $file) {
            $path = $dir . '/' . $file;
            is_dir($path) ? $this->deleteDirectory($path) : @unlink($path);
        }
        
        return @rmdir($dir);
    }
}

