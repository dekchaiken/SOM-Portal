<?php
/**
 * Fetch required fields for a specific Jira transition.
 * GET /api/jira/transition-fields.php?key=SMC-123&transitionId=31
 */
require_once __DIR__ . '/../helpers.php';

try {
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') respondError('Method not allowed', 405);

    $payload = requireAuth();
    requireRole($payload, ALL_STAFF_ROLES);

    if (!jiraCredsReady()) respondError('Jira credentials not configured', 500);

    $key          = trim($_GET['key']          ?? '');
    $transitionId = trim($_GET['transitionId'] ?? '');

    if (!$key || !preg_match('/^[A-Z]+-\d+$/', $key)) respondError('Invalid issue key', 400);
    if (!$transitionId) respondError('transitionId required', 400);

    $url = JIRA_BASE_URL . '/rest/api/3/issue/' . urlencode($key) . '/transitions?expand=transitions.fields';
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 12,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => 0,
        CURLOPT_HTTPHEADER     => [
            'Authorization: Basic ' . base64_encode(jiraEmail() . ':' . jiraToken()),
            'Accept: application/json',
        ],
    ]);
    $resp = curl_exec($ch);
    $err  = curl_error($ch);
    curl_close($ch);

    if ($err) respondError('Cannot reach Jira: ' . $err, 502);

    $data   = json_decode($resp, true) ?? [];
    $fields = [];

    foreach ($data['transitions'] ?? [] as $t) {
        if ((string)$t['id'] !== (string)$transitionId) continue;

        foreach ($t['fields'] ?? [] as $fieldId => $f) {
            $type    = $f['schema']['type']  ?? 'string';
            $items   = $f['schema']['items'] ?? null;

            $allowed = [];
            foreach ($f['allowedValues'] ?? [] as $av) {
                $allowed[] = [
                    'id'          => $av['id']          ?? null,
                    'value'       => $av['value']       ?? $av['name'] ?? ($av['id'] ?? ''),
                    'accountId'   => $av['accountId']   ?? null,
                    'displayName' => $av['displayName'] ?? null,
                ];
            }

            $fields[] = [
                'fieldId'       => $fieldId,
                'name'          => $f['name']     ?? $fieldId,
                'required'      => (bool)($f['required'] ?? false),
                'type'          => $type,
                'items'         => $items,
                'allowedValues' => $allowed,
                'hasSearch'     => !empty($f['autoCompleteUrl']),
            ];
        }
        break;
    }

    respondOk(['fields' => $fields]);

} catch (\Throwable $e) {
    respondError('Server error: ' . $e->getMessage(), 500);
}
