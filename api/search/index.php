<?php
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
$q       = trim($_GET['q'] ?? '');
$offset  = max(0, (int)($_GET['offset'] ?? 0));
$limit   = 40;

if (!$q || mb_strlen($q) < 2) {
    respondOk(['results' => [], 'total' => 0, 'query' => $q]);
}

$ql      = strtolower($q);
$results = [];

// ── Board posts ──────────────────────────────────────────────────
$posts = readJson('board.json');
foreach ($posts as $p) {
    if (str_contains(strtolower($p['title'] ?? ''), $ql) ||
        str_contains(strtolower($p['content'] ?? ''), $ql)) {
        // Find excerpt around match
        $body    = $p['content'] ?? '';
        $pos     = stripos($body, $q);
        $excerpt = $pos !== false
            ? '...' . mb_substr($body, max(0, $pos - 20), 120) . '...'
            : mb_substr($body, 0, 110);
        $results[] = [
            'type'    => 'post',
            'id'      => $p['id'],
            'title'   => $p['title'] ?? '',
            'excerpt' => $excerpt,
            'meta'    => $p['author_name'] ?? '',
            'badge'   => $p['board_type_name'] ?? 'Post',
            'date'    => $p['created_at'] ?? '',
            'pinned'  => $p['pinned'] ?? false,
        ];
    }
}

// ── Team Docs ────────────────────────────────────────────────────
$sheets = readJson('sheets.json');
foreach ($sheets as $s) {
    if (str_contains(strtolower($s['name'] ?? ''), $ql) ||
        str_contains(strtolower($s['description'] ?? ''), $ql)) {
        $results[] = [
            'type'    => 'sheet',
            'id'      => $s['id'],
            'title'   => $s['name'] ?? '',
            'excerpt' => mb_substr($s['description'] ?? '', 0, 110),
            'meta'    => $s['category'] ?? '',
            'badge'   => 'Docs',
            'date'    => $s['updated_at'] ?? $s['created_at'] ?? '',
            'url'     => $s['url'] ?? '',
        ];
    }
}

// ── Users ────────────────────────────────────────────────────────
$users = readJson('users.json');
foreach ($users as $u) {
    if (str_contains(strtolower($u['name'] ?? ''), $ql) ||
        str_contains(strtolower($u['username'] ?? ''), $ql)) {
        $results[] = [
            'type'    => 'user',
            'id'      => $u['id'],
            'title'   => $u['name'] ?? '',
            'excerpt' => '@' . ($u['username'] ?? ''),
            'meta'    => $u['role'] ?? '',
            'badge'   => 'User',
            'date'    => '',
        ];
    }
}

// Sort: posts first, then sheets, then users; within type by date desc
$typeOrder = ['post' => 0, 'sheet' => 1, 'user' => 2];
usort($results, function($a, $b) use ($typeOrder) {
    $diff = ($typeOrder[$a['type']] ?? 9) - ($typeOrder[$b['type']] ?? 9);
    if ($diff !== 0) return $diff;
    return strcmp($b['date'] ?? '', $a['date'] ?? '');
});

respondOk([
    'results' => array_slice($results, $offset, $limit),
    'total'   => count($results),
    'query'   => $q,
    'offset'  => $offset,
]);
