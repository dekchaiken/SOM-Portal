<?php
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];
$id      = $_GET['id'] ?? '';

// ── GET — list active announcements ──────────────────────────────────────────
if ($method === 'GET') {
    $all   = readJson('announcements.json') ?: [];
    $isAdmin = in_array($payload['role'] ?? '', ADMIN_ROLES);
    $adminAll = isset($_GET['all']) && $isAdmin;

    if ($adminAll) {
        $items = $all;
    } else {
        $now   = date('c');
        $items = array_values(array_filter($all, function ($a) use ($now) {
            if (!($a['active'] ?? true)) return false;
            if (!empty($a['expires_at']) && $a['expires_at'] < $now) return false;
            return true;
        }));
    }

    // Sort: pinned first, then by created_at desc
    usort($items, function ($a, $b) {
        if (($b['pinned'] ?? false) !== ($a['pinned'] ?? false))
            return ($b['pinned'] ?? false) ? 1 : -1;
        return strcmp($b['created_at'] ?? '', $a['created_at'] ?? '');
    });

    respondOk($items);
}

// ── POST — create ─────────────────────────────────────────────────────────────
if ($method === 'POST') {
    requireCsrf();
    requireRole($payload, ADMIN_ROLES);
    $body = json_decode(file_get_contents('php://input'), true) ?: [];

    if (empty($body['message'])) respondError('Message required');

    $display = in_array($body['display'] ?? '', ['ticker','card','both','popup','promo','all']) ? $body['display'] : 'both';
    $item = [
        'id'              => genId('ann'),
        'type'            => $body['type']    ?? 'info',
        'title'           => $body['title']   ?? '',
        'message'         => $body['message'],
        'display'         => $display,
        'icon'            => trim((string)($body['icon']  ?? '')),
        'badge'           => trim((string)($body['badge'] ?? '')),
        'popup_cta_label' => trim((string)($body['popup_cta_label'] ?? '')),
        'popup_cta_url'   => trim((string)($body['popup_cta_url']   ?? '')),
        'active'          => (bool)($body['active']     ?? true),
        'expires_at'      => $body['expires_at']        ?? null,
        'created_by'      => $payload['sub'],
        'created_by_name' => $payload['name'],
        'created_at'      => date('c'),
    ];

    $all   = readJson('announcements.json') ?: [];
    $all[] = $item;
    writeJson('announcements.json', $all);
    logActivity('announcement_create', ['id' => $item['id'], 'type' => $item['type']], $payload['sub'], $payload['name']);
    respondOk($item, 'Created');
}

// ── PUT — update ──────────────────────────────────────────────────────────────
if ($method === 'PUT') {
    requireCsrf();
    requireRole($payload, ADMIN_ROLES);
    if (!$id) respondError('ID required');
    $body = json_decode(file_get_contents('php://input'), true) ?: [];

    $all   = readJson('announcements.json') ?: [];
    $found = false;
    foreach ($all as &$item) {
        if ($item['id'] !== $id) continue;
        if (isset($body['type']))       $item['type']       = $body['type'];
        if (isset($body['title']))      $item['title']      = $body['title'];
        if (isset($body['message']))    $item['message']    = $body['message'];
        if (isset($body['display']) && in_array($body['display'], ['ticker','card','both','popup','promo','all']))
            $item['display'] = $body['display'];
        if (array_key_exists('icon',  $body)) $item['icon']  = trim((string)$body['icon']);
        if (array_key_exists('badge', $body)) $item['badge'] = trim((string)$body['badge']);
        if (array_key_exists('popup_cta_label', $body)) $item['popup_cta_label'] = trim((string)$body['popup_cta_label']);
        if (array_key_exists('popup_cta_url',   $body)) $item['popup_cta_url']   = trim((string)$body['popup_cta_url']);
        if (isset($body['active']))     $item['active']     = (bool)$body['active'];
        if (array_key_exists('expires_at', $body)) $item['expires_at'] = $body['expires_at'] ?: null;
        $found = true;
        break;
    }
    unset($item);

    if (!$found) respondError('Not found', 404);
    writeJson('announcements.json', $all);
    respondOk(null, 'Updated');
}

// ── DELETE ────────────────────────────────────────────────────────────────────
if ($method === 'DELETE') {
    requireCsrf();
    requireRole($payload, ADMIN_ROLES);
    if (!$id) respondError('ID required');

    $all      = readJson('announcements.json') ?: [];
    $filtered = array_values(array_filter($all, fn($a) => $a['id'] !== $id));
    if (count($filtered) === count($all)) respondError('Not found', 404);

    writeJson('announcements.json', $filtered);
    logActivity('announcement_delete', ['id' => $id], $payload['sub'], $payload['name']);
    respondOk(null, 'Deleted');
}

respondError('Method not allowed', 405);
