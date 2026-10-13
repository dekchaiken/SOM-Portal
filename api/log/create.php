<?php
/**
 * Create Activity Log Entry
 * POST endpoint for logging user activities
 */

require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();

// Parse request body
$input = json_decode(file_get_contents('php://input'), true);

$action   = $input['action']    ?? '';
$detail   = $input['detail']    ?? [];
$userId   = $payload['user_id'] ?? '';
$userName = $payload['name']    ?? '';

if (!$action) {
    respondError('Action is required', 400);
}

// Ensure detail is an array
if (!is_array($detail)) {
    $detail = ['info' => $detail];
}

// Log the activity using the helper function
logActivity($action, $detail, $userId, $userName);

respondOk(['message' => 'Activity logged successfully']);
