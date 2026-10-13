<?php
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];
$id      = $_GET['id'] ?? '';
$kind    = $_GET['kind'] ?? '';  // 'category' | 'service_type' | 'subtype'
$parent  = $_GET['parent'] ?? ''; // parent service_type id when adding subtype

// ── GET — return full config ────────────────────────────────
if ($method === 'GET') {
    respondOk([
        'categories'    => readJson('board_categories.json'),
        'service_types' => readJson('board_service_types.json')
    ]);
}

// ── POST — create item ──────────────────────────────────────
if ($method === 'POST') {
    $body = getBody();

    // Add board category (tab) — lead+ only
    if ($kind === 'category') {
        requireRole($payload, LEAD_ROLES);
        $name = trim($body['name'] ?? '');
        if (!$name) respondError('Name is required');

        $items = readJson('board_categories.json');
        $items[] = [
            'id'    => genId('bcat'),
            'name'  => $name,
            'order' => count($items) + 1
        ];
        writeJson('board_categories.json', $items);
        logActivity('boardconfig_category_add', ['name' => $name], $payload['sub'], $payload['name']);
        respondOk(null, 'Category added');
    }

    // Add board service type (top-level) — any authenticated user
    if ($kind === 'service_type') {
        $name = trim($body['name'] ?? '');
        if (!$name) respondError('Name is required');

        $items = readJson('board_service_types.json');
        $items[] = [
            'id'       => genId('bst'),
            'name'     => $name,
            'order'    => count($items) + 1,
            'subtypes' => []
        ];
        writeJson('board_service_types.json', $items);
        logActivity('boardconfig_servicetype_add', ['name' => $name], $payload['sub'], $payload['name']);
        respondOk(null, 'Service type added');
    }

    // Add subtype to a service type
    if ($kind === 'subtype' && $parent) {
        $name = trim($body['name'] ?? '');
        if (!$name) respondError('Name is required');

        $items = readJson('board_service_types.json');
        $found = false;
        foreach ($items as &$st) {
            if ($st['id'] === $parent) {
                $st['subtypes'][] = [
                    'id'    => genId('bsst'),
                    'name'  => $name,
                    'order' => count($st['subtypes']) + 1
                ];
                $found = true;
                break;
            }
        }
        unset($st);
        if (!$found) respondError('Service type not found', 404);
        writeJson('board_service_types.json', $items);
        logActivity('boardconfig_subtype_add', ['name' => $name, 'parent_id' => $parent], $payload['sub'], $payload['name']);
        respondOk(null, 'Subtype added');
    }

    respondError('Invalid kind');
}

// ── PUT/DELETE — rename/remove require sm_lead+ ────────────
requireRole($payload, LEAD_ROLES);

// ── PUT — rename item ───────────────────────────────────────
if ($method === 'PUT') {
    if (!$id) respondError('ID required');
    $body = getBody();
    $name = trim($body['name'] ?? '');
    if (!$name) respondError('Name is required');

    // Try categories first
    $cats = readJson('board_categories.json');
    foreach ($cats as &$c) {
        if ($c['id'] === $id) {
            $c['name'] = $name;
            writeJson('board_categories.json', $cats);
            logActivity('boardconfig_rename', ['id' => $id, 'name' => $name, 'kind' => 'category'], $payload['sub'], $payload['name']);
            respondOk(null, 'Updated');
        }
    }
    unset($c);

    // Try service types and subtypes
    $items = readJson('board_service_types.json');
    foreach ($items as &$st) {
        if ($st['id'] === $id) {
            $st['name'] = $name;
            writeJson('board_service_types.json', $items);
            logActivity('boardconfig_rename', ['id' => $id, 'name' => $name, 'kind' => 'service_type'], $payload['sub'], $payload['name']);
            respondOk(null, 'Updated');
        }
        foreach ($st['subtypes'] as &$sub) {
            if ($sub['id'] === $id) {
                $sub['name'] = $name;
                writeJson('board_service_types.json', $items);
                logActivity('boardconfig_rename', ['id' => $id, 'name' => $name, 'kind' => 'subtype'], $payload['sub'], $payload['name']);
                respondOk(null, 'Updated');
            }
        }
        unset($sub);
    }
    unset($st);

    respondError('Item not found', 404);
}

// ── DELETE — remove item ────────────────────────────────────
if ($method === 'DELETE') {
    if (!$id) respondError('ID required');

    // Try categories
    $cats = readJson('board_categories.json');
    $filtered = array_values(array_filter($cats, fn($c) => $c['id'] !== $id));
    if (count($filtered) < count($cats)) {
        writeJson('board_categories.json', $filtered);
        logActivity('boardconfig_delete', ['id' => $id, 'kind' => 'category'], $payload['sub'], $payload['name']);
        respondOk(null, 'Deleted');
    }

    // Try service types (top-level)
    $items = readJson('board_service_types.json');
    $filtered = array_values(array_filter($items, fn($st) => $st['id'] !== $id));
    if (count($filtered) < count($items)) {
        writeJson('board_service_types.json', $filtered);
        logActivity('boardconfig_delete', ['id' => $id, 'kind' => 'service_type'], $payload['sub'], $payload['name']);
        respondOk(null, 'Deleted');
    }

    // Try subtypes (nested)
    $changed = false;
    foreach ($items as &$st) {
        $before = count($st['subtypes']);
        $st['subtypes'] = array_values(array_filter($st['subtypes'], fn($s) => $s['id'] !== $id));
        if (count($st['subtypes']) < $before) { $changed = true; break; }
    }
    unset($st);
    if ($changed) {
        writeJson('board_service_types.json', $items);
        logActivity('boardconfig_delete', ['id' => $id, 'kind' => 'subtype'], $payload['sub'], $payload['name']);
        respondOk(null, 'Deleted');
    }

    respondError('Item not found', 404);
}

respondError('Method not allowed', 405);
