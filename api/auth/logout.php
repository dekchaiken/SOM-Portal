<?php
require_once __DIR__ . '/../helpers.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respondError('Method not allowed', 405);
}

// super_viewer must be able to log itself out even though it's read-only.
$payload = requireAuth(true, true);
logActivity('logout', [], $payload['sub'], $payload['name'] ?? '');
logSecurity('logout', ['username' => $payload['username'] ?? ''], $payload['sub'], $payload['name'] ?? '');
respondOk(null, 'Logged out');
