<?php
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];
$id      = $_GET['id'] ?? '';

// GET — ดึง sidebar tools ทั้งหมด (sort by order)
if ($method === 'GET') {
    $tools = readJson('sidebar_tools.json');
    usort($tools, fn($a, $b) => ($a['order'] ?? 99) - ($b['order'] ?? 99));
    respondOk(array_values($tools));
}

// POST — สร้าง tool ใหม่ (lead / admin เท่านั้น)
if ($method === 'POST') {
    requireCsrf();
    requireRole($payload, LEAD_ROLES);
    $body = getBody();

    $name      = trim($body['name']      ?? '');
    $link_type = trim($body['link_type'] ?? 'external');

    if (!$name) respondError('Name is required');

    // Validate url vs path depending on type
    $url  = trim($body['url']  ?? '');
    $path = trim($body['path'] ?? '');
    if ($link_type === 'external' && !$url)  respondError('URL is required for external tools');
    if ($link_type === 'internal' && !$path) respondError('Path is required for internal tools');

    $tools    = readJson('sidebar_tools.json');
    $maxOrder = 0;
    foreach ($tools as $t) {
        if (($t['order'] ?? 0) > $maxOrder) $maxOrder = $t['order'];
    }

    $tool = [
        'id'          => genId('stool'),
        'link_type'   => $link_type,
        'page_id'     => trim($body['page_id'] ?? ''),
        'path'        => $path,
        'name'        => $name,
        'url'         => $url,
        'icon'        => trim($body['icon']        ?? '⊕'),
        'description' => trim($body['description'] ?? ''),
        'badge_text'  => trim($body['badge_text']  ?? ''),
        'badge_type'  => trim($body['badge_type']  ?? 'gray'),
        'enabled'     => isset($body['enabled']) ? (bool)$body['enabled'] : true,
        'order'       => (int)($body['order'] ?? $maxOrder + 1),
        'created_at'  => date('c'),
        'created_by'  => $payload['sub']
    ];

    $tools[] = $tool;
    writeJson('sidebar_tools.json', $tools);
    logActivity('sidebar_tool_create', ['id' => $tool['id'], 'name' => $name, 'link_type' => $link_type], $payload['sub'], $payload['name']);
    respondOk($tool, 'Tool created');
}

// PUT — แก้ไข tool
if ($method === 'PUT') {
    requireCsrf();
    requireRole($payload, LEAD_ROLES);
    if (!$id) respondError('Tool ID required');

    $body  = getBody();
    $tools = readJson('sidebar_tools.json');
    $found = false;

    foreach ($tools as &$t) {
        if ($t['id'] === $id) {
            if (isset($body['name']))        $t['name']        = trim($body['name']);
            if (isset($body['link_type']))   $t['link_type']   = trim($body['link_type']);
            if (isset($body['page_id']))     $t['page_id']     = trim($body['page_id']);
            if (isset($body['path']))        $t['path']        = trim($body['path']);
            if (isset($body['url']))         $t['url']         = trim($body['url']);
            if (isset($body['icon']))        $t['icon']        = trim($body['icon']);
            if (isset($body['description'])) $t['description'] = trim($body['description']);
            if (isset($body['badge_text']))  $t['badge_text']  = trim($body['badge_text']);
            if (isset($body['badge_type']))  $t['badge_type']  = trim($body['badge_type']);
            if (isset($body['enabled']))     $t['enabled']     = (bool)$body['enabled'];
            if (isset($body['order']))       $t['order']       = (int)$body['order'];
            $found = true;
            break;
        }
    }
    unset($t);

    if (!$found) respondError('Tool not found', 404);
    writeJson('sidebar_tools.json', $tools);
    logActivity('sidebar_tool_update', ['id' => $id], $payload['sub'], $payload['name']);
    respondOk(null, 'Tool updated');
}

// DELETE — ลบ tool
if ($method === 'DELETE') {
    requireCsrf();
    requireRole($payload, LEAD_ROLES);
    if (!$id) respondError('Tool ID required');

    $tools    = readJson('sidebar_tools.json');
    $filtered = array_values(array_filter($tools, fn($t) => $t['id'] !== $id));
    if (count($filtered) === count($tools)) respondError('Tool not found', 404);

    writeJson('sidebar_tools.json', $filtered);
    logActivity('sidebar_tool_delete', ['id' => $id], $payload['sub'], $payload['name']);
    respondOk(null, 'Tool deleted');
}

respondError('Method not allowed', 405);
