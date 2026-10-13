<?php
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];
$isAdmin = in_array($payload['role'] ?? '', LEAD_ROLES);

// ── GET — anyone authenticated can read colors ────────────────────────────────
if ($method === 'GET') {
    $colors = readJson('user-colors.json') ?: [];
    respondOk($colors);
}

// All other methods: admin/lead only
if (!$isAdmin) {
    respondError('Unauthorized', 403);
}

// ── POST — set user colors ────────────────────────────────────────────────────
if ($method === 'POST') {
    $body = json_decode(file_get_contents('php://input'), true) ?: [];

    if (empty($body)) {
        respondError('No color data provided');
    }

    // Validate: all values must be valid hex colors
    foreach ($body as $uid => $color) {
        if (!preg_match('/^#[0-9a-fA-F]{6}$/', $color)) {
            respondError("Invalid color for user $uid: $color");
        }
    }

    $colors = readJson('user-colors.json') ?: [];
    foreach ($body as $uid => $color) {
        $colors[$uid] = $color;
    }

    if (writeJson('user-colors.json', $colors)) {
        logActivity('schedule_color_update', [
            'changed' => array_keys($body),
            'colors'  => $body,
        ], $payload['sub'], $payload['name']);
        respondOk($colors, 'Colors saved successfully');
    } else {
        respondError('Failed to save colors', 500);
    }
}

respondError('Method not allowed', 405);
?>
