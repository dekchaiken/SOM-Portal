<?php
/**
 * Generate CSRF Token
 * 
 * Endpoint for frontend to get CSRF token
 * Called on page load or after login
 */

require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/../security/CsrfProtector.php';

// No auth required - token generation is public
$csrf = new CsrfProtector();
$token = $csrf->generateToken();

respondOk(['token' => $token], 'CSRF token generated');
