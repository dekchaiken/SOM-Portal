<?php
/**
 * get-field-options.php
 * Fetch Jira custom field options (select/multi-select values)
 */
require_once __DIR__ . '/../helpers.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    respondError('Method not allowed', 405);
}

requireAuth();

$fieldId = $_GET['fieldId'] ?? '';
if (!$fieldId) {
    respondError('Missing fieldId parameter', 400);
}

// Basic auth header
$auth = base64_encode(jiraEmail() . ':' . jiraToken());

// Get field metadata including allowed values
$url = JIRA_BASE_URL . '/rest/api/3/field/' . urlencode($fieldId);

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER     => [
        'Authorization: Basic ' . $auth,
        'Accept: application/json'
    ],
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_TIMEOUT        => 10
]);

$response  = curl_exec($ch);
$http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curl_err  = curl_error($ch);
curl_close($ch);

if ($curl_err) {
    respondError('Connection to Jira failed: ' . $curl_err, 502);
}

if ($http_code !== 200) {
    respondError('Jira API error: HTTP ' . $http_code, $http_code);
}

$fieldData = json_decode($response, true);

// Try to get allowed values from field schema
$allowedValues = [];

// For custom fields, we need to get the create metadata for the project
$metaUrl = JIRA_BASE_URL . '/rest/api/3/issue/createmeta?projectKeys=' . JIRA_PROJECT_KEY . '&expand=projects.issuetypes.fields';

$ch = curl_init($metaUrl);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER     => [
        'Authorization: Basic ' . $auth,
        'Accept: application/json'
    ],
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_TIMEOUT        => 10
]);

$metaResponse  = curl_exec($ch);
$metaHttpCode  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($metaHttpCode === 200) {
    $metaData = json_decode($metaResponse, true);
    
    // Navigate through the metadata structure
    foreach ($metaData['projects'] ?? [] as $project) {
        foreach ($project['issuetypes'] ?? [] as $issueType) {
            if (isset($issueType['fields'][$fieldId])) {
                $field = $issueType['fields'][$fieldId];
                
                // Get allowed values
                if (isset($field['allowedValues'])) {
                    foreach ($field['allowedValues'] as $option) {
                        $allowedValues[] = [
                            'value' => $option['value'] ?? $option['name'] ?? '',
                            'id'    => $option['id'] ?? null,
                        ];
                    }
                    break 2;
                }
            }
        }
    }
}

respondOk([
    'fieldId'       => $fieldId,
    'name'          => $fieldData['name'] ?? 'Unknown',
    'allowedValues' => $allowedValues,
    'schema'        => $fieldData['schema'] ?? null,
]);
