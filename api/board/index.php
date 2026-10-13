<?php
require_once __DIR__ . '/../helpers.php';
require_once __DIR__ . '/../cache/CacheManager.php';

$payload = requireAuth();
requirePagePermission($payload, 'board');
$method  = $_SERVER['REQUEST_METHOD'];
$id      = $_GET['id'] ?? '';

$cache = new CacheManager();

// GET — poll for new posts since a given timestamp (?since=ISO)
if ($method === 'GET' && isset($_GET['since'])) {
    $since = $_GET['since'];
    $posts = readJson('board.json');
    $new   = array_values(array_filter($posts, function($p) use ($since) {
        return empty($p['deleted_at']) && ($p['created_at'] ?? '') > $since;
    }));
    respondOk(['count' => count($new), 'posts' => $new]);
}

// GET — list all posts (search/filter/pagination/starred supported)
if ($method === 'GET') {
    apiRateLimit($payload['sub'], 'board');
    
    // Don't cache - need real-time updates
    $posts     = readJson('board.json');
    $search    = strtolower($_GET['search'] ?? '');
    $boardType = $_GET['board_type'] ?? '';
    $status    = $_GET['status'] ?? '';
    $starredOnly = !empty($_GET['starred']);
    $authorId  = $_GET['author_id'] ?? '';   // filter to a specific author's posts

    // Always exclude soft-deleted posts
    $posts = array_values(array_filter($posts, fn($p) => empty($p['deleted_at'])));

    if ($boardType) {
        $posts = array_values(array_filter($posts, fn($p) => ($p['board_type'] ?? '') === $boardType));
    }
    if ($status && in_array($status, ['open','in_progress','resolved'])) {
        $posts = array_values(array_filter($posts, fn($p) => ($p['status'] ?? 'open') === $status));
    }
    // Filter by author (used by profile page — only own posts, or admin viewing any user)
    if ($authorId) {
        $posts = array_values(array_filter($posts, fn($p) => ($p['author_id'] ?? '') === $authorId));
    }
    if ($search) {
        $posts = array_values(array_filter($posts, function($p) use ($search) {
            return str_contains(strtolower($p['title']       ?? ''), $search)
                || str_contains(strtolower($p['content']     ?? ''), $search)
                || str_contains(strtolower($p['author_name'] ?? ''), $search);
        }));
        logActivity('board_search', ['query' => $search, 'board_type' => $boardType, 'status' => $status], $payload['sub'], $payload['name']);
    }

    // Filter by starred (personal bookmarks)
    if ($starredOnly) {
        $stars   = readJson('stars.json');
        $myStars = array_column(array_filter($stars, fn($s) => ($s['user_id'] ?? '') === $payload['sub']), 'post_id');
        $posts   = array_values(array_filter($posts, fn($p) => in_array($p['id'], $myStars)));
    }

    // Sort: pinned first, then by created_at desc
    usort($posts, function($a, $b) {
        if (($b['pinned'] ?? false) !== ($a['pinned'] ?? false)) {
            return ($b['pinned'] ?? false) ? 1 : -1;
        }
        return strcmp($b['created_at'] ?? '', $a['created_at'] ?? '');
    });

    // Pagination
    $total  = count($posts);
    $limit  = isset($_GET['limit'])  ? max(1, min(50, (int)$_GET['limit']))  : 12;
    $offset = isset($_GET['offset']) ? max(0, (int)$_GET['offset']) : 0;
    $paged  = array_slice(array_values($posts), $offset, $limit);

    // Enrich with personal starred status
    $stars   = readJson('stars.json');
    $myStars = array_column(array_filter($stars, fn($s) => ($s['user_id'] ?? '') === $payload['sub']), 'post_id');
    foreach ($paged as &$p) {
        $p['starred'] = in_array($p['id'], $myStars);
    }
    unset($p);

    $result = ['items' => $paged, 'total' => $total];
    
    respondOk($result);
}

// POST — create post
if ($method === 'POST') {
    requireCsrf();
    apiRateLimit($payload['sub'], 'board');
    $body     = getBody();
    $title    = trim($body['title'] ?? '');
    $content  = trim($body['content'] ?? '');
    $mentions = $body['mentions'] ?? [];
    $status   = $body['status'] ?? 'open';

    if (!$title) respondError('Title is required');
    if (mb_strlen($title) > 300) respondError('Title too long (max 300 chars)');
    if (mb_strlen($content) > 20000) respondError('Content too long (max 20,000 chars)');
    if (!in_array($status, ['open','in_progress','resolved'])) $status = 'open';

    $post = [
        'id'                   => genId('post'),
        'title'                => $title,
        'content'              => $content,
        'mentions'             => $mentions,
        'status'               => $status,
        'image_url'            => $body['image_url'] ?? null,
        'board_type'           => $body['board_type'] ?? '',
        'board_type_name'      => $body['board_type_name'] ?? '',
        'service_type_id'      => $body['service_type_id'] ?? '',
        'service_type_name'    => $body['service_type_name'] ?? '',
        'service_subtype_id'   => $body['service_subtype_id'] ?? '',
        'service_subtype_name' => $body['service_subtype_name'] ?? '',
        'pinned'               => false,
        'edit_history'         => [],
        'author_id'            => $payload['sub'],
        'author_name'          => $payload['name'],
        'author_role'          => $payload['role'],
        'created_at'           => date('c'),
        'updated_at'           => date('c'),
        'deleted_at'           => null,
        'deleted_by'           => null,
        'deleted_by_name'      => null,
    ];

    $posts = readJson('board.json');
    $posts[] = $post;
    writeJson('board.json', $posts);

    // Notify mentioned users
    if (!empty($mentions)) {
        $notifs = readJson('notifications.json');
        $hasAllMention = false;
        foreach ($mentions as $m) {
            if (($m['id'] ?? '') === '__all__') { $hasAllMention = true; break; }
        }
        if ($hasAllMention) {
            $allUsers = readJson('users.json');
            foreach ($allUsers as $u) {
                $mid = $u['id'];
                if ($mid === $payload['sub']) continue;
                $notifs[] = [
                    'id'             => genId('notif'),
                    'user_id'        => $mid,
                    'type'           => 'mention',
                    'title'          => $payload['name'] . ' mentioned @allsm in a post',
                    'body'           => mb_substr($content, 0, 120),
                    'post_id'        => $post['id'],
                    'post_title'     => $title,
                    'read'           => false,
                    'from_user_id'   => $payload['sub'],
                    'from_user_name' => $payload['name'],
                    'created_at'     => date('c'),
                ];
            }
        } else {
            foreach ($mentions as $m) {
                $mid = $m['id'] ?? '';
                if (!$mid || $mid === $payload['sub']) continue;
                $notifs[] = [
                    'id'             => genId('notif'),
                    'user_id'        => $mid,
                    'type'           => 'mention',
                    'title'          => $payload['name'] . ' mentioned you in a post',
                    'body'           => mb_substr($content, 0, 120),
                    'post_id'        => $post['id'],
                    'post_title'     => $title,
                    'read'           => false,
                    'from_user_id'   => $payload['sub'],
                    'from_user_name' => $payload['name'],
                    'created_at'     => date('c'),
                ];
            }
        }
        writeJson('notifications.json', $notifs);
    }

    logActivity('board_create', ['post_id' => $post['id'], 'title' => $title, 'board_type' => $body['board_type_name'] ?? '', 'status' => $status], $payload['sub'], $payload['name']);
    
    respondOk($post, 'Post created');
}

// PUT — update post
if ($method === 'PUT') {
    requireCsrf();
    if (!$id) respondError('Post ID required');
    $body  = getBody();
    $posts = readJson('board.json');
    $found = false;
    $logDetails = ['post_id' => $id];

    foreach ($posts as &$p) {
        if ($p['id'] === $id) {
            // Only author or lead/admin can edit
            $canEdit = ($p['author_id'] === $payload['sub'])
                    || in_array($payload['role'], LEAD_ROLES);
            if (!$canEdit) respondError('Not authorized to edit this post', 403);

            // Snapshot history BEFORE mutations
            $histEntry = [
                'edited_at'   => date('c'),
                'editor_id'   => $payload['sub'],
                'editor_name' => $payload['name'],
                'old_title'   => $p['title'],
                'old_content' => $p['content'] ?? '',
                'old_status'  => $p['status'] ?? 'open',
            ];
            $p['edit_history'] = array_slice(
                array_merge([$histEntry], $p['edit_history'] ?? []),
                0, 20
            );

            // Apply updates
            if (isset($body['title']))                { $p['title']                = trim($body['title']); $logDetails['title'] = $p['title']; }
            if (isset($body['content']))              $p['content']              = $body['content'];
            if (isset($body['image_url']))            $p['image_url']            = $body['image_url'];
            if (isset($body['board_type']))           $p['board_type']           = $body['board_type'];
            if (isset($body['board_type_name']))      $p['board_type_name']      = $body['board_type_name'];
            if (isset($body['service_type_id']))      $p['service_type_id']      = $body['service_type_id'];
            if (isset($body['service_type_name']))    $p['service_type_name']    = $body['service_type_name'];
            if (isset($body['service_subtype_id']))   $p['service_subtype_id']   = $body['service_subtype_id'];
            if (isset($body['service_subtype_name'])) $p['service_subtype_name'] = $body['service_subtype_name'];

            // Status change
            if (isset($body['status'])) {
                $allowed = ['open', 'in_progress', 'resolved'];
                if (!in_array($body['status'], $allowed)) respondError('Invalid status');
                $oldStatus = $histEntry['old_status'];
                $p['status'] = $body['status'];
                if ($p['status'] !== $oldStatus) {
                    $logDetails['status_from'] = $oldStatus;
                    $logDetails['status_to']   = $p['status'];
                }
            }

            $p['updated_at'] = date('c');
            $found = true;
            break;
        }
    }
    unset($p);

    if (!$found) respondError('Post not found', 404);
    writeJson('board.json', $posts);

    // Log status change separately if it happened
    if (isset($logDetails['status_from'])) {
        logActivity('board_status_change', [
            'post_id' => $id,
            'title'   => $logDetails['title'] ?? '',
            'from'    => $logDetails['status_from'],
            'to'      => $logDetails['status_to'],
        ], $payload['sub'], $payload['name']);
    }
    logActivity('board_update', $logDetails, $payload['sub'], $payload['name']);
    
    respondOk(null, 'Post updated');
}

// PATCH — toggle pin
if ($method === 'PATCH') {
    requireCsrf();
    if (!$id) respondError('Post ID required');
    requireRole($payload, LEAD_ROLES);

    $posts = readJson('board.json');
    $found = false;
    foreach ($posts as &$p) {
        if ($p['id'] === $id) {
            $p['pinned'] = !($p['pinned'] ?? false);
            $found = true;
            break;
        }
    }
    unset($p);

    if (!$found) respondError('Post not found', 404);
    writeJson('board.json', $posts);
    $pinned = null;
    foreach ($posts as $p) { if ($p['id'] === $id) { $pinned = $p['pinned']; break; } }
    logActivity('board_pin', ['post_id' => $id, 'pinned' => $pinned], $payload['sub'], $payload['name']);
    
    respondOk(null, 'Pin toggled');
}

// DELETE — soft-delete post (sets deleted_at; admin can hard-delete via trash endpoint)
if ($method === 'DELETE') {
    requireCsrf();
    if (!$id) respondError('Post ID required');
    $posts = readJson('board.json');
    $found = false;

    foreach ($posts as &$p) {
        if ($p['id'] !== $id) continue;
        if (!empty($p['deleted_at'])) respondError('Post already deleted', 404);

        $canDelete = ($p['author_id'] === $payload['sub'])
                  || in_array($payload['role'], LEAD_ROLES);
        if (!$canDelete) respondError('Not authorized to delete this post', 403);

        $p['deleted_at']      = date('c');
        $p['deleted_by']      = $payload['sub'];
        $p['deleted_by_name'] = $payload['name'];
        $found = true;
        $deletedTitle = $p['title'] ?? '';
        break;
    }
    unset($p);

    if (!$found) respondError('Post not found', 404);
    writeJson('board.json', $posts);
    logActivity('board_delete', ['post_id' => $id, 'title' => $deletedTitle, 'soft' => true], $payload['sub'], $payload['name']);
    
    respondOk(null, 'Post deleted');
}

respondError('Method not allowed', 405);
