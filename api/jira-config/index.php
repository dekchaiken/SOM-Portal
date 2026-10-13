<?php
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];
$id      = $_GET['id'] ?? '';

// GET — return full config
if ($method === 'GET') {
    $cfg = readJson('jira_config.json');
    if (!is_array($cfg)) $cfg = ['categories' => [], 'issue_types' => [], 'custom_fields' => []];
    if (!isset($cfg['custom_fields'])) $cfg['custom_fields'] = [];
    respondOk($cfg);
}

// POST — add item (sm_lead+ only)
if ($method === 'POST') {
    requireSmForShared();
    requireRole($payload, LEAD_ROLES);
    $body = getBody();
    $kind = trim($body['kind'] ?? '');

    $cfg = readJson('jira_config.json');
    if (!is_array($cfg)) $cfg = ['categories' => [], 'issue_types' => [], 'custom_fields' => []];
    if (!isset($cfg['custom_fields'])) $cfg['custom_fields'] = [];

    // ── Add category or issue_type ─────────────────────────
    if (in_array($kind, ['category', 'issue_type'])) {
        $name = trim($body['name'] ?? '');
        if (!$name) respondError('Name is required');
        $key    = $kind === 'category' ? 'categories' : 'issue_types';
        $prefix = $kind === 'category' ? 'c' : 'it';
        foreach ($cfg[$key] as $item) {
            if (strtolower($item['name']) === strtolower($name)) {
                respondError('Item with this name already exists');
            }
        }
        $newItem = ['id' => genId($prefix), 'name' => $name];
        $cfg[$key][] = $newItem;
        writeJson('jira_config.json', $cfg);
        logActivity('jiraconfig_add', ['kind' => $kind, 'name' => $name], $payload['sub'], $payload['name']);
        respondOk($newItem, ucfirst($kind) . ' added');
    }

    // ── Add custom field ───────────────────────────────────
    if ($kind === 'custom_field') {
        $fieldId = trim($body['field_id'] ?? '');
        $label   = trim($body['label']    ?? '');
        if (!$fieldId) respondError('field_id is required (e.g. customfield_12345)');
        if (!$label)   respondError('Label is required');

        // Duplicate field_id check
        foreach ($cfg['custom_fields'] as $cf) {
            if ($cf['field_id'] === $fieldId) respondError('Field ID already exists');
        }

        $maxOrder = 0;
        foreach ($cfg['custom_fields'] as $cf) {
            if (($cf['order'] ?? 0) > $maxOrder) $maxOrder = $cf['order'];
        }

        $newCf = [
            'id'         => genId('cf'),
            'field_id'   => $fieldId,
            'label'      => $label,
            'placeholder'=> trim($body['placeholder'] ?? ''),
            'field_type' => in_array($body['field_type'] ?? '', ['text','fault_start']) ? $body['field_type'] : 'text',
            'enabled'    => true,
            'order'      => $maxOrder + 1
        ];
        $cfg['custom_fields'][] = $newCf;
        writeJson('jira_config.json', $cfg);
        logActivity('jiraconfig_add', ['kind' => 'custom_field', 'field_id' => $fieldId, 'label' => $label], $payload['sub'], $payload['name']);
        respondOk($newCf, 'Custom field added');
    }

    respondError('Invalid kind');
}

// PUT — update item (sm_lead+ only)
if ($method === 'PUT') {
    requireSmForShared();
    requireRole($payload, LEAD_ROLES);
    if (!$id) respondError('ID required');
    $body = getBody();

    $cfg = readJson('jira_config.json');
    $found = false;

    // Check categories / issue_types
    foreach (['categories', 'issue_types'] as $key) {
        foreach ($cfg[$key] as &$item) {
            if ($item['id'] === $id) {
                $name = trim($body['name'] ?? '');
                if (!$name) respondError('Name is required');
                $item['name'] = $name;
                $found = true;
                break 2;
            }
        }
        unset($item);
    }

    // Check custom_fields
    if (!$found) {
        foreach ($cfg['custom_fields'] as &$cf) {
            if ($cf['id'] === $id) {
                if (isset($body['label']))       $cf['label']       = trim($body['label']);
                if (isset($body['placeholder'])) $cf['placeholder'] = trim($body['placeholder']);
                if (isset($body['field_type']) && in_array($body['field_type'], ['text','fault_start'])) {
                    $cf['field_type'] = $body['field_type'];
                }
                if (isset($body['enabled']))     $cf['enabled']     = (bool)$body['enabled'];
                if (isset($body['order']))        $cf['order']       = (int)$body['order'];
                $found = true;
                break;
            }
        }
        unset($cf);
    }

    if (!$found) respondError('Item not found', 404);
    writeJson('jira_config.json', $cfg);
    logActivity('jiraconfig_update', ['id' => $id], $payload['sub'], $payload['name']);
    respondOk(null, 'Updated');
}

// DELETE — remove item (sm_lead+ only)
if ($method === 'DELETE') {
    requireSmForShared();
    requireRole($payload, LEAD_ROLES);
    if (!$id) respondError('ID required');

    $cfg = readJson('jira_config.json');
    $found = false;

    foreach (['categories', 'issue_types', 'custom_fields'] as $key) {
        $before = count($cfg[$key]);
        $cfg[$key] = array_values(array_filter($cfg[$key], fn($i) => $i['id'] !== $id));
        if (count($cfg[$key]) < $before) { $found = true; break; }
    }

    if (!$found) respondError('Item not found', 404);
    writeJson('jira_config.json', $cfg);
    logActivity('jiraconfig_delete', ['id' => $id], $payload['sub'], $payload['name']);
    respondOk(null, 'Deleted');
}

respondError('Method not allowed', 405);
