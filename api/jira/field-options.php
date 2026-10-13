<?php
require_once __DIR__ . '/../helpers.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') respondError('Method not allowed', 405);

requireAuth();

if (!JIRA_BASE_URL || !jiraCredsReady()) {
    respondError('Jira not configured', 503);
}

$auth = base64_encode(jiraEmail() . ':' . jiraToken());

function jiraGet(string $url, string $auth): ?array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => [
            'Authorization: Basic ' . $auth,
            'Accept: application/json',
        ],
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => 0,
        CURLOPT_TIMEOUT        => 15,
    ]);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($code !== 200) return null;
    return json_decode($body, true);
}

// ── 1. Get createmeta (has allowedValues for some fields) ──────────────────
$meta = jiraGet(
    JIRA_BASE_URL . '/rest/api/3/issue/createmeta'
    . '?projectKeys=' . urlencode(JIRA_PROJECT_KEY)
    . '&expand=projects.issuetypes.fields',
    $auth
);

// Merge fields from all issue types
$all_fields = [];
foreach (($meta['projects'][0]['issuetypes'] ?? []) as $it) {
    foreach (($it['fields'] ?? []) as $fid => $fdata) {
        if (!isset($all_fields[$fid])) $all_fields[$fid] = $fdata;
    }
}

// ── 2. Helper: fetch options via context API (Jira Cloud) ──────────────────
function fetchOptionsViaContext(string $fieldId, string $auth): array {
    global $JIRA_BASE_URL_GLOBAL;
    // Get contexts for this field
    $ctxData = jiraGet(
        $JIRA_BASE_URL_GLOBAL . '/rest/api/3/field/' . urlencode($fieldId) . '/context',
        $auth
    );
    if (empty($ctxData['values'])) return [];

    $options = [];
    foreach ($ctxData['values'] as $ctx) {
        $ctxId   = $ctx['id'];
        $optData = jiraGet(
            $JIRA_BASE_URL_GLOBAL . '/rest/api/3/field/' . urlencode($fieldId)
            . '/context/' . $ctxId . '/option?maxResults=200',
            $auth
        );
        foreach ($optData['values'] ?? [] as $opt) {
            $label = $opt['value'] ?? $opt['optionId'] ?? '';
            if ($label !== '' && !in_array($label, $options)) {
                $options[] = $label;
            }
        }
    }
    return $options;
}

// Need global for the helper above
$JIRA_BASE_URL_GLOBAL = JIRA_BASE_URL;

// ── 3. Build result for each configured custom field ───────────────────────
$jira_cfg      = readJson('jira_config.json');
$custom_fields = $jira_cfg['custom_fields'] ?? [];

$result = [];
foreach ($custom_fields as $cf) {
    $fid   = $cf['field_id'] ?? '';
    $ftype = $cf['field_type'] ?? 'text';
    if (!$fid || $ftype === 'text' || $ftype === 'fault_start') continue;

    // Try createmeta allowedValues first
    $options = [];
    $allowed = $all_fields[$fid]['allowedValues'] ?? [];
    foreach ($allowed as $opt) {
        $label = $opt['value'] ?? $opt['name'] ?? '';
        if ($label !== '') $options[] = $label;
    }

    // Fallback: context API if createmeta returned nothing
    if (empty($options)) {
        $options = fetchOptionsViaContext($fid, $auth);
    }

    $result[$fid] = [
        'label'   => $cf['label'],
        'type'    => $ftype,
        'options' => array_values($options),
    ];
}

respondOk($result);
