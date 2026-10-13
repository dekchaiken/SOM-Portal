<?php
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];
$id      = $_GET['id']   ?? '';
$kind    = $_GET['kind'] ?? '';
$isAdmin = in_array($payload['role'] ?? '', ADMIN_ROLES);

$data = readJson('sheets.json');
if (!isset($data['docs']))       $data['docs']       = [];
if (!isset($data['categories'])) $data['categories'] = [];

// ── GET categories ────────────────────────────────────────────
if ($method === 'GET' && isset($_GET['categories'])) {
    respondOk($data['categories']);
}

// ── GET list docs ─────────────────────────────────────────────
if ($method === 'GET') {
    $docs     = $data['docs'];
    $category = $_GET['category'] ?? '';
    $search   = strtolower($_GET['search'] ?? '');

    if ($category) {
        $docs = array_values(array_filter($docs, fn($d) => ($d['category'] ?? '') === $category));
    }
    if ($search) {
        $docs = array_values(array_filter($docs, fn($d) =>
            str_contains(strtolower($d['name'] ?? ''), $search) ||
            str_contains(strtolower($d['description'] ?? ''), $search)
        ));
    }

    usort($docs, fn($a, $b) => strcmp($b['created_at'] ?? '', $a['created_at'] ?? ''));

    // Enrich with per-user starred flag
    $stars = readJson('sheet_stars.json');
    $myStars = array_flip(array_column(
        array_filter($stars, fn($s) => ($s['user_id'] ?? '') === $payload['sub']),
        'doc_id'
    ));
    foreach ($docs as &$d) { $d['starred'] = isset($myStars[$d['id']]); }
    unset($d);

    respondOk(array_values($docs));
}

// ── POST star (per-user, idempotent) ─────────────────────────
if ($method === 'POST' && $kind === 'star') {
    requireCsrf();
    if (!$id) respondError('doc id required');
    $exists = false;
    foreach ($data['docs'] as $d) { if ($d['id'] === $id) { $exists = true; break; } }
    if (!$exists) respondError('Doc not found', 404);

    $stars = readJson('sheet_stars.json');
    foreach ($stars as $s) {
        if (($s['user_id'] ?? '') === $payload['sub'] && ($s['doc_id'] ?? '') === $id) {
            respondOk(null, 'Already starred');
        }
    }
    $stars[] = [
        'id'         => genId('sst'),
        'user_id'    => $payload['sub'],
        'doc_id'     => $id,
        'starred_at' => date('c'),
    ];
    writeJson('sheet_stars.json', $stars);
    respondOk(null, 'Starred');
}

// ── DELETE unstar ────────────────────────────────────────────
if ($method === 'DELETE' && $kind === 'star') {
    requireCsrf();
    if (!$id) respondError('doc id required');
    $stars = readJson('sheet_stars.json');
    $filtered = array_values(array_filter($stars, fn($s) =>
        !(($s['user_id'] ?? '') === $payload['sub'] && ($s['doc_id'] ?? '') === $id)
    ));
    writeJson('sheet_stars.json', $filtered);
    respondOk(null, 'Unstarred');
}

// ── POST add category (admin only) ───────────────────────────
if ($method === 'POST' && $kind === 'category') {
    if (!$isAdmin) respondError('Forbidden', 403);
    $body = getBody();
    $name = trim($body['name'] ?? '');
    if (!$name) respondError('Category name required');
    if (in_array($name, $data['categories'])) respondError('Category already exists');
    $data['categories'][] = $name;
    writeJson('sheets.json', $data);
    respondOk($data['categories']);
}

// ── POST create doc ───────────────────────────────────────────
if ($method === 'POST') {
    $body = getBody();
    $name = trim($body['name'] ?? '');
    $url  = trim($body['url']  ?? '');

    if (!$name) respondError('Name is required');
    if (!$url)  respondError('URL is required');
    if (!filter_var($url, FILTER_VALIDATE_URL)) respondError('Invalid URL');

    $doc = [
        'id'          => genId('doc'),
        'name'        => substr($name, 0, 120),
        'description' => substr(trim($body['description'] ?? ''), 0, 300),
        'url'         => $url,
        'type'        => in_array($body['type'] ?? '', ['sheet','doc','slide','other'])
                           ? $body['type'] : 'other',
        'category'    => substr(trim($body['category'] ?? ''), 0, 60),
        'author_id'   => $payload['sub'],
        'author_name' => $payload['name'],
        'created_at'  => date('c'),
        'updated_at'  => date('c'),
    ];

    array_unshift($data['docs'], $doc);
    writeJson('sheets.json', $data);
    logActivity('doc_create', ['doc_id' => $doc['id'], 'name' => $doc['name'], 'type' => $doc['type']], $payload['sub'], $payload['name']);
    respondOk($doc);
}

// ── PUT update doc ────────────────────────────────────────────
if ($method === 'PUT') {
    if (!$id) respondError('ID required');
    $idx = array_search($id, array_column($data['docs'], 'id'));
    if ($idx === false) respondError('Not found', 404);

    $doc = $data['docs'][$idx];
    if ($doc['author_id'] !== $payload['sub'] && !$isAdmin) respondError('Forbidden', 403);

    $body = getBody();
    $name = trim($body['name'] ?? '');
    $url  = trim($body['url']  ?? '');

    if (!$name) respondError('Name is required');
    if (!$url)  respondError('URL is required');
    if (!filter_var($url, FILTER_VALIDATE_URL)) respondError('Invalid URL');

    $data['docs'][$idx] = array_merge($doc, [
        'name'        => substr($name, 0, 120),
        'description' => substr(trim($body['description'] ?? ''), 0, 300),
        'url'         => $url,
        'type'        => in_array($body['type'] ?? '', ['sheet','doc','slide','other'])
                           ? $body['type'] : $doc['type'],
        'category'    => substr(trim($body['category'] ?? ''), 0, 60),
        'updated_at'  => date('c'),
    ]);

    writeJson('sheets.json', $data);
    logActivity('doc_update', ['doc_id' => $id, 'name' => $data['docs'][$idx]['name']], $payload['sub'], $payload['name']);
    respondOk($data['docs'][$idx]);
}

// ── DELETE category (admin only) ─────────────────────────────
if ($method === 'DELETE' && $kind === 'category') {
    if (!$isAdmin) respondError('Forbidden', 403);
    $data['categories'] = array_values(array_filter($data['categories'], fn($c) => $c !== $id));
    writeJson('sheets.json', $data);
    respondOk($data['categories']);
}

// ── DELETE doc ────────────────────────────────────────────────
if ($method === 'DELETE') {
    if (!$id) respondError('ID required');
    $idx = array_search($id, array_column($data['docs'], 'id'));
    if ($idx === false) respondError('Not found', 404);

    $doc = $data['docs'][$idx];
    if ($doc['author_id'] !== $payload['sub'] && !$isAdmin) respondError('Forbidden', 403);

    array_splice($data['docs'], $idx, 1);
    writeJson('sheets.json', $data);
    logActivity('doc_delete', ['doc_id' => $id, 'name' => $doc['name']], $payload['sub'], $payload['name']);
    respondOk(['deleted' => $id]);
}

respondError('Method not allowed', 405);
