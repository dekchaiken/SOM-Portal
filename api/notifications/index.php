<?php
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];
$userId  = $payload['sub'];

// GET — list notifications for current user
if ($method === 'GET') {
    $all  = readJson('notifications.json');
    $mine = array_values(array_filter($all, fn($n) => ($n['user_id'] ?? '') === $userId));
    usort($mine, fn($a, $b) => strcmp($b['created_at'] ?? '', $a['created_at'] ?? ''));
    $mine   = array_slice($mine, 0, 50);
    $unread = count(array_filter($mine, fn($n) => !($n['read'] ?? false)));
    respondOk(['notifications' => $mine, 'unread' => $unread]);
}

// PATCH — mark as read (single or all)
if ($method === 'PATCH') {
    $body    = getBody();
    $notifId = $body['id'] ?? 'all';
    $all     = readJson('notifications.json');
    foreach ($all as &$n) {
        if (($n['user_id'] ?? '') !== $userId) continue;
        if ($notifId === 'all' || $n['id'] === $notifId) {
            $n['read'] = true;
        }
    }
    unset($n);
    writeJson('notifications.json', $all);
    respondOk(null, 'Marked as read');
}

// DELETE — clear read notifications for current user
if ($method === 'DELETE') {
    $all      = readJson('notifications.json');
    $filtered = array_values(array_filter($all,
        fn($n) => ($n['user_id'] ?? '') !== $userId || !($n['read'] ?? false)
    ));
    writeJson('notifications.json', $filtered);
    respondOk(null, 'Cleared');
}

respondError('Method not allowed', 405);
