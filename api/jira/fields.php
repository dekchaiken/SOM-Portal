<?php
require_once __DIR__ . '/../helpers.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') respondError('Method not allowed', 405);

requireAuth();

if (!JIRA_BASE_URL || !jiraCredsReady()) {
    respondError('Jira not configured', 503);
}

$auth = base64_encode(jiraEmail() . ':' . jiraToken());

$ch = curl_init(JIRA_BASE_URL . '/rest/api/3/field');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER     => ['Authorization: Basic ' . $auth, 'Accept: application/json'],
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_TIMEOUT        => 15,
]);
$body = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$err  = curl_error($ch);
curl_close($ch);

if ($err)        respondError('Jira connection failed: ' . $err, 502);
if ($code !== 200) respondError('Jira API error: ' . $code, 502);

$fields = json_decode($body, true) ?? [];

// Return only custom fields with id + name
$custom = array_values(array_filter($fields, fn($f) => str_starts_with($f['id'], 'customfield_')));
usort($custom, fn($a, $b) => strcmp($a['name'], $b['name']));

respondOk(array_map(fn($f) => [
    'id'   => $f['id'],
    'name' => $f['name'],
    'type' => $f['schema']['type'] ?? ($f['schema']['custom'] ?? ''),
], $custom));
