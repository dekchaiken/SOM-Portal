<?php
/**
 * Assign (or unassign) a Jira issue.
 * POST /api/jira/assign.php
 *   Body: { key: "SMC-123", accountId: "abc..." | null }
 *
 * Pass accountId = null  → unassign
 * Pass accountId = "..." → assign to that user
 */
require_once __DIR__ . '/../helpers.php';

try {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') respondError('Method not allowed', 405);

    $payload = requireAuth();
    requireRole($payload, ALL_STAFF_ROLES);

    if (!jiraCredsReady()) respondError('Jira credentials not configured', 500);

    $body      = getBody();
    $key       = trim($body['key'] ?? '');
    $accountId = array_key_exists('accountId', $body) ? $body['accountId'] : '';

    if (!$key || !preg_match('/^[A-Z]+-\d+$/', $key)) respondError('Invalid key', 400);

    // Jira API v3: { accountId: "..." } or { accountId: null } to unassign
    $jiraPayload = json_encode(['accountId' => $accountId === '' ? null : $accountId]);

    $ch = curl_init(JIRA_BASE_URL . '/rest/api/3/issue/' . urlencode($key) . '/assignee');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST  => 'PUT',
        CURLOPT_POSTFIELDS     => $jiraPayload,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => 0,
        CURLOPT_HTTPHEADER     => [
            'Authorization: Basic ' . base64_encode(jiraEmail() . ':' . jiraToken()),
            'Accept: application/json',
            'Content-Type: application/json',
        ],
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);

    if ($err) respondError('Cannot reach Jira: ' . $err, 502);
    // Jira returns 204 on success
    if ($code !== 204) {
        $data = json_decode($resp, true);
        $msg  = $data['errorMessages'][0] ?? "HTTP {$code}";
        respondError("Jira: {$msg}", 502);
    }

    logActivity('jira_assign', ['key' => $key, 'accountId' => $accountId ?: '(unassign)'], $payload['sub'], $payload['name'] ?? '');
    respondOk(['assigned' => true]);

} catch (\Throwable $e) {
    respondError('Server error: ' . $e->getMessage(), 500);
}
