<?php
/**
 * Input Sanitization & Validation
 * 
 * Provides comprehensive input sanitization and validation
 * to prevent XSS, SQL injection, and other injection attacks.
 * 
 * Usage:
 *   $sanitizer = new InputSanitizer();
 *   $clean = $sanitizer->sanitizeString($input);
 *   $valid = $sanitizer->validateEmail($email);
 *   $data = $sanitizer->sanitizeArray($_POST, $schema);
 */

class InputSanitizer {
    // XSS patterns to detect
    private const XSS_PATTERNS = [
        '/<script\b[^>]*>.*?<\/script>/is',
        '/<iframe\b[^>]*>.*?<\/iframe>/is',
        '/javascript:/i',
        '/on\w+\s*=/i', // Event handlers like onclick=
        '/<embed\b[^>]*>/i',
        '/<object\b[^>]*>/i',
        '/vbscript:/i',
        '/data:text\/html/i',
    ];
    
    // SQL injection patterns to detect
    private const SQL_PATTERNS = [
        '/(\bUNION\b.*\bSELECT\b)/i',
        '/(\bSELECT\b.*\bFROM\b)/i',
        '/(\bINSERT\b.*\bINTO\b)/i',
        '/(\bUPDATE\b.*\bSET\b)/i',
        '/(\bDELETE\b.*\bFROM\b)/i',
        '/(\bDROP\b.*\bTABLE\b)/i',
        '/(\bEXEC\b|\bEXECUTE\b)/i',
        '/(\'|\")(\s*)(OR|AND)(\s*)(\'|\")(\s*)=(\s*)(\'|\")/i',
        '/--/i',
        '/;.*--/i',
    ];
    
    /**
     * Sanitize string input
     * Removes HTML tags, trims whitespace, limits length
     * 
     * @param string $input Input string
     * @param int $maxLength Maximum length (default 1000)
     * @return string Sanitized string
     */
    public function sanitizeString(string $input, int $maxLength = 1000): string {
        // Remove null bytes
        $input = str_replace("\0", '', $input);
        
        // Strip HTML tags
        $input = strip_tags($input);
        
        // Trim whitespace
        $input = trim($input);
        
        // Limit length
        if (mb_strlen($input) > $maxLength) {
            $input = mb_substr($input, 0, $maxLength);
        }
        
        return $input;
    }
    
    /**
     * Sanitize HTML input
     * Allows only safe HTML tags, escapes dangerous content
     * 
     * @param string $input HTML input
     * @param array $allowedTags Allowed HTML tags (default: p, br, strong, em, a)
     * @return string Sanitized HTML
     */
    public function sanitizeHtml(string $input, array $allowedTags = ['p', 'br', 'strong', 'em', 'a', 'ul', 'ol', 'li']): string {
        // Remove null bytes
        $input = str_replace("\0", '', $input);
        
        // Build allowed tags string for strip_tags
        $allowedTagsStr = '<' . implode('><', $allowedTags) . '>';
        
        // Strip disallowed tags
        $input = strip_tags($input, $allowedTagsStr);
        
        // Remove event handlers and javascript: URLs
        $input = preg_replace('/on\w+\s*=\s*["\'].*?["\']/i', '', $input);
        $input = preg_replace('/href\s*=\s*["\']javascript:.*?["\']/i', '', $input);
        
        return $input;
    }
    
    /**
     * Validate email address
     * 
     * @param string $email Email address
     * @return bool True if valid
     */
    public function validateEmail(string $email): bool {
        return filter_var($email, FILTER_VALIDATE_EMAIL) !== false;
    }
    
    /**
     * Validate URL
     * 
     * @param string $url URL
     * @return bool True if valid
     */
    public function validateUrl(string $url): bool {
        return filter_var($url, FILTER_VALIDATE_URL) !== false;
    }
    
    /**
     * Detect SQL injection patterns
     * 
     * @param string $input Input string
     * @return bool True if SQL injection detected
     */
    public function detectSqlInjection(string $input): bool {
        foreach (self::SQL_PATTERNS as $pattern) {
            if (preg_match($pattern, $input)) {
                return true;
            }
        }
        return false;
    }
    
    /**
     * Detect XSS patterns
     * 
     * @param string $input Input string
     * @return bool True if XSS detected
     */
    public function detectXss(string $input): bool {
        foreach (self::XSS_PATTERNS as $pattern) {
            if (preg_match($pattern, $input)) {
                return true;
            }
        }
        return false;
    }
    
    /**
     * Sanitize array based on schema
     * 
     * Schema format:
     * [
     *   'field_name' => [
     *     'type' => 'string|html|email|url|int|float|bool',
     *     'required' => true|false,
     *     'max' => 100, // max length for strings
     *     'min' => 0,   // min value for numbers
     *     'allowed_tags' => ['p', 'br'], // for html type
     *   ]
     * ]
     * 
     * @param array $data Input data
     * @param array $schema Validation schema
     * @return array Sanitized data
     * @throws Exception If validation fails
     */
    public function sanitizeArray(array $data, array $schema): array {
        $result = [];
        
        foreach ($schema as $field => $rules) {
            $value = $data[$field] ?? null;
            
            // Check required
            if (($rules['required'] ?? false) && ($value === null || $value === '')) {
                throw new Exception("Field '{$field}' is required");
            }
            
            // Skip if not required and empty
            if ($value === null || $value === '') {
                $result[$field] = $value;
                continue;
            }
            
            // Sanitize based on type
            $type = $rules['type'] ?? 'string';
            $max = $rules['max'] ?? 1000;
            
            switch ($type) {
                case 'string':
                    $value = $this->sanitizeString($value, $max);
                    
                    // Check for malicious content
                    if ($this->detectXss($value)) {
                        throw new Exception("Field '{$field}' contains potentially malicious content");
                    }
                    if ($this->detectSqlInjection($value)) {
                        throw new Exception("Field '{$field}' contains potentially malicious content");
                    }
                    break;
                    
                case 'html':
                    $allowedTags = $rules['allowed_tags'] ?? ['p', 'br', 'strong', 'em'];
                    $value = $this->sanitizeHtml($value, $allowedTags);
                    
                    if (mb_strlen($value) > $max) {
                        $value = mb_substr($value, 0, $max);
                    }
                    break;
                    
                case 'email':
                    $value = $this->sanitizeString($value, 255);
                    if (!$this->validateEmail($value)) {
                        throw new Exception("Field '{$field}' must be a valid email address");
                    }
                    break;
                    
                case 'url':
                    $value = $this->sanitizeString($value, 2000);
                    if (!$this->validateUrl($value)) {
                        throw new Exception("Field '{$field}' must be a valid URL");
                    }
                    break;
                    
                case 'int':
                    $value = filter_var($value, FILTER_VALIDATE_INT);
                    if ($value === false) {
                        throw new Exception("Field '{$field}' must be an integer");
                    }
                    
                    $min = $rules['min'] ?? PHP_INT_MIN;
                    $max = $rules['max'] ?? PHP_INT_MAX;
                    if ($value < $min || $value > $max) {
                        throw new Exception("Field '{$field}' must be between {$min} and {$max}");
                    }
                    break;
                    
                case 'float':
                    $value = filter_var($value, FILTER_VALIDATE_FLOAT);
                    if ($value === false) {
                        throw new Exception("Field '{$field}' must be a number");
                    }
                    
                    $min = $rules['min'] ?? -PHP_FLOAT_MAX;
                    $max = $rules['max'] ?? PHP_FLOAT_MAX;
                    if ($value < $min || $value > $max) {
                        throw new Exception("Field '{$field}' must be between {$min} and {$max}");
                    }
                    break;
                    
                case 'bool':
                    $value = filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
                    if ($value === null) {
                        throw new Exception("Field '{$field}' must be a boolean");
                    }
                    break;
                    
                default:
                    throw new Exception("Unknown field type '{$type}' for field '{$field}'");
            }
            
            $result[$field] = $value;
        }
        
        return $result;
    }
    
    /**
     * Escape HTML entities for output
     * Use this when displaying user-generated content
     * 
     * @param string $input Input string
     * @return string Escaped string
     */
    public function escapeHtml(string $input): string {
        return htmlspecialchars($input, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    }
    
    /**
     * Sanitize filename
     * Removes path traversal attempts and dangerous characters
     * 
     * @param string $filename Original filename
     * @return string Safe filename
     */
    public function sanitizeFilename(string $filename): string {
        // Remove path components
        $filename = basename($filename);
        
        // Remove null bytes
        $filename = str_replace("\0", '', $filename);
        
        // Remove dangerous characters
        $filename = preg_replace('/[^a-zA-Z0-9._-]/', '_', $filename);
        
        // Limit length
        if (mb_strlen($filename) > 255) {
            $ext = pathinfo($filename, PATHINFO_EXTENSION);
            $name = mb_substr(pathinfo($filename, PATHINFO_FILENAME), 0, 250);
            $filename = $name . '.' . $ext;
        }
        
        return $filename;
    }
}

