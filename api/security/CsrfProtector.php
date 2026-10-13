<?php
/**
 * CSRF Protection
 * 
 * Implements double-submit cookie pattern for CSRF protection.
 * Tokens are signed with HMAC using JWT_SECRET for validation.
 * 
 * Usage:
 *   $csrf = new CsrfProtector();
 *   $token = $csrf->generateToken();
 *   $csrf->validateToken($token);
 *   $csrf->requireValidToken(); // Middleware
 */

class CsrfProtector {
    private const TOKEN_LIFETIME = 28800; // 8 hours (same as JWT)
    private const COOKIE_NAME = 'csrf_token';
    private const HEADER_NAME = 'X-CSRF-Token';
    
    /**
     * Generate a new CSRF token
     * Format: {timestamp}.{random}.{hmac}
     * 
     * @return string The generated token
     */
    public function generateToken(): string {
        $timestamp = time();
        $random = bin2hex(random_bytes(16));
        $data = "{$timestamp}.{$random}";
        $hmac = hash_hmac('sha256', $data, JWT_SECRET);
        
        $token = "{$data}.{$hmac}";
        
        // Set cookie (NOT httpOnly so JavaScript can read it for double-submit pattern)
        $secure = isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on';
        setcookie(
            self::COOKIE_NAME,
            $token,
            [
                'expires' => $timestamp + self::TOKEN_LIFETIME,
                'path' => '/',
                'httponly' => false,  // Allow JavaScript to read for double-submit
                'secure' => $secure,
                'samesite' => 'Strict'
            ]
        );
        
        return $token;
    }
    
    /**
     * Validate a CSRF token
     * 
     * @param string $token The token to validate
     * @return bool True if valid, false otherwise
     */
    public function validateToken(string $token): bool {
        if (empty($token)) {
            return false;
        }
        
        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            return false;
        }
        
        [$timestamp, $random, $hmac] = $parts;
        
        // Check if token is expired
        if ((int)$timestamp + self::TOKEN_LIFETIME < time()) {
            return false;
        }
        
        // Verify HMAC signature
        $data = "{$timestamp}.{$random}";
        $expectedHmac = hash_hmac('sha256', $data, JWT_SECRET);
        
        if (!hash_equals($expectedHmac, $hmac)) {
            return false;
        }
        
        return true;
    }
    
    /**
     * Get CSRF token from request
     * Checks header first, then POST body
     * 
     * @return string|null The token or null if not found
     */
    public function getTokenFromRequest(): ?string {
        // Header — routed through the shared helper so it survives Apache
        // stripping the custom X-CSRF-Token header under CGI/FastCGI.
        if (function_exists('getRequestHeader')) {
            $t = getRequestHeader(self::HEADER_NAME);
            if ($t !== '') return $t;
        } else {
            $headers = function_exists('getallheaders') ? (getallheaders() ?: []) : [];
            foreach ($headers as $key => $value) {
                if (strcasecmp($key, self::HEADER_NAME) === 0) return (string)$value;
            }
            // $_SERVER fallback for CGI/FastCGI deploys
            $serverKey = 'HTTP_' . strtoupper(str_replace('-', '_', self::HEADER_NAME));
            if (!empty($_SERVER[$serverKey])) return (string)$_SERVER[$serverKey];
            if (!empty($_SERVER['REDIRECT_' . $serverKey])) return (string)$_SERVER['REDIRECT_' . $serverKey];
        }

        // Check POST body
        if (isset($_POST['csrf_token'])) {
            return $_POST['csrf_token'];
        }

        // Check JSON body
        $body = json_decode(file_get_contents('php://input'), true);
        if (isset($body['csrf_token'])) {
            return $body['csrf_token'];
        }

        return null;
    }
    
    /**
     * Get CSRF token from cookie
     * 
     * @return string|null The token or null if not found
     */
    public function getTokenFromCookie(): ?string {
        return $_COOKIE[self::COOKIE_NAME] ?? null;
    }
    
    /**
     * Rotate token (generate new one)
     * Should be called after login/logout
     * 
     * @return string The new token
     */
    public function rotateToken(): string {
        // Delete old cookie
        $this->deleteToken();
        
        // Generate new token
        return $this->generateToken();
    }
    
    /**
     * Delete CSRF token cookie
     */
    public function deleteToken(): void {
        setcookie(
            self::COOKIE_NAME,
            '',
            [
                'expires' => time() - 3600,
                'path' => '/',
                'httponly' => false,
                'samesite' => 'Strict'
            ]
        );
    }
    
    /**
     * Middleware: Require valid CSRF token
     * Validates double-submit cookie pattern
     * Terminates request with 403 if invalid
     */
    public function requireValidToken(): void {
        $requestToken = $this->getTokenFromRequest();
        $cookieToken = $this->getTokenFromCookie();
        
        // Both tokens must be present
        if (!$requestToken || !$cookieToken) {
            $this->logCsrfFailure('missing_token', [
                'has_request_token' => !empty($requestToken),
                'has_cookie_token' => !empty($cookieToken),
            ]);
            $this->respondCsrfError('CSRF token missing');
        }
        
        // Tokens must match (double-submit)
        if (!hash_equals($cookieToken, $requestToken)) {
            $this->logCsrfFailure('token_mismatch', [
                'request_token_prefix' => substr($requestToken, 0, 20),
                'cookie_token_prefix' => substr($cookieToken, 0, 20),
            ]);
            $this->respondCsrfError('CSRF token mismatch');
        }
        
        // Validate token signature and expiry
        if (!$this->validateToken($requestToken)) {
            $this->logCsrfFailure('token_invalid', [
                'token_prefix' => substr($requestToken, 0, 20),
            ]);
            $this->respondCsrfError('CSRF token invalid or expired');
        }
    }
    
    /**
     * Log CSRF failure
     * 
     * @param string $reason Failure reason
     * @param array $detail Additional details
     */
    private function logCsrfFailure(string $reason, array $detail = []): void {
        if (function_exists('logSecurity')) {
            logSecurity('csrf_validation_failed', array_merge([
                'reason' => $reason,
                'method' => $_SERVER['REQUEST_METHOD'] ?? '',
                'path' => strtok($_SERVER['REQUEST_URI'] ?? '', '?'),
            ], $detail));
        }
    }
    
    /**
     * Respond with CSRF error
     * 
     * @param string $message Error message
     */
    private function respondCsrfError(string $message): void {
        http_response_code(403);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode([
            'success' => false,
            'error' => [
                'code' => 'CSRF_VALIDATION_FAILED',
                'message' => $message,
                'timestamp' => date('c'),
            ]
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }
}

