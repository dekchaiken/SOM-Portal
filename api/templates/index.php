<?php
require_once __DIR__ . '/../helpers.php';

$payload = requireAuth();
$method  = $_SERVER['REQUEST_METHOD'];
$id      = $_GET['id'] ?? '';

// GET — list templates. Reads the SM-shared templates.json (see smSharedFiles).
// Grant either the full 'jira-templates' feature (per-team ticket creation) or
// 'jira-templates-shared' (view-only) — both allow read.
if ($method === 'GET') {
    if (($payload['role'] ?? '') !== 'super_admin' && ($payload['team'] ?? '') !== 'sm') {
        $teams = readJson('teams.json');
        $teamSlug = $payload['team'] ?? null;
        $granted  = false;
        foreach ($teams as $t) {
            if (($t['slug'] ?? '') !== $teamSlug) continue;
            $features = $t['features'] ?? [];
            if (in_array('jira-templates', $features, true) || in_array('jira-templates-shared', $features, true)) {
                $granted = true;
            }
            break;
        }
        if (!$granted) respondError("Your team does not have access to jira templates", 403);
    }
    $templates = readJson('templates.json');
    usort($templates, fn($a, $b) => strcmp($b['created_at'] ?? '', $a['created_at'] ?? ''));
    respondOk(array_values($templates));
}

// POST — create template. Writes to SM-shared file so gate to SM/super_admin.
if ($method === 'POST') {
    requireSmForShared();
    requireCsrf();
    $body = getBody();
    $name    = trim($body['name'] ?? '');
    $summary = trim($body['summary'] ?? '');

    if (!$name) respondError('Template name is required');
    if (!$summary) respondError('Summary (case title) is required');

    $fields = $body['fields'] ?? [];

    // Accept issuetype + customfield_* keys (driven by jira_config.json on the client side)
    // Also detect the fault_start field to set default 'auto' if missing
    $clean_fields = [];
    $fault_start_field = null;
    if (!empty($fields['issuetype'])) {
        $clean_fields['issuetype'] = trim($fields['issuetype']);
    }
    foreach ($fields as $key => $val) {
        if (strpos($key, 'customfield_') === 0) {
            $clean_fields[$key] = $val;
        }
    }
    // Detect fault_start field from jira_config.json and default to 'auto' if absent
    $jira_cfg = readJson('jira_config.json');
    if (!empty($jira_cfg['custom_fields'])) {
        foreach ($jira_cfg['custom_fields'] as $cf) {
            if (($cf['field_type'] ?? '') === 'fault_start') {
                $fault_start_field = $cf['field_id'];
                break;
            }
        }
    }
    // Fallback to legacy field if not configured
    if (!$fault_start_field) $fault_start_field = 'customfield_17026';
    if (!isset($clean_fields[$fault_start_field])) {
        $clean_fields[$fault_start_field] = 'auto';
    }

    $tpl = [
        'id'               => genId('tpl'),
        'name'             => $name,
        'category'         => trim($body['category'] ?? 'Incident'),
        'service_type_id'  => trim($body['service_type_id'] ?? ''),
        'service_subtype_id' => trim($body['service_subtype_id'] ?? ''),
        'summary'          => $summary,
        'fields'           => $clean_fields,
        'created_at'       => date('c'),
        'created_by'       => $payload['sub'],
        'author_name'      => $payload['name']
    ];

    $templates = readJson('templates.json');
    $templates[] = $tpl;
    writeJson('templates.json', $templates);
    logActivity('template_create', ['id' => $tpl['id'], 'name' => $name, 'category' => $tpl['category']], $payload['sub'], $payload['name']);
    respondOk($tpl, 'Template created');
}

// PUT — update template
if ($method === 'PUT') {
    requireSmForShared();
    requireCsrf();
    if (!$id) respondError('Template ID required');
    $body = getBody();
    $templates = readJson('templates.json');
    $found = false;

    foreach ($templates as &$t) {
        if ($t['id'] === $id) {
            if (isset($body['name']))              $t['name']               = trim($body['name']);
            if (isset($body['category']))          $t['category']           = trim($body['category']);
            if (isset($body['service_type_id']))   $t['service_type_id']    = trim($body['service_type_id']);
            if (isset($body['service_subtype_id'])) $t['service_subtype_id'] = trim($body['service_subtype_id']);
            if (isset($body['summary']))            $t['summary']            = trim($body['summary']);
            if (isset($body['fields']))             $t['fields']             = $body['fields'];
            $found = true;
            break;
        }
    }
    unset($t);

    if (!$found) respondError('Template not found', 404);
    writeJson('templates.json', $templates);
    logActivity('template_update', ['id' => $id], $payload['sub'], $payload['name']);
    respondOk(null, 'Template updated');
}

// DELETE — delete template
if ($method === 'DELETE') {
    requireSmForShared();
    requireCsrf();
    if (!$id) respondError('Template ID required');
    // Lead and Admin can delete
    requireRole($payload, LEAD_ROLES);

    $templates = readJson('templates.json');
    $filtered  = array_values(array_filter($templates, fn($t) => $t['id'] !== $id));
    if (count($filtered) === count($templates)) respondError('Template not found', 404);

    writeJson('templates.json', $filtered);
    logActivity('template_delete', ['id' => $id], $payload['sub'], $payload['name']);
    respondOk(null, 'Template deleted');
}

respondError('Method not allowed', 405);
