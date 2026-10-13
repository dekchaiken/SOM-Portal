<?php
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
requireRole($payload, LEAD_ROLES);

$method = $_SERVER['REQUEST_METHOD'];
$entity = $_GET['entity'] ?? 'post'; // 'post' | 'comment'
$id     = $_GET['id']     ?? '';

// Determine retention days from settings
$retentionDays = (int)(SYS_SETTINGS['trash_retention_days'] ?? 30);

// ── GET — list trash items ─────────────────────────────────────────────────────
if ($method === 'GET') {
    $result = [];

    if ($entity !== 'comment') {
        $posts   = readJson('board.json');
        $deleted = array_values(array_filter($posts, fn($p) => !empty($p['deleted_at'])));
        usort($deleted, fn($a, $b) => strcmp($b['deleted_at'], $a['deleted_at']));
        foreach ($deleted as &$p) {
            $daysAgo  = (time() - strtotime($p['deleted_at'])) / 86400;
            $daysLeft = max(0, (int)ceil($retentionDays - $daysAgo));
            $p['days_left'] = $daysLeft;
            $p['entity']    = 'post';
        }
        unset($p);
        $result['posts'] = $deleted;
    }

    if ($entity !== 'post') {
        $comments = readJson('board-comments.json');
        $deleted  = array_values(array_filter($comments, fn($c) => !empty($c['deleted_at'])));
        usort($deleted, fn($a, $b) => strcmp($b['deleted_at'], $a['deleted_at']));
        foreach ($deleted as &$c) {
            $daysAgo  = (time() - strtotime($c['deleted_at'])) / 86400;
            $daysLeft = max(0, (int)ceil($retentionDays - $daysAgo));
            $c['days_left'] = $daysLeft;
            $c['entity']    = 'comment';
        }
        unset($c);
        $result['comments'] = $deleted;
    }

    respondOk($result);
}

// ── POST — restore item ────────────────────────────────────────────────────────
if ($method === 'POST') {
    if (!$id) respondError('ID required');
    $action = $_GET['action'] ?? '';
    if ($action !== 'restore') respondError('Unknown action');

    if ($entity === 'comment') {
        $items = readJson('board-comments.json');
        $found = false;
        foreach ($items as &$c) {
            if ($c['id'] === $id && !empty($c['deleted_at'])) {
                $c['deleted_at'] = $c['deleted_by'] = $c['deleted_by_name'] = null;
                $found = true;
                break;
            }
        }
        unset($c);
        if (!$found) respondError('Comment not found in trash', 404);
        writeJson('board-comments.json', $items);
        logActivity('comment_restore', ['comment_id' => $id], $payload['sub'], $payload['name']);
    } else {
        $items = readJson('board.json');
        $found = false;
        foreach ($items as &$p) {
            if ($p['id'] === $id && !empty($p['deleted_at'])) {
                $p['deleted_at'] = $p['deleted_by'] = $p['deleted_by_name'] = null;
                $found = true;
                break;
            }
        }
        unset($p);
        if (!$found) respondError('Post not found in trash', 404);
        writeJson('board.json', $items);
        logActivity('board_restore', ['post_id' => $id], $payload['sub'], $payload['name']);
    }

    respondOk(null, 'Restored successfully');
}

// ── DELETE — hard-delete or purge expired ─────────────────────────────────────
if ($method === 'DELETE') {
    // Purge all items past retention window
    if (isset($_GET['purge'])) {
        requireRole($payload, ADMIN_ROLES); // purge is admin-only
        $cutoff   = time() - ($retentionDays * 86400);
        $posts    = readJson('board.json');
        $comments = readJson('board-comments.json');

        $postsBefore    = count(array_filter($posts,    fn($p) => !empty($p['deleted_at'])));
        $commentsBefore = count(array_filter($comments, fn($c) => !empty($c['deleted_at'])));

        $posts    = array_values(array_filter($posts, function($p) use ($cutoff) {
            if (empty($p['deleted_at'])) return true;
            return strtotime($p['deleted_at']) > $cutoff; // keep if NOT yet expired
        }));
        $comments = array_values(array_filter($comments, function($c) use ($cutoff) {
            if (empty($c['deleted_at'])) return true;
            return strtotime($c['deleted_at']) > $cutoff;
        }));

        $purgedPosts    = $postsBefore    - count(array_filter($posts,    fn($p) => !empty($p['deleted_at'])));
        $purgedComments = $commentsBefore - count(array_filter($comments, fn($c) => !empty($c['deleted_at'])));

        writeJson('board.json', $posts);
        writeJson('board-comments.json', $comments);
        logActivity('board_auto_purge', [
            'posts_purged'    => $purgedPosts,
            'comments_purged' => $purgedComments,
            'retention_days'  => $retentionDays,
        ], $payload['sub'], $payload['name']);
        respondOk(['posts_purged' => $purgedPosts, 'comments_purged' => $purgedComments], 'Purge complete');
    }

    // Hard-delete single item (admin only)
    requireRole($payload, ADMIN_ROLES);
    if (!$id) respondError('ID required');

    if ($entity === 'comment') {
        $items    = readJson('board-comments.json');
        $filtered = array_values(array_filter($items, fn($c) => $c['id'] !== $id));
        if (count($filtered) === count($items)) respondError('Comment not found', 404);
        writeJson('board-comments.json', $filtered);
        logActivity('board_hard_delete', ['entity' => 'comment', 'id' => $id], $payload['sub'], $payload['name']);
    } else {
        $items    = readJson('board.json');
        $filtered = array_values(array_filter($items, fn($p) => $p['id'] !== $id));
        if (count($filtered) === count($items)) respondError('Post not found', 404);
        writeJson('board.json', $filtered);
        logActivity('board_hard_delete', ['entity' => 'post', 'id' => $id], $payload['sub'], $payload['name']);
    }

    respondOk(null, 'Permanently deleted');
}

respondError('Method not allowed', 405);
