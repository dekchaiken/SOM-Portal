<?php
require_once __DIR__ . '/../helpers.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respondError('Method not allowed', 405);
}

$payload = requireAuth();
$body    = getBody();

$summary     = trim($body['summary'] ?? '');
$description = trim($body['description'] ?? '');
$fields_in   = $body['fields'] ?? [];

if (!$summary) respondError('Summary is required');

// Load custom field type map from jira_config.json
$jira_cfg    = readJson('jira_config.json');
$field_types = [];
foreach ($jira_cfg['custom_fields'] ?? [] as $cf) {
    if (!empty($cf['field_id'])) {
        $field_types[$cf['field_id']] = $cf['field_type'] ?? 'text';
    }
}

// Determine fault start
$fault_start = $fields_in['customfield_17026'] ?? 'auto';
if ($fault_start === 'auto' || empty($fault_start)) {
    $fault_start = date('Y-m-d\TH:i:s.000O');
}

// Build Jira issue fields payload
$issuetype   = trim($fields_in['issuetype'] ?? 'Task');
$jira_fields = [
    'project'   => ['key' => JIRA_PROJECT_KEY],
    'issuetype' => ['name' => $issuetype],
    'summary'   => $summary
];

// Description (Jira API v3 expects ADF — Atlassian Document Format — for description)
if ($description !== '') {
    $jira_fields['description'] = [
        'type'    => 'doc',
        'version' => 1,
        'content' => array_map(fn($line) => [
            'type'    => 'paragraph',
            'content' => $line === '' ? [] : [['type' => 'text', 'text' => $line]],
        ], explode("\n", $description)),
    ];
}

// Map each custom field with correct format based on its type
foreach ($field_types as $field_id => $ftype) {
    if ($ftype === 'fault_start') continue; // handled separately below
    $val = $fields_in[$field_id] ?? '';
    if ($val === '' || $val === null) continue;

    if ($ftype === 'select') {
        // Jira single-select option: { "value": "..." }
        $jira_fields[$field_id] = ['value' => $val];
    } elseif ($ftype === 'array') {
        // Jira multi-select: [{ "value": "..." }, ...]
        // Support comma-separated values from the template
        $items = array_filter(array_map('trim', explode(',', $val)));
        $jira_fields[$field_id] = array_map(fn($v) => ['value' => $v], $items);
    } else {
        // Plain text field
        $jira_fields[$field_id] = $val;
    }
}

// Fault start as datetime string
if (isset($fields_in['customfield_17026'])) {
    $jira_fields['customfield_17026'] = $fault_start;
}

// ── Incident Launcher monitoring fields — explicit type fallback ──
// These are always select/array type but may not be in jira_config.json
$il_select_fields = ['customfield_17031','customfield_17016','customfield_17238'];
$il_array_fields  = ['customfield_17066','customfield_17024','customfield_17023'];
foreach ($il_select_fields as $fid) {
    if (isset($jira_fields[$fid])) continue; // already handled by jira_config.json mapping
    $val = trim($fields_in[$fid] ?? '');
    if ($val === '') continue;
    $jira_fields[$fid] = ['value' => $val];
}
foreach ($il_array_fields as $fid) {
    if (isset($jira_fields[$fid])) continue;
    $val = trim($fields_in[$fid] ?? '');
    if ($val === '') continue;
    $items = array_values(array_filter(array_map('trim', explode(',', $val))));
    if ($items) $jira_fields[$fid] = array_map(fn($v) => ['value' => $v], $items);
}

// ── Batch-specific custom fields (not stored in jira_config.json) ──
// Single-option select: needs { "value": "..." }
foreach (['customfield_17019', 'customfield_17030'] as $fid) {
    if (!empty($fields_in[$fid]) && is_string($fields_in[$fid])) {
        $jira_fields[$fid] = ['value' => $fields_in[$fid]];
    }
}
// Cascading select: passed as array { value, child? } — use as-is
if (!empty($fields_in['customfield_17058']) && is_array($fields_in['customfield_17058'])) {
    $jira_fields['customfield_17058'] = $fields_in['customfield_17058'];
}

$jira_payload = json_encode(['fields' => $jira_fields]);

// Basic auth header
$auth = base64_encode(jiraEmail() . ':' . jiraToken());

$ch = curl_init(JIRA_BASE_URL . '/rest/api/3/issue');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => $jira_payload,
    CURLOPT_HTTPHEADER     => [
        'Authorization: Basic ' . $auth,
        'Content-Type: application/json',
        'Accept: application/json'
    ],
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_TIMEOUT        => 15
]);

$response  = curl_exec($ch);
$http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curl_err  = curl_error($ch);
curl_close($ch);

if ($curl_err) {
    respondError('Connection to Jira failed: ' . $curl_err, 502);
}

$result = json_decode($response, true);

if ($http_code === 201) {
    $issue_key = $result['key'] ?? 'UNKNOWN';
    $issue_url = JIRA_BASE_URL . '/browse/' . $issue_key;
    logActivity('jira_create_ticket', ['issue_key' => $issue_key, 'summary' => $summary], $payload['sub'], $payload['name']);
    respondOk([
        'issue_key' => $issue_key,
        'issue_url' => $issue_url
    ], "Ticket created: $issue_key");
} else {
    $errors     = $result['errors']        ?? [];
    $errMsgs    = $result['errorMessages'] ?? [];

    $parts = [];
    foreach ($errors as $field => $msg) {
        $parts[] = "$field: $msg";
    }
    foreach ($errMsgs as $msg) {
        $parts[] = $msg;
    }

    $error_msg = $parts ? implode(' | ', $parts) : ('HTTP ' . $http_code);
    // Include raw Jira response for easier debugging
    respond([
        'success' => false,
        'message' => $error_msg,
        'jira_errors'   => $errors,
        'jira_messages' => $errMsgs,
        'jira_payload'  => json_decode($jira_payload, true),
    ], 422);
}
