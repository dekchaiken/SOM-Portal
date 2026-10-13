<?php
/**
 * File Upload Security Scanner
 * 
 * Validates uploaded files for security threats:
 * - MIME type validation
 * - File signature validation
 * - Malware pattern detection
 * - Safe filename generation
 * 
 * Usage:
 *   $scanner = new FileScanner();
 *   $result = $scanner->scanFile($filePath);
 *   if (!$result['safe']) {
 *       // Handle threat
 *   }
 */

class FileScanner {
    // Allowed MIME types for images
    private const ALLOWED_IMAGE_TYPES = [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
    ];
    
    // File signatures (magic bytes) for validation
    private const FILE_SIGNATURES = [
        'image/jpeg' => [
            ['offset' => 0, 'bytes' => 'FFD8FF'],
        ],
        'image/png' => [
            ['offset' => 0, 'bytes' => '89504E47'],
        ],
        'image/gif' => [
            ['offset' => 0, 'bytes' => '474946383761'], // GIF87a
            ['offset' => 0, 'bytes' => '474946383961'], // GIF89a
        ],
        'image/webp' => [
            ['offset' => 0, 'bytes' => '52494646'], // RIFF
            ['offset' => 8, 'bytes' => '57454250'], // WEBP
        ],
    ];
    
    // Malicious patterns to detect in files
    private const MALICIOUS_PATTERNS = [
        '/<\?php/i',
        '/<script/i',
        '/eval\s*\(/i',
        '/base64_decode\s*\(/i',
        '/exec\s*\(/i',
        '/system\s*\(/i',
        '/passthru\s*\(/i',
        '/shell_exec\s*\(/i',
        '/assert\s*\(/i',
        '/preg_replace\s*\(.*\/e/i',
    ];
    
    /**
     * Scan file for security threats
     * 
     * @param string $filePath Path to file
     * @return array Scan result with 'safe', 'threats', 'mime_type'
     */
    public function scanFile(string $filePath): array {
        $result = [
            'safe' => true,
            'threats' => [],
            'mime_type' => null,
            'size' => 0,
        ];
        
        if (!file_exists($filePath)) {
            $result['safe'] = false;
            $result['threats'][] = 'File does not exist';
            return $result;
        }
        
        $result['size'] = filesize($filePath);
        
        // Get MIME type
        $mimeType = $this->getMimeType($filePath);
        $result['mime_type'] = $mimeType;
        
        // Validate file signature
        if (!$this->validateFileSignature($filePath, $mimeType)) {
            $result['safe'] = false;
            $result['threats'][] = 'File signature does not match MIME type';
        }
        
        // Scan for malicious patterns
        $maliciousPatterns = $this->detectMaliciousPatterns($filePath);
        if (!empty($maliciousPatterns)) {
            $result['safe'] = false;
            $result['threats'] = array_merge($result['threats'], $maliciousPatterns);
        }
        
        return $result;
    }
    
    /**
     * Validate file type against allowed types
     * 
     * @param string $filePath Path to file
     * @param array $allowedTypes Allowed MIME types
     * @return bool True if valid
     */
    public function validateFileType(string $filePath, array $allowedTypes): bool {
        $mimeType = $this->getMimeType($filePath);
        return in_array($mimeType, $allowedTypes);
    }
    
    /**
     * Check if file is a valid image
     * 
     * @param string $filePath Path to file
     * @return bool True if valid image
     */
    public function isValidImage(string $filePath): bool {
        // Check MIME type
        $mimeType = $this->getMimeType($filePath);
        if (!in_array($mimeType, self::ALLOWED_IMAGE_TYPES)) {
            return false;
        }
        
        // Validate with getimagesize
        $imageInfo = @getimagesize($filePath);
        if ($imageInfo === false) {
            return false;
        }
        
        // Validate file signature
        if (!$this->validateFileSignature($filePath, $mimeType)) {
            return false;
        }
        
        return true;
    }
    
    /**
     * Generate safe random filename
     * Preserves extension, generates random name
     * 
     * @param string $originalName Original filename
     * @return string Safe filename
     */
    public function generateSafeFilename(string $originalName): string {
        // Get extension
        $ext = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));
        
        // Sanitize extension (only alphanumeric)
        $ext = preg_replace('/[^a-z0-9]/', '', $ext);
        
        // Limit extension length
        if (strlen($ext) > 10) {
            $ext = substr($ext, 0, 10);
        }
        
        // Generate random name
        $randomName = bin2hex(random_bytes(16));
        
        // Combine
        return $randomName . '.' . $ext;
    }
    
    /**
     * Get MIME type of file
     * 
     * @param string $filePath Path to file
     * @return string MIME type
     */
    public function getMimeType(string $filePath): string {
        // Method 1: finfo (preferred)
        if (function_exists('finfo_open')) {
            $finfo = finfo_open(FILEINFO_MIME_TYPE);
            if ($finfo) {
                $mimeType = finfo_file($finfo, $filePath);
                finfo_close($finfo);
                if ($mimeType) return $mimeType;
            }
        }
        // Method 2: mime_content_type fallback
        if (function_exists('mime_content_type')) {
            $mimeType = mime_content_type($filePath);
            if ($mimeType) return $mimeType;
        }
        // Method 3: magic bytes (works even without extensions — e.g. PHP temp files)
        $magic = $this->detectMimeFromMagicBytes($filePath);
        if ($magic) return $magic;
        // Method 4: extension-based last resort
        $ext = strtolower(pathinfo($filePath, PATHINFO_EXTENSION));
        $extMap = [
            'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg',
            'png' => 'image/png', 'gif' => 'image/gif', 'webp' => 'image/webp',
        ];
        return $extMap[$ext] ?? 'application/octet-stream';
    }

    /**
     * Detect MIME type by reading file magic bytes (no PHP extensions needed)
     */
    private function detectMimeFromMagicBytes(string $filePath): ?string {
        $fp = @fopen($filePath, 'rb');
        if (!$fp) return null;
        $bytes = fread($fp, 12);
        fclose($fp);
        $hex = strtoupper(bin2hex($bytes));

        if (str_starts_with($hex, 'FFD8FF'))     return 'image/jpeg';
        if (str_starts_with($hex, '89504E47'))   return 'image/png';
        if (str_starts_with($hex, '47494638'))   return 'image/gif';  // GIF87a / GIF89a
        // RIFF....WEBP
        if (str_starts_with($hex, '52494646') && substr($hex, 16, 8) === '57454250') return 'image/webp';

        return null;
    }
    
    /**
     * Validate file signature (magic bytes)
     * 
     * @param string $filePath Path to file
     * @param string $mimeType Expected MIME type
     * @return bool True if signature matches
     */
    private function validateFileSignature(string $filePath, string $mimeType): bool {
        if (!isset(self::FILE_SIGNATURES[$mimeType])) {
            // No signature defined for this type, skip validation
            return true;
        }
        
        $fp = fopen($filePath, 'rb');
        if (!$fp) {
            return false;
        }
        
        $signatures = self::FILE_SIGNATURES[$mimeType];
        $valid = false;
        
        foreach ($signatures as $signature) {
            fseek($fp, $signature['offset']);
            $bytes = fread($fp, strlen($signature['bytes']) / 2);
            $hex = strtoupper(bin2hex($bytes));
            
            if ($hex === $signature['bytes']) {
                $valid = true;
                break;
            }
        }
        
        fclose($fp);
        return $valid;
    }
    
    /**
     * Detect malicious patterns in file content
     * 
     * @param string $filePath Path to file
     * @return array Array of detected threats
     */
    private function detectMaliciousPatterns(string $filePath): array {
        $threats = [];
        
        // Read first 8KB of file (enough to detect most threats)
        $content = file_get_contents($filePath, false, null, 0, 8192);
        if ($content === false) {
            return ['Unable to read file content'];
        }
        
        // Check for malicious patterns
        foreach (self::MALICIOUS_PATTERNS as $pattern) {
            if (preg_match($pattern, $content)) {
                $threats[] = 'Malicious pattern detected: ' . $pattern;
            }
        }
        
        // Check for double extensions (e.g., file.php.jpg)
        $filename = basename($filePath);
        if (preg_match('/\.(php|phtml|php3|php4|php5|phar|exe|sh|bat|cmd)\./i', $filename)) {
            $threats[] = 'Suspicious double extension detected';
        }
        
        return $threats;
    }
    
    /**
     * Get file extension from MIME type
     * 
     * @param string $mimeType MIME type
     * @return string File extension
     */
    public function getExtensionFromMimeType(string $mimeType): string {
        $extensions = [
            'image/jpeg' => 'jpg',
            'image/png' => 'png',
            'image/gif' => 'gif',
            'image/webp' => 'webp',
            'application/pdf' => 'pdf',
            'text/plain' => 'txt',
            'application/json' => 'json',
        ];
        
        return $extensions[$mimeType] ?? 'bin';
    }
}

