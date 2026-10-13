<?php
/**
 * batch-fields.php
 * GET — returns options for the 3 batch-specific Jira custom fields:
 *   customfield_17019  SM Priority      (option)
 *   customfield_17030  Batch Issue      (option)
 *   customfield_17058  Batch File Type  (option-with-child / cascading select)
 */
require_once __DIR__ . '/../helpers.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') respondError('Method not allowed', 405);
requireAuth();

if (!JIRA_BASE_URL || !jiraCredsReady()) {
    respondError('Jira not configured', 503);
}

$auth = base64_encode(jiraEmail() . ':' . jiraToken());

function bfGet(string $url, string $auth): ?array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => [
            'Authorization: Basic ' . $auth,
            'Accept: application/json',
        ],
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_TIMEOUT        => 15,
    ]);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($code !== 200) return null;
    return json_decode($body, true);
}

// Fetch createmeta to get allowedValues for all issue types
$meta = bfGet(
    JIRA_BASE_URL . '/rest/api/3/issue/createmeta'
    . '?projectKeys=' . urlencode(JIRA_PROJECT_KEY)
    . '&expand=projects.issuetypes.fields',
    $auth
);

$all_fields = [];
foreach (($meta['projects'][0]['issuetypes'] ?? []) as $it) {
    foreach (($it['fields'] ?? []) as $fid => $fdata) {
        if (!isset($all_fields[$fid])) $all_fields[$fid] = $fdata;
    }
}

// Fallback: fetch via context API (returns flat options only)
function bfOptionsViaContext(string $fieldId, string $auth): array {
    global $JIRA_BASE_URL_GLOBAL;
    $ctxData = bfGet(
        $JIRA_BASE_URL_GLOBAL . '/rest/api/3/field/' . urlencode($fieldId) . '/context',
        $auth
    );
    if (empty($ctxData['values'])) return [];
    $options = [];
    foreach ($ctxData['values'] as $ctx) {
        $optData = bfGet(
            $JIRA_BASE_URL_GLOBAL . '/rest/api/3/field/' . urlencode($fieldId)
            . '/context/' . $ctx['id'] . '/option?maxResults=200',
            $auth
        );
        foreach ($optData['values'] ?? [] as $opt) {
            $label = $opt['value'] ?? '';
            if ($label !== '') $options[] = $label;
        }
    }
    return array_values(array_unique($options));
}

$JIRA_BASE_URL_GLOBAL = JIRA_BASE_URL;

// ── SM Priority (simple option) ───────────────────────────────────
$smOpts = [];
foreach (($all_fields['customfield_17019']['allowedValues'] ?? []) as $v) {
    if (!empty($v['value'])) $smOpts[] = $v['value'];
}
if (empty($smOpts)) $smOpts = bfOptionsViaContext('customfield_17019', $auth);

// ── Batch Issue (simple option) ───────────────────────────────────
$biOpts = [];
foreach (($all_fields['customfield_17030']['allowedValues'] ?? []) as $v) {
    if (!empty($v['value'])) $biOpts[] = $v['value'];
}
if (empty($biOpts)) $biOpts = bfOptionsViaContext('customfield_17030', $auth);

// ── Batch File Type (option-with-child / cascading select) ────────
$ftOpts = [];
foreach (($all_fields['customfield_17058']['allowedValues'] ?? []) as $parent) {
    $pVal = $parent['value'] ?? '';
    if ($pVal === '') continue;
    $children = [];
    foreach (($parent['children'] ?? []) as $child) {
        $cVal = $child['value'] ?? '';
        if ($cVal !== '') $children[] = $cVal;
    }
    $ftOpts[] = ['value' => $pVal, 'children' => $children];
}
// Fallback via context API for cascading selects
if (empty($ftOpts)) {
    $ctxData = bfGet(
        JIRA_BASE_URL . '/rest/api/3/field/customfield_17058/context',
        $auth
    );
    foreach (($ctxData['values'] ?? []) as $ctx) {
        $optData = bfGet(
            JIRA_BASE_URL . '/rest/api/3/field/customfield_17058'
            . '/context/' . $ctx['id'] . '/option?maxResults=200',
            $auth
        );
        // Build parent→children map
        $parentMap = [];
        foreach ($optData['values'] ?? [] as $opt) {
            if (empty($opt['optionId'])) {
                // parent option
                $parentMap[$opt['id']] = ['value' => $opt['value'], 'children' => []];
            }
        }
        foreach ($optData['values'] ?? [] as $opt) {
            if (!empty($opt['optionId']) && isset($parentMap[$opt['optionId']])) {
                $parentMap[$opt['optionId']]['children'][] = $opt['value'];
            }
        }
        foreach ($parentMap as $p) {
            $ftOpts[] = $p;
        }
    }
}

respondOk([
    'sm_priority'    => ['label' => 'SM Priority',    'field_id' => 'customfield_17019', 'options' => $smOpts],
    'batch_issue'    => ['label' => 'Batch Issue',     'field_id' => 'customfield_17030', 'options' => $biOpts],
    'batch_file_type'=> ['label' => 'Batch File Type', 'field_id' => 'customfield_17058', 'options' => $ftOpts],
]);
