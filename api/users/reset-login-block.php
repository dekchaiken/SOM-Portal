<?php
require_once __DIR__ . '/../helpers.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respondError('Method not allowed', 405);
}

$payload = requireAuth();
requireRole($payload, ADMIN_ROLES);

$body     = getBody();
$username = trim($body['username'] ?? '');

if (!$username) {
    respondError('Username is required');
}

// Remove the user's entry from rate_limit.json
$key   = substr(hash('sha256', strtolower($username)), 0, 16);
$store = readJson('rate_limit.json');

if (isset($store[$key])) {
    unset($store[$key]);
    writeJson('rate_limit.json', $store);
    logSecurity('login_block_reset', ['username' => $username, 'reset_by' => $payload['username']]);
    respondOk(['message' => 'Login block cleared for user']);
} else {
    respondOk(['message' => 'User was not blocked']);
}
