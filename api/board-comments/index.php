<?php
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];

// GET — batch count: ?counts=id1,id2,id3  (excludes soft-deleted)
if ($method === 'GET' && isset($_GET['counts'])) {
    $postIds = array_filter(array_map('trim', explode(',', $_GET['counts'])));
    if (!$postIds) respondOk([]);
    $all    = readJson('board-comments.json');
    $result = [];
    foreach ($postIds as $pid) {
        $result[$pid] = count(array_filter($all, fn($c) =>
            ($c['post_id'] ?? '') === $pid && empty($c['deleted_at'])
        ));
    }
    respondOk($result);
}

// GET — list comments for a post (excludes soft-deleted)
if ($method === 'GET') {
    $postId = $_GET['post_id'] ?? '';
    if (!$postId) respondError('post_id required');
    $all = readJson('board-comments.json');
    $comments = array_values(array_filter($all, fn($c) =>
        ($c['post_id'] ?? '') === $postId && empty($c['deleted_at'])
    ));
    usort($comments, fn($a, $b) => strcmp($a['created_at'] ?? '', $b['created_at'] ?? ''));
    respondOk($comments);
}

// POST — create comment + trigger notifications
if ($method === 'POST') {
    requireCsrf();
    $body     = getBody();
    $postId   = trim($body['post_id'] ?? '');
    $content  = trim($body['content'] ?? '');
    $mentions = $body['mentions'] ?? []; // [{id, name}, ...]

    if (!$postId)  respondError('post_id required');
    if (!$content) respondError('Content required');
    if (mb_strlen($content) > 5000) respondError('Comment too long (max 5,000 chars)');
    apiRateLimit($payload['sub'], 'comments');

    // Verify post exists
    $posts = readJson('board.json');
    $post  = null;
    foreach ($posts as $p) {
        if ($p['id'] === $postId) { $post = $p; break; }
    }
    if (!$post) respondError('Post not found', 404);

    $comment = [
        'id'             => genId('cmt'),
        'post_id'        => $postId,
        'content'        => $content,
        'mentions'       => $mentions,
        'author_id'      => $payload['sub'],
        'author_name'    => $payload['name'],
        'created_at'     => date('c'),
        'deleted_at'     => null,
        'deleted_by'     => null,
        'deleted_by_name'=> null,
    ];

    $all   = readJson('board-comments.json');
    $all[] = $comment;
    writeJson('board-comments.json', $all);

    // Build notifications
    $notifs   = readJson('notifications.json');
    $notified = [];

    // Expand @allsm → all users
    $hasAllMention = false;
    foreach ($mentions as $m) {
        if (($m['id'] ?? '') === '__all__') { $hasAllMention = true; break; }
    }
    if ($hasAllMention) {
        $allUsers = readJson('users.json');
        foreach ($allUsers as $u) {
            $mid = $u['id'];
            if ($mid === $payload['sub']) continue;
            $notified[] = $mid;
            $notifs[] = [
                'id'             => genId('notif'),
                'user_id'        => $mid,
                'type'           => 'mention',
                'title'          => $payload['name'] . ' mentioned @allsm',
                'body'           => mb_substr($content, 0, 120),
                'post_id'        => $postId,
                'post_title'     => $post['title'] ?? '',
                'read'           => false,
                'from_user_id'   => $payload['sub'],
                'from_user_name' => $payload['name'],
                'created_at'     => date('c'),
            ];
        }
    } else {
        // Notify each individually mentioned user
        foreach ($mentions as $m) {
            $mid = $m['id'] ?? '';
            if (!$mid || $mid === $payload['sub']) continue;
            $notified[] = $mid;
            $notifs[] = [
                'id'             => genId('notif'),
                'user_id'        => $mid,
                'type'           => 'mention',
                'title'          => $payload['name'] . ' mentioned you',
                'body'           => mb_substr($content, 0, 120),
                'post_id'        => $postId,
                'post_title'     => $post['title'] ?? '',
                'read'           => false,
                'from_user_id'   => $payload['sub'],
                'from_user_name' => $payload['name'],
                'created_at'     => date('c'),
            ];
        }
    }

    // Notify post author (if not self, not already notified)
    $authorId = $post['author_id'] ?? '';
    if ($authorId && $authorId !== $payload['sub'] && !in_array($authorId, $notified)) {
        $notifs[] = [
            'id'             => genId('notif'),
            'user_id'        => $authorId,
            'type'           => 'comment',
            'title'          => $payload['name'] . ' commented on your post',
            'body'           => mb_substr($content, 0, 120),
            'post_id'        => $postId,
            'post_title'     => $post['title'] ?? '',
            'read'           => false,
            'from_user_id'   => $payload['sub'],
            'from_user_name' => $payload['name'],
            'created_at'     => date('c'),
        ];
    }

    writeJson('notifications.json', $notifs);

    logActivity('board_comment', [
        'post_id'    => $postId,
        'comment_id' => $comment['id'],
        'mentions'   => count($mentions),
    ], $payload['sub'], $payload['name']);

    respondOk($comment, 'Comment added');
}

// PATCH — edit comment content (author only)
if ($method === 'PATCH') {
    requireCsrf();
    $id   = $_GET['id'] ?? '';
    $body = getBody();
    $content = trim($body['content'] ?? '');
    if (!$id)      respondError('Comment ID required');
    if (!$content) respondError('Content required');
    if (mb_strlen($content) > 5000) respondError('Comment too long (max 5,000 chars)');

    $all   = readJson('board-comments.json');
    $found = false;
    foreach ($all as &$c) {
        if ($c['id'] !== $id) continue;
        if (!empty($c['deleted_at'])) respondError('Comment deleted', 404);
        if ($c['author_id'] !== $payload['sub']) respondError('Forbidden', 403);
        $c['content']    = $content;
        $c['updated_at'] = date('c');
        $found = true;
        break;
    }
    unset($c);
    if (!$found) respondError('Comment not found', 404);
    writeJson('board-comments.json', $all);
    logActivity('comment_edit', ['comment_id' => $id], $payload['sub'], $payload['name']);
    respondOk(null, 'Comment updated');
}

// DELETE — soft-delete comment (author or lead/admin)
if ($method === 'DELETE') {
    requireCsrf();
    $id = $_GET['id'] ?? '';
    if (!$id) respondError('Comment ID required');

    $all   = readJson('board-comments.json');
    $found = false;

    foreach ($all as &$c) {
        if ($c['id'] !== $id) continue;
        if (!empty($c['deleted_at'])) respondError('Comment already deleted', 404);
        if ($c['author_id'] !== $payload['sub']
            && !in_array($payload['role'], LEAD_ROLES)) {
            respondError('Forbidden', 403);
        }
        $c['deleted_at']      = date('c');
        $c['deleted_by']      = $payload['sub'];
        $c['deleted_by_name'] = $payload['name'];
        $found = true;
        break;
    }
    unset($c);

    if (!$found) respondError('Comment not found', 404);
    writeJson('board-comments.json', $all);
    logActivity('comment_delete', ['comment_id' => $id, 'soft' => true], $payload['sub'], $payload['name']);
    respondOk(null, 'Comment deleted');
}

respondError('Method not allowed', 405);
