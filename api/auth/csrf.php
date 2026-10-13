<?php
require_once __DIR__ . '/../helpers.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    respondError('Method not allowed', 405);
}

$payload = requireAuth(true);

require_once __DIR__ . '/../security/CsrfProtector.php';
$csrf = new CsrfProtector();
$csrf->rotateToken();

respondOk(null, 'CSRF token refreshed');
