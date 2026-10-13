<?php
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];
$action  = $_GET['action']  ?? 'rows';   // sections | columns | rows
$id      = $_GET['id']      ?? '';
$secId   = $_GET['section'] ?? '';

// ─── GET — ดึงข้อมูลทั้งหมด ──────────────────────────────────────────────────
if ($method === 'GET') {
    $data = readJson('ops_runbook.json');
    $sections = $data['sections'] ?? [];

    // เรียงตาม order
    usort($sections, fn($a, $b) => ($a['order'] ?? 99) - ($b['order'] ?? 99));
    foreach ($sections as &$sec) {
        usort($sec['columns'], fn($a, $b) => ($a['order'] ?? 99) - ($b['order'] ?? 99));
    }

    respondOk($sections);
}

// ─── Write actions: Lead + Admin เท่านั้น ────────────────────────────────────
requireRole($payload, LEAD_ROLES);

// ─── POST — สร้างใหม่ ─────────────────────────────────────────────────────────
if ($method === 'POST') {
    requireCsrf();
    $body = getBody();
    $data = readJson('ops_runbook.json');
    if (!isset($data['sections'])) $data['sections'] = [];

    // ── สร้าง Section ──────────────────────────────────────────────────────────
    if ($action === 'sections') {
        $name = trim($body['name'] ?? '');
        if (!$name) respondError('Section name is required');

        $maxOrder = 0;
        foreach ($data['sections'] as $s) {
            if (($s['order'] ?? 0) > $maxOrder) $maxOrder = $s['order'];
        }

        $section = [
            'id'         => genId('sec'),
            'name'       => $name,
            'icon'       => trim($body['icon'] ?? '📋'),
            'order'      => $maxOrder + 1,
            'columns'    => [],
            'rows'       => [],
        ];

        $data['sections'][] = $section;
        writeJson('ops_runbook.json', $data);
        logActivity('ops_runbook_section_create', ['id' => $section['id'], 'name' => $name], $payload['sub'], $payload['name']);
        respondOk($section, 'Section created');
    }

    // ── สร้าง Column ───────────────────────────────────────────────────────────
    if ($action === 'columns') {
        if (!$secId) respondError('Section ID required');
        $label = trim($body['label'] ?? '');
        $type  = trim($body['type']  ?? 'text');
        if (!$label) respondError('Column label is required');
        if (!in_array($type, ['text', 'dropdown', 'url'])) respondError('Invalid column type');

        $found = false;
        foreach ($data['sections'] as &$sec) {
            if ($sec['id'] !== $secId) continue;
            $found = true;

            // ตรวจ key ซ้ำ
            $baseKey = strtolower(preg_replace('/[^a-z0-9]+/i', '_', $label));
            $key = $baseKey;
            $i = 1;
            $existingKeys = array_column($sec['columns'], 'key');
            while (in_array($key, $existingKeys)) { $key = $baseKey . '_' . $i++; }

            $maxOrder = 0;
            foreach ($sec['columns'] as $c) {
                if (($c['order'] ?? 0) > $maxOrder) $maxOrder = $c['order'];
            }

            $col = [
                'key'     => $key,
                'label'   => $label,
                'type'    => $type,
                'options' => array_values(array_filter(array_map('trim', $body['options'] ?? []))),
                'order'   => $maxOrder + 1,
            ];
            $sec['columns'][] = $col;
            break;
        }

        if (!$found) respondError('Section not found', 404);
        writeJson('ops_runbook.json', $data);
        logActivity('ops_runbook_column_create', ['section' => $secId, 'label' => $label], $payload['sub'], $payload['name']);
        respondOk(null, 'Column added');
    }

    // ── สร้าง Row ──────────────────────────────────────────────────────────────
    if ($action === 'rows') {
        if (!$secId) respondError('Section ID required');
        $rowData = $body['data'] ?? [];

        $found = false;
        $newRow = null;
        foreach ($data['sections'] as &$sec) {
            if ($sec['id'] !== $secId) continue;
            $found = true;

            // sanitize — เก็บเฉพาะ key ที่มีใน columns
            $allowedKeys = array_column($sec['columns'], 'key');
            $sanitized = [];
            foreach ($allowedKeys as $k) {
                $sanitized[$k] = isset($rowData[$k]) ? $rowData[$k] : '';
            }

            $newRow = [
                'id'         => genId('row'),
                'data'       => $sanitized,
                'created_at' => date('c'),
                'created_by' => $payload['sub'],
                'created_name'=> $payload['name'],
                'updated_at' => date('c'),
                'updated_by' => $payload['sub'],
            ];
            $sec['rows'][] = $newRow;
            break;
        }

        if (!$found) respondError('Section not found', 404);
        writeJson('ops_runbook.json', $data);
        logActivity('ops_runbook_row_create', ['section' => $secId, 'row_id' => $newRow['id']], $payload['sub'], $payload['name']);
        respondOk($newRow, 'Row created');
    }

    respondError('Unknown action');
}

// ─── PUT — แก้ไข ─────────────────────────────────────────────────────────────
if ($method === 'PUT') {
    requireCsrf();
    if (!$id) respondError('ID required');
    $body = getBody();
    $data = readJson('ops_runbook.json');

    // ── แก้ไข Section ──────────────────────────────────────────────────────────
    if ($action === 'sections') {
        $found = false;
        foreach ($data['sections'] as &$sec) {
            if ($sec['id'] !== $id) continue;
            $found = true;
            if (isset($body['name']))  $sec['name']  = trim($body['name']);
            if (isset($body['icon']))  $sec['icon']  = trim($body['icon']);
            if (isset($body['order'])) $sec['order'] = (int)$body['order'];
            break;
        }
        if (!$found) respondError('Section not found', 404);
        writeJson('ops_runbook.json', $data);
        logActivity('ops_runbook_section_update', ['id' => $id], $payload['sub'], $payload['name']);
        respondOk(null, 'Section updated');
    }

    // ── แก้ไข Column ───────────────────────────────────────────────────────────
    if ($action === 'columns') {
        if (!$secId) respondError('Section ID required');
        $found = false;
        foreach ($data['sections'] as &$sec) {
            if ($sec['id'] !== $secId) continue;
            foreach ($sec['columns'] as &$col) {
                if ($col['key'] !== $id) continue;
                $found = true;
                if (isset($body['label']))   $col['label']   = trim($body['label']);
                if (isset($body['type']))    $col['type']    = $body['type'];
                if (isset($body['options'])) $col['options'] = array_values(array_filter(array_map('trim', $body['options'])));
                if (isset($body['order']))   $col['order']   = (int)$body['order'];
                break 2;
            }
        }
        if (!$found) respondError('Column not found', 404);
        writeJson('ops_runbook.json', $data);
        logActivity('ops_runbook_column_update', ['section' => $secId, 'column' => $id], $payload['sub'], $payload['name']);
        respondOk(null, 'Column updated');
    }

    // ── แก้ไข Row ──────────────────────────────────────────────────────────────
    if ($action === 'rows') {
        if (!$secId) respondError('Section ID required');
        $rowData = $body['data'] ?? [];
        $found = false;
        foreach ($data['sections'] as &$sec) {
            if ($sec['id'] !== $secId) continue;
            $allowedKeys = array_column($sec['columns'], 'key');
            foreach ($sec['rows'] as &$row) {
                if ($row['id'] !== $id) continue;
                $found = true;
                foreach ($allowedKeys as $k) {
                    if (isset($rowData[$k])) $row['data'][$k] = $rowData[$k];
                }
                $row['updated_at'] = date('c');
                $row['updated_by'] = $payload['sub'];
                break 2;
            }
        }
        if (!$found) respondError('Row not found', 404);
        writeJson('ops_runbook.json', $data);
        logActivity('ops_runbook_row_update', ['section' => $secId, 'row_id' => $id], $payload['sub'], $payload['name']);
        respondOk(null, 'Row updated');
    }

    respondError('Unknown action');
}

// ─── DELETE — ลบ ─────────────────────────────────────────────────────────────
if ($method === 'DELETE') {
    requireCsrf();
    if (!$id) respondError('ID required');
    $data = readJson('ops_runbook.json');

    // ── ลบ Section ─────────────────────────────────────────────────────────────
    if ($action === 'sections') {
        $before = count($data['sections']);
        $data['sections'] = array_values(array_filter($data['sections'], fn($s) => $s['id'] !== $id));
        if (count($data['sections']) === $before) respondError('Section not found', 404);
        writeJson('ops_runbook.json', $data);
        logActivity('ops_runbook_section_delete', ['id' => $id], $payload['sub'], $payload['name']);
        respondOk(null, 'Section deleted');
    }

    // ── ลบ Column ──────────────────────────────────────────────────────────────
    if ($action === 'columns') {
        if (!$secId) respondError('Section ID required');
        $found = false;
        foreach ($data['sections'] as &$sec) {
            if ($sec['id'] !== $secId) continue;
            $before = count($sec['columns']);
            $sec['columns'] = array_values(array_filter($sec['columns'], fn($c) => $c['key'] !== $id));
            if (count($sec['columns']) < $before) { $found = true; break; }
        }
        if (!$found) respondError('Column not found', 404);
        writeJson('ops_runbook.json', $data);
        logActivity('ops_runbook_column_delete', ['section' => $secId, 'column' => $id], $payload['sub'], $payload['name']);
        respondOk(null, 'Column deleted');
    }

    // ── ลบ Row ─────────────────────────────────────────────────────────────────
    if ($action === 'rows') {
        if (!$secId) respondError('Section ID required');
        $found = false;
        foreach ($data['sections'] as &$sec) {
            if ($sec['id'] !== $secId) continue;
            $before = count($sec['rows']);
            $sec['rows'] = array_values(array_filter($sec['rows'], fn($r) => $r['id'] !== $id));
            if (count($sec['rows']) < $before) { $found = true; break; }
        }
        if (!$found) respondError('Row not found', 404);
        writeJson('ops_runbook.json', $data);
        logActivity('ops_runbook_row_delete', ['section' => $secId, 'row_id' => $id], $payload['sub'], $payload['name']);
        respondOk(null, 'Row deleted');
    }

    respondError('Unknown action');
}

respondError('Method not allowed', 405);
