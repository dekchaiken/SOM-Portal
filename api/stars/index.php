<?php
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];

// GET — list post IDs starred by this user
if ($method === 'GET') {
    $stars   = readJson('stars.json');
    $myStars = array_values(array_filter($stars, fn($s) => ($s['user_id'] ?? '') === $payload['sub']));
    $postIds = array_column($myStars, 'post_id');
    respondOk($postIds);
}

// POST — star a post (idempotent)
if ($method === 'POST') {
    requireCsrf();
    apiRateLimit($payload['sub'], 'stars');
    $body   = getBody();
    $postId = trim($body['post_id'] ?? '');
    if (!$postId) respondError('post_id required');

    // Verify post exists and is not deleted
    $posts = readJson('board.json');
    $post  = null;
    foreach ($posts as $p) {
        if ($p['id'] === $postId && empty($p['deleted_at'])) { $post = $p; break; }
    }
    if (!$post) respondError('Post not found', 404);

    $stars = readJson('stars.json');

    // Idempotent — already starred
    foreach ($stars as $s) {
        if (($s['user_id'] ?? '') === $payload['sub'] && ($s['post_id'] ?? '') === $postId) {
            respondOk(null, 'Already starred');
        }
    }

    $stars[] = [
        'id'         => genId('star'),
        'user_id'    => $payload['sub'],
        'post_id'    => $postId,
        'starred_at' => date('c'),
    ];
    writeJson('stars.json', $stars);
    logActivity('board_star', ['post_id' => $postId], $payload['sub'], $payload['name']);
    respondOk(null, 'Starred');
}

// DELETE — unstar a post
if ($method === 'DELETE') {
    requireCsrf();
    $postId = trim($_GET['post_id'] ?? '');
    if (!$postId) respondError('post_id required');

    $stars    = readJson('stars.json');
    $filtered = array_values(array_filter($stars, fn($s) =>
        !($s['user_id'] === $payload['sub'] && $s['post_id'] === $postId)
    ));
    writeJson('stars.json', $filtered);
    logActivity('board_unstar', ['post_id' => $postId], $payload['sub'], $payload['name']);
    respondOk(null, 'Unstarred');
}

respondError('Method not allowed', 405);
